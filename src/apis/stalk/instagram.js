import { ok, fail } from '../../lib/respond.js';
import { json, ProxyError } from '../../lib/ikyy.js';

/**
 * Instagram profile lookup by username.
 *
 * Upstream carries the profile under `result` and stamps its own `creator`;
 * json() returns `result` alone, so that is dropped, and only the fields below
 * are re-emitted under this API's own envelope.
 */
export default {
  name: 'Instagram Stalk',
  desc: 'Info profil Instagram — bio, followers, foto, status akun',
  category: 'Stalker',
  path: '/v1/stalk/instagram',
  method: 'GET',
  example: '/v1/stalk/instagram?username=dikzxnxx_',
  params: [
    {
      name: 'username',
      required: true,
      placeholder: 'Username Instagram (tanpa @)',
      desc: 'Username akun Instagram',
    },
  ],

  async handler({ params }) {
    const username = String(params.username ?? '')
      .trim()
      .replace(/^@/, '');

    if (!/^[a-z0-9._]{1,30}$/i.test(username)) {
      return fail('Username Instagram hanya huruf/angka/titik/underscore, maksimal 30 karakter');
    }

    let data;
    try {
      data = await json(`/stalk/igv2?username=${encodeURIComponent(username)}`, 30000);
    } catch (error) {
      if (error instanceof ProxyError) {
        const missing = /not found|no result|internal server error|404/i.test(error.message);
        return missing
          ? fail(`Akun Instagram "${username}" tidak ditemukan`, 404)
          : fail(error.message, error.status);
      }
      throw error;
    }

    const stats = data.stats || {};
    const info = data.info || {};
    const profile = data.profile || {};
    const category = info.category && info.category !== 'N/A' ? info.category : null;

    return ok({
      user_id: data.user_id || null,
      username: data.username || username,
      full_name: data.full_name || null,
      bio: data.bio || null,
      profile_picture: profile.images || null,
      stats: {
        followers: Number(stats.followers) || 0,
        following: Number(stats.following) || 0,
        posts: Number(stats.posts) || 0,
      },
      info: {
        private: Boolean(info.private),
        verified: Boolean(info.verified),
        business: Boolean(info.business),
        category,
      },
      profile_url: `https://www.instagram.com/${data.username || username}`,
    });
  },
};
