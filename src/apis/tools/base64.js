import { ok, fail } from '../../lib/respond.js';

/**
 * Base64 encode / decode, UTF-8 safe.
 */
export default {
  name: 'Base64',
  desc: 'Encode atau decode string Base64',
  category: 'Tools',
  path: '/v1/tools/base64',
  method: 'GET',
  params: [
    { name: 'text', required: true, placeholder: 'Enter text' },
    { name: 'mode', required: false, placeholder: 'encode | decode', default: 'encode' },
  ],

  async handler({ params }) {
    const mode = String(params.mode).toLowerCase();

    if (mode !== 'encode' && mode !== 'decode') {
      return fail('Parameter "mode" harus encode atau decode');
    }

    try {
      if (mode === 'encode') {
        const bytes = new TextEncoder().encode(params.text);
        const binary = String.fromCharCode(...bytes);
        return ok({ mode, input: params.text, output: btoa(binary) });
      }

      const binary = atob(params.text.trim());
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      return ok({ mode, input: params.text, output: new TextDecoder().decode(bytes) });
    } catch {
      return fail('Input bukan Base64 yang valid');
    }
  },
};
