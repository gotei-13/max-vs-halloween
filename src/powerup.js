import * as THREE from '../vendor/three.module.js';
import { sparkle } from './textures.js';

// The fire crystal: now and then a glowing orange crystal appears somewhere in
// the area, crackling like a campfire (you can find it by ear). Walk over it and
// for 30 seconds the wand shoots fireballs: fast, double damage, wider aim.

export const FIRE_TIME = 30;
const FIRST_DELAY = [18, 26];   // seconds into an area before the first crystal
const NEXT_DELAY = [40, 60];    // seconds between crystals
const LIFETIME = 25;            // how long a crystal waits to be picked up
const PICKUP_RADIUS = 0.8;

const rand = (a, b) => a + Math.random() * (b - a);

export class FireCrystal {
  constructor(scene, audio) {
    this.audio = audio;
    this.crystalMat = new THREE.MeshBasicMaterial({ color: 0xff8a20 });
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.11).scale(1, 1.7, 1), this.crystalMat);
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.05).scale(1, 1.7, 1), new THREE.MeshBasicMaterial({ color: 0xfff0b0 }));
    this.haloMat = new THREE.SpriteMaterial({
      map: sparkle(), color: 0xff7a20, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const halo = new THREE.Sprite(this.haloMat);
    halo.scale.setScalar(0.9);
    this.crystal = new THREE.Group();
    this.crystal.add(crystal, core);
    this.group = new THREE.Group();
    this.group.add(this.crystal, halo);
    this.group.visible = false;
    scene.add(this.group);
    this.voice = null;
    this.time = 0;
    this.area = { bounds: { minX: -6, maxX: 6, minZ: -6, maxZ: 6 }, obstacles: [], circle: { x: 0, z: 0 } };
    this.reset();
  }

  get fireActive() {
    return this.fire > 0;
  }

  get secondsLeft() {
    return Math.ceil(this.fire);
  }

  // a new area: the crystal hides again, but the fire wand keeps burning
  setArea(info) {
    this.area = info;
    this.reset(true);
  }

  // fire: keep the fire wand going (between areas the power stays)
  reset(keepFire = false) {
    this.state = 'hidden';
    this.timer = rand(...FIRST_DELAY);
    if (!keepFire) this.fire = 0;
    this.group.visible = false;
    this._silence();
  }

  // make a crystal appear soon (e.g. right before the boss)
  soon(seconds = 2) {
    if (this.state === 'hidden') this.timer = Math.min(this.timer, seconds);
  }

  // returns 'appear' | 'pickup' | 'gone' | 'tick' (last 3 seconds) | 'fireEnd' | null
  update(dt, player, playing) {
    let event = null;
    this.time += dt;
    if (this.fire > 0) {
      const before = Math.ceil(this.fire);
      this.fire -= dt;
      if (this.fire <= 0) {
        this.fire = 0;
        event = 'fireEnd';
      } else if (Math.ceil(this.fire) !== before && before <= 3) {
        event = 'tick';
      }
    }
    if (!playing) return event;

    if (this.state === 'hidden') {
      this.timer -= dt;
      if (this.timer <= 0 && this._place(player)) {
        this.state = 'waiting';
        this.timer = LIFETIME;
        this.group.visible = true;
        this.voice = this.audio.createVoice();
        this.audio.setVoicePosition(this.voice, this.group.position);
        this.crackleTimer = 0;
        this.audio.crystalAppear(this.voice);
        return 'appear';
      }
    } else if (this.state === 'waiting') {
      this.timer -= dt;
      this.crystal.rotation.y = this.time * 2.2;
      this.crystal.position.y = Math.sin(this.time * 2.4) * 0.07;
      const flicker = 0.75 + 0.15 * Math.sin(this.time * 13) + 0.1 * Math.sin(this.time * 31);
      this.haloMat.opacity = 0.6 * flicker;
      this.crystalMat.color.setRGB(1, 0.45 + 0.15 * flicker, 0.1);
      this.group.visible = !(this.timer < 5 && Math.sin(this.time * 18) > 0);
      this.crackleTimer -= dt;
      if (this.crackleTimer <= 0) {
        this.crackleTimer = 0.35 + Math.random() * 0.4;
        this.audio.crackle(this.voice);
      }
      const p = this.group.position;
      if (Math.hypot(player.x - p.x, player.z - p.z) < PICKUP_RADIUS) {
        this.fire = FIRE_TIME;
        this.audio.firePickup();
        this._hide();
        return 'pickup';
      }
      if (this.timer <= 0) {
        this.audio.poof(this.voice);
        this._hide();
        return 'gone';
      }
    }
    return event;
  }

  _hide() {
    this.state = 'hidden';
    this.timer = rand(...NEXT_DELAY);
    this.group.visible = false;
    this._silence();
  }

  _silence() {
    if (this.voice) this.audio.releaseVoice(this.voice);
    this.voice = null;
  }

  // a free spot: not in furniture, not on the pentagram, not too close to the player
  _place(player) {
    const { bounds: b, obstacles, circle } = this.area;
    const marginX = Math.min(1, (b.maxX - b.minX) / 2 - 0.5);
    for (let tries = 0; tries < 30; tries++) {
      const x = rand(b.minX + marginX, b.maxX - marginX), z = rand(b.minZ + 1, b.maxZ - 1);
      if (Math.hypot(x - circle.x, z - circle.z) < 1.8) continue;
      if (Math.hypot(x - player.x, z - player.z) < 3) continue;
      if (obstacles.some(([x0, x1, z0, z1]) => x > x0 - 0.5 && x < x1 + 0.5 && z > z0 - 0.5 && z < z1 + 0.5)) continue;
      this.group.position.set(x, 1.0, z);
      return true;
    }
    return false;
  }
}
