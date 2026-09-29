// Wall detection from line work (all units mm, +y down).
// 1. Find the drawing's dominant direction and square it up.
// 2. Collect near-horizontal / near-vertical strokes and merge collinear pieces.
// 3. Pair parallel strokes 70–400 mm apart with nothing drawn between them → wall pieces.
// 4. Keep pieces whose thickness is common in the drawing and that form a connected network.

export const TMIN = 70, TMAX = 400;

export function dominantAngle(segs) {
  const bins = new Float64Array(180); // 0.5° bins over 0..90
  for (const s of segs) {
    if (s.curve) continue;
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1, L = Math.hypot(dx, dy);
    if (L < 300) continue;
    let a = Math.atan2(dy, dx) * 180 / Math.PI;
    a = ((a % 90) + 90) % 90;
    bins[Math.min(179, Math.floor(a * 2))] += L;
  }
  let best = 0;
  for (let i = 1; i < 180; i++) if (bins[i] > bins[best]) best = i;
  // weighted refinement around the peak
  let sw = 0, sa = 0;
  for (let k = -2; k <= 2; k++) {
    const i = (best + k + 180) % 180;
    let a = (i + 0.5) / 2; if (best + k < 0) a -= 90; if (best + k >= 180) a += 90;
    sw += bins[i]; sa += bins[i] * a;
  }
  let a = sa / (sw || 1);
  if (a > 45) a -= 90;
  return a * Math.PI / 180;
}

// Axis-aligned strokes. Returns {H, V}; each item {c, a, b, w}: c = constant coordinate, [a,b] extent.
export function axisStrokes(d, { tolDeg = 0.7, minLen = 25, skipDash = true } = {}) {
  const tol = Math.tan(tolDeg * Math.PI / 180);
  const H = [], V = [];
  for (const s of d.segs) {
    if (s.curve) continue;
    if (skipDash && s.dash) continue;
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    if (adx >= minLen && ady <= tol * adx) H.push({ c: (s.y1 + s.y2) / 2, a: Math.min(s.x1, s.x2), b: Math.max(s.x1, s.x2), w: s.w || 0.25, fe: s.fillEdge ? 1 : 0 });
    else if (ady >= minLen && adx <= tol * ady) V.push({ c: (s.x1 + s.x2) / 2, a: Math.min(s.y1, s.y2), b: Math.max(s.y1, s.y2), w: s.w || 0.25, fe: s.fillEdge ? 1 : 0 });
  }
  return { H: mergeCollinear(H), V: mergeCollinear(V) };
}

export function mergeCollinear(L, ctol = 1.5, gap = 2) {
  L.sort((p, q) => p.c - q.c || p.a - q.a);
  const out = [];
  let i = 0;
  while (i < L.length) {
    let j = i;
    while (j + 1 < L.length && L[j + 1].c - L[i].c < ctol) j++;
    const grp = L.slice(i, j + 1).sort((p, q) => p.a - q.a);
    let cur = null;
    for (const s of grp) {
      if (cur && s.a <= cur.b + gap) { cur.b = Math.max(cur.b, s.b); cur.w = Math.max(cur.w, s.w); cur.n++; cur.cs += s.c; }
      else { if (cur) out.push(fin(cur)); cur = { ...s, n: 1, cs: s.c }; }
    }
    if (cur) out.push(fin(cur));
    i = j + 1;
  }
  out.sort((p, q) => p.c - q.c || p.a - q.a);
  return out;
  function fin(c) { c.c = c.cs / c.n; delete c.cs; delete c.n; return c; }
}

// Pair strokes into wall pieces {o:'H'|'V', c0, c1, a, b, t}
export function pairStrokes(L, o, { tmin = TMIN, tmax = TMAX, minOverlap = 120 } = {}) {
  const out = [];
  for (let i = 0; i < L.length; i++) {
    const A = L[i];
    for (let j = i + 1; j < L.length && L[j].c - A.c <= tmax; j++) {
      const B = L[j];
      const t = B.c - A.c;
      if (t < tmin) continue;
      const lo = Math.max(A.a, B.a), hi = Math.min(A.b, B.b);
      if (hi - lo < minOverlap) continue;
      let ivs = [[lo, hi]];
      for (let k = i + 1; k < j && ivs.length; k++) {
        const C = L[k];
        if (C.c - A.c < 4 || B.c - C.c < 4) continue;
        if (C.b <= lo || C.a >= hi) continue;
        ivs = subtract(ivs, C.a, C.b);
      }
      for (const [a, b] of ivs) if (b - a >= minOverlap) out.push({ o, c0: A.c, c1: B.c, a, b, t, w: Math.max(A.w, B.w) });
    }
  }
  return out;
}

function subtract(ivs, a, b) {
  const out = [];
  for (const [p, q] of ivs) {
    if (b <= p || a >= q) { out.push([p, q]); continue; }
    if (a > p) out.push([p, a]);
    if (b < q) out.push([b, q]);
  }
  return out;
}

export function pieceRect(p) {
  return p.o === 'H' ? [p.a, p.c0, p.b, p.c1] : [p.c0, p.a, p.c1, p.b];
}

// Thickness clusters (length-weighted), returns sorted list of {t, len}
export function thicknessPeaks(pieces) {
  const bins = new Map();
  for (const p of pieces) {
    const k = Math.round(p.t / 5) * 5;
    bins.set(k, (bins.get(k) || 0) + (p.b - p.a));
  }
  const arr = [...bins.entries()].map(([t, len]) => ({ t, len })).sort((a, b) => a.t - b.t);
  // merge neighbouring bins into peaks
  const peaks = [];
  for (const b of arr) {
    const last = peaks[peaks.length - 1];
    if (last && b.t - last.tMax <= 10) { last.len += b.len; last.tMax = b.t; if (b.len > last.best) { last.best = b.len; last.t = b.t; } }
    else peaks.push({ t: b.t, tMin: b.t, tMax: b.t, len: b.len, best: b.len });
  }
  return peaks.sort((a, b) => b.len - a.len);
}

// Connected networks of pieces (touching within tol mm). Returns array of index arrays.
export function networks(pieces, tol = 30) {
  const n = pieces.length;
  const R = pieces.map(pieceRect);
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  // grid bucketing
  const cell = 2000, buckets = new Map();
  R.forEach((r, i) => {
    for (let gx = Math.floor((r[0] - tol) / cell); gx <= Math.floor((r[2] + tol) / cell); gx++)
      for (let gy = Math.floor((r[1] - tol) / cell); gy <= Math.floor((r[3] + tol) / cell); gy++) {
        const k = gx + ',' + gy; let b = buckets.get(k); if (!b) buckets.set(k, b = []); b.push(i);
      }
  });
  for (const b of buckets.values()) {
    for (let x = 0; x < b.length; x++) for (let y = x + 1; y < b.length; y++) {
      const i = b[x], j = b[y], p = R[i], q = R[j];
      if (p[0] - tol <= q[2] && q[0] - tol <= p[2] && p[1] - tol <= q[3] && q[1] - tol <= p[3]) {
        const a = find(i), c = find(j); if (a !== c) parent[a] = c;
      }
    }
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) { const r = find(i); let g = groups.get(r); if (!g) groups.set(r, g = []); g.push(i); }
  return [...groups.values()];
}

// Full first pass on a whole drawing (mm): candidate wall pieces + networks
export function wallCandidates(dmm) {
  const { H, V } = axisStrokes(dmm);
  let pieces = pairStrokes(H, 'H').concat(pairStrokes(V, 'V'));
  const peaks = thicknessPeaks(pieces);
  const total = peaks.reduce((s, p) => s + p.len, 0);
  // accept thickness peaks carrying at least 4% of all paired length (and ≥ 3 m)
  const good = peaks.filter(p => p.len >= Math.max(3000, total * 0.04));
  const ok = t => good.some(p => t >= p.tMin - 8 && t <= p.tMax + 8);
  pieces = pieces.filter(p => ok(p.t));
  return { pieces, peaks: good, H, V };
}
