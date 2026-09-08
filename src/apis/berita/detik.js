import { newsFeed } from './_news.js';

/** Upstream path is typo'd as beritaa/detik — keep as-is. */
export default newsFeed({
  name: 'Detik News',
  desc: 'Berita terkini dari Detik',
  path: '/v1/berita/detik',
  upstream: '/beritaa/detik',
});
