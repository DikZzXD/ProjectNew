/**
 * End-to-end test: mint hCaptcha PoW locally → get temp token → react-to-post.
 *
 * Uses the already-downloaded test/_hc/hsw.js (from assets.hcaptcha.com).
 * The hsw.js file is hCaptcha's proof-of-work script that runs in browsers.
 */
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { JSDOM } from 'jsdom';

const SECRET = 'AsithaApiSignatureKey2026!@#';
const API = 'https://back.asitha.top/api';
const SITEKEY = '3acc5934-433c-46a8-82ba-51c03050c64a';
const HOST = 'asitha.top';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

// Extract bearer token from HAR
const har = JSON.parse(readFileSync('test/asithatop.har', 'utf8'));
let bearerToken = '';
for (const e of har.log.entries) {
  const u = new URL(e.request.url);
  if (u.host === 'back.asitha.top' && u.pathname === '/api/auth/user') {
    const auth = e.request.headers.find(h => h.name.toLowerCase() === 'authorization');
    if (auth) { bearerToken = auth.value.replace('Bearer ', ''); break; }
  }
}
console.log('[auth] bearer token length:', bearerToken.length);

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

// Step 1: Get hCaptcha challenge config
console.log('[step1] checksiteconfig...');
const cfgUrl = `https://api.hcaptcha.com/checksiteconfig?v=1&host=${HOST}&sitekey=${SITEKEY}&sc=1&swa=1`;
const cfg = await (await fetch(cfgUrl, { headers: { 'user-agent': UA } })).json();
console.log('[step1] pass=%s type=%s', cfg.pass, cfg.c?.type);
const req = cfg.c.req;

// Step 2: Run PoW (hsw.js already on disk)
console.log('[step2] running hsw PoW...');
const hswCode = readFileSync('test/_hc/hsw.js', 'utf8');
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: `https://newassets.hcaptcha.com/captcha/v1/${SITEKEY}`,
  referrer: `https://${HOST}/`,
  userAgent: UA,
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;
window.WebAssembly = WebAssembly;
window.TextEncoder = TextEncoder;
window.TextDecoder = TextDecoder;
if (!window.crypto?.subtle) {
  Object.defineProperty(window, 'crypto', { value: globalThis.crypto, configurable: true });
}
if (!window.navigator.hardwareConcurrency)
  Object.defineProperty(window.navigator, 'hardwareConcurrency', { value: 8 });

const t0 = Date.now();
window.eval(hswCode);
console.log('[step2] eval ok, typeof hsw =', typeof window.hsw);

const proof = await window.hsw(req, SITEKEY);
console.log('[step2] proof minted in %dms, length=%d', Date.now() - t0, String(proof||'').length);
console.log('[step2] proof prefix:', String(proof).slice(0, 60));

if (!proof || proof.length < 20) {
  console.log('FAIL: no valid proof generated');
  process.exit(1);
}

// Step 3: getcaptcha (submit PoW, get hCaptcha token P1_...)
console.log('[step3] submitting to hcaptcha getcaptcha...');
const gcBody = new URLSearchParams({
  v: '1',
  sitekey: SITEKEY,
  host: HOST,
  hl: 'en',
  motionData: JSON.stringify({st:Date.now(),mm:[],md:[],mu:[],sc:{},ts:Date.now()}),
  n: proof,
  c: JSON.stringify(cfg.c),
});
const gcRes = await fetch('https://api.hcaptcha.com/getcaptcha/' + SITEKEY, {
  method: 'POST',
  headers: {
    'content-type': 'application/x-www-form-urlencoded',
    'user-agent': UA,
    origin: 'https://newassets.hcaptcha.com',
    referer: 'https://newassets.hcaptcha.com/',
  },
  body: gcBody.toString(),
});
const gcData = await gcRes.json().catch(() => null);
console.log('[step3] HTTP %d', gcRes.status);
console.log('[step3] keys:', Object.keys(gcData || {}));

// Check if we got a pass-through token (pass:true means no challenge needed)
let hcaptchaToken = gcData?.generated_pass_UUID || '';
if (!hcaptchaToken && gcData?.pass) hcaptchaToken = gcData?.pass;

if (!hcaptchaToken) {
  console.log('[step3] response:', JSON.stringify(gcData).slice(0, 400));
  console.log('FAIL: no token from getcaptcha — may need challenge solving');
  process.exit(1);
}
console.log('[step3] hCaptcha token length:', hcaptchaToken.length);
console.log('[step3] token prefix:', hcaptchaToken.slice(0, 40));
