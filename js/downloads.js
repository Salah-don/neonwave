// Offline downloads: queue (max 2 at once), streamed progress, retry with byte-range resume.
import * as db from './db.js';
import { emit, sleep } from './util.js';
import { getTrack, saveTrack } from './library.js';
import { toast } from './ui.js';

const MAX_PARALLEL = 2;
const MAX_ATTEMPTS = 4;
const jobs = new Map(); // id -> { track, status: 'queued'|'active'|'waiting'|'failed', progress, attempts, chunks, received }

export const job = (id) => jobs.get(id);
export const activeJobs = () => [...jobs.values()];

export async function download(track) {
  const t = (await getTrack(track.id)) || track;
  if (t.downloaded) return;
  const existing = jobs.get(t.id);
  if (existing && existing.status !== 'failed') return;
  if (t.source === 'jamendo' && !t.downloadable) {
    toast("Téléchargement non autorisé par l'artiste", 'xmark');
    return;
  }
  if (!t.downloadUrl && !t.audioUrl) return;
  jobs.set(t.id, { track: t, status: 'queued', progress: 0, attempts: 0, chunks: [], received: 0 });
  emit('download', { id: t.id });
  pump();
}

export async function downloadMany(tracks) {
  const eligible = tracks.filter((t) => !t.downloaded && (t.source !== 'jamendo' || t.downloadable));
  for (const t of eligible) await download(t);
  return eligible.length;
}

export async function removeDownload(id) {
  const t = await getTrack(id);
  if (!t || t.source === 'local') return;
  await db.del('blobs', `audio:${id}`);
  await saveTrack({ id, downloaded: false });
  emit('library');
}

export function retry(id) {
  const j = jobs.get(id);
  if (j?.status === 'failed') { j.status = 'queued'; j.attempts = 0; emit('download', { id }); pump(); }
}

function pump() {
  let active = [...jobs.values()].filter((j) => j.status === 'active').length;
  for (const j of jobs.values()) {
    if (active >= MAX_PARALLEL) break;
    if (j.status === 'queued') { active++; run(j); }
  }
}

async function run(j) {
  const { track } = j;
  j.status = 'active';
  emit('download', { id: track.id });
  try {
    // Stream URL is the real MP3; `downloadable` still gates whether the artist allows it.
    const src = track.audioUrl || track.downloadUrl;
    let blob;
    try {
      blob = await fetchWithProgress(j.relay ? viaRelay(j.relay, src) : src, j);
    } catch (e) {
      // Jamendo omits CORS on some files: go through the user's relay (Réglages) when one is set.
      const relay = !j.relay && e instanceof TypeError && navigator.onLine && !j.received && (await db.getKV('relayUrl', ''));
      if (!relay) throw e;
      j.relay = relay;
      blob = await fetchWithProgress(viaRelay(relay, src), j);
    }
    await db.putBlob(`audio:${track.id}`, blob);
    const hasArtBlob = await fetchArt(track);
    await saveTrack({ ...track, downloaded: true, inLibrary: true, hasArtBlob: hasArtBlob || track.hasArtBlob, downloadedAt: Date.now(), size: blob.size });
    jobs.delete(track.id);
    emit('download', { id: track.id, done: true });
    emit('library');
  } catch (e) {
    j.attempts++;
    const quota = e?.name === 'QuotaExceededError';
    // Online + TypeError before any byte = the file host refused CORS (Jamendo does this for some tracks): retrying won't help.
    const blocked = e instanceof TypeError && navigator.onLine && !j.received;
    if (blocked) e.message = j.relay ? 'Le relais ne répond pas (vérifiez son adresse dans Réglages)' : 'Jamendo bloque ce titre — activez le relais dans Réglages';
    if (!quota && !blocked && j.attempts < MAX_ATTEMPTS && navigator.onLine) {
      j.status = 'waiting';
      emit('download', { id: track.id });
      await sleep(1000 * 2 ** j.attempts);
      j.status = 'queued';
    } else {
      j.status = 'failed';
      j.error = quota ? 'Stockage plein' : e?.message || 'Erreur réseau';
      toast(`Échec : ${track.title} — ${j.error}`, 'xmark');
    }
    emit('download', { id: track.id });
  } finally {
    pump();
  }
}

const viaRelay = (relay, url) => `${relay.replace(/\/+$/, '')}/?url=${encodeURIComponent(url)}`;

/** Checks a relay URL: it must answer our CORS request with its "OK" text. */
export async function testRelay(relay) {
  const res = await fetch(relay.replace(/\/+$/, '') + '/', { signal: AbortSignal.timeout?.(10000) });
  return res.ok && (await res.text()).includes('NeonWave relay OK');
}

async function fetchWithProgress(url, j) {
  // Resume where the previous attempt stopped when the server honours Range.
  const headers = j.received ? { Range: `bytes=${j.received}-` } : {};
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (j.received && res.status !== 206) { j.chunks = []; j.received = 0; }
  const type = res.headers.get('content-type')?.split(';')[0] || 'audio/mpeg';
  // Never store an HTML/error page as a "song" (Jamendo's audiodownload link returns a web page).
  if (!/^audio\/|^application\/octet-stream$/.test(type)) throw new Error('Le serveur n\'a pas renvoyé de fichier audio');
  const total = Number(res.headers.get('content-length') || 0) + j.received;
  if (!res.body?.getReader) {
    const b = await res.blob();
    return new Blob([...j.chunks, b], { type });
  }
  const reader = res.body.getReader();
  let lastEmit = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    j.chunks.push(value);
    j.received += value.length;
    j.progress = total ? j.received / total : 0;
    if (performance.now() - lastEmit > 150) { lastEmit = performance.now(); emit('download-progress', { id: j.track.id, progress: j.progress }); }
  }
  if (total && j.received < total) throw new Error('Téléchargement interrompu');
  return new Blob(j.chunks, { type: type.startsWith('audio/') ? type : 'audio/mpeg' });
}

async function fetchArt(t) {
  if (t.hasArtBlob || !t.artwork) return !!t.hasArtBlob;
  try {
    const res = await fetch(t.artwork);
    if (!res.ok) throw new Error();
    await db.putBlob(`art:${t.id}`, await res.blob());
    return true;
  } catch {
    // No CORS on the image host: at least keep an opaque copy in the SW image cache for offline <img>.
    try { (await caches.open('nw-img')).put(t.artwork, await fetch(t.artwork, { mode: 'no-cors' })); } catch { /* offline art unavailable */ }
    return false;
  }
}
