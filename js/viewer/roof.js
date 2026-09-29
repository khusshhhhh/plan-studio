// Hip roof generator for orthogonal footprints.
// For equal-pitch hip roofs on an orthogonal footprint the roof height at any point is
// eaveLevel + tan(pitch) × (L∞ distance to the eave outline). That surface equals the
// upper envelope of simple hip roofs built on every maximal rectangle inside the
// outline, which is what we build here (ridges, hips and valleys fall out naturally
// and match the roof layout on sheet 08).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { M } from './materials.js';

export function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

// Offset an orthogonal polygon outward by d (same units as the points)
export function offsetOrtho(pts, d) {
  const ccw = signedArea(pts) > 0;
  const n = pts.length, out = [];
  const nrm = (a, b) => {
    const dx = Math.sign(b[0] - a[0]), dy = Math.sign(b[1] - a[1]);
    return ccw ? [dy, -dx] : [-dy, dx];
  };
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const n1 = nrm(p0, p1), n2 = nrm(p1, p2);
    out.push([p1[0] + d * (n1[0] + n2[0]), p1[1] + d * (n1[1] + n2[1])]);
  }
  return out;
}

export function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (((yi > y) !== (yj > y)) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function maximalRects(pts) {
  const xs = [...new Set(pts.map(p => p[0]))].sort((a, b) => a - b);
  const ys = [...new Set(pts.map(p => p[1]))].sort((a, b) => a - b);
  const nx = xs.length - 1, ny = ys.length - 1;
  const cell = [];
  for (let i = 0; i < nx; i++) {
    cell[i] = [];
    for (let j = 0; j < ny; j++) cell[i][j] = pointInPoly((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2, pts) ? 1 : 0;
  }
  // 2D prefix sums
  const S = Array.from({ length: nx + 1 }, () => new Array(ny + 1).fill(0));
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) S[i + 1][j + 1] = cell[i][j] + S[i][j + 1] + S[i + 1][j] - S[i][j];
  const full = (i1, j1, i2, j2) => {
    if (i1 < 0 || j1 < 0 || i2 > nx || j2 > ny) return false;
    const s = S[i2][j2] - S[i1][j2] - S[i2][j1] + S[i1][j1];
    return s === (i2 - i1) * (j2 - j1);
  };
  const rects = [];
  for (let i1 = 0; i1 < nx; i1++) for (let i2 = i1 + 1; i2 <= nx; i2++)
    for (let j1 = 0; j1 < ny; j1++) for (let j2 = j1 + 1; j2 <= ny; j2++) {
      if (!full(i1, j1, i2, j2)) continue;
      if (full(i1 - 1, j1, i2, j2) || full(i1, j1, i2 + 1, j2) || full(i1, j1 - 1, i2, j2) || full(i1, j1, i2, j2 + 1)) continue;
      rects.push([xs[i1], ys[j1], xs[i2], ys[j2]]);
    }
  return rects;
}

// Build a roof mesh group. eavePts in metres ([x,z]); eaveY = roof surface height at eave line.
export function buildHipRoof(eavePts, { eaveY, pitchDeg = 22.5, roofKey = 'roof', capKey = 'roofCap', gutters = true, fasciaKey = 'gutter', profile = 'D', name = 'roof' } = {}) {
  const t = Math.tan(pitchDeg * Math.PI / 180);
  const sec = 1 / Math.cos(pitchDeg * Math.PI / 180);
  const rects = maximalRects(eavePts);
  const pos = [], nor = [], uv = [];

  const face = (verts, slopeAxis) => {
    // compute normal; flip so it points up
    const a = new THREE.Vector3(...verts[0]), b = new THREE.Vector3(...verts[1]), c = new THREE.Vector3(...verts[2]);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    if (n.y < 0) { verts = verts.slice().reverse(); n.negate(); }
    const tris = verts.length === 3 ? [[0, 1, 2]] : [[0, 1, 2], [0, 2, 3]];
    for (const tr of tris) for (const k of tr) {
      const v = verts[k];
      pos.push(...v); nor.push(n.x, n.y, n.z);
      // ribs run down the slope: u across the ribs, v along the slope
      if (slopeAxis === 'z') uv.push(v[0], v[2] * sec); else uv.push(v[2], v[0] * sec);
    }
  };

  for (const [x1, z1, x2, z2] of rects) {
    const w = x2 - x1, d = z2 - z1;
    if (w >= d) {
      const zc = (z1 + z2) / 2, R = eaveY + t * d / 2, xa = x1 + d / 2, xb = x2 - d / 2;
      face([[x1, eaveY, z1], [x2, eaveY, z1], [xb, R, zc], [xa, R, zc]], 'z');
      face([[x2, eaveY, z2], [x1, eaveY, z2], [xa, R, zc], [xb, R, zc]], 'z');
      face([[x1, eaveY, z2], [x1, eaveY, z1], [xa, R, zc]], 'x');
      face([[x2, eaveY, z1], [x2, eaveY, z2], [xb, R, zc]], 'x');
    } else {
      const xc = (x1 + x2) / 2, R = eaveY + t * w / 2, za = z1 + w / 2, zb = z2 - w / 2;
      face([[x1, eaveY, z2], [x1, eaveY, z1], [xc, R, za], [xc, R, zb]], 'x');
      face([[x2, eaveY, z1], [x2, eaveY, z2], [xc, R, zb], [xc, R, za]], 'x');
      face([[x1, eaveY, z1], [x2, eaveY, z1], [xc, R, za]], 'z');
      face([[x2, eaveY, z2], [x1, eaveY, z2], [xc, R, zb]], 'z');
    }
  }

  const group = new THREE.Group();
  group.name = name;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const roof = new THREE.Mesh(geo, M(roofKey));
  roof.castShadow = true; roof.receiveShadow = true; roof.name = name + ':sheet';
  group.add(roof);

  // Height function of the finished roof
  const heightAt = (x, z) => {
    let best = -Infinity;
    for (const [x1, z1, x2, z2] of rects) {
      if (x < x1 || x > x2 || z < z1 || z > z2) continue;
      const dd = Math.min(x - x1, x2 - x, z - z1, z2 - z);
      best = Math.max(best, eaveY + t * dd);
    }
    return best;
  };

  // Ridge / hip capping – only where the envelope forms a convex crease
  const caps = [];
  const segs = [];
  for (const r of rects) {
    const [x1, z1, x2, z2] = r;
    const w = x2 - x1, d = z2 - z1;
    const add = (a, b) => { const s = [a, b]; s.rect = r; segs.push(s); };
    if (w >= d) {
      const zc = (z1 + z2) / 2, xa = x1 + d / 2, xb = x2 - d / 2;
      if (xb > xa) add([xa, zc], [xb, zc]);
      add([x1, z1], [xa, zc]); add([x1, z2], [xa, zc]); add([x2, z1], [xb, zc]); add([x2, z2], [xb, zc]);
    } else {
      const xc = (x1 + x2) / 2, za = z1 + w / 2, zb = z2 - w / 2;
      if (zb > za) add([xc, za], [xc, zb]);
      add([x1, z1], [xc, za]); add([x2, z1], [xc, za]); add([x1, z2], [xc, zb]); add([x2, z2], [xc, zb]);
    }
  }
  const key = s => s.flat().map(v => v.toFixed(3)).join(',');
  const seen = new Set();
  const step = 0.08;
  for (const s of segs) {
    const k = key(s), k2 = key([s[1], s[0]]);
    if (seen.has(k) || seen.has(k2)) continue;
    seen.add(k);
    const [a, b] = s;
    const [rx1, rz1, rx2, rz2] = s.rect;
    const own = (x, z) => eaveY + t * Math.min(x - rx1, rx2 - x, z - rz1, rz2 - z);
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.round(L / step));
    const px = -(b[1] - a[1]) / L, pz = (b[0] - a[0]) / L;
    let runStart = null;
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      const x = a[0] + (b[0] - a[0]) * f, z = a[1] + (b[1] - a[1]) * f;
      const h = heightAt(x, z);
      const e = 0.12;
      const hl = heightAt(x + px * e, z + pz * e), hr = heightAt(x - px * e, z - pz * e);
      const onTop = isFinite(hl) && isFinite(hr) && h > (hl + hr) / 2 + 0.004 && Math.abs(h - own(x, z)) < 1e-4 && h >= eaveY + 0.02;
      if (onTop && runStart === null) runStart = f;
      if ((!onTop || i === n) && runStart !== null) {
        const fe = onTop ? f : (i - 1) / n;
        if (fe - runStart > 0.001) caps.push([runStart, fe, a, b]);
        runStart = null;
      }
    }
  }
  const capGeos = [];
  for (const [f0, f1, a, b] of caps) {
    const p0 = new THREE.Vector3(a[0] + (b[0] - a[0]) * f0, 0, a[1] + (b[1] - a[1]) * f0);
    const p1 = new THREE.Vector3(a[0] + (b[0] - a[0]) * f1, 0, a[1] + (b[1] - a[1]) * f1);
    p0.y = heightAt(p0.x, p0.z) + 0.03; p1.y = heightAt(p1.x, p1.z) + 0.03;
    const len = p0.distanceTo(p1);
    if (len < 0.02) continue;
    const g = new THREE.BoxGeometry(len + 0.04, 0.05, 0.2);
    const m = new THREE.Matrix4();
    const dir = new THREE.Vector3().subVectors(p1, p0).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
    m.compose(p0.clone().add(p1).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m);
    capGeos.push(g);
  }
  if (capGeos.length) {
    const capMesh = new THREE.Mesh(mergeGeometries(capGeos), M(capKey));
    capMesh.castShadow = true; capMesh.name = name + ':caps';
    group.add(capMesh);
  }

  if (gutters) group.add(...buildGutters(eavePts, eaveY, { key: fasciaKey, profile, name }));

  group.userData.heightAt = heightAt;
  group.userData.rects = rects;
  return group;
}

// Fascia + gutters along a closed eave outline (or only along selected edges)
export function buildGutters(eavePts, eaveY, { key = 'gutter', profile = 'D', name = 'roof', edges = null, fascia = true } = {}) {
  const gGeos = [], fGeos = [];
  const ccw = signedArea(eavePts) > 0;
  const shape = gutterShape(profile);
  for (let i = 0; i < eavePts.length; i++) {
    if (edges && !edges(i)) continue;
    const a = eavePts[i], b = eavePts[(i + 1) % eavePts.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    if (L < 1e-4) continue;
    const ux = dx / L, uz = dz / L;
    const nx = ccw ? uz : -uz, nz = ccw ? -ux : ux; // outward
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const ang = Math.atan2(-uz, ux);
    if (fascia) {
      const f = new THREE.BoxGeometry(L + 0.05, 0.24, 0.025);
      f.applyMatrix4(new THREE.Matrix4().makeRotationY(ang));
      f.translate(mid[0] + nx * 0.0125, eaveY - 0.1, mid[1] + nz * 0.0125);
      fGeos.push(f);
    }
    if (shape) {
      const ext = new THREE.ExtrudeGeometry(shape, { depth: L + 0.25, bevelEnabled: false, curveSegments: 4 });
      ext.translate(0, 0, -(L + 0.25) / 2);
      const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(nx, 0, nz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-nz, 0, nx));
      ext.applyMatrix4(basis);
      ext.translate(mid[0] + nx * 0.025, eaveY + 0.0, mid[1] + nz * 0.025);
      gGeos.push(ext.index ? ext.toNonIndexed() : ext);
    }
  }
  const out = [];
  if (fGeos.length) { const fm = new THREE.Mesh(mergeGeometries(fGeos), M(key)); fm.castShadow = true; fm.name = name + ':fascia'; out.push(fm); }
  if (gGeos.length) { const gm = new THREE.Mesh(mergeGeometries(gGeos), M(key)); gm.castShadow = true; gm.name = name + ':gutter'; out.push(gm); }
  return out;
}

function gutterShape(profile) {
  const s = new THREE.Shape();
  switch (profile) {
    case 'box': return null;
    case 'quad':
      s.moveTo(0, 0); s.lineTo(0, -0.115); s.lineTo(0.09, -0.115); s.quadraticCurveTo(0.125, -0.11, 0.128, -0.03); s.lineTo(0.14, 0.0); s.lineTo(0.13, 0.005);
      s.lineTo(0.116, -0.03); s.quadraticCurveTo(0.113, -0.103, 0.088, -0.105); s.lineTo(0.01, -0.105); s.lineTo(0.01, 0); return s;
    case 'square':
      s.moveTo(0, 0); s.lineTo(0, -0.125); s.lineTo(0.125, -0.125); s.lineTo(0.125, 0); s.lineTo(0.115, 0); s.lineTo(0.115, -0.115); s.lineTo(0.01, -0.115); s.lineTo(0.01, 0); return s;
    case 'half':
      s.moveTo(0, 0); s.absarc(0.07, 0, 0.07, Math.PI, 2 * Math.PI, false); s.lineTo(0.13, 0); s.absarc(0.07, 0, 0.06, 0, -Math.PI, true); return s;
    default:
      s.moveTo(0, 0); s.lineTo(0, -0.13); s.lineTo(0.07, -0.13);
      s.quadraticCurveTo(0.125, -0.12, 0.125, -0.05); s.lineTo(0.125, 0.0); s.lineTo(0.115, 0);
      s.lineTo(0.115, -0.05); s.quadraticCurveTo(0.115, -0.11, 0.07, -0.118); s.lineTo(0.012, -0.118); s.lineTo(0.012, 0); return s;
  }
}

function meshOf(P, N, U, key) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  const m = new THREE.Mesh(g, M(key)); m.castShadow = true; m.receiveShadow = true;
  return m;
}

// Push a planar polygon (3 or 4 verts) with a normal pointing up (roof) or both ways (gable)
function pushFace(P, N, U, verts, mode, sec) {
  const a = new THREE.Vector3(...verts[0]), b = new THREE.Vector3(...verts[1]), c = new THREE.Vector3(...verts[2]);
  const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
  const tris = verts.length === 3 ? [[0, 1, 2]] : [[0, 1, 2], [0, 2, 3]];
  const passes = mode === 'g' ? [false, true] : [n.y < 0];
  for (const flip of passes) {
    const nn = flip ? n.clone().negate() : n;
    for (const tr of tris) {
      const o = flip ? [tr[0], tr[2], tr[1]] : tr;
      for (const k of o) {
        const v = verts[k];
        P.push(...v); N.push(nn.x, nn.y, nn.z);
        if (mode === 'z') U.push(v[0], v[2] * sec); else if (mode === 'x') U.push(v[2], v[0] * sec); else U.push(Math.abs(nn.x) > 0.5 ? v[2] : v[0], v[1]);
      }
    }
  }
}

// Gable roof: a ridge along the long axis of every maximal rectangle, with gable ends.
export function buildGableRoof(eavePts, { eaveY, pitchDeg = 22.5, roofKey = 'roof', gableKey = 'extWall', capKey = 'roofCap', fasciaKey = 'gutter', profile = 'D', name = 'roof' } = {}) {
  const t = Math.tan(pitchDeg * Math.PI / 180), sec = 1 / Math.cos(pitchDeg * Math.PI / 180);
  const rects = maximalRects(eavePts);
  const P = [], N = [], U = [], gP = [], gN = [], gU = [];
  const ridges = [], parts = [];
  for (const [x1, z1, x2, z2] of rects) {
    const w = x2 - x1, d = z2 - z1;
    if (w >= d) {
      const zc = (z1 + z2) / 2, R = eaveY + t * d / 2;
      pushFace(P, N, U, [[x1, eaveY, z1], [x2, eaveY, z1], [x2, R, zc], [x1, R, zc]], 'z', sec);
      pushFace(P, N, U, [[x2, eaveY, z2], [x1, eaveY, z2], [x1, R, zc], [x2, R, zc]], 'z', sec);
      pushFace(gP, gN, gU, [[x1, eaveY, z1], [x1, eaveY, z2], [x1, R, zc]], 'g', sec);
      pushFace(gP, gN, gU, [[x2, eaveY, z2], [x2, eaveY, z1], [x2, R, zc]], 'g', sec);
      ridges.push([[x1, R, zc], [x2, R, zc]]);
    } else {
      const xc = (x1 + x2) / 2, R = eaveY + t * w / 2;
      pushFace(P, N, U, [[x1, eaveY, z2], [x1, eaveY, z1], [xc, R, z1], [xc, R, z2]], 'x', sec);
      pushFace(P, N, U, [[x2, eaveY, z1], [x2, eaveY, z2], [xc, R, z2], [xc, R, z1]], 'x', sec);
      pushFace(gP, gN, gU, [[x1, eaveY, z1], [x2, eaveY, z1], [xc, R, z1]], 'g', sec);
      pushFace(gP, gN, gU, [[x2, eaveY, z2], [x1, eaveY, z2], [xc, R, z2]], 'g', sec);
      ridges.push([[xc, R, z1], [xc, R, z2]]);
    }
    parts.push({ r: [x1, z1, x2, z2], along: w >= d ? 'x' : 'z' });
  }
  const group = new THREE.Group(); group.name = name;
  const sheet = meshOf(P, N, U, roofKey); sheet.name = name + ':sheet'; group.add(sheet);
  group.add(meshOf(gP, gN, gU, gableKey));
  const capGeos = ridges.map(([a, b]) => {
    const p0 = new THREE.Vector3(...a), p1 = new THREE.Vector3(...b), L = p0.distanceTo(p1);
    const g = new THREE.BoxGeometry(L + 0.04, 0.05, 0.22);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), p1.clone().sub(p0).normalize());
    g.applyMatrix4(new THREE.Matrix4().compose(p0.clone().add(p1).multiplyScalar(0.5).add(new THREE.Vector3(0, 0.03, 0)), q, new THREE.Vector3(1, 1, 1)));
    return g;
  });
  if (capGeos.length) group.add(new THREE.Mesh(mergeGeometries(capGeos), M(capKey)));
  const edgeIsEave = i => {
    const a = eavePts[i], b = eavePts[(i + 1) % eavePts.length];
    const horiz = Math.abs(a[1] - b[1]) < 1e-6;
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    let best = null, area = -1;
    for (const h of parts) { const [x1, z1, x2, z2] = h.r; if (mx >= x1 - 1e-4 && mx <= x2 + 1e-4 && mz >= z1 - 1e-4 && mz <= z2 + 1e-4) { const A = (x2 - x1) * (z2 - z1); if (A > area) { area = A; best = h; } } }
    return best ? (best.along === 'x') === horiz : true;
  };
  group.add(...buildGutters(eavePts, eaveY, { key: fasciaKey, profile, name, edges: edgeIsEave }));
  group.add(...buildGutters(eavePts, eaveY, { key: fasciaKey, profile: 'box', name: name + '-barge', edges: i => !edgeIsEave(i) }));
  group.userData.heightAt = (x, z) => {
    let best = -Infinity;
    for (const h of parts) { const [x1, z1, x2, z2] = h.r; if (x < x1 || x > x2 || z < z1 || z > z2) continue; const dd = h.along === 'x' ? Math.min(z - z1, z2 - z) : Math.min(x - x1, x2 - x); best = Math.max(best, eaveY + t * dd); }
    return best;
  };
  return group;
}

// Skillion: one plane falling towards `low` ('N'|'S'|'E'|'W' = −z, +z, +x, −x).
export function buildSkillionRoof(eavePts, { eaveY, pitchDeg = 10, low = 'N', roofKey = 'roof', fasciaKey = 'gutter', profile = 'D', name = 'roof' } = {}) {
  const t = Math.tan(pitchDeg * Math.PI / 180);
  const xs = eavePts.map(p => p[0]), zs = eavePts.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const heightAt = (x, z) => eaveY + t * ({ N: z - z0, S: z1 - z, W: x - x0, E: x1 - x }[low]);
  const contour = eavePts.map(p => new THREE.Vector2(p[0], p[1]));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const pos = [], uv = [], upos = [];
  const sec = Math.sqrt(1 + t * t);
  for (const tr of tris) {
    let v = tr.map(i => [eavePts[i][0], heightAt(eavePts[i][0], eavePts[i][1]), eavePts[i][1]]);
    const a = new THREE.Vector3(...v[0]), b = new THREE.Vector3(...v[1]), c = new THREE.Vector3(...v[2]);
    if (new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).y < 0) v = [v[0], v[2], v[1]];
    for (const p of v) { pos.push(...p); uv.push(low === 'N' || low === 'S' ? p[0] : p[2], (low === 'N' || low === 'S' ? p[2] : p[0]) * sec); }
    for (const p of [v[0], v[2], v[1]]) upos.push(p[0], p[1] - 0.18, p[2]);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
  const group = new THREE.Group(); group.name = name;
  const m = new THREE.Mesh(g, M(roofKey)); m.castShadow = m.receiveShadow = true; m.name = name + ':sheet'; group.add(m);
  const ug = new THREE.BufferGeometry(); ug.setAttribute('position', new THREE.Float32BufferAttribute(upos, 3)); ug.computeVertexNormals();
  group.add(new THREE.Mesh(ug, M('soffit')));
  const fGeos = [];
  for (let i = 0; i < eavePts.length; i++) {
    const a = eavePts[i], b = eavePts[(i + 1) % eavePts.length];
    const ha = heightAt(a[0], a[1]), hb = heightAt(b[0], b[1]);
    const q = [[a[0], ha + 0.03, a[1]], [b[0], hb + 0.03, b[1]], [b[0], hb - 0.22, b[1]], [a[0], ha - 0.22, a[1]]];
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute([...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3], ...q[0], ...q[2], ...q[1], ...q[0], ...q[3], ...q[2]], 3));
    fg.computeVertexNormals();
    fGeos.push(fg);
  }
  const fm = new THREE.Mesh(mergeGeometries(fGeos), M(fasciaKey)); fm.castShadow = true; group.add(fm);
  const lowEdge = i => { const a = eavePts[i], b = eavePts[(i + 1) % eavePts.length]; return Math.abs(heightAt(a[0], a[1]) - eaveY) < 1e-3 && Math.abs(heightAt(b[0], b[1]) - eaveY) < 1e-3; };
  group.add(...buildGutters(eavePts, eaveY, { key: fasciaKey, profile, name, edges: lowEdge, fascia: false }));
  group.userData.heightAt = heightAt;
  return group;
}

// Flat roof hidden behind parapets (the parapets are built with the walls)
export function buildFlatRoof(eavePts, { topY, roofKey = 'roofCap', name = 'roof' } = {}) {
  const group = new THREE.Group(); group.name = name;
  const shape = new THREE.Shape(eavePts.map(p => new THREE.Vector2(p[0], -p[1])));
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); g.translate(0, topY - 0.2, 0);
  const m = new THREE.Mesh(g, M(roofKey)); m.castShadow = m.receiveShadow = true; m.name = name + ':sheet'; group.add(m);
  group.userData.heightAt = () => topY;
  return group;
}
