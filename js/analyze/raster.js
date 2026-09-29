// Small raster toolkit used for rooms, exterior detection and outlines.
export class Grid {
  constructor(x0, y0, x1, y1, cell = 25) {
    this.cell = cell; this.x0 = x0; this.y0 = y0;
    this.w = Math.max(1, Math.ceil((x1 - x0) / cell)); this.h = Math.max(1, Math.ceil((y1 - y0) / cell));
    this.a = new Uint8Array(this.w * this.h);
  }
  clone() { const g = Object.create(Grid.prototype); Object.assign(g, this); g.a = this.a.slice(); return g; }
  ix(x) { return Math.floor((x - this.x0) / this.cell); }
  iy(y) { return Math.floor((y - this.y0) / this.cell); }
  cx(i) { return this.x0 + (i + 0.5) * this.cell; }
  cy(j) { return this.y0 + (j + 0.5) * this.cell; }
  get(i, j) { return i < 0 || j < 0 || i >= this.w || j >= this.h ? 0 : this.a[j * this.w + i]; }
  at(x, y) { return this.get(this.ix(x), this.iy(y)); }
  // Fill cells whose centres fall inside the rect (inclusive of partially covered cells when grow>0)
  fillRect(x1, y1, x2, y2, v = 1, grow = 0) {
    const c = this.cell;
    const i0 = Math.max(0, Math.floor((Math.min(x1, x2) - this.x0 - grow) / c + 0.5));
    const i1 = Math.min(this.w - 1, Math.ceil((Math.max(x1, x2) - this.x0 + grow) / c - 0.5) - 1);
    const j0 = Math.max(0, Math.floor((Math.min(y1, y2) - this.y0 - grow) / c + 0.5));
    const j1 = Math.min(this.h - 1, Math.ceil((Math.max(y1, y2) - this.y0 + grow) / c - 0.5) - 1);
    for (let j = j0; j <= j1; j++) this.a.fill(v, j * this.w + i0, j * this.w + i1 + 1);
  }
  // Binary morphology on cells == v (square structuring element of radius r cells)
  dilate(r, v = 1) { this._morph(r, v, true); return this; }
  erode(r, v = 1) { this._morph(r, v, false); return this; }
  _morph(r, v, grow) {
    const { w, h } = this;
    const src = this.a, tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
    // separable: rows then columns (running window count)
    for (let j = 0; j < h; j++) {
      let cnt = 0; const row = j * w;
      for (let i = -r; i < w + r; i++) {
        const add = i + r, rem = i - r - 1;
        if (add < w && add >= 0 && src[row + add] === v) cnt++;
        if (rem >= 0 && rem < w && src[row + rem] === v) cnt--;
        if (i >= 0 && i < w) {
          const span = Math.min(w - 1, i + r) - Math.max(0, i - r) + 1;
          tmp[row + i] = grow ? (cnt > 0 ? 1 : 0) : (cnt === span ? 1 : 0);
        }
      }
    }
    for (let i = 0; i < w; i++) {
      let cnt = 0;
      for (let j = -r; j < h + r; j++) {
        const add = j + r, rem = j - r - 1;
        if (add < h && add >= 0 && tmp[add * w + i]) cnt++;
        if (rem >= 0 && rem < h && tmp[rem * w + i]) cnt--;
        if (j >= 0 && j < h) {
          const span = Math.min(h - 1, j + r) - Math.max(0, j - r) + 1;
          out[j * w + i] = grow ? (cnt > 0 ? 1 : 0) : (cnt === span ? 1 : 0);
        }
      }
    }
    for (let p = 0; p < w * h; p++) src[p] = out[p] ? v : (src[p] === v ? 0 : src[p]);
  }
  // Rasterise a line (thin) – marks every cell the segment passes through
  line(x1, y1, x2, y2, v = 1) {
    const L = Math.hypot(x2 - x1, y2 - y1), n = Math.max(1, Math.ceil(L / (this.cell * 0.5)));
    for (let k = 0; k <= n; k++) {
      const i = this.ix(x1 + (x2 - x1) * k / n), j = this.iy(y1 + (y2 - y1) * k / n);
      if (i >= 0 && j >= 0 && i < this.w && j < this.h) this.a[j * this.w + i] = v;
    }
  }
  // Flood fill from (i,j) over cells equal to `from`, writing `to`. 4-connected. Returns count.
  flood(i, j, from, to) {
    const { w, h, a } = this;
    if (i < 0 || j < 0 || i >= w || j >= h || a[j * w + i] !== from) return 0;
    const st = [j * w + i]; a[j * w + i] = to; let n = 0;
    while (st.length) {
      const p = st.pop(); n++;
      const x = p % w, y = (p - x) / w;
      if (x > 0 && a[p - 1] === from) { a[p - 1] = to; st.push(p - 1); }
      if (x < w - 1 && a[p + 1] === from) { a[p + 1] = to; st.push(p + 1); }
      if (y > 0 && a[p - w] === from) { a[p - w] = to; st.push(p - w); }
      if (y < h - 1 && a[p + w] === from) { a[p + w] = to; st.push(p + w); }
    }
    return n;
  }
  floodBorder(from, to) {
    for (let i = 0; i < this.w; i++) { this.flood(i, 0, from, to); this.flood(i, this.h - 1, from, to); }
    for (let j = 0; j < this.h; j++) { this.flood(0, j, from, to); this.flood(this.w - 1, j, from, to); }
  }
  // Connected components of cells == v; returns {labels: Int32Array, comps:[{id, n, cells}]}
  components(v) {
    const { w, h, a } = this;
    const lab = new Int32Array(w * h).fill(-1);
    const comps = [];
    for (let p = 0; p < w * h; p++) {
      if (a[p] !== v || lab[p] >= 0) continue;
      const id = comps.length, cells = [];
      const st = [p]; lab[p] = id;
      while (st.length) {
        const q = st.pop(); cells.push(q);
        const x = q % w, y = (q - x) / w;
        const nb = [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, y > 0 ? q - w : -1, y < h - 1 ? q + w : -1];
        for (const r of nb) if (r >= 0 && a[r] === v && lab[r] < 0) { lab[r] = id; st.push(r); }
      }
      comps.push({ id, n: cells.length, cells });
    }
    return { labels: lab, comps };
  }
  // Decompose a set of cells (Set or predicate over index) into axis rectangles (mm)
  rectsOf(pred) {
    const { w, h } = this;
    const out = [];
    let prev = new Map(); // "i0,i1" → rect index
    for (let j = 0; j < h; j++) {
      const cur = new Map();
      let i = 0;
      while (i < w) {
        if (!pred(j * w + i)) { i++; continue; }
        let k = i; while (k + 1 < w && pred(j * w + k + 1)) k++;
        const key = i + ',' + k;
        if (prev.has(key)) { const r = out[prev.get(key)]; r[3] = j + 1; cur.set(key, prev.get(key)); }
        else { out.push([i, j, k + 1, j + 1]); cur.set(key, out.length - 1); }
        i = k + 1;
      }
      prev = cur;
    }
    return out.map(([i0, j0, i1, j1]) => [this.x0 + i0 * this.cell, this.y0 + j0 * this.cell, this.x0 + i1 * this.cell, this.y0 + j1 * this.cell]);
  }
  // Few, large rectangles covering the cells of pred (greedy largest-rectangle cover)
  coverRects(pred, { minArea = 0.25e6, maxRects = 10, target = 0.96 } = {}) {
    const { w, h } = this;
    let i0 = w, i1 = -1, j0 = h, j1 = -1, total = 0;
    for (let p = 0; p < w * h; p++) if (pred(p)) { const i = p % w, j = (p - i) / w; if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; total++; }
    if (!total) return [];
    const W = i1 - i0 + 1, Hh = j1 - j0 + 1;
    const mask = new Uint8Array(W * Hh);
    for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) mask[j * W + i] = pred((j + j0) * w + i + i0) ? 1 : 0;
    const out = [];
    let covered = 0;
    const heights = new Int32Array(W);
    for (let n = 0; n < maxRects; n++) {
      heights.fill(0);
      let best = { a: 0 };
      for (let j = 0; j < Hh; j++) {
        for (let i = 0; i < W; i++) heights[i] = mask[j * W + i] ? heights[i] + 1 : 0;
        const st = [];
        for (let i = 0; i <= W; i++) {
          const hh = i < W ? heights[i] : 0;
          let start = i;
          while (st.length && st[st.length - 1][1] >= hh) {
            const [si, sh] = st.pop();
            const a = sh * (i - si);
            if (a > best.a) best = { a, x0: si, x1: i, y0: j - sh + 1, y1: j + 1 };
            start = si;
          }
          st.push([start, hh]);
        }
      }
      if (!best.a || best.a * this.cell * this.cell < minArea) break;
      for (let j = best.y0; j < best.y1; j++) for (let i = best.x0; i < best.x1; i++) mask[j * W + i] = 0;
      out.push([this.x0 + (best.x0 + i0) * this.cell, this.y0 + (best.y0 + j0) * this.cell, this.x0 + (best.x1 + i0) * this.cell, this.y0 + (best.y1 + j0) * this.cell]);
      covered += best.a;
      if (covered >= total * target) break;
    }
    return out;
  }
  // Outer boundary polygons (mm) of cells satisfying pred. Returns array of closed orthogonal loops.
  trace(pred) {
    const { w, h } = this;
    const inside = (i, j) => i >= 0 && j >= 0 && i < w && j < h && pred(j * w + i);
    // directed boundary edges with inside on the left (y down → clockwise on screen)
    const edges = new Map();
    const add = (x1, y1, x2, y2) => { const k = x1 + ',' + y1; const l = edges.get(k); if (l) l.push([x2, y2]); else edges.set(k, [[x2, y2]]); };
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      if (!inside(i, j)) continue;
      if (!inside(i, j - 1)) add(i, j, i + 1, j);
      if (!inside(i + 1, j)) add(i + 1, j, i + 1, j + 1);
      if (!inside(i, j + 1)) add(i + 1, j + 1, i, j + 1);
      if (!inside(i - 1, j)) add(i, j + 1, i, j);
    }
    const loops = [];
    while (edges.size) {
      const [k0] = edges.keys();
      let [x, y] = k0.split(',').map(Number);
      const loop = [];
      let px = null, py = null, guard = 0;
      while (guard++ < 1e7) {
        const k = x + ',' + y; const list = edges.get(k);
        if (!list || !list.length) break;
        let idx = 0;
        if (list.length > 1 && px !== null) {
          // at a pinch point take the right-hand turn (keeps diagonal-touching cells apart)
          const dx = x - px, dy = y - py;
          const score = ([nx, ny]) => { const ex = nx - x, ey = ny - y; return dx * ey - dy * ex; };
          idx = list.map((q, i) => [score(q), i]).sort((a, b) => b[0] - a[0])[0][1];
        }
        const nx = list.splice(idx, 1)[0];
        if (!list.length) edges.delete(k);
        loop.push([x, y]);
        px = x; py = y;
        [x, y] = nx;
      }
      if (loop.length >= 4) loops.push(simplifyOrtho(loop).map(([i, j]) => [this.x0 + i * this.cell, this.y0 + j * this.cell]));
    }
    return loops;
  }
}

export function simplifyOrtho(pts) {
  const out = [];
  const n = pts.length;
  for (let k = 0; k < n; k++) {
    const p = pts[(k - 1 + n) % n], c = pts[k], q = pts[(k + 1) % n];
    const col = (p[0] === c[0] && c[0] === q[0]) || (p[1] === c[1] && c[1] === q[1]);
    if (!col) out.push(c);
  }
  return out;
}

export function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}
