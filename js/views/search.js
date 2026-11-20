// "Rechercher" — instant search (300 ms debounce) across the local library and Jamendo.
import { esc, icon, debounce } from '../util.js';
import { pageHeader, hydrate, skeletonRows } from '../ui.js';
import * as db from '../db.js';
import { libraryTracks, groupAlbums, groupArtists } from '../library.js';
import * as playlists from '../playlists.js';
import * as jamendo from '../jamendo.js';
import { trackListHTML, bindTrackList, albumCard, artistCard, playlistCard } from '../components.js';

let lastQuery = '';
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

async function saveRecent(q) {
  q = q.trim();
  if (q.length < 2) return;
  const list = (await db.getKV('recentSearches', [])).filter((x) => x !== q);
  await db.setKV('recentSearches', [q, ...list].slice(0, 10));
}

export async function search(page) {
  pageHeader(page, { title: 'Rechercher' });
  page.insertAdjacentHTML('beforeend', `<div class="searchbar"><label class="search-field">${icon('search')}
    <input type="search" placeholder="Artistes, titres, albums…" autocomplete="off" autocorrect="off" enterkeyhint="search" aria-label="Rechercher" value="${esc(lastQuery)}">
    <button class="search-clear" aria-label="Effacer" hidden>${icon('xmark', 'ic-sm')}</button></label></div><div data-results></div>`);
  const input = page.querySelector('input');
  const clearBtn = page.querySelector('.search-clear');
  const out = page.querySelector('[data-results]');
  let token = 0;

  const showRecent = async () => {
    const rec = await db.getKV('recentSearches', []);
    out.innerHTML = rec.length
      ? `<section class="sec"><h2 class="sec-h">Récents<button class="link" data-clear-rec>Effacer</button></h2><div class="list">
        ${rec.map((q) => `<button class="row tap" data-q="${esc(q)}" style="width:100%;text-align:left">${icon('search', 'ic-sm muted')}<div class="row-main"><div class="meta"><div class="t">${esc(q)}</div></div></div></button>`).join('')}</div></section>`
      : `<div class="empty">${icon('search')}<h3>Rechercher</h3><p>Dans votre bibliothèque et parmi des milliers de titres libres Jamendo.</p></div>`;
  };

  const run = async (q) => {
    const my = ++token;
    lastQuery = q;
    clearBtn.hidden = !q;
    if (!q.trim()) { showRecent(); return; }
    const nq = norm(q);
    const [lib, ps] = await Promise.all([libraryTracks(), playlists.list()]);
    if (my !== token) return;
    const tracks = lib.filter((t) => norm(`${t.title} ${t.artist} ${t.album}`).includes(nq)).slice(0, 20);
    const albums = groupAlbums(lib).filter((a) => norm(`${a.title} ${a.artist}`).includes(nq)).slice(0, 10);
    const artists = groupArtists(lib).filter((a) => norm(a.name).includes(nq)).slice(0, 10);
    const pls = ps.filter((p) => norm(p.name).includes(nq));
    out.innerHTML = `<div data-local></div><div data-remote>${(await jamendo.hasClientId()) && navigator.onLine ? `<h2 class="sub-h">Jamendo</h2>${skeletonRows(4)}` : ''}</div>`;
    renderGroup(out.querySelector('[data-local]'), { tracks, albums, artists, playlists: pls }, 'Bibliothèque');
    if (!(await jamendo.hasClientId()) || !navigator.onLine) {
      if (!tracks.length && !albums.length && !artists.length && !pls.length) out.querySelector('[data-local]').innerHTML = `<div class="empty"><h3>Aucun résultat</h3><p>pour « ${esc(q)} »</p></div>`;
      return;
    }
    try {
      const [jt, ja, jr] = await Promise.all([jamendo.searchTracks(q, 20), jamendo.searchAlbums(q, 10), jamendo.searchArtists(q, 10)]);
      if (my !== token) return;
      const known = new Set(tracks.map((t) => t.id));
      renderGroup(out.querySelector('[data-remote]'), { tracks: jt.filter((t) => !known.has(t.id)), albums: ja, artists: jr }, 'Jamendo');
    } catch (e) {
      if (my === token) out.querySelector('[data-remote]').innerHTML = `<p class="list-foot">${esc(e.message)}</p>`;
    }
  };
  const debounced = debounce(run, 300);

  input.addEventListener('input', () => debounced(input.value));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { saveRecent(input.value); input.blur(); } });
  clearBtn.addEventListener('click', (e) => { e.preventDefault(); input.value = ''; run(''); input.focus(); });
  out.addEventListener('click', async (e) => {
    const q = e.target.closest('[data-q]')?.dataset.q;
    if (q) { input.value = q; run(q); return; }
    if (e.target.closest('[data-clear-rec]')) { await db.setKV('recentSearches', []); showRecent(); return; }
    if (e.target.closest('.row, .card') && input.value.trim()) saveRecent(input.value);
  }, true);
  run(lastQuery);
}

function renderGroup(el, { tracks = [], albums = [], artists = [], playlists: pls = [] }, label) {
  let html = '';
  if (tracks.length) html += `<section class="sec"><h2 class="sec-h">Titres <span class="muted" style="font-size:15px;font-weight:500">${label}</span></h2>${trackListHTML(tracks)}</section>`;
  if (albums.length) html += `<section class="sec"><h2 class="sec-h">Albums</h2><div class="shelf">${albums.map(albumCard).join('')}</div></section>`;
  if (artists.length) html += `<section class="sec"><h2 class="sec-h">Artistes</h2><div class="shelf small">${artists.map(artistCard).join('')}</div></section>`;
  if (pls.length) html += `<section class="sec"><h2 class="sec-h">Playlists</h2><div class="shelf">${pls.map((p) => playlistCard(p)).join('')}</div></section>`;
  el.innerHTML = html;
  hydrate(el);
  const list = el.querySelector('.tracks');
  if (list) bindTrackList(list, tracks, { name: `Recherche (${label})` });
}
