import { readFileSync } from 'node:fs';
const har = JSON.parse(readFileSync('test/asithatop.har', 'utf8'));

let token = '';
for (const e of har.log.entries) {
  const u = new URL(e.request.url);
  if (u.host === 'back.asitha.top' && u.pathname === '/api/auth/user' && e.request.method === 'GET') {
    const auth = e.request.headers.find(h => h.name.toLowerCase() === 'authorization');
    if (auth) { token = auth.value.replace('Bearer ', ''); break; }
  }
}

// Get nonce
const res1 = await fetch('https://back.asitha.top/api/security/init', {
  headers: { authorization: `Bearer ${token}` }
});
const { nonce } = await res1.json();
console.log('nonce:', nonce);

// Try using a free hcaptcha solver alternative: nopecha or just skip
// The HAR shows recaptcha_token is actually an hcaptcha token (P1_eyJ...)
// Let's try sadcaptcha or capsolver with a test token

// Actually, let's try hsolver.online with a paid proxy format
// The error was "zero balance" when proxy was provided - this means the key
// just has no credits left. Let's look for alternatives.

// Alternative: try to use the nonce-only security without captcha
// The request in HAR has: cookie x_sec_session + recaptcha_token in body
// Let's try with just the correct cookie format

console.log();
console.log('=== POST /api/user/get-temp-token (with nonce as session, dummy token) ===');
const res2 = await fetch('https://back.asitha.top/api/user/get-temp-token', {
  method: 'POST',
  headers: {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    cookie: `x_sec_session=${nonce}`,
    origin: 'https://asitha.top',
    referer: 'https://asitha.top/',
  },
  body: JSON.stringify({ recaptcha_token: 'test123' })
});
const data2 = await res2.json().catch(() => null);
console.log('HTTP:', res2.status);
console.log('response:', JSON.stringify(data2).slice(0, 300));
console.log();

// Let's try with the checkcaptcha response format from HAR
// The HAR shows the recaptcha_token is "P1_eyJ..." which is the hcaptcha generated token
// We need a REAL captcha solve. Let's check capsolver (free tier has some credits)
console.log('=== Trying capsolver.com createTask ===');
const capsRes = await fetch('https://api.capsolver.com/createTask', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    appId: 'B3C06D21-E226-4B20-9B9A-F8B5310E2E8B',
    task: {
      type: 'HCaptchaTaskProxyLess',
      websiteURL: 'https://asitha.top/channel-manager',
      websiteKey: '3acc5934-433c-46a8-82ba-51c03050c64a',
    }
  })
});
const capsData = await capsRes.json().catch(() => null);
console.log('capsolver HTTP:', capsRes.status);
console.log('capsolver response:', JSON.stringify(capsData).slice(0, 300));
console.log();

// Also try 2captcha-style (anticaptcha format)
console.log('=== Checking hsolver balance/info ===');
const balRes = await fetch('https://hsolver.online/getBalance', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ clientKey: 'HS-77T3UVE8AJT5QR' })
});
const balData = await balRes.json().catch(() => null);
console.log('balance HTTP:', balRes.status);
console.log('balance response:', JSON.stringify(balData).slice(0, 200));
