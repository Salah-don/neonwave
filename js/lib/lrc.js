// LRC parser (pure, no DOM) — shared by lyrics.js and the unit tests.
const TS = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/y;

/**
 * @param {string} text
 * @returns {{time:number,text:string}[]|null} sorted lines, or null when the text has no timestamps
 */
export function parseLRC(text) {
  if (!text || typeof text !== 'string') return null;
  let offset = 0;
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const off = raw.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]/i);
    if (off) { offset = Number(off[1]) / 1000; continue; }
    const times = [];
    let pos = raw.search(/\S/);
    if (pos < 0) continue;
    TS.lastIndex = pos;
    let m;
    while ((m = TS.exec(raw))) {
      times.push(Number(m[1]) * 60 + parseFloat(m[2].replace(':', '.')));
      pos = TS.lastIndex;
    }
    if (!times.length) continue;
    const words = raw.slice(pos).replace(/<\d+:\d+(?:[.:]\d+)?>/g, '').trim();
    for (const t of times) lines.push({ time: Math.max(0, t - offset), text: words });
  }
  if (!lines.length) return null;
  return lines.sort((a, b) => a.time - b.time);
}

/** Index of the line active at time `t` (-1 before the first line). */
export function activeLine(lines, t) {
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= t + 0.15) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}
