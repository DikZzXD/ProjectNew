import { ok, fail } from '../../lib/respond.js';
import { fetchJSON } from '../../lib/http.js';

/**
 * Live currency conversion using the open exchange-rate feed.
 */
export default {
  name: 'Currency Converter',
  desc: 'Konversi mata uang dengan kurs terkini',
  category: 'Information',
  path: '/v1/info/currency',
  method: 'GET',
  params: [
    { name: 'from', required: true, placeholder: 'From (contoh: USD)' },
    { name: 'to', required: true, placeholder: 'To (contoh: IDR)' },
    { name: 'amount', required: false, type: 'number', placeholder: 'Amount (default 1)', default: 1 },
  ],

  async handler({ params }) {
    const from = String(params.from).toUpperCase();
    const to = String(params.to).toUpperCase();
    const amount = Number(params.amount) || 1;

    const { ok: fine, data } = await fetchJSON(`https://open.er-api.com/v6/latest/${encodeURIComponent(from)}`);

    if (!fine || data?.result !== 'success') return fail(`Mata uang "${from}" tidak dikenal`, 400);

    const rate = data.rates?.[to];
    if (!rate) return fail(`Mata uang "${to}" tidak dikenal`, 400);

    return ok({
      from,
      to,
      rate,
      amount,
      result: Number((amount * rate).toFixed(4)),
      updated_at: data.time_last_update_utc,
    });
  },
};
