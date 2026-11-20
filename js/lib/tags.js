// Hand-written tag reader (pure, no DOM): ID3v2.2/2.3/2.4 (+ID3v1), MP4/M4A ilst, FLAC Vorbis comments, WAV.
// Returns { title, artist, album, albumArtist, duration, picture:{mime,data}, lyrics, syncedLyrics:[{time,text}] }.

const latin1 = new TextDecoder('latin1');
const utf8 = new TextDecoder('utf-8');
const utf16le = new TextDecoder('utf-16le');
const utf16be = new TextDecoder('utf-16be');

const str = (u8, a, b) => latin1.decode(u8.subarray(a, b));
const be32 = (u8, p) => ((u8[p] << 24) | (u8[p + 1] << 16) | (u8[p + 2] << 8) | u8[p + 3]) >>> 0;
const le32 = (u8, p) => (u8[p] | (u8[p + 1] << 8) | (u8[p + 2] << 16) | (u8[p + 3] << 24)) >>> 0;
const syncsafe = (u8, p) => ((u8[p] & 0x7f) << 21) | ((u8[p + 1] & 0x7f) << 14) | ((u8[p + 2] & 0x7f) << 7) | (u8[p + 3] & 0x7f);
const clean = (s) => s.replace(/\0+$/g, '').split('\0')[0].trim();

function decodeText(b, enc) {
  if (enc === 0) return latin1.decode(b);
  if (enc === 3) return utf8.decode(b);
  if (enc === 2) return utf16be.decode(b);
  if (b[0] === 0xfe && b[1] === 0xff) return utf16be.decode(b.subarray(2));
  if (b[0] === 0xff && b[1] === 0xfe) return utf16le.decode(b.subarray(2));
  return utf16le.decode(b);
}
const wide = (enc) => enc === 1 || enc === 2;
function termIndex(b, start, enc) {
  if (wide(enc)) {
    for (let i = start; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i;
    return b.length;
  }
  const i = b.indexOf(0, start);
  return i < 0 ? b.length : i;
}

/* ---------------- ID3v2 ---------------- */
const V22 = { TT2: 'TIT2', TP1: 'TPE1', TAL: 'TALB', TP2: 'TPE2', PIC: 'APIC', ULT: 'USLT', SLT: 'SYLT', TLE: 'TLEN' };

function id3Frame(id, b, out, v22) {
  if (!b.length) return;
  const enc = b[0];
  switch (id) {
    case 'TIT2': out.title ??= clean(decodeText(b.subarray(1), enc)); break;
    case 'TPE1': out.artist ??= clean(decodeText(b.subarray(1), enc)); break;
    case 'TALB': out.album ??= clean(decodeText(b.subarray(1), enc)); break;
    case 'TPE2': out.albumArtist ??= clean(decodeText(b.subarray(1), enc)); break;
    case 'TLEN': { const ms = Number(clean(decodeText(b.subarray(1), enc))); if (ms > 0) out.duration ??= ms / 1000; break; }
    case 'APIC': {
      let p, mime;
      if (v22) { const f = str(b, 1, 4).toUpperCase(); mime = f === 'PNG' ? 'image/png' : 'image/jpeg'; p = 4; }
      else { const e = b.indexOf(0, 1); mime = str(b, 1, e) || 'image/jpeg'; p = e + 1; }
      const type = b[p];
      const d = termIndex(b, p + 1, enc);
      const data = b.slice(d + (wide(enc) ? 2 : 1));
      if (!mime.includes('/')) mime = `image/${mime.toLowerCase() === 'png' ? 'png' : 'jpeg'}`;
      if (data.length && (!out.picture || type === 3)) out.picture = { mime, data };
      break;
    }
    case 'USLT': {
      const d = termIndex(b, 4, enc);
      const text = decodeText(b.subarray(d + (wide(enc) ? 2 : 1)), enc).replace(/\0+$/, '').trim();
      if (text) out.lyrics ??= text;
      break;
    }
    case 'SYLT': {
      if (b[4] !== 2) break; // only millisecond timestamps
      let p = termIndex(b, 6, enc) + (wide(enc) ? 2 : 1);
      const lines = [];
      while (p < b.length) {
        const e = termIndex(b, p, enc);
        const text = decodeText(b.subarray(p, e), enc).replace(/^\n/, '').trim();
        p = e + (wide(enc) ? 2 : 1);
        if (p + 4 > b.length) break;
        lines.push({ time: be32(b, p) / 1000, text });
        p += 4;
      }
      if (lines.length) out.syncedLyrics ??= lines.sort((x, y) => x.time - y.time);
      break;
    }
  }
}

export function parseID3(u8, off = 0, out = {}) {
  if (u8.length < off + 10 || str(u8, off, off + 3) !== 'ID3') return null;
  const ver = u8[off + 3], flags = u8[off + 5];
  const end = Math.min(u8.length, off + 10 + syncsafe(u8, off + 6));
  let p = off + 10;
  // shortcut: whole-tag unsynchronisation (rare, flag 0x80) is not undone; such tags may read garbled.
  if (flags & 0x40) p += ver === 4 ? syncsafe(u8, p) : be32(u8, p) + 4;
  const v22 = ver === 2, hlen = v22 ? 6 : 10;
  while (p + hlen <= end) {
    const id = str(u8, p, p + (v22 ? 3 : 4));
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
    const size = v22 ? (u8[p + 3] << 16) | (u8[p + 4] << 8) | u8[p + 5] : ver === 4 ? syncsafe(u8, p + 4) : be32(u8, p + 4);
    if (size <= 0 || p + hlen + size > end) break;
    id3Frame(v22 ? V22[id] || id : id, u8.subarray(p + hlen, p + hlen + size), out, v22);
    p += hlen + size;
  }
  return out;
}

function parseID3v1(u8, out) {
  if (u8.length < 128) return;
  const p = u8.length - 128;
  if (str(u8, p, p + 3) !== 'TAG') return;
  out.title ||= clean(str(u8, p + 3, p + 33));
  out.artist ||= clean(str(u8, p + 33, p + 63));
  out.album ||= clean(str(u8, p + 63, p + 93));
}

/* ---------------- MP4 / M4A ---------------- */
const MP4_CONTAINERS = new Set(['moov', 'udta', 'ilst', 'meta']);
const MP4_ITEMS = { '\xa9nam': 'title', '\xa9ART': 'artist', '\xa9alb': 'album', aART: 'albumArtist', '\xa9lyr': 'lyrics' };

export function parseMP4(u8) {
  if (u8.length < 12 || str(u8, 4, 8) !== 'ftyp') return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const out = {};
  const walk = (start, end, parent) => {
    let p = start;
    while (p + 8 <= end) {
      let size = dv.getUint32(p);
      const type = str(u8, p + 4, p + 8);
      let hdr = 8;
      if (size === 1) { size = Number(dv.getBigUint64(p + 8)); hdr = 16; } else if (size === 0) size = end - p;
      if (size < hdr || p + size > end) break;
      const cs = p + hdr, ce = p + size;
      if (type === 'mvhd') {
        const v = u8[cs];
        const scale = dv.getUint32(cs + (v === 1 ? 20 : 12));
        const dur = v === 1 ? Number(dv.getBigUint64(cs + 24)) : dv.getUint32(cs + 16);
        if (scale) out.duration = dur / scale;
      } else if (type === 'meta') {
        walk(str(u8, cs + 4, cs + 8) === 'hdlr' ? cs : cs + 4, ce, type); // QuickTime meta has no version field
      } else if (MP4_CONTAINERS.has(type)) {
        walk(cs, ce, type);
      } else if (parent === 'ilst' && (MP4_ITEMS[type] || type === 'covr')) {
        if (str(u8, cs + 4, cs + 8) === 'data') {
          const dsize = dv.getUint32(cs);
          const kind = dv.getUint32(cs + 8) & 0xffffff;
          const data = u8.subarray(cs + 16, Math.min(cs + dsize, ce));
          if (type === 'covr') out.picture ??= { mime: kind === 14 ? 'image/png' : 'image/jpeg', data: data.slice() };
          else out[MP4_ITEMS[type]] ??= utf8.decode(data).trim();
        }
      }
      p += size;
    }
  };
  walk(0, u8.length, '');
  return out;
}

/* ---------------- FLAC ---------------- */
export function parseFLAC(u8) {
  if (str(u8, 0, 4) !== 'fLaC') return null;
  const out = {};
  let p = 4, last = false;
  while (!last && p + 4 <= u8.length) {
    last = !!(u8[p] & 0x80);
    const type = u8[p] & 0x7f;
    const len = (u8[p + 1] << 16) | (u8[p + 2] << 8) | u8[p + 3];
    const b = u8.subarray(p + 4, p + 4 + len);
    p += 4 + len;
    if (type === 0 && b.length >= 18) {
      const sr = (b[10] << 12) | (b[11] << 4) | (b[12] >> 4);
      const total = (b[13] & 0x0f) * 2 ** 32 + be32(b, 14);
      if (sr && total) out.duration = total / sr;
    } else if (type === 4) {
      let q = 4 + le32(b, 0);
      const n = le32(b, q); q += 4;
      for (let i = 0; i < n && q + 4 <= b.length; i++) {
        const l = le32(b, q); q += 4;
        const kv = utf8.decode(b.subarray(q, q + l)); q += l;
        const eq = kv.indexOf('=');
        if (eq < 0) continue;
        const k = kv.slice(0, eq).toUpperCase(), v = kv.slice(eq + 1).trim();
        if (k === 'TITLE') out.title ??= v;
        else if (k === 'ARTIST') out.artist ??= v;
        else if (k === 'ALBUM') out.album ??= v;
        else if (k === 'ALBUMARTIST') out.albumArtist ??= v;
        else if (k === 'LYRICS' || k === 'UNSYNCEDLYRICS') out.lyrics ??= v;
      }
    } else if (type === 6 && !out.picture) {
      let q = 4;
      const ml = be32(b, q); q += 4;
      const mime = str(b, q, q + ml); q += ml;
      const dl = be32(b, q); q += 4 + dl + 16;
      const len2 = be32(b, q); q += 4;
      out.picture = { mime: mime || 'image/jpeg', data: b.slice(q, q + len2) };
    }
  }
  return out;
}

/* ---------------- WAV ---------------- */
export function parseWAV(u8) {
  if (str(u8, 0, 4) !== 'RIFF' || str(u8, 8, 12) !== 'WAVE') return null;
  const out = {};
  let p = 12, byteRate = 0, dataSize = 0;
  while (p + 8 <= u8.length) {
    const id = str(u8, p, p + 4);
    const size = le32(u8, p + 4);
    const cs = p + 8;
    if (id === 'fmt ') byteRate = le32(u8, cs + 8);
    else if (id === 'data') dataSize = size;
    else if (id === 'id3 ' || id === 'ID3 ') parseID3(u8, cs, out);
    else if (id === 'LIST' && str(u8, cs, cs + 4) === 'INFO') {
      let q = cs + 4;
      while (q + 8 <= cs + size) {
        const k = str(u8, q, q + 4), l = le32(u8, q + 4);
        const v = clean(utf8.decode(u8.subarray(q + 8, q + 8 + l)));
        if (k === 'INAM') out.title ??= v;
        else if (k === 'IART') out.artist ??= v;
        else if (k === 'IPRD') out.album ??= v;
        q += 8 + l + (l & 1);
      }
    }
    p = cs + size + (size & 1);
  }
  if (byteRate && dataSize) out.duration = dataSize / byteRate;
  return out;
}

/* ---------------- entry point ---------------- */
export function fromFilename(name = '') {
  const base = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const m = base.match(/^(.+?)\s+-\s+(.+)$/);
  if (m && !/^\d+$/.test(m[1].trim())) return { artist: m[1].trim(), title: m[2].trim() };
  return { title: base.replace(/^\d+[\s.-]+/, '') || base };
}

/**
 * @param {ArrayBuffer|Uint8Array} buf
 * @param {string} filename
 */
export function parseTags(buf, filename = '') {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let out = {};
  try {
    out = parseID3(u8) || parseMP4(u8) || parseFLAC(u8) || parseWAV(u8) || {};
    parseID3v1(u8, out);
  } catch {
    out = {}; // corrupted tags: fall back to the filename
  }
  const fb = fromFilename(filename);
  return {
    ...out,
    title: out.title || fb.title || 'Sans titre',
    artist: out.artist || out.albumArtist || fb.artist || 'Artiste inconnu',
    album: out.album || '',
  };
}
