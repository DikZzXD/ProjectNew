import { ok, fail } from '../../lib/respond.js';
import { json, ProxyError } from '../../lib/ikyy.js';
import { qs } from '../../lib/http.js';

/**
 * Roblox profile lookup.
 *
 * The upstream payload is reshaped rather than passed through: its keys are
 * mixed camelCase, the friend entries arrive with empty `name`/`displayName`
 * strings, and "Tidak tersedia" is used where a null belongs. Cleaning that up
 * here keeps the response consistent with the rest of this API.
 */
export default {
  name: 'Roblox Stalk',
  desc: 'Info akun Roblox — profil, status online, teman, badge',
  category: 'Stalker',
  path: '/v1/stalk/roblox',
  method: 'GET',
  params: [
    {
      name: 'username',
      required: true,
      placeholder: 'Username Roblox',
      desc: 'Username, bukan display name',
    },
  ],

  async handler({ params }) {
    const username = String(params.username).trim();

    if (!/^[a-z0-9_]{3,20}$/i.test(username)) {
      return fail('Username Roblox hanya huruf/angka/underscore, panjang 3–20 karakter');
    }

    let data;
    try {
      data = await json(`/stalk/roblox?${qs({ username })}`, 30000);
    } catch (error) {
      if (error instanceof ProxyError) {
        // Upstream answers 500 for a name that doesn't exist, which reads as our
        // bug unless it's translated into the 404 it actually is.
        const missing = /internal server error/i.test(error.message);
        return missing
          ? fail(`Akun "${username}" tidak ditemukan`, 404)
          : fail(error.message, error.status);
      }
      throw error;
    }

    const account = data.account || {};
    const presence = data.presence || {};
    const stats = data.stats || {};

    return ok({
      username: account.username || username,
      display_name: account.displayName || null,
      profile_picture: account.profilePicture || null,
      description: account.description || null,
      created_at: account.created || null,
      verified: Boolean(account.hasVerifiedBadge),
      banned: Boolean(account.isBanned),
      presence: {
        online: Boolean(presence.isOnline),
        // Upstream writes "Tidak tersedia" instead of leaving the field empty.
        last_online: clean(presence.lastOnline),
        recent_activity: clean(presence.recentGame),
      },
      stats: {
        friends: Number(stats.friendCount) || 0,
        followers: Number(stats.followers) || 0,
        following: Number(stats.following) || 0,
      },
      badges: (Array.isArray(data.badges) ? data.badges : []).map((b) => ({
        id: b.id ?? null,
        name: b.name || null,
        description: b.description || null,
        image: b.imageUrl || b.image || null,
      })),
      friends: (Array.isArray(data.friendList) ? data.friendList : []).map((f) => ({
        id: f.id ?? null,
        // These come back as empty strings from upstream, so null is honest.
        username: f.name || null,
        display_name: f.displayName || null,
        profile_picture: f.profilePicture || null,
        profile_url: f.id ? `https://www.roblox.com/users/${f.id}/profile` : null,
      })),
      profile_url: `https://www.roblox.com/users/profile?username=${encodeURIComponent(
        account.username || username
      )}`,
    });
  },
};

/** Turn upstream's placeholder strings into a real null. */
function clean(value) {
  const text = String(value ?? '').trim();
  if (!text || /^(tidak tersedia|unknown|n\/a|-)$/i.test(text)) return null;
  return text;
}
