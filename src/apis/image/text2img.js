import { raw, fail } from '../../lib/respond.js';
import { image, IMAGE_TIMEOUT, ProxyError } from '../../lib/ikyy.js';
import { qs } from '../../lib/http.js';

/**
 * Text to image.
 *
 * Backed by the gptimage upstream, which answers with the picture itself rather
 * than a JSON wrapper — so the bytes are streamed straight back with the real
 * content type. The five Workers AI models this used to front were dropped: they
 * needed per-model step/size juggling and still produced noisy output at the step
 * counts the free tier allows.
 *
 * Generation is slow (a real diffusion round-trip), hence the raised timeout.
 */
const MAX_PROMPT = 1000;

export default {
  name: 'Text To Image',
  desc: 'Generate gambar dari prompt — hasilnya langsung berupa foto',
  category: 'Image Generator',
  path: '/v1/image/text2img',
  method: 'GET',
  responseType: 'image',
  params: [
    {
      name: 'prompt',
      required: true,
      placeholder: 'Enter prompt',
      desc: 'Deskripsi gambar, boleh bahasa Indonesia',
    },
  ],

  async handler({ params }) {
    const prompt = String(params.prompt).trim();

    if (!prompt) return fail('Prompt tidak boleh kosong');
    if (prompt.length > MAX_PROMPT) {
      return fail(`Prompt terlalu panjang, maksimal ${MAX_PROMPT} karakter`);
    }

    try {
      const { bytes, type } = await image(`/ai/gptimage?${qs({ text: prompt })}`, IMAGE_TIMEOUT);
      return raw(bytes, type);
    } catch (error) {
      if (error instanceof ProxyError) return fail(`Gagal membuat gambar: ${error.message}`, error.status);
      throw error;
    }
  },
};
