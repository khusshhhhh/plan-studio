// Builds the dwelling from the recognised model + the chosen specification.
// Everything is rebuilt from scratch on every change (fast: tens of milliseconds), so any
// option – or any single door/window edited in the inspector – shows up instantly.
import * as THREE from 'three';
import { Batch } from './batch.js';
import { M } from './materials.js';
import { buildHipRoof, buildGableRoof, buildSkillionRoof, buildFlatRoof, offsetOrtho, pointInPoly, signedArea } from './roof.js';
import { WET } from '../analyze/text.js';

const k = v => v / 1000;
const ease = x => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;

export function heightsOf(spec) {
  const ceiling = +spec.structure.ceiling;
  return {
    ceiling, raised: Math.max(ceiling, +spec.structure.raised),
    lintel: Math.min(+spec.windows.head, ceiling - 30), extDoor: Math.min(+spec.doors.extHeight, ceiling), intDoor: Math.min(+spec.doors.intHeight, ceiling),
    arch: Math.min(+spec.doors.archHeight, ceiling), slab: +spec.structure.slab, garage: -spec.structure.garageStep, outdoor: -spec.structure.outdoorStep,
    eaveY: ceiling + 80, parapet: ceiling + 900,
  };
}

// ---------------------------------------------------------------------------
// Model helpers
// ---------------------------------------------------------------------------
export function roomAt(model, x, y) {
  for (const r of model.rooms) for (const q of r.rects) if (x >= q[0] - 1 && x <= q[2] + 1 && y >= q[1] - 1 && y <= q[3] + 1) return r;
  return null;
}
export const wallFrame = w => {
  const [x1, y1, x2, y2] = w.rect;
  const horiz = w.o ? w.o === 'H' : (x2 - x1) >= (y2 - y1);
  return { horiz, L0: horiz ? x1 : y1, L1: horiz ? x2 : y2, T0: horiz ? y1 : x1, T1: horiz ? y2 : x2 };
};
export function sidesOf(model, w, op) {
  const f = wallFrame(w), mid = (op.a + op.b) / 2, off = (f.T1 - f.T0) / 2 + 300, tc = (f.T0 + f.T1) / 2;
  const P = t => f.horiz ? [mid, t] : [t, mid];
  return [roomAt(model, ...P(tc - off)), roomAt(model, ...P(tc + off))];
}

// Opening with all heights/styles resolved against the spec
export function resolveOpening(model, spec, H, w, op) {
  const [r0, r1] = sidesOf(model, w, op);
  const wet = [r0, r1].some(r => r && WET.has(r.type));
  const o = { ...op, rooms: [r0, r1], wet };
  const ext = w.kind === 'ext';
  switch (op.type) {
    case 'door': o.head = op.head ?? (ext ? H.extDoor : H.intDoor); o.sill = 0; break;
    case 'slider': o.head = op.head ?? H.extDoor; o.sill = 0; break;
    case 'garage': o.head = op.head ?? (op.h && op.h > 1800 ? op.h : +spec.garage.height); o.sill = H.garage; break;
    case 'arch': o.head = op.head ?? (op.h && op.h >= 1800 && op.h <= H.ceiling ? op.h : H.arch); o.sill = 0; break;
    case 'void': o.head = op.head ?? H.ceiling; o.sill = 0; break;
    default: { // window
      o.head = op.head ?? H.lintel;
      let hgt = op.h ?? (wet ? +spec.windows.wetHeight : +spec.windows.height);
      // unlabelled kitchen / laundry windows sit above the benchtop
      if (op.h == null && [r0, r1].some(r => r && (r.type === 'kitchen' || r.type === 'laundry'))) hgt = Math.min(hgt, o.head - 1050);
      o.sill = op.sill ?? Math.max(150, o.head - hgt);
      o.style = op.style || spec.windows.style;
      o.obscure = op.obscure || (wet && spec.windows.obscureWet);
    }
  }
  o.head = Math.min(o.head, H.ceiling);
  if (o.sill >= o.head - 100) o.sill = Math.max(0, o.head - 300);
  return o;
}

// ---------------------------------------------------------------------------
export function buildHouse(model, spec, env = {}) {
  const H = heightsOf(spec);
  const ctx = {
    model, spec, H, colliders: [], doors: [], interactables: [], picks: [],
    dynamic: new THREE.Group(), entry: null,
  };
  ctx.dynamic.name = 'dynamic';
  const structure = new Batch('structure'), glass = new Batch('glass'), upper = new Batch('ceiling');
  ctx.addCollider = (x1, y1, x2, y2, h0, h1, tag) => ctx.colliders.push({ x1: Math.min(x1, x2), y1: Math.min(y1, y2), x2: Math.max(x1, x2), y2: Math.max(y1, y2), h0, h1, tag });

  pickEntry(ctx);
  buildWalls(ctx, structure, glass);
  buildColumnsBeams(ctx, structure, upper);
  buildFloors(ctx, structure);
  buildCeilings(ctx, upper);
  buildRobes(ctx, structure);
  const roof = buildRoof(ctx, structure);
  buildDownpipes(ctx, structure, roof);

  const structGroup = structure.build();
  const glassGroup = glass.build({ castShadow: false, receiveShadow: false });
  glassGroup.traverse(o => { if (o.isMesh) o.renderOrder = 2; });
  const ceilingGroup = upper.build({ castShadow: true });
  return {
    structGroup, glassGroup, ceilingGroup, roof, dynamicGroup: ctx.dynamic,
    colliders: ctx.colliders, doors: ctx.doors, interactables: ctx.interactables, H,
    levelAt: (x, y) => levelAt(ctx, x, y), entry: ctx.entry,
  };
}

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------
function roomLevel(H, r) {
  if (!r) return null;
  if (r.type === 'garage') return H.garage;
  if (r.type === 'outdoor') return H.outdoor;
  return 0;
}
function levelAt(ctx, x, y) {
  const { model, H } = ctx;
  for (const r of model.rooms) if (r.type === 'outdoor' || r.type === 'garage') for (const q of r.rects) if (x >= q[0] && x <= q[2] && y >= q[1] && y <= q[3]) return roomLevel(H, r);
  if (model.houseOutline.length && pointInPoly(x, y, model.houseOutline)) {
    const r = roomAt(model, x, y);
    return r ? roomLevel(H, r) : 0;
  }
  return null;
}

function pickEntry(ctx) {
  let best = null, score = -1;
  for (const w of ctx.model.walls) {
    if (w.kind !== 'ext') continue;
    for (const op of w.openings) {
      if (op.type !== 'door') continue;
      const [r0, r1] = sidesOf(ctx.model, w, op);
      let s = (op.b - op.a) / 100;
      for (const r of [r0, r1]) if (r) { if (/entry|foyer/i.test(r.name)) s += 30; if (/porch/i.test(r.name)) s += 25; if (r.type === 'hall' || r.type === 'living') s += 5; if (r.type === 'garage' || r.type === 'laundry') s -= 20; }
      if (s > score) { score = s; best = op.id; }
    }
  }
  ctx.entry = best;
}

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------
function wbox(batch, f, a0, a1, t0, t1, h0, h1, faces) {
  if (f.horiz) batch.box(k(a0), k(h0), k(t0), k(a1), k(h1), k(t1), faces);
  else batch.box(k(t0), k(h0), k(a0), k(t1), k(h1), k(a1), faces);
}
function F(f, longA, longB, endA, endB, top = 'poche', bottom = 'plaster') {
  return f.horiz ? { nz: longA, pz: longB, nx: endA, px: endB, py: top, ny: bottom } : { nx: longA, px: longB, nz: endA, pz: endB, py: top, ny: bottom };
}

function wallSideKeys(ctx, w) {
  // longA = T0 side (−y or −x), longB = T1 side
  const outKey = isFeatureWall(ctx, w) ? 'feature' : 'extWall';
  if (w.kind === 'ext') {
    const outA = w.ext === 'N' || w.ext === 'W';
    return [outA ? outKey : 'plaster', outA ? 'plaster' : outKey, outKey];
  }
  return ['plaster', 'plaster', 'plaster'];
}
function isFeatureWall(ctx, w) {
  if (ctx.spec.exterior.featureMaterial === 'same' || w.kind !== 'ext') return false;
  const f = wallFrame(w), outSign = (w.ext === 'N' || w.ext === 'W') ? -1 : 1;
  const tc = outSign < 0 ? f.T0 - 400 : f.T1 + 400, mid = (f.L0 + f.L1) / 2;
  const r = roomAt(ctx.model, ...(f.horiz ? [mid, tc] : [tc, mid]));
  return !!(r && r.type === 'outdoor' && /porch|entry/i.test(r.name));
}

function buildWalls(ctx, batch, glassBatch) {
  const { model, spec, H } = ctx;
  const flat = spec.roof.type === 'flat';
  for (const w of model.walls) {
    const f = wallFrame(w);
    const top = w.kind === 'ext' && flat ? H.parapet : H.ceiling;
    const base = w.kind === 'ext' ? -H.slab : 0;
    const ops = w.openings.map(op => resolveOpening(model, spec, H, w, op)).sort((p, q) => p.a - q.a);
    const [LA, LB, END] = wallSideKeys(ctx, w);
    let cur = f.L0;
    const segs = [];
    for (const op of ops) {
      const a = Math.max(op.a, f.L0), b = Math.min(op.b, f.L1);
      if (b <= a) continue;
      if (a > cur) segs.push({ a: cur, b: a, h0: base, h1: top, endA: segs.length === 0 && cur === f.L0 ? null : 'plaster', endB: 'plaster' });
      const sill = op.type === 'garage' ? op.sill : op.sill;
      if (sill > base + 1) segs.push({ a, b, h0: base, h1: sill, endA: 'plaster', endB: 'plaster', top: op.type === 'win' ? 'plaster' : 'poche' });
      if (op.head < top - 1) segs.push({ a, b, h0: op.head, h1: top, endA: 'plaster', endB: 'plaster', bottom: 'plaster' });
      cur = Math.max(cur, b);
    }
    if (cur < f.L1) segs.push({ a: cur, b: f.L1, h0: base, h1: top, endA: ops.length ? 'plaster' : null, endB: null });
    for (const s of segs) {
      const ea = s.endA || END, eb = s.endB || END;
      wbox(batch, f, s.a, s.b, f.T0, f.T1, s.h0, s.h1, F(f, LA, LB, ea, eb, s.top || 'poche', s.bottom || 'plaster'));
      if (f.horiz) ctx.addCollider(s.a, f.T0, s.b, f.T1, s.h0, s.h1, w.id); else ctx.addCollider(f.T0, s.a, f.T1, s.b, s.h0, s.h1, w.id);
    }
    // parapet capping
    if (w.kind === 'ext' && flat) wbox(batch, f, f.L0 - 20, f.L1 + 20, f.T0 - 20, f.T1 + 20, top, top + 30, 'gutter');
    // skirting
    const sk = +spec.doors.skirting;
    if (sk > 0) {
      const runs = [];
      let c = f.L0;
      for (const op of ops) { if (op.a > c) runs.push([c, op.a]); c = Math.max(c, op.b); }
      if (c < f.L1) runs.push([c, f.L1]);
      for (const [a, b] of runs) for (const side of [0, 1]) {
        const key = side === 0 ? LA : LB;
        if (key !== 'plaster') continue;
        if (side === 0) wbox(batch, f, a, b, f.T0 - 12, f.T0, 0, sk, 'trim'); else wbox(batch, f, a, b, f.T1, f.T1 + 12, 0, sk, 'trim');
      }
    }
    for (const op of ops) {
      if (op.type === 'win') buildWindow(ctx, batch, glassBatch, w, f, op);
      else if (op.type === 'door') buildHingedDoor(ctx, batch, w, f, op);
      else if (op.type === 'slider') buildSlider(ctx, batch, w, f, op);
      else if (op.type === 'garage') buildGarageDoor(ctx, batch, w, f, op);
      ctx.picks.push({ kind: 'opening', wall: w.id, id: op.id, f, op });
    }
    ctx.picks.push({ kind: 'wall', id: w.id, f });
  }
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------
function buildWindow(ctx, batch, glassBatch, w, f, op) {
  const tc = (f.T0 + f.T1) / 2;
  const fw = 45, fd = 60, a = op.a, b = op.b, s = op.sill, h = op.head;
  const glassKey = op.obscure ? 'obscure' : 'glass';
  const fr = (a0, a1, h0, h1, d0 = tc - fd / 2, d1 = tc + fd / 2) => wbox(batch, f, a0, a1, d0, d1, h0, h1, 'frame');
  const gl = (a0, a1, h0, h1, dz = 0) => wbox(glassBatch, f, a0, a1, tc + dz - 3, tc + dz + 3, h0, h1, glassKey);
  fr(a, a + fw, s, h); fr(b - fw, b, s, h); fr(a, b, s, s + fw); fr(a, b, h - fw, h);
  const outSide = w.ext === 'N' || w.ext === 'W' ? -1 : 1;
  if (w.kind === 'ext') {
    const d0 = outSide < 0 ? f.T0 - 25 : tc, d1 = outSide < 0 ? tc : f.T1 + 25;
    wbox(batch, f, a - 10, b + 10, d0, d1, s - 25, s, 'frame');
  }
  // internal reveal sill board
  const inT = outSide < 0 ? [tc + fd / 2, f.T1 + 15] : [f.T0 - 15, tc - fd / 2];
  wbox(batch, f, a - 20, b + 20, inT[0], inT[1], s - 20, s, 'trim');
  const wid = b - a, ai = a + fw, bi = b - fw, si = s + fw, hi = h - fw;
  const style = op.style;
  if (style === 'AFW') gl(ai, bi, si, hi);
  else if (style === 'ASW') {
    const m = (a + b) / 2;
    fr(m - 22, m + 22, si, hi);
    fr(ai, m - 22, si, si + 35, tc - 25, tc - 5); fr(ai, m - 22, hi - 35, hi, tc - 25, tc - 5);
    fr(m + 22, bi, si, si + 35, tc + 5, tc + 25); fr(m + 22, bi, hi - 35, hi, tc + 5, tc + 25);
    gl(ai, m - 22, si + 35, hi - 35, -15); gl(m + 22, bi, si + 35, hi - 35, 15);
  } else if (style === 'ADH') {
    const mr = (s + h) / 2;
    fr(ai, bi, mr - 25, mr + 25);
    gl(ai, bi, si, mr - 25, -12); gl(ai, bi, mr + 25, hi, 12);
  } else if (style === 'ACW') {
    const n = Math.max(1, Math.round(wid / 700));
    for (let i = 1; i < n; i++) { const m = a + wid * i / n; fr(m - 20, m + 20, si, hi); }
    for (let i = 0; i < n; i++) gl(a + wid * i / n + (i ? 20 : fw), a + wid * (i + 1) / n - (i < n - 1 ? 20 : fw), si, hi);
  } else if (style === 'LOUVRE') {
    for (let y = si + 60; y < hi - 20; y += 110) {
      const dz = outSide * 0;
      wbox(glassBatch, f, ai, bi, tc - 30 + dz, tc + 30 + dz, y - 4, y + 4, glassKey);
    }
  } else { // AAW awning: transom + mullion
    const tr = s + (h - s) * 0.35;
    fr(ai, bi, tr - 20, tr + 20);
    if (wid > 1000) {
      const m = (a + b) / 2;
      fr(m - 20, m + 20, si, hi);
      gl(ai, m - 20, si, tr - 20); gl(m + 20, bi, si, tr - 20); gl(ai, m - 20, tr + 20, hi); gl(m + 20, bi, tr + 20, hi);
    } else { gl(ai, bi, si, tr - 20); gl(ai, bi, tr + 20, hi); }
  }
  // coverings on the inside face
  if (w.kind === 'ext' && !op.wet) {
    const cov = ctx.spec.windows.coverings;
    const inner = outSide < 0 ? f.T1 : f.T0, dir = outSide < 0 ? 1 : -1;
    if (cov === 'roller') {
      wbox(batch, f, a - 40, b + 40, inner + dir * 20, inner + dir * 90, h + 20, h + 110, 'blind');
      wbox(batch, f, a - 30, b + 30, inner + dir * 50, inner + dir * 55, h - (h - s) * 0.3, h + 30, 'blind');
    } else if (cov === 'sheer') {
      wbox(batch, f, a - 350, b + 350, inner + dir * 120, inner + dir * 126, 20, Math.min(ctx.H.ceiling - 40, h + 250), 'curtain');
      wbox(batch, f, a - 380, b + 380, inner + dir * 110, inner + dir * 140, Math.min(ctx.H.ceiling - 40, h + 250), Math.min(ctx.H.ceiling - 20, h + 275), 'black');
    } else if (cov === 'shutters') {
      const n = Math.max(2, Math.round(wid / 450));
      for (let i = 0; i < n; i++) {
        const p0 = a + wid * i / n + 5, p1 = a + wid * (i + 1) / n - 5;
        for (let y = s + 40; y < h - 40; y += 90) wbox(batch, f, p0, p1, inner + dir * 30, inner + dir * 70, y, y + 12, 'shutter');
        wbox(batch, f, p0, p0 + 40, inner + dir * 30, inner + dir * 70, s, h, 'shutter'); wbox(batch, f, p1 - 40, p1, inner + dir * 30, inner + dir * 70, s, h, 'shutter');
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Doors
// ---------------------------------------------------------------------------
class Door {
  constructor(ctx, { pivot, meshes, kind, label, closedAngle = 0, openAngle = Math.PI / 2, collider, update, startOpen = 0, opId }) {
    Object.assign(this, { pivot, meshes, kind, label, closedAngle, openAngle, collider, _update: update, opId });
    this.t = startOpen; this.target = startOpen;
    this.apply();
    for (const m of meshes) {
      m.userData.door = this; m.userData.openingId = opId;
      ctx.interactables.push({ mesh: m, action: () => this.toggle(), get hint() { return `${this.door.target > 0.5 ? 'Close' : 'Open'} ${this.door.label}`; }, door: this });
    }
  }
  toggle() { this.target = this.target > 0.5 ? 0 : 1; }
  isClosed() { return this.t < 0.15; }
  apply() { if (this._update) this._update(this.t); else this.pivot.rotation.y = this.closedAngle + (this.openAngle - this.closedAngle) * ease(this.t); }
  step(dt) {
    if (this.t === this.target) return;
    const speed = this.kind === 'garage' ? 0.35 : 1.6;
    this.t += Math.sign(this.target - this.t) * Math.min(Math.abs(this.target - this.t), dt * speed);
    this.apply();
  }
}

function addBox(g, w, h, d, x, y, z, key, meshes) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M(key));
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m);
  if (meshes) meshes.push(m);
  return m;
}

// Door leaf (local: x from hinge 0 → w, y up, z thickness), styled
function leaf(spec, W, Hh, T, key, style, handleSide = 1, { entry = false } = {}) {
  const g = new THREE.Group(), meshes = [];
  const hw = 'hardware';
  if (style === 'glassPanel' || style === 'glass' || style === 'halfGlass') {
    const fr = entry ? key : style === 'glass' && !entry ? 'black' : key;
    const s = 0.1;
    addBox(g, W, s, T, W / 2, Hh - s / 2, 0, fr, meshes); addBox(g, W, 0.2, T, W / 2, 0.1, 0, fr, meshes);
    addBox(g, s, Hh, T, s / 2, Hh / 2, 0, fr, meshes); addBox(g, s, Hh, T, W - s / 2, Hh / 2, 0, fr, meshes);
    const gTop = Hh - s, gBot = style === 'halfGlass' ? Hh / 2 : 0.2;
    if (style === 'halfGlass') addBox(g, W - 2 * s, gBot - 0.2, T, W / 2, (gBot + 0.2) / 2, 0, fr, meshes);
    addBox(g, W - 2 * s, gTop - gBot, 0.008, W / 2, (gTop + gBot) / 2, 0, 'glass', meshes);
  } else {
    addBox(g, W, Hh, T, W / 2, Hh / 2, 0, key, meshes);
    const groove = (y) => { for (const s of [-1, 1]) addBox(g, W - 0.02, 0.008, 0.004, W / 2, y, s * (T / 2 + 0.001), 'cabGap'); };
    if (style === 'grooves') { groove(Hh * 0.35); groove(Hh * 0.5); groove(Hh * 0.65); }
    if (style === 'vgroove') for (let x = 0.1; x < W - 0.05; x += 0.1) for (const s of [-1, 1]) addBox(g, 0.006, Hh - 0.02, 0.004, x, Hh / 2, s * (T / 2 + 0.001), 'cabGap');
    if (style === 'shaker' || style === 'twoPanel' || style === 'farmhouse') {
      const panels = style === 'twoPanel' ? [[0.12, Hh * 0.45], [Hh * 0.5, Hh - 0.12]] : [[0.12, Hh - 0.12]];
      for (const [y0, y1] of panels) for (const s of [-1, 1]) {
        const z = s * (T / 2 + 0.004);
        addBox(g, W - 0.24, 0.02, 0.008, W / 2, y0, z, key); addBox(g, W - 0.24, 0.02, 0.008, W / 2, y1, z, key);
        addBox(g, 0.02, y1 - y0, 0.008, 0.12, (y0 + y1) / 2, z, key); addBox(g, 0.02, y1 - y0, 0.008, W - 0.12, (y0 + y1) / 2, z, key);
      }
    }
    if (style === 'glassStrip') addBox(g, 0.1, Hh - 0.5, T + 0.004, entry ? 0.18 : W - 0.18, Hh / 2, 0, 'glass');
  }
  // hardware
  const hx = W - 0.065;
  const hType = entry ? spec.doors.entryHandle : spec.doors.handle;
  for (const s of [-1, 1]) {
    if (hType === 'pull' && entry) {
      addBox(g, 0.03, 1.2, 0.03, W - 0.12, 1.05, s * (T / 2 + 0.06), hw);
      for (const yy of [0.5, 1.6]) addBox(g, 0.02, 0.02, 0.06, W - 0.12, yy, s * (T / 2 + 0.03), hw);
    } else if (hType === 'knob') {
      const kn = new THREE.Mesh(new THREE.SphereGeometry(0.028, 16, 12), M(hw)); kn.position.set(hx, 1.0, s * (T / 2 + 0.05)); g.add(kn);
      addBox(g, 0.014, 0.014, 0.05, hx, 1.0, s * (T / 2 + 0.025), hw);
    } else if (hType === 'pull') {
      addBox(g, 0.02, 0.3, 0.02, hx, 1.0, s * (T / 2 + 0.03), hw);
    } else {
      const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.012, 16), M(hw));
      rose.rotation.x = Math.PI / 2; rose.position.set(hx, 1.0, s * (T / 2 + 0.006)); g.add(rose);
      addBox(g, 0.13, 0.018, 0.018, W - 0.11, 1.0, s * (T / 2 + 0.05), hw);
      addBox(g, 0.018, 0.018, 0.05, hx, 1.0, s * (T / 2 + 0.028), hw);
    }
  }
  void handleSide;
  return { group: g, meshes };
}

function architraves(ctx, batch, w, f, op, head) {
  const at = +ctx.spec.doors.architrave;
  const t0 = f.T0, t1 = f.T1;
  // jamb liners + head
  wbox(batch, f, op.a, op.a + 20, t0, t1, 0, head, 'trim');
  wbox(batch, f, op.b - 20, op.b, t0, t1, 0, head, 'trim');
  wbox(batch, f, op.a, op.b, t0, t1, head - 20, head, 'trim');
  if (!at) return;
  const sides = w.kind === 'ext' ? [w.ext === 'N' || w.ext === 'W' ? 'T1' : 'T0'] : ['T0', 'T1'];
  for (const sd of sides) {
    const d0 = sd === 'T0' ? t0 - 16 : t1, d1 = sd === 'T0' ? t0 : t1 + 16;
    wbox(batch, f, op.a - at, op.a + 10, d0, d1, 0, head + at, 'trim');
    wbox(batch, f, op.b - 10, op.b + at, d0, d1, 0, head + at, 'trim');
    wbox(batch, f, op.a - at, op.b + at, d0, d1, head, head + at, 'trim');
  }
}

function buildHingedDoor(ctx, batch, w, f, op) {
  const { spec } = ctx;
  const Wd = op.b - op.a, head = op.head, tc = (f.T0 + f.T1) / 2;
  const isEntry = op.id === ctx.entry;
  const ext = w.kind === 'ext';
  architraves(ctx, batch, w, f, op, head);
  const intStyle = spec.doors.intStyle;
  if (!ext && intStyle === 'barn') return buildBarnDoor(ctx, w, f, op);
  const key = isEntry ? 'entry' : ext ? 'extDoor' : 'intDoor';
  const style = isEntry ? spec.doors.entryStyle : ext ? spec.doors.extDoorStyle : intStyle;
  const double = op.style === 'double' || (isEntry && style === 'pivot' && Wd > 1400 && false);
  const clear = Wd - 40;
  const leaves = double ? [{ hinge: 'a', w: clear / 2 - 3 }, { hinge: 'b', w: clear / 2 - 3 }] : [{ hinge: op.hinge || 'a', w: clear - 6 }];
  const lh = (head - 20 - 12) / 1000;
  for (const L of leaves) {
    const { group, meshes } = leaf(spec, L.w / 1000, lh, 0.038, key, style, 1, { entry: isEntry });
    group.position.y = 0.008;
    const pivot = new THREE.Group();
    const hingeAlong = L.hinge === 'a' ? op.a + 22 : op.b - 22;
    pivot.position.set(f.horiz ? k(hingeAlong) : k(tc), 0, f.horiz ? k(tc) : k(hingeAlong));
    pivot.add(group);
    ctx.dynamic.add(pivot);
    const u = f.horiz ? [L.hinge === 'a' ? 1 : -1, 0] : [0, L.hinge === 'a' ? 1 : -1];
    const sw = op.swing || 1;
    const sdir = f.horiz ? [0, sw] : [sw, 0];
    const ang = v => Math.atan2(v[1], v[0]);
    const base = -ang(u);
    let open = -(ang(sdir) - ang(u));
    while (open > Math.PI) open -= 2 * Math.PI;
    while (open < -Math.PI) open += 2 * Math.PI;
    const coll = f.horiz ? { x1: op.a, y1: tc - 25, x2: op.b, y2: tc + 25 } : { x1: tc - 25, y1: op.a, x2: tc + 25, y2: op.b };
    const startOpen = ext ? 0 : spec.doors.openInternal ? 1 : 0;
    const label = isEntry ? 'entry door' : (op.rooms && op.rooms.find(r => r) ? `${op.rooms.find(r => r).name} door` : 'door');
    const d = new Door(ctx, { pivot, meshes, kind: 'hinge', label, closedAngle: base, openAngle: base + open * 0.95, collider: { ...coll, h0: 0, h1: head }, startOpen, opId: op.id });
    ctx.doors.push(d);
  }
}

function buildBarnDoor(ctx, w, f, op) {
  const tc = (f.T0 + f.T1) / 2, Wd = op.b - op.a + 100, head = op.head;
  const side = (op.swing || 1) > 0 ? f.T1 + 30 : f.T0 - 30;
  const { group, meshes } = leaf(ctx.spec, Wd / 1000, (head + 30) / 1000, 0.035, 'intDoor', 'shaker');
  const g = new THREE.Group(); g.add(group);
  group.position.set(-Wd / 2000, 0.01, 0);
  ctx.dynamic.add(g);
  const place = t => { const al = (op.a + op.b) / 2 + t * (op.b - op.a + 60); if (f.horiz) { g.position.set(k(al), 0, k(side)); g.rotation.y = 0; } else { g.position.set(k(side), 0, k(al)); g.rotation.y = -Math.PI / 2; } };
  const railLen = 2 * Wd + 100;
  const rail = new THREE.Mesh(new THREE.BoxGeometry(f.horiz ? k(railLen) : 0.02, 0.04, f.horiz ? 0.02 : k(railLen)), M('hardware'));
  const mid = (op.a + op.b) / 2 + (op.b - op.a) / 2;
  rail.position.set(f.horiz ? k(mid) : k(side), k(head + 80), f.horiz ? k(side) : k(mid));
  ctx.dynamic.add(rail);
  const coll = f.horiz ? { x1: op.a, y1: tc - 60, x2: op.b, y2: tc + 60 } : { x1: tc - 60, y1: op.a, x2: tc + 60, y2: op.b };
  const d = new Door(ctx, { pivot: g, meshes, kind: 'slide', label: 'barn door', update: t => place(ease(t)), startOpen: ctx.spec.doors.openInternal ? 1 : 0, opId: op.id, collider: { ...coll, h0: 0, h1: head } });
  d.openCollider = { x1: 0, y1: 0, x2: 0, y2: 0, h0: 0, h1: 0 };
  void tc;
  ctx.doors.push(d);
}

function buildSlider(ctx, batch, w, f, op) {
  const tc = (f.T0 + f.T1) / 2, a = op.a, b = op.b, h = op.head;
  const fr = (a0, a1, h0, h1, d0, d1) => wbox(batch, f, a0, a1, d0, d1, h0, h1, 'frame');
  fr(a, a + 50, 0, h, tc - 40, tc + 40); fr(b - 50, b, 0, h, tc - 40, tc + 40);
  fr(a, b, h - 50, h, tc - 40, tc + 40); fr(a, b, 0, 20, tc - 40, tc + 40);
  const n = Math.max(2, Math.min(4, +ctx.spec.windows.sliderPanels || 2));
  const pw = (b - a - 100) / n + 30;
  const glassKey = op.obscure ? 'obscure' : 'glass';
  const makePanel = () => {
    const g = new THREE.Group();
    const W = pw / 1000, Hh = (h - 70) / 1000;
    for (const [pw2, ph, x, y] of [[W, 0.05, 0, Hh - 0.025], [W, 0.07, 0, 0.035], [0.05, Hh, -W / 2 + 0.025, Hh / 2], [0.05, Hh, W / 2 - 0.025, Hh / 2]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(pw2, ph, 0.035), M('frame')); m.position.set(x, y, 0); m.castShadow = true; g.add(m);
    }
    const gl = new THREE.Mesh(new THREE.BoxGeometry(W - 0.1, Hh - 0.12, 0.008), M(glassKey)); gl.position.set(0, Hh / 2, 0); g.add(gl);
    return g;
  };
  const outer = w.ext === 'N' || w.ext === 'W' ? -1 : 1;
  const place = (g, along, dz) => { if (f.horiz) g.position.set(k(along), 0.02, k(tc + dz)); else { g.position.set(k(tc + dz), 0.02, k(along)); g.rotation.y = Math.PI / 2; } };
  const panels = [];
  for (let i = 0; i < n; i++) {
    const g = makePanel(); ctx.dynamic.add(g);
    const home = a + 50 + pw / 2 + i * (b - a - 100 - pw) / (n - 1);
    const dz = (i === 0 ? outer * 18 : -outer * 18 + (i - 1) * -outer * 14);
    place(g, home, dz);
    panels.push({ g, home, dz });
  }
  // panels 1..n-1 slide towards panel 0 (stacker)
  const meshes = [];
  for (let i = 1; i < n; i++) panels[i].g.traverse(o => { if (o.isMesh) meshes.push(o); });
  const coll = f.horiz ? { x1: a, y1: tc - 40, x2: b, y2: tc + 40 } : { x1: tc - 40, y1: a, x2: tc + 40, y2: b };
  const d = new Door(ctx, {
    pivot: panels[n - 1].g, meshes, kind: 'slide', label: 'sliding door', collider: { ...coll, h0: 0, h1: h }, opId: op.id,
    update: t => { for (let i = 1; i < n; i++) { const P = panels[i]; place(P.g, P.home + (panels[0].home - P.home) * ease(t) * 0.97, P.dz); } },
  });
  d.openCollider = f.horiz ? { x1: a, y1: tc - 40, x2: a + pw + 60, y2: tc + 40, h0: 0, h1: h } : { x1: tc - 40, y1: a, x2: tc + 40, y2: a + pw + 60, h0: 0, h1: h };
  ctx.doors.push(d);
}

function buildGarageDoor(ctx, batch, w, f, op) {
  const type = ctx.spec.garage.doorType;
  const outer = w.ext === 'N' || w.ext === 'W' ? -1 : 1;
  const insideT = outer > 0 ? f.T0 : f.T1, sgn = -outer; // towards the inside
  const Wd = k(op.b - op.a) - 0.02, zc = k((op.a + op.b) / 2);
  const bottom = k(op.sill), top = k(op.head), Lv = top - bottom;
  const group = new THREE.Group(); ctx.dynamic.add(group);
  // local frame: X = inward normal, Z = along the wall; we build in "wall local" coords then orient
  const holder = new THREE.Group(); group.add(holder);
  const t0 = k(insideT);
  if (f.horiz) { holder.rotation.y = -Math.PI / 2 * (sgn > 0 ? 1 : -1) * 0; }
  const P = (x, y, z) => f.horiz ? [z, y, t0 + sgn * x] : [t0 + sgn * x, y, z];
  const meshes = [];
  const box = (sx, sy, sz, x, y, z, key, rot = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(f.horiz ? sz : sx, sy, f.horiz ? sx : sz), M(key));
    m.position.set(...P(x, y, z)); m.castShadow = true; m.receiveShadow = true;
    if (rot) { if (f.horiz) m.rotation.x = -sgn * rot; else m.rotation.z = sgn * rot; }
    group.add(m); return m;
  };
  let update;
  if (type === 'roller') {
    const drumR = 0.22;
    const curtain = box(0.02, Lv, Wd, -0.04, bottom + Lv / 2, zc, 'garageDoor'); meshes.push(curtain);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(drumR, drumR, Wd, 20), M('garageDoor'));
    drum.rotation[f.horiz ? 'z' : 'x'] = Math.PI / 2; drum.position.set(...P(drumR + 0.02, top + drumR, zc)); group.add(drum);
    update = t => { const e = ease(t), hgt = Math.max(0.02, Lv * (1 - e)); curtain.scale.y = hgt / Lv; curtain.position.y = top - hgt / 2; };
  } else if (type === 'tilt') {
    const panel = box(0.04, Lv, Wd, -0.03, bottom + Lv / 2, zc, 'garageDoor'); meshes.push(panel);
    update = t => {
      const e = ease(t), ang = e * Math.PI / 2;
      const cx = -0.03 + Math.sin(ang) * Lv * 0.5 + e * 0.2, cy = bottom + Lv / 2 + (1 - Math.cos(ang)) * Lv * 0.5 + e * Lv * 0.35;
      panel.position.set(...P(cx, cy, zc));
      if (f.horiz) panel.rotation.x = -sgn * ang; else panel.rotation.z = sgn * ang;
    };
  } else {
    const n = 5, ph = Lv / n, r = 0.28;
    const panels = [];
    for (let i = 0; i < n; i++) {
      const p = box(0.04, ph - 0.008, Wd, 0, 0, zc, 'garageDoor');
      panels.push(p); meshes.push(p);
    }
    const trackPt = s => {
      if (s <= Lv) return [-0.03, bottom + s, 0];
      const arc = Math.PI * r / 2;
      if (s <= Lv + arc) { const al = (s - Lv) / r; return [-0.03 + r - r * Math.cos(al), top + r * Math.sin(al), al]; }
      return [-0.03 + r + (s - Lv - arc), top + r, Math.PI / 2];
    };
    update = t => {
      for (let i = 0; i < n; i++) {
        const s = (i + 0.5) * ph + ease(t) * (Lv + 0.05);
        const [x, y, al] = trackPt(s);
        panels[i].position.set(...P(x, y, zc));
        if (f.horiz) panels[i].rotation.x = -sgn * al; else panels[i].rotation.z = sgn * al;
      }
    };
    for (const side of [-1, 1]) {
      box(0.04, Lv, 0.03, 0.0, bottom + Lv / 2, zc + side * (Wd / 2 + 0.03), 'steel');
      box(2.8, 0.03, 0.04, r + 1.4, top + r, zc + side * (Wd / 2 + 0.03), 'steel');
    }
    box(0.35, 0.12, 0.25, 3.1, top + r - 0.02, zc, 'plastic');
    box(3.0, 0.04, 0.05, 1.6, top + r + 0.02, zc, 'steel');
  }
  const coll = f.horiz ? { x1: op.a, y1: insideT - 60, x2: op.b, y2: insideT + 20 } : { x1: insideT - 60, y1: op.a, x2: insideT + 20, y2: op.b };
  const d = new Door(ctx, { pivot: group, meshes, kind: 'garage', label: 'garage door', update, collider: { ...coll, h0: op.sill, h1: op.head }, opId: op.id });
  ctx.doors.push(d);
  void batch;
}

// ---------------------------------------------------------------------------
// Robes
// ---------------------------------------------------------------------------
function buildRobes(ctx, batch) {
  const { spec, H } = ctx;
  for (const r of ctx.model.robes || []) {
    const [x1, y1, x2, y2] = r.rect;
    const alongZ = r.front === 'W' || r.front === 'E';
    const front = r.front === 'W' ? x1 : r.front === 'E' ? x2 : r.front === 'N' ? y1 : y2;
    const a = alongZ ? y1 : x1, b = alongZ ? y2 : x2, L = b - a;
    const inS = (r.front === 'W' || r.front === 'N') ? 1 : -1; // direction into the robe
    const box = (f0, f1, a0, a1, h0, h1, key) => alongZ ? batch.box(k(Math.min(f0, f1)), k(h0), k(a0), k(Math.max(f0, f1)), k(h1), k(a1), key) : batch.box(k(a0), k(h0), k(Math.min(f0, f1)), k(a1), k(h1), k(Math.max(f0, f1)), key);
    const back = r.front === 'W' ? x2 : r.front === 'E' ? x1 : r.front === 'N' ? y2 : y1;
    // bulkhead over the robe front
    box(front - 45, front + 45, a, b, 2100, H.ceiling, 'plaster');
    box(front + inS * 50, back, a, b, 1700, 1720, 'shelf');
    box((front + back) / 2 - 10, (front + back) / 2 + 10, a + 20, b - 20, 1600, 1620, 'chrome');
    ctx.addCollider(x1, y1, x2, y2, 0, H.ceiling, 'robe');
    const style = spec.joinery.robeDoors;
    if (style === 'hinged') {
      const n = Math.max(2, Math.round(L / 450));
      for (let i = 0; i < n; i++) {
        const p0 = a + L * i / n + 2, p1 = a + L * (i + 1) / n - 2;
        box(front - 18 * inS, front, p0, p1, 10, 2090, 'robeDoor');
        box(front - 18 * inS - 30 * inS, front - 18 * inS, (i % 2 ? p0 + 60 : p1 - 60) - 8, (i % 2 ? p0 + 60 : p1 - 60) + 8, 950, 1250, 'hardware');
      }
      continue;
    }
    const pw = L / 2 + 30;
    const mk = (key, dz) => {
      const g = new THREE.Group();
      const panel = new THREE.Mesh(new THREE.BoxGeometry(alongZ ? 0.03 : k(pw), 2.08, alongZ ? k(pw) : 0.03), M(key));
      panel.position.set(0, 1.05, 0); panel.castShadow = true; g.add(panel);
      const edgeKey = style === 'blackGlass' ? 'black' : 'frame';
      for (const s of [-1, 1]) {
        const e = new THREE.Mesh(new THREE.BoxGeometry(alongZ ? 0.036 : 0.025, 2.08, alongZ ? 0.025 : 0.036), M(edgeKey));
        if (alongZ) e.position.set(0, 1.05, s * (k(pw) / 2 - 0.012)); else e.position.set(s * (k(pw) / 2 - 0.012), 1.05, 0);
        g.add(e);
      }
      if (style === 'blackGlass') for (const yy of [0.02, 1.04, 2.06]) { const bar = new THREE.Mesh(new THREE.BoxGeometry(alongZ ? 0.036 : k(pw), 0.03, alongZ ? k(pw) : 0.036), M('black')); bar.position.set(0, yy, 0); g.add(bar); }
      if (alongZ) g.position.set(k(front + dz), 0.01, 0); else g.position.set(0, 0.01, k(front + dz));
      ctx.dynamic.add(g);
      return { g, panel };
    };
    const outS = -inS;
    const p1 = mk('robeDoor', outS * 20), p2 = mk(style === 'mirror' ? 'robeDoor' : 'robeDoor', -outS * 20);
    const cA = k(a + pw / 2), cB = k(b - pw / 2);
    if (alongZ) { p1.g.position.z = cA; p2.g.position.z = cB; } else { p1.g.position.x = cA; p2.g.position.x = cB; }
    const d = new Door(ctx, {
      pivot: p2.g, meshes: [p1.panel, p2.panel], kind: 'robe', label: 'robe doors',
      update: t => { const v = cB + (cA - cB) * ease(t) * 0.95; if (alongZ) p2.g.position.z = v; else p2.g.position.x = v; },
    });
    d.noCollide = true;
    ctx.doors.push(d);
  }
}

// ---------------------------------------------------------------------------
// Columns & beams (porch / alfresco)
// ---------------------------------------------------------------------------
function buildColumnsBeams(ctx, batch, upper) {
  const { model, spec, H } = ctx;
  const cs = +spec.structure.columnSize;
  for (const c of model.columns || []) {
    const [x1, y1, x2, y2] = c.rect;
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
    // keep the column's outer corner fixed when resizing
    const r = model.rooms.find(q => q.id === c.room);
    const box = r ? r.rects[0] : null;
    let X1 = cx - cs / 2, Y1 = cy - cs / 2;
    if (box) { X1 = Math.abs(x1 - box[0]) < Math.abs(x2 - box[2]) ? box[0] : box[2] - cs; Y1 = Math.abs(y1 - box[1]) < Math.abs(y2 - box[3]) ? box[1] : box[3] - cs; }
    batch.box(k(X1), k(-H.slab), k(Y1), k(X1 + cs), k(H.ceiling), k(Y1 + cs), { px: 'feature', nx: 'feature', pz: 'feature', nz: 'feature', py: 'poche', ny: 'feature' });
    ctx.addCollider(X1, Y1, X1 + cs, Y1 + cs, -H.slab, H.ceiling, 'column');
  }
  if (spec.structure.beams) for (const bm of model.beams || []) {
    const [x1, y1, x2, y2] = bm.rect;
    upper.box(k(x1), k(H.ceiling - 350), k(y1), k(x2), k(H.ceiling), k(y2), { px: 'beam', nx: 'beam', pz: 'beam', nz: 'beam', ny: 'beam', py: null });
  }
}

// ---------------------------------------------------------------------------
// Floors
// ---------------------------------------------------------------------------
function unionRects(rects, clipPoly = null, cell = 25) {
  if (!rects.length) return [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) { x0 = Math.min(x0, r[0]); y0 = Math.min(y0, r[1]); x1 = Math.max(x1, r[2]); y1 = Math.max(y1, r[3]); }
  const w = Math.ceil((x1 - x0) / cell) + 2, h = Math.ceil((y1 - y0) / cell) + 2;
  const a = new Uint8Array(w * h);
  for (const r of rects) {
    const i0 = Math.max(0, Math.floor((r[0] - x0) / cell) - 1), i1 = Math.min(w - 1, Math.ceil((r[2] - x0) / cell));
    const j0 = Math.max(0, Math.floor((r[1] - y0) / cell) - 1), j1 = Math.min(h - 1, Math.ceil((r[3] - y0) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) a[j * w + i] = 1;
  }
  if (clipPoly) for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (a[j * w + i] && !pointInPoly(x0 + (i + 0.5) * cell, y0 + (j + 0.5) * cell, clipPoly)) a[j * w + i] = 0;
  const out = [];
  let prev = new Map();
  for (let j = 0; j < h; j++) {
    const cur = new Map();
    let i = 0;
    while (i < w) {
      if (!a[j * w + i]) { i++; continue; }
      let e = i; while (e + 1 < w && a[j * w + e + 1]) e++;
      const key = i + ',' + e;
      if (prev.has(key)) { const r = out[prev.get(key)]; r[3] = j + 1; cur.set(key, prev.get(key)); }
      else { out.push([i, j, e + 1, j + 1]); cur.set(key, out.length - 1); }
      i = e + 1;
    }
    prev = cur;
  }
  return out.map(([i0, j0, i1, j1]) => [x0 + i0 * cell, y0 + j0 * cell, x0 + i1 * cell, y0 + j1 * cell]);
}

// House outline minus some rectangles, as a few rectangles (50 mm raster)
function floorMinus(poly, holes, cell = 50) {
  const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys);
  const w = Math.ceil((x1 - x0) / cell), h = Math.ceil((y1 - y0) / cell);
  const out = [];
  let prev = new Map();
  for (let j = 0; j < h; j++) {
    const cy = y0 + (j + 0.5) * cell;
    const row = new Uint8Array(w);
    // scanline: crossings of this row with the polygon edges
    const xsx = [];
    for (let e = 0, n = poly.length; e < n; e++) {
      const [ax, ay] = poly[e], [bx, by] = poly[(e + 1) % n];
      if ((ay > cy) !== (by > cy)) xsx.push(ax + (cy - ay) * (bx - ax) / (by - ay));
    }
    xsx.sort((a, b) => a - b);
    const hs = holes.filter(q => cy > q[1] - 60 && cy < q[3] + 60);
    for (let t = 0; t + 1 < xsx.length; t += 2) {
      const i0 = Math.max(0, Math.round((xsx[t] - x0) / cell)), i1 = Math.min(w, Math.round((xsx[t + 1] - x0) / cell));
      for (let i = i0; i < i1; i++) { const cx = x0 + (i + 0.5) * cell; row[i] = hs.some(q => cx > q[0] - 60 && cx < q[2] + 60) ? 0 : 1; }
    }
    const cur = new Map();
    let i = 0;
    while (i < w) {
      if (!row[i]) { i++; continue; }
      let e = i; while (e + 1 < w && row[e + 1]) e++;
      const key = i + ',' + e;
      if (prev.has(key)) { const r = out[prev.get(key)]; r[3] = j + 1; cur.set(key, prev.get(key)); }
      else { out.push([i, j, e + 1, j + 1]); cur.set(key, out.length - 1); }
      i = e + 1;
    }
    prev = cur;
  }
  return out.map(([a, b, c, d]) => [x0 + a * cell, y0 + b * cell, Math.min(x1, x0 + c * cell), Math.min(y1, y0 + d * cell)]);
}

function buildFloors(ctx, batch) {
  const { model, spec, H } = ctx;
  const toM = pts => pts.map(p => [k(p[0]), k(p[1])]);
  const house = model.houseOutline;
  const garageRects = model.rooms.filter(r => r.type === 'garage').flatMap(r => r.rects);
  // base floor: house outline minus the garage
  if (house.length >= 3) {
    if (!garageRects.length) batch.poly('floor_living', toM(house), 0, true);
    else for (const q of floorMinus(house, garageRects)) batch.box(k(q[0]), k(-40), k(q[1]), k(q[2]), k(0), k(q[3]), { py: 'floor_living' });
    // slab edge from ground to floor
    const n = house.length, ccw = signedArea(house) > 0;
    for (let i = 0; i < n; i++) {
      const a = house[i], b = house[(i + 1) % n];
      const [p, q] = ccw ? [b, a] : [a, b];
      batch.strip('slabEdge', [k(p[0]), k(p[1])], [k(q[0]), k(q[1])], k(-H.slab - 20), k(Math.min(0, -1)));
    }
  }
  const zone = { bedroom: 'floor_bedroom', wir: 'floor_bedroom', robe: 'floor_bedroom', study: 'floor_bedroom' };
  for (const r of model.rooms) {
    if (r.type === 'outdoor') {
      for (const q of r.rects) batch.box(k(q[0]), k(-H.slab - 30), k(q[1]), k(q[2]), k(H.outdoor), k(q[3]), { py: 'floor_outdoor', nx: 'slabEdge', px: 'slabEdge', nz: 'slabEdge', pz: 'slabEdge' });
      continue;
    }
    if (r.type === 'garage') {
      for (const q of unionRects(r.rects, null)) batch.box(k(q[0]), k(-H.slab - 30), k(q[1]), k(q[2]), k(H.garage), k(q[3]), { py: 'floor_garage' });
      continue;
    }
    const key = WET.has(r.type) ? 'floor_wet' : (spec.floors.bedroom !== 'same' ? zone[r.type] : null);
    if (!key) continue;
    for (const q of unionRects(r.rects, null)) batch.poly(key, toM([[q[0], q[1]], [q[2], q[1]], [q[2], q[3]], [q[0], q[3]]]), 0.004, true);
  }
}

// ---------------------------------------------------------------------------
// Ceilings & soffits
// ---------------------------------------------------------------------------
function buildCeilings(ctx, upper) {
  const { model, spec, H } = ctx;
  const toM = pts => pts.map(p => [k(p[0]), k(p[1])]);
  const trays = [];
  for (const r of model.rooms) {
    if (!(r.ceiling > H.ceiling) || r.type === 'outdoor') continue;
    const bb = r.rects.reduce((b, q) => [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[2]), Math.max(b[3], q[3])], [Infinity, Infinity, -Infinity, -Infinity]);
    const ins = 350;
    const t = [bb[0] + ins, bb[1] + ins, bb[2] - ins, bb[3] - ins];
    if (t[2] - t[0] > 600 && t[3] - t[1] > 600) trays.push({ rect: t, h: Math.min(H.raised, r.ceiling > H.ceiling ? Math.max(r.ceiling, H.raised) : H.raised) });
  }
  const house = model.houseOutline;
  if (house.length >= 3) {
    const holes = trays.map(tr => { const [x1, y1, x2, y2] = tr.rect; return toM([[x1, y1], [x1, y2], [x2, y2], [x2, y1]]); });
    try { upper.poly('ceiling', toM(house), k(H.ceiling), false, holes); } catch (e) { upper.poly('ceiling', toM(house), k(H.ceiling), false); }
  }
  for (const tr of trays) {
    const [x1, y1, x2, y2] = tr.rect.map(k);
    upper.poly('ceiling', [[x1, y1], [x2, y1], [x2, y2], [x1, y2]], k(tr.h), false);
    const y0 = k(H.ceiling), yh = k(tr.h);
    upper.strip('ceiling', [x1, y1], [x2, y1], y0, yh); upper.strip('ceiling', [x2, y2], [x1, y2], y0, yh);
    upper.strip('ceiling', [x1, y2], [x1, y1], y0, yh); upper.strip('ceiling', [x2, y1], [x2, y2], y0, yh);
  }
  ctx.trays = trays;
  // soffit under the eaves & over alfresco/porch (a hair above the ceiling plane)
  if (spec.roof.type !== 'flat' && model.outline.length >= 3) {
    const eave = offsetOrtho(model.outline, +spec.roof.eave);
    upper.poly('soffit', toM(eave), k(H.ceiling + 4), false);
  } else if (spec.roof.type === 'flat') {
    for (const r of model.rooms.filter(q => q.type === 'outdoor')) for (const q of r.rects) upper.poly('soffit', toM([[q[0], q[1]], [q[2], q[1]], [q[2], q[3]], [q[0], q[3]]]), k(H.ceiling + 4), false);
  }
}

// ---------------------------------------------------------------------------
// Roof
// ---------------------------------------------------------------------------
function buildRoof(ctx, batch) {
  const { model, spec, H } = ctx;
  if (model.outline.length < 3) return new THREE.Group();
  const toM = pts => pts.map(p => [k(p[0]), k(p[1])]);
  const type = spec.roof.type, pitch = +spec.roof.pitch, eave = +spec.roof.eave;
  const eaveOut = offsetOrtho(model.outline, eave);
  let roof;
  if (type === 'gable') roof = buildGableRoof(toM(eaveOut), { eaveY: k(H.eaveY), pitchDeg: pitch, profile: spec.roof.gutterProfile });
  else if (type === 'skillion') {
    roof = buildSkillionRoof(toM(eaveOut), { eaveY: k(H.eaveY), pitchDeg: Math.min(pitch, 15), low: backSideOf(ctx), profile: spec.roof.gutterProfile });
    // infill between the ceiling line and the sloping roof along the house outline
    const ha = roof.userData.heightAt, o = model.outline, n = o.length, ccw = signedArea(o) > 0;
    for (let i = 0; i < n; i++) {
      const a = o[i], b = o[(i + 1) % n];
      const [p, q] = ccw ? [b, a] : [a, b];
      const P = [k(p[0]), k(p[1])], Q = [k(q[0]), k(q[1])];
      const hp = ha(P[0], P[1]) - 0.2, hq = ha(Q[0], Q[1]) - 0.2, y0 = k(H.ceiling);
      if (Math.max(hp, hq) <= y0 + 0.01) continue;
      const dx = Q[0] - P[0], dz = Q[1] - P[1], L = Math.hypot(dx, dz), nrm = [-dz / L, 0, dx / L];
      batch.quad('extWall', [P[0], y0, P[1]], [Q[0], y0, Q[1]], [Q[0], hq, Q[1]], [P[0], hp, P[1]], nrm, v => [((v[0] - P[0]) * dx + (v[2] - P[1]) * dz) / L, v[1]]);
    }
  } else if (type === 'flat') roof = buildFlatRoof(toM(model.outline), { topY: k(H.ceiling + 300) });
  else roof = buildHipRoof(toM(eaveOut), { eaveY: k(H.eaveY), pitchDeg: pitch, profile: spec.roof.gutterProfile });
  roof.userData.type = type;
  return roof;
}

export function streetSideOf(ctx) {
  const s = ctx.spec.site.streetSide;
  if (s && s !== 'auto') return s;
  // side of the garage door, else of the entry door
  const find = pred => { for (const w of ctx.model.walls) for (const op of w.openings) if (pred(op)) return w.ext; return null; };
  return find(op => op.type === 'garage') || find(op => op.id === ctx.entry) || 'S';
}
function backSideOf(ctx) { return { N: 'S', S: 'N', E: 'W', W: 'E' }[streetSideOf(ctx)] || 'N'; }

// ---------------------------------------------------------------------------
// Downpipes at the corners of the roof outline
// ---------------------------------------------------------------------------
function buildDownpipes(ctx, batch, roof) {
  const { model, spec, H } = ctx;
  ctx.downpipes = [];
  if (spec.roof.downpipe === 'none' || spec.roof.type === 'flat') return;
  const o = model.outline; if (o.length < 4) return;
  const eave = +spec.roof.eave;
  const ccw = signedArea(o) > 0, n = o.length;
  const pts = [];
  let run = 0;
  for (let i = 0; i < n; i++) {
    const p = o[(i - 1 + n) % n], c = o[i], q = o[(i + 1) % n];
    const cross = (c[0] - p[0]) * (q[1] - c[1]) - (c[1] - p[1]) * (q[0] - c[0]);
    const convex = ccw ? cross > 0 : cross < 0;
    run += Math.hypot(q[0] - c[0], q[1] - c[1]);
    if (convex && run > 5000) { pts.push(c); run = 0; }
  }
  for (const [x, y] of pts) {
    // push the downpipe onto the wall face under the gutter corner
    const inX = pointInPoly(x + 200, y, o) ? 1 : -1, inY = pointInPoly(x, y + 200, o) ? 1 : -1;
    const px = x - inX * 60, py = y + inY * 200;
    const top = H.eaveY - 120, bot = -H.slab;
    if (spec.roof.downpipe === 'square') batch.box(k(px - 50), k(bot), k(py - 25), k(px + 50), k(top), k(py + 25), 'dp');
    else batch.box(k(px - 40), k(bot), k(py - 40), k(px + 40), k(top), k(py + 40), 'dp');
    // gooseneck to the gutter
    batch.box(k(Math.min(px, x - inX * (eave - 60))), k(top - 60), k(py - 30), k(Math.max(px, x - inX * (eave - 60))), k(top), k(py + 30), 'dp');
    ctx.addCollider(px - 50, py - 50, px + 50, py + 50, bot, top, 'dp');
    ctx.downpipes.push([px, py]);
  }
  void roof;
}
