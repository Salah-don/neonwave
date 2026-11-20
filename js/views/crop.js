// Square cropper: drag to move, pinch / slider to zoom → 512 px JPEG Blob.
import { sheet, toast } from '../ui.js';

const OUT = 512;

/** @returns {Promise<Blob|null>} */
export async function openCropper(file) {
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { toast('Image illisible', 'xmark'); return null; }
  const s = sheet({ title: 'Recadrer', left: '<button data-x>Annuler</button>', right: '<button class="strong" data-ok>Choisir</button>' });
  s.body.innerHTML = `<div class="crop"><div class="crop-frame"><canvas width="${OUT}" height="${OUT}"></canvas></div>
    <input type="range" min="1" max="4" step="0.01" value="1" aria-label="Zoom"><p class="hint">Glissez pour déplacer · pincez ou utilisez le curseur pour zoomer</p></div>`;
  const canvas = s.body.querySelector('canvas');
  const g = canvas.getContext('2d');
  const range = s.body.querySelector('input');
  const base = OUT / Math.min(bmp.width, bmp.height); // "cover" scale
  let zoom = 1, cx = bmp.width / 2, cy = bmp.height / 2; // image point at the centre

  const clamp = () => {
    const half = OUT / (2 * base * zoom);
    cx = Math.min(bmp.width - half, Math.max(half, cx));
    cy = Math.min(bmp.height - half, Math.max(half, cy));
  };
  const draw = () => {
    clamp();
    const sc = base * zoom;
    g.fillStyle = '#000';
    g.fillRect(0, 0, OUT, OUT);
    g.drawImage(bmp, OUT / 2 - cx * sc, OUT / 2 - cy * sc, bmp.width * sc, bmp.height * sc);
  };
  draw();

  const pts = new Map();
  let pinch0 = 0, zoom0 = 1;
  const cssScale = () => OUT / canvas.getBoundingClientRect().width;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); zoom0 = zoom; }
  });
  canvas.addEventListener('pointermove', (e) => {
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      zoom = Math.min(4, Math.max(1, zoom0 * (Math.hypot(a.x - b.x, a.y - b.y) / pinch0)));
      range.value = zoom;
    } else {
      const k = cssScale() / (base * zoom);
      cx -= (e.clientX - prev.x) * k;
      cy -= (e.clientY - prev.y) * k;
    }
    draw();
  });
  const release = (e) => pts.delete(e.pointerId);
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom = Math.min(4, Math.max(1, zoom * (e.deltaY < 0 ? 1.08 : 0.93))); range.value = zoom; draw(); }, { passive: false });
  range.addEventListener('input', () => { zoom = +range.value; draw(); });

  return new Promise((resolve) => {
    s.el.querySelector('[data-x]').onclick = () => s.close();
    s.el.querySelector('[data-ok]').onclick = () => {
      canvas.toBlob((b) => { s.close(b); }, 'image/jpeg', 0.85);
    };
    s.closed.then((b) => { bmp.close?.(); resolve(b instanceof Blob ? b : null); });
  });
}
