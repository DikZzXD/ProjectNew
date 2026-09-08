/** Offline check: a .stop raised mid-broadcast must halt before the next send. */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const hook = `
export async function resolve(spec, ctx, next) {
  if (spec.endsWith('ubotstore.js')) return { url: 'stub:store', shortCircuit: true };
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (url === 'stub:store') return { format: 'module', shortCircuit: true, source: \`
    export const state = { row: null };
    export async function getJob() { const r = state.row; return r ? { ...r, targets: r.targets, log: [...r.log] } : null; }
    export async function updateJob(env, key, patch) { for (const [k,v] of Object.entries(patch)) if (v!==undefined) state.row[k]=v; }
    export async function createJob() { return {}; }
    export async function stopJobs() { return 0; }
    export async function refreshSession() {}
  \` };
  return next(url, ctx);
}`;
register('data:text/javascript,' + encodeURIComponent(hook), pathToFileURL('./'));

const { stepJob } = await import('../src/lib/ubotpromo.js');
const store = await import('../src/lib/ubotstore.js');

const targets = [{ id: '-1', title: 'A' }, { id: '-2', title: 'B' }, { id: '-3', title: 'C' }];
store.state.row = {
  jobKey: 'k', accountId: 1, status: 'running', targets, cursor: 0, total: 3,
  sent: 0, failed: 0, skipped: 0, stop: false, passes: 0, payload: { text: 'x' },
  delayMin: 1, delayMax: 1, note: '', log: [],
};

const sends = [];
const client = { async sendMessage(p) { sends.push(String(p)); } };

await stepJob({}, { id: 1 }, 'k', client);          // sends A
store.state.row.stop = true;                         // .stop arrives
const r = await stepJob({}, { id: 1 }, 'k', client); // must NOT send B

console.log('sends      :', sends.join(',') || '(none)');
console.log('after_stop : done=' + r.done + ' reason=' + r.reason);
console.log('status     :', store.state.row.status, '| note:', store.state.row.note);
console.log('stopped_ok :', sends.length === 1 && store.state.row.status === 'stopped');
