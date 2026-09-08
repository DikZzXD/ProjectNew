/**
 * Text encryption core — AES-256-GCM with a password-derived key.
 *
 * Uses the Workers `crypto.subtle` (WebCrypto) only, no dependencies. The design
 * goals are that a token is (a) strong — a random salt and IV per call, a slow
 * KDF, authenticated ciphertext — and (b) portable, so the plaintext can be
 * recovered anywhere with the same password using standard primitives.
 *
 * Token layout, all concatenated then base64url-encoded behind a version tag:
 *
 *   DZ1.<base64url( salt[16] | iv[12] | ciphertext+tag )>
 *
 * PBKDF2-SHA256 at 100k iterations stretches the password into the 256-bit key;
 * AES-GCM gives confidentiality and integrity in one pass, so a tampered or
 * wrong-key token fails to decrypt rather than returning garbage.
 */

const VERSION = 'DZ1';
const ITERATIONS = 100000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

const enc = new TextEncoder();
const dec = new TextDecoder();

/** base64url without padding — safe in URLs, JSON, and shell one-liners. */
function toB64url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Encrypt `text` with `password`, returning a DZ1 token string. */
export async function encrypt(text, password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt);

  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text))
  );

  const packed = new Uint8Array(salt.length + iv.length + cipher.length);
  packed.set(salt, 0);
  packed.set(iv, salt.length);
  packed.set(cipher, salt.length + iv.length);

  return `${VERSION}.${toB64url(packed)}`;
}

/** Decrypt a DZ1 token with `password`. Throws CryptoError on any failure. */
export async function decrypt(token, password) {
  const trimmed = String(token || '').trim();
  const match = /^([A-Za-z0-9]+)\.(.+)$/.exec(trimmed);

  if (!match || match[1] !== VERSION) {
    throw new CryptoError('Token tidak valid atau versi tidak dikenal');
  }

  let packed;
  try {
    packed = fromB64url(match[2]);
  } catch {
    throw new CryptoError('Token rusak — bukan base64url yang valid');
  }

  if (packed.length <= SALT_BYTES + IV_BYTES) {
    throw new CryptoError('Token terlalu pendek untuk berisi data terenkripsi');
  }

  const salt = packed.slice(0, SALT_BYTES);
  const iv = packed.slice(SALT_BYTES, SALT_BYTES + IV_BYTES);
  const cipher = packed.slice(SALT_BYTES + IV_BYTES);
  const key = await deriveKey(password, salt);

  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
    return dec.decode(plain);
  } catch {
    // AES-GCM authentication failed: wrong password or the token was tampered with.
    throw new CryptoError('Gagal dekripsi — key salah atau token sudah diubah');
  }
}

export class CryptoError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CryptoError';
  }
}

export const CRYPTO_META = { algorithm: 'AES-256-GCM', kdf: `PBKDF2-SHA256/${ITERATIONS}`, version: VERSION };
