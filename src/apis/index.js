/**
 * Endpoint index.
 *
 * The Workers bundler resolves imports statically, so each endpoint gets one
 * line here. Adding an API = create the file, add the import, add it to the
 * array. `npm run new` does both steps for you.
 */

// ── AI ────────────────────────────────────────────────────────
import llama from './ai/llama.js';
import mistral from './ai/mistral.js';
import dola from './ai/dola.js';
import chat from './ai/chat.js';
import translate from './ai/translate.js';

// ── Image Generator ───────────────────────────────────────────
import text2img from './image/text2img.js';

// ── Canvas ────────────────────────────────────────────────────
import bratBahlil from './canvas/brat-bahlil.js';
import brat from './canvas/brat.js';
import bratVideo from './canvas/brat-video.js';

// ── Random ────────────────────────────────────────────────────
import cecanChina from './random/cecan-china.js';
import cecanIndonesia from './random/cecan-indonesia.js';
import cecanJapan from './random/cecan-japan.js';
import cecanKorea from './random/cecan-korea.js';
import cecanMalaysia from './random/cecan-malaysia.js';
import cecanThailand from './random/cecan-thailand.js';
import cecanHijaber from './random/cecan-hijaber.js';

// ── Stalker ───────────────────────────────────────────────────
import robloxStalk from './stalk/roblox.js';
import epepStalk from './stalk/epepid.js';
import githubStalk from './stalk/github.js';
import tiktokStalk from './stalk/tiktok.js';
import instagramStalk from './stalk/instagram.js';

// ── Search ────────────────────────────────────────────────────
import ytplay from './search/ytplay.js';
import ytplayv2 from './search/ytplayv2.js';
import ytplayv3 from './search/ytplayv3.js';
import youtubeSearch from './search/youtube.js';
import pinterestSearch from './search/pinterest.js';

// ── Downloader ────────────────────────────────────────────────
import aio from './download/aio.js';
import appleMusic from './download/apple-music.js';
import capcut from './download/capcut.js';
import instagramDl from './download/instagram.js';
import jadwalSholat from './download/jadwal-sholat.js';
import spotifyDl from './download/spotify.js';
import tiktokDl from './download/tiktok.js';
import tiktokDlV2 from './download/tiktok-v2.js';
import tiktokDlV3 from './download/tiktok-v3.js';
import ytShorts from './download/yt-shorts.js';
import ytMp3 from './download/yt-mp3.js';

// ── Temp Mail ─────────────────────────────────────────────────
import tempmail from './tools/emailqu.js';
import mailedu from './tools/mailedu.js';

// ── Bypass ────────────────────────────────────────────────────
import turnstileMin from './bypass/turnstile-min.js';
import turnstileMinV2 from './bypass/turnstile-min-v2.js';
import turnstileMinV3 from './bypass/turnstile-min-v3.js';
import sfl from './bypass/sfl.js';

// ── Info / Information ────────────────────────────────────────
import cekGempa from './info/cek-gempa.js';
import infoCuaca from './info/cuaca.js';
import jadwalTv from './info/jadwal-tv.js';
import ytMetadata from './info/yt-metadata.js';
import weather from './info/weather.js';
import ip from './info/ip.js';
import currency from './info/currency.js';
import linkPreview from './info/link-preview.js';

// ── Berita ────────────────────────────────────────────────────
import beritaAntara from './berita/antara.js';
import beritaCnbc from './berita/cnbc.js';
import beritaCnn from './berita/cnn.js';
import beritaDetik from './berita/detik.js';
import beritaGoogle from './berita/google-news.js';
import beritaKompas from './berita/kompas.js';
import beritaOkezone from './berita/okezone.js';
import beritaTribun from './berita/tribun.js';

// ── Tools ─────────────────────────────────────────────────────
import alightmotion from './tools/alightmotion.js';
import nglSpam from './tools/ngl-spam.js';
import hash from './tools/hash.js';
import base64 from './tools/base64.js';
import qrcode from './tools/qrcode.js';
import uuid from './tools/uuid.js';
import password from './tools/password.js';
import ping from './tools/ping.js';
import ssweb from './tools/ssweb.js';
import encryptPython from './tools/encrypt-python.js';
import encryptJs from './tools/encrypt-js.js';
import encryptBase64 from './tools/encrypt-base64.js';
import decryptTool from './tools/decrypt.js';
import whatsappReact from './tools/whatsapp-react.js';
import detectOtpWhatsapp from './tools/detect-otp-whatsapp.js';
import ubotLogin from './tools/ubot-login.js';

export default [
  llama,
  mistral,
  dola,
  chat,
  translate,
  text2img,
  bratBahlil,
  brat,
  bratVideo,
  cecanChina,
  cecanIndonesia,
  cecanJapan,
  cecanKorea,
  cecanMalaysia,
  cecanThailand,
  cecanHijaber,
  robloxStalk,
  epepStalk,
  githubStalk,
  tiktokStalk,
  instagramStalk,
  ytplay,
  ytplayv2,
  ytplayv3,
  youtubeSearch,
  pinterestSearch,
  aio,
  appleMusic,
  capcut,
  instagramDl,
  jadwalSholat,
  spotifyDl,
  tiktokDl,
  tiktokDlV2,
  tiktokDlV3,
  ytShorts,
  ytMp3,
  tempmail,
  mailedu,
  turnstileMin,
  turnstileMinV2,
  turnstileMinV3,
  sfl,
  cekGempa,
  infoCuaca,
  jadwalTv,
  ytMetadata,
  weather,
  ip,
  currency,
  linkPreview,
  beritaAntara,
  beritaCnbc,
  beritaCnn,
  beritaDetik,
  beritaGoogle,
  beritaKompas,
  beritaOkezone,
  beritaTribun,
  alightmotion,
  nglSpam,
  hash,
  base64,
  qrcode,
  uuid,
  password,
  ping,
  ssweb,
  encryptPython,
  encryptJs,
  encryptBase64,
  decryptTool,
  whatsappReact,
  detectOtpWhatsapp,
  ubotLogin,
];
