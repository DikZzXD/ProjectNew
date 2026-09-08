import { ok, fail } from '../../lib/respond.js';
import { sendCode, signIn, checkPassword, checkConnection } from '../../lib/ubotlogin.js';
import { getAccount, StoreError } from '../../lib/ubotstore.js';
import { UbotError, normalisePhone, DEFAULT_API_ID, DEFAULT_API_HASH } from '../../lib/ubot.js';

/**
 * Ubot Login — pasang sender >> OTP >> PIN 2FA (kalau ada) >> tersambung.
 *
 * One endpoint for all userbot features mirroring test/userbot.py:
 *   (base) / /sender    phone            → kirim OTP, balas login_token
 *   /otp                login_token+code → tersambung, atau minta PIN 2FA
 *   /password           login_token+password → tersambung
 *   /status             account_token    → status tersambung & sinkronisasi userbot
 *
 * Userbot commands supported on Telegram (mirrors test/userbot.py with blockquote formatting):
 *   .help, .ping, .id, .promosi <teks>, .addbl, .delbl, .listbl, .setdelay, .stop
 */
export default {
  name: 'Ubot Login',
  desc: 'Userbot Telegram: sender → OTP → PIN 2FA → aktif (.help, .promosi, dll)',
  category: 'Tools',
  path: '/v1/tools/ubot-login',
  method: 'POST',
  ui: 'ubot-login',
  example: 'phone=+628123456789 → otp → userbot aktif (.help, .promosi)',
  routes: [
    { suffix: 'sender', mode: 'sender' },
    { suffix: 'otp', mode: 'otp' },
    { suffix: 'password', mode: 'password' },
    { suffix: 'status', mode: 'status' },
  ],
  params: [
    {
      name: 'phone',
      required: false,
      placeholder: '+628123456789',
      desc: 'Langkah 1 — nomor Telegram yang dijadikan userbot (format +62...)',
    },
    {
      name: 'login_token',
      required: false,
      placeholder: 'Token dari langkah sebelumnya',
      desc: 'Langkah 2 & 3 — token sesi login dari respons sebelumnya',
    },
    {
      name: 'code',
      required: false,
      placeholder: '12345',
      desc: 'Langkah 2 — kode OTP dari aplikasi Telegram',
    },
    {
      name: 'password',
      required: false,
      placeholder: 'PIN / password 2FA',
      desc: 'Langkah 3 — hanya jika akun Telegram menggunakan Two-Step Verification',
    },
    {
      name: 'account_token',
      required: false,
      placeholder: 'Token akun dari hasil login',
      desc: 'Langkah 4 — cek status koneksi userbot',
    },
    {
      name: 'api_id',
      required: false,
      placeholder: `${DEFAULT_API_ID} (default)`,
      desc: `Opsional — default terpasang (${DEFAULT_API_ID})`,
    },
    {
      name: 'api_hash',
      required: false,
      placeholder: `${DEFAULT_API_HASH} (default)`,
      desc: 'Opsional — default terpasang',
    },
  ],

  async handler({ params, mode, env, ctx }) {
    // Sub-path mode wins; base URL infers step from provided params
    const step = mode || detect(params);

    try {
      if (step === 'status') return ok(await status(env, params, ctx));
      if (step === 'password') return ok(await checkPassword(env, params));
      if (step === 'otp') return ok(await signIn(env, params));

      if (!params.phone) {
        return fail('Parameter "phone" wajib diisi untuk langkah pertama — nomor Telegram yang mau dipakai', 400);
      }
      return ok(await sendCode(env, params));
    } catch (error) {
      if (error instanceof UbotError || error instanceof StoreError) {
        return fail(error.message, error.status);
      }
      return fail('Layanan userbot sedang tidak bisa dipakai. Coba lagi beberapa saat lagi.', 503);
    }
  },
};

function detect(params) {
  if (params.account_token) return 'status';
  if (params.login_token && params.password) return 'password';
  if (params.login_token && params.code) return 'otp';
  return 'sender';
}

/** Langkah 4 — cek koneksi & sinkronisasi userbot */
async function status(env, params, ctx) {
  const account = await getAccount(env, params.account_token, { touch: true });
  const probe = await checkConnection(env, account, ctx);

  return {
    step: probe.connected ? 'connected' : 'disconnected',
    status: probe.connected ? 'Userbot aktif & tersambung' : 'Userbot tidak tersambung',
    connected: probe.connected,
    account_id: account.id,
    phone: account.phone || normalisePhoneSafe(account.phone),
    user: probe.user || {
      id: account.userId || null,
      name: account.name || null,
      username: account.username || null,
    },
    dc: probe.dc ?? null,
    reason: probe.reason || null,
    delay: `${account.delayMin}–${account.delayMax} detik`,
    blacklist_count: account.blacklist.length,
    commands: [
      '.help — Daftar semua perintah userbot',
      '.ping — Tes keaktifan userbot (🏓 Pong!)',
      '.id — Cek Chat ID dan User ID Telegram',
      '.promosi <teks> — Broadcast promosi ke semua grup (bisa reply pesan)',
      '.addbl [@user/id] — Blacklist grup agar dilewati promosi',
      '.delbl [@user/id] — Hapus grup dari blacklist',
      '.listbl — Lihat daftar grup yang di-blacklist',
      '.setdelay <min> <max> — Atur rentang jeda antar grup (detik)',
      '.stop — Hentikan semua promosi yang sedang berjalan',
    ],
    created_at: new Date(account.createdAt).toISOString(),
    last_used: account.lastUsed ? new Date(account.lastUsed).toISOString() : null,
  };
}

/** Old rows predate normalisation; never fail a status read over formatting. */
function normalisePhoneSafe(phone) {
  try {
    return normalisePhone(phone);
  } catch {
    return null;
  }
}
