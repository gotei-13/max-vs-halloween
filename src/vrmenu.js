import * as THREE from '../vendor/three.module.js';

// The start / game-over menu inside the headset: a floating panel in the same
// style as the laptop menu. Point a wand at a button and pull the trigger.

const W = 1024, H = 960;          // canvas pixels
const PANEL_W = 1.5;              // meters
const LEVELS = [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']];
const STYLES = [['realistic', 'Realistic'], ['outline', 'Glow outlines']];

const TITLE_FONT = "'Creepster', system-ui, sans-serif";

// soft glow behind the panel: a blurred rounded rectangle
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 210;
  const ctx = c.getContext('2d');
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 36;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  roundRect(ctx, 40, 40, 176, 130, 24);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

export class VrMenu {
  constructor(scene) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    const height = PANEL_W * (H / W);
    this.panel = new THREE.Mesh(
      new THREE.PlaneGeometry(PANEL_W, height),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false }),
    );
    this.panel.renderOrder = 21;
    this.auraMat = new THREE.MeshBasicMaterial({
      map: glowTexture(), color: 0x7a4cff, transparent: true, opacity: 0.3,
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
    });
    this.aura = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W * 1.45, height * 1.6), this.auraMat);
    this.aura.position.z = -0.01;
    this.aura.renderOrder = 20;
    this.group = new THREE.Group();
    this.group.add(this.aura, this.panel);
    this.group.visible = false;
    scene.add(this.group);

    this.cursor = new THREE.Mesh(
      new THREE.SphereGeometry(0.012, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
    );
    this.cursor.renderOrder = 22;
    this.cursor.visible = false;
    scene.add(this.cursor);

    this.raycaster = new THREE.Raycaster();
    this.buttons = [];
    this.hover = null;
    this.time = 0;
    this.appear = 0;
    this.content = { title: '', subtitle: '', action: 'START' };
    // areas: [{ label, unlocked }] parts of the house to start in; start: the chosen one
    this.selection = { level: 'easy', levelNote: '', style: 'realistic', mixedReality: false, areas: [], start: 0 };
    // redraw once the spooky title font has loaded
    document.fonts?.load(`80px ${TITLE_FONT}`).then(() => { if (this.visible) this._draw(); }).catch(() => {});
  }

  get visible() {
    return this.group.visible;
  }

  // place the panel 2 m in front of the player's head, facing them
  show(content, camera) {
    this.content = content;
    const head = camera.getWorldPosition(new THREE.Vector3());
    const fwd = camera.getWorldDirection(new THREE.Vector3()).setY(0);
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();
    this.group.position.copy(head).addScaledVector(fwd, 2);
    this.group.position.y = THREE.MathUtils.clamp(head.y, 1.2, 1.8);
    this.group.lookAt(head.x, this.group.position.y, head.z);
    this.group.visible = true;
    this.appear = 0;
    this.hover = null;
    this._draw();
  }

  hide() {
    this.group.visible = false;
    this.cursor.visible = false;
  }

  setSelection(selection) {
    Object.assign(this.selection, selection);
    if (this.visible) this._draw();
  }

  // the button id under this controller's ray, or null
  pick(controller) {
    return this._hit(controller)?.id ?? null;
  }

  update(dt, controllers) {
    if (!this.visible) return;
    this.time += dt;
    this.appear = Math.min(1, this.appear + dt / 0.45);
    // pop in with a little overshoot, then float gently
    const t = this.appear;
    const pop = 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);  // ease-out-back
    this.group.scale.setScalar(Math.max(0.01, pop));
    this.panel.position.y = Math.sin(this.time * 1.2) * 0.015;
    this.aura.position.y = this.panel.position.y;
    this.auraMat.opacity = 0.5 + 0.2 * Math.sin(this.time * 2.2);

    // hover highlight and cursor for whichever wand points at the panel
    let hit = null;
    for (const c of controllers) {
      if (!c.userData.source) continue;
      hit = this._hit(c);
      if (hit) break;
    }
    this.cursor.visible = Boolean(hit);
    if (hit) this.cursor.position.copy(hit.point);
    const hover = hit?.id ?? null;
    if (hover !== this.hover) {
      this.hover = hover;
      this._draw();
    }
  }

  _hit(controller) {
    const origin = controller.getWorldPosition(new THREE.Vector3());
    const dir = controller.getWorldDirection(new THREE.Vector3()).negate();  // controllers point down -Z
    this.raycaster.set(origin, dir);
    const hit = this.raycaster.intersectObject(this.panel)[0];
    if (!hit) return null;
    const x = hit.uv.x * W, y = (1 - hit.uv.y) * H;
    const button = this.buttons.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    return { point: hit.point, id: button?.id ?? null };
  }

  _button(id, label, x, y, w, h, { selected = false, big = false, small = false } = {}) {
    const ctx = this.ctx;
    const hovered = this.hover === id;
    this.buttons.push({ id, x, y, w, h });
    if (big) {
      const grad = ctx.createLinearGradient(0, y, 0, y + h);
      grad.addColorStop(0, hovered ? '#ffa04a' : '#ff8a2a');
      grad.addColorStop(1, hovered ? '#e0560a' : '#c04a08');
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = selected ? '#6a4cff' : hovered ? '#2e2160' : '#1b1238';
    }
    ctx.shadowColor = big ? '#ff7a1a' : '#8f7fff';
    ctx.shadowBlur = hovered || selected ? 24 : 0;
    roundRect(ctx, x, y, w, h, 18);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 3;
    ctx.strokeStyle = big ? '#ffd0a0' : selected ? '#d8ccff' : hovered ? '#b8a8ff' : '#4b3d8f';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `${big ? 'bold 52px' : small ? '28px' : '36px'} system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2 + 2);
  }

  _draw() {
    const ctx = this.ctx;
    const { title, subtitle, action } = this.content;
    const sel = this.selection;
    this.buttons = [];
    ctx.clearRect(0, 0, W, H);

    // panel background
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, 'rgba(26, 14, 52, 0.94)');
    bg.addColorStop(1, 'rgba(8, 4, 20, 0.94)');
    ctx.fillStyle = bg;
    roundRect(ctx, 8, 8, W - 16, H - 16, 40);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#5a46b0';
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `86px ${TITLE_FONT}`;
    ctx.fillStyle = '#ff7a1a';
    ctx.shadowColor = '#ff7a1a';
    ctx.shadowBlur = 26;
    ctx.fillText(title, W / 2, 100);
    ctx.shadowBlur = 0;
    ctx.font = '34px system-ui, sans-serif';
    ctx.fillStyle = '#d8d0f0';
    ctx.fillText(subtitle, W / 2, 168);

    const label = (text, y) => {
      ctx.font = 'bold 28px system-ui, sans-serif';
      ctx.fillStyle = '#9d8cff';
      ctx.textAlign = 'left';
      ctx.fillText(text.toUpperCase(), 92, y);
      ctx.textAlign = 'center';
    };

    label('Difficulty', 236);
    LEVELS.forEach(([id, text], i) => {
      this._button(`level:${id}`, text, 92 + i * 287, 262, 266, 78, { selected: sel.level === id });
    });
    ctx.font = '28px system-ui, sans-serif';
    ctx.fillStyle = '#66ffd9';
    ctx.fillText(sel.levelNote, W / 2, 372);

    if (sel.mixedReality) {
      label('Room', 432);
      ctx.font = '32px system-ui, sans-serif';
      ctx.fillStyle = '#d8d0f0';
      ctx.fillText('Your real room (mixed reality)', W / 2, 490);
    } else {
      label('Room', 432);
      STYLES.forEach(([id, text], i) => {
        this._button(`style:${id}`, text, 92 + i * 430, 456, 410, 78, { selected: sel.style === id });
      });
    }

    // where in the house to start: only the parts already reached
    label('Start at', 572);
    const n = sel.areas.length || 1;
    const bw = (840 - (n - 1) * 14) / n;
    sel.areas.forEach((a, i) => {
      const x = 92 + i * (bw + 14);
      if (a.unlocked) {
        this._button(`area:${i}`, a.label, x, 594, bw, 70, { selected: sel.start === i, small: true });
      } else {
        roundRect(ctx, x, 594, bw, 70, 18);
        ctx.fillStyle = 'rgba(27, 18, 56, 0.5)';
        ctx.fill();
        ctx.font = '26px system-ui, sans-serif';
        ctx.fillStyle = '#5a5278';
        ctx.fillText(`🔒 ${a.label}`, x + bw / 2, 631);
      }
    });

    this._button('start', action, W / 2 - 280, 700, 560, 108, { big: true });

    ctx.font = '26px system-ui, sans-serif';
    ctx.fillStyle = '#8a82a8';
    ctx.fillText('Point your wand at a button and pull the trigger', W / 2, 866);
    ctx.fillText('In the game: left stick walks · hold grip to run · right stick turns', W / 2, 900);
    this.texture.needsUpdate = true;
  }
}
