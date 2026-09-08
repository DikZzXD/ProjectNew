/**
 * Client for the getedumail.com temporary .edu mail service.
 *
 * Unlike emailqu, an address here has to be *claimed* first: POST /guest
 * registers it and returns an expiry (~2 hours), and only then does /list answer.
 * So the flow is availability → claim → poll, and a claimed address is readable
 * from any later request because the claim lives upstream, not in this Worker.
 *
 * The upstream answers 429 "Too many requests" to every write unless the request
 * carries the site's own `x-powered-by: EXPRE55` header — verified against the
 * live API: identical requests with and without it return 201 and 429. It is a
 * fixed string the site sends on every call, not a credential.
 */

import { fetchJSON } from './http.js';
import { shape } from './mailparse.js';

const BASE = 'https://api.getedumail.com/getedumail/emails-v2';

/** The only two domains the service hosts. */
export const DOMAINS = ['iunp.edu.rs', 'warsawuni.edu.pl'];

export const USER_RE = /^[a-z0-9]([a-z0-9._-]{1,28})[a-z0-9]$/i;
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const HEADERS = {
  accept: 'application/json, text/plain, */*',
  'x-powered-by': 'EXPRE55',
  origin: 'https://getedumail.com',
  referer: 'https://getedumail.com/',
};

async function call(path, options = {}) {
  const res = await fetchJSON(`${BASE}${path}`, {
    ...options,
    headers: { ...HEADERS, ...(options.headers || {}) },
  });

  // fetchJSON reports ok:false when the body isn't JSON, and DELETE answers 204
  // with an empty body — so the HTTP status decides, not the parse result.
  const httpOk = res.status >= 200 && res.status < 300;
  if (!httpOk) {
    const message = res.data?.error || res.data?.message || `HTTP ${res.status}`;
    throw new EduError(`getedumail.com: ${message}`, res.status);
  }
  return res.data;
}

/** Is the address free to claim? */
export async function availability(email) {
  const data = await call(`/availability?email=${encodeURIComponent(email)}`);
  return {
    available: Boolean(data.isMailAvailable),
    alreadyCreated: Boolean(data.isMailAlreadyCreated),
  };
}

/** Claim the address. Returns the mailbox id + expiry. */
export async function claim(email) {
  const data = await call('/guest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });

  return {
    id: data.id,
    email: data.email,
    domain: data.domain,
    username: data.username,
    expires_at: data.expiresAt || null,
  };
}

/**
 * Inbox listing. Every message already carries its full body here, so a second
 * per-message fetch is unnecessary — the OTP is available straight from the list.
 */
export async function inbox(email, page = 1) {
  const data = await call(`/${encodeURIComponent(email)}/list?page=${page}`);
  const list = Array.isArray(data.emails) ? data.emails : [];

  return {
    total: Number(data.total) || list.length,
    messages: list
      .map((m) =>
        shape({
          id: m.uid,
          from: address(m.from),
          subject: m.subject,
          received_at: m.date,
          read: false,
          text: m.body?.text,
          html: m.body?.html,
        })
      )
      .sort((a, b) => new Date(b.received_at || 0) - new Date(a.received_at || 0)),
  };
}

/** One message by its uid, when the list preview was truncated. */
export async function message(email, uid) {
  const data = await call(`/${encodeURIComponent(email)}/email/${encodeURIComponent(uid)}`);
  const env = data.envelope || {};

  return shape({
    id: data.uid ?? uid,
    from: address(env.from),
    subject: env.subject,
    received_at: env.date,
    read: false,
    text: data.body?.text,
    html: data.body?.html,
  });
}

/** Release a claimed mailbox by its id. */
export async function release(id) {
  await call(`/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return true;
}

/** from/to arrive as [{ name, address }]; flatten to a display string. */
function address(list) {
  const first = Array.isArray(list) ? list[0] : list;
  if (!first) return '—';
  return first.name ? `${first.name} <${first.address}>` : first.address || '—';
}

export class EduError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'EduError';
    this.status = status >= 400 && status < 500 ? status : 502;
  }
}
