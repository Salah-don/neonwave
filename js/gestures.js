// Touch gestures: long press, drag-to-reorder, swipe-to-delete, vertical drag-to-dismiss.

let suppressClickUntil = 0;
// A long press or swipe must not also trigger the click that follows pointerup.
document.addEventListener('click', (e) => {
  if (Date.now() < suppressClickUntil) { e.stopPropagation(); e.preventDefault(); }
}, true);
const suppressClick = () => { suppressClickUntil = Date.now() + 450; };

/** Long press (or right click) on elements matching `sel` inside `root`. */
export function longPress(root, sel, cb, ms = 480) {
  let timer = null, sx = 0, sy = 0, el = null;
  const cancel = () => { clearTimeout(timer); timer = null; el?.classList.remove('pressing'); };
  root.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    el = e.target.closest(sel);
    if (!el || e.target.closest('.handle, .more, button, a[href]:not(' + sel + ')')) { el = null; return; }
    sx = e.clientX; sy = e.clientY;
    el.classList.add('pressing');
    timer = setTimeout(() => {
      timer = null;
      el.classList.remove('pressing');
      suppressClick();
      navigator.vibrate?.(8);
      cb(el);
    }, ms);
  });
  root.addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel(); });
  root.addEventListener('pointerup', cancel);
  root.addEventListener('pointercancel', cancel);
  root.addEventListener('scroll', cancel, { passive: true, capture: true });
  root.addEventListener('contextmenu', (e) => {
    const target = e.target.closest(sel);
    if (!target) return;
    e.preventDefault();
    if (Date.now() < suppressClickUntil) return; // already opened by the timer
    cancel();
    cb(target);
  });
}

/** Drag-to-reorder by `.handle`. onMove(from, to) is called once on drop. */
export function sortable(list, { item = '.row', handle = '.handle', onMove }) {
  list.addEventListener('pointerdown', (e) => {
    const h = e.target.closest(handle);
    if (!h || !list.contains(h)) return;
    const el = h.closest(item);
    const items = [...list.children].filter((c) => c.matches(item));
    const from = items.indexOf(el);
    if (from < 0) return;
    e.preventDefault();
    h.setPointerCapture(e.pointerId);
    const rects = items.map((i) => i.getBoundingClientRect());
    const startY = e.clientY;
    const hgt = rects[from].height;
    let to = from;
    el.classList.add('dragging');
    items.forEach((i) => i !== el && i.classList.add('shifting'));
    navigator.vibrate?.(6);

    const onMovePtr = (ev) => {
      const dy = ev.clientY - startY;
      el.style.transform = `translate3d(0, ${dy}px, 0)`;
      const center = rects[from].top + hgt / 2 + dy;
      to = from;
      for (let i = from + 1; i < items.length; i++) if (center > rects[i].top + rects[i].height / 2) to = i;
      for (let i = from - 1; i >= 0; i--) if (center < rects[i].top + rects[i].height / 2) to = i;
      items.forEach((it, i) => {
        if (it === el) return;
        const shift = from < to && i > from && i <= to ? -hgt : to < from && i >= to && i < from ? hgt : 0;
        it.style.transform = shift ? `translate3d(0, ${shift}px, 0)` : '';
      });
    };
    const end = () => {
      h.removeEventListener('pointermove', onMovePtr);
      h.removeEventListener('pointerup', end);
      h.removeEventListener('pointercancel', end);
      items.forEach((it) => { it.style.transform = ''; it.classList.remove('shifting', 'dragging'); });
      if (to !== from) {
        // Reflect the move in the DOM immediately; caller persists it.
        const ref = to > from ? items[to].nextSibling : items[to];
        list.insertBefore(el, ref);
        onMove(from, to);
      }
    };
    h.addEventListener('pointermove', onMovePtr);
    h.addEventListener('pointerup', end);
    h.addEventListener('pointercancel', end);
  });
}

/** Swipe left on a row to delete it. onDelete(row) is called after the row animates out. */
export function swipeToDelete(list, { item = '.row', onDelete }) {
  list.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const row = e.target.closest(item);
    if (!row || e.target.closest('.handle')) return;
    const sx = e.clientX, sy = e.clientY, w = row.offsetWidth;
    let mode = null, dx = 0;
    const move = (ev) => {
      const mx = ev.clientX - sx, my = ev.clientY - sy;
      if (!mode) {
        if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my) * 1.3) { mode = 'h'; row.setPointerCapture(ev.pointerId); row.classList.add('swiping'); }
        else if (Math.abs(my) > 10) { mode = 'v'; cleanup(); return; }
        else return;
      }
      dx = Math.min(0, mx);
      row.style.setProperty('--dx', `${dx}px`);
      row.style.setProperty('--reveal', `${-dx}px`);
    };
    const up = () => {
      cleanup();
      if (mode !== 'h') return;
      suppressClick();
      row.classList.remove('swiping');
      row.classList.add('swiped');
      if (dx < -w * 0.35) {
        row.style.setProperty('--dx', `${-w}px`);
        row.style.setProperty('--reveal', `${w}px`);
        setTimeout(() => onDelete(row), 220);
      } else {
        row.style.setProperty('--dx', '0px');
        row.style.setProperty('--reveal', '0px');
        setTimeout(() => row.classList.remove('swiped'), 260);
      }
    };
    const cleanup = () => {
      row.removeEventListener('pointermove', move);
      row.removeEventListener('pointerup', up);
      row.removeEventListener('pointercancel', up);
    };
    row.addEventListener('pointermove', move);
    row.addEventListener('pointerup', up);
    row.addEventListener('pointercancel', up);
  });
}

/**
 * Vertical drag on `el` (a sheet). Calls onDismiss when dragged far/fast enough.
 * `canStart(e)` lets callers ignore drags that begin on scrollers, sliders…
 */
export function dragToDismiss(el, { onDismiss, canStart = () => true, direction = 1, onProgress }) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || !canStart(e)) return;
    const sy = e.clientY, sx = e.clientX, t0 = performance.now();
    let dy = 0, active = false;
    const move = (ev) => {
      const my = (ev.clientY - sy) * direction, mx = ev.clientX - sx;
      if (!active) {
        if (my > 8 && my > Math.abs(mx)) { active = true; el.setPointerCapture(ev.pointerId); el.classList.add('dragging'); }
        else if (Math.abs(mx) > 12 || my < -8) { cleanup(); return; }
        else return;
      }
      dy = Math.max(0, my);
      el.style.transform = `translate3d(0, ${dy * direction}px, 0)`;
      onProgress?.(dy);
    };
    const up = () => {
      cleanup();
      if (!active) return;
      suppressClick();
      el.classList.remove('dragging');
      const v = dy / (performance.now() - t0);
      el.style.transform = '';
      if (dy > 140 || (v > 0.6 && dy > 40)) onDismiss();
      else onProgress?.(0);
    };
    const cleanup = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
}
