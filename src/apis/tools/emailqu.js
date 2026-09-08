import { ok, fail } from '../../lib/respond.js';
import { inbox, randomUser, DOMAIN, EMAIL_RE, USER_RE, MailError } from '../../lib/emailqu.js';

/**
 * Temporary email — one endpoint, two modes.
 *
 *   no params            → random address on @bahlil.codes
 *   user=                → custom username on the same domain
 *   email=               → read that inbox, with the OTP and verification link
 *                          already extracted from each message
 *
 * The domain is fixed: emailqu lists thousands, but a caller who picked one by
 * hand usually got a domain that no longer routes mail, and the address failed
 * silently. Addresses are virtual upstream, so nothing has to be created or
 * stored — the address returned here is live the moment it's handed out.
 */
export default {
  name: 'Temp Email',
  desc: `Email sementara @${DOMAIN} + pembacaan OTP otomatis`,
  category: 'Temp Mail',
  path: '/v1/tools/emailqu',
  method: 'GET',
  ui: 'mail-steps',
  // Sub-path aliases (base URL keeps auto-detecting on params):
  //   /email      → hand out a fresh address
  //   /email/otp  → read the inbox (OTP + link lifted to top level)
  routes: [
    { suffix: 'email', mode: 'create' },
    { suffix: 'email/otp', mode: 'inbox' },
  ],
  params: [
    {
      name: 'email',
      required: false,
      placeholder: 'Cek inbox email ini (kosongkan untuk buat email baru)',
      desc: 'Alamat yang mau dibaca inbox-nya',
    },
    {
      name: 'user',
      required: false,
      placeholder: 'Username custom (opsional)',
      desc: `Domain selalu @${DOMAIN}`,
    },
    { name: 'limit', required: false, type: 'number', placeholder: 'Jumlah pesan (default 10)', default: 10 },
  ],

  async handler({ params, mode }) {
    try {
      if (mode === 'create') return await create(params);
      if (mode === 'inbox') return await read(params);
      return params.email ? await read(params) : await create(params);
    } catch (error) {
      if (error instanceof MailError) return fail(error.message, error.status);
      return fail(`Gagal menghubungi layanan email sementara: ${error.message}`, 502);
    }
  },
};

/** Mode 1 — hand out an address. */
async function create({ user }) {
  let username = String(user || '').trim().toLowerCase();

  if (username && !USER_RE.test(username)) {
    return fail('Username hanya boleh huruf/angka/titik/strip, panjang 3–30 karakter');
  }

  if (!username) username = await randomUser();

  const address = `${username}@${DOMAIN}`;

  return ok({
    email: address,
    type: user ? 'custom' : 'random',
    username,
    domain: DOMAIN,
    inbox_url: `/v1/tools/emailqu?email=${encodeURIComponent(address)}`,
    note: 'Alamat langsung aktif. Pakai untuk daftar, lalu cek inbox lewat inbox_url — OTP dan link verifikasi diambil otomatis.',
  });
}

/** Mode 2 — read an inbox. */
async function read({ email, limit }) {
  const address = String(email).trim().toLowerCase();
  if (!EMAIL_RE.test(address)) return fail('Format email tidak valid');

  const cap = Math.min(30, Math.max(1, Number(limit) || 10));
  const messages = await inbox(address, cap);
  const latest = messages.find((m) => m.otp || m.verification_link) || messages[0] || null;

  return ok({
    email: address,
    total: messages.length,
    // Promoted to the top level so a bot can read result.otp without walking the list.
    otp: latest?.otp || null,
    verification_link: latest?.verification_link || null,
    messages,
    note: messages.length
      ? 'OTP dan link verifikasi diambil dari pesan terbaru yang mengandungnya.'
      : 'Inbox masih kosong — tunggu beberapa detik lalu ulangi request ini.',
  });
}
