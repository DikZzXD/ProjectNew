/**
 * Usage tracking on D1.
 *
 * Writes are fire-and-forget through ctx.waitUntil so a slow or missing
 * database never delays an API response. Every helper swallows its own
 * errors for the same reason.
 *
 * Two ledgers, on purpose:
 *
 *   recent_requests  one row per call, kept for 24 hours. Every live figure on
 *                    the dashboard is aggregated from here, which is what makes
 *                    them reset on a rolling 24-hour window without a cron job
 *                    or a stored reset marker — a row simply ages out.
 *   daily_stats      one row per day, never pruned. This is where the monthly
 *                    and all-time totals come from, so resetting the window
 *                    above never loses history.
 */

const WINDOW_MS = 86400000;

/**
 * DDL for every table the stats layer touches. Run defensively before a write
 * (and once on read) so tracking works even when schema.sql was never applied
 * to the remote D1 — which is exactly why external/bot traffic "wasn't counting":
 * the batch below threw on a missing table and the error was swallowed.
 */
const DDL = [
  `CREATE TABLE IF NOT EXISTS endpoint_stats (
     path TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '',
     hits INTEGER NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0,
     bytes INTEGER NOT NULL DEFAULT 0, avg_ms REAL NOT NULL DEFAULT 0, last_used INTEGER
   )`,
  `CREATE TABLE IF NOT EXISTS recent_requests (
     id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
     method TEXT NOT NULL DEFAULT 'GET', status INTEGER NOT NULL DEFAULT 200,
     bytes INTEGER NOT NULL DEFAULT 0, ms INTEGER NOT NULL DEFAULT 0,
     country TEXT NOT NULL DEFAULT '--', ts INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS daily_stats (
     day TEXT PRIMARY KEY, hits INTEGER NOT NULL DEFAULT 0,
     errors INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0
   )`,
];

/** Create the stats tables if they don't exist yet. Best-effort, idempotent. */
async function ensureTables(env) {
  try {
    await env.DB.batch(DDL.map((sql) => env.DB.prepare(sql)));
    return true;
  } catch {
    return false;
  }
}

/**
 * Hard cap on the 24 h table. The window is what bounds it in practice; this
 * only stops a traffic spike from turning every aggregate query into a scan of
 * hundreds of thousands of rows.
 */
const RECENT_CAP = 5000;

/** How many rows the activity feed shows. */
const FEED_LIMIT = 25;

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Record one API call. Call inside ctx.waitUntil(). */
export async function record(env, hit) {
  if (!env.DB) return;

  const { path, name = '', category = '', method = 'GET', status = 200, bytes = 0, ms = 0, country = '--' } = hit;
  const failed = status >= 400 ? 1 : 0;
  const now = Date.now();

  const writes = () => [
    env.DB.prepare(
      `INSERT INTO endpoint_stats (path, name, category, hits, errors, bytes, avg_ms, last_used)
         VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6, ?7)
         ON CONFLICT(path) DO UPDATE SET
           hits      = hits + 1,
           errors    = errors + ?4,
           bytes     = bytes + ?5,
           avg_ms    = (avg_ms * hits + ?6) / (hits + 1),
           last_used = ?7,
           name      = ?2,
           category  = ?3`
    ).bind(path, name, category, failed, bytes, ms, now),

    env.DB.prepare(
      `INSERT INTO recent_requests (path, name, method, status, bytes, ms, country, ts)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
    ).bind(path, name, method, status, bytes, ms, country, now),

    env.DB.prepare(
      `INSERT INTO daily_stats (day, hits, errors, bytes)
         VALUES (?1, 1, ?2, ?3)
         ON CONFLICT(day) DO UPDATE SET
           hits   = hits + 1,
           errors = errors + ?2,
           bytes  = bytes + ?3`
    ).bind(today(), failed, bytes),

    // Age-out is what implements the 24-hour reset.
    env.DB.prepare(`DELETE FROM recent_requests WHERE ts < ?1`).bind(now - WINDOW_MS),

    env.DB.prepare(
      `DELETE FROM recent_requests
         WHERE id NOT IN (SELECT id FROM recent_requests ORDER BY ts DESC LIMIT ${RECENT_CAP})`
    ),
  ];

  try {
    await env.DB.batch(writes());
  } catch {
    // Most likely the tables don't exist yet on this D1 (schema.sql never
    // applied). Create them and retry once — this is what makes counters work
    // for API traffic driven from the bot or an external client.
    if (await ensureTables(env)) {
      try {
        await env.DB.batch(writes());
      } catch {
        // Still failing — give up quietly; stats must never break a request.
      }
    }
  }
}

const EMPTY = {
  window: { hits: 0, errors: 0, bytes: 0, avg_ms: 0, endpoints: 0, since: null, resets_in_ms: WINDOW_MS },
  month: { hits: 0, errors: 0, bytes: 0, days: 0, label: monthLabel() },
  totals: { hits: 0, errors: 0, bytes: 0, endpoints: 0, avg_ms: 0 },
  top: [],
  recent: [],
  offline: true,
};

/** Everything the dashboard renders. */
export async function snapshot(env) {
  if (!env.DB) return EMPTY;

  try {
    return await readSnapshot(env);
  } catch {
    // A missing table throws here on a fresh D1; create them and retry once so
    // the dashboard reads work even before the first recorded write.
    if (await ensureTables(env)) {
      try {
        return await readSnapshot(env);
      } catch {
        return EMPTY;
      }
    }
    return EMPTY;
  }
}

async function readSnapshot(env) {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const month = `${new Date().toISOString().slice(0, 7)}%`;

  {
    const [windowRow, monthRow, totalRow, top, recent] = await env.DB.batch([
      // Live figures: everything inside the rolling 24 h.
      env.DB.prepare(
        `SELECT COUNT(*)                            AS hits,
                COALESCE(SUM(status >= 400), 0)     AS errors,
                COALESCE(SUM(bytes), 0)             AS bytes,
                COALESCE(AVG(NULLIF(ms, 0)), 0)     AS avg_ms,
                COUNT(DISTINCT path)                AS endpoints,
                MIN(ts)                             AS since
         FROM recent_requests WHERE ts >= ?1`
      ).bind(cutoff),

      env.DB.prepare(
        `SELECT COALESCE(SUM(hits), 0)   AS hits,
                COALESCE(SUM(errors), 0) AS errors,
                COALESCE(SUM(bytes), 0)  AS bytes,
                COUNT(*)                 AS days
         FROM daily_stats WHERE day LIKE ?1`
      ).bind(month),

      env.DB.prepare(
        `SELECT COALESCE(SUM(hits), 0)   AS hits,
                COALESCE(SUM(errors), 0) AS errors,
                COALESCE(SUM(bytes), 0)  AS bytes
         FROM daily_stats`
      ),

      env.DB.prepare(
        `SELECT path, name, category, hits, errors, bytes, avg_ms, last_used
         FROM endpoint_stats ORDER BY hits DESC LIMIT 12`
      ),

      env.DB.prepare(
        `SELECT path, name, method, status, bytes, ms, country, ts
         FROM recent_requests ORDER BY ts DESC LIMIT ${FEED_LIMIT}`
      ),
    ]);

    const live = windowRow.results?.[0] || {};
    const since = Number(live.since) || null;

    // Lifetime endpoint count comes from endpoint_stats: an endpoint that saw no
    // traffic today still exists, so the window's DISTINCT count would understate it.
    const lifetimeEndpoints = (top.results || []).length;

    return {
      window: {
        hits: Number(live.hits) || 0,
        errors: Number(live.errors) || 0,
        bytes: Number(live.bytes) || 0,
        avg_ms: Number(live.avg_ms) || 0,
        endpoints: Number(live.endpoints) || 0,
        since,
        // Counted from the oldest surviving row, which is when this window began.
        resets_in_ms: since ? Math.max(0, since + WINDOW_MS - now) : WINDOW_MS,
      },
      month: { ...(monthRow.results?.[0] || {}), label: monthLabel() },
      totals: {
        ...(totalRow.results?.[0] || { hits: 0, errors: 0, bytes: 0 }),
        endpoints: lifetimeEndpoints,
        avg_ms: Number(live.avg_ms) || 0,
      },
      top: top.results || [],
      recent: recent.results || [],
      offline: false,
    };
  }
}

function monthLabel() {
  return new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}
