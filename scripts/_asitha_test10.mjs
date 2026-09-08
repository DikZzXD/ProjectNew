import { readFileSync } from 'node:fs';

const jsRes = await fetch('https://asitha.top/assets/ChannelManager--WV9vAM6.js');
const jsText = await jsRes.text();

// Find the function that uses the nonce (c parameter = nonce)
// H = (t={}, r="POST", x="", c="") => { ... headers }
// z = async t => { ... } — likely the request function that calls security/init then makes the call

// Get more context around H and z
const hIdx = jsText.indexOf('H=(t={},r="POST"');
if (hIdx === -1) {
  // try alternate
  const h2 = jsText.indexOf('H=(t={}');
  console.log('H function at:', h2);
  if (h2 !== -1) console.log(jsText.slice(h2, h2 + 400));
} else {
  console.log('H function at:', hIdx);
  console.log(jsText.slice(hIdx, hIdx + 400));
}

console.log();

// Find z function
const zIdx = jsText.indexOf('z=async t=>{');
if (zIdx === -1) {
  const z2 = jsText.indexOf('z=async');
  console.log('z function at:', z2);
  if (z2 !== -1) console.log(jsText.slice(z2, z2 + 600));
} else {
  console.log('z function at:', zIdx);
  console.log(jsText.slice(zIdx, zIdx + 600));
}

// Also look for the captcha + temp token flow
console.log();
const tempIdx = jsText.indexOf('temp-token');
if (tempIdx !== -1) {
  console.log('=== temp-token context ===');
  console.log(jsText.slice(Math.max(0, tempIdx - 200), tempIdx + 400));
}

// Look for react-to-post
console.log();
const reactIdx = jsText.indexOf('react-to-post');
if (reactIdx !== -1) {
  console.log('=== react-to-post context ===');
  console.log(jsText.slice(Math.max(0, reactIdx - 200), reactIdx + 400));
}
