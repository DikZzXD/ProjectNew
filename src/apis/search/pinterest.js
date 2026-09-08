import { ok, fail } from '../../lib/respond.js';
import { json, ProxyError } from '../../lib/ikyy.js';
import { qs } from '../../lib/http.js';

/**
 * Pinterest Search — image results for a query.
 *
 * The upstream carries the payload under `results` (not `result`) and stamps its
 * own `creator`; json() is told to unwrap `results`, and each pin is reshaped
 * into this API's own envelope so nothing foreign leaks through.
 */
const APIKEY = 'kyzz';

export default {
  name: 'Pinterest Search',
  desc: 'Cari gambar di Pinterest — pin, uploader, sumber',
  category: 'Search',
  path: '/v1/search/pinterest',
  method: 'GET',
  example: '/v1/search/pinterest?q=aesthetic wallpaper',
  params: [
    {
      name: 'q',
      required: true,
      placeholder: 'Kata kunci gambar',
      desc: 'Kata kunci pencarian Pinterest',
    },
  ],

  async handler({ params }) {
    const q = String(params.q ?? '').trim();
    if (!q) return fail('Kata kunci tidak boleh kosong');

    let data;
    try {
      data = await json(`/search/pinterest?${qs({ apikey: APIKEY, q })}`, 30000, 'results');
    } catch (error) {
      if (error instanceof ProxyError) {
        const missing = /not found|no result|404/i.test(error.message);
        return missing ? fail(`Tidak ada hasil untuk "${q}"`, 404) : fail(error.message, error.status);
      }
      throw error;
    }

    const items = (Array.isArray(data) ? data : []).map((p) => {
      const user = p.user || {};
      return {
        id: p.id || null,
        title: p.title || null,
        image_url: p.image_url || null,
        source: p.source || null,
        uploader: {
          username: user.username || null,
          name: user.name || null,
          followers: Number(user.followers) || 0,
        },
      };
    });

    if (!items.length) return fail(`Tidak ada hasil untuk "${q}"`, 404);

    return ok({ query: q, count: items.length, results: items });
  },
};
