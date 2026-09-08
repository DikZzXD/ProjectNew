-- Per-endpoint lifetime counters
CREATE TABLE IF NOT EXISTS endpoint_stats (
  path       TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  category   TEXT NOT NULL DEFAULT '',
  hits       INTEGER NOT NULL DEFAULT 0,
  errors     INTEGER NOT NULL DEFAULT 0,
  bytes      INTEGER NOT NULL DEFAULT 0,
  avg_ms     REAL    NOT NULL DEFAULT 0,
  last_used  INTEGER
);

-- Rolling 24-hour window of individual calls. Rows older than 24 h are deleted
-- on every write, which is what makes the dashboard's live figures reset without
-- a cron trigger; a hard row cap keeps the aggregate queries cheap.
CREATE TABLE IF NOT EXISTS recent_requests (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  path     TEXT    NOT NULL,
  name     TEXT    NOT NULL DEFAULT '',
  method   TEXT    NOT NULL DEFAULT 'GET',
  status   INTEGER NOT NULL DEFAULT 200,
  bytes    INTEGER NOT NULL DEFAULT 0,
  ms       INTEGER NOT NULL DEFAULT 0,
  country  TEXT    NOT NULL DEFAULT '--',
  ts       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recent_ts ON recent_requests (ts DESC);

-- Daily aggregate, never pruned. Feeds the monthly summary and the all-time
-- totals, so the 24-hour window above can reset without losing history.
CREATE TABLE IF NOT EXISTS daily_stats (
  day    TEXT PRIMARY KEY,
  hits   INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  bytes  INTEGER NOT NULL DEFAULT 0
);

-- Rewind AI API keys, managed from the owner-only Telegram bot (/addrewind,
-- /listrewind, /delrewind). A key is picked at random per AI call so quota is
-- spread across the pool; see src/lib/rewind.js.
CREATE TABLE IF NOT EXISTS rewind_keys (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  key      TEXT NOT NULL UNIQUE,
  label    TEXT NOT NULL DEFAULT '',
  added_at INTEGER NOT NULL
);

-- nonecap captcha-solver keys. Same idea as rewind_keys but self-pruning: a key
-- the solver reports as invalid or out of balance is DELETED on the spot, so a
-- pool of 100+ keys never needs manual gardening. `fails` counts consecutive
-- ambiguous failures — a key is dropped once it hits the cap, which is how a key
-- that dies without a clear error message still leaves the pool.
-- See src/lib/keypool.js (storage) and src/lib/nonecap.js (rotation).
CREATE TABLE IF NOT EXISTS nonecap_keys (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT    NOT NULL UNIQUE,
  label      TEXT    NOT NULL DEFAULT '',
  uses       INTEGER NOT NULL DEFAULT 0,
  fails      INTEGER NOT NULL DEFAULT 0,
  last_used  INTEGER,
  last_error TEXT    NOT NULL DEFAULT '',
  added_at   INTEGER NOT NULL
);

-- Least-recently-used pick order: NULL (never used) first, then oldest.
CREATE INDEX IF NOT EXISTS idx_nonecap_lru ON nonecap_keys (last_used ASC, id ASC);

-- ── Ubot Promosi ────────────────────────────────────────────────────────────
-- Telegram userbot accounts for /v1/tools/ubot-*. A row holds a live MTProto
-- session — full access to someone's Telegram account — so two rules apply:
--   • `session` is never stored in the clear. It is an AES-256-GCM token from
--     src/lib/crypto.js holding {s: sessionString, h: apiHash}, so the two
--     secrets cost one key derivation instead of two.
--   • `token` is the only handle a caller ever gets back: 32 random bytes,
--     kept here as a SHA-256 hash. Every later call authorises with it, and
--     there is deliberately no route that lists accounts.
-- See src/lib/ubotstore.js.
CREATE TABLE IF NOT EXISTS ubot_accounts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT    NOT NULL UNIQUE,
  phone      TEXT    NOT NULL DEFAULT '',
  user_id    TEXT    NOT NULL DEFAULT '',
  username   TEXT    NOT NULL DEFAULT '',
  name       TEXT    NOT NULL DEFAULT '',
  session    TEXT    NOT NULL,
  api_id     TEXT    NOT NULL DEFAULT '',
  delay_min  INTEGER NOT NULL DEFAULT 5,
  delay_max  INTEGER NOT NULL DEFAULT 12,
  blacklist  TEXT    NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  last_used  INTEGER
);

-- Half-finished logins: phone sent, waiting on the OTP and maybe a 2FA PIN.
-- The session here is already a real auth key, which is why rows are swept on
-- every write and rejected past expires_at rather than left lying around.
CREATE TABLE IF NOT EXISTS ubot_logins (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT    NOT NULL UNIQUE,
  phone      TEXT    NOT NULL,
  code_hash  TEXT    NOT NULL DEFAULT '',
  session    TEXT    NOT NULL,
  api_id     TEXT    NOT NULL DEFAULT '',
  stage      TEXT    NOT NULL DEFAULT 'otp',
  hint       TEXT    NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- One promo broadcast. A Worker request can't sit still for 40 groups × 10 s of
-- delay, so a job is a resumable cursor: `targets` is the group list resolved
-- once at start, `cursor` is how far the send loop got, and each pass drains a
-- time-boxed batch then hands off to the next. `stop` is the kill switch the
-- .stop command had.
CREATE TABLE IF NOT EXISTS ubot_jobs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  job_key    TEXT    NOT NULL UNIQUE,
  account_id INTEGER NOT NULL,
  status     TEXT    NOT NULL DEFAULT 'running',
  targets    TEXT    NOT NULL DEFAULT '[]',
  cursor     INTEGER NOT NULL DEFAULT 0,
  total      INTEGER NOT NULL DEFAULT 0,
  sent       INTEGER NOT NULL DEFAULT 0,
  failed     INTEGER NOT NULL DEFAULT 0,
  skipped    INTEGER NOT NULL DEFAULT 0,
  stop       INTEGER NOT NULL DEFAULT 0,
  passes     INTEGER NOT NULL DEFAULT 0,
  payload    TEXT    NOT NULL DEFAULT '{}',
  delay_min  INTEGER NOT NULL DEFAULT 5,
  delay_max  INTEGER NOT NULL DEFAULT 12,
  note       TEXT    NOT NULL DEFAULT '',
  log        TEXT    NOT NULL DEFAULT '[]',
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  ended_at   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_ubot_jobs_account ON ubot_jobs (account_id, started_at DESC);

