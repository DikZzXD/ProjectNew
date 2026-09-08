import { ok, fail } from '../../lib/respond.js';
import { payload, ProxyError } from '../../lib/ikyy.js';
import { qs } from '../../lib/http.js';

/** Jadwal acara TV berdasarkan nama channel. */
export default {
  name: 'Jadwal Televisi',
  desc: 'Jadwal acara TV hari ini berdasarkan channel (indosiar, sctv, …)',
  category: 'Info',
  path: '/v1/info/jadwal-tv',
  method: 'GET',
  example: '/v1/info/jadwal-tv?channel=indosiar',
  params: [
    {
      name: 'channel',
      required: true,
      placeholder: 'indosiar',
      desc: 'Nama channel TV',
    },
  ],

  async handler({ params }) {
    const channel = String(params.channel || '').trim();
    if (!channel) return fail('Parameter "channel" wajib diisi');

    try {
      const body = await payload(`/info/jadwaltv?${qs({ channel })}`, { timeoutMs: 30000 });
      const items = body.data || body.result || [];
      if (!Array.isArray(items) || !items.length) {
        return fail('Jadwal tidak ditemukan untuk channel ini', 404);
      }
      return ok({
        channel: body.channel || channel,
        items,
        timestamp: body.timestamp || null,
      });
    } catch (error) {
      if (error instanceof ProxyError) return fail(error.message, error.status);
      throw error;
    }
  },
};
