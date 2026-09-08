/**
 * Endpoint registry.
 *
 * Every file in src/apis/<category>/<name>.js default-exports one endpoint
 * definition. src/apis/index.js lists them; this module turns that list into
 * a lookup table + the catalog the docs UI renders from.
 *
 * Endpoint definition shape:
 *   {
 *     name:     'Gemini AI',                 // card title
 *     desc:     'Gemini chat by Google',      // card subtitle
 *     category: 'AI',                         // groups the cards
 *     path:     '/v1/ai/gemini',              // public URL
 *     method:   'GET',                        // GET | POST
 *     params:   [{ name, required, placeholder, type, default }],
 *     routes:   [{ suffix, mode, params }],   // optional sub-path aliases
 *     handler:  async ({ params, mode, env, request, ctx }) => Response,
 *   }
 *
 * Sub-path routing (`routes`)
 * ---------------------------
 * An endpoint that has 2+ modes can expose each as its own URL suffix while
 * keeping the single base URL working exactly as before. A route entry:
 *
 *   { suffix: 'text/download', mode: 'text', params: { download: 'true' } }
 *
 * registers `<path>/text/download` as an alias that resolves to the same
 * handler, injects `params` on top of whatever the caller sent, and hands the
 * handler an explicit `mode`. Base URLs carry `mode: null`, so their existing
 * auto-detect behaviour is untouched. Every alias still records stats and
 * aggregates under the base `path`.
 */

import endpoints from '../apis/index.js';

function normalise(def) {
  const params = (def.params || []).map((p) => ({
    name: p.name,
    required: Boolean(p.required),
    placeholder: p.placeholder || `Enter ${p.name}`,
    type: p.type || 'text',
    default: p.default ?? '',
    desc: p.desc || '',
    // A `select` param carries its choices so the playground can render a dropdown.
    options: Array.isArray(p.options) ? p.options : null,
  }));

  // Sub-path aliases. Each becomes its own URL under the base path, carrying a
  // fixed `mode` + injected params. Kept off the catalog payload — the docs UI
  // still shows one card per endpoint; the aliases are just extra entry URLs.
  const routes = Array.isArray(def.routes)
    ? def.routes.map((r) => ({
        suffix: String(r.suffix || '').replace(/^\/+|\/+$/g, ''),
        mode: r.mode ?? null,
        params: r.params || {},
      }))
    : [];

  return {
    ...def,
    method: (def.method || 'GET').toUpperCase(),
    params,
    routes,
    responseType: def.responseType || 'json',
    ui: def.ui || null,
    example: def.example || null,
    slug: def.path.replace(/^\/v1\//, '').replace(/\//g, '-'),
  };
}

const list = endpoints.map(normalise).sort((a, b) => {
  if (a.category === b.category) return a.name.localeCompare(b.name);
  return a.category.localeCompare(b.category);
});

const byPath = new Map(list.map((e) => [e.path, e]));

// Alias table: sub-path URL → { endpoint, mode, inject }. The base URL of every
// endpoint is registered here too (mode null, nothing injected) so match() has
// a single lookup and dispatch always gets the same shape back.
const byRoute = new Map();
for (const e of list) {
  byRoute.set(e.path, { endpoint: e, mode: null, inject: {} });
  for (const r of e.routes) {
    if (!r.suffix) continue;
    byRoute.set(`${e.path}/${r.suffix}`, { endpoint: e, mode: r.mode, inject: r.params });
  }
}

/**
 * Resolve a pathname (trailing-slash tolerant) to an endpoint + routing context.
 * Returns { endpoint, mode, inject } or null. `mode` is the sub-path's declared
 * mode (null for a base URL); `inject` are params the sub-path forces on.
 */
export function match(pathname) {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return byRoute.get(clean) || null;
}

/** Everything the UI needs — handlers stripped out. */
export function catalog() {
  const categories = new Map();

  for (const e of list) {
    if (!categories.has(e.category)) categories.set(e.category, []);
    categories.get(e.category).push({
      name: e.name,
      desc: e.desc,
      category: e.category,
      path: e.path,
      method: e.method,
      params: e.params,
      responseType: e.responseType,
      ui: e.ui,
      example: e.example,
      slug: e.slug,
    });
  }

  return {
    total: list.length,
    categories: [...categories.entries()].map(([name, items]) => ({ name, items })),
  };
}

export const all = list;
