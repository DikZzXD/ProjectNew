import { ok, fail } from '../../lib/respond.js';
import { json, ProxyError } from '../../lib/ikyy.js';
import { qs } from '../../lib/http.js';

/**
 * Youtube Search — list matching videos for a query.
 *
 * The upstream needs an API key; it's ours, so it stays server-side rather than
 * being asked of the caller. The payload is a plain array under `result`, so the
 * upstream `creator` is dropped by returning only that array, re-wrapped here.
 */
const APIKEY = 'kyzz';

export default {
  name: 'Youtube Search',
  desc: 'Cari video YouTube — judul, channel, durasi, thumbnail',
  category: 'Search',
  path: '/v1/search/youtube',
  method: 'GET',
  example: '/v1/search/youtube?query=alan walker',
  params: [
    {
      name: 'query',
      required: true,
      placeholder: 'Kata kunci pencarian',
      desc: 'Judul atau kata kunci video YouTube',
    },
  ],

  async handler({ params }) {
    const query = String(params.query ?? '').trim();
    if (!query) return fail('Kata kunci tidak boleh kosong');

    let data;
    try {
      data = await json(`/search/youtube?${qs({ apikey: APIKEY, query })}`, 30000);
    } catch (error) {
      if (error instanceof ProxyError) {
        const missing = /not found|no result|404/i.test(error.message);
        return missing ? fail(`Tidak ada hasil untuk "${query}"`, 404) : fail(error.message, error.status);
      }
      throw error;
    }

    const items = (Array.isArray(data) ? data : []).map((v) => ({
      title: v.title || null,
      channel: v.channel || null,
      duration: v.duration || null,
      thumbnail: v.imageUrl || v.thumbnail || null,
      url: v.link || v.url || null,
    }));

    if (!items.length) return fail(`Tidak ada hasil untuk "${query}"`, 404);

    return ok({ query, count: items.length, results: items });
  },
};
