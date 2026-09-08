import { linkDownload } from './_link.js';

export default linkDownload({
  name: 'Spotify',
  desc: 'Download / ekstrak dari link Spotify',
  path: '/v1/download/spotify',
  upstream: '/download/spotifydl',
});
