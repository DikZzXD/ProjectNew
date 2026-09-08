import { linkDownload } from './_link.js';

export default linkDownload({
  name: 'Instagram',
  desc: 'Download media Instagram dari link post/reel',
  path: '/v1/download/instagram',
  upstream: '/download/igv2',
});
