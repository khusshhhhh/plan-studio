// Neutral drawing format shared by the DWG/DXF and PDF importers.
// Coordinates are in "drawing units" (CAD units or PDF points) with +x right and +y down.
//   segs    {x1,y1,x2,y2, w (pen mm), l (layer), dash, curve, blk, sym, col}
//   arcs    {cx,cy,r,a0,a1,sweep,pts, ...}   a0/a1 = end-point angles, sweep in radians (0..2π)
//   circles {x,y,r}
//   fills   {pts, col}      solid-filled polygons (wall poche, hatches)
//   polys   {pts}           closed polylines (for reference)
//   texts   {t, x, y, h, rot, w}  x/y = approximate centre of the text
//   dims    {a, b, dp, tp, value, text}   CAD dimensions (value in drawing units)
//   symbols {name, x, y, rot, bbox}       named block inserts (CAD only)

export function newDrawing(kind) {
  return {
    kind, unitToMm: 1, meta: {},
    segs: [], arcs: [], circles: [], fills: [], polys: [], texts: [], dims: [], symbols: [],
    bbox: null,
  };
}

export function pushSeg(d, x1, y1, x2, y2, o = {}) {
  if (!isFinite(x1) || !isFinite(y1) || !isFinite(x2) || !isFinite(y2)) return;
  if (x1 === x2 && y1 === y2) return;
  d.segs.push({ x1, y1, x2, y2, ...o });
}

export function pushArc(d, cx, cy, r, a0, a1, ccw, pts, o = {}) {
  if (!(r > 0) || !isFinite(cx)) return;
  let sweep = ccw ? a1 - a0 : a0 - a1;
  while (sweep <= 0) sweep += Math.PI * 2;
  while (sweep > Math.PI * 2 + 1e-9) sweep -= Math.PI * 2;
  d.arcs.push({ cx, cy, r, a0, a1, sweep, ccw, pts, ...o });
}

export function pushText(d, t, x, y, h, rot, o = {}) {
  if (!t || !isFinite(x) || !isFinite(y)) return;
  d.texts.push({ t: String(t), x, y, h, rot: rot || 0, ...o });
}

export function finishDrawing(d) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; };
  for (const s of d.segs) { add(s.x1, s.y1); add(s.x2, s.y2); }
  for (const a of d.arcs) { add(a.cx - a.r, a.cy - a.r); add(a.cx + a.r, a.cy + a.r); }
  d.bbox = x0 === Infinity ? [0, 0, 1, 1] : [x0, y0, x1, y1];
  return d;
}

// Crop a drawing to a rectangle (drawing units). Returns a shallow copy.
export function cropDrawing(d, [x0, y0, x1, y1]) {
  const inR = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  const o = { ...d };
  o.segs = d.segs.filter(s => inR(s.x1, s.y1) || inR(s.x2, s.y2));
  o.arcs = d.arcs.filter(a => inR(a.cx, a.cy));
  o.circles = d.circles.filter(c => inR(c.x, c.y));
  o.fills = d.fills.filter(f => f.pts.some(p => inR(p[0], p[1])));
  o.polys = d.polys.filter(f => f.pts.some(p => inR(p[0], p[1])));
  o.texts = d.texts.filter(t => inR(t.x, t.y));
  o.dims = d.dims.filter(t => inR(t.a[0], t.a[1]) || inR(t.b[0], t.b[1]));
  o.symbols = d.symbols.filter(t => inR(t.x, t.y));
  o.bbox = [x0, y0, x1, y1];
  return o;
}

// Transform every coordinate with (x, y) → (s·(x − ox), s·(y − oy)) then rotate by −rot about origin.
export function transformDrawing(d, { s = 1, ox = 0, oy = 0, rot = 0 }) {
  const c = Math.cos(-rot), n = Math.sin(-rot);
  const T = (x, y) => { const X = (x - ox) * s, Y = (y - oy) * s; return [X * c - Y * n, X * n + Y * c]; };
  const o = newDrawing(d.kind);
  o.meta = d.meta; o.unitToMm = 1;
  for (const q of d.segs) { const [a, b] = T(q.x1, q.y1), [e, f] = T(q.x2, q.y2); o.segs.push({ ...q, x1: a, y1: b, x2: e, y2: f }); }
  for (const q of d.arcs) {
    const [cx, cy] = T(q.cx, q.cy);
    o.arcs.push({ ...q, cx, cy, r: q.r * s, a0: q.a0 - rot, a1: q.a1 - rot, pts: q.pts ? q.pts.map(p => T(p[0], p[1])) : null });
  }
  for (const q of d.circles) { const [x, y] = T(q.x, q.y); o.circles.push({ ...q, x, y, r: q.r * s }); }
  for (const q of d.fills) o.fills.push({ ...q, pts: q.pts.map(p => T(p[0], p[1])) });
  for (const q of d.polys) o.polys.push({ ...q, pts: q.pts.map(p => T(p[0], p[1])) });
  for (const q of d.texts) { const [x, y] = T(q.x, q.y); o.texts.push({ ...q, x, y, h: q.h * s, w: (q.w || 0) * s, rot: q.rot - rot }); }
  for (const q of d.dims) o.dims.push({ ...q, a: T(...q.a), b: T(...q.b), dp: T(...q.dp), tp: T(...q.tp), value: q.value });
  for (const q of d.symbols) {
    const [x, y] = T(q.x, q.y);
    let bbox = null;
    if (q.bbox) { const p = T(q.bbox[0], q.bbox[1]), r = T(q.bbox[2], q.bbox[3]); bbox = [Math.min(p[0], r[0]), Math.min(p[1], r[1]), Math.max(p[0], r[0]), Math.max(p[1], r[1])]; }
    o.symbols.push({ ...q, x, y, rot: q.rot - rot, scale: (q.scale || 1) * s, bbox });
  }
  return finishDrawing(o);
}
