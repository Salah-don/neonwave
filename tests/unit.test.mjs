// Unit tests for the pure modules. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { Queue } from '../js/queue.js';
import { parseLRC, activeLine } from '../js/lib/lrc.js';
import { parseTags, fromFilename } from '../js/lib/tags.js';
import { sortTracks, groupByPeriod, fmtTime } from '../js/lib/sort.js';
import { makeWav, buildID3 } from './fixtures.mjs';

const T = (n) => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, title: `T${i}` }));

test('queue: up next has priority over the source, then source continues', () => {
  const q = new Queue();
  q.playContext(T(3), 0, 'Album');
  q.addToQueue({ id: 'x' });
  q.playNext({ id: 'y' });
  assert.deepEqual(q.upNext.map((t) => t.id), ['y', 'x']);
  assert.equal(q.next().id, 'y');
  assert.equal(q.next().id, 'x');
  assert.equal(q.next().id, 't1');
  assert.equal(q.next().id, 't2');
  assert.equal(q.next(), null, 'end of queue with repeat off');
  assert.equal(q.current.id, 't2', 'state unchanged at the end');
});

test('queue: prev walks back through history including up-next items', () => {
  const q = new Queue();
  q.playContext(T(3), 0);
  q.playNext({ id: 'y' });
  q.next(); q.next(); // y, t1
  assert.equal(q.prev().id, 'y');
  assert.equal(q.prev().id, 't0');
  assert.equal(q.next().id, 'y', 'y was put back in front of up next');
});

test('queue: repeat all wraps, repeat one peeks current', () => {
  const q = new Queue();
  q.playContext(T(2), 1);
  q.repeat = 'all';
  assert.equal(q.next().id, 't0');
  q.repeat = 'one';
  assert.equal(q.peekNext().id, 't0');
  assert.equal(q.cycleRepeat(), 'off');
});

test('queue: shuffle keeps current first and restores order when turned off', () => {
  const q = new Queue();
  const list = T(20);
  q.playContext(list, 5, '', { shuffle: true });
  assert.equal(q.current.id, 't5');
  assert.equal(q.context.tracks.length, 20);
  q.setShuffle(false);
  assert.equal(q.context.index, 5);
  assert.deepEqual(q.context.tracks.map((t) => t.id), list.map((t) => t.id));
});

test('queue: reorder / remove / clear / jump', () => {
  const q = new Queue();
  q.playContext(T(5), 0);
  q.moveSource(0, 2);
  assert.deepEqual(q.source.map((t) => t.id), ['t2', 't3', 't1', 't4']);
  q.removeSource(0);
  assert.deepEqual(q.source.map((t) => t.id), ['t3', 't1', 't4']);
  q.addToQueue({ id: 'a' }, { id: 'b' }, { id: 'c' });
  q.moveUpNext(2, 0);
  assert.deepEqual(q.upNext.map((t) => t.id), ['c', 'a', 'b']);
  assert.equal(q.jumpToUpNext(1).id, 'a');
  assert.deepEqual(q.upNext.map((t) => t.id), ['b']);
  q.clearAll();
  assert.equal(q.upNext.length, 0);
  assert.equal(q.source.length, 0);
});

test('queue: survives JSON round trip', () => {
  const q = new Queue();
  q.playContext(T(3), 1, 'P');
  q.addToQueue({ id: 'z' });
  const r = new Queue(JSON.parse(JSON.stringify(q)));
  assert.equal(r.current.id, 't1');
  assert.equal(r.next().id, 'z');
});

test('lrc: multiple timestamps, offset, word tags, sorting', () => {
  const lines = parseLRC('[ar:X]\n[offset:+500]\n[00:10.00][00:30.50]Chorus\n[00:05.2]<00:05.20>Intro <00:06.00>line\n\n');
  assert.deepEqual(lines.map((l) => l.text), ['Intro line', 'Chorus', 'Chorus']);
  assert.ok(Math.abs(lines[0].time - 4.7) < 1e-9);
  assert.equal(activeLine(lines, 0), -1);
  assert.equal(activeLine(lines, 10), 1);
  assert.equal(activeLine(lines, 99), 2);
  assert.equal(parseLRC('no timestamps here'), null);
});

test('tags: ID3v2.3 title/artist/album, UTF-16 USLT, APIC', () => {
  const pic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const buf = Buffer.concat([buildID3({ title: 'Été', artist: 'Ünïcode', album: 'Album', lyrics: '[00:01.00]Salut', picture: pic }), Buffer.alloc(64)]);
  const t = parseTags(buf, 'x.mp3');
  assert.equal(t.title, 'Été');
  assert.equal(t.artist, 'Ünïcode');
  assert.equal(t.album, 'Album');
  assert.equal(t.lyrics, '[00:01.00]Salut');
  assert.equal(t.picture.mime, 'image/png');
  assert.deepEqual([...t.picture.data], [...pic]);
});

test('tags: WAV with id3 chunk gives tags and duration', () => {
  const wav = makeWav({ seconds: 2, id3: buildID3({ title: 'Wave', artist: 'Neon', album: 'Test' }) });
  const t = parseTags(wav, 'f.wav');
  assert.equal(t.title, 'Wave');
  assert.equal(t.artist, 'Neon');
  assert.ok(Math.abs(t.duration - 2) < 0.01);
});

test('tags: corrupt data falls back to the filename', () => {
  const t = parseTags(Buffer.from('ID3\x03\x00\x00\x7f\x7f\x7f\x7fgarbage'), 'Daft Artist - My Song.mp3');
  assert.equal(t.title, 'My Song');
  assert.equal(t.artist, 'Daft Artist');
  assert.deepEqual(fromFilename('01 - Track.mp3'), { title: 'Track' });
});

test('sort: by key and direction, custom keeps order', () => {
  const list = [{ title: 'b', duration: 3, addedAt: 2 }, { title: 'A', duration: 1, addedAt: 3 }, { title: 'c', duration: 2, addedAt: 1 }];
  assert.deepEqual(sortTracks(list, 'title').map((t) => t.title), ['A', 'b', 'c']);
  assert.deepEqual(sortTracks(list, 'duration', 'desc').map((t) => t.title), ['b', 'c', 'A']);
  assert.deepEqual(sortTracks(list, 'custom').map((t) => t.title), ['b', 'A', 'c']);
  assert.equal(fmtTime(3725), '1:02:05');
});

test('history grouping: today / yesterday / this week / older', () => {
  const now = new Date(2026, 10, 20, 15, 0).getTime();
  const day = 86400000;
  const g = groupByPeriod([{ at: now - 1000 }, { at: now - day }, { at: now - 3 * day }, { at: now - 30 * day }], now);
  assert.deepEqual(g.map((x) => x.label), ["Aujourd'hui", 'Hier', 'Cette semaine', 'Plus ancien']);
});

test('service worker: Range requests get 206 + Content-Range', async () => {
  const src = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  const self = { addEventListener() {}, clients: {} };
  vm.runInNewContext(src, { self, location: { origin: 'http://x' }, Response, Blob, caches: {}, indexedDB: {}, URL, fetch });
  const blob = new Blob([new Uint8Array(1000)], { type: 'audio/wav' });
  let r = self.rangeResponse(blob, 'bytes=0-1');
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('content-range'), 'bytes 0-1/1000');
  assert.equal((await r.arrayBuffer()).byteLength, 2);
  r = self.rangeResponse(blob, 'bytes=900-');
  assert.equal(r.headers.get('content-range'), 'bytes 900-999/1000');
  r = self.rangeResponse(blob, 'bytes=-100');
  assert.equal(r.headers.get('content-range'), 'bytes 900-999/1000');
  assert.equal(self.rangeResponse(blob, 'bytes=5000-').status, 416);
  r = self.rangeResponse(blob, null);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('accept-ranges'), 'bytes');
});

test('cloudflare relay: Jamendo only, CORS headers, Range forwarded, no open proxy', async () => {
  const relay = (await import('../tools/cloudflare-relay.js')).default;
  const origin = { Origin: 'https://salah-don.github.io' };
  const realFetch = globalThis.fetch;
  let seen = null;
  globalThis.fetch = async (url, init) => {
    seen = { url, range: init.headers.Range };
    const r = new Response('ID3abc', { status: 206, headers: { 'Content-Type': 'audio/mpeg', 'Content-Range': 'bytes 0-5/100', 'Set-Cookie': 'x=1' } });
    Object.defineProperty(r, 'url', { value: url });
    return r;
  };
  try {
    const ok = await relay.fetch(new Request('https://r.dev/?url=' + encodeURIComponent('https://prod-1.storage.jamendo.com/?trackid=1&format=mp32'), { headers: { ...origin, Range: 'bytes=0-5' } }));
    assert.equal(ok.status, 206);
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://salah-don.github.io');
    assert.equal(ok.headers.get('content-range'), 'bytes 0-5/100');
    assert.equal(ok.headers.get('set-cookie'), null, 'upstream cookies are not forwarded');
    assert.equal(seen.range, 'bytes=0-5');
    for (const bad of ['https://evil.com/x', 'http://prod-1.storage.jamendo.com/', 'https://jamendo.com.evil.com/', 'file:///etc/passwd']) {
      const r = await relay.fetch(new Request('https://r.dev/?url=' + encodeURIComponent(bad), { headers: origin }));
      assert.equal(r.status, 403, bad);
    }
    const ping = await relay.fetch(new Request('https://r.dev/', { headers: origin }));
    assert.equal(await ping.text(), 'NeonWave relay OK');
    assert.equal((await relay.fetch(new Request('https://r.dev/', { method: 'OPTIONS', headers: origin }))).status, 204);
  } finally {
    globalThis.fetch = realFetch;
  }
});
