// Listening history: a listen counts after 30 s of actual playback.
import * as db from './db.js';
import { emit } from './util.js';
import { getTrack, saveTrack } from './library.js';

export const LISTEN_THRESHOLD = 30;

const slim = ({ id, source, title, artist, album, albumId, artistId, artwork, hasArtBlob, duration, audioUrl, downloadUrl, downloadable }) =>
  ({ id, source, title, artist, album, albumId, artistId, artwork, hasArtBlob, duration, audioUrl, downloadUrl, downloadable });

/** @returns {Promise<number>} history entry id */
export async function recordListen(track, listened) {
  const id = await db.put('history', { trackId: track.id, track: slim(track), at: Date.now(), listened: Math.round(listened) });
  const stored = await getTrack(track.id);
  await saveTrack({ ...slim(track), ...(stored || {}), playCount: (stored?.playCount || 0) + 1 });
  emit('history');
  return id;
}

export async function updateListen(id, listened) {
  const e = await db.get('history', id);
  if (e) await db.put('history', { ...e, listened: Math.round(listened) });
}

export async function getHistory() {
  return (await db.all('history')).sort((a, b) => b.at - a.at);
}

/** Most recent distinct tracks (fresh data from the tracks store when available). */
export async function recentTracks(limit = 20) {
  const seen = new Set();
  const out = [];
  for (const e of await getHistory()) {
    if (seen.has(e.trackId)) continue;
    seen.add(e.trackId);
    out.push((await getTrack(e.trackId)) || e.track);
    if (out.length >= limit) break;
  }
  return out;
}

export async function clearHistory() {
  await db.clear('history');
  emit('history');
}
