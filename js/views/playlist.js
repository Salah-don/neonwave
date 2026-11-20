// Playlist detail: cover, play/shuffle, sort, edit mode (reorder/remove), download, auto-download, export…
import { esc, icon, on, plural, uid } from '../util.js';
import { pageHeader, hydrate, playlistArtHTML, actionMenu, toast, confirmBox, sheet, pickFiles } from '../ui.js';
import * as playlists from '../playlists.js';
import * as downloads from '../downloads.js';
import { sortable, swipeToDelete } from '../gestures.js';
import { trackListHTML, trackRow, bindTrackList, playList, totalDuration, sortMenu } from '../components.js';
import { sortTracks, fmtTotal, SORT_LABELS } from '../lib/sort.js';
import { refresh, go } from '../router.js';
import { openCropper } from './crop.js';

const SORTS = ['custom', 'title', 'artist', 'album', 'addedAt', 'duration'];

export async function playlistView(page, { id }) {
  const p = await playlists.get(id);
  const head = pageHeader(page, { title: p?.name || 'Playlist', large: false });
  if (!p) { page.insertAdjacentHTML('beforeend', '<div class="empty"><h3>Playlist introuvable</h3></div>'); return; }
  let editing = false;
  const all = await playlists.tracksOf(p);
  const tracks = sortTracks(all, p.sort || 'custom', p.sortDir || 'asc');
  const custom = (p.sort || 'custom') === 'custom' && p.sortDir !== 'desc';

  head.querySelector('.nav-right').innerHTML = `<button class="nav-btn text tap" data-edit>Modifier</button><button class="nav-btn tap" data-more aria-label="Plus">${icon('more')}</button>`;

  const body = document.createElement('div');
  body.innerHTML = `<div class="hero"><button class="hero-art tap" data-cover aria-label="Changer l'image">${playlistArtHTML(p, all)}</button>
      <h2>${esc(p.name)}</h2>${p.description ? `<p class="hero-desc">${esc(p.description)}</p>` : ''}
      <div class="hero-meta">${SORT_LABELS[p.sort || 'custom']}${p.autoDownload ? ' · Téléchargement auto' : ''}</div>
      <div class="hero-actions"><button class="pill" data-play ${tracks.length ? '' : 'disabled'}>${icon('play')}Lecture</button><button class="pill" data-shuffle ${tracks.length ? '' : 'disabled'}>${icon('shuffle')}Aléatoire</button></div></div>
    ${tracks.length ? trackListHTML(tracks, { showAlbum: false }) : `<div class="empty">${icon('playlist')}<h3>Playlist vide</h3><p>Touchez « … » sur un titre › Ajouter à une playlist.</p></div>`}
    ${tracks.length ? `<p class="list-foot">${plural(tracks.length, 'titre', 'titres')}, ${fmtTotal(totalDuration(tracks))}</p>` : ''}`;
  page.append(body);
  hydrate(body);
  const io = new IntersectionObserver(([en]) => head.classList.toggle('scrolled', !en.isIntersecting), { rootMargin: '-94px 0px 0px 0px' });
  io.observe(body.querySelector('.hero h2'));

  body.querySelector('[data-play]').onclick = () => playList(tracks, 0, p.name);
  body.querySelector('[data-shuffle]').onclick = () => playList(tracks, -1, p.name, { shuffle: true });
  body.querySelector('[data-cover]').onclick = () => coverMenu(p);

  const list = body.querySelector('.tracks');
  if (list) {
    bindTrackList(list, tracks, { name: p.name, playlistId: p.id, editing: () => editing });
    list.classList.add('swipe-list');
    // In edit mode the page isn't re-rendered, so reload the rows in place after each change.
    const reload = async () => {
      const fresh = await playlists.get(p.id);
      tracks.splice(0, tracks.length, ...sortTracks(await playlists.tracksOf(fresh), fresh.sort || 'custom', fresh.sortDir || 'asc'));
      setEditing(editing);
    };
    swipeToDelete(list, { item: '.track', onDelete: async (row) => { await playlists.removeEntry(p.id, tracks[+row.dataset.i].entryIndex); if (editing) reload(); } });
    sortable(list, { item: '.track', handle: '.handle', onMove: async (from, to) => { await playlists.moveEntry(p.id, tracks[from].entryIndex, tracks[to].entryIndex); reload(); } });
    list.addEventListener('click', async (e) => {
      const del = e.target.closest('.del-btn');
      if (!del) return;
      await playlists.removeEntry(p.id, tracks[+del.closest('.track').dataset.i].entryIndex);
      reload();
    });
  }

  const setEditing = (on_) => {
    editing = on_;
    head.querySelector('[data-edit]').textContent = editing ? 'OK' : 'Modifier';
    if (!list) return;
    list.innerHTML = tracks.map((t, i) => trackRowFor(t, i, editing && custom)).join('');
    hydrate(list);
  };
  head.querySelector('[data-edit]').onclick = () => {
    if (!editing && !custom && tracks.length) toast("Réordonner : passez en « Ordre personnalisé »", 'sort');
    if (editing) { setEditing(false); refresh(); return; }
    setEditing(true);
    if (!tracks.length) editDetails(p);
  };
  head.querySelector('[data-more]').onclick = () => moreMenu(p, all);
  // Avoid re-rendering under the user's finger while editing; own changes re-render on "OK".
  on('playlists', (pid) => { if (pid === p.id && !editing) refresh(); }, page);
  on('library', () => { if (!editing) refresh(); }, page);
}

// Edit-mode rows show remove + drag handles.
const trackRowFor = (t, i, editable) => trackRow(t, i, { editable });

function moreMenu(p, tracks) {
  const s = { key: p.sort || 'custom', dir: p.sortDir || 'asc' };
  actionMenu({
    groups: [
      [
        { label: 'Modifier le nom et la description', icon: 'edit', run: () => editDetails(p) },
        { label: 'Changer l\'image', icon: 'photo', run: () => coverMenu(p) },
        { label: `Trier : ${SORT_LABELS[s.key]}`, icon: 'sort', run: () => sortMenu(`playlist:${p.id}`, s, SORTS, (n) => playlists.update(p.id, { sort: n.key, sortDir: n.dir })) },
      ],
      [
        { label: 'Télécharger la playlist', icon: 'download', run: async () => { const n = await downloads.downloadMany(tracks); toast(n ? `${plural(n, 'titre', 'titres')} en téléchargement` : 'Déjà téléchargée', 'download'); } },
        { label: p.autoDownload ? 'Désactiver le téléchargement auto' : 'Téléchargement auto des nouveaux titres', icon: 'downloaded', checked: p.autoDownload, run: () => playlists.update(p.id, { autoDownload: !p.autoDownload }) },
      ],
      [
        { label: 'Dupliquer', icon: 'copy', run: async () => { const c = await playlists.duplicate(p.id); go(`/playlist/${encodeURIComponent(c.id)}`); } },
        { label: 'Exporter (JSON)', icon: 'share', run: () => exportPlaylists() },
      ],
      [{ label: 'Supprimer la playlist', icon: 'trash', destructive: true, run: async () => {
        if (await confirmBox(`Supprimer « ${p.name} » ?`, 'Les titres restent dans votre bibliothèque.', 'Supprimer', true)) { await playlists.remove(p.id); history.back(); }
      } }],
    ],
  });
}

function editDetails(p) {
  const s = sheet({ title: 'Modifier la playlist', left: '<button data-x>Annuler</button>', right: '<button class="strong" data-ok>OK</button>' });
  s.body.innerHTML = `<div class="group" style="margin-top:8px">
      <label class="field block"><span class="muted" style="font-size:13px">Nom</span><input type="text" maxlength="120" value="${esc(p.name)}" data-name></label>
      <label class="field block"><span class="muted" style="font-size:13px">Description (facultative)</span><textarea rows="3" maxlength="1000" data-desc>${esc(p.description || '')}</textarea></label></div>`;
  s.el.querySelector('[data-x]').onclick = () => s.close();
  s.el.querySelector('[data-ok]').onclick = async () => {
    const name = s.body.querySelector('[data-name]').value.trim();
    if (!name) { toast('Le nom est obligatoire', 'xmark'); return; }
    await playlists.update(p.id, { name, description: s.body.querySelector('[data-desc]').value.trim() });
    s.close();
  };
}

function coverMenu(p) {
  actionMenu({ groups: [[
    { label: 'Choisir une photo', icon: 'photo', run: async () => {
      const [f] = await pickFiles({ accept: 'image/*' });
      if (!f) return;
      const blob = await openCropper(f);
      if (blob) { await playlists.setImage(p.id, blob); toast('Image mise à jour', 'photo'); }
    } },
    p.hasImage && { label: 'Utiliser la mosaïque automatique', icon: 'browse', run: () => playlists.clearImage(p.id) },
  ].filter(Boolean)] });
}

export async function exportPlaylists() {
  const data = await playlists.exportJSON();
  const file = new File([JSON.stringify(data, null, 2)], `neonwave-playlists-${new Date().toISOString().slice(0, 10)}.json`, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Sauvegarde NeonWave' }); return; } catch (e) { if (e?.name === 'AbortError') return; }
  }
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: file.name, id: uid() });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
