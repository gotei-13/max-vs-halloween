import * as THREE from '../vendor/three.module.js';
import { sparkle } from './textures.js';

// The pentagram in the middle of the room. Step into it while it is charged
// and a wall of light rises: for 10 seconds ghosts can't get through. Then it needs
// time to recharge before it protects again.

export const SHIELD_TIME = 10;
export const RECHARGE_TIME = 20;
const CIRCLE_RADIUS = 0.9;   // the pentagram on the floor
const DOME_RADIUS = 1.6;     // ghosts are held back at this distance from the middle
const WALL_HEIGHT = 2.6;

const MOTES = 90;

// soft light fading upward, wrapped around the barrier
function curtainTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const ctx = c.getContext('2d');
  const fade = ctx.createLinearGradient(0, 0, 0, c.height);
  fade.addColorStop(0, 'rgba(255,255,255,0)');
  fade.addColorStop(0.6, 'rgba(255,255,255,0.35)');
  fade.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, c.width, c.height);
  return new THREE.CanvasTexture(c);
}

export class Shield {
  constructor(scene) {
    this.center = new THREE.Vector3(0, 0, 0);
    this.state = 'ready';    // ready -> active -> charging -> ready
    this.timer = 0;
    this.level = 0;          // dome rise/fade 0..1
    this.time = 0;

    // a curtain of light around the pentagram, and a bright ring where it meets the floor
    this.skinMat = new THREE.MeshBasicMaterial({
      map: curtainTexture(), color: 0x66ffd9, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.gridMat = new THREE.MeshBasicMaterial({
      color: 0xb69cff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(DOME_RADIUS, DOME_RADIUS, WALL_HEIGHT, 48, 1, true), this.skinMat);
    wall.position.y = WALL_HEIGHT / 2;
    const ring = new THREE.Mesh(new THREE.RingGeometry(DOME_RADIUS - 0.04, DOME_RADIUS + 0.04, 64), this.gridMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    // sparkles drifting up around the edge, like embers from a magic fire
    this.motePos = new Float32Array(MOTES * 3);
    this.moteSpeed = new Float32Array(MOTES);
    for (let i = 0; i < MOTES; i++) this._resetMote(i, Math.random() * WALL_HEIGHT);
    const moteGeo = new THREE.BufferGeometry();
    this.moteAttr = new THREE.BufferAttribute(this.motePos, 3).setUsage(THREE.DynamicDrawUsage);
    moteGeo.setAttribute('position', this.moteAttr);
    this.moteMat = new THREE.PointsMaterial({
      map: sparkle(), color: 0x9fffe6, size: 0.06, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const motes = new THREE.Points(moteGeo, this.moteMat);
    motes.frustumCulled = false;
    this.dome = new THREE.Group();
    this.dome.add(wall, ring, motes);
    this.dome.position.copy(this.center);
    this.dome.visible = false;
    scene.add(this.dome);
  }

  _resetMote(i, y = 0) {
    const a = Math.random() * Math.PI * 2;
    const r = DOME_RADIUS * (0.92 + Math.random() * 0.12);
    this.motePos[i * 3] = Math.cos(a) * r;
    this.motePos[i * 3 + 1] = y;
    this.motePos[i * 3 + 2] = Math.sin(a) * r;
    this.moteSpeed[i] = 0.3 + Math.random() * 0.6;
  }

  get active() {
    return this.state === 'active';
  }

  // 0..1 how far the recharge has come (1 when ready)
  get progress() {
    return this.state === 'charging' ? 1 - this.timer / RECHARGE_TIME : 1;
  }

  get secondsLeft() {
    return Math.ceil(this.timer);
  }

  // short HUD text
  get label() {
    if (this.state === 'active') return `🛡️ ${this.secondsLeft}s`;
    if (this.state === 'charging') return `⏳ ${this.secondsLeft}s`;
    return '🛡️ ready';
  }

  // where ghosts are held back, while the dome is up
  get barrier() {
    return this.active ? { x: this.center.x, z: this.center.z, radius: DOME_RADIUS } : null;
  }

  // is this position standing in the pentagram?
  contains(p) {
    return Math.hypot(p.x - this.center.x, p.z - this.center.z) < CIRCLE_RADIUS;
  }

  reset() {
    this.state = 'ready';
    this.timer = 0;
    this.level = 0;
    this.dome.visible = false;
  }

  // returns 'up' | 'down' | 'ready' | 'tick' (each of the last 3 seconds) | null
  update(dt, player, playing) {
    this.time += dt;
    let event = null;
    if (this.state === 'ready') {
      if (playing && this.contains(player)) {
        this.state = 'active';
        this.timer = SHIELD_TIME;
        event = 'up';
      }
    } else if (this.state === 'active') {
      const before = Math.ceil(this.timer);
      this.timer -= dt;
      if (this.timer <= 0) {
        this.state = 'charging';
        this.timer = RECHARGE_TIME;
        event = 'down';
      } else if (Math.ceil(this.timer) !== before && before <= 3) {
        event = 'tick';
      }
    } else if (this.state === 'charging') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.state = 'ready';
        this.timer = 0;
        event = 'ready';
      }
    }

    // the dome grows up out of the floor, shimmers, and flickers when time runs out
    const goal = this.active ? 1 : 0;
    this.level += (goal - this.level) * Math.min(1, dt * 5);
    this.dome.visible = this.level > 0.01;
    if (this.dome.visible) {
      const ending = this.active && this.timer < 3 && Math.sin(this.time * 30) > 0 ? 0.35 : 1;
      this.dome.scale.set(1, Math.max(0.01, this.level), 1);
      this.skinMat.opacity = this.level * ending * (0.22 + 0.05 * Math.sin(this.time * 2));
      this.gridMat.opacity = this.level * ending * (0.7 + 0.15 * Math.sin(this.time * 3));
      this.moteMat.opacity = this.level * ending;
      for (let i = 0; i < MOTES; i++) {
        this.motePos[i * 3 + 1] += this.moteSpeed[i] * dt;
        if (this.motePos[i * 3 + 1] > WALL_HEIGHT * 0.8) this._resetMote(i);
      }
      this.moteAttr.needsUpdate = true;
    }
    return event;
  }
}
