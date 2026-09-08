import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

// From the JS source:
// SECRET = "AsithaApiSignatureKey2026!@#"
// timestamp = Date.now().toString()
// payload = (method === "GET") ? x : JSON.stringify(body)  
// message = `${timestamp}.${nonce}.${payload}`
// signature = HMAC-SHA256(message, SECRET).hex()
//
// Headers: x-signature, x-timestamp, x-nonce

const SECRET = 'AsithaApiSignatureKey2026!@#';

function sign(timestamp, nonce, payload) {
  const message = `${timestamp}.${nonce}.${payload}`;
  return createHmac('sha256', SECRET).update(message).digest('hex');
}

// Verify with sample 1
const nonce1 = '001fc3886e2d3555f94d2f1acc786ff2';
const ts1 = '1787391309577';
const body1 = '{"recaptcha_token":"P1_eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.haJwZACjZXhwzmqJbaencGFzc2tlecUGneNRXfBcMF1a-2qri07Q8n5woVvrhIoxbc2H111S-4Tgr4fyDuAJ2dLZAs1Cf4rFdWtiRatM16oZYwSDEw5ddM42wEiPTNFy_KQGy41LllC-P6rY-rZxH_zolYzta3Oo0v9huKz4-brrhiA8BwogNArQN5Z3FimP5qfly9aeYAf0Go7RqLo9IDfLTzgMChS7X9P5av5PysCaBwx0ubUL-iYtITVB2uAhycWvdex-P_5pVzoe19W1dbCElCcxr_pRruvTfCtv3QKjHh6mEJJ192qQAnu__-VbXa795mdRehKHmEhD7ZTkHeKUWlNzn5kMzzlhmuAl6aPkRdWgh_MDfNQySOjNptJvrC1tpjt-SlfmXkHLM811uUrU8VRIJ7sy87LQioS7h1Yo1s86uNlxYiWz';

// We need the full body from HAR — let's get it
const har = JSON.parse(readFileSync('test/asithatop.har', 'utf8'));
let fullBody1 = '';
let fullBody2 = '';
for (const e of har.log.entries) {
  const u = new URL(e.request.url);
  if (u.host !== 'back.asitha.top' || e.request.method !== 'POST') continue;
  if (u.pathname === '/api/user/get-temp-token' && !fullBody1) {
    fullBody1 = e.request.postData?.text || '';
  }
  if (u.pathname === '/api/channel/react-to-post' && !fullBody2) {
    fullBody2 = e.request.postData?.text || '';
  }
}

const expected1 = '4e169b8e1854c480fc28a7619a982747b7f20d375cb6cca02b3e2252e4126487';
const got1 = sign(ts1, nonce1, fullBody1);
console.log('Sample 1 verification:');
console.log('  expected:', expected1);
console.log('  got:     ', got1);
console.log('  MATCH:', got1 === expected1);
console.log();

// Sample 2
const nonce2 = '4a3c7cec75d8dbf8f5ccbb4214c2f113';
const ts2 = '1787391312004';
const expected2 = '9c881bc668234bd48ea4874d914ed633b0d50a7ee042f487e34cfeb678268606';
const got2 = sign(ts2, nonce2, fullBody2);
console.log('Sample 2 verification:');
console.log('  expected:', expected2);
console.log('  got:     ', got2);
console.log('  MATCH:', got2 === expected2);
console.log();

if (got1 === expected1 && got2 === expected2) {
  console.log('SIGNATURE ALGORITHM CONFIRMED!');
  console.log('  HMAC-SHA256( "${timestamp}.${nonce}.${body}", "AsithaApiSignatureKey2026!@#" )');
}
