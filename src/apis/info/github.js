import { ok, fail } from '../../lib/respond.js';
import { fetchJSON } from '../../lib/http.js';

/**
 * Public profile + top repositories for a GitHub username.
 */
export default {
  name: 'GitHub Profile',
  desc: 'Profil dan repo populer dari user GitHub',
  category: 'Information',
  path: '/v1/info/github',
  method: 'GET',
  params: [{ name: 'username', required: true, placeholder: 'Enter GitHub username' }],

  async handler({ params }) {
    const user = encodeURIComponent(params.username);
    const headers = { accept: 'application/vnd.github+json' };

    const [profile, repos] = await Promise.all([
      fetchJSON(`https://api.github.com/users/${user}`, { headers }),
      fetchJSON(`https://api.github.com/users/${user}/repos?sort=updated&per_page=6`, { headers }),
    ]);

    if (!profile.ok || !profile.data?.login) return fail('User GitHub tidak ditemukan', 404);

    const p = profile.data;

    return ok({
      username: p.login,
      name: p.name,
      bio: p.bio,
      avatar: p.avatar_url,
      company: p.company,
      location: p.location,
      blog: p.blog,
      followers: p.followers,
      following: p.following,
      public_repos: p.public_repos,
      created_at: p.created_at,
      repositories: (Array.isArray(repos.data) ? repos.data : []).map((r) => ({
        name: r.name,
        description: r.description,
        language: r.language,
        stars: r.stargazers_count,
        forks: r.forks_count,
        url: r.html_url,
        updated_at: r.updated_at,
      })),
    });
  },
};
