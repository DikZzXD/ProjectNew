/**
 * hCaptcha HSW proof-of-work runner (test harness).
 *
 * Runs hCaptcha's own `hsw.js` inside jsdom and calls the `window.hsw(req, sitekey)`
 * entry point it exports. If this works we can mint the `n` proof locally — no paid
 * solver needed for the proof-of-work half of the flow.
 */

import { JSDOM } from 'jsdom';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const SITEKEY = '3acc5934-433c-46a8-82ba-51c03050c64a';
const HOST = 'asitha.top';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

mkdirSync('test/_hc', { recursive: true });

const log = (...a) => console.log(...a);

// ── 1. site config → challenge JWT ────────────────────────────────
const cfgUrl = `https://api.hcaptcha.com/checksiteconfig?v=1&host=${HOST}&sitekey=${SITEKEY}&sc=1&swa=1`;
const cfg = await (await fetch(cfgUrl, { headers: { 'user-agent': UA } })).json();
log('[cfg] pass=%s type=%s features=%j', cfg.pass, cfg.c?.type, cfg.features);

const req = cfg.c.req;
const payload = JSON.parse(Buffer.from(req.split('.')[1], 'base64url').toString());
log('[cfg] label=%s n=%s c=%s', payload.l, payload.n, payload.c);

// ── 2. fetch the matching hsw.js for this label ───────────────────
const hswUrl = `https://assets.hcaptcha.com${payload.l}/hsw.js`;
let hsw;
try {
  hsw = readFileSync('test/_hc/hsw.js', 'utf8');
  if (!hsw.includes('window.hsw')) throw new Error('stale');
  log('[hsw] using cached test/_hc/hsw.js (%d bytes)', hsw.length);
} catch {
  const res = await fetch(hswUrl, { headers: { 'user-agent': UA, referer: 'https://newassets.hcaptcha.com/' } });
  hsw = await res.text();
  writeFileSync('test/_hc/hsw.js', hsw);
  log('[hsw] downloaded %s → %d bytes', hswUrl, hsw.length);
}

// ── 3. run it in a browser-ish DOM ────────────────────────────────
const dom = new JSDOM(
  '<!doctype html><html><head></head><body><div class="h-captcha"></div></body></html>',
  {
    url: `https://newassets.hcaptcha.com/captcha/v1/hsw/${SITEKEY}`,
    referrer: `https://${HOST}/`,
    userAgent: UA,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  }
);

const { window } = dom;

// jsdom lacks a few APIs the worker touches; stub the cheap ones.
if (!window.crypto?.subtle) {
  window.crypto = globalThis.crypto;
}
window.WebAssembly = WebAssembly;
window.TextEncoder = TextEncoder;
window.TextDecoder = TextDecoder;
window.performance = window.performance || performance;
if (!window.navigator.hardwareConcurrency) {
  Object.defineProperty(window.navigator, 'hardwareConcurrency', { value: 8, configurable: true });
}

const started = Date.now();
try {
  window.eval(hsw);
} catch (error) {
  log('[hsw] eval threw: %s', error?.message);
  log(error?.stack?.split('\n').slice(0, 6).join('\n'));
  process.exit(1);
}

log('[hsw] eval ok in %dms — typeof window.hsw = %s', Date.now() - started, typeof window.hsw);

if (typeof window.hsw !== 'function') {
  log('[hsw] no entry point exported — keys added:', Object.keys(window).filter((k) => /hsw|hcap/i.test(k)));
  process.exit(1);
}

// ── 4. mint the proof ─────────────────────────────────────────────
const t0 = Date.now();
let proof;
try {
  proof = await window.hsw(req, SITEKEY);
} catch (error) {
  log('[hsw] hsw() threw: %s', error?.message);
  log(error?.stack?.split('\n').slice(0, 8).join('\n'));
  process.exit(1);
}

log('[hsw] proof in %dms, %d chars', Date.now() - t0, String(proof || '').length);
log('[hsw] proof = %s', String(proof).slice(0, 120) + (String(proof).length > 120 ? '…' : ''));

writeFileSync(
  'test/_hc/proof.json',
  JSON.stringify({ sitekey: SITEKEY, host: HOST, req, proof, at: Date.now() }, null, 2)
);
log('[hsw] saved test/_hc/proof.json');
