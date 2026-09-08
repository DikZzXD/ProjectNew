import { ok } from '../../lib/respond.js';

/**
 * Health probe — confirms the edge is reachable and reports which colo
 * answered. Handy as the first call when debugging an integration.
 */
export default {
  name: 'Ping',
  desc: 'Cek koneksi dan lokasi edge yang melayani',
  category: 'Tools',
  path: '/v1/tools/ping',
  method: 'GET',
  params: [],

  async handler({ request }) {
    const cf = request.cf || {};

    return ok({
      pong: true,
      colo: cf.colo || 'LOCAL',
      city: cf.city || '--',
      country: cf.country || request.headers.get('cf-ipcountry') || '--',
      protocol: cf.httpProtocol || '--',
      time: new Date().toISOString(),
    });
  },
};
