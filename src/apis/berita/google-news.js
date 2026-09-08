import { newsFeed } from './_news.js';

export default newsFeed({
  name: 'Google News',
  desc: 'Berita terkini dari Google News',
  path: '/v1/berita/google-news',
  upstream: '/berita/google-news',
});
