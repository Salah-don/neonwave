// "Parcourir" — Jamendo genres as tiles, and the genre detail page.
import { esc, icon } from '../util.js';
import { pageHeader, skeletonRows } from '../ui.js';
import * as jamendo from '../jamendo.js';
import { trackListHTML, bindTrackList, playList } from '../components.js';

export async function browse(page) {
  pageHeader(page, { title: 'Parcourir' });
  page.insertAdjacentHTML('beforeend', `<section class="sec"><h2 class="sec-h">Genres</h2><div class="tiles">
    ${jamendo.GENRES.map(([tag, label, a, b]) => `<a class="tile tap" href="#/genre/${tag}" style="--g:linear-gradient(135deg, ${a}, ${b})">${esc(label)}</a>`).join('')}
  </div></section>`);
}

export async function genre(page, { tag }) {
  const g = jamendo.GENRES.find((x) => x[0] === tag);
  const label = g ? g[1] : tag;
  pageHeader(page, { title: label, showBack: true });
  const body = document.createElement('div');
  body.innerHTML = skeletonRows(8);
  page.append(body);
  try {
    const tracks = await jamendo.byGenre(tag);
    if (!tracks.length) { body.innerHTML = '<div class="empty"><h3>Aucun titre</h3></div>'; return; }
    body.innerHTML = `<div class="hero-actions" style="padding:0 var(--gutter) 14px;margin:0 auto">
        <button class="pill" data-play>${icon('play')}Lecture</button><button class="pill" data-shuffle>${icon('shuffle')}Aléatoire</button></div>
      ${trackListHTML(tracks, { showAlbum: false })}`;
    body.querySelector('[data-play]').onclick = () => playList(tracks, 0, label);
    body.querySelector('[data-shuffle]').onclick = () => playList(tracks, -1, label, { shuffle: true });
    bindTrackList(body.querySelector('.tracks'), tracks, { name: label });
  } catch (e) {
    body.innerHTML = `<div class="empty">${icon('browse')}<h3>Indisponible</h3><p>${esc(e.message)}</p></div>`;
  }
}
