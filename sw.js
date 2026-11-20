// NeonWave service worker: offline-first app shell, image cache, and offline audio with HTTP Range (206).
const VERSION = '2026.11.20-1'; // bumped by tools/bump-version.mjs on each deploy
const SHELL_CACHE = `nw-shell-${VERSION}`;
const IMG_CACHE = 'nw-img';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest',
  'css/tokens.css', 'css/base.css', 'css/layout.css', 'css/components.css', 'css/player.css',
  'js/app.js', 'js/util.js', 'js/db.js', 'js/router.js', 'js/ui.js', 'js/gestures.js', 'js/components.js',
  'js/player.js', 'js/queue.js', 'js/library.js', 'js/jamendo.js', 'js/downloads.js', 'js/playlists.js',
  'js/history.js', 'js/lyrics.js', 'js/nowplaying.js', 'js/version.js',
  'js/lib/tags.js', 'js/lib/lrc.js', 'js/lib/sort.js',
  'js/views/home.js', 'js/views/browse.js', 'js/views/library.js', 'js/views/search.js',
  'js/views/album.js', 'js/views/playlist.js', 'js/views/crop.js', 'js/views/settings.js',
  'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('nw-shell-') && k !== SHELL_CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

/* ---------- IndexedDB (same schema as js/db.js) ---------- */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('neonwave', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      const stores = { tracks: { keyPath: 'id' }, blobs: { keyPath: 'id' }, playlists: { keyPath: 'id' }, history: { keyPath: 'id', autoIncrement: true }, lyrics: { keyPath: 'id' }, kv: { keyPath: 'key' } };
      for (const [n, o] of Object.entries(stores)) if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, o);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function getBlob(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction('blobs').objectStore('blobs').get(id);
    r.onsuccess = () => { resolve(r.result?.blob || null); db.close(); };
    r.onerror = () => { reject(r.error); db.close(); };
  });
}

/**
 * Build a Response for `blob` honouring a Range header. Safari requires 206 + Content-Range for <audio>.
 * Exposed on self for tests.
 */
function rangeResponse(blob, rangeHeader) {
  const size = blob.size;
  const type = blob.type || 'audio/mpeg';
  const m = /^bytes=(\d*)-(\d*)$/.exec((rangeHeader || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) {
    return new Response(blob, { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } });
  }
  let start, end;
  if (m[1] === '') { start = Math.max(0, size - Number(m[2])); end = size - 1; } // suffix: last N bytes
  else { start = Number(m[1]); end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  return new Response(blob.slice(start, end + 1, type), {
    status: 206,
    headers: { 'Content-Type': type, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' },
  });
}
self.rangeResponse = rangeResponse;

async function offlineAudio(request, id) {
  const blob = await getBlob(`audio:${id}`);
  if (!blob) return new Response('Not downloaded', { status: 404 });
  return rangeResponse(blob, request.headers.get('range'));
}

async function shell(request) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (res.ok && new URL(request.url).origin === location.origin) cache.put(request, res.clone());
    return res;
  } catch {
    if (request.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
    return Response.error();
  }
}

async function image(request) {
  const cache = await caches.open(IMG_CACHE);
  const hit = await cache.match(request);
  const net = fetch(request).then((res) => { if (res.ok || res.type === 'opaque') cache.put(request, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || Response.error();
}

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === location.origin) {
    const m = url.pathname.match(/\/offline-audio\/([^/]+)$/);
    if (m) { e.respondWith(offlineAudio(request, decodeURIComponent(m[1]))); return; }
    e.respondWith(shell(request));
    return;
  }
  if (request.destination === 'image' || /usercontent\.jamendo\.com|\/image/.test(url.hostname + url.pathname)) {
    e.respondWith(image(request));
  }
  // Everything else (APIs, remote audio streams) goes straight to the network.
});
