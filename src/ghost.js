import * as THREE from '../vendor/three.module.js';

// Three kinds of ghost, each with its own sound so you can tell where to look:
//   walker  - walks along the floor: footsteps
//   flyer   - swoops down through the ceiling: whooshes and moans
//   crawler - rises up through the floor: knocking from below, then scratching
// and a rarer, scarier one:
//   demon   - a red horned creature stomping along the floor and growling;
//             it takes 3 hits to banish and 2 lives when it catches you

export const GHOST_TYPES = ['walker', 'flyer', 'crawler'];

const WALK_RADIUS = 7.5;   // walkers start far away, often outside the room, and walk through the wall
const FLY_DISTANCE = 7;    // flyers/crawlers start this far from your head
const BODY_Y = 1.1;        // ghost's middle, above the bottom of its sheet
const CATCH_RADIUS = 0.7;
const UP = new THREE.Vector3(0, 1, 0);
const _to = new THREE.Vector3();
const _side = new THREE.Vector3();
const _target = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const GLITCH_TIME = 0.45;
const GLITCH_COLORS = [0x66ffd9, 0xff3ad0, 0xffffff, 0xff2a1a, 0x7a5cff].map((c) => new THREE.Color(c));

let shared = null;
function geometry() {
  if (!shared) {
    const profile = [[0, 1.75], [0.2, 1.71], [0.31, 1.58], [0.36, 1.38], [0.37, 1.1], [0.4, 0.75], [0.44, 0.4], [0.48, 0.12]]
      .map(([x, y]) => new THREE.Vector2(x, y));
    const body = new THREE.LatheGeometry(profile, 16);
    shared = {
      body,
      eye: new THREE.SphereGeometry(0.045, 8, 6),
      horn: new THREE.ConeGeometry(0.05, 0.24, 8),
    };
  }
  return shared;
}

// A ghost moves toward the player. It is invisible: only its sounds
// (and its breathing when close) tell the player where it is.
export class Ghost {
  // angle: direction around you (0 = straight ahead of the room's door wall)
  // elevation: radians above (+) or below (-) your head, for flyers/crawlers
  constructor(scene, audio, { type = 'walker', angle, elevation = 0, speed, pitch, head }) {
    this.scene = scene;
    this.audio = audio;
    this.type = type;
    this.speed = speed;
    this.pitch = pitch;
    this.state = 'hunting';  // hunting -> dying | scare -> gone
    this.doomed = false;     // a spell is on its way to it
    this.onFloor = type === 'walker' || type === 'demon';
    this.damage = type === 'demon' ? 2 : 1;
    this.hp = type === 'demon' ? 3 : 1;   // spell hits needed to banish it
    this.hurtGlow = 0;
    this.glitchTime = 0;      // > 0 while the ghost glitches into view
    this.glitchTimer = -2;    // seconds until the next glitch (set by the game on its first frame)
    this.catchRadius = type === 'demon' ? 0.8 : CATCH_RADIUS;
    this.baseScale = type === 'demon' ? 1.2 : 1;
    if (this.onFloor) {
      this.pos = new THREE.Vector3(head.x + Math.sin(angle) * WALK_RADIUS, BODY_Y, head.z - Math.cos(angle) * WALK_RADIUS);
    } else {
      const flat = Math.cos(elevation);
      this.pos = new THREE.Vector3(Math.sin(angle) * flat, Math.sin(elevation), -Math.cos(angle) * flat)
        .multiplyScalar(FLY_DISTANCE)
        .add(head);
    }
    this.time = Math.random() * 10;
    this.wobble = 0.35 + Math.random() * 0.35;
    this.soundTimer = 0.3;
    this.stepSide = 1;
    this.breathTimer = 0;
    this.moanTimer = 0.8 + Math.random();
    this.growlTimer = 0.6;
    this.blockCooldown = 0;
    this.justBlocked = false;
    this.fxTime = 0;

    const g = geometry();
    // drawn on top of walls/floor so a ghost is seen even when it is still behind them
    const demon = type === 'demon';
    this.bodyMat = new THREE.MeshBasicMaterial({ color: demon ? 0xd01810 : 0xb8fff0, transparent: true, opacity: 0, depthWrite: false, depthTest: false });
    // the demon's eyes burn; a ghost's eyes are dark holes
    this.eyeMat = new THREE.MeshBasicMaterial({ color: demon ? 0xffd040 : 0x000000, transparent: true, opacity: 0, depthTest: false });
    this.group = new THREE.Group();
    const body = new THREE.Mesh(g.body, this.bodyMat);
    body.renderOrder = 10;
    this.group.add(body);
    if (demon) {
      for (const s of [-1, 1]) {
        const horn = new THREE.Mesh(g.horn, this.bodyMat);
        horn.renderOrder = 10;
        horn.position.set(s * 0.17, 1.74, 0.04);
        horn.rotation.z = -s * 0.45;
        this.group.add(horn);
      }
    }
    this.group.scale.setScalar(this.baseScale);
    this.baseColor = this.bodyMat.color.clone();
    for (const x of [-0.11, 0.11]) {
      const eye = new THREE.Mesh(g.eye, this.eyeMat);
      eye.renderOrder = 11;
      eye.position.set(x, 1.45, 0.33);
      eye.scale.set(1, 1.4, 0.5);
      this.group.add(eye);
    }
    this.group.visible = false;
    scene.add(this.group);

    this.feet = audio.createVoice();
    this.body = audio.createVoice();
    _side.set(1, 0, 0);
    this._syncAudio();
  }

  get alive() {
    return this.state === 'hunting';
  }

  chestPosition(target) {
    return target.copy(this.pos);
  }

  // points from the bottom of the sheet up to the head, for aiming spells
  bodyPoints() {
    return [-0.85, -0.35, 0.15, 0.5].map((dy) => this.pos.clone().setY(this.pos.y + dy));
  }

  // returns an event object ('step', 'caught', 'gone') or null.
  // barrier: { x, z, radius } the ghost can't enter (the pentagram's dome), or null
  // revealed: the player drank a potion of visibility, so the ghost shows
  update(dt, player, barrier = null, revealed = false) {
    this.time += dt;
    this.revealed = revealed;
    if (this.state === 'hunting') return this._hunt(dt, player, barrier);

    this.fxTime += dt;
    if (this.state === 'dying') {
      const t = this.fxTime;
      this._setOpacity(t < 0.12 ? 1 : Math.max(0, 1 - (t - 0.12) / 0.9));
      this.group.position.y += dt * 0.8;
      this.group.rotation.y += dt * 6;
      this.group.scale.setScalar(this.baseScale * (1 + t * 0.6));
      if (t > 1.05) return this._finish();
    } else if (this.state === 'scare') {
      const t = this.fxTime;
      this._setOpacity(t < 0.45 ? 1 : Math.max(0, 1 - (t - 0.45) / 0.3));
      if (t > 0.8) return this._finish();
    }
    return null;
  }

  // hit but not banished yet (the demon): it flashes into view, roars and is thrown back
  hurt(player) {
    this.hp--;
    this.doomed = false;
    this.hurtGlow = 1;
    _to.set(this.pos.x - player.x, 0, this.pos.z - player.z).normalize();
    this.pos.addScaledVector(_to, 1.8);
    this.audio.roar(this.body);
  }

  // for a split second the ghost stutters into view with static: a clue where it is
  glitch() {
    if (this.state !== 'hunting') return;
    this.glitchTime = GLITCH_TIME;
    this.audio.radioStatic(this.body);
  }

  banish() {
    this.state = 'dying';
    this.fxTime = 0;
    this.audio.banish(this.body);
  }

  // pop up right in front of the player's face
  jumpScare(camera) {
    this.state = 'scare';
    this.fxTime = 0;
    const head = camera.getWorldPosition(_tmp);
    const fwd = camera.getWorldDirection(_to).setY(0).normalize();
    this.group.position.copy(head).addScaledVector(fwd, 0.55);
    this.group.position.y = head.y - 1.45;
    this.group.lookAt(head.x, this.group.position.y, head.z);
    this.group.scale.setScalar(this.baseScale);
  }

  // fade away (game over)
  vanish() {
    this.state = 'dying';
    this.fxTime = 0.12;
  }

  _hunt(dt, player, barrier) {
    // walkers stay on the floor; flyers and crawlers go for your chest
    if (this.onFloor) _target.set(player.x, BODY_Y, player.z);
    else _target.set(player.x, THREE.MathUtils.clamp(player.y - 0.45, 0.8, 1.8), player.z);
    _to.subVectors(_target, this.pos);
    const dist = _to.length();
    if (this.doomed) return null;  // frozen while the spell flies in
    if (dist < this.catchRadius) return { type: 'caught', dist };

    _to.divideScalar(dist);
    _side.crossVectors(_to, UP);
    if (_side.lengthSq() < 1e-4) _side.set(1, 0, 0);
    _side.normalize();
    // sway side to side a bit, less when close, so the sound source moves
    const sway = Math.sin(this.time * 0.9) * this.wobble * Math.min(1, dist / 3);
    const step = this.speed * dt;
    this.pos.addScaledVector(_to, step).addScaledVector(_side, sway * step);
    if (this.onFloor) this.pos.y = BODY_Y;

    // held back by the dome: slide along its edge; justBlocked tells the game to spark
    this.blockCooldown -= dt;
    if (barrier) {
      const bx = this.pos.x - barrier.x, bz = this.pos.z - barrier.z;
      const bd = Math.hypot(bx, bz) || 0.001;
      if (bd < barrier.radius) {
        this.pos.x = barrier.x + (bx / bd) * barrier.radius;
        this.pos.z = barrier.z + (bz / bd) * barrier.radius;
        if (this.blockCooldown <= 0) {
          this.blockCooldown = 0.7;
          this.justBlocked = true;
        }
      }
    }

    let event = null;
    this.soundTimer -= dt;
    if (this.soundTimer <= 0) event = this._makeSound(dist);

    this.breathTimer -= dt;
    if (dist < 2.4 && this.breathTimer <= 0) {
      this.breathTimer = 1.7;
      this.audio.breath(this.body, this.pitch);
    }
    if (this.type === 'demon') {
      this.growlTimer -= dt;
      if (this.growlTimer <= 0) {
        this.growlTimer = 2 + Math.random() * 1.5;
        this.audio.growl(this.body, this.pitch);
      }
    }
    if (this.type === 'flyer') {
      this.moanTimer -= dt;
      if (this.moanTimer <= 0) {
        this.moanTimer = 2.4;
        this.audio.moan(this.body, this.pitch);
      }
    }

    // a faint shimmer only when it is almost on top of you (the demon glows red from further away)
    const seen = this.type === 'demon' ? 3.2 : 1.8;
    this.hurtGlow = Math.max(0, this.hurtGlow - dt * 1.5);
    const shimmer = dist < seen ? (1 - dist / seen) * (this.type === 'demon' ? 0.3 : 0.18) : 0;
    let glitch = 0;
    if (this.glitchTime > 0) {
      this.glitchTime -= dt;
      glitch = Math.random() < 0.65 ? 0.35 + Math.random() * 0.55 : 0;  // flickering on and off
    }
    this._setOpacity(Math.max(this.hurtGlow, this.revealed ? 0.7 : 0, shimmer, glitch));
    this.group.position.set(this.pos.x, this.pos.y - BODY_Y + Math.sin(this.time * 2) * 0.04, this.pos.z);
    this.group.lookAt(player.x, this.group.position.y, player.z);
    if (this.glitchTime > 0) {
      // jitter, stretch and color-flash like a broken video
      this.group.position.x += (Math.random() - 0.5) * 0.25;
      this.group.position.y += (Math.random() - 0.5) * 0.12;
      this.group.position.z += (Math.random() - 0.5) * 0.25;
      this.group.scale.set(this.baseScale * (0.75 + Math.random() * 0.6), this.baseScale * (0.9 + Math.random() * 0.2), this.baseScale);
      this.bodyMat.color.copy(GLITCH_COLORS[Math.floor(Math.random() * GLITCH_COLORS.length)]);
      this.glitched = true;
    } else if (this.glitched) {
      this.glitched = false;
      this.group.scale.setScalar(this.baseScale);
      this.bodyMat.color.copy(this.baseColor);
    }
    this._syncAudio();
    return event;
  }

  // the ghost's regular sound; returns a 'step' event saying what trace it leaves
  _makeSound(dist) {
    const event = { type: 'step', dist, dir: _to.clone() };
    if (this.onFloor) {
      const demon = this.type === 'demon';
      this.soundTimer += THREE.MathUtils.clamp((demon ? 0.5 : 0.42) / this.speed, 0.38, 0.85);
      this.stepSide *= -1;
      this._syncAudio();
      if (demon) this.audio.stomp(this.feet, this.pitch);
      else this.audio.footstep(this.feet, this.pitch);
      event.kind = 'foot';
      if (demon) event.color = 0xff3020;
      event.at = this.pos.clone().addScaledVector(_side, 0.12 * this.stepSide).setY(0);
    } else if (this.type === 'flyer') {
      this.soundTimer += THREE.MathUtils.clamp(0.5 / this.speed, 0.45, 0.9);
      this.audio.whoosh(this.body, this.pitch);
      event.kind = 'wisp';
      event.at = this.pos.clone();
    } else {
      this.soundTimer += THREE.MathUtils.clamp(0.6 / this.speed, 0.5, 1.0);
      if (this.pos.y < 0.2) {
        // still under the floor: knock, and ripple the floor above it
        this.audio.knock(this.body, this.pitch);
        event.kind = 'ripple';
        event.at = this.pos.clone().setY(0);
      } else {
        this.audio.scratch(this.body, this.pitch);
        event.kind = 'wisp';
        event.at = this.pos.clone();
      }
    }
    return event;
  }

  _syncAudio() {
    if (this.onFloor) {
      _tmp.copy(this.pos).addScaledVector(_side, 0.12 * this.stepSide).setY(0.05);
      this.audio.setVoicePosition(this.feet, _tmp);
      _tmp.copy(this.pos).setY(1.5);
      this.audio.setVoicePosition(this.body, _tmp);
    } else {
      this.audio.setVoicePosition(this.feet, this.pos);
      this.audio.setVoicePosition(this.body, this.pos);
    }
  }

  _setOpacity(o) {
    this.bodyMat.opacity = o * 0.75;
    // the demon's eyes burn brighter than its faint body
    this.eyeMat.opacity = this.type === 'demon' ? Math.min(1, o * 3) : o;
    this.group.visible = o > 0.001;
  }

  _finish() {
    this.dispose();
    return { type: 'gone' };
  }

  dispose() {
    if (this.state === 'gone') return;
    this.state = 'gone';
    this.scene.remove(this.group);
    this.bodyMat.dispose();
    this.eyeMat.dispose();
    this.audio.releaseVoice(this.feet);
    this.audio.releaseVoice(this.body);
  }
}
