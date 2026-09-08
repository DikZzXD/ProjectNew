import { raw } from '../../lib/respond.js';
import { fetchWithTimeout, qs } from '../../lib/http.js';

/**
 * QR code generator. Streams the PNG straight back to the caller.
 */
export default {
  name: 'QR Code',
  desc: 'Ubah teks atau URL jadi QR code PNG',
  category: 'Tools',
  path: '/v1/tools/qrcode',
  method: 'GET',
  responseType: 'image',
  params: [
    { name: 'text', required: true, placeholder: 'Enter text or URL' },
    { name: 'size', required: false, type: 'number', placeholder: 'Size in px (default 512)', default: 512 },
  ],

  async handler({ params }) {
    const size = Math.min(1000, Math.max(64, Number(params.size) || 512));
    const url = `https://api.qrserver.com/v1/create-qr-code/?${qs({
      data: params.text,
      size: `${size}x${size}`,
      margin: 8,
    })}`;

    const res = await fetchWithTimeout(url);
    return raw(res.body, 'image/png', res.status);
  },
};
