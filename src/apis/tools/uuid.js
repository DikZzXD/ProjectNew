import { ok } from '../../lib/respond.js';

/**
 * Random UUID v4 batch generator.
 */
export default {
  name: 'UUID Generator',
  desc: 'Generate UUID v4 secara acak',
  category: 'Tools',
  path: '/v1/tools/uuid',
  method: 'GET',
  params: [{ name: 'count', required: false, type: 'number', placeholder: 'How many (1-50)', default: 1 }],

  async handler({ params }) {
    const count = Math.min(50, Math.max(1, Number(params.count) || 1));
    const list = Array.from({ length: count }, () => crypto.randomUUID());
    return ok({ count, uuids: list });
  },
};
