import { ok, fail } from '../../lib/respond.js';
import { json, ProxyError } from '../../lib/ikyy.js';
import { qs } from '../../lib/http.js';

/**
 * Free Fire (Epep) profile lookup by UID.
 *
 * Upstream returns the profile under `data` (not `result`), stamped with its own
 * `creator` — so json() is told to unwrap `data`, and only the fields we care
 * about are re-emitted under this API's envelope.
 */
export default {
  name: 'Epep Stalk',
  desc: 'Info akun Free Fire dari UID — level, rank, guild, likes',
  category: 'Stalker',
  path: '/v1/stalk/epepid',
  method: 'GET',
  example: '/v1/stalk/epepid?uid=822355534',
  params: [
    {
      name: 'uid',
      required: true,
      type: 'number',
      placeholder: 'UID Free Fire',
      desc: 'UID numerik akun Free Fire',
    },
  ],

  async handler({ params }) {
    const uid = String(params.uid).trim();

    if (!/^\d{4,15}$/.test(uid)) {
      return fail('UID Free Fire harus berupa angka (4–15 digit)');
    }

    let data;
    try {
      data = await json(`/stalk/epepid?${qs({ uid })}`, 30000, 'data');
    } catch (error) {
      if (error instanceof ProxyError) {
        const missing = /internal server error|not found/i.test(error.message);
        return missing
          ? fail(`Akun dengan UID "${uid}" tidak ditemukan`, 404)
          : fail(error.message, error.status);
      }
      throw error;
    }

    return ok({
      uid: String(data.uid || uid),
      name: data.name || null,
      level: Number(data.level) || null,
      region: data.region || null,
      likes: Number(data.likes) || 0,
      br_rank_point: Number(data.br_rank_point) || 0,
      cs_rank_point: Number(data.cs_rank_point) || 0,
      guild_name: data.guild_name || null,
      banner_image: data.banner_image || null,
      created_at: data.created_at || null,
      last_login: data.last_login || null,
    });
  },
};
