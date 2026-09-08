/**
 * DikZzCodeAPIs — Cloudflare Worker entry point.
 *
 * Responsibilities, in order:
 *   1. CORS preflight
 *   2. Meta routes the docs UI consumes (/api/catalog, /api/stats, /api/system)
 *   3. Endpoint dispatch for /v1/* from the registry
 *   4. Anything else falls through to the static assets in public/
 *
 * Author: DikZzCode — t.me/maklohytam
 */

import { match, catalog } from './lib/registry.js';
import { collect, missingMessage } from './lib/params.js';
import { ok, fail, json, preflight, BRAND } from './lib/respond.js';
import { record, snapshot } from './lib/stats.js';
import { handleTelegram } from './lib/telegram.js';
import { runLiveLoops } from './lib/ubotloop.js';

// Date.now() returns 0 during module init on Workers, so the boot timestamp
// is captured on the first real request instead.
let BOOT = 0;

export default {
  async fetch(request, env, ctx) {
    if (!BOOT) BOOT = Date.now();

    const url = new URL(request.url);
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;

    if (request.method === 'OPTIONS') return preflight();

    // ── Meta routes ───────────────────────────────────────────
    if (path === '/api/catalog') {
      return json({ status: true, brand: BRAND, ...catalog() });
    }

    if (path === '/api/stats') {
      const data = await snapshot(env);
      return json({ status: true, endpoints: catalog().total, ...data });
    }

    if (path === '/api/system') {
      return json({ status: true, ...systemInfo(request) });
    }

    if (path === '/api/health') {
      return json({ status: true, uptime_ms: Date.now() - BOOT, endpoints: catalog().total });
    }

    // Telegram webhook (owner-only management bot; validated inside the handler).
    if (path === '/api/telegram' && request.method === 'POST') {
      return handleTelegram(request, env, ctx);
    }

    // ── Endpoint dispatch ─────────────────────────────────────
    if (path.startsWith('/v1/')) {
      return dispatch(request, env, ctx, path);
    }

    // ── Static docs UI ────────────────────────────────────────
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return fail('Not found', 404);
  },

  /**
   * Cron Trigger — starts the userbot's live loop.
   *
   * A cron invocation gets 15 minutes of wall time, so this does not poll once
   * and exit. It holds one Telegram connection open and watches for commands
   * continuously, which is what makes `.ping` answer in a second or two and lets
   * `.promosi` run unattended. See src/lib/ubotloop.js.
   *
   * The trigger fires every minute so a finished or crashed loop is picked up
   * again quickly; a D1 lease makes the ticks that land on an account already
   * being driven return immediately. The promise is awaited rather than passed to
   * `waitUntil`, because `waitUntil` only extends execution ~30 s past the
   * handler — far short of the loop's budget.
   */
  async scheduled(event, env, ctx) {
    try {
      await runLiveLoops(env);
    } catch {
      /* the next tick retries */
    }
  },
};

async function dispatch(request, env, ctx, path) {
  const route = match(path);

  if (!route) {
    return fail(`Endpoint "${path}" tidak ditemukan. Lihat daftar lengkap di https://api.makluxnxx.my.id`, 404);
  }

  const { endpoint, mode, inject } = route;

  if (endpoint.method !== request.method && request.method !== 'GET') {
    return fail(`Method ${request.method} tidak diizinkan, gunakan ${endpoint.method}`, 405);
  }

  const started = Date.now();
  let response;

  try {
    const { params, missing } = await collect(request, endpoint);

    // A sub-path forces its own params on top of whatever the caller sent, so
    // /encrypt-base64/text/download always packs-and-downloads regardless of body.
    Object.assign(params, inject);

    response = missing.length
      ? fail(missingMessage(missing), 400)
      : await endpoint.handler({ params, mode, env, request, ctx, url: new URL(request.url) });

    if (!(response instanceof Response)) {
      response = ok(response);
    }
  } catch (error) {
    response = fail(`Internal error: ${error?.message || 'unknown'}`, 500);
  }

  const elapsed = Date.now() - started;

  // Meter the payload on a clone so the client still gets an untouched body.
  const meter = response.body ? response.clone() : null;

  ctx.waitUntil(
    (async () => {
      let bytes = Number(response.headers.get('content-length')) || 0;
      if (!bytes && meter) {
        try {
          bytes = (await meter.arrayBuffer()).byteLength;
        } catch {
          bytes = 0;
        }
      }
      await record(env, {
        path: endpoint.path,
        name: endpoint.name,
        category: endpoint.category,
        method: request.method,
        status: response.status,
        bytes,
        ms: elapsed,
        country: request.headers.get('cf-ipcountry') || '--',
      });
    })()
  );

  const out = new Response(response.body, response);
  out.headers.set('x-response-time', `${elapsed}ms`);
  out.headers.set('x-powered-by', 'DikZzCodeAPIs - DikZzCode');
  return out;
}

/**
 * Workers have no process metrics, so the docs "RAM / CPU" cards report the
 * platform limits of the isolate plus the colo actually serving the request.
 */
function systemInfo(request) {
  const cf = request.cf || {};
  return {
    runtime: 'Cloudflare Workers',
    ram_mb: 128,
    ram_label: '128 MB',
    cpu_label: 'Edge Isolate',
    cpu_ms_limit: 30000,
    colo: cf.colo || 'LOCAL',
    city: cf.city || '--',
    country: cf.country || '--',
    region: 'Global Anycast',
    uptime_ms: Date.now() - BOOT,
    time: new Date().toISOString(),
  };
}
