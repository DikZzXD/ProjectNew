/**
 * Shared shell: sidebar, contact dock, spider cursor, smooth scrolling,
 * toasts, formatting helpers, reveal-on-scroll. Every page imports this.
 */

import { icon, spider, logo } from './icons.js';

export const CONTACTS = {
  whatsapp: 'https://wa.me/6285757411154',
  telegram: 'https://t.me/maklohytam',
  telegramBackup: 'https://t.me/dikzxinxz',
  author: 'DikZzCode',
};

export const BRAND = { name: 'DikZzCode', suffix: 'APIs', full: 'DikZzCodeAPIs' };

/* ── Formatting ─────────────────────────────────────────────── */

export function num(value) {
  return Number(value || 0).toLocaleString('en-US');
}

export function compact(value) {
  const n = Number(value || 0);
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}K`;
  if (n < 1e9) return `${(n / 1e6).toFixed(1)}M`;
  return `${(n / 1e9).toFixed(2)}B`;
}

export function bytes(value) {
  const n = Number(value || 0);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : v < 10 ? 2 : 1)} ${units[i]}`;
}

export function gb(value) {
  return `${(Number(value || 0) / 1024 ** 3).toFixed(3)} GB`;
}

export function ago(ts) {
  if (!ts) return '—';
  const diff = Math.max(0, Date.now() - Number(ts));
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

/* ── Count-up animation for stat values ─────────────────────── */

export function countTo(el, target, format = num, duration = 900) {
  const from = 0;
  const start = performance.now();

  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - t) ** 3;
    el.textContent = format(from + (target - from) * eased);
    if (t < 1) requestAnimationFrame(frame);
    else el.textContent = format(target);
  }

  requestAnimationFrame(frame);
}

/* ── Toast ──────────────────────────────────────────────────── */

let toastHost;

export function toast(message, kind = 'ok') {
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.className = 'toast-host';
    document.body.append(toastHost);
  }

  const el = document.createElement('div');
  el.className = `toast${kind === 'err' ? ' err' : ''}`;
  el.innerHTML = `${icon(kind === 'err' ? 'close' : 'check', 14)}<span>${escapeHtml(message)}</span>`;
  toastHost.append(el);

  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 260);
  }, 1900);
}

/* ── Clipboard ──────────────────────────────────────────────── */

export async function copy(text, button) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API needs a secure context; fall back to a hidden textarea.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }

  if (button) {
    const original = button.innerHTML;
    button.classList.add('done');
    button.innerHTML = `${icon('check', 12)}<span>COPIED</span>`;
    setTimeout(() => {
      button.classList.remove('done');
      button.innerHTML = original;
    }, 1400);
  }
}

/* ── Sidebar ────────────────────────────────────────────────── */

const NAV = [
  { group: 'Main' },
  { id: 'dashboard', label: 'Dashboard', href: '/', ico: 'dashboard' },
  // Cloudflare's asset layer serves clean URLs and redirects the .html form.
  { id: 'docs', label: 'Documentation', href: '/docs', ico: 'docs', badge: 'API' },
  { group: 'Support' },
  { id: 'information', label: 'Information', href: '/information', ico: 'info' },
];

export function renderSidebar(active) {
  const items = NAV.map((entry) => {
    if (entry.group) return `<div class="nav-label">${entry.group}</div>`;
    const badge = entry.badge ? `<span class="nav-badge" data-badge="${entry.id}">${entry.badge}</span>` : '';
    return `<a class="nav-item${entry.id === active ? ' active' : ''}" href="${entry.href}">
      ${icon(entry.ico, 18)}<span>${entry.label}</span>${badge}
    </a>`;
  }).join('');

  const html = `
    <aside class="sidebar">
      <a class="brand" href="/">
        <div class="brand-mark">${logo(26)}</div>
        <div>
          <div class="brand-name"><span class="dz">DikZzCode</span><i class="api">APIs</i></div>
          <div class="brand-sub">by DikZzCode</div>
        </div>
      </a>
      <nav class="nav">${items}</nav>
      <div class="sidebar-foot">
        <span class="status-dot"><i></i> Public · no API key</span>
      </div>
    </aside>
    <div class="nav-scrim" data-nav-close></div>
    <button class="nav-toggle" data-nav-toggle aria-label="Toggle navigation">${icon('menu', 20)}</button>
  `;

  document.body.insertAdjacentHTML('afterbegin', html);

  document.querySelector('[data-nav-toggle]')?.addEventListener('click', () => {
    document.body.classList.toggle('nav-open');
  });
  document.querySelector('[data-nav-close]')?.addEventListener('click', () => {
    document.body.classList.remove('nav-open');
  });
}

/* ── Contact dock ───────────────────────────────────────────── */

export function renderDock() {
  const links = [
    { href: CONTACTS.whatsapp, cls: 'wa', ico: 'whatsapp', title: 'WhatsApp', sub: '+62 857 5741 1154' },
    { href: CONTACTS.telegram, cls: 'tg', ico: 'telegram', title: 'Telegram', sub: '@maklohytam' },
    { href: CONTACTS.telegramBackup, cls: 'tg2', ico: 'telegram', title: 'Telegram 2', sub: '@dikzxinxz' },
  ];

  const html = `<div class="dock">${links
    .map(
      (l) => `<a class="dock-item" href="${l.href}" target="_blank" rel="noopener">
        <span class="dock-ico ${l.cls}">${icon(l.ico, 17)}</span>
        <span class="dock-label">${l.title}<small>${l.sub}</small></span>
      </a>`
    )
    .join('')}</div>`;

  document.body.insertAdjacentHTML('beforeend', html);
}

/* ── Spider cursor ──────────────────────────────────────────── */

/**
 * A spider follows the pointer on its own drag-line. Two bodies are tracked:
 * the spider eases toward the pointer, and the web is drawn as a curve from
 * where the spider is to where the pointer actually is, so the thread bends
 * when you move fast.
 */
export function initCursor() {
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!fine || calm) return;

  const bug = document.createElement('div');
  bug.className = 'spider';
  bug.innerHTML = spider();

  const web = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  web.setAttribute('class', 'web');
  const thread = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  web.append(thread);

  document.body.append(web, bug);
  document.body.classList.add('has-cursor');

  let mx = innerWidth / 2;
  let my = innerHeight / 2;
  let sx = mx;
  let sy = my;
  let anchorX = mx;
  let anchorY = my;
  let idle;

  addEventListener('mousemove', (e) => {
    mx = e.clientX;
    my = e.clientY;

    const hot = e.target.closest?.('a, button, input, textarea, .card, .chip, .lang, .copy, .stat');
    bug.classList.toggle('hot', Boolean(hot));

    // After a pause the anchor catches up, so the thread retracts when idle.
    clearTimeout(idle);
    idle = setTimeout(() => {
      anchorX = mx;
      anchorY = my;
    }, 320);
  });

  addEventListener('mousedown', (e) => {
    bug.classList.remove('press');
    // Re-adding on the next frame restarts the animation.
    requestAnimationFrame(() => bug.classList.add('press'));

    const ring = document.createElement('div');
    ring.className = 'snap';
    ring.style.left = `${e.clientX}px`;
    ring.style.top = `${e.clientY}px`;
    document.body.append(ring);
    setTimeout(() => ring.remove(), 560);
  });

  (function loop() {
    sx += (mx - sx) * 0.2;
    sy += (my - sy) * 0.2;

    // Rotate into the direction of travel, so the spider always faces forward.
    const dx = mx - sx;
    const dy = my - sy;
    const speed = Math.hypot(dx, dy);
    const angle = speed > 1.4 ? (Math.atan2(dy, dx) * 180) / Math.PI + 90 : null;
    if (angle !== null) bug.dataset.angle = angle;

    bug.style.transform = `translate(${sx}px, ${sy}px) rotate(${bug.dataset.angle || 0}deg)`;

    anchorX += (mx - anchorX) * 0.035;
    anchorY += (my - anchorY) * 0.035;

    // Quadratic curve sagging away from the straight line.
    const cx = (anchorX + sx) / 2 + (sy - anchorY) * 0.16;
    const cy = (anchorY + sy) / 2 + (anchorX - sx) * 0.16;
    thread.setAttribute('d', `M ${anchorX} ${anchorY} Q ${cx} ${cy} ${sx} ${sy}`);
    thread.style.opacity = Math.min(0.85, speed / 24);

    requestAnimationFrame(loop);
  })();
}

/* ── Ambient background ─────────────────────────────────────── */

/** The drifting aurora blobs behind the glass. */
export function initAura() {
  if (document.querySelector('.aura')) return;
  document.body.insertAdjacentHTML('afterbegin', '<div class="aura"><i></i><i></i><i></i></div>');
}

/* ── Scrolling ──────────────────────────────────────────────── */

/**
 * Progress bar only — native scroll feels smoother than a custom lerp,
 * which was reading as choppy ("patah-patah") on wheel input.
 */
export function initSmoothScroll() {
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (calm) return;

  const bar = document.createElement('div');
  bar.className = 'scroll-bar';
  document.body.append(bar);

  function progress() {
    const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    const y = scrollY;
    bar.style.transform = `scaleX(${max ? y / max : 0})`;
    parallax(y);
  }

  addEventListener('scroll', progress, { passive: true });
  addEventListener('resize', progress);
  progress();
}

/** Depth: elements marked .para drift at a fraction of the scroll speed. */
function parallax(offset) {
  document.querySelectorAll('.para').forEach((el) => {
    const rate = Number(el.dataset.rate || 0.08);
    el.style.setProperty('--py', `${-offset * rate}px`);
  });
}

/* ── Reveal on scroll ───────────────────────────────────────── */

export function initReveal(root = document) {
  const targets = root.querySelectorAll('.reveal:not(.in)');
  if (!targets.length) return;

  // Immediate reveal for anything already in the first viewport.
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const delay = Number(el.dataset.revealDelay || 0);
        setTimeout(() => el.classList.add('in'), delay);
        io.unobserve(el);
      });
    },
    { rootMargin: '0px 0px -6% 0px', threshold: 0.08 }
  );

  targets.forEach((t, i) => {
    if (!t.dataset.revealDelay) t.dataset.revealDelay = String(Math.min(i % 4, 3) * 35);
    io.observe(t);
  });
}

/** Pointer-follow sheen on cards and stat tiles. */
export function initCardGlow(root = document) {
  root.querySelectorAll('.card, .stat').forEach((card) => {
    if (card.dataset.glow) return;
    card.dataset.glow = '1';
    card.addEventListener('mousemove', (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${e.clientX - r.left}px`);
      card.style.setProperty('--my', `${e.clientY - r.top}px`);
    });
  });
}

/* ── Boot ───────────────────────────────────────────────────── */

export function boot(activeNav) {
  initAura();
  renderSidebar(activeNav);
  renderDock();
  initCursor();
  initSmoothScroll();
}

export { icon };

