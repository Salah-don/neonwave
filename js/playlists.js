// Custom playlists: CRUD, ordering, cover image, JSON export/import.
import * as db from './db.js';
import { emit, uid, blobToDataURL } from './util.js';
import { addToLibrary, getTrack, saveTrack } from './library.js';
import { downloadMany } from './downloads.js';
import { forgetBlobUrl } from './ui.js';

const now = () => Date.now();
const MAX_NAME = 120, MAX_DESC = 1000;

export async function list() {
  return (await db.all('playlists')).sort((a, b) => b.updatedAt - a.updatedAt);
}
export const get = (id) => db.get('playlists', id);

async function save(p) {
  await db.put('playlists', p);
  emit('playlists', p.id);
  return p;
}

export function create({ name, description = '' }) {
  const t = now();
  return save({
    id: `p:${uid()}`, name: String(name).slice(0, MAX_NAME) || 'Nouvelle playlist', description: String(description).slice(0, MAX_DESC),
    entries: [], createdAt: t, updatedAt: t, sort: 'custom', sortDir: 'asc', autoDownload: false, hasImage: false,
  });
}

export async function update(id, patch) {
  const p = await get(id);
  if (!p) throw new Error('Playlist introuvable');
  const next = { ...p, ...patch, updatedAt: now() };
  if (patch.name !== undefined) next.name = String(patch.name).slice(0, MAX_NAME) || p.name;
  if (patch.description !== undefined) next.description = String(patch.description).slice(0, MAX_DESC);
  return save(next);
}

export async function remove(id) {
  await db.del('playlists', id);
  await db.del('blobs', `pimg:${id}`);
  forgetBlobUrl(`pimg:${id}`);
  emit('playlists', id);
}

export async function duplicate(id) {
  const p = await get(id);
  const copy = { ...p, id: `p:${uid()}`, name: `${p.name} (copie)`, createdAt: now(), updatedAt: now(), entries: [...p.entries] };
  if (p.hasImage) {
    const b = await db.getBlob(`pimg:${id}`);
    if (b) await db.putBlob(`pimg:${copy.id}`, b); else copy.hasImage = false;
  }
  return save(copy);
}

/** @returns {Promise<{added:number, duplicates:number}>} */
export async function addTracks(id, tracks) {
  const p = await get(id);
  const have = new Set(p.entries.map((e) => e.id));
  const fresh = [];
  for (const t of tracks) {
    if (have.has(t.id)) continue;
    have.add(t.id);
    fresh.push(await addToLibrary(t));
  }
  await save({ ...p, entries: [...p.entries, ...fresh.map((t) => ({ id: t.id, addedAt: now() }))], updatedAt: now() });
  if (p.autoDownload && fresh.length) downloadMany(fresh);
  return { added: fresh.length, duplicates: tracks.length - fresh.length };
}

export async function removeEntry(id, index) {
  const p = await get(id);
  return save({ ...p, entries: p.entries.filter((_, i) => i !== index), updatedAt: now() });
}

export async function moveEntry(id, from, to) {
  const p = await get(id);
  const entries = [...p.entries];
  const [e] = entries.splice(from, 1);
  entries.splice(to, 0, e);
  return save({ ...p, entries, updatedAt: now() });
}

export async function setImage(id, blob) {
  await db.putBlob(`pimg:${id}`, blob);
  forgetBlobUrl(`pimg:${id}`);
  return update(id, { hasImage: true });
}
export async function clearImage(id) {
  await db.del('blobs', `pimg:${id}`);
  forgetBlobUrl(`pimg:${id}`);
  return update(id, { hasImage: false });
}

/** Tracks of a playlist, each carrying the entry's addedAt and its index in `entries`. */
export async function tracksOf(p) {
  const ts = await Promise.all(p.entries.map((e) => getTrack(e.id)));
  return ts.map((t, i) => (t ? { ...t, addedAt: p.entries[i].addedAt, entryIndex: i } : null)).filter(Boolean);
}

/* ---------------- backup ---------------- */
const TRACK_FIELDS = ['id', 'source', 'title', 'artist', 'artistId', 'album', 'albumId', 'duration', 'artwork', 'audioUrl', 'downloadUrl', 'downloadable', 'lyrics'];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

export async function exportJSON() {
  const ps = await db.all('playlists');
  const ids = new Set(ps.flatMap((p) => p.entries.map((e) => e.id)));
  const tracks = (await Promise.all([...ids].map(getTrack))).filter(Boolean).map((t) => pick(t, TRACK_FIELDS));
  const playlists = await Promise.all(ps.map(async (p) => {
    const b = p.hasImage ? await db.getBlob(`pimg:${p.id}`) : null;
    return { ...pick(p, ['id', 'name', 'description', 'entries', 'createdAt', 'sort', 'sortDir', 'autoDownload']), image: b ? await blobToDataURL(b) : null };
  }));
  return { app: 'NeonWave', version: 1, exportedAt: new Date().toISOString(), playlists, tracks };
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Import a backup. Untrusted input: every field is validated. Local-file tracks absent here are skipped. */
export async function importJSON(data) {
  if (!data || data.app !== 'NeonWave' || !Array.isArray(data.playlists)) throw new Error('Fichier de sauvegarde NeonWave invalide');
  const known = new Set();
  for (const raw of Array.isArray(data.tracks) ? data.tracks : []) {
    if (!raw || typeof raw.id !== 'string' || !/^[jl]:/.test(raw.id) || typeof raw.title !== 'string') continue;
    const existing = await getTrack(raw.id);
    if (existing) { known.add(raw.id); continue; }
    if (raw.source !== 'jamendo') continue; // local audio isn't in the backup
    const safeUrl = (u) => (typeof u === 'string' && /^https:\/\//.test(u) ? u : undefined);
    await saveTrack({
      id: raw.id, source: 'jamendo', title: str(raw.title, 300), artist: str(raw.artist, 300), album: str(raw.album, 300),
      artistId: str(raw.artistId, 50) || undefined, albumId: str(raw.albumId, 50) || undefined,
      duration: Number(raw.duration) || 0, artwork: safeUrl(raw.artwork), audioUrl: safeUrl(raw.audioUrl),
      downloadUrl: safeUrl(raw.downloadUrl), downloadable: !!raw.downloadable, lyrics: str(raw.lyrics, 20000) || undefined,
      inLibrary: true,
    });
    known.add(raw.id);
  }
  let count = 0;
  for (const raw of data.playlists) {
    if (!raw || typeof raw.name !== 'string') continue;
    const entries = (Array.isArray(raw.entries) ? raw.entries : [])
      .filter((e) => e && typeof e.id === 'string' && known.has(e.id))
      .map((e) => ({ id: e.id, addedAt: Number(e.addedAt) || now() }));
    const p = await create({ name: str(raw.name, MAX_NAME), description: str(raw.description, MAX_DESC) });
    let hasImage = false;
    if (typeof raw.image === 'string' && /^data:image\/(png|jpe?g|webp);base64,/.test(raw.image) && raw.image.length < 4_000_000) {
      try { await db.putBlob(`pimg:${p.id}`, await (await fetch(raw.image)).blob()); hasImage = true; } catch { /* ignore bad image */ }
    }
    await save({ ...p, entries, hasImage, sort: str(raw.sort, 20) || 'custom', sortDir: raw.sortDir === 'desc' ? 'desc' : 'asc', autoDownload: !!raw.autoDownload });
    count++;
  }
  emit('library');
  return count;
}
