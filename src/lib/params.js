/**
 * Param collection + validation.
 *
 * Values are read from the query string first, then the JSON or form body
 * (POST). Endpoints only declare what they need; this module handles the
 * plumbing and produces a consistent "missing parameter" message.
 */

export async function collect(request, endpoint) {
  const url = new URL(request.url);
  const values = {};

  for (const [key, value] of url.searchParams) values[key] = value;

  if (request.method === 'POST') {
    const type = request.headers.get('content-type') || '';
    try {
      if (type.includes('application/json')) {
        Object.assign(values, await request.json());
      } else if (type.includes('form')) {
        for (const [key, value] of await request.formData()) values[key] = value;
      }
    } catch {
      // Malformed body: fall back to whatever the query string gave us.
    }
  }

  const params = {};
  const missing = [];

  for (const spec of endpoint.params) {
    let value = values[spec.name];

    // An uploaded file arrives as a File/Blob — pass it through untouched, and
    // treat its presence as "provided" so a required-file check can see it.
    if (spec.type === 'file' && value && typeof value === 'object' && typeof value.arrayBuffer === 'function') {
      params[spec.name] = value;
      continue;
    }

    if (value === undefined || value === '') {
      if (spec.required) {
        missing.push(spec.name);
        continue;
      }
      value = spec.default;
    }

    if (spec.type === 'number' && value !== '' && value !== undefined) {
      const num = Number(value);
      params[spec.name] = Number.isFinite(num) ? num : spec.default;
    } else {
      params[spec.name] = value;
    }
  }

  return { params, missing };
}

export function missingMessage(missing) {
  const list = missing.map((m) => `"${m}"`).join(', ');
  return `Parameter ${list} wajib diisi / is required`;
}
