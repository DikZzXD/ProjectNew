import { ok, fail } from '../../lib/respond.js';
import { json, ProxyError } from '../../lib/ikyy.js';
import { qs } from '../../lib/http.js';

/**
 * GitHub profile lookup.
 *
 * The upstream needs an API key; it's ours, so it's held server-side rather than
 * asked of the caller. The result is already snake_case and clean, so it's passed
 * straight through this API's envelope — only the upstream `creator` is dropped
 * (json() returns `result` alone).
 */
const APIKEY = 'kyzz';

export default {
  name: 'Github Stalk',
  desc: 'Info profil GitHub — repo, followers, bio, lokasi',
  category: 'Stalker',
  path: '/v1/stalk/github',
  method: 'GET',
  example: '/v1/stalk/github?user=sarperavci',
  params: [
    {
      name: 'user',
      required: true,
      placeholder: 'Username GitHub',
      desc: 'Username GitHub yang mau dilihat',
    },
  ],

  async handler({ params }) {
    const user = String(params.user).trim();

    if (!/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i.test(user)) {
      return fail('Username GitHub tidak valid');
    }

    let data;
    try {
      data = await json(`/stalk/github?${qs({ apikey: APIKEY, user })}`, 20000);
    } catch (error) {
      if (error instanceof ProxyError) {
        const missing = /not found|internal server error/i.test(error.message);
        return missing
          ? fail(`User GitHub "${user}" tidak ditemukan`, 404)
          : fail(error.message, error.status);
      }
      throw error;
    }

    return ok({
      username: data.username || user,
      name: data.name || null,
      bio: data.bio || null,
      company: data.company || null,
      location: data.location || null,
      email: data.email || null,
      blog: data.blog || null,
      twitter: data.twitter || null,
      public_repos: Number(data.public_repos) || 0,
      public_gists: Number(data.public_gists) || 0,
      followers: Number(data.followers) || 0,
      following: Number(data.following) || 0,
      created_at: data.created_at || null,
      updated_at: data.updated_at || null,
      avatar: data.avatar || null,
      profile_url: data.profile_url || `https://github.com/${user}`,
    });
  },
};
