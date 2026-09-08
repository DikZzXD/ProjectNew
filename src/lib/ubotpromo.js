/**
 * Promosi — broadcast one message to every group the account is in.
 *
 * The reference Telethon script keeps a background asyncio task alive for the
 * whole run, sleeping 5-12 s between groups. A Worker has no such luxury: the
 * request ends, and with it the isolate. So a broadcast here is a *resumable
 * cursor* in D1 rather than a live loop:
 *
 *   1. `start()` resolves the group list once (the expensive part: one
 *      messages.GetDialogs sweep) and stores it with the payload.
 *   2. Each pass reconnects, sends from `cursor` onward with the same random
 *      delay, and stops when the time box is up — writing progress after every
 *      group, so nothing is ever sent twice or lost.
 *   3. Progress is written after every group, so any later pass picks up exactly
 *      where the last one stopped.
 *
 * The live loop (src/lib/ubotloop.js) is what normally drives a run, via
 * `stepJob` — one group per delay window, interleaved with the command poll, so a
 * broadcast finishes unattended. `runPass` below is the older time-boxed batch,
 * kept for the HTTP path; the two must never run on one job at once, since both
 * advance the same cursor.
 *
 * Skip / fail classification follows the Python original: ChatWriteForbidden,
 * UserBannedInChannel and ChannelPrivate are *dilewati* (not our problem), a
 * FloodWait is slept off once and retried, anything else counts as gagal.
 */

import { connect, close, sessionOf, gram, short, UbotError } from './ubot.js';
import { createJob, getJob, updateJob, stopJobs, refreshSession } from './ubotstore.js';

/** Wall-clock budget for one pass. Kept under the Worker request ceiling. */
const PASS_BUDGET_MS = 45_000;

/** Hard cap on groups per broadcast — a sanity limit, not a Telegram one. */
const MAX_TARGETS = 500;

/** Longest flood wait worth sleeping through inside a pass; matches the script. */
const MAX_FLOOD_SLEEP_S = 300;

/* ── Group discovery ─────────────────────────────────────────── */

/**
 * Every group/supergroup the account belongs to, minus broadcast channels and
 * the blacklist — the same filter as `dialog.is_group and not in_blacklist`.
 */
export async function listGroups(env, account, { includeBlacklisted = false, client: existing = null } = {}) {
  // The live loop already holds a connected client; reusing it saves the ~3 s
  // DH handshake, which is most of the wait when `.promosi` is answered.
  const client = existing || (await connect({ session: account.session, apiId: Number(account.apiId), apiHash: account.apiHash }));

  try {
    const dialogs = await client.getDialogs({ limit: 400 });
    const blocked = new Set(account.blacklist.map(String));

    const groups = [];
    for (const dialog of dialogs) {
      if (!dialog?.isGroup) continue;

      const id = String(dialog.id ?? '');
      if (!id) continue;

      const blacklisted = blocked.has(id) || blocked.has(id.replace(/^-100/, '')) || blocked.has(dialog.entity?.id?.toString?.() || '');
      if (blacklisted && !includeBlacklisted) continue;

      groups.push({
        id,
        title: String(dialog.title || dialog.name || 'Tanpa nama'),
        members: Number(dialog.entity?.participantsCount || 0) || null,
        blacklisted,
      });
    }

    await persistSession(env, account, client);
    return groups;
  } catch (error) {
    throw promoError(error);
  } finally {
    // Only close what we opened — a borrowed client belongs to the caller.
    if (!existing) await close(client);
  }
}

/* ── Start ───────────────────────────────────────────────────── */

/**
 * Resolve the targets and open a job. Nothing is sent here — the first batch
 * runs in the caller's `ctx.waitUntil`, so the HTTP response comes back
 * immediately with a job key to poll, exactly like `.promosi` returning
 * "dimulai di background".
 */
export async function start(env, account, { text, targets: explicit, delayMin, delayMax }) {
  const message = String(text || '').trim();
  if (!message) throw new UbotError('Parameter "text" wajib diisi — isi pesan promosi', 400, 'TEXT_MISSING');
  if (message.length > 4000) throw new UbotError('Pesan promosi terlalu panjang, maksimal 4000 karakter', 400, 'TEXT_TOO_LONG');

  let targets;
  if (explicit?.length) {
    // An explicit list skips discovery entirely: no dialog sweep, no delay.
    targets = explicit.slice(0, MAX_TARGETS).map((id) => ({ id: String(id), title: String(id) }));
  } else {
    const groups = await listGroups(env, account);
    targets = groups.slice(0, MAX_TARGETS).map((g) => ({ id: g.id, title: g.title }));
  }

  if (!targets.length) {
    throw new UbotError(
      'Tidak ada grup yang bisa dikirimi. Akun ini belum masuk grup apa pun, atau semuanya ada di blacklist.',
      409,
      'NO_TARGETS'
    );
  }

  const lo = clamp(delayMin ?? account.delayMin, 1, 600);
  const hi = clamp(delayMax ?? account.delayMax, 1, 600);
  const [low, high] = lo <= hi ? [lo, hi] : [hi, lo];

  const job = await createJob(env, {
    accountId: account.id,
    targets,
    payload: { text: message },
    delayMin: low,
    delayMax: high,
  });

  return { ...job, delayMin: low, delayMax: high, targets };
}

/* ── The send loop ───────────────────────────────────────────── */

/**
 * Drain one time-boxed batch. Safe to call on a job that is already finished,
 * stopped, or mid-flight from another pass — it re-reads state first and returns
 * a summary either way, so a double poll can't double-send.
 */
export async function runPass(env, account, jobKey) {
  const job = await getJob(env, jobKey, account.id);
  if (!job) return { ran: false, reason: 'not_found' };
  if (job.status !== 'running') return { ran: false, reason: job.status };

  if (job.stop) {
    await finish(env, job, 'stopped', 'Dihentikan lewat perintah stop');
    return { ran: false, reason: 'stopped' };
  }

  const deadline = Date.now() + PASS_BUDGET_MS;
  let client;

  try {
    client = await connect({ session: account.session, apiId: Number(account.apiId), apiHash: account.apiHash });
  } catch (error) {
    // A failed connect is not the job's fault; leave it running so the next poll
    // can retry instead of burning the remaining targets.
    await updateJob(env, jobKey, { note: 'Menunggu koneksi ke Telegram, akan dilanjut otomatis' });
    return { ran: false, reason: 'connect_failed', detail: short(error) };
  }

  const counts = { sent: job.sent, failed: job.failed, skipped: job.skipped };
  const log = [...job.log];
  let cursor = job.cursor;

  try {
    while (cursor < job.targets.length && Date.now() < deadline) {
      // Re-read the flag between groups so .stop takes effect mid-run.
      const live = await getJob(env, jobKey, account.id);
      if (live?.stop) {
        await finish(env, { ...job, ...counts, cursor }, 'stopped', 'Dihentikan lewat perintah stop');
        return { ran: true, stopped: true, ...counts, cursor };
      }

      const target = job.targets[cursor];
      const outcome = await sendOne(client, target, job.payload);

      counts[outcome.bucket] += 1;
      cursor += 1;
      log.push({ id: target.id, title: target.title, result: outcome.bucket, note: outcome.note || undefined });

      await updateJob(env, jobKey, { cursor, ...counts, log, note: outcome.note || '' });

      // Random jitter between groups, skipped after the last one — the whole
      // point of the delay is to look human to Telegram's spam heuristics.
      if (cursor < job.targets.length && Date.now() < deadline) {
        await sleep(randomBetween(job.delayMin, job.delayMax) * 1000);
      }
    }

    const done = cursor >= job.targets.length;
    if (done) {
      await finish(env, { ...job, ...counts, cursor }, 'done', 'Selesai');
    } else {
      await updateJob(env, jobKey, {
        cursor,
        ...counts,
        passes: job.passes + 1,
        note: `${cursor}/${job.total} grup terkirim, lanjut otomatis`,
      });
    }

    await persistSession(env, account, client);
    return { ran: true, done, ...counts, cursor };
  } catch (error) {
    // An error that escapes sendOne is session-level (auth key dead, transport
    // gone), so the job ends rather than looping on a broken client.
    const mapped = promoError(error);
    await finish(env, { ...job, ...counts, cursor }, 'error', mapped.message);
    return { ran: true, error: mapped.message, ...counts, cursor };
  } finally {
    await close(client);
  }
}

/* ── One step at a time (the live loop's entry point) ─────────── */

/**
 * Send to exactly one group using a client the caller already has open, then
 * return when the next one is due.
 *
 * `runPass` above owns its own connection and blocks for up to 45 s, which is
 * why a broadcast used to advance only while someone polled the status route.
 * The live loop in src/lib/ubotloop.js instead interleaves: step one group, go
 * back to watching for commands, step the next when `nextDueMs` has elapsed. So
 * `.stop` and `.ping` stay responsive *during* a broadcast, and the run keeps
 * moving with nobody watching.
 *
 * Returns `{ done }` when there is nothing left to send, otherwise
 * `{ done: false, nextDueMs }` — the delay is the caller's to wait out.
 */
export async function stepJob(env, account, jobKey, client) {
  const job = await getJob(env, jobKey, account.id);
  if (!job) return { done: true, reason: 'not_found' };
  if (job.status !== 'running') return { done: true, reason: job.status };

  if (job.stop) {
    await finish(env, job, 'stopped', 'Dihentikan lewat perintah stop');
    return { done: true, reason: 'stopped' };
  }

  if (job.cursor >= job.targets.length) {
    await finish(env, job, 'done', 'Selesai');
    return { done: true, reason: 'done', sent: job.sent };
  }

  const target = job.targets[job.cursor];

  let outcome;
  try {
    outcome = await sendOne(client, target, job.payload);
  } catch (error) {
    // Session-level (PEER_FLOOD, auth key dead): end the job rather than
    // grinding through the remaining targets on a client that can't send.
    const mapped = promoError(error);
    await finish(env, { ...job, cursor: job.cursor }, 'error', mapped.message);
    return { done: true, reason: 'error', error: mapped.message };
  }

  const cursor = job.cursor + 1;
  const counts = {
    sent: job.sent + (outcome.bucket === 'sent' ? 1 : 0),
    failed: job.failed + (outcome.bucket === 'failed' ? 1 : 0),
    skipped: job.skipped + (outcome.bucket === 'skipped' ? 1 : 0),
  };
  const log = [...job.log, { id: target.id, title: target.title, result: outcome.bucket, note: outcome.note || undefined }];
  const complete = cursor >= job.targets.length;

  await updateJob(env, jobKey, {
    cursor,
    ...counts,
    log,
    note: complete ? 'Selesai' : `Terkirim ${counts.sent}/${job.total} grup`,
    status: complete ? 'done' : undefined,
    endedAt: complete ? Date.now() : undefined,
  });

  if (complete) return { done: true, reason: 'done', ...counts };
  return { done: false, nextDueMs: randomBetween(job.delayMin, job.delayMax) * 1000, ...counts };
}

/** One group. Never throws for a per-chat problem — it classifies instead. */
async function sendOne(client, target, payload) {
  const peer = coercePeer(target.id);

  try {
    await client.sendMessage(peer, { message: payload.text });
    return { bucket: 'sent' };
  } catch (error) {
    const raw = String(error?.errorMessage || error?.message || '');

    // Skipped: we simply aren't allowed to post there.
    if (/CHAT_WRITE_FORBIDDEN|USER_BANNED_IN_CHANNEL|CHANNEL_PRIVATE|CHAT_ADMIN_REQUIRED|TOPIC_CLOSED|CHAT_RESTRICTED|USER_IS_BLOCKED/i.test(raw)) {
      return { bucket: 'skipped', note: 'Tidak boleh kirim di grup ini' };
    }

    // Flood wait: sleep it off once and retry, same as the Python original.
    const seconds = Number(error?.seconds || 0);
    if (/FLOOD_WAIT|SLOWMODE_WAIT|PEER_FLOOD/i.test(raw)) {
      if (/PEER_FLOOD/i.test(raw)) {
        // Account-wide limit — pushing further would risk a ban, so bail out and
        // let the pass end; the remaining targets stay queued.
        throw new UbotError(
          'Telegram membatasi akun ini karena terlalu banyak pesan. Hentikan promosi beberapa jam.',
          429,
          'PEER_FLOOD'
        );
      }
      const wait = Math.min(seconds + 2, MAX_FLOOD_SLEEP_S);
      await sleep(wait * 1000);
      try {
        await client.sendMessage(peer, { message: payload.text });
        return { bucket: 'sent', note: `Tertunda ${wait}s karena limit Telegram` };
      } catch {
        return { bucket: 'failed', note: 'Masih dibatasi setelah menunggu' };
      }
    }

    if (/AUTH_KEY_UNREGISTERED|SESSION_REVOKED|USER_DEACTIVATED|FROZEN_METHOD_INVALID/i.test(raw)) {
      throw error; // session-level: handled by the caller
    }

    return { bucket: 'failed', note: 'Gagal kirim' };
  }
}

/* ── Stop ────────────────────────────────────────────────────── */

/** Raise the stop flag on one job or all of the account's running jobs. */
export async function stop(env, account, jobKey = null) {
  const changed = await stopJobs(env, account.id, jobKey);
  return { stopped: changed };
}

/* ── Helpers ─────────────────────────────────────────────────── */

async function finish(env, job, status, note) {
  await updateJob(env, job.jobKey, {
    status,
    cursor: job.cursor,
    sent: job.sent,
    failed: job.failed,
    skipped: job.skipped,
    note,
    endedAt: Date.now(),
  });
}

/**
 * A dialog id like `-1001234567890` has to go back to Telegram as a number, not
 * a string, or GramJS treats it as a username lookup.
 */
function coercePeer(id) {
  const text = String(id);
  return /^-?\d+$/.test(text) ? BigInt(text) : text;
}

/** Keep the stored session current — it rotates on DC migration. */
async function persistSession(env, account, client) {
  try {
    const current = sessionOf(client);
    if (current && current !== account.session) {
      await refreshSession(env, account.id, { session: current, apiHash: account.apiHash });
    }
  } catch {
    /* bookkeeping only */
  }
}

function promoError(error) {
  if (error instanceof UbotError) return error;
  const raw = String(error?.errorMessage || error?.message || '');

  if (/AUTH_KEY_UNREGISTERED|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED/i.test(raw)) {
    return new UbotError('Sesi Telegram sudah tidak berlaku — login ulang untuk dapat token baru.', 401, 'SESSION_DEAD');
  }
  if (/FROZEN_METHOD_INVALID/i.test(raw)) {
    return new UbotError('Akun Telegram ini sedang dibekukan, jadi tidak bisa dipakai.', 403, 'FROZEN');
  }
  if (/FLOOD_WAIT/i.test(raw)) {
    return new UbotError('Telegram membatasi permintaan sementara. Coba lagi beberapa menit lagi.', 429, 'FLOOD_WAIT');
  }
  return new UbotError('Layanan Telegram sedang sibuk. Coba lagi beberapa saat lagi.', 503, short(error));
}

function randomBetween(min, max) {
  return min + Math.random() * Math.max(0, max - min);
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

export { PASS_BUDGET_MS, MAX_TARGETS };
