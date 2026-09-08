/**
 * Dashboard: rolling 24-hour figures, this month's summary, top endpoints,
 * and a live feed of the most recent requests. Refreshes every 20s.
 *
 * The headline cards read from `stats.window`, which covers the last 24 hours
 * only — a row ages out of the database and the number drops, so the reset needs
 * no cron job. Lifetime history lives in `stats.month` and `stats.totals`.
 */

import { boot, initReveal, initCardGlow, countTo, num, compact, bytes, gb, ago, escapeHtml } from './app.js';

boot('dashboard');

const el = (id) => document.getElementById(id);

/** "4 jam" / "18 menit" — how long until the oldest request ages out. */
function until(ms) {
  const mins = Math.max(0, Math.round(Number(ms) / 60000));
  if (mins < 60) return `${mins} menit`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? `${hours} jam ${rest} menit` : `${hours} jam`;
}

/** Success percentage, with an empty window counting as perfect. */
function successRate(hits, errors) {
  if (!hits) return '100.0';
  return (100 - (errors / hits) * 100).toFixed(1);
}

function renderTop(top) {
  const host = el('top');

  if (!top.length) {
    host.innerHTML = '<div class="empty">Belum ada endpoint yang dipakai</div>';
    return;
  }

  const peak = Math.max(...top.map((t) => t.hits), 1);

  host.innerHTML = top
    .map(
      (t, i) => `<div class="rank">
        <span class="rank-no">${i + 1}</span>
        <div class="rank-main">
          <div class="rank-name">${escapeHtml(t.name || t.path)}</div>
          <div class="rank-path">${escapeHtml(t.path)}</div>
          <div class="rank-bar"><i data-w="${Math.round((t.hits / peak) * 100)}"></i></div>
        </div>
        <div>
          <div class="rank-value">${compact(t.hits)}</div>
          <div class="rank-sub">${bytes(t.bytes)}</div>
        </div>
      </div>`
    )
    .join('');

  // Animate the inline bars after layout so the transition actually runs.
  requestAnimationFrame(() => {
    host.querySelectorAll('.rank-bar > i').forEach((bar) => {
      bar.style.width = `${bar.dataset.w}%`;
    });
  });
}

function renderFeed(recent) {
  const host = el('feed');

  if (!recent.length) {
    host.innerHTML = '<div class="empty">Belum ada request masuk</div>';
    return;
  }

  host.innerHTML = recent
    .map(
      (r) => `<div class="feed-row">
        <span class="code s${String(r.status)[0]}">${r.status}</span>
        <div class="feed-main">
          <div class="feed-name">${escapeHtml(r.name || r.path)}</div>
          <div class="feed-meta">${r.method} ${escapeHtml(r.path)} · ${r.ms}ms · ${bytes(r.bytes)} · ${escapeHtml(r.country)}</div>
        </div>
        <span class="feed-time">${ago(r.ts)}</span>
      </div>`
    )
    .join('');
}

let first = true;

async function load() {
  try {
    const [stats, sys] = await Promise.all([
      fetch('/api/stats').then((r) => r.json()),
      fetch('/api/system').then((r) => r.json()),
    ]);

    const w = stats.window || {};
    const m = stats.month || {};
    const t = stats.totals || {};

    if (first) {
      countTo(el('t-requests'), w.hits || 0, compact);
      countTo(el('t-endpoints'), stats.endpoints || 0, num);
      countTo(el('h-requests'), t.hits || 0, num, 1200);
    } else {
      el('t-requests').textContent = compact(w.hits || 0);
      el('t-endpoints').textContent = num(stats.endpoints || 0);
      el('h-requests').textContent = num(t.hits || 0);
    }

    el('h-endpoints').textContent = `${num(stats.endpoints || 0)} endpoint live`;
    el('h-colo').textContent = `${sys.colo} · ${sys.city !== '--' ? sys.city : sys.region}`;

    // Headline row — rolling 24-hour window.
    el('t-requests-foot').textContent = w.hits
      ? `${num(w.errors || 0)} error · ${successRate(w.hits, w.errors)}% sukses · reset dalam ${until(w.resets_in_ms)}`
      : 'Belum ada request dalam 24 jam terakhir';
    el('t-bandwidth').textContent = gb(w.bytes);
    el('t-bandwidth-foot').textContent = `${bytes(w.bytes)} dalam 24 jam terakhir`;
    el('t-latency').textContent = `${Math.round(w.avg_ms || 0)}ms`;
    el('t-latency-foot').textContent = `${sys.colo} · ${sys.runtime}`;
    el('t-endpoints-foot').textContent = `${num(w.endpoints || 0)} dipakai dalam 24 jam`;

    // Monthly summary — from daily_stats, so it survives the 24 h reset.
    el('m-label').textContent = m.label || 'Bulan ini';
    el('m-requests').textContent = num(m.hits || 0);
    el('m-bandwidth').textContent = bytes(m.bytes || 0);
    el('m-days').textContent = `${num(m.days || 0)} hari aktif`;
    el('m-success').textContent = `${successRate(m.hits || 0, m.errors || 0)}%`;
    el('m-errors').textContent = `${num(m.errors || 0)} error`;
    el('m-alltime').textContent = num(t.hits || 0);
    el('m-alltime-sub').textContent = `requests · ${bytes(t.bytes || 0)}`;

    renderTop(stats.top || []);
    renderFeed(stats.recent || []);

    el('sync').textContent = `Synced ${new Date().toLocaleTimeString('en-GB')}`;

    if (stats.offline) {
      el('sync').textContent = 'Stats DB belum di-init — jalankan npm run db:init';
    }

    first = false;
  } catch (error) {
    el('sync').textContent = `Gagal memuat: ${error.message}`;
  }
}

load();
setInterval(load, 20000);
initReveal();
initCardGlow();

// Refresh button in the activity panel head.
document.getElementById('refresh')?.addEventListener('click', (e) => {
  e.currentTarget.querySelector('.ico')?.animate(
    [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
    { duration: 600, easing: 'ease-in-out' }
  );
  load();
});
