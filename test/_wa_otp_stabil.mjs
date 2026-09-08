// Uji keandalan: jalankan probe berkali-kali dan hitung berapa yang berhasil
// dapat cooldown asli. Ini yang membedakan "kadang jalan" dari "benar-benar
// jalan" — bug lamanya justru cuma kelihatan kalau diulang.
//
// Pakai:  node test/_wa_otp_stabil.mjs [nomor] [putaran]
import { spawn } from 'node:child_process';
import path from 'node:path';

const akarRepo = path.resolve(import.meta.dirname, '..');
const nomor = process.argv[2] || '6285757411154';
const putaran = Number(process.argv[3]) || 10;

const jalankan = (n) =>
  new Promise((selesai) => {
    const anak = spawn('node', [path.join(akarRepo, 'test/_wa_otp_probe.mjs'), n, 'sms'], {
      cwd: akarRepo,
    });
    let keluaran = '';
    anak.stdout.on('data', (d) => (keluaran += d));
    anak.stderr.on('data', (d) => (keluaran += d));
    anak.on('close', () => {
      const cocok = keluaran.match(/"reason":\s*"([^"]*)"/);
      const durasi = keluaran.match(/selesai dalam (\d+)ms/);
      const via = keluaran.match(/"via":\s*"([^"]*)"/);
      selesai({
        reason: cocok?.[1] || 'ERROR',
        ms: Number(durasi?.[1] || 0),
        via: via?.[1] || '-',
      });
    });
  });

let asli = 0;
const durasi = [];
for (let i = 1; i <= putaran; i++) {
  const r = await jalankan(nomor);
  const bagus = r.reason !== 'no_routes' && r.reason !== 'ERROR';
  if (bagus) asli += 1;
  durasi.push(r.ms);
  console.log(`${String(i).padStart(2)}. ${bagus ? 'OK  ' : 'GAGAL'} ${r.reason.padEnd(12)} ${String(r.ms).padStart(5)}ms  ${r.via}`);
}

const rata = Math.round(durasi.reduce((a, b) => a + b, 0) / durasi.length);
console.log(`\nJawaban asli: ${asli}/${putaran} — rata-rata ${rata}ms`);
process.exitCode = asli === putaran ? 0 : 1;
