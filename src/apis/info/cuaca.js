import { ok, fail } from '../../lib/respond.js';
import { payload, withKey, ProxyError } from '../../lib/ikyy.js';

/** Cuaca berdasarkan query lokasi. Apikey upstream disisipkan server-side. */
export default {
  name: 'Info Cuaca',
  desc: 'Cek cuaca (lokasi, kondisi, suhu, kelembapan, angin)',
  category: 'Info',
  path: '/v1/info/cuaca',
  method: 'GET',
  example: '/v1/info/cuaca?query=sulawesi selatan',
  params: [
    {
      name: 'query',
      required: true,
      placeholder: 'sulawesi selatan',
      desc: 'Nama kota / daerah',
    },
  ],

  async handler({ params }) {
    const query = String(params.query || '').trim();
    if (!query) return fail('Parameter "query" wajib diisi');

    try {
      const data = await payload(withKey('/Info/cuaca', { query }), { timeoutMs: 30000, key: 'result' });
      return ok(data);
    } catch (error) {
      if (error instanceof ProxyError) return fail(error.message, error.status);
      throw error;
    }
  },
};
