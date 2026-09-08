/**
 * HTTPS request through a forward proxy, on Workers.
 *
 * fetch() on Workers cannot use forward proxies — no CONNECT tunneling, no
 * SOCKS dispatcher — but `cloudflare:sockets` gives raw TCP plus startTls,
 * which is enough to speak the proxy protocols ourselves:
 *
 *   SOCKS5 (RFC 1928 + user/pass auth RFC 1929)
 *     greet → auth → CONNECT <target> → startTls → HTTP/1.1 over TLS
 *   HTTP proxy
 *     CONNECT <target> + Proxy-Authorization → startTls → HTTP/1.1 over TLS
 *
 * Intended for ONE request per call: the tunnel is closed as soon as the
 * response body is read (Connection: close). OwlProxy serves both protocols
 * on the same port, so the scheme in the proxy URL picks the handshake.
 */

import { connect } from 'cloudflare:sockets';

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Buffered reader over a socket ReadableStream — exact-N, line, and EOF reads. */
class Reader {
  constructor(reader) {
    this.reader = reader;
    this.buf = new Uint8Array(0);
    this.eof = false;
  }

  async fill() {
    if (this.eof) return false;
    const { done, value } = await this.reader.read();
    if (done) {
      this.eof = true;
      return false;
    }
    if (value?.length) {
      const merged = new Uint8Array(this.buf.length + value.length);
      merged.set(this.buf, 0);
      merged.set(value, this.buf.length);
      this.buf = merged;
    }
    return true;
  }

  async readExact(n) {
    while (this.buf.length < n && (await this.fill()));
    if (this.buf.length < n) return null;
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    return out;
  }

  async readLine() {
    for (;;) {
      for (let k = 0; k + 1 < this.buf.length; k++) {
        if (this.buf[k] === 13 && this.buf[k + 1] === 10) {
          const line = dec.decode(this.buf.subarray(0, k));
          this.buf = this.buf.subarray(k + 2);
          return line;
        }
      }
      if (!(await this.fill())) {
        const rest = dec.decode(this.buf);
        this.buf = new Uint8Array(0);
        return rest.length ? rest : null;
      }
    }
  }

  async readAll() {
    while (await this.fill());
    const out = this.buf;
    this.buf = new Uint8Array(0);
    return out;
  }
}

/** Kode reply SOCKS5 (RFC 1928 §6) — biar log tidak cuma menampilkan angka. */
function jelaskanKodeSocks(code) {
  const tabel = {
    1: 'kegagalan umum di server proxy',
    2: 'koneksi tidak diizinkan oleh ruleset',
    3: 'jaringan tujuan tidak terjangkau',
    4: 'host tujuan tidak terjangkau',
    5: 'koneksi ditolak tujuan',
    6: 'TTL habis',
    7: 'perintah tidak didukung',
    8: 'tipe alamat tidak didukung',
  };
  return code === null ? 'tanpa respons' : tabel[code] || `code ${code}`;
}

/**
 * Kredensial dari URL selalu percent-encoded (URL constructor yang melakukannya).
 * Kalau dikirim mentah ke proxy, username/password yang mengandung karakter
 * spesial jadi tidak cocok dan auth ditolak.
 */
const kredensial = (proxy) => ({
  user: decodeURIComponent(proxy.username || ''),
  pass: decodeURIComponent(proxy.password || ''),
});

/** SOCKS5 handshake: greet (no-auth + user/pass) → auth → CONNECT by hostname. */
async function socks5Handshake(writer, reader, proxy, target) {
  await writer.write(new Uint8Array([5, 2, 0, 2]));

  let head = await reader.readExact(2);
  if (!head || head[0] !== 5) throw new Error('bukan respons SOCKS5');
  if (head[1] === 2) {
    const kredit = kredensial(proxy);
    const user = enc.encode(kredit.user);
    const pass = enc.encode(kredit.pass);
    const auth = new Uint8Array(3 + user.length + pass.length);
    auth.set([1, user.length], 0);
    auth.set(user, 2);
    auth[2 + user.length] = pass.length;
    auth.set(pass, 3 + user.length);
    await writer.write(auth);
    head = await reader.readExact(2);
    if (!head || head[1] !== 0) throw new Error('auth proxy ditolak');
  } else if (head[1] !== 0) {
    throw new Error('proxy minta metode auth yang tidak didukung');
  }

  const host = enc.encode(target.hostname);
  const req = new Uint8Array(7 + host.length);
  req.set([5, 1, 0, 3, host.length], 0);
  req.set(host, 5);
  req[5 + host.length] = (target.port >> 8) & 255;
  req[6 + host.length] = target.port & 255;
  await writer.write(req);

  head = await reader.readExact(4);
  if (!head || head[0] !== 5 || head[1] !== 0) {
    throw new Error(`SOCKS CONNECT ditolak (${jelaskanKodeSocks(head ? head[1] : null)})`);
  }
  const atyp = head[3];
  let addrLen;
  if (atyp === 1) addrLen = 4;
  else if (atyp === 4) addrLen = 16;
  else if (atyp === 3) {
    const len = await reader.readExact(1);
    addrLen = len ? len[0] : undefined;
  } else addrLen = undefined;
  if (!Number.isInteger(addrLen)) throw new Error('SOCKS reply ATYP tidak dikenal');
  await reader.readExact(addrLen + 2);
}

/** HTTP proxy handshake: CONNECT with Basic Proxy-Authorization, expect 2xx. */
async function httpConnectHandshake(writer, reader, proxy, target) {
  const kredit = kredensial(proxy);
  const auth = btoa(`${kredit.user}:${kredit.pass}`);
  const req =
    `CONNECT ${target.hostname}:${target.port} HTTP/1.1\r\n` +
    `Host: ${target.hostname}:${target.port}\r\n` +
    `Proxy-Authorization: Basic ${auth}\r\n` +
    'Proxy-Connection: Keep-Alive\r\n\r\n';
  await writer.write(enc.encode(req));

  const statusLine = await reader.readLine();
  if (!statusLine || !/^HTTP\/1\.[01] 2\d\d/.test(statusLine)) {
    throw new Error(`CONNECT ditolak: ${statusLine || 'tidak ada respons'}`);
  }
  for (;;) {
    const line = await reader.readLine();
    if (line === null || line === '') break;
  }
}

/** Decode a chunked body (Transfer-Encoding: chunked). */
function parseChunked(bytes) {
  const parts = [];
  let i = 0;
  for (;;) {
    let j = i;
    while (j + 1 < bytes.length && !(bytes[j] === 13 && bytes[j + 1] === 10)) j++;
    const size = parseInt(dec.decode(bytes.subarray(i, j)).split(';')[0], 16);
    if (!Number.isFinite(size)) throw new Error('chunk rusak');
    i = j + 2;
    if (size === 0) break;
    parts.push(bytes.subarray(i, i + size));
    i += size + 2;
  }
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function parseHttpResponse(raw) {
  let sep = -1;
  for (let k = 0; k + 3 < raw.length; k++) {
    if (raw[k] === 13 && raw[k + 1] === 10 && raw[k + 2] === 13 && raw[k + 3] === 10) {
      sep = k;
      break;
    }
  }
  if (sep < 0) throw new Error('respons HTTP rusak (header tidak lengkap)');

  const lines = dec.decode(raw.subarray(0, sep)).split('\r\n');
  const status = Number((lines[0].match(/^HTTP\/1\.[01] (\d+)/) || [])[1]) || 0;
  const headers = {};
  for (let k = 1; k < lines.length; k++) {
    const c = lines[k].indexOf(':');
    if (c > 0) headers[lines[k].slice(0, c).trim().toLowerCase()] = lines[k].slice(c + 1).trim();
  }

  let body = raw.subarray(sep + 4);
  if ((headers['transfer-encoding'] || '').includes('chunked')) body = parseChunked(body);
  else if (headers['content-length']) body = body.subarray(0, Number(headers['content-length']));
  return { status, headers, text: dec.decode(body) };
}

/**
 * One HTTPS GET through `proxyUrl` (socks5:// or http:// with credentials).
 * Returns { status, text }. The whole tunnel is torn down on timeout.
 * Residential proxies are slow, so the default budget is generous (25 s).
 *
 * NOTE: verified working from the real Cloudflare edge. The local dev preview
 * (`wrangler dev --remote`) cannot serve TLS sockets at all — even a direct
 * `secureTransport: "on"` connection to a target hangs there. Untuk menguji
 * jalur ini tanpa deploy, pakai `node test/_wa_proxy_probe.mjs <proxy-uri>`
 * yang menukar `cloudflare:sockets` dengan shim node:net/tls.
 */
export async function proxiedGet(proxyUrl, targetUrl, headers = {}, timeoutMs = 25000) {
  const proxy = new URL(proxyUrl);
  const target = new URL(targetUrl);

  // `new URL('https://x/').port` itu STRING KOSONG, bukan '443' — jadi pola
  // `target.port || 443` di URL object tidak pernah kepakai dan CONNECT dulu
  // dikirim ke port 0. Port tujuan dihitung terpisah, jangan disimpan balik
  // ke URL object.
  const portTujuan = Number(target.port) || (target.protocol === 'http:' ? 80 : 443);
  const tujuan = { hostname: target.hostname, port: portTujuan };

  const socket = await connect(
    { hostname: proxy.hostname, port: Number(proxy.port) || 7778 },
    { secureTransport: 'starttls' }
  );

  // Satu-satunya cara membatalkan pembacaan socket yang menggantung adalah
  // membalapkannya dengan timer. Setelah startTls, socket lama TIDAK boleh
  // di-close (runtime melempar), makanya penutupan selalu lewat tutupTunnel().
  let sudahUpgrade = false;
  let secure = null;
  let sudahTutup = false;
  const tutupTunnel = () => {
    if (sudahTutup) return;
    sudahTutup = true;
    try {
      const yangHidup = sudahUpgrade ? secure : socket;
      yangHidup?.close?.()?.catch?.(() => {});
    } catch {
      /* socket sudah mati duluan, tidak ada yang perlu dibereskan */
    }
  };

  let timer;
  const batasWaktu = new Promise((_, tolak) => {
    timer = setTimeout(() => {
      tutupTunnel();
      tolak(new Error(`timeout ${timeoutMs}ms lewat proxy`));
    }, timeoutMs);
  });

  const jalan = async () => {
    const writer = socket.writable.getWriter();
    const reader = new Reader(socket.readable.getReader());

    if (proxy.protocol === 'http:' || proxy.protocol === 'https:') {
      await httpConnectHandshake(writer, reader, proxy, tujuan);
    } else {
      await socks5Handshake(writer, reader, proxy, tujuan);
    }

    // startTls() invalidates the current socket, so release the stream locks first.
    writer.releaseLock();
    reader.reader.releaseLock();
    secure = socket.startTls({ expected_server_hostname: target.hostname });
    sudahUpgrade = true;

    const secWriter = secure.writable.getWriter();
    const secReader = new Reader(secure.readable.getReader());

    // Header bawaan pemanggil menang; Host/Connection dikunci di sini supaya
    // tidak ada duplikat yang bikin upstream balas 400.
    const headerLines = Object.entries(headers)
      .filter(([k]) => !['host', 'connection'].includes(k.toLowerCase()))
      .map(([k, v]) => `${k}: ${v}\r\n`)
      .join('');
    const hostHeader = portTujuan === 443 ? target.hostname : `${target.hostname}:${portTujuan}`;
    const req =
      `GET ${target.pathname}${target.search} HTTP/1.1\r\n` +
      `Host: ${hostHeader}\r\n${headerLines}Connection: close\r\n\r\n`;
    await secWriter.write(enc.encode(req));

    const raw = await secReader.readAll();
    if (!raw.length) throw new Error('proxy menutup tunnel tanpa mengirim respons');
    return parseHttpResponse(raw);
  };

  try {
    return await Promise.race([jalan(), batasWaktu]);
  } finally {
    clearTimeout(timer);
    tutupTunnel();
  }
}
