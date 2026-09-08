import { ok, fail } from '../../lib/respond.js';
import { authenticate, quota, jobs, cooldown, EMAIL_RE, UpstreamError } from '../../lib/alight.js';

/**
 * Account status helper: remaining daily quota, cooldown, and the state of
 * recent activation jobs. Useful to check before calling /send.
 */
export default {
  name: 'Alight Motion — Status',
  desc: 'Cek kuota harian dan status job aktivasi',
  category: 'Alight Motion',
  path: '/v1/alightmotion/status',
  method: 'GET',
  params: [{ name: 'email', required: true, placeholder: 'Enter email Alight Motion' }],

  async handler({ params }) {
    const email = String(params.email).trim();

    if (!EMAIL_RE.test(email)) return fail('Format email tidak valid');

    try {
      const { cookie, mode } = await authenticate(email);
      const [q, list] = await Promise.all([quota(cookie), jobs(cookie)]);

      return ok({
        email,
        account: mode === 'register' ? 'Baru dibuat' : 'Sudah terdaftar',
        quota_used: q.usedToday,
        quota_limit: q.dailyLimit,
        quota_left: Math.max(0, q.dailyLimit - q.usedToday),
        cooldown: q.retryAfterMs > 0 ? cooldown(q.retryAfterMs) : null,
        can_generate: q.retryAfterMs === 0 && q.usedToday < q.dailyLimit,
        jobs: list.slice(0, 5).map((j) => ({
          job_id: j.id,
          state: j.state,
          am_email: j.amEmail,
          created_at: new Date(j.createdAt).toISOString(),
          can_resend: j.canResend,
        })),
      });
    } catch (error) {
      if (error instanceof UpstreamError) return fail(error.message, error.status);
      return fail(`Gagal menghubungi layanan Alight Motion: ${error.message}`, 502);
    }
  },
};
