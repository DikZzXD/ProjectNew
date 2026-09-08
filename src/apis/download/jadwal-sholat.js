import { ok, fail } from '../../lib/respond.js';
import { payload, withKey, ProxyError } from '../../lib/ikyy.js';

/** Jadwal sholat berdasarkan kota. Apikey upstream disisipkan server-side. */
export default {
  name: 'Jadwal Sholat',
  desc: 'Jadwal sholat harian berdasarkan nama kota',
  category: 'Downloader',
  path: '/v1/download/jadwal-sholat',
  method: 'GET',
  example: '/v1/download/jadwal-sholat?kota=makassar',
  params: [
    {
      name: 'kota',
      required: true,
      placeholder: 'makassar',
      desc: 'Nama kota',
    },
  ],

  async handler({ params }) {
    const kota = String(params.kota || '').trim();
    if (!kota) return fail('Parameter "kota" wajib diisi');

    try {
      const data = await payload(withKey('/download/jadwalsholat', { kota }), {
        timeoutMs: 30000,
        key: 'result',
      });
      return ok(data);
    } catch (error) {
      if (error instanceof ProxyError) return fail(error.message, error.status);
      throw error;
    }
  },
};
