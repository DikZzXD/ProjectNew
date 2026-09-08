/**
 * Standard response envelope for every endpoint.
 * Keeping this in one place means every API answers with the same shape.
 */

export const BRAND = {
  author: 'DikZzCode',
  short: 'DikZzCode',
  whatsapp: 'https://wa.me/6285757411154',
  telegram: 'https://t.me/maklohytam',
  telegramBackup: 'https://t.me/dikzxinxz',
};

const CREATOR = 'DikZzCode — t.me/maklohytam';

const BASE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'cache-control': 'no-store',
};

/** Pretty-printed JSON so the playground response box reads nicely. */
export function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...BASE_HEADERS, ...extra },
  });
}

/** Successful payload: { status, creator, result }. */
export function ok(result, meta = {}) {
  return json({ status: true, creator: CREATOR, ...meta, result });
}

/** Failure payload: { status, creator, message }. */
export function fail(message, status = 400) {
  return json({ status: false, creator: CREATOR, message }, status);
}

/** Raw passthrough (images, audio, binary) with CORS still applied. */
export function raw(body, contentType, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'content-type': contentType,
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=3600',
    },
  });
}

/**
 * Force a browser download. Same CORS as raw(), plus a content-disposition so
 * the payload lands as a file instead of flooding a response box — handy for the
 * long crypto tokens the Encrypt/Decrypt tools produce.
 */
export function download(body, filename, contentType = 'text/plain; charset=utf-8') {
  const safe = String(filename || 'download.txt').replace(/[^\w.\-]+/g, '_');
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': contentType,
      'content-disposition': `attachment; filename="${safe}"`,
      'access-control-allow-origin': '*',
      'access-control-expose-headers': 'content-disposition',
      'cache-control': 'no-store',
    },
  });
}

export function preflight() {
  return new Response(null, { status: 204, headers: BASE_HEADERS });
}

export { CREATOR };
