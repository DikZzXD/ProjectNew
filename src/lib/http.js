/**
 * Small shared helpers for endpoint handlers.
 */

/** fetch() with a hard timeout so a dead upstream can't hang the Worker. */
export async function fetchJSON(url, options = {}, timeoutMs = 15000) {
  const res = await fetchWithTimeout(url, options, timeoutMs);
  const text = await res.text();

  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text) };
  } catch {
    return { ok: false, status: res.status, data: null, text };
  }
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; DikZzCodeAPIs/1.0; +https://api.makluxnxx.my.id)',
        ...(options.headers || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Build a query string, skipping empty values. */
export function qs(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  return search.toString();
}

export function clamp(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}
