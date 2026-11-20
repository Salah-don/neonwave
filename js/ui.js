// UI primitives: page header, iOS dialogs, bottom sheets, action menus, toasts, artwork.
import { $, esc, html, icon, reducedMotion } from './util.js';
import { getBackLabel, back, setTitle } from './router.js';
import * as db from './db.js';
import { dragToDismiss } from './gestures.js';

const layer = () => $('#layer');

/* ---------------- page header (nav bar + large title) ---------------- */
export function pageHeader(page, { title, large = true, actions = '', showBack = !large, sentinel } = {}) {
  setTitle(title);
  const label = getBackLabel() || 'Retour';
  const head = html(`<header class="navbar">
    <div class="nav-left">${showBack ? `<button class="nav-back tap" aria-label="Retour">${icon('chevron-left')}<span>${esc(label)}</span></button>` : ''}</div>
    <div class="nav-title">${esc(title)}</div>
    <div class="nav-right">${actions}</div>
  </header>`);
  head.querySelector('.nav-back')?.addEventListener('click', back);
  page.prepend(head);
  let watch = sentinel;
  if (large) {
    watch = html(`<h1 class="large-title">${esc(title)}</h1>`);
    head.after(watch);
  }
  if (watch) watchTitle(head, watch);
  return head;
}

/** Show the nav-bar title once `el` scrolls under it. Waits until `el` is in the document (pages render off-DOM on refresh). */
export function watchTitle(head, el) {
  const io = new IntersectionObserver(([en]) => head.classList.toggle('scrolled', !en.isIntersecting), { rootMargin: '-94px 0px 0px 0px' });
  let tries = 0;
  const start = () => { if (el.isConnected) io.observe(el); else if (tries++ < 120) requestAnimationFrame(start); };
  start();
}

/* ---------------- toast ---------------- */
let toastTimer;
export function toast(msg, ic = 'check') {
  layer().querySelector('.toast')?.remove();
  const t = html(`<div class="toast" role="status">${ic ? icon(ic) : ''}<span>${esc(msg)}</span></div>`);
  layer().append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.add('closing'); setTimeout(() => t.remove(), 260); }, 2200);
}

/* ---------------- dialogs (no native alert/confirm) ---------------- */
/**
 * @param {{title:string,message?:string,input?:{value?:string,placeholder?:string,multiline?:boolean},
 *          buttons:{label:string,role?:'cancel'|'destructive'|'default',value:any}[]}} o
 * @returns {Promise<{value:any,text?:string}>}
 */
export function dialog({ title, message = '', input, buttons }) {
  return new Promise((resolve) => {
    const back = html('<div class="backdrop"></div>');
    const stack = buttons.length > 2;
    const field = input
      ? input.multiline
        ? `<textarea rows="3" placeholder="${esc(input.placeholder || '')}">${esc(input.value || '')}</textarea>`
        : `<input type="text" value="${esc(input.value || '')}" placeholder="${esc(input.placeholder || '')}" enterkeyhint="done">`
      : '';
    const wrap = html(`<div class="dialog-wrap" role="alertdialog" aria-modal="true">
      <div class="dialog"><div class="dialog-body"><h3>${esc(title)}</h3>${message ? `<p>${esc(message)}</p>` : ''}${field}</div>
      <div class="dialog-actions ${stack ? 'stack' : ''}">${buttons.map((b, i) => `<button data-i="${i}" class="${b.role || ''}">${esc(b.label)}</button>`).join('')}</div></div></div>`);
    layer().append(back, wrap);
    const inp = wrap.querySelector('input,textarea');
    if (inp) setTimeout(() => { inp.focus(); inp.select?.(); }, 50);
    const done = (i) => {
      const b = buttons[i];
      wrap.querySelector('.dialog').classList.add('closing');
      back.classList.add('closing');
      setTimeout(() => { wrap.remove(); back.remove(); }, 180);
      resolve({ value: b?.value, text: inp?.value.trim() });
    };
    wrap.addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (b) done(+b.dataset.i); });
    inp?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !input.multiline) done(buttons.findIndex((b) => b.role === 'default'));
    });
  });
}
export const alertBox = (title, message) => dialog({ title, message, buttons: [{ label: 'OK', role: 'default', value: true }] });
export async function confirmBox(title, message, okLabel = 'OK', destructive = false) {
  const r = await dialog({ title, message, buttons: [{ label: 'Annuler', role: 'cancel', value: false }, { label: okLabel, role: destructive ? 'destructive' : 'default', value: true }] });
  return r.value === true;
}
export async function promptBox(title, { value = '', placeholder = '', okLabel = 'OK', message = '' } = {}) {
  const r = await dialog({ title, message, input: { value, placeholder }, buttons: [{ label: 'Annuler', role: 'cancel', value: false }, { label: okLabel, role: 'default', value: true }] });
  return r.value ? r.text : null;
}

/* ---------------- bottom sheet ---------------- */
/** Opens a sheet; returns { el, body, close, closed:Promise }. */
export function sheet({ title = '', left = '', right = '', content = '', cls = '' } = {}) {
  const backEl = html('<div class="backdrop blur"></div>');
  const el = html(`<div class="sheet ${cls}" role="dialog" aria-modal="true">
    <div class="sheet-grabber"></div>
    ${title || left || right ? `<div class="sheet-head"><div class="side">${left}</div><h3>${esc(title)}</h3><div class="side">${right}</div></div>` : ''}
    <div class="sheet-body"></div></div>`);
  const body = el.querySelector('.sheet-body');
  if (typeof content === 'string') body.innerHTML = content; else if (content) body.append(content);
  layer().append(backEl, el);
  document.body.classList.add('locked');
  let resolveClosed;
  const closed = new Promise((r) => { resolveClosed = r; });
  let isClosed = false;
  const close = (value) => {
    if (isClosed) return;
    isClosed = true;
    el.classList.add('closing');
    backEl.classList.add('closing');
    setTimeout(() => { el.remove(); backEl.remove(); if (!layer().querySelector('.sheet')) document.body.classList.remove('locked'); }, reducedMotion() ? 0 : 280);
    resolveClosed(value);
  };
  backEl.addEventListener('click', () => close());
  dragToDismiss(el, { onDismiss: () => close(), canStart: (e) => !e.target.closest('input,textarea,canvas,.handle') && body.scrollTop <= 0 });
  return { el, body, close, closed };
}

/**
 * Action menu (iOS context menu as a sheet).
 * groups: [[{label, icon, destructive, checked, disabled, run}]]
 */
export function actionMenu({ header = '', groups }) {
  const s = sheet({ content: '' });
  s.body.innerHTML = header + groups.filter((g) => g.length).map((g, gi) => `<div class="menu-group">${g.map((it, i) =>
    `<button class="menu-item ${it.destructive ? 'destructive' : ''} ${it.checked ? 'checked' : ''}" data-g="${gi}" data-i="${i}" ${it.disabled ? 'disabled' : ''}>
      <span>${esc(it.label)}</span>${it.checked ? icon('check') : it.icon ? icon(it.icon) : ''}</button>`).join('')}</div>`).join('');
  const live = groups.filter((g) => g.length);
  s.body.addEventListener('click', (e) => {
    const b = e.target.closest('.menu-item');
    if (!b) return;
    const it = live[+b.dataset.g][+b.dataset.i];
    s.close();
    setTimeout(() => it.run?.(), 120);
  });
  return s;
}

/* ---------------- artwork ---------------- */
const blobUrls = new Map();
export async function blobUrl(key) {
  if (blobUrls.has(key)) return blobUrls.get(key);
  const b = await db.getBlob(key);
  // shortcut: thumbnail object URLs live for the session; revisit if memory grows with huge libraries.
  const u = b ? URL.createObjectURL(b) : null;
  if (u) blobUrls.set(key, u);
  return u;
}
export function forgetBlobUrl(key) {
  const u = blobUrls.get(key);
  if (u) { URL.revokeObjectURL(u); blobUrls.delete(key); }
}

/** <img> for a track (local blob first, then remote URL), or a placeholder. */
export function artHTML(t, cls = 'art') {
  if (t?.hasArtBlob) return `<img class="${cls}" data-blob="art:${esc(t.id)}" ${t.artwork ? `data-fallback="${esc(t.artwork)}"` : ''} alt="" loading="lazy">`;
  if (t?.artwork) return `<img class="${cls}" src="${esc(t.artwork)}" alt="" loading="lazy">`;
  return `<div class="noart ${cls === 'art' ? '' : cls}">${icon('note')}</div>`;
}

/** Playlist cover: custom image, else 4-cover mosaic, else placeholder. */
export function playlistArtHTML(p, tracks = []) {
  if (p.hasImage) return `<img class="art" data-blob="pimg:${esc(p.id)}" alt="">`;
  const withArt = tracks.filter((t) => t && (t.hasArtBlob || t.artwork));
  if (withArt.length >= 4) return `<div class="mosaic art">${withArt.slice(0, 4).map((t) => artHTML(t, '')).join('')}</div>`;
  if (withArt.length) return artHTML(withArt[0]);
  return `<div class="noart">${icon('playlist')}</div>`;
}

/** Resolve data-blob images inside root (call after inserting HTML). */
export function hydrate(root) {
  root.querySelectorAll('img[data-blob]:not([src])').forEach(async (img) => {
    const u = await blobUrl(img.dataset.blob);
    if (u) img.src = u;
    else if (img.dataset.fallback) img.src = img.dataset.fallback;
  });
}

export const skeletonRows = (n = 6) => Array.from({ length: n }, () => '<div class="skel-row"><div class="skel"></div><div class="skel skel-line"></div></div>').join('');
export const skeletonShelf = (n = 4) => `<div class="shelf">${Array.from({ length: n }, () => '<div class="skel-card"><div class="skel"></div><div class="skel skel-line"></div></div>').join('')}</div>`;

/** Hidden file picker → Promise<File[]> */
export function pickFiles({ accept = '*/*', multiple = false } = {}) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.multiple = multiple;
    inp.style.display = 'none';
    document.body.append(inp);
    inp.addEventListener('change', () => { resolve([...inp.files]); inp.remove(); }, { once: true });
    inp.addEventListener('cancel', () => { resolve([]); inp.remove(); }, { once: true });
    inp.click();
  });
}
