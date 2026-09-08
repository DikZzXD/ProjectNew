import { raw, fail } from '../../lib/respond.js';
import { media, withKey, IMAGE_TIMEOUT, ProxyError } from '../../lib/ikyy.js';

/** Brat video dari teks. Apikey upstream disisipkan server-side. */
export default {
  name: 'Brat Video',
  desc: 'Generate video Brat dari teks',
  category: 'Canvas',
  path: '/v1/canvas/brat-video',
  method: 'GET',
  responseType: 'video',
  example: '/v1/canvas/brat-video?text=kas',
  params: [
    {
      name: 'text',
      required: true,
      placeholder: 'kas',
      desc: 'Teks yang mau digambar jadi video',
    },
  ],

  async handler({ params }) {
    const text = String(params.text || '').trim();
    if (!text) return fail('Parameter "text" wajib diisi');

    try {
      const { bytes, type } = await media(
        withKey('/canvas/bratvid', { text }),
        IMAGE_TIMEOUT,
        /^(image|video)\//i
      );
      return raw(bytes, type);
    } catch (error) {
      if (error instanceof ProxyError) return fail(error.message, error.status);
      throw error;
    }
  },
};
