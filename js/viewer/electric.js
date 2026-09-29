// Light fittings, switches and power points – from the drawing's electrical layout when one
// was found, otherwise an automatic layout. Lights work: switches toggle their room.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Batch } from './batch.js';
import { M } from './materials.js';
import { roomAt, wallFrame } from './build.js';
import { WET } from '../analyze/text.js';

const k = v => v / 1000;

export const ELEC_TYPES = {
  downlight: { label: 'Down light', color: '#b14bff', group: 'Lighting' },
  pendant: { label: 'Pendant', color: '#b14bff', group: 'Lighting' },
  walllight: { label: 'Wall / outdoor light', color: '#b14bff', group: 'Lighting' },
  batten: { label: 'Batten light', color: '#ff2fbf', group: 'Lighting' },
  hle: { label: 'Heat / light / exhaust', color: '#3050ff', group: 'Lighting' },
  fan: { label: 'Ceiling fan', color: '#3050ff', group: 'Lighting' },
  smoke: { label: 'Smoke alarm', color: '#ff2b2b', group: 'Safety' },
  security: { label: 'Security sensor', color: '#222222', group: 'Safety' },
  gpo: { label: 'Power point (GPO)', color: '#00a040', group: 'Power' },
  switch: { label: 'Switch', color: '#00b8ff', group: 'Switches' },
  switch2: { label: '2-way switch', color: '#1060ff', group: 'Switches' },
  tv: { label: 'TV outlet', color: '#1060ff', group: 'Comms' },
  phone: { label: 'Telephone outlet', color: '#ff2b2b', group: 'Comms' },
  nbnOutlet: { label: 'Data outlet', color: '#ff2fbf', group: 'Comms' },
  nbnBox: { label: 'NBN provision', color: '#1060ff', group: 'Comms' },
  acPanel: { label: 'A/C controller', color: '#ff2fbf', group: 'HVAC' },
  acUnit: { label: 'A/C unit', color: '#ff2fbf', group: 'HVAC' },
  hws: { label: 'Hot water', color: '#ff8a00', group: 'HVAC' },
};

const POOL = 8;
export class LightSystem {
  constructor() {
    this.rooms = new Map(); this.night = false; this.manual = new Map();
    this.poolGroup = new THREE.Group(); this.poolGroup.visible = false; this.pool = [];
    for (let i = 0; i < POOL; i++) { const l = new THREE.PointLight('#ffe7c4', 0, 0, 2); this.pool.push(l); this.poolGroup.add(l); }
    this._tmp = [];
  }
  update(camPos) {
    const src = this._tmp; src.length = 0;
    for (const r of this.rooms.values()) if (r.on) for (const l of r.lights) src.push([l.intensity / Math.max(1, l.position.distanceToSquared(camPos)), l]);
    const any = src.length > 0;
    if (this.poolGroup.visible !== any) this.poolGroup.visible = any;
    if (!any) return;
    src.sort((a, b) => b[0] - a[0]);
    for (let i = 0; i < POOL; i++) {
      const p = this.pool[i], s = src[i];
      if (s) { const l = s[1]; p.position.copy(l.position); p.intensity = l.intensity; p.color.copy(l.color); p.distance = l.distance; } else p.intensity = 0;
    }
  }
  room(id) {
    let r = this.rooms.get(id);
    if (!r) { r = { lights: [], mat: M('lightOn').clone(), on: false, count: 0, sum: new THREE.Vector3() }; this.rooms.set(id, r); }
    return r;
  }
  set(id, on) { const r = this.rooms.get(id); if (!r) return; r.on = on; r.mat.emissiveIntensity = on ? 3.0 : 0; r.mat.color.set(on ? '#fffaf0' : '#e9e9e6'); }
  toggle(id) { const r = this.rooms.get(id); if (r) { this.manual.set(id, !r.on); this.set(id, !r.on); } }
  setAll(on) { this.manual.clear(); for (const id of this.rooms.keys()) this.set(id, on); }
  setNight(n) { this.night = n; for (const id of this.rooms.keys()) this.set(id, this.manual.has(id) ? this.manual.get(id) : n); }
}

function snapToWall(model, x, y) {
  let best = null;
  for (const w of model.walls) {
    const f = wallFrame(w);
    const al = f.horiz ? x : y, pc = f.horiz ? y : x;
    if (al < f.L0 - 30 || al > f.L1 + 30) continue;
    for (const [face, n] of [[f.T0, -1], [f.T1, 1]]) {
      const d = Math.abs(pc - face);
      if ((pc - face) * n < -60) continue;
      if (!best || d < best.d) {
        const a = Math.min(Math.max(al, f.L0 + 40), f.L1 - 40);
        best = { d, x: f.horiz ? a : face, y: f.horiz ? face : a, n: f.horiz ? [0, n] : [n, 0], wall: w };
      }
    }
  }
  return best && best.d < 700 ? best : null;
}

// Automatic layout when the drawing has none
function autoLayout(model, spec, pendants) {
  const out = [];
  const bedrooms = model.rooms.filter(r => r.type === 'bedroom');
  for (const r of model.rooms) {
    const bb = r.rects.reduce((b, q) => [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[2]), Math.max(b[3], q[3])], [Infinity, Infinity, -Infinity, -Infinity]);
    const W = bb[2] - bb[0], D = bb[3] - bb[1];
    if (r.type === 'garage') { out.push({ type: 'batten', x: (bb[0] + bb[2]) / 2, y: (bb[1] + bb[3]) / 2, room: r.id }); continue; }
    if (WET.has(r.type) && r.type !== 'laundry') out.push({ type: 'hle', x: (bb[0] + bb[2]) / 2, y: (bb[1] + bb[3]) / 2, room: r.id });
    const nx = Math.max(1, Math.round((W - 1200) / 1700) + 1), ny = Math.max(1, Math.round((D - 1200) / 1700) + 1);
    const cells = r.type === 'store' || r.type === 'robe' ? [[0.5, 0.5]] : [];
    if (!cells.length) for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) cells.push([(i + 0.5) / nx, (j + 0.5) / ny]);
    for (const [u, v] of cells) {
      const x = bb[0] + W * u, y = bb[1] + D * v;
      if (!r.rects.some(q => x >= q[0] && x <= q[2] && y >= q[1] && y <= q[3])) continue;
      if (WET.has(r.type) && r.type !== 'laundry' && Math.hypot(x - (bb[0] + bb[2]) / 2, y - (bb[1] + bb[3]) / 2) < 500) continue;
      if (spec.lighting.fans && (r.type === 'bedroom' || r.type === 'living') && Math.abs(u - 0.5) < 0.01 && Math.abs(v - 0.5) < 0.01) continue;
      out.push({ type: 'downlight', x, y, room: r.id });
    }
    if (spec.lighting.fans && (r.type === 'bedroom' || r.type === 'living')) out.push({ type: 'fan', x: (bb[0] + bb[2]) / 2, y: (bb[1] + bb[3]) / 2, room: r.id });
    if (r.type === 'hall' && bedrooms.length) out.push({ type: 'smoke', x: (bb[0] + bb[2]) / 2, y: (bb[1] + bb[3]) / 2 });
    // a switch beside the first door of the room
    for (const w of model.walls) {
      const f = wallFrame(w);
      for (const op of w.openings) {
        if (!['door', 'arch', 'slider', 'void'].includes(op.type)) continue;
        for (const side of [-1, 1]) {
          const tc = side < 0 ? f.T0 - 10 : f.T1 + 10;
          const al = op.b + 150;
          const [x, y] = f.horiz ? [al, tc] : [tc, al];
          const rr = roomAt(model, f.horiz ? x : x + side * 200, f.horiz ? y + side * 200 : y);
          if (rr === r && !out.some(o => o.type === 'switch' && o.room === r.id)) out.push({ type: 'switch', x, y, room: r.id });
        }
      }
    }
  }
  for (const p of pendants || []) out.push({ type: 'pendant', x: p.x, y: p.y, h: p.h, style: p.style, len: p.len, horiz: p.horiz });
  return out;
}

export function buildElectrical(model, spec, H, { pendants = [], trays = [], interactables = [] } = {}) {
  const fittings = new Batch('electrical');
  const group = new THREE.Group(); group.name = 'electrical';
  const ceilingItems = new THREE.Group(); ceilingItems.name = 'ceiling-fittings';
  const markers = new THREE.Group(); markers.name = 'elec-markers'; markers.visible = false;
  const lights = new LightSystem();
  const src = spec.lighting.source;
  let items = [];
  if (src === 'none') items = [];
  else if (src === 'generate') items = autoLayout(model, spec, pendants);
  else {
    items = (model.electrical || []).slice();
    if (!items.some(i => ['downlight', 'batten', 'pendant'].includes(i.type)) && src === 'auto') items = autoLayout(model, spec, pendants);
    else if (pendants.length && !items.some(i => i.type === 'pendant')) items = items.concat(pendants.map(p => ({ type: 'pendant', ...p })));
  }
  const ceilingAt = (x, y) => { for (const t of trays) { const [x1, y1, x2, y2] = t.rect; if (x >= x1 && x <= x2 && y >= y1 && y <= y2) return t.h; } const r = roomAt(model, x, y); return r && r.type === 'outdoor' ? H.ceiling + 4 : H.ceiling; };
  const dlGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.012, 20);
  const trimGeo = new THREE.TorusGeometry(0.05, 0.006, 6, 20);
  const addMarker = (item, x, y, h) => {
    const t = ELEC_TYPES[item.type]; if (!t || typeof document === 'undefined') return;
    const el = document.createElement('div'); el.className = 'emk'; el.style.setProperty('--c', t.color);
    const code = { downlight: 'DL', pendant: 'PD', walllight: 'WL', batten: 'BL', hle: 'HLE', fan: 'FAN', smoke: 'SA', security: 'SS', gpo: 'GPO', switch: 'SW', switch2: '2W', tv: 'TV', phone: 'TEL', nbnOutlet: 'DATA', nbnBox: 'NBN', acPanel: 'A/C', acUnit: 'AC', hws: 'HWS' }[item.type];
    el.textContent = item.type === 'switch' && item.gang > 1 ? item.gang + 'G' : code;
    el.title = t.label + (item.name ? ` (${item.name})` : '');
    const o = new CSS2DObject(el); o.position.set(k(x), k(h) + 0.02, k(y)); o.userData.type = item.type; markers.add(o);
  };
  const plateKey = 'plate';
  const wallItem = (item, w, hgt, depth, key = plateKey, hDef = 1050) => {
    const s = snapToWall(model, item.x, item.y); if (!s) return null;
    const [nx, ny] = s.n, x = s.x, y = s.y, h = item.h ?? hDef;
    if (nx === 0) fittings.box(k(x - w / 2), k(h - hgt / 2), k(y), k(x + w / 2), k(h + hgt / 2), k(y + ny * depth), key);
    else fittings.box(k(x), k(h - hgt / 2), k(y - w / 2), k(x + nx * depth), k(h + hgt / 2), k(y + w / 2), key);
    return { x, y, h, nx, ny };
  };
  const warm = M('lightOn').userData.warm || '#ffe7c4';
  for (const item of items) {
    const t = item.type;
    const room = roomAt(model, item.x, item.y);
    const rid = room ? room.id : 'external';
    if (t === 'downlight') {
      const ch = ceilingAt(item.x, item.y);
      const L = lights.room(rid);
      const m = new THREE.Mesh(dlGeo, L.mat); m.position.set(k(item.x), k(ch) - 0.006, k(item.y));
      const trim = new THREE.Mesh(trimGeo, M('dlTrim')); trim.rotation.x = Math.PI / 2; trim.position.copy(m.position); trim.position.y -= 0.004;
      ceilingItems.add(m, trim);
      L.count++; L.sum.add(new THREE.Vector3(k(item.x), k(ch) - 0.3, k(item.y)));
      addMarker(item, item.x, item.y, ch);
    } else if (t === 'pendant') {
      const L = lights.room(rid);
      const ch = ceilingAt(item.x, item.y), ph = item.h || Math.max(1650, ch - 950);
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, k(ch - ph), 6), M('black')); cord.position.set(k(item.x), k((ch + ph) / 2), k(item.y));
      let shade;
      if (item.style === 'globe') { shade = new THREE.Mesh(new THREE.SphereGeometry(0.15, 24, 16), L.mat); }
      else if (item.style === 'linear') { shade = new THREE.Mesh(new THREE.BoxGeometry(item.horiz ? k(item.len || 1500) : 0.06, 0.05, item.horiz ? 0.06 : k(item.len || 1500)), M('black')); const strip = new THREE.Mesh(new THREE.BoxGeometry(item.horiz ? k(item.len || 1500) - 0.04 : 0.03, 0.005, item.horiz ? 0.03 : k(item.len || 1500) - 0.04), L.mat); strip.position.set(k(item.x), k(ph) - 0.03, k(item.y)); ceilingItems.add(strip); }
      else { shade = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), M('black')); const inner = new THREE.Mesh(new THREE.CircleGeometry(0.16, 24), L.mat); inner.rotation.x = Math.PI / 2; inner.position.set(k(item.x), k(ph) + 0.001, k(item.y)); ceilingItems.add(inner); }
      shade.position.set(k(item.x), k(ph), k(item.y));
      ceilingItems.add(cord, shade);
      const pl = new THREE.PointLight(warm, 1.2, 6, 2); pl.position.set(k(item.x), k(ph) - 0.1, k(item.y)); pl.visible = false; L.lights.push(pl);
      addMarker(item, item.x, item.y, ph);
    } else if (t === 'batten') {
      const L = lights.room(rid), ch = ceilingAt(item.x, item.y);
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 1.2), L.mat); m.position.set(k(item.x), k(ch) - 0.03, k(item.y)); ceilingItems.add(m);
      L.count += 2; L.sum.add(new THREE.Vector3(k(item.x), k(ch) - 0.4, k(item.y)).multiplyScalar(2));
      addMarker(item, item.x, item.y, ch);
    } else if (t === 'hle') {
      const L = lights.room(rid), ch = ceilingAt(item.x, item.y);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.3), M('plastic')); plate.position.set(k(item.x), k(ch) - 0.01, k(item.y)); ceilingItems.add(plate);
      for (const d of [-0.085, 0.085]) { const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.022, 16), L.mat); lamp.position.set(k(item.x) + d, k(ch) - 0.012, k(item.y) - 0.06); ceilingItems.add(lamp); }
      L.count++; L.sum.add(new THREE.Vector3(k(item.x), k(ch) - 0.3, k(item.y)));
      addMarker(item, item.x, item.y, ch);
    } else if (t === 'fan') {
      const ch = ceilingAt(item.x, item.y);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.18, 16), M('plastic')); hub.position.set(k(item.x), k(ch) - 0.25, k(item.y)); ceilingItems.add(hub);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 8), M('plastic')); rod.position.set(k(item.x), k(ch) - 0.1, k(item.y)); ceilingItems.add(rod);
      for (let b = 0; b < 3; b++) { const bl = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.012, 0.12), M('woodVeneer')); bl.position.set(k(item.x), k(ch) - 0.3, k(item.y)); bl.rotation.y = b * Math.PI * 2 / 3; bl.geometry.translate(0.36, 0, 0); ceilingItems.add(bl); }
      addMarker(item, item.x, item.y, ch);
    } else if (t === 'smoke') {
      const ch = ceilingAt(item.x, item.y);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.065, 0.04, 20), M('plastic')); m.position.set(k(item.x), k(ch) - 0.02, k(item.y)); ceilingItems.add(m);
      addMarker(item, item.x, item.y, ch);
    } else if (t === 'walllight') {
      const s = snapToWall(model, item.x, item.y);
      let x = item.x, y = item.y, nx = 0, ny = 0;
      if (s) { x = s.x; y = s.y; [nx, ny] = s.n; }
      const h = item.h || 2100;
      const L = lights.room('ext-' + Math.round(item.x / 500) + '-' + Math.round(item.y / 500));
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.24, 16), M('black')); body.position.set(k(x + nx * 70), k(h), k(y + ny * 70)); body.castShadow = true;
      for (const sg of [-1, 1]) { const lens = new THREE.Mesh(new THREE.CircleGeometry(0.035, 16), L.mat); lens.rotation.x = sg > 0 ? -Math.PI / 2 : Math.PI / 2; lens.position.set(body.position.x, body.position.y + sg * 0.121, body.position.z); group.add(lens); }
      group.add(body);
      const pl = new THREE.PointLight('#ffd9a8', 1.3, 7, 2); pl.position.set(k(x + nx * 250), k(h) - 0.1, k(y + ny * 250)); pl.visible = false; L.lights.push(pl);
      addMarker(item, x, y, h);
    } else if (t === 'gpo') {
      const p = wallItem(item, 120, 72, 9, plateKey, item.h ?? 300);
      if (p) {
        for (const sg of [-1, 1]) {
          if (p.nx === 0) fittings.box(k(p.x + sg * 28 - 9), k(p.h - 12), k(p.y + p.ny * 9), k(p.x + sg * 28 + 9), k(p.h + 12), k(p.y + p.ny * 10), 'black');
          else fittings.box(k(p.x + p.nx * 9), k(p.h - 12), k(p.y + sg * 28 - 9), k(p.x + p.nx * 10), k(p.h + 12), k(p.y + sg * 28 + 9), 'black');
        }
        addMarker(item, p.x, p.y, p.h);
      }
    } else if (t === 'switch' || t === 'switch2') {
      const gang = item.gang || 1;
      const p = wallItem({ ...item, h: 1050 }, 72, 118, 9);
      if (p) {
        for (let g = 0; g < gang; g++) {
          const off = (g - (gang - 1) / 2) * 15;
          if (p.nx === 0) fittings.box(k(p.x + off - 5), k(p.h - 10), k(p.y + p.ny * 9), k(p.x + off + 5), k(p.h + 10), k(p.y + p.ny * 12), 'plastic');
          else fittings.box(k(p.x + p.nx * 9), k(p.h - 10), k(p.y + off - 5), k(p.x + p.nx * 12), k(p.h + 10), k(p.y + off + 5), 'plastic');
        }
        const hit = new THREE.Mesh(new THREE.BoxGeometry(p.nx ? 0.04 : 0.12, 0.16, p.nx ? 0.12 : 0.04), new THREE.MeshBasicMaterial({ visible: false }));
        hit.position.set(k(p.x + p.nx * 20), k(p.h), k(p.y + p.ny * 20)); group.add(hit);
        const rm = roomAt(model, p.x + p.nx * 300, p.y + p.ny * 300);
        if (rm) interactables.push({ mesh: hit, action: () => lights.toggle(rm.id), get hint() { const r = lights.rooms.get(rm.id); return `Switch ${r && r.on ? 'off' : 'on'} lights – ${rm.name}`; } });
        addMarker(item, p.x, p.y, p.h);
      }
    } else if (['tv', 'phone', 'nbnOutlet'].includes(t)) { const p = wallItem(item, 72, 118, 9, plateKey, item.h ?? 300); if (p) addMarker(item, p.x, p.y, p.h); }
    else if (t === 'nbnBox') { const p = wallItem(item, 420, 520, 90, 'plastic', 1500); if (p) addMarker(item, p.x, p.y, p.h); }
    else if (t === 'acPanel') { const p = wallItem(item, 90, 120, 14, 'plastic', 1500); if (p) addMarker(item, p.x, p.y, p.h); }
    else if (t === 'hws') { const p = wallItem(item, 360, 600, 190, 'ac', 1600); if (p) addMarker(item, p.x, p.y, p.h); }
    else if (t === 'acUnit') {
      const s = snapToWall(model, item.x, item.y);
      if (s) { const [nx, ny] = s.n; const cx = s.x + nx * 300, cy = s.y + ny * 300; fittings.box(k(cx - (ny ? 360 : 170)), k(-H.slab), k(cy - (nx ? 360 : 170)), k(cx + (ny ? 360 : 170)), k(-H.slab + 650), k(cy + (nx ? 360 : 170)), 'ac'); addMarker(item, cx, cy, 700); }
    } else if (t === 'security') { const p = wallItem(item, 90, 90, 60, 'plastic', 2400); if (p) addMarker(item, p.x, p.y, p.h); }
  }
  // one warm light per room at the centroid of its fittings
  for (const [id, L] of lights.rooms) {
    if (!L.count) continue;
    const p = L.sum.clone().multiplyScalar(1 / L.count);
    const r = model.rooms.find(q => q.id === id);
    const area = r ? r.area || 8 : 8;
    const pl = new THREE.PointLight(warm, 1.2 + area * 0.35, 0, 2); pl.position.copy(p); pl.visible = false;
    L.lights.push(pl);
  }
  group.add(fittings.build({ castShadow: false }), markers, lights.poolGroup);
  lights.setNight(false);
  return { group, ceilingItems, markers, lights, items };
}
