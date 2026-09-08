/**
 * Pool logic tests — `node scripts/test-keypool.mjs` (or `npm run test:pool`).
 *
 * The nonecap pool has to be trusted blind: it DELETES rows on its own, in
 * production, with no human looking. So the rules that decide a deletion are
 * pinned here against a fake D1 and a fake nonecap, with no network and no
 * wrangler needed.
 *
 * What matters most is the negative case: when every key fails the same way
 * (which is exactly what nonecap's blanket 403 does today) the pool must lose
 * NOTHING. A bug there wipes 100 keys on the first outage.
 */

import { pool, maskKey, MAX_FAILS } from '../src/lib/keypool.js';
import { solve, NonecapError } from '../src/lib/nonecap.js';

/* ── Fake D1 ──────────────────────────────────────────────────────────────
 * Just enough of the D1 surface for keypool.js: prepare/bind/run/all/first and
 * batch. Statements are matched by shape, and `bind()` returns a new object
 * like the real driver does (keypool reuses one prepared statement per batch).
 */
function fakeD1() {
  const tables = new Map();
  const seq = new Map();
  const rowsOf = (t) => {
    if (!tables.has(t)) tables.set(t, []);
    return tables.get(t);
  };

  function exec(sql, args) {
    const q = sql.replace(/\s+/g, ' ').trim();
    let m;

    if ((m = q.match(/^CREATE TABLE IF NOT EXISTS (\w+)/))) {
      rowsOf(m[1]);
      return { meta: { changes: 0 } };
    }

    if ((m = q.match(/^INSERT OR IGNORE INTO (\w+) \(key, label, added_at\)/))) {
      const rows = rowsOf(m[1]);
      const [key, label, added_at] = args;
      if (rows.some((r) => r.key === key)) return { meta: { changes: 0 } };
      const id = (seq.get(m[1]) || 0) + 1;
      seq.set(m[1], id);
      rows.push({ id, key, label, uses: 0, fails: 0, last_used: null, last_error: '', added_at });
      return { meta: { changes: 1 } };
    }

    if ((m = q.match(/^SELECT id, key FROM (\w+) ORDER BY last_used IS NOT NULL/))) {
      const sorted = [...rowsOf(m[1])].sort(
        (a, b) =>
          (a.last_used === null ? 0 : 1) - (b.last_used === null ? 0 : 1) ||
          (a.last_used || 0) - (b.last_used || 0) ||
          a.id - b.id
      );
      return { results: sorted.slice(0, args[0]).map((r) => ({ id: r.id, key: r.key })) };
    }

    if ((m = q.match(/^UPDATE (\w+) SET uses = uses \+ 1/))) {
      const row = rowsOf(m[1]).find((r) => r.id === args[0]);
      if (!row) return { meta: { changes: 0 } };
      Object.assign(row, { uses: row.uses + 1, fails: 0, last_error: '', last_used: args[1] });
      return { meta: { changes: 1 } };
    }

    if ((m = q.match(/^UPDATE (\w+) SET fails = fails \+ 1/))) {
      const row = rowsOf(m[1]).find((r) => r.id === args[0]);
      if (!row) return { meta: { changes: 0 } };
      Object.assign(row, { fails: row.fails + 1, last_error: args[1], last_used: args[2] });
      return { meta: { changes: 1 } };
    }

    if ((m = q.match(/^SELECT fails FROM (\w+) WHERE id = \?1/))) {
      const row = rowsOf(m[1]).find((r) => r.id === args[0]);
      return row ? { fails: row.fails } : null;
    }

    if ((m = q.match(/^SELECT id, key, uses, fails, last_used, last_error, added_at FROM (\w+)/))) {
      const sorted = [...rowsOf(m[1])].sort((a, b) => a.id - b.id).slice(0, args[0]);
      return { results: sorted.map((r) => ({ ...r })) };
    }

    if ((m = q.match(/^SELECT COUNT\(\*\) AS n FROM (\w+)/))) {
      return { n: rowsOf(m[1]).length };
    }

    if ((m = q.match(/^DELETE FROM (\w+) WHERE id = \?1/))) {
      const rows = rowsOf(m[1]);
      const i = rows.findIndex((r) => r.id === args[0]);
      if (i < 0) return { meta: { changes: 0 } };
      rows.splice(i, 1);
      return { meta: { changes: 1 } };
    }

    if ((m = q.match(/^DELETE FROM (\w+)$/))) {
      const rows = rowsOf(m[1]);
      const n = rows.length;
      rows.length = 0;
      return { meta: { changes: n } };
    }

    throw new Error(`fakeD1: unhandled SQL → ${q}`);
  }

  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => exec(sql, args),
    all: async () => exec(sql, args),
    first: async () => exec(sql, args),
  });

  return {
    prepare: (sql) => stmt(sql),
    batch: async (stmts) => Promise.all(stmts.map((s) => s.run())),
    _rows: (t = 'nonecap_keys') => rowsOf(t),
  };
}

/* ── Tiny assert harness ─────────────────────────────────────────────────── */
let pass = 0;
const failures = [];

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(`${label}\n       expected ${e}\n       actual   ${a}`);
    console.log(`  FAIL ${label} → expected ${e}, got ${a}`);
  }
}

async function group(name, fn) {
  console.log(`\n${name}`);
  await fn();
}

/* ── Fake nonecap ─────────────────────────────────────────────────────────
 * Response shapes taken from live probes of api.nonecap.com (2026-08-23), so the
 * classifier is pinned against what the service actually says rather than a
 * guess: a missing/invalid key is a labelled 401, a shut-down account is a
 * labelled 403 `account_locked`, and an *unlabelled* 403 is the WAF/IP-block
 * case that must never delete anything.
 */
const FORBIDDEN = { status: 403, body: { error: { code: 'forbidden', message: 'access denied' } } };
const LOCKED = { status: 403, body: { error: { code: 'account_locked', message: 'this account has been locked' } } };
const NO_BALANCE = { status: 402, body: { error: { code: 'payment_required', message: 'insufficient balance' } } };
const BAD_KEY = { status: 401, body: { error: { code: 'unauthorized', message: 'invalid or revoked API key' } } };
const BOOM = { status: 502, body: { error: { message: 'bad gateway' } } };
const TOKEN = (t) => ({ status: 200, body: { token: t } });

/**
 * Route responses per key. `plan` maps key → response spec (or a list, consumed
 * in order); anything unlisted gets `fallback`. Records the call order so tests
 * can assert rotation actually happened.
 */
function mockNonecap(plan, fallback = FORBIDDEN) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const key = String(init?.headers?.authorization || '').replace(/^Bearer /, '');
    calls.push(key);
    let spec = plan[key] ?? fallback;
    if (Array.isArray(spec)) spec = spec.shift() ?? fallback;
    return {
      ok: spec.status >= 200 && spec.status < 300,
      status: spec.status,
      json: async () => spec.body,
    };
  };
  return calls;
}

const KEYS = Array.from({ length: 5 }, (_, i) => `nc_live_testkey_${'abcdefgh'.slice(0, 4)}${i}0000`);

/* ── 1. Bulk add ─────────────────────────────────────────────────────────── */
await group('bulk add', async () => {
  const env = { DB: fakeD1() };
  const p = pool(env);

  // The realistic paste: newlines, a trailing comma, the same key twice, and
  // two things that aren't keys at all.
  const res = await p.addMany(
    `${KEYS[0]}\n${KEYS[1]},${KEYS[2]}\n${KEYS[0]}\nshort\nbad!key!!!!!!!!!!!!!\n\n  ${KEYS[3]}  `
  );
  check('added', res.added, 4);
  check('duplicate (within input)', res.duplicate, 0);
  check('invalid', res.invalid, 2);
  check('invalid reported back, never in full', res.invalidSamples.every((s) => s.includes('•') || s.includes('…')), true);
  check('count', await p.count(), 4);

  const again = await p.addMany(KEYS.slice(0, 4).join('\n'));
  check('re-add is all duplicate', [again.added, again.duplicate], [0, 4]);
  check('count unchanged', await p.count(), 4);

  const big = await pool({ DB: fakeD1() }).addMany(
    Array.from({ length: 120 }, (_, i) => `nc_live_bulk_${String(i).padStart(6, '0')}0000`).join('\n')
  );
  check('120 keys in one shot (chunked batch)', big.added, 120);
});

/* ── 2. LRU rotation ─────────────────────────────────────────────────────── */
await group('LRU rotation', async () => {
  const env = { DB: fakeD1() };
  const p = pool(env);
  await p.addMany(KEYS.join('\n'));

  check('never-used keys come first, in id order', (await p.take(3)).map((r) => r.id), [1, 2, 3]);

  await p.ok(1);
  check('a used key drops to the back', (await p.take(2)).map((r) => r.id), [2, 3]);

  for (const id of [2, 3, 4, 5]) await p.ok(id);
  check('all used → oldest first', (await p.take(2)).map((r) => r.id), [1, 2]);

  // A key added later must be tried immediately, not wait for a lucky roll —
  // this is the whole reason pick order is LRU and not RANDOM().
  await p.addMany('nc_live_freshly_added_00001');
  check('fresh key jumps the queue', (await p.take(1))[0].id, 6);
});

/* ── 3. Deletion rules ───────────────────────────────────────────────────── */
await group('deletion rules', async () => {
  const env = { DB: fakeD1() };
  const p = pool(env);
  await p.addMany(KEYS.join('\n'));

  check('dead() drops the row now', await p.dead(1, 'saldo habis'), true);
  check('count after dead', await p.count(), 4);
  check('dead() on a ghost id', await p.dead(999, 'x'), false);

  const streak = [];
  for (let i = 0; i < MAX_FAILS; i += 1) streak.push(await p.soft(2, 'access denied'));
  check(`soft() drops only on strike ${MAX_FAILS}`, streak, [...Array(MAX_FAILS - 1).fill(false), true]);
  check('count after streak', await p.count(), 3);

  // A success in between must reset the streak, or a key that merely has a bad
  // day eventually gets deleted for no reason.
  await p.soft(3, 'access denied');
  await p.soft(3, 'access denied');
  await p.ok(3);
  check('ok() resets the fail streak', env.DB._rows().find((r) => r.id === 3).fails, 0);
  check('surviving a fresh strike', await p.soft(3, 'again'), false);

  check('remove() by id', await p.remove(4), true);
  check('clear() reports rows dropped', await p.clear(), 2);
  check('empty pool', await p.count(), 0);
});

/* ── 4. solve(): what a live failure does to the pool ────────────────────── */
await group('solve() pruning', async () => {
  // 4a. THE important one: every key gets the same ambiguous 403. That is an
  // outage signature, not 5 dead keys — the pool must be untouched.
  {
    const env = { DB: fakeD1() };
    const p = pool(env);
    await p.addMany(KEYS.join('\n'));
    const calls = mockNonecap({});
    let err = null;
    try {
      await solve(env, { sitekey: 'sk', url: 'u', wait: 1 });
    } catch (e) {
      err = e;
    }
    check('throws NonecapError', err instanceof NonecapError, true);
    check('soft 503 message, nothing raw', [err.status, /sibuk/.test(err.message)], [503, true]);
    check('tried every key', calls.length, 5);
    check('POOL INTACT after all-403', await p.count(), 5);
    check('no fail counted', env.DB._rows().every((r) => r.fails === 0), true);
  }

  // 4b. Same, for a 5xx: transport problems are never the key's fault.
  {
    const env = { DB: fakeD1() };
    const p = pool(env);
    await p.addMany(KEYS.join('\n'));
    mockNonecap({}, BOOM);
    await solve(env, { sitekey: 'sk', url: 'u', wait: 1 }).catch(() => {});
    check('pool intact after upstream 5xx', await p.count(), 5);
    check('no fail counted for 5xx', env.DB._rows().every((r) => r.fails === 0), true);
  }

  // 4c. Empty balance is unambiguous → gone immediately, and the request still
  // succeeds on the next key. This is the user's headline requirement.
  {
    const env = { DB: fakeD1() };
    const p = pool(env);
    await p.addMany(KEYS.join('\n'));
    mockNonecap({ [KEYS[0]]: NO_BALANCE, [KEYS[1]]: TOKEN('P1_ok') });
    check('token from the next key', await solve(env, { sitekey: 'sk', url: 'u', wait: 1 }), 'P1_ok');
    check('broke key deleted', await p.count(), 4);
    check('deleted one was #1', env.DB._rows().some((r) => r.id === 1), false);
    check('winner credited', env.DB._rows().find((r) => r.id === 2).uses, 1);
  }

  // 4d. An explicitly invalid key: same treatment.
  {
    const env = { DB: fakeD1() };
    const p = pool(env);
    await p.addMany(KEYS.join('\n'));
    mockNonecap({ [KEYS[0]]: BAD_KEY, [KEYS[1]]: TOKEN('P1_ok') });
    await solve(env, { sitekey: 'sk', url: 'u', wait: 1 });
    check('invalid key deleted', await p.count(), 4);
  }

  // 4d-bis. A locked account is nonecap's real answer for a key that got shut
  // down. It arrives as a 403 — but a *labelled* one, so it must still delete,
  // and it must delete without waiting for another key to succeed.
  {
    const env = { DB: fakeD1() };
    const p = pool(env);
    await p.addMany(KEYS.join('\n'));
    mockNonecap({ [KEYS[0]]: LOCKED, [KEYS[1]]: LOCKED }, FORBIDDEN);
    await solve(env, { sitekey: 'sk', url: 'u', wait: 1 }).catch(() => {});
    check('locked accounts deleted even with no success', await p.count(), 3);
    check('unlabelled 403s in the same run survive', env.DB._rows().map((r) => r.id), [3, 4, 5]);
  }

  // 4e. Ambiguous 403 *followed by* a success: the success proves the service is
  // up, so the earlier rejection was really about that key — charge it now.
  {
    const env = { DB: fakeD1() };
    const p = pool(env);
    await p.addMany(KEYS.join('\n'));
    mockNonecap({ [KEYS[0]]: FORBIDDEN, [KEYS[1]]: FORBIDDEN, [KEYS[2]]: TOKEN('P1_ok') });
    await solve(env, { sitekey: 'sk', url: 'u', wait: 1 });
    check('rejections charged once a key worked', env.DB._rows().filter((r) => r.fails === 1).map((r) => r.id), [1, 2]);
    check('still in the pool (strike 1 of 3)', await p.count(), 5);
  }

  // 4f. A 200 with no token means the solver gave up on the captcha. Not the
  // key's fault, and it must not be charged.
  {
    const env = { DB: fakeD1() };
    const p = pool(env);
    await p.addMany(KEYS.slice(0, 2).join('\n'));
    mockNonecap({ [KEYS[0]]: { status: 200, body: {} }, [KEYS[1]]: TOKEN('P1_ok') });
    await solve(env, { sitekey: 'sk', url: 'u', wait: 1 });
    check('unsolved captcha does not delete', await p.count(), 2);
  }
});

/* ── 5. Env seed fallback ────────────────────────────────────────────────── */
await group('env seed fallback', async () => {
  const env = { DB: fakeD1(), NONECAP_KEY: 'nc_live_env_seed_key_0001' };
  mockNonecap({ [env.NONECAP_KEY]: TOKEN('P1_env') });
  check('empty pool falls back to env', await solve(env, { sitekey: 'sk', url: 'u', wait: 1 }), 'P1_env');

  // The env key has no row, so nothing can be pruned — and it must not crash.
  mockNonecap({ [env.NONECAP_KEY]: NO_BALANCE });
  let err = null;
  try {
    await solve(env, { sitekey: 'sk', url: 'u', wait: 1 });
  } catch (e) {
    err = e;
  }
  check('dead env key fails softly', err instanceof NonecapError, true);

  // Once the pool has keys, the env seed is ignored entirely.
  const p = pool(env);
  await p.addMany(KEYS[0]);
  const calls = mockNonecap({ [KEYS[0]]: TOKEN('P1_pool') });
  check('pool wins over env', await solve(env, { sitekey: 'sk', url: 'u', wait: 1 }), 'P1_pool');
  check('env key never touched', calls.includes(env.NONECAP_KEY), false);

  const bare = { NONECAP_KEY: '' };
  let cfgErr = null;
  try {
    await solve(bare, { sitekey: 'sk', url: 'u', wait: 1 });
  } catch (e) {
    cfgErr = e;
  }
  check('no keys at all → configured-yet message', /dikonfigurasi/.test(cfgErr?.message || ''), true);
});

/* ── 6. Masking ──────────────────────────────────────────────────────────── */
await group('masking', async () => {
  const env = { DB: fakeD1() };
  const p = pool(env);
  await p.addMany(KEYS[0]);
  const rows = await p.list();
  check('list() never returns a raw key', rows[0].key === KEYS[0], false);
  check('list() key is masked', rows[0].key, maskKey(KEYS[0]));
  check('short keys fully hidden', maskKey('abc'), '••••');
  // Provider keys share a long `nc_live_` prefix, so the mask has to keep enough
  // head to tell two rows apart in /listnonecap.
  check(
    'two keys with the same prefix mask differently',
    maskKey('nc_live_aaaaaaaa1111') === maskKey('nc_live_bbbbbbbb2222'),
    false
  );
});

console.log(`\n${failures.length ? '✕' : '✓'} ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`\n  ✕ ${f}`);
  process.exit(1);
}
