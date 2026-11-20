// Entry point: routes, service worker, persistent storage, welcome screen, queue restore.
import { html, icon, isStandalone, isIOS } from './util.js';
import * as db from './db.js';
import { route, start } from './router.js';
import { toast } from './ui.js';
import * as player from './player.js';
import './nowplaying.js';
import { home } from './views/home.js';
import { browse, genre } from './views/browse.js';
import { libraryRoot, librarySection } from './views/library.js';
import { search } from './views/search.js';
import { albumView, artistView } from './views/album.js';
import { playlistView } from './views/playlist.js';
import { settings } from './views/settings.js';

route('/home', home);
route('/browse', browse);
route('/genre/:tag', genre);
route('/library', libraryRoot);
route('/library/:section', librarySection);
route('/search', search);
route('/album/:id', albumView);
route('/artist/:id', artistView);
route('/playlist/:id', playlistView);
route('/settings', settings);

async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) toast('Mise à jour installée — elle sera active au prochain lancement', 'check');
      });
    });
  } catch (e) {
    toast(`Mode hors-ligne indisponible (${e.message})`, 'xmark');
  }
}

async function firstLaunch() {
  const seen = await db.getKV('welcomed', false);
  if (!seen) {
    await db.setKV('welcomed', true);
    navigator.storage?.persist?.().catch(() => {});
  }
  if (seen || isStandalone()) return;
  const w = html(`<div class="welcome" role="dialog" aria-label="Bienvenue">
    <img src="icons/icon-192.png" alt="">
    <h1>NeonWave</h1>
    <p class="lead">Votre musique — en ligne et hors-ligne.</p>
    ${isIOS() ? `<div class="steps">
      <div class="step"><b>1</b><div>Touchez ${icon('share')} <strong>Partager</strong> dans la barre de Safari.</div></div>
      <div class="step"><b>2</b><div>Choisissez <strong>« Sur l'écran d'accueil »</strong>.</div></div>
      <div class="step"><b>3</b><div>Ouvrez NeonWave depuis son icône.</div></div>
    </div>
    <p class="why">Pourquoi ? Installée, l'app s'ouvre en plein écran et ses téléchargements sont conservés durablement. Dans Safari, iOS peut effacer les titres hors-ligne après 7 jours sans visite.</p>`
    : `<p class="why" style="margin:28px 0">Installez l'app depuis le menu de votre navigateur pour l'utiliser en plein écran et hors-ligne.</p>`}
    <button class="pill primary">Continuer</button></div>`);
  w.querySelector('button').onclick = () => w.remove();
  document.body.append(w);
}

addEventListener('offline', () => toast('Hors ligne — titres téléchargés disponibles', 'downloaded'));
addEventListener('online', () => toast('De nouveau en ligne', 'check'));

start();
registerSW();
firstLaunch();
player.restore().catch(() => {});
