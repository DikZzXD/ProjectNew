/**
 * Rewind account provisioner.
 *
 * Automates the signup flow the browser performs, using our own temp .edu mail
 * service for the address so no real inbox is involved:
 *
 *   1. claim a temp .edu address        (src/lib/getedumail.js)
 *   2. POST /v1/auth/signup             → { user, accessToken }
 *   3. poll the inbox for the verify link, extract its `token`
 *   4. verify the address               (API call, falling back to a plain GET)
 *   5. POST /v1/api-keys                → { key: "sk-rewind-…" }
 *
 * Step 4 is best-effort: the API mints a usable key even while
 * `emailVerifiedAt` is null, so a verification hiccup downgrades the result to
 * `verified: false` instead of throwing the whole account away.
 */

import { fetchWithTimeout } from './http.js';
import { claim, inbox, DOMAINS } from './getedumail.js';

const API = 'https://api.rewind.ai/v1';

/** Browser-shaped headers — the API rejects requests without an allowed origin. */
const BROWSER = {
  accept: 'application/json',
  'content-type': 'application/json',
  origin: 'https://rewind.ai',
  referer: 'https://rewind.ai/',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
};

export class SignupError extends Error {
  constructor(message, step = 'unknown') {
    super(message);
    this.name = 'SignupError';
    this.step = step;
  }
}

const FIRST = ['clara', 'alice', 'nadia', 'dylan', 'maya', 'owen', 'ruby', 'kevin', 'sofia', 'liam', 'nora', 'ethan', 'zoe', 'micah', 'lena', 'jonas'];
const LAST = ['grant', 'brooks', 'hayes', 'porter', 'reeves', 'quinn', 'sloan', 'vance', 'ward', 'yates', 'nash', 'pierce', 'colby', 'raines'];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** `clara.grant192` — same shape the real signup used. */
function randomUser() {
  return `${pick(FIRST)}.${pick(LAST)}${Math.floor(100 + Math.random() * 900)}`;
}

/** A password that satisfies the usual upper/lower/digit/symbol rules. */
function randomPassword() {
  const body = Math.random().toString(36).slice(2, 8);
  return `Dz${body.charAt(0).toUpperCase()}${body.slice(1)}${Math.floor(1000 + Math.random() * 9000)}@`;
}

async function rq(path, { method = 'GET', token, body, timeoutMs = 20000 } = {}) {
  const headers = { ...BROWSER };
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetchWithTimeout(
    `${API}${path}`,
    { method, headers, body: body ? JSON.stringify(body) : undefined },
    timeoutMs
  );

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data, text };
}

export { randomUser, randomPassword, DOMAINS };

/** Step 2 — create the account. Returns { userId, email, accessToken }. */
async function signup(email, password) {
  const { ok, status, data, text } = await rq('/auth/signup', {
    method: 'POST',
    body: { email, password },
  });

  if (!ok || !data?.accessToken) {
    const message = data?.error?.message || data?.message || text?.slice(0, 120) || `HTTP ${status}`;
    throw new SignupError(`signup gagal: ${message}`, 'signup');
  }

  return {
    userId: data.user?.id || null,
    email: data.user?.email || email,
    accessToken: data.accessToken,
    verifiedAt: data.user?.emailVerifiedAt || null,
  };
}

/**
 * Step 3 — wait for the verification mail and lift the token out of its link.
 * The mail service already extracts `verification_link` per message, so this
 * just polls until one shows up and pulls `?token=…` off it.
 */
async function waitForToken(email, { attempts = 12, delayMs = 5000 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    if (i) await new Promise((r) => setTimeout(r, delayMs));

    let box;
    try {
      box = await inbox(email);
    } catch {
      continue; // inbox not ready yet
    }

    for (const m of box.messages || []) {
      const link = m.verification_link || '';
      const hit = /[?&]token=([A-Za-z0-9._-]{16,})/.exec(link);
      if (hit) return { token: hit[1], link };

      // Fall back to scanning the raw body for a rewind verify URL.
      const body = `${m.text || ''} ${m.html || ''}`;
      const raw = /https?:\/\/[^\s"'<>]*rewind\.ai\/[^\s"'<>]*token=([A-Za-z0-9._-]{16,})/.exec(body);
      if (raw) return { token: raw[1], link: raw[0] };
    }
  }
  throw new SignupError('link verifikasi tidak muncul di inbox', 'verify');
}

/**
 * Step 4 — verify. The HAR never captured this call (the browser followed the
 * emailed link directly), so the known API shapes are tried in turn and the
 * emailed URL itself is the last resort.
 */
async function verifyEmail(token, link) {
  const candidates = [
    { path: '/auth/verify-email', method: 'POST', body: { token } },
    { path: '/auth/verify', method: 'POST', body: { token } },
    { path: `/auth/verify-email?token=${encodeURIComponent(token)}`, method: 'GET' },
  ];

  for (const c of candidates) {
    try {
      const r = await rq(c.path, { method: c.method, body: c.body });
      if (r.ok) return true;
    } catch {
      /* try the next shape */
    }
  }

  // Last resort: fetch the emailed link the way a browser would.
  if (link) {
    try {
      const res = await fetchWithTimeout(link, { headers: { 'user-agent': BROWSER['user-agent'] } }, 20000);
      if (res.ok) return true;
    } catch {
      /* fall through */
    }
  }
  return false;
}

/** Step 5 — mint an API key. Returns the full `sk-rewind-…` secret. */
async function createApiKey(accessToken, name) {
  const { ok, status, data, text } = await rq('/api-keys', {
    method: 'POST',
    token: accessToken,
    body: { name },
  });

  if (!ok || !data?.key) {
    const message = data?.error?.message || data?.message || text?.slice(0, 120) || `HTTP ${status}`;
    throw new SignupError(`gagal bikin api key: ${message}`, 'apikey');
  }
  return { key: data.key, id: data.id || null, prefix: data.keyPrefix || null };
}

/**
 * Provision one account end to end: claim address → signup → verify → api key.
 * Never throws; a failure is reported as `{ ok: false, step, error }` so one bad
 * account cannot abort a batch.
 */
export async function provisionOne({ keyName = 'dik', pollAttempts = 12, pollDelayMs = 5000 } = {}) {
  const domain = pick(DOMAINS);
  const email = `${randomUser()}@${domain}`;
  const password = randomPassword();

  try {
    await claim(email);
  } catch (error) {
    return { ok: false, step: 'mail', email, error: `gagal klaim email: ${error?.message || 'unknown'}` };
  }

  let account;
  try {
    account = await signup(email, password);
  } catch (error) {
    return { ok: false, step: error?.step || 'signup', email, error: error?.message || 'unknown' };
  }

  // Verification is best-effort — the key works regardless, so a miss here is
  // reported rather than fatal.
  let verified = false;
  try {
    const { token, link } = await waitForToken(email, { attempts: pollAttempts, delayMs: pollDelayMs });
    verified = await verifyEmail(token, link);
  } catch {
    verified = false;
  }

  let apiKey;
  try {
    apiKey = await createApiKey(account.accessToken, keyName);
  } catch (error) {
    return { ok: false, step: 'apikey', email, verified, error: error?.message || 'unknown' };
  }

  return { ok: true, email, password, verified, key: apiKey.key, prefix: apiKey.prefix };
}

/**
 * Provision `count` accounts with at most `workers` in flight at once. Results
 * come back in completion order; each entry is a provisionOne() result.
 */
export async function provisionMany(count, workers = 10, options = {}) {
  const total = Math.max(1, Number(count) || 1);
  const lanes = Math.min(Math.max(1, Number(workers) || 10), total);

  const results = [];
  let next = 0;

  const lane = async () => {
    while (next < total) {
      const mine = next;
      next += 1;
      const r = await provisionOne(options);
      results[mine] = r;
      if (typeof options.onResult === 'function') {
        try {
          await options.onResult(r, results.filter(Boolean).length, total);
        } catch {
          /* a reporting failure must not kill the lane */
        }
      }
    }
  };

  await Promise.all(Array.from({ length: lanes }, lane));
  return results.filter(Boolean);
}
