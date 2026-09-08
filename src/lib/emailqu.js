/**
 * Client for the emailqu.com temporary-mail service.
 *
 * The public API needs no auth and no "create mailbox" step: an address is
 * virtual, so mail sent to <anything>@<listed-domain> shows up under
 * /api/public/emails/<address>. That means a generated address can be handed
 * out immediately and polled later from a completely separate request.
 *
 * Message parsing (OTP, verification link) is shared with the other temp-mail
 * services in lib/mailparse.js — only the field names are normalised here.
 */

import { fetchJSON } from './http.js';
import { shape } from './mailparse.js';

const BASE = 'https://emailqu.com';

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const USER_RE = /^[a-z0-9]([a-z0-9._-]{1,28})[a-z0-9]$/i;

/**
 * The single domain every address is issued on.
 *
 * emailqu lists ~4600 domains, but most are unroutable or vanish without notice,
 * and a caller who picked one by hand got a dead address with no way to tell.
 * One verified domain is handed out instead, so an address always works.
 */
export const DOMAIN = 'bahlil.codes';

async function call(path) {
  const res = await fetchJSON(`${BASE}${path}`, {
    headers: { accept: 'application/json', referer: `${BASE}/` },
  });

  if (!res.ok || !res.data) {
    throw new MailError(`emailqu.com menolak permintaan (HTTP ${res.status})`, res.status);
  }
  return res.data;
}

/** Random username straight from the service, so it looks like a real handle. */
export async function randomUser() {
  try {
    const data = await call('/api/random-username');
    if (data.username) return String(data.username);
  } catch {
    // Fall through to a locally generated handle.
  }

  const words = ['swift', 'lunar', 'nova', 'pixel', 'delta', 'zephyr', 'orbit', 'ember', 'quartz', 'vivid'];
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  return `${pick(words)}${pick(words)}${Math.floor(Math.random() * 9000 + 1000)}`;
}

/** Messages for an address, newest first. */
export async function inbox(address, limit = 20) {
  const data = await call(`/api/public/emails/${encodeURIComponent(address)}?limit=${limit}`);
  const list = Array.isArray(data.emails) ? data.emails : [];

  return list
    .map((m) =>
      shape({
        id: m.id,
        from: m.from,
        subject: m.subject,
        received_at: m.received_at,
        read: m.read,
        text: m.body_text,
        html: m.body_html,
      })
    )
    .sort((a, b) => new Date(b.received_at || 0) - new Date(a.received_at || 0));
}

export class MailError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'MailError';
    this.status = status >= 400 && status < 500 ? status : 502;
  }
}
