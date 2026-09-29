// Site context generated around the house: lot, lawn, driveway to the garage door, entry
// path, street with kerb & footpath, fences, planting, letterbox and neighbouring houses.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Batch } from './batch.js';
import { M } from './materials.js';
import { wallFrame, streetSideOf } from './build.js';
import { pointInPoly } from './roof.js';

const k = v => v / 1000;
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

export function buildSite(model, spec, H, ctxLike) {
  seed = 7;
  const b = new Batch('site');
  const group = new THREE.Group(); group.name = 'site';
  const labels = new THREE.Group(); labels.visible = false;
  const segColliders = [];
  const pts = model.outline.length ? model.outline : model.houseOutline;
  const bb = [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
  const side = streetSideOf(ctxLike);
  const eave = spec.roof.type === 'flat' ? 0 : +spec.roof.eave;
  // front frame: u along the street, v = distance out from the house front (outline incl. eaves)
  const FR = {
    S: { P: (u, v) => [u, bb[3] + v], u0: bb[0], u1: bb[2], depth: bb[3] - bb[1] },
    N: { P: (u, v) => [u, bb[1] - v], u0: bb[0], u1: bb[2], depth: bb[3] - bb[1] },
    E: { P: (u, v) => [bb[2] + v, u], u0: bb[1], u1: bb[3], depth: bb[2] - bb[0] },
    W: { P: (u, v) => [bb[0] - v, u], u0: bb[1], u1: bb[3], depth: bb[2] - bb[0] },
  }[side];
  const P = FR.P;
  const front = Math.max(+spec.site.frontSetback, 2000), sideSet = 1500, rear = 6000;
  const entSide = entrySideOf(model, ctxLike.entry);
  const cornerU = entSide && ((side === 'S' || side === 'N') ? { W: 'u0', E: 'u1' } : { N: 'u0', S: 'u1' })[entSide];
  const lotU0 = FR.u0 - (cornerU === 'u0' ? 3500 : sideSet) - eave, lotU1 = FR.u1 + (cornerU === 'u1' ? 3500 : sideSet) + eave, lotV0 = -(FR.depth + rear), lotV1 = front;
  const G = -H.slab;            // natural ground level
  const quadUV = (key, a, c, y) => { const p1 = P(a[0], a[1]), p2 = P(c[0], a[1]), p3 = P(c[0], c[1]), p4 = P(a[0], c[1]); b.poly(key, [p1, p2, p3, p4].map(p => [k(p[0]), k(p[1])]), k(y), true); };

  // ground plane (huge lawn) + lot lawn
  const big = 90000;
  b.poly('grass', [[-big, -big], [big, -big], [big, big], [-big, big]].map(p => [k(p[0] + (bb[0] + bb[2]) / 2), k(p[1] + (bb[1] + bb[3]) / 2)]), k(G - 30), true);
  // street: footpath, kerb, road
  const roadW = 7400, path = 1500, verge = 1000;
  quadUV('grass', [lotU0 - 40000, front], [lotU1 + 40000, front + verge], G - 10);
  quadUV('paving', [lotU0 - 40000, front + verge], [lotU1 + 40000, front + verge + path], G - 5);
  quadUV('kerb', [lotU0 - 40000, front + verge + path], [lotU1 + 40000, front + verge + path + 150], G - 5);
  quadUV('asphalt', [lotU0 - 40000, front + verge + path + 150], [lotU1 + 40000, front + verge + path + 150 + roadW], G - 150);
  // kerb face
  {
    const a = P(lotU0 - 40000, front + verge + path + 150), c = P(lotU1 + 40000, front + verge + path + 150);
    b.box(k(Math.min(a[0], c[0])), k(G - 150), k(Math.min(a[1], c[1])), k(Math.max(a[0], c[0])) + (side === 'E' || side === 'W' ? 0.01 : 0), k(G - 5), k(Math.max(a[1], c[1])) + (side === 'N' || side === 'S' ? 0.01 : 0), 'kerb');
  }
  for (let u = lotU0 - 40000; u < lotU1 + 40000; u += 6000) quadUV('roadLine', [u, front + verge + path + 150 + roadW / 2 - 50], [u + 3000, front + verge + path + 150 + roadW / 2 + 50], G - 145);

  // driveway from the garage door (or the house corner) to the road
  let driveU = null, driveW = 0, driveTop = G;
  for (const w of model.walls) for (const op of w.openings) {
    if (op.type !== 'garage') continue;
    const f = wallFrame(w);
    const along = f.horiz ? ['S', 'N'].includes(side) : ['E', 'W'].includes(side);
    if (!along) continue;
    driveU = (op.a + op.b) / 2; driveW = op.b - op.a + 600; driveTop = H.garage;
  }
  const drives = [];
  if (driveU !== null) {
    // from the building face to the street
    const faceV = 0; // outline (incl. porch/garage) face is v = 0
    const u0 = driveU - driveW / 2, u1 = driveU + driveW / 2;
    const garageFace = findFaceV(model, side, bb, driveU);
    const v0 = garageFace;
    const pA = P(u0, v0), pB = P(u1, v0), pC = P(u1, front + verge + path), pD = P(u0, front + verge + path);
    const y0 = k(driveTop - 5), y1 = k(G - 5);
    const n = [0, 1, 0];
    b.quad('paving', [k(pA[0]), y0, k(pA[1])], [k(pB[0]), y0, k(pB[1])], [k(pC[0]), y1, k(pC[1])], [k(pD[0]), y1, k(pD[1])], n, p => [p[0], p[2]]);
    b.quad('paving', [k(pA[0]), y0, k(pA[1])], [k(pD[0]), y1, k(pD[1])], [k(pC[0]), y1, k(pC[1])], [k(pB[0]), y0, k(pB[1])], [0, -1, 0], p => [p[0], p[2]]);
    drives.push({ u0, u1, v0, v1: front + verge + path, y0: driveTop - 5, y1: G - 5 });
    // crossover across the verge
    quadUV('paving', [u0 - 600, front + verge], [u1 + 600, front + verge + path + 150], G - 4);
    void faceV;
  }
  // entry path – to the main street, or to a second street when the entry faces a side (corner lot)
  const entryOp = findEntry(model, ctxLike.entry);
  const inv = (x, y) => side === 'S' ? [x, y - bb[3]] : side === 'N' ? [x, bb[1] - y] : side === 'E' ? [y, x - bb[2]] : [y, bb[0] - x];
  let corner = null;
  if (entryOp) {
    const [eu, ev] = inv(entryOp.x, entryOp.y);
    entryOp.u = eu; entryOp.v = ev;
    const sideMap = (side === 'S' || side === 'N') ? { W: 'u0', E: 'u1' } : { N: 'u0', S: 'u1' };
    corner = sideMap[entryOp.side] || null;
    const pw = 1200;
    if (corner) {
      const edge = corner === 'u1' ? lotU1c() : lotU0c();
      const dir = corner === 'u1' ? 1 : -1;
      const a = Math.min(eu, edge + dir * (verge)), c = Math.max(eu, edge + dir * (verge));
      quadUV('paving', [a, ev - pw / 2], [c, ev + pw / 2], G);
      const lb = P(edge - dir * 300, ev + pw);
      b.box(k(lb[0] - 200), k(G), k(lb[1] - 200), k(lb[0] + 200), k(G + 1200), k(lb[1] + 200), 'feature');
      b.box(k(lb[0] - 210), k(G + 900), k(lb[1] - 150), k(lb[0] + 210), k(G + 1100), k(lb[1] + 150), 'letterbox');
    } else {
      const pv = Math.max(0, ev);
      if (driveU !== null && Math.abs(eu - driveU) < driveW / 2 + 3000) {
        const toU = eu < driveU ? driveU - driveW / 2 : driveU + driveW / 2;
        quadUV('paving', [Math.min(eu - pw / 2, toU), pv], [Math.max(eu + pw / 2, toU), pv + pw], G);
      } else quadUV('paving', [eu - pw / 2, pv], [eu + pw / 2, front + verge], G);
      const lb = P(eu + pw, front - 300);
      b.box(k(lb[0] - 200), k(G), k(lb[1] - 200), k(lb[0] + 200), k(G + 1200), k(lb[1] + 200), 'feature');
      b.box(k(lb[0] - 150), k(G + 900), k(lb[1] - 210), k(lb[0] + 150), k(G + 1100), k(lb[1] + 210), 'letterbox');
    }
  }
  function lotU1c() { return lotU1; }
  function lotU0c() { return lotU0; }
  // second street along the entry side of a corner lot
  if (corner) {
    const dir = corner === 'u1' ? 1 : -1, e = corner === 'u1' ? lotU1 : lotU0;
    const band = (d0, d1, key, y) => { const a0 = e + dir * d0, a1 = e + dir * d1; quadUV(key, [Math.min(a0, a1), lotV0 - 30000], [Math.max(a0, a1), front + verge + path], y); };
    band(0, verge, 'grass', G - 10); band(verge, verge + path, 'paving', G - 5); band(verge + path, verge + path + 150, 'kerb', G - 5); band(verge + path + 150, verge + path + 150 + roadW, 'asphalt', G - 150);
  }

  // garden beds along the front of the house
  if (spec.site.landscape !== 'lawnOnly') {
    const bedKey = spec.site.landscape === 'gravel' ? 'gravel' : 'mulch';
    const blocked = u => drives.some(d => u > d.u0 - 300 && u < d.u1 + 300) || (entryOp && Math.abs(u - entryOp.u) < 900);
    for (let u = FR.u0; u < FR.u1; u += 900) {
      if (blocked(u) || blocked(u + 900)) continue;
      const fv = findFaceV(model, side, bb, u + 450);
      if (fv > 2500) continue;
      quadUV(bedKey, [u, fv + 200], [u + 900, fv + 1100], G - 20);
      const p = P(u + 450, fv + 650);
      shrub(group, p[0], p[1], G, 350 + rnd() * 200, rnd() < 0.3 ? 'flower' : 'shrub');
    }
  }

  // fences: sides and rear
  if (spec.site.fence !== 'none') {
    const hgt = spec.site.fence === 'slat' ? 1500 : 1800;
    const runs = [corner === 'u0' ? null : [[lotU0, lotV0], [lotU0, front - 1000]], corner === 'u1' ? null : [[lotU1, lotV0], [lotU1, front - 1000]], [[lotU0, lotV0], [lotU1, lotV0]]].filter(Boolean);
    for (const [a, c] of runs) {
      const pa = P(...a), pc = P(...c);
      fence(b, pa, pc, G, hgt);
      segColliders.push({ a: pa, b: pc, r: 40, h0: G, h1: G + hgt });
    }
  }
  // trees (front & back) and lawn edge planting
  const treeAt = (u, v, s = 1) => { const p = P(u, v); if (model.outline.length && pointInPoly(p[0], p[1], model.outline)) return; if (drives.some(d => u > d.u0 - 1500 && u < d.u1 + 1500 && v > d.v0 - 500)) return; tree(group, p[0], p[1], G, s); segColliders.push({ a: p, b: p, r: 250, h0: G, h1: G + 3000 }); };
  treeAt(lotU0 + 1500, front - 1500, 0.9); treeAt(lotU1 - 1500, lotV0 + 1800, 1.1); treeAt(lotU0 + 2000, lotV0 + 2200, 1.3);
  if (spec.site.landscape === 'lawn') { treeAt((lotU0 + lotU1) / 2 + 1500, lotV0 + 1500, 0.8); for (let u = lotU0 + 600; u < lotU1 - 600; u += 1400) { const p = P(u, lotV0 + 600); shrub(group, p[0], p[1], G, 450 + rnd() * 250, 'shrub'); } }
  // street trees
  for (let u = lotU0 - 20000; u < lotU1 + 20000; u += 9000) { const p = P(u, front + verge / 2); if (drives.some(d => u > d.u0 - 1500 && u < d.u1 + 1500)) continue; tree(group, p[0], p[1], G, 1.1); }

  // neighbours
  const context = new THREE.Group(); context.name = 'context';
  if (spec.site.neighbours) {
    const nb = new Batch('neighbours');
    const nW = 12000, gap = 3000;
    for (const [uA, uB, which] of [[lotU0 - gap - nW, lotU0 - gap, 'u0'], [lotU1 + gap, lotU1 + gap + nW, 'u1']]) {
      if (which === corner) continue;
      const a = P(uA, front - 5500), c = P(uB, front - 5500 - Math.max(12000, FR.depth));
      const x0 = Math.min(a[0], c[0]), x1 = Math.max(a[0], c[0]), y0 = Math.min(a[1], c[1]), y1 = Math.max(a[1], c[1]);
      nb.box(k(x0), k(G), k(y0), k(x1), k(G + 2700), k(y1), { px: 'neighbourWall', nx: 'neighbourWall', pz: 'neighbourWall', nz: 'neighbourWall', py: null });
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 4, 1), M('neighbourRoof'));
      roof.rotation.y = Math.PI / 4; roof.scale.set(k(x1 - x0) * 0.78, 2.2, k(y1 - y0) * 0.78);
      roof.position.set(k((x0 + x1) / 2), k(G + 2700) + 1.1, k((y0 + y1) / 2)); roof.castShadow = true;
      context.add(roof);
    }
    context.add(nb.build());
  }
  const mesh = b.build();
  group.add(mesh, labels, context);
  const siteLevelAt = (x, y) => {
    for (const d of drives) {
      // inverse of P for this frame
      const [u, v] = side === 'S' ? [x, y - bb[3]] : side === 'N' ? [x, bb[1] - y] : side === 'E' ? [y, x - bb[2]] : [y, bb[0] - x];
      if (u >= d.u0 && u <= d.u1 && v >= d.v0 && v <= d.v1) return d.y0 + (d.y1 - d.y0) * (v - d.v0) / Math.max(1, d.v1 - d.v0);
    }
    return G;
  };
  const lot = { side, P, lotU0, lotU1, lotV0, lotV1, front, bb };
  return { group, labels, segColliders, siteLevelAt, lot, context };
}

function findFaceV(model, side, bb, u) {
  // distance (v) from the outline front to the house face at u (for the driveway start / beds)
  const pts = model.houseOutline.length ? model.houseOutline : model.outline;
  let best = 0;
  const n = pts.length;
  let found = -Infinity;
  for (let i = 0; i < n; i++) {
    const a = pts[i], c = pts[(i + 1) % n];
    if (side === 'S' || side === 'N') {
      if (a[1] !== c[1]) continue;
      if (u < Math.min(a[0], c[0]) || u > Math.max(a[0], c[0])) continue;
      const v = side === 'S' ? a[1] - bb[3] : bb[1] - a[1];
      if (v > found) found = v;
    } else {
      if (a[0] !== c[0]) continue;
      if (u < Math.min(a[1], c[1]) || u > Math.max(a[1], c[1])) continue;
      const v = side === 'E' ? a[0] - bb[2] : bb[0] - a[0];
      if (v > found) found = v;
    }
  }
  return found === -Infinity ? best : found;
}

function findEntry(model, entryId) {
  for (const w of model.walls) for (const op of w.openings) if (op.id === entryId) {
    const f = wallFrame(w);
    const mid = (op.a + op.b) / 2;
    const [x, y] = f.horiz ? [mid, w.ext === 'N' ? f.T0 : f.T1] : [w.ext === 'W' ? f.T0 : f.T1, mid];
    return { x, y, side: w.ext };
  }
  return null;
}
function entrySideOf(model, entryId) { const e = findEntry(model, entryId); return e ? e.side : null; }

function fence(b, a, c, G, hgt) {
  const dx = c[0] - a[0], dy = c[1] - a[1], L = Math.hypot(dx, dy);
  const nx = -dy / L * 20, ny = dx / L * 20;
  const p = [[a[0] - nx, a[1] - ny], [c[0] - nx, c[1] - ny], [c[0] + nx, c[1] + ny], [a[0] + nx, a[1] + ny]].map(q => [k(q[0]), k(q[1])]);
  b.strip('fence', p[0], p[1], k(G), k(G + hgt)); b.strip('fence', p[2], p[3], k(G), k(G + hgt));
  const post = Math.max(1, Math.round(L / 2400));
  for (let i = 0; i <= post; i++) { const x = a[0] + dx * i / post, y = a[1] + dy * i / post; b.box(k(x - 30), k(G), k(y - 30), k(x + 30), k(G + hgt + 40), k(y + 30), 'fence'); }
}

function tree(g, x, y, G, s = 1) {
  const h = (4200 + rnd() * 1800) * s;
  const t = new THREE.Mesh(new THREE.CylinderGeometry(0.09 * s, 0.14 * s, k(h * 0.55), 8), M('trunk'));
  t.position.set(k(x), k(G + h * 0.275), k(y)); t.castShadow = true; g.add(t);
  for (let i = 0; i < 4; i++) {
    const r = (900 + rnd() * 700) * s;
    const c = new THREE.Mesh(new THREE.IcosahedronGeometry(k(r), 1), M(i % 2 ? 'leaves' : 'leavesDark'));
    c.position.set(k(x + (rnd() - 0.5) * 900 * s), k(G + h * 0.6 + rnd() * h * 0.3), k(y + (rnd() - 0.5) * 900 * s));
    c.scale.y = 0.8; c.castShadow = true; g.add(c);
  }
}
function shrub(g, x, y, G, r, key) {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(k(r), 1), M(key));
  m.position.set(k(x), k(G + r * 0.7), k(y)); m.scale.y = 0.8; m.castShadow = true; g.add(m);
}
export { CSS2DObject };
