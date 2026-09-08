import { newsFeed } from './_news.js';

export default newsFeed({
  name: 'OkeZone Nasional',
  desc: 'Berita terkini dari Okezone',
  path: '/v1/berita/okezone',
  upstream: '/news/okezone',
});
