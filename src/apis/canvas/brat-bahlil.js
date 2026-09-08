import { raw, fail } from '../../lib/respond.js';
import { media, IMAGE_TIMEOUT, ProxyError } from '../../lib/ikyy.js';
import { qs } from '../../lib/http.js';

/** Brat Bahlil sticker/image dari teks. */
export default {
  name: 'Brat Bahlil',
  desc: 'Generate gambar Brat Bahlil dari teks',
  category: 'Canvas',
  path: '/v1/canvas/brat-bahlil',
  method: 'GET',
  responseType: 'image',
  example: '/v1/canvas/brat-bahlil?text=lahe',
  params: [
    {
      name: 'text',
      required: true,
      placeholder: 'lahe',
      desc: 'Teks yang mau digambar',
    },
  ],

  async handler({ params }) {
    const text = String(params.text || '').trim();
    if (!text) return fail('Parameter "text" wajib diisi');

    try {
      const { bytes, type } = await media(`/maker/bratbahlil?${qs({ text })}`, IMAGE_TIMEOUT);
      return raw(bytes, type);
    } catch (error) {
      if (error instanceof ProxyError) return fail(error.message, error.status);
      throw error;
    }
  },
};
