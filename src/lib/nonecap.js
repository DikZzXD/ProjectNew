/**
 * nonecap captcha solver client with a self-pruning key pool.
 *
 * A solve walks the least-recently-used keys from the `nonecap_keys` D1 pool and
 * returns the first token it gets. `env.NONECAP_KEY` is only a seed/fallback for
 * when the pool is empty, so the pool can be filled and rotated from the Telegram
 * bot without a redeploy.
 *
 * ── Why pruning is careful ────────────────────────────────────────────────────
 * nonecap does label its auth failures (`unauthorized`, `account_locked`,
 * balance/quota), and those labels are trusted: such a key can never solve again,
 * so it is deleted on the spot. What is NOT trusted is an unlabelled rejection —
 * a bare 403 or 4xx with no recognisable code, which is what an IP-level block or
 * a WAF in front of the API looks like. Deleting on those would wipe a 100-key
 * pool the first time the whole service refuses us.
 *
 * The rule that follows from that:
 *   • labelled errors (empty balance, invalid/revoked key, locked account) delete
 *     the row immediately — those can only be about that one key;
 *   • unlabelled rejections are buffered and only counted against a key if some
 *     OTHER key succeeded in the same request. A success proves the service is
 *     up, which makes the rejection key-specific;
 *   • if every key tried fails the same way, nothing is pruned — that's an
 *     outage, not 100 dead keys.
 * A key that keeps failing ambiguously still leaves the pool once its streak
 * reaches keypool's MAX_FAILS.
 */

import { pool, maskKey } from './keypool.js';

const API = 'https://api.nonecap.com/v1/solves';

/** How many keys one solve may burn through before giving up. */
const MAX_ATTEMPTS = 5;

export class NonecapError extends Error {
  constructor(message, status = 503) {
    super(message);
    this.name = 'NonecapError';
    this.status = status;
  }
}

/**
 * Classify one failed attempt.
 *   dead    → delete this key now (its own balance/validity is the problem)
 *   soft    → maybe this key, maybe not; only counted if another key worked
 *   upstream→ definitely not about the key (5xx, timeout, network)
 *
 * Live responses this was checked against (2026-08-23):
 *   no Authorization      → 401 unauthorized / "missing or malformed Authorization header"
 *   invalid key           → 401 unauthorized / "invalid or revoked API key"
 *   key on a locked acct  → 403 account_locked / "this account has been locked"
 */
function classify(status, body) {
  const code = String(body?.error?.code || body?.code || '');
  const message = String(body?.error?.message || body?.message || body?.detail || '');
  const blob = `${code} ${message}`;

  // Balance/quota exhaustion — the whole reason this pool exists.
  if (/balance|insufficient|no funds|out of credit|credits?|quota|topup|top-up|payment/i.test(blob)) {
    return { kind: 'dead', reason: message || 'saldo habis' };
  }

  // Explicitly about the key or the account behind it. `locked` is nonecap's
  // real-world answer for a key whose account got shut down — that key will
  // never solve again, so it goes immediately.
  if (/invalid[ _-]?(api[ _-]?)?key|api[ _-]?key.*(invalid|not found|expired|revoked)|unauthorized|unauthenticated|key not found|account[ _-]?locked|locked|suspended|banned|disabled|revoked|expired/i.test(blob)) {
    return { kind: 'dead', reason: message || 'key tidak valid' };
  }

  // Server-side / transport problems are never the key's fault.
  if (status >= 500 || status === 0 || status === 429) {
    return { kind: 'upstream', reason: message || `HTTP ${status}` };
  }

  // 401 with no further detail: auth-shaped, treat as the key.
  if (status === 401) return { kind: 'dead', reason: message || 'HTTP 401' };

  // Everything else — notably a bare 403 with no code, which is what a WAF or an
  // IP-level block looks like — is ambiguous.
  return { kind: 'soft', reason: message || code || `HTTP ${status}` };
}

/** POST one solve with one key. Never throws; returns a normalised outcome. */
async function attempt(key, { sitekey, url, type, wait }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), (wait + 8) * 1000);

  try {
    const res = await fetch(`${API}?wait=${wait}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ type, sitekey, url }),
      signal: controller.signal,
    });

    const body = await res.json().catch(() => ({}));

    if (res.ok && body?.token) return { ok: true, token: body.token };

    // A 200 with no token means the solver gave up on the captcha, not that the
    // key is bad — don't hold that against it.
    if (res.ok) return { ok: false, ...classify(0, body), reason: 'solver tidak mengembalikan token' };

    return { ok: false, ...classify(res.status, body) };
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    return { kind: 'upstream', ok: false, reason: timedOut ? 'timeout' : `network: ${error?.message || 'unknown'}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Solve a captcha, rotating through the pool. Returns the token string.
 * Throws NonecapError with a soft Indonesian message when nothing works.
 */
export async function solve(env, { sitekey, url, type = 'hcaptcha', wait = 90 } = {}) {
  const keys = pool(env);
  const rows = await keys.take(MAX_ATTEMPTS);

  // Seed fallback: env.NONECAP_KEY is used only when the pool is empty. id=null
  // marks it as unprunable — we can't delete an env var from a running Worker.
  const candidates = rows.length
    ? rows
    : env?.NONECAP_KEY
      ? [{ id: null, key: env.NONECAP_KEY }]
      : [];

  if (!candidates.length) throw new NonecapError('Layanan belum dikonfigurasi', 503);

  const pending = []; // ambiguous outcomes, applied only if another key worked

  for (const row of candidates) {
    const out = await attempt(row.key, { sitekey, url, type, wait });

    if (out.ok) {
      await keys.ok(row.id);
      // A success proves the service is up, so the earlier rejections really
      // were about those keys — count them now.
      for (const p of pending) await keys.soft(p.id, p.reason);
      return out.token;
    }

    if (out.kind === 'dead' && row.id) {
      await keys.dead(row.id, out.reason);
      continue;
    }
    if (out.kind === 'upstream') continue; // never counted against a key
    if (row.id) pending.push({ id: row.id, reason: out.reason });
  }

  // Nothing worked. `pending` is deliberately discarded: every attempt failed, so
  // this is far more likely an outage than N simultaneously dead keys.
  throw new NonecapError('Layanan sedang sibuk, coba lagi sebentar lagi', 503);
}
