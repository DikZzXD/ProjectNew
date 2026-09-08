import { readFileSync } from 'node:fs';

const har = JSON.parse(readFileSync('test/asithatop.har', 'utf8'));

// Let's trace x_sec_session cookie more carefully
// security/init returns a nonce
// The cookie x_sec_session = nonce + "." + something
// Let's see what the something is

// From HAR:
// security/init (1st call): returns nonce "001fc3886e2d3555f94d2f1acc786ff2"
// Then get-temp-token uses cookie: x_sec_session=001fc3886e2d3555f94d2f1acc786ff2.2253e085a495565f8bff43149e88abf97d9e99e4d3f310a
//
// security/init (2nd call): returns nonce "4a3c7cec75d8dbf8f5ccbb4214c2f113"
// Then react-to-post uses cookie: x_sec_session=4a3c7cec75d8dbf8f5ccbb4214c2f113.ed164529d97251dd40cbb2f0081e512f8ebb68d05774bdc

// The second part seems to be set from the client too. Let's look at the JS source
// for how x_sec_session is constructed.

const jsRes = await fetch('https://asitha.top/assets/ChannelManager--WV9vAM6.js');
const jsText = await jsRes.text();

// Find x_sec_session related code
const snippets = [];
let idx = 0;
while (true) {
  idx = jsText.indexOf('sec_session', idx);
  if (idx === -1) break;
  snippets.push(jsText.slice(Math.max(0, idx - 100), idx + 200));
  idx += 10;
}
console.log('x_sec_session references:', snippets.length);
for (const s of snippets) {
  console.log('---');
  console.log(s.trim().replace(/\n/g, ' '));
}

// Also search for "security" or "init" related logic
console.log();
const initIdx = jsText.indexOf('security/init');
if (initIdx !== -1) {
  console.log('=== security/init context ===');
  console.log(jsText.slice(Math.max(0, initIdx - 200), initIdx + 300).replace(/\n/g, ' '));
}
