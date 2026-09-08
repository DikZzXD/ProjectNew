import { ok, fail, download } from '../../lib/respond.js';
import { unpack, PackError } from '../../lib/pack.js';

/**
 * Decrypt / unpack — reverse the Encrypt tools back to the original source.
 *
 * The encrypt tools emit a self-running stub (base64 or zlib+base64). This lifts
 * the payload back out and returns the original script text. Paste the whole
 * packed file (or just its base64 payload) in `data`, or upload the
 * `namafileenc.<ext>` file directly.
 */
export default {
  name: 'Decrypt',
  desc: 'Balikin file hasil Encrypt (Python/JS/Base64) ke source code aslinya',
  category: 'Tools',
  path: '/v1/tools/decrypt',
  method: 'POST',
  ui: 'crypto',
  example: '/v1/tools/decrypt',
  // Sub-path aliases (base URL unchanged):
  //   /text          → decode the "data" field
  //   /text/download → same, returned as a downloadable file
  //   /file          → decode an uploaded encrypted file
  routes: [
    { suffix: 'text', mode: 'text' },
    { suffix: 'text/download', mode: 'text', params: { download: 'true' } },
    { suffix: 'file', mode: 'file' },
  ],
  params: [
    { name: 'data', required: false, placeholder: 'Tempel isi file hasil encrypt / payload base64', desc: 'Isi ini ATAU upload file' },
    { name: 'file', required: false, type: 'file', placeholder: 'Upload file hasil encrypt (namafileenc.py)', desc: 'File hasil dari tool Encrypt' },
    { name: 'download', required: false, type: 'select', options: ['', 'true'], default: '', placeholder: 'Kirim hasil sebagai file?', desc: 'Isi "true" untuk mengunduh source asli sebagai file' },
  ],

  async handler({ params, mode }) {
    const upload = mode === 'text' ? null : params.file;
    let data = String(params.data ?? '').trim();
    let outName = 'decoded.txt';

    if (mode === 'file' && !(upload && typeof upload.text === 'function')) {
      return fail('Upload file di "file" untuk endpoint ini');
    }

    if (upload && typeof upload.text === 'function') {
      data = await upload.text();
      const base = String(upload.name || '').replace(/enc(\.[^.]+)$/i, '$1').replace(/\.[^.]+$/, '');
      if (base) outName = `${base}.txt`;
    }

    if (!data) return fail('Isi payload di "data" atau upload file di "file"');

    let source;
    try {
      source = await unpack(data);
    } catch (error) {
      if (error instanceof PackError) return fail(error.message);
      return fail(`Gagal unpack: ${error?.message || 'unknown'}`, 500);
    }

    const asFile = /^(1|true|yes|ya)$/i.test(String(params.download ?? '').trim());
    if (asFile) return download(source, outName);
    return ok({ decoded: source, length: source.length });
  },
};
