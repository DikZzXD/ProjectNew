/**
 * Builder for the "Cecan" random-photo endpoints.
 *
 * There are seven of them and they differ only by country, so the endpoint files
 * stay one-per-route (the router needs that) while the behaviour lives here once.
 * Each one answers with the photo itself, not JSON, so the playground previews it
 * directly.
 */

import { raw, fail } from '../../lib/respond.js';
import { image, ProxyError } from '../../lib/ikyy.js';

/** Randoms are cheap upstream, so this needs nowhere near the image-gen timeout. */
const TIMEOUT_MS = 25000;

export function cecan({ slug, title, label }) {
  return {
    name: `Cecan ${title}`,
    desc: `Foto random cewek cantik ${label}`,
    category: 'Random',
    path: `/v1/random/cecan/${slug}`,
    method: 'GET',
    responseType: 'image',
    params: [],

    async handler() {
      try {
        const { bytes, type } = await image(`/random/cecan/${slug}`, TIMEOUT_MS);
        return raw(bytes, type);
      } catch (error) {
        if (error instanceof ProxyError) {
          return fail(`Gagal mengambil foto Cecan ${title}: ${error.message}`, error.status);
        }
        throw error;
      }
    },
  };
}
