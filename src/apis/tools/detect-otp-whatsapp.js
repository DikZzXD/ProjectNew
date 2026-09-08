import { ok, fail } from '../../lib/respond.js';
import { detectWaOtp, WA_OTP_METHODS, WaOtpError } from '../../lib/waotp.js';

/**
 * Detect OTP WhatsApp — cek cooldown permintaan OTP (sms/voice/wa_old) dan
 * status blokir sebuah nomor WhatsApp.
 *
 * Satu probe ke endpoint registrasi /v2/code membalas semua *_wait sekaligus,
 * jadi pemanggil tidak perlu menebak-nebak kapan nomor boleh minta kode lagi:
 * 0 = boleh sekarang, -1 = method dimatikan server, lainnya = detik tunggu.
 * Respons "blocked" juga diuraikan (layar blokir resmi dari WhatsApp).
 */
export default {
  name: 'Detect OTP WhatsApp',
  desc: 'Cek cooldown & status OTP WhatsApp suatu nomor (sms / voice / wa_old)',
  category: 'Tools',
  path: '/v1/tools/detect-otp-whatsapp',
  method: 'GET',
  params: [
    {
      name: 'number',
      required: true,
      placeholder: 'Nomor WhatsApp (mis. 628123456789)',
      desc: 'Dengan atau tanpa tanda +, contoh: 6285757411154',
    },
    {
      name: 'method',
      required: false,
      type: 'select',
      options: WA_OTP_METHODS,
      default: 'sms',
      placeholder: 'Metode OTP',
      desc: 'Metode yang dipakai saat mengetuk server: sms / voice / wa_old',
    },
    {
      name: 'raw',
      required: false,
      placeholder: 'true / false',
      default: 'false',
      desc: 'Sertakan respons mentah dari server WhatsApp',
    },
  ],

  async handler({ params, env }) {
    const number = String(params.number || '').trim();
    const method = String(params.method || 'sms').trim().toLowerCase();
    const withRaw = ['1', 'true', 'yes'].includes(String(params.raw || '').trim().toLowerCase());

    if (!number) return fail('Parameter "number" wajib diisi');
    if (!WA_OTP_METHODS.includes(method)) {
      return fail(`Parameter "method" harus salah satu dari: ${WA_OTP_METHODS.join(', ')}`);
    }

    try {
      const result = await detectWaOtp({ number, method, env });
      const { raw, ...summary } = result;

      const message = result.blocked
        ? 'Nomor diblokir WhatsApp — permintaan OTP ditolak'
        : result.wa_status === 'sent'
          ? 'OTP berhasil dikirim ke nomor ini'
          : result.reason
            ? `Permintaan OTP ditolak (${result.reason})`
            : 'Cooldown OTP berhasil dideteksi';

      return ok({ ...summary, message, ...(withRaw ? { raw } : {}) });
    } catch (error) {
      if (error instanceof WaOtpError) return fail(error.message, error.status);
      return fail(`Gagal mendeteksi OTP: ${error?.message || 'unknown error'}`, 500);
    }
  },
};
