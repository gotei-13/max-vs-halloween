import * as THREE from '../vendor/three.module.js';

// Text and lives drawn on canvases, attached to the camera so they work the
// same on the laptop and inside the headset.

function panel(width, height, meters) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(meters, meters * (height / width)), mat);
  mesh.renderOrder = 999;
  return { canvas, ctx: canvas.getContext('2d'), texture, mesh, key: '' };
}

const NUMBER_FONT = "'Creepster', system-ui, sans-serif";

function drawPumpkin(ctx, x, y, r, lit) {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = lit ? 1 : 0.25;
  if (lit) {
    ctx.shadowColor = '#ff8a2a';
    ctx.shadowBlur = 16;
  }
  ctx.fillStyle = lit ? '#ff7a1a' : '#555';
  ctx.beginPath();
  ctx.ellipse(0, 0, r, r * 0.82, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = lit ? '#3a7d2a' : '#444';
  ctx.fillRect(-r * 0.12, -r * 1.1, r * 0.24, r * 0.35);
  if (lit) {
    // the carved face glows like a candle inside
    ctx.fillStyle = '#ffd36b';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * r * 0.45, -r * 0.05);
      ctx.lineTo(s * r * 0.2, -r * 0.05);
      ctx.lineTo(s * r * 0.32, -r * 0.35);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(-r * 0.5, r * 0.25);
    ctx.quadraticCurveTo(0, r * 0.7, r * 0.5, r * 0.25);
    ctx.quadraticCurveTo(0, r * 0.45, -r * 0.5, r * 0.25);
    ctx.fill();
  }
  ctx.restore();
}

// the pentagram: bright when it protects, a filling ring while it recharges
function drawPentagram(ctx, x, y, r, state, progress) {
  ctx.save();
  ctx.translate(x, y);
  const on = state !== 'charging';
  ctx.strokeStyle = state === 'active' ? '#66ffd9' : on ? '#b69cff' : '#5a5278';
  ctx.shadowColor = ctx.strokeStyle;
  ctx.shadowBlur = on ? 14 : 0;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i <= 5; i++) {
    const a = (i * 4 * Math.PI) / 5 - Math.PI / 2;
    ctx.lineTo(Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85);
  }
  ctx.stroke();
  if (!on) {
    ctx.strokeStyle = '#b69cff';
    ctx.shadowColor = '#b69cff';
    ctx.shadowBlur = 10;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 0, r + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.stroke();
  }
  ctx.restore();
}

// a magic eye with a green slit pupil (potion of visibility)
function drawEye(ctx, x, y, r) {
  ctx.save();
  ctx.translate(x, y);
  ctx.shadowColor = '#3dff9a';
  ctx.shadowBlur = 18;
  ctx.fillStyle = '#e9fff3';
  ctx.beginPath();
  ctx.moveTo(-r, 0);
  ctx.quadraticCurveTo(0, -r * 0.95, r, 0);
  ctx.quadraticCurveTo(0, r * 0.95, -r, 0);
  ctx.fill();
  ctx.shadowBlur = 0;
  const iris = ctx.createRadialGradient(0, 0, 1, 0, 0, r * 0.45);
  iris.addColorStop(0, '#b6ffd6');
  iris.addColorStop(1, '#14a050');
  ctx.fillStyle = iris;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#04140a';
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.09, r * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// a little ghost for the score
function drawGhost(ctx, x, y, r) {
  ctx.save();
  ctx.translate(x, y);
  ctx.shadowColor = '#9fffe0';
  ctx.shadowBlur = 16;
  ctx.fillStyle = '#e8fff8';
  ctx.beginPath();
  ctx.arc(0, -r * 0.2, r * 0.7, Math.PI, 0);
  ctx.lineTo(r * 0.7, r * 0.8);
  for (let i = 0; i < 4; i++) {
    const x0 = r * 0.7 - (i + 0.5) * (r * 1.4 / 4);
    ctx.quadraticCurveTo(x0, r * (i % 2 ? 0.95 : 0.5), x0 - r * 0.175, r * 0.8);
  }
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#1a1030';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s * r * 0.25, -r * 0.2, r * 0.11, r * 0.17, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// a flame (the fire wand)
function drawFlame(ctx, x, y, r) {
  ctx.save();
  ctx.translate(x, y);
  ctx.shadowColor = '#ff7a1a';
  ctx.shadowBlur = 18;
  for (const [scale, color] of [[1, '#ff5a10'], [0.68, '#ffa030'], [0.38, '#fff0a0']]) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -r * scale);
    ctx.bezierCurveTo(r * 0.8 * scale, -r * 0.2 * scale, r * 0.7 * scale, r * 0.8 * scale, 0, r * 0.85 * scale);
    ctx.bezierCurveTo(-r * 0.7 * scale, r * 0.8 * scale, -r * 0.8 * scale, -r * 0.2 * scale, 0, -r * scale);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

// the Holy Bell (ready to ring)
function drawBell(ctx, x, y, r) {
  ctx.save();
  ctx.translate(x, y);
  ctx.shadowColor = '#ffe9a0';
  ctx.shadowBlur = 18;
  ctx.fillStyle = '#ffd36b';
  ctx.beginPath();
  ctx.moveTo(-r * 0.15, -r * 0.85);
  ctx.quadraticCurveTo(-r * 0.6, -r * 0.8, -r * 0.62, -r * 0.1);
  ctx.quadraticCurveTo(-r * 0.66, r * 0.45, -r * 0.95, r * 0.6);
  ctx.lineTo(r * 0.95, r * 0.6);
  ctx.quadraticCurveTo(r * 0.66, r * 0.45, r * 0.62, -r * 0.1);
  ctx.quadraticCurveTo(r * 0.6, -r * 0.8, r * 0.15, -r * 0.85);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#a08040';
  ctx.beginPath();
  ctx.arc(0, r * 0.75, r * 0.16, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// soft dark (or red) edges around the view: a ring that fades to clear in the middle
function vignetteTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 40, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

export class Hud {
  constructor(camera) {
    this.root = new THREE.Group();
    camera.add(this.root);

    this.status = panel(800, 128, 0.66);
    this.status.mesh.position.set(0, -0.36, -1.3);
    this.root.add(this.status.mesh);

    this.message = panel(1024, 512, 1.1);
    this.message.mesh.position.set(0, 0.08, -1.6);
    this.root.add(this.message.mesh);

    this.flashMat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
    this.flashMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.flashMat);
    this.flashMesh.position.z = -0.3;
    this.flashMesh.renderOrder = 1000;
    this.flashMesh.visible = false;
    this.root.add(this.flashMesh);

    // edges of the view: black while running (comfort in VR), pulsing red when danger is close
    this.vignetteMat = new THREE.MeshBasicMaterial({ map: vignetteTexture(), color: 0x000000, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
    this.vignette = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), this.vignetteMat);
    this.vignette.position.z = -0.25;
    this.vignette.renderOrder = 998;
    this.vignette.visible = false;
    this.root.add(this.vignette);
    this.run = 0;
    this.danger = 0;
    this.time = 0;

    // black fade between the areas of the house (in front of everything else)
    this.fadeMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
    this.fadeMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.fadeMat);
    this.fadeMesh.position.z = -0.12;
    this.fadeMesh.renderOrder = 1001;
    this.fadeMesh.visible = false;
    this.root.add(this.fadeMesh);

    this.crosshair = new THREE.Mesh(
      new THREE.RingGeometry(0.006, 0.01, 24),
      new THREE.MeshBasicMaterial({ color: 0xb69cff, transparent: true, opacity: 0.7, depthTest: false, depthWrite: false }),
    );
    this.crosshair.position.z = -1;
    this.crosshair.renderOrder = 999;
    this.root.add(this.crosshair);

    this.toastTime = 0;
    this.title = '';
    this.sub = '';
    // redraw the status once the spooky number font has loaded
    document.fonts?.load(`48px ${NUMBER_FONT}`).then(() => { this.status.key = ''; }).catch(() => {});
  }

  // lives as pumpkins, the pentagram's state, the potion's sight, and the score.
  // shield: { state, seconds, progress } or null; vision: seconds of potion sight left (0 = none)
  // goal: { done, need } while an area's ghosts are still to be banished (shown instead of the score)
  // fire: seconds of the fire wand left; stamina: 0..1 for running (bar shown when not full)
  // bell: the Holy Bell is ready to ring
  setStatus({ lives, maxLives, score, shield = null, vision = 0, goal = null, fire = 0, stamina = 1, bell = false }) {
    const p = this.status;
    const ring = shield?.state === 'charging' ? Math.floor(shield.progress * 20) : 0;
    const bar = Math.round(stamina * 20);
    const key = `${lives}/${maxLives}/${score}/${shield?.state}/${shield?.seconds}/${ring}/${vision}/${goal?.done}/${goal?.need}/${fire}/${bar}/${bell}`;
    if (p.key === key) return;
    p.key = key;
    const { ctx, canvas } = p;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    // up to 6 pumpkins: smaller and closer together when there are more than 3
    const step = maxLives > 3 ? 230 / maxLives : 78, size = maxLives > 3 ? Math.min(24, step * 0.45) : 30;
    for (let i = 0; i < maxLives; i++) drawPumpkin(ctx, 35 + size * 0.3 + i * step, 60, size, i < lives);
    // stamina bar under the pumpkins
    if (stamina < 0.995) {
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(20, 104, 210, 10);
      ctx.fillStyle = stamina < 0.3 ? '#ff5a3a' : '#ffd36b';
      ctx.fillRect(20, 104, 210 * stamina, 10);
    }

    if (shield) {
      drawPentagram(ctx, 300, 64, 28, shield.state, shield.progress);
      ctx.font = `48px ${NUMBER_FONT}`;
      ctx.fillStyle = shield.state === 'active' ? '#66ffd9' : shield.state === 'ready' ? '#b69cff' : '#6a6290';
      if (shield.state !== 'charging') ctx.fillText(shield.state === 'active' ? `${shield.seconds}` : 'ok', 338, 68);
    }
    if (vision > 0) {
      drawEye(ctx, 412, 64, 26);
      ctx.font = `44px ${NUMBER_FONT}`;
      ctx.fillStyle = '#3dff9a';
      ctx.fillText(`${vision}`, 444, 68);
    }
    if (fire > 0) {
      drawFlame(ctx, 512, 62, 30);
      ctx.font = `44px ${NUMBER_FONT}`;
      ctx.fillStyle = '#ffa030';
      ctx.fillText(`${fire}`, 536, 68);
    }
    if (bell) {
      const pulse = 0.75 + 0.25 * Math.sin(performance.now() / 300);
      ctx.globalAlpha = pulse;
      drawBell(ctx, 612, 60, 30);
      ctx.globalAlpha = 1;
    }
    drawGhost(ctx, 662, 62, 30);
    ctx.font = `${goal ? 46 : 56}px ${NUMBER_FONT}`;
    ctx.fillStyle = goal ? '#ffd36b' : '#e8fff8';
    ctx.fillText(goal ? `${goal.done}/${goal.need}` : `${score}`, 698, 70);
    p.texture.needsUpdate = true;
  }

  setMessage(title = '', sub = '') {
    this.toastTime = 0;
    this._drawMessage(title, sub);
  }

  // short text that disappears on its own
  toast(sub, seconds = 1.6) {
    this._drawMessage('', sub);
    this.toastTime = seconds;
  }

  flash(color = 0xff0000, strength = 0.65) {
    this.flashMat.color.set(color);
    this.flashMat.opacity = strength;
  }

  // a big title for a moment (e.g. when entering a new part of the house)
  announce(title, sub, seconds = 4) {
    this._drawMessage(title, sub);
    this.toastTime = seconds;
  }

  // run: 0..1 darkens the view edges while running; danger: 0..1 pulses them red
  setEdges(run, danger) {
    this.run = run;
    this.danger = danger;
  }

  // 0 = clear, 1 = black
  setFade(k) {
    this.fadeMat.opacity = k;
    this.fadeMesh.visible = k > 0.001;
  }

  setVisible(visible) {
    this.root.visible = visible;
  }

  setCrosshair(visible) {
    this.crosshair.visible = visible;
  }

  update(dt) {
    this.time += dt;
    const beat = Math.pow(Math.max(0, Math.sin(this.time * (5 + this.danger * 5))), 6);
    const red = this.danger * (0.25 + 0.45 * beat);
    const dark = this.run * 0.75;
    this.vignetteMat.opacity = Math.min(0.9, Math.max(red, dark));
    this.vignetteMat.color.setRGB(red > dark ? 0.6 : 0, 0, 0);
    this.vignette.visible = this.vignetteMat.opacity > 0.01;
    if (this.flashMat.opacity > 0) this.flashMat.opacity = Math.max(0, this.flashMat.opacity - dt * 1.2);
    this.flashMesh.visible = this.flashMat.opacity > 0;
    if (this.toastTime > 0) {
      this.toastTime -= dt;
      if (this.toastTime <= 0) this._drawMessage('', '');
    }
  }

  _drawMessage(title, sub) {
    const p = this.message;
    const key = `${title}|${sub}`;
    if (p.key === key) return;
    p.key = key;
    p.mesh.visible = Boolean(title || sub);
    if (!p.mesh.visible) return;

    const { ctx, canvas } = p;
    const lines = sub ? sub.split('\n') : [];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const titleH = title ? 110 : 0;
    const boxH = titleH + lines.length * 58 + 60;
    const top = (canvas.height - boxH) / 2;
    ctx.fillStyle = 'rgba(12, 6, 30, 0.72)';
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(40, top, canvas.width - 80, boxH, 28);
      ctx.fill();
    } else {
      ctx.fillRect(40, top, canvas.width - 80, boxH);
    }

    let y = top + 30;
    if (title) {
      ctx.font = 'bold 84px system-ui, sans-serif';
      ctx.fillStyle = '#ff7a1a';
      ctx.shadowColor = '#ff7a1a';
      ctx.shadowBlur = 20;
      ctx.fillText(title, canvas.width / 2, y + titleH / 2);
      ctx.shadowBlur = 0;
      y += titleH;
    }
    ctx.fillStyle = '#e8e0ff';
    for (const line of lines) {
      // shrink long lines so they fit inside the box
      ctx.font = '44px system-ui, sans-serif';
      const room = canvas.width - 130;
      const width = ctx.measureText(line).width;
      if (width > room) ctx.font = `${Math.floor(44 * room / width)}px system-ui, sans-serif`;
      ctx.fillText(line, canvas.width / 2, y + 29);
      y += 58;
    }
    p.texture.needsUpdate = true;
  }
}
