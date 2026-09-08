import { ok, fail } from '../../lib/respond.js';
import { json, ProxyError } from '../../lib/ikyy.js';

/**
 * Youtube Play (V2) — same idea as V1, different upstream extractor: it returns
 * an mp3 stream and the video id/mode instead of an opus link. Re-wrapped so the
 * upstream `creator` never reaches a caller.
 */
export default {
  name: 'Youtube Play V2',
  desc: 'Cari lagu di YouTube, dapat audio mp3 langsung',
  category: 'Search',
  path: '/v1/search/ytplayv2',
  method: 'GET',
  example: '/v1/search/ytplayv2?q=alan walker faded',
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
      data = await json(`/search/ytplayv2?q=${encodeURIComponent(q)}`, 45000);
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
      id: data.id || null,
      source: data.source || null,
      thumbnail: data.thumbnail || null,
      duration: Number(data.duration) || null,
      audio: {
        type: audio.type || null,
        url: audio.url || null,
      },
      mode: data.mode || null,
    });
  },
};
