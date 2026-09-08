import { ok, fail } from '../../lib/respond.js';
import { reactToChannelPost, AsithaError } from '../../lib/asitha.js';

/**
 * WhatsApp React — react to a WhatsApp channel post with emojis.
 *
 * Posts run through asitha.top's bot pool: pick a channel post link, one or
 * more emojis (comma-separated), and how many bot accounts should react. The
 * upstream gates each run behind an hCaptcha solve and a coin balance; both are
 * handled server-side (see src/lib/asitha.js), so the caller only sees the
 * queued result.
 *
 * `count` accepts a fixed size (1/10/20/30/40/50) or `all` = every available bot.
 */
const COUNTS = ['1', '10', '20', '30', '40', '50', 'all'];

export default {
  name: 'WhatsApp React',
  desc: 'Kirim reaksi emoji ke postingan channel WhatsApp lewat bot',
  category: 'Tools',
  path: '/v1/tools/whatsapp-react',
  method: 'GET',
  params: [
    {
      name: 'link',
      required: true,
      placeholder: 'Link postingan channel WhatsApp',
      desc: 'Contoh: https://whatsapp.com/channel/xxxx/123',
    },
    {
      name: 'emoji',
      required: false,
      placeholder: 'Emoji dipisah koma (mis. ❤,😍)',
      default: '❤,😍',
      desc: 'Satu atau beberapa emoji, pisahkan dengan koma',
    },
    {
      name: 'count',
      required: false,
      type: 'select',
      options: COUNTS,
      default: '1',
      placeholder: 'Jumlah bot',
      desc: '1/10/20/30/40/50 atau "all" untuk semua bot',
    },
  ],

  async handler({ params, env }) {
    const link = String(params.link || '').trim();
    const emoji = String(params.emoji || '❤,😍').trim();
    const count = normalizeCount(params.count);

    if (!link) return fail('Parameter "link" wajib diisi');
    if (!/^https?:\/\/(www\.)?whatsapp\.com\/channel\//i.test(link)) {
      return fail('Link harus berupa link postingan channel WhatsApp (https://whatsapp.com/channel/...)');
    }

    // Keep only real emoji tokens; the upstream wants a comma-separated string.
    const reacts = emoji
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean)
      .join(',');
    if (!reacts) return fail('Isi minimal satu emoji');

    try {
      const result = await reactToChannelPost({
        env,
        bearer: env.ASITHA_BEARER,
        postLink: link,
        reacts,
        count,
      });

      const bot = result.botResponse || {};
      return ok({
        link,
        emoji: reacts,
        count,
        status: 'queued',
        message: 'Reaksi sedang dikirim ke postingan',
        target_count: bot.targetCount ?? null,
        job_id: bot.jobId ?? null,
      });
    } catch (error) {
      if (error instanceof AsithaError) return fail(error.message, error.status);
      // Never surface a raw "server failed to call" — report a soft capacity note.
      return fail('Layanan sedang sibuk, coba lagi sebentar lagi', 503);
    }
  },
};

/** Snap `count` to an allowed value; anything unknown falls back to 1. */
function normalizeCount(value) {
  const v = String(value || '1').trim().toLowerCase();
  return COUNTS.includes(v) ? v : '1';
}
