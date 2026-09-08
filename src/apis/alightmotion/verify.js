import { ok, fail } from '../../lib/respond.js';
import { authenticate, jobs, verifyLink, EMAIL_RE, UpstreamError } from '../../lib/alight.js';

/**
 * Step 2 of Alight Motion premium activation.
 *
 * Takes the sign-in link from the inbox and finishes activation. The session is
 * rebuilt from the email (the upstream password is derived from it), so this
 * call is independent of the one that requested the link.
 *
 * job_id is optional: when omitted the newest pending job for the account is
 * used, which is what a caller wants in practice.
 */
export default {
  name: 'Alight Motion — Verify',
  desc: 'Langkah 2: tempel link verifikasi untuk aktifkan premium',
  category: 'Alight Motion',
  path: '/v1/alightmotion/verify',
  method: 'GET',
  params: [
    { name: 'email', required: true, placeholder: 'Enter email Alight Motion' },
    { name: 'link', required: true, placeholder: 'Paste link verifikasi dari email' },
    { name: 'job_id', required: false, placeholder: 'Job ID (opsional, otomatis)' },
  ],

  async handler({ params }) {
    const email = String(params.email).trim();
    const link = String(params.link).trim();

    if (!EMAIL_RE.test(email)) return fail('Format email tidak valid');
    if (!/^https?:\/\//i.test(link)) return fail('Link verifikasi harus diawali http:// atau https://');

    try {
      const { cookie } = await authenticate(email);

      let jobId = params.job_id ? String(params.job_id).trim() : '';

      if (!jobId) {
        const list = await jobs(cookie);
        const pending = list.find((j) => j.state === 'AWAITING_AM_VERIFICATION') || list[0];

        if (!pending) {
          return fail('Belum ada permintaan link untuk email ini. Jalankan /v1/alightmotion/send dulu', 409);
        }
        jobId = pending.id;
      }

      const result = await verifyLink(cookie, jobId, link);

      if (result.state !== 'SUCCESS') {
        return fail(result.error || result.message || `Belum aktif (state: ${result.state})`, 400);
      }

      return ok({
        email: result.amEmail || email,
        status: 'Premium',
        duration: '1 Tahun',
        detail: result.activationDetail || 'Fitur premium berhasil diaktifkan',
        job_id: jobId,
        state: result.state,
      });
    } catch (error) {
      if (error instanceof UpstreamError) {
        // The upstream usually explains itself well; only pad terse messages.
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
