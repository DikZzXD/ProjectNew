import { newsFeed } from './_news.js';

export default newsFeed({
  name: 'CNN Indo',
  desc: 'Berita terkini dari CNN Indonesia',
  path: '/v1/berita/cnn',
  upstream: '/berita/cnn',
});
