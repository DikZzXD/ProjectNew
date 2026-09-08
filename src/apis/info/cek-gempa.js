import { ok, fail } from '../../lib/respond.js';
import { payload, ProxyError } from '../../lib/ikyy.js';

/** Gempa terkini BMKG via upstream Info/cekgempa. */
export default {
  name: 'Cek Gempa',
  desc: 'Info gempa bumi terkini (tanggal, magnitudo, wilayah, potensi)',
  category: 'Info',
  path: '/v1/info/cek-gempa',
  method: 'GET',
  example: '/v1/info/cek-gempa',
  params: [],

  async handler() {
    try {
      const data = await payload('/Info/cekgempa', { timeoutMs: 30000, key: 'data' });
      return ok(data);
    } catch (error) {
      if (error instanceof ProxyError) return fail(error.message, error.status);
      throw error;
    }
  },
};
