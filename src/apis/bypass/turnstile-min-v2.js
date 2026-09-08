import { ok, fail } from '../../lib/respond.js';
import { fetchJSON, qs } from '../../lib/http.js';

/**
 * Cloudflare Turnstile solver (minimal mode, V2).
 *
 * Same shape as V1 — url + sitekey in, token out — but hits a different
 * upstream. The reply is re-wrapped in this API's envelope so the upstream
 * `creator` never reaches a caller.
 *
 * Solving is a real browser round-trip upstream, so the timeout sits well
 * above the shared 15 s default.
 */
const UPSTREAM = 'https://api.kyzznekoo.my.id/api/cloudflare/turnstileMin';
const TIMEOUT_MS = 90000;

export default {
  name: 'Turnstile-Min (V2)',
  desc: 'Solve Cloudflare Turnstile (V2), balikin token siap pakai',
  category: 'Bypass',
  path: '/v1/bypass/turnstile-min-v2',
  method: 'GET',
  example: '/v1/bypass/turnstile-min-v2?url=https://smailr.com/app/register&sitekey=0x4AAAAAAEHcErc8DA5NpIMM',
  params: [
    {
      name: 'url',
      required: true,
      placeholder: 'https://target.com/sign-up',
      desc: 'Halaman yang memasang widget Turnstile',
    },
    {
      name: 'sitekey',
      required: true,
      placeholder: '0x4AAAAAAA...',
      desc: 'Ambil dari atribut data-sitekey di halaman itu',
    },
  ],

  async handler({ params }) {
    const url = String(params.url).trim();
    const sitekey = String(params.sitekey).trim();

    if (!/^https?:\/\/[^\s]+\.[^\s]+/i.test(url)) {
      return fail('Parameter url harus URL lengkap, contoh https://target.com/sign-up');
    }

    if (!/^0x[a-z0-9_-]{10,}$/i.test(sitekey)) {
      return fail('Format sitekey tidak valid — biasanya diawali 0x lalu huruf/angka');
    }

    const started = Date.now();
    let res;
    try {
      res = await fetchJSON(`${UPSTREAM}?${qs({ url, sitekey })}`, { headers: { accept: 'application/json' } }, TIMEOUT_MS);
    } catch (error) {
      const timedOut = error?.name === 'AbortError' || /abort/i.test(error?.message || '');
      return fail(
        timedOut
          ? `Solver tidak merespons dalam ${TIMEOUT_MS / 1000} detik — coba lagi`
          : `Gagal menghubungi solver: ${error.message}`,
        502
      );
    }

    const body = res.data || {};
    const token = body.data?.token || body.result?.token || body.token;
    if (!res.ok || body.status === false || !token) {
      const reason = body.message || body.error || `HTTP ${res.status}`;
      return fail(`Solver gagal menyelesaikan Turnstile: ${reason}`, res.status >= 400 ? res.status : 502);
    }

    return ok({
      token,
      sitekey,
      url,
      runtime: `${Date.now() - started} ms`,
      note: 'Kirim token ini sebagai field cf-turnstile-response di form target. Token sekali pakai dan cepat kedaluwarsa.',
    });
  },
};
