// Sun position (NOAA approximation), sky, shadows and weather.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
export const LOC = { lat: -34.93, lon: 138.6, tz: 9.5, dst: true, north: 0, center: [8, 7] };

const D2R = Math.PI / 180;

// Adelaide: ACST UTC+9:30, daylight saving (ACDT +10:30) from 1st Sunday Oct to 1st Sunday Apr.
export function localOffsetHours(y, m, d) {
  if (!LOC.dst) return LOC.tz;
  const firstSunday = (yy, mm) => { const dt = new Date(Date.UTC(yy, mm, 1)); return 1 + ((7 - dt.getUTCDay()) % 7); };
  const inDST = (m > 9 || m < 3) || (m === 9 && d >= firstSunday(y, 9)) || (m === 3 && d < firstSunday(y, 3));
  return inDST ? LOC.tz + 1 : LOC.tz;
}

export function sunPosition(utcMs, lat, lon) {
  const jd = utcMs / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = ((280.460 + 0.9856474 * n) % 360 + 360) % 360;
  const g = (((357.528 + 0.9856003 * n) % 360 + 360) % 360) * D2R;
  const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R;
  const eps = (23.439 - 0.0000004 * n) * D2R;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const gmst = ((18.697374558 + 24.06570982441908 * n) % 24 + 24) % 24;
  const lst = (gmst * 15 + lon) * D2R;
  const ha = lst - ra;
  const la = lat * D2R;
  const el = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.cos(dec) * Math.sin(ha), Math.sin(dec) * Math.cos(la) - Math.cos(dec) * Math.sin(la) * Math.cos(ha));
  return { azimuth: ((az / D2R) + 360) % 360, elevation: el / D2R };
}

// Convert azimuth (from true north, clockwise) + elevation to a world direction.
export function sunVector(azDeg, elDeg) {
  const t = (LOC.north + azDeg) * D2R, e = elDeg * D2R;
  return new THREE.Vector3(Math.cos(e) * Math.sin(t), Math.sin(e), -Math.cos(e) * Math.cos(t));
}

export const WEATHER = {
  clear: { label: 'Clear', turbidity: 2.5, rayleigh: 2.0, sun: 4.6, hemi: 0.75, env: 1.0, clouds: 0, fog: 0, rain: false },
  cloudy: { label: 'Partly cloudy', turbidity: 6, rayleigh: 2.2, sun: 3.2, hemi: 0.95, env: 0.95, clouds: 0.55, fog: 0.004, rain: false },
  overcast: { label: 'Overcast', turbidity: 14, rayleigh: 3.5, sun: 0.45, hemi: 1.5, env: 0.75, clouds: 0.95, fog: 0.008, rain: false },
  rain: { label: 'Rain', turbidity: 16, rayleigh: 4, sun: 0.2, hemi: 1.1, env: 0.6, clouds: 1, fog: 0.018, rain: true },
  fog: { label: 'Fog', turbidity: 10, rayleigh: 2, sun: 0.4, hemi: 1.2, env: 0.55, clouds: 0, fog: 0.06, rain: false },
};

function cloudTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 1024;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 1024, 1024);
  let s = 7;
  const r = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  for (let i = 0; i < 260; i++) {
    const cx = r() * 1024, cy = r() * 1024, rad = 30 + r() * 120;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, `rgba(255,255,255,${0.22 + r() * 0.2})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    for (const ox of [-1024, 0, 1024]) for (const oy of [-1024, 0, 1024]) { x.beginPath(); x.arc(cx + ox, cy + oy, rad, 0, 7); x.fill(); }
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Environment {
  constructor(scene, renderer) {
    this.scene = scene; this.renderer = renderer;
    this.center = new THREE.Vector3(8.2, 0, 7.5);
    this.sky = new Sky(); this.sky.scale.setScalar(4000); scene.add(this.sky);
    const u = this.sky.material.uniforms;
    u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.8;

    this.sun = new THREE.DirectionalLight('#fff4e0', 3);
    this.sun.castShadow = true;
    this.sun.shadow.autoUpdate = false; this.sun.shadow.needsUpdate = true;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.03;
    this.setShadowSize(2048, 26);
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight('#cfe3ff', '#8a7f6a', 0.55);
    scene.add(this.hemi);
    this.moon = new THREE.DirectionalLight('#9fb4ff', 0);
    this.moon.position.set(-30, 40, 20); scene.add(this.moon);

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new Sky(); this.envSky.scale.setScalar(1000); this.envSky.material = this.sky.material; this.envScene.add(this.envSky);
    this.envRT = null; this._lastEnvKey = '';

    // clouds
    this.cloudTex = cloudTexture();
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.MeshBasicMaterial({ map: this.cloudTex, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.clouds.rotation.x = Math.PI / 2; this.clouds.position.y = 160; this.cloudTex.repeat.set(3, 3);
    scene.add(this.clouds);

    // stars
    const sp = []; for (let i = 0; i < 1500; i++) { const v = new THREE.Vector3().randomDirection(); if (v.y < 0.05) v.y = Math.abs(v.y) + 0.05; sp.push(v.multiplyScalar(1500)); }
    this.stars = new THREE.Points(new THREE.BufferGeometry().setFromPoints(sp), new THREE.PointsMaterial({ color: '#ffffff', size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    scene.add(this.stars);

    // rain
    const N = 7000; this.rainN = N;
    const rp = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) { const x = (Math.random() - 0.5) * 60, y = Math.random() * 25, z = (Math.random() - 0.5) * 60; rp.set([x, y, z, x + 0.02, y - 0.45, z], i * 6); }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: '#b8c6d6', transparent: true, opacity: 0.45, depthWrite: false }));
    this.rain.frustumCulled = false; this.rain.visible = false; scene.add(this.rain);

    this.weather = 'clear';
    this.interior = 1;
    const now = new Date();
    this.date = { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
    this.hours = 11.5;
    this.onNight = null;
    this.night = false;
    this.apply();
  }

  setShadowSize(size, extent) {
    this.sun.shadow.mapSize.set(size, size);
    const c = this.sun.shadow.camera;
    c.left = -extent; c.right = extent; c.top = extent; c.bottom = -extent; c.near = 1; c.far = 160;
    c.updateProjectionMatrix();
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.sun.shadow.needsUpdate = true;
  }

  setDate(y, m, d) { this.date = { y, m, d }; this.apply(); }
  setHours(h) { this.hours = h; this.apply(); }
  setWeather(w) { this.weather = w; this.apply(); }

  utc() {
    const { y, m, d } = this.date;
    const off = localOffsetHours(y, m, d);
    return Date.UTC(y, m, d, 0, 0, 0) + (this.hours - off) * 3600000;
  }

  apply() {
    this.center.set(LOC.center[0], 0, LOC.center[1]);
    const pos = sunPosition(this.utc(), LOC.lat, LOC.lon);
    this.pos = pos;
    const W = WEATHER[this.weather];
    const dir = sunVector(pos.azimuth, pos.elevation);
    this.dir = dir;
    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(dir);
    u.turbidity.value = W.turbidity; u.rayleigh.value = W.rayleigh;
    const el = pos.elevation;
    const day = THREE.MathUtils.smoothstep(el, -4, 6);
    const low = 1 - THREE.MathUtils.smoothstep(el, 2, 25);
    this.sun.color.setRGB(1, 0.93 - low * 0.35, 0.85 - low * 0.6);
    this.sun.intensity = W.sun * THREE.MathUtils.smoothstep(el, -1, 8);
    this.sun.position.copy(this.center).addScaledVector(dir, 70);
    this.sun.target.position.copy(this.center);
    this.sun.visible = el > -1;
    this.sun.shadow.needsUpdate = true;
    this.hemiBase = W.hemi * (0.08 + 0.92 * day);
    this.hemi.intensity = this.hemiBase * this.interior;
    this.hemi.color.set(this.weather === 'clear' ? '#cfe3ff' : '#d8dde3');
    this.moon.intensity = (1 - day) * 0.12;
    this.envIntensity = W.env * (0.1 + 0.9 * day);
    this.stars.material.opacity = (1 - day) * (W.clouds > 0.8 || W.fog > 0.02 ? 0.1 : 0.9);
    this.clouds.material.opacity = W.clouds * (0.25 + 0.75 * day) * 0.95;
    this.clouds.material.color.set(this.weather === 'rain' ? '#9aa1a8' : '#ffffff');
    this.rain.visible = W.rain;
    const fogCol = new THREE.Color(this.weather === 'fog' ? '#c9cdd1' : '#b8c0c8').multiplyScalar(0.15 + 0.85 * day);
    if (W.fog > 0) {
      this.scene.fog = new THREE.FogExp2(fogCol, W.fog);
    } else this.scene.fog = null;
    this.sky.visible = this.weather !== 'fog';
    this.scene.background = this.weather === 'fog' ? fogCol : null;
    this.exposureBase = (this.weather === 'overcast' || this.weather === 'rain' ? 0.7 : 0.58) + (1 - day) * 0.5;
    this.day = day;
    this.renderer.toneMappingExposure = this.exposureBase * (1 + (1 - this.interior) * 0.9 * day);

    const night = el < -3;
    if (night !== this.night) { this.night = night; if (this.onNight) this.onNight(night); }
    this.updateEnv();
  }

  updateEnv() {
    const key = `${this.dir.x.toFixed(2)},${this.dir.y.toFixed(2)},${this.dir.z.toFixed(2)},${this.weather}`;
    if (key === this._lastEnvKey) { this.scene.environmentIntensity = this.envIntensity * this.interior; return; }
    this._lastEnvKey = key;
    clearTimeout(this._envTimer);
    this._envTimer = setTimeout(() => {
      const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 2000);
      if (this.envRT) this.envRT.dispose();
      this.envRT = rt;
      this.scene.environment = rt.texture;
      this.scene.environmentIntensity = this.envIntensity * this.interior;
    }, 60);
    this.scene.environmentIntensity = this.envIntensity * this.interior;
  }

  // 1 = outdoors, lower = inside (sky light occluded by walls/roof; eye adapts)
  setInterior(target, dt) {
    const f = this.interior + (target - this.interior) * Math.min(1, dt * 2.5);
    if (Math.abs(f - this.interior) < 1e-4) return;
    this.interior = f;
    this.hemi.intensity = this.hemiBase * f;
    this.scene.environmentIntensity = this.envIntensity * f;
    this.renderer.toneMappingExposure = this.exposureBase * (1 + (1 - f) * 0.9 * this.day);
  }

  update(dt, camera) {
    this.cloudTex.offset.x += dt * 0.002;
    this.clouds.position.x = camera.position.x; this.clouds.position.z = camera.position.z;
    if (this.rain.visible) {
      const p = this.rain.geometry.attributes.position.array;
      const cx = camera.position.x, cz = camera.position.z, cy = camera.position.y;
      for (let i = 0; i < this.rainN; i++) {
        const o = i * 6;
        let y = p[o + 1] - dt * 11;
        let x = p[o], z = p[o + 2];
        if (y < -0.3 || Math.abs(x - cx) > 30 || Math.abs(z - cz) > 30) {
          x = cx + (Math.random() - 0.5) * 60; z = cz + (Math.random() - 0.5) * 60; y = cy + 5 + Math.random() * 18;
        }
        p[o] = x; p[o + 1] = y; p[o + 2] = z; p[o + 3] = x + 0.02; p[o + 4] = y - 0.45; p[o + 5] = z;
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
  }
}
