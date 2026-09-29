// Automatic fit-out: kitchen, bathrooms, laundry, robes, bedrooms, living, dining, garage and
// alfresco – placed against real walls, away from doors, using fixture hints read from the
// drawing (WC, SH, BT, V, S, F, CT…) when there are any. Finishes come from the spec.
import * as THREE from 'three';
import { Batch } from './batch.js';
import { M } from './materials.js';
import { resolveOpening, wallFrame } from './build.js';
import { WET } from '../analyze/text.js';

const k = v => v / 1000;
let bt, grp, ctx;

const B = (x1, y1, x2, y2, h0, h1, key) => { if (Math.abs(x2 - x1) < 0.5 || Math.abs(y2 - y1) < 0.5 || Math.abs(h1 - h0) < 0.5) return; bt.box(k(Math.min(x1, x2)), k(h0), k(Math.min(y1, y2)), k(Math.max(x1, x2)), k(h1), k(Math.max(y1, y2)), key); };
const col = (x1, y1, x2, y2, h0, h1, tag = 'furniture') => ctx.colliders.push({ x1: Math.min(x1, x2), y1: Math.min(y1, y2), x2: Math.max(x1, x2), y2: Math.max(y1, y2), h0, h1, tag });
function cyl(x, y, h0, h1, r, key, seg = 20, rTop = null) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(k(rTop ?? r), k(r), k(h1 - h0), seg), M(key));
  m.position.set(k(x), k((h0 + h1) / 2), k(y)); m.castShadow = true; m.receiveShadow = true; grp.add(m); return m;
}
function sph(x, y, h, r, key, sy = 1) { const m = new THREE.Mesh(new THREE.SphereGeometry(k(r), 20, 14), M(key)); m.position.set(k(x), k(h), k(y)); m.scale.y = sy; m.castShadow = true; grp.add(m); return m; }

// ---------------------------------------------------------------------------
// Room geometry: bounding box and wall sides with their free spans
// ---------------------------------------------------------------------------
const bboxOf = rects => rects.reduce((b, q) => [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[2]), Math.max(b[3], q[3])], [Infinity, Infinity, -Infinity, -Infinity]);
function mainRect(r) { let best = r.rects[0], a = 0; for (const q of r.rects) { const A = (q[2] - q[0]) * (q[3] - q[1]); if (A > a) { a = A; best = q; } } return best; }

// For side s of box: the coordinate of the wall face, the along-axis span, and blocked intervals
function sideInfo(box, s) {
  const { model, spec, H } = ctx;
  const [x1, y1, x2, y2] = box;
  const horiz = s === 'N' || s === 'S';
  const c = { N: y1, S: y2, W: x1, E: x2 }[s];
  const lo = horiz ? x1 : y1, hi = horiz ? x2 : y2;
  const covered = [], blocked = [];
  for (const w of model.walls) {
    const f = wallFrame(w);
    if (f.horiz !== horiz) continue;
    const face = (s === 'N' || s === 'W') ? f.T1 : f.T0;
    if (Math.abs(face - c) > 60) continue;
    const a = Math.max(lo, f.L0), b = Math.min(hi, f.L1);
    if (b - a < 50) continue;
    covered.push([a, b]);
    for (const op0 of w.openings) {
      const op = resolveOpening(model, spec, H, w, op0);
      if (op.b < lo || op.a > hi) continue;
      blocked.push({ a: op.a, b: op.b, type: op.type, sill: op.type === 'win' ? op.sill : 0, head: op.head, op });
    }
  }
  return { s, horiz, c, lo, hi, covered: mergeIv(covered), blocked };
}
function mergeIv(iv) { iv.sort((p, q) => p[0] - q[0]); const o = []; for (const v of iv) { const l = o[o.length - 1]; if (l && v[0] <= l[1] + 30) l[1] = Math.max(l[1], v[1]); else o.push([...v]); } return o; }
// free spans along a side: covered by wall, minus doors (with clearance) and windows lower than minSill
function freeSpans(info, { minSill = 99999, doorClear = 150 } = {}) {
  let spans = info.covered.map(v => [...v]);
  for (const b of info.blocked) {
    const isDoor = b.type !== 'win';
    if (!isDoor && b.sill >= minSill) continue;
    const a = b.a - (isDoor ? doorClear : 0), e = b.b + (isDoor ? doorClear : 0);
    const n = [];
    for (const [p, q] of spans) { if (e <= p || a >= q) n.push([p, q]); else { if (a > p) n.push([p, a]); if (e < q) n.push([e, q]); } }
    spans = n;
  }
  return spans.filter(([p, q]) => q - p > 50);
}
const longest = spans => spans.reduce((b, s) => (!b || s[1] - s[0] > b[1] - b[0]) ? s : b, null);
const inward = s => ({ N: 1, S: -1, W: 1, E: -1 }[s]);
// rect against side s: along [a,b], depth d from the face
function against(info, a, b, d) {
  const c = info.c, i = inward(info.s);
  return info.horiz ? [a, Math.min(c, c + i * d), b, Math.max(c, c + i * d)] : [Math.min(c, c + i * d), a, Math.max(c, c + i * d), b];
}
const overlap = (p, q, m = 0) => p[0] < q[2] + m && q[0] < p[2] + m && p[1] < q[3] + m && q[1] < p[3] + m;
function doorsOf(box) {
  const out = [];
  for (const s of ['N', 'S', 'W', 'E']) for (const b of sideInfo(box, s).blocked) if (b.type !== 'win') out.push({ s, x: s === 'N' || s === 'S' ? (b.a + b.b) / 2 : sideInfo(box, s).c, y: s === 'N' || s === 'S' ? sideInfo(box, s).c : (b.a + b.b) / 2, a: b.a, b: b.b, op: b.op });
  return out;
}
function hintsIn(r, types) {
  return (ctx.model.fixtures || []).filter(f => types.includes(f.type) && r.rects.some(q => f.x >= q[0] - 150 && f.x <= q[2] + 150 && f.y >= q[1] - 150 && f.y <= q[3] + 150));
}
function nearestSide(box, x, y) {
  const d = { N: Math.abs(y - box[1]), S: Math.abs(box[3] - y), W: Math.abs(x - box[0]), E: Math.abs(box[2] - x) };
  return Object.keys(d).sort((a, b) => d[a] - d[b])[0];
}

// ---------------------------------------------------------------------------
// Kitchen
// ---------------------------------------------------------------------------
function kitchen(r) {
  const { spec, H } = ctx;
  const box = r.rects.length > 1 ? bboxOf(r.rects) : r.rects[0];
  const hints = hintsIn(r, ['cooktop', 'sink', 'fridge', 'dishwasher', 'microwave']);
  const cookH = hints.find(h => h.type === 'cooktop');
  const sides = ['N', 'S', 'W', 'E'].map(s => sideInfo(box, s));
  let back = null, bestScore = -1;
  for (const info of sides) {
    const sp = longest(freeSpans(info, { minSill: 950 }));
    if (!sp) continue;
    let score = sp[1] - sp[0];
    if (cookH) score += 5000 - Math.min(5000, Math.abs(info.horiz ? cookH.y - info.c : cookH.x - info.c) * 3);
    if (score > bestScore) { bestScore = score; back = { info, span: sp }; }
  }
  if (!back || back.span[1] - back.span[0] < 1200) return;
  const { info } = back;
  let [a0, a1] = back.span;
  const i = inward(info.s), c = info.c;
  const bench = +spec.kitchen.benchThickness || 40;
  const BH = 900, BT = BH - bench;
  const depthRoom = info.horiz ? box[3] - box[1] : box[2] - box[0];
  // appliance / tall zones
  const fridgeH = hints.find(h => h.type === 'fridge');
  const fridgeAtA = fridgeH ? Math.abs((info.horiz ? fridgeH.x : fridgeH.y) - a0) < Math.abs((info.horiz ? fridgeH.x : fridgeH.y) - a1) : false;
  const len = a1 - a0;
  const fridge = fridgeAtA ? [a0, a0 + 950] : [a1 - 950, a1];
  let runA = fridgeAtA ? a0 + 950 : a0, runB = fridgeAtA ? a1 : a1 - 950;
  let tower = null;
  if (len >= 4200) { tower = fridgeAtA ? [runB - 650, runB] : [runA, runA + 650]; if (fridgeAtA) runB -= 650; else runA += 650; }
  const R = (p, q, d0, d1, h0, h1, key) => { const r0 = info.horiz ? [p, c + i * d0, q, c + i * d1] : [c + i * d0, p, c + i * d1, q]; B(r0[0], r0[1], r0[2], r0[3], h0, h1, key); };
  // fridge + cupboard over
  R(fridge[0] + 25, fridge[1] - 25, 20, 700, 0, 1800, 'appliance');
  R(fridge[0], fridge[1], 0, 600, 1850, Math.min(H.ceiling, 2400), 'cabOver');
  R(fridge[0], fridge[0] + 20, 0, 620, 0, Math.min(H.ceiling, 2400), 'cabBase'); R(fridge[1] - 20, fridge[1], 0, 620, 0, Math.min(H.ceiling, 2400), 'cabBase');
  if (tower) { R(tower[0], tower[1], 0, 600, 0, Math.min(H.ceiling, 2400), 'cabBase'); const m = (tower[0] + tower[1]) / 2; R(m - 280, m + 280, 600, 606, 1350, 1750, 'blackGlass'); R(m - 280, m + 280, 600, 606, 850, 1300, 'appliance'); }
  // base run
  R(runA, runB, 50, 560, 0, 100, 'cabGap');
  R(runA, runB, 0, 580, 100, BT, 'cabBase');
  for (let x = runA + 600; x < runB - 100; x += 600) R(x - 2, x + 2, 580, 583, 110, BT - 10, 'cabGap');
  cabinetHandles(info, runA, runB, 583, BT - 60);
  R(runA, runB, 0, 620, BT, BH, 'benchtop');
  // cooktop centred (or at the hint)
  const cm = cookH ? Math.max(runA + 450, Math.min(runB - 450, info.horiz ? cookH.x : cookH.y)) : (runA + runB) / 2;
  R(cm - 450, cm + 450, 80, 540, BH, BH + 6, 'blackGlass');
  const burners = spec.kitchen.cooktop === 'gas' ? [[-250, 150, 90], [250, 150, 90], [-250, 380, 70], [250, 380, 70], [0, 265, 110]] : [[-200, 180, 110], [200, 180, 110], [-200, 400, 90], [200, 400, 90]];
  for (const [da, dd, rr] of burners) {
    const px = info.horiz ? cm + da : c + i * dd, py = info.horiz ? c + i * dd : cm + da;
    if (spec.kitchen.cooktop === 'gas') { const ring = new THREE.Mesh(new THREE.TorusGeometry(k(rr), 0.004, 6, 24), M('steel')); ring.rotation.x = Math.PI / 2; ring.position.set(k(px), k(BH + 8), k(py)); grp.add(ring); }
    else { const ring = new THREE.Mesh(new THREE.TorusGeometry(k(rr), 0.0015, 4, 32), M('lightOff')); ring.rotation.x = Math.PI / 2; ring.position.set(k(px), k(BH + 7), k(py)); grp.add(ring); }
  }
  R(cm - 300, cm + 300, 580, 590, 160, 760, 'blackGlass'); R(cm - 280, cm + 280, 590, 612, 700, 720, 'appliance');
  // window over the run?
  const win = info.blocked.find(b => b.type === 'win' && b.b > runA && b.a < runB);
  // splashback & overheads
  const over = spec.kitchen.overheads;
  const ohBot = BH + 650, ohTop = Math.min(H.ceiling, 2400);
  const pieces = win ? [[runA, win.a - 30], [win.b + 30, runB]] : [[runA, runB]];
  for (const [p, q] of pieces) {
    if (q - p < 150) continue;
    R(p, q, 0, 8, BH, over === 'none' ? BH + 650 : ohBot, 'splash');
    if (over === 'yes') { R(p, q, 0, 350, ohBot, ohTop, 'cabOver'); for (let x = p + 600; x < q - 100; x += 600) R(x - 2, x + 2, 350, 353, ohBot + 10, ohTop - 10, 'cabGap'); }
    else if (over === 'shelf') for (const hh of [ohBot + 150, ohBot + 500]) R(p, q, 0, 280, hh, hh + 30, 'woodVeneer');
  }
  if (win && win.sill > BH) R(Math.max(runA, win.a), Math.min(runB, win.b), 0, 8, BH, win.sill, 'splash');
  // rangehood
  const rh = spec.kitchen.rangehood;
  if (rh === 'canopy') { R(cm - 450, cm + 450, 0, 500, 1550, 1650, 'appliance'); R(cm - 150, cm + 150, 0, 300, 1650, H.ceiling, 'appliance'); }
  else if (over !== 'yes') R(cm - 450, cm + 450, 0, 420, 1560, 1650, 'appliance');
  else R(cm - 440, cm + 440, 330, 352, ohBot - 10, ohBot + 40, 'appliance');
  const kt = info.horiz ? [box[0], box[1], box[2], box[3]] : box;
  void kt;
  const benchRect = info.horiz ? [a0, Math.min(c, c + i * 620), a1, Math.max(c, c + i * 620)] : [Math.min(c, c + i * 620), a0, Math.max(c, c + i * 620), a1];
  col(...benchRect, 0, 2400, 'kitchen');

  // island
  const sinkH = hints.find(h => h.type === 'sink' || h.type === 'dishwasher');
  const sinkFar = sinkH && Math.abs((info.horiz ? sinkH.y : sinkH.x) - c) > 1300;
  const wantIsland = spec.kitchen.island === 'yes' || (spec.kitchen.island === 'auto' && (sinkFar || depthRoom >= 3400));
  let sinkOnIsland = false;
  if (wantIsland && depthRoom >= 2900) {
    const walk = depthRoom >= 3600 ? 1100 : 950;
    const iDepth = 1000;
    const d0 = 620 + walk, d1 = d0 + iDepth;
    let L = Math.min(3200, Math.max(1800, (runB - runA) - 200));
    let mid = sinkH ? (info.horiz ? sinkH.x : sinkH.y) : (runA + runB) / 2;
    mid = Math.max(a0 + L / 2, Math.min(a1 - L / 2, mid));
    const p = mid - L / 2, q = mid + L / 2;
    const ir = (d0_, d1_) => info.horiz ? [p, c + i * d0_, q, c + i * d1_] : [c + i * d0_, p, c + i * d1_, q];
    const cabD = 600;
    const R2 = (pp, qq, e0, e1, h0, h1, key) => { const r0 = info.horiz ? [pp, c + i * e0, qq, c + i * e1] : [c + i * e0, pp, c + i * e1, qq]; B(r0[0], r0[1], r0[2], r0[3], h0, h1, key); };
    const wf = spec.kitchen.waterfall ? 40 : 0;
    R2(p + wf, q - wf, d0 + 50, d0 + cabD - 50, 0, 100, 'cabGap');
    R2(p + wf, q - wf, d0, d0 + cabD, 100, BT, 'cabIsland');
    for (let x = p + wf + 600; x < q - wf - 100; x += 600) R2(x - 2, x + 2, d0 - 3, d0, 110, BT - 10, 'cabGap');
    R2(p, q, d0, d1, BT, BH + (wf ? 10 : 0), 'benchtop');
    if (wf) { R2(p, p + 40, d0, d1, 0, BT, 'benchtop'); R2(q - 40, q, d0, d1, 0, BT, 'benchtop'); }
    R2(p + wf, q - wf, d0 + cabD, d0 + cabD + 20, 0, BT, 'cabIsland');
    // sink + mixer + dishwasher panel
    sinkOnIsland = true;
    const sm = mid - Math.min(500, L / 4);
    const sw = spec.kitchen.sink === 'single' ? 450 : 800;
    R2(sm - sw / 2, sm + sw / 2, d0 + 90, d0 + 510, BH + 5, BH + 11, 'steel');
    if (sw > 500) { R2(sm - sw / 2 + 20, sm - 10, d0 + 110, d0 + 490, BH + 11, BH + 12, 'black'); R2(sm + 10, sm + sw / 2 - 20, d0 + 110, d0 + 490, BH + 11, BH + 12, 'black'); }
    else R2(sm - sw / 2 + 20, sm + sw / 2 - 20, d0 + 110, d0 + 490, BH + 11, BH + 12, 'black');
    const tx = info.horiz ? sm : c + i * (d0 + 40), ty = info.horiz ? c + i * (d0 + 40) : sm;
    cyl(tx, ty, BH, BH + 320, 14, 'kTap', 12);
    const spout = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.012, 8, 16, Math.PI), M('kTap'));
    spout.position.set(k(tx + (info.horiz ? 0 : i * 90)), k(BH + 320), k(ty + (info.horiz ? i * 90 : 0))); spout.rotation.y = info.horiz ? Math.PI / 2 : 0; grp.add(spout);
    R2(sm + sw / 2 + 50, sm + sw / 2 + 650, d0 - 4, d0, 110, BT - 10, spec.kitchen.appliances === 'integrated' ? 'cabIsland' : 'appliance');
    col(...ir(d0, d1), 0, BH);
    // stools on the overhang side
    const n = Math.max(2, Math.floor(L / 650));
    for (let s = 0; s < n; s++) {
      const al = p + L * (s + 0.5) / n, dd = d1 + 260;
      const x = info.horiz ? al : c + i * dd, y = info.horiz ? c + i * dd : al;
      cyl(x, y, 620, 680, 180, 'fabricDark'); cyl(x, y, 20, 620, 18, 'black', 8); cyl(x, y, 0, 20, 200, 'black');
      col(x - 190, y - 190, x + 190, y + 190, 0, 680, 'stool');
    }
    // pendants
    const pend = spec.kitchen.pendants;
    if (pend !== 'none') {
      const ph = Math.max(1650, H.ceiling - 950);
      const mdd = (d0 + d1) / 2;
      const pts = pend === 'linear' ? [mid] : [mid - L / 4, mid + L / 4].concat(L > 2600 ? [mid] : []);
      ctx.pendants = pts.map(al => ({ x: info.horiz ? al : c + i * mdd, y: info.horiz ? c + i * mdd : al, h: ph, style: pend, len: pend === 'linear' ? L * 0.7 : 0, horiz: info.horiz }));
    }
  }
  // sink on the back run when there is no island (under the window if there is one)
  if (!sinkOnIsland) {
    let sm = win ? (Math.max(runA, win.a) + Math.min(runB, win.b)) / 2 : (cm + (fridgeAtA ? runB : runA)) / 2;
    if (Math.abs(sm - cm) < 900) sm = cm + (sm < cm ? -900 : 900);
    sm = Math.max(runA + 450, Math.min(runB - 450, sm));
    R(sm - 400, sm + 400, 90, 510, BH + 5, BH + 11, 'steel'); R(sm - 380, sm + 380, 110, 490, BH + 11, BH + 12, 'black');
    const tx = info.horiz ? sm : c + i * 60, ty = info.horiz ? c + i * 60 : sm;
    cyl(tx, ty, BH, BH + 320, 14, 'kTap', 12);
  }
}

function cabinetHandles(info, a, b, d, h) {
  const { spec } = ctx;
  const t = spec.kitchen.handles;
  if (t === 'finger') return;
  const c = info.c, i = inward(info.s);
  for (let x = a + 300; x < b - 150; x += 600) {
    const P = (al, dd) => info.horiz ? [al, c + i * dd] : [c + i * dd, al];
    if (t === 'knob') { const [px, py] = P(x, d + 15); sph(px, py, h, 14, 'handle'); }
    else if (t === 'lip') { const [p1, q1] = P(x - 200, d); const [p2, q2] = P(x + 200, d + 12); B(p1, q1, p2, q2, h + 40, h + 55, 'handle'); }
    else { const [p1, q1] = P(x - 100, d + 10); const [p2, q2] = P(x + 100, d + 25); B(p1, q1, p2, q2, h - 6, h + 6, 'handle'); }
  }
}

// ---------------------------------------------------------------------------
// Bathrooms, ensuites, WCs
// ---------------------------------------------------------------------------
function bathroom(r) {
  const { spec, H } = ctx;
  const box = mainRect(r);
  const [x1, y1, x2, y2] = box;
  const W = x2 - x1, D = y2 - y1;
  const doors = doorsOf(box);
  const hint = t => hintsIn(r, [t])[0];
  const placed = [];
  const free = rc => !placed.some(p => overlap(p, rc, -1)) && !doors.some(d => overlap(rc, [d.x - 450, d.y - 450, d.x + 450, d.y + 450]));
  const corners = [[x1, y1, 1, 1], [x2, y1, -1, 1], [x2, y2, -1, -1], [x1, y2, 1, -1]];
  const dd = c => Math.min(...doors.map(d => Math.hypot(d.x - c[0], d.y - c[1])), 1e9);
  const far = corners.slice().sort((a, b) => dd(b) - dd(a));
  const cornerRect = (c, w, d) => { const [cx, cy, sx, sy] = c; return [Math.min(cx, cx + sx * w), Math.min(cy, cy + sy * d), Math.max(cx, cx + sx * w), Math.max(cy, cy + sy * d)]; };
  const nearestCorner = (x, y) => corners.slice().sort((a, b) => Math.hypot(a[0] - x, a[1] - y) - Math.hypot(b[0] - x, b[1] - y))[0];

  const isWC = r.type === 'wc';
  const isLaundry = r.type === 'laundry';
  if (isLaundry) return laundry(r, box, doors);
  // ---- shower
  let shower = null;
  if (!isWC) {
    const sh = hint('shower');
    const sw = Math.min(1200, Math.max(900, Math.min(W, D) >= 1700 ? 1000 : 900)), sd = 900;
    const order = sh ? [nearestCorner(sh.x, sh.y)] : far;
    for (const c of order) {
      for (const [a, b] of [[sw, sd], [sd, sw]]) { const rc = cornerRect(c, a, b); if (rc[2] - rc[0] <= W && rc[3] - rc[1] <= D && free(rc)) { shower = { rect: rc, c }; break; } }
      if (shower) break;
    }
    if (!shower && Math.min(W, D) >= 850) { const c = far[0]; shower = { rect: cornerRect(c, Math.min(900, W), Math.min(900, D)), c }; }
    if (shower) { placed.push(shower.rect); buildShower(r, box, shower); }
  }
  // ---- bath
  const bathH = hint('bath');
  const wantBath = spec.bathroom.bath !== 'none' && !isWC && (bathH || (spec.bathroom.bath !== 'auto' && r.type === 'bath') || (spec.bathroom.bath === 'auto' && r.type === 'bath' && W * D / 1e6 >= 5.2));
  if (wantBath) {
    const bl = 1700, bw = 750;
    const order = bathH ? [nearestCorner(bathH.x, bathH.y)] : far;
    let done = false;
    for (const c of order) {
      for (const [a, b] of [[bl, bw], [bw, bl]]) {
        const rc = cornerRect(c, a, b);
        if (rc[2] - rc[0] <= W + 1 && rc[3] - rc[1] <= D + 1 && free(rc)) { placed.push(rc); buildBath(rc, c); done = true; break; }
      }
      if (done) break;
    }
  }
  // ---- vanity on the longest free wall span
  const vh = hint('vanity');
  const sides = ['N', 'S', 'W', 'E'].map(s => sideInfo(box, s));
  let vPlaced = false;
  const trySides = vh ? [sideInfo(box, nearestSide(box, vh.x, vh.y))].concat(sides) : sides.slice().sort((a, b) => (longest(freeSpans(b, { minSill: 1200 }))?.[1] - longest(freeSpans(b, { minSill: 1200 }))?.[0] || 0) - (longest(freeSpans(a, { minSill: 1200 }))?.[1] - longest(freeSpans(a, { minSill: 1200 }))?.[0] || 0));
  for (const info of trySides) {
    for (const [p, q] of freeSpans(info, { minSill: 1200 })) {
      const vl = Math.min(isWC ? 450 : 1500, q - p - 20);
      if (vl < 400) continue;
      const centre = vh ? Math.max(p + vl / 2, Math.min(q - vl / 2, info.horiz ? vh.x : vh.y)) : (p + q) / 2;
      const rc = against(info, centre - vl / 2, centre + vl / 2, isWC ? 300 : 460);
      if (!free(rc)) continue;
      placed.push(rc); vanity(info, rc, isWC); vPlaced = true; break;
    }
    if (vPlaced) break;
  }
  // ---- toilet
  const wh = hint('wc');
  const tSides = wh ? [sideInfo(box, nearestSide(box, wh.x, wh.y))].concat(sides) : sides;
  let tPlaced = false;
  for (const info of tSides) {
    for (const [p, q] of freeSpans(info, { minSill: 900 })) {
      if (q - p < 450) continue;
      const pos = wh ? Math.max(p + 225, Math.min(q - 225, info.horiz ? wh.x : wh.y)) : (isWC ? (p + q) / 2 : p + 225 + 50);
      for (const al of [pos, q - 275, p + 275, (p + q) / 2]) {
        const rc = against(info, al - 225, al + 225, 720);
        if (!free(rc)) continue;
        placed.push(rc); toilet(info, al); tPlaced = true; break;
      }
      if (tPlaced) break;
    }
    if (tPlaced) break;
  }
  // ---- wall tiles
  tileRoom(box, shower);
}

function tileRoom(box, shower) {
  const { spec, H } = ctx;
  const th = spec.bathroom.tileHeight;
  const T = 8;
  for (const s of ['N', 'S', 'W', 'E']) {
    const info = sideInfo(box, s);
    for (const [p, q] of info.covered) {
      let spans = [[p, q]];
      for (const b of info.blocked) { if (b.type === 'win' && th !== 'full') continue; const n = []; for (const [u, v] of spans) { if (b.b <= u || b.a >= v) n.push([u, v]); else { if (b.a > u) n.push([u, b.a]); if (b.b < v) n.push([b.b, v]); } } spans = n; }
      for (const [u, v] of spans) {
        const top = th === 'full' ? H.ceiling - 5 : th === '1200' ? 1200 : th === 'shower' ? 100 : 0;
        if (top <= 0) continue;
        const rc = against(info, u, v, T);
        B(rc[0], rc[1], rc[2], rc[3], 0, top, 'wallTile');
      }
    }
  }
  void shower;
}

function buildShower(r, box, sh) {
  const { spec, H } = ctx;
  const [a0, b0, a1, b1] = sh.rect;
  const [cx, cy, sx, sy] = sh.c;
  const T = 10;
  const feat = spec.bathroom.featureTile && spec.bathroom.featureTile !== 'None' ? 'featureTile' : 'wallTile';
  const top = Math.min(H.ceiling - 5, 2400);
  // two wall linings (the corner walls)
  const wx = sx > 0 ? a0 : a1, wy = sy > 0 ? b0 : b1;
  B(wx, b0, wx + sx * T, b1, 0, top, feat);
  B(a0, wy, a1, wy + sy * T, 0, top, feat);
  if (spec.bathroom.niche) {
    const nx = (a0 + a1) / 2;
    B(nx - 300, wy + sy * T, nx + 300, wy + sy * (T + 6), 1150, 1450, 'poche');
    B(nx - 300, wy + sy * T, nx + 300, wy + sy * (T + 80), 1150, 1162, 'wallTile');
  }
  // screen on the open sides
  const open = [];
  const fx = sx > 0 ? a1 : a0, fy = sy > 0 ? b1 : b0;
  const onEdgeX = Math.abs(fx - (sx > 0 ? box[2] : box[0])) < 60, onEdgeY = Math.abs(fy - (sy > 0 ? box[3] : box[1])) < 60;
  if (!onEdgeX) open.push(['x', fx, Math.min(b0, b1), Math.max(b0, b1)]);
  if (!onEdgeY) open.push(['y', fy, Math.min(a0, a1), Math.max(a0, a1)]);
  const scr = spec.bathroom.screen;
  const gh = 2000;
  for (const [ax, v, p, q] of open) {
    const len = scr === 'walkin' ? (q - p) * 0.6 : q - p;
    const P = ax === 'x' ? (sy > 0 ? p : q - len) : (sx > 0 ? p : q - len);
    const rc = ax === 'x' ? [v - 5, P, v + 5, P + len] : [P, v - 5, P + len, v + 5];
    B(rc[0], rc[1], rc[2], rc[3], 20, gh, 'showerGlass');
    if (scr === 'semi' || scr === 'black') {
      const fr = ax === 'x' ? [[v - 12, P, v + 12, P + 25], [v - 12, P + len - 25, v + 12, P + len]] : [[P, v - 12, P + 25, v + 12], [P + len - 25, v - 12, P + len, v + 12]];
      for (const f of fr) B(f[0], f[1], f[2], f[3], 0, gh, 'screenFrame');
      B(rc[0] - 7, rc[1] - 7, rc[2] + 7, rc[3] + 7, gh - 25, gh, 'screenFrame');
      if (scr === 'black') B(rc[0] - 7, rc[1] - 7, rc[2] + 7, rc[3] + 7, 0, 25, 'screenFrame');
    } else B(rc[0] - 3, rc[1] - 3, rc[2] + 3, rc[3] + 3, 0, 20, 'screenFrame');
    ctx.colliders.push({ x1: rc[0], y1: rc[1], x2: rc[2], y2: rc[3], h0: 0, h1: gh, tag: 'screen' });
  }
  // rose, arm, mixer, waste
  const rx = (a0 + a1) / 2, ry = wy + sy * 150;
  const rose = cyl(rx, ry, 2080, 2092, 125, 'tap', 32);
  void rose;
  B(rx - 10, wy + sy * T, rx + 10, ry, 2092, 2112, 'tap');
  const mx = (a0 + a1) / 2, my = wy + sy * (T + 20);
  cyl(mx, my, 1000, 1010, 45, 'tap', 20).rotation.x = Math.PI / 2;
  B(mx - 8, my - 8, mx + 8, my + 8, 1040, 1060, 'tap');
  B(rx - 60, (b0 + b1) / 2 - 60, rx + 60, (b0 + b1) / 2 + 60, 1, 3, 'steel');
  // towel rail beside the shower
  const tx = sx > 0 ? a1 + 250 : a0 - 250;
  if (tx > box[0] + 100 && tx < box[2] - 100) { B(tx - 300, wy + sy * T, tx + 300, wy + sy * (T + 60), 1180, 1200, 'tap'); B(tx - 300, wy + sy * T, tx + 300, wy + sy * (T + 60), 1080, 1100, 'tap'); }
}

function buildBath(rc, c) {
  const { spec } = ctx;
  const [tx1, ty1, tx2, ty2] = rc;
  const long = tx2 - tx1 > ty2 - ty1;
  if (spec.bathroom.bath === 'freestanding') {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.3, 0.56, 36, 1, false), M('ceramic'));
    m.scale.set(long ? 2.3 : 1, 1, long ? 1 : 2.3);
    m.position.set(k((tx1 + tx2) / 2), 0.28, k((ty1 + ty2) / 2)); m.castShadow = true; grp.add(m);
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.27, 0.02, 36), M('linen'));
    inner.scale.copy(m.scale); inner.position.set(m.position.x, 0.55, m.position.z); grp.add(inner);
    // floor mixer
    const fx = long ? (c[2] > 0 ? tx1 + 100 : tx2 - 100) : (tx1 + tx2) / 2, fy = long ? (ty1 + ty2) / 2 : (c[3] > 0 ? ty1 + 100 : ty2 - 100);
    cyl(fx, fy, 0, 950, 14, 'tap', 10);
  } else {
    B(tx1, ty1, tx2, ty2, 0, 100, 'wallTile');
    B(tx1, ty1, tx1 + 80, ty2, 100, 550, 'ceramic'); B(tx2 - 80, ty1, tx2, ty2, 100, 550, 'ceramic');
    B(tx1 + 80, ty1, tx2 - 80, ty1 + 80, 100, 550, 'ceramic'); B(tx1 + 80, ty2 - 80, tx2 - 80, ty2, 100, 550, 'ceramic');
    B(tx1 + 80, ty1 + 80, tx2 - 80, ty2 - 80, 100, 110, 'ceramic');
    const sx = long ? (c[2] > 0 ? tx1 + 40 : tx2 - 40) : (tx1 + tx2) / 2, sy = long ? (ty1 + ty2) / 2 : (c[3] > 0 ? ty1 + 40 : ty2 - 40);
    B(sx - 20, sy - 20, sx + 20, sy + 20, 650, 700, 'tap');
  }
  col(tx1, ty1, tx2, ty2, 0, 560);
}

function vanity(info, rc, small) {
  const { spec } = ctx;
  const [x1, y1, x2, y2] = rc;
  const style = spec.bathroom.vanity;
  const top = 870;
  if (style === 'floor') B(x1, y1, x2, y2, 0, top - 20, 'vanity');
  else if (style === 'open') { B(x1, y1, x2, y2, 450, 500, 'vanity'); B(x1, y1, x2, y2, top - 60, top - 20, 'vanity'); }
  else B(x1, y1, x2, y2, 450, top - 20, 'vanity');
  if (style !== 'open') {
    const L = info.horiz ? x2 - x1 : y2 - y1, n = L > 900 ? 2 : 1;
    for (let d = 1; d < n; d++) { const al = (info.horiz ? x1 : y1) + L * d / n; const q = against(info, al - 2, al + 2, (info.horiz ? y2 - y1 : x2 - x1) + 3); B(q[0], q[1], q[2], q[3], style === 'floor' ? 100 : 460, top - 30, 'cabGap'); }
  }
  B(x1, y1, x2, y2, top - 20, top, 'vanityTop');
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, i = inward(info.s);
  const basin = spec.bathroom.basin;
  const dpt = info.horiz ? y2 - y1 : x2 - x1;
  const bx = info.horiz ? cx : info.c + i * dpt * 0.55, by = info.horiz ? info.c + i * dpt * 0.55 : cy;
  if (basin === 'under') B(bx - 220, by - 160, bx + 220, by + 160, top, top + 2, 'black');
  else if (basin === 'rect') { B(bx - (info.horiz ? 250 : 180), by - (info.horiz ? 180 : 250), bx + (info.horiz ? 250 : 180), by + (info.horiz ? 180 : 250), top, top + 120, 'ceramic'); }
  else { const b = cyl(bx, by, top, top + 130, small ? 150 : 190, 'ceramic', 28, small ? 160 : 200); b.scale.set(info.horiz ? 1.3 : 1, 1, info.horiz ? 1 : 1.3); }
  // wall mixer + spout
  const mx = info.horiz ? cx : info.c + i * 30, my = info.horiz ? info.c + i * 30 : cy;
  B(mx - 20, my - 20, mx + 20, my + 20, top + 250, top + 290, 'tap');
  const sp = against(info, (info.horiz ? cx : cy) - 10, (info.horiz ? cx : cy) + 10, 190);
  B(sp[0], sp[1], sp[2], sp[3], top + 200, top + 220, 'tap');
  // splashback tiles + mirror
  const sb = against(info, info.horiz ? x1 : y1, info.horiz ? x2 : y2, 8);
  B(sb[0], sb[1], sb[2], sb[3], top, top + 400, 'wallTile');
  const mirror = spec.bathroom.mirror;
  const ml = Math.min(info.horiz ? x2 - x1 : y2 - y1, 1200) - 100;
  const mc = info.horiz ? cx : cy;
  const mr = against(info, mc - ml / 2, mc + ml / 2, mirror === 'cabinet' ? 150 : 14);
  if (mirror === 'round') { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.012, 48), M('mirror')); m.rotation[info.horiz ? 'x' : 'z'] = Math.PI / 2; m.position.set(k((mr[0] + mr[2]) / 2), k(top + 750), k((mr[1] + mr[3]) / 2)); grp.add(m); }
  else if (mirror === 'arch') { B(mr[0], mr[1], mr[2], mr[3], top + 350, top + 1100, 'mirror'); const m = new THREE.Mesh(new THREE.CylinderGeometry(k(ml / 2), k(ml / 2), 0.012, 32, 1, false, 0, Math.PI), M('mirror')); m.rotation[info.horiz ? 'x' : 'z'] = Math.PI / 2; if (!info.horiz) m.rotation.y = Math.PI / 2; m.position.set(k((mr[0] + mr[2]) / 2), k(top + 1100), k((mr[1] + mr[3]) / 2)); grp.add(m); }
  else B(mr[0], mr[1], mr[2], mr[3], top + 300, Math.min(ctx.H.ceiling - 200, top + 1180), mirror === 'cabinet' ? 'vanity' : 'mirror');
  if (mirror === 'cabinet') { const f = against(info, mc - ml / 2, mc + ml / 2, 154); B(...[f[0], f[1], f[2], f[3]].map((v, idx) => v), top + 300, top + 1180, 'mirror'); }
  col(x1, y1, x2, y2, 400, top + 150);
}

function toilet(info, al) {
  const { spec } = ctx;
  const i = inward(info.s), c = info.c;
  const P = (a, d) => info.horiz ? [a, c + i * d] : [c + i * d, a];
  const t = spec.bathroom.toilet;
  const [cxa, cya] = P(al, 110);
  if (t === 'wallFaced') { const [p, q] = P(al - 200, 10), [r, s] = P(al + 200, 190); B(p, q, r, s, 380, 820, 'ceramic'); }
  else if (t === 'wallHung') { const [p, q] = P(al - 90, 0), [r, s] = P(al + 90, 8); B(p, q, r, s, 1000, 1150, 'tap'); }
  else { const [p, q] = P(al - 180, 10), [r, s] = P(al + 180, 200); B(p, q, r, s, 0, 420, 'ceramic'); }
  const [bx, by] = P(al, 450);
  if (t !== 'wallHung') cyl(bx, by, 0, 360, 150, 'ceramic', 24, 175);
  const bowl = cyl(bx, by, t === 'wallHung' ? 280 : 360, 420, 190, 'ceramic', 28);
  bowl.scale.set(info.horiz ? 1 : 1.3, 1, info.horiz ? 1.3 : 1);
  const seat = cyl(bx, by, 420, 440, 190, 'plastic', 28); seat.scale.copy(bowl.scale);
  void cxa; void cya;
  const [p1, q1] = P(al - 230, 0), [p2, q2] = P(al + 230, 700);
  col(p1, q1, p2, q2, 0, 800);
  // toilet roll holder
  const [hx, hy] = P(al + 380, 40); B(hx - 70, hy - 20, hx + 70, hy + 20, 700, 720, 'tap');
}

function laundry(r, box, doors) {
  const { spec, H } = ctx;
  const sides = ['N', 'S', 'W', 'E'].map(s => sideInfo(box, s));
  let best = null;
  for (const info of sides) { const sp = longest(freeSpans(info, { minSill: 1000 })); if (sp && (!best || sp[1] - sp[0] > best.sp[1] - best.sp[0])) best = { info, sp }; }
  if (!best) return;
  const { info, sp } = best;
  const [p, q] = sp;
  const L = q - p;
  const machinesW = L >= 1500 ? 650 : 0;
  const benchA = p, benchB = q - machinesW;
  const bench = against(info, benchA, benchB, 600);
  B(bench[0], bench[1], bench[2], bench[3], 100, 870, 'laundryCab');
  B(...against(info, benchA, benchB, 560).slice(0, 4), 0, 100, 'cabGap');
  B(bench[0], bench[1], bench[2], bench[3], 870, 900, 'benchtop');
  const tm = (benchA + benchB) / 2;
  const tub = against(info, tm - 230, tm + 230, 520);
  B(tub[0], tub[1], tub[2], tub[3], 900, 905, 'tub');
  const [tx, ty] = info.horiz ? [tm, info.c + inward(info.s) * 50] : [info.c + inward(info.s) * 50, tm];
  cyl(tx, ty, 900, 1180, 12, 'tap', 10);
  B(...against(info, benchA, benchB, 8).slice(0, 4), 900, 1500, 'wallTile');
  if (spec.laundry.overheads) B(...against(info, benchA, q, 350).slice(0, 4), 1600, Math.min(H.ceiling, 2400), 'laundryCab');
  if (machinesW) {
    const mc = against(info, q - machinesW + 10, q - 10, 620);
    B(mc[0], mc[1], mc[2], mc[3], 0, 850, 'plastic'); B(mc[0], mc[1], mc[2], mc[3], 880, 1740, 'plastic');
    const i = inward(info.s), m = q - machinesW / 2;
    for (const h of [430, 1310]) {
      const door = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 32), M('blackGlass'));
      const [dx, dy] = info.horiz ? [m, info.c + i * 625] : [info.c + i * 625, m];
      if (info.horiz) door.rotation.x = Math.PI / 2; else door.rotation.z = Math.PI / 2;
      door.position.set(k(dx), k(h), k(dy)); grp.add(door);
    }
  }
  col(...against(info, p, q, 620).slice(0, 4), 0, 1740);
  void doors;
}

// ---------------------------------------------------------------------------
// Bedrooms, living, dining, study, storage
// ---------------------------------------------------------------------------
function bedroom(r, isMaster) {
  const { spec, H, model } = ctx;
  const box = mainRect(r);
  const area = r.area || (box[2] - box[0]) * (box[3] - box[1]) / 1e6;
  const size = isMaster && area >= 11.5 ? [1830, 2030] : area >= 8.5 ? [1530, 2030] : [1380, 1880];
  const robes = (model.robes || []).map(q => q.rect);
  const sides = ['N', 'S', 'W', 'E'].map(s => sideInfo(box, s));
  let best = null;
  for (const pass of [1600, 900]) {
    for (const info of sides) {
      for (const [p, q] of freeSpans(info, { minSill: pass })) {
        const need = size[0] + 2 * 500;
        const span = q - p;
        if (span < size[0] + 80) continue;
        const depth = info.horiz ? box[3] - box[1] : box[2] - box[0];
        if (depth < size[1] + 700) continue;
        const mid = (p + q) / 2;
        const bed = against(info, mid - size[0] / 2, mid + size[0] / 2, size[1] + 40);
        if (robes.some(rb => overlap(rb, bed, 50))) continue;
        const score = Math.min(span, need) + (span >= need ? 2000 : 0) + (pass > 1000 ? 1000 : 0);
        if (!best || score > best.score) best = { info, mid, bed, score, span: [p, q] };
      }
    }
    if (best) break;
  }
  if (!best) return;
  const { info, mid } = best;
  const i = inward(info.s), c = info.c;
  const R = (a0, a1, d0, d1, h0, h1, key) => { const q = info.horiz ? [a0, c + i * d0, a1, c + i * d1] : [c + i * d0, a0, c + i * d1, a1]; B(q[0], q[1], q[2], q[3], h0, h1, key); return q; };
  const a0 = mid - size[0] / 2, a1 = mid + size[0] / 2;
  R(a0 - 40, a1 + 40, 0, 60, 0, 1150, 'fabric');                  // headboard
  R(a0, a1, 60, 60 + size[1], 60, 300, 'fabricDark');             // base
  R(a0 + 10, a1 - 10, 70, 50 + size[1], 300, 540, 'linen');       // mattress
  R(a0, a1, size[1] - 590, size[1] + 65, 540, 570, 'throw');       // throw
  R(a0 + 90, mid - 30, 110, 510, 540, 660, 'linen'); R(mid + 30, a1 - 90, 110, 510, 540, 660, 'linen');
  const q = R(a0, a1, 0, 60 + size[1], 0, 0.1, 'linen');
  col(q[0], q[1], q[2], q[3], 0, 570);
  // bedsides where they fit
  for (const s of [-1, 1]) {
    const e = s < 0 ? a0 - 60 : a1 + 60;
    const room = s < 0 ? e - best.span[0] : best.span[1] - e;
    if (room < 480) continue;
    const b0 = s < 0 ? e - 460 : e, b1 = s < 0 ? e : e + 460;
    R(b0, b1, 20, 420, 0, 520, 'woodVeneer');
    const [lx, ly] = info.horiz ? [(b0 + b1) / 2, c + i * 220] : [c + i * 220, (b0 + b1) / 2];
    cyl(lx, ly, 520, 560, 70, 'ceramic', 16); cyl(lx, ly, 560, 820, 10, 'black', 8); cyl(lx, ly, 780, 960, 130, 'linen', 20, 100);
    const cq = R(b0, b1, 20, 420, 0, 0.1, 'linen'); col(cq[0], cq[1], cq[2], cq[3], 0, 520);
  }
  // feature wall paint behind the bed
  if (spec.paint.feature && spec.paint.feature !== 'None') {
    const f = against(info, best.span[0], best.span[1], 4);
    B(f[0], f[1], f[2], f[3], spec.doors.skirting ? +spec.doors.skirting : 0, H.ceiling - 2, 'featurePaint');
  }
}

function living(r) {
  const box = mainRect(r);
  const W = box[2] - box[0], D = box[3] - box[1];
  if (W * D < 6e6) return;
  const sides = ['N', 'S', 'W', 'E'].map(s => sideInfo(box, s));
  let best = null;
  for (const info of sides) for (const [p, q] of freeSpans(info, { minSill: 1400 })) { if (!best || q - p > best.q - best.p) best = { info, p, q }; }
  if (!best || best.q - best.p < 1800) return;
  const { info } = best;
  const i = inward(info.s), c = info.c;
  const depth = info.horiz ? D : W;
  const mid = (best.p + best.q) / 2;
  const R = (a0, a1, d0, d1, h0, h1, key) => { const q = info.horiz ? [a0, c + i * d0, a1, c + i * d1] : [c + i * d0, a0, c + i * d1, a1]; B(q[0], q[1], q[2], q[3], h0, h1, key); return q; };
  const tvL = Math.min(2200, best.q - best.p - 200);
  const tq = R(mid - tvL / 2, mid + tvL / 2, 0, 420, 120, 460, 'woodVeneer'); R(mid - tvL / 2 + 80, mid + tvL / 2 - 80, 40, 400, 0, 120, 'black');
  col(tq[0], tq[1], tq[2], tq[3], 0, 460);
  R(mid - 740, mid + 740, 10, 50, 1100, 1950, 'black'); R(mid - 725, mid + 725, 50, 53, 1112, 1938, 'screen');
  const sd = Math.min(3200, depth - 900);
  if (sd < 2000) return;
  const sl = Math.min(2600, best.q - best.p);
  R(mid - sl / 2, mid + sl / 2, sd, sd + 900, 60, 420, 'fabric');
  R(mid - sl / 2, mid + sl / 2, sd + 670, sd + 900, 420, 820, 'fabric');
  R(mid - sl / 2, mid - sl / 2 + 200, sd, sd + 900, 420, 620, 'fabric'); R(mid + sl / 2 - 200, mid + sl / 2, sd, sd + 900, 420, 620, 'fabric');
  R(mid - sl / 2 + 250, mid - sl / 2 + 700, sd + 560, sd + 680, 500, 800, 'throw');
  const sq = R(mid - sl / 2, mid + sl / 2, sd, sd + 900, 0, 0.1, 'fabric'); col(sq[0], sq[1], sq[2], sq[3], 0, 820);
  R(mid - 1300, mid + 1300, sd - 1500, sd + 400, 5, 12, 'rug');
  const cq = R(mid - 550, mid + 550, sd - 1000, sd - 450, 340, 380, 'wood'); R(mid - 510, mid + 510, sd - 960, sd - 490, 0, 340, 'cabGap');
  col(cq[0], cq[1], cq[2], cq[3], 0, 380);
}

function dining(r) {
  const box = mainRect(r);
  const W = box[2] - box[0], D = box[3] - box[1];
  if (Math.min(W, D) < 2200) return;
  const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2;
  const alongX = W >= D;
  const L = Math.min(2000, (alongX ? W : D) - 1600), Wt = 950;
  if (L < 1000) return;
  const [x1, y1, x2, y2] = alongX ? [cx - L / 2, cy - Wt / 2, cx + L / 2, cy + Wt / 2] : [cx - Wt / 2, cy - L / 2, cx + Wt / 2, cy + L / 2];
  B(x1, y1, x2, y2, 720, 760, 'wood');
  for (const [lx, ly] of [[x1 + 80, y1 + 80], [x2 - 80, y1 + 80], [x2 - 80, y2 - 80], [x1 + 80, y2 - 80]]) B(lx - 30, ly - 30, lx + 30, ly + 30, 0, 720, 'black');
  col(x1, y1, x2, y2, 0, 760);
  const n = L >= 1800 ? 3 : 2;
  for (let s = 0; s < n; s++) {
    const t = (s + 0.5) / n;
    if (alongX) { chair(x1 + L * t, y1 - 150, 'S'); chair(x1 + L * t, y2 + 150, 'N'); }
    else { chair(x1 - 150, y1 + L * t, 'E'); chair(x2 + 150, y1 + L * t, 'W'); }
  }
}

function chair(x, y, face, key = 'fabric') {
  const d = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }[face];
  B(x - 220, y - 220, x + 220, y + 220, 430, 480, key);
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B(x + sx * 190 - 12, y + sy * 190 - 12, x + sx * 190 + 12, y + sy * 190 + 12, 0, 430, 'black');
  const bx = x - d[0] * 205, by = y - d[1] * 205;
  if (d[0] === 0) B(x - 220, by - 20, x + 220, by + 20, 480, 880, key); else B(bx - 20, y - 220, bx + 20, y + 220, 480, 880, key);
  col(x - 230, y - 230, x + 230, y + 230, 0, 880);
}

function shelving(r, key, depth = 450) {
  const box = mainRect(r);
  const { H } = ctx;
  for (const s of ['N', 'S', 'W', 'E']) {
    const info = sideInfo(box, s);
    for (const [p, q] of freeSpans(info, { minSill: 0, doorClear: 80 })) {
      if (q - p < 400) continue;
      for (const h of [350, 750, 1150, 1550, 1950]) { const rc = against(info, p + 5, q - 5, depth); B(rc[0], rc[1], rc[2], rc[3], h, h + 22, key); }
      const rc = against(info, p, q, depth); col(rc[0], rc[1], rc[2], rc[3], 0, Math.min(H.ceiling, 2300));
    }
  }
}

function wir(r) {
  const { spec, H } = ctx;
  const box = mainRect(r);
  const sides = ['N', 'S', 'W', 'E'].map(s => sideInfo(box, s)).map(info => ({ info, sp: freeSpans(info, { doorClear: 80 }) }));
  let first = true;
  for (const { info, sp } of sides) for (const [p, q] of sp) {
    if (q - p < 500) continue;
    if (first) { // hanging on the longest
      const rc = against(info, p, q, 560);
      B(rc[0], rc[1], rc[2], rc[3], 1780, 1800, 'shelf');
      const rail = against(info, p + 20, q - 20, 300); B(rail[0], rail[1], rail[2], rail[3], 1680, 1700, 'chrome');
      const cols = ['fabric', 'fabricDark', 'linen', 'throw'];
      for (let a = p + 60, n = 0; a < q - 60; a += 70, n++) { const g = against(info, a, a + 45, 460); B(g[0], g[1] + (info.horiz ? 0 : 0), g[2], g[3], 700 + (n % 3) * 120, 1680, cols[n % 4]); }
      col(rc[0], rc[1], rc[2], rc[3], 600, 2200);
      first = false;
    } else {
      for (const h of [350, 750, 1150, 1550, 1950]) { const rc = against(info, p + 5, q - 5, 400); B(rc[0], rc[1], rc[2], rc[3], h, h + 22, 'shelf'); }
      const rc = against(info, p, q, 400); col(rc[0], rc[1], rc[2], rc[3], 0, 2200);
    }
  }
  if (spec.joinery.wirFitout === 'drawers') { const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2; if (Math.min(box[2] - box[0], box[3] - box[1]) > 2000) { B(cx - 450, cy - 300, cx + 450, cy + 300, 0, 900, 'shelf'); col(cx - 450, cy - 300, cx + 450, cy + 300, 0, 900); } }
  void H;
}

function study(r) {
  const box = mainRect(r);
  const sides = ['N', 'S', 'W', 'E'].map(s => sideInfo(box, s));
  for (const info of sides) for (const [p, q] of freeSpans(info, { minSill: 700 })) {
    if (q - p < 1400) continue;
    const m = (p + q) / 2;
    const d = against(info, m - 700, m + 700, 650);
    B(d[0], d[1], d[2], d[3], 720, 750, 'wood');
    for (const [a, b] of [[m - 690, m - 650], [m + 650, m + 690]]) { const leg = against(info, a, b, 640); B(leg[0], leg[1], leg[2], leg[3], 0, 720, 'black'); }
    col(d[0], d[1], d[2], d[3], 0, 750);
    const ch = against(info, m - 10, m + 10, 1000);
    chair((ch[0] + ch[2]) / 2, (ch[1] + ch[3]) / 2, { N: 'N', S: 'S', W: 'W', E: 'E' }[info.s], 'fabricDark');
    return;
  }
}

function garage(r) {
  const { spec, H } = ctx;
  if (!spec.garage.cars) return;
  const box = mainRect(r);
  // cars face the garage door
  let door = null;
  for (const w of ctx.model.walls) for (const op of w.openings) if (op.type === 'garage') {
    const f = wallFrame(w);
    const mid = (op.a + op.b) / 2;
    const [x, y] = f.horiz ? [mid, (f.T0 + f.T1) / 2] : [(f.T0 + f.T1) / 2, mid];
    if (x >= box[0] - 400 && x <= box[2] + 400 && y >= box[1] - 400 && y <= box[3] + 400) door = { f, op, x, y };
  }
  const alongX = door ? !door.f.horiz : (box[2] - box[0]) > (box[3] - box[1]);
  const across = alongX ? box[3] - box[1] : box[2] - box[0];
  const n = Math.max(1, Math.min(2, Math.floor(across / 2800)));
  for (let s = 0; s < n; s++) {
    const t = (s + 0.5) / n;
    let cx = alongX ? (box[0] + box[2]) / 2 : box[0] + (box[2] - box[0]) * t;
    let cy = alongX ? box[1] + (box[3] - box[1]) * t : (box[1] + box[3]) / 2;
    // park clear of the door (the door panels run up inside the garage)
    if (door) { if (alongX) cx += door.x > cx ? -450 : 450; else cy += door.y > cy ? -450 : 450; }
    car(cx, cy, alongX, s % 2 ? 'carBody2' : 'carBody', H.garage);
  }
}

function car(cx, cy, alongX, key, base) {
  const L = 4450, Wd = 1800;
  const [hl, hw] = alongX ? [L / 2, Wd / 2] : [Wd / 2, L / 2];
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(k(L), 0.62, k(Wd)), M(key)); body.position.y = 0.52; g.add(body);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(k(L * 0.52), 0.5, k(Wd * 0.9)), M('carGlass')); cab.position.set(-0.15, 1.05, 0); g.add(cab);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(k(L * 0.46), 0.06, k(Wd * 0.86)), M(key)); roof.position.set(-0.2, 1.31, 0); g.add(roof);
  for (const [dx, dz] of [[1.45, 0.8], [1.45, -0.8], [-1.45, 0.8], [-1.45, -0.8]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 20), M('tyre')); w.rotation.x = Math.PI / 2; w.position.set(dx, 0.34, dz); g.add(w);
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.position.set(k(cx), k(base), k(cy));
  if (!alongX) g.rotation.y = Math.PI / 2;
  grp.add(g);
  col(cx - hl, cy - hw, cx + hl, cy + hw, base, base + 1450, 'car');
}

function alfresco(r) {
  if (/porch|entry/i.test(r.name)) return;
  const box = mainRect(r);
  const W = box[2] - box[0], D = box[3] - box[1];
  if (Math.min(W, D) < 2200) return;
  const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2, lv = ctx.H.outdoor;
  const alongX = W >= D;
  const [hx, hy] = alongX ? [800, 400] : [400, 800];
  B(cx - hx, cy - hy, cx + hx, cy + hy, lv + 700, lv + 740, 'wood');
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B(cx + sx * (hx - 80) - 25, cy + sy * (hy - 80) - 25, cx + sx * (hx - 80) + 25, cy + sy * (hy - 80) + 25, lv, lv + 700, 'black');
  col(cx - hx, cy - hy, cx + hx, cy + hy, lv, lv + 740);
  for (const off of [-450, 450]) {
    if (alongX) { chairAt(cx + off, cy - hy - 200, 'S'); chairAt(cx + off, cy + hy + 200, 'N'); }
    else { chairAt(cx - hx - 200, cy + off, 'E'); chairAt(cx + hx + 200, cy + off, 'W'); }
  }
  function chairAt(x, y, f) { const g0 = bt; chair(x, y, f, 'fabricDark'); void g0; }
}

// ---------------------------------------------------------------------------
export function buildInterior(model, spec, H, colliders) {
  ctx = { model, spec, H, colliders, pendants: [] };
  bt = new Batch('interior');
  grp = new THREE.Group(); grp.name = 'interior-meshes';
  const show = spec.furniture.show;
  const bedrooms = model.rooms.filter(r => r.type === 'bedroom');
  const master = bedrooms.find(r => /master|main|suite/i.test(r.name)) || bedrooms.slice().sort((a, b) => (b.area || 0) - (a.area || 0))[0];
  for (const r of model.rooms) {
    try {
      switch (r.type) {
        case 'kitchen': kitchen(r); break;
        case 'bath': case 'ensuite': case 'wc': case 'laundry': bathroom(r); break;
        case 'pantry': shelving(r, 'pantryShelf', 400); break;
        case 'wir': wir(r); break;
        case 'store': if ((r.area || 0) < 3) shelving(r, 'shelf', 450); break;
        case 'bedroom': if (show) bedroom(r, r === master); break;
        case 'living': if (show) living(r); break;
        case 'dining': if (show) dining(r); break;
        case 'study': if (show) study(r); break;
        case 'garage': garage(r); break;
        case 'outdoor': if (show) alfresco(r); break;
        default: break;
      }
    } catch (e) { console.warn('fit-out failed for', r.name, e); }
  }
  const g = new THREE.Group(); g.name = 'interior';
  g.add(bt.build(), grp);
  return { group: g, pendants: ctx.pendants };
}

export { WET };

// Debug helper: wall sides & free spans the fit-out sees for a room
export function debugRoom(model, spec, H, id) {
  ctx = { model, spec, H, colliders: [], pendants: [] };
  const r = model.rooms.find(q => q.id === id || q.name === id);
  const box = r.rects.length > 1 ? bboxOf(r.rects) : r.rects[0];
  const main = mainRect(r);
  return { box, main, sides: ['N', 'S', 'W', 'E'].map(s => { const i = sideInfo(main, s); return { s, c: i.c, covered: i.covered, blocked: i.blocked.map(b => [b.type, b.a, b.b, b.sill]), free: freeSpans(i, { minSill: 900 }) }; }) };
}
