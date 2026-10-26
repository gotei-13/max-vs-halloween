import * as THREE from '../vendor/three.module.js';
import { sparkle } from './textures.js';

// The ghost hunter's magic wand: a carved wooden wand with gold bands and a
// glowing crystal at the tip, with little sparkles circling it.
// The wand points down -Z; its origin is where the hand holds it.

const GRIP = 0.06;     // where along the wand the hand holds it
const LENGTH = 0.315;
const SPARKS = 4;

let shared = null;
function parts() {
  if (shared) return shared;
  // the wand's outline from the butt to the tip: a knob, a wavy grip, then a thin tapering shaft
  const profile = [
    [0, 0], [0.013, 0.004], [0.014, 0.02], [0.011, 0.035], [0.0125, 0.05], [0.011, 0.065],
    [0.0125, 0.08], [0.0105, 0.11], [0.009, 0.13], [0.007, 0.2], [0.005, 0.28], [0.004, 0.31], [0, LENGTH],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const toForward = (geo) => geo.translate(0, -GRIP, 0).rotateX(-Math.PI / 2);  // +Y up the wand -> -Z ahead
  shared = {
    wood: toForward(new THREE.LatheGeometry(profile, 12)),
    band: new THREE.TorusGeometry(0.0125, 0.0025, 6, 16),
    crystal: new THREE.OctahedronGeometry(0.016).scale(1, 1, 2),
    glowTex: sparkle(),
  };
  return shared;
}

// onTop: draw over everything (the laptop wand, so it never sinks into a wall)
export function makeWand({ onTop = false } = {}) {
  const p = parts();
  const wand = new THREE.Group();
  const tipZ = -(LENGTH - GRIP) - 0.012;

  const woodMat = new THREE.MeshLambertMaterial({ color: 0x5a3a22, emissive: 0x1a0e06 });
  const goldMat = new THREE.MeshLambertMaterial({ color: 0xc8a040, emissive: 0x2a1e08 });
  const crystalMat = new THREE.MeshBasicMaterial({ color: 0xc7a8ff });
  const glowMat = new THREE.SpriteMaterial({
    map: p.glowTex, color: 0x9a6cff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false,
  });

  const wood = new THREE.Mesh(p.wood, woodMat);
  // gold bands near the knob and where the grip meets the shaft (a torus rings the Z axis)
  const bands = [0.03, -0.05].map((z) => {
    const band = new THREE.Mesh(p.band, goldMat);
    band.position.z = z;
    return band;
  });
  const crystal = new THREE.Mesh(p.crystal, crystalMat);
  crystal.position.z = tipZ;
  const glow = new THREE.Sprite(glowMat);
  glow.scale.setScalar(0.09);
  glow.position.z = tipZ;

  // sparkles circling the tip
  const sparkPos = new Float32Array(SPARKS * 3);
  const sparkGeo = new THREE.BufferGeometry();
  const sparkAttr = new THREE.BufferAttribute(sparkPos, 3).setUsage(THREE.DynamicDrawUsage);
  sparkGeo.setAttribute('position', sparkAttr);
  const sparkMat = new THREE.PointsMaterial({
    map: p.glowTex, color: 0xe0d0ff, size: 0.02, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  sparks.frustumCulled = false;

  wand.add(wood, ...bands, crystal, glow, sparks);
  if (onTop) {
    [wood, ...bands, crystal, glow, sparks].forEach((o, i) => {
      o.material.depthTest = false;
      o.renderOrder = 50 + i;
    });
  }

  // the fire wand: the crystal burns orange
  wand.userData.setFire = (on) => {
    crystalMat.color.set(on ? 0xffb050 : 0xc7a8ff);
    glowMat.color.set(on ? 0xff6a10 : 0x9a6cff);
  };
  wand.userData.tip = crystal;
  wand.userData.tipZ = tipZ;
  wand.userData.power = 1;
  // power: 0..3, how bright the crystal is (flares when casting)
  wand.userData.update = (time, power = 1) => {
    glow.scale.setScalar(0.06 + 0.05 * power);
    glowMat.opacity = Math.min(1, 0.4 + 0.3 * power);
    crystal.rotation.z = time * 2;
    for (let i = 0; i < SPARKS; i++) {
      const a = time * (2 + i * 0.4) + (i * Math.PI * 2) / SPARKS;
      const r = 0.02 + 0.006 * Math.sin(time * 5 + i);
      sparkPos[i * 3] = Math.cos(a) * r;
      sparkPos[i * 3 + 1] = Math.sin(a) * r;
      sparkPos[i * 3 + 2] = tipZ + 0.01 * Math.sin(time * 3 + i * 2);
    }
    sparkAttr.needsUpdate = true;
  };
  return wand;
}
