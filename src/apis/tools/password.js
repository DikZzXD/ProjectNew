import { ok } from '../../lib/respond.js';

const CHARS = {
  lower: 'abcdefghijkmnopqrstuvwxyz',
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  number: '23456789',
  symbol: '!@#$%^&*()-_=+[]{};:,.?',
};

/**
 * Cryptographically random password. Ambiguous glyphs (l, I, O, 0) are left
 * out of the pools so generated values stay easy to read aloud.
 */
export default {
  name: 'Password Generator',
  desc: 'Password acak yang kuat dan mudah dibaca',
  category: 'Tools',
  path: '/v1/tools/password',
  method: 'GET',
  params: [
    { name: 'length', required: false, type: 'number', placeholder: 'Length 8-128 (default 16)', default: 16 },
    { name: 'symbols', required: false, placeholder: 'true | false (default true)', default: 'true' },
  ],

  async handler({ params }) {
    const length = Math.min(128, Math.max(8, Number(params.length) || 16));
    const useSymbols = String(params.symbols) !== 'false';

    const pool = CHARS.lower + CHARS.upper + CHARS.number + (useSymbols ? CHARS.symbol : '');
    const bytes = crypto.getRandomValues(new Uint32Array(length));
    const password = [...bytes].map((n) => pool[n % pool.length]).join('');

    return ok({
      password,
      length,
      symbols: useSymbols,
      entropy_bits: Math.round(length * Math.log2(pool.length)),
    });
  },
};
