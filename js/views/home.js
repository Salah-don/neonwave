// "Écouter" — recently played, your playlists, recently downloaded, Jamendo trending.
import { icon, on } from '../util.js';
import { pageHeader, skeletonShelf, hydrate } from '../ui.js';
import { recentTracks } from '../history.js';
import * as playlists from '../playlists.js';
import { libraryTracks } from '../library.js';
import * as jamendo from '../jamendo.js';
import { trackCards, bindTrackCards, playlistCard } from '../components.js';
import { refresh } from '../router.js';

export const settingsBtn = `<a class="nav-btn filled tap" href="#/settings" aria-label="Réglages">${icon('person-circle')}</a>`;

const shelf = (title, inner, href, key = '') =>
  `<section class="sec"><h2 class="sec-h">${href ? `<a href="${href}">${title}${icon('chevron-right', 'chev')}</a>` : title}</h2><div class="shelf" ${key ? `data-list="${key}"` : ''}>${inner}</div></section>`;

export async function home(page) {
  pageHeader(page, { title: 'Écouter', actions: settingsBtn });
  const body = document.createElement('div');
  body.innerHTML = skeletonShelf() + skeletonShelf();
  page.append(body);

  const [recent, ps, lib] = await Promise.all([recentTracks(20), playlists.list(), libraryTracks({ downloadedOnly: true })]);
  const downloaded = lib.sort((a, b) => (b.downloadedAt || b.addedAt) - (a.downloadedAt || a.addedAt)).slice(0, 20);
  const shownPs = ps.slice(0, 12);
  const psTracks = await Promise.all(shownPs.map((p) => playlists.tracksOf({ ...p, entries: p.entries.slice(0, 4) })));

  let html = '';
  if (!recent.length && !ps.length && !downloaded.length) {
    html += `<div class="empty">${icon('note')}<h3>Bienvenue sur NeonWave</h3><p>Importez vos fichiers audio ou explorez la musique libre de Jamendo.</p>
      <a class="pill primary" href="#/library">${icon('import')}Importer de la musique</a></div>`;
  }
  if (recent.length) html += shelf('Écoutés récemment', trackCards(recent), '#/library/history', 'recent');
  if (shownPs.length) html += shelf('Vos playlists', shownPs.map((p, i) => playlistCard(p, psTracks[i])).join(''), '#/library/playlists');
  if (downloaded.length) html += shelf('Téléchargés récemment', trackCards(downloaded), '#/library/downloads', 'downloaded');
  html += `<section class="sec"><h2 class="sec-h">Tendances Jamendo</h2><div data-trending>${skeletonShelf()}</div></section>`;
  body.innerHTML = html;
  hydrate(body);
  const recentEl = body.querySelector('[data-list=recent]');
  if (recentEl) bindTrackCards(recentEl, recent, 'Écoutés récemment');
  const dlEl = body.querySelector('[data-list=downloaded]');
  if (dlEl) bindTrackCards(dlEl, downloaded, 'Téléchargés');

  on('history', () => refresh(), page);
  on('playlists', () => refresh(), page);

  const slot = body.querySelector('[data-trending]');
  if (!(await jamendo.hasClientId())) {
    slot.innerHTML = `<p class="list-foot">Ajoutez votre client_id Jamendo dans <a class="accent" href="#/settings">Réglages</a> pour découvrir des milliers de titres libres.</p>`;
    return;
  }
  try {
    const trending = await jamendo.trending(20);
    slot.innerHTML = `<div class="shelf">${trackCards(trending)}</div>`;
    bindTrackCards(slot.firstElementChild, trending, 'Tendances Jamendo');
  } catch (e) {
    slot.innerHTML = `<p class="list-foot">${navigator.onLine ? e.message : 'Hors ligne — vos titres téléchargés restent disponibles.'}</p>`;
  }
}
