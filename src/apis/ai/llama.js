import { ok, fail } from '../../lib/respond.js';

/**
 * Chat with Llama 3.3 through the Workers AI binding.
 */
export default {
  name: 'Llama AI',
  desc: 'Llama 3.3 70B chat (Workers AI)',
  category: 'AI',
  path: '/v1/ai/llama',
  method: 'GET',
  params: [
    { name: 'text', required: true, placeholder: 'Enter text', desc: 'Prompt yang dikirim ke model' },
    { name: 'system', required: false, placeholder: 'Enter system prompt (optional)' },
  ],

  async handler({ params, env }) {
    if (!env.AI) return fail('Workers AI binding tidak aktif', 503);

    const messages = [];
    if (params.system) messages.push({ role: 'system', content: params.system });
    messages.push({ role: 'user', content: params.text });

    const res = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages,
      max_tokens: 1024,
    });

    return ok(res.response?.trim() || '', { model: 'llama-3.3-70b' });
  },
};
