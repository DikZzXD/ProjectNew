import { ok, fail } from '../../lib/respond.js';

const ALGOS = { 'sha-1': 'SHA-1', 'sha-256': 'SHA-256', 'sha-384': 'SHA-384', 'sha-512': 'SHA-512' };

/**
 * Cryptographic digest of a string via WebCrypto.
 */
export default {
  name: 'Hash Generator',
  desc: 'Hitung SHA-1 / SHA-256 / SHA-384 / SHA-512',
  category: 'Tools',
  path: '/v1/tools/hash',
  method: 'GET',
  params: [
    { name: 'text', required: true, placeholder: 'Enter text' },
    { name: 'algo', required: false, placeholder: 'sha-256 (default)', default: 'sha-256' },
  ],

  async handler({ params }) {
    const key = String(params.algo).toLowerCase().replace('sha', 'sha-').replace('sha--', 'sha-');
    const algo = ALGOS[key];

    if (!algo) return fail(`Algoritma tidak didukung. Pilih: ${Object.keys(ALGOS).join(', ')}`);

    const digest = await crypto.subtle.digest(algo, new TextEncoder().encode(params.text));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');

    return ok({ algo, input: params.text, hash: hex });
  },
};
