// Track data layer: library queries, local file import, album/artist grouping.
import * as db from './db.js';
import { emit, uid, shrinkImage } from './util.js';
import { parseTags } from './lib/tags.js';
import { parseLRC } from './lib/lrc.js';
import { compareText } from './lib/sort.js';

const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

export const getTrack = (id) => db.get('tracks', id);

/** Upsert, keeping existing fields (download state, play count…) that `t` doesn't override. */
export async function saveTrack(t) {
  const prev = (await db.get('tracks', t.id)) || {};
  const merged = { addedAt: Date.now(), playCount: 0, downloaded: false, inLibrary: false, ...prev, ...defined(t) };
  await db.put('tracks', merged);
  return merged;
}

export async function libraryTracks({ downloadedOnly = false } = {}) {
  const all = await db.all('tracks');
  return all.filter((t) => (t.inLibrary || t.downloaded) && (!downloadedOnly || t.downloaded));
}

export async function addToLibrary(t) {
  const prev = await db.get('tracks', t.id);
  const saved = await saveTrack({ ...t, inLibrary: true, addedAt: prev?.inLibrary ? prev.addedAt : Date.now() });
  emit('library');
  return saved;
}

export async function removeFromLibrary(id) {
  const t = await db.get('tracks', id);
  if (!t) return;
  await db.del('blobs', `audio:${id}`);
  if (t.source === 'local') {
    await db.del('blobs', `art:${id}`);
    await db.del('tracks', id);
    await db.del('lyrics', id);
    for (const p of await db.all('playlists')) {
      if (p.entries.some((e) => e.id === id)) await db.put('playlists', { ...p, entries: p.entries.filter((e) => e.id !== id) });
    }
  } else {
    await db.put('tracks', { ...t, inLibrary: false, downloaded: false });
  }
  emit('library');
}

/** Merge local state (downloaded, play count…) into fresh API tracks. */
export async function withLocalState(tracks) {
  return Promise.all(tracks.map(async (t) => {
    const local = await db.get('tracks', t.id);
    return local ? { ...t, ...pickLocal(local) } : t;
  }));
}
const pickLocal = (l) => defined({ downloaded: l.downloaded, inLibrary: l.inLibrary, hasArtBlob: l.hasArtBlob, playCount: l.playCount, addedAt: l.addedAt });

/* ---------------- grouping ---------------- */
const keyOf = (s) => (s || '').trim().toLowerCase();
export const localAlbumId = (artist, album) => `l:${keyOf(artist)}|${keyOf(album)}`;
export const localArtistId = (artist) => `l:${keyOf(artist)}`;

export function groupAlbums(tracks) {
  const map = new Map();
  for (const t of tracks) {
    if (!t.album) continue;
    const id = t.albumId || localAlbumId(t.artist, t.album);
    const a = map.get(id) || { id, title: t.album, artist: t.albumArtist || t.artist, tracks: [], addedAt: 0, playCount: 0 };
    a.tracks.push(t);
    a.addedAt = Math.max(a.addedAt, t.addedAt || 0);
    a.playCount += t.playCount || 0;
    map.set(id, a);
  }
  return [...map.values()].map((a) => ({ ...a, cover: a.tracks.find((t) => t.hasArtBlob || t.artwork) }));
}

export function groupArtists(tracks) {
  const map = new Map();
  for (const t of tracks) {
    const id = t.artistId || localArtistId(t.artist);
    const a = map.get(id) || { id, name: t.artist || 'Artiste inconnu', tracks: [], addedAt: 0, playCount: 0 };
    a.tracks.push(t);
    a.addedAt = Math.max(a.addedAt, t.addedAt || 0);
    a.playCount += t.playCount || 0;
    map.set(id, a);
  }
  return [...map.values()].map((a) => ({ ...a, cover: a.tracks.find((t) => t.hasArtBlob || t.artwork) })).sort((x, y) => compareText(x.name, y.name));
}

/* ---------------- local import ---------------- */
const MIME = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/ogg' };
const ext = (name) => (name.split('.').pop() || '').toLowerCase();
const base = (name) => name.replace(/\.[^.]+$/, '').toLowerCase();

function probeDuration(blob) {
  // Metadata-only probe (never played): the single playback <audio> element stays untouched.
  return new Promise((resolve) => {
    const a = document.createElement('audio');
    const url = URL.createObjectURL(blob);
    const done = (d) => { URL.revokeObjectURL(url); a.removeAttribute('src'); resolve(Number.isFinite(d) ? d : 0); };
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(a.duration);
    a.onerror = () => done(0);
    setTimeout(() => done(0), 6000);
    a.src = url;
  });
}

/**
 * Import audio files (+ optional .lrc with the same base name).
 * @returns {Promise<{added:number, skipped:number, failed:string[]}>}
 */
export async function importFiles(files, onProgress = () => {}) {
  const lrcs = new Map();
  for (const f of files) if (ext(f.name) === 'lrc') lrcs.set(base(f.name), f);
  const audio = files.filter((f) => ext(f.name) !== 'lrc' && (f.type.startsWith('audio/') || MIME[ext(f.name)]));
  const existing = await db.all('tracks');
  const result = { added: 0, skipped: 0, failed: [] };
  for (let i = 0; i < audio.length; i++) {
    const f = audio[i];
    onProgress(i, audio.length, f.name);
    try {
      if (existing.some((t) => t.source === 'local' && t.fileName === f.name && t.size === f.size)) { result.skipped++; continue; }
      const buf = await f.arrayBuffer();
      const tags = parseTags(buf, f.name);
      const id = `l:${uid()}`;
      const type = f.type || MIME[ext(f.name)] || 'audio/mpeg';
      await db.putBlob(`audio:${id}`, new Blob([buf], { type }));
      let hasArtBlob = false;
      if (tags.picture) {
        try {
          const art = await shrinkImage(new Blob([tags.picture.data], { type: tags.picture.mime }), 600);
          await db.putBlob(`art:${id}`, art);
          hasArtBlob = true;
        } catch { /* unreadable embedded image: keep the track without artwork */ }
      }
      const duration = tags.duration || (await probeDuration(new Blob([buf], { type })));
      const track = {
        id, source: 'local', title: tags.title, artist: tags.artist, album: tags.album, albumArtist: tags.albumArtist,
        albumId: tags.album ? localAlbumId(tags.albumArtist || tags.artist, tags.album) : undefined,
        artistId: localArtistId(tags.artist), duration, mime: type, size: f.size, fileName: f.name,
        downloaded: true, inLibrary: true, hasArtBlob, addedAt: Date.now(), playCount: 0,
        embeddedLyrics: tags.lyrics, embeddedSynced: tags.syncedLyrics,
      };
      await db.put('tracks', defined(track));
      const lrc = lrcs.get(base(f.name));
      if (lrc) await saveLRC(id, await lrc.text());
      existing.push(track);
      result.added++;
    } catch (e) {
      result.failed.push(`${f.name} (${e?.name === 'QuotaExceededError' ? 'stockage plein' : e?.message || 'erreur'})`);
    }
  }
  onProgress(audio.length, audio.length, '');
  emit('library');
  return result;
}

export async function saveLRC(trackId, text) {
  const lines = parseLRC(text);
  const rec = lines ? { id: trackId, synced: true, lines, source: 'lrc' } : { id: trackId, synced: false, text: text.trim(), source: 'lrc' };
  await db.put('lyrics', rec);
  emit('lyrics', trackId);
}
