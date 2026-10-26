import * as THREE from '../vendor/three.module.js';
import { sparkle } from './textures.js';

// The golden key that appears when an area's ghosts are banished. Walk over it
// to pick it up; it opens the way to the next part of the house.

const PICKUP_RADIUS = 0.75;

export class Key {
  constructor(scene, audio) {
    this.audio = audio;
    const gold = new THREE.MeshBasicMaterial({ color: 0xffd36b });
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.018, 8, 20), gold);
    bow.position.y = 0.16;
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.24, 0.025), gold);
    const bits = [-0.06, -0.1].map((y) => {
      const bit = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.025, 0.025), gold);
      bit.position.set(0.035, y, 0);
      return bit;
    });
    this.key = new THREE.Group();
    this.key.add(bow, shaft, ...bits);
    this.haloMat = new THREE.SpriteMaterial({
      map: sparkle(), color: 0xffd36b, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const halo = new THREE.Sprite(this.haloMat);
    halo.scale.setScalar(0.6);
    this.group = new THREE.Group();
    this.group.add(this.key, halo);
    this.group.visible = false;
    scene.add(this.group);
    this.voice = null;
    this.active = false;
    this.time = 0;
  }

  // show the key at a spot on the floor (it floats at chest height)
  show(x, z) {
    this.group.position.set(x, 1.1, z);
    this.group.visible = true;
    this.active = true;
    this.voice = this.audio.createVoice();
    this.audio.setVoicePosition(this.voice, this.group.position);
    this.audio.keyAppear(this.voice);
    this.chimeTimer = 2;
  }

  hide() {
    this.group.visible = false;
    this.active = false;
    if (this.voice) this.audio.releaseVoice(this.voice);
    this.voice = null;
  }

  // returns 'picked' when the player walks over it
  update(dt, player) {
    if (!this.active) return null;
    this.time += dt;
    this.key.rotation.y = this.time * 2;
    this.key.position.y = Math.sin(this.time * 2) * 0.06;
    this.haloMat.opacity = 0.45 + 0.25 * Math.sin(this.time * 4);
    // a soft chime now and then, so it can be found by ear
    this.chimeTimer -= dt;
    if (this.chimeTimer <= 0) {
      this.chimeTimer = 2.5;
      this.audio.keyChime(this.voice);
    }
    const p = this.group.position;
    if (Math.hypot(player.x - p.x, player.z - p.z) < PICKUP_RADIUS) {
      this.audio.keyPickup();
      this.hide();
      return 'picked';
    }
    return null;
  }
}

// An extra life: a small glowing jack-o'-lantern that appears once in each
// area, halfway through. It chimes so it can be found by ear; walk over it for +1 life.
export class LifePumpkin {
  constructor(scene, audio) {
    this.audio = audio;
    const skin = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 10), new THREE.MeshBasicMaterial({ color: 0xff7a1a }));
    skin.scale.y = 0.8;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.025, 0.07, 6), new THREE.MeshBasicMaterial({ color: 0x3f8a2a }));
    stem.position.y = 0.12;
    // a glowing carved face on the front
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.06, 3), new THREE.MeshBasicMaterial({ color: 0xffe08a }));
    face.position.z = 0.125;
    face.rotation.z = Math.PI / 2;
    this.pumpkin = new THREE.Group();
    this.pumpkin.add(skin, stem, face);
    this.haloMat = new THREE.SpriteMaterial({
      map: sparkle(), color: 0xff9a40, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const halo = new THREE.Sprite(this.haloMat);
    halo.scale.setScalar(0.7);
    this.group = new THREE.Group();
    this.group.add(this.pumpkin, halo);
    this.group.visible = false;
    scene.add(this.group);
    this.voice = null;
    this.active = false;
    this.time = 0;
  }

  show(x, z) {
    this.group.position.set(x, 1.0, z);
    this.group.visible = true;
    this.active = true;
    this.voice = this.audio.createVoice();
    this.audio.setVoicePosition(this.voice, this.group.position);
    this.audio.keyAppear(this.voice);
    this.chimeTimer = 2;
  }

  hide() {
    this.group.visible = false;
    this.active = false;
    if (this.voice) this.audio.releaseVoice(this.voice);
    this.voice = null;
  }

  // returns 'picked' when the player walks over it
  update(dt, player) {
    if (!this.active) return null;
    this.time += dt;
    this.pumpkin.rotation.y = this.time * 1.5;
    this.pumpkin.position.y = Math.sin(this.time * 2) * 0.06;
    this.haloMat.opacity = 0.45 + 0.25 * Math.sin(this.time * 4);
    this.chimeTimer -= dt;
    if (this.chimeTimer <= 0) {
      this.chimeTimer = 2.2;
      this.audio.keyChime(this.voice);
    }
    const p = this.group.position;
    if (Math.hypot(player.x - p.x, player.z - p.z) < 0.75) {
      this.audio.lifePickup();
      this.hide();
      return 'picked';
    }
    return null;
  }
}
