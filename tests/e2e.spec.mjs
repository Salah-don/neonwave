// End-to-end flows in WebKit with iPhone 15 Pro emulation. Jamendo + LRCLIB are mocked; audio is generated WAV.
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { makeWav, buildID3 } from './fixtures.mjs';

const TMP = new URL('./tmp/', import.meta.url);
const SHOTS = new URL('./screens/', import.meta.url);
mkdirSync(TMP, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
for (const i of [1, 2, 3]) writeFileSync(new URL(`j${i}.wav`, TMP), makeWav({ seconds: 90, freq: 300 + i * 100 }));
const LOCAL_WAV = makeWav({
  seconds: 40,
  id3: buildID3({ title: 'Local Neon', artist: 'Test Artist', album: 'Imported', lyrics: '[00:00.00]Première ligne\n[00:02.00]Deuxième ligne\n[00:04.00]Troisième ligne' }),
});
const PHOTO = readFileSync(new URL('../icons/icon-512.png', import.meta.url));

const BASE = 'http://localhost:4173';
const jTrack = (i, extra = {}) => ({
  id: String(100 + i), name: `Jam Track ${i}`, artist_name: 'Jam Artist', artist_id: '77', album_name: 'Jam Album', album_id: '55',
  duration: 6, image: `${BASE}/icons/icon-192.png?width=300`, audio: `${BASE}/tests/tmp/j${i}.wav`,
  audiodownload: `${BASE}/tests/tmp/j${i}.wav`, audiodownload_allowed: true, ...extra,
});
const TRACKS = [jTrack(1), jTrack(2), jTrack(3, { lyrics: 'Paroles Jamendo\nligne deux' })];

async function mockNet(page) {
  await page.route('https://api.jamendo.com/**', (route) => {
    const u = new URL(route.request().url());
    const ok = (results) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ headers: { status: 'success' }, results }) });
    if (u.pathname.includes('/albums')) return ok([{ id: '55', name: 'Jam Album', artist_name: 'Jam Artist', artist_id: '77', image: `${BASE}/icons/icon-192.png`, releasedate: '2024-01-01' }]);
    if (u.pathname.includes('/artists')) return ok([{ id: '77', name: 'Jam Artist', image: '' }]);
    return ok(TRACKS);
  });
  await page.route('https://lrclib.net/**', (route) => route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: '[]' }));
}

let errors = [];
async function boot(page, { jamendo = true } = {}) {
  errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await mockNet(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Continuer' }).click();
  if (jamendo) {
    await page.goto('/#/settings');
    await page.locator('[data-cid]').fill('test-client-id');
    await page.getByRole('button', { name: 'Enregistrer et tester' }).click();
    await expect(page.locator('.toast')).toContainText('Jamendo connecté');
  }
}
// WinCairo (Playwright WebKit on Windows) refuses blob: and SW-served media; real iOS Safari plays both.
const localMediaOK = (browserName) => !(browserName === 'webkit' && process.platform === 'win32');

/** Second load: the service worker now controls the page (needed for the offline-audio path). */
async function controlled(page) {
  await page.goto('/');
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
}
const shot = (page, name) => page.screenshot({ path: new URL(`${test.info().project.name}-${name}.png`, SHOTS).pathname.replace(/^\/(\w:)/, '$1') });
const menuItem = (page, name) => page.locator('.menu-item', { hasText: name });

async function importLocal(page) {
  await page.goto('/#/library');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-add]').click();
  await menuItem(page, 'Importer des fichiers audio').click();
  await (await chooser).setFiles([{ name: 'Test Artist - Local Neon.wav', mimeType: 'audio/wav', buffer: LOCAL_WAV }]);
  await expect(page.locator('.toast')).toContainText('1 titre importé', { timeout: 15000 });
}

test('service worker registers and tabs navigate', async ({ page }) => {
  await boot(page);
  const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; });
  expect(sw).toBe(true);
  for (const [tab, title] of [['home', 'Écouter'], ['browse', 'Parcourir'], ['library', 'Bibliothèque'], ['search', 'Rechercher']]) {
    await page.locator(`#tabbar [data-tab=${tab}]`).click();
    await expect(page.locator('.large-title')).toHaveText(title);
    await expect(page.locator(`#tabbar [data-tab=${tab}]`)).toHaveClass(/active/);
    await page.waitForTimeout(400);
    await shot(page, `tab-${tab}`);
  }
  await page.locator('#tabbar [data-tab=browse]').click();
  await page.locator('.tile', { hasText: 'Rock' }).click();
  await expect(page.locator('.track').first()).toContainText('Jam Track 1');
  await page.locator('.nav-back').click();
  await expect(page.locator('.large-title')).toHaveText('Parcourir');
  expect(errors).toEqual([]);
});

test('play from Jamendo, queue: play next / add to queue, full player', async ({ page }) => {
  await boot(page);
  await page.goto('/#/genre/pop');
  await page.locator('.track').first().click();
  await expect(page.locator('#mini .mini-title')).toHaveText('Jam Track 1');
  await expect.poll(() => page.evaluate(() => !document.getElementById('audio').paused)).toBe(true);
  // "Lire ensuite" on track 3, "Ajouter à la file" on track 2
  await page.locator('.track').nth(2).locator('.more').click();
  await menuItem(page, 'Lire ensuite').click();
  await page.locator('.track').nth(1).locator('.more').click();
  await menuItem(page, "Ajouter à la file d'attente").click();
  await page.locator('#mini .mini-hit').click();
  await expect(page.locator('#np')).toHaveClass(/open/);
  await page.waitForTimeout(700);
  await shot(page, 'player');
  await page.locator('.b-queue').click();
  const up = page.locator('.q-up .track .t');
  await expect(up).toHaveText(['Jam Track 3', 'Jam Track 2']);
  await shot(page, 'queue');
  await page.locator('.c-next').click();
  await expect(page.locator('.np-compact .t')).toHaveText('Jam Track 3');
  // media session metadata follows the current track (Playwright's Windows WebKit has no Media Session)
  const ms = await page.evaluate(() => ('mediaSession' in navigator ? navigator.mediaSession.metadata?.title : 'unsupported'));
  expect(['Jam Track 3', 'unsupported']).toContain(ms);
  await page.locator('.b-lyrics').click();
  await expect(page.locator('.np-lyrics')).toContainText('Paroles Jamendo');
  await shot(page, 'lyrics-plain');
  expect(errors).toEqual([]);
});

test('import local file: tags, synced lyrics, history after 30 s', async ({ page, browserName }) => {
  await boot(page, { jamendo: false });
  await controlled(page);
  await importLocal(page);
  await page.goto('/#/library/songs');
  await expect(page.locator('.track .t')).toHaveText(['Local Neon']);
  await page.locator('.track').first().click();
  await expect(page.locator('#mini .mini-title')).toHaveText('Local Neon');
  await page.evaluate(() => { document.getElementById('audio').playbackRate = 8; });
  await page.locator('#mini .mini-hit').click();
  await page.locator('.b-lyrics').click();
  await expect(page.locator('.ly').first()).toHaveText('Première ligne');
  await expect(page.locator('.ly.active')).toHaveCount(1, { timeout: 10000 });
  await shot(page, 'lyrics-synced');
  if (!localMediaOK(browserName)) {
    test.info().annotations.push({ type: 'skipped-part', description: 'History needs local playback, unsupported by WinCairo WebKit — covered by the Chrome project.' });
    return;
  }
  // 40 s track at 8x: a listen (> 30 s) is recorded
  await expect.poll(async () => page.evaluate(async () => {
    const db = await new Promise((r) => { const q = indexedDB.open('neonwave'); q.onsuccess = () => r(q.result); });
    return new Promise((r) => { const q = db.transaction('history').objectStore('history').getAll(); q.onsuccess = () => r(q.result.length); });
  }), { timeout: 20000 }).toBeGreaterThan(0);
  await page.locator('.np-grabber').click();
  await page.goto('/#/library/history');
  await expect(page.locator('.sub-h').first()).toHaveText("Aujourd'hui");
  await expect(page.locator('.track .t').first()).toHaveText('Local Neon');
  await shot(page, 'history');
  expect(errors).toEqual([]);
});

test('playlist with custom image, add tracks, sort', async ({ page }) => {
  await boot(page);
  await page.goto('/#/library/playlists');
  await page.locator('[data-new]').click();
  await page.locator('.dialog input').fill('Ma Playlist Néon');
  await page.getByRole('button', { name: 'Créer' }).click();
  await expect(page.locator('.hero h2')).toHaveText('Ma Playlist Néon');
  // custom image: pick → crop → choose
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-cover]').click();
  await menuItem(page, 'Choisir une photo').click();
  await (await chooser).setFiles([{ name: 'photo.png', mimeType: 'image/png', buffer: PHOTO }]);
  await expect(page.locator('.crop canvas')).toBeVisible();
  await page.locator('.crop input[type=range]').fill('1.5');
  await page.getByRole('button', { name: 'Choisir', exact: true }).click();
  await expect(page.locator('.hero-art img[data-blob^="pimg:"]')).toHaveAttribute('src', /^blob:/);
  // add Jamendo tracks 2 then 1
  await page.goto('/#/genre/pop');
  for (const i of [1, 0]) {
    await page.locator('.track').nth(i).locator('.more').click();
    await menuItem(page, 'Ajouter à une playlist').click();
    await page.locator('.sheet .row', { hasText: 'Ma Playlist Néon' }).click();
    await expect(page.locator('.toast')).toContainText('1 titre ajouté');
  }
  await page.goto('/#/library/playlists');
  await page.locator('.card', { hasText: 'Ma Playlist Néon' }).click();
  await expect(page.locator('.track .t')).toHaveText(['Jam Track 2', 'Jam Track 1']);
  await page.locator('[data-more]').click();
  await menuItem(page, 'Trier').click();
  await page.locator('.menu-item').filter({ hasText: /^\s*Titre\s*$/ }).click();
  await expect(page.locator('.track .t')).toHaveText(['Jam Track 1', 'Jam Track 2']);
  await shot(page, 'playlist');
  expect(errors).toEqual([]);
});

test('download, then offline: app shell loads and the downloaded track plays (blob + SW 206)', async ({ page, context, browserName }) => {
  await boot(page);
  await page.goto('/#/genre/pop');
  await page.locator('.track').first().locator('.more').click();
  await menuItem(page, 'Télécharger').click();
  await expect(page.locator('.track').first().locator('.dl-mark')).toBeVisible({ timeout: 15000 });
  await page.reload(); // make sure the SW controls the page
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  // SW Range path: 206 with a correct Content-Range
  const range = await page.evaluate(async () => {
    const r = await fetch('offline-audio/' + encodeURIComponent('j:101'), { headers: { Range: 'bytes=0-99' } });
    return { status: r.status, cr: r.headers.get('content-range'), len: (await r.arrayBuffer()).byteLength };
  });
  expect(range.status).toBe(206);
  expect(range.cr).toMatch(/^bytes 0-99\/\d+$/);
  expect(range.len).toBe(100);

  await context.setOffline(true);
  // The shell is served by the SW cache while offline.
  // (Playwright's Windows WebKit blocks offline requests before they reach the SW, so there we inspect the cache itself.)
  const shellOffline = await page.evaluate(async (viaFetch) => (await Promise.all(['index.html', 'js/app.js', 'css/player.css']
    .map((u) => (viaFetch ? fetch(u).then((r) => r.status) : caches.match(u, { ignoreSearch: true }).then((r) => r?.status ?? 0))))).join(), localMediaOK(browserName));
  expect(shellOffline).toBe('200,200,200');
  if (!localMediaOK(browserName)) {
    // WinCairo WebKit crashes on any offline document navigation in Playwright; check the in-app path instead.
    await page.goto('/#/library/downloads');
  } else {
    // Full document load while offline (a new query string forces it).
    await page.goto('/?offline=1#/library/downloads');
  }
  await expect(page.locator('.large-title')).toHaveText('Téléchargés');
  await expect(page.locator('.track .t')).toHaveText(['Jam Track 1']);
  await page.locator('.track').first().click();
  await expect(page.locator('#mini .mini-title')).toHaveText('Jam Track 1');
  await shot(page, 'offline-downloads');
  if (!localMediaOK(browserName)) {
    test.info().annotations.push({ type: 'skipped-part', description: 'Offline playback unsupported by WinCairo WebKit media stack — covered by the Chrome project.' });
    await context.setOffline(false);
    return;
  }
  // Blob URL first; an engine that refuses blob: media falls back to the SW 206 path automatically.
  await expect.poll(() => page.evaluate(() => { const a = document.getElementById('audio'); return /^blob:|offline-audio/.test(a.src) && !a.error && a.currentTime > 0; }), { timeout: 10000 }).toBe(true);

  // Explicit service-worker path
  await page.evaluate(async () => {
    await new Promise((r) => { const q = indexedDB.open('neonwave'); q.onsuccess = () => { q.result.transaction('kv', 'readwrite').objectStore('kv').put({ key: 'audioPath', value: 'sw' }).transaction.oncomplete = r; }; });
  });
  await page.goto('/?offline=2#/library/downloads');
  await page.locator('.track').first().click();
  await expect.poll(() => page.evaluate(() => { const a = document.getElementById('audio'); return a.src.includes('offline-audio') && !a.error && a.currentTime > 0; }), { timeout: 10000 }).toBe(true);
  // offline: non-downloaded tracks are refused cleanly
  await context.setOffline(false);
  const offlineErrors = errors.filter((e) => !/network|offline|Failed to load|NetworkError|internet/i.test(e));
  expect(offlineErrors).toEqual([]);
});
