import { ok, fail } from '../../lib/respond.js';
import { listGroups } from '../../lib/ubotpromo.js';
import { getAccount, setDelay, setBlacklist, dropAccount, StoreError } from '../../lib/ubotstore.js';
import { UbotError } from '../../lib/ubot.js';

/**
 * Ubot Grup — the housekeeping half of the userbot: see the groups a broadcast
 * would reach, and manage the settings that shape it.
 *
 * These are the `.listbl` / `.addbl` / `.delbl` / `.setdelay` commands from the
 * Telethon script, turned into sub-paths. The blacklist and delay live on the
 * account row, so a change applies to every later promo without re-sending it.
 *
 *   (base) / /list    account_token                → daftar grup + status blacklist
 *   /blacklist        account_token [+ add/remove] → lihat atau ubah blacklist
 *   /delay            account_token + min + max    → atur jeda antar grup
 *   /logout           account_token                → lupakan akun dari database
 */
export default {
  name: 'Ubot Grup',
  desc: 'Daftar grup userbot, blacklist, jeda kirim, dan hapus akun',
  category: 'Tools',
  path: '/v1/tools/ubot-grup',
  method: 'POST',
  ui: 'ubot-groups',
  example: 'account_token → semua grup yang akan dikirimi',
  routes: [
    { suffix: 'list', mode: 'list' },
    { suffix: 'blacklist', mode: 'blacklist' },
    { suffix: 'delay', mode: 'delay' },
    { suffix: 'logout', mode: 'logout' },
  ],
  params: [
    {
      name: 'account_token',
      required: true,
      placeholder: 'Token akun dari Ubot Login',
      desc: 'Token yang dibalas saat login userbot berhasil',
    },
    {
      name: 'add',
      required: false,
      placeholder: '-1001234567890',
      desc: 'Blacklist — ID grup yang mau dilewati (boleh beberapa, pisah koma)',
    },
    {
      name: 'remove',
      required: false,
      placeholder: '-1001234567890',
      desc: 'Blacklist — ID grup yang mau dikeluarkan dari blacklist',
    },
    {
      name: 'min',
      required: false,
      type: 'number',
      placeholder: '5',
      desc: 'Jeda minimum antar grup (detik)',
    },
    {
      name: 'max',
      required: false,
      type: 'number',
      placeholder: '12',
      desc: 'Jeda maksimum antar grup (detik)',
    },
  ],

  async handler({ params, mode, env }) {
    const step = mode || (params.add || params.remove ? 'blacklist' : params.min || params.max ? 'delay' : 'list');

    try {
      const account = await getAccount(env, params.account_token, { touch: true });

      if (step === 'logout') return ok(await logout(env, account));
      if (step === 'delay') return ok(await delay(env, account, params));
      if (step === 'blacklist') return ok(await blacklist(env, account, params));
      return ok(await groups(env, account));
    } catch (error) {
      if (error instanceof UbotError || error instanceof StoreError) {
        return fail(error.message, error.status);
      }
      return fail('Layanan userbot sedang tidak bisa dipakai. Coba lagi beberapa saat lagi.', 503);
    }
  },
};

/** Every group, blacklisted ones included but flagged, so the UI can show both. */
async function groups(env, account) {
  const all = await listGroups(env, account, { includeBlacklisted: true });
  const active = all.filter((g) => !g.blacklisted);

  return {
    step: 'groups',
    status: `${active.length} grup siap dikirimi`,
    total: all.length,
    target_count: active.length,
    blacklist_count: all.length - active.length,
    delay: `${account.delayMin}–${account.delayMax} detik`,
    groups: all.map((g) => ({
      id: g.id,
      title: g.title,
      members: g.members,
      blacklisted: g.blacklisted,
    })),
  };
}

async function blacklist(env, account, params) {
  const add = split(params.add);
  const remove = split(params.remove);

  if (!add.length && !remove.length) {
    return {
      step: 'blacklist',
      status: account.blacklist.length ? `${account.blacklist.length} grup di blacklist` : 'Blacklist kosong',
      blacklist: account.blacklist,
    };
  }

  const removeSet = new Set(remove);
  const next = [...account.blacklist.filter((id) => !removeSet.has(id)), ...add];
  const saved = await setBlacklist(env, account.id, next);

  return {
    step: 'blacklist',
    status: 'Blacklist diperbarui',
    added: add.filter((id) => !account.blacklist.includes(id)),
    removed: remove.filter((id) => account.blacklist.includes(id)),
    blacklist: saved,
    note: 'Grup di blacklist otomatis dilewati saat promosi.',
  };
}

async function delay(env, account, params) {
  if (params.min === '' && params.max === '') {
    return { step: 'delay', status: `Jeda sekarang ${account.delayMin}–${account.delayMax} detik`, min: account.delayMin, max: account.delayMax };
  }

  const saved = await setDelay(env, account.id, params.min || account.delayMin, params.max || account.delayMax);

  return {
    step: 'delay',
    status: `Jeda diset ${saved.min}–${saved.max} detik`,
    ...saved,
    note: 'Jeda acak antar grup bikin pengiriman terlihat wajar dan mengurangi risiko limit.',
  };
}

/**
 * Forget the account. The Telegram session itself stays valid — only this site
 * stops holding it — so say so rather than implying the device was logged out.
 */
async function logout(env, account) {
  await dropAccount(env, account.id);

  return {
    step: 'logout',
    status: 'Akun dihapus dari database',
    note: 'Token ini tidak berlaku lagi. Sesi di Telegram sendiri masih aktif — cabut dari Settings › Devices kalau mau benar-benar keluar.',
  };
}

function split(raw) {
  if (!raw) return [];
  return [
    ...new Set(
      String(raw)
        .split(/[\s,;|]+/)
        .map((x) => x.trim())
        .filter(Boolean)
    ),
  ].slice(0, 200);
}
