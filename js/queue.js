// Pure queue model (no DOM, no storage) — Apple Music style:
//   Now playing · "À suivre" (manual, has priority) · "Suite de la source" (album/playlist context)
export function shuffled(a) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

function move(arr, from, to) {
  const [x] = arr.splice(from, 1);
  arr.splice(to, 0, x);
}

export class Queue {
  constructor(s = {}) {
    this.current = s.current ?? null;
    this.upNext = s.upNext ?? [];
    this.context = s.context ?? { name: '', tracks: [], index: -1, original: null };
    this.past = s.past ?? [];          // [{ track, ctxIndex|null }]
    this.fromUpNext = s.fromUpNext ?? false;
    this.shuffle = s.shuffle ?? false;
    this.repeat = s.repeat ?? 'off';   // 'off' | 'all' | 'one'
  }

  toJSON() {
    return {
      current: this.current, upNext: this.upNext, context: this.context,
      past: this.past.slice(-50), fromUpNext: this.fromUpNext, shuffle: this.shuffle, repeat: this.repeat,
    };
  }

  /** Start a new source. index -1 with shuffle = random start. */
  playContext(tracks, index = 0, name = '', { shuffle = this.shuffle } = {}) {
    this.shuffle = shuffle;
    if (shuffle) {
      const start = tracks[index];
      const rest = shuffled(tracks.filter((_, i) => i !== index));
      this.context = { name, tracks: start ? [start, ...rest] : rest, index: 0, original: [...tracks] };
    } else {
      this.context = { name, tracks: [...tracks], index: Math.max(0, index), original: null };
    }
    this.current = this.context.tracks[this.context.index] ?? null;
    this.fromUpNext = false;
    this.past = [];
    return this.current;
  }

  get source() { return this.context.tracks.slice(this.context.index + 1); }

  peekNext() {
    if (this.repeat === 'one') return this.current;
    if (this.upNext.length) return this.upNext[0];
    const c = this.context;
    if (c.index + 1 < c.tracks.length) return c.tracks[c.index + 1];
    if (this.repeat === 'all') return c.tracks[0] ?? null;
    return null;
  }

  /** Advance. Returns the new current track, or null at the end of the queue (state unchanged). */
  next() {
    const c = this.context;
    const hasMore = this.upNext.length || c.index + 1 < c.tracks.length || (this.repeat !== 'off' && c.tracks.length);
    if (!hasMore) return null;
    if (this.current) this.past.push({ track: this.current, ctxIndex: this.fromUpNext ? null : c.index });
    if (this.upNext.length) {
      this.current = this.upNext.shift();
      this.fromUpNext = true;
      return this.current;
    }
    c.index = c.index + 1 < c.tracks.length ? c.index + 1 : 0;
    this.current = c.tracks[c.index];
    this.fromUpNext = false;
    return this.current;
  }

  prev() {
    const e = this.past.pop();
    if (!e) {
      if (!this.fromUpNext && this.context.index > 0) {
        this.context.index--;
        this.current = this.context.tracks[this.context.index];
        return this.current;
      }
      return null;
    }
    if (this.fromUpNext && this.current) this.upNext.unshift(this.current);
    this.current = e.track;
    this.fromUpNext = e.ctxIndex == null;
    if (e.ctxIndex != null) this.context.index = e.ctxIndex;
    return this.current;
  }

  playNext(...tracks) { this.upNext.unshift(...tracks); }
  addToQueue(...tracks) { this.upNext.push(...tracks); }
  removeUpNext(i) { this.upNext.splice(i, 1); }
  moveUpNext(from, to) { move(this.upNext, from, to); }

  removeSource(i) {
    const c = this.context;
    const [t] = c.tracks.splice(c.index + 1 + i, 1);
    if (c.original && t) {
      const k = c.original.indexOf(t);
      if (k >= 0) c.original.splice(k, 1);
    }
  }
  moveSource(from, to) { const b = this.context.index + 1; move(this.context.tracks, b + from, b + to); }

  clearUpNext() { this.upNext = []; }
  clearAll() {
    this.upNext = [];
    this.context.tracks = this.context.tracks.slice(0, this.context.index + 1);
    this.context.original = null;
  }

  /** Jump to the i-th item of "À suivre" (items before it are dropped, like Apple Music). */
  jumpToUpNext(i) {
    this.upNext.splice(0, i);
    return this.next();
  }
  /** Jump to the i-th item of the source. */
  jumpToSource(i) {
    if (this.current) this.past.push({ track: this.current, ctxIndex: this.fromUpNext ? null : this.context.index });
    this.context.index += i + 1;
    this.current = this.context.tracks[this.context.index];
    this.fromUpNext = false;
    return this.current;
  }

  setShuffle(on) {
    if (on === this.shuffle) return;
    this.shuffle = on;
    const c = this.context;
    if (on) {
      c.original = [...c.tracks];
      c.tracks = [...c.tracks.slice(0, c.index + 1), ...shuffled(c.tracks.slice(c.index + 1))];
    } else if (c.original) {
      const ref = c.tracks[c.index];
      const idx = c.original.findIndex((t) => t?.id === ref?.id);
      c.tracks = c.original;
      c.index = Math.max(0, idx);
      c.original = null;
      this.past = this.past.map((e) => ({ ...e, ctxIndex: null }));
    }
  }

  cycleRepeat() {
    this.repeat = { off: 'all', all: 'one', one: 'off' }[this.repeat] ?? 'off';
    return this.repeat;
  }

  /** Replace stale copies of a track (e.g. after download) everywhere in the queue. */
  updateTrack(t) {
    const fix = (x) => (x?.id === t.id ? { ...x, ...t } : x);
    this.current = fix(this.current);
    this.upNext = this.upNext.map(fix);
    this.context.tracks = this.context.tracks.map(fix);
    if (this.context.original) this.context.original = this.context.original.map(fix);
  }
}
