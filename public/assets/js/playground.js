/**
 * The TRY modal: parameter form, live URL, snippet tabs, real request.
 */

import { icon } from './icons.js';
import { copy, escapeHtml, toast, bytes } from './app.js';
import { LANGS, snippet } from './snippets.js';

const ORIGIN = location.origin;

let scrim;
let state = { endpoint: null, lang: 'curl' };

/**
 * Colourise a JSON string for the response box. Booleans get a true/false
 * variant so a `"status": false` reads at a glance, and URLs inside string
 * values are underlined; everything else stays on the monochrome ramp.
 */
function highlight(text) {
  return escapeHtml(text)
    .replace(/&quot;([^&]*?)&quot;(\s*:)/g, '<span class="j-key">&quot;$1&quot;</span>$2')
    .replace(/:\s*&quot;([\s\S]*?)&quot;/g, (m, value) => {
      const cls = /^https?:\/\//.test(value) ? 'j-url' : 'j-str';
      return `: <span class="${cls}">&quot;${value}&quot;</span>`;
    })
    .replace(/:\s*(-?\d+\.?\d*)/g, ': <span class="j-num">$1</span>')
    .replace(/:\s*(true|false)/g, (m, b) => `: <span class="j-bool ${b === 'true' ? 't' : 'f'}">${b}</span>`)
    .replace(/:\s*null/g, ': <span class="j-null">null</span>');
}

/**
 * Params that need the full grid row. Two groups: URL-ish names stay a
 * single-line input (a 2-row textarea for one URL just wastes vertical space,
 * and the input area is the part that has to read tidy), while genuinely
 * multi-line payloads get a textarea.
 */
const AREA_NAME = /text|prompt|code|content|message|data/i;
const URL_NAME = /^(link|url|post_link|target)$/i;
const WIDE_NAME = (name) => AREA_NAME.test(name) || URL_NAME.test(name);

/**
 * Render the input control for one param. `type:'select'` becomes a dropdown
 * (options from `p.options`, `p.default` preselected); long free-text names get
 * a textarea; everything else is a single-line input.
 */
function fieldControl(p) {
  if (p.type === 'select' && Array.isArray(p.options) && p.options.length) {
    const opts = p.options
      .map((o) => {
        const val = String(o);
        const label = val === '' ? '— default —' : val;
        const sel = val === String(p.default ?? '') ? ' selected' : '';
        return `<option value="${escapeHtml(val)}"${sel}>${escapeHtml(label)}</option>`;
      })
      .join('');
    return `<select class="input" data-param="${escapeHtml(p.name)}">${opts}</select>`;
  }

  if (p.type === 'file') {
    return `<input class="input input-file" data-param="${escapeHtml(p.name)}" data-file type="file">`;
  }

  if (AREA_NAME.test(p.name)) {
    return `<textarea class="input" data-param="${escapeHtml(p.name)}" rows="2" placeholder="${escapeHtml(p.placeholder)}">${escapeHtml(p.default)}</textarea>`;
  }
  return `<input class="input" data-param="${escapeHtml(p.name)}" type="${p.type === 'number' ? 'number' : 'text'}"
     placeholder="${escapeHtml(p.placeholder)}" value="${escapeHtml(p.default)}">`;
}

/** Full labelled field (label + control + hint) for one param definition. */
function paramField(p) {
  // Textareas, URLs and file pickers need the whole row; short inputs pair up.
  const wide = WIDE_NAME(p.name) || p.type === 'file' ? ' wide' : '';
  return `<div class="field${wide}">
    <label>${escapeHtml(p.name)}${p.required ? '<span class="req">*</span>' : '<span class="pill-opt">optional</span>'}</label>
    ${fieldControl(p)}
    ${p.desc ? `<span class="field-hint">${escapeHtml(p.desc)}</span>` : ''}
  </div>`;
}

/** The live request URL strip: method chip + URL + inline copy. */
function urlStrip(method) {
  return `<div class="field-url">
    <span class="url-verb">${escapeHtml(method || 'GET')}</span>
    <span class="url-text" data-url></span>
    <button class="copy copy-url" data-copy-url title="Copy URL">${icon('copy', 11)}</button>
  </div>`;
}

/**
 * The shared two-column body. `left` holds whatever drives the request (steps +
 * fields); the right column always carries the URL, snippet tabs and response,
 * so on a wide screen the form and the result are visible at the same time.
 * Each block is a labelled `.pg-panel` so the three regions (input, request,
 * response) read as distinct cards rather than one undifferentiated stack.
 */
function shell({ left, method, note }) {
  return `<div class="pg">
    <div class="pg-col">${left}</div>
    <div class="pg-col">
      <div class="pg-panel">
        <div class="box-label">${icon('code', 12)} Request</div>
        ${urlStrip(method)}
        <div class="langs">${LANGS.map(
          (l) => `<button class="lang${l.id === 'curl' ? ' active' : ''}" data-lang="${l.id}">${l.label}</button>`
        ).join('')}</div>
        <div class="code-box">
          <button class="copy" data-copy-snippet>${icon('copy', 11)}<span>COPY</span></button>
          <pre data-snippet></pre>
        </div>
      </div>
      <div class="pg-panel">
        <div class="box-label">${icon('terminal', 12)} Response
          <span class="pill" data-status>idle</span>
          <span class="meta-chip" data-meta hidden></span>
        </div>
        <div class="code-box tall" data-response-box>
          <button class="copy" data-copy-response>${icon('copy', 11)}<span>COPY</span></button>
          <pre data-response>${escapeHtml(note)}</pre>
        </div>
      </div>
    </div>
  </div>`;
}

/** Wire the language tabs and the three copy buttons of a freshly built shell. */
function wireShell() {
  scrim.querySelectorAll('[data-lang]').forEach((tab) =>
    tab.addEventListener('click', () => {
      state.lang = tab.dataset.lang;
      scrim.querySelectorAll('[data-lang]').forEach((t) => t.classList.toggle('active', t === tab));
      refresh();
    })
  );

  scrim.querySelector('[data-copy-url]')?.addEventListener('click', (e) => {
    copy(scrim.querySelector('[data-url]')?.textContent || '', e.currentTarget);
  });

  scrim.querySelector('[data-copy-snippet]').addEventListener('click', (e) => {
    copy(e.currentTarget.dataset.text || '', e.currentTarget);
  });

  scrim.querySelector('[data-copy-response]').addEventListener('click', (e) => {
    copy(scrim.querySelector('[data-response]')?.textContent || '', e.currentTarget);
  });
}

function ensureHost() {
  if (scrim) return;

  scrim = document.createElement('div');
  scrim.className = 'modal-scrim';
  scrim.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-head">
        <div>
          <div class="modal-title" data-title></div>
          <div class="modal-sub" data-sub></div>
        </div>
        <button class="modal-x" data-close aria-label="Close">${icon('close', 17)}</button>
      </div>
      <div class="modal-body" data-body></div>
      <div class="modal-foot">
        <span class="hint">ESC to close</span>
        <button class="btn btn-accent" data-submit>${icon('play', 12)}<span>Submit Query</span></button>
      </div>
    </div>`;

  document.body.append(scrim);

  scrim.addEventListener('click', (e) => {
    if (e.target === scrim || e.target.closest('[data-close]')) close();
  });

  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && scrim.classList.contains('open')) close();
  });

  scrim.querySelector('[data-submit]').addEventListener('click', send);
}

/** Current param values, empty entries removed. File inputs are handled separately. */
function readParams() {
  const values = {};
  scrim.querySelectorAll('[data-param]').forEach((input) => {
    if (input.dataset.file !== undefined) return; // files go through readFiles()
    const value = input.value.trim();
    if (value) values[input.dataset.param] = value;
  });
  return values;
}

/** Any file inputs with a chosen file, as [name, File] pairs. */
function readFiles() {
  const files = [];
  scrim.querySelectorAll('[data-file]').forEach((input) => {
    if (input.files && input.files[0]) files.push([input.dataset.param, input.files[0]]);
  });
  return files;
}

function buildUrl() {
  const params = readParams();
  // Stepped flows that use sub-path routing (the userbot ones) hang the current
  // step off the endpoint path, so the request states its step explicitly instead
  // of leaving the server to infer it from which fields happen to be filled.
  const suffix = state.ubot?.suffix ? `/${state.ubot.suffix}` : '';
  const base = `${ORIGIN}${state.endpoint.path}${suffix}`;

  // POST endpoints carry their params in a body, so the visible URL stays clean;
  // GET endpoints put everything in the query string.
  if (state.endpoint.method === 'POST') {
    return { url: base, params };
  }

  const query = new URLSearchParams(params).toString();
  return { url: query ? `${base}?${query}` : `${base}?`, params };
}

/**
 * fetch() init for the current endpoint. A POST with a chosen file goes out as
 * multipart/form-data (so the file rides along); a plain POST sends JSON; GET
 * is a bare request.
 */
function requestInit(params) {
  if (state.endpoint.method !== 'POST') return { method: state.endpoint.method };

  const files = readFiles();
  if (files.length) {
    const form = new FormData();
    for (const [k, v] of Object.entries(params)) form.append(k, v);
    for (const [k, file] of files) form.append(k, file, file.name);
    return { method: 'POST', body: form }; // let the browser set the multipart boundary
  }

  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params || {}),
  };
}

function refresh() {
  const { url, params } = buildUrl();

  scrim.querySelector('[data-url]').textContent = url;

  const code = snippet(state.lang, { url, method: state.endpoint.method, params });
  scrim.querySelector('[data-snippet]').textContent = code;
  scrim.querySelector('[data-copy-snippet]').dataset.text = code;
}

/**
 * The left column's header + param grid. Giving the inputs a labelled block of
 * their own (mirroring "Response" on the right) is what makes the form read as
 * a tidy panel instead of controls floating at the top of the modal.
 */
function fieldsBlock(params, { label = 'Parameters', extra = '' } = {}) {
  const list = params || [];
  const required = list.filter((p) => p.required).length;
  const tally = list.length
    ? `<span class="pill">${list.length} field${list.length > 1 ? 's' : ''}</span>${
        required ? `<span class="meta-chip">${required} wajib</span>` : ''
      }`
    : '<span class="pill">none</span>';

  return `<div class="pg-panel">
    <div class="box-label">${icon('wrench', 12)} ${escapeHtml(label)}${tally}</div>
    ${extra}
    ${
      list.length
        ? `<div class="pg-fields">${list.map(paramField).join('')}</div>`
        : `<span class="field-hint">Endpoint ini tidak butuh input — langsung jalankan.</span>`
    }
  </div>`;
}

export function open(endpoint) {
  ensureHost();
  state = { endpoint, lang: 'curl' };

  scrim.querySelector('[data-title]').textContent = endpoint.name;
  scrim.querySelector('[data-sub]').textContent = endpoint.desc || endpoint.path;

  if (endpoint.ui === 'alight-steps') {
    openAlight(endpoint);
    return;
  }

  if (endpoint.ui === 'mail-steps') {
    openMail(endpoint);
    return;
  }

  if (endpoint.ui === 'crypto') {
    openCrypto(endpoint);
    return;
  }

  if (UBOT_FLOWS[endpoint.ui]) {
    openUbot(endpoint);
    return;
  }

  setSubmitLabel('Submit Query');

  scrim.querySelector('[data-body]').innerHTML = shell({
    left: fieldsBlock(endpoint.params),
    method: endpoint.method,
    note: '// Tekan "Submit Query" untuk menjalankan endpoint ini.',
  });

  scrim.querySelectorAll('[data-param]').forEach((input) => {
    input.addEventListener('input', refresh);
    input.addEventListener('change', refresh); // file / select fire change, not input
  });

  wireShell();

  refresh();
  scrim.classList.add('open');
  document.body.style.overflow = 'hidden';
  scrim.querySelector('[data-param]')?.focus();
}

export function close() {
  stopUbotPoll();
  scrim?.classList.remove('open');
  document.body.style.overflow = '';
}

/* ── Alight Motion stepped UI ────────────────────────────────────
 * Same endpoint, three ordered steps that unlock in sequence:
 *   send   → ?email=            (unlocks verify on success)
 *   verify → ?email=&link=      (unlocks status on success)
 *   status → ?email=            (re-polls, always available once reached)
 * You cannot skip ahead (verify/status stay locked until the prior step
 * succeeds) and you cannot go back to send once verify is unlocked.
 */
const ALIGHT_STEPS = [
  { id: 'send', label: 'Send' },
  { id: 'verify', label: 'Verify' },
  { id: 'status', label: 'Status' },
];

function openAlight(endpoint) {
  state = { endpoint, lang: 'curl', alight: { step: 'send', reached: { send: true }, email: '' } };

  scrim.querySelector('[data-body]').innerHTML = shell({
    left: `<div class="pg-panel">
      <div class="box-label">${icon('wrench', 12)} Alight Motion<span class="pill">3 langkah</span></div>
      <div class="steps" data-steps>${ALIGHT_STEPS.map(
        (s, i) => `<button class="step" data-step="${s.id}"><span class="step-n">${i + 1}</span>${s.label}</button>`
      ).join('')}</div>
      <div class="pg-fields" data-alight-fields></div>
    </div>`,
    method: endpoint.method,
    note: '// Mulai dari step "Send" — masukkan email lalu jalankan.',
  });

  wireShell();

  scrim.querySelectorAll('[data-step]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const id = btn.dataset.step;
      if (state.alight.reached[id]) selectAlightStep(id);
      else toast('Selesaikan step sebelumnya dulu', 'err');
    })
  );

  selectAlightStep('send');
  scrim.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function selectAlightStep(step) {
  state.alight.step = step;

  scrim.querySelectorAll('[data-step]').forEach((btn) => {
    const id = btn.dataset.step;
    btn.classList.toggle('active', id === step);
    btn.classList.toggle('done', state.alight.reached[id] && id !== step);
    btn.disabled = !state.alight.reached[id];
    btn.classList.toggle('locked', !state.alight.reached[id]);
  });

  const email = state.alight.email;
  const host = scrim.querySelector('[data-alight-fields]');

  if (step === 'send') {
    host.innerHTML = field('email', 'text', 'Enter email Alight Motion', email, 'Email akun yang mau dipremiumkan', true);
  } else if (step === 'verify') {
    host.innerHTML =
      field('email', 'text', '', email, 'Email dari step Send (terkunci)', true, true) +
      field('link', 'text', 'Paste link verifikasi dari inbox', '', 'Link "Sign in to Alight Creative" dari email', true);
  } else {
    host.innerHTML =
      field('email', 'text', '', email, 'Cek status aktivasi email ini', true, true) +
      `<div class="field wide"><span class="field-hint">${escapeHtml('Jalankan untuk melihat status terkini.')}</span></div>`;
  }

  host.querySelectorAll('[data-param]').forEach((input) => input.addEventListener('input', refresh));
  setSubmitLabel(step === 'send' ? 'Send Link' : step === 'verify' ? 'Verify' : 'Check Status');
  refresh();

  const editable = host.querySelector('[data-param]:not([readonly])');
  editable?.focus();
}

function field(name, type, placeholder, value, desc, required, readonly = false, opts = {}) {
  // Textareas only for genuinely multi-line values; a verification link is long
  // but still one line, so it gets a wide single-line input instead. `opts` lets a
  // caller override the name guess for the odd field it reads wrong (an OTP
  // `code` is five digits; an account token is one long line).
  const area = opts.multiline ?? AREA_NAME.test(name);
  const wide = opts.wide ?? WIDE_NAME(name);
  const ro = readonly ? ' readonly' : '';
  const control = area
    ? `<textarea class="input" data-param="${name}" rows="2" placeholder="${escapeHtml(placeholder)}"${ro}>${escapeHtml(value)}</textarea>`
    : `<input class="input" data-param="${name}" type="${type}" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(value)}"${ro}>`;
  return `<div class="field${wide ? ' wide' : ''}">
    <label>${escapeHtml(name)}${required ? '<span class="req">*</span>' : ''}</label>
    ${control}
    ${desc ? `<span class="field-hint">${escapeHtml(desc)}</span>` : ''}
  </div>`;
}

function setSubmitLabel(text) {
  const span = scrim.querySelector('[data-submit] span');
  if (span) span.textContent = text;
}

/**
 * Status pill + the size/content-type chip beside it. Passing no `meta` hides
 * the chip, which is what a fresh request wants while it's still in flight.
 */
function setStatus(label, kind, meta) {
  const pill = scrim.querySelector('[data-status]');
  pill.textContent = label;
  pill.className = kind ? `pill ${kind}` : 'pill';

  const chip = scrim.querySelector('[data-meta]');
  if (!chip) return;
  chip.hidden = !meta;
  chip.textContent = meta || '';
}

async function sendAlight() {
  const { endpoint, alight } = state;
  const params = readParams();

  if (!params.email) return toast('Isi dulu: email', 'err');
  if (alight.step === 'verify' && !params.link) return toast('Isi dulu: link verifikasi', 'err');

  alight.email = params.email;

  const { url } = buildUrl();
  const button = scrim.querySelector('[data-submit]');
  const box = resetResponseBox();

  box.innerHTML = `<span class="loading"><span class="spinner"></span> Requesting ${escapeHtml(endpoint.path)}…</span>`;
  setStatus('···', '');
  button.disabled = true;

  const started = performance.now();

  try {
    const res = await fetch(url, { method: endpoint.method });
    const ms = Math.round(performance.now() - started);

    const text = await res.text();
    setStatus(`${res.status} · ${ms}ms`, res.ok ? 'ok' : 'err', bytes(text.length));

    let data = null;
    let out = text;
    try {
      data = JSON.parse(text);
      out = JSON.stringify(data, null, 2);
    } catch {
      /* not JSON */
    }
    box.innerHTML = highlight(out);

    const step = data?.result?.step;
    if (res.ok && alight.step === 'send' && (step === 'link_sent' || step === 'waiting_verification')) {
      alight.reached.verify = true;
      toast('Link terkirim — lanjut ke Verify', 'ok');
      selectAlightStep('verify');
    } else if (res.ok && alight.step === 'verify' && step === 'activated') {
      alight.reached.status = true;
      toast('Aktivasi berhasil — lanjut ke Status', 'ok');
      selectAlightStep('status');
    }
  } catch (error) {
    setStatus('failed', 'err');
    box.textContent = `// Request gagal: ${error?.message || 'network error'}`;
  } finally {
    button.disabled = false;
  }
}

/** Put the response box back to its <pre> shell and return that <pre>. */
function resetResponseBox() {
  const box = scrim.querySelector('[data-response-box]');
  box.className = 'code-box tall';
  box.innerHTML = `<button class="copy" data-copy-response>${icon('copy', 11)}<span>COPY</span></button>
    <pre data-response></pre>`;

  box.querySelector('[data-copy-response]').addEventListener('click', (e) => {
    copy(scrim.querySelector('[data-response]')?.textContent || '', e.currentTarget);
  });

  return box.querySelector('[data-response]');
}

async function send() {
  if (state.endpoint?.ui === 'alight-steps') return sendAlight();
  if (state.endpoint?.ui === 'mail-steps') return sendMail();
  if (state.ubot) return sendUbot();

  const { endpoint } = state;
  const missing = endpoint.params.filter((p) => p.required && !readParams()[p.name]).map((p) => p.name);

  if (missing.length) {
    toast(`Isi dulu: ${missing.join(', ')}`, 'err');
    return;
  }

  const { url, params } = buildUrl();
  const button = scrim.querySelector('[data-submit]');

  // An image result replaces the whole box, so rebuild the text shell on every
  // run — otherwise a second submit would find no [data-response] to write to.
  const box = resetResponseBox();

  box.innerHTML = `<span class="loading"><span class="spinner"></span> Requesting ${escapeHtml(endpoint.path)}…</span>`;
  setStatus('···', '');
  button.disabled = true;

  const started = performance.now();

  try {
    const res = await fetch(url, requestInit(params));
    const ms = Math.round(performance.now() - started);
    const type = res.headers.get('content-type') || '';
    const kind = res.ok ? 'ok' : 'err';

    setStatus(`${res.status} · ${ms}ms`, kind);

    // File downloads (encrypt/decrypt "file" mode) come back with a
    // content-disposition attachment header — offer a SAVE link instead of
    // dumping a long token into the response box.
    const disp = res.headers.get('content-disposition') || '';
    if (/attachment/i.test(disp)) {
      const blob = await res.blob();
      const src = URL.createObjectURL(blob);
      const nameMatch = /filename="?([^"]+)"?/i.exec(disp);
      const name = nameMatch ? nameMatch[1] : `${endpoint.path.split('/').pop() || 'result'}.txt`;
      const frame = scrim.querySelector('[data-response-box]');
      setStatus(`${res.status} · ${ms}ms`, kind, bytes(blob.size));
      frame.className = 'code-box';
      frame.innerHTML = `
        <div class="img-meta">
          ${icon('terminal', 12)}<span>${escapeHtml(name)}</span>
          <span class="grow"></span>
          <span>${bytes(blob.size)}</span>
          <a class="copy" style="position:static" href="${src}" download="${escapeHtml(name)}">
            ${icon('arrowUp', 12)}<span>SAVE</span>
          </a>
        </div>`;
      return;
    }

    // Image endpoints (QR code, text-to-image) get a framed preview with a
    // meta strip and a download link instead of a raw <img> dumped in the box.
    if (type.startsWith('image/')) {
      const blob = await res.blob();
      const src = URL.createObjectURL(blob);
      const frame = scrim.querySelector('[data-response-box]');
      // The extension follows the real content-type: text2img answers with JPEG
      // on FLUX and PNG on the SDXL models, so a fixed .png would mislabel it.
      const ext = (type.split('/')[1] || 'png').split(';')[0].replace('jpeg', 'jpg');
      const name = `${endpoint.path.split('/').pop() || 'result'}.${ext}`;

      setStatus(`${res.status} · ${ms}ms`, kind, bytes(blob.size));
      frame.className = 'code-box';
      frame.innerHTML = `
        <div class="img-out"><img src="${src}" alt="${escapeHtml(endpoint.name)} result"></div>
        <div class="img-meta">
          ${icon('image', 12)}<span data-dim>${escapeHtml(type)}</span>
          <span class="grow"></span>
          <span>${bytes(blob.size)}</span>
          <a class="copy" style="position:static" href="${src}" download="${name}">
            ${icon('arrowUp', 12)}<span>SAVE</span>
          </a>
        </div>`;

      // Dimensions only exist once decoding finishes, so the label is upgraded
      // from "image/png" to "image/png · 1024×1024" after load.
      const img = frame.querySelector('.img-out img');
      img.addEventListener('load', () => {
        const label = frame.querySelector('[data-dim]');
        if (label) label.textContent = `${type} · ${img.naturalWidth}×${img.naturalHeight}`;
      });
      return;
    }

    const text = await res.text();
    setStatus(`${res.status} · ${ms}ms`, kind, bytes(text.length));

    let out = text;
    try {
      out = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      // Not JSON — show the raw payload.
    }
    box.innerHTML = highlight(out);
  } catch (error) {
    setStatus('failed', 'err');
    box.textContent = `// Request gagal: ${error?.message || 'network error'}`;
  } finally {
    button.disabled = false;
  }
}

/* ── Temp-mail stepped UI ─────────────────────────────────────────
 * A two-button [ Email ] [ Otp ] segmented control, styled like the Alight
 * stepped flow. Both steps hit the SAME endpoint:
 *   Email → no `email` param  → server hands out a fresh address
 *   Otp   → ?email=<address>  → server reads that inbox (OTP lifted to top)
 * Generating an address on the Email step auto-fills and unlocks Otp; you can
 * always jump back to Email to mint another address.
 */
const MAIL_STEPS = [
  { id: 'email', label: 'Email' },
  { id: 'otp', label: 'Otp' },
];

function openMail(endpoint) {
  state = { endpoint, lang: 'curl', mail: { step: 'email', reached: { email: true }, email: '' } };

  scrim.querySelector('[data-body]').innerHTML = shell({
    left: `<div class="pg-panel">
      <div class="box-label">${icon('mail', 12)} Temp Mail<span class="pill">2 langkah</span></div>
      <div class="steps" data-steps>${MAIL_STEPS.map(
        (s, i) => `<button class="step" data-step="${s.id}"><span class="step-n">${i + 1}</span>${s.label}</button>`
      ).join('')}</div>
      <div class="pg-fields" data-mail-fields></div>
    </div>`,
    method: endpoint.method,
    note: '// Step "Email" — buat alamat baru, lalu pindah ke "Otp" untuk baca inbox.',
  });

  wireShell();

  scrim.querySelectorAll('[data-step]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const id = btn.dataset.step;
      if (state.mail.reached[id]) selectMailStep(id);
      else toast('Buat email dulu di step "Email"', 'err');
    })
  );

  selectMailStep('email');
  scrim.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function selectMailStep(step) {
  state.mail.step = step;

  scrim.querySelectorAll('[data-step]').forEach((btn) => {
    const id = btn.dataset.step;
    btn.classList.toggle('active', id === step);
    btn.classList.toggle('done', state.mail.reached[id] && id !== step);
    btn.disabled = !state.mail.reached[id];
    btn.classList.toggle('locked', !state.mail.reached[id]);
  });

  const host = scrim.querySelector('[data-mail-fields]');
  const email = state.mail.email;

  if (step === 'email') {
    // Optional customiser params only (never the `email` param — that reads an
    // inbox, which is the Otp step). Keeps the "make a fresh address" intent clean.
    const extras = state.endpoint.params.filter((p) => p.name !== 'email' && p.name !== 'limit');
    host.innerHTML =
      extras.map((p) => field(p.name, p.type === 'number' ? 'number' : 'text', p.placeholder, p.default || '', p.desc, false)).join('') ||
      `<div class="field wide"><span class="field-hint">${escapeHtml('Tanpa parameter — langsung jalankan untuk dapat alamat acak.')}</span></div>`;
  } else {
    host.innerHTML =
      field('email', 'text', '', email, 'Alamat dari step Email (terkunci)', true, true) +
      `<div class="field wide"><span class="field-hint">${escapeHtml('Jalankan untuk membaca inbox — OTP & link verifikasi diambil otomatis.')}</span></div>`;
  }

  host.querySelectorAll('[data-param]').forEach((input) => input.addEventListener('input', refresh));
  setSubmitLabel(step === 'email' ? 'Buat Email' : 'Baca OTP');
  refresh();

  const editable = host.querySelector('[data-param]:not([readonly])');
  editable?.focus();
}

async function sendMail() {
  const { endpoint, mail } = state;
  const params = readParams();

  if (mail.step === 'otp' && !params.email) return toast('Belum ada email — buat dulu di step "Email"', 'err');

  const { url } = buildUrl();
  const button = scrim.querySelector('[data-submit]');
  const box = resetResponseBox();

  box.innerHTML = `<span class="loading"><span class="spinner"></span> Requesting ${escapeHtml(endpoint.path)}…</span>`;
  setStatus('···', '');
  button.disabled = true;

  const started = performance.now();

  try {
    const res = await fetch(url, { method: endpoint.method });
    const ms = Math.round(performance.now() - started);

    const text = await res.text();
    setStatus(`${res.status} · ${ms}ms`, res.ok ? 'ok' : 'err', bytes(text.length));

    let data = null;
    let out = text;
    try {
      data = JSON.parse(text);
      out = JSON.stringify(data, null, 2);
    } catch {
      /* not JSON */
    }
    box.innerHTML = highlight(out);

    // A fresh address on the Email step carries into Otp and unlocks it.
    const address = data?.result?.email;
    if (res.ok && mail.step === 'email' && address) {
      mail.email = address;
      mail.reached.otp = true;
      toast('Email dibuat — lanjut ke Otp untuk baca inbox', 'ok');
      selectMailStep('otp');
    }
  } catch (error) {
    setStatus('failed', 'err');
    box.textContent = `// Request gagal: ${error?.message || 'network error'}`;
  } finally {
    button.disabled = false;
  }
}

/* ── Crypto UI (Encrypt/Decrypt) ──────────────────────────────────
 * A [ Text ] [ File ] mode toggle so it's obvious you can encrypt either a
 * typed string OR an uploaded script. `key` is always shown; `download` only
 * matters in Text mode (a File upload always comes back as a download). The
 * actual request goes through the standard send() path, which already handles
 * both attachment downloads and JSON responses.
 */
const CRYPTO_MODES = [
  { id: 'text', label: 'Text' },
  { id: 'file', label: 'File' },
];

function openCrypto(endpoint) {
  state = { endpoint, lang: 'curl', crypto: { mode: 'text' } };

  setSubmitLabel('Submit Query');

  scrim.querySelector('[data-body]').innerHTML = shell({
    left: `<div class="pg-panel">
      <div class="box-label">${icon('key', 12)} Sumber data<span class="pill" data-mode-pill>text</span></div>
      <div class="steps" data-modes>${CRYPTO_MODES.map(
        (m) => `<button class="step" data-mode="${m.id}">${m.label}</button>`
      ).join('')}</div>
      <div class="pg-fields" data-crypto-fields></div>
    </div>`,
    method: endpoint.method,
    note: '// Pilih mode Text atau File, isi key, lalu Submit Query.',
  });

  wireShell();

  scrim.querySelectorAll('[data-mode]').forEach((btn) =>
    btn.addEventListener('click', () => selectCryptoMode(btn.dataset.mode))
  );

  selectCryptoMode('text');
  scrim.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function selectCryptoMode(mode) {
  state.crypto.mode = mode;

  scrim.querySelectorAll('[data-mode]').forEach((btn) =>
    btn.classList.toggle('active', btn.dataset.mode === mode)
  );

  const modePill = scrim.querySelector('[data-mode-pill]');
  if (modePill) modePill.textContent = mode;

  const params = state.endpoint.params;
  // Text mode → the textarea param (text/data) + key + download.
  // File mode → the file param + key. The unused source input is omitted so only
  // one content source is ever sent.
  const textLike = params.find((p) => p.type !== 'file' && p.type !== 'select' && p.name !== 'key');
  const fileParam = params.find((p) => p.type === 'file');
  const keyParam = params.find((p) => p.name === 'key');
  const dlParam = params.find((p) => p.name === 'download');

  const shown = [];
  if (mode === 'text') {
    if (textLike) shown.push(textLike);
  } else if (fileParam) {
    shown.push(fileParam);
  }
  if (keyParam) shown.push(keyParam);
  if (mode === 'text' && dlParam) shown.push(dlParam);

  scrim.querySelector('[data-crypto-fields]').innerHTML = shown.map(paramField).join('');

  scrim.querySelectorAll('[data-crypto-fields] [data-param]').forEach((input) => {
    input.addEventListener('input', refresh);
    input.addEventListener('change', refresh);
  });

  refresh();
  scrim.querySelector('[data-crypto-fields] [data-param]:not([readonly])')?.focus();
}

/* ── Userbot flow (Ubot Login) ──────────────────────────────────────
 * Single stepped driver for the Telegram userbot login. Each step posts to
 * its sub-path (/sender, /otp, /password, /status) with automatic token carry-forward.
 * Once connected, the userbot responds to .help, .ping, .id, .promosi, etc. on Telegram.
 */
const UBOT_FLOWS = {
  'ubot-login': {
    label: 'Userbot Login',
    glyph: 'key',
    hint: '// Step 1 "Nomor" — isi nomor Telegram lalu kirim OTP (api_id & api_hash sudah terpasang default).',
    steps: [
      {
        id: 'sender',
        label: 'Nomor',
        suffix: 'sender',
        submit: 'Kirim OTP',
        open: true,
        fields: ['phone', 'api_id', 'api_hash'],
        need: ['phone'],
      },
      { id: 'otp', label: 'OTP', suffix: 'otp', submit: 'Verifikasi', fields: ['login_token', 'code'], need: ['login_token', 'code'] },
      { id: 'password', label: 'PIN 2FA', suffix: 'password', submit: 'Kirim PIN', fields: ['login_token', 'password'], need: ['login_token', 'password'] },
      { id: 'status', label: 'Tersambung', suffix: 'status', submit: 'Cek Koneksi', fields: ['account_token'], need: ['account_token'] },
    ],
  },
};

/**
 * What the three modals share. Session-scoped on purpose: an account_token is a
 * live Telegram session and an api_hash is the caller's app secret, so both die
 * with the tab rather than persisting on disk.
 */
const UBOT_KEY = 'dz_ubot';
const UBOT_SHARED = ['account_token', 'api_id', 'api_hash'];

function rememberUbot(vars) {
  const keep = {};
  for (const name of UBOT_SHARED) if (vars[name]) keep[name] = vars[name];
  try {
    sessionStorage.setItem(UBOT_KEY, JSON.stringify(keep));
  } catch {
    /* private mode — the fields just start empty */
  }
}

function recallUbot() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(UBOT_KEY) || '{}');
    return UBOT_SHARED.reduce((acc, name) => (raw[name] ? { ...acc, [name]: String(raw[name]) } : acc), {});
  } catch {
    return {};
  }
}

function openUbot(endpoint) {
  const flow = UBOT_FLOWS[endpoint.ui];
  const vars = recallUbot();
  const first = flow.steps[0];

  // Steps marked `open` start unlocked; the rest wait for the reply that makes
  // them meaningful. A token left over from an earlier login also unlocks every
  // step that only needs that token, so "tersambung tidak?" and "stop" stay
  // reachable without walking the whole flow again.
  const reached = Object.fromEntries(
    flow.steps
      .filter((s) => s.open || (vars.account_token && s.need?.length === 1 && s.need[0] === 'account_token'))
      .map((s) => [s.id, true])
  );

  state = {
    endpoint,
    lang: 'curl',
    ubot: { flow, step: first.id, suffix: first.suffix, reached, vars, timer: 0 },
  };

  scrim.querySelector('[data-body]').innerHTML = shell({
    left: `<div class="pg-panel">
      <div class="box-label">${icon(flow.glyph, 12)} ${escapeHtml(flow.label)}<span class="pill">${flow.steps.length} langkah</span></div>
      <div class="steps" data-steps>${flow.steps
        .map((s, i) => `<button class="step" data-step="${s.id}"><span class="step-n">${i + 1}</span>${s.label}</button>`)
        .join('')}</div>
      <div class="pg-fields" data-ubot-fields></div>
    </div>`,
    method: endpoint.method,
    note: flow.hint,
  });

  wireShell();

  scrim.querySelectorAll('[data-step]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const id = btn.dataset.step;
      if (state.ubot.reached[id]) selectUbotStep(id);
      else toast('Selesaikan langkah sebelumnya dulu', 'err');
    })
  );

  selectUbotStep(first.id);
  scrim.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function selectUbotStep(id) {
  const { flow } = state.ubot;
  const step = flow.steps.find((s) => s.id === id) || flow.steps[0];

  stopUbotPoll();
  state.ubot.step = step.id;
  state.ubot.suffix = step.suffix;

  scrim.querySelectorAll('[data-step]').forEach((btn) => {
    const sid = btn.dataset.step;
    btn.classList.toggle('active', sid === step.id);
    btn.classList.toggle('done', state.ubot.reached[sid] && sid !== step.id);
    btn.disabled = !state.ubot.reached[sid];
    btn.classList.toggle('locked', !state.ubot.reached[sid]);
  });

  const host = scrim.querySelector('[data-ubot-fields]');
  const specs = step.fields.map((name) => state.endpoint.params.find((p) => p.name === name)).filter(Boolean);

  host.innerHTML = specs
    .map((p) => {
      const carried = state.ubot.vars[p.name] || '';
      // A token the flow produced is shown locked — it is the thread holding the
      // steps together, and editing it is only ever a way to break the flow.
      const locked = Boolean(carried) && (p.name === 'login_token' || p.name === 'job_id');
      const required = (step.need || []).includes(p.name);
      // `text` is the one genuinely multi-line field; the tokens and `code` only
      // look multi-line to the name guess, but tokens do want the full width.
      const long = p.name === 'text';
      const opts = { multiline: long, wide: long || p.name.endsWith('_token') || p.name === 'targets' };
      return field(p.name, p.type === 'number' ? 'number' : 'text', p.placeholder, carried, p.desc, required, locked, opts);
    })
    .join('');

  host.querySelectorAll('[data-param]').forEach((input) => {
    input.addEventListener('input', refresh);
    input.addEventListener('change', refresh);
  });

  setSubmitLabel(step.submit);
  refresh();
  host.querySelector('[data-param]:not([readonly])')?.focus();
}

async function sendUbot() {
  const { endpoint, ubot } = state;
  const step = ubot.flow.steps.find((s) => s.id === ubot.step);
  const { url, params } = buildUrl();

  const missing = (step?.need || []).filter((name) => !params[name]);
  if (missing.length) {
    const help = missing.includes('account_token') ? ' — token itu dibalas saat Ubot Login berhasil' : '';
    return toast(`Isi dulu: ${missing.join(', ')}${help}`, 'err');
  }

  const button = scrim.querySelector('[data-submit]');
  const box = resetResponseBox();

  box.innerHTML = `<span class="loading"><span class="spinner"></span> Requesting ${escapeHtml(endpoint.path)}…</span>`;
  setStatus('···', '');
  button.disabled = true;

  const started = performance.now();

  try {
    const res = await fetch(url, requestInit(params));
    const ms = Math.round(performance.now() - started);
    const text = await res.text();

    setStatus(`${res.status} · ${ms}ms`, res.ok ? 'ok' : 'err', bytes(text.length));

    let data = null;
    let out = text;
    try {
      data = JSON.parse(text);
      out = JSON.stringify(data, null, 2);
    } catch {
      /* not JSON */
    }
    box.innerHTML = highlight(out);

    if (res.ok) advanceUbot(data?.result || {}, params);
  } catch (error) {
    setStatus('failed', 'err');
    box.textContent = `// Request gagal: ${error?.message || 'network error'}`;
  } finally {
    button.disabled = false;
  }
}

/** Read the tokens out of a successful reply and move to whatever comes next. */
function advanceUbot(result, sent) {
  const { ubot } = state;
  const vars = ubot.vars;

  // Carry forward whatever the caller just typed — the app credentials in
  // particular, so they are entered once per session rather than once per step.
  for (const name of [...UBOT_SHARED, 'phone']) if (sent[name]) vars[name] = sent[name];
  if (result.login_token) vars.login_token = result.login_token;
  if (result.job_id) vars.job_id = result.job_id;
  if (result.account_token) vars.account_token = result.account_token;

  rememberUbot(vars);

  if (result.step === 'password_needed') {
    ubot.reached.password = true;
    toast('Kode benar — akun ini minta PIN 2FA', 'ok');
    selectUbotStep('password');
    return;
  }

  if (result.step === 'otp_sent') {
    ubot.reached.otp = true;
    toast('OTP dikirim — cek chat Telegram', 'ok');
    selectUbotStep('otp');
    return;
  }

  if (result.step === 'connected' && result.account_token) {
    ubot.reached.status = true;
    toast('Userbot tersambung — token akun tersimpan', 'ok');
    selectUbotStep('status');
    return;
  }

  if (result.step === 'started') {
    ubot.reached.status = true;
    ubot.reached.stop = true;
    toast(`Promosi dimulai ke ${result.total_groups} grup`, 'ok');
    selectUbotStep('status');
    scheduleUbotPoll();
    return;
  }

  // A running broadcast only advances while its status is polled, so keep polling
  // for as long as this step is on screen.
  if (result.finished === false) {
    ubot.reached.stop = true;
    scheduleUbotPoll();
  }
  if (result.finished === true) {
    stopUbotPoll();
    toast(`Selesai — ${result.berhasil} berhasil, ${result.gagal} gagal, ${result.dilewati} dilewati`, 'ok');
  }
}

function scheduleUbotPoll() {
  stopUbotPoll();
  if (state.ubot?.step !== 'status') return;
  state.ubot.timer = setTimeout(() => {
    if (!scrim.classList.contains('open') || state.ubot?.step !== 'status') return;
    sendUbot();
  }, 4000);
}

function stopUbotPoll() {
  if (state.ubot?.timer) clearTimeout(state.ubot.timer);
  if (state.ubot) state.ubot.timer = 0;
}

