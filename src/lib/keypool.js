/**
 * Self-pruning API key pool backed by D1.
 *
 * Built for the nonecap captcha keys but deliberately generic: a pool is just a
 * table name. The point is that you can load 100+ keys once and never touch them
 * again — the rotation logic reports every outcome back here, and a key that is
 * dead (invalid / no balance) is DELETED immediately rather than left to slow
 * every future request down.
 *
 * Pick order is least-recently-used, not random: with a large pool that spreads
 * load evenly and, more usefully, means a freshly added key gets tried straight
 * away instead of waiting for a lucky roll.
 *
 * Three outcomes a caller can report:
 *   ok(id)            → clears the fail streak, bumps uses/last_used
 *   dead(id, reason)  → deletes the row now (invalid key, empty balance)
 *   soft(id, reason)  → increments `fails`; the row is deleted once the streak
 *                       reaches MAX_FAILS, so a key that dies silently still
 *                       leaves the pool without ever being hand-inspected.
 */

/** Consecutive ambiguous failures before a key is dropped anyway. */
export const MAX_FAILS = 3;

/**
 * Mask a key for logs/labels — the full secret never leaves this module.
 *
 * Keeps 10 leading characters, not 4: provider keys share a long prefix
 * (`nc_live_…`), so a shorter head made every row in /listnonecap render
 * identically and there was no way to tell which key an error belonged to.
 */
export function maskKey(key) {
  const s = String(key || '');
  if (s.length <= 10) return '••••';
  if (s.length <= 18) return `${s.slice(0, 4)}…${s.slice(-4)}`;
  return `${s.slice(0, 10)}…${s.slice(-4)}`;
}

/**
 * A pool bound to one table. `env.DB` must be a D1 binding; every method is a
 * no-op-with-sane-default when D1 is missing so a Worker without the binding
 * still runs (it just falls back to the env seed key).
 */
export function pool(env, table = 'nonecap_keys') {
  const db = env?.DB || null;

  // Table names can't be bound as parameters, so keep the identifier on a strict
  // allow-list rather than interpolating whatever a caller passed.
  if (!/^[a-z_]+$/.test(table)) throw new Error('invalid pool table');

  async function ensure() {
    if (!db) return false;
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS ${table} (
           id         INTEGER PRIMARY KEY AUTOINCREMENT,
           key        TEXT    NOT NULL UNIQUE,
           label      TEXT    NOT NULL DEFAULT '',
           uses       INTEGER NOT NULL DEFAULT 0,
           fails      INTEGER NOT NULL DEFAULT 0,
           last_used  INTEGER,
           last_error TEXT    NOT NULL DEFAULT '',
           added_at   INTEGER NOT NULL
         )`
      )
      .run();
    return true;
  }

  return {
    ensure,

    /**
     * Add many keys at once. Accepts anything separated by newlines, commas,
     * semicolons, pipes or whitespace — paste a whole block from the nonecap
     * dashboard and it just works. Duplicates are ignored, not errors.
     */
    async addMany(raw) {
      const seen = new Set();
      const keys = String(raw || '')
        .split(/[\s,;|]+/)
        .map((k) => k.trim())
        .filter(Boolean)
        .filter((k) => {
          // De-dupe within the input itself, so pasting the same key twice
          // doesn't report one "added" and one "duplicate".
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });

      const result = { added: 0, duplicate: 0, invalid: 0, invalidSamples: [] };
      if (!keys.length) return result;
      if (!(await ensure())) return result;

      const now = Date.now();
      const valid = [];
      for (const key of keys) {
        // Provider keys are letters/digits with . _ - separators; anything with
        // spaces or punctuation is a paste accident, not a key.
        if (!/^[A-Za-z0-9._-]{16,200}$/.test(key)) {
          result.invalid += 1;
          if (result.invalidSamples.length < 5) result.invalidSamples.push(maskKey(key));
          continue;
        }
        valid.push(key);
      }

      // One batch instead of 100+ round trips — D1 charges per statement.
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO ${table} (key, label, added_at) VALUES (?1, ?2, ?3)`
      );
      const CHUNK = 50;
      for (let i = 0; i < valid.length; i += CHUNK) {
        const slice = valid.slice(i, i + CHUNK);
        const rows = await db.batch(slice.map((k) => stmt.bind(k, maskKey(k), now)));
        for (const r of rows) {
          if (r.meta?.changes) result.added += 1;
          else result.duplicate += 1;
        }
      }
      return result;
    },

    /**
     * Least-recently-used keys, up to `limit`. Returns [{id, key}] so a caller
     * can walk the list and try the next one when a key turns out to be dead.
     */
    async take(limit = 5) {
      if (!db) return [];
      try {
        const { results } = await db
          .prepare(
            `SELECT id, key FROM ${table}
             ORDER BY last_used IS NOT NULL, last_used ASC, id ASC
             LIMIT ?1`
          )
          .bind(Math.max(1, Math.min(50, limit)))
          .all();
        return results || [];
      } catch {
        // Table missing / D1 hiccup — caller falls back to the env seed.
        return [];
      }
    },

    /** A key worked: clear its fail streak and mark it used. */
    async ok(id) {
      if (!db || !id) return;
      try {
        await db
          .prepare(
            `UPDATE ${table}
             SET uses = uses + 1, fails = 0, last_error = '', last_used = ?2
             WHERE id = ?1`
          )
          .bind(id, Date.now())
          .run();
      } catch {
        /* stats are best-effort — never fail a request over bookkeeping */
      }
    },

    /** A key is definitively dead (invalid or out of balance): drop it now. */
    async dead(id, reason = '') {
      if (!db || !id) return false;
      try {
        const r = await db.prepare(`DELETE FROM ${table} WHERE id = ?1`).bind(id).run();
        return Boolean(r.meta?.changes);
      } catch {
        return false;
      }
    },

    /**
     * An ambiguous failure (timeout, upstream 5xx, empty token with no reason).
     * Bumps the streak and deletes the key once it passes MAX_FAILS — that's the
     * safety net for keys that die without saying so. Returns true if dropped.
     */
    async soft(id, reason = '') {
      if (!db || !id) return false;
      try {
        await db
          .prepare(
            `UPDATE ${table}
             SET fails = fails + 1, last_error = ?2, last_used = ?3
             WHERE id = ?1`
          )
          .bind(id, String(reason).slice(0, 120), Date.now())
          .run();

        const row = await db.prepare(`SELECT fails FROM ${table} WHERE id = ?1`).bind(id).first();
        if ((row?.fails || 0) >= MAX_FAILS) {
          await db.prepare(`DELETE FROM ${table} WHERE id = ?1`).bind(id).run();
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },

    /** Rows for the management UI — keys masked, never raw. */
    async list(limit = 100) {
      if (!db) return [];
      try {
        await ensure();
        const { results } = await db
          .prepare(
            `SELECT id, key, uses, fails, last_used, last_error, added_at
             FROM ${table} ORDER BY id ASC LIMIT ?1`
          )
          .bind(Math.max(1, Math.min(500, limit)))
          .all();
        return (results || []).map((r) => ({ ...r, key: maskKey(r.key) }));
      } catch {
        return [];
      }
    },

    async count() {
      if (!db) return 0;
      try {
        await ensure();
        const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first();
        return row?.n || 0;
      } catch {
        return 0;
      }
    },

    async remove(id) {
      if (!db || !Number.isInteger(id)) return false;
      try {
        const r = await db.prepare(`DELETE FROM ${table} WHERE id = ?1`).bind(id).run();
        return Boolean(r.meta?.changes);
      } catch {
        return false;
      }
    },

    /** Wipe the pool. Returns how many rows went. */
    async clear() {
      if (!db) return 0;
      try {
        const r = await db.prepare(`DELETE FROM ${table}`).run();
        return r.meta?.changes || 0;
      } catch {
        return 0;
      }
    },
  };
}
