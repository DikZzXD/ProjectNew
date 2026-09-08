/**
 * Icon set — thin-line SVG glyphs used instead of emoji.
 * icon('rocket', 18) returns an inline SVG string.
 */

const P = {
  dashboard:
    '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  docs: '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H14l6 6v11.5A1.5 1.5 0 0 1 18.5 22h-13A1.5 1.5 0 0 1 4 20.5z"/><path d="M14 3v6h6"/><path d="M8.5 13.5h7M8.5 17.5h4.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><circle cx="12" cy="7.75" r=".9" fill="currentColor" stroke="none"/>',
  search: '<circle cx="10.75" cy="10.75" r="6.75"/><path d="m15.9 15.9 4.35 4.35"/>',
  layers: '<path d="m12 3 8.5 4.6L12 12.2 3.5 7.6z"/><path d="m3.5 12.4 8.5 4.6 8.5-4.6"/><path d="m3.5 16.9 8.5 4.6 8.5-4.6"/>',
  chip: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M4 10h3M4 14h3M17 10h3M17 14h3M10 4v3M14 4v3M10 17v3M14 17v3"/>',
  ram: '<rect x="2.5" y="7" width="19" height="10" rx="2"/><path d="M7 17v3M12 17v3M17 17v3M6.5 10.5h11"/>',
  bolt: '<path d="M13.5 2 4 13.5h6L9.5 22 20 10.5h-6.5z"/>',
  activity: '<path d="M3 12h4l2.5-7 4 14 2.5-7h5"/>',
  cloud: '<path d="M17.5 18a4.5 4.5 0 0 0 .3-9 6 6 0 0 0-11.6 1.6A3.7 3.7 0 0 0 7 18z"/>',
  gauge: '<path d="M20.5 17a9.5 9.5 0 1 0-17 0"/><path d="M12 12.5 16 9"/><circle cx="12" cy="13" r="1.6"/>',
  arrowUp: '<path d="M12 20V4"/><path d="m5.5 10.5 6.5-6.5 6.5 6.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3.5 2.2"/>',
  play: '<path d="M8 5.5 18.5 12 8 18.5z"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 5.5h-9a2 2 0 0 0-2 2v9"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18"/>',
  code: '<path d="m9 8-4.5 4L9 16"/><path d="m15 8 4.5 4L15 16"/>',
  terminal: '<rect x="2.5" y="4" width="19" height="16" rx="2.5"/><path d="m7 10 2.5 2L7 14M12.5 14.5h4"/>',
  key: '<circle cx="8.5" cy="15.5" r="4"/><path d="m11.4 12.6 8-8M17 5.5l2.5 2.5M14.5 8l2.5 2.5"/>',
  shield: '<path d="M12 3l7.5 3v6c0 4.4-3.1 8.2-7.5 9.5C7.6 20.2 4.5 16.4 4.5 12V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  whatsapp:
    '<path d="M12 3a9 9 0 0 0-7.7 13.6L3 21l4.5-1.3A9 9 0 1 0 12 3z"/><path d="M9 9.2c0 3 2.3 5.3 5.2 5.4.6 0 1.3-.4 1.3-1v-.8l-1.9-.8-.9 1a5.2 5.2 0 0 1-2.3-2.3l1-.9-.8-1.9h-.8c-.6 0-1 .7-1 1.3z" fill="currentColor" stroke="none"/>',
  telegram: '<path d="M21 4.5 2.8 11.3l5.4 1.7 1.7 5.6 2.8-3.2 4.4 3.1z"/><path d="m8.2 13 9.6-6.4-6.9 8.8"/>',
  spark: '<path d="M12 3v4M12 17v4M4.5 12h4M15.5 12h4M6.7 6.7l2.8 2.8M14.5 14.5l2.8 2.8M17.3 6.7l-2.8 2.8M9.5 14.5l-2.8 2.8"/>',
  db: '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6"/><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/>',
  external: '<path d="M14 4h6v6"/><path d="m20 4-9 9"/><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  image: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><circle cx="8.75" cy="10" r="1.6"/><path d="m4 17 5-4.5 4.5 4 3-2.5L20 17"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 1 5.3 5.3l-8.5 8.5a2.5 2.5 0 0 1-3.5-3.5z"/><path d="M8.5 4.5 4 9l2.5 2.5"/>',
  brain: '<path d="M9.5 4A3.5 3.5 0 0 0 6 7.5 3 3 0 0 0 5 13a3 3 0 0 0 1.5 4.3A3 3 0 0 0 12 19V4.5A2 2 0 0 0 9.5 4z"/><path d="M14.5 4A3.5 3.5 0 0 1 18 7.5 3 3 0 0 1 19 13a3 3 0 0 1-1.5 4.3A3 3 0 0 1 12 19"/>',
  mail: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="m3.5 7.5 7.3 5.2a2 2 0 0 0 2.4 0l7.3-5.2"/>',
  inbox:
    '<path d="M3 13.5 5.6 5.2A2 2 0 0 1 7.5 4h9a2 2 0 0 1 1.9 1.2L21 13.5v4.9A1.6 1.6 0 0 1 19.4 20H4.6A1.6 1.6 0 0 1 3 18.4z"/><path d="M3 13.5h5l1.4 2.4h5.2L16 13.5h5"/>',
  hash: '<path d="M9 4 7.4 20M16.6 4 15 20M4.2 9h15.6M3.6 15h15.6"/>',
  qr: '<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.5"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.5"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.5"/><path d="M14 14h3v3h-3zM20.5 14v3M17.5 20.5h3M14 20.5h.5"/>',
};

/**
 * Spider cursor glyph. Drawn facing straight up because initCursor() adds 90°
 * to the travel angle, so 0° must point along -Y. Classes match effects.css:
 * `.body` ticks on hover, `.leg l1–l4` are the staggered leg pairs.
 */
export function spider() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <g class="leg l1"><path d="M10.1 8.4C6.9 6.9 5.4 4.4 5.9 2.2"/><path d="M13.9 8.4c3.2-1.5 4.7-4 4.2-6.2"/></g>
    <g class="leg l2"><path d="M9.7 9.9C6 9.7 3.4 8.3 2.1 6.1"/><path d="M14.3 9.9c3.7-.2 6.3-1.6 7.6-3.8"/></g>
    <g class="leg l3"><path d="M9.8 11.4C6.4 12.2 4 12.8 2.3 11.8"/><path d="M14.2 11.4c3.4.8 5.8 1.4 7.5.4"/></g>
    <g class="leg l4"><path d="M10.3 12.6C7.2 14.3 5.7 16.7 6 18.8"/><path d="M13.7 12.6c3.1 1.7 4.6 4.1 4.3 6.2"/></g>
    <g class="body">
      <ellipse cx="12" cy="15.1" rx="3.9" ry="4.6" fill="rgba(255,255,255,.32)"/>
      <path d="M12 11.4v7.6M9.4 13.2h5.2M9.6 16.8h4.8" stroke-width="1"/>
      <circle cx="12" cy="9.2" r="2.5" fill="rgba(255,255,255,.5)"/>
      <circle cx="11" cy="8.4" r=".62" fill="currentColor" stroke="none"/>
      <circle cx="13" cy="8.4" r=".62" fill="currentColor" stroke="none"/>
    </g>
  </svg>`;
}

/**
 * Brand logomark — a monochrome geometric glyph (interlocked hexagon + node
 * network) used in the sidebar brand tile. Stroke follows currentColor so it
 * inherits the theme's white ink.
 */
export function logo(size = 26) {
  // Chunked geometric mark — thick stroke hex + D block for neo-brutal wordmark.
  return `<svg class="logo-mark" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none"
    aria-hidden="true">
    <rect x="2" y="2" width="28" height="28" rx="4" fill="currentColor" opacity="0.12"/>
    <path d="M7 7h10.5c4.2 0 7 2.6 7 6.5S21.7 20 17.5 20H12v5H7V7zm5 4.2v4.6h5c1.7 0 2.7-.9 2.7-2.3S18.7 11.2 17 11.2H12z"
      fill="currentColor"/>
    <rect x="22" y="22" width="6" height="6" fill="currentColor"/>
  </svg>`;
}

export function icon(name, size = 18, cls = 'ico') {
  const body = P[name] || P.spark;
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true">${body}</svg>`;
}

/** Best-guess glyph for a category name. */
export function categoryIcon(name) {
  const key = String(name).toLowerCase();
  if (key.includes('bypass') || key.includes('captcha') || key.includes('turnstile')) return 'shield';
  if (key.includes('stalk')) return 'search';
  if (key.includes('alight') || key.includes('motion')) return 'bolt';
  if (key.includes('mail') || key.includes('email')) return 'mail';
  if (key.includes('ai') || key.includes('chat')) return 'brain';
  if (key.includes('image') || key.includes('photo') || key.includes('canvas') || key.includes('brat')) return 'image';
  if (key.includes('berita') || key.includes('news')) return 'docs';
  if (key.includes('qr')) return 'qr';
  if (key.includes('tool')) return 'wrench';
  if (key.includes('info')) return 'globe';
  if (key.includes('download')) return 'arrowUp';
  return 'spark';
}

export default icon;
