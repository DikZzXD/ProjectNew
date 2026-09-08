import { ok, fail } from '../../lib/respond.js';
import { payload, ProxyError } from '../../lib/ikyy.js';
import { qs } from '../../lib/http.js';

/** Metadata video YouTube dari URL. */
export default {
  name: 'Youtube Metadata',
  desc: 'Ambil metadata video YouTube (judul, channel, stats, thumbnail, …)',
  category: 'Info',
  path: '/v1/info/yt-metadata',
  method: 'GET',
  example: '/v1/info/yt-metadata?url=https://www.youtube.com/watch?v=…',
  params: [
    {
      name: 'url',
      required: true,
      placeholder: 'https://www.youtube.com/watch?v=…',
      desc: 'Link video YouTube',
    },
  ],

  async handler({ params }) {
    const url = String(params.url || '').trim();
    if (!/^https?:\/\//i.test(url)) return fail('Parameter url harus link YouTube yang valid');

    try {
      const data = await payload(`/info/ytmetadata?${qs({ url })}`, { timeoutMs: 45000, key: 'result' });
      return ok(data);
    } catch (error) {
      if (error instanceof ProxyError) return fail(error.message, error.status);
      throw error;
    }
  },
};
