/**
 * Script packer — wraps source into a small self-executing stub.
 *
 *   compress=true  → zlib (RFC-1950 via CompressionStream('deflate')) then base64
 *   compress=false → base64 only
 *
 * Python stubs use zlib.decompress / base64.b64decode + exec.
 * JS stubs use zlib.inflateSync / Buffer.from + eval.
 * unpack() accepts the whole stub or just the base64 payload and auto-detects
 * zlib vs plain.
 */

export class PackError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PackError';
  }
}

/** Guess language from a filename; default python. */
export function langFromName(name) {
  const n = String(name || '').toLowerCase();
  if (/\.(m?js|cjs|ts)$/.test(n)) return 'javascript';
  return 'python';
}

async function streamCollect(readable) {
  const reader = readable.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** RFC-1950 zlib bytes — matches Python zlib.decompress and Node inflateSync. */
async function zlibCompress(bytes) {
  const cs = new CompressionStream('deflate');
  const w = cs.writable.getWriter();
  await w.write(bytes);
  await w.close();
  return streamCollect(cs.readable);
}

async function zlibDecompress(bytes) {
  const ds = new DecompressionStream('deflate');
  const w = ds.writable.getWriter();
  await w.write(bytes);
  await w.close();
  return streamCollect(ds.readable);
}

function toB64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromB64(text) {
  const cleaned = String(text).replace(/\s+/g, '');
  const binary = atob(cleaned);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Pack `source` into a runnable stub.
 * @param {string} source
 * @param {'python'|'javascript'} lang
 * @param {boolean} compress
 */
export async function pack(source, lang = 'python', compress = true) {
  const raw = new TextEncoder().encode(String(source));
  const payload = compress ? await zlibCompress(raw) : raw;
  const b64 = toB64(payload);
  // JSON.stringify keeps the payload a valid string literal in both Python and JS.
  const lit = JSON.stringify(b64);

  if (lang === 'javascript') {
    if (compress) {
      return `eval(require("zlib").inflateSync(Buffer.from(${lit},"base64")).toString())\n`;
    }
    return `eval(Buffer.from(${lit},"base64").toString())\n`;
  }

  if (compress) {
    return `import base64,zlib;exec(zlib.decompress(base64.b64decode(${lit})))\n`;
  }
  return `import base64;exec(base64.b64decode(${lit}))\n`;
}

/** Pull the base64 payload out of a stub, or accept raw base64. */
function extractB64(text) {
  const patterns = [
    /Buffer\.from\(\s*(['"`])([\s\S]*?)\1\s*,\s*['"]base64['"]/,
    /b64decode\(\s*(?:b)?(['"`])([\s\S]*?)\1/,
    /atob\(\s*(['"`])([\s\S]*?)\1/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[2].replace(/\\n/g, '').replace(/\s+/g, '');
  }

  const cleaned = text.replace(/\s+/g, '');
  if (/^[A-Za-z0-9+/_-]+=*$/.test(cleaned) && cleaned.length >= 8) return cleaned;

  const quoted = [...text.matchAll(/(['"`])([A-Za-z0-9+/=\s_-]{16,})\1/g)];
  if (quoted.length) {
    quoted.sort((a, b) => b[2].length - a[2].length);
    return quoted[0][2].replace(/\s+/g, '');
  }

  throw new PackError('Tidak menemukan payload base64 di input');
}

/** Reverse a packed stub (or raw base64) back to the original source text. */
export async function unpack(data) {
  const text = String(data || '').trim();
  if (!text) throw new PackError('Payload kosong');

  let bytes;
  try {
    bytes = fromB64(extractB64(text));
  } catch (error) {
    if (error instanceof PackError) throw error;
    throw new PackError('Payload bukan base64 yang valid');
  }

  const dec = new TextDecoder();

  // Prefer zlib; fall back to plain base64 payload.
  try {
    return dec.decode(await zlibDecompress(bytes));
  } catch {
    try {
      return dec.decode(bytes);
    } catch {
      throw new PackError('Gagal unpack — format tidak dikenali');
    }
  }
}
