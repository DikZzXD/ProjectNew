// Harness manual buat nguji src/lib/waproxy.js di luar Cloudflare.
// Sumber waproxy.js dibaca apa adanya, cuma specifier `cloudflare:sockets`
// yang ditukar ke shim node:net/tls, jadi yang diuji tetap kode produksi.
//
// Pakai:  node test/_wa_proxy_probe.mjs "<proxy-uri>" [target-url]
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const akarRepo = path.resolve(import.meta.dirname, '..');
const sumber = readFileSync(path.join(akarRepo, 'src/lib/waproxy.js'), 'utf8').replace(
  "from 'cloudflare:sockets'",
  `from ${JSON.stringify(path.join(akarRepo, 'test/_wa_socketshim.mjs'))}`
);
const dirSementara = mkdtempSync(path.join(tmpdir(), 'waproxy-'));
const berkas = path.join(dirSementara, 'waproxy.mjs');
writeFileSync(berkas, sumber);

const { proxiedGet } = await import(berkas);

const proxy = process.argv[2];
const target = process.argv[3] || 'https://api.ipify.org/?format=json';
if (!proxy) {
  console.error('butuh argumen proxy URI');
  process.exit(2);
}

const mulai = Date.now();
try {
  const hasil = await proxiedGet(proxy, target, { 'User-Agent': 'curl/8', Accept: '*/*' }, 25000);
  console.log(`OK ${Date.now() - mulai}ms status=${hasil.status}`);
  console.log(hasil.text.slice(0, 400));
} catch (e) {
  console.log(`GAGAL ${Date.now() - mulai}ms: ${e?.message || e}`);
  process.exitCode = 1;
}
