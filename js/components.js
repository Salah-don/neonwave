// Shared track/collection components: rows, cards, list binding, context menus, sort menu.
import { esc, icon, on, $$ } from './util.js';
import { artHTML, playlistArtHTML, hydrate, actionMenu, toast, confirmBox, promptBox, pickFiles, sheet } from './ui.js';
import { longPress } from './gestures.js';
import * as player from './player.js';
import * as downloads from './downloads.js';
import * as playlists from './playlists.js';
import { addToLibrary, removeFromLibrary, saveLRC } from './library.js';
import { go } from './router.js';
import { fmtTime, SORT_LABELS } from './lib/sort.js';
import * as db from './db.js';

/* ---------------- rows ---------------- */
function statusHTML(t) {
  const j = downloads.job(t.id);
  if (j && j.status !== 'failed') return `<span class="dl-ring ${j.status === 'active' ? '' : 'queued'}" data-dl="${esc(t.id)}" style="--p:${j.progress || 0}"></span>`;
  return '';
}

/**
 * @param {object} t track
 * @param {number} i index in list
 * @param {{numbered?:boolean, editable?:boolean, sub?:string}} o
 */
export function trackRow(t, i, o = {}) {
  const playing = player.current()?.id === t.id;
  const lead = o.numbered ? `<span class="num">${playing ? '<span class="eq"><i></i><i></i><i></i></span>' : t.trackNo || i + 1}</span>` : artHTML(t);
  const sub = o.sub ?? [t.artist, o.showAlbum ? t.album : ''].filter(Boolean).join(' · ');
  return `<div class="row track tap ${playing ? 'playing' : ''}" data-i="${i}" data-id="${esc(t.id)}" role="button" tabindex="0">
    ${o.editable ? `<button class="del-btn" aria-label="Retirer">${icon('minus-circle')}</button>` : ''}
    ${lead}
    <div class="row-main">
      <div class="meta"><div class="t">${esc(t.title)}</div>
        <div class="s">${t.downloaded ? icon('downloaded', 'dl-mark') : ''}<span class="ellipsis">${esc(sub)}</span></div></div>
      ${statusHTML(t)}
      ${o.editable ? `<span class="handle" aria-label="Déplacer">${icon('grip')}</span>` : `<button class="more" aria-label="Plus d'options">${icon('more')}</button>`}
    </div></div>`;
}

export const trackListHTML = (tracks, o) => `<div class="list tracks">${tracks.map((t, i) => trackRow(t, i, o)).join('')}</div>`;

/** Play from a list; offline, only downloaded tracks are kept. */
export function playList(tracks, i, name, opts) {
  if (!navigator.onLine) {
    const ok = tracks.filter((t) => t.downloaded);
    const idx = i < 0 ? -1 : ok.indexOf(tracks[i]);
    if (!ok.length || (i >= 0 && idx < 0)) { toast('Non disponible hors ligne', 'xmark'); return; }
    return player.playTracks(ok, idx, name, opts);
  }
  return player.playTracks(tracks, i, name, opts);
}

/** Wire click → play, "…"/long press → menu, and live state updates on a rendered list. */
export function bindTrackList(listEl, tracks, ctx = {}) {
  listEl.addEventListener('click', (e) => {
    const row = e.target.closest('.track');
    if (!row || ctx.editing?.()) return;
    const i = +row.dataset.i;
    if (e.target.closest('.more')) { e.stopPropagation(); openTrackMenu(tracks[i], { ...ctx, index: i }); return; }
    if (e.target.closest('.del-btn')) return;
    playList(tracks, i, ctx.name || '');
  });
  longPress(listEl, '.track', (row) => openTrackMenu(tracks[+row.dataset.i], { ...ctx, index: +row.dataset.i }));
  hydrate(listEl);
}

// Global live updates: playing indicator + download rings (cheap DOM patches, no re-render).
on('track', (t) => {
  $$('.track[data-id]').forEach((r) => {
    const on_ = r.dataset.id === t?.id;
    r.classList.toggle('playing', on_);
    const num = r.querySelector('.num');
    if (num) num.innerHTML = on_ ? '<span class="eq"><i></i><i></i><i></i></span>' : String(+r.dataset.i + 1);
  });
});
on('state', () => document.body.classList.toggle('paused-all', !player.isPlaying()));
on('download-progress', ({ id, progress }) => {
  $$(`[data-dl="${CSS.escape(id)}"]`).forEach((el) => { el.classList.remove('queued'); el.style.setProperty('--p', progress); });
});
on('download', ({ id, done }) => {
  const j = downloads.job(id);
  $$(`.track[data-id="${CSS.escape(id)}"] .row-main`).forEach((main) => {
    main.querySelector('.dl-ring')?.remove();
    const sub = main.querySelector('.meta .s');
    if (done && sub && !sub.querySelector('.dl-mark')) sub.insertAdjacentHTML('afterbegin', icon('downloaded', 'dl-mark'));
    if (j && j.status !== 'failed') main.querySelector('.meta').insertAdjacentHTML('afterend', `<span class="dl-ring ${j.status === 'active' ? '' : 'queued'}" data-dl="${esc(id)}" style="--p:${j.progress || 0}"></span>`);
  });
});

/* ---------------- cards ---------------- */
export const albumCard = (a) => `<a class="card tap" href="#/album/${encodeURIComponent(a.id)}">${a.cover ? artHTML(a.cover) : a.artwork ? artHTML({ artwork: a.artwork }) : `<div class="noart">${icon('album')}</div>`}
  <div class="card-t">${esc(a.title)}</div><div class="card-s">${esc(a.artist || '')}</div></a>`;
export const artistCard = (a) => `<a class="card round tap" href="#/artist/${encodeURIComponent(a.id)}">${a.cover ? artHTML(a.cover) : a.artwork ? artHTML({ artwork: a.artwork }) : `<div class="noart">${icon('artist')}</div>`}
  <div class="card-t">${esc(a.name)}</div></a>`;
export const playlistCard = (p, tracks) => `<a class="card tap" href="#/playlist/${encodeURIComponent(p.id)}">${playlistArtHTML(p, tracks)}
  <div class="card-t">${esc(p.name)}</div><div class="card-s">${p.entries.length} titre${p.entries.length > 1 ? 's' : ''}</div></a>`;
export function trackCards(tracks) {
  return tracks.map((t, i) => `<button class="card tap" data-i="${i}" style="text-align:left">${artHTML(t)}<div class="card-t">${esc(t.title)}</div><div class="card-s">${esc(t.artist)}</div></button>`).join('');
}
export function bindTrackCards(el, tracks, name) {
  el.addEventListener('click', (e) => { const c = e.target.closest('[data-i]'); if (c) playList(tracks, +c.dataset.i, name); });
  longPress(el, '[data-i]', (c) => openTrackMenu(tracks[+c.dataset.i], {}));
  hydrate(el);
}

/* ---------------- context menu ---------------- */
export function openTrackMenu(t, ctx = {}) {
  const header = `<div class="menu-head">${artHTML(t)}<div class="meta"><div class="t ellipsis">${esc(t.title)}</div><div class="s ellipsis">${esc(t.artist)}${t.album ? ` · ${esc(t.album)}` : ''}</div></div></div>`;
  const isLocal = t.source === 'local';
  const queueGroup = [
    { label: 'Lire ensuite', icon: 'insert-next', run: () => { player.playNext(t); toast('Sera lu ensuite', 'insert-next'); } },
    { label: "Ajouter à la file d'attente", icon: 'insert-last', run: () => { player.addToQueue(t); toast("Ajouté à la file d'attente", 'insert-last'); } },
  ];
  const libGroup = [
    { label: 'Ajouter à une playlist…', icon: 'playlist', run: () => pickPlaylist([t]) },
    !t.inLibrary && !isLocal && { label: 'Ajouter à la bibliothèque', icon: 'plus', run: async () => { await addToLibrary(t); toast('Ajouté à la bibliothèque'); } },
    !isLocal && !t.downloaded && t.downloadable && { label: 'Télécharger', icon: 'download', run: () => downloads.download(t) },
    !isLocal && t.downloaded && { label: 'Supprimer le téléchargement', icon: 'trash', destructive: true, run: () => downloads.removeDownload(t.id).then(() => toast('Téléchargement supprimé')) },
  ].filter(Boolean);
  const navGroup = [
    t.albumId && t.album && { label: "Aller à l'album", icon: 'album', run: () => go(`/album/${encodeURIComponent(t.albumId)}`) },
    t.artistId && { label: "Aller à l'artiste", icon: 'artist', run: () => go(`/artist/${encodeURIComponent(t.artistId)}`) },
    { label: 'Importer des paroles (.lrc)', icon: 'lyrics', run: () => importLyrics(t) },
  ].filter(Boolean);
  const dangerGroup = [
    ctx.playlistId != null && t.entryIndex != null && { label: 'Retirer de la playlist', icon: 'xmark', destructive: true, run: () => playlists.removeEntry(ctx.playlistId, t.entryIndex) },
    (t.inLibrary || isLocal) && { label: 'Supprimer de la bibliothèque', icon: 'trash', destructive: true, run: async () => {
      if (await confirmBox('Supprimer de la bibliothèque ?', isLocal ? 'Le fichier importé sera effacé de cet appareil.' : 'Le téléchargement éventuel sera aussi supprimé.', 'Supprimer', true)) removeFromLibrary(t.id);
    } },
  ].filter(Boolean);
  actionMenu({ header, groups: [queueGroup, libGroup, navGroup, dangerGroup] });
}

async function importLyrics(t) {
  const [f] = await pickFiles({ accept: '.lrc,.txt,text/plain' });
  if (!f) return;
  if (f.size > 512 * 1024) { toast('Fichier trop volumineux', 'xmark'); return; }
  await saveLRC(t.id, await f.text());
  toast('Paroles importées', 'lyrics');
}

/** Sheet listing playlists (+ "Nouvelle playlist…"). */
export async function pickPlaylist(tracks) {
  const ps = await playlists.list();
  const s = sheet({ title: 'Ajouter à une playlist', left: '<button data-x>Annuler</button>' });
  s.body.innerHTML = `<div class="list">
    <div class="row nav-row tap" data-new>${icon('plus')}<div class="row-main"><span class="accent">Nouvelle playlist…</span></div></div>
    ${ps.map((p) => `<div class="row tap" data-id="${esc(p.id)}">${playlistArtHTML(p)}<div class="row-main"><div class="meta"><div class="t">${esc(p.name)}</div><div class="s">${p.entries.length} titres</div></div></div></div>`).join('')}
  </div>`;
  hydrate(s.body);
  s.el.querySelector('[data-x]').addEventListener('click', () => s.close());
  s.body.addEventListener('click', async (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    let id = row.dataset.id;
    s.close();
    if (row.hasAttribute('data-new')) {
      const name = await promptBox('Nouvelle playlist', { placeholder: 'Nom de la playlist', okLabel: 'Créer' });
      if (!name) return;
      id = (await playlists.create({ name })).id;
    }
    const r = await playlists.addTracks(id, tracks);
    toast(r.added ? `${r.added} titre${r.added > 1 ? 's' : ''} ajouté${r.added > 1 ? 's' : ''}` : 'Déjà dans la playlist', r.added ? 'check' : 'xmark');
  });
}

/* ---------------- sorting ---------------- */
export async function getSort(section, fallback = { key: 'title', dir: 'asc' }) {
  return db.getKV(`sort:${section}`, fallback);
}
/** Opens the sort menu; resolves after the choice is stored. */
export function sortMenu(section, current, keys, onChange) {
  const pick = async (s) => { await db.setKV(`sort:${section}`, s); onChange(s); };
  actionMenu({
    groups: [
      keys.map((k) => ({ label: SORT_LABELS[k], checked: current.key === k, run: () => pick({ ...current, key: k }) })),
      [
        { label: 'Croissant', checked: current.dir === 'asc', run: () => pick({ ...current, dir: 'asc' }) },
        { label: 'Décroissant', checked: current.dir === 'desc', run: () => pick({ ...current, dir: 'desc' }) },
      ],
    ],
  });
}

export const totalDuration = (tracks) => tracks.reduce((s, t) => s + (t.duration || 0), 0);
export { fmtTime };
