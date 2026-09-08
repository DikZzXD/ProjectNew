import { newsFeed } from './_news.js';

export default newsFeed({
  name: 'Antara',
  desc: 'Berita terkini dari Antara News',
  path: '/v1/berita/antara',
  upstream: '/news/antara',
});
