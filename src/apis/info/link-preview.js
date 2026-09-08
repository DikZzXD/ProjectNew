import { ok, fail } from '../../lib/respond.js';
import { fetchWithTimeout } from '../../lib/http.js';

const TITLE = /<title[^>]*>([\s\S]*?)<\/title>/i;

function meta(html, attr, value) {
  const re = new RegExp(`<meta[^>]+${attr}=["']${value}["'][^>]+content=["']([^"']*)["']`, 'i');
  const alt = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+${attr}=["']${value}["']`, 'i');
  return (html.match(re) || html.match(alt) || [])[1] || null;
}

function decode(text) {
  if (!text) return text;
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .trim();
}

/**
 * Scrape Open Graph / meta tags from any public URL — handy for link previews.
 */
export default {
  name: 'Link Preview',
  desc: 'Ambil judul, deskripsi, dan thumbnail dari sebuah URL',
  category: 'Information',
  path: '/v1/info/link-preview',
  method: 'GET',
  params: [{ name: 'url', required: true, placeholder: 'Enter URL (https://...)' }],

  async handler({ params }) {
    let target;
    try {
      target = new URL(params.url);
      if (!/^https?:$/.test(target.protocol)) throw new Error('protocol');
    } catch {
      return fail('URL tidak valid, gunakan http:// atau https://');
    }

    let res;
    try {
      res = await fetchWithTimeout(target.toString(), { headers: { accept: 'text/html' } }, 12000);
    } catch {
      return fail('Tidak bisa menjangkau URL tersebut', 502);
    }

    // Cap the read so a huge page can't blow the isolate's memory budget.
    const html = (await res.text()).slice(0, 300000);

    return ok({
      url: target.toString(),
      status: res.status,
      site: decode(meta(html, 'property', 'og:site_name')) || target.hostname,
      title: decode(meta(html, 'property', 'og:title')) || decode((html.match(TITLE) || [])[1]) || null,
      description:
        decode(meta(html, 'property', 'og:description')) || decode(meta(html, 'name', 'description')) || null,
      image: decode(meta(html, 'property', 'og:image')) || null,
      type: decode(meta(html, 'property', 'og:type')) || null,
    });
  },
};
