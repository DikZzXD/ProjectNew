import { linkDownload } from './_link.js';

export default linkDownload({
  name: 'YT Mp3',
  desc: 'Download audio MP3 dari link YouTube',
  path: '/v1/download/yt-mp3',
  upstream: '/download/ytmp3',
});
