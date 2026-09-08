/**
 * Shared builder for the "Encrypt X" tools.
 *
 * These do NOT produce an opaque ciphertext — the whole point is a result you
 * can still RUN. Each tool packs the source into a small self-executing stub
 * (base64, optionally zlib-compressed) in the target language:
 *
 *   Encrypt Python  → a .py that runs the original via exec(zlib+base64)
 *   Encrypt JS      → a .js that runs the original via eval(zlib+base64)
 *   Encrypt Base64  → base64-only variant (no compression layer)
 *
 * `python namafileenc.py` (or `node namafileenc.js`) reconstructs and runs the
 * original script. The Decrypt tool reverses any of them back to source.
 */

import { ok, fail, download } from '../../lib/respond.js';
import { pack, langFromName } from '../../lib/pack.js';

const MAX_TEXT = 100000;

/** `namafile.py` → `namafileenc.py`; `script` → `scriptenc.py`. */
function encName(original, lang) {
  const fallbackExt = lang === 'javascript' ? 'js' : 'py';
  const safe = String(original || `script.${fallbackExt}`).replace(/[^\w.\-]+/g, '_');
  const dot = safe.lastIndexOf('.');
  if (dot <= 0) return `${safe}enc.${fallbackExt}`;
  return `${safe.slice(0, dot)}enc${safe.slice(dot)}`;
}

/**
 * Build an encrypt endpoint.
 * @param {{ name, path, lang, langLabel, compress }} config
 *   lang: 'python' | 'javascript'
 *   compress: true → zlib+base64, false → base64 only (Encrypt Base64)
 */
export function encryptTool({ name, path, lang = 'python', langLabel = 'Python', compress = true }) {
  const runner = lang === 'javascript' ? 'node' : 'python';
  return {
    name,
    desc: `Pack teks / file script jadi ${langLabel} yang tetap bisa dijalankan (${compress ? 'zlib+base64' : 'base64'})`,
    category: 'Tools',
    path,
    method: 'POST',
    ui: 'crypto',
    example: path,
    // Sub-path aliases (base URL keeps working unchanged):
    //   /text            → pack the "text" field only
    //   /text/download   → same, forced to download as a file
    //   /file            → pack an uploaded file
    routes: [
      { suffix: 'text', mode: 'text' },
      { suffix: 'text/download', mode: 'text', params: { download: 'true' } },
      { suffix: 'file', mode: 'file' },
    ],
    params: [
      { name: 'text', required: false, placeholder: `Kode ${langLabel} yang mau di-pack`, desc: `Isi kode ATAU upload file. Maksimal ${MAX_TEXT} karakter` },
      { name: 'file', required: false, type: 'file', placeholder: `Upload file script (mis. namafile.${lang === 'javascript' ? 'js' : 'py'})`, desc: 'Isi file di-pack; hasil diunduh sebagai namafileenc.<ext>' },
      { name: 'download', required: false, type: 'select', options: ['', 'true'], default: '', placeholder: 'Paksa unduh sebagai file?', desc: 'Mode teks: isi "true" untuk mengunduh hasil sebagai file. Upload file selalu diunduh.' },
    ],

    async handler({ params, mode }) {
      const upload = params.file;
      // `mode` comes from the sub-path: 'text' ignores any upload, 'file'
      // requires one. The base URL (mode null) keeps auto-detecting.
      const hasUpload = mode !== 'text' && upload && typeof upload.text === 'function';

      if (mode === 'file' && !hasUpload) return fail('Upload file di "file" untuk endpoint ini');
      let source;
      let outName;
      if (hasUpload) {
        if (typeof upload.size === 'number' && upload.size > MAX_TEXT) {
          return fail(`File terlalu besar, maksimal ${MAX_TEXT} karakter`);
        }
        source = await upload.text();
        outName = encName(upload.name, lang);
      } else {
        source = String(params.text ?? '');
      }

      if (!source) return fail('Isi kode di "text" atau upload file di "file"');
      if (source.length > MAX_TEXT) return fail(`Isi terlalu panjang, maksimal ${MAX_TEXT} karakter`);

      let packed;
      try {
        packed = await pack(source, lang, compress);
      } catch (error) {
        return fail(`Gagal pack: ${error?.message || 'unknown'}`, 500);
      }

      // Uploads always download; text mode downloads only when download=true.
      const forceFile = /^(1|true|yes|ya)$/i.test(String(params.download ?? '').trim());
      if (hasUpload || forceFile) {
        const fname = outName || `${path.split('/').pop() || 'encrypt'}.${lang === 'javascript' ? 'js' : 'py'}`;
        return download(packed, fname);
      }

      return ok({
        language: langLabel,
        method: compress ? 'zlib+base64' : 'base64',
        run: `${runner} <file>`,
        packed,
        note: `Simpan sebagai file lalu jalankan "${runner} namafile" — kode asli akan berjalan. Untuk balikin ke sumber, pakai /v1/tools/decrypt.`,
      });
    },
  };
}
