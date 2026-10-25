import * as THREE from '../vendor/three.module.js';

// All room textures are painted on canvases in code: no image files to
// download, and sizes stay small enough for the Quest 1.

function seeded(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function canvasTexture(width, height, draw, { repeat = [1, 1], wrap = true } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (wrap) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(...repeat);
  }
  return tex;
}

function grain(ctx, w, h, rand, { lines, color, alpha, horizontal = false }) {
  ctx.strokeStyle = color;
  for (let i = 0; i < lines; i++) {
    ctx.globalAlpha = alpha * (0.4 + rand() * 0.6);
    ctx.lineWidth = 0.5 + rand() * 1.5;
    ctx.beginPath();
    const base = rand() * (horizontal ? h : w);
    const wave = 2 + rand() * 6;
    const freq = 0.01 + rand() * 0.03;
    for (let t = 0; t <= (horizontal ? w : h); t += 8) {
      const off = base + Math.sin(t * freq + i) * wave;
      if (horizontal) ctx.lineTo(t, off);
      else ctx.lineTo(off, t);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

export function woodFloor() {
  return canvasTexture(512, 512, (ctx, w, h) => {
    const rand = seeded(7);
    const planks = 8;
    const pw = w / planks;
    for (let i = 0; i < planks; i++) {
      // each plank is cut into two boards at a random joint
      const joint = h * (0.2 + rand() * 0.6);
      for (const [y0, y1] of [[0, joint], [joint, h]]) {
        const l = 18 + rand() * 12;
        ctx.fillStyle = `hsl(${24 + rand() * 8}, ${32 + rand() * 12}%, ${l}%)`;
        ctx.fillRect(i * pw, y0, pw, y1 - y0);
      }
      ctx.save();
      ctx.beginPath();
      ctx.rect(i * pw, 0, pw, h);
      ctx.clip();
      ctx.translate(i * pw, 0);
      grain(ctx, pw, h, rand, { lines: 14, color: '#1a0e06', alpha: 0.35 });
      ctx.restore();
      ctx.fillStyle = '#0d0703';
      ctx.fillRect(i * pw, 0, 2, h);
      ctx.fillRect(i * pw, joint - 1, pw, 2);
    }
  }, { repeat: [4, 4] });
}

export function wallpaper() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    const rand = seeded(11);
    ctx.fillStyle = '#2a2233';
    ctx.fillRect(0, 0, w, h);
    // stripes
    ctx.fillStyle = '#322840';
    ctx.fillRect(w * 0.375, 0, w * 0.25, h);
    // damask-like motif: a diamond of leaves around a dot
    ctx.fillStyle = '#433556';
    for (const [cx, cy] of [[w / 2, h / 2], [0, 0], [w, 0], [0, h], [w, h]]) {
      ctx.save();
      ctx.translate(cx, cy);
      for (let k = 0; k < 4; k++) {
        ctx.rotate(Math.PI / 2);
        ctx.beginPath();
        ctx.ellipse(0, -22, 9, 20, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // age stains
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(10, 5, 15, ${0.04 + rand() * 0.06})`;
      ctx.beginPath();
      ctx.arc(rand() * w, rand() * h, 5 + rand() * 30, 0, Math.PI * 2);
      ctx.fill();
    }
  }, { repeat: [8, 3] });
}

export function woodGrain(seed = 3, hue = 22, light = 22) {
  return canvasTexture(256, 256, (ctx, w, h) => {
    const rand = seeded(seed);
    ctx.fillStyle = `hsl(${hue}, 38%, ${light}%)`;
    ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, rand, { lines: 40, color: '#140a04', alpha: 0.3, horizontal: true });
    grain(ctx, w, h, rand, { lines: 12, color: '#6b4426', alpha: 0.15, horizontal: true });
  });
}

export function plaster() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    const rand = seeded(5);
    ctx.fillStyle = '#4a4650';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 1500; i++) {
      ctx.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)';
      ctx.fillRect(rand() * w, rand() * h, 2, 2);
    }
  }, { repeat: [4, 4] });
}

export function fabric(base, line, seed = 9) {
  return canvasTexture(128, 128, (ctx, w, h) => {
    const rand = seeded(seed);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = line;
    ctx.globalAlpha = 0.35;
    for (let i = 0; i < w; i += 16) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = `rgba(0,0,0,${rand() * 0.08})`;
      ctx.fillRect(rand() * w, rand() * h, 2, 2);
    }
  }, { repeat: [2, 2] });
}

// vertical folds for curtains
export function velvet() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    for (let i = 0; i <= 6; i++) grad.addColorStop(i / 6, i % 2 ? '#3a0a14' : '#6a1424');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  });
}

export function rug() {
  return canvasTexture(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#3d0f12';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#a8742c';
    ctx.lineWidth = 6;
    ctx.strokeRect(14, 14, w - 28, h - 28);
    ctx.strokeStyle = '#1e2a4a';
    ctx.lineWidth = 12;
    ctx.strokeRect(34, 34, w - 68, h - 68);
    ctx.fillStyle = '#a8742c';
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-50, -50, 100, 100);
    ctx.restore();
    ctx.fillStyle = '#5c1a1e';
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-30, -30, 60, 60);
    ctx.restore();
    for (const x of [110, w - 110]) {
      ctx.fillStyle = '#1e2a4a';
      ctx.beginPath();
      ctx.arc(x, h / 2, 30, 0, Math.PI * 2);
      ctx.fill();
    }
  }, { wrap: false });
}

// glowing magic circle drawn on a transparent background (used additively)
export function magicCircle() {
  return canvasTexture(512, 512, (ctx, w, h) => {
    const rand = seeded(13);
    ctx.translate(w / 2, h / 2);
    ctx.strokeStyle = '#ffffff';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 12;
    ctx.lineWidth = 6;
    for (const r of [235, 205]) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.lineWidth = 5;
    ctx.beginPath();
    for (let i = 0; i <= 5; i++) {
      const a = (i * 4 * Math.PI) / 5 - Math.PI / 2;
      ctx.lineTo(Math.cos(a) * 200, Math.sin(a) * 200);
    }
    ctx.stroke();
    // runes between the two rings
    ctx.lineWidth = 3;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      ctx.save();
      ctx.rotate(a);
      ctx.translate(0, -220);
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        ctx.moveTo((rand() - 0.5) * 14, (rand() - 0.5) * 14);
        ctx.lineTo((rand() - 0.5) * 14, (rand() - 0.5) * 14);
      }
      ctx.stroke();
      ctx.restore();
    }
  }, { wrap: false });
}

// pumpkin skin with ridges + a separate glow map for the carved face
export function pumpkin() {
  const face = (ctx, w, h) => {
    // face sits around u = 0.75 (the side of a three.js sphere facing -z)
    const cx = w * 0.75, cy = h * 0.5;
    ctx.beginPath();
    for (const s of [-1, 1]) {
      ctx.moveTo(cx + s * 18, cy - 4);
      ctx.lineTo(cx + s * 6, cy - 4);
      ctx.lineTo(cx + s * 12, cy - 18);
      ctx.closePath();
    }
    ctx.moveTo(cx - 24, cy + 8);
    ctx.lineTo(cx - 12, cy + 14);
    ctx.lineTo(cx - 6, cy + 9);
    ctx.lineTo(cx, cy + 15);
    ctx.lineTo(cx + 6, cy + 9);
    ctx.lineTo(cx + 12, cy + 14);
    ctx.lineTo(cx + 24, cy + 8);
    ctx.lineTo(cx, cy + 24);
    ctx.closePath();
    ctx.fill();
  };
  const map = canvasTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#d4600f';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 12; i++) {
      const x = (i / 12) * w;
      const grad = ctx.createLinearGradient(x, 0, x + w / 12, 0);
      grad.addColorStop(0, 'rgba(90,30,0,0.45)');
      grad.addColorStop(0.5, 'rgba(255,150,40,0.15)');
      grad.addColorStop(1, 'rgba(90,30,0,0.45)');
      ctx.fillStyle = grad;
      ctx.fillRect(x, 0, w / 12, h);
    }
    ctx.fillStyle = '#2a0d00';
    face(ctx, w, h);
  }, { wrap: false });
  const glow = canvasTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffd36b';
    face(ctx, w, h);
  }, { wrap: false });
  return { map, glow };
}

export function nightSky() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    const rand = seeded(17);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#05081a');
    grad.addColorStop(1, '#1a2448');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.3 + rand() * 0.7})`;
      ctx.fillRect(rand() * w, rand() * h * 0.7, 1.5, 1.5);
    }
    // moon with a halo
    const halo = ctx.createRadialGradient(170, 70, 10, 170, 70, 70);
    halo.addColorStop(0, 'rgba(255,245,210,0.5)');
    halo.addColorStop(1, 'rgba(255,245,210,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff4d0';
    ctx.beginPath();
    ctx.arc(170, 70, 24, 0, Math.PI * 2);
    ctx.fill();
    // bare tree silhouette
    ctx.strokeStyle = '#020309';
    ctx.lineCap = 'round';
    const branch = (x, y, len, ang, width) => {
      if (len < 6) return;
      const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
      ctx.lineWidth = width;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
      branch(x2, y2, len * 0.72, ang - 0.4 - rand() * 0.3, width * 0.7);
      branch(x2, y2, len * 0.68, ang + 0.35 + rand() * 0.3, width * 0.7);
    };
    branch(60, h, 70, -Math.PI / 2 - 0.1, 10);
    ctx.fillStyle = '#020309';
    ctx.fillRect(0, h - 14, w, 14);
  }, { wrap: false });
}

// creepy portrait + a glow map for its eyes
export function portrait() {
  const figure = (ctx, w, h) => {
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.38, w * 0.17, h * 0.17, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(w * 0.15, h);
    ctx.quadraticCurveTo(w * 0.2, h * 0.58, w / 2, h * 0.56);
    ctx.quadraticCurveTo(w * 0.8, h * 0.58, w * 0.85, h);
    ctx.fill();
  };
  const eyes = (ctx, w, h) => {
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(w / 2 + s * w * 0.065, h * 0.37, w * 0.022, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  const map = canvasTexture(128, 160, (ctx, w, h) => {
    const grad = ctx.createRadialGradient(w / 2, h * 0.4, 5, w / 2, h * 0.4, w);
    grad.addColorStop(0, '#4a3a2a');
    grad.addColorStop(1, '#120c08');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#0a0705';
    figure(ctx, w, h);
    ctx.fillStyle = '#300';
    eyes(ctx, w, h);
  }, { wrap: false });
  const glow = canvasTexture(128, 160, (ctx, w, h) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ff2a1a';
    eyes(ctx, w, h);
  }, { wrap: false });
  return { map, glow };
}

// soft round dot used for spell particles
export function sparkle() {
  return canvasTexture(64, 64, (ctx, w, h) => {
    const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.8)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }, { wrap: false });
}
