// Click-to-measure tool (point to point on any surface), results in millimetres.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

export class MeasureTool {
  constructor(scene, dom, getCamera, getTargets, onChange) {
    this.scene = scene; this.dom = dom; this.getCamera = getCamera; this.getTargets = getTargets; this.onChange = onChange;
    this.group = new THREE.Group(); this.group.name = 'measurements'; scene.add(this.group);
    this.active = false; this.first = null; this.items = [];
    this.snap = true;
    this.ray = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    const dotGeo = new THREE.SphereGeometry(0.035, 12, 8);
    this.dotMat = new THREE.MeshBasicMaterial({ color: '#ff4d6d', depthTest: false });
    this.dotGeo = dotGeo;
    this.cursor = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: '#ffd166', depthTest: false }));
    this.cursor.renderOrder = 10; this.cursor.visible = false; this.group.add(this.cursor);
    this.preview = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: '#ffd166', depthTest: false }));
    this.preview.renderOrder = 10; this.preview.visible = false; this.group.add(this.preview);
    this.previewLabel = this.label('');
    this.previewLabel.visible = false; this.group.add(this.previewLabel);
    this._down = null;
    dom.addEventListener('pointerdown', e => { this._down = [e.clientX, e.clientY]; });
    dom.addEventListener('pointerup', e => {
      if (!this.active || !this._down || e.button !== 0) return;
      if (Math.hypot(e.clientX - this._down[0], e.clientY - this._down[1]) > 5) return;
      const p = this.pick(e); if (p) this.click(p);
    });
    dom.addEventListener('pointermove', e => {
      if (!this.active) return;
      const p = this.pick(e);
      this.cursor.visible = !!p;
      if (p) this.cursor.position.copy(p);
      if (this.first && p) {
        this.preview.visible = true;
        this.preview.geometry.setFromPoints([this.first, p]);
        this.previewLabel.visible = true;
        this.previewLabel.element.innerHTML = this.fmt(this.first, p);
        this.previewLabel.position.copy(this.first).add(p).multiplyScalar(0.5);
      }
    });
    window.addEventListener('keydown', e => { if (this.active && e.key === 'Escape') this.cancel(); });
  }

  label(html) {
    const el = document.createElement('div'); el.className = 'mlbl'; el.innerHTML = html;
    return new CSS2DObject(el);
  }

  fmt(a, b) {
    const d = a.distanceTo(b) * 1000, dx = Math.abs(b.x - a.x) * 1000, dz = Math.abs(b.z - a.z) * 1000, dy = Math.abs(b.y - a.y) * 1000;
    return `<b>${Math.round(d).toLocaleString()} mm</b><span>Δplan ${Math.round(Math.hypot(dx, dz))} · Δh ${Math.round(dy)}</span>`;
  }

  pick(e) {
    const r = this.dom.getBoundingClientRect();
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.mouse, this.getCamera());
    const hits = this.ray.intersectObjects(this.getTargets(), true).filter(h => h.object.visible && h.object.material?.visible !== false && !h.object.material?.transparent);
    if (!hits.length) return null;
    const p = hits[0].point.clone();
    if (this.snap) { p.x = Math.round(p.x * 100) / 100; p.z = Math.round(p.z * 100) / 100; p.y = Math.round(p.y * 100) / 100; }
    return p;
  }

  click(p) {
    if (!this.first) {
      this.first = p;
      const d = new THREE.Mesh(this.dotGeo, this.dotMat); d.position.copy(p); d.renderOrder = 10;
      this.group.add(d); this._firstDot = d;
      return;
    }
    const a = this.first, b = p;
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: '#ff4d6d', depthTest: false }));
    line.renderOrder = 10;
    const d2 = new THREE.Mesh(this.dotGeo, this.dotMat); d2.position.copy(b); d2.renderOrder = 10;
    const lbl = this.label(this.fmt(a, b)); lbl.position.copy(a).add(b).multiplyScalar(0.5);
    this.group.add(line, d2, lbl);
    this.items.push({ a, b, objs: [line, d2, lbl, this._firstDot], mm: Math.round(a.distanceTo(b) * 1000) });
    this.first = null; this.preview.visible = false; this.previewLabel.visible = false;
    if (this.onChange) this.onChange(this.items);
  }

  cancel() {
    if (this._firstDot && this.first) this.group.remove(this._firstDot);
    this.first = null; this.preview.visible = false; this.previewLabel.visible = false;
  }

  clear() {
    this.cancel();
    for (const it of this.items) for (const o of it.objs) { this.group.remove(o); if (o.element) o.element.remove(); }
    this.items = [];
    if (this.onChange) this.onChange(this.items);
  }

  setActive(on) {
    this.active = on; this.cursor.visible = false;
    if (!on) this.cancel();
  }
}
