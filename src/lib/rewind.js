/**
 * Rewind AI client — a thin wrapper over https://api.rewind.ai/v1.
 *
 * Keys live in the D1 `rewind_keys` table (managed from the Telegram bot) so the
 * pool can be rotated without a redeploy; env.REWIND_KEY is the seed/fallback
 * used when the table is empty or D1 is unavailable. A key is picked at random
 * per call to spread quota across the pool.
 *
 * Everything is re-wrapped by the calling endpoint — the raw upstream envelope
 * (and any third-party branding on it) never reaches a caller.
 */

import { fetchWithTimeout } from './http.js';

const BASE = 'https://api.rewind.ai/v1';

/**
 * Chat models the /v1/ai/chat endpoint is allowed to use. Nothing else works.
 * Every entry was probed live against the Rewind API with a key that had a full
 * balance and returned a real reply.
 *
 * Note: an "Insufficient tokens" error from any of these is a *quota* problem on
 * the key, not a bad model — top the pool up with /createrewind on the bot.
 */
export const CHAT_MODELS = [
  'anthropic/claude-haiku-4.5',
  'anthropic/claude-haiku-latest',
  'anthropic/claude-3-haiku',
  'amazon/nova-lite-v1',
  'amazon/nova-2-lite-v1',
  'amazon/nova-micro-v1',
  'amazon/nova-pro-v1',
  'aion-labs/aion-rp-llama-3.1-8b',
  'aion-labs/aion-3.0-mini',
  'aion-labs/aion-2.0',
  'arcee-ai/trinity-large-thinking',
  'deepseek/deepseek-v4-flash-0731',
  'deepseek/deepseek-v4-flash',
  'deepseek/deepseek-v3.2-exp',
  'deepseek/deepseek-v3.2',
  'qwen/qwen3.7-plus',
  'qwen/qwen3.7-max',
  'qwen/qwen3.6-plus',
  'qwen/qwen3.6-max-preview',
  'qwen/qwen3.6-flash',
];

export const DEFAULT_CHAT_MODEL = 'anthropic/claude-haiku-4.5';

export class RewindError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'RewindError';
    this.status = status;
  }
}

/**
 * Pick a rewind API key. Prefers a random row from D1 `rewind_keys`, falls back
 * to env.REWIND_KEY. Throws if neither is available.
 */
export async function pickKey(env) {
  if (env?.DB) {
    try {
      const row = await env.DB.prepare(
        'SELECT key FROM rewind_keys ORDER BY RANDOM() LIMIT 1'
      ).first();
      if (row?.key) return row.key;
    } catch {
      // Table missing or D1 down — fall through to the env seed.
    }
  }
  if (env?.REWIND_KEY) return env.REWIND_KEY;
  throw new RewindError('Tidak ada API key rewind yang tersedia', 503);
}

async function call(env, path, body, timeoutMs) {
  const key = await pickKey(env);
  let res;
  try {
    res = await fetchWithTimeout(
      `${BASE}${path}`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      timeoutMs
    );
  } catch (error) {
    const timedOut = error?.name === 'AbortError' || /abort/i.test(error?.message || '');
    throw new RewindError(
      timedOut ? `Rewind tidak merespons dalam ${Math.round(timeoutMs / 1000)} detik` : `Gagal menghubungi rewind: ${error.message}`,
      502
    );
  }

  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    // A non-JSON body here is an upstream/gateway error page.
    throw new RewindError(`Rewind mengembalikan respons tidak valid (HTTP ${res.status})`, 502);
  }

  if (!res.ok || data?.error) {
    const message = data?.error?.message || data?.message || `HTTP ${res.status}`;
    throw new RewindError(message, res.status >= 400 && res.status < 500 ? res.status : 502);
  }

  return data;
}

/** Chat completion. Returns { reply, model, usage }. */
export async function chat(env, { model, messages, timeoutMs = 60000 }) {
  const data = await call(env, '/chat/completions', { model, messages }, timeoutMs);
  const reply = String(data?.choices?.[0]?.message?.content || '').trim();
  if (!reply) throw new RewindError('Rewind mengembalikan jawaban kosong', 502);
  return { reply, usage: data.usage || null };
}
