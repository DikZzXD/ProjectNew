/**
 * Feasibility probe 2: MTProto transport inside workerd.
 *
 * GramJS in a browser talks to Telegram over `wss://<dc>.web.telegram.org/apiws`
 * using the global WebSocket constructor. Workers expose `new WebSocket(url)`,
 * so the questions are:
 *   1. does the outbound WebSocket to Telegram open at all?
 *   2. does GramJS's DH auth-key exchange complete (connect() with no api_id)?
 *
 * `?mode=ws` tests (1) with no dependencies; `?mode=connect` tests (2).
 */

const WS_URL = 'wss://venus.web.telegram.org/apiws';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const mode = url.searchParams.get('mode') || 'ws';

    if (mode === 'ws') return rawSocket();
    if (mode === 'connect') return gramConnect(url);
    return Response.json({ error: 'mode=ws|connect' }, { status: 400 });
  },
};

/** Can a Worker open a plain outbound WebSocket to Telegram's web DC? */
async function rawSocket() {
  // Telegram's web transport is picky about both host and subprotocol, so try a
  // spread rather than guessing once.
  const attempts = [
    ['wss://venus.web.telegram.org/apiws', undefined],
    ['wss://venus.web.telegram.org/apiws', 'binary'],
    ['wss://flora.web.telegram.org/apiws', 'binary'],
    ['wss://vesta.web.telegram.org/apiws', 'binary'],
    ['wss://zws1.web.telegram.org/apiws', 'binary'],
    ['wss://149.154.167.51/apiws', 'binary'],
  ];

  const results = [];
  for (const [target, protocol] of attempts) {
    results.push({ target, protocol: protocol || null, ...(await tryOpen(target, protocol)) });
  }
  return Response.json({ wsGlobal: typeof WebSocket, results });
}

function tryOpen(target, protocol) {
  return new Promise((resolve) => {
    let ws;
    try {
      ws = protocol ? new WebSocket(target, protocol) : new WebSocket(target);
    } catch (error) {
      resolve({ opened: false, threw: String(error?.message || error).slice(0, 160) });
      return;
    }
    const finish = (v) => {
      try {
        ws.close();
      } catch {
        /* already gone */
      }
      resolve(v);
    };
    const timer = setTimeout(() => finish({ opened: false, reason: 'timeout 12s' }), 12_000);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      finish({ opened: true, negotiated: ws.protocol || '' });
    });
    ws.addEventListener('error', (e) => {
      clearTimeout(timer);
      finish({ opened: false, reason: String(e?.message || 'error').slice(0, 160) });
    });
    ws.addEventListener('close', (e) => {
      clearTimeout(timer);
      finish({ opened: false, reason: `closed ${e?.code}` });
    });
  });
}

/**
 * Full GramJS connect. api_id/api_hash are only needed once a request is wrapped
 * in initConnection, so the DH handshake should complete with placeholders —
 * which is exactly what we want to know before designing around this.
 */
async function gramConnect(url) {
  const out = { step: 'import' };
  try {
    const { TelegramClient } = await import('telegram');
    const { StringSession } = await import('telegram/sessions/index.js');

    const apiId = Number(url.searchParams.get('api_id') || 1);
    const apiHash = url.searchParams.get('api_hash') || '0'.repeat(32);

    out.step = 'construct';
    const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
      connectionRetries: 1,
      useWSS: true,
      timeout: 20,
    });
    client.setLogLevel?.('error');

    out.step = 'connect';
    const started = Date.now();
    await client.connect();
    out.connectMs = Date.now() - started;
    out.connected = Boolean(client.connected);
    out.sessionLen = client.session.save()?.length || 0;

    // Prove the RPC layer works too, not just the handshake. With a bogus api_id
    // Telegram answers API_ID_INVALID — an *application* error, which is exactly
    // the confirmation we want: the request was decrypted and processed.
    const phone = url.searchParams.get('phone');
    if (phone) {
      out.step = 'sendCode';
      const { Api } = await import('telegram');
      try {
        const sent = await client.invoke(
          new Api.auth.SendCode({
            phoneNumber: phone,
            apiId,
            apiHash,
            settings: new Api.CodeSettings({}),
          })
        );
        out.sendCode = { className: sent.className, type: sent.type?.className || null };
      } catch (error) {
        out.sendCode = { rpcError: String(error?.errorMessage || error?.message || error).slice(0, 120) };
      }
    }

    try {
      await client.disconnect();
    } catch {
      /* best effort */
    }
    return Response.json({ ok: true, ...out });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        ...out,
        error: String(error?.message || error),
        stack: String(error?.stack || '').split('\n').slice(0, 8),
      },
      { status: 500 }
    );
  }
}
