import * as THREE from '../vendor/three.module.js';

// Glowing traces the invisible ghosts leave behind, fading out after a few
// seconds. A visual hint for the easier difficulty levels:
//   foot   - footprints on the floor (walkers)
//   wisp   - little glowing puffs in the air (flyers, crawlers once out)
//   ripple - rings spreading on the floor above a ghost under the floor

const LIFETIME = { foot: 2.8, wisp: 1.8, ripple: 1.6 };

const soleGeo = new THREE.CircleGeometry(0.055, 14).scale(1, 1.9, 1).rotateX(-Math.PI / 2);
const toeGeo = new THREE.CircleGeometry(0.04, 12).translate(0, 0.13, 0).rotateX(-Math.PI / 2);
const wispGeo = new THREE.SphereGeometry(0.05, 10, 8);
const rippleGeo = new THREE.RingGeometry(0.14, 0.18, 32).rotateX(-Math.PI / 2);

export class Trail {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.brightness = 0.9;
  }

  // dir: the direction the ghost is moving; color: red for the demon
  add(kind, position, dir, color = 0x66ffd9) {
    if (this.brightness <= 0) return;
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: this.brightness,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    });
    const obj = new THREE.Group();
    if (kind === 'foot') {
      obj.add(new THREE.Mesh(soleGeo, mat), new THREE.Mesh(toeGeo, mat));
      obj.position.set(position.x, 0.015, position.z);
      obj.rotation.y = Math.atan2(-dir.x, -dir.z);  // toes point the way it walks
      obj.scale.setScalar(1.4);
    } else if (kind === 'wisp') {
      obj.add(new THREE.Mesh(wispGeo, mat));
      obj.position.copy(position);
      obj.scale.setScalar(1.4);
    } else {
      obj.add(new THREE.Mesh(rippleGeo, mat));
      obj.position.set(position.x, 0.02, position.z);
    }
    this.scene.add(obj);
    this.items.push({ obj, mat, kind, age: 0, life: LIFETIME[kind] });
  }

  update(dt) {
    for (const it of this.items) {
      it.age += dt;
      const t = Math.min(1, it.age / it.life);
      it.mat.opacity = this.brightness * Math.pow(1 - t, 1.5);
      if (it.kind === 'ripple') it.obj.scale.setScalar(1 + t * 3);
      else if (it.kind === 'wisp') it.obj.position.y += dt * 0.15;
      if (it.age >= it.life) this._remove(it);
    }
    this.items = this.items.filter((it) => it.age < it.life);
  }

  clear() {
    for (const it of this.items) this._remove(it);
    this.items = [];
  }

  _remove(it) {
    this.scene.remove(it.obj);
    it.mat.dispose();
  }
}
