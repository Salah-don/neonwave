// Playback engine. ONE <audio> element for the whole session (required for iOS lock-screen playback);
// only its src changes. Media Session, queue persistence and listen history live here.
import { Queue } from './queue.js';
import * as db from './db.js';
import { emit, on, throttle, blobToDataURL, isIOS } from './util.js';
import { getTrack } from './library.js';
import { recordListen, updateListen, LISTEN_THRESHOLD } from './history.js';
import { toast } from './ui.js';

export const audio = document.getElementById('audio');
export const queue = new Queue();
const ms = 'mediaSession' in navigator ? navigator.mediaSession : null;

let currentUrl = null;      // object URL owned by the audio element
let prepared = null;        // { id, url, revoke } — next track resolved ahead so `ended` can switch synchronously
let prepareToken = 0;
let loadToken = 0;

export const current = () => queue.current;
export const isPlaying = () => !audio.paused && !audio.ended;

/* ---------------- source resolution ---------------- */
async function resolveSrc(track) {
  const t = (await getTrack(track.id)) || track;
  if (t.downloaded) {
    const viaSW = (await db.getKV('audioPath', 'blob')) === 'sw' && navigator.serviceWorker?.controller;
    if (viaSW) return { id: t.id, url: `offline-audio/${encodeURIComponent(t.id)}`, revoke: false };
    const blob = await db.getBlob(`audio:${t.id}`);
    if (blob) return { id: t.id, url: URL.createObjectURL(blob), revoke: true };
  }
  if (t.audioUrl && navigator.onLine) return { id: t.id, url: t.audioUrl, revoke: false };
  throw new Error(t.audioUrl ? 'Hors ligne : titre non téléchargé' : 'Fichier introuvable');
}

function dropPrepared() {
  if (prepared?.revoke) URL.revokeObjectURL(prepared.url);
  prepared = null;
}

async function prepareNext() {
  const token = ++prepareToken;
  const n = queue.peekNext();
  if (!n || n.id === queue.current?.id) { dropPrepared(); return; }
  if (prepared?.id === n.id) return;
  dropPrepared();
  try {
    const src = await resolveSrc(n);
    if (token !== prepareToken) { if (src.revoke) URL.revokeObjectURL(src.url); return; }
    prepared = src;
  } catch { /* resolved again at play time */ }
}

/* ---------------- loading ---------------- */
async function load(track, { autoplay = true, position = 0 } = {}) {
  const token = ++loadToken;
  finalizeListen();
  let src = prepared?.id === track.id ? prepared : null;
  if (src) prepared = null;
  if (!src) {
    try { src = await resolveSrc(track); } catch (e) {
      if (token !== loadToken) return false;
      toast(e.message, 'xmark');
      emit('track', queue.current);
      return false;
    }
  }
  if (token !== loadToken) { if (src.revoke) URL.revokeObjectURL(src.url); return false; }
  const old = currentUrl;
  currentUrl = src.revoke ? src.url : null;
  audio.src = src.url;
  if (old) URL.revokeObjectURL(old);
  if (position > 0) audio.addEventListener('loadedmetadata', () => { audio.currentTime = position; }, { once: true });
  lastTime = position;
  listened = 0;
  listenTrack = track;
  emit('track', track);
  updateMetadata(track);
  persist();
  if (autoplay) await playSafe();
  prepareNext();
  return true;
}

async function playSafe() {
  try { await audio.play(); } catch (e) {
    if (e?.name === 'NotSupportedError') toast('Format audio non pris en charge', 'xmark');
    // NotAllowedError (no user gesture yet) / AbortError (src changed) are expected — stay paused.
  }
}

/* ---------------- public controls ---------------- */
export async function playTracks(tracks, index = 0, name = '', opts) {
  if (!tracks.length) return;
  const t = queue.playContext(tracks, index, name, opts);
  emit('queue');
  if (t) await load(t);
}
export const shufflePlay = (tracks, name) => playTracks(tracks, -1, name, { shuffle: true });

export function toggle() {
  if (!queue.current) return;
  if (audio.paused) {
    if (!audio.src) load(queue.current); else playSafe();
  } else audio.pause();
}
export const play = () => (audio.src ? playSafe() : queue.current && load(queue.current));
export const pause = () => audio.pause();

export async function next() {
  const t = queue.next();
  emit('queue');
  if (t) await load(t, { autoplay: true });
  else { audio.pause(); audio.currentTime = 0; }
}

export async function prev() {
  if (audio.currentTime > 3) { seek(0); return; }
  const t = queue.prev();
  emit('queue');
  if (t) await load(t); else seek(0);
}

export function seek(s) {
  if (!Number.isFinite(s)) return;
  const d = audio.duration;
  audio.currentTime = Math.max(0, Number.isFinite(d) ? Math.min(s, d - 0.25) : s);
  lastTime = audio.currentTime;
  updatePosition();
}

function afterQueueChange() { emit('queue'); persist(); prepareNext(); }

export function playNext(tracks) {
  const list = [].concat(tracks);
  if (!queue.current) return playTracks(list, 0);
  queue.playNext(...list);
  afterQueueChange();
}
export function addToQueue(tracks) {
  const list = [].concat(tracks);
  if (!queue.current) return playTracks(list, 0);
  queue.addToQueue(...list);
  afterQueueChange();
}
export function queueOp(fn) { fn(queue); afterQueueChange(); }
export async function jump(kind, i) {
  const t = kind === 'upNext' ? queue.jumpToUpNext(i) : queue.jumpToSource(i);
  emit('queue');
  if (t) await load(t);
}
export function setShuffle(on) { queue.setShuffle(on); afterQueueChange(); }
export function cycleRepeat() { queue.cycleRepeat(); afterQueueChange(); }
export function setVolume(v) { audio.volume = Math.max(0, Math.min(1, v)); }

/** iOS ignores audio.volume (hardware buttons only) — hide the slider there. */
export const volumeSupported = (() => {
  const prev = audio.volume;
  try { audio.volume = 0.5; return audio.volume === 0.5; } finally { audio.volume = prev; }
})();

/* ---------------- listen history ---------------- */
let lastTime = 0, listened = 0, listenTrack = null, histId = null;
function trackListen() {
  const t = audio.currentTime;
  const dt = t - lastTime;
  lastTime = t;
  if (audio.paused || dt <= 0 || dt > 3 || !listenTrack) return;
  listened += dt;
  if (listened >= LISTEN_THRESHOLD && histId === null) {
    histId = 'pending';
    const trackAtStart = listenTrack;
    recordListen(trackAtStart, listened).then((id) => { if (listenTrack === trackAtStart) histId = id; else updateListen(id, listened); });
  }
}
function finalizeListen() {
  if (typeof histId === 'number') updateListen(histId, listened);
  histId = null;
}

/* ---------------- media session ---------------- */
let artToken = 0;
async function artworkFor(t) {
  const fresh = (await getTrack(t.id)) || t;
  if (fresh.hasArtBlob) {
    const b = await db.getBlob(`art:${t.id}`);
    // data: URL rather than blob: — more reliable for the iOS lock screen, and our art is ≤ 600 px.
    if (b) return { src: await blobToDataURL(b), type: b.type || 'image/jpeg' };
  }
  if (fresh.artwork) return { src: fresh.artwork, type: 'image/jpeg' };
  return null;
}

async function updateMetadata(t) {
  if (!ms || !t) return;
  const token = ++artToken;
  const base = { title: t.title || '', artist: t.artist || '', album: t.album || '' };
  ms.metadata = new MediaMetadata(base);
  const art = await artworkFor(t).catch(() => null);
  if (token !== artToken || !art) return;
  ms.metadata = new MediaMetadata({ ...base, artwork: [96, 128, 192, 256, 384, 512].map((s) => ({ src: art.src, sizes: `${s}x${s}`, type: art.type })) });
}

function updatePosition() {
  if (!ms?.setPositionState) return;
  const d = audio.duration;
  if (!Number.isFinite(d) || d <= 0) return;
  try { ms.setPositionState({ duration: d, position: Math.min(Math.max(0, audio.currentTime), d), playbackRate: audio.playbackRate || 1 }); } catch { /* invalid state during src switch */ }
}

function setupMediaSession() {
  if (!ms) return;
  const handlers = {
    play: () => play(),
    pause: () => pause(),
    stop: () => { audio.pause(); seek(0); },
    previoustrack: () => prev(),
    nexttrack: () => next(),
    seekto: (d) => { if (d.fastSeek && 'fastSeek' in audio) audio.fastSeek(d.seekTime); else seek(d.seekTime); },
  };
  // On iOS, registering seekbackward/seekforward replaces the lock-screen ⏮/⏭ buttons with ±10 s,
  // which would break "next track" from the lock screen — so they are only registered elsewhere.
  if (!isIOS()) {
    handlers.seekbackward = (d) => seek(audio.currentTime - (d.seekOffset || 10));
    handlers.seekforward = (d) => seek(audio.currentTime + (d.seekOffset || 10));
  }
  for (const [action, fn] of Object.entries(handlers)) {
    try { ms.setActionHandler(action, fn); } catch { /* action unsupported by this browser */ }
  }
}

/* ---------------- persistence ---------------- */
const persist = throttle(() => {
  db.setKV('queue', { ...queue.toJSON(), position: audio.currentTime || 0 }).catch(() => {});
}, 1500);
const persistNow = () => db.setKV('queue', { ...queue.toJSON(), position: audio.currentTime || 0 }).catch(() => {});

export async function restore() {
  const s = await db.getKV('queue', null);
  if (!s?.current) return;
  Object.assign(queue, new Queue(s));
  emit('queue');
  await load(queue.current, { autoplay: false, position: s.position || 0 });
}

/* ---------------- audio events ---------------- */
const posThrottled = throttle(updatePosition, 1000);
audio.addEventListener('play', () => { if (ms) ms.playbackState = 'playing'; emit('state'); updatePosition(); });
audio.addEventListener('pause', () => { if (ms) ms.playbackState = 'paused'; emit('state'); updatePosition(); persistNow(); });
audio.addEventListener('timeupdate', () => { trackListen(); emit('time'); posThrottled(); persist(); });
audio.addEventListener('durationchange', () => { updatePosition(); emit('time'); });
audio.addEventListener('seeked', () => { lastTime = audio.currentTime; updatePosition(); });
audio.addEventListener('ended', () => {
  if (queue.repeat === 'one') { audio.currentTime = 0; playSafe(); return; }
  next();
});
audio.addEventListener('error', () => {
  if (!audio.src) return;
  toast('Lecture impossible', 'xmark');
  emit('state');
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persistNow(); });
addEventListener('pagehide', persistNow);

// Keep queue copies in sync when a track's state changes (download finished, etc.)
on('library', async () => {
  const near = [queue.current, ...queue.upNext, ...queue.source.slice(0, 20)].filter(Boolean);
  for (const id of new Set(near.map((t) => t.id))) {
    const t = await getTrack(id);
    if (t) queue.updateTrack(t);
  }
  dropPrepared(); // re-resolve: a download may have changed the best source
  prepareNext();
});

setupMediaSession();
