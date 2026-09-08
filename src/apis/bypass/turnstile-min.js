import { ok, fail } from '../../lib/respond.js';
import { fetchJSON, qs } from '../../lib/http.js';

/**
 * Cloudflare Turnstile solver (minimal mode).
 *
 * Proxies the upstream solver and re-wraps the answer in this API's own envelope,
 * so a caller never sees a third party's `creator` field. The token is what the
 * target site's own form expects in `cf-turnstile-response`.
 *
 * Solving is a real browser round-trip upstream — measured 4–8 s — so the timeout
 * is raised well past the shared 15 s default; anything lower turns a normal
 * solve into a spurious failure.
 */
const UPSTREAM = 'https://api.ikyyxd.my.id/bypass/turnstile-cf-min';
const TIMEOUT_MS = 90000;

export default {
  name: 'Turnstile-Min (V1)',
  desc: 'Solve Cloudflare Turnstile (V1), balikin token siap pakai',
  category: 'Bypass',
  path: '/v1/bypass/turnstile-min',
  method: 'GET',
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

    const token = res.data?.result?.token;
    if (!res.ok || !token) {
      const reason = res.data?.message || res.data?.error || `HTTP ${res.status}`;
      return fail(`Solver gagal menyelesaikan Turnstile: ${reason}`, res.status >= 400 ? res.status : 502);
    }

    return ok({
      token,
      sitekey: res.data.result.sitekey || sitekey,
      url: res.data.result.url || url,
      // Upstream reports its own solve time; this one covers the whole round trip.
      runtime: `${Date.now() - started} ms`,
      note: 'Kirim token ini sebagai field cf-turnstile-response di form target. Token sekali pakai dan cepat kedaluwarsa.',
    });
  },
};
