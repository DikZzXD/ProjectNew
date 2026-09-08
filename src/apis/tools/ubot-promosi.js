import { ok, fail } from '../../lib/respond.js';
import { start, runPass, stop } from '../../lib/ubotpromo.js';
import { getAccount, getJob, listJobs, StoreError } from '../../lib/ubotstore.js';
import { UbotError } from '../../lib/ubot.js';

/**
 * Ubot Promosi — kirim satu pesan ke semua grup akun userbot.
 *
 * The Telethon original runs `.promosi` as a background asyncio task. A Worker
 * cannot hold a loop open for 40 groups × 10 s, so a broadcast here is a job
 * stored in D1: this endpoint starts it and reports progress, and each status
 * poll quietly drives the next batch forward (src/lib/ubotpromo.js explains the
 * cursor). That means the run continues while anyone is watching and pauses
 * harmlessly when nobody is — no work is ever lost or repeated.
 *
 *   (base) / /start   account_token + text  → mulai, balas job_id
 *   /status           account_token         → progres + lanjutkan batch
 *   /stop             account_token         → hentikan
 */
export default {
  name: 'Ubot Promosi',
  desc: 'Broadcast pesan promosi ke semua grup lewat akun userbot Telegram',
  category: 'Tools',
  path: '/v1/tools/ubot-promosi',
  method: 'POST',
  ui: 'ubot-promo',
  example: 'account_token + text → kirim ke semua grup',
  routes: [
    { suffix: 'start', mode: 'start' },
    { suffix: 'status', mode: 'status' },
    { suffix: 'stop', mode: 'stop' },
  ],
  params: [
    {
      name: 'account_token',
      required: true,
      placeholder: 'Token akun dari Ubot Login',
      desc: 'Token yang dibalas saat login userbot berhasil',
    },
    {
      name: 'text',
      required: false,
      placeholder: 'Isi pesan promosi',
      desc: 'Pesan yang dikirim ke setiap grup (wajib saat mulai)',
    },
    {
      name: 'job_id',
      required: false,
      placeholder: 'ID job dari respons mulai',
      desc: 'Untuk cek progres atau hentikan satu job tertentu',
    },
    {
      name: 'targets',
      required: false,
      placeholder: '-1001234567890, -1009876543210',
      desc: 'Opsional — kirim hanya ke grup ini, bukan semua grup',
    },
    {
      name: 'delay_min',
      required: false,
      type: 'number',
      placeholder: '5',
      desc: 'Jeda minimum antar grup (detik)',
    },
    {
      name: 'delay_max',
      required: false,
      type: 'number',
      placeholder: '12',
      desc: 'Jeda maksimum antar grup (detik)',
    },
  ],

  async handler({ params, mode, env, ctx }) {
    const step = mode || (params.job_id ? 'status' : 'start');

    try {
      const account = await getAccount(env, params.account_token, { touch: true });

      if (step === 'stop') return ok(await halt(env, account, params));
      if (step === 'status') return ok(await progress(env, account, params, ctx));
      return ok(await begin(env, account, params, ctx));
    } catch (error) {
      if (error instanceof UbotError || error instanceof StoreError) {
        return fail(error.message, error.status);
      }
      return fail('Layanan promosi sedang tidak bisa dipakai. Coba lagi beberapa saat lagi.', 503);
    }
  },
};

/** Mulai — resolve the group list, open the job, kick off the first batch. */
async function begin(env, account, params, ctx) {
  const job = await start(env, account, {
    text: params.text,
    targets: parseTargets(params.targets),
    delayMin: params.delay_min,
    delayMax: params.delay_max,
  });

  // The first batch runs after the response is already on its way, which is what
  // makes this feel like the Python "dimulai di background".
  ctx?.waitUntil(runPass(env, account, job.jobKey).catch(() => {}));

  return {
    step: 'started',
    status: 'Promosi dimulai',
    job_id: job.jobKey,
    total_groups: job.total,
    delay: `${job.delayMin}–${job.delayMax} detik per grup`,
    estimate: estimate(job.total, job.delayMin, job.delayMax),
    groups: job.targets.slice(0, 20).map((t) => t.title),
    next_step: `Cek progres di /v1/tools/ubot-promosi/status dengan job_id=${job.jobKey}`,
    note: 'Progres jalan tiap kali status dicek — buka status berkala sampai selesai.',
  };
}

/**
 * Progres — and the engine. Reading the status of a running job advances it,
 * because a Worker has no timer that outlives the request.
 */
async function progress(env, account, params, ctx) {
  const jobKey = String(params.job_id || '').trim();

  if (!jobKey) {
    const recent = await listJobs(env, account.id, 10);
    return {
      step: 'history',
      status: recent.length ? `${recent.length} promosi terakhir` : 'Belum ada promosi',
      jobs: recent.map(shapeRow),
    };
  }

  const before = await getJob(env, jobKey, account.id);
  if (!before) throw new UbotError('Job promosi tidak ditemukan untuk akun ini', 404, 'JOB_NOT_FOUND');

  // Drive one batch inline when there is work left, so a poll returns fresh
  // numbers rather than the same figures until some other trigger fires.
  if (before.status === 'running' && !before.stop) {
    await runPass(env, account, jobKey).catch(() => {});
  }

  const job = (await getJob(env, jobKey, account.id)) || before;
  const remaining = Math.max(0, job.total - job.cursor);

  if (job.status === 'running' && remaining > 0) {
    ctx?.waitUntil(runPass(env, account, jobKey).catch(() => {}));
  }

  return {
    step: job.status === 'running' ? 'running' : job.status,
    status: label(job, remaining),
    job_id: job.jobKey,
    progress: `${job.cursor}/${job.total}`,
    percent: job.total ? Math.round((job.cursor / job.total) * 100) : 0,
    berhasil: job.sent,
    gagal: job.failed,
    dilewati: job.skipped,
    total: job.total,
    sisa: remaining,
    finished: job.status !== 'running',
    note: job.note || null,
    recent: job.log.slice(-10).map((entry) => ({
      group: entry.title || entry.id,
      result: entry.result,
      note: entry.note || null,
    })),
    started_at: new Date(job.startedAt).toISOString(),
    ended_at: job.endedAt ? new Date(job.endedAt).toISOString() : null,
  };
}

/** Stop — the `.stop` command. The flag is read between groups. */
async function halt(env, account, params) {
  const { stopped } = await stop(env, account, String(params.job_id || '').trim() || null);

  return {
    step: 'stopped',
    status: stopped ? `${stopped} promosi dihentikan` : 'Tidak ada promosi yang berjalan',
    stopped,
    note: stopped ? 'Pengiriman berhenti setelah grup yang sedang diproses selesai.' : null,
  };
}

function label(job, remaining) {
  if (job.status === 'done') return 'Promosi selesai';
  if (job.status === 'stopped') return 'Promosi dihentikan';
  if (job.status === 'error') return 'Promosi berhenti karena kendala';
  return `Sedang mengirim — sisa ${remaining} grup`;
}

function shapeRow(row) {
  return {
    job_id: row.job_key,
    status: row.status,
    progress: `${row.cursor}/${row.total}`,
    berhasil: row.sent,
    gagal: row.failed,
    dilewati: row.skipped,
    started_at: new Date(row.started_at).toISOString(),
    ended_at: row.ended_at ? new Date(row.ended_at).toISOString() : null,
  };
}

/** Rough wall-clock estimate — the delay dominates, so the midpoint is close enough. */
function estimate(total, min, max) {
  if (total <= 1) return 'beberapa detik';
  const seconds = Math.round(((min + max) / 2) * (total - 1));
  if (seconds < 60) return `± ${seconds} detik`;
  if (seconds < 3600) return `± ${Math.ceil(seconds / 60)} menit`;
  return `± ${(seconds / 3600).toFixed(1)} jam`;
}

function parseTargets(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[\s,;|]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 500);
}
