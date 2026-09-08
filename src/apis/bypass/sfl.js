import { ok, fail } from '../../lib/respond.js';
import { json, ProxyError } from '../../lib/ikyy.js';
import { qs } from '../../lib/http.js';

/**
 * SFL (sfl.gl) skip-link bypass.
 *
 * Upstream returns { originalUrl, destinationUrl, message } under `result`, plus
 * its own `creator` and `runtime` at the top level — none of which is passed on.
 * We reshape to snake_case and keep only the fields that matter to a caller.
 */
export default {
  name: 'SFL',
  desc: 'Bypass link sfl.gl — dapat URL tujuan langsung tanpa halaman perantara',
  category: 'Bypass',
  path: '/v1/bypass/sfl',
  method: 'GET',
  example: '/v1/bypass/sfl?url=https://sfl.gl/NQYsS',
  params: [
    {
      name: 'url',
      required: true,
      placeholder: 'https://sfl.gl/xxxxx',
      desc: 'Link sfl.gl yang mau di-bypass',
    },
  ],

  async handler({ params }) {
    const url = String(params.url).trim();

    if (!/^https?:\/\//i.test(url)) {
      return fail('URL harus diawali http:// atau https://');
    }

    let data;
    try {
      data = await json(`/tools/skiplink/sfl?${qs({ url })}`, 30000);
    } catch (error) {
      if (error instanceof ProxyError) return fail(error.message, error.status);
      throw error;
    }

    const destination = data.destinationUrl || data.originalUrl || null;
    if (!destination) return fail('Bypass gagal — link tidak menghasilkan URL tujuan', 502);

    return ok({
      source_url: url,
      original_url: data.originalUrl || null,
      destination_url: destination,
      message: data.message || 'Bypass berhasil',
    });
  },
};
