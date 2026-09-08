import { ok, fail } from '../../lib/respond.js';
import { json, ProxyError } from '../../lib/ikyy.js';

/**
 * Youtube Play (V3) — third extractor variant, returns a `download` link. The
 * upstream occasionally answers 403 for a track it can't resolve; that is
 * surfaced as a clean failure rather than a broken payload.
 */
export default {
  name: 'Youtube Play V3',
  desc: 'Cari lagu di YouTube, dapat link download audio',
  category: 'Search',
  path: '/v1/search/ytplayv3',
  method: 'GET',
  example: '/v1/search/ytplayv3?q=alan walker faded',
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
      data = await json(`/search/ytplayv3?q=${encodeURIComponent(q)}`, 45000);
    } catch (error) {
      if (error instanceof ProxyError) {
        if (/403|not found|no result|404/i.test(error.message)) {
          return fail(`Tidak bisa mengambil audio untuk "${q}" — coba V1 atau V2`, 404);
        }
        return fail(error.message, error.status);
      }
      throw error;
    }

    return ok({
      title: data.title || null,
      duration: Number(data.duration) || data.duration || null,
      thumbnail: data.thumbnail || null,
      source: data.source || null,
      download: data.download || null,
    });
  },
};
