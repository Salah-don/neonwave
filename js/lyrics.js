// Lyrics resolution — priority: 1) embedded tags (SYLT/USLT), 2) user .lrc, 3) Jamendo, 4) LRCLIB.
// Result: { synced:true, lines:[{time,text}], source } | { synced:false, text, source } | null
import * as db from './db.js';
import { getTrack } from './library.js';
import { parseLRC } from './lib/lrc.js';

const fromText = (text, source) => {
  const lines = parseLRC(text);
  return lines ? { synced: true, lines, source } : { synced: false, text: text.trim(), source };
};

export async function getLyrics(track) {
  const t = (await getTrack(track.id)) || track;
  if (t.embeddedSynced?.length) return { synced: true, lines: t.embeddedSynced, source: 'Fichier audio' };
  if (t.embeddedLyrics) return fromText(t.embeddedLyrics, 'Fichier audio');
  const cached = await db.get('lyrics', t.id);
  if (cached?.source === 'lrc') return { ...cached, source: 'Fichier .lrc' };
  if (t.lyrics) return fromText(t.lyrics, 'Jamendo');
  if (cached) return cached;
  if (!navigator.onLine) return null;
  try {
    const found = await lrclib(t);
    if (found) await db.put('lyrics', { id: t.id, ...found });
    return found;
  } catch {
    return null; // network/API failure: show "no lyrics" rather than an error
  }
}

async function lrclib(t) {
  if (!t.title) return null;
  const p = new URLSearchParams({ artist_name: t.artist || '', track_name: t.title });
  if (t.album) p.set('album_name', t.album);
  if (t.duration) p.set('duration', String(Math.round(t.duration)));
  let res = await fetch(`https://lrclib.net/api/get?${p}`, { signal: AbortSignal.timeout?.(10000) });
  let j = null;
  if (res.ok) j = await res.json();
  else if (res.status === 404) {
    res = await fetch(`https://lrclib.net/api/search?${new URLSearchParams({ track_name: t.title, artist_name: t.artist || '' })}`, { signal: AbortSignal.timeout?.(10000) });
    const list = res.ok ? await res.json() : [];
    j = Array.isArray(list) ? list.find((x) => x.syncedLyrics) || list.find((x) => x.plainLyrics) : null;
  }
  if (!j || j.instrumental) return null;
  if (typeof j.syncedLyrics === 'string' && j.syncedLyrics) {
    const lines = parseLRC(j.syncedLyrics);
    if (lines) return { synced: true, lines, source: 'LRCLIB' };
  }
  if (typeof j.plainLyrics === 'string' && j.plainLyrics.trim()) return { synced: false, text: j.plainLyrics.trim(), source: 'LRCLIB' };
  return null;
}
