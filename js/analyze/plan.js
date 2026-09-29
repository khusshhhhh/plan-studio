// Floor plan recognition: drawing (mm, one plan view) → building model.
// Walls come from layered line stacks, windows from stacks whose inner-line signature differs
// from the solid wall's, doors and arches from gaps (door swing arcs / labels as evidence),
// rooms from a flood fill between walls, and the roof outline from the building footprint.
import { axisStrokes, thicknessPeaks } from './walls.js';
import { sweepStacks, lineIndex } from './stacks.js';
import { Grid, polyArea } from './raster.js';
import { segmentRooms } from './rooms.js';
import { roomTypeOf, prettyRoomName, parseOpeningLabel, fixtureOf, symbolTypeOf, WET } from './text.js';

const lum = hex => {
  if (!hex || hex[0] !== '#' || hex.length < 7) return 0;
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};
const isHatchPen = s => s.col && lum(s.col) > 0.3 && (s.w || 0) < 0.2;

export function analyzePlan(d, opts = {}) {
  const notes = [];
  const segs = d.kind === 'pdf' && !globalThis.NOFILTER ? d.segs.filter(s => !isHatchPen(s)) : d.segs;
  const { H, V } = axisStrokes({ segs });
  const IDX = { H: lineIndex(H), V: lineIndex(V) };

  // ------------------------------------------------------------------ stacks → runs
  const pieces = sweepStacks(H, 'H').concat(sweepStacks(V, 'V'));
  let groups = bandGroups(pieces);
  let runs = [];
  for (const g of groups) runs.push(...toRuns(g));

  // thickness classes carrying real wall length
  const peaks = thicknessPeaks(runs.filter(r => r.b - r.a >= 300).map(r => ({ t: r.t, a: r.a, b: r.b })));
  const total = peaks.reduce((s, p) => s + p.len, 0);
  const good = peaks.filter(p => p.len >= Math.max(2000, total * 0.03));
  const dbg = { all: runs.slice() };
  const okT = r => good.some(p => r.t >= p.tMin - 10 && r.t <= p.tMax + 10);
  const kept = runs.filter(okT), rejected = runs.filter(r => !okT(r));
  // Rescue: a stack thickened by an extra line (meter box, cabinet, sill…) that contains the
  // band of a collinear wall nearby is that wall.
  for (const r of rejected) {
    const cs = new Set([r.c0, r.c1]);
    for (const p of r.parts) for (const v of p.sig.split(',').filter(Boolean)) cs.add(r.c0 + +v);
    const has = c => [...cs].some(v => Math.abs(v - c) <= 8);
    const k = kept.find(q => q.o === r.o && has(q.c0) && has(q.c1) && Math.max(q.a, r.a) - Math.min(q.b, r.b) <= 3000);
    if (k) kept.push({ ...r, c0: k.c0, c1: k.c1, t: k.t, parts: r.parts.map(p => ({ ...p, sig: '__rescued' })), rescued: true });
  }
  runs = kept.filter(r => r.b - r.a >= 120);
  dbg.thick = runs.slice();

  // keep the main connected network(s)
  runs = mainNetwork(runs, 260);
  dbg.net = runs.slice();
  if (!runs.length) return { error: 'No walls were found in this area. Try another page/view, or check the scale.' };

  // ------------------------------------------------------------------ signatures → walls vs window candidates
  // cluster similar signatures (±8 mm, mirrored drawing allowed) per thickness class
  const clusters = []; // {tc, rep, len}
  for (const r of runs) for (const p of r.parts) {
    if (p.sig === '__rescued') continue;
    const tc = Math.round(r.t / 10);
    let c = clusters.find(q => q.tc === tc && sameSig(q.rep, p.sig, r.t));
    if (!c) clusters.push(c = { tc, rep: p.sig, len: 0 });
    c.len += p.b - p.a;
  }
  const domSig = t => {
    const tc = Math.round(t / 10);
    let best = null;
    for (const c of clusters) if (c.tc === tc && (!best || c.len > best.len)) best = c;
    return best ? best.rep : '';
  };
  const segsOut = []; // {o,c0,c1,a,b,kind:'wall'|'win'}
  for (const r of runs) {
    const dom = domSig(r.t);
    const hasDom = r.parts.some(p => sameSig(p.sig, dom, r.t)) || r.rescued;
    let cur = null;
    for (const p of r.parts) {
      const kind = !hasDom || p.sig === '__rescued' || sameSig(p.sig, dom, r.t) ? 'wall' : 'win';
      if (cur && cur.kind === kind && p.a - cur.b <= 5) cur.b = Math.max(cur.b, p.b);
      else { if (cur) segsOut.push(cur); cur = { o: r.o, c0: r.c0, c1: r.c1, t: r.t, a: p.a, b: p.b, kind, sig: p.sig }; }
    }
    if (cur) segsOut.push(cur);
  }
  // window candidates must be window sized, otherwise they are wall
  for (const s of segsOut) if (s.kind === 'win' && (s.b - s.a < 480 || s.b - s.a > 6500)) s.kind = 'wall';
  // rebuild runs as ordered lists of segments (collinear, same band)
  dbg.segsOut = segsOut.map(x => ({ ...x }));
  let lines = linesOf(segsOut);

  // ------------------------------------------------------------------ gaps: fill, junctions, openings
  const cands = [];
  for (const ln of lines) {
    const idx = IDX[ln.o];
    const merged = [ln.items[0]];
    for (let i = 1; i < ln.items.length; i++) {
      const p = merged[merged.length - 1], q = ln.items[i];
      const g = q.a - p.b;
      if (g <= 5) { merged.push(q); continue; }
      const f0 = idx.covers(ln.c0, p.b, q.a, 3), f1 = idx.covers(ln.c1, p.b, q.a, 3);
      if ((f0 && f1) || ((f0 || f1) && g < 350)) { merged.push({ ...p, a: p.b, b: q.a, kind: 'wall', fill: true }); merged.push(q); continue; }
      if (g >= 350 && g <= 6500) cands.push({ o: ln.o, c0: ln.c0, c1: ln.c1, t: ln.t, a: p.b, b: q.a, bounded: 2 });
      merged.push(q);
    }
    ln.items = merged;
  }
  // corners & half-bounded gaps against perpendicular walls
  lines = linesOf(lines.flatMap(l => l.items));
  const perp = o => lines.filter(l => l.o !== o);
  for (const ln of lines) {
    const P = perp(ln.o);
    for (const end of ['a', 'b']) {
      const first = end === 'a' ? ln.items[0] : ln.items[ln.items.length - 1];
      const e = first[end], dir = end === 'a' ? -1 : 1;
      let best = null;
      for (const p of P) {
        // p's band must lie ahead of (or at) the end, p's extent must reach our band
        const reach = p.a <= ln.c1 + 25 && p.b >= ln.c0 - 25;
        if (!reach) continue;
        const near = dir > 0 ? p.c0 - e : e - p.c1;   // distance to p's facing face
        const inside = e >= p.c0 - 5 && e <= p.c1 + 5;
        if (!(inside || (near >= -5 && near <= 6500))) continue;
        const dist = inside ? 0 : Math.max(0, near);
        if (!best || dist < best.dist) best = { p, dist, inside };
      }
      if (!best) continue;
      const p = best.p;
      const covers = p.a <= ln.c0 + 5 && p.b >= ln.c1 - 5;
      if (best.dist < 350) {
        // extend to touch p; across p's band as well when p does not cover our band (L corner)
        const face = dir > 0 ? p.c0 : p.c1, far = dir > 0 ? p.c1 : p.c0;
        const target = covers ? face : far;
        if (dir > 0 && target > e) first.b = target;
        if (dir < 0 && target < e) first.a = target;
        if (!covers) { // make the corner square belong to this wall, trim p if it overlaps
          ln.corner = true;
        }
      } else if (covers && best.dist <= 6500) {
        const a = dir > 0 ? e : p.c1, b = dir > 0 ? p.c0 : e;
        cands.push({ o: ln.o, c0: ln.c0, c1: ln.c1, t: ln.t, a, b, bounded: 1 });
      }
    }
  }
  lines = linesOf(lines.flatMap(l => l.items));

  // Wall + window rectangles
  let wallSegs = lines.flatMap(l => l.items);
  dbg.beforeRC = wallSegs.map(x => ({ ...x }));
  wallSegs = removeCovered(wallSegs);
  dbg.afterRC = wallSegs.map(x => ({ ...x }));
  // Hatched walls (typical of PDFs): an un-hatched stretch of a hatched wall is a window
  {
    const hatch = d.segs.filter(q => {
      const dx = Math.abs(q.x2 - q.x1), dy = Math.abs(q.y2 - q.y1), L = Math.hypot(dx, dy);
      if (L < 30 || L > 700) return false;
      const ang = Math.atan2(dy, dx) * 180 / Math.PI;
      return ang > 20 && ang < 70;
    });
    const poche = (d.fills || []).filter(f => f.pts.length <= 12 && lum(f.col || '#000') < 0.75).map(f => {
      const xs = f.pts.map(p => p[0]), ys = f.pts.map(p => p[1]);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }).filter(r => Math.min(r[2] - r[0], r[3] - r[1]) >= 30 && Math.min(r[2] - r[0], r[3] - r[1]) <= 450);
    if (hatch.length > 50 || poche.length > 20) {
      const BIN = 50;
      const out = [];
      for (const sg of wallSegs) {
        if (sg.kind !== 'wall' || sg.b - sg.a < 900) { out.push(sg); continue; }
        const n = Math.ceil((sg.b - sg.a) / BIN), bins = new Uint8Array(n);
        for (const q of hatch) {
          const steps = 6;
          for (let t = 0; t <= steps; t++) {
            const x = q.x1 + (q.x2 - q.x1) * t / steps, y = q.y1 + (q.y2 - q.y1) * t / steps;
            const al = sg.o === 'H' ? x : y, pc = sg.o === 'H' ? y : x;
            if (pc < sg.c0 + 5 || pc > sg.c1 - 5 || al < sg.a || al >= sg.b) continue;
            bins[Math.floor((al - sg.a) / BIN)] = 1;
          }
        }
        for (const r of poche) {
          const [b0, b1, l0, l1] = sg.o === 'H' ? [r[1], r[3], r[0], r[2]] : [r[0], r[2], r[1], r[3]];
          const ov = Math.min(b1, sg.c1) - Math.max(b0, sg.c0);
          if (ov < Math.min(40, (sg.c1 - sg.c0) * 0.3)) continue;
          for (let q = Math.max(0, Math.floor((l0 - sg.a) / BIN)); q < Math.min(n, Math.ceil((l1 - sg.a) / BIN)); q++) bins[q] = 1;
        }
        const cov = bins.reduce((a, v) => a + v, 0) / n;

        if (cov < 0.3) { out.push(sg); continue; }
        // runs of empty bins
        let i = 0, cur = sg.a;
        const parts = [];
        while (i < n) {
          if (bins[i]) { i++; continue; }
          let j = i; while (j < n && !bins[j]) j++;
          const a = sg.a + i * BIN, b = Math.min(sg.b, sg.a + j * BIN);
          if (b - a >= 450 && b - a <= 6000 && i > 1 && j < n - 1) parts.push([a, b]);
          i = j;
        }
        if (!parts.length) { out.push(sg); continue; }
        for (const [a, b] of parts) { if (a > cur) out.push({ ...sg, a: cur, b: a }); out.push({ ...sg, a, b, kind: 'win', hatchGap: true }); cur = b; }
        if (cur < sg.b) out.push({ ...sg, a: cur, b: sg.b });
      }
      wallSegs = out;
    }
  }

  const R = s => s.o === 'H' ? [s.a, s.c0, s.b, s.c1] : [s.c0, s.a, s.c1, s.b];

  // ------------------------------------------------------------------ rooms (raster)
  const allR = wallSegs.map(R).concat(cands.map(R));
  const bb = allR.reduce((b, r) => [Math.min(b[0], r[0]), Math.min(b[1], r[1]), Math.max(b[2], r[2]), Math.max(b[3], r[3])], [Infinity, Infinity, -Infinity, -Infinity]);
  const M = 3000, cell = opts.cell || 25;
  const wallsG = new Grid(bb[0] - M, bb[1] - M, bb[2] + M, bb[3] + M, cell);
  for (const r of allR) wallsG.fillRect(r[0], r[1], r[2], r[3], 1, cell * 0.49);

  // Lines raster for ray casting (robes, outdoor areas)
  const LG = wallsG.clone();
  for (const s of segs) {
    if (s.curve) continue;
    const L = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    if (L >= 350 && !s.dash) LG.line(s.x1, s.y1, s.x2, s.y2, 1);
  }

  // Texts: join stacked words ("MASTER" / "SUITE")
  const texts = joinStacked(d.texts);
  const roomLabels = [];
  for (const t of texts) {
    const type = roomTypeOf(t.t);
    if (!type) continue;
    roomLabels.push({ t, type, name: prettyRoomName(t.t, type), x: t.x, y: t.y });
  }
  const seg = segmentRooms(wallsG, segs, roomLabels);
  const G = seg.G, compOf = seg.comp;
  const groupOf = new Map();
  seg.groups.forEach((g, gi) => { for (const c of g.comps) groupOf.set(c, gi); });
  const inGroup0 = gi => p => G.a[p] === 0 && groupOf.get(compOf[p]) === gi;
  // include thin line cells between parts of the same room so its rectangles stay whole
  const inGroup = gi => {
    const base = inGroup0(gi), W = G.w;
    return p => base(p) || (G.a[p] === 3 && ((base(p - 1) && base(p + 1)) || (base(p - W) && base(p + W)) || (base(p - 1) || base(p + 1) || base(p - W) || base(p + W)) && lineBridge(p)));
    function lineBridge(p) { let n = 0; for (const q of [p - 1, p + 1, p - W, p + W]) if (base(q) || G.a[q] === 3) n++; return n >= 3; }
  };

  const rooms = [];
  const robes = [];
  let rid = 0;
  const addRobe = (rb) => {
    const w = rb[2] - rb[0], h = rb[3] - rb[1], area = w * h / 1e6;
    if (area < 0.25 || area > 5 || Math.min(w, h) < 350 || Math.min(w, h) > 1100) return false;
    robes.push({ rect: rb.map(Math.round), front: robeFront(wallsG, rb), name: 'Robe' });
    return true;
  };
  seg.groups.forEach((g, gi) => {
    const labs = g.labels;
    const robeLabs = labs.filter(l => l.type === 'robe');
    let zoneLabs = labs.filter(l => l.type !== 'robe');
    // "WC" written next to the pan inside a bathroom is a fixture, not a room
    if (zoneLabs.some(l => l.type !== 'wc')) zoneLabs = zoneLabs.filter(l => !(l.type === 'wc' && l.t.t.length <= 4));
    zoneLabs = zoneLabs.filter((l, i) => !zoneLabs.some((m, k) => k < i && m.type === l.type && Math.hypot(m.x - l.x, m.y - l.y) < 1200 && m.t.t === l.t.t));
    const pred = inGroup(gi);
    if (!zoneLabs.length && robeLabs.length && g.area < 4) {
      // a built-in robe drawn as its own little space
      const rr = G.rectsOf(pred);
      const bx = rr.reduce((b, r) => [Math.min(b[0], r[0]), Math.min(b[1], r[1]), Math.max(b[2], r[2]), Math.max(b[3], r[3])], [Infinity, Infinity, -Infinity, -Infinity]);
      if (addRobe(bx)) return;
    }
    if (!zoneLabs.length) {
      const r = unnamedRoom(G, pred, g.area, cell);
      r.id = 'r' + (rid++); rooms.push(r);
    } else if (zoneLabs.length === 1) {
      const L = zoneLabs[0];
      rooms.push({ id: 'r' + (rid++), name: L.name, type: L.type, rects: G.coverRects(pred), area: +g.area.toFixed(2), label: [L.x, L.y], outdoor: L.type === 'outdoor' || undefined });
    } else {
      // Split open-plan areas between their labels (nearest label, Manhattan metric keeps edges square)
      const zone = new Map();
      const counts = new Array(zoneLabs.length).fill(0);
      for (let p = 0; p < G.a.length; p++) {
        if (!pred(p)) continue;
        const x = G.cx(p % G.w), y = G.cy(Math.floor(p / G.w));
        let best = 0, bd = Infinity;
        zoneLabs.forEach((l, z) => { const dd = Math.abs(l.x - x) + Math.abs(l.y - y); if (dd < bd) { bd = dd; best = z; } });
        zone.set(p, best); counts[best]++;
      }
      zoneLabs.forEach((L, z) => {
        rooms.push({ id: 'r' + (rid++), name: L.name, type: L.type, rects: G.coverRects(p => zone.get(p) === z, { minArea: 0.15e6 }), area: +(counts[z] * cell * cell / 1e6).toFixed(2), label: [L.x, L.y], openPlan: true, outdoor: L.type === 'outdoor' || undefined });
      });
    }
    for (const L of robeLabs) { const rb = rayRect(LG, L.x, L.y, 2600); if (rb) addRobe(rb); }
  });
  numberDuplicates(rooms);

  // Outdoor rooms (alfresco, porch…) whose label sits outside every enclosed space
  for (const L of roomLabels.filter(l => l.outside)) {
    if (L.type !== 'outdoor') continue;
    const rb = rayRect(LG, L.x, L.y, 9000);
    if (!rb) continue;
    const area = (rb[2] - rb[0]) * (rb[3] - rb[1]) / 1e6;
    if (area < 1.5 || area > 90) continue;
    if (!touches(wallsG, rb, 400)) continue;
    rooms.push({ id: 'r' + (rid++), name: L.name, type: 'outdoor', rects: [rb.map(Math.round)], area: +area.toFixed(2), label: [L.x, L.y], outdoor: true });
  }
  for (const r of rooms) if (r.type === 'outdoor') r.outdoor = true;

  // ------------------------------------------------------------------ classify openings (with room context)
  const outdoorRects = rooms.filter(r => r.outdoor).flatMap(r => r.rects);
  const sideAt = (x, y) => {
    if (wallsG.at(x, y) === 1) return null;
    for (const q of outdoorRects) if (x >= q[0] && x <= q[2] && y >= q[1] && y <= q[3]) return { outside: true, room: rooms.find(r => r.rects.includes(q)) };
    const rm = roomAtPoint(rooms, x, y);
    if (rm) return { outside: false, room: rm };
    const o = seg.isOutside(x, y);
    return o === false ? { outside: false, room: null } : { outside: true, room: null };
  };
  const labelPool = texts.map(t => ({ t, p: parseOpeningLabel(t.t) })).filter(q => q.p && (q.p.w || q.p.kind));
  const usedLabels = new Set();
  const doorSyms = (d.symbols || []).filter(s => { const ty = symbolTypeOf(s.name); return ty && ty.cat === 'door'; });

  const openings = []; // {o,c0,c1,a,b,type,...}
  const consider = (c, isWinCand) => {
    const g = c.b - c.a, cm = (c.c0 + c.c1) / 2, mid = (c.a + c.b) / 2;
    const P = (al, cr) => c.o === 'H' ? [al, cr] : [cr, al];
    const off = c.t / 2 + 350;
    const s1 = sideAt(...P(mid, cm - off)), s2 = sideAt(...P(mid, cm + off));
    // evidence: swing arcs
    let door = null;
    for (const arc of d.arcs) {
      if (arc.r < g * 0.4 || arc.r > g * 1.18) continue;
      const sw = arc.sweep * 180 / Math.PI;
      if (sw < 40 || sw > 130) continue;
      const [ax, ac] = c.o === 'H' ? [arc.cx, arc.cy] : [arc.cy, arc.cx];
      if (ac < c.c0 - 220 || ac > c.c1 + 220) continue;
      const da = Math.abs(ax - c.a), db = Math.abs(ax - c.b);
      if (Math.min(da, db) > 220) continue;
      // which side does the arc bulge to?
      const mA = (arc.a0 + (arc.ccw ? 1 : -1) * arc.sweep / 2);
      const mx = arc.cx + arc.r * Math.cos(mA), my = arc.cy + arc.r * Math.sin(mA);
      const mc = c.o === 'H' ? my : mx;
      const swing = mc > cm ? 1 : -1;
      const hinge = da < db ? 'a' : 'b';
      const leaf = arc.r;
      const strong = Math.min(da, db) <= 130 && (arc.r / g >= 0.72 || arc.r < g * 0.62);
      const cand = { hinge, swing, leaf, double: arc.r < g * 0.62, strong };
      if (!door || Math.abs(leaf - g) < Math.abs(door.leaf - g)) door = cand;
    }
    if (!door) for (const s of doorSyms) {
      const [ax, ac] = c.o === 'H' ? [s.x, s.y] : [s.y, s.x];
      if (ac >= c.c0 - 300 && ac <= c.c1 + 300 && ax >= c.a - 300 && ax <= c.b + 300) { door = { hinge: Math.abs(ax - c.a) < Math.abs(ax - c.b) ? 'a' : 'b', swing: 1, leaf: g }; break; }
    }
    // evidence: nearby label with matching width
    let lab = null, lbest = Infinity;
    for (const q of labelPool) {
      if (usedLabels.has(q)) continue;
      const [lx, ly] = [q.t.x, q.t.y];
      const [la, lc] = c.o === 'H' ? [lx, ly] : [ly, lx];
      const dist = Math.hypot(la - mid, (lc - cm) * 0.7);
      if (dist > 2600) continue;
      if (q.p.w && Math.abs(q.p.w - g) > Math.max(160, g * 0.12)) continue;
      if (!q.p.w && dist > 1500) continue;
      const score = dist + (q.p.w ? Math.abs(q.p.w - g) * 2 : 600);
      if (score < lbest) { lbest = score; lab = q; }
    }
    const ext = (s1 && s1.outside) || (s2 && s2.outside);
    const inRoom = s => s && s.room;
    const types = [s1, s2].map(s => s && s.room && s.room.type);
    const outdoorSide = [s1, s2].some(s => s && s.room && s.room.type === 'outdoor');
    let type = null, style = null, obscure = false;
    let lp = lab && lab.p;
    if (lp && lp.kind) type = lp.kind;
    // a swing arc hinged right at a jamb is a door even if a nearby label says window/arch
    if (door && door.strong && (!type || type === 'arch' || type === 'win' || type === 'void')) { type = 'door'; lab = null; lp = null; }
    if (!type && door) type = 'door';
    if (!type && isWinCand) type = 'win';
    if (!type) {
      if (types.includes('garage') && ext && g >= 2000) type = 'garage';
      else if (c.bounded === 2 && !ext && g <= 1300 && !types.includes('garage')) type = 'arch';
      else if (c.bounded === 2 && ext && types.includes('garage') && g >= 1800) type = 'garage';
      else if (c.bounded === 2 && ext && outdoorSide && g >= 1500) type = 'slider';
      else if (c.bounded === 2 && ext && g <= 3700) type = 'win';
      else if (c.bounded === 2 && ext) type = 'void';
      else return;
    }
    if (type === 'win' && !lp) {
      if (!ext) return; // internal "window" stack → most likely joinery lines; keep as wall
      if (outdoorSide && g >= 1500) type = 'slider';
    }
    if (type === 'door' && door && door.double && g > 1300) style = 'double';
    if (lp && lp.style) style = lp.style;
    if (lp && lp.obscure) obscure = true;
    if (lab) usedLabels.add(lab);
    const o = {
      o: c.o, c0: c.c0, c1: c.c1, a: Math.round(c.a), b: Math.round(c.b), type, style, obscure,
      hinge: door ? door.hinge : 'a', swing: door ? door.swing : 1,
      h: lp && lp.h ? Math.round(lp.h) : null, label: lab ? lab.t.t : null,
      ext: !!ext, rooms: [s1, s2].map(s => s && s.room ? s.room.id : (s && s.outside ? 'outside' : null)),
    };
    openings.push(o);
    return o;
  };
  const closeGaps = [];
  for (const c of cands) { const o = consider(c, false); if (!o && c.bounded === 2) closeGaps.push(c); }
  for (const s of wallSegs) if (s.kind === 'win') {
    const o = consider({ ...s, bounded: 2 }, true);
    if (!o) s.kind = 'wall';
  }

  // ------------------------------------------------------------------ walls with their openings
  const walls = [];
  let wid = 0;
  const finalWalls = mergeForOutput(wallSegs.filter(s => s.kind === 'wall').concat(wallSegs.filter(s => s.kind === 'win')));
  for (const s of finalWalls) {
    const rect = R(s).map(v => Math.round(v));
    walls.push({ id: 'w' + (wid++), rect, o: s.o, t: Math.round(s.t), kind: 'int', ext: null, openings: [] });
  }
  // gaps between two pieces of the same wall with no evidence of an opening are wall
  for (const c of closeGaps) {
    const rect = c.o === 'H' ? [c.a, c.c0, c.b, c.c1] : [c.c0, c.a, c.c1, c.b];
    walls.push({ id: 'w' + (wid++), rect: rect.map(Math.round), o: c.o, t: Math.round(c.c1 - c.c0), kind: 'int', ext: null, openings: [] });
  }
  // openings are attached to the wall that spans them (create a host wall across door gaps)
  for (const op of openings) {
    const bandOv = w => { const [b0, b1] = bandOf(w); const ov = Math.min(b1, op.c1) - Math.max(b0, op.c0); return ov / Math.max(1, Math.min(b1 - b0, op.c1 - op.c0)); };
    let host = walls.find(w => w.o === op.o && bandOv(w) >= 0.6 && spanOf(w)[0] <= op.a + 2 && spanOf(w)[1] >= op.b - 2);
    if (!host) {
      const rect = op.o === 'H' ? [op.a, op.c0, op.b, op.c1] : [op.c0, op.a, op.c1, op.b];
      host = { id: 'w' + (wid++), rect: rect.map(Math.round), o: op.o, t: Math.round(op.c1 - op.c0), kind: 'int', ext: null, openings: [] };
      walls.push(host);
    }
    host.openings.push(op);
  }
  // Doors the gap analysis missed: every swing arc must have a door at its hinge
  for (const arc of d.arcs) {
    const sw = arc.sweep * 180 / Math.PI;
    if (arc.r < 550 || arc.r > 1250 || sw < 70 || sw > 110) continue;
    const e0 = [arc.cx + arc.r * Math.cos(arc.a0), arc.cy + arc.r * Math.sin(arc.a0)];
    const e1 = [arc.cx + arc.r * Math.cos(arc.a1), arc.cy + arc.r * Math.sin(arc.a1)];
    // already explained by an opening?
    let explained = false;
    for (const w of walls) for (const op of w.openings) {
      const [x1, y1, x2, y2] = w.rect, hz = w.o === 'H';
      const r = hz ? [op.a, y1, op.b, y2] : [x1, op.a, x2, op.b];
      if (arc.cx > r[0] - 200 && arc.cx < r[2] + 200 && arc.cy > r[1] - 200 && arc.cy < r[3] + 200 && (op.type === 'door' || op.type === 'garage' || op.type === 'slider')) explained = true;
    }
    if (explained) continue;
    // closed leaf lies along a wall: the endpoint whose offset is mostly along x (H wall) or y (V wall)
    for (const [ce, oe] of [[e0, e1], [e1, e0]]) {
      const dx = ce[0] - arc.cx, dy = ce[1] - arc.cy;
      const o = Math.abs(dx) > Math.abs(dy) * 2.5 ? 'H' : Math.abs(dy) > Math.abs(dx) * 2.5 ? 'V' : null;
      if (!o) continue;
      const al0 = o === 'H' ? arc.cx : arc.cy, al1 = o === 'H' ? ce[0] : ce[1], pc = o === 'H' ? arc.cy : arc.cx;
      const a = Math.round(Math.min(al0, al1) - 20), b = Math.round(Math.max(al0, al1) + 20);
      const host = walls.find(w => {
        if (w.o !== o) return false;
        const [x1, y1, x2, y2] = w.rect;
        const [t0, t1, l0, l1] = o === 'H' ? [y1, y2, x1, x2] : [x1, x2, y1, y2];
        return pc >= t0 - 160 && pc <= t1 + 160 && l0 <= a + 5 && l1 >= b - 5;
      });
      let hostW = host;
      if (!hostW) {
        // no wall across the door: bridge the gap from the nearest collinear wall
        const near = walls.filter(w => {
          if (w.o !== o) return false;
          const [x1, y1, x2, y2] = w.rect;
          const [t0, t1, l0, l1] = o === 'H' ? [y1, y2, x1, x2] : [x1, x2, y1, y2];
          return pc >= t0 - 160 && pc <= t1 + 160 && (Math.abs(l1 - a) < 450 || Math.abs(l0 - b) < 450 || (l0 < b && l1 > a));
        })[0];
        if (!near) continue;
        const [x1, y1, x2, y2] = near.rect;
        const [t0, t1, l0, l1] = o === 'H' ? [y1, y2, x1, x2] : [x1, x2, y1, y2];
        const na = Math.min(a, l1 < a ? l1 : a), nb = Math.max(b, l0 > b ? l0 : b);
        hostW = { id: 'w' + (wid++), rect: o === 'H' ? [na, t0, nb, t1] : [t0, na, t1, nb], o, t: t1 - t0, kind: 'int', ext: null, openings: [] };
        walls.push(hostW);
      }
      const host2 = hostW;
      if (host2.openings.some(op => a < op.b && b > op.a)) {
        const host = host2;
        // a window/arch sits here – turn it into the door
        const op = host.openings.find(q => a < q.b && b > q.a);
        if (op.type !== 'garage' && op.type !== 'slider') { op.type = 'door'; op.a = a; op.b = b; op.style = null; op.h = null; op.label = null; }
        break;
      }
      const [x1, y1, x2, y2] = host2.rect;
      const mid = o === 'H' ? (y1 + y2) / 2 : (x1 + x2) / 2;
      const opc = o === 'H' ? oe[1] : oe[0];
      host2.openings.push({ o, c0: o === 'H' ? y1 : x1, c1: o === 'H' ? y2 : x2, a, b, type: 'door', style: null, hinge: al0 < al1 ? 'a' : 'b', swing: opc > mid ? 1 : -1, h: null, label: null, fromArc: true });
      break;
    }
  }

  // external faces
  for (const w of walls) {
    const [x1, y1, x2, y2] = w.rect;
    const sample = (face) => {
      let n = 0, out = 0;
      const L = w.o === 'H' ? x2 - x1 : y2 - y1;
      for (let k = 0.1; k < 0.95; k += 0.1) {
        const al = (w.o === 'H' ? x1 : y1) + L * k;
        const off = 60;
        const [px, py] = w.o === 'H' ? [al, face < 0 ? y1 - off : y2 + off] : [face < 0 ? x1 - off : x2 + off, al];
        const s = sideAt(px, py); n++;
        if (s && s.outside) out++;
      }
      return out / Math.max(1, n);
    };
    const fa = sample(-1), fb = sample(1);
    if (fa > 0.35 || fb > 0.35) { w.kind = 'ext'; w.ext = w.o === 'H' ? (fa >= fb ? 'N' : 'S') : (fa >= fb ? 'W' : 'E'); }
  }
  for (const w of walls) for (const op of w.openings) { op.ext = w.kind === 'ext'; }

  // ------------------------------------------------------------------ outlines, columns, beams
  const HG = new Grid(G.x0, G.y0, G.x0 + G.w * G.cell, G.y0 + G.h * G.cell, G.cell);
  for (const wl of walls) HG.fillRect(...wl.rect, 1, cell * 0.49);
  for (const r of rooms) if (!r.outdoor) for (const q of r.rects) HG.fillRect(q[0], q[1], q[2], q[3], 1, cell * 1.01);
  const smooth = g => { const k = Math.max(1, Math.round(160 / cell)); g.dilate(k).erode(k).erode(k).dilate(k); return g; };
  smooth(HG);
  const houseLoops = HG.trace(p => HG.a[p] === 1).sort((a, b) => Math.abs(polyArea(b)) - Math.abs(polyArea(a)));
  const outline0 = houseLoops[0] || [];
  for (const q of outdoorRects) HG.fillRect(q[0], q[1], q[2], q[3], 1, cell * 0.49);
  smooth(HG);
  const roofLoops = HG.trace(p => HG.a[p] === 1).sort((a, b) => Math.abs(polyArea(b)) - Math.abs(polyArea(a)));
  const snapPts = pts => snapOutline(pts, walls, outdoorRects);
  const houseOutline = snapPts(outline0);
  const outline = snapPts(roofLoops[0] || outline0);

  // Close the envelope: stretches of the building outline with no wall get an external wall
  if (houseOutline.length >= 4) {
    const extT = Math.round(Math.max(...good.map(p => p.t), 90));
    const n = houseOutline.length;
    for (let i = 0; i < n; i++) {
      const A = houseOutline[i], B = houseOutline[(i + 1) % n];
      const o = A[1] === B[1] ? 'H' : A[0] === B[0] ? 'V' : null;
      if (!o) continue;
      const e = o === 'H' ? A[1] : A[0];
      const lo = Math.min(o === 'H' ? A[0] : A[1], o === 'H' ? B[0] : B[1]), hi = Math.max(o === 'H' ? A[0] : A[1], o === 'H' ? B[0] : B[1]);
      const mid = (lo + hi) / 2;
      const inward = o === 'H' ? (HG.at(mid, e + 60) === 1 ? 1 : -1) : (HG.at(e + 60, mid) === 1 ? 1 : -1);
      let free = [[lo, hi]];
      for (const w of walls) {
        const [x1, y1, x2, y2] = w.rect;
        const onEdge = o === 'H' ? (Math.abs(y1 - e) < 45 || Math.abs(y2 - e) < 45 || (y1 < e && y2 > e)) : (Math.abs(x1 - e) < 45 || Math.abs(x2 - e) < 45 || (x1 < e && x2 > e));
        if (!onEdge) continue;
        const [a, b] = o === 'H' ? [x1, x2] : [y1, y2];
        const nf = [];
        for (const [p, q] of free) { if (b <= p || a >= q) nf.push([p, q]); else { if (a > p) nf.push([p, a]); if (b < q) nf.push([b, q]); } }
        free = nf;
      }
      for (const [a, b] of free) {
        if (b - a < 300) continue;
        const c0 = inward > 0 ? e : e - extT, c1 = inward > 0 ? e + extT : e;
        const rect = o === 'H' ? [a, c0, b, c1] : [c0, a, c1, b];
        const nw = { id: 'w' + (wid++), rect: rect.map(Math.round), o, t: extT, kind: 'ext', ext: o === 'H' ? (inward > 0 ? 'N' : 'S') : (inward > 0 ? 'W' : 'E'), openings: [], inferred: true };
        // an open side of a garage is its garage door
        const mid2 = (a + b) / 2, probe = e + inward * (extT + 600);
        const inside = roomAtPoint(rooms, ...(o === 'H' ? [mid2, probe] : [probe, mid2]));
        if (inside && inside.type === 'garage' && b - a >= 2200) nw.openings.push({ o, c0, c1, a: Math.round(a + 250), b: Math.round(b - 250), type: 'garage', style: null, hinge: 'a', swing: 1, h: null, label: null });
        walls.push(nw);
      }
    }
  }

  const columns = [], beams = [];
  for (const r of rooms.filter(r => r.outdoor)) {
    const [x1, y1, x2, y2] = r.rects[0];
    const cs = 350;
    const corners = [[x1, y1, 1, 1], [x2, y1, -1, 1], [x2, y2, -1, -1], [x1, y2, 1, -1]];
    for (const [x, y, sx, sy] of corners) {
      if (wallsG.at(x + sx * 100, y + sy * 100) === 1 || nearMask(wallsG, x, y, 250)) continue;
      const cx0 = sx > 0 ? x : x - cs, cy0 = sy > 0 ? y : y - cs;
      columns.push({ rect: [cx0, cy0, cx0 + cs, cy0 + cs].map(Math.round), room: r.id });
    }
    // beams along open edges
    const edges = [[x1, y1, x2, y1, 'H'], [x2, y1, x2, y2, 'V'], [x1, y2, x2, y2, 'H'], [x1, y1, x1, y2, 'V']];
    for (const [ax, ay, bx, by, o] of edges) {
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      if (nearMask(wallsG, mx, my, 250)) continue;
      const bw = 350;
      const rect = o === 'H' ? [ax, ay === y1 ? ay : ay - bw, bx, ay === y1 ? ay + bw : ay] : [ax === x1 ? ax : ax - bw, ay, ax === x1 ? ax + bw : ax, by];
      beams.push({ rect: rect.map(Math.round), room: r.id });
    }
  }

  // ------------------------------------------------------------------ fixtures & symbols, ceilings
  const fixtures = [];
  for (const t of d.texts) {
    const f = fixtureOf(t.t);
    if (!f) continue;
    const rm = roomAtPoint(rooms, t.x, t.y);
    if (!rm && !['tap', 'downpipe', 'hws'].includes(f)) continue;
    if (f === 'tap' || f === 'downpipe') { if (!nearMask(wallsG, t.x, t.y, 900)) continue; }
    fixtures.push({ type: f, x: Math.round(t.x), y: Math.round(t.y), room: rm ? rm.id : null, from: 'text' });
  }
  const electrical = [];
  for (const s of d.symbols || []) {
    const ty = symbolTypeOf(s.name);
    if (!ty) continue;
    const rm = roomAtPoint(rooms, s.x, s.y);
    const cx = s.bbox ? (s.bbox[0] + s.bbox[2]) / 2 : s.x, cy = s.bbox ? (s.bbox[1] + s.bbox[3]) / 2 : s.y;
    if (ty.cat === 'fix') fixtures.push({ type: ty.type, x: Math.round(cx), y: Math.round(cy), rot: s.rot, bbox: s.bbox ? s.bbox.map(Math.round) : null, room: rm ? rm.id : null, from: 'symbol', name: s.name });
    if (ty.cat === 'elec') electrical.push({ type: ty.type, gang: ty.gang, x: Math.round(cx), y: Math.round(cy), room: rm ? rm.id : null, name: s.name });
  }
  for (const t of d.texts) {
    const m = String(t.t).toUpperCase().match(/C\.?L\.?\s*[:=]?\s*(\d{4})/);
    if (!m) continue;
    const rm = roomAtPoint(rooms, t.x, t.y);
    if (rm) rm.ceiling = +m[1];
  }

  notes.push(`${walls.length} walls, ${openings.length} openings, ${rooms.length} rooms detected`);
  return {
    walls, rooms, robes, columns, beams, outline, houseOutline, fixtures, electrical,
    debug: { G, wallsG, stages: dbg, labels: roomLabels.map(l => l.t.t + (l.outside ? ' OUT' : '')), runs: runs.length, cands: cands.length, peaks: good.map(p => p.t), bbox: bb },
    notes,
  };
}

// ---------------------------------------------------------------------------
function sameSig(a, b, t) {
  if (a === b) return true;
  const A = a ? a.split(',').map(Number) : [], B = b ? b.split(',').map(Number) : [];
  if (A.length !== B.length) return false;
  const close = (X, Y) => X.every((v, i) => Math.abs(v - Y[i]) <= 8);
  return close(A, B) || close(A, B.map(v => t - v).reverse());
}

function bandGroups(pieces) {
  const out = [];
  for (const o of ['H', 'V']) {
    const L = pieces.filter(p => p.o === o).sort((p, q) => p.c0 - q.c0 || p.c1 - q.c1);
    const used = new Uint8Array(L.length);
    for (let i = 0; i < L.length; i++) {
      if (used[i]) continue;
      const g = [L[i]]; used[i] = 1;
      for (let j = i + 1; j < L.length && L[j].c0 - L[i].c0 <= 6; j++) if (!used[j] && Math.abs(L[j].c1 - L[i].c1) <= 6) { g.push(L[j]); used[j] = 1; }
      g.sort((p, q) => p.a - q.a);
      out.push({ o, c0: med(g.map(p => p.c0)), c1: med(g.map(p => p.c1)), parts: g });
    }
  }
  return out;
}
const med = a => { const s = a.slice().sort((p, q) => p - q); return s[s.length >> 1]; };

function toRuns(g) {
  const runs = [];
  let cur = null;
  for (const p of g.parts) {
    if (cur && p.a <= cur.b + 5) { cur.b = Math.max(cur.b, p.b); cur.parts.push(p); }
    else { cur = { o: g.o, c0: g.c0, c1: g.c1, t: g.c1 - g.c0, a: p.a, b: p.b, parts: [p] }; runs.push(cur); }
  }
  return runs;
}

function mainNetwork(runs, tol) {
  const n = runs.length;
  const R = runs.map(r => r.o === 'H' ? [r.a, r.c0, r.b, r.c1] : [r.c0, r.a, r.c1, r.b]);
  const near = (p, q, t) => p[0] - t <= q[2] && q[0] - t <= p[2] && p[1] - t <= q[3] && q[1] - t <= p[3];
  // 1. grow from "seed" runs (long enough to be a wall on their own) through touching runs
  const keep = new Uint8Array(n);
  const st = [];
  for (let i = 0; i < n; i++) if (runs[i].b - runs[i].a >= 1500) { keep[i] = 1; st.push(i); }
  while (st.length) {
    const i = st.pop();
    for (let j = 0; j < n; j++) if (!keep[j] && near(R[i], R[j], tol)) { keep[j] = 1; st.push(j); }
  }
  // 2. of the kept groups (bridging door-sized gaps), keep the building-sized ones
  const idx = [...keep.keys()].filter(i => keep[i]);
  const parent = new Map(idx.map(i => [i, i]));
  const find = i => { while (parent.get(i) !== i) i = parent.get(i); return i; };
  for (const i of idx) for (const j of idx) if (i < j && near(R[i], R[j], 1300)) { const a = find(i), b = find(j); if (a !== b) parent.set(a, b); }
  const len = new Map();
  for (const i of idx) { const r = find(i); len.set(r, (len.get(r) || 0) + runs[i].b - runs[i].a); }
  const max = Math.max(0, ...len.values());
  return idx.filter(i => len.get(find(i)) >= Math.max(3000, max * 0.15)).map(i => runs[i]);
}

function linesOf(segs) {
  const map = [];
  for (const s of segs) {
    let ln = map.find(l => l.o === s.o && Math.abs(l.c0 - s.c0) <= 6 && Math.abs(l.c1 - s.c1) <= 6);
    if (!ln) { ln = { o: s.o, c0: s.c0, c1: s.c1, t: s.c1 - s.c0, items: [] }; map.push(ln); }
    ln.items.push(s);
  }
  for (const l of map) {
    l.items.sort((p, q) => p.a - q.a);
    // merge overlapping same-kind items
    const out = [];
    for (const s of l.items) {
      const p = out[out.length - 1];
      if (p && s.a <= p.b + 1 && p.kind === s.kind) p.b = Math.max(p.b, s.b);
      else if (p && s.a < p.b) { if (s.b > p.b) out.push({ ...s, a: p.b }); }
      else out.push({ ...s });
    }
    l.items = out;
  }
  return map;
}

// Drop segments mostly covered by other (thinner/primary) walls
function removeCovered(segs) {
  const R = s => s.o === 'H' ? [s.a, s.c0, s.b, s.c1] : [s.c0, s.a, s.c1, s.b];
  const area = r => (r[2] - r[0]) * (r[3] - r[1]);
  const inter = (p, q) => Math.max(0, Math.min(p[2], q[2]) - Math.max(p[0], q[0])) * Math.max(0, Math.min(p[3], q[3]) - Math.max(p[1], q[1]));
  const keep = [];
  const sorted = segs.slice().sort((p, q) => (q.b - q.a) - (p.b - p.a));
  for (const s of sorted) {
    const r = R(s);
    let cov = 0;
    for (const k of keep) cov += inter(r, R(k));
    if (cov < area(r) * 0.55) keep.push(s);
  }
  return keep;
}

function mergeForOutput(segs) {
  // merge consecutive wall pieces of the same band into one rect; windows stay inside host walls
  const lines = linesOf(segs.map(s => ({ ...s, kind: 'wall' })));
  return lines.flatMap(l => l.items);
}

function bandOf(w) { return w.o === 'H' ? [w.rect[1], w.rect[3]] : [w.rect[0], w.rect[2]]; }
function spanOf(w) { return w.o === 'H' ? [w.rect[0], w.rect[2]] : [w.rect[1], w.rect[3]]; }

function nudge(G, i, j) {
  for (let r = 1; r < 16; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
    if (G.get(i + di, j + dj) !== 1) return [i + di, j + dj];
  }
  return null;
}

function rayRect(G, x, y, max) {
  const c = G.cell;
  let i = G.ix(x), j = G.iy(y);
  if (G.get(i, j) === 1) { const k = nudge(G, i, j); if (!k) return null; [i, j] = k; }
  const n = Math.ceil(max / c);
  const cast = (di, dj) => { for (let k = 1; k <= n; k++) if (G.get(i + di * k, j + dj * k) === 1) return k; return null; };
  const l = cast(-1, 0), r = cast(1, 0), u = cast(0, -1), dn = cast(0, 1);
  if (!l || !r || !u || !dn) return null;
  // second pass from the centre of the first rectangle for stability
  const x0 = G.x0 + (i - l + 1) * c, x1 = G.x0 + (i + r) * c, y0 = G.y0 + (j - u + 1) * c, y1 = G.y0 + (j + dn) * c;
  return [x0, y0, x1, y1];
}

function robeFront(WG, [x0, y0, x1, y1]) {
  const off = 80;
  const wallAt = (x, y) => WG.at(x, y) === 1;
  const sides = {
    N: wallAt((x0 + x1) / 2, y0 - off), S: wallAt((x0 + x1) / 2, y1 + off),
    W: wallAt(x0 - off, (y0 + y1) / 2), E: wallAt(x1 + off, (y0 + y1) / 2),
  };
  const open = Object.keys(sides).filter(k => !sides[k]);
  const long = (x1 - x0) >= (y1 - y0) ? ['N', 'S'] : ['W', 'E'];
  return open.find(k => long.includes(k)) || open[0] || long[0];
}

function touches(WG, [x0, y0, x1, y1], tol) {
  for (let k = 0; k <= 10; k++) {
    const x = x0 + (x1 - x0) * k / 10, y = y0 + (y1 - y0) * k / 10;
    for (const [px, py] of [[x, y0], [x, y1], [x0, y], [x1, y]]) if (nearMask(WG, px, py, tol)) return true;
  }
  return false;
}
function nearMask(WG, x, y, r) {
  const c = WG.cell, n = Math.ceil(r / c), i = WG.ix(x), j = WG.iy(y);
  for (let dj = -n; dj <= n; dj += 2) for (let di = -n; di <= n; di += 2) if (WG.get(i + di, j + dj) === 1) return true;
  return false;
}

export function roomAtPoint(rooms, x, y) {
  for (const r of rooms) for (const q of r.rects) if (x >= q[0] && x <= q[2] && y >= q[1] && y <= q[3]) return r;
  return null;
}

function unnamedRoom(G, pred, area, cell) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let p = 0; p < G.a.length; p++) { if (!pred(p)) continue; const i = p % G.w, j = (p - i) / G.w; if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
  const w = (x1 - x0 + 1) * cell, h = (y1 - y0 + 1) * cell;
  const rr = G.coverRects(pred);
  let type = 'room', name = 'Room';
  if (area < 2.2) { type = 'store'; name = 'Store'; }
  else if (Math.min(w, h) < 1400 && Math.max(w, h) / Math.min(w, h) > 2.2) { type = 'hall'; name = 'Hall'; }
  return { name, type, rects: rr, area: +area.toFixed(2), label: [G.x0 + (x0 + x1 + 1) / 2 * cell, G.y0 + (y0 + y1 + 1) / 2 * cell], guessed: true };
}

function numberDuplicates(rooms) {
  const by = {};
  for (const r of rooms) (by[r.name] ||= []).push(r);
  for (const [n, list] of Object.entries(by)) if (list.length > 1 && !/\d/.test(n)) list.forEach((r, i) => { r.name = `${n} ${i + 1}`; });
}

function joinStacked(texts) {
  const T = texts.map(t => ({ ...t }));
  const used = new Set();
  const out = [];
  for (let i = 0; i < T.length; i++) {
    if (used.has(i)) continue;
    const a = T[i];
    if (roomTypeOf(a.t)) {
      for (let j = 0; j < T.length; j++) {
        if (j === i || used.has(j)) continue;
        const b = T[j];
        if (/\d/.test(b.t) || b.t.length > 12 || !/^[A-Z .']+$/i.test(b.t)) continue;
        const dy = b.y - a.y, dx = Math.abs(b.x - a.x);
        if (dy > a.h * 0.6 && dy < a.h * 2.4 && dx < Math.max(a.w || 0, b.w || 0) * 0.6 + a.h && Math.abs(b.h - a.h) < a.h * 0.3) {
          a.t = a.t + ' ' + b.t; a.y = (a.y + b.y) / 2; used.add(j); break;
        }
      }
    }
    out.push(a);
  }
  return out;
}

function snapOutline(pts, walls, extra) {
  if (!pts.length) return pts;
  const xs = [], ys = [];
  for (const w of walls) { xs.push(w.rect[0], w.rect[2]); ys.push(w.rect[1], w.rect[3]); }
  for (const r of extra) { xs.push(r[0], r[2]); ys.push(r[1], r[3]); }
  const sn = (v, arr) => { let b = v, bd = 40; for (const a of arr) { const dd = Math.abs(a - v); if (dd < bd) { bd = dd; b = a; } } return b; };
  const out = pts.map(([x, y]) => [Math.round(sn(x, xs)), Math.round(sn(y, ys))]);
  // drop duplicates / collinear after snapping
  const clean = [];
  for (const p of out) { const q = clean[clean.length - 1]; if (!q || q[0] !== p[0] || q[1] !== p[1]) clean.push(p); }
  if (clean.length > 1 && clean[0][0] === clean[clean.length - 1][0] && clean[0][1] === clean[clean.length - 1][1]) clean.pop();
  const res = [];
  const n = clean.length;
  for (let k = 0; k < n; k++) {
    const p = clean[(k - 1 + n) % n], c = clean[k], q = clean[(k + 1) % n];
    if ((p[0] === c[0] && c[0] === q[0]) || (p[1] === c[1] && c[1] === q[1])) continue;
    res.push(c);
  }
  return res;
}

export { WET };
