import { newsFeed } from './_news.js';

export default newsFeed({
  name: 'CNBC Indo',
  desc: 'Berita terkini dari CNBC Indonesia',
  path: '/v1/berita/cnbc',
  upstream: '/news/cnbc',
});
