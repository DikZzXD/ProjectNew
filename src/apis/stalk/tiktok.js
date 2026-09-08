import { ok, fail } from '../../lib/respond.js';
import { json, ProxyError } from '../../lib/ikyy.js';

/**
 * TikTok profile lookup by username.
 *
 * Upstream carries the payload under `data` (a search wrapper with a `users[]`
 * list, each entry `{ user, stats }`), stamped with its own `creator`. We unwrap
 * `data`, then return ONLY the user whose `uniqueId` matches the searched
 * username exactly — the search can surface near-matches we don't want. Nothing
 * foreign leaks: only the fields below are re-emitted under this API's envelope.
 */
export default {
  name: 'TikTok Stalk',
  desc: 'Info profil TikTok — nickname, followers, likes, foto',
  category: 'Stalker',
  path: '/v1/stalk/tiktok',
  method: 'GET',
  example: '/v1/stalk/tiktok?username=maklohytam',
  params: [
    {
      name: 'username',
      required: true,
      placeholder: 'Username TikTok (tanpa @)',
      desc: 'Username persis, bukan nama tampilan',
    },
  ],

  async handler({ params }) {
    const username = String(params.username ?? '')
      .trim()
      .replace(/^@/, '');

    if (!/^[a-z0-9._]{2,24}$/i.test(username)) {
      return fail('Username TikTok hanya huruf/angka/titik/underscore, panjang 2–24 karakter');
    }

    let data;
    try {
      data = await json(`/stalk/tiktok?username=${encodeURIComponent(username)}`, 30000, 'data');
    } catch (error) {
      if (error instanceof ProxyError) {
        const missing = /not found|no result|internal server error|404/i.test(error.message);
        return missing
          ? fail(`Akun TikTok "${username}" tidak ditemukan`, 404)
          : fail(error.message, error.status);
      }
      throw error;
    }

    const users = Array.isArray(data.users) ? data.users : [];
    // The search returns near-matches; take only the exact uniqueId.
    const target = username.toLowerCase();
    const match = users.find((u) => String(u?.user?.uniqueId || '').toLowerCase() === target);

    if (!match) return fail(`Akun TikTok "${username}" tidak ditemukan`, 404);

    const user = match.user || {};
    const stats = match.stats || {};

    return ok({
      id: user.id || null,
      username: user.uniqueId || username,
      nickname: user.nickname || null,
      signature: user.signature || null,
      region: user.region || null,
      verified: Boolean(user.verified),
      private: Boolean(user.privateAccount),
      avatar: user.avatarLarger || user.avatarMedium || user.avatarThumb || null,
      stats: {
        followers: Number(stats.followerCount) || 0,
        following: Number(stats.followingCount) || 0,
        likes: Number(stats.heartCount ?? stats.heart) || 0,
        videos: Number(stats.videoCount) || 0,
      },
      profile_url: `https://www.tiktok.com/@${user.uniqueId || username}`,
    });
  },
};
