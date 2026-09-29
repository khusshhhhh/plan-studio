// Room segmentation on a raster.
// Barriers are walls/openings (1) and any other drawn line (3). The outside is flooded from
// the border; the remaining regions are merged or discarded by how much of their boundary is
// real wall, how thin they are, and whether they carry a room label. This closes the leaks
// left by openings the recogniser missed (a door leaf or slab edge still blocks the flood)
// without splitting rooms along furniture lines.
import { Grid } from './raster.js';

export function segmentRooms(wallsG, segs, labels) {
  const G = wallsG.clone();
  const { w, h } = G;
  // line barriers
  for (const s of segs) {
    if (s.curve || s.dash) continue;
    const dx = Math.abs(s.x2 - s.x1), dy = Math.abs(s.y2 - s.y1);
    const L = Math.hypot(dx, dy);
    if (L < 200) continue;
    // only square lines block (roof hips, hatching and furniture diagonals do not)
    if (Math.min(dx, dy) > L * 0.035) continue;
    const i0 = G.ix(s.x1), j0 = G.iy(s.y1), i1 = G.ix(s.x2), j1 = G.iy(s.y2);
    const n = Math.max(Math.abs(i1 - i0), Math.abs(j1 - j0), 1);
    for (let k = 0; k <= n; k++) {
      const i = Math.round(i0 + (i1 - i0) * k / n), j = Math.round(j0 + (j1 - j0) * k / n);
      if (i >= 0 && j >= 0 && i < w && j < h && G.a[j * w + i] === 0) G.a[j * w + i] = 3;
    }
  }
  G.floodBorder(0, 2);
  const { labels: comp, comps } = G.components(0);
  const N = comps.length;
  const cellA = G.cell * G.cell / 1e6;

  // boundary stats & neighbours through thin line barriers
  const st = comps.map(c => ({ id: c.id, n: c.n, wallB: 0, lineB: 0, extAdj: 0, nb: new Map(), label: null, status: 'unk' }));
  const dirs = [1, -1, w, -w];
  for (const c of comps) {
    const S = st[c.id];
    for (const p of c.cells) {
      const x = p % w;
      for (const d of dirs) {
        if ((d === 1 && x === w - 1) || (d === -1 && x === 0)) continue;
        const q = p + d;
        if (q < 0 || q >= w * h) continue;
        const v = G.a[q];
        if (v === 1) S.wallB++;
        else if (v === 3) {
          S.lineB++;
          let r = q, k = 0;
          while (k < 4 && r >= 0 && r < w * h && G.a[r] === 3) { r += d; k++; }
          if (r < 0 || r >= w * h) continue;
          if (G.a[r] === 2) S.extAdj++;
          else if (G.a[r] === 0 && comp[r] !== c.id) S.nb.set(comp[r], (S.nb.get(comp[r]) || 0) + 1);
        }
      }
    }
  }
  for (const L of labels) {
    let i = G.ix(L.x), j = G.iy(L.y);
    let p = j * w + i;
    if (G.a[p] !== 0 && G.a[p] !== 2) { const k = nearestFree(G, i, j); if (k) p = k[1] * w + k[0]; }
    L.cell = p;
    if (G.a[p] === 0) { const S = st[comp[p]]; (S.labels ||= []).push(L); }
    else L.outside = true;
  }

  // union-find merging
  const parent = Array.from({ length: N }, (_, i) => i);
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const labelled = S => S.labels && S.labels.length;
  for (const S of st) {
    const B = S.wallB + S.lineB || 1;
    S.wallFrac = S.wallB / B;
    S.thick = 2 * S.n / B * G.cell; // ≈ 2·area / perimeter (mm)
    if (labelled(S) && (S.wallFrac >= 0.3 || S.n * cellA >= 5)) S.status = 'room';
    else if (labelled(S)) S.status = 'unk'; // e.g. a name written inside a table outline
    else if (S.n * cellA < 0.08) S.status = 'ext';
  }
  let changed = true, guard = 0;
  while (changed && guard++ < 20) {
    changed = false;
    for (const S of st) {
      if (S.status !== 'unk') continue;
      const B = S.wallB + S.lineB || 1;
      const extFrac = S.extAdj / B;
      if (S.extAdj > 0 && (S.wallFrac < 0.25 || S.thick < 450 || extFrac > 0.3)) { S.status = 'ext'; changed = true; continue; }
      // neighbours that already turned out to be outside make this one outside too
      let extNb = 0, tot = 0;
      for (const [k, v] of S.nb) { tot += v; if (st[k].status === 'ext') extNb += v; }
      if (tot && extNb / tot > 0.5 && S.wallFrac < 0.4) { S.status = 'ext'; changed = true; continue; }
      const area = S.n * cellA;
      if (area < 2.5 || S.wallFrac < 0.45 || labelled(S)) {
        let best = -1, bv = 0;
        for (const [k, v] of S.nb) if (st[k].status !== 'ext' && find(k) !== find(S.id) && v > bv) { bv = v; best = k; }
        if (best >= 0) { parent[find(S.id)] = find(best); S.status = 'merged'; changed = true; }
        else if (labelled(S)) { S.status = 'room'; changed = true; }
      }
    }
  }
  // groups
  const groups = new Map();
  for (const S of st) {
    if (S.status === 'ext') continue;
    const r = find(S.id);
    if (st[r].status === 'ext') continue;
    let g = groups.get(r); if (!g) groups.set(r, g = { comps: [], labels: [], n: 0, wallB: 0, lineB: 0 });
    g.comps.push(S.id); g.n += S.n; g.wallB += S.wallB; g.lineB += S.lineB;
    if (S.labels) g.labels.push(...S.labels);
  }
  const out = [];
  for (const g of groups.values()) {
    const area = g.n * cellA;
    if (area < 0.3) continue;
    const wallFrac = g.wallB / ((g.wallB + g.lineB) || 1);
    if (!g.labels.length && (wallFrac < 0.5 || area < 0.6)) continue;
    const set = new Set(g.comps);
    out.push({ comps: set, labels: g.labels, area, wallFrac });
  }
  return { G, comp, groups: out, isOutside: (x, y) => { const p = G.iy(y) * w + G.ix(x); const v = G.a[p]; if (v === 2) return true; if (v !== 0) return null; return !out.some(o => o.comps.has(comp[p])); } };
}

function nearestFree(G, i, j) {
  for (let r = 1; r < 14; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
    const v = G.get(i + di, j + dj);
    if (v === 0 || v === 2) return [i + di, j + dj];
  }
  return null;
}

export { Grid };
