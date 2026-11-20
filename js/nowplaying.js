// Mini player + full-screen player (art / lyrics / queue modes), shared-element transition, swipe to close.
import { $, esc, icon, on, reducedMotion } from './util.js';
import { hydrate, blobUrl } from './ui.js';
import { dragToDismiss, sortable, swipeToDelete } from './gestures.js';
import * as player from './player.js';
import { getLyrics } from './lyrics.js';
import { activeLine } from './lib/lrc.js';
import { fmtTime } from './lib/sort.js';
import { trackRow, openTrackMenu } from './components.js';
import { go } from './router.js';

const np = $('#np');
const mini = $('#mini');
let mode = 'art';
let isOpen = false;
let scrubbing = false;
let lyricLines = null;
let lyricIdx = -2;
let userScrolledAt = 0;
let artSrc = '';

np.innerHTML = `
  <div class="np-bg"><img alt=""></div>
  <div class="np-inner">
    <div class="np-grabber" role="button" aria-label="Fermer le lecteur"></div>
    <div class="np-compact"><img alt=""><div class="meta"><div class="t ellipsis"></div><div class="s ellipsis"></div></div>
      <button class="np-more tap" aria-label="Plus d'options">${icon('more')}</button></div>
    <div class="np-main">
      <div class="np-art-wrap"><img class="np-art" alt=""></div>
      <div class="np-panel np-lyrics" aria-label="Paroles"></div>
      <div class="np-panel np-queue" aria-label="File d'attente"></div>
    </div>
    <div class="np-info"><div class="meta"><div class="np-title"></div><div class="np-artist"><a></a></div></div>
      <button class="np-more tap" aria-label="Plus d'options">${icon('more')}</button></div>
    <div class="np-progress">
      <div class="bar" role="slider" aria-label="Position" tabindex="0"><div class="bar-track"><div class="bar-fill"></div></div></div>
      <div class="times"><span class="cur">0:00</span><span class="rem">-0:00</span></div>
    </div>
    <div class="np-controls">
      <button class="c-skip c-prev" aria-label="Précédent">${icon('prev')}</button>
      <button class="c-play" aria-label="Lecture">${icon('play')}</button>
      <button class="c-skip c-next" aria-label="Suivant">${icon('next')}</button>
    </div>
    <div class="np-volume" ${player.volumeSupported ? '' : 'hidden'}>${icon('vol-low')}<input type="range" min="0" max="1" step="0.01" value="1" aria-label="Volume">${icon('vol-high')}</div>
    <div class="np-bottom">
      <button class="b-lyrics" aria-label="Paroles">${icon('lyrics')}</button>
      <button class="b-queue" aria-label="File d'attente">${icon('queue')}</button>
    </div>
  </div>`;

const el = {
  bg: np.querySelector('.np-bg img'), art: np.querySelector('.np-art'),
  title: np.querySelector('.np-title'), artist: np.querySelector('.np-artist a'),
  cImg: np.querySelector('.np-compact img'), cT: np.querySelector('.np-compact .t'), cS: np.querySelector('.np-compact .s'),
  fill: np.querySelector('.bar-fill'), bar: np.querySelector('.bar'), progress: np.querySelector('.np-progress'),
  cur: np.querySelector('.cur'), rem: np.querySelector('.rem'),
  play: np.querySelector('.c-play'), lyrics: np.querySelector('.np-lyrics'), queue: np.querySelector('.np-queue'),
  vol: np.querySelector('.np-volume input'),
  mArt: mini.querySelector('.mini-art'), mTitle: mini.querySelector('.mini-title'), mArtist: mini.querySelector('.mini-artist'), mPlay: mini.querySelector('.mini-play'),
};

/* ---------------- artwork + dominant colour ---------------- */
async function artFor(t) {
  if (!t) return '';
  if (t.hasArtBlob) return (await blobUrl(`art:${t.id}`)) || t.artwork || '';
  return t.artwork || '';
}

function dominantColor(img) {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 24;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, 24, 24);
    const d = g.getImageData(0, 0, 24, 24).data;
    let r = 0, gg = 0, b = 0, w = 0;
    for (let i = 0; i < d.length; i += 4) {
      const max = Math.max(d[i], d[i + 1], d[i + 2]), min = Math.min(d[i], d[i + 1], d[i + 2]);
      const weight = 1 + ((max - min) / 255) * 4 + (max > 30 ? 1 : 0); // favour saturated, non-black pixels
      r += d[i] * weight; gg += d[i + 1] * weight; b += d[i + 2] * weight; w += weight;
    }
    return [r / w, gg / w, b / w].map(Math.round);
  } catch {
    return null; // tainted canvas (image host without CORS)
  }
}

function applyColor(rgb) {
  const [r, g, b] = rgb || [10, 60, 110];
  const dark = (k) => `rgb(${Math.round(r * k)}, ${Math.round(g * k)}, ${Math.round(b * k)})`;
  np.style.setProperty('--np-c1', dark(0.75));
  np.style.setProperty('--np-c2', dark(0.18));
  np.style.setProperty('--np-shadow', `rgba(${r}, ${g}, ${b}, .45)`);
}

async function setArtwork(t) {
  const src = await artFor(t);
  if (src === artSrc) return;
  artSrc = src;
  for (const img of [el.art, el.bg, el.cImg, el.mArt]) {
    if (src) img.src = src; else img.removeAttribute('src');
  }
  if (!src) { applyColor(null); return; }
  // Colour extraction needs a CORS-clean copy; blob URLs are always clean.
  const probe = new Image();
  if (!src.startsWith('blob:')) probe.crossOrigin = 'anonymous';
  probe.onload = () => applyColor(dominantColor(probe));
  probe.onerror = () => applyColor(null);
  probe.src = src;
}

/* ---------------- rendering ---------------- */
function renderTrack() {
  const t = player.current();
  mini.hidden = !t;
  document.body.classList.toggle('has-mini', !!t);
  if (!t) { if (isOpen) close(); return; }
  el.title.textContent = el.cT.textContent = el.mTitle.textContent = t.title;
  el.artist.textContent = t.artist || '';
  el.cS.textContent = el.mArtist.textContent = t.artist || '';
  el.artist.href = t.artistId ? `#/artist/${encodeURIComponent(t.artistId)}` : '';
  setArtwork(t);
  lyricLines = null; lyricIdx = -2;
  if (mode === 'lyrics') renderLyrics();
  if (mode === 'queue') renderQueue();
}

function renderState() {
  const playing = player.isPlaying();
  const ic = icon(playing ? 'pause' : 'play');
  el.play.innerHTML = ic;
  el.play.setAttribute('aria-label', playing ? 'Pause' : 'Lecture');
  el.mPlay.innerHTML = ic;
  el.mPlay.setAttribute('aria-label', playing ? 'Pause' : 'Lecture');
  np.classList.toggle('paused', !playing);
}

function renderTime() {
  const a = player.audio;
  const d = Number.isFinite(a.duration) ? a.duration : player.current()?.duration || 0;
  if (!scrubbing) {
    el.fill.style.setProperty('--pos', d ? a.currentTime / d : 0);
    el.cur.textContent = fmtTime(a.currentTime);
    el.rem.textContent = '-' + fmtTime(Math.max(0, d - a.currentTime));
    el.bar.setAttribute('aria-valuenow', Math.round(a.currentTime));
    el.bar.setAttribute('aria-valuemax', Math.round(d));
  }
  if (mode === 'lyrics' && lyricLines) syncLyrics(a.currentTime);
}

/* ---------------- lyrics ---------------- */
async function renderLyrics() {
  const t = player.current();
  if (!t) return;
  el.lyrics.classList.remove('plain');
  el.lyrics.innerHTML = '<div class="ly-none">Recherche des paroles…</div>';
  const res = await getLyrics(t);
  if (player.current()?.id !== t.id || mode !== 'lyrics') return;
  if (!res) {
    lyricLines = null;
    el.lyrics.innerHTML = `<div class="ly-none">Aucune parole disponible pour ce titre.<br><br>Astuce : « … » › Importer des paroles (.lrc)</div>`;
    return;
  }
  if (res.synced) {
    lyricLines = res.lines;
    lyricIdx = -2;
    el.lyrics.innerHTML = res.lines.map((l, i) => `<p class="ly" data-i="${i}">${esc(l.text)}</p>`).join('') + `<p class="ly-src">Paroles : ${esc(res.source)}</p>`;
    syncLyrics(player.audio.currentTime, true);
  } else {
    lyricLines = null;
    el.lyrics.classList.add('plain');
    el.lyrics.innerHTML = `<div class="ly-plain">${esc(res.text)}</div><p class="ly-src">Paroles : ${esc(res.source)}</p>`;
  }
}

function syncLyrics(time, force = false) {
  const i = activeLine(lyricLines, time);
  if (i === lyricIdx && !force) return;
  lyricIdx = i;
  const ps = el.lyrics.querySelectorAll('.ly');
  ps.forEach((p, k) => { p.classList.toggle('active', k === i); p.classList.toggle('past', k < i); });
  const target = ps[Math.max(0, i)];
  if (target && Date.now() - userScrolledAt > 3000) {
    const top = target.offsetTop - el.lyrics.clientHeight * 0.32;
    el.lyrics.scrollTo({ top, behavior: force || reducedMotion() ? 'auto' : 'smooth' });
  }
}
el.lyrics.addEventListener('click', (e) => {
  const p = e.target.closest('.ly');
  if (p && lyricLines) { player.seek(lyricLines[+p.dataset.i].time); userScrolledAt = 0; if (!player.isPlaying()) player.play(); }
});
['touchmove', 'wheel'].forEach((ev) => el.lyrics.addEventListener(ev, () => { userScrolledAt = Date.now(); }, { passive: true }));

/* ---------------- queue panel ---------------- */
function renderQueue() {
  const q = player.queue;
  const cur = q.current;
  const src = q.source;
  el.queue.innerHTML = `
    <div class="q-toggles">
      <button class="q-toggle ${q.shuffle ? 'on' : ''}" data-act="shuffle" aria-pressed="${q.shuffle}">${icon('shuffle')}Aléatoire</button>
      <button class="q-toggle ${q.repeat !== 'off' ? 'on' : ''}" data-act="repeat" aria-label="Répéter : ${q.repeat}">${icon(q.repeat === 'one' ? 'repeat1' : 'repeat')}${q.repeat === 'one' ? 'Répéter 1' : 'Répéter'}</button>
    </div>
    <div class="q-h"><h4>Lecture en cours</h4></div>
    ${cur ? `<div class="list">${trackRow(cur, 0, { sub: cur.artist })}</div>` : ''}
    <div class="q-h"><h4>À suivre</h4>${q.upNext.length ? '<button data-act="clear-up">Effacer</button>' : ''}</div>
    <div class="list q-up">${q.upNext.map((t, i) => queueRow(t, i)).join('') || '<div class="q-empty">Utilisez « Lire ensuite » pour ajouter des titres ici.</div>'}</div>
    ${src.length || q.context.name ? `<div class="q-h"><div><h4>Suite de la lecture</h4>${q.context.name ? `<div class="q-sub">Depuis : ${esc(q.context.name)}</div>` : ''}</div>${src.length ? '<button data-act="clear-all">Effacer</button>' : ''}</div>
    <div class="list q-src">${src.map((t, i) => queueRow(t, i)).join('')}</div>` : ''}`;
  hydrate(el.queue);
}
const queueRow = (t, i) => trackRow(t, i, { editable: false }).replace(/<button class="more"[\s\S]*?<\/button>/, `<span class="handle" aria-label="Déplacer">${icon('grip')}</span>`);

el.queue.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'shuffle') { player.setShuffle(!player.queue.shuffle); return; }
  if (act === 'repeat') { player.cycleRepeat(); return; }
  if (act === 'clear-up') { player.queueOp((q) => q.clearUpNext()); return; }
  if (act === 'clear-all') { player.queueOp((q) => q.clearAll()); return; }
  const row = e.target.closest('.track');
  if (!row || e.target.closest('.handle')) return;
  if (row.closest('.q-up')) player.jump('upNext', +row.dataset.i);
  else if (row.closest('.q-src')) player.jump('source', +row.dataset.i);
});
function bindQueueLists() {
  // Lists are recreated on each render, so gestures are bound again.
  const up = el.queue.querySelector('.q-up');
  const src = el.queue.querySelector('.q-src');
  if (up && !up.dataset.bound) {
    up.dataset.bound = '1';
    sortable(up, { item: '.track', handle: '.handle', onMove: (f, t) => player.queueOp((q) => q.moveUpNext(f, t)) });
    swipeToDelete(up, { item: '.track', onDelete: (row) => player.queueOp((q) => q.removeUpNext(+row.dataset.i)) });
  }
  if (src && !src.dataset.bound) {
    src.dataset.bound = '1';
    sortable(src, { item: '.track', handle: '.handle', onMove: (f, t) => player.queueOp((q) => q.moveSource(f, t)) });
    swipeToDelete(src, { item: '.track', onDelete: (row) => player.queueOp((q) => q.removeSource(+row.dataset.i)) });
  }
}

/* ---------------- modes ---------------- */
function setMode(m) {
  mode = mode === m ? 'art' : m;
  np.classList.remove('mode-art', 'mode-lyrics', 'mode-queue');
  np.classList.add(`mode-${mode}`);
  np.querySelector('.b-lyrics').classList.toggle('on', mode === 'lyrics');
  np.querySelector('.b-queue').classList.toggle('on', mode === 'queue');
  if (mode === 'lyrics') renderLyrics();
  if (mode === 'queue') { renderQueue(); bindQueueLists(); }
}

/* ---------------- open / close with shared artwork flight ---------------- */
function flight(fromEl, toEl) {
  if (reducedMotion() || !artSrc) return;
  const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
  if (!a.width || !b.width) return;
  const img = document.createElement('img');
  img.className = 'flight';
  img.src = artSrc;
  Object.assign(img.style, { left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px` });
  document.body.append(img);
  const s = a.width / b.width;
  toEl.style.opacity = '0';
  img.animate(
    [{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${s})`, borderRadius: `${7 / s}px` }, { transform: 'none', borderRadius: '10px' }],
    { duration: 500, easing: 'cubic-bezier(.32,.72,0,1)' },
  ).finished.finally(() => { img.remove(); toEl.style.opacity = ''; });
}

export function open() {
  if (!player.current() || isOpen) return;
  isOpen = true;
  np.setAttribute('aria-hidden', 'false');
  np.classList.add('open');
  document.body.classList.add('locked');
  history.pushState({ np: true }, '');
  if (mode === 'art') requestAnimationFrame(() => flight(el.mArt, el.art));
}

export function close({ fromPop = false } = {}) {
  if (!isOpen) return;
  isOpen = false;
  np.classList.remove('open');
  np.setAttribute('aria-hidden', 'true');
  np.style.transform = '';
  document.body.classList.remove('locked');
  if (!fromPop && history.state?.np) history.back();
}
addEventListener('popstate', () => { if (isOpen) close({ fromPop: true }); });
// Navigating somewhere (album/artist from a menu) closes the player.
addEventListener('hashchange', () => { if (isOpen) close({ fromPop: true }); });

/* ---------------- progress scrubbing ---------------- */
function scrubTo(clientX) {
  const r = el.bar.getBoundingClientRect();
  const p = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  const d = player.audio.duration || player.current()?.duration || 0;
  el.fill.style.setProperty('--pos', p);
  el.cur.textContent = fmtTime(p * d);
  el.rem.textContent = '-' + fmtTime((1 - p) * d);
  return p * d;
}
el.bar.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  el.bar.setPointerCapture(e.pointerId);
  scrubbing = true;
  el.progress.classList.add('active');
  let target = scrubTo(e.clientX);
  const move = (ev) => { target = scrubTo(ev.clientX); };
  const up = () => {
    el.bar.removeEventListener('pointermove', move);
    el.bar.removeEventListener('pointerup', up);
    el.bar.removeEventListener('pointercancel', up);
    scrubbing = false;
    el.progress.classList.remove('active');
    player.seek(target);
  };
  el.bar.addEventListener('pointermove', move);
  el.bar.addEventListener('pointerup', up);
  el.bar.addEventListener('pointercancel', up);
});
el.bar.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') player.seek(player.audio.currentTime + 5);
  if (e.key === 'ArrowLeft') player.seek(player.audio.currentTime - 5);
});

/* ---------------- wiring ---------------- */
el.play.addEventListener('click', () => player.toggle());
np.querySelector('.c-prev').addEventListener('click', () => player.prev());
np.querySelector('.c-next').addEventListener('click', () => player.next());
np.querySelector('.b-lyrics').addEventListener('click', () => setMode('lyrics'));
np.querySelector('.b-queue').addEventListener('click', () => setMode('queue'));
np.querySelector('.np-grabber').addEventListener('click', () => close());
np.querySelectorAll('.np-more').forEach((b) => b.addEventListener('click', () => { const t = player.current(); if (t) openTrackMenu(t); }));
el.artist.addEventListener('click', (e) => { e.preventDefault(); const t = player.current(); if (t?.artistId) go(`/artist/${encodeURIComponent(t.artistId)}`); });
el.vol.addEventListener('input', () => { player.setVolume(+el.vol.value); el.vol.style.setProperty('--v', `${el.vol.value * 100}%`); });

dragToDismiss(np, {
  onDismiss: () => close(),
  canStart: (e) => isOpen && !e.target.closest('.np-panel, .np-progress, .np-volume, .np-controls button'),
});

mini.querySelector('.mini-hit').addEventListener('click', open);
el.mPlay.addEventListener('click', (e) => { e.stopPropagation(); player.toggle(); });
mini.querySelector('.mini-next').addEventListener('click', (e) => { e.stopPropagation(); player.next(); });
// swipe up on the mini player opens the full player
mini.addEventListener('pointerdown', (e) => {
  const sy = e.clientY;
  const up = (ev) => { mini.removeEventListener('pointerup', up); if (sy - ev.clientY > 30) open(); };
  mini.addEventListener('pointerup', up);
});

on('track', renderTrack);
on('state', renderState);
on('time', renderTime);
on('queue', () => { if (mode === 'queue' && isOpen) { renderQueue(); bindQueueLists(); } });
on('lyrics', (id) => { if (id === player.current()?.id && mode === 'lyrics') renderLyrics(); });
renderState();
np.classList.add('mode-art');
