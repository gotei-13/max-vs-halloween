import * as THREE from '../vendor/three.module.js';
import { ROOM_HALF, OBSTACLES } from './room.js';

// Moving the player around the room. The player is a "rig" (a group holding
// the camera and the VR hands): moving the rig moves the player.

const BODY_RADIUS = 0.25;
const UP = new THREE.Vector3(0, 1, 0);
const _head = new THREE.Vector3();
const clamp = THREE.MathUtils.clamp;

// pushes a floor position ({x, z}) back inside the room and out of the furniture
export function resolveCollisions(p, r = BODY_RADIUS) {
  const limit = ROOM_HALF - r - 0.05;
  p.x = clamp(p.x, -limit, limit);
  p.z = clamp(p.z, -limit, limit);
  for (const [x0, x1, z0, z1] of OBSTACLES) {
    const cx = clamp(p.x, x0, x1), cz = clamp(p.z, z0, z1);
    const dx = p.x - cx, dz = p.z - cz;
    const d = Math.hypot(dx, dz);
    if (d >= r) continue;
    if (d > 1e-6) {
      p.x = cx + (dx / d) * r;
      p.z = cz + (dz / d) * r;
    } else {
      // standing inside the box: leave by the nearest side
      const exits = [[x0 - r - p.x, 0], [x1 + r - p.x, 0], [0, z0 - r - p.z], [0, z1 + r - p.z]];
      exits.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
      p.x += exits[0][0];
      p.z += exits[0][1];
    }
  }
  return p;
}

// moves the rig so the head moves by (dx, dz), without going through walls or furniture
export function walk(rig, camera, dx, dz) {
  camera.getWorldPosition(_head);
  const goal = resolveCollisions({ x: _head.x + dx, z: _head.z + dz });
  rig.position.x += goal.x - _head.x;
  rig.position.z += goal.z - _head.z;
  rig.updateMatrixWorld(true);
}

// the directions "ahead" and "to the right" of where the player looks, on the floor
export function floorDirections(camera, forward, right) {
  camera.getWorldDirection(forward).setY(0);
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
  forward.normalize();
  right.set(-forward.z, 0, forward.x);
}

// turns the rig around the player's head (VR snap turn)
export function snapTurn(rig, camera, angle) {
  camera.getWorldPosition(_head);
  rig.position.sub(_head).applyAxisAngle(UP, angle).add(_head);
  rig.rotation.y += angle;
  rig.updateMatrixWorld(true);
}
