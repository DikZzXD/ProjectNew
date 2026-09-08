// Uji end-to-end detectWaOtp() di luar Cloudflare: waproxy.js dipakai apa
// adanya, cuma `cloudflare:sockets` yang ditukar shim node:net/tls.
//
// Pakai:  node test/_wa_otp_probe.mjs <nomor> [method]
// Daftar proxy diambil dari WA_PROXIES di wrangler.toml (blok """...""").
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';

const akarRepo = path.resolve(import.meta.dirname, '..');
// Folder kerja sengaja DI DALAM repo: modul salinan tetap butuh resolusi
// node_modules repo (curve25519-js, libphonenumber-js) yang cuma jalan kalau
// file-nya berada di bawah akar proyek.
const dirSementara = mkdtempSync(path.join(akarRepo, '.wa-probe-'));
process.on('exit', () => rmSync(dirSementara, { recursive: true, force: true }));

const salin = (relatif, transform = (s) => s) => {
  const tujuan = path.join(dirSementara, path.basename(relatif));
  writeFileSync(tujuan, transform(readFileSync(path.join(akarRepo, relatif), 'utf8')));
  return tujuan;
};

salin('src/lib/http.js');
salin('src/lib/waproxy.js', (s) =>
  s.replace(
    "from 'cloudflare:sockets'",
    `from ${JSON.stringify(path.join(akarRepo, 'test/_wa_socketshim.mjs'))}`
  )
);
const berkasOtp = salin('src/lib/waotp.js', (s) =>
  s.replace(/from '\.\/(http|waproxy)\.js'/g, "from './$1.js'")
);

const { detectWaOtp } = await import(berkasOtp);

// WA_PROXIES ditulis sebagai TOML multi-line string; ambil isinya apa adanya.
// WA_PROXIES_OVERRIDE dipakai untuk skenario uji (mis. semua proxy sengaja mati).
const toml = readFileSync(path.join(akarRepo, 'wrangler.toml'), 'utf8');
const daftarProxy =
  process.env.WA_PROXIES_OVERRIDE ?? (toml.match(/WA_PROXIES\s*=\s*"""([\s\S]*?)"""/) || [])[1] ?? '';

const nomor = process.argv[2] || '6285757411154';
const method = process.argv[3] || 'sms';

const mulai = Date.now();
const hasil = await detectWaOtp({
  number: nomor,
  method,
  env: { WA_PROXIES: daftarProxy },
});
console.log(`selesai dalam ${Date.now() - mulai}ms`);
console.log(JSON.stringify(hasil, null, 2));
