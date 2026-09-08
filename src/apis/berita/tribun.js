import { newsFeed } from './_news.js';

export default newsFeed({
  name: 'Tribun News',
  desc: 'Berita terkini dari Tribun',
  path: '/v1/berita/tribun',
  upstream: '/berita/tribun',
});
