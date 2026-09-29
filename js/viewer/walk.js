// First-person "game" controller.
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const EYE = 1.62, CROUCH = 1.05, RADIUS = 0.22, STEP = 0.36;

export class Walker {
  constructor(camera, dom, { colliders, segColliders, doors, levelAt, interactables, onLockChange }) {
    this.camera = camera; this.dom = dom;
    this.colliders = colliders; this.segColliders = segColliders; this.doors = doors;
    this.levelAt = levelAt; this.interactables = interactables;
    this.controls = new PointerLockControls(camera, dom);
    this.controls.pointerSpeed = 0.8;
    this.enabled = false;
    this.pos = new THREE.Vector3(5.1, -0.15, 17.5); // feet
    this.vel = new THREE.Vector3();
    this.vy = 0; this.onGround = true;
    this.crouch = false; this.eye = EYE;
    this.keys = {};
    this.bob = 0; this.stepDist = 0;
    this.ray = new THREE.Raycaster(); this.ray.far = 2.6;
    this.hint = null; this.focus = null;
    this.flash = new THREE.SpotLight('#fff6e8', 0, 22, Math.PI / 7, 0.5, 1.5);
    this.flash.position.set(0.15, -0.15, 0); this.flash.target.position.set(0, -0.2, -3);
    this.flash.visible = false;
    camera.add(this.flash, this.flash.target);
    this.sound = true; this.audio = null;
    this.fovBase = camera.fov;
    this.controls.addEventListener('lock', () => onLockChange && onLockChange(true));
    this.controls.addEventListener('unlock', () => onLockChange && onLockChange(false));
    this._kd = e => this.onKey(e, true); this._ku = e => this.onKey(e, false);
    window.addEventListener('keydown', this._kd); window.addEventListener('keyup', this._ku);
    dom.addEventListener('mousedown', e => {
      if (!this.enabled) return;
      if (!this.controls.isLocked) { this.controls.lock(); return; }
      if (e.button === 0 && this.focus) this.focus.action();
      if (e.button === 2) this.zoom = true;
    });
    dom.addEventListener('mouseup', e => { if (e.button === 2) this.zoom = false; });
    dom.addEventListener('contextmenu', e => { if (this.enabled) e.preventDefault(); });
  }

  onKey(e, down) {
    if (!this.enabled) return;
    const k = e.code;
    this.keys[k] = down;
    if (!down) return;
    if (k === 'KeyE' && this.focus) this.focus.action();
    if (k === 'KeyC' || k === 'ControlLeft') this.crouch = !this.crouch;
    if (k === 'KeyF') { this.flash.visible = !this.flash.visible; this.flash.intensity = this.flash.visible ? 60 : 0; }
    if (k === 'Space' && this.onGround) { this.vy = 3.7; this.onGround = false; }
    if (this.onKeyExtra) this.onKeyExtra(k);
  }

  enable(on) {
    this.enabled = on;
    if (!on) { this.controls.unlock(); this.keys = {}; this.flash.intensity = 0; this.flash.visible = false; this.camera.fov = this.fovBase; this.camera.updateProjectionMatrix(); }
  }

  teleport(x, y, zFeet, yawDeg) {
    this.pos.set(x, zFeet, y); this.vy = 0;
    this.camera.rotation.set(0, yawDeg * Math.PI / 180, 0, 'YXZ');
    this.camera.position.set(x, zFeet + this.eye, y);
  }

  collidersNow() {
    const list = this.colliders.slice();
    for (const d of this.doors) {
      if (d.noCollide) continue;
      if (d.kind === 'slide') list.push(d.isClosed() ? d.collider : d.openCollider);
      else if (d.kind === 'pld') { if (d.t < 0.85) list.push(d.collider); }
      else if (d.isClosed()) list.push(d.collider);
    }
    return list;
  }

  resolve(p, feet) {
    const lo = (feet + STEP) * 1000, hi = (feet + this.eye + 0.1) * 1000;
    const x = p.x * 1000, z = p.z * 1000, r = RADIUS * 1000;
    let px = x, pz = z;
    const list = this._list;
    for (let it = 0; it < 3; it++) {
      for (const c of list) {
        if (c.h1 <= lo || c.h0 >= hi) continue;
        if (px < c.x1 - r || px > c.x2 + r || pz < c.y1 - r || pz > c.y2 + r) continue;
        const nx = Math.max(c.x1, Math.min(px, c.x2)), nz = Math.max(c.y1, Math.min(pz, c.y2));
        let dx = px - nx, dz = pz - nz, d = Math.hypot(dx, dz);
        if (d >= r) continue;
        if (d < 1e-6) { // centre inside the box – push out along smallest axis
          const pen = [[px - c.x1, -1, 0], [c.x2 - px, 1, 0], [pz - c.y1, 0, -1], [c.y2 - pz, 0, 1]].sort((a, b) => a[0] - b[0])[0];
          px += pen[1] * (pen[0] + r); pz += pen[2] * (pen[0] + r);
        } else { px = nx + dx / d * r; pz = nz + dz / d * r; }
      }
      for (const s of this.segColliders) {
        if (s.h1 <= lo || s.h0 >= hi) continue;
        const ax = s.a[0], ay = s.a[1], bx = s.b[0], by = s.b[1];
        const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy;
        let t = ((px - ax) * vx + (pz - ay) * vy) / L2; t = Math.max(0, Math.min(1, t));
        const qx = ax + vx * t, qz = ay + vy * t;
        const dx = px - qx, dz = pz - qz, d = Math.hypot(dx, dz), rr = r + s.r;
        if (d < rr && d > 1e-6) { px = qx + dx / d * rr; pz = qz + dz / d * rr; }
      }
    }
    p.x = px / 1000; p.z = pz / 1000;
  }

  update(dt) {
    if (!this.enabled) return;
    dt = Math.min(dt, 0.1);
    this._list = this.collidersNow();
    const locked = this.controls.isLocked;
    const k = this.keys;
    const run = k.ShiftLeft || k.ShiftRight;
    const speed = this.crouch ? 1.1 : run ? 4.2 : 2.0;
    const f = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
    const s = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    const fwd = new THREE.Vector3(); this.camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const want = new THREE.Vector3().addScaledVector(fwd, f).addScaledVector(right, s);
    if (want.lengthSq() > 0) want.normalize().multiplyScalar(speed);
    void locked;
    const accel = this.onGround ? 12 : 3;
    this.vel.x += (want.x - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (want.z - this.vel.z) * Math.min(1, accel * dt);

    // sub-step the horizontal move so fast motion can't tunnel through 90mm stud walls
    const next = this.pos.clone();
    const mx = this.vel.x * dt, mz = this.vel.z * dt;
    const steps = Math.max(1, Math.ceil(Math.hypot(mx, mz) / 0.07));
    for (let i = 0; i < steps; i++) { next.x += mx / steps; next.z += mz / steps; this.resolve(next, this.pos.y); }
    // floor under the new position
    let floor = this.levelAt(next.x * 1000, next.z * 1000) / 1000;
    if (floor - this.pos.y > STEP) { next.x = this.pos.x; next.z = this.pos.z; floor = this.levelAt(next.x * 1000, next.z * 1000) / 1000; }
    const moved = Math.hypot(next.x - this.pos.x, next.z - this.pos.z);
    this.pos.x = next.x; this.pos.z = next.z;

    // gravity, step-up and sticking to the ground when walking down steps
    this.vy -= 9.8 * dt;
    let ny = this.pos.y + this.vy * dt;
    if (ny <= floor) { ny = floor; this.vy = 0; this.onGround = true; }
    else if (this.onGround && this.vy <= 0 && ny - floor < STEP * 0.7) { ny = floor; this.vy = 0; }
    else this.onGround = false;
    this.pos.y = ny;

    // eye height, head bob, footsteps
    const targetEye = this.crouch ? CROUCH : EYE;
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 10);
    if (this.onGround && moved > 0.0005) { this.bob += moved * (run ? 5.2 : 6.2); this.stepDist += moved; }
    const bobY = Math.sin(this.bob) * 0.025 * Math.min(1, this.vel.length() / 1.5);
    if (this.stepDist > (run ? 0.8 : 0.62)) { this.stepDist = 0; this.footstep(); }
    this.camera.position.set(this.pos.x, this.pos.y + this.eye + bobY, this.pos.z);
    // right-mouse zoom
    const fov = this.zoom ? 28 : this.fovBase;
    if (Math.abs(this.camera.fov - fov) > 0.1) { this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 10); this.camera.updateProjectionMatrix(); }

    // interaction focus
    this.ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const meshes = this.interactables.map(i => i.mesh);
    const hit = this.ray.intersectObjects(meshes, false)[0];
    this.focus = hit ? this.interactables.find(i => i.mesh === hit.object) : null;
    for (const d of this.doors) d.step(dt);
  }

  footstep() {
    if (!this.sound) return;
    try {
      if (!this.audio) this.audio = new (window.AudioContext || window.webkitAudioContext)();
      const a = this.audio, n = a.sampleRate * 0.09;
      const buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
      const src = a.createBufferSource(); src.buffer = buf;
      const flt = a.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 500 + Math.random() * 250;
      const g = a.createGain(); g.gain.value = 0.16;
      src.connect(flt).connect(g).connect(a.destination); src.start();
    } catch (e) { /* audio unavailable */ }
  }
}

// ---------------------------------------------------------------------------
// Minimap (plan-up, north arrow drawn from the drawing's north point)
// ---------------------------------------------------------------------------
export class Minimap {
  constructor(canvas, { walls, rooms, northDeg }) {
    this.c = canvas; this.ctx = canvas.getContext('2d');
    this.walls = walls; this.rooms = rooms; this.northDeg = northDeg;
    this.bounds = { x0: -4000, y0: -4000, x1: 24000, y1: 23000 };
    this.floorKey = r => r.type === 'bedroom' ? 'bedroom' : ['bath', 'ensuite', 'wc', 'laundry'].includes(r.type) ? 'wetTile' : r.type === 'outdoor' ? 'outdoorTile' : r.type === 'garage' ? 'garage' : 'living';
  }
  draw(px, py, yaw, doors) {
    const { c, ctx } = this, W = c.width, Hh = c.height;
    const b = this.bounds, s = Math.min(W / (b.x1 - b.x0), Hh / (b.y1 - b.y0));
    const T = (x, y) => [(x - b.x0) * s, (y - b.y0) * s];
    ctx.clearRect(0, 0, W, Hh);
    ctx.fillStyle = 'rgba(18,22,28,0.78)'; ctx.fillRect(0, 0, W, Hh);
    for (const r of this.rooms) for (const [x1, y1, x2, y2] of r.rects) {
      const [a, bb] = T(x1, y1), [cc, d] = T(x2, y2);
      const fl = this.floorKey(r);
      ctx.fillStyle = fl === 'bedroom' ? 'rgba(160,150,140,0.35)' : fl === 'wetTile' ? 'rgba(120,170,200,0.35)' : fl === 'outdoorTile' ? 'rgba(120,120,120,0.35)' : fl === 'garage' ? 'rgba(90,90,90,0.4)' : 'rgba(200,160,110,0.32)';
      ctx.fillRect(a, bb, cc - a, d - bb);
    }
    ctx.fillStyle = '#e8e8e8';
    for (const w of this.walls) { const [x1, y1, x2, y2] = w.rect; const [a, bb] = T(x1, y1), [cc, d] = T(x2, y2); ctx.fillRect(a, bb, Math.max(1, cc - a), Math.max(1, d - bb)); }
    // openings punched out
    ctx.fillStyle = 'rgba(18,22,28,1)';
    for (const w of this.walls) for (const o of w.openings || []) {
      if (o.type === 'win') continue;
      const [x1, y1, x2, y2] = w.rect, horiz = (x2 - x1) >= (y2 - y1);
      const r = horiz ? [o.a, y1, o.b, y2] : [x1, o.a, x2, o.b];
      const [a, bb] = T(r[0], r[1]), [cc, d] = T(r[2], r[3]); ctx.fillRect(a, bb, cc - a, d - bb);
    }
    // player
    const [x, y] = T(px, py);
    ctx.save(); ctx.translate(x, y); ctx.rotate(-yaw);
    ctx.fillStyle = 'rgba(90,200,255,0.25)'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 34, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#5ac8ff'; ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(0, 2); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill();
    ctx.restore();
    // north arrow
    ctx.save(); ctx.translate(W - 18, 20); ctx.rotate(this.northDeg * Math.PI / 180);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(5, 7); ctx.lineTo(0, 3); ctx.lineTo(-5, 7); ctx.closePath(); ctx.fill();
    ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('N', 0, -13);
    ctx.restore();
  }
}
