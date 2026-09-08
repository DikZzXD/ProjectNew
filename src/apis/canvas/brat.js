import { raw, fail } from '../../lib/respond.js';
import { media, withKey, IMAGE_TIMEOUT, ProxyError } from '../../lib/ikyy.js';

/** Brat image dari teks. Apikey upstream disisipkan server-side. */
export default {
  name: 'Brat',
  desc: 'Generate gambar Brat dari teks',
  category: 'Canvas',
  path: '/v1/canvas/brat',
  method: 'GET',
  responseType: 'image',
  example: '/v1/canvas/brat?text=halo',
  params: [
    {
      name: 'text',
      required: true,
      placeholder: 'halo',
      desc: 'Teks yang mau digambar',
    },
  ],

  async handler({ params }) {
    const text = String(params.text || '').trim();
    if (!text) return fail('Parameter "text" wajib diisi');

    try {
      const { bytes, type } = await media(withKey('/canvas/bratv1', { text }), IMAGE_TIMEOUT);
      return raw(bytes, type);
    } catch (error) {
      if (error instanceof ProxyError) return fail(error.message, error.status);
      throw error;
    }
  },
};
