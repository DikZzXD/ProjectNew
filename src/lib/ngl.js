/**
 * Client for the NGL relay used by the Ngl Spam endpoint.
 *
 * Two routes, both plain JSON POSTs:
 *   /api/validate  { username }                      → { valid }
 *   /api/send      { username, message, gameSlug }   → { success, questionId }
 *
 * The relay carries no auth and rate-limits per username upstream, so the only
 * thing this module adds is validation, a hard ceiling, and batching.
 */

import { fetchJSON } from './http.js';

const BASE = 'https://dikzxd-ngl.netlify.app';
const TIMEOUT_MS = 20000;

const HEADERS = {
  'content-type': 'application/json',
  accept: '*/*',
  origin: BASE,
  referer: `${BASE}/`,
};

/**
 * The Worker's subrequest budget is what caps this, not the relay: every send is
 * one outbound fetch, and a Worker gets 50 per request. 40 leaves room for the
 * validate call plus the stats write.
 */
export const MAX_TOTAL = 40;
export const DEFAULT_TOTAL = 10;

/** Sends run in small waves — enough to be fast, not enough to get throttled. */
export const BATCH = 5;

export const USER_RE = /^[a-z0-9._]{3,30}$/i;

/** Which NGL prompt the message is filed under. */
export const SLUGS = ['confessions', 'nice', 'shipme', '3words', 'tbh', 'dare'];

async function post(path, body) {
  const res = await fetchJSON(
    `${BASE}${path}`,
    { method: 'POST', headers: HEADERS, body: JSON.stringify(body) },
    TIMEOUT_MS
  );

  if (!res.ok || !res.data) {
    throw new NglError(`Relay NGL menolak permintaan (HTTP ${res.status})`, res.status);
  }
  return res.data;
}

/** Does the NGL username exist? */
export async function validate(username) {
  const data = await post('/api/validate', { username });
  return Boolean(data.valid);
}

/** Send one message. Returns the upstream question id when it lands. */
export async function send(username, message, gameSlug) {
  const data = await post('/api/send', { username, message, gameSlug });
  if (!data.success) throw new NglError(data.message || data.error || 'Pesan ditolak relay', 502);
  return data.questionId || null;
}

export class NglError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'NglError';
    this.status = status >= 400 && status < 500 ? status : 502;
  }
}
