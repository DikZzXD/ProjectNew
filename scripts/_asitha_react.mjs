/**
 * End-to-end WhatsApp channel react via asitha.top, using nonecap for the
 * hCaptcha token. Flow mirrors ChannelManager.js:
 *   1. solve hCaptcha (nonecap)              → P1_ token
 *   2. GET  /security/init                   → nonce   (sets session cookie)
 *   3. POST /user/get-temp-token {recaptcha_token} signed → temp JWT
 *   4. POST /channel/react-to-post?apiKey=<jwt> {post_link,reacts,count} signed
 *
 * Signing: HMAC-SHA256(`${ts}.${nonce}.${JSON.stringify(body)}`, SECRET) hex.
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const NONECAP_KEY = devVar('NONECAP_KEY');
const API = 'https://back.asitha.top/api';
const SITEKEY = '3acc5934-433c-46a8-82ba-51c03050c64a';
const SECRET = 'AsithaApiSignatureKey2026!@#';
const SITE_URL = 'https://asitha.top/channel-manager';

/** Read one key out of the gitignored .dev.vars so no secret sits in this file. */
function devVar(name) {
  try {
    const line = readFileSync('.dev.vars', 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim() : '';
  } catch {
    return '';
  }
}

const POST_LINK = process.argv[2] || 'https://whatsapp.com/channel/0029Vb6xflDKAwEmGOltPU2X/6703';
const REACTS = process.argv[3] || '❤,😍';
const COUNT = process.argv[4] || '1';

// Account bearer (from the HAR login). Every asitha API call needs it — the
// temp-token endpoint is gated by BOTH this AND the hCaptcha token.
let BEARER = '';
try {
  const har = JSON.parse(readFileSync('test/asithatop.har', 'utf8'));
  for (const e of har.log.entries) {
    const u = new URL(e.request.url);
    if (u.host === 'back.asitha.top') {
      const a = e.request.headers.find((h) => h.name.toLowerCase() === 'authorization');
      if (a) { BEARER = a.value.replace(/^Bearer /, ''); break; }
    }
  }
} catch {}
console.log('[0] account bearer len=%d', BEARER.length);

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

// Cookie jar keyed by name so a fresh /security/init session replaces the old
// one instead of stacking a duplicate (which made the server read a stale nonce).
const cookies = new Map();
function absorb(res) {
  const set = res.headers.getSetCookie?.() || [];
  for (const c of set) {
    const [pair] = c.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}
const cookieHeader = () => [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
const baseHeaders = () => ({
  'user-agent': UA,
  origin: 'https://asitha.top',
  referer: 'https://asitha.top/',
  ...(BEARER ? { authorization: `Bearer ${BEARER}` } : {}),
  ...(cookies.size ? { cookie: cookieHeader() } : {}),
});

function sign(body, nonce) {
  const ts = Date.now().toString();
  const payload = JSON.stringify(body);
  const msg = `${ts}.${nonce}.${payload}`;
  return {
    'x-signature': createHmac('sha256', SECRET).update(msg).digest('hex'),
    'x-timestamp': ts,
    'x-nonce': nonce,
    'content-type': 'application/json',
  };
}

async function nonce() {
  const res = await fetch(`${API}/security/init`, { headers: baseHeaders() });
  absorb(res);
  const data = await res.json();
  return data.nonce;
}

// 1. hCaptcha via nonecap
console.log('[1] solving hCaptcha via nonecap…');
const solveRes = await fetch('https://api.nonecap.com/v1/solves?wait=90', {
  method: 'POST',
  headers: { authorization: `Bearer ${NONECAP_KEY}`, 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'hcaptcha', sitekey: SITEKEY, url: SITE_URL }),
});
const solve = await solveRes.json();
console.log('    status=%s http=%d', solve.status, solveRes.status);
const hcToken = solve.token;
if (!hcToken) {
  console.log('    FAIL:', JSON.stringify(solve).slice(0, 300));
  process.exit(1);
}
console.log('    token len=%d prefix=%s', hcToken.length, hcToken.slice(0, 12));

// 2 + 3. temp token
console.log('[2] GET /security/init…');
let n = await nonce();
console.log('    nonce=%s', n);

console.log('[3] POST /user/get-temp-token…');
const ttBody = { recaptcha_token: hcToken };
const ttRes = await fetch(`${API}/user/get-temp-token`, {
  method: 'POST',
  headers: { ...baseHeaders(), ...sign(ttBody, n) },
  body: JSON.stringify(ttBody),
});
absorb(ttRes);
const ttData = await ttRes.json().catch(() => ({}));
console.log('    http=%d keys=%s', ttRes.status, Object.keys(ttData).join(','));
const tempJwt = ttData.token;
if (!tempJwt) {
  console.log('    FAIL:', JSON.stringify(ttData).slice(0, 300));
  process.exit(1);
}
console.log('    tempJwt len=%d', tempJwt.length);

// 4. react-to-post
console.log('[4] POST /channel/react-to-post…');
n = await nonce();
const reactBody = { post_link: POST_LINK, reacts: REACTS, count: COUNT };
const rRes = await fetch(`${API}/channel/react-to-post?apiKey=${encodeURIComponent(tempJwt)}`, {
  method: 'POST',
  headers: { ...baseHeaders(), ...sign(reactBody, n) },
  body: JSON.stringify(reactBody),
});
const rData = await rRes.json().catch(() => ({}));
console.log('    http=%d', rRes.status);
console.log('    body:', JSON.stringify(rData).slice(0, 500));
console.log(rRes.ok ? '\n✅ REACT SENT' : '\n❌ react failed');
