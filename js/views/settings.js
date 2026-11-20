// Réglages: Jamendo client_id, storage, offline audio path, backups, maintenance.
import { esc, fmtBytes, icon } from '../util.js';
import { pageHeader, toast, confirmBox } from '../ui.js';
import * as db from '../db.js';
import * as jamendo from '../jamendo.js';
import { clearHistory } from '../history.js';
import { testRelay } from '../downloads.js';
import { exportPlaylists } from './playlist.js';
import { importBackupFlow, importFlow } from './library.js';
import { refresh } from '../router.js';
import { APP_VERSION } from '../version.js';

export async function settings(page) {
  pageHeader(page, { title: 'Réglages', showBack: true });
  const [clientId, relayUrl, audioPath, est, persisted] = await Promise.all([
    jamendo.getClientId(), db.getKV('relayUrl', ''), db.getKV('audioPath', 'blob'),
    navigator.storage?.estimate?.().catch(() => null), navigator.storage?.persisted?.().catch(() => false),
  ]);
  const used = est?.usage || 0, quota = est?.quota || 0;
  const tracks = await db.all('tracks');
  const nDl = tracks.filter((t) => t.downloaded).length;

  page.insertAdjacentHTML('beforeend', `
    <h3 class="group-h">Jamendo</h3>
    <div class="group">
      <label class="field"><span>Client ID</span><input type="text" data-cid value="${esc(clientId)}" placeholder="ex. a1b2c3d4" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <div class="field"><button class="link" data-test>Enregistrer et tester</button></div>
    </div>
    <p class="group-f">Gratuit sur devportal.jamendo.com → « Create an app ». Stocké uniquement sur cet appareil.</p>
    <div class="group">
      <label class="field"><span>Relais</span><input type="text" data-relay value="${esc(relayUrl)}" placeholder="https://….workers.dev" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="url"></label>
      <div class="field"><button class="link" data-relay-test>Enregistrer et tester le relais</button></div>
    </div>
    <p class="group-f">Facultatif. Permet de télécharger les titres Jamendo que leur serveur bloque (voir le README, « Relais Cloudflare »).</p>

    <h3 class="group-h">Stockage</h3>
    <div class="group">
      <div class="field"><span>Utilisé</span><span class="val">${fmtBytes(used)}${quota ? ` sur ${fmtBytes(quota)}` : ''}</span></div>
      ${quota ? `<div class="meter"><div style="width:${Math.min(100, (used / quota) * 100).toFixed(1)}%"></div></div>` : ''}
      <div class="field"><span>Titres téléchargés</span><span class="val">${nDl}</span></div>
      <div class="field"><span>Stockage persistant</span><span class="val">${persisted ? 'Activé' : 'Non accordé'}</span></div>
      ${persisted ? '' : '<div class="field"><button class="link" data-persist>Demander le stockage persistant</button></div>'}
    </div>
    <p class="group-f">Sur iPhone, installez l'app sur l'écran d'accueil : sinon Safari peut effacer les téléchargements après 7 jours sans visite.</p>

    <h3 class="group-h">Lecture hors-ligne</h3>
    <div class="group">
      <label class="field"><span>Via le service worker (Range 206)</span><span class="switch"><input type="checkbox" data-sw ${audioPath === 'sw' ? 'checked' : ''}><i></i></span></label>
    </div>
    <p class="group-f">Désactivé : lecture directe du fichier (Blob URL), recommandé sur iPhone. Activez si un titre téléchargé refuse de se lire.</p>

    <h3 class="group-h">Bibliothèque</h3>
    <div class="group">
      <button class="field" data-import style="width:100%"><span style="text-align:left">Importer des fichiers audio</span>${icon('import', 'ic-sm accent')}</button>
      <button class="field" data-export style="width:100%"><span style="text-align:left">Exporter les playlists (JSON)</span>${icon('share', 'ic-sm accent')}</button>
      <button class="field" data-restore style="width:100%"><span style="text-align:left">Importer une sauvegarde</span>${icon('import', 'ic-sm accent')}</button>
    </div>
    <div class="group">
      <button class="field danger" data-clear-history style="width:100%">Effacer l'historique</button>
      <button class="field danger" data-clear-dl style="width:100%">Supprimer tous les téléchargements Jamendo</button>
    </div>
    <p class="group-f">NeonWave ${esc(APP_VERSION)} · Musique : Jamendo (licences Creative Commons) et vos fichiers · Paroles : LRCLIB.</p>`);

  const cid = page.querySelector('[data-cid]');
  page.querySelector('[data-test]').onclick = async () => {
    await jamendo.setClientId(cid.value);
    if (!cid.value.trim()) { toast('Client ID effacé'); return; }
    try { await jamendo.testClientId(); toast('Jamendo connecté'); } catch (e) { toast(e.message, 'xmark'); }
  };
  page.querySelector('[data-relay-test]').onclick = async () => {
    const v = page.querySelector('[data-relay]').value.trim();
    if (!v) { await db.setKV('relayUrl', ''); toast('Relais désactivé'); return; }
    if (!/^https:\/\/[^\s/?#]+\/?$/.test(v)) { toast('Adresse invalide (ex. https://neonwave-relay.xxx.workers.dev)', 'xmark'); return; }
    try {
      if (!(await testRelay(v))) throw new Error();
      await db.setKV('relayUrl', v);
      toast('Relais connecté');
    } catch {
      toast('Le relais ne répond pas — vérifiez l\'adresse et le code du Worker', 'xmark');
    }
  };
  page.querySelector('[data-persist]')?.addEventListener('click', async () => {
    const ok = await navigator.storage?.persist?.();
    toast(ok ? 'Stockage persistant activé' : "Refusé — installez l'app sur l'écran d'accueil", ok ? 'check' : 'xmark');
    refresh();
  });
  page.querySelector('[data-sw]').onchange = (e) => db.setKV('audioPath', e.target.checked ? 'sw' : 'blob');
  page.querySelector('[data-import]').onclick = importFlow;
  page.querySelector('[data-export]').onclick = exportPlaylists;
  page.querySelector('[data-restore]').onclick = importBackupFlow;
  page.querySelector('[data-clear-history]').onclick = async () => {
    if (await confirmBox("Effacer l'historique ?", '', 'Effacer', true)) { await clearHistory(); toast('Historique effacé'); }
  };
  page.querySelector('[data-clear-dl]').onclick = async () => {
    if (!(await confirmBox('Supprimer les téléchargements ?', 'Les titres Jamendo téléchargés ne seront plus disponibles hors ligne. Vos fichiers importés sont conservés.', 'Supprimer', true))) return;
    for (const t of await db.all('tracks')) {
      if (t.source === 'jamendo' && t.downloaded) { await db.del('blobs', `audio:${t.id}`); await db.put('tracks', { ...t, downloaded: false }); }
    }
    toast('Téléchargements supprimés');
    refresh();
  };
}
