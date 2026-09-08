/**
 * The login chain: nomor → OTP → (PIN 2FA) → tersambung.
 *
 * This mirrors Telethon's `send_code_request` → `sign_in(phone, code)` →
 * `SessionPasswordNeededError` → `sign_in(password=…)`, but split across HTTP
 * calls instead of one blocking script. The awkward part is that MTProto login
 * is stateful — the auth key established while sending the code is the same one
 * that must submit the code — and a Worker keeps nothing between requests.
 *
 * So each step ends by exporting the session string and sealing it into a
 * short-lived `ubot_logins` row, and the next step rebuilds the exact same
 * client from it. The caller only ever carries an opaque `login_token`.
 *
 * Raw API calls are used rather than GramJS's `client.start()` helper, because
 * that one is built around interactive prompts and callbacks that would never
 * return in a request/response world.
 */

import {
  connect,
  close,
  credentials,
  normalisePhone,
  sessionOf,
  describeUser,
  gram,
  short,
  UbotError,
} from './ubot.js';
import { saveLogin, getLogin, updateLogin, dropLogin, saveAccount, refreshSession } from './ubotstore.js';
import { syncAndProcessUpdates } from './ubothandler.js';

/* ── Step 1 — kirim kode ke nomor ────────────────────────────── */

/**
 * Ask Telegram to deliver a login code. Returns the token that carries the
 * half-open session, plus how the code was sent so the UI can say where to look.
 */
export async function sendCode(env, params) {
  const { apiId, apiHash } = credentials(env, params);
  const phone = normalisePhone(params.phone);

  const client = await connect({ session: '', apiId, apiHash });

  try {
    const { Api } = await gram();
    const sent = await client.invoke(
      new Api.auth.SendCode({
        phoneNumber: phone,
        apiId,
        apiHash,
        settings: new Api.CodeSettings({}),
      })
    );

    // Rare, but real: Telegram can hand back a session instead of a code.
    if (sent.className === 'auth.SentCodeSuccess') {
      return finishFromAuthorization(env, client, { phone, apiId, apiHash, authorization: sent.authorization });
    }

    const { token, expiresAt } = await saveLogin(env, {
      phone,
      codeHash: sent.phoneCodeHash,
      session: sessionOf(client),
      apiId,
      apiHash,
    });

    return {
      step: 'otp_sent',
      status: 'Kode OTP dikirim',
      phone,
      login_token: token,
      sent_via: deliveryLabel(sent.type?.className),
      code_length: sent.type?.length ?? null,
      expires_in: '15 menit',
      next_step: 'Kirim kode ke /v1/tools/ubot-login/otp dengan login_token + code.',
    };
  } catch (error) {
    throw translate(error, 'send');
  } finally {
    await close(client);
  }
}

/* ── Step 2 — kirim OTP ──────────────────────────────────────── */

/**
 * Submit the code. Two outcomes: logged in, or the account has 2FA and we hand
 * back the same token with `stage: 'password'` so the PIN step can continue on
 * the very same session.
 */
export async function signIn(env, params) {
  const token = String(params.login_token || '').trim();
  if (!token) throw new UbotError('Parameter "login_token" wajib diisi', 400, 'TOKEN_MISSING');

  const code = String(params.code || '').replace(/\D/g, '');
  if (!code) throw new UbotError('Parameter "code" wajib diisi — kode OTP dari Telegram', 400, 'CODE_MISSING');

  const login = await getLogin(env, token);
  if (login.stage === 'password') {
    throw new UbotError(
      'Akun ini pakai verifikasi dua langkah. Lanjut ke /v1/tools/ubot-login/password dengan login_token + password.',
      409,
      'PASSWORD_NEEDED'
    );
  }

  const client = await connect({ session: login.session, apiId: Number(login.apiId), apiHash: login.apiHash });

  try {
    const { Api } = await gram();
    const result = await client.invoke(
      new Api.auth.SignIn({
        phoneNumber: login.phone,
        phoneCodeHash: login.codeHash,
        phoneCode: code,
      })
    );

    // Telegram can answer with "this number needs to be registered first".
    if (result.className === 'auth.AuthorizationSignUpRequired') {
      await dropLogin(env, token);
      throw new UbotError(
        'Nomor ini belum punya akun Telegram. Daftarkan dulu lewat aplikasi Telegram, lalu login di sini.',
        409,
        'SIGNUP_REQUIRED'
      );
    }

    return await promote(env, client, login, token, result.user);
  } catch (error) {
    if (isPasswordNeeded(error)) {
      return await switchToPassword(env, client, login, token);
    }
    throw translate(error, 'otp');
  } finally {
    await close(client);
  }
}

/* ── Step 3 — PIN / password 2FA (kalau ada) ─────────────────── */

/** Finish a login that stopped at the 2FA prompt, using SRP like Telethon does. */
export async function checkPassword(env, params) {
  const token = String(params.login_token || '').trim();
  if (!token) throw new UbotError('Parameter "login_token" wajib diisi', 400, 'TOKEN_MISSING');

  const password = String(params.password ?? '');
  if (!password) throw new UbotError('Parameter "password" wajib diisi — PIN/sandi verifikasi dua langkah', 400, 'PASSWORD_MISSING');

  const login = await getLogin(env, token);
  const client = await connect({ session: login.session, apiId: Number(login.apiId), apiHash: login.apiHash });

  try {
    const { Api } = await gram();
    const { computeCheck } = await import('telegram/Password.js');

    const state = await client.invoke(new Api.account.GetPassword());
    const check = await computeCheck(state, password);
    const result = await client.invoke(new Api.auth.CheckPassword({ password: check }));

    return await promote(env, client, login, token, result.user);
  } catch (error) {
    throw translate(error, 'password');
  } finally {
    await close(client);
  }
}

/* ── Step 4 — tersambung atau tidak ──────────────────────────── */

/**
 * The "tersambung tidak?" check. A stored session can die without warning —
 * revoked from another device, account frozen — and the only honest way to know
 * is to actually connect and ask. A dead session is reported, never silently
 * retried, so the caller knows to log in again.
 */
export async function checkConnection(env, account, ctx = null) {
  const client = await connect({ session: account.session, apiId: Number(account.apiId), apiHash: account.apiHash });

  try {
    const { Api } = await gram();
    const authorized = await client.isUserAuthorized();

    if (!authorized) {
      return { connected: false, reason: 'Sesi sudah tidak berlaku — login ulang untuk dapat token baru.' };
    }

    const me = await client.getMe();
    const full = await client.invoke(new Api.help.GetNearestDc()).catch(() => null);

    // The session string can change after a migration; keep D1 in step.
    const current = sessionOf(client);
    if (current && current !== account.session) {
      await refreshSession(env, account.id, { session: current, apiHash: account.apiHash });
    }

    // Process incoming/outgoing Telegram updates and userbot commands
    let syncResult = { processed: 0 };
    try {
      syncResult = await syncAndProcessUpdates(env, account, client, ctx);
    } catch {
      /* non-fatal */
    }

    return {
      connected: true,
      user: describeUser(me),
      dc: full?.thisDc ?? null,
      commands_processed: syncResult.processed || 0,
    };
  } catch (error) {
    const mapped = translate(error, 'status');
    if (mapped.code === 'SESSION_DEAD') return { connected: false, reason: mapped.message };
    throw mapped;
  } finally {
    await close(client);
  }
}

/* ── Internals ───────────────────────────────────────────────── */

/** Turn a completed sign-in into a stored account + the caller's permanent token. */
async function promote(env, client, login, loginToken, user) {
  const session = sessionOf(client);
  const profile = describeUser(user);

  const { token, id, createdAt } = await saveAccount(env, {
    phone: login.phone,
    session,
    apiId: login.apiId,
    apiHash: login.apiHash,
    user: { id: profile?.id, username: profile?.username, name: profile?.name },
  });

  await dropLogin(env, loginToken);

  return {
    step: 'connected',
    status: 'Login berhasil, userbot tersambung',
    connected: true,
    account_token: token,
    account_id: id,
    phone: login.phone,
    user: profile,
    created_at: new Date(createdAt).toISOString(),
    warning: 'Simpan account_token ini — hanya ditampilkan sekali dan tidak bisa dilihat lagi.',
    commands_help: 'Userbot siap! Di Telegram ketik .help, .ping, .id, .promosi, .addbl, .delbl, .listbl, .setdelay, .stop',
    next_step: 'Cek koneksi dan sinkronisasi di /v1/tools/ubot-login/status dengan account_token.',
  };
}

/**
 * A login that hit the 2FA wall. The session is re-saved because the SignIn
 * attempt advanced its state, and the caller keeps the same token — one flow,
 * one handle, whether or not a PIN exists.
 */
async function switchToPassword(env, client, login, token) {
  let hint = '';
  try {
    const { Api } = await gram();
    const state = await client.invoke(new Api.account.GetPassword());
    hint = state?.hint || '';
  } catch {
    /* the hint is a nicety, not worth failing the step over */
  }

  await updateLogin(env, token, {
    session: sessionOf(client),
    apiHash: login.apiHash,
    stage: 'password',
    hint,
  });

  return {
    step: 'password_needed',
    status: 'Kode benar, akun ini pakai verifikasi dua langkah',
    connected: false,
    phone: login.phone,
    login_token: token,
    password_hint: hint || null,
    next_step: 'Kirim ke /v1/tools/ubot-login/password dengan login_token + password (PIN 2FA).',
  };
}

/** SentCodeSuccess: Telegram logged us in while sending the code. */
async function finishFromAuthorization(env, client, { phone, apiId, apiHash, authorization }) {
  const user = authorization?.user;
  const { token, id, createdAt } = await saveAccount(env, {
    phone,
    session: sessionOf(client),
    apiId,
    apiHash,
    user: describeUser(user) || {},
  });

  return {
    step: 'connected',
    status: 'Login langsung berhasil tanpa OTP',
    connected: true,
    account_token: token,
    account_id: id,
    phone,
    user: describeUser(user),
    created_at: new Date(createdAt).toISOString(),
    warning: 'Simpan account_token ini — hanya ditampilkan sekali.',
  };
}

function isPasswordNeeded(error) {
  return /SESSION_PASSWORD_NEEDED/i.test(String(error?.errorMessage || error?.message || ''));
}

function deliveryLabel(className = '') {
  if (/TypeApp/i.test(className)) return 'Aplikasi Telegram (cek chat "Telegram")';
  if (/TypeSms/i.test(className)) return 'SMS';
  if (/TypeCall/i.test(className)) return 'Panggilan telepon';
  if (/TypeFlashCall|TypeMissedCall/i.test(className)) return 'Missed call — kodenya bagian akhir nomor penelepon';
  if (/TypeEmail/i.test(className)) return 'Email';
  if (/TypeFragment/i.test(className)) return 'Fragment (anonymous number)';
  return 'Telegram';
}

/**
 * Telegram's RPC errors are terse ALL_CAPS strings; map the ones a user can act
 * on to plain Indonesian and let the rest fall back to a generic capacity note
 * rather than leaking upstream text.
 */
function translate(error, stage) {
  if (error instanceof UbotError) return error;

  const raw = String(error?.errorMessage || error?.message || '');
  const seconds = Number(error?.seconds || 0);

  const table = [
    [/PHONE_NUMBER_INVALID/, ['Nomor telepon tidak dikenali Telegram. Cek lagi kode negaranya.', 400]],
    [/PHONE_NUMBER_BANNED/, ['Nomor ini diblokir oleh Telegram.', 403]],
    [/PHONE_NUMBER_FLOOD/, ['Nomor ini sudah terlalu sering minta kode. Tunggu beberapa jam.', 429]],
    [/PHONE_NUMBER_OCCUPIED/, ['Nomor ini sudah dipakai akun lain.', 409]],
    [/PHONE_PASSWORD_FLOOD/, ['Terlalu banyak percobaan sandi. Tunggu beberapa jam sebelum coba lagi.', 429]],
    [/PHONE_CODE_INVALID/, ['Kode OTP salah. Cek lagi kodenya.', 400]],
    [/PHONE_CODE_EMPTY/, ['Kode OTP kosong.', 400]],
    [/PHONE_CODE_EXPIRED/, ['Kode OTP sudah kedaluwarsa. Minta kode baru dari langkah pertama.', 410]],
    [/PHONE_CODE_HASH_EMPTY/, ['Sesi login tidak lengkap. Mulai ulang dari langkah kirim nomor.', 400]],
    [/PASSWORD_HASH_INVALID/, ['PIN / sandi dua langkah salah.', 400]],
    [/PASSWORD_MISSING/, ['Akun belum punya sandi dua langkah.', 400]],
    [/PASSWORD_TOO_FRESH_(\d+)/, ['Sandi baru diubah, Telegram menahan login sebentar. Coba lagi nanti.', 403]],
    [/SESSION_TOO_FRESH_(\d+)/, ['Sesi baru dibuat, Telegram menahan login sebentar. Coba lagi nanti.', 403]],
    [/AUTH_KEY_UNREGISTERED|AUTH_KEY_DUPLICATED|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED/, null],
    [/API_ID_INVALID|API_ID_PUBLISHED_FLOOD/, ['Kombinasi api_id / api_hash tidak valid. Ambil ulang di my.telegram.org.', 400]],
    [/FROZEN_METHOD_INVALID/, ['Akun Telegram ini sedang dibekukan, jadi tidak bisa dipakai.', 403]],
  ];

  for (const [pattern, mapped] of table) {
    if (!pattern.test(raw)) continue;
    if (!mapped) {
      return new UbotError(
        'Sesi Telegram sudah tidak berlaku — login ulang untuk dapat token baru.',
        401,
        'SESSION_DEAD'
      );
    }
    return new UbotError(mapped[0], mapped[1], raw.slice(0, 40));
  }

  if (/FLOOD_WAIT/.test(raw) || seconds > 0) {
    const wait = seconds > 0 ? formatWait(seconds) : 'beberapa saat';
    return new UbotError(`Telegram membatasi permintaan sementara. Tunggu ${wait} lagi.`, 429, 'FLOOD_WAIT');
  }

  const label = { send: 'mengirim kode', otp: 'memverifikasi kode', password: 'memeriksa sandi', status: 'memeriksa sesi' }[stage];
  return new UbotError(`Layanan Telegram sedang tidak bisa ${label}. Coba lagi beberapa saat lagi.`, 503, short(error));
}

export function formatWait(seconds) {
  const total = Math.max(1, Math.round(Number(seconds) || 0));
  if (total < 60) return `${total} detik`;
  if (total < 3600) return `${Math.ceil(total / 60)} menit`;
  return `${Math.ceil(total / 3600)} jam`;
}

export { translate };
