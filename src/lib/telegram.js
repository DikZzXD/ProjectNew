/**
 * Telegram bot — owner-only management for the rewind AI key pool and the
 * nonecap captcha key pool, plus a few basic commands. Wired to a webhook at
 * POST /api/telegram (see src/index.js).
 *
 * Every update is checked against OWNER_ID first: a message from anyone else gets
 * a polite refusal and nothing is touched. Commands:
 *
 *   /start, /help        show the command list
 *   /ping                liveness check
 *   /stats               endpoint + key-pool counts
 *   /addrewind <k|k|k>   add one or more keys (pipe-separated for bulk)
 *   /listrewind          list keys as inline buttons; tap one → hapus / kembali
 *   /delrewind <id>      delete a key by id (also reachable from the buttons)
 *   /createrewind <n> <w>  auto-provision n rewind accounts (w lanes, default 10)
 *   /addnonecap <keys>   bulk-add nonecap keys (newline/space/comma separated)
 *   /listnonecap         pool health: uses, fail streak, last error
 *   /delnonecap <id>     drop one nonecap key
 *   /clearnonecap        wipe the nonecap pool (asks for confirmation)
 *
 * Keys are only ever shown masked (sk-…abcd). The bot token and owner id come
 * from wrangler [vars]; nothing is hard-coded here.
 */

import { provisionMany } from './rewindsignup.js';
import { pool, maskKey, MAX_FAILS } from './keypool.js';

const API = 'https://api.telegram.org/bot';

/**
 * Provisioning caps. Each account costs roughly 15-20 subrequests (claim mail,
 * signup, inbox polls, verify, api-key) and a Worker gets 1000 per invocation,
 * so 40 accounts is the safe ceiling.
 */
const MAX_CREATE = 40;
const DEFAULT_WORKERS = 10;

/** Mask a key so the full secret never lands in a chat log. */
function mask(key) {
  const s = String(key || '');
  if (s.length <= 10) return '••••';
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

async function tg(env, method, body) {
  const res = await fetch(`${API}${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => ({}));
}

const sendMessage = (env, chatId, text, extra = {}) =>
  tg(env, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });

const HELP = [
  '<b>DIKZZAPI · Rewind Bot</b>',
  '',
  '<b>Umum</b>',
  '• /help — daftar perintah',
  '• /ping — cek bot hidup',
  '• /stats — jumlah endpoint &amp; key',
  '',
  '<b>Rewind AI</b>',
  '• /addrewind &lt;key&gt; — tambah key (pisah dengan | untuk banyak)',
  '• /listrewind — lihat semua key (tombol hapus/kembali)',
  '• /delrewind &lt;id&gt; — hapus key by id',
  `• /createrewind &lt;jumlah&gt; &lt;worker&gt; — bikin akun rewind otomatis (worker default ${DEFAULT_WORKERS}, maks ${MAX_CREATE})`,
  '',
  '<b>Nonecap (captcha)</b>',
  '• /addnonecap &lt;keys&gt; — tambah banyak sekaligus, pisah pakai baris baru / spasi / koma. Bisa 100+ sekali kirim.',
  '• Atau kirim <b>file .txt</b> isi key (satu per baris) — cara paling aman buat 100+ key.',
  '• /listnonecap — kondisi pool (pakai, gagal, error terakhir)',
  '• /delnonecap &lt;id&gt; — hapus satu key',
  '• /clearnonecap — kosongkan pool',
  '',
  `<i>Key mati (saldo habis / tidak valid) kehapus sendiri saat dipakai. Key yang gagal terus ${MAX_FAILS}x juga ikut kehapus.</i>`,
  '',
  '<i>Khusus owner.</i>',
].join('\n');

/** Ensure the table exists — the bot may run before schema.sql is applied. */
async function ensureTable(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS rewind_keys (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       key TEXT NOT NULL UNIQUE,
       label TEXT NOT NULL DEFAULT '',
       added_at INTEGER NOT NULL
     )`
  ).run();
}

async function addKeys(env, raw) {
  const keys = String(raw || '')
    .split('|')
    .map((k) => k.trim())
    .filter(Boolean);

  if (!keys.length) return { added: 0, skipped: 0, invalid: 0, rejected: [] };

  await ensureTable(env);
  let added = 0;
  let skipped = 0;
  let invalid = 0;
  const rejected = [];
  const now = Date.now();

  for (const key of keys) {
    // Accept any realistic API-key token, not just sk- prefixes: letters,
    // digits, and . _ - are all common in provider keys. Only obviously
    // malformed input (too short, or with spaces/other junk) is rejected.
    if (!/^[A-Za-z0-9._-]{12,}$/.test(key)) {
      invalid += 1;
      rejected.push(mask(key));
      continue;
    }
    try {
      const r = await env.DB.prepare(
        'INSERT OR IGNORE INTO rewind_keys (key, label, added_at) VALUES (?1, ?2, ?3)'
      )
        .bind(key, mask(key), now)
        .run();
      if (r.meta?.changes) added += 1;
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  return { added, skipped, invalid, rejected };
}

async function listKeys(env) {
  await ensureTable(env);
  const { results } = await env.DB.prepare(
    'SELECT id, key, added_at FROM rewind_keys ORDER BY id ASC'
  ).all();
  return results || [];
}

async function delKey(env, id) {
  await ensureTable(env);
  const r = await env.DB.prepare('DELETE FROM rewind_keys WHERE id = ?1').bind(id).run();
  return Boolean(r.meta?.changes);
}

/**
 * Insert one freshly provisioned key. Bypasses addKeys()' format check — this
 * key came straight from the rewind API, so its shape is already known good.
 */
async function insertKey(env, key, label) {
  await ensureTable(env);
  try {
    const r = await env.DB.prepare(
      'INSERT OR IGNORE INTO rewind_keys (key, label, added_at) VALUES (?1, ?2, ?3)'
    )
      .bind(key, label || mask(key), Date.now())
      .run();
    return Boolean(r.meta?.changes);
  } catch {
    return false;
  }
}

/** Inline keyboard: one button per key, tapping shows the delete/back menu. */
function listKeyboard(keys) {
  if (!keys.length) return { inline_keyboard: [] };
  return {
    inline_keyboard: keys.map((k) => [
      { text: `# ${k.id} · ${mask(k.key)}`, callback_data: `view:${k.id}` },
    ]),
  };
}

/** The per-key menu: danger "Hapus" + neutral "Kembali". */
function keyMenu(id) {
  return {
    inline_keyboard: [
      [
        { text: '✕ Hapus', callback_data: `del:${id}` },
        { text: '‹ Kembali', callback_data: 'back' },
      ],
    ],
  };
}

/**
 * /createrewind runner. Provisions accounts, adds every key it gets straight
 * into the pool, and edits one progress message in place rather than spamming
 * the chat. Runs inside ctx.waitUntil so the webhook can answer 200 at once.
 */
async function runCreate(env, chatId, count, workers) {
  const started = Date.now();
  const head = `Membuat ${count} akun rewind — ${workers} worker paralel.`;

  const first = await sendMessage(env, chatId, `${head}\nStatus: menyiapkan...`);
  const messageId = first?.result?.message_id;

  const editProgress = (text) => {
    if (!messageId) return sendMessage(env, chatId, text);
    return tg(env, 'editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
    });
  };

  let added = 0;
  let failed = 0;
  let lastEdit = 0;

  const results = await provisionMany(count, workers, {
    keyName: 'dik',
    onResult: async (r, done, total) => {
      if (r.ok) {
        const stored = await insertKey(env, r.key, mask(r.key));
        if (stored) added += 1;
      } else {
        failed += 1;
      }

      // Telegram rate-limits edits; one every 3 s is plenty for a progress bar.
      const now = Date.now();
      if (now - lastEdit > 3000 || done === total) {
        lastEdit = now;
        await editProgress(
          `${head}\nProgres: ${done}/${total} selesai\nKey masuk pool: ${added}\nGagal: ${failed}`
        );
      }
    },
  });

  const okRows = results.filter((r) => r.ok);
  const verified = okRows.filter((r) => r.verified).length;
  const secs = Math.round((Date.now() - started) / 1000);

  const lines = [
    '<b>Selesai</b>',
    `Diminta: ${count} · Worker: ${workers} · Durasi: ${secs}s`,
    `Berhasil: ${okRows.length} · Gagal: ${results.length - okRows.length}`,
    `Terverifikasi: ${verified}/${okRows.length}`,
    `Key masuk pool: ${added}`,
  ];

  if (okRows.length) {
    lines.push('', '<b>Akun</b>');
    for (const r of okRows.slice(0, 20)) {
      lines.push(`- <code>${r.email}</code> · ${mask(r.key)} · ${r.verified ? 'verified' : 'unverified'}`);
    }
    if (okRows.length > 20) lines.push(`- ...dan ${okRows.length - 20} lainnya`);
  }

  const errors = results.filter((r) => !r.ok);
  if (errors.length) {
    lines.push('', '<b>Gagal</b>');
    const seen = new Map();
    for (const e of errors) {
      const k = `${e.step}: ${e.error}`;
      seen.set(k, (seen.get(k) || 0) + 1);
    }
    for (const [reason, n] of [...seen].slice(0, 6)) {
      lines.push(`- ${n}x ${reason.replace(/[<>]/g, '')}`);
    }
  }

  lines.push('', 'Cek dengan /listrewind.');
  await editProgress(lines.join('\n'));
}

/* ── Nonecap pool ─────────────────────────────────────────────────
 * The captcha pool is meant to be filled once with 100+ keys and then left
 * alone: src/lib/nonecap.js deletes a key the moment the solver says its balance
 * is empty or the key is invalid, so these commands are for loading and for
 * checking in, not for day-to-day gardening.
 */

/** Relative "3 menit lalu" style stamp — absolute times aren't useful here. */
function ago(ts) {
  if (!ts) return 'belum dipakai';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s lalu`;
  if (s < 3600) return `${Math.round(s / 60)}m lalu`;
  if (s < 86400) return `${Math.round(s / 3600)}j lalu`;
  return `${Math.round(s / 86400)}h lalu`;
}

async function nonecapAdd(env, arg) {
  const keys = pool(env);
  const { added, duplicate, invalid, invalidSamples } = await keys.addMany(arg);
  const total = await keys.count();

  const lines = [
    `<b>Nonecap</b> — ${added} masuk, ${duplicate} duplikat, ${invalid} tidak valid.`,
    `Total di pool sekarang: <b>${total}</b>`,
  ];
  if (invalidSamples.length) {
    lines.push(`Ditolak: ${invalidSamples.map((s) => `<code>${s}</code>`).join(', ')}`);
  }
  if (added) {
    lines.push('', '<i>Key dipakai bergilir (yang paling lama nganggur dulu). Yang saldonya habis kehapus otomatis.</i>');
  }
  return lines.join('\n');
}

async function nonecapList(env) {
  const keys = pool(env);
  const rows = await keys.list(100);
  if (!rows.length) {
    return 'Pool nonecap kosong. Tambah dengan <code>/addnonecap &lt;keys&gt;</code> — boleh 100+ sekaligus, pisah pakai baris baru.';
  }

  const total = await keys.count();
  const lines = [`<b>Nonecap pool (${total})</b>`, ''];

  // Cap the listing: 100 rows of detail would blow past Telegram's 4096-char
  // message limit, and the health summary is what actually matters at scale.
  for (const r of rows.slice(0, 25)) {
    const warn = r.fails ? ` ⚠ gagal ${r.fails}/${MAX_FAILS}` : '';
    const err = r.last_error ? ` · ${String(r.last_error).replace(/[<>]/g, '').slice(0, 40)}` : '';
    lines.push(`#${r.id} <code>${r.key}</code> · ${r.uses}x · ${ago(r.last_used)}${warn}${err}`);
  }
  if (rows.length > 25) lines.push(`…dan ${rows.length - 25} key lainnya`);

  const shaky = rows.filter((r) => r.fails > 0).length;
  const fresh = rows.filter((r) => !r.last_used).length;
  lines.push('', `Belum kepakai: ${fresh} · Bermasalah: ${shaky}`);
  lines.push('Hapus satu: <code>/delnonecap &lt;id&gt;</code>');
  return lines.join('\n');
}

/**
 * A .txt of keys sent to the bot is treated as an /addnonecap batch. One
 * Telegram message caps at 4096 characters — about 95 nonecap keys — so for a
 * pool of 100+ the file route is the one that actually works in a single shot.
 * Captioning the file with /addrewind loads the rewind pool instead.
 */
async function handleDocument(env, msg) {
  const chatId = msg.chat.id;
  const doc = msg.document;
  const caption = String(msg.caption || '').toLowerCase();

  if (doc.file_size > 512 * 1024) {
    return sendMessage(env, chatId, 'File kegedean (maks 512 KB). Pecah jadi beberapa file.');
  }

  const info = await tg(env, 'getFile', { file_id: doc.file_id });
  const path = info?.result?.file_path;
  if (!path) return sendMessage(env, chatId, 'Gagal ambil file dari Telegram, coba kirim ulang.');

  const res = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${path}`);
  if (!res.ok) return sendMessage(env, chatId, 'Gagal unduh file, coba kirim ulang.');
  const body = await res.text();

  if (caption.includes('/addrewind')) {
    const { added, skipped, invalid } = await addKeys(env, body.split(/[\s,;|]+/).filter(Boolean).join('|'));
    return sendMessage(env, chatId, `<b>Rewind</b> — ${added} masuk, ${skipped} duplikat, ${invalid} tidak valid.`);
  }

  return sendMessage(env, chatId, await nonecapAdd(env, body));
}

async function handleCommand(env, msg, ctx) {
  const chatId = msg.chat.id;
  const text = String(msg.text || '').trim();
  const [cmd, ...rest] = text.split(/\s+/);
  const arg = text.slice(cmd.length).trim();
  const base = cmd.split('@')[0].toLowerCase();

  switch (base) {
    case '/start':
    case '/help':
      return sendMessage(env, chatId, HELP);

    case '/ping':
      return sendMessage(env, chatId, '✓ pong — bot aktif.');

    case '/stats': {
      const keys = await listKeys(env);
      const nonecap = await pool(env).count();
      return sendMessage(
        env,
        chatId,
        `<b>Status</b>\n• Rewind keys: <b>${keys.length}</b>\n• Nonecap keys: <b>${nonecap}</b>\n• Domain: api.makluxnxx.my.id`
      );
    }

    case '/addnonecap': {
      if (!arg) {
        return sendMessage(
          env,
          chatId,
          [
            'Kirim key-nya setelah perintah. Boleh banyak sekaligus:',
            '',
            '<code>/addnonecap key1 key2 key3</code>',
            '',
            'Atau tempel satu per baris (paling gampang buat 100+):',
            '<code>/addnonecap',
            'key1',
            'key2',
            'key3</code>',
            '',
            'Pemisah yang diterima: baris baru, spasi, koma, titik-koma, atau |',
          ].join('\n')
        );
      }
      return sendMessage(env, chatId, await nonecapAdd(env, arg));
    }

    case '/listnonecap':
      return sendMessage(env, chatId, await nonecapList(env));

    case '/delnonecap': {
      const id = Number(arg);
      if (!Number.isInteger(id)) return sendMessage(env, chatId, 'Format: <code>/delnonecap &lt;id&gt;</code>');
      const done = await pool(env).remove(id);
      return sendMessage(env, chatId, done ? `Nonecap key #${id} dihapus.` : `Key #${id} tidak ditemukan.`);
    }

    case '/clearnonecap': {
      const n = await pool(env).count();
      if (!n) return sendMessage(env, chatId, 'Pool nonecap sudah kosong.');
      // Destructive and easy to fat-finger next to /listnonecap, so it asks first.
      return sendMessage(env, chatId, `Hapus <b>semua ${n}</b> key nonecap?`, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: `✕ Ya, hapus ${n}`, callback_data: 'nc-clear' },
              { text: '‹ Batal', callback_data: 'nc-cancel' },
            ],
          ],
        },
      });
    }

    case '/addrewind': {
      if (!arg) return sendMessage(env, chatId, 'Format: <code>/addrewind sk-xxxx</code>\nBanyak: <code>/addrewind sk-a|sk-b|sk-c</code>');
      const { added, skipped, invalid, rejected } = await addKeys(env, arg);
      let out = `Selesai — <b>${added}</b> ditambah, ${skipped} duplikat, ${invalid} tidak valid.`;
      if (rejected.length) out += `\nDitolak (format aneh): ${rejected.map((r) => `<code>${r}</code>`).join(', ')}`;
      return sendMessage(env, chatId, out);
    }

    case '/listrewind': {
      const keys = await listKeys(env);
      if (!keys.length) return sendMessage(env, chatId, 'Belum ada key. Tambah dengan /addrewind.');
      return sendMessage(env, chatId, `<b>Rewind keys (${keys.length})</b>\nTap untuk kelola:`, {
        reply_markup: listKeyboard(keys),
      });
    }

    case '/delrewind': {
      const id = Number(arg);
      if (!Number.isInteger(id)) return sendMessage(env, chatId, 'Format: <code>/delrewind &lt;id&gt;</code>');
      const done = await delKey(env, id);
      return sendMessage(env, chatId, done ? `Key #${id} dihapus.` : `Key #${id} tidak ditemukan.`);
    }

    case '/createrewind': {
      const [rawCount, rawWorkers] = arg.split(/\s+/).filter(Boolean);
      const count = Number(rawCount);
      const workers = rawWorkers === undefined ? DEFAULT_WORKERS : Number(rawWorkers);

      if (!Number.isInteger(count) || count < 1) {
        return sendMessage(
          env,
          chatId,
          `Format: <code>/createrewind &lt;jumlah&gt; [worker]</code>\nContoh: <code>/createrewind 5</code> atau <code>/createrewind 20 10</code>\nWorker default ${DEFAULT_WORKERS}, maksimal ${MAX_CREATE} akun sekali jalan.`
        );
      }
      if (count > MAX_CREATE) {
        return sendMessage(env, chatId, `Maksimal ${MAX_CREATE} akun sekali jalan (batas subrequest Worker). Pecah jadi beberapa perintah.`);
      }
      if (!Number.isInteger(workers) || workers < 1 || workers > 20) {
        return sendMessage(env, chatId, 'Worker harus angka 1-20.');
      }

      // Provisioning takes minutes; run it in the background so Telegram gets
      // its 200 immediately and does not retry the update.
      const job = runCreate(env, chatId, count, workers).catch((error) =>
        sendMessage(env, chatId, `Gagal: ${String(error?.message || 'unknown').replace(/[<>]/g, '')}`)
      );
      if (ctx?.waitUntil) ctx.waitUntil(job);
      else await job;
      return null;
    }

    default:
      return sendMessage(env, chatId, 'Perintah tidak dikenal. /help untuk daftar.');
  }
}

async function handleCallback(env, cb) {
  const chatId = cb.message?.chat?.id;
  const messageId = cb.message?.message_id;
  const data = String(cb.data || '');

  const answer = (text = '') => tg(env, 'answerCallbackQuery', { callback_query_id: cb.id, text });
  const edit = (text, markup) =>
    tg(env, 'editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      reply_markup: markup,
    });

  if (data === 'nc-cancel') {
    await answer('Dibatalkan');
    return edit('Dibatalkan — pool nonecap tidak diubah.', { inline_keyboard: [] });
  }

  if (data === 'nc-clear') {
    const n = await pool(env).clear();
    await answer(`${n} dihapus`);
    return edit(`<b>Pool nonecap dikosongkan</b> — ${n} key dihapus.\nTambah lagi dengan /addnonecap.`, {
      inline_keyboard: [],
    });
  }

  if (data === 'back') {
    const keys = await listKeys(env);
    await answer();
    return keys.length
      ? edit(`<b>Rewind keys (${keys.length})</b>\nTap untuk kelola:`, listKeyboard(keys))
      : edit('Belum ada key. Tambah dengan /addrewind.', { inline_keyboard: [] });
  }

  if (data.startsWith('view:')) {
    const id = Number(data.slice(5));
    const keys = await listKeys(env);
    const row = keys.find((k) => k.id === id);
    await answer();
    if (!row) return edit('Key sudah tidak ada.', listKeyboard(keys));
    return edit(`<b>Key #${row.id}</b>\n<code>${mask(row.key)}</code>\nDitambah: ${new Date(row.added_at).toISOString().slice(0, 10)}`, keyMenu(id));
  }

  if (data.startsWith('del:')) {
    const id = Number(data.slice(4));
    await delKey(env, id);
    const keys = await listKeys(env);
    await answer('Dihapus');
    return keys.length
      ? edit(`<b>Rewind keys (${keys.length})</b>\nTap untuk kelola:`, listKeyboard(keys))
      : edit('Semua key sudah dihapus.', { inline_keyboard: [] });
  }

  return answer();
}

/**
 * Webhook entry point. Returns a Response (Telegram only needs a 200). Bails
 * quietly if the bot isn't configured or the sender isn't the owner.
 */
export async function handleTelegram(request, env, ctx) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.OWNER_ID) {
    return new Response('bot not configured', { status: 200 });
  }
  if (!env.DB) return new Response('no db', { status: 200 });

  let update;
  try {
    update = await request.json();
  } catch {
    return new Response('bad update', { status: 200 });
  }

  const owner = String(env.OWNER_ID);
  const msg = update.message || update.edited_message;
  const cb = update.callback_query;

  const fromId = String(msg?.from?.id || cb?.from?.id || '');

  // Owner gate: anyone else is politely refused, nothing is touched.
  if (fromId !== owner) {
    if (msg?.chat?.id) await sendMessage(env, msg.chat.id, 'Bot ini khusus owner.');
    if (cb?.id) await tg(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: 'Khusus owner.' });
    return new Response('forbidden', { status: 200 });
  }

  try {
    if (cb) await handleCallback(env, cb);
    else if (msg?.document) await handleDocument(env, msg);
    else if (msg?.text) await handleCommand(env, msg, ctx);
  } catch (error) {
    if (msg?.chat?.id) await sendMessage(env, msg.chat.id, `Error: ${error?.message || 'unknown'}`);
  }

  return new Response('ok', { status: 200 });
}
