import { ok, fail } from '../../lib/respond.js';
import { json, ProxyError } from '../../lib/ikyy.js';

/**
 * Youtube Play (V1) — search a track and get a direct audio stream.
 *
 * Upstream stamps its own `creator` on the body; json() returns `result` alone,
 * so only the fields below are re-emitted under this API's own envelope.
 */
export default {
  name: 'Youtube Play',
  desc: 'Cari lagu di YouTube, dapat audio langsung (opus)',
  category: 'Search',
  path: '/v1/search/ytplay',
  method: 'GET',
  example: '/v1/search/ytplay?q=alan walker faded',
  params: [
    {
      name: 'q',
      required: true,
      placeholder: 'Judul lagu / kata kunci',
      desc: 'Nama lagu atau kata kunci pencarian',
    },
  ],

  async handler({ params }) {
    const q = String(params.q ?? '').trim();
    if (!q) return fail('Kata kunci tidak boleh kosong');

    let data;
    try {
      data = await json(`/search/ytplay?q=${encodeURIComponent(q)}`, 45000);
    } catch (error) {
      if (error instanceof ProxyError) {
        const missing = /not found|no result|404/i.test(error.message);
        return missing ? fail(`Tidak ada hasil untuk "${q}"`, 404) : fail(error.message, error.status);
      }
      throw error;
    }

    const audio = data.audio || {};
    return ok({
      title: data.title || null,
      thumbnail: data.thumbnail || null,
      duration: Number(data.duration) || null,
      source: data.source || null,
      audio: {
        quality: audio.quality || null,
        url: audio.url || null,
      },
    });
  },
};
