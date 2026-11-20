// Pure sorting / grouping helpers (no DOM) — used by views and unit tests.
const coll = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });

const KEYS = {
  title: (t) => t.title ?? '',
  artist: (t) => t.artist ?? '',
  album: (t) => t.album ?? '',
  addedAt: (t) => t.addedAt ?? 0,
  plays: (t) => t.playCount ?? 0,
  duration: (t) => t.duration ?? 0,
};

export const SORT_LABELS = {
  custom: 'Ordre personnalisé',
  title: 'Titre',
  artist: 'Artiste',
  album: 'Album',
  addedAt: "Date d'ajout",
  plays: 'Plus écoutés',
  duration: 'Durée',
};

/** Returns a new sorted array; `custom` keeps the given order. */
export function sortTracks(list, key = 'custom', dir = 'asc') {
  const sign = dir === 'desc' ? -1 : 1;
  const f = KEYS[key];
  if (!f) return dir === 'desc' ? [...list].reverse() : [...list];
  return [...list].sort((a, b) => {
    const x = f(a), y = f(b);
    const r = typeof x === 'string' ? coll.compare(x, y) : x - y;
    return r * sign || coll.compare(a.title ?? '', b.title ?? '');
  });
}

export const compareText = (a, b) => coll.compare(a ?? '', b ?? '');

/** Group entries with an `at` timestamp into Apple-style buckets. */
export function groupByPeriod(entries, now = Date.now()) {
  const d = new Date(now);
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const yesterday = today - 86400000;
  const week = today - 6 * 86400000;
  const buckets = [
    ["Aujourd'hui", (t) => t >= today],
    ['Hier', (t) => t >= yesterday],
    ['Cette semaine', (t) => t >= week],
    ['Plus ancien', () => true],
  ];
  const out = buckets.map(([label]) => ({ label, items: [] }));
  for (const e of entries) {
    const i = buckets.findIndex(([, test]) => test(e.at));
    out[i].items.push(e);
  }
  return out.filter((g) => g.items.length);
}

export function fmtTime(s) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

export function fmtTotal(seconds) {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
