// Procedural canvas textures – no external image files required.
import * as THREE from 'three';

let seed = 1337;
function rand() {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Layered value noise drawn with smoothed up-scaling of small random canvases.
function noiseLayer(ctx, w, h, cells, alpha, light = 255, dark = 0) {
  const s = canvas(cells, Math.max(1, Math.round(cells * h / w)));
  const sc = s.getContext('2d');
  const img = sc.createImageData(s.width, s.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = rand() * (light - dark) + dark;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  sc.putImageData(img, 0, 0);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // draw tiled 3x3 so edges wrap reasonably
  for (let ix = -1; ix <= 1; ix++) for (let iy = -1; iy <= 1; iy++) ctx.drawImage(s, ix * w, iy * h, w, h);
  ctx.restore();
}

function grain(ctx, w, h, amount) {
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * amount;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function toTex(c, { srgb = true, repeat = 1 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(repeat, repeat);
  t.needsUpdate = true;
  return t;
}

function shade(hex, f) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return '#' + c.getHexString();
}

// Each generator returns { map, normalMap?, roughnessMap?, size } where size = metres covered by one texture repeat.
export const TEX = {
  render(hex = '#ECE9E1') {
    const c = canvas(512, 512), x = c.getContext('2d');
    x.fillStyle = hex; x.fillRect(0, 0, 512, 512);
    noiseLayer(x, 512, 512, 64, 0.05, 255, 150);
    noiseLayer(x, 512, 512, 16, 0.05, 255, 170);
    grain(x, 512, 512, 10);
    return { map: toTex(c), size: 2 };
  },

  plaster(hex = '#F2F1EC') {
    const c = canvas(256, 256), x = c.getContext('2d');
    x.fillStyle = hex; x.fillRect(0, 0, 256, 256);
    noiseLayer(x, 256, 256, 16, 0.025, 255, 200);
    grain(x, 256, 256, 4);
    return { map: toTex(c), size: 3 };
  },

  tiles({ base = '#d9d6cf', grout = '#b9b5ad', tileW = 0.6, tileH = 0.6, px = 1024, sizeM = 2.4, vary = 0.05, veins = false, gloss = false } = {}) {
    const c = canvas(px, px), x = c.getContext('2d');
    const nx = Math.round(sizeM / tileW), ny = Math.round(sizeM / tileH);
    const tw = px / nx, th = px / ny, g = Math.max(2, px / sizeM * 0.003);
    x.fillStyle = grout; x.fillRect(0, 0, px, px);
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const f = 1 + (rand() - 0.5) * vary;
      x.fillStyle = shade(base, f);
      x.fillRect(i * tw + g / 2, j * th + g / 2, tw - g, th - g);
    }
    noiseLayer(x, px, px, 128, 0.06, 255, 120);
    if (veins) {
      x.strokeStyle = 'rgba(120,120,120,0.10)';
      for (let k = 0; k < 40; k++) {
        x.lineWidth = 1 + rand() * 2; x.beginPath();
        let a = rand() * px, b = rand() * px; x.moveTo(a, b);
        for (let s = 0; s < 8; s++) { a += (rand() - 0.3) * 60; b += (rand() - 0.5) * 60; x.lineTo(a, b); }
        x.stroke();
      }
    }
    grain(x, px, px, 6);
    // roughness: grout rough, tile smoother
    const r = canvas(px, px), rx = r.getContext('2d');
    rx.fillStyle = '#ffffff'; rx.fillRect(0, 0, px, px);
    rx.fillStyle = gloss ? '#303030' : '#8a8a8a';
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) rx.fillRect(i * tw + g / 2, j * th + g / 2, tw - g, th - g);
    return { map: toTex(c), roughnessMap: toTex(r, { srgb: false }), size: sizeM };
  },

  planks({ base = '#b48a5e', px = 1024, sizeM = 2.4, plankW = 0.19, plankL = 1.83 } = {}) {
    const c = canvas(px, px), x = c.getContext('2d');
    const rows = Math.round(sizeM / plankW), rh = px / rows, pl = px * plankL / sizeM;
    for (let r = 0; r < rows; r++) {
      let off = -rand() * pl;
      while (off < px) {
        const f = 0.85 + rand() * 0.3;
        const col = shade(base, f);
        x.fillStyle = col; x.fillRect(off, r * rh, pl, rh);
        // grain streaks
        for (let k = 0; k < 18; k++) {
          x.strokeStyle = `rgba(${rand() < 0.5 ? '60,35,15' : '255,230,200'},${0.05 + rand() * 0.08})`;
          x.lineWidth = 0.5 + rand() * 1.5;
          const yy = r * rh + rand() * rh;
          x.beginPath(); x.moveTo(off, yy);
          x.bezierCurveTo(off + pl * 0.3, yy + (rand() - 0.5) * 6, off + pl * 0.6, yy + (rand() - 0.5) * 6, off + pl, yy + (rand() - 0.5) * 4);
          x.stroke();
        }
        x.fillStyle = 'rgba(40,25,10,0.55)'; x.fillRect(off, r * rh, 1.5, rh);
        off += pl;
      }
      x.fillStyle = 'rgba(40,25,10,0.5)'; x.fillRect(0, r * rh, px, 1.5);
    }
    grain(x, px, px, 6);
    return { map: toTex(c), size: sizeM };
  },

  carpet(hex = '#8d8a85') {
    const c = canvas(512, 512), x = c.getContext('2d');
    x.fillStyle = hex; x.fillRect(0, 0, 512, 512);
    noiseLayer(x, 512, 512, 256, 0.25, 255, 0);
    noiseLayer(x, 512, 512, 32, 0.08, 255, 0);
    grain(x, 512, 512, 30);
    return { map: toTex(c), size: 1 };
  },

  concrete(hex = '#a9a7a2', { spots = true, px = 512, size = 3 } = {}) {
    const c = canvas(px, px), x = c.getContext('2d');
    x.fillStyle = hex; x.fillRect(0, 0, px, px);
    noiseLayer(x, px, px, 8, 0.12, 255, 60);
    noiseLayer(x, px, px, 48, 0.10, 255, 80);
    if (spots) for (let i = 0; i < 900; i++) {
      x.fillStyle = `rgba(${rand() < 0.5 ? '40,40,40' : '240,240,240'},${rand() * 0.25})`;
      x.beginPath(); x.arc(rand() * px, rand() * px, rand() * 1.8, 0, 7); x.fill();
    }
    grain(x, px, px, 14);
    return { map: toTex(c), size };
  },

  grass() {
    const px = 1024, c = canvas(px, px), x = c.getContext('2d');
    x.fillStyle = '#5f7f35'; x.fillRect(0, 0, px, px);
    noiseLayer(x, px, px, 6, 0.08, 200, 90);
    noiseLayer(x, px, px, 96, 0.16, 255, 60);
    for (let i = 0; i < 30000; i++) {
      const g = 90 + rand() * 90;
      x.strokeStyle = `rgba(${40 + rand() * 50},${g},${20 + rand() * 30},0.5)`;
      x.lineWidth = 1;
      const a = rand() * px, b = rand() * px;
      x.beginPath(); x.moveTo(a, b); x.lineTo(a + (rand() - 0.5) * 4, b - 3 - rand() * 5); x.stroke();
    }
    return { map: toTex(c), size: 4 };
  },

  asphalt() {
    const px = 512, c = canvas(px, px), x = c.getContext('2d');
    x.fillStyle = '#3f4042'; x.fillRect(0, 0, px, px);
    noiseLayer(x, px, px, 8, 0.1, 255, 0);
    for (let i = 0; i < 12000; i++) {
      const v = 40 + rand() * 90;
      x.fillStyle = `rgba(${v},${v},${v},0.6)`; x.fillRect(rand() * px, rand() * px, 1.5, 1.5);
    }
    return { map: toTex(c), size: 3 };
  },

  pavers({ base = '#a4553c', px = 512, sizeM = 1.2 } = {}) {
    const c = canvas(px, px), x = c.getContext('2d');
    x.fillStyle = '#8f8a80'; x.fillRect(0, 0, px, px);
    const bw = px * 0.23 / sizeM, bh = px * 0.115 / sizeM;
    for (let r = 0; r * bh < px; r++) for (let k = -1; k * bw < px; k++) {
      const off = (r % 2) * bw / 2;
      x.fillStyle = shade(base, 0.8 + rand() * 0.35);
      x.fillRect(k * bw + off + 1, r * bh + 1, bw - 2, bh - 2);
    }
    grain(x, px, px, 12);
    return { map: toTex(c), size: sizeM };
  },

  // Colorbond roof sheet – rib normal map (trimdek-like 190mm cover per rib)
  ribNormal({ ribs = 8, sizeM = 1.52 } = {}) {
    const w = 512, h = 8, c = canvas(w, h), x = c.getContext('2d');
    const img = x.createImageData(w, h);
    for (let i = 0; i < w; i++) {
      const p = (i / w * ribs) % 1;
      // profile slope: pan flat, rib trapezoid
      let s = 0;
      if (p < 0.06) s = 0.9; else if (p < 0.14) s = 0; else if (p < 0.2) s = -0.9;
      else s = Math.sin(p * Math.PI * 10) * 0.05;
      const nx = s, nz = 1;
      const l = Math.hypot(nx, nz);
      for (let j = 0; j < h; j++) {
        const k = (j * w + i) * 4;
        img.data[k] = (nx / l * 0.5 + 0.5) * 255;
        img.data[k + 1] = 128;
        img.data[k + 2] = (nz / l * 0.5 + 0.5) * 255;
        img.data[k + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);
    const t = toTex(c, { srgb: false });
    return { normalMap: t, size: sizeM };
  },

  battens({ base = '#9a6a43', px = 512, sizeM = 1.0, gap = 0.012, w = 0.066 } = {}) {
    const c = canvas(px, px), x = c.getContext('2d');
    x.fillStyle = '#2a1d12'; x.fillRect(0, 0, px, px);
    const n = Math.round(sizeM / (w + gap)), bw = px / n;
    for (let i = 0; i < n; i++) {
      x.fillStyle = shade(base, 0.85 + rand() * 0.3);
      x.fillRect(i * bw, 0, bw - px * gap / sizeM, px);
      for (let k = 0; k < 10; k++) {
        x.strokeStyle = `rgba(50,30,15,${0.06 + rand() * 0.1})`;
        x.beginPath(); const xx = i * bw + rand() * bw * 0.8; x.moveTo(xx, 0); x.lineTo(xx + (rand() - 0.5) * 6, px); x.stroke();
      }
    }
    grain(x, px, px, 8);
    return { map: toTex(c), size: sizeM };
  },

  corrugatedFence(hex = '#4e524f') {
    const c = canvas(256, 16), x = c.getContext('2d');
    for (let i = 0; i < 256; i++) {
      const v = 0.8 + 0.25 * Math.sin(i / 256 * Math.PI * 2 * 13);
      x.fillStyle = shade(hex, v); x.fillRect(i, 0, 1, 16);
    }
    return { map: toTex(c), size: 1 };
  },

  boardFence() {
    const c = canvas(64, 512), x = c.getContext('2d');
    const n = 7, bh = 512 / n;
    for (let i = 0; i < n; i++) {
      x.fillStyle = shade('#8a6a4b', 0.8 + rand() * 0.35); x.fillRect(0, i * bh, 64, bh - 6);
      x.fillStyle = '#2b2118'; x.fillRect(0, i * bh + bh - 6, 64, 6);
    }
    grain(x, 64, 512, 18);
    return { map: toTex(c), size: 1.0 };
  },

  roofTile() {
    const c = canvas(256, 256), x = c.getContext('2d');
    x.fillStyle = '#6e6b66'; x.fillRect(0, 0, 256, 256);
    for (let r = 0; r < 8; r++) { x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(0, r * 32 + 28, 256, 4); }
    grain(x, 256, 256, 14);
    return { map: toTex(c), size: 2.6 };
  },

  brick({ base = '#8e4a36', mortar = '#d9d4c8', px = 1024, sizeM = 1.72 } = {}) {
    const c = canvas(px, px), x = c.getContext('2d');
    x.fillStyle = mortar; x.fillRect(0, 0, px, px);
    const bw = px * 0.230 / sizeM, bh = px * 0.086 / sizeM, j = px * 0.010 / sizeM;
    for (let r = 0; r * bh < px + bh; r++) for (let k = -1; k * bw < px + bw; k++) {
      const off = (r % 2) * bw / 2;
      x.fillStyle = shade(base, 0.78 + rand() * 0.4);
      x.fillRect(k * bw + off + j / 2, r * bh + j / 2, bw - j, bh - j);
    }
    noiseLayer(x, px, px, 256, 0.10, 255, 60);
    grain(x, px, px, 16);
    return { map: toTex(c), size: sizeM };
  },

  weatherboard(hex = '#e9e6de', { board = 0.18, px = 512, sizeM = 1.44 } = {}) {
    const c = canvas(px, px), x = c.getContext('2d');
    const n = Math.round(sizeM / board), bh = px / n;
    for (let i = 0; i < n; i++) {
      const g = x.createLinearGradient(0, i * bh, 0, (i + 1) * bh);
      g.addColorStop(0, shade(hex, 0.78)); g.addColorStop(0.12, shade(hex, 1.0)); g.addColorStop(1, shade(hex, 0.94));
      x.fillStyle = g; x.fillRect(0, i * bh, px, bh);
    }
    grain(x, px, px, 5);
    return { map: toTex(c), size: sizeM };
  },

  vcladding(hex = '#e9e6de', { pitch = 0.133, px = 512, sizeM = 1.33 } = {}) {
    const c = canvas(px, px), x = c.getContext('2d');
    x.fillStyle = hex; x.fillRect(0, 0, px, px);
    const n = Math.round(sizeM / pitch), bw = px / n;
    for (let i = 0; i < n; i++) { x.fillStyle = shade(hex, 0.72); x.fillRect(i * bw, 0, 3, px); x.fillStyle = shade(hex, 1.06); x.fillRect(i * bw + 3, 0, 2, px); }
    grain(x, px, px, 5);
    return { map: toTex(c), size: sizeM };
  },

  stone(hex = '#b9b6ae', { px = 1024, sizeM = 1.2 } = {}) {
    const c = canvas(px, px), x = c.getContext('2d');
    x.fillStyle = shade(hex, 0.45); x.fillRect(0, 0, px, px);
    let y = 0;
    while (y < px) {
      const h = px * (0.05 + rand() * 0.06) / sizeM;
      let xx = -rand() * 100;
      while (xx < px) {
        const w = px * (0.15 + rand() * 0.35) / sizeM;
        x.fillStyle = shade(hex, 0.7 + rand() * 0.5);
        x.fillRect(xx + 2, y + 2, w - 4, h - 4);
        xx += w;
      }
      y += h;
    }
    noiseLayer(x, px, px, 128, 0.15, 255, 40);
    grain(x, px, px, 18);
    return { map: toTex(c), size: sizeM };
  },

  roofTiles(hex = '#3b3b3c', { terracotta = false, px = 512, sizeM = 1.3 } = {}) {
    const c = canvas(px, px), x = c.getContext('2d');
    const rows = 4, cols = 4, rh = px / rows, cw = px / cols;
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
      const g = x.createLinearGradient(k * cw, 0, (k + 1) * cw, 0);
      const f = 0.9 + rand() * 0.2;
      g.addColorStop(0, shade(hex, 0.6 * f)); g.addColorStop(0.35, shade(hex, 1.1 * f)); g.addColorStop(0.7, shade(hex, 0.95 * f)); g.addColorStop(1, shade(hex, 0.6 * f));
      x.fillStyle = g; x.fillRect(k * cw, r * rh, cw, rh);
      x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(k * cw, r * rh + rh - 6, cw, 6);
    }
    if (terracotta) noiseLayer(x, px, px, 64, 0.12, 255, 60);
    grain(x, px, px, 10);
    return { map: toTex(c), size: sizeM };
  },

  fluted(hex = '#f3f2ee', { pitch = 0.025, px = 256, sizeM = 0.5 } = {}) {
    const c = canvas(px, 16), x = c.getContext('2d');
    const n = Math.round(sizeM / pitch), bw = px / n;
    for (let i = 0; i < px; i++) { const p = (i % bw) / bw; x.fillStyle = shade(hex, 0.82 + 0.25 * Math.sin(p * Math.PI)); x.fillRect(i, 0, 1, 16); }
    return { map: toTex(c), size: sizeM };
  },

  frosted() {
    const c = canvas(256, 256), x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 256, 256);
    noiseLayer(x, 256, 256, 128, 0.35, 255, 160);
    return { map: toTex(c), size: 0.5 };
  },
};

// Text label sprite texture (used for signage / plan labels in WebGL)
export function textTexture(text, { font = 'bold 64px Inter, Arial', color = '#222', bg = null, pad = 16 } = {}) {
  const c = canvas(8, 8); let x = c.getContext('2d');
  x.font = font; const w = Math.ceil(x.measureText(text).width) + pad * 2;
  c.width = w; c.height = 96; x = c.getContext('2d'); x.font = font;
  if (bg) { x.fillStyle = bg; x.fillRect(0, 0, w, 96); }
  x.fillStyle = color; x.textBaseline = 'middle'; x.fillText(text, pad, 50);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return { tex: t, aspect: w / 96 };
}
