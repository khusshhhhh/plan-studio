// Geometry batcher: accumulates faces per material key and emits one mesh per
// material. All UVs are world-space in metres so tiled textures line up across
// separate pieces (and coplanar faces from different pieces shade identically).
import * as THREE from 'three';
import { M } from './materials.js';

export class Batch {
  constructor(name = 'batch') {
    this.name = name;
    this.g = new Map();
  }

  _grp(key) {
    let b = this.g.get(key);
    if (!b) { b = { p: [], n: [], uv: [] }; this.g.set(key, b); }
    return b;
  }

  // Triangle with explicit uvs
  tri(key, a, b, c, n, ua, ub, uc) {
    const g = this._grp(key);
    g.p.push(...a, ...b, ...c);
    g.n.push(...n, ...n, ...n);
    g.uv.push(...ua, ...ub, ...uc);
  }

  // Quad a-b-c-d (counter-clockwise when seen from the front)
  quad(key, a, b, c, d, n, uvFn) {
    const uv = uvFn || defaultUV(n);
    this.tri(key, a, b, c, n, uv(a), uv(b), uv(c));
    this.tri(key, a, c, d, n, uv(a), uv(c), uv(d));
  }

  // Axis-aligned box in metres. faces: {px,nx,py,ny,pz,nz} → material key (or null to skip)
  box(x1, y1, z1, x2, y2, z2, faces) {
    if (x2 < x1) [x1, x2] = [x2, x1];
    if (y2 < y1) [y1, y2] = [y2, y1];
    if (z2 < z1) [z1, z2] = [z2, z1];
    if (x2 - x1 < 1e-5 || y2 - y1 < 1e-5 || z2 - z1 < 1e-5) return;
    const f = typeof faces === 'string' ? { px: faces, nx: faces, py: faces, ny: faces, pz: faces, nz: faces } : faces;
    if (f.px) this.quad(f.px, [x2, y1, z2], [x2, y1, z1], [x2, y2, z1], [x2, y2, z2], [1, 0, 0]);
    if (f.nx) this.quad(f.nx, [x1, y1, z1], [x1, y1, z2], [x1, y2, z2], [x1, y2, z1], [-1, 0, 0]);
    if (f.py) this.quad(f.py, [x1, y2, z2], [x2, y2, z2], [x2, y2, z1], [x1, y2, z1], [0, 1, 0]);
    if (f.ny) this.quad(f.ny, [x1, y1, z1], [x2, y1, z1], [x2, y1, z2], [x1, y1, z2], [0, -1, 0]);
    if (f.pz) this.quad(f.pz, [x1, y1, z2], [x2, y1, z2], [x2, y2, z2], [x1, y2, z2], [0, 0, 1]);
    if (f.nz) this.quad(f.nz, [x2, y1, z1], [x1, y1, z1], [x1, y2, z1], [x2, y2, z1], [0, 0, -1]);
  }

  // Horizontal polygon (array of [x,z] in metres) at height y. up=true faces +Y.
  poly(key, pts, y, up = true, holes = []) {
    const contour = pts.map(p => new THREE.Vector2(p[0], p[1]));
    const hs = holes.map(h => h.map(p => new THREE.Vector2(p[0], p[1])));
    const tris = THREE.ShapeUtils.triangulateShape(contour, hs);
    const all = contour.concat(...hs);
    const n = up ? [0, 1, 0] : [0, -1, 0];
    for (const t of tris) {
      let [a, b, c] = t.map(i => [all[i].x, y, all[i].y]);
      // ensure winding matches normal
      const cross = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
      const faceUp = cross < 0; // in x/z with y up, clockwise in x-z plane means +Y normal
      if (faceUp !== up) [b, c] = [c, b];
      this.tri(key, a, b, c, n, [a[0], -a[2]], [b[0], -b[2]], [c[0], -c[2]]);
    }
  }

  // Vertical strip between 2D points (x,z) from y0 to y1. Faces the (−dz, +dx) side of a→b
  // (e.g. a→b along +X faces +Z).
  strip(key, a, b, y0, y1) {
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    if (L < 1e-6) return;
    const n = [-dz / L, 0, dx / L];
    const along = p => [((p[0] - a[0]) * dx + (p[2] - a[2]) * dz) / L, p[1]];
    this.quad(key, [a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], n, along);
  }

  build({ castShadow = true, receiveShadow = true } = {}) {
    const group = new THREE.Group();
    group.name = this.name;
    for (const [key, b] of this.g) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, M(key));
      mesh.name = this.name + ':' + key;
      mesh.userData.matKey = key;
      const mat = M(key);
      mesh.castShadow = castShadow && !mat.transparent;
      mesh.receiveShadow = receiveShadow;
      group.add(mesh);
    }
    return group;
  }
}

function defaultUV(n) {
  if (Math.abs(n[0]) > 0.5) return p => [p[2] * -Math.sign(n[0]), p[1]];
  if (Math.abs(n[1]) > 0.5) return p => [p[0], -p[2]];
  return p => [p[0] * Math.sign(n[2]), p[1]];
}

export const mm = v => v / 1000;
