/**
 * Documentation page: stat cards, search, category filter, endpoint grid.
 */

import { boot, initReveal, initCardGlow, countTo, num, compact, toast, icon } from './app.js';
import { categoryIcon } from './icons.js';
import { open } from './playground.js';

const grid = document.getElementById('catalog');
const search = document.getElementById('search');
const chipRow = document.getElementById('chips');

let catalog = { total: 0, categories: [] };
let filter = { text: '', category: 'all' };

boot('docs');

function cardMarkup(item) {
  const params = (item.params || []).filter((p) => p.name);
  const chips = params.length
    ? `<div class="card-params">${params
        .slice(0, 5)
        .map((p) => `<span class="param-chip${p.required ? ' req' : ''}">${p.name}${p.required ? '<i class="tag-req">wajib</i>' : ''}</span>`)
        .join('')}${params.length > 5 ? `<span class="param-chip more">+${params.length - 5}</span>` : ''}</div>`
    : `<div class="card-params"><span class="param-chip none">no params</span></div>`;

  const rtype = item.responseType && item.responseType !== 'json'
    ? `<span class="rtype">${item.responseType}</span>`
    : '';

  // The path reads as a request line — same verb-chip + mono-URL language as the
  // playground's URL strip, so a card and its modal look like the same thing.
  const path = `<div class="card-path">
      <span class="path-verb${item.method === 'POST' ? ' post' : ''}">${item.method}</span>
      <span class="path-text">${item.path}</span>
    </div>`;

  return `<article class="card reveal" data-path="${item.path}">
    <div>
      <div class="card-name">${item.name}${rtype}</div>
      <div class="card-desc">${item.desc || ''}</div>
      ${path}
      ${chips}
    </div>
    <div class="card-foot">
      <span class="card-count">${params.length ? `${params.length} param${params.length > 1 ? 's' : ''}` : 'siap pakai'}</span>
      <button class="btn btn-sm" data-try="${item.path}">${icon('play', 12)}<span>COBA</span></button>
    </div>
  </article>`;
}

function render() {
  const text = filter.text.toLowerCase();

  const groups = catalog.categories
    .filter((c) => filter.category === 'all' || c.name === filter.category)
    .map((c) => ({
      name: c.name,
      items: c.items.filter(
        (i) =>
          !text ||
          i.name.toLowerCase().includes(text) ||
          (i.desc || '').toLowerCase().includes(text) ||
          i.path.toLowerCase().includes(text)
      ),
    }))
    .filter((c) => c.items.length);

  if (!groups.length) {
    grid.innerHTML = `<div class="empty">${icon('search', 22)}<br><br>Tidak ada endpoint yang cocok dengan "${filter.text}"</div>`;
    return;
  }

  grid.innerHTML = groups
    .map(
      (c) => `<section>
        <div class="cat-head">${icon(categoryIcon(c.name), 15)} ${c.name} <span class="count">${c.items.length}</span></div>
        <div class="card-grid">${c.items.map(cardMarkup).join('')}</div>
      </section>`
    )
    .join('');

  initReveal(grid);
  initCardGlow(grid);
}

function renderChips() {
  const names = ['all', ...catalog.categories.map((c) => c.name)];
  chipRow.innerHTML = names
    .map(
      (n) =>
        `<button class="chip${n === 'all' ? ' active' : ''}" data-cat="${n}">${n === 'all' ? `All · ${catalog.total}` : n}</button>`
    )
    .join('');

  chipRow.querySelectorAll('[data-cat]').forEach((chip) =>
    chip.addEventListener('click', () => {
      filter.category = chip.dataset.cat;
      chipRow.querySelectorAll('[data-cat]').forEach((c) => c.classList.toggle('active', c === chip));
      render();
    })
  );
}

function findEndpoint(path) {
  for (const c of catalog.categories) {
    const hit = c.items.find((i) => i.path === path);
    if (hit) return hit;
  }
  return null;
}

/* ── Events ─────────────────────────────────────────────────── */

grid.addEventListener('click', (e) => {
  const button = e.target.closest('[data-try]');
  const card = e.target.closest('.card');
  const path = button?.dataset.try || card?.dataset.path;
  if (!path) return;

  const endpoint = findEndpoint(path);
  if (endpoint) open(endpoint);
});

search.addEventListener('input', () => {
  filter.text = search.value.trim();
  render();
});

addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== search) {
    e.preventDefault();
    search.focus();
  }
});

/* ── Load ───────────────────────────────────────────────────── */

async function load() {
  try {
    const [cat, sys, stats] = await Promise.all([
      fetch('/api/catalog').then((r) => r.json()),
      fetch('/api/system').then((r) => r.json()),
      fetch('/api/stats').then((r) => r.json()),
    ]);

    catalog = { total: cat.total, categories: cat.categories };

    countTo(document.getElementById('s-endpoints'), cat.total, num);
    countTo(document.getElementById('s-categories'), cat.categories.length, num);

    document.getElementById('s-ram').textContent = sys.ram_label;
    document.getElementById('s-ram-foot').textContent = `${sys.runtime} · ${sys.colo}`;
    document.getElementById('s-cpu').textContent = sys.cpu_label;
    document.getElementById('s-cpu-foot').textContent = `${sys.cpu_ms_limit / 1000}s CPU limit`;

    const hits = stats?.totals?.hits || 0;
    document.getElementById('s-endpoints-foot').textContent = `${compact(hits)} total requests served`;

    document.querySelectorAll('.meter > i').forEach((bar) => {
      bar.style.width = bar.dataset.fill || '42%';
    });

    const badge = document.querySelector('[data-badge="docs"]');
    if (badge) badge.textContent = cat.total;

    renderChips();
    render();
  } catch (error) {
    grid.innerHTML = `<div class="empty">Gagal memuat katalog: ${error.message}</div>`;
    toast('Gagal memuat katalog', 'err');
  }
}

load();
initReveal();
initCardGlow();
