import { ok, fail } from '../../lib/respond.js';

/**
 * Fast, cheap general chat backed by Mistral 7B on Workers AI.
 */
export default {
  name: 'Mistral AI',
  desc: 'Mistral 7B Instruct chat',
  category: 'AI',
  path: '/v1/ai/mistral',
  method: 'GET',
  params: [
    { name: 'text', required: true, placeholder: 'Enter text' },
    { name: 'system', required: false, placeholder: 'Enter system prompt (optional)' },
  ],

  async handler({ params, env }) {
    if (!env.AI) return fail('Workers AI binding tidak aktif', 503);

    const messages = [];
    if (params.system) messages.push({ role: 'system', content: params.system });
    messages.push({ role: 'user', content: params.text });

    const res = await env.AI.run('@cf/mistral/mistral-7b-instruct-v0.2', { messages, max_tokens: 1024 });
    return ok(res.response?.trim() || '', { model: 'mistral-7b-instruct' });
  },
};
