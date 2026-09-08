import { ok, fail } from '../../lib/respond.js';
import { chat, RewindError, CHAT_MODELS, DEFAULT_CHAT_MODEL } from '../../lib/rewind.js';

/**
 * AI Chat — one endpoint over the rewind chat models.
 *
 * The model is picked from a fixed whitelist (CHAT_MODELS); anything else is
 * rejected up front rather than passed upstream. The upstream envelope is
 * re-wrapped so only the reply and the model reach a caller.
 */
const MAX_PROMPT = 8000;

export default {
  name: 'AI Chat',
  desc: 'Chat AI (Claude & lainnya) — pilih model dari daftar',
  category: 'AI',
  path: '/v1/ai/chat',
  method: 'POST',
  example: '/v1/ai/chat',
  params: [
    {
      name: 'prompt',
      required: true,
      placeholder: 'Tulis pertanyaan atau pesan',
      desc: 'Pesan untuk AI',
    },
    {
      name: 'model',
      required: false,
      type: 'select',
      options: CHAT_MODELS,
      default: DEFAULT_CHAT_MODEL,
      placeholder: 'Pilih model',
      desc: `Default ${DEFAULT_CHAT_MODEL}. Hanya model dalam daftar yang berfungsi.`,
    },
  ],

  async handler({ params, env }) {
    const prompt = String(params.prompt ?? '').trim();
    const model = String(params.model || DEFAULT_CHAT_MODEL).trim();

    if (!prompt) return fail('Prompt tidak boleh kosong');
    if (prompt.length > MAX_PROMPT) return fail(`Prompt terlalu panjang, maksimal ${MAX_PROMPT} karakter`);
    if (!CHAT_MODELS.includes(model)) {
      return fail(`Model "${model}" tidak didukung. Pilih salah satu: ${CHAT_MODELS.join(', ')}`);
    }

    try {
      const { reply, usage } = await chat(env, {
        model,
        messages: [{ role: 'user', content: prompt }],
      });
      return ok({ reply, model, type: 'chat' }, usage ? { usage } : {});
    } catch (error) {
      if (error instanceof RewindError) return fail(`AI gagal menjawab: ${error.message}`, error.status);
      throw error;
    }
  },
};
