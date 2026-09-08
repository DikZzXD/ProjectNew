import { ok, fail } from '../../lib/respond.js';
import {
  authenticate,
  quota,
  requestLink,
  jobs,
  verifyLink,
  cooldown,
  EMAIL_RE,
  UpstreamError,
} from '../../lib/alight.js';

/**
 * Alight Motion premium — one endpoint for the whole flow.
 *
 *   ?email=              → asks for the link, and reports quota + job state
 *   ?email=&link=        → verifies the link from the inbox, premium goes live
 *
 * A repeat call with only the email while a job is still pending reports its
 * status instead of burning another quota slot, so the caller never needs a
 * separate status route.
 *
 * Sub-paths expose each step as its own URL (base URL still auto-detects):
 *   /email   → request the link (step 1)
 *   /verify  → verify the link    (step 2, needs email+link)
 *   /status  → quota + job state, without spending a slot
 *
 * The calls share no server state: the upstream password is derived from the
 * email, so each call rebuilds the same session from scratch.
 */
export default {
  name: 'Alight Motion Premium',
  desc: 'Masukkan email untuk minta link, lalu kirim link-nya untuk aktivasi',
  category: 'Tools',
  path: '/v1/tools/alightmotion',
  method: 'GET',
  ui: 'alight-steps',
  routes: [
    { suffix: 'email', mode: 'request' },
    { suffix: 'verify', mode: 'verify' },
    { suffix: 'status', mode: 'status' },
  ],
  params: [
    {
      name: 'email',
      required: true,
      placeholder: 'Enter email Alight Motion',
      desc: 'Email akun Alight Motion yang mau dipremiumkan',
    },
    {
      name: 'link',
      required: false,
      placeholder: 'Paste link verifikasi dari inbox (langkah 2)',
      desc: 'Kosongkan dulu — isi setelah link masuk ke email',
    },
  ],

  async handler({ params, mode }) {
    const email = String(params.email).trim();
    const link = String(params.link || '').trim();

    if (!EMAIL_RE.test(email)) return fail('Format email tidak valid');

    try {
      const { cookie, mode: accountMode } = await authenticate(email);

      // Explicit sub-path mode wins; the base URL keeps auto-detecting on link.
      if (mode === 'status') return await status({ cookie, email, accountMode });
      if (mode === 'verify') {
        if (!link) return fail('Parameter "link" wajib diisi untuk verifikasi', 400);
        return await verify({ cookie, email, link });
      }
      if (mode === 'request') return await request({ cookie, email, mode: accountMode });

      return link ? await verify({ cookie, email, link }) : await request({ cookie, email, mode: accountMode });
    } catch (error) {
      if (error instanceof UpstreamError) {
        // The upstream explains itself well; only pad terse verify failures.
        const terse = error.data?.code === 'AM_VERIFY_FAILED' && error.message.length < 60;
        const hint = terse
          ? ' Pastikan link disalin utuh dari email "Sign in to Alight Creative" dan belum kedaluwarsa.'
          : '';
        return fail(`${error.message}${hint}`, error.status);
      }
      return fail(`Gagal menghubungi layanan Alight Motion: ${error.message}`, 502);
    }
  },
};

/* ── Status — quota + job state, no slot spent ──────────────── */

async function status({ cookie, email, accountMode }) {
  const [q, list] = await Promise.all([quota(cookie), jobs(cookie)]);

  return ok({
    email,
    account: accountMode === 'register' ? 'Baru dibuat' : 'Sudah terdaftar',
    quota_used: q.usedToday,
    quota_limit: q.dailyLimit,
    quota_left: Math.max(0, q.dailyLimit - q.usedToday),
    cooldown: q.retryAfterMs > 0 ? cooldown(q.retryAfterMs) : null,
    can_generate: q.retryAfterMs === 0 && q.usedToday < q.dailyLimit,
    jobs: list.slice(0, 5).map((j) => ({
      job_id: j.id,
      state: j.state,
      am_email: j.amEmail,
      created_at: iso(j.createdAt),
      can_resend: j.canResend,
    })),
  });
}

/* ── Step 1 — request the link (or report the pending one) ───── */

async function request({ cookie, email, mode }) {
  const [q, list] = await Promise.all([quota(cookie), jobs(cookie)]);
  const pending = list.find((j) => j.state === 'AWAITING_AM_VERIFICATION');
  const done = list.find((j) => j.state === 'SUCCESS');

  // Already waiting on a link: report it rather than spending another slot.
  if (pending) {
    return ok({
      email,
      step: 'waiting_verification',
      status: 'Link sudah dikirim, menunggu verifikasi',
      quota: `${q.usedToday}/${q.dailyLimit}`,
      requested_at: iso(pending.createdAt),
      next_step: nextStep(email),
      link_expires_in: '± 30 menit',
    });
  }

  if (q.retryAfterMs > 0) {
    return fail(`Masih cooldown, tunggu ${cooldown(q.retryAfterMs)} lagi`, 429);
  }

  if (q.usedToday >= q.dailyLimit) {
    const extra = done ? ' Aktivasi terakhir sudah berhasil.' : '';
    return fail(`Kuota harian habis (${q.usedToday}/${q.dailyLimit}). Coba lagi besok.${extra}`, 429);
  }

  const job = await requestLink(cookie, email);

  return ok({
    email,
    step: 'link_sent',
    status: 'Link verifikasi terkirim',
    account: mode === 'register' ? 'Akun baru dibuat & terverifikasi otomatis' : 'Login ke akun lama',
    quota: `${q.usedToday}/${q.dailyLimit}`,
    state: job.state,
    next_step: nextStep(email),
    link_expires_in: '± 30 menit',
  });
}

/* ── Step 2 — verify ────────────────────────────────────────── */

async function verify({ cookie, email, link }) {
  if (!/^https?:\/\//i.test(link)) {
    return fail('Link verifikasi harus diawali http:// atau https://');
  }

  const list = await jobs(cookie);
  const job = list.find((j) => j.state === 'AWAITING_AM_VERIFICATION') || list[0];

  if (!job) {
    return fail(`Belum ada permintaan link untuk email ini. Panggil dulu /v1/tools/alightmotion?email=${email}`, 409);
  }

  const result = await verifyLink(cookie, job.id, link);

  if (result.state !== 'SUCCESS') {
    return fail(result.error || result.message || `Belum aktif (state: ${result.state})`, 400);
  }

  return ok({
    email: result.amEmail || email,
    step: 'activated',
    status: 'Premium aktif',
    duration: '1 Tahun',
    detail: result.activationDetail || 'Fitur premium berhasil diaktifkan',
    note: 'Buka ulang aplikasi Alight Motion dan login dengan email ini.',
  });
}

function nextStep(email) {
  return (
    `Buka inbox ${email}, cari email "Sign in to Alight Creative", tekan-tahan tombolnya lalu Salin URL. ` +
    'Kirim ulang endpoint ini dengan parameter link=<url tadi>.'
  );
}

function iso(ts) {
  const time = Number(ts);
  return Number.isFinite(time) && time > 0 ? new Date(time).toISOString() : null;
}
