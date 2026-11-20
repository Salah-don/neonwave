// Album and artist detail pages (local library or Jamendo).
import { esc, icon, on, plural } from '../util.js';
import { pageHeader, watchTitle, hydrate, artHTML, skeletonRows, toast } from '../ui.js';
import { libraryTracks, groupAlbums } from '../library.js';
import * as jamendo from '../jamendo.js';
import * as downloads from '../downloads.js';
import { trackListHTML, bindTrackList, albumCard, playList, totalDuration, pickPlaylist } from '../components.js';
import { fmtTotal } from '../lib/sort.js';
import { refresh } from '../router.js';

const isRemote = (id) => id.startsWith('j:');

function heroHTML({ art, title, sub, subHref, meta, round }) {
  return `<div class="hero ${round ? 'round' : ''}"><div class="hero-art">${art}</div><h2>${esc(title)}</h2>
    ${sub ? `<a class="hero-sub" href="${subHref || '#'}">${esc(sub)}</a>` : ''}${meta ? `<div class="hero-meta">${esc(meta)}</div>` : ''}
    <div class="hero-actions"><button class="pill" data-play>${icon('play')}Lecture</button><button class="pill" data-shuffle>${icon('shuffle')}Aléatoire</button></div></div>`;
}

function wireHero(root, tracks, name) {
  root.querySelector('[data-play]').onclick = () => playList(tracks, 0, name);
  root.querySelector('[data-shuffle]').onclick = () => playList(tracks, -1, name, { shuffle: true });
}

function navActions(head, tracks) {
  const right = head.querySelector('.nav-right');
  const canDl = tracks.some((t) => !t.downloaded && t.source === 'jamendo' && t.downloadable);
  right.innerHTML = `${canDl ? `<button class="nav-btn tap" data-dl aria-label="Tout télécharger">${icon('download')}</button>` : ''}
    <button class="nav-btn tap" data-add aria-label="Ajouter à une playlist">${icon('plus')}</button>`;
  right.querySelector('[data-dl]')?.addEventListener('click', async () => {
    const n = await downloads.downloadMany(tracks);
    toast(n ? `${plural(n, 'titre', 'titres')} en téléchargement` : 'Rien à télécharger', 'download');
  });
  right.querySelector('[data-add]').onclick = () => pickPlaylist(tracks);
}

export async function albumView(page, { id }) {
  const head = pageHeader(page, { title: '', large: false });
  const body = document.createElement('div');
  body.innerHTML = skeletonRows(8);
  page.append(body);
  let album, tracks;
  try {
    if (isRemote(id)) {
      [album, tracks] = await Promise.all([jamendo.album(id), jamendo.albumTracks(id)]);
      if (!album && tracks[0]) album = { title: tracks[0].album, artist: tracks[0].artist, artistId: tracks[0].artistId, artwork: tracks[0].artwork };
    } else {
      const a = groupAlbums(await libraryTracks()).find((x) => x.id === id);
      if (a) { album = { title: a.title, artist: a.artist, artistId: a.tracks[0]?.artistId, cover: a.cover }; tracks = a.tracks; }
    }
  } catch (e) {
    // Offline: fall back to whatever of this album is in the library.
    const a = groupAlbums(await libraryTracks()).find((x) => x.id === id);
    if (a) { album = { title: a.title, artist: a.artist, artistId: a.tracks[0]?.artistId, cover: a.cover }; tracks = a.tracks; }
    else { body.innerHTML = `<div class="empty"><h3>Album indisponible</h3><p>${esc(e.message)}</p></div>`; return; }
  }
  if (!album || !tracks?.length) { body.innerHTML = '<div class="empty"><h3>Album introuvable</h3></div>'; return; }
  head.querySelector('.nav-title').textContent = album.title;
  const year = album.releaseDate ? album.releaseDate.slice(0, 4) : '';
  body.innerHTML = heroHTML({
    art: album.cover ? artHTML(album.cover) : artHTML({ artwork: album.artwork }),
    title: album.title, sub: album.artist, subHref: album.artistId ? `#/artist/${encodeURIComponent(album.artistId)}` : '',
    meta: [tracks[0]?.genre, year].filter(Boolean).join(' · '),
  }) + trackListHTML(tracks, { numbered: true, sub: '' }) + `<p class="list-foot">${plural(tracks.length, 'titre', 'titres')}, ${fmtTotal(totalDuration(tracks))}</p>`;
  // hero-art is the sentinel: nav title fades in once it scrolls away
  watchTitle(head, body.querySelector('.hero h2'));
  hydrate(body);
  wireHero(body, tracks, album.title);
  navActions(head, tracks);
  bindTrackList(body.querySelector('.tracks'), tracks, { name: album.title });
  on('library', () => refresh(), page);
}

export async function artistView(page, { id }) {
  const head = pageHeader(page, { title: '', large: false });
  const body = document.createElement('div');
  body.innerHTML = skeletonRows(8);
  page.append(body);
  const local = (await libraryTracks()).filter((t) => t.artistId === id);
  let info = { name: local[0]?.artist || 'Artiste', artwork: '' }, top = local, albums = groupAlbums(local);
  let note = '';
  if (isRemote(id) && navigator.onLine) {
    try {
      const [a, t, al] = await Promise.all([jamendo.artist(id), jamendo.artistTracks(id), jamendo.artistAlbums(id)]);
      if (a) info = a;
      top = t.length ? t : local;
      albums = al.length ? al : albums;
    } catch (e) { note = e.message; }
  }
  head.querySelector('.nav-title').textContent = info.name;
  body.innerHTML = heroHTML({ art: info.artwork ? artHTML({ artwork: info.artwork }) : local[0]?.hasArtBlob ? artHTML(local[0]) : `<div class="noart">${icon('artist')}</div>`, title: info.name, round: true })
    + (top.length ? `<section class="sec"><h2 class="sec-h">Titres populaires</h2>${trackListHTML(top.slice(0, 30), { showAlbum: true })}</section>` : '')
    + (albums.length ? `<section class="sec"><h2 class="sec-h">Albums</h2><div class="shelf">${albums.map(albumCard).join('')}</div></section>` : '')
    + (note ? `<p class="list-foot">${esc(note)}</p>` : '');
  watchTitle(head, body.querySelector('.hero h2'));
  hydrate(body);
  const list = top.slice(0, 30);
  wireHero(body, list, info.name);
  navActions(head, list);
  const el = body.querySelector('.tracks');
  if (el) bindTrackList(el, list, { name: info.name });
}
