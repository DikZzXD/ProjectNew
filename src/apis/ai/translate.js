import { ok, fail } from '../../lib/respond.js';

/**
 * Translate arbitrary text between languages using an instruct model.
 */
export default {
  name: 'AI Translate',
  desc: 'Terjemahkan teks ke bahasa apa pun',
  category: 'AI',
  path: '/v1/ai/translate',
  method: 'GET',
  params: [
    { name: 'text', required: true, placeholder: 'Enter text' },
    { name: 'to', required: false, placeholder: 'Target language (default: Indonesian)', default: 'Indonesian' },
  ],

  async handler({ params, env }) {
    if (!env.AI) return fail('Workers AI binding tidak aktif', 503);

    const res = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        {
          role: 'system',
          content: `You are a translation engine. Translate the user's text into ${params.to}. Reply with the translation only — no notes, no quotes.`,
        },
        { role: 'user', content: params.text },
      ],
      max_tokens: 1024,
    });

    return ok(
      { source: params.text, target_language: params.to, translated: res.response?.trim() || '' },
      { model: 'llama-3.3-70b' }
    );
  },
};
