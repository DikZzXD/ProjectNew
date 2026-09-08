// The hsolver key has zero balance. Let's check if there's any balance info endpoint
// or alternative solver. First, verify the full react flow works with the token
// we already have (from HAR) without needing hcaptcha — the flow uses hcaptcha
// only for get-temp-token, but maybe we can use the main apiKey directly.

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

// Check: can we generate an apikey?
console.log('=== POST /api/user/generate-apikey ===');
const res1 = await fetch('https://back.asitha.top/api/user/generate-apikey', {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: '{}'
});
const data1 = await res1.json().catch(() => null);
console.log('HTTP:', res1.status);
console.log('apiKey present:', !!data1?.user?.apiKey);
console.log('message:', data1?.message || 'none');
console.log();

// Get nonce
console.log('=== GET /api/security/init ===');
const res2 = await fetch('https://back.asitha.top/api/security/init', {
  headers: { authorization: `Bearer ${token}` }
});
const data2 = await res2.json().catch(() => null);
console.log('nonce:', data2?.nonce);
console.log();

// Try get-temp-token WITHOUT hcaptcha
console.log('=== POST /api/user/get-temp-token (no captcha) ===');
const res3 = await fetch('https://back.asitha.top/api/user/get-temp-token', {
  method: 'POST',
  headers: {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    cookie: `x_sec_session=${data2?.nonce}`
  },
  body: JSON.stringify({})
});
const data3 = await res3.json().catch(() => res3.text());
console.log('HTTP:', res3.status);
console.log('response:', JSON.stringify(data3).slice(0, 300));
console.log();

// Try get-temp-token with empty recaptcha_token
console.log('=== POST /api/user/get-temp-token (empty captcha) ===');
const res4 = await fetch('https://back.asitha.top/api/user/get-temp-token', {
  method: 'POST',
  headers: {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    cookie: `x_sec_session=${data2?.nonce}`
  },
  body: JSON.stringify({ recaptcha_token: '' })
});
const data4 = await res4.json().catch(() => res4.text());
console.log('HTTP:', res4.status);
console.log('response:', JSON.stringify(data4).slice(0, 300));
console.log();

// Try react-to-post directly with main bearer (no temp token)
console.log('=== POST /api/channel/react-to-post (main bearer, no temp token) ===');
const res5 = await fetch('https://back.asitha.top/api/channel/react-to-post', {
  method: 'POST',
  headers: {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    post_link: 'https://whatsapp.com/channel/0029Vb6xflDKAwEmGOltPU2X/6703',
    reacts: '🦄,🩷,🌼,🤍,💗',
    count: '1'
  })
});
const data5 = await res5.json().catch(() => res5.text());
console.log('HTTP:', res5.status);
console.log('response:', JSON.stringify(data5).slice(0, 300));
