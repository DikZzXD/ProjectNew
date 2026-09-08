/**
 * Upstream client for the Alight Motion activation service
 * (am.caggyshop.my.id).
 *
 * The service is session-based: every generate/verify call needs the cookies
 * issued by register or login. Workers' fetch has no cookie jar, so the jar is
 * threaded manually here.
 *
 * Because the account password is derived deterministically from the email, a
 * later request can rebuild the same session from scratch — which is what lets
 * the two-step flow (send link → verify link) work statelessly across separate
 * API calls.
 */

const BASE = 'https://am.caggyshop.my.id';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function headers(refererPath, cookie) {
  return {
    'content-type': 'application/json',
    accept: '*/*',
    origin: BASE,
    referer: `${BASE}${refererPath}`,
    'user-agent': UA,
    ...(cookie ? { cookie } : {}),
  };
}

/** Collect Set-Cookie name=value pairs into a single Cookie header string. */
function jar(res, previous = '') {
  const raw = res.headers.getSetCookie?.() || [];
  const list = raw.length ? raw : [res.headers.get('set-cookie')].filter(Boolean);

  const map = new Map(
    previous
      .split('; ')
      .filter(Boolean)
      .map((pair) => {
        const i = pair.indexOf('=');
        return [pair.slice(0, i), pair.slice(i + 1)];
      })
  );

  for (const entry of list) {
    const first = entry.split(';')[0];
    const i = first.indexOf('=');
    if (i > 0) map.set(first.slice(0, i).trim(), first.slice(i + 1));
  }

  return [...map].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function readJSON(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

function errorOf(data, fallback) {
  return (data && (data.error || data.message)) || fallback;
}

/** Deterministic password so the same email always maps to the same account. */
export async function derivePassword(email) {
  const seed = `amgen::${email.toLowerCase().trim()}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `Am${hex.slice(0, 12)}9x`;
}

/**
 * Register the account, or log in when it already exists.
 * Resolves to { cookie, mode } — mode is 'register' or 'login'.
 */
export async function authenticate(email) {
  const password = await derivePassword(email);

  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: headers('/auth/register'),
    body: JSON.stringify({ email, password, terms: true }),
  });
  const regData = await readJSON(reg);

  if (reg.ok && regData.user) {
    return { cookie: jar(reg), mode: 'register', user: regData.user };
  }

  // 409 = already registered, anything else is a real failure.
  if (reg.status !== 409) {
    throw new UpstreamError(errorOf(regData, `Register gagal (HTTP ${reg.status})`), reg.status);
  }

  const log = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: headers('/auth/login'),
    body: JSON.stringify({ email, password }),
  });
  const logData = await readJSON(log);

  if (!log.ok || !logData.user) {
    throw new UpstreamError(errorOf(logData, `Login gagal (HTTP ${log.status})`), log.status);
  }

  return { cookie: jar(log), mode: 'login', user: logData.user };
}

/** Remaining daily quota and cooldown for the session. */
export async function quota(cookie) {
  const res = await fetch(`${BASE}/api/generate`, { headers: headers('/app', cookie) });
  const data = await readJSON(res);
  return {
    usedToday: data.usedToday ?? 0,
    dailyLimit: data.dailyLimit ?? 2,
    retryAfterMs: data.retryAfterMs ?? 0,
  };
}

/** Ask the service to mail an activation link to the Alight Motion address. */
export async function requestLink(cookie, amEmail) {
  const res = await fetch(`${BASE}/api/generate`, {
    method: 'POST',
    headers: headers('/app', cookie),
    body: JSON.stringify({ amEmail }),
  });
  const data = await readJSON(res);

  if (!res.ok || !data.id) {
    throw new UpstreamError(errorOf(data, `Gagal minta link (HTTP ${res.status})`), res.status);
  }

  return data;
}

/** Jobs belonging to the session, newest first. */
export async function jobs(cookie) {
  const res = await fetch(`${BASE}/api/jobs`, { headers: headers('/app', cookie) });
  const data = await readJSON(res);
  const list = Array.isArray(data) ? data : [];
  return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/** Submit the sign-in link from the inbox to finish activation. */
export async function verifyLink(cookie, jobId, link) {
  const res = await fetch(`${BASE}/api/generate/${encodeURIComponent(jobId)}/verify-link`, {
    method: 'POST',
    headers: headers('/app', cookie),
    body: JSON.stringify({ link }),
  });
  const data = await readJSON(res);

  if (!res.ok) {
    throw new UpstreamError(errorOf(data, `Verifikasi gagal (HTTP ${res.status})`), res.status, data);
  }

  return data;
}

/** Format a millisecond cooldown as HH:MM:SS. */
export function cooldown(ms) {
  const total = Math.floor(Math.max(0, Number(ms) || 0) / 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

export class UpstreamError extends Error {
  constructor(message, status = 502, data = null) {
    super(message);
    this.name = 'UpstreamError';
    // Client mistakes stay 4xx; everything else is reported as a bad gateway.
    this.status = status >= 400 && status < 500 ? status : 502;
    this.data = data;
  }
}
