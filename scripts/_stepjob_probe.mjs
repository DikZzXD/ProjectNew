/**
 * Offline check for stepJob's cursor arithmetic — no Telegram, no D1.
 *
 * What matters is that each call advances exactly one group, never re-sends a
 * group, and reports done exactly once. ubotstore is stubbed via a module hook so
 * the real ubotpromo code runs unmodified.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const hook = `
export async function resolve(spec, ctx, next) {
  if (spec.endsWith('ubotstore.js')) return { url: 'stub:store', shortCircuit: true };
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (url === 'stub:store') {
    return { format: 'module', shortCircuit: true, source: \`
      export const state = { row: null, sends: [] };
      export async function getJob() {
        const r = state.row;
        return r ? { ...r, targets: r.targets, log: [...r.log] } : null;
      }
      export async function updateJob(env, key, patch) {
        for (const [k, v] of Object.entries(patch)) if (v !== undefined) state.row[k] = v;
      }
      export async function createJob() { return {}; }
      export async function stopJobs() { return 0; }
      export async function refreshSession() {}
    \` };
  }
  return next(url, ctx);
}
`;
register('data:text/javascript,' + encodeURIComponent(hook), pathToFileURL('./'));

const { stepJob } = await import('../src/lib/ubotpromo.js');
const store = await import('../src/lib/ubotstore.js');

const targets = [
  { id: '-1001', title: 'Grup A' },
  { id: '-1002', title: 'Grup B' },
  { id: '-1003', title: 'Grup C' },
];

store.state.row = {
  jobKey: 'k', accountId: 1, status: 'running', targets,
  cursor: 0, total: 3, sent: 0, failed: 0, skipped: 0,
  stop: false, passes: 0, payload: { text: 'hi' },
  delayMin: 1, delayMax: 1, note: '', log: [],
};

const sends = [];
const client = { async sendMessage(peer) { sends.push(String(peer)); } };

const outcomes = [];
for (let i = 0; i < 6; i++) {
  const r = await stepJob({}, { id: 1 }, 'k', client);
  outcomes.push(r.done ? `done(${r.reason})` : `step sent=${r.sent} next=${Math.round(r.nextDueMs)}ms`);
  if (r.done) break;
}

const row = store.state.row;
console.log('sends     :', sends.join(','));
console.log('outcomes  :', outcomes.join(' | '));
console.log('final     : cursor=' + row.cursor + ' sent=' + row.sent + ' status=' + row.status);
console.log('note      :', row.note);
console.log('no_dupes  :', new Set(sends).size === sends.length);
console.log('all_sent  :', sends.length === 3);
