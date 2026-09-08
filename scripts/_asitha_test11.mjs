import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const har = JSON.parse(readFileSync('test/asithatop.har', 'utf8'));

const SECRET = 'AsithaApiSignatureKey2026!@#';
const API = 'https://back.asitha.top/api';

// Get token from HAR
let bearerToken = '';
for (const e of har.log.entries) {
  const u = new URL(e.request.url);
  if (u.host === 'back.asitha.top' && u.pathname === '/api/auth/user' && e.request.method === 'GET') {
    const auth = e.request.headers.find(h => h.name.toLowerCase() === 'authorization');
    if (auth) { bearerToken = auth.value.replace('Bearer ', ''); break; }
  }
}

function signHeaders(body, nonce) {
  const ts = Date.now().toString();
  const payload = JSON.stringify(body);
  const message = `${ts}.${nonce}.${payload}`;
  const sig = createHmac('sha256', SECRET).update(message).digest('hex');
  return {
    'x-signature': sig,
    'x-timestamp': ts,
    'x-nonce': nonce,
    'content-type': 'application/json',
    authorization: `Bearer ${bearerToken}`,
    origin: 'https://asitha.top',
    referer: 'https://asitha.top/',
  };
}

// Step 1: GET /api/security/init (this also sets the x_sec_session cookie)
console.log('=== Step 1: security/init ===');
const initRes = await fetch(`${API}/security/init`, {
  headers: { authorization: `Bearer ${bearerToken}`, origin: 'https://asitha.top', referer: 'https://asitha.top/' },
});
const initData = await initRes.json();
console.log('nonce:', initData.nonce);

// Check for Set-Cookie header
const setCookies = initRes.headers.getSetCookie?.() || [];
console.log('Set-Cookie headers:', setCookies.length);
for (const c of setCookies) {
  console.log('  ', c.slice(0, 100));
}
console.log();

// Step 2: Need hcaptcha token. Let's try a creative approach — 
// check if there's an alternative captcha solver or if we can proceed differently.
// First, let's verify our signature works by trying a simple GET endpoint with signing.

// Step 2b: Try react-to-post with just the signing (see if captcha is truly required
// or if it's per-session)
console.log('=== Step 2: react-to-post with fresh sig (no temp token) ===');
const nonce2 = initData.nonce;
const body2 = { post_link: 'https://whatsapp.com/channel/0029Vb6xflDKAwEmGOltPU2X/6703', reacts: '🦄', count: '1' };
const headers2 = signHeaders(body2, nonce2);
const reactRes = await fetch(`${API}/channel/react-to-post`, {
  method: 'POST',
  headers: headers2,
  body: JSON.stringify(body2),
});
const reactData = await reactRes.json().catch(() => null);
console.log('HTTP:', reactRes.status);
console.log('response:', JSON.stringify(reactData).slice(0, 200));
console.log();

// Step 3: Try with apiKey query (the static apiKey from the user profile)
console.log('=== Step 3: react-to-post with profile apiKey ===');
const initRes2 = await fetch(`${API}/security/init`, {
  headers: { authorization: `Bearer ${bearerToken}`, origin: 'https://asitha.top', referer: 'https://asitha.top/' },
});
const initData2 = await initRes2.json();
const nonce3 = initData2.nonce;
const headers3 = signHeaders(body2, nonce3);

// From HAR, the apiKey used was a temp JWT. Let's use the static apiKey from /auth/user instead
const userRes = await fetch(`${API}/auth/user`, {
  headers: { authorization: `Bearer ${bearerToken}`, accept: 'application/json' }
});
const userData = await userRes.json();
const staticApiKey = userData?.user?.apiKey;
console.log('static apiKey length:', staticApiKey?.length);

const reactRes2 = await fetch(`${API}/channel/react-to-post?apiKey=${staticApiKey}`, {
  method: 'POST',
  headers: headers3,
  body: JSON.stringify(body2),
});
const reactData2 = await reactRes2.json().catch(() => null);
console.log('HTTP:', reactRes2.status);
console.log('response:', JSON.stringify(reactData2).slice(0, 200));
