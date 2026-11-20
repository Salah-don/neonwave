// "Bibliothèque" — root menu and sections: Playlists, Artistes, Albums, Titres, Téléchargés, Historique.
import { esc, icon, on, plural } from '../util.js';
import { pageHeader, actionMenu, toast, promptBox, confirmBox, hydrate, artHTML, pickFiles, skeletonRows } from '../ui.js';
import * as db from '../db.js';
import { libraryTracks, groupAlbums, groupArtists, importFiles } from '../library.js';
import * as playlists from '../playlists.js';
import * as downloads from '../downloads.js';
import { getHistory, clearHistory } from '../history.js';
import { trackListHTML, bindTrackList, albumCard, playlistCard, sortMenu, getSort, playList } from '../components.js';
import { sortTracks, groupByPeriod, compareText } from '../lib/sort.js';
import { refresh, go } from '../router.js';
import { settingsBtn } from './home.js';

const SECTIONS = [
  ['playlists', 'Playlists', 'playlist'], ['artists', 'Artistes', 'artist'], ['albums', 'Albums', 'album'],
  ['songs', 'Titres', 'note'], ['downloads', 'Téléchargés', 'downloaded'], ['history', 'Historique', 'clock'],
];
const TRACK_SORTS = ['title', 'artist', 'album', 'addedAt', 'plays', 'duration'];
const GROUP_SORTS = ['title', 'addedAt', 'plays'];

const downloadedOnly = () => db.getKV('libDownloadedOnly', false);

/* ---------------- import / create actions ---------------- */
export async function importFlow() {
  const files = await pickFiles({ accept: 'audio/*,.mp3,.m4a,.aac,.flac,.wav,.lrc', multiple: true });
  if (!files.length) return;
  toast(`Import de ${plural(files.length, 'fichier', 'fichiers')}…`, 'import');
  const r = await importFiles(files, (i, n) => { if (n > 3 && i < n) toast(`Import ${i + 1}/${n}…`, 'import'); });
  const parts = [`${plural(r.added, 'titre importé', 'titres importés')}`];
  if (r.skipped) parts.push(`${r.skipped} déjà présent${r.skipped > 1 ? 's' : ''}`);
  toast(parts.join(' · '), r.added ? 'check' : 'xmark');
  if (r.failed.length) setTimeout(() => toast(`Échec : ${r.failed.slice(0, 2).join(', ')}`, 'xmark'), 2400);
}
export async function newPlaylistFlow() {
  const name = await promptBox('Nouvelle playlist', { placeholder: 'Nom de la playlist', okLabel: 'Créer' });
  if (!name) return;
  const p = await playlists.create({ name });
  go(`/playlist/${encodeURIComponent(p.id)}`);
}
const addMenu = () => actionMenu({ groups: [[
  { label: 'Importer des fichiers audio', icon: 'import', run: importFlow },
  { label: 'Nouvelle playlist', icon: 'playlist', run: newPlaylistFlow },
]] });

/* ---------------- root ---------------- */
export async function libraryRoot(page) {
  const head = pageHeader(page, { title: 'Bibliothèque', actions: `<button class="nav-btn tap" data-add aria-label="Ajouter">${icon('plus')}</button>${settingsBtn}` });
  head.querySelector('[data-add]').onclick = addMenu;
  const only = await downloadedOnly();
  const tracks = await libraryTracks({ downloadedOnly: only });
  const ps = await playlists.list();
  const counts = {
    playlists: ps.length, artists: groupArtists(tracks).length, albums: groupAlbums(tracks).length,
    songs: tracks.length, downloads: tracks.filter((t) => t.downloaded).length, history: '',
  };
  const recentAlbums = groupAlbums(tracks).sort((a, b) => b.addedAt - a.addedAt).slice(0, 8);
  const recentPs = ps.slice(0, 4);
  const psTracks = await Promise.all(recentPs.map((p) => playlists.tracksOf({ ...p, entries: p.entries.slice(0, 4) })));
  page.insertAdjacentHTML('beforeend', `
    <div class="list nav-list">${SECTIONS.map(([k, label, ic]) => `<a class="row nav-row tap" href="#/library/${k}">${icon(ic)}<div class="row-main"><span>${label}</span><span class="count">${counts[k] || ''}</span>${icon('chevron-right', 'chev')}</div></a>`).join('')}</div>
    <div class="chips" style="margin:6px 0 4px"><button class="chip ${only ? 'on' : ''}" data-only>${icon('downloaded', 'ic-xs')}Téléchargés uniquement</button></div>
    ${tracks.length || ps.length ? `<section class="sec"><h2 class="sec-h">Ajoutés récemment</h2><div class="grid">
      ${recentPs.map((p, i) => playlistCard(p, psTracks[i])).join('')}${recentAlbums.map(albumCard).join('')}</div></section>` : ''}
    ${!tracks.length ? `<div class="empty">${icon('library')}<h3>Bibliothèque vide</h3><p>Importez vos MP3, M4A, FLAC ou WAV depuis l'app Fichiers, ou ajoutez des titres Jamendo.</p>
      <button class="pill primary" data-import>${icon('import')}Importer des fichiers</button></div>` : ''}`);
  hydrate(page);
  page.querySelector('[data-only]').onclick = async () => { await db.setKV('libDownloadedOnly', !only); refresh(); };
  page.querySelector('[data-import]')?.addEventListener('click', importFlow);
  on('library', () => refresh(), page);
  on('playlists', () => refresh(), page);
}

/* ---------------- sections ---------------- */
export async function librarySection(page, { section }) {
  const meta = SECTIONS.find((s) => s[0] === section);
  if (!meta) { page.innerHTML = '<div class="empty"><h3>Section inconnue</h3></div>'; return; }
  const view = { playlists: playlistsSection, artists: artistsSection, albums: albumsSection, songs: songsSection, downloads: downloadsSection, history: historySection }[section];
  await view(page, meta[1]);
  on('library', () => refresh(), page);
  on('playlists', () => refresh(), page);
}

function sortButton(head, section, keys, current) {
  const right = head.querySelector('.nav-right');
  right.insertAdjacentHTML('afterbegin', `<button class="nav-btn tap" aria-label="Trier">${icon('sort')}</button>`);
  right.firstElementChild.onclick = () => sortMenu(section, current, keys, () => refresh());
}

function sortGroups(list, s, titleKey) {
  const f = { title: (a, b) => compareText(a[titleKey], b[titleKey]), addedAt: (a, b) => a.addedAt - b.addedAt, plays: (a, b) => a.playCount - b.playCount }[s.key] || ((a, b) => compareText(a[titleKey], b[titleKey]));
  const out = [...list].sort(f);
  return s.dir === 'desc' ? out.reverse() : out;
}

async function playlistsSection(page, title) {
  const head = pageHeader(page, { title, large: true, showBack: true });
  const s = await getSort('playlists', { key: 'addedAt', dir: 'desc' });
  sortButton(head, 'playlists', GROUP_SORTS, s);
  const ps = sortGroups((await playlists.list()).map((p) => ({ ...p, title: p.name, addedAt: p.createdAt, playCount: 0 })), s, 'title');
  const psTracks = await Promise.all(ps.map((p) => playlists.tracksOf({ ...p, entries: p.entries.slice(0, 4) })));
  page.insertAdjacentHTML('beforeend', `<div class="list">
    <div class="row nav-row tap" data-new>${icon('plus')}<div class="row-main"><span class="accent">Nouvelle playlist…</span></div></div>
    <div class="row nav-row tap" data-import-json>${icon('import')}<div class="row-main"><span class="accent">Importer une sauvegarde…</span></div></div></div>
    <div class="grid" style="margin-top:16px">${ps.map((p, i) => playlistCard(p, psTracks[i])).join('')}</div>`);
  hydrate(page);
  page.querySelector('[data-new]').onclick = newPlaylistFlow;
  page.querySelector('[data-import-json]').onclick = importBackupFlow;
}

export async function importBackupFlow() {
  const [f] = await pickFiles({ accept: 'application/json,.json' });
  if (!f) return;
  try {
    if (f.size > 20 * 1024 * 1024) throw new Error('Fichier trop volumineux');
    const n = await playlists.importJSON(JSON.parse(await f.text()));
    toast(`${plural(n, 'playlist importée', 'playlists importées')}`);
  } catch (e) {
    toast(e instanceof SyntaxError ? 'JSON invalide' : e.message, 'xmark');
  }
}

async function artistsSection(page, title) {
  const head = pageHeader(page, { title, showBack: true });
  const s = await getSort('artists', { key: 'title', dir: 'asc' });
  sortButton(head, 'artists', GROUP_SORTS, s);
  const artists = sortGroups(groupArtists(await libraryTracks({ downloadedOnly: await downloadedOnly() })), s, 'name');
  if (!artists.length) { page.insertAdjacentHTML('beforeend', `<div class="empty">${icon('artist')}<h3>Aucun artiste</h3></div>`); return; }
  page.insertAdjacentHTML('beforeend', `<div class="list">${artists.map((a) => `<a class="row tap" href="#/artist/${encodeURIComponent(a.id)}">
    ${a.cover ? artHTML(a.cover).replace('class="art"', 'class="art" style="border-radius:50%"') : `<div class="noart" style="border-radius:50%">${icon('artist')}</div>`}
    <div class="row-main"><div class="meta"><div class="t">${esc(a.name)}</div><div class="s">${plural(a.tracks.length, 'titre', 'titres')}</div></div>${icon('chevron-right', 'chev')}</div></a>`).join('')}</div>`);
  hydrate(page);
}

async function albumsSection(page, title) {
  const head = pageHeader(page, { title, showBack: true });
  const s = await getSort('albums', { key: 'title', dir: 'asc' });
  sortButton(head, 'albums', GROUP_SORTS, s);
  const albums = sortGroups(groupAlbums(await libraryTracks({ downloadedOnly: await downloadedOnly() })), s, 'title');
  if (!albums.length) { page.insertAdjacentHTML('beforeend', `<div class="empty">${icon('album')}<h3>Aucun album</h3></div>`); return; }
  page.insertAdjacentHTML('beforeend', `<div class="grid">${albums.map(albumCard).join('')}</div>`);
  hydrate(page);
}

async function songsSection(page, title, { onlyDownloaded = false, section = 'songs' } = {}) {
  const head = pageHeader(page, { title, showBack: true });
  const s = await getSort(section, { key: 'title', dir: 'asc' });
  sortButton(head, section, TRACK_SORTS, s);
  const body = document.createElement('div');
  body.innerHTML = skeletonRows(8);
  page.append(body);
  const all = await libraryTracks({ downloadedOnly: onlyDownloaded || (await downloadedOnly()) });
  const tracks = sortTracks(all, s.key, s.dir);
  if (!tracks.length) {
    body.innerHTML = `<div class="empty">${icon(onlyDownloaded ? 'download' : 'note')}<h3>${onlyDownloaded ? 'Aucun téléchargement' : 'Aucun titre'}</h3>
      <p>${onlyDownloaded ? 'Touchez « … » › Télécharger sur un titre Jamendo pour l\'écouter hors ligne.' : 'Importez des fichiers ou ajoutez des titres depuis Jamendo.'}</p></div>`;
    return;
  }
  body.innerHTML = `<div class="hero-actions" style="padding:0 var(--gutter) 14px;margin:0 auto">
      <button class="pill" data-play>${icon('play')}Lecture</button><button class="pill" data-shuffle>${icon('shuffle')}Aléatoire</button></div>
    ${trackListHTML(tracks, { showAlbum: true })}<p class="list-foot">${plural(tracks.length, 'titre', 'titres')}</p>`;
  body.querySelector('[data-play]').onclick = () => playList(tracks, 0, title);
  body.querySelector('[data-shuffle]').onclick = () => playList(tracks, -1, title, { shuffle: true });
  bindTrackList(body.querySelector('.tracks'), tracks, { name: title });
}

async function downloadsSection(page, title) {
  const active = downloads.activeJobs();
  await songsSection(page, title, { onlyDownloaded: true, section: 'downloads' });
  if (!active.length) return;
  const box = document.createElement('section');
  box.className = 'sec';
  box.innerHTML = `<h2 class="sub-h">En cours (${active.length})</h2><div class="list">${active.map((j) => `<div class="row" data-job="${esc(j.track.id)}">${artHTML(j.track)}
    <div class="row-main"><div class="meta"><div class="t">${esc(j.track.title)}</div>
    <div class="s">${j.status === 'failed' ? `Échec — ${esc(j.error || '')}` : j.status === 'waiting' ? 'Nouvel essai…' : j.status === 'queued' ? 'En attente' : 'Téléchargement…'}</div>
    <div class="dl-bar"><div data-dl-bar="${esc(j.track.id)}" style="width:${Math.round((j.progress || 0) * 100)}%"></div></div></div>
    ${j.status === 'failed' ? `<button class="nav-btn text" data-retry="${esc(j.track.id)}">Réessayer</button>` : ''}</div></div>`).join('')}</div>`;
  page.querySelector('.navbar').nextElementSibling.after(box);
  hydrate(box);
  box.addEventListener('click', (e) => { const id = e.target.closest('[data-retry]')?.dataset.retry; if (id) downloads.retry(id); });
  on('download-progress', ({ id, progress }) => {
    const bar = box.querySelector(`[data-dl-bar="${CSS.escape(id)}"]`);
    if (bar) bar.style.width = `${Math.round(progress * 100)}%`;
  }, box);
  on('download', () => refresh(), box);
}

async function historySection(page, title) {
  const head = pageHeader(page, { title, showBack: true });
  const entries = await getHistory();
  if (entries.length) {
    head.querySelector('.nav-right').insertAdjacentHTML('afterbegin', '<button class="nav-btn text tap" data-clear>Effacer</button>');
    head.querySelector('[data-clear]').onclick = async () => {
      if (await confirmBox("Effacer l'historique ?", 'Les compteurs « Plus écoutés » sont conservés.', 'Effacer', true)) { await clearHistory(); refresh(); }
    };
  }
  if (!entries.length) { page.insertAdjacentHTML('beforeend', `<div class="empty">${icon('clock')}<h3>Aucune écoute</h3><p>Les titres écoutés plus de 30 secondes apparaissent ici.</p></div>`); return; }
  const fresh = new Map((await db.all('tracks')).map((t) => [t.id, t]));
  const groups = groupByPeriod(entries.slice(0, 500));
  const timeFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  for (const g of groups) {
    const tracks = g.items.map((e) => ({ ...(e.track || {}), ...(fresh.get(e.trackId) || {}), _at: e.at, _listened: e.listened }));
    const sec = document.createElement('section');
    sec.innerHTML = `<h2 class="sub-h">${esc(g.label)}</h2>${trackListHTML(tracks.map((t) => ({ ...t, artist: `${t.artist || ''} · ${timeFmt.format(t._at)}` })))}`;
    page.append(sec);
    bindTrackList(sec.querySelector('.tracks'), tracks, { name: 'Historique' });
  }
}
