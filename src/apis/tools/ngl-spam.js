import { ok, fail } from '../../lib/respond.js';
import { validate, send, MAX_TOTAL, DEFAULT_TOTAL, BATCH, SLUGS, USER_RE, NglError } from '../../lib/ngl.js';

/**
 * Ngl Spam — send the same anonymous message N times.
 *
 * The username is validated once up front, because sending 40 messages to a
 * misspelled handle wastes the whole run and reports nothing useful. Sends then
 * go out in small concurrent waves: fully sequential is slow enough to hit the
 * Worker's wall-clock limit, fully parallel gets throttled by the relay.
 *
 * Failures are counted rather than fatal — a partial run is still a useful
 * result, so the response reports sent/failed and the first error seen.
 */
export default {
  name: 'Ngl Spam',
  desc: 'Kirim pesan NGL anonim berulang ke satu username',
  category: 'Tools',
  path: '/v1/tools/ngl-spam',
  method: 'GET',
  params: [
    {
      name: 'username',
      required: true,
      placeholder: 'Username NGL target',
      desc: 'Tanpa @ dan tanpa ngl.link/',
    },
    {
      name: 'message',
      required: true,
      placeholder: 'Isi pesan',
      desc: 'Pesan yang dikirim berulang',
    },
    {
      name: 'total',
      required: false,
      type: 'number',
      placeholder: `Jumlah kirim (1–${MAX_TOTAL})`,
      default: String(DEFAULT_TOTAL),
      desc: `Default ${DEFAULT_TOTAL}, maksimal ${MAX_TOTAL}`,
    },
  ],

  async handler({ params }) {
    const username = String(params.username).trim().replace(/^@/, '').toLowerCase();
    const message = String(params.message).trim();
    const total = count(params.total);

    if (!USER_RE.test(username)) {
      return fail('Username NGL hanya huruf/angka/titik/underscore, panjang 3–30 karakter');
    }
    if (!message) return fail('Pesan tidak boleh kosong');
    if (message.length > 300) return fail('Pesan terlalu panjang, maksimal 300 karakter');

    // Slug is chosen at random server-side — it's an internal NGL prompt type,
    // not something the caller needs to pick (the user asked to hide it).
    const slug = SLUGS[Math.floor(Math.random() * SLUGS.length)];

    const started = Date.now();

    try {
      if (!(await validate(username))) {
        return fail(`Username NGL "${username}" tidak ditemukan`, 404);
      }
    } catch (error) {
      if (error instanceof NglError) return fail(error.message, error.status);
      return fail(`Gagal menghubungi relay NGL: ${error.message}`, 502);
    }

    const ids = [];
    let failed = 0;
    let firstError = null;

    for (let done = 0; done < total; done += BATCH) {
      const wave = Math.min(BATCH, total - done);
      const results = await Promise.allSettled(
        Array.from({ length: wave }, () => send(username, message, slug))
      );

      for (const r of results) {
        if (r.status === 'fulfilled') {
          if (r.value) ids.push(r.value);
        } else {
          failed += 1;
          firstError = firstError || r.reason?.message || 'unknown';
        }
      }
    }

    const sent = total - failed;

    // Nothing landed at all — that's a failure, not a report of zero successes.
    if (!sent) {
      return fail(`Semua ${total} pesan gagal terkirim: ${firstError || 'unknown'}`, 502);
    }

    return ok({
      target: username,
      ngl_url: `https://ngl.link/${username}`,
      message,
      slug,
      requested: total,
      sent,
      failed,
      runtime: `${Date.now() - started} ms`,
      question_ids: ids.slice(0, 10),
      ...(failed ? { first_error: firstError } : {}),
      note: failed
        ? 'Sebagian gagal — biasanya kena rate limit NGL. Tunggu sebentar lalu ulangi sisanya.'
        : 'Semua pesan terkirim. Pesan masuk anonim ke inbox NGL target.',
    });
  },
};

/** Clamp `total` into 1…MAX_TOTAL, falling back to the default. */
function count(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TOTAL;
  return Math.min(MAX_TOTAL, Math.floor(n));
}
