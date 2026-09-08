/**
 * Shared client for api.ikyyxd.my.id.
 *
 * Handlers get the payload only — upstream `creator` / `runtime` never leak.
 * The fixed apikey stays server-side and is never exposed in docs or responses.
 */

import { fetchJSON, fetchWithTimeout, qs } from './http.js';

const BASE = 'https://api.ikyyxd.my.id';

/** Hidden upstream key — never put this in endpoint params or docs. */
export const APIKEY = 'kyzz';

/** Image / canvas generation is slow. */
export const IMAGE_TIMEOUT = 90000;
export const DOWNLOAD_TIMEOUT = 90000;

/**
 * GET a JSON route and hand back the payload alone.
 *
 * Most routes carry it under `result`, but a few use `data` — pass `key: 'data'`
 * for those. The upstream reports failure as { status: false, message }.
 */
export async function json(path, timeoutMs = 20000, key = 'result') {
  const body = await fetchBody(path, timeoutMs);
  if (body.status === false) {
    throw new ProxyError(body.message || body.error || 'Upstream gagal', 502);
  }
  if (!body[key]) {
    throw new ProxyError(body.message || body.error || `Payload "${key}" kosong`, 502);
  }
  return body[key];
}

/**
 * GET JSON and return a cleaned object: drop status/creator/runtime/apikey noise.
 * If `key` is set, return only that field; otherwise return the rest of the body.
 */
export async function payload(path, { timeoutMs = 30000, key } = {}) {
  const body = await fetchBody(path, timeoutMs);
  if (body.status === false) {
    const message = body.message || body.error || 'Upstream gagal';
    throw new ProxyError(message, 400);
  }
  if (key) {
    if (body[key] === undefined || body[key] === null) {
      throw new ProxyError(body.message || body.error || `Payload "${key}" kosong`, 502);
    }
    return body[key];
  }
  return stripMeta(body);
}

/** Drop upstream branding / transport noise before re-wrapping. */
export function stripMeta(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const out = { ...body };
  delete out.status;
  delete out.creator;
  delete out.runtime;
  delete out.apikey;
  delete out.apiKey;
  return out;
}

async function fetchBody(path, timeoutMs) {
  let res;
  try {
    res = await fetchJSON(`${BASE}${path}`, { headers: { accept: 'application/json' } }, timeoutMs);
  } catch (error) {
    throw new ProxyError(reason(error, timeoutMs), 502);
  }
  if (!res.data) {
    throw new ProxyError(res.text ? String(res.text).slice(0, 200) : `HTTP ${res.status}`, 502);
  }
  if (!res.ok && res.data.status !== true) {
    const message = res.data.message || res.data.error || `HTTP ${res.status}`;
    throw new ProxyError(message, res.status >= 400 && res.status < 500 ? res.status : 502);
  }
  return res.data;
}

/**
 * GET a route that answers with the picture itself.
 */
export async function image(path, timeoutMs = IMAGE_TIMEOUT) {
  return media(path, timeoutMs, /^image\//i);
}

/**
 * GET image or video bytes (brat / bratvid / downloads that stream media).
 */
export async function media(path, timeoutMs = IMAGE_TIMEOUT, typeRe = /^(image|video)\//i) {
  let res;
  try {
    res = await fetchWithTimeout(
      `${BASE}${path}`,
      { headers: { accept: 'image/*,video/*,application/json' } },
      timeoutMs
    );
  } catch (error) {
    throw new ProxyError(reason(error, timeoutMs), 502);
  }

  const type = (res.headers.get('content-type') || '').split(';')[0].trim();

  if (!res.ok || !typeRe.test(type)) {
    const text = await res.text().catch(() => '');
    let message = `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(text);
      message = parsed.message || parsed.error || message;
    } catch {
      /* not JSON */
    }
    throw new ProxyError(message, res.status >= 400 && res.status < 500 ? res.status : 502);
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.length) throw new ProxyError('Upstream mengirim media kosong', 502);
  return { bytes, type };
}

/**
 * Flexible proxy for downloaders: JSON envelope OR raw media / octet-stream.
 * Returns { kind:'json', data } or { kind:'binary', bytes, type }.
 */
export async function flexible(path, timeoutMs = DOWNLOAD_TIMEOUT) {
  let res;
  try {
    res = await fetchWithTimeout(
      `${BASE}${path}`,
      { headers: { accept: 'application/json,image/*,video/*,audio/*,*/*' } },
      timeoutMs
    );
  } catch (error) {
    throw new ProxyError(reason(error, timeoutMs), 502);
  }

  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const binary = /^(image|video|audio)\//.test(type) || type === 'application/octet-stream';

  if (binary && res.ok) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.length) throw new ProxyError('Upstream mengirim file kosong', 502);
    return { kind: 'binary', bytes, type: type || 'application/octet-stream' };
  }

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    if (!res.ok) throw new ProxyError(`HTTP ${res.status}`, 502);
    throw new ProxyError('Upstream mengirim response yang tidak dikenali', 502);
  }

  if (!res.ok || body.status === false) {
    const message = body.message || body.error || `HTTP ${res.status}`;
    throw new ProxyError(message, res.status >= 400 && res.status < 500 ? res.status : 502);
  }

  return { kind: 'json', data: stripMeta(body) };
}

/** Build an upstream path and always inject the hidden apikey when needed. */
export function withKey(path, params = {}) {
  const q = qs({ apikey: APIKEY, ...params });
  return q ? `${path}?${q}` : path;
}

function reason(error, timeoutMs) {
  const timedOut = error?.name === 'AbortError' || /abort/i.test(error?.message || '');
  return timedOut
    ? `Upstream tidak merespons dalam ${Math.round(timeoutMs / 1000)} detik — coba lagi`
    : `Gagal menghubungi upstream: ${error.message}`;
}

export class ProxyError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'ProxyError';
    this.status = status;
  }
}
