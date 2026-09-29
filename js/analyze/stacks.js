// Layered-wall detection by sweeping along each axis.
// At every position along the axis, the parallel strokes that cover it are grouped into
// "stacks" (consecutive strokes ≤ gapMax apart). A stack 70–400 mm thick is a wall (or a
// window/sliding door drawn inside a wall). Its inner-line pattern is its "signature":
// walls and windows in the same wall line have different signatures, which is how windows
// are told apart from solid wall even when the wall faces run straight through them.

export function sweepStacks(L, o, { gapMax = 110, tmin = 70, tmax = 400, minLen = 40 } = {}) {
  // quantise coordinates to 0.5 mm for stable comparisons
  const lines = L.map(s => ({ c: Math.round(s.c * 2) / 2, a: s.a, b: s.b, w: s.w }));
  const ev = new Set();
  for (const s of lines) { ev.add(Math.round(s.a)); ev.add(Math.round(s.b)); }
  const xs = [...ev].sort((p, q) => p - q);
  const byStart = lines.slice().sort((p, q) => p.a - q.a);
  let si = 0;
  let active = [];
  const pieces = [];
  const open = new Map(); // key → piece being extended
  for (let i = 0; i + 1 < xs.length; i++) {
    const x0 = xs[i], x1 = xs[i + 1];
    if (x1 - x0 < 0.5) continue;
    while (si < byStart.length && byStart[si].a <= x0 + 0.5) { active.push(byStart[si]); si++; }
    active = active.filter(s => s.b >= x1 - 0.5);
    const cov = active.filter(s => s.a <= x0 + 0.5).map(s => s.c).sort((p, q) => p - q);
    const uniq = [];
    for (const c of cov) if (!uniq.length || c - uniq[uniq.length - 1] > 1.5) uniq.push(c);
    const found = new Set();
    let k = 0;
    while (k < uniq.length) {
      let j = k;
      while (j + 1 < uniq.length && uniq[j + 1] - uniq[j] <= gapMax) j++;
      const c0 = uniq[k], c1 = uniq[j], t = c1 - c0;
      if (t >= tmin && t <= tmax) {
        const inner = uniq.slice(k + 1, j).map(c => Math.round((c - c0) / 5) * 5);
        // canonical signature: a wall drawn mirrored (outside face on the other side) matches
        const mir = inner.map(v => Math.round((t - v) / 5) * 5).reverse();
        const sa = inner.join(','), sb = mir.join(',');
        const sig = sa <= sb ? sa : sb;
        const key = c0 + '|' + c1;
        found.add(key);
        const p = open.get(key);
        if (p && p.sig === sig && Math.abs(p.b - x0) < 1) p.b = x1;
        else {
          if (p) { open.delete(key); if (p.b - p.a >= minLen) pieces.push(p); }
          open.set(key, { o, c0, c1, t, a: x0, b: x1, sig, n: inner.length });
        }
      } else if (j > k && t > tmax) {
        // thick bundle: try the wall-like sub-bundles at either edge (e.g. wall + cabinet line)
      }
      k = j + 1;
    }
    for (const [key, p] of open) if (!found.has(key)) { open.delete(key); if (p.b - p.a >= minLen) pieces.push(p); }
  }
  for (const p of open.values()) if (p.b - p.a >= minLen) pieces.push(p);
  return pieces;
}

// Face-line lookup: does a stroke at coordinate c cover [a, b]?
export function lineIndex(L) {
  const sorted = L.slice().sort((p, q) => p.c - q.c);
  const cs = sorted.map(s => s.c);
  const lower = v => { let lo = 0, hi = cs.length; while (lo < hi) { const m = (lo + hi) >> 1; if (cs[m] < v) lo = m + 1; else hi = m; } return lo; };
  return {
    // max extent of lines at c (±tol) that contain point x; returns [a, b] or null
    at(c, x, tol = 2) {
      let best = null;
      for (let i = lower(c - tol); i < cs.length && cs[i] <= c + tol; i++) {
        const s = sorted[i];
        if (s.a <= x + 1 && s.b >= x - 1) best = best ? [Math.min(best[0], s.a), Math.max(best[1], s.b)] : [s.a, s.b];
      }
      return best;
    },
    covers(c, a, b, tol = 2) {
      for (let i = lower(c - tol); i < cs.length && cs[i] <= c + tol; i++) { const s = sorted[i]; if (s.a <= a + 2 && s.b >= b - 2) return true; }
      return false;
    },
    near(c, tol) { const out = []; for (let i = lower(c - tol); i < cs.length && cs[i] <= c + tol; i++) out.push(sorted[i]); return out; },
    all: sorted,
  };
}
