import { ok, fail } from '../../lib/respond.js';
import { json, ProxyError } from '../../lib/ikyy.js';
import { qs } from '../../lib/http.js';

/**
 * Dola AI — conversational chat.
 *
 * The upstream reply is lifted out and re-wrapped, so neither its `creator` nor
 * its internal model name reaches a caller; from the outside this is Dola AI.
 */
const MAX_PROMPT = 4000;
const MODEL = 'Dola-1';

export default {
  name: 'Dola AI',
  desc: 'Chat AI gaya santai — tanya apa saja',
  category: 'AI',
  path: '/v1/ai/dola',
  method: 'GET',
  params: [
    {
      name: 'prompt',
      required: true,
      placeholder: 'Enter prompt',
      desc: 'Pertanyaan atau pesan untuk Dola',
    },
  ],

  async handler({ params }) {
    const prompt = String(params.prompt).trim();

    if (!prompt) return fail('Prompt tidak boleh kosong');
    if (prompt.length > MAX_PROMPT) {
      return fail(`Prompt terlalu panjang, maksimal ${MAX_PROMPT} karakter`);
    }

    let data;
    try {
      data = await json(`/ai/cici?${qs({ prompt })}`, 45000);
    } catch (error) {
      if (error instanceof ProxyError) return fail(`Dola AI gagal menjawab: ${error.message}`, error.status);
      throw error;
    }

    const reply = String(data.reply || '').trim();
    if (!reply) return fail('Dola AI mengembalikan jawaban kosong', 502);

    return ok({ reply, model: MODEL, type: 'interactive-chat' });
  },
};
