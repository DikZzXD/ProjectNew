/**
 * Userbot Telegram command handlers mirroring test/userbot.py:
 *
 * Supported commands (outgoing messages from self):
 *   .help                           — Daftar perintah
 *   .ping                           — Pong! Status userbot aktif
 *   .id                             — Info Chat ID & User ID
 *   .promosi <teks> (or reply msg)  — Mulai broadcast ke semua grup
 *   .addbl [@user/id]               — Tambah grup ke blacklist
 *   .delbl [@user/id]               — Hapus grup dari blacklist
 *   .listbl                         — Lihat daftar blacklist
 *   .setdelay <min> <max>           — Atur jeda antar grup (detik)
 *   .stop                           — Hentikan semua promosi yang berjalan
 *
 * Formatted with HTML blockquote (<blockquote>...</blockquote>).
 */

import { gram, sessionOf } from './ubot.js';
import {
  setDelay,
  setBlacklist,
  stopJobs,
  createJob,
  refreshSession,
  updateSyncState,
} from './ubotstore.js';
import { listGroups, MAX_TARGETS } from './ubotpromo.js';

/** Bungkus teks jadi blockquote HTML */
export function bq(text) {
  return '<blockquote>' + text + '</blockquote>';
}

/** Parse HTML entities with GramJS HTMLParser */
async function parseHTML(html) {
  const { HTMLParser } = await import('telegram/extensions/html.js');
  const [text, entities] = HTMLParser.parse(html);
  return { text, entities };
}

/** Edit message with blockquote HTML */
async function editBq(client, peer, messageId, htmlText) {
  const { Api } = await gram();
  const { text, entities } = await parseHTML(htmlText);
  try {
    const inputPeer = await client.getInputEntity(peer);
    await client.invoke(
      new Api.messages.EditMessage({
        peer: inputPeer,
        id: messageId,
        message: text,
        entities,
        noWebpage: true,
      })
    );
  } catch (error) {
    // If edit fails (e.g. timeout or deleted), attempt sending as new reply
    try {
      const inputPeer = await client.getInputEntity(peer);
      await client.sendMessage(inputPeer, {
        message: text,
        formattingEntities: entities,
      });
    } catch {
      /* ignore */
    }
  }
}

/** Resolve @username or numeric ID to numeric peer ID */
async function resolveTargetId(client, ref) {
  const clean = String(ref || '').trim();
  if (!clean) return null;
  try {
    if (/^-?\d+$/.test(clean)) {
      const entity = await client.getEntity(BigInt(clean));
      return entity?.id ? String(entity.id) : clean;
    }
    const entity = await client.getEntity(clean);
    return entity?.id ? String(entity.id) : null;
  } catch {
    return /^-?\d+$/.test(clean) ? clean : null;
  }
}

/**
 * Handle a single outgoing command message from the user
 */
export async function executeCommand(env, account, client, msg, ctx = null) {
  const rawText = String(msg.message || '').trim();
  if (!rawText.startsWith('.')) return false;

  // Use cached userId from account to avoid getMe() per message
  let myId = account.userId || '';
  if (!myId) {
    const me = await client.getMe();
    myId = String(me.id || '');
    account.userId = myId;
  }
  const senderId = String(msg.fromId?.userId || msg.peerId?.userId || myId);

  // Only commands from self (outgoing)
  if (!msg.out && senderId !== myId) return false;

  const msgId = msg.id;
  const chatPeer = msg.peerId;
  const chatId = String(
    chatPeer?.channelId
      ? `-100${chatPeer.channelId}`
      : chatPeer?.chatId
      ? `-${chatPeer.chatId}`
      : chatPeer?.userId || myId
  );

  // ── .ping ─────────────────────────────────────────────────────────────
  if (/^\.ping$/i.test(rawText)) {
    await editBq(client, chatPeer, msgId, bq('🏓 Pong! Userbot aktif.'));
    return true;
  }

  // ── .id ───────────────────────────────────────────────────────────────
  if (/^\.id$/i.test(rawText)) {
    const text = `🆔 Info\nChat ID : ${chatId}\nUser ID : ${myId}`;
    await editBq(client, chatPeer, msgId, bq(text));
    return true;
  }

  // ── .help ─────────────────────────────────────────────────────────────
  if (/^\.help$/i.test(rawText)) {
    const text =
      '📖 Daftar Perintah\n' +
      '.promosi &lt;teks&gt; — kirim ke semua grup (bisa reply pesan)\n' +
      '.addbl [@user/id] — blacklist grup\n' +
      '.delbl [@user/id] — hapus dari blacklist\n' +
      '.listbl — lihat blacklist\n' +
      '.setdelay &lt;min&gt; &lt;max&gt; — atur jeda (detik)\n' +
      '.stop — hentikan promosi\n' +
      '.ping / .id — info';
    await editBq(client, chatPeer, msgId, bq(text));
    return true;
  }

  // ── .setdelay ─────────────────────────────────────────────────────────
  const delayMatch = rawText.match(/^\.setdelay(?:\s+(\d+)\s+(\d+))?$/i);
  if (delayMatch) {
    const minArg = delayMatch[1];
    const maxArg = delayMatch[2];

    if (!minArg || !maxArg) {
      const text =
        `⏱ Delay sekarang: ${account.delayMin}–${account.delayMax} detik.\n` +
        'Ubah: .setdelay &lt;min&gt; &lt;max&gt;';
      await editBq(client, chatPeer, msgId, bq(text));
      return true;
    }

    let lo = parseInt(minArg, 10);
    let hi = parseInt(maxArg, 10);
    if (lo > hi) {
      const tmp = lo;
      lo = hi;
      hi = tmp;
    }

    await setDelay(env, account.id, lo, hi);
    account.delayMin = lo;
    account.delayMax = hi;

    await editBq(client, chatPeer, msgId, bq(`✅ Delay diset ${lo}–${hi} detik.`));
    return true;
  }

  // ── .stop ─────────────────────────────────────────────────────────────
  if (/^\.stop$/i.test(rawText)) {
    const count = await stopJobs(env, account.id);
    if (!count) {
      await editBq(client, chatPeer, msgId, bq('Tidak ada promosi yang berjalan.'));
      return true;
    }
    await editBq(
      client,
      chatPeer,
      msgId,
      bq(`🛑 Menghentikan ${count} promosi yang berjalan...`)
    );
    return true;
  }

  // ── .addbl ────────────────────────────────────────────────────────────
  const addblMatch = rawText.match(/^\.addbl(?:\s+(.+))?$/i);
  if (addblMatch) {
    const arg = addblMatch[1]?.trim();
    let tid = chatId;
    if (arg) {
      const resolved = await resolveTargetId(client, arg);
      if (!resolved) {
        await editBq(client, chatPeer, msgId, bq('❌ Grup/target tidak ditemukan.'));
        return true;
      }
      tid = resolved;
    }

    const currentBl = account.blacklist || [];
    const blSet = new Set(currentBl.map(String));
    if (blSet.has(String(tid))) {
      await editBq(client, chatPeer, msgId, bq('ℹ️ Grup itu sudah di blacklist.'));
      return true;
    }

    const nextBl = [...currentBl, String(tid)];
    await setBlacklist(env, account.id, nextBl);
    account.blacklist = nextBl;

    await editBq(client, chatPeer, msgId, bq(`✅ Ditambahkan ke blacklist: ${tid}`));
    return true;
  }

  // ── .delbl ────────────────────────────────────────────────────────────
  const delblMatch = rawText.match(/^\.delbl(?:\s+(.+))?$/i);
  if (delblMatch) {
    const arg = delblMatch[1]?.trim();
    let tid = chatId;
    if (arg) {
      const resolved = await resolveTargetId(client, arg);
      if (!resolved) {
        await editBq(client, chatPeer, msgId, bq('❌ Grup/target tidak ditemukan.'));
        return true;
      }
      tid = resolved;
    }

    const currentBl = account.blacklist || [];
    const blSet = new Set(currentBl.map(String));
    if (!blSet.has(String(tid))) {
      await editBq(client, chatPeer, msgId, bq('ℹ️ Grup itu tidak ada di blacklist.'));
      return true;
    }

    const nextBl = currentBl.filter((x) => String(x) !== String(tid));
    await setBlacklist(env, account.id, nextBl);
    account.blacklist = nextBl;

    await editBq(client, chatPeer, msgId, bq(`✅ Dihapus dari blacklist: ${tid}`));
    return true;
  }

  // ── .listbl ───────────────────────────────────────────────────────────
  if (/^\.listbl$/i.test(rawText)) {
    const bl = account.blacklist || [];
    if (!bl.length) {
      await editBq(client, chatPeer, msgId, bq('📭 Blacklist kosong.'));
      return true;
    }
    const lines = ['🚫 Daftar Blacklist:'];
    bl.forEach((x, i) => lines.push(`${i + 1}. ${x}`));
    await editBq(client, chatPeer, msgId, bq(lines.join('\n')));
    return true;
  }

  // ── .promosi ──────────────────────────────────────────────────────────
  const promoMatch = rawText.match(/^\.promosi(?:\s+([\s\S]+))?$/i);
  if (promoMatch) {
    let replyMsg = null;
    if (msg.replyTo?.replyToMsgId) {
      try {
        const inputPeer = await client.getInputEntity(chatPeer);
        const msgs = await client.getMessages(inputPeer, {
          ids: [msg.replyTo.replyToMsgId],
        });
        replyMsg = msgs?.[0] || null;
      } catch {
        /* ignore */
      }
    }

    const argText = promoMatch[1]?.trim() || '';
    if (!replyMsg && !argText) {
      const text =
        'Cara pakai:\n.promosi &lt;teks&gt;\n' +
        'atau reply sebuah pesan lalu ketik .promosi';
      await editBq(client, chatPeer, msgId, bq(text));
      return true;
    }

    const promoContent = replyMsg?.message || argText;

    // Reuse the client we're already connected on — a second connect() here
    // would add ~3 s before the "dimulai" reply appears.
    const groups = await listGroups(env, account, { client });
    const targets = groups.slice(0, MAX_TARGETS).map((g) => ({ id: g.id, title: g.title }));

    if (!targets.length) {
      await editBq(
        client,
        chatPeer,
        msgId,
        bq('❌ Tidak ada grup yang bisa dikirimi (belum masuk grup atau semua di-blacklist).')
      );
      return true;
    }

    // Create job
    const job = await createJob(env, {
      accountId: account.id,
      targets,
      payload: { text: promoContent },
      delayMin: account.delayMin || 5,
      delayMax: account.delayMax || 12,
    });

    await editBq(
      client,
      chatPeer,
      msgId,
      bq(
        `🚀 Promosi #${job.jobKey} dimulai ke ${targets.length} grup.\n` +
        `Jeda ${account.delayMin}–${account.delayMax} detik/grup.\n` +
        'Jalan sendiri di background — kamu tetap bisa pakai perintah lain. Ketik .stop untuk menghentikan.'
      )
    );

    // No kick-off here on purpose. The live loop (src/lib/ubotloop.js) picks the
    // job up on its next iteration and steps it one group at a time. Starting a
    // `runPass` as well would give two writers the same cursor and could send to
    // a group twice.
    return true;
  }

  return false;
}

/**
 * Fetch new updates from Telegram and process any pending commands
 */
export async function syncAndProcessUpdates(env, account, client, ctx = null, { live = false } = {}) {
  const { Api } = await gram();

  // In live mode this runs about once a second for as long as the loop holds its
  // lease, so writing the cursor to D1 every poll would burn ~72k row writes a
  // day per account against a 100k free-tier budget. The loop is long-lived, so
  // the cursor can safely live in memory and be flushed on a timer instead —
  // `dirty` tells the caller a flush is owed.
  let dirty = false;
  const persist = async (patch) => {
    if (live) {
      dirty = true;
      return;
    }
    await updateSyncState(env, account.id, patch);
  };

  let state = null;
  // If we don't have sync state yet, fetch initial state
  if (!account.pts || !account.syncDate) {
    try {
      state = await client.invoke(new Api.updates.GetState());
      await persist({ pts: state.pts, qts: state.qts, date: state.date });
      account.pts = state.pts;
      account.qts = state.qts;
      account.syncDate = state.date;
    } catch {
      /* fallback */
    }
  }

  // Poll differences using updates.GetDifference
  let diff = null;
  if (account.pts) {
    try {
      diff = await client.invoke(
        new Api.updates.GetDifference({
          pts: account.pts,
          date: account.syncDate || 0,
          qts: account.qts || 0,
        })
      );
    } catch {
      /* difference failed, we'll try history */
    }
  }

  let processedCount = 0;

  if (diff) {
    // DifferenceEmpty means nothing new — just update the date
    if (diff.className === 'updates.DifferenceEmpty') {
      if (diff.date) {
        await persist({ date: diff.date });
        account.syncDate = diff.date;
      }
    } else {
      // Extract state from Difference or DifferenceSlice
      const newState = diff.state || diff.intermediateState;
      if (newState) {
        await persist({ pts: newState.pts, qts: newState.qts, date: newState.date });
        account.pts = newState.pts;
        account.qts = newState.qts;
        account.syncDate = newState.date;
      }

      // Collect all new messages
      const messages = [];
      if (Array.isArray(diff.newMessages)) {
        messages.push(...diff.newMessages);
      }
      if (Array.isArray(diff.otherUpdates)) {
        for (const u of diff.otherUpdates) {
          if (u instanceof Api.UpdateNewMessage || u instanceof Api.UpdateNewChannelMessage) {
            if (u.message) messages.push(u.message);
          } else if (u instanceof Api.UpdateShortMessage || u instanceof Api.UpdateShortChatMessage) {
            messages.push({
              id: u.id,
              out: u.out,
              message: u.message,
              peerId: u.chatId
                ? new Api.PeerChat({ chatId: u.chatId })
                : new Api.PeerUser({ userId: u.userId }),
              date: u.date,
            });
          }
        }
      }

      for (const msg of messages) {
        try {
          const handled = await executeCommand(env, account, client, msg, ctx);
          if (handled) processedCount++;
        } catch {
          /* continue with next msg */
        }
      }
    }
  }

  // Fallback: scan recent dialogs for unprocessed outgoing dot-commands.
  // GetDifference can return empty if the cron set state *after* the user typed
  // a command, so this catches commands in any chat within the last few minutes.
  //
  // Skipped in live mode: it costs a GetDialogs sweep plus a GetMessages per
  // dialog, which is far too heavy to repeat every second, and a loop that polls
  // continuously has no window for a command to slip through unseen.
  if (processedCount === 0 && !live) {
    try {
      const dialogs = await client.getDialogs({ limit: 10 });
      const now = Math.floor(Date.now() / 1000);
      const cutoff = now - 120; // only look at messages from last 2 minutes

      for (const dialog of dialogs || []) {
        try {
          const peer = dialog.inputEntity || dialog.entity;
          if (!peer) continue;
          const msgs = await client.getMessages(peer, { limit: 3 });
          for (const msg of msgs || []) {
            if (!msg.out) continue;
            if ((msg.date || 0) < cutoff) continue;
            const text = String(msg.message || '').trim();
            if (!text.startsWith('.')) continue;
            // Skip messages that are already a blockquote reply (already processed)
            if (msg.entities?.some((e) => e.className === 'MessageEntityBlockquote')) continue;
            const handled = await executeCommand(env, account, client, msg, ctx);
            if (handled) processedCount++;
          }
        } catch { /* skip this dialog */ }
        if (processedCount > 0) break;
      }
    } catch {
      /* ignore */
    }
  }

  return { processed: processedCount, dirty };
}

/** Write the in-memory sync cursor back to D1. Used by the live loop's flush timer. */
export async function flushSyncState(env, account) {
  if (!account?.pts) return;
  await updateSyncState(env, account.id, {
    pts: account.pts,
    qts: account.qts || 0,
    date: account.syncDate || 0,
  });
}
