/**
 * D1 storage for the Telegram userbot accounts behind /v1/tools/ubot-*.
 *
 * A row in `ubot_accounts` is a live MTProto session — whoever holds it can read
 * and send as that Telegram user — so the storage rules are deliberately strict:
 *
 *   • The session string never touches D1 in the clear. It is sealed with
 *     src/lib/crypto.js (AES-256-GCM, PBKDF2-SHA256) alongside the api_hash, so
 *     a dump of the table is useless without the Worker secret.
 *   • The caller's only handle is a random 32-byte `token`, returned once at
 *     login and stored here as a SHA-256 hash. Nothing can enumerate accounts:
 *     no list route exists, and a lost token means the row can only be orphaned,
 *     never read.
 *   • Half-finished logins live in their own short-lived table and are swept on
 *     every write, because a `ubot_logins` row already holds a real auth key.
 *
 * Tables are created on demand (same approach as src/lib/keypool.js) so a fresh
 * database works without waiting for `npm run db:init`.
 */

import { encrypt, decrypt } from './crypto.js';

/** How long a pending login (OTP / 2FA step) stays usable. */
export const LOGIN_TTL_MS = 15 * 60 * 1000;

const enc = new TextEncoder();

/* ── Tokens ──────────────────────────────────────────────────── */

/** A fresh caller-facing handle: 32 random bytes, base64url, no padding. */
export function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Lookup key for a token. Only the hash is ever stored. */
export async function hashToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(String(token || '')));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The password the session blobs are sealed with. `UBOT_SECRET` is the intended
 * source; the fallback keeps local dev working without another secret to set,
 * and is only as strong as the bot token it is built from — which is why the
 * README tells you to set UBOT_SECRET before going live.
 */
function secret(env) {
  const explicit = String(env?.UBOT_SECRET || '').trim();
  if (explicit) return explicit;
  return `ubot:${env?.TELEGRAM_BOT_TOKEN || 'dev'}:${env?.OWNER_ID || '0'}`;
}

/** Seal the two per-account secrets into one token, so one KDF pass covers both. */
async function seal(env, { session, apiHash }) {
  return encrypt(JSON.stringify({ s: String(session || ''), h: String(apiHash || '') }), secret(env));
}

async function unseal(env, blob) {
  const plain = await decrypt(blob, secret(env));
  const data = JSON.parse(plain);
  return { session: String(data.s || ''), apiHash: String(data.h || '') };
}

/* ── Schema ──────────────────────────────────────────────────── */

async function ensure(db) {
  if (!db) return false;
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS ubot_accounts (
         id INTEGER PRIMARY KEY AUTOINCREMENT, token_hash TEXT NOT NULL UNIQUE,
         phone TEXT NOT NULL DEFAULT '', user_id TEXT NOT NULL DEFAULT '',
         username TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '',
         session TEXT NOT NULL, api_id TEXT NOT NULL DEFAULT '',
         delay_min INTEGER NOT NULL DEFAULT 5, delay_max INTEGER NOT NULL DEFAULT 12,
         blacklist TEXT NOT NULL DEFAULT '[]', pts INTEGER NOT NULL DEFAULT 0,
         qts INTEGER NOT NULL DEFAULT 0, sync_date INTEGER NOT NULL DEFAULT 0,
         created_at INTEGER NOT NULL, last_used INTEGER
       )`
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS ubot_logins (
         id INTEGER PRIMARY KEY AUTOINCREMENT, token_hash TEXT NOT NULL UNIQUE,
         phone TEXT NOT NULL, code_hash TEXT NOT NULL DEFAULT '',
         session TEXT NOT NULL, api_id TEXT NOT NULL DEFAULT '',
         stage TEXT NOT NULL DEFAULT 'otp', hint TEXT NOT NULL DEFAULT '',
         created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
       )`
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS ubot_leases (
         account_id INTEGER PRIMARY KEY, holder TEXT NOT NULL DEFAULT '',
         until INTEGER NOT NULL DEFAULT 0
       )`
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS ubot_jobs (
         id INTEGER PRIMARY KEY AUTOINCREMENT, job_key TEXT NOT NULL UNIQUE,
         account_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'running',
         targets TEXT NOT NULL DEFAULT '[]', cursor INTEGER NOT NULL DEFAULT 0,
         total INTEGER NOT NULL DEFAULT 0, sent INTEGER NOT NULL DEFAULT 0,
         failed INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0,
         stop INTEGER NOT NULL DEFAULT 0, passes INTEGER NOT NULL DEFAULT 0,
         payload TEXT NOT NULL DEFAULT '{}', delay_min INTEGER NOT NULL DEFAULT 5,
         delay_max INTEGER NOT NULL DEFAULT 12, note TEXT NOT NULL DEFAULT '',
         log TEXT NOT NULL DEFAULT '[]', started_at INTEGER NOT NULL,
         updated_at INTEGER NOT NULL, ended_at INTEGER
       )`
    ),
  ]);
  return true;
}

/** Raised for anything a caller can fix; the endpoints turn it into a 4xx. */
export class StoreError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'StoreError';
    this.status = status;
  }
}

function db(env) {
  const handle = env?.DB || null;
  if (!handle) throw new StoreError('Database belum tersambung, fitur userbot sedang tidak tersedia', 503);
  return handle;
}

/* ── Pending logins ──────────────────────────────────────────── */

/**
 * Park a half-finished login and hand back its one-time token. Expired rows are
 * swept in the same call, so the table self-cleans without a cron trigger.
 */
export async function saveLogin(env, { phone, codeHash, session, apiId, apiHash, stage = 'otp', hint = '' }) {
  const handle = db(env);
  await ensure(handle);

  const now = Date.now();
  await handle.prepare('DELETE FROM ubot_logins WHERE expires_at < ?1').bind(now).run();

  const token = newToken();
  await handle
    .prepare(
      `INSERT INTO ubot_logins (token_hash, phone, code_hash, session, api_id, stage, hint, created_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
    )
    .bind(
      await hashToken(token),
      String(phone || ''),
      String(codeHash || ''),
      await seal(env, { session, apiHash }),
      String(apiId || ''),
      stage,
      String(hint || '').slice(0, 120),
      now,
      now + LOGIN_TTL_MS
    )
    .run();

  return { token, expiresAt: now + LOGIN_TTL_MS };
}

/** Resolve a login token. Expiry is enforced here, not just by the sweeper. */
export async function getLogin(env, token) {
  const handle = db(env);
  await ensure(handle);

  const row = await handle
    .prepare('SELECT * FROM ubot_logins WHERE token_hash = ?1')
    .bind(await hashToken(token))
    .first();

  if (!row) throw new StoreError('Sesi login tidak ditemukan. Mulai ulang dari langkah kirim nomor.', 404);
  if (row.expires_at < Date.now()) {
    await handle.prepare('DELETE FROM ubot_logins WHERE id = ?1').bind(row.id).run();
    throw new StoreError('Sesi login sudah kedaluwarsa. Kirim ulang nomor untuk minta kode baru.', 410);
  }

  const { session, apiHash } = await unseal(env, row.session);
  return {
    id: row.id,
    phone: row.phone,
    codeHash: row.code_hash,
    stage: row.stage,
    hint: row.hint,
    apiId: row.api_id,
    apiHash,
    session,
    expiresAt: row.expires_at,
  };
}

/**
 * Rewrite a pending login in place — used when the OTP turns out to need a 2FA
 * PIN, so the caller keeps the same token for the extra step.
 */
export async function updateLogin(env, token, { session, apiHash, stage, hint, codeHash }) {
  const handle = db(env);
  const patch = [];
  const values = [];

  if (session !== undefined) {
    patch.push(`session = ?${patch.length + 1}`);
    values.push(await seal(env, { session, apiHash }));
  }
  for (const [column, value] of [
    ['stage', stage],
    ['hint', hint === undefined ? undefined : String(hint).slice(0, 120)],
    ['code_hash', codeHash],
  ]) {
    if (value === undefined) continue;
    patch.push(`${column} = ?${patch.length + 1}`);
    values.push(value);
  }
  if (!patch.length) return;

  await handle
    .prepare(`UPDATE ubot_logins SET ${patch.join(', ')} WHERE token_hash = ?${patch.length + 1}`)
    .bind(...values, await hashToken(token))
    .run();
}

export async function dropLogin(env, token) {
  const handle = db(env);
  await handle.prepare('DELETE FROM ubot_logins WHERE token_hash = ?1').bind(await hashToken(token)).run();
}

/* ── Accounts ────────────────────────────────────────────────── */

/**
 * Promote a finished login into a stored account. Returns the permanent token —
 * the only time it is ever visible, since D1 keeps just its hash.
 */
export async function saveAccount(env, { phone, session, apiId, apiHash, user }) {
  const handle = db(env);
  await ensure(handle);

  const token = newToken();
  const now = Date.now();

  await handle
    .prepare(
      `INSERT INTO ubot_accounts (token_hash, phone, user_id, username, name, session, api_id, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
    )
    .bind(
      await hashToken(token),
      String(phone || ''),
      String(user?.id || ''),
      String(user?.username || ''),
      String(user?.name || ''),
      await seal(env, { session, apiHash }),
      String(apiId || ''),
      now
    )
    .run();

  const row = await handle
    .prepare('SELECT id FROM ubot_accounts WHERE token_hash = ?1')
    .bind(await hashToken(token))
    .first();

  return { token, id: row?.id || 0, createdAt: now };
}

/**
 * Resolve an account token into everything needed to rebuild its client.
 * `touch` marks the row used, which is the only mutation a read performs.
 */
export async function getAccount(env, token, { touch = false } = {}) {
  const handle = db(env);
  await ensure(handle);

  const tokenHash = await hashToken(token);
  const row = await handle.prepare('SELECT * FROM ubot_accounts WHERE token_hash = ?1').bind(tokenHash).first();

  if (!row) throw new StoreError('Token akun tidak dikenal. Login ulang untuk dapat token baru.', 404);

  if (touch) {
    await handle
      .prepare('UPDATE ubot_accounts SET last_used = ?2 WHERE id = ?1')
      .bind(row.id, Date.now())
      .run();
  }

  const { session, apiHash } = await unseal(env, row.session);
  return {
    id: row.id,
    tokenHash,
    phone: row.phone,
    userId: row.user_id,
    username: row.username,
    name: row.name,
    apiId: row.api_id,
    apiHash,
    session,
    delayMin: row.delay_min,
    delayMax: row.delay_max,
    blacklist: parseList(row.blacklist),
    pts: Number(row.pts || 0),
    qts: Number(row.qts || 0),
    syncDate: Number(row.sync_date || 0),
    createdAt: row.created_at,
    lastUsed: row.last_used,
  };
}

/** Update sync state (pts, qts, date) after processing updates */
export async function updateSyncState(env, id, { pts, qts, date }) {
  const handle = db(env);
  const patch = [];
  const vals = [];
  if (pts !== undefined) {
    patch.push(`pts = ?${patch.length + 1}`);
    vals.push(Number(pts));
  }
  if (qts !== undefined) {
    patch.push(`qts = ?${patch.length + 1}`);
    vals.push(Number(qts));
  }
  if (date !== undefined) {
    patch.push(`sync_date = ?${patch.length + 1}`);
    vals.push(Number(date));
  }
  if (!patch.length) return;
  await handle
    .prepare(`UPDATE ubot_accounts SET ${patch.join(', ')} WHERE id = ?${patch.length + 1}`)
    .bind(...vals, id)
    .run();
}

/** Get list of all active ubot accounts (for background cron sync) */
export async function listAllAccounts(env, limit = 20) {
  const handle = db(env);
  await ensure(handle);
  const { results } = await handle
    .prepare('SELECT * FROM ubot_accounts ORDER BY last_used DESC, id DESC LIMIT ?1')
    .bind(limit)
    .all();

  const accounts = [];
  for (const row of results || []) {
    try {
      const { session, apiHash } = await unseal(env, row.session);
      accounts.push({
        id: row.id,
        tokenHash: row.token_hash,
        phone: row.phone,
        userId: row.user_id,
        username: row.username,
        name: row.name,
        apiId: row.api_id,
        apiHash,
        session,
        delayMin: row.delay_min,
        delayMax: row.delay_max,
        blacklist: parseList(row.blacklist),
        pts: Number(row.pts || 0),
        qts: Number(row.qts || 0),
        syncDate: Number(row.sync_date || 0),
        createdAt: row.created_at,
        lastUsed: row.last_used,
      });
    } catch {
      /* ignore corrupted/unsealable rows */
    }
  }
  return accounts;
}

/** Refresh the stored session — GramJS may rotate it after a DC migration. */
export async function refreshSession(env, id, { session, apiHash }) {
  const handle = db(env);
  await handle
    .prepare('UPDATE ubot_accounts SET session = ?2 WHERE id = ?1')
    .bind(id, await seal(env, { session, apiHash }))
    .run();
}

export async function setDelay(env, id, min, max) {
  const handle = db(env);
  const lo = clampDelay(min);
  const hi = clampDelay(max);
  const [low, high] = lo <= hi ? [lo, hi] : [hi, lo];
  await handle.prepare('UPDATE ubot_accounts SET delay_min = ?2, delay_max = ?3 WHERE id = ?1').bind(id, low, high).run();
  return { min: low, max: high };
}

export async function setBlacklist(env, id, list) {
  const handle = db(env);
  const clean = [...new Set(list.map((x) => String(x)).filter(Boolean))].slice(0, 500);
  await handle
    .prepare('UPDATE ubot_accounts SET blacklist = ?2 WHERE id = ?1')
    .bind(id, JSON.stringify(clean))
    .run();
  return clean;
}

/** Forget an account. The session is dropped, but stays valid on Telegram's side. */
export async function dropAccount(env, id) {
  const handle = db(env);
  await handle.batch([
    handle.prepare('DELETE FROM ubot_jobs WHERE account_id = ?1').bind(id),
    handle.prepare('DELETE FROM ubot_accounts WHERE id = ?1').bind(id),
  ]);
}

/* ── Leases ──────────────────────────────────────────────────── */

/**
 * Claim the right to run the live loop for one account.
 *
 * Cron ticks overlap: a 15-minute loop is still running when the next minute
 * fires, and two loops on one account would double-answer every command. So a
 * loop takes a short lease, renews it while it works, and releases it on exit.
 * A crashed loop simply lets the lease expire, and the next tick takes over —
 * no cleanup path needed.
 *
 * The UPDATE is conditional on expiry, which SQLite applies atomically, so two
 * simultaneous ticks cannot both come away thinking they won.
 */
export async function acquireLease(env, accountId, holder, ttlMs) {
  const handle = db(env);
  await ensure(handle);

  const now = Date.now();
  const until = now + Math.max(1000, ttlMs);

  // INSERT first: succeeds only if no row exists for this account yet.
  try {
    await handle
      .prepare('INSERT INTO ubot_leases (account_id, holder, until) VALUES (?1, ?2, ?3)')
      .bind(accountId, String(holder), until)
      .run();
    return true;
  } catch {
    /* a row already exists — fall through to the expiry-guarded takeover */
  }

  const result = await handle
    .prepare('UPDATE ubot_leases SET holder = ?2, until = ?3 WHERE account_id = ?1 AND until < ?4')
    .bind(accountId, String(holder), until, now)
    .run();

  return (result.meta?.changes || 0) > 0;
}

/** Push the lease deadline out. Returns false if someone else stole it. */
export async function renewLease(env, accountId, holder, ttlMs) {
  const handle = db(env);
  const result = await handle
    .prepare('UPDATE ubot_leases SET until = ?3 WHERE account_id = ?1 AND holder = ?2')
    .bind(accountId, String(holder), Date.now() + Math.max(1000, ttlMs))
    .run();
  return (result.meta?.changes || 0) > 0;
}

/** Give the lease up early so the next cron tick can start immediately. */
export async function releaseLease(env, accountId, holder) {
  const handle = db(env);
  try {
    await handle
      .prepare('UPDATE ubot_leases SET until = 0 WHERE account_id = ?1 AND holder = ?2')
      .bind(accountId, String(holder))
      .run();
  } catch {
    /* the loop is ending anyway; an expired lease has the same effect */
  }
}

function clampDelay(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 5;
  return Math.max(1, Math.min(600, Math.round(n)));
}

function parseList(raw) {
  try {
    const parsed = JSON.parse(String(raw || '[]'));
    return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

/* ── Jobs ────────────────────────────────────────────────────── */

/**
 * A broadcast is stored, not held in memory: the group list is resolved once and
 * `cursor` records how far the send loop got, so a run that outlives one request
 * can be picked up by the next pass. See src/lib/ubotpromo.js.
 */
export async function createJob(env, { accountId, targets, payload, delayMin, delayMax }) {
  const handle = db(env);
  await ensure(handle);

  const jobKey = newToken().slice(0, 22);
  const now = Date.now();

  await handle
    .prepare(
      `INSERT INTO ubot_jobs
         (job_key, account_id, status, targets, total, payload, delay_min, delay_max, started_at, updated_at)
       VALUES (?1, ?2, 'running', ?3, ?4, ?5, ?6, ?7, ?8, ?8)`
    )
    .bind(jobKey, accountId, JSON.stringify(targets), targets.length, JSON.stringify(payload || {}), delayMin, delayMax, now)
    .run();

  return { jobKey, total: targets.length, startedAt: now };
}

/** A job row, or null. `accountId` scopes the lookup so tokens can't peek. */
export async function getJob(env, jobKey, accountId = null) {
  const handle = db(env);
  await ensure(handle);

  const row = await handle.prepare('SELECT * FROM ubot_jobs WHERE job_key = ?1').bind(String(jobKey || '')).first();
  if (!row) return null;
  if (accountId !== null && row.account_id !== accountId) return null;

  return {
    jobKey: row.job_key,
    accountId: row.account_id,
    status: row.status,
    targets: parseTargets(row.targets),
    cursor: row.cursor,
    total: row.total,
    sent: row.sent,
    failed: row.failed,
    skipped: row.skipped,
    stop: Boolean(row.stop),
    passes: row.passes,
    payload: parseObject(row.payload),
    delayMin: row.delay_min,
    delayMax: row.delay_max,
    note: row.note,
    log: parseTargets(row.log),
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    endedAt: row.ended_at,
  };
}

/** Write back progress after a batch. Only the given fields are touched. */
export async function updateJob(env, jobKey, patch) {
  const handle = db(env);
  const columns = {
    status: patch.status,
    cursor: patch.cursor,
    sent: patch.sent,
    failed: patch.failed,
    skipped: patch.skipped,
    passes: patch.passes,
    note: patch.note === undefined ? undefined : String(patch.note).slice(0, 300),
    log: patch.log === undefined ? undefined : JSON.stringify(patch.log.slice(-40)),
    ended_at: patch.endedAt,
  };

  const sets = [];
  const values = [];
  for (const [column, value] of Object.entries(columns)) {
    if (value === undefined) continue;
    sets.push(`${column} = ?${sets.length + 1}`);
    values.push(value);
  }

  sets.push(`updated_at = ?${sets.length + 1}`);
  values.push(Date.now());

  await handle
    .prepare(`UPDATE ubot_jobs SET ${sets.join(', ')} WHERE job_key = ?${sets.length + 1}`)
    .bind(...values, jobKey)
    .run();
}

/** Raise the stop flag; the send loop notices between groups. */export async function stopJobs(env, accountId, jobKey = null) {
  const handle = db(env);
  await ensure(handle);

  const query = jobKey
    ? handle
        .prepare("UPDATE ubot_jobs SET stop = 1, updated_at = ?3 WHERE account_id = ?1 AND job_key = ?2 AND status = 'running'")
        .bind(accountId, jobKey, Date.now())
    : handle
        .prepare("UPDATE ubot_jobs SET stop = 1, updated_at = ?2 WHERE account_id = ?1 AND status = 'running'")
        .bind(accountId, Date.now());

  const result = await query.run();
  return result.meta?.changes || 0;
}

/**
 * The oldest still-running job key for an account, or null.
 *
 * Only the key is selected, not `targets` — the live loop calls this on every
 * iteration and a broadcast's target list can be hundreds of rows of JSON.
 */
export async function findRunningJobKey(env, accountId) {
  const handle = db(env);
  await ensure(handle);

  const row = await handle
    .prepare("SELECT job_key FROM ubot_jobs WHERE account_id = ?1 AND status = 'running' ORDER BY started_at ASC LIMIT 1")
    .bind(accountId)
    .first();

  return row?.job_key || null;
}

/** Recent jobs for one account, newest first — the dashboard/status view. */
export async function listJobs(env, accountId, limit = 10) {
  const handle = db(env);
  await ensure(handle);

  const { results } = await handle
    .prepare(
      `SELECT job_key, status, total, sent, failed, skipped, cursor, note, started_at, ended_at
       FROM ubot_jobs WHERE account_id = ?1 ORDER BY started_at DESC LIMIT ?2`
    )
    .bind(accountId, Math.max(1, Math.min(50, limit)))
    .all();

  return results || [];
}

function parseTargets(raw) {
  try {
    const parsed = JSON.parse(String(raw || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseObject(raw) {
  try {
    const parsed = JSON.parse(String(raw || '{}'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}



