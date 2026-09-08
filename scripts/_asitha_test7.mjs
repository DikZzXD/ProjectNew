import { readFileSync } from 'node:fs';
import { createHmac, createHash } from 'node:crypto';

// We have two samples:
// Sample 1:
//   nonce: 001fc3886e2d3555f94d2f1acc786ff2
//   timestamp: 1787391309577
//   signature: 4e169b8e1854c480fc28a7619a982747b7f20d375cb6cca02b3e2252e4126487
//   path: /api/user/get-temp-token
//   body: {"recaptcha_token":"P1_eyJ..."}
//
// Sample 2:
//   nonce: 4a3c7cec75d8dbf8f5ccbb4214c2f113
//   timestamp: 1787391312004
//   signature: 9c881bc668234bd48ea4874d914ed633b0d50a7ee042f487e34cfeb678268606
//   path: /api/channel/react-to-post (with query ?apiKey=...)
//   body: {"post_link":"...","reacts":"...","count":"1"}

// The signature is sha256 (64 hex chars). Let's try common patterns:
// 1) HMAC-SHA256(nonce, timestamp+path)
// 2) SHA256(nonce + timestamp + path)
// 3) SHA256(nonce + timestamp)
// 4) HMAC-SHA256(nonce, timestamp)
// 5) SHA256(timestamp + nonce)

const samples = [
  {
    nonce: '001fc3886e2d3555f94d2f1acc786ff2',
    timestamp: '1787391309577',
    signature: '4e169b8e1854c480fc28a7619a982747b7f20d375cb6cca02b3e2252e4126487',
    path: '/api/user/get-temp-token',
    method: 'POST',
  },
  {
    nonce: '4a3c7cec75d8dbf8f5ccbb4214c2f113',
    timestamp: '1787391312004',
    signature: '9c881bc668234bd48ea4874d914ed633b0d50a7ee042f487e34cfeb678268606',
    path: '/api/channel/react-to-post',
    method: 'POST',
  },
];

// Let's try many known key candidates
const secrets = [
  'asitha',
  'asitha.top',
  'asitha_secret',
  'x_sec_key',
  'security',
  'secret',
  'react',
  'channel-manager',
];

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}
function hmac256(key, data) {
  return createHmac('sha256', key).update(data).digest('hex');
}

const s = samples[0];
// Try basic concatenations
const combos = [
  `${s.nonce}${s.timestamp}`,
  `${s.timestamp}${s.nonce}`,
  `${s.nonce}:${s.timestamp}`,
  `${s.timestamp}:${s.nonce}`,
  `${s.nonce}.${s.timestamp}`,
  `${s.nonce}${s.timestamp}${s.path}`,
  `${s.timestamp}${s.nonce}${s.path}`,
  `${s.method}${s.path}${s.nonce}${s.timestamp}`,
  `${s.nonce}${s.timestamp}${s.method}${s.path}`,
  `${s.path}${s.nonce}${s.timestamp}`,
  `${s.path}:${s.nonce}:${s.timestamp}`,
  `POST:${s.path}:${s.nonce}:${s.timestamp}`,
  `${s.nonce}|${s.timestamp}`,
  `${s.nonce}-${s.timestamp}`,
];

console.log('Target sig:', s.signature);
console.log();
console.log('--- SHA256 direct ---');
for (const c of combos) {
  const h = sha256(c);
  if (h === s.signature) console.log('MATCH:', c);
}

console.log();
console.log('--- HMAC-SHA256 (secret as key) ---');
for (const secret of secrets) {
  for (const c of combos) {
    const h = hmac256(secret, c);
    if (h === s.signature) console.log('MATCH: secret=' + secret, 'data=' + c);
  }
}

console.log();
console.log('--- HMAC-SHA256 (nonce as key) ---');
const nonceKeyCombos = [
  s.timestamp,
  `${s.timestamp}${s.path}`,
  `${s.method}${s.path}${s.timestamp}`,
  `${s.path}${s.timestamp}`,
  `POST:${s.path}:${s.timestamp}`,
  `${s.timestamp}:${s.path}`,
];
for (const c of nonceKeyCombos) {
  const h = hmac256(s.nonce, c);
  if (h === s.signature) console.log('MATCH: key=nonce, data=' + c);
}

console.log();
console.log('--- HMAC-SHA256 (timestamp as key) ---');
const tsCombos = [
  s.nonce,
  `${s.nonce}${s.path}`,
  `${s.method}${s.nonce}${s.path}`,
  `${s.path}${s.nonce}`,
];
for (const c of tsCombos) {
  const h = hmac256(s.timestamp, c);
  if (h === s.signature) console.log('MATCH: key=timestamp, data=' + c);
}

// Let's also look at the JS file that implements this
console.log();
console.log('=== Fetching client JS to find signature logic ===');
const jsRes = await fetch('https://asitha.top/assets/ChannelManager--WV9vAM6.js');
const jsText = await jsRes.text();
console.log('JS size:', jsText.length);

// Search for signature/nonce/x-signature patterns
const sigMatches = jsText.match(/.{0,80}(signature|x-nonce|x-timestamp|x-signature|x_sec_session|hmac|crypto|createHmac|sha256).{0,80}/gi);
if (sigMatches) {
  console.log('Found', sigMatches.length, 'matches');
  for (const m of sigMatches.slice(0, 15)) {
    console.log('  ...', m.trim().slice(0, 150));
  }
}
