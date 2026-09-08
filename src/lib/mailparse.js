/**
 * Message parsing shared by every temp-mail service.
 *
 * The transports differ (emailqu hands back `body_html`, getedumail nests it
 * under `body.html`), but the job is identical: turn a raw message into the one
 * thing a caller actually wants — the OTP or the verification link. So the
 * parsing lives here and each transport normalises its own field names first.
 */

const KEYWORDS =
  /(otp|kode|code|pin|token|password|passcode|verification|verifikasi|security|konfirmasi|confirm)/i;

export const ACTION_RE =
  /(verify|verification|confirm|activate|activation|signin|sign-in|login|auth|reset|magic|invite|__\/auth)/i;

/** Strip tags so the text scan works on HTML-only mail too. */
export function plain({ text, html }) {
  if (text) return unqp(text);
  return unqp(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Undo quoted-printable encoding.
 *
 * Mail wraps long lines with a trailing "=" soft break and escapes bytes as
 * "=XX", which is how a firebase sign-in link arrives split across three lines
 * with every "=" written as "=3D". Decoding has to happen before anything is
 * scanned: in raw form the markup reads `href=3D'…'`, so an href match never
 * fires and the link is lost entirely.
 *
 * Only bodies that actually look encoded are touched, so a plain body that
 * happens to contain "=41" is left as the author wrote it.
 */
export function unqp(body) {
  const raw = String(body || '');

  // Gate on the two markers that only appear in encoded bodies: a soft line
  // break, or "=3D" for a literal '='. Matching bare "=XX" instead would eat
  // ordinary markup — `width=100` would decode "=10" into a control character.
  if (!/=\r?\n/.test(raw) && !/=3D/i.test(raw)) return raw;

  // Inside an encoded body every '=' is escaped, so any remaining "=XX" is data.
  return raw.replace(/=\r?\n/g, '').replace(/(?:=[0-9a-f]{2})+/gi, (run) => {
    // Decoded as one run, not byte by byte, or "=E2=80=99" turns into mojibake.
    const bytes = Uint8Array.from(run.match(/[0-9a-f]{2}/gi).map((hex) => parseInt(hex, 16)));
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  });
}

/**
 * Pull out a one-time code.
 *
 * Candidates near an OTP-ish keyword win; a bare code standing alone on its own
 * line is the fallback. Anything that looks like a year or a formatted number is
 * dropped, since "2026" and "1,250" show up in plenty of legitimate mail.
 */
export function extractCode(text, subject = '') {
  const haystack = `${subject}\n${text}`;
  const scored = [];

  const patterns = [
    /\b(\d{4,8})\b/g,
    /\b([A-Z0-9]{4,8})\b/g,
    /\b([A-Z0-9]{3,4}-[A-Z0-9]{3,4})\b/g,
  ];

  for (const re of patterns) {
    for (const m of haystack.matchAll(re)) {
      const value = m[1];
      if (/^\d+$/.test(value)) {
        const n = Number(value);
        if (value.length === 4 && n > 1900 && n < 2100) continue;   // a year
        if (/[.,]\d*$/.test(haystack.slice(m.index + value.length, m.index + value.length + 2))) continue;
      } else if (!/\d/.test(value)) {
        continue;                                                    // plain word
      }

      const around = haystack.slice(Math.max(0, m.index - 70), m.index + value.length + 40);
      const alone = /(^|\n)\s*$/.test(haystack.slice(Math.max(0, m.index - 12), m.index));
      const score = (KEYWORDS.test(around) ? 2 : 0) + (alone ? 1 : 0);

      if (score > 0) scored.push({ value, score });
    }
  }

  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score || b.value.length - a.value.length);
  return scored[0].value;
}

/** Links in the message, action links (verify / sign-in / reset) first. */
export function extractLinks({ text, html }) {
  const found = new Set();
  // Decoded first: raw quoted-printable markup reads href=3D'…', which no href
  // pattern matches, so the only real link in the mail would be missed.
  const markup = unqp(html);

  for (const m of markup.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    found.add(m[1]);
  }
  for (const m of plain({ text, html }).matchAll(/https?:\/\/[^\s<>"')]+/g)) {
    found.add(m[0]);
  }

  const links = [...found]
    .map((l) => l.replace(/&amp;/g, '&').trim())
    .filter((l) => /^https?:\/\//i.test(l) && !/unsubscribe|\.(png|jpe?g|gif|svg|css)$/i.test(l));

  // Action links first, longest first inside each group (they carry the token).
  return links.sort((a, b) => {
    const rank = Number(ACTION_RE.test(b)) - Number(ACTION_RE.test(a));
    return rank || b.length - a.length;
  });
}

/**
 * Build the message shape every temp-mail endpoint returns.
 * `raw` is already normalised to { id, from, subject, received_at, read, text, html }.
 */
export function shape(raw) {
  const text = plain(raw);
  const links = extractLinks(raw);

  return {
    id: raw.id ?? null,
    from: raw.from || '—',
    subject: raw.subject || '(tanpa subjek)',
    received_at: raw.received_at || null,
    read: Boolean(raw.read),
    otp: extractCode(text, raw.subject || ''),
    verification_link: links.find((l) => ACTION_RE.test(l)) || null,
    links: links.slice(0, 5),
    text: text.length > 1200 ? `${text.slice(0, 1200)}…` : text,
  };
}
