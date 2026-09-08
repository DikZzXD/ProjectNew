import { raw, fail } from '../../lib/respond.js';
import { image, IMAGE_TIMEOUT, ProxyError } from '../../lib/ikyy.js';
import { qs } from '../../lib/http.js';

/**
 * Screenshot Web.
 *
 * Upstream renders the target page in a headless browser and answers with the
 * PNG itself, so the bytes stream straight back with their real content type.
 * A real browser render is slow, hence the raised timeout.
 */
export default {
  name: 'Screenshot Web',
  desc: 'Screenshot halaman web — hasilnya langsung berupa foto',
  category: 'Tools',
  path: '/v1/tools/ssweb',
  method: 'GET',
  responseType: 'image',
  example: '/v1/tools/ssweb?url=https://sfl-bypass.vercel.app/',
  params: [
    {
      name: 'url',
      required: true,
      placeholder: 'https://contoh.com',
      desc: 'URL halaman yang mau di-screenshot',
    },
  ],

  async handler({ params }) {
    const url = String(params.url).trim();

    if (!/^https?:\/\//i.test(url)) {
      return fail('URL harus diawali http:// atau https://');
    }

    try {
      const { bytes, type } = await image(`/tools/ssweb?${qs({ url })}`, IMAGE_TIMEOUT);
      return raw(bytes, type);
    } catch (error) {
      if (error instanceof ProxyError) return fail(`Gagal screenshot: ${error.message}`, error.status);
      throw error;
    }
  },
};
