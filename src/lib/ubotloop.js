/**
 * The live loop — one long-lived connection instead of one per minute.
 *
 * Telethon keeps `client.run_until_disconnected()` open forever and gets updates
 * pushed to it. A Worker can't do that, but it gets closer than it looks: a Cron
 * Trigger invocation has a **15-minute wall-clock budget** (only *CPU* time is
 * scarce, and awaiting a socket costs none). So rather than connect → poll once →
 * disconnect every minute, one tick connects once and then polls for a quarter of
 * an hour, and the next tick takes over when it retires.
 *
 * What that buys, against the old every-minute design:
 *
 *   • `.ping` answers in ~1-2 s instead of up to 60 s, because something is
 *     always watching.
 *   • The ~3 s MTProto DH handshake is paid once per 15 minutes, not once per
 *     minute — and not at all on the path that answers a command.
 *   • `.promosi` advances on its own. It used to move only while somebody polled
 *     the status endpoint; now the loop interleaves one group per delay window
 *     with the command poll, so a broadcast runs to completion unattended and
 *     `.stop` still lands mid-run.
 *
 * Three things keep this inside the free tier, and they are the whole reason the
 * code below looks the way it does:
 *
 *   1. **Only one loop per account.** Cron ticks overlap (a new one fires every
 *      minute while a 15-minute loop is still running), and two loops would
 *      answer every command twice. A D1 lease, renewed as the loop works, makes
 *      the extra ticks exit immediately.
 *   2. **CPU time, not wall time, is the limit.** Every iteration is dominated by
 *      an `await` on the network or a timer, which is why 15 minutes of wall time
 *      fits in a small CPU budget.
 *   3. **D1 row writes are capped at 100k/day.** Polling once a second would blow
 *      that on cursor updates alone, so the sync cursor is kept in memory and
 *      flushed on a timer (see `flushSyncState`).
 */

import { connect, close } from './ubot.js';
import { syncAndProcessUpdates, flushSyncState } from './ubothandler.js';
import { stepJob } from './ubotpromo.js';
import {
  listAllAccounts,
  acquireLease,
  renewLease,
  releaseLease,
  findRunningJobKey,
} from './ubotstore.js';

/**
 * How long one loop lives. Cron's ceiling is 15 min; stopping short leaves room
 * for the final flush and teardown to finish inside the same invocation.
 */
const LOOP_BUDGET_MS = 13 * 60 * 1000;

/** Gap between update polls. The floor on how fast a command gets answered. */
const POLL_INTERVAL_MS = 1200;

/**
 * Lease horizon.
 *
 * If a loop dies without running its `finally` — CPU limit, isolate eviction —
 * nothing releases the lease, so this doubles as the recovery time: no loop can
 * take over until it lapses. Kept under the 60 s cron period so a crash costs at
 * most one missed tick, and renewed at a third of it so a slow poll can't let it
 * expire under a healthy loop.
 */
const LEASE_TTL_MS = 45 * 1000;

/** How often the in-memory sync cursor is written back to D1. */
const FLUSH_INTERVAL_MS = 60 * 1000;

/** Consecutive poll failures tolerated before the connection is written off. */
const MAX_CONSECUTIVE_ERRORS = 5;

/** Accounts driven per invocation. Each one holds a socket, and Workers cap
 *  simultaneous outgoing connections at 6. */
const MAX_ACCOUNTS = 3;

/**
 * Entry point for the cron trigger. Picks up whichever accounts aren't already
 * being driven by a live loop and runs them concurrently until the budget is up.
 */
export async function runLiveLoops(env) {
  let accounts = [];
  try {
    accounts = await listAllAccounts(env, MAX_ACCOUNTS);
  } catch {
    return { loops: 0 };
  }
  if (!accounts.length) return { loops: 0 };

  const holder = crypto.randomUUID();
  const results = await Promise.allSettled(accounts.map((account) => driveAccount(env, account, holder)));

  return {
    loops: results.filter((r) => r.status === 'fulfilled' && r.value?.ran).length,
  };
}

/**
 * One account's loop: claim the lease, connect once, then alternate between
 * polling for commands and stepping any running broadcast.
 */
async function driveAccount(env, account, holder) {
  // Another tick's loop is already on this account — nothing to do.
  const won = await acquireLease(env, account.id, holder, LEASE_TTL_MS).catch(() => false);
  if (!won) return { ran: false, reason: 'leased' };

  let client;
  try {
    client = await connect({
      session: account.session,
      apiId: Number(account.apiId),
      apiHash: account.apiHash,
    });
  } catch {
    // Let the lease lapse rather than holding it while disconnected, so the next
    // tick can retry promptly.
    await releaseLease(env, account.id, holder);
    return { ran: false, reason: 'connect_failed' };
  }

  const deadline = Date.now() + LOOP_BUDGET_MS;
  let lastFlush = Date.now();
  let lastRenew = Date.now();
  let nextSendAt = 0;
  let errors = 0;
  let processed = 0;
  let pendingFlush = false;

  try {
    while (Date.now() < deadline) {
      // A dropped socket is the one failure that wouldn't surface below:
      // `syncAndProcessUpdates` swallows its own RPC errors, so without this the
      // loop would spin out its whole budget polling a dead connection.
      // `autoReconnect` is off, so reconnecting means a fresh cron tick.
      if (!client.connected) break;

      // ── Commands ────────────────────────────────────────────
      try {
        const result = await syncAndProcessUpdates(env, account, client, null, { live: true });
        processed += result.processed || 0;
        if (result.dirty) pendingFlush = true;
        errors = 0;
      } catch {
        // A dead socket surfaces here; give up after a few in a row and let the
        // next cron tick rebuild the connection from scratch.
        errors += 1;
        if (errors >= MAX_CONSECUTIVE_ERRORS) break;
      }

      // ── Broadcast, one group per delay window ───────────────
      if (Date.now() >= nextSendAt) {
        try {
          const jobKey = await findRunningJobKey(env, account.id);
          if (jobKey) {
            const step = await stepJob(env, account, jobKey, client);
            // `done` covers finished, stopped and errored alike — either way
            // there's nothing to pace, so check again on the next iteration.
            nextSendAt = step.done ? 0 : Date.now() + (step.nextDueMs || 0);
          }
        } catch {
          // Never let a broadcast problem kill the command loop; the job's own
          // status carries the failure.
          nextSendAt = Date.now() + 5000;
        }
      }

      // ── Housekeeping ────────────────────────────────────────
      const now = Date.now();

      if (now - lastRenew >= LEASE_TTL_MS / 3) {
        const held = await renewLease(env, account.id, holder, LEASE_TTL_MS).catch(() => true);
        // Lease lost (our row was taken over after an apparent stall): stop
        // immediately rather than competing with the new owner.
        if (!held) break;
        lastRenew = now;
      }

      if (pendingFlush && now - lastFlush >= FLUSH_INTERVAL_MS) {
        await flushSyncState(env, account).catch(() => {});
        pendingFlush = false;
        lastFlush = now;
      }

      await sleep(POLL_INTERVAL_MS);
    }
  } finally {
    // The cursor only exists in memory during a live loop, so this flush is what
    // stops the next loop from re-reading and re-answering old commands.
    if (pendingFlush) await flushSyncState(env, account).catch(() => {});
    await close(client);
    await releaseLease(env, account.id, holder);
  }

  return { ran: true, processed };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

export { LOOP_BUDGET_MS, POLL_INTERVAL_MS };
