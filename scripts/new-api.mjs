#!/usr/bin/env node
/**
 * Scaffold a new endpoint and register it.
 *
 *   npm run new -- --category ai --name "Gemini AI" --path /v1/ai/gemini \
 *                  --desc "Gemini chat by Google" --params text,sessionId
 *
 * Creates src/apis/<category>/<slug>.js and wires it into src/apis/index.js.
 */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const INDEX = path.join(ROOT, 'src', 'apis', 'index.js');

function args() {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    out[key] = !next || next.startsWith('--') ? true : (i += 1, next);
  }
  return out;
}

const kebab = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const camel = (s) => kebab(s).replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

/**
 * Git Bash / MSYS rewrites a leading "/v1/..." argument into a Windows path
 * (e.g. "C:/Program Files/Git/v1/tools/x"), so recover the real route.
 */
function normalisePath(raw) {
  if (typeof raw !== 'string') return null;
  const cut = raw.replace(/\\/g, '/').indexOf('/v1/');
  const value = cut >= 0 ? raw.replace(/\\/g, '/').slice(cut) : raw;
  return value.startsWith('/') ? value : `/${value}`;
}

function template({ name, desc, category, endpointPath, params }) {
  const paramLines = params.length
    ? params
        .map((p, i) => `    { name: '${p}', required: ${i === 0}, placeholder: 'Enter ${p}' },`)
        .join('\n')
    : '';

  return `import { ok, fail } from '../../lib/respond.js';

/**
 * ${desc || name}
 */
export default {
  name: '${name}',
  desc: '${desc || name}',
  category: '${category}',
  path: '${endpointPath}',
  method: 'GET',
  params: [
${paramLines}
  ],

  async handler({ params, env, request }) {
    // TODO: implement. Return ok(result) or fail(message, status).
    return ok({ params });
  },
};
`;
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function register(slug, varName, category) {
  let src = await readFile(INDEX, 'utf8');
  const importLine = `import ${varName} from './${category}/${slug}.js';`;

  if (src.includes(importLine)) {
    console.log('• index.js already references this endpoint, skipping registration');
    return;
  }

  // Append the import after the last existing import.
  const lastImport = src.lastIndexOf('import ');
  const lineEnd = src.indexOf('\n', lastImport);
  src = `${src.slice(0, lineEnd + 1)}${importLine}\n${src.slice(lineEnd + 1)}`;

  // Add to the exported array, just before its closing bracket.
  src = src.replace(/\n\];\s*$/, `\n  ${varName},\n];\n`);

  await writeFile(INDEX, src);
}

async function main() {
  const a = args();
  const name = a.name || a.n;

  if (!name || typeof name !== 'string') {
    console.error('Usage: npm run new -- --name "Gemini AI" --category ai --path /v1/ai/gemini [--desc "..."] [--params text,sessionId]');
    process.exit(1);
  }

  const category = kebab(a.category || 'misc');
  const slug = kebab(a.slug || name);
  const endpointPath = normalisePath(a.path) || `/v1/${category}/${slug}`;
  const params = typeof a.params === 'string' ? a.params.split(',').map((p) => p.trim()).filter(Boolean) : [];
  const dir = path.join(ROOT, 'src', 'apis', category);
  const file = path.join(dir, `${slug}.js`);

  if (await exists(file)) {
    console.error(`✗ ${path.relative(ROOT, file)} already exists`);
    process.exit(1);
  }

  await mkdir(dir, { recursive: true });
  await writeFile(
    file,
    template({
      name,
      desc: typeof a.desc === 'string' ? a.desc : '',
      // Display category keeps the human casing the user typed.
      category: typeof a.category === 'string' ? a.category : 'Misc',
      endpointPath,
      params,
    })
  );

  await register(slug, camel(slug), category);

  console.log(`✓ created  src/apis/${category}/${slug}.js`);
  console.log(`✓ wired    src/apis/index.js`);
  console.log(`→ endpoint ${endpointPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
