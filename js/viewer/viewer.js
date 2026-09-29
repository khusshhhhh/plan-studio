// 3D studio: renders the model with the current spec and rebuilds it instantly whenever the
// spec or any element changes. Modes: exterior, floor plan / dollhouse, roof, electrical,
// walk-through. Tools: options, inspector (click any door, window, wall or room to edit it),
// sun & weather, measure, HQ, screenshot.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

import { applySpec, M } from './materials.js';
import { buildHouse, roomAt, wallFrame, resolveOpening, heightsOf, streetSideOf } from './build.js';
import { buildInterior } from './furnish.js';
import { buildElectrical, ELEC_TYPES } from './electric.js';
import { buildSite } from './site.js';
import { Environment, WEATHER, LOC } from './sun.js';
import { Walker, Minimap } from './walk.js';
import { MeasureTool } from './measure.js';
import { TZ } from '../spec.js';

const k = v => v / 1000;

export class Studio {
  constructor(stage, { onSelect, onFps } = {}) {
    this.stage = stage; this.onSelect = onSelect; this.onFps = onFps;
    const renderer = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.85;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    stage.appendChild(renderer.domElement);
    this.labelRenderer = new CSS2DRenderer(); this.labelRenderer.domElement.className = 'labels'; stage.appendChild(this.labelRenderer.domElement);
    this.scene = new THREE.Scene();
    this.persp = new THREE.PerspectiveCamera(50, 1, 0.1, 6000);
    this.ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);
    this.camera = this.persp;
    this.orbit = new OrbitControls(this.persp, renderer.domElement);
    this.orbit.enableDamping = true; this.orbit.dampingFactor = 0.08; this.orbit.maxPolarAngle = Math.PI * 0.495; this.orbit.minDistance = 1.5; this.orbit.maxDistance = 200;
    this.orbitO = new OrbitControls(this.ortho, renderer.domElement);
    this.orbitO.enableDamping = true; this.orbitO.enabled = false; this.orbitO.screenSpacePanning = true; this.orbitO.minZoom = 0.3; this.orbitO.maxZoom = 12;
    this.env = new Environment(this.scene, renderer);
    this.env.onNight = n => { if (this.elec) this.elec.lights.setNight(n); this.emit('night', n); };
    // shared arrays the walker keeps references to
    this.colliders = []; this.segColliders = []; this.doors = []; this.interactables = [];
    this.levelAt = () => 0;
    this.walker = new Walker(this.persp, renderer.domElement, {
      colliders: this.colliders, segColliders: this.segColliders, doors: this.doors, levelAt: (x, y) => this.levelAt(x, y), interactables: this.interactables,
      onLockChange: locked => this.emit('lock', locked),
    });
    this.minimap = null;
    this.measure = new MeasureTool(this.scene, renderer.domElement, () => this.camera, () => this.pickTargets(), items => this.emit('measure', items));
    // post
    const rt = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera); this.composer.addPass(this.renderPass);
    try { this.gtao = new GTAOPass(this.scene, this.camera, 1, 1); this.gtao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.5, thickness: 1.0, scale: 1.0, samples: 16 }); this.gtao.blendIntensity = 0.85; this.composer.addPass(this.gtao); } catch (e) { this.gtao = null; }
    this.composer.addPass(new OutputPass());
    this.HQ = false;
    this.mode = 'exterior'; this.tween = null; this.listeners = {};
    this.roomLabels = new THREE.Group(); this.roomLabels.visible = false; this.scene.add(this.roomLabels);
    this.overlay = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.8, depthTest: false, depthWrite: false, toneMapped: false }));
    this.overlay.rotation.x = -Math.PI / 2; this.overlay.renderOrder = 50; this.overlay.visible = false; this.scene.add(this.overlay);
    this.selBox = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), M('pick') || new THREE.MeshBasicMaterial());
    this.selBox.visible = false; this.selBox.renderOrder = 60; this.scene.add(this.selBox);
    this.groups = [];
    this.inspect = false;
    this._bindPointer();
    window.addEventListener('resize', () => this.resize());
    new ResizeObserver(() => this.resize()).observe(stage);
    this.clock = new THREE.Clock();
    this._fps = { n: 0, t: 0 };
    this.walker.onKeyExtra = code => {
      if (code === 'KeyL' && this.elec) { const anyOn = [...this.elec.lights.rooms.values()].some(r => r.on); this.elec.lights.setAll(!anyOn); }
      if (code === 'KeyN') { this.env.setHours(this.env.hours >= 19 || this.env.hours < 6 ? 11.5 : 20.5); this.emit('sun'); }
      if (code === 'KeyM') this.emit('minimap');
    };
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }
  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  emit(ev, ...a) { for (const fn of this.listeners[ev] || []) fn(...a); }

  // ------------------------------------------------------------------------------------
  load(model, spec, { overlay = null } = {}) {
    this.model = model; this.spec = spec;
    const pts = model.outline.length ? model.outline : model.houseOutline;
    const bb = pts.length ? [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))] : [0, 0, 15000, 15000];
    this.bb = bb; this.center = [(bb[0] + bb[2]) / 2000, (bb[1] + bb[3]) / 2000]; this.size = Math.max(bb[2] - bb[0], bb[3] - bb[1]) / 1000;
    this.setOverlay(overlay);
    this.rebuild();
    this.persp.position.set(this.center[0] + this.size * 1.6, this.size * 1.1, this.center[1] + this.size * 1.8);
    this.orbit.target.set(this.center[0], 1, this.center[1]);
    this.minimap = null;
    this.setMode('exterior', { view: 'O' });
  }

  rebuild() {
    const t0 = performance.now();
    const { model, spec } = this;
    applySpec(spec);
    LOC.lat = +spec.site.lat; LOC.lon = +spec.site.lon; LOC.north = +spec.site.north || 0;
    const tz = TZ[spec.site.state]; if (tz) { LOC.tz = tz[0]; LOC.dst = tz[1]; }
    LOC.center = this.center;
    for (const g of this.groups) { this.scene.remove(g); disposeTree(g); }
    this.groups = [];
    const house = buildHouse(model, spec);
    const fit = buildInterior(model, spec, house.H, house.colliders);
    const elec = buildElectrical(model, spec, house.H, { pendants: fit.pendants, trays: [], interactables: house.interactables });
    const site = buildSite(model, spec, house.H, { model, spec, entry: house.entry });
    this.house = house; this.interior = fit.group; this.elec = elec; this.site = site; this.H = house.H;
    this.groups.push(house.structGroup, house.glassGroup, house.ceilingGroup, house.roof, house.dynamicGroup, fit.group, elec.group, elec.ceilingItems, site.group);
    for (const g of this.groups) this.scene.add(g);
    // shared arrays (walker keeps references)
    this.colliders.length = 0; this.colliders.push(...house.colliders);
    this.segColliders.length = 0; this.segColliders.push(...site.segColliders);
    this.doors.length = 0; this.doors.push(...house.doors);
    this.interactables.length = 0; this.interactables.push(...house.interactables);
    this.levelAt = (x, y) => { const h = house.levelAt(x, y); return h !== null ? h : site.siteLevelAt(x, y); };
    elec.lights.setNight(this.env.night);
    this.buildRoomLabels();
    this.applyVisibility();
    this.env.setShadowSize(this.HQ ? 4096 : 2048, Math.max(18, this.size * 1.1));
    this.env.apply();
    this.env.sun.shadow.needsUpdate = true;
    if (this.selection) this.highlight(this.selection);
    this.buildMs = performance.now() - t0;
    this.emit('rebuilt', this.buildMs);
  }

  buildRoomLabels() {
    for (const c of [...this.roomLabels.children]) { this.roomLabels.remove(c); c.element?.remove(); }
    for (const r of this.model.rooms) {
      const el = document.createElement('div'); el.className = 'rlbl';
      el.innerHTML = `<b>${esc(r.name.toUpperCase())}</b><span>${r.area ? r.area.toFixed(1) + ' m²' : ''}</span>`;
      const o = new CSS2DObject(el); o.position.set(k(r.label[0]), 0.3, k(r.label[1])); this.roomLabels.add(o);
    }
  }

  setOverlay(ov) {
    this.overlayInfo = ov;
    if (!ov) { this.overlay.visible = false; this.overlay.material.map = null; return; }
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      this.overlay.material.map = t; this.overlay.material.needsUpdate = true;
      const [x0, y0, x1, y1] = ov.rect;
      this.overlay.scale.set(k(x1 - x0), k(y1 - y0), 1);
      this.overlay.position.set(k((x0 + x1) / 2), 0.07, k((y0 + y1) / 2));
      this.overlay.rotation.set(-Math.PI / 2, 0, -(ov.rot || 0));
    };
    img.src = ov.url;
  }
  showOverlay(on) { this.overlayOn = on; this.overlay.visible = !!(on && this.overlay.material.map && (this.mode === 'plan' || this.mode === 'electrical' || this.mode === 'roof')); }

  // ------------------------------------------------------------------------------------
  // Modes & cameras
  // ------------------------------------------------------------------------------------
  views() {
    const c = this.center, s = this.size, side = streetSideOf({ spec: this.spec, model: this.model, entry: this.house?.entry });
    const dir = { S: [0, 1], N: [0, -1], E: [1, 0], W: [-1, 0] };
    const f = dir[side] || [0, 1], r = [-f[1], f[0]];
    const at = (d, h, dist) => [c[0] + d[0] * dist, h, c[1] + d[1] * dist];
    return {
      F: { label: 'Front', pos: at(f, 1.7, s * 1.25 + 8), target: [c[0], 2, c[1]], dir: [f[0], 0, f[1]] },
      R: { label: 'Rear', pos: at([-f[0], -f[1]], 2.2, s * 1.2 + 6), target: [c[0], 2, c[1]], dir: [-f[0], 0, -f[1]] },
      L: { label: 'Left side', pos: at(r, 1.9, s * 1.2 + 6), target: [c[0], 2, c[1]], dir: [r[0], 0, r[1]] },
      Rt: { label: 'Right side', pos: at([-r[0], -r[1]], 1.9, s * 1.2 + 6), target: [c[0], 2, c[1]], dir: [-r[0], 0, -r[1]] },
      O: { label: 'Aerial', pos: [c[0] + (f[0] + r[0]) * s * 1.3, s * 1.05 + 6, c[1] + (f[1] + r[1]) * s * 1.3], target: [c[0], 0.5, c[1]] },
    };
  }
  flyTo(pos, target, dur = 0.9) {
    const ctl = this.camera === this.ortho ? this.orbitO : this.orbit;
    this.tween = { cam: this.camera, ctl, p0: this.camera.position.clone(), p1: new THREE.Vector3(...pos), t0: ctl.target.clone(), t1: new THREE.Vector3(...target), t: 0, dur };
  }
  useOrtho(on) {
    this.camera = on ? this.ortho : this.persp;
    this.orbit.enabled = !on && this.mode !== 'walk'; this.orbitO.enabled = on;
    this.renderPass.camera = this.camera; if (this.gtao) { this.gtao.camera = this.camera; this.gtao.enabled = this.HQ && !on; }
    this.resize();
  }
  topView(extent) {
    this.tween = null; this.useOrtho(true);
    const c = this.center;
    this.ortho.position.set(c[0], 60, c[1] + 0.0005); this.orbitO.target.set(c[0], 0, c[1]);
    this.orbitO.enableRotate = false;
    this.orbitO.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.ortho.zoom = 1; this.ortho.userData.extent = extent || this.size * 0.62 + 1.5;
    this.resize(); this.orbitO.update();
  }
  orthoElevation(dir) {
    this.tween = null; this.useOrtho(true);
    const c = new THREE.Vector3(this.center[0], 2.4, this.center[1]);
    this.ortho.position.copy(c).addScaledVector(new THREE.Vector3(...dir).normalize(), 60);
    this.orbitO.target.copy(c); this.orbitO.enableRotate = true;
    this.orbitO.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.ortho.zoom = 1; this.ortho.userData.extent = this.size * 0.45 + 1;
    this.resize(); this.orbitO.update();
  }
  applyVisibility() {
    const m = this.mode;
    const roof = !(m === 'plan' || m === 'electrical');
    if (this.house) { this.house.roof.visible = roof; this.house.ceilingGroup.visible = roof; }
    if (this.elec) { this.elec.markers.visible = m === 'electrical'; this.elec.ceilingItems.visible = roof; }
    this.roomLabels.visible = m === 'plan';
    if (this.site?.context) this.site.context.visible = !(m === 'plan' || m === 'electrical' || m === 'roof');
    if (this.interior) this.interior.visible = this.furnVisible !== false;
    this.showOverlay(this.overlayOn);
    this.env.sun.shadow.needsUpdate = true;
  }
  setMode(m, opts = {}) {
    if (this.mode === 'walk' && m !== 'walk') { this.walker.enable(false); this.persp.fov = 50; this.persp.updateProjectionMatrix(); }
    this.mode = m;
    this.measure.setActive(this.measuring && m !== 'walk');
    this.orbit.enabled = m !== 'walk';
    this.applyVisibility();
    const V = this.views();
    switch (m) {
      case 'exterior': if (opts.ortho && V[opts.view]?.dir) this.orthoElevation(V[opts.view].dir); else { this.useOrtho(false); const v = V[opts.view || 'O']; this.flyTo(v.pos, v.target); } this.view = opts.view || 'O'; break;
      case 'plan': if (opts.dollhouse) { this.useOrtho(false); this.flyTo([this.center[0], this.size * 1.15, this.center[1] + this.size * 0.95], [this.center[0], 0, this.center[1]]); } else this.topView(); break;
      case 'roof': if (opts.threeD) { this.useOrtho(false); this.flyTo([this.center[0] + this.size, this.size * 0.9, this.center[1] + this.size * 1.2], [this.center[0], 1.5, this.center[1]]); } else this.topView(); break;
      case 'electrical': if (opts.top) this.topView(); else { this.useOrtho(false); this.flyTo([this.center[0], this.size * 1.05, this.center[1] + this.size * 0.95], [this.center[0], 0.5, this.center[1]]); } break;
      case 'walk': {
        this.tween = null; this.useOrtho(false); this.orbit.enabled = false;
        this.persp.fov = 72; this.persp.updateProjectionMatrix(); this.walker.fovBase = 72;
        this.walker.enable(true);
        if (!this.walker._placed) { this.teleport('Street'); this.walker._placed = true; }
        if (!this.minimap) this.minimap = new Minimap(document.getElementById('minimap'), { walls: this.model.walls, rooms: this.model.rooms, northDeg: +this.spec.site.north || 0 });
        this.minimap.walls = this.model.walls; this.minimap.rooms = this.model.rooms; this.minimap.northDeg = +this.spec.site.north || 0;
        const b = this.bb; this.minimap.bounds = { x0: b[0] - 5000, y0: b[1] - 5000, x1: b[2] + 5000, y1: b[3] + 5000 };
        break;
      }
    }
    this.env.setShadowSize(this.HQ ? 4096 : 2048, Math.max(18, this.size * 1.1));
    this.emit('mode', m);
  }
  spots() {
    const out = {};
    const lot = this.site?.lot;
    if (lot) { const p = lot.P((lot.lotU0 + lot.lotU1) / 2, lot.front + 500); const c = lot.P((lot.lotU0 + lot.lotU1) / 2, 0); out.Street = [p[0] / 1000, p[1] / 1000, Math.atan2(-(c[0] - p[0]), -(c[1] - p[1])) * 180 / Math.PI]; }
    for (const r of this.model.rooms) {
      if (['robe', 'store'].includes(r.type) && (r.area || 0) < 2) continue;
      let q = r.rects[0], a = 0; for (const x of r.rects) { const A = (x[2] - x[0]) * (x[3] - x[1]); if (A > a) { a = A; q = x; } }
      out[r.name] = [(q[0] + q[2]) / 2000, (q[1] + q[3]) / 2000, 0];
    }
    if (lot) { const p = lot.P((lot.lotU0 + lot.lotU1) / 2, lot.lotV0 + 2000); out.Backyard = [p[0] / 1000, p[1] / 1000, 0]; }
    return out;
  }
  teleport(name) {
    const s = this.spots()[name]; if (!s) return;
    const [x, y, yaw] = s;
    const lvl = (this.levelAt(x * 1000, y * 1000) ?? 0) / 1000;
    this.walker.teleport(x, y, lvl, yaw);
  }
  setHQ(on) {
    this.HQ = on;
    this.renderer.setPixelRatio(on ? Math.min(devicePixelRatio, 2) : Math.min(devicePixelRatio, 1.25));
    this.env.setShadowSize(on ? 4096 : 2048, Math.max(18, this.size * 1.1));
    if (this.gtao) this.gtao.enabled = on && this.camera === this.persp;
    this.resize();
  }
  setMeasuring(on) { this.measuring = on; this.measure.setActive(on && this.mode !== 'walk'); }
  pickTargets() { return [this.house?.structGroup, this.house?.roof, this.interior, this.site?.group, this.house?.dynamicGroup, this.house?.ceilingGroup].filter(g => g && g.visible); }

  // ------------------------------------------------------------------------------------
  // Picking: doors / windows / walls / rooms
  // ------------------------------------------------------------------------------------
  _bindPointer() {
    const ray = new THREE.Raycaster(); let down = null;
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
    el.addEventListener('pointerup', e => {
      if (this.mode === 'walk' || this.measuring || !down || e.button !== 0) return;
      if (Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      const r = el.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
      const targets = [this.house.structGroup, this.house.dynamicGroup, this.house.glassGroup, this.interior].filter(g => g.visible);
      if (this.house.roof.visible) targets.push(this.house.roof);
      const hits = ray.intersectObjects(targets, true);
      if (!hits.length) { if (this.inspect) this.select(null); return; }
      const h = hits[0];
      if (!this.inspect) {
        const it = this.interactables.find(i => i.mesh === h.object);
        if (it) it.action();
        return;
      }
      this.select(this.identify(h));
    });
  }
  identify(hit) {
    const obj = hit.object;
    if (obj.userData.openingId) return { kind: 'opening', id: obj.userData.openingId };
    let p = obj; while (p) { if (p.name === 'roof' || p.parent?.name === 'roof') return { kind: 'roof' }; p = p.parent; }
    const x = hit.point.x * 1000, y = hit.point.z * 1000, z = hit.point.y * 1000;
    // openings (windows/sliders are batched)
    for (const w of this.model.walls) {
      const f = wallFrame(w);
      const al = f.horiz ? x : y, pc = f.horiz ? y : x;
      if (pc < f.T0 - 60 || pc > f.T1 + 60 || al < f.L0 - 20 || al > f.L1 + 20) continue;
      for (const op of w.openings) {
        const o = resolveOpening(this.model, this.spec, this.H, w, op);
        if (al >= op.a - 30 && al <= op.b + 30 && z >= o.sill - 60 && z <= o.head + 90) return { kind: 'opening', id: op.id };
      }
      if (z > 30) return { kind: 'wall', id: w.id, at: al };
    }
    if (hit.point.y < 0.12) { const r = roomAt(this.model, x, y); if (r) return { kind: 'room', id: r.id }; }
    const r = roomAt(this.model, x, y); if (r) return { kind: 'room', id: r.id };
    return null;
  }
  select(sel) {
    this.selection = sel;
    this.highlight(sel);
    if (this.onSelect) this.onSelect(sel);
  }
  highlight(sel) {
    const b = this.selBox;
    b.visible = false;
    if (!sel) return;
    let box = null;
    if (sel.kind === 'opening') {
      for (const w of this.model.walls) for (const op of w.openings) if (op.id === sel.id) {
        const f = wallFrame(w), o = resolveOpening(this.model, this.spec, this.H, w, op);
        box = f.horiz ? [op.a, f.T0 - 40, op.b, f.T1 + 40, o.sill, o.head] : [f.T0 - 40, op.a, f.T1 + 40, op.b, o.sill, o.head];
      }
    } else if (sel.kind === 'wall') {
      const w = this.model.walls.find(q => q.id === sel.id);
      if (w) box = [w.rect[0] - 15, w.rect[1] - 15, w.rect[2] + 15, w.rect[3] + 15, 0, this.H.ceiling];
    } else if (sel.kind === 'room') {
      const r = this.model.rooms.find(q => q.id === sel.id);
      if (r) { const bb = r.rects.reduce((a, q) => [Math.min(a[0], q[0]), Math.min(a[1], q[1]), Math.max(a[2], q[2]), Math.max(a[3], q[3])], [Infinity, Infinity, -Infinity, -Infinity]); box = [...bb, 0, 40]; }
    }
    if (!box) return;
    b.material = M('pick');
    b.scale.set(k(box[2] - box[0]), k(box[5] - box[4]), k(box[3] - box[1]));
    b.position.set(k((box[0] + box[2]) / 2), k((box[4] + box[5]) / 2), k((box[1] + box[3]) / 2));
    b.visible = true;
  }

  // ------------------------------------------------------------------------------------
  resize() {
    const w = this.stage.clientWidth, h = this.stage.clientHeight;
    if (w < 2 || h < 2) return;
    this.renderer.setSize(w, h); this.labelRenderer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio()); this.composer.setSize(w, h);
    this.persp.aspect = w / h; this.persp.updateProjectionMatrix();
    const ext = this.ortho.userData.extent || 12, a = w / h;
    this.ortho.left = -ext * a; this.ortho.right = ext * a; this.ortho.top = ext; this.ortho.bottom = -ext; this.ortho.updateProjectionMatrix();
  }
  loop() {
    requestAnimationFrame(this.loop);
    if (!this.model) return;
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this._fps.n++; this._fps.t += dt; if (this._fps.t > 1) { this.onFps && this.onFps(Math.round(this._fps.n / this._fps.t)); this._fps.n = 0; this._fps.t = 0; }
    if (this.tween) {
      const tw = this.tween; tw.t += dt / tw.dur;
      const e = tw.t >= 1 ? 1 : 1 - Math.pow(1 - tw.t, 3);
      tw.cam.position.lerpVectors(tw.p0, tw.p1, e); tw.ctl.target.lerpVectors(tw.t0, tw.t1, e);
      if (tw.cam !== this.camera) tw.t = 1;
      if (tw.t >= 1) this.tween = null;
    }
    if (this.mode === 'walk') this.walker.update(dt);
    else { for (const d of this.doors) d.step(dt); (this.camera === this.ortho ? this.orbitO : this.orbit).update(); }
    if (this.sunPlaying) { let h = this.env.hours + dt * 0.35; if (h > 21) h = 5; this.env.setHours(h); this.emit('sun'); }
    this.env.update(dt, this.camera);
    {
      const cx = this.camera.position.x * 1000, cz = this.camera.position.z * 1000;
      const lv = this.house ? this.house.levelAt(cx, cz) : null;
      const inside = lv !== null && this.camera === this.persp && this.camera.position.y < k(this.H.ceiling) && (this.mode === 'walk' ? lv > -60 || lv === this.H.garage : true);
      this.env.setInterior(inside ? 0.4 : 1, dt);
      if (this.env.rain.visible) this.env.rain.material.opacity = this.mode === 'walk' && inside ? 0 : 0.45;
    }
    if (this.elec) this.elec.lights.update(this.camera.position);
    if (this.doors.some(d => d.t !== d.target)) this.env.sun.shadow.needsUpdate = true;
    if (this.HQ) this.composer.render(); else this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
    if (this.mode === 'walk' && this.minimap) {
      this._mm = (this._mm || 0) + dt;
      if (this._mm > 0.05) { this._mm = 0; const d = new THREE.Vector3(); this.persp.getWorldDirection(d); this.minimap.draw(this.walker.pos.x * 1000, this.walker.pos.z * 1000, Math.atan2(-d.x, -d.z), this.doors); }
      const r = roomAt(this.model, this.walker.pos.x * 1000, this.walker.pos.z * 1000);
      const f = this.walker.focus;
      this.emit('hud', { room: r, focus: f });
    }
  }
  screenshot(name = 'house') {
    this.renderer.render(this.scene, this.camera);
    this.renderer.domElement.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${name}-${this.mode}.png`; a.click(); });
  }
}

function disposeTree(g) {
  g.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.element) o.element.remove?.();
  });
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export { ELEC_TYPES, WEATHER, heightsOf, resolveOpening };
