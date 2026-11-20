// Jamendo API v3 client. The client_id is entered by the user in Settings (stored in IndexedDB, never in code).
import { getKV, setKV } from './db.js';
import { withLocalState } from './library.js';

const API = 'https://api.jamendo.com/v3.0';
let clientId = null;

export async function getClientId() {
  clientId ??= await getKV('jamendoClientId', '');
  return clientId;
}
export async function setClientId(id) {
  clientId = (id || '').trim();
  await setKV('jamendoClientId', clientId);
}
export const hasClientId = async () => !!(await getClientId());

export const GENRES = [
  ['pop', 'Pop', '#1E40FF', '#00D4FF'], ['rock', 'Rock', '#0B1E5B', '#3B82F6'],
  ['electronic', 'Électro', '#00D4FF', '#7C3AED'], ['hiphop', 'Hip-Hop', '#1D4ED8', '#0EA5E9'],
  ['jazz', 'Jazz', '#0F172A', '#2563EB'], ['indie', 'Indé', '#0369A1', '#22D3EE'],
  ['ambient', 'Ambient', '#082F49', '#38BDF8'], ['classical', 'Classique', '#1E3A8A', '#93C5FD'],
  ['folk', 'Folk', '#0C4A6E', '#06B6D4'], ['lounge', 'Lounge', '#312E81', '#00D4FF'],
  ['metal', 'Metal', '#020617', '#1D4ED8'], ['soundtrack', 'Bandes originales', '#172554', '#60A5FA'],
  ['chillout', 'Chill', '#0E7490', '#67E8F9'], ['reggae', 'Reggae', '#164E63', '#22D3EE'],
  ['world', 'Monde', '#1E3A8A', '#0EA5E9'], ['latin', 'Latino', '#0284C7', '#A5F3FC'],
];

class JamendoError extends Error {}

async function call(endpoint, params = {}) {
  const id = await getClientId();
  if (!id) throw new JamendoError('Ajoutez votre client_id Jamendo dans Réglages.');
  const qs = new URLSearchParams({ client_id: id, format: 'json', ...params });
  let res;
  try {
    res = await fetch(`${API}${endpoint}?${qs}`, { signal: AbortSignal.timeout?.(12000) });
  } catch {
    throw new JamendoError(navigator.onLine ? 'Jamendo ne répond pas.' : 'Hors ligne.');
  }
  if (!res.ok) throw new JamendoError(`Jamendo : erreur ${res.status}`);
  const data = await res.json();
  if (data?.headers?.status !== 'success') throw new JamendoError(data?.headers?.error_message || 'Réponse Jamendo invalide');
  return Array.isArray(data.results) ? data.results : [];
}

const bigArt = (url) => (url ? url.replace(/([?&])width=\d+/, '$1width=600') : '');

/** Map an API track to the app track model (validates the fields we rely on). */
export function mapTrack(j) {
  if (!j || j.id == null || !j.name) return null;
  return {
    id: `j:${j.id}`,
    source: 'jamendo',
    title: String(j.name),
    artist: String(j.artist_name || ''),
    artistId: j.artist_id ? `j:${j.artist_id}` : undefined,
    album: String(j.album_name || ''),
    albumId: j.album_id ? `j:${j.album_id}` : undefined,
    duration: Number(j.duration) || 0,
    artwork: bigArt(j.image || j.album_image || ''),
    audioUrl: typeof j.audio === 'string' ? j.audio : '',
    downloadUrl: j.audiodownload_allowed && typeof j.audiodownload === 'string' ? j.audiodownload : undefined,
    downloadable: !!j.audiodownload_allowed,
    lyrics: typeof j.lyrics === 'string' && j.lyrics.trim() ? j.lyrics : undefined,
    genre: j.musicinfo?.tags?.genres?.[0],
  };
}
const TRACK_PARAMS = { include: 'musicinfo lyrics', audioformat: 'mp32', imagesize: '600' };
const tracks = async (params) => withLocalState((await call('/tracks/', { ...TRACK_PARAMS, ...params })).map(mapTrack).filter(Boolean));

const mapAlbum = (a) => ({ id: `j:${a.id}`, title: a.name, artist: a.artist_name, artistId: `j:${a.artist_id}`, artwork: bigArt(a.image), releaseDate: a.releasedate });
const mapArtist = (a) => ({ id: `j:${a.id}`, name: a.name, artwork: a.image || '' });
const raw = (id) => String(id).replace(/^j:/, '');

export const trending = (limit = 20) => tracks({ order: 'popularity_week', limit });
export const byGenre = (tag, limit = 50) => tracks({ tags: tag, order: 'popularity_month', limit });
export const searchTracks = (q, limit = 20) => tracks({ search: q, limit });
export const albumTracks = (albumId) => tracks({ album_id: raw(albumId), order: 'track_position', limit: 100 });
export const artistTracks = (artistId, limit = 30) => tracks({ artist_id: raw(artistId), order: 'popularity_total', limit });

export async function searchAlbums(q, limit = 10) { return (await call('/albums/', { namesearch: q, limit, imagesize: 600 })).map(mapAlbum); }
export async function searchArtists(q, limit = 10) { return (await call('/artists/', { namesearch: q, limit })).map(mapArtist); }
export async function album(id) { return (await call('/albums/', { id: raw(id), imagesize: 600 })).map(mapAlbum)[0] || null; }
export async function artist(id) { return (await call('/artists/', { id: raw(id) })).map(mapArtist)[0] || null; }
export async function artistAlbums(id) { return (await call('/albums/', { artist_id: raw(id), limit: 30, imagesize: 600, order: 'releasedate_desc' })).map(mapAlbum); }

/** Quick key check used by Settings. */
export async function testClientId() { await call('/tracks/', { limit: 1 }); return true; }
