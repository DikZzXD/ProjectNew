import { ok, fail } from '../../lib/respond.js';
import { availability, claim, inbox, message, DOMAINS, USER_RE, EMAIL_RE, EduError } from '../../lib/getedumail.js';

/**
 * Mail Edu — temporary .edu addresses, one endpoint.
 *
 *   no params        → random address, claimed and ready
 *   user= / domain=  → custom address on one of the two supported domains
 *   email=           → read that inbox, OTP and verification link extracted
 *   email= & uid=    → one full message
 *
 * A .edu address is what student-discount and university sign-ups check for, and
 * the OTP parser is the same one the other temp-mail endpoints use, so any
 * verification code — sign-in link, numeric OTP, alphanumeric token — comes back
 * lifted to the top level.
 */
export default {
  name: 'Mail Edu',
  desc: 'Email .edu sementara — inbox + OTP otomatis',
  category: 'Temp Mail',
  path: '/v1/tools/mailedu',
  method: 'GET',
  ui: 'mail-steps',
  // Sub-path aliases (base URL keeps auto-detecting on params):
  //   /email          → claim a fresh address
  //   /email/otp      → read the inbox (OTP + link lifted to top level)
  //   /email/message  → one full message (needs uid)
  routes: [
    { suffix: 'email', mode: 'create' },
    { suffix: 'email/otp', mode: 'inbox' },
    { suffix: 'email/message', mode: 'message' },
  ],
  params: [
    {
      name: 'email',
      required: false,
      placeholder: 'Cek inbox email ini (kosongkan untuk buat email baru)',
      desc: 'Alamat .edu yang mau dibaca inbox-nya',
    },
    { name: 'user', required: false, placeholder: 'Username custom (opsional)' },
    {
      name: 'domain',
      required: false,
      placeholder: DOMAINS.join(' | '),
      desc: `Hanya ${DOMAINS.join(' dan ')}`,
    },
    { name: 'uid', required: false, type: 'number', placeholder: 'Buka satu pesan (opsional)' },
  ],

  async handler({ params, mode }) {
    try {
      // Sub-path modes are explicit; the base URL still auto-detects on params.
      if (mode === 'create') return await create(params);
      if (mode === 'message') return await one(params);
      if (mode === 'inbox') return await read(params);
      if (params.email) return params.uid ? await one(params) : await read(params);
      return await create(params);
    } catch (error) {
      if (error instanceof EduError) return fail(error.message, error.status);
      return fail(`Gagal menghubungi layanan Mail Edu: ${error.message}`, 502);
    }
  },
};

/** Mode 1 — claim an address. */
async function create({ user, domain }) {
  let username = String(user || '').trim().toLowerCase();
  const host = String(domain || '').trim().toLowerCase().replace(/^@/, '');

  if (username && !USER_RE.test(username)) {
    return fail('Username hanya boleh huruf/angka/titik/strip, panjang 3–30 karakter');
  }

  if (host && !DOMAINS.includes(host)) {
    return fail(`Domain "${host}" tidak tersedia. Pilihan: ${DOMAINS.join(', ')}`);
  }

  const pickedDomain = host || DOMAINS[Math.floor(Math.random() * DOMAINS.length)];
  if (!username) username = randomUser();

  const wanted = `${username}@${pickedDomain}`;

  // The address has to be claimed before the inbox exists, so a name that's
  // already taken must fail here rather than hand back an inbox someone else reads.
  const free = await availability(wanted);
  if (!free.available || free.alreadyCreated) {
    return fail(`Alamat "${wanted}" sudah dipakai. Ganti username atau kosongkan untuk random`, 409);
  }

  const box = await claim(wanted);

  return ok({
    email: box.email,
    type: user || domain ? 'custom' : 'random',
    username: box.username,
    domain: box.domain,
    expires_at: box.expires_at,
    inbox_url: `/v1/tools/mailedu?email=${encodeURIComponent(box.email)}`,
    note: 'Alamat aktif sampai expires_at. Pakai untuk daftar, lalu cek inbox lewat inbox_url — OTP dan link verifikasi diambil otomatis.',
  });
}

/** Mode 2 — read the inbox. */
async function read({ email }) {
  const address = normalise(email);
  if (!address) return fail(`Format email tidak valid. Domain harus ${DOMAINS.join(' atau ')}`);

  const { total, messages } = await inbox(address);
  const latest = messages.find((m) => m.otp || m.verification_link) || messages[0] || null;

  return ok({
    email: address,
    total,
    // Promoted to the top level so a bot can read result.otp without walking the list.
    otp: latest?.otp || null,
    verification_link: latest?.verification_link || null,
    messages,
    note: messages.length
      ? 'OTP dan link verifikasi diambil dari pesan terbaru yang mengandungnya.'
      : 'Inbox masih kosong — tunggu beberapa detik lalu ulangi request ini.',
  });
}

/** Mode 3 — one message in full. */
async function one({ email, uid }) {
  const address = normalise(email);
  if (!address) return fail(`Format email tidak valid. Domain harus ${DOMAINS.join(' atau ')}`);

  const found = await message(address, uid);
  return ok({ email: address, uid: Number(uid), message: found });
}

/** Lowercase, and reject anything outside the two supported domains. */
function normalise(email) {
  const address = String(email).trim().toLowerCase();
  if (!EMAIL_RE.test(address)) return null;
  return DOMAINS.some((d) => address.endsWith(`@${d}`)) ? address : null;
}

function randomUser() {
  const first = ['adam', 'brian', 'clara', 'derek', 'elena', 'felix', 'gina', 'hugo', 'irene', 'jonas'];
  const last = ['walker', 'bennet', 'cortez', 'dawson', 'ellis', 'fisher', 'grant', 'hayes', 'ibarra', 'jensen'];
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  return `${pick(first)}.${pick(last)}${Math.floor(Math.random() * 900 + 100)}`;
}
