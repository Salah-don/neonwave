export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape any untrusted value (ID3 tags, API data, user input) before putting it in HTML. */
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function html(str) {
  const t = document.createElement('template');
  t.innerHTML = str.trim();
  return t.content.firstElementChild;
}

export const icon = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function throttle(fn, ms) {
  let last = 0;
  return (...a) => { const n = Date.now(); if (n - last >= ms) { last = n; fn(...a); } };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
export const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/* ---- tiny event bus ---- */
const bus = new EventTarget();
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));
/** Subscribe; when `owner` (a DOM node) leaves the document the listener removes itself. */
export function on(type, fn, owner) {
  const h = (e) => {
    if (owner && !owner.isConnected) { bus.removeEventListener(type, h); return; }
    fn(e.detail);
  };
  bus.addEventListener(type, h);
  return () => bus.removeEventListener(type, h);
}

export function plural(n, one, many) { return `${n} ${n > 1 ? many : one}`; }

export function fmtBytes(b) {
  if (!b) return '0 Mo';
  const u = ['o', 'Ko', 'Mo', 'Go'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / 1024 ** i).toFixed(i > 1 ? 1 : 0).replace('.', ',')} ${u[i]}`;
}

export function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

/** Downscale any image blob to a JPEG (max `size` px on the long side). */
export async function shrinkImage(blob, size = 512, quality = 0.85) {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, size / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return new Promise((res) => c.toBlob((b) => res(b || blob), 'image/jpeg', quality));
}
