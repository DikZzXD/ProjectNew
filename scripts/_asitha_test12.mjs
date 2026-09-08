import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const har = JSON.parse(readFileSync('test/asithatop.har', 'utf8'));
const SECRET = 'AsithaApiSignatureKey2026!@#';
const API = 'https://back.asitha.top/api';

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

// The react endpoint requires the TEMP token as ?apiKey=..., NOT the static one.
// The temp token is obtained from get-temp-token which requires hcaptcha.
// The x_sec_session cookie from security/init must be forwarded too.
// Let's check if we can pass the cookie properly.

// Step 1: Get nonce + cookie
console.log('=== Step 1: security/init ===');
const initRes = await fetch(`${API}/security/init`, {
  headers: { authorization: `Bearer ${bearerToken}`, origin: 'https://asitha.top', referer: 'https://asitha.top/' },
});
const initData = await initRes.json();
const nonce = initData.nonce;
const setCookie = initRes.headers.getSetCookie?.() || [];
const sessionCookie = setCookie.find(c => c.startsWith('x_sec_session='));
const cookieValue = sessionCookie ? sessionCookie.split(';')[0] : '';
console.log('nonce:', nonce);
console.log('cookie:', cookieValue.slice(0, 60) + '...');
console.log();

// Step 2: get-temp-token — we need a real hcaptcha response.
// The hsolver key is dead (zero balance). Let's try nopecha or another free solver.
// Actually, let's check if we can use our own Turnstile bypass or if we need to 
// try a different approach entirely.

// Let's check: can we call get-temp-token with the captcha token from the HAR 
// (it's expired obviously, but what error do we get with proper signing + cookie)?
console.log('=== Step 2: get-temp-token with proper signing + cookie (expired captcha) ===');
const body2 = { recaptcha_token: 'P1_expired_test_token' };
const headers2 = signHeaders(body2, nonce);
headers2.cookie = cookieValue;
const tempRes = await fetch(`${API}/user/get-temp-token`, {
  method: 'POST',
  headers: headers2,
  body: JSON.stringify(body2),
});
const tempData = await tempRes.json().catch(() => null);
console.log('HTTP:', tempRes.status);
console.log('response:', JSON.stringify(tempData).slice(0, 300));
console.log();

// Check if the blocking is from cookie or captcha
console.log('=== Step 3: get-temp-token with signing + cookie but no captcha token ===');
const body3 = { recaptcha_token: '' };
const initRes3 = await fetch(`${API}/security/init`, {
  headers: { authorization: `Bearer ${bearerToken}`, origin: 'https://asitha.top', referer: 'https://asitha.top/' },
});
const initData3 = await initRes3.json();
const nonce3 = initData3.nonce;
const setCookie3 = initRes3.headers.getSetCookie?.() || [];
const cookie3 = (setCookie3.find(c => c.startsWith('x_sec_session=')) || '').split(';')[0];
const headers3 = signHeaders(body3, nonce3);
headers3.cookie = cookie3;
const tempRes3 = await fetch(`${API}/user/get-temp-token`, {
  method: 'POST',
  headers: headers3,
  body: JSON.stringify(body3),
});
const tempData3 = await tempRes3.json().catch(() => null);
console.log('HTTP:', tempRes3.status);
console.log('response:', JSON.stringify(tempData3).slice(0, 300));
