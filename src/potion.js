import * as THREE from '../vendor/three.module.js';
import { sparkle } from './textures.js';

// Now and then a potion of visibility appears somewhere in the room, floating
// and bubbling (you can find it by ear). Walk over it to drink it: for 15
// seconds you can see every ghost, even through walls, floor and ceiling.

export const VISION_TIME = 15;
const FIRST_DELAY = [25, 35];   // seconds before the first potion of a game
const NEXT_DELAY = [30, 50];    // seconds between potions
const LIFETIME = 25;            // how long a potion waits to be picked up
const PICKUP_RADIUS = 0.75;

const rand = (a, b) => a + Math.random() * (b - a);

export class Potion {
  constructor(scene, audio) {
    this.audio = audio;
    this.group = new THREE.Group();

    const glass = new THREE.MeshLambertMaterial({ color: 0xaaffdd, transparent: true, opacity: 0.35, depthWrite: false });
    this.liquidMat = new THREE.MeshBasicMaterial({ color: 0x3dff9a });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), glass);
    const liquid = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.65), this.liquidMat);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.08, 10), glass);
    neck.position.y = 0.11;
    const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.023, 0.04, 10), new THREE.MeshLambertMaterial({ color: 0x7a5230, emissive: 0x1a1006 }));
    cork.position.y = 0.165;
    this.haloMat = new THREE.SpriteMaterial({
      map: sparkle(), color: 0x3dff9a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.halo = new THREE.Sprite(this.haloMat);
    this.halo.scale.setScalar(0.7);
    this.halo.position.y = 0.02;
    this.bottle = new THREE.Group();
    this.bottle.add(body, liquid, neck, cork);
    this.group.add(this.bottle, this.halo);
    this.group.visible = false;
    scene.add(this.group);

    this.voice = null;
    this.area = { bounds: { minX: -6, maxX: 6, minZ: -6, maxZ: 6 }, obstacles: [], circle: { x: 0, z: 0 } };
    this.reset();
  }

  // the area of the house the player is in now
  setArea(info) {
    this.area = info;
    this.reset();
  }

  get visionActive() {
    return this.vision > 0;
  }

  get secondsLeft() {
    return Math.ceil(this.vision);
  }

  reset() {
    this.state = 'hidden';   // hidden -> waiting (in the room) -> hidden
    this.timer = rand(...FIRST_DELAY);
    this.vision = 0;
    this.group.visible = false;
    this._silence();
  }

  // returns 'appear' | 'drink' | 'gone' | 'tick' (each of the last 3 seconds of sight) | 'visionEnd' | null
  update(dt, player, playing) {
    let event = null;
    this.time = (this.time || 0) + dt;

    if (this.vision > 0) {
      const before = Math.ceil(this.vision);
      this.vision -= dt;
      if (this.vision <= 0) {
        this.vision = 0;
        event = 'visionEnd';
      } else if (Math.ceil(this.vision) !== before && before <= 3) {
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
        this.bubbleTimer = 0;
        this.audio.potionAppear(this.voice);
        return 'appear';
      }
    } else if (this.state === 'waiting') {
      this.timer -= dt;
      // float, spin, glow; blink in the last 5 seconds
      this.bottle.position.y = Math.sin(this.time * 2) * 0.06;
      this.bottle.rotation.y = this.time * 1.5;
      this.bottle.rotation.z = Math.sin(this.time * 1.3) * 0.15;
      const blink = this.timer < 5 && Math.sin(this.time * 18) > 0;
      this.group.visible = !blink;
      this.haloMat.opacity = 0.45 + 0.25 * Math.sin(this.time * 4);
      this.bubbleTimer -= dt;
      if (this.bubbleTimer <= 0) {
        this.bubbleTimer = 0.25 + Math.random() * 0.35;
        this.audio.bubble(this.voice);
      }

      const p = this.group.position;
      if (Math.hypot(player.x - p.x, player.z - p.z) < PICKUP_RADIUS) {
        this.vision = VISION_TIME;
        this.audio.drink();
        this._hide();
        return 'drink';
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
    const margin = Math.min(1, (b.maxX - b.minX) / 2 - 0.4);   // narrow hallways get a smaller margin
    for (let tries = 0; tries < 30; tries++) {
      const x = rand(b.minX + margin, b.maxX - margin), z = rand(b.minZ + 1, b.maxZ - 1);
      if (Math.hypot(x - circle.x, z - circle.z) < 1.8) continue;
      if (Math.hypot(x - player.x, z - player.z) < 3) continue;
      if (obstacles.some(([x0, x1, z0, z1]) => x > x0 - 0.5 && x < x1 + 0.5 && z > z0 - 0.5 && z < z1 + 0.5)) continue;
      this.group.position.set(x, 0.9, z);
      return true;
    }
    return false;
  }
}
