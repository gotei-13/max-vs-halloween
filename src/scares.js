import * as THREE from '../vendor/three.module.js';

// Atmosphere during a game: now and then a creepy grin, a pair of burning
// eyes or an evil witch appears for a moment at the edge of your view (with a
// giggle or a cackle), witches cackle somewhere in the room, and horror sounds
// come from around you: creaks, whispers, knocking inside the walls, distant screams.

const FACES = ['grin', 'eyes', 'smile', 'witch'];
const SOUNDS = ['creak', 'whisper', 'wallKnock', 'distantScream', 'giggle'];

// an evil witch: pointy hat, green face, glowing eyes and a crooked grin
function witchTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 320;
  const ctx = c.getContext('2d');
  // hat with a crooked tip and a wide brim
  ctx.fillStyle = '#0c0614';
  ctx.strokeStyle = '#8a5cff';
  ctx.lineWidth = 4;
  ctx.shadowColor = '#8a5cff';
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.moveTo(190, 120);
  ctx.quadraticCurveTo(250, 40, 300, 6);
  ctx.quadraticCurveTo(290, 50, 330, 120);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(256, 124, 150, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // face
  ctx.shadowColor = '#5aff7a';
  ctx.shadowBlur = 24;
  ctx.fillStyle = 'rgba(70, 150, 70, 0.85)';
  ctx.beginPath();
  ctx.ellipse(256, 210, 74, 92, 0, 0.05 * Math.PI, 0.95 * Math.PI);
  ctx.lineTo(182, 140);
  ctx.lineTo(330, 140);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  // glowing eyes
  for (const x of [226, 286]) {
    const g = ctx.createRadialGradient(x, 175, 1, x, 175, 18);
    g.addColorStop(0, '#fffbd0');
    g.addColorStop(0.4, '#ffe000');
    g.addColorStop(1, 'rgba(255,200,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, 175, 18, 9, x < 256 ? 0.3 : -0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  // hooked nose and crooked grin with two teeth
  ctx.strokeStyle = '#1e4a1e';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(256, 185);
  ctx.quadraticCurveTo(270, 215, 252, 228);
  ctx.stroke();
  ctx.fillStyle = '#120400';
  ctx.beginPath();
  ctx.moveTo(206, 245);
  ctx.quadraticCurveTo(256, 290, 312, 238);
  ctx.quadraticCurveTo(256, 268, 206, 245);
  ctx.fill();
  ctx.fillStyle = '#efe6cf';
  ctx.fillRect(236, 252, 9, 12);
  ctx.fillRect(272, 249, 9, 14);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function faceTexture(kind) {
  if (kind === 'witch') return witchTexture();
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 320;
  const ctx = c.getContext('2d');
  const eyes = () => {
    for (const x of [176, 336]) {
      ctx.save();
      ctx.translate(x, 110);
      ctx.rotate(x < 256 ? 0.25 : -0.25);  // slanted, angry
      const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 46);
      g.addColorStop(0, '#fff6c0');
      g.addColorStop(0.35, '#ffb000');
      g.addColorStop(1, 'rgba(255,40,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, 0, 46, 20, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#200000';
      ctx.beginPath();
      ctx.ellipse(0, 0, 5, 16, 0, 0, Math.PI * 2);  // cat-like pupil
      ctx.fill();
      ctx.restore();
    }
  };
  const mouth = (wide) => {
    const top = 190, w = wide ? 210 : 160;
    ctx.shadowColor = '#ff3a1a';
    ctx.shadowBlur = 20;
    ctx.fillStyle = '#120000';
    ctx.beginPath();
    ctx.moveTo(256 - w, top);
    ctx.quadraticCurveTo(256, top + 70, 256 + w, top);
    ctx.quadraticCurveTo(256, top + 150, 256 - w, top);
    ctx.fill();
    ctx.shadowBlur = 0;
    // jagged teeth top and bottom
    ctx.fillStyle = '#efe6cf';
    const teeth = wide ? 14 : 10;
    for (let i = 0; i < teeth; i++) {
      const t0 = i / teeth, t1 = (i + 1) / teeth;
      const x0 = 256 - w + 2 * w * t0, x1 = 256 - w + 2 * w * t1, xm = (x0 + x1) / 2;
      const yTop = top + 70 * 4 * t0 * (1 - t0) * 0.5;
      const yBot = top + 150 * 4 * t0 * (1 - t0) * 0.5;
      ctx.beginPath();
      ctx.moveTo(x0, yTop); ctx.lineTo(x1, yTop); ctx.lineTo(xm, yTop + 22);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x0, yBot); ctx.lineTo(x1, yBot); ctx.lineTo(xm, yBot - 18);
      ctx.fill();
    }
  };
  if (kind !== 'smile') eyes();
  if (kind !== 'eyes') mouth(kind === 'smile');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const _v = new THREE.Vector3();
const _head = new THREE.Vector3();

export class Scares {
  constructor(scene, audio) {
    this.scene = scene;
    this.audio = audio;
    this.textures = Object.fromEntries(FACES.map((k) => [k, faceTexture(k)]));
    this.geometry = new THREE.PlaneGeometry(0.8, 0.5);
    this.faces = [];
    this.bounds = { minX: -6, maxX: 6, minZ: -6, maxZ: 6 };
    this.reset();
  }

  // the area of the house the player is in now
  setArea(info) {
    this.bounds = info.bounds;
    this.reset();
  }

  reset() {
    this.faceTimer = 14 + Math.random() * 10;
    this.soundTimer = 6 + Math.random() * 6;
    this.cackleTimer = 20 + Math.random() * 15;
    for (const f of this.faces) this._remove(f);
    this.faces = [];
  }

  // intense: true while something extra scary is around (sounds come more often)
  update(dt, camera, playing, intense = false) {
    for (const f of this.faces) {
      f.age += dt;
      // fade in, hold, fade out; the face slowly leans closer
      const t = f.age;
      f.mat.opacity = t < 0.5 ? t / 0.5 : t < 1.6 ? 1 : Math.max(0, 1 - (t - 1.6) / 0.6);
      f.mesh.scale.setScalar(0.9 + t * 0.08);
      if (t > 2.2) this._remove(f);
    }
    this.faces = this.faces.filter((f) => f.age <= 2.2);
    if (!playing) return;

    this.faceTimer -= dt;
    if (this.faceTimer <= 0) {
      this.faceTimer = 15 + Math.random() * 15;
      this._showFace(camera);
    }
    this.soundTimer -= dt * (intense ? 1.8 : 1);
    if (this.soundTimer <= 0) {
      this.soundTimer = 7 + Math.random() * 9;
      this._playSound(camera);
    }
    // an evil witch cackles somewhere in the dark
    this.cackleTimer -= dt;
    if (this.cackleTimer <= 0) {
      this.cackleTimer = 25 + Math.random() * 20;
      this._playSound(camera, 'cackle');
    }
  }

  // a face at the edge of your view, in a dark spot of the room
  _showFace(camera) {
    camera.getWorldPosition(_head);
    camera.getWorldDirection(_v);
    const look = Math.atan2(_v.x, -_v.z);
    const off = (0.45 + Math.random() * 0.5) * (Math.random() < 0.5 ? -1 : 1);  // 25-55° to the side
    const angle = look + off;
    const dir = _v.set(Math.sin(angle), 0, -Math.cos(angle));
    // just in front of the wall in that direction, but not further than 3.5 m
    const toWall = Math.min(
      dir.x ? ((dir.x > 0 ? this.bounds.maxX - 0.35 : this.bounds.minX + 0.35) - _head.x) / dir.x : Infinity,
      dir.z ? ((dir.z > 0 ? this.bounds.maxZ - 0.35 : this.bounds.minZ + 0.35) - _head.z) / dir.z : Infinity,
    );
    const dist = Math.max(0.8, Math.min(4.5, toWall));
    const kind = FACES[Math.floor(Math.random() * FACES.length)];
    const mat = new THREE.MeshBasicMaterial({ map: this.textures[kind], transparent: true, opacity: 0, depthWrite: false });
    const mesh = new THREE.Mesh(this.geometry, mat);
    mesh.position.set(_head.x + dir.x * dist, 1.3 + Math.random() * 1.0, _head.z + dir.z * dist);
    mesh.lookAt(_head);
    mesh.renderOrder = 5;
    this.scene.add(mesh);
    this.faces.push({ mesh, mat, age: 0 });
    this.audio.at(mesh.position, (voice) => (kind === 'witch' ? this.audio.cackle(voice) : this.audio.giggle(voice)));
  }

  _playSound(camera, name = SOUNDS[Math.floor(Math.random() * SOUNDS.length)]) {
    camera.getWorldPosition(_head);
    const angle = Math.random() * Math.PI * 2;
    const dist = 3 + Math.random() * 3;
    const y = name === 'wallKnock' ? 1.2 : name === 'creak' ? 1.0 : 1.6;
    _v.set(_head.x + Math.sin(angle) * dist, y, _head.z - Math.cos(angle) * dist);
    this.audio.at(_v, (voice) => this.audio[name](voice));
  }

  _remove(f) {
    this.scene.remove(f.mesh);
    f.mat.dispose();
  }
}
