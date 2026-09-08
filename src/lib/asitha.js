/**
 * asitha.top client — WhatsApp channel post reactions.
 *
 * The upstream gates every write behind two things at once:
 *   1. an account Bearer (from a logged-in asitha session), and
 *   2. a fresh hCaptcha token, exchanged for a 60-second temp JWT.
 *
 * Flow (mirrors the site's own ChannelManager):
 *   solve hCaptcha (nonecap)  → P1_ token
 *   GET  /security/init       → nonce  (+ session cookie)
 *   POST /user/get-temp-token → temp JWT   (needs Bearer + hCaptcha token, signed)
 *   POST /channel/react-to-post?apiKey=<jwt> → queue the reactions   (signed)
 *
 * Every signed request carries HMAC-SHA256(`${ts}.${nonce}.${JSON.stringify(body)}`).
 * Nothing here is exposed raw to a caller: the endpoint re-wraps the result.
 *
 * The captcha step goes through src/lib/nonecap.js, which rotates a D1-backed key
 * pool and prunes dead keys — this file just asks for a token.
 */

import { solve, NonecapError } from './nonecap.js';

const API = 'https://back.asitha.top/api';
export const SITEKEY = '3acc5934-433c-46a8-82ba-51c03050c64a';
export const SITE_URL = 'https://asitha.top/channel-manager';
const SIGN_SECRET = 'AsithaApiSignatureKey2026!@#';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

export class AsithaError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'AsithaError';
    this.status = status;
  }
}

/** Hex HMAC-SHA256 over `${ts}.${nonce}.${body}` using WebCrypto (Workers-safe). */
async function signature(bodyJson, nonce, ts) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SIGN_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const msg = new TextEncoder().encode(`${ts}.${nonce}.${bodyJson}`);
  const sig = await crypto.subtle.sign('HMAC', key, msg);
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Cookie jar keyed by name so a fresh /security/init replaces the old session. */
function jar() {
  const cookies = new Map();
  return {
    absorb(res) {
      const set = res.headers.getSetCookie?.() || [];
      for (const c of set) {
        const [pair] = c.split(';');
        const eq = pair.indexOf('=');
        if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    },
    header() {
      return [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    get size() {
      return cookies.size;
    },
  };
}

function timeout(ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
}

/** Shared request headers: UA + origin, plus the account bearer and session jar. */
function baseHeaders(bearer, cookieJar) {
  const h = {
    'user-agent': UA,
    origin: 'https://asitha.top',
    referer: 'https://asitha.top/',
  };
  if (bearer) h.authorization = `Bearer ${bearer}`;
  if (cookieJar && cookieJar.size) h.cookie = cookieJar.header();
  return h;
}

/** Signed-request headers for a JSON body. */
async function signedHeaders(body, nonce) {
  const bodyJson = JSON.stringify(body);
  const ts = Date.now().toString();
  return {
    'x-signature': await signature(bodyJson, nonce, ts),
    'x-timestamp': ts,
    'x-nonce': nonce,
    'content-type': 'application/json',
  };
}

/**
 * Solve the channel-manager hCaptcha and return a P1_ enterprise token. Goes
 * through the rotating nonecap pool: dead keys are pruned there, so all this
 * layer has to do is translate a pool exhaustion into an AsithaError.
 *
 * The sitekey has enc_get_req=true, so only a paid solver mints a token this
 * endpoint accepts — free/PoW solvers produce demo tokens the server rejects.
 */
async function solveCaptcha(env) {
  try {
    return await solve(env, { sitekey: SITEKEY, url: SITE_URL, type: 'hcaptcha', wait: 90 });
  } catch (error) {
    if (error instanceof NonecapError) throw new AsithaError(error.message, error.status);
    throw new AsithaError('Layanan sedang sibuk, coba lagi sebentar lagi', 503);
  }
}

/** GET /security/init → nonce (and refresh the session cookie in the jar). */
async function getNonce(bearer, cookieJar) {
  const t = timeout(20_000);
  try {
    const res = await fetch(`${API}/security/init`, {
      headers: baseHeaders(bearer, cookieJar),
      signal: t.signal,
    });
    cookieJar.absorb(res);
    const data = await res.json().catch(() => ({}));
    if (!data.nonce) throw new AsithaError('Gagal memulai sesi, coba lagi', 503);
    return data.nonce;
  } finally {
    t.done();
  }
}

/** POST /user/get-temp-token → short-lived JWT (needs bearer + hCaptcha token). */
async function getTempToken(bearer, cookieJar, hcToken) {
  const nonce = await getNonce(bearer, cookieJar);
  const body = { recaptcha_token: hcToken };
  const t = timeout(25_000);
  try {
    const res = await fetch(`${API}/user/get-temp-token`, {
      method: 'POST',
      headers: { ...baseHeaders(bearer, cookieJar), ...(await signedHeaders(body, nonce)) },
      body: JSON.stringify(body),
      signal: t.signal,
    });
    cookieJar.absorb(res);
    const data = await res.json().catch(() => ({}));
    if (!data.token) {
      // 401 here means the account bearer expired; surface as a soft capacity note.
      throw new AsithaError('Layanan sedang tidak tersedia, coba lagi nanti', 503);
    }
    return data.token;
  } finally {
    t.done();
  }
}

/** POST /channel/react-to-post → queue the reactions. */
async function postReact(bearer, cookieJar, tempJwt, { postLink, reacts, count }) {
  const nonce = await getNonce(bearer, cookieJar);
  const body = { post_link: postLink, reacts, count };
  const t = timeout(30_000);
  try {
    const res = await fetch(`${API}/channel/react-to-post?apiKey=${encodeURIComponent(tempJwt)}`, {
      method: 'POST',
      headers: { ...baseHeaders(bearer, cookieJar), ...(await signedHeaders(body, nonce)) },
      body: JSON.stringify(body),
      signal: t.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = String(data.message || data.error || '');
      // Coin/credit exhaustion: don't echo a raw "server failed" — say it plainly.
      if (/coin|credit|insufficient|balance|limit/i.test(msg)) {
        throw new AsithaError('Kuota reaksi sedang habis, coba lagi nanti', 503);
      }
      throw new AsithaError(msg || 'Gagal mengirim reaksi', res.status >= 500 ? 503 : 400);
    }
    return data;
  } finally {
    t.done();
  }
}

/**
 * Full flow: solve captcha → open session → temp token → react.
 * Returns the upstream queue result (message + botResponse), nothing raw leaks.
 *
 * `env` is passed through so the captcha step can reach the D1 key pool; the
 * caller no longer hands us a single nonecap key.
 */
export async function reactToChannelPost({ env, bearer, postLink, reacts, count }) {
  if (!bearer) throw new AsithaError('Layanan belum dikonfigurasi', 503);

  const cookieJar = jar();
  const hcToken = await solveCaptcha(env);
  const tempJwt = await getTempToken(bearer, cookieJar, hcToken);
  return postReact(bearer, cookieJar, tempJwt, { postLink, reacts, count });
}
