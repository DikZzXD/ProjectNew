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

// Good news: 
// - "Bot Detected" with an invalid captcha (vs "Strict Security: Blocked" without cookie/signing)
// - "Security Check Failed" with empty captcha
// This means our signing + cookie IS working, we just need a real hcaptcha token.
//
// The flow is: security/init → (get cookie) → solve hcaptcha → get-temp-token → react
//
// hsolver.online has zero balance. Let's try alternative free captcha solvers.
// Or better: let's see if we can solve it with our own turnstile bypass endpoint.
// The site uses hcaptcha (not turnstile), so we need an hcaptcha solver.

// Let's try nopecha (free tier)
console.log('=== Trying nopecha.com ===');
const nopRes = await fetch('https://api.nopecha.com/token/', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    type: 'hcaptcha',
    sitekey: '3acc5934-433c-46a8-82ba-51c03050c64a',
    url: 'https://asitha.top/channel-manager',
  })
});
const nopData = await nopRes.json().catch(() => null);
console.log('nopecha HTTP:', nopRes.status);
console.log('nopecha response:', JSON.stringify(nopData).slice(0, 200));
console.log();

// Try a different approach: use a free hcaptcha solving service
// hcaptcha-challenger or use the user's own hsolver with proper proxy
console.log('=== Trying sadcaptcha.com ===');
const sadRes = await fetch('https://www.sadcaptcha.com/api/v1/hcaptcha', {
  method: 'POST', 
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    siteKey: '3acc5934-433c-46a8-82ba-51c03050c64a',
    pageUrl: 'https://asitha.top/channel-manager',
  })
});
console.log('sadcaptcha HTTP:', sadRes.status);
const sadText = await sadRes.text();
console.log('sadcaptcha response:', sadText.slice(0, 200));
console.log();

// If all free solvers fail, we need to use hsolver.online but the key needs balance.
// Let's verify the hsolver flow is correct by checking what happens with a fresh account/credits.
console.log('=== One more try: hsolver.online with the key (different task format) ===');
const hs2 = await fetch('https://hsolver.online/createTask', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    clientKey: 'HS-77T3UVE8AJT5QR',
    task: {
      type: 'HCaptchaTask',
      websiteURL: 'https://asitha.top/channel-manager',
      websiteKey: '3acc5934-433c-46a8-82ba-51c03050c64a',
      proxy: 'http://user:pass@1.2.3.4:8080'
    }
  })
});
const hs2Data = await hs2.json().catch(() => null);
console.log('hsolver HTTP:', hs2.status);
console.log('hsolver response:', JSON.stringify(hs2Data).slice(0, 200));
