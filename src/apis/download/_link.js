import { ok, fail, raw } from '../../lib/respond.js';
import { flexible, DOWNLOAD_TIMEOUT, ProxyError } from '../../lib/ikyy.js';
import { qs } from '../../lib/http.js';

/**
 * Shared builder for link-based downloaders.
 * Upstream may answer with JSON (urls/meta) or raw media — both are supported.
 * The fixed apikey is never shown to callers.
 */
export function linkDownload({ name, desc, path, upstream, example }) {
  return {
    name,
    desc,
    category: 'Downloader',
    path,
    method: 'GET',
    example: example || `${path}?url=https://…`,
    params: [
      {
        name: 'url',
        required: true,
        placeholder: 'https://…',
        desc: 'Link yang mau di-download',
      },
    ],

    async handler({ params }) {
      const url = String(params.url || '').trim();
      if (!/^https?:\/\//i.test(url)) return fail('Parameter url harus diawali http:// atau https://');

      try {
        const out = await flexible(`${upstream}?${qs({ url })}`, DOWNLOAD_TIMEOUT);
        if (out.kind === 'binary') return raw(out.bytes, out.type);
        // Prefer nested result/data when present so the envelope stays clean.
        const data = out.data;
        if (data?.result !== undefined) return ok(data.result);
        if (data?.data !== undefined) return ok(data.data);
        return ok(data);
      } catch (error) {
        if (error instanceof ProxyError) return fail(error.message, error.status);
        throw error;
      }
    },
  };
}
