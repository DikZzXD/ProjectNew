/**
 * GramJS wrapper — a Telegram *user* account (not a bot) driven from a Worker.
 *
 * Telethon, which the reference script uses, is Python and cannot run here, so
 * the userbot is rebuilt on GramJS. That works inside workerd, but only under
 * conditions worth writing down because none of them are obvious:
 *
 *   • Transport is WebSocket, not TCP. Workers have no raw sockets, so the client
 *     must be handed GramJS's browser transport pair explicitly —
 *     `ConnectionTCPObfuscated` + `PromisedWebSockets`. The defaults are chosen
 *     from `isNode`, which is TRUE here (see below), so without this it would try
 *     `net.Socket` and fail immediately. `useWSS: true` then selects port 443, and
 *     PromisedWebSockets already passes the `'binary'` subprotocol Telegram
 *     requires — a plain `new WebSocket(url)` is answered with 404. Raw DC IPs do
 *     not work over this transport; the `*.web.telegram.org` hostnames are
 *     mandatory.
 *   • Those hostnames are only used if GramJS thinks it is *not* Node. It decides
 *     from `typeof window`, which is undefined in a Worker, so both the initial DC
 *     seed (`149.154.167.91`) and `getDC()` after a migration hand back TCP IPs.
 *     `webDcOverride()` patches `getDC`, and `connect()` re-seeds a fresh session,
 *     so every address the socket ever sees is a web hostname.
 *   • On the HTTP path a client is per-request: connect → invoke → save session →
 *     disconnect, with the session string carrying state between requests. The
 *     cron path is different — a Cron Trigger invocation gets 15 minutes of wall
 *     time, so src/lib/ubotloop.js holds one client open and polls on it, which is
 *     how commands get answered in seconds.
 *
 * The DH handshake costs ~2.5-3 s. That is the floor on every HTTP call, and the
 * main reason the loop connects once and reuses the client.
 */

/** GramJS is ~2.4 MB of generated TL schema; keep it out of the cold path. */
async function gram() {
  const [{ TelegramClient, Api, errors }, { StringSession }, { PromisedWebSockets }, { ConnectionTCPObfuscated }] =
    await Promise.all([
      import('telegram'),
      import('telegram/sessions/index.js'),
      import('telegram/extensions/index.js'),
      import('telegram/network/index.js'),
    ]);
  return { TelegramClient, Api, errors, StringSession, PromisedWebSockets, ConnectionTCPObfuscated };
}

export { gram };

/** Anything Telegram or the transport rejected, in a shape the endpoints can map. */
export class UbotError extends Error {
  constructor(message, status = 400, code = '') {
    super(message);
    this.name = 'UbotError';
    this.status = status;
    this.code = code;
  }
}

export const DEFAULT_API_ID = 39191050;
export const DEFAULT_API_HASH = '2ee2a563b5e174e6c5f8009992722284';

/**
 * api_id/api_hash identify the Telegram *app*, with default values provided
 * from the userbot configuration (39191050 / 2ee2a563b5e174e6c5f8009992722284),
 * while still allowing callers/env to provide custom credentials if desired.
 */
export function credentials(env, params = {}) {
  const apiId = Number(params.api_id || env?.UBOT_API_ID || DEFAULT_API_ID);
  const apiHash = String(params.api_hash || env?.UBOT_API_HASH || DEFAULT_API_HASH).trim();

  if (!Number.isInteger(apiId) || apiId <= 0) {
    throw new UbotError(
      'Parameter "api_id" tidak valid — harus angka positif',
      400,
      'API_ID_MISSING'
    );
  }
  if (!/^[a-f0-9]{32}$/i.test(apiHash)) {
    throw new UbotError('Parameter "api_hash" tidak valid — harus 32 karakter hex', 400, 'API_HASH_INVALID');
  }
  return { apiId, apiHash };
}

/** +62… — the only shape Telegram accepts, so normalise before asking. */
export function normalisePhone(raw) {
  const digits = String(raw || '').replace(/[^\d+]/g, '');
  const plus = digits.startsWith('+') ? digits.slice(1) : digits;
  const clean = plus.replace(/\D/g, '');

  if (clean.length < 8 || clean.length > 16) {
    throw new UbotError('Nomor telepon tidak valid. Pakai format internasional, contoh +628123456789', 400, 'PHONE_INVALID');
  }
  // Local Indonesian style (08xx) is the common paste, so fix it rather than reject.
  return `+${clean.startsWith('0') ? `62${clean.slice(1)}` : clean}`;
}

/**
 * Build a connected client from a session string ('' for a fresh login).
 *
 * `connectionRetries: 2` and a 25 s timeout are deliberate: a Worker request has
 * a wall-clock budget, and a stuck handshake should surface as a clean capacity
 * message rather than a hung request.
 */
export async function connect({ session = '', apiId, apiHash }) {
  const { TelegramClient, StringSession, PromisedWebSockets, ConnectionTCPObfuscated } = await gram();
  const store = new StringSession(String(session || ''));

  // GramJS reads `typeof window` to decide Node vs browser, and a Worker has no
  // `window` — so every transport default lands on TCP, which workerd cannot do.
  // With nodejs_compat, the `websocket` npm package works (it uses Node's net/tls
  // which are polyfilled). WorkersWebSocket is a fallback for environments where
  // that fails. Try PromisedWebSockets first since it's proven on this platform.
  const client = new TelegramClient(store, apiId, apiHash, {
    connection: ConnectionTCPObfuscated,
    networkSocket: PromisedWebSockets,
    connectionRetries: 2,
    useWSS: true,
    timeout: 25,
    autoReconnect: false,
    // The reference userbot sleeps through short flood waits; anything longer is
    // reported back so the caller can decide.
    floodSleepThreshold: 30,
    deviceModel: 'Chrome',
    systemVersion: 'Windows',
    appVersion: '5.5.5',
  });

  client.setLogLevel?.('none');
  webDcOverride(client);

  // A fresh session would otherwise be seeded with the Node default IP. Point it
  // at the web DC before the first connect, not just after a migration.
  if (!session) {
    const dc = await client.getDC(4);
    store.setDC(dc.id, dc.ipAddress, dc.port);
  }

  try {
    await client.connect();
  } catch (error) {
    throw new UbotError(
      'Tidak bisa menyambung ke Telegram saat ini. Coba lagi beberapa saat lagi.',
      503,
      short(error) || 'CONNECT_FAILED'
    );
  }

  if (!client.connected) {
    throw new UbotError('Koneksi ke Telegram terputus sebelum siap. Coba lagi.', 503, 'NOT_CONNECTED');
  }

  return client;
}

/**
 * Force the wss:// DC addresses on migration.
 *
 * GramJS picks TCP IPs vs web hostnames from `isNode`, which is true in a Worker
 * because there is no `window`. Without this, a PHONE_MIGRATE (very common — a
 * fresh session starts on DC 4 and most accounts live elsewhere) would reconnect
 * to an IP that never completes a WebSocket handshake.
 */
function webDcOverride(client) {
  const WEB_DC = { 1: 'pluto', 2: 'venus', 3: 'aurora', 4: 'vesta', 5: 'flora' };
  const original = client.getDC.bind(client);

  client.getDC = async (dcId, downloadDC = false, web = false) => {
    const host = WEB_DC[dcId];
    if (!host) return original(dcId, downloadDC, web);
    return { id: dcId, ipAddress: `${host}${downloadDC ? '-1' : ''}.web.telegram.org`, port: 443 };
  };
}

/** Best-effort teardown; a Worker isolate would otherwise keep the socket warm. */
export async function close(client) {
  try {
    await client?.destroy();
  } catch {
    /* the request is already answered — nothing useful to do here */
  }
}

/** The session string as it stands now, so a caller can persist any rotation. */
export function sessionOf(client) {
  try {
    return client.session.save() || '';
  } catch {
    return '';
  }
}

/** Who we are logged in as, flattened for the JSON envelope. */
export function describeUser(user) {
  if (!user) return null;
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return {
    id: String(user.id ?? ''),
    name: name || null,
    username: user.username || null,
    phone: user.phone ? `+${String(user.phone).replace(/^\+/, '')}` : null,
    premium: Boolean(user.premium),
  };
}

function short(error) {
  return String(error?.errorMessage || error?.message || error || '').slice(0, 80);
}

export { short };
