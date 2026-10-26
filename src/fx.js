import * as THREE from '../vendor/three.module.js';
import { sparkle } from './textures.js';

// Spell visuals: particle sparks, the flying orb with its comet tail, the
// hit burst of embers and magic smoke, and a light that travels with the
// spell so it lights up the room as it flies.

// A pool of glowing points that move, slow down, fall and fade out.
class ParticleLayer {
  constructor(scene, max, size, texture) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.base = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.gravity = new Float32Array(max);
    this.drag = new Float32Array(max);

    this.geometry = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('color', this.colAttr);
    this.geometry.setDrawRange(0, 0);
    const material = new THREE.PointsMaterial({
      size, map: texture, vertexColors: true, transparent: true,
      depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
  }

  spawn(p, v, color, life, gravity = 0, drag = 0) {
    if (this.count >= this.max) return;
    const i = this.count++;
    const i3 = i * 3;
    this.pos[i3] = p.x; this.pos[i3 + 1] = p.y; this.pos[i3 + 2] = p.z;
    this.vel[i3] = v.x; this.vel[i3 + 1] = v.y; this.vel[i3 + 2] = v.z;
    this.base[i3] = color.r; this.base[i3 + 1] = color.g; this.base[i3 + 2] = color.b;
    this.life[i] = this.maxLife[i] = life;
    this.gravity[i] = gravity;
    this.drag[i] = drag;
  }

  update(dt) {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this._moveLastInto(i);
        continue;
      }
      const i3 = i * 3;
      const slow = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] *= slow;
      this.vel[i3 + 1] = this.vel[i3 + 1] * slow - this.gravity[i] * dt;
      this.vel[i3 + 2] *= slow;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      // additive blending: a darker color is a fainter particle
      const k = this.life[i] / this.maxLife[i];
      const fade = k * k;
      this.col[i3] = this.base[i3] * fade;
      this.col[i3 + 1] = this.base[i3 + 1] * fade;
      this.col[i3 + 2] = this.base[i3 + 2] * fade;
      i++;
    }
    this.geometry.setDrawRange(0, this.count);
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }

  clear() {
    this.count = 0;
    this.geometry.setDrawRange(0, 0);
  }

  _moveLastInto(i) {
    const last = --this.count;
    if (i === last) return;
    for (const arr of [this.pos, this.vel, this.base, this.col]) {
      arr[i * 3] = arr[last * 3];
      arr[i * 3 + 1] = arr[last * 3 + 1];
      arr[i * 3 + 2] = arr[last * 3 + 2];
    }
    this.life[i] = this.life[last];
    this.maxLife[i] = this.maxLife[last];
    this.gravity[i] = this.gravity[last];
    this.drag[i] = this.drag[last];
  }
}

const WHITE = new THREE.Color(0xffffff);
const VIOLET = new THREE.Color(0xa47cff);
const CYAN = new THREE.Color(0x66ffd9);
const PINK = new THREE.Color(0xff7ad9);
const HIT_COLORS = [WHITE, VIOLET, CYAN, PINK];
const DEMON_COLORS = [new THREE.Color(0xff3010), new THREE.Color(0xff8a20), new THREE.Color(0xffd060), WHITE];
const SMOKE = new THREE.Color(0x5a4a7a);
// the fire wand's fireballs
const FIRE = [new THREE.Color(0xffe080), new THREE.Color(0xff9a20), new THREE.Color(0xff4a10)];
const FIRE_SMOKE = new THREE.Color(0x4a3020);
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _u = new THREE.Vector3();
const _w = new THREE.Vector3();
const _c = new THREE.Color();

function randomDir(target) {
  // uniform direction on a sphere
  const z = Math.random() * 2 - 1;
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return target.set(Math.cos(a) * r, z, Math.sin(a) * r);
}

export class SpellFx {
  constructor(scene) {
    this.scene = scene;
    const texture = sparkle();
    this.sparks = new ParticleLayer(scene, 1500, 0.05, texture);
    this.glows = new ParticleLayer(scene, 300, 0.24, texture);
    this.coreGeo = new THREE.SphereGeometry(0.05, 12, 8);
    this.coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false });
    this.haloGeo = new THREE.SphereGeometry(0.12, 12, 8);
    this.haloMat = new THREE.MeshBasicMaterial({ color: 0x8a6cff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false });
    this.fireCoreMat = new THREE.MeshBasicMaterial({ color: 0xfff0b0, depthTest: false });
    this.fireHaloMat = new THREE.MeshBasicMaterial({ color: 0xff6a10, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false });
    // always in the scene (changing the number of lights would stall the
    // Quest while shaders recompile); dark when no spell is around
    this.light = new THREE.PointLight(0xb090ff, 0, 7, 2);
    scene.add(this.light);
    this.orbGlow = 0;
    this.flashGlow = 0;
    this.time = 0;
  }

  // fire: a fireball from the fire wand instead of a magic orb
  makeOrb(fire = false) {
    const orb = new THREE.Mesh(this.coreGeo, fire ? this.fireCoreMat : this.coreMat);
    const halo = new THREE.Mesh(this.haloGeo, fire ? this.fireHaloMat : this.haloMat);
    orb.add(halo);
    orb.renderOrder = halo.renderOrder = 10;
    orb.userData.halo = halo;
    orb.userData.fire = fire;
    if (fire) orb.scale.setScalar(1.5);
    this.scene.add(orb);
    return orb;
  }

  removeOrb(orb) {
    this.scene.remove(orb);
  }

  // sparks bursting out of the wand (flames with the fire wand)
  cast(origin, dir, fire = false) {
    for (let i = 0; i < 30; i++) {
      _v.copy(dir).addScaledVector(randomDir(_u), 0.55).normalize().multiplyScalar(1.5 + Math.random() * 3);
      if (fire) _c.copy(FIRE[i % 3]);
      else _c.copy(WHITE).lerp(VIOLET, Math.random());
      this.sparks.spawn(origin, _v, _c, 0.25 + Math.random() * 0.3, 0, 3);
    }
    this.glows.spawn(origin, _v.set(0, 0, 0), fire ? FIRE[1] : VIOLET, 0.25);
    this.light.color.set(fire ? 0xff7a20 : 0xb090ff);
    this.light.position.copy(origin);
    this.flashGlow = Math.max(this.flashGlow, 3);
  }

  // called every frame for each flying orb: comet tail + two spiralling sparkles
  trail(orb, dir) {
    if (orb.userData.fire) {
      this._fireTrail(orb);
      return;
    }
    this.light.color.set(0xb090ff);
    const p = orb.position;
    // two directions at right angles to the flight direction
    _u.set(0, 1, 0).cross(dir);
    if (_u.lengthSq() < 1e-4) _u.set(1, 0, 0);
    _u.normalize();
    _w.copy(dir).cross(_u).normalize();
    for (let k = 0; k < 2; k++) {
      const a = this.time * 22 + k * Math.PI;
      _v.copy(_u).multiplyScalar(Math.cos(a) * 0.09).addScaledVector(_w, Math.sin(a) * 0.09);
      _p.copy(p).add(_v);
      this.sparks.spawn(_p, _v.multiplyScalar(1.5), k ? CYAN : PINK, 0.45, 0, 2);
    }
    for (let k = 0; k < 2; k++) {
      randomDir(_v).multiplyScalar(0.4);
      this.sparks.spawn(p, _v, WHITE, 0.3, 0, 1);
    }
    this.glows.spawn(p, _v.set(0, 0, 0), VIOLET, 0.22);
    orb.userData.halo.scale.setScalar(1 + Math.sin(this.time * 35) * 0.2);
    this.light.position.copy(p);
    this.orbGlow = 2.5 + Math.sin(this.time * 40) * 0.5;
  }

  // a fireball leaves flames and smoke behind it
  _fireTrail(orb) {
    const p = orb.position;
    this.light.color.set(0xff7a20);
    for (let k = 0; k < 4; k++) {
      randomDir(_v).multiplyScalar(0.5).setY(0.4 + Math.random() * 0.6);
      this.sparks.spawn(p, _v, FIRE[k % 3], 0.35 + Math.random() * 0.25, -0.5, 1.5);
    }
    this.glows.spawn(p, _v.set(0, 0.3, 0), FIRE[1], 0.3);
    if (Math.random() < 0.4) this.glows.spawn(p, _v.set(0, 0.4, 0), FIRE_SMOKE, 0.8, -0.1, 0.5);
    orb.userData.halo.scale.setScalar(1 + Math.sin(this.time * 30) * 0.25);
    this.light.position.copy(p);
    this.orbGlow = 3.5 + Math.sin(this.time * 33) * 0.8;
  }

  // the spell hits a ghost: a burst of embers that drift down, and magic
  // smoke rising slowly (red and orange when it is the demon)
  hit(position, demon = false) {
    const colors = demon ? DEMON_COLORS : HIT_COLORS;
    for (let i = 0; i < 110; i++) {
      randomDir(_v).multiplyScalar(0.8 + Math.random() * 3);
      const color = colors[Math.floor(Math.random() * colors.length)];
      this.sparks.spawn(position, _v, color, 0.7 + Math.random() * 0.8, 0.6, 2.2);
    }
    for (let i = 0; i < 16; i++) {
      randomDir(_v).multiplyScalar(0.25).setY(0.3 + Math.random() * 0.4);
      _p.copy(position).addScaledVector(randomDir(_u), 0.2);
      this.glows.spawn(_p, _v, i % 3 ? SMOKE : (demon ? DEMON_COLORS[0] : VIOLET), 1.2 + Math.random() * 0.6, -0.15, 0.6);
    }
    this.light.color.set(demon ? 0xff5020 : 0xb090ff);
    this.light.position.copy(position);
    this.flashGlow = 10;
  }

  // a ghost bumps into the pentagram's dome
  zap(position) {
    for (let i = 0; i < 24; i++) {
      randomDir(_v).multiplyScalar(0.8 + Math.random() * 1.6);
      this.sparks.spawn(position, _v, i % 3 ? CYAN : WHITE, 0.3 + Math.random() * 0.3, 1, 2);
    }
    this.glows.spawn(position, _v.set(0, 0, 0), CYAN, 0.3);
  }

  // a missed spell runs out of power and drops a few sparks
  fizzle(position) {
    for (let i = 0; i < 26; i++) {
      randomDir(_v).multiplyScalar(0.3 + Math.random() * 0.9);
      _c.copy(VIOLET).multiplyScalar(0.6);
      this.sparks.spawn(position, _v, _c, 0.5 + Math.random() * 0.3, 2.5, 1);
    }
    this.glows.spawn(position, _v.set(0, 0, 0), _c, 0.3);
  }

  update(dt, camera) {
    this.time += dt;
    this.sparks.update(dt);
    this.glows.update(dt);

    this.flashGlow = Math.max(0, this.flashGlow - dt * 14);
    this.light.intensity = Math.max(this.orbGlow, this.flashGlow);
    this.orbGlow = 0;  // set again next frame by trail() while an orb flies
  }

  clear() {
    this.sparks.clear();
    this.glows.clear();
    this.orbGlow = this.flashGlow = 0;
    this.light.intensity = 0;
  }
}
