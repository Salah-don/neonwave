// Generated audio fixtures (no binary files in the repo).

function id3Frame(id, body) {
  const h = Buffer.alloc(10);
  h.write(id, 0, 'latin1');
  h.writeUInt32BE(body.length, 4);
  return Buffer.concat([h, body]);
}
const syncsafe = (n) => Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);

/** ID3v2.3 tag with UTF-8 text frames, optional UTF-16 USLT lyrics and APIC picture. */
export function buildID3({ title, artist, album, lyrics, picture }) {
  const text = (s) => Buffer.concat([Buffer.from([3]), Buffer.from(s, 'utf8')]);
  const frames = [id3Frame('TIT2', text(title)), id3Frame('TPE1', text(artist)), id3Frame('TALB', text(album))];
  if (lyrics) {
    const bom = Buffer.from([0xff, 0xfe]);
    frames.push(id3Frame('USLT', Buffer.concat([Buffer.from([1]), Buffer.from('fra'), bom, Buffer.from([0, 0]), bom, Buffer.from(lyrics, 'utf16le')])));
  }
  if (picture) frames.push(id3Frame('APIC', Buffer.concat([Buffer.from([0]), Buffer.from('image/png\0', 'latin1'), Buffer.from([3, 0]), picture])));
  const all = Buffer.concat(frames);
  return Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0]), syncsafe(all.length), all]);
}

/** Mono 16-bit PCM WAV with a sine tone and an optional ID3 chunk. */
export function makeWav({ seconds = 3, rate = 8000, freq = 440, id3 } = {}) {
  const n = Math.round(seconds * rate);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 8000), i * 2);
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0); fmt.writeUInt16LE(1, 2); fmt.writeUInt32LE(rate, 4);
  fmt.writeUInt32LE(rate * 2, 8); fmt.writeUInt16LE(2, 12); fmt.writeUInt16LE(16, 14);
  const chunk = (id, body) => {
    const h = Buffer.alloc(8);
    h.write(id, 0, 'latin1');
    h.writeUInt32LE(body.length, 4);
    return Buffer.concat([h, body, body.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };
  const parts = [chunk('fmt ', fmt), chunk('data', data)];
  if (id3) parts.push(chunk('id3 ', id3));
  const body = Buffer.concat([Buffer.from('WAVE'), ...parts]);
  const head = Buffer.alloc(8);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}
