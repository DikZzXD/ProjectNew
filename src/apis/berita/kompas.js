import { newsFeed } from './_news.js';

export default newsFeed({
  name: 'Kompas News',
  desc: 'Berita terkini dari Kompas',
  path: '/v1/berita/kompas',
  upstream: '/news/kompas',
});
