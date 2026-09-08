import { readFileSync } from 'node:fs';
const har = JSON.parse(readFileSync('test/asithatop.har', 'utf8'));

// Let's reverse-engineer the x-signature + x_sec_session cookie generation.
// We have two data points from the HAR:

// Request 1: get-temp-token
// x-nonce: 001fc3886e2d3555f94d2f1acc786ff2
// x-timestamp: 1787391309577
// x-signature: 4e169b8e1854c480fc28a7619a982747b7f20d375cb6cca02b3e2252e4126487
// x_sec_session: 001fc3886e2d3555f94d2f1acc786ff2.2253e085a495565f8bff43149e88abf97...

// Request 2: react-to-post  
// x-nonce: 4a3c7cec75d8dbf8f5ccbb4214c2f113
// x-timestamp: 1787391312004
// x-signature: 9c881bc668234bd48ea4874d914ed633b0d50a7ee042f487e34cfeb678268606
// x_sec_session: 4a3c7cec75d8dbf8f5ccbb4214c2f113.ed164529d97251dd40cbb2f0081e512f8...

// The signature is 64 hex chars = sha256 output
// Let's get the full x_sec_session cookies from HAR

for (const e of har.log.entries) {
  const u = new URL(e.request.url);
  if (u.host !== 'back.asitha.top') continue;
  if (e.request.method === 'OPTIONS') continue;
  const xnonce = e.request.headers.find(h => h.name === 'x-nonce');
  const xts = e.request.headers.find(h => h.name === 'x-timestamp');
  const xsig = e.request.headers.find(h => h.name === 'x-signature');
  if (!xnonce) continue;

  const cookies = e.request.headers.filter(h => h.name.toLowerCase() === 'cookie');
  let secSession = '';
  for (const c of cookies) {
    const m = /x_sec_session=([^\s;]+)/.exec(c.value);
    if (m) { secSession = m[1]; break; }
  }
  
  console.log('===', e.request.method, u.pathname);
  console.log('  nonce:', xnonce.value);
  console.log('  timestamp:', xts?.value);
  console.log('  signature:', xsig?.value);
  console.log('  x_sec_session:', secSession.slice(0, 80));
  console.log('  body:', (e.request.postData?.text || '').slice(0, 100));
  console.log();
}
