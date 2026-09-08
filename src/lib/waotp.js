/**
 * WhatsApp OTP cooldown detector.
 *
 * Every call to WhatsApp's /v2/code registration endpoint doubles as a cooldown
 * probe: the reply carries sms_wait / voice_wait / wa_old_wait / email_otp_wait
 * (seconds until that delivery method may be requested again, 0 = free now,
 * -1 = server disabled the method) plus a verdict for the number itself
 * (too_recent, too_many, no_routes, blocked, or status "sent").
 *
 * The request must look like a fresh iOS registration attempt, so each probe
 * generates a throwaway Curve25519 identity/noise/signed-prekey set. The `token`
 * is md5(secret + md5(VERSION) + national_number) — the formula from Baileys
 * commit #290, where the "package md5" turned out to be md5 of the version
 * STRING, not a hash of the IPA file.
 *
 * Pure JS: node:crypto for md5/random bytes, curve25519-js for the keypairs,
 * libphonenumber-js for cc/national-number splitting — all safe inside Workers.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { generateKeyPair, sign } from 'curve25519-js';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { fetchWithTimeout } from './http.js';
import { proxiedGet } from './waproxy.js';

const WA_VERSION_DEFAULT = '2.26.33.73';
const WA_SECRET = '0a1mLfGUIBVrMKF1RdvLI5lkRBvof6vn0fD2QRSM';
const CODE_URL = 'https://v.whatsapp.net/v2/code';

/** Delivery methods the upstream accepts for a code request. */
export const WA_OTP_METHODS = ['sms', 'voice', 'wa_old'];

/**
 * UA diacak tiap probe. Kalau semua request datang dengan device+iOS yang
 * identik, fingerprint "satu device menembak banyak nomor" gampang di-flag dan
 * upstream membalas placeholder, bukan cooldown asli.
 */
const DEVICE_IOS = [
  'Apple-iPhone_12',
  'Apple-iPhone_13',
  'Apple-iPhone_13_Pro',
  'Apple-iPhone_14',
  'Apple-iPhone_14_Pro',
  'Apple-iPhone_15',
  'Apple-iPhone_15_Pro',
  'Apple-iPhone_SE_3',
];
const VERSI_IOS = ['16.7.8', '17.5.1', '17.6.1', '18.0', '18.1.1'];
const acak = (arr) => arr[Math.floor(Math.random() * arr.length)];

export class WaOtpError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'WaOtpError';
    this.status = status;
  }
}

const md5 = (text) => createHash('md5').update(text).digest('hex');

/** base64url without padding, from raw bytes (no Buffer needed). */
function b64url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** token = md5(secret + md5(version) + national_number). */
const buatToken = (version, nomor) => md5(WA_SECRET + md5(version) + nomor);

const buatKeyPair = () => {
  const kp = generateKeyPair(randomBytes(32));
  return { private: kp.private, public: kp.public };
};

/** Signal-format public key: 0x05 prefix when the raw key is 32 bytes. */
const pubKeySignal = (p) => (p.length === 33 ? p : new Uint8Array([5, ...p]));

const signedPreKey = (identityKey) => {
  const preKey = buatKeyPair();
  return { keyPair: preKey, signature: sign(identityKey.private, pubKeySignal(preKey.public)) };
};

/**
 * Split a user-supplied number into WhatsApp's cc / national-number pair.
 * Accepts "+62...", "62...", "62-8xx" — anything libphonenumber can parse.
 *
 * Uses Google's libphonenumber metadata, not the leaner `phone` package:
 * `phone` carries a much smaller ruleset and rejects real numbers for whole
 * prefixes (e.g. Sudan +249 12x and Mali +223 fixed lines), which made the
 * endpoint report valid numbers as invalid. Parsing only needs to produce the
 * cc/national split here — WhatsApp itself is the authority on whether a
 * number can receive an OTP, so the local `valid` flag is informational.
 */
export function parseWaNumber(input) {
  const cleaned = String(input || '').replace(/[^\d+]/g, '');
  const text = cleaned.startsWith('+') ? cleaned : `+${cleaned.replace(/\+/g, '')}`;
  const parsed = parsePhoneNumberFromString(text);

  if (!parsed || !parsed.countryCallingCode || !parsed.nationalNumber) {
    throw new WaOtpError(`Nomor "${input}" tidak valid atau tidak dikenali sebagai nomor telepon`);
  }

  return {
    cc: parsed.countryCallingCode,
    national: parsed.nationalNumber,
    e164: parsed.number,
    country: parsed.country || null,
    valid: parsed.isValid(),
  };
}

/**
 * Build the /v2/code URL + iOS headers. Transport-agnostic: the same request
 * is sent either directly via fetch() or through a proxy tunnel (waproxy.js).
 */
function buildCodeRequest({ cc, national, method, version }) {
  const identityKey = buatKeyPair();
  const noiseKey = buatKeyPair();
  const signed = signedPreKey(identityKey);

  // registration id: one random byte masked to 14 bits, big-endian int32
  const regId = new Uint8Array(4);
  new DataView(regId.buffer).setInt32(0, randomBytes(1)[0] & 16383);

  const params = {
    cc,
    in: national,
    lg: 'en',
    lc: 'GB',
    mistyped: '6',
    authkey: b64url(noiseKey.public),
    e_regid: b64url(regId),
    e_keytype: 'BQ',
    e_ident: b64url(identityKey.public),
    e_skey_id: b64url(new Uint8Array([0, 1, 0])),
    e_skey_val: b64url(signed.keyPair.public),
    e_skey_sig: b64url(signed.signature),
    fdid: randomUUID(),
    expid: b64url(randomBytes(16)),
    network_radio_type: '1',
    simnum: '1',
    hasinrc: '1',
    pid: String(Math.floor(Math.random() * 9000) + 1000),
    rc: '0',
    id: b64url(randomBytes(20)),
    token: buatToken(version, national),
    method,
  };

  return {
    url: `${CODE_URL}?${new URLSearchParams(params).toString()}`,
    headers: {
      'User-Agent': `WhatsApp/${version} iOS/${acak(VERSI_IOS)} Device/${acak(DEVICE_IOS)}`,
      Accept: 'text/json',
    },
  };
}

/**
 * Direct transport. Retries once — the upstream occasionally answers a bare
 * "404 Not Found" page instead of JSON.
 */
async function requestDirect(url, headers) {
  for (let attempt = 1; ; attempt += 1) {
    let text;
    try {
      const res = await fetchWithTimeout(url, { headers }, 12000);
      text = await res.text();
    } catch {
      if (attempt >= 2) throw new WaOtpError('Tidak bisa menghubungi server WhatsApp, coba lagi sebentar', 502);
      continue;
    }
    try {
      return JSON.parse(text);
    } catch {
      if (attempt >= 2) {
        throw new WaOtpError('Server WhatsApp tidak merespons dengan benar (respons bukan JSON), coba lagi', 502);
      }
    }
  }
}

/**
 * Proxy transport: one GET through the tunnel; non-JSON or transport errors bubble up.
 *
 * Budget 8 detik: exit residential yang sehat balas < 3 detik, sisanya lebih
 * baik cepat menyerah supaya slot balapan bisa dipakai exit berikutnya.
 */
async function requestViaProxy(proxyUrl, url, headers) {
  const { status, text } = await proxiedGet(proxyUrl, url, headers, 8000);
  if (status !== 200) throw new Error(`upstream HTTP ${status}`);
  return JSON.parse(text);
}

/** Parse WA_PROXIES (one socks5:// or http:// URI per line) into a list. */
export function parseProxyList(raw) {
  return String(raw || '')
    .split(/[\r\n,]+/)
    .map((s) => s.trim())
    .filter((s) => /^(https?|socks5):\/\//.test(s));
}

/** Human label for which exit served the probe, credentials masked. */
function describeProxy(proxyUrl) {
  try {
    const u = new URL(proxyUrl);
    const user = decodeURIComponent(u.username || '');
    const zone = user.match(/_zone_([A-Z]+)_/)?.[1];
    const sid = user.match(/_sid_(\d+)_/)?.[1];
    const label = [zone, sid ? `sid_${sid}` : null].filter(Boolean).join(' ');
    return `proxy ${u.hostname} ${label || user.slice(0, 4) + '***'}`.trim();
  } catch {
    return 'proxy (URI tidak terbaca)';
  }
}

/** Human-readable cooldown text: -1 = disabled, 0 = free now, otherwise h/m. */
export function humanWait(seconds) {
  if (!Number.isFinite(seconds)) return null;
  if (seconds < 0) return 'tidak tersedia (method dinonaktifkan server)';
  if (seconds === 0) return 'boleh minta sekarang';
  if (seconds < 60) return `${seconds} detik`;
  const jam = Math.floor(seconds / 3600);
  const menit = Math.floor((seconds % 3600) / 60);
  return jam ? `${jam} jam ${menit} menit` : `${menit} menit`;
}

const waitField = (seconds) =>
  Number.isFinite(seconds) ? { seconds, human: humanWait(seconds) } : null;

/**
 * Jawaban yang benar-benar berisi cooldown nomor, bukan placeholder rate-limit.
 *
 * WhatsApp membalas `no_routes` + semua *_wait = 3600 untuk IP yang dianggap
 * kotor (egress datacenter, exit yang sudah kebanyakan probe). Itu properti
 * IP-nya, bukan properti nomornya, jadi hasil begitu tidak boleh dipakai —
 * lebih baik lanjut ke exit berikutnya. `blocked` juga IP-scoped di sini:
 * exit yang sama membalas blocked untuk nomor yang exit lain bilang too_recent.
 */
function jawabanAsli(raw) {
  if (!raw || typeof raw !== 'object') return false;
  if (raw.reason === 'no_routes' || raw.reason === 'blocked') return false;
  return Number.isFinite(raw.sms_wait) || raw.status === 'sent';
}

/**
 * Balapkan beberapa proxy sekaligus, menangkan yang pertama membalas jawaban
 * asli. Begitu satu exit menang, sisanya diabaikan.
 *
 * `buatBerkas(px)` dipanggil tepat saat exit itu mau dipakai, bukan di muka:
 * tiap berkas berisi sepasang keypair curve25519 baru, dan membuat semuanya
 * sekaligus untuk 20+ exit membakar CPU budget Worker tanpa guna karena
 * balapan biasanya berhenti setelah beberapa exit pertama.
 *
 * Kenapa paralel, bukan berurutan: satu exit residential butuh ~1-3 detik dan
 * mayoritas exit membalas placeholder, jadi mode berurutan hampir selalu
 * kehabisan waktu sebelum ketemu exit bersih. `lebar` ditahan di 5 karena
 * Workers cuma mengizinkan 6 koneksi keluar bersamaan per request.
 */
async function balapProxy(daftarProxy, buatBerkas, lebar = 5) {
  let indeks = 0;
  let cadangan = null; // hasil placeholder terakhir, dipakai kalau tak ada yang asli

  return new Promise((selesaikan) => {
    let aktif = 0;
    let sudahSelesai = false;

    const majukan = () => {
      if (sudahSelesai) return;

      while (aktif < lebar && indeks < daftarProxy.length) {
        const px = daftarProxy[indeks++];
        const { url, headers } = buatBerkas(px);
        aktif += 1;

        requestViaProxy(px, url, headers)
          .then((raw) => {
            if (sudahSelesai) return;
            if (jawabanAsli(raw)) {
              sudahSelesai = true;
              selesaikan({ raw, via: describeProxy(px) });
              return;
            }
            cadangan ||= { raw, via: `${describeProxy(px)} — jawaban generik` };
          })
          .catch((e) => {
            console.log('[waotp] proxy gagal:', describeProxy(px), '→', e?.message || e);
          })
          .finally(() => {
            aktif -= 1;
            majukan();
          });
      }

      // Antrian habis dan tidak ada request yang masih jalan.
      if (!sudahSelesai && aktif === 0 && indeks >= daftarProxy.length) {
        sudahSelesai = true;
        selesaikan(cadangan);
      }
    };

    majukan();
  });
}

/**
 * Full detection for one number: cooldown per delivery method, block status,
 * and the raw upstream verdict. Throws WaOtpError on invalid input or an
 * unreachable upstream; every upstream verdict (even "blocked") is a result.
 *
 * When env.WA_PROXIES is set (one socks5:// or http:// URI per line) the probe
 * goes out through residential exits — WhatsApp blankets datacenter egress IPs
 * with a generic no_routes + 3600 answer, so only a clean residential exit
 * reads real per-number cooldowns. Exits are raced (see balapProxy) and the
 * first genuine answer wins; if every exit only returns the generic answer we
 * surface the last one and say so in `via`.
 */
export async function detectWaOtp({ number, method = 'sms', env }) {
  const version = env?.WA_VERSION || WA_VERSION_DEFAULT;
  const target = parseWaNumber(number);

  const proxies = parseProxyList(env?.WA_PROXIES);
  let raw = null;
  let via = 'langsung (tanpa proxy)';

  if (proxies.length) {
    // Acak urutan supaya exit yang sama tidak selalu kena giliran pertama —
    // exit yang terlalu sering dipakai lebih cepat dianggap kotor upstream.
    const urutan = [...proxies];
    for (let i = urutan.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [urutan[i], urutan[j]] = [urutan[j], urutan[i]];
    }

    // Tiap percobaan proxy pakai identitas device baru: kalau query string
    // (fdid/expid/keypair) diulang persis dari IP berbeda, upstream membaca
    // pola itu sebagai replay dan balik ke jawaban generik.
    const lebar = Number(env?.WA_PROXY_LEBAR) || 5;
    const hasil = await balapProxy(
      urutan,
      () => buildCodeRequest({ cc: target.cc, national: target.national, method, version }),
      lebar
    );
    if (hasil) {
      raw = hasil.raw;
      via = hasil.via;
    } else {
      via = 'langsung (semua proxy gagal, fallback)';
    }
  }

  if (!raw) {
    const { url, headers } = buildCodeRequest({
      cc: target.cc,
      national: target.national,
      method,
      version,
    });
    raw = await requestDirect(url, headers);
  }

  const waitKeys = ['sms', 'voice', 'wa_old', 'email_otp', 'flash'];
  const waits = {};
  for (const key of waitKeys) {
    const field = waitField(raw[`${key}_wait`]);
    if (field) waits[key] = field;
  }
  const retryAfter = waitField(raw.retry_after);

  const blockScreen = raw.custom_block_screen || null;

  return {
    number: target.e164,
    country: target.country,
    valid: target.valid,
    method,
    via,
    wa_status: raw.status || null,
    reason: raw.reason || null,
    blocked: raw.reason === 'blocked',
    block_screen: blockScreen
      ? {
          title: blockScreen.title || null,
          body: blockScreen.body || null,
          learn_more_url: blockScreen.btn_secondary_url || null,
          action_url: blockScreen.btn_primary_url || null,
          action_text: blockScreen.btn_primary_text || null,
        }
      : null,
    otp_length: raw.length ?? null,
    cooldown: Object.keys(waits).length || retryAfter ? { ...waits, retry_after: retryAfter } : null,
    fallback_methods: raw.fallback_methods || null,
    recommended_method: raw.recommended_method || null,
    raw,
  };
}
