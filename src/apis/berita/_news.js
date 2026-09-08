import { ok, fail } from '../../lib/respond.js';
import { payload, ProxyError } from '../../lib/ikyy.js';

/**
 * Shared builder for news list endpoints.
 * Upstream stamps its own creator — we drop it and re-wrap under our envelope.
 */
export function newsFeed({ name, desc, path, upstream, example }) {
  return {
    name,
    desc,
    category: 'Berita',
    path,
    method: 'GET',
    example: example || path,
    params: [],

    async handler() {
      try {
        const body = await payload(upstream, { timeoutMs: 45000 });
        const items = body.result || body.data || (Array.isArray(body) ? body : null);
        if (!items || !Array.isArray(items)) {
          return fail('Upstream tidak mengirim daftar berita', 502);
        }
        return ok({
          source: body.source || name,
          total: body.total ?? items.length,
          items: items.map((item) => ({
            title: item.title || null,
            link: item.link || null,
            thumbnail: item.thumbnail || null,
            category: item.category || null,
            time: item.time || item.pubDate || null,
          })),
        });
      } catch (error) {
        if (error instanceof ProxyError) return fail(error.message, error.status);
        throw error;
      }
    },
  };
}
