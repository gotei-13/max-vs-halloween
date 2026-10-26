import * as THREE from '../vendor/three.module.js';

// Three kinds of ghost, each with its own sound so you can tell where to look:
//   walker  - walks along the floor: footsteps
//   flyer   - swoops down through the ceiling: whooshes and moans
//   crawler - rises up through the floor: knocking from below, then scratching
// and a rarer, scarier one:
//   demon   - a red horned creature stomping along the floor and growling;
//             it takes 3 hits to banish (more as the final boss) and 2 lives when it catches you
// deeper in the house:
//   shadow  - a dark figure with red eyes and very soft steps; it only moves while
//             you are NOT looking at it, so turning toward its steps freezes it
//   bats    - a fluttering, squeaking swarm from above or below
//   wraith  - a dark flying spirit with rattling chains that blinks closer every few seconds
//   skeleton- rattling bones on the floor, 2 hits
//   werewolf- howls when it arrives, then sprints at you in bursts, 2 hits
//   zombie  - climbs out of a grave, then shambles at you with its arms out, 2 hits
// Skeletons, werewolves and zombies have real bodies with walking legs: you can see them.

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
const FREEZE_ANGLE = Math.cos(THREE.MathUtils.degToRad(35));   // a shadow freezes inside this view cone
const BATS = 7;
const SOLID = ['zombie', 'skeleton', 'werewolf'];   // creatures with a body you can see
const RISE_TIME = 2.2;                              // seconds a zombie takes to climb out of its grave
const _look = new THREE.Vector3();

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
      batBody: new THREE.SphereGeometry(0.035, 6, 5),
      batWing: new THREE.PlaneGeometry(0.13, 0.06).translate(0.065, 0, 0),
    };
  }
  return shared;
}

// A ghost moves toward the player. It is invisible: only its sounds
// (and its breathing when close) tell the player where it is.
export class Ghost {
  // angle: direction around you (0 = straight ahead of the room's door wall)
  // elevation: radians above (+) or below (-) your head, for flyers/crawlers
  // hp: spell hits needed (the final boss gets more)
  // at: { x, z } to appear at a fixed spot (a zombie's grave) instead of coming from `angle`
  constructor(scene, audio, { type = 'walker', angle, elevation = 0, speed, pitch, head, hp, at }) {
    this.scene = scene;
    this.audio = audio;
    this.type = type;
    this.speed = speed;
    this.pitch = pitch;
    this.state = 'hunting';  // hunting -> dying | scare -> gone
    this.doomed = false;     // a spell is on its way to it
    this.onFloor = ['walker', 'demon', 'shadow', 'skeleton', 'werewolf', 'zombie'].includes(type);
    this.solid = SOLID.includes(type);
    this.damage = type === 'demon' ? 2 : 1;
    this.hp = hp ?? ({ demon: 3, skeleton: 2, werewolf: 2, zombie: 2 }[type] || 1);   // spell hits needed to banish it
    this.rise = type === 'zombie' && at ? RISE_TIME : 0;
    this.walkPhase = 0;
    this.hurtGlow = 0;
    this.glitchTime = 0;      // > 0 while the ghost glitches into view
    this.glitchTimer = -2;    // seconds until the next glitch (set by the game on its first frame)
    this.catchRadius = ['demon', 'bats', 'werewolf', 'zombie'].includes(type) ? 0.8 : CATCH_RADIUS;
    this.baseScale = { demon: 1.2, shadow: 1.1, werewolf: 1.15, skeleton: 0.95 }[type] || 1;
    this.burstTimer = 3 + Math.random() * 2;   // werewolf: seconds until the next sprint
    this.bursting = 0;                         // werewolf: seconds of sprint left
    this.blinkTimer = 3 + Math.random() * 1.5; // wraith: seconds until it blinks closer
    this.frozen = false;      // a shadow that is being looked at
    if (at) {
      this.pos = new THREE.Vector3(at.x, BODY_Y, at.z);
    } else if (this.onFloor) {
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
    this.whisperTimer = 2 + Math.random() * 3;
    this.screechTimer = 1 + Math.random() * 2;
    this.blockCooldown = 0;
    this.justBlocked = false;
    this.fxTime = 0;

    const g = geometry();
    // drawn on top of walls/floor so a ghost is seen even when it is still behind them
    const demon = type === 'demon';
    const color = { demon: 0xd01810, shadow: 0x0c0612, bats: 0x1e1626, wraith: 0x5a2a8a, skeleton: 0xe8dcc0, werewolf: 0x5a4a40 }[type] ?? 0xb8fff0;
    this.bodyMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0, depthWrite: false, depthTest: false, side: type === 'bats' ? THREE.DoubleSide : THREE.FrontSide,
    });
    // the demon's and shadow's eyes burn; a ghost's eyes are dark holes
    const eyeColor = { demon: 0xffd040, shadow: 0xff2a10, wraith: 0x9fffe6, werewolf: 0xffc020, skeleton: 0x200000 }[type] ?? 0x000000;
    this.eyeMat = new THREE.MeshBasicMaterial({ color: eyeColor, transparent: true, opacity: 0, depthTest: false });
    this.group = new THREE.Group();
    this.bats = [];
    if (type === 'bats') {
      // a swarm of little bats circling around the swarm's middle
      for (let i = 0; i < BATS; i++) {
        const bat = new THREE.Group();
        const body = new THREE.Mesh(g.batBody, this.bodyMat);
        const left = new THREE.Mesh(g.batWing, this.bodyMat);
        const right = new THREE.Mesh(g.batWing, this.bodyMat);
        right.scale.x = -1;
        for (const o of [body, left, right]) o.renderOrder = 10;
        bat.add(body, left, right);
        bat.userData = { left, right, phase: Math.random() * Math.PI * 2, radius: 0.25 + Math.random() * 0.35, height: (Math.random() - 0.5) * 0.5, speed: 2 + Math.random() * 2 };
        this.group.add(bat);
        this.bats.push(bat);
      }
    } else if (this.solid) {
      this._buildFigure(type);
    } else {
      const body = new THREE.Mesh(g.body, this.bodyMat);
      body.renderOrder = 10;
      this.group.add(body);
    }
    if ((demon || type === 'werewolf') && !this.solid) {
      // horns for the demon, pointed ears for the werewolf
      for (const s of [-1, 1]) {
        const horn = new THREE.Mesh(g.horn, this.bodyMat);
        horn.renderOrder = 10;
        horn.position.set(s * (demon ? 0.17 : 0.2), demon ? 1.74 : 1.72, 0.04);
        horn.rotation.z = -s * (demon ? 0.45 : 0.25);
        if (!demon) horn.scale.set(1.3, 0.8, 0.6);
        this.group.add(horn);
      }
    }
    this.group.scale.setScalar(this.baseScale);
    this.baseColor = this.bodyMat.color.clone();
    for (const x of type === 'bats' || this.solid ? [] : [-0.11, 0.11]) {
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
    if (type === 'werewolf') audio.howl(this.body);   // you hear it coming from far away
    if (type === 'wraith') audio.chains(this.body);
    if (this.rise > 0) audio.graveRise(this.body);
  }

  get alive() {
    return this.state === 'hunting';
  }

  chestPosition(target) {
    return target.copy(this.pos);
  }

  // points from the bottom of the sheet up to the head (or around the swarm), for aiming spells
  bodyPoints() {
    const offsets = this.type === 'bats' ? [-0.35, 0, 0.35] : [-0.85, -0.35, 0.15, 0.5];
    return offsets.map((dy) => this.pos.clone().setY(this.pos.y + dy));
  }

  // returns an event object ('step', 'caught', 'gone') or null.
  // barrier: { x, z, radius } the ghost can't enter (the pentagram's dome), or null
  // revealed: the player drank a potion of visibility, so the ghost shows
  // look: the direction the player is looking (shadows freeze when looked at)
  update(dt, player, barrier = null, revealed = false, look = null) {
    this.time += dt;
    this.revealed = revealed;
    if (this.bats.length) this._flap(dt);
    if (this.state === 'hunting') return this._hunt(dt, player, barrier, look);

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

  // hit but not banished yet (demon, skeleton, werewolf): it flashes into view,
  // cries out and is thrown back. damage: 2 with the fire wand
  hurt(player, damage = 1) {
    this.hp -= damage;
    this.doomed = false;
    this.hurtGlow = 1;
    this.bursting = 0;
    _to.set(this.pos.x - player.x, 0, this.pos.z - player.z).normalize();
    this.pos.addScaledVector(_to, 1.8);
    if (this.type === 'skeleton') this.audio.boneRattle(this.body);
    else if (this.type === 'werewolf') this.audio.yelp(this.body);
    else this.audio.roar(this.body);
  }

  // a body for skeletons, werewolves and zombies: legs and arms that swing as they walk
  _buildFigure(type) {
    const geos = [];
    const box = (w, h, d) => {
      const geo = new THREE.BoxGeometry(w, h, d);
      geos.push(geo);
      return geo;
    };
    const lambert = (color) => new THREE.MeshLambertMaterial({ color, transparent: true });
    const look = {
      zombie: { skin: 0x6f7d5a, cloth: 0x3b3326, eyes: 0xd8ff60, limb: 0.13, torso: [0.44, 0.62, 0.26], lean: 0.12 },
      skeleton: { skin: 0xe6dcc4, cloth: 0xe6dcc4, eyes: 0xff2a10, limb: 0.06, torso: [0.34, 0.08, 0.2], lean: 0 },
      werewolf: { skin: 0x4a3a2c, cloth: 0x2e241c, eyes: 0xffc020, limb: 0.16, torso: [0.56, 0.66, 0.34], lean: 0.4 },
    }[type];
    const skin = lambert(look.skin), cloth = lambert(look.cloth);
    const eyes = new THREE.MeshBasicMaterial({ color: look.eyes, transparent: true });
    this.figureMats = [skin, cloth, eyes];
    this.figureGeos = geos;
    const part = (geo, mat, x, y, z, parent = this.group) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    };
    // legs swing from the hips
    const legs = [-0.12, 0.12].map((x) => {
      const hip = new THREE.Group();
      hip.position.set(x, 0.88, 0);
      part(box(look.limb, 0.86, look.limb + 0.02), type === 'skeleton' ? skin : cloth, 0, -0.43, 0, hip);
      this.group.add(hip);
      return hip;
    });
    // the upper body leans forward (a lot for the werewolf)
    const upper = new THREE.Group();
    upper.position.y = 0.9;
    upper.rotation.x = look.lean;
    this.group.add(upper);
    if (type === 'skeleton') {
      part(box(0.05, 0.62, 0.05), skin, 0, 0.3, -0.06, upper);   // spine
      for (let i = 0; i < 4; i++) part(box(0.32 - i * 0.03, 0.035, 0.2), skin, 0, 0.35 + i * 0.08, 0, upper);   // ribs
      part(box(0.3, 0.06, 0.14), skin, 0, 0.02, 0, upper);   // hips
    } else {
      part(box(...look.torso), cloth, 0, 0.32, 0, upper);
    }
    // arms swing from the shoulders (a zombie holds them out in front)
    const arms = [-1, 1].map((s) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(s * (look.torso[0] / 2 + look.limb / 2 + 0.01), 0.58, 0);
      const armLength = type === 'werewolf' ? 0.78 : 0.64;
      part(box(look.limb * 0.8, armLength, look.limb * 0.8), skin, 0, -armLength / 2, 0, shoulder);
      if (type === 'werewolf') {
        for (const cx of [-0.04, 0, 0.04]) part(box(0.015, 0.1, 0.015), eyes, cx, -armLength - 0.04, 0.03, shoulder);   // claws
      }
      upper.add(shoulder);
      return shoulder;
    });
    // the head
    const headY = 0.8;
    if (type === 'skeleton') {
      const skull = new THREE.SphereGeometry(0.12, 10, 8);
      geos.push(skull);
      part(skull, skin, 0, headY, 0, upper);
      part(box(0.14, 0.05, 0.1), skin, 0, headY - 0.12, 0.03, upper);   // jaw
    } else {
      part(box(0.24, 0.27, 0.25), skin, 0, headY, 0, upper);
    }
    if (type === 'werewolf') {
      part(box(0.13, 0.11, 0.2), skin, 0, headY - 0.06, 0.2, upper);   // snout
      const ear = new THREE.ConeGeometry(0.05, 0.16, 6);
      geos.push(ear);
      for (const s of [-1, 1]) part(ear, cloth, s * 0.09, headY + 0.19, -0.02, upper);
    }
    const eye = box(0.045, 0.03, 0.02);
    for (const s of [-1, 1]) part(eye, eyes, s * 0.06, headY + 0.03, type === 'skeleton' ? 0.11 : 0.13, upper);
    this.limbs = { legs, arms, upper, armsOut: type === 'zombie' };
    this.group.traverse((o) => { if (o.isMesh) o.renderOrder = 10; });
  }

  // legs and arms swing as it walks
  _animateFigure(dt, moving) {
    const l = this.limbs;
    this.walkPhase += dt * (moving ? this.speed * 5.5 * (this.bursting > 0 ? 1.8 : 1) : 0);
    const swing = Math.sin(this.walkPhase) * (moving ? 0.55 : 0);
    l.legs[0].rotation.x = swing;
    l.legs[1].rotation.x = -swing;
    if (l.armsOut) {
      l.arms[0].rotation.x = -1.35 + Math.sin(this.walkPhase * 0.5) * 0.12;
      l.arms[1].rotation.x = -1.35 - Math.sin(this.walkPhase * 0.5 + 1) * 0.12;
    } else {
      l.arms[0].rotation.x = -swing * 0.8;
      l.arms[1].rotation.x = swing * 0.8;
    }
    l.upper.position.y = 0.9 + Math.abs(Math.cos(this.walkPhase)) * 0.03;
    // a faint glow of its own color so it shows in the dark, and a red flash when hurt
    for (const mat of this.figureMats) {
      if (!mat.emissive) continue;
      mat.emissive.copy(mat.color).multiplyScalar(0.22);
      mat.emissive.r += this.hurtGlow * 0.7;
    }
  }

  // for a split second the ghost stutters into view with static: a clue where it is
  glitch() {
    if (this.state !== 'hunting' || this.solid) return;
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
    this.group.position.y = this.bats.length ? head.y : head.y - (this.solid ? 1.65 : 1.45);
    this.group.lookAt(head.x, this.group.position.y, head.z);
    this.group.scale.setScalar(this.baseScale);
  }

  // fade away (game over)
  vanish() {
    this.state = 'dying';
    this.fxTime = 0.12;
  }

  // the bats beat their wings and circle the swarm's middle
  _flap(dt) {
    for (const bat of this.bats) {
      const u = bat.userData;
      const a = this.time * u.speed + u.phase;
      bat.position.set(Math.cos(a) * u.radius, u.height + Math.sin(a * 1.7) * 0.08, Math.sin(a) * u.radius);
      bat.rotation.y = -a;
      const flap = Math.sin(this.time * 28 + u.phase) * 0.9;
      u.left.rotation.z = flap;
      u.right.rotation.z = -flap;
    }
  }

  _hunt(dt, player, barrier, look) {
    // a zombie still climbing out of its grave: it rises out of the ground first
    if (this.rise > 0) {
      this.rise -= dt;
      const k = Math.max(0, this.rise / RISE_TIME);
      this.group.position.set(this.pos.x, -1.8 * k, this.pos.z);
      this.group.lookAt(player.x, this.group.position.y, player.z);
      this._setOpacity(1);
      this._animateFigure(dt, false);
      this.limbs.arms[0].rotation.x = this.limbs.arms[1].rotation.x = -2.6 + (1 - k) * 1.2;   // clawing upward
      this._syncAudio();
      return this.rise <= 0 ? null : (Math.random() < dt * 4 ? { type: 'step', kind: 'ripple', at: this.pos.clone().setY(0), dist: 9, dir: new THREE.Vector3() } : null);
    }
    // walkers stay on the floor; flyers and crawlers go for your chest
    if (this.onFloor) _target.set(player.x, BODY_Y, player.z);
    else _target.set(player.x, THREE.MathUtils.clamp(player.y - 0.45, 0.8, 1.8), player.z);
    _to.subVectors(_target, this.pos);
    const dist = _to.length();
    if (this.doomed) return null;  // frozen while the spell flies in
    if (dist < this.catchRadius) return { type: 'caught', dist };

    // a shadow freezes while the player looks at it: no movement, no sound
    this.frozen = false;
    if (this.type === 'shadow' && look) {
      _look.set(look.x, 0, look.z).normalize();
      const fx = this.pos.x - player.x, fz = this.pos.z - player.z;
      const fl = Math.hypot(fx, fz) || 1;
      this.frozen = (fx * _look.x + fz * _look.z) / fl > FREEZE_ANGLE;
    }

    _to.divideScalar(dist);
    _side.crossVectors(_to, UP);
    if (_side.lengthSq() < 1e-4) _side.set(1, 0, 0);
    _side.normalize();
    // sway side to side a bit, less when close, so the sound source moves
    const sway = Math.sin(this.time * 0.9) * this.wobble * Math.min(1, dist / 3);
    // a werewolf sprints at you in bursts
    if (this.type === 'werewolf') {
      if (this.bursting > 0) this.bursting -= dt;
      else {
        this.burstTimer -= dt;
        if (this.burstTimer <= 0 && dist > 1.5) {
          this.bursting = 1.3;
          this.burstTimer = 3.5 + Math.random() * 2;
          this.audio.growl(this.body, 1.2);
        }
      }
    }
    const step = this.frozen ? 0 : this.speed * dt * (this.bursting > 0 ? 2.8 : 1);
    this.pos.addScaledVector(_to, step).addScaledVector(_side, sway * step);
    // a wraith blinks a good bit closer now and then, with a flicker and its chains
    if (this.type === 'wraith') {
      this.blinkTimer -= dt;
      if (this.blinkTimer <= 0 && dist > 2.5) {
        this.blinkTimer = 3.5 + Math.random() * 2;
        this.pos.addScaledVector(_to, Math.min(2.2, dist - 1.8));
        this.glitchTime = 0.3;
        this.audio.chains(this.body);
      }
    }
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
    if (!this.frozen) {
      this.soundTimer -= dt;
      if (this.soundTimer <= 0) event = this._makeSound(dist);
    }

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
    if (this.type === 'shadow') {
      this.whisperTimer -= dt;
      if (this.whisperTimer <= 0) {
        this.whisperTimer = 4 + Math.random() * 3;
        this.audio.whisper(this.body);
      }
    }
    if (this.type === 'zombie') {
      this.whisperTimer -= dt;
      if (this.whisperTimer <= 0) {
        this.whisperTimer = 2.5 + Math.random() * 2;
        this.audio.zombieGroan(this.body, this.pitch);
      }
    }
    if (this.type === 'werewolf' && dist < 4) {
      this.screechTimer -= dt;
      if (this.screechTimer <= 0) {
        this.screechTimer = 1.6;
        this.audio.pant(this.body);
      }
    }
    if (this.type === 'bats') {
      this.screechTimer -= dt;
      if (this.screechTimer <= 0) {
        this.screechTimer = 2.2 + Math.random() * 2;
        this.audio.screech(this.body);
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
    const seen = this.type === 'demon' ? 3.2 : this.type === 'skeleton' ? 2.4 : 1.8;
    this.hurtGlow = Math.max(0, this.hurtGlow - dt * 1.5);
    const shimmer = dist < seen ? (1 - dist / seen) * (this.type === 'demon' ? 0.3 : 0.18) : 0;
    let glitch = 0;
    if (this.glitchTime > 0) {
      this.glitchTime -= dt;
      glitch = Math.random() < 0.65 ? 0.35 + Math.random() * 0.55 : 0;  // flickering on and off
    }
    this._setOpacity(Math.max(this.hurtGlow, this.revealed ? 0.7 : 0, shimmer, glitch));
    if (this.solid) this._animateFigure(dt, !this.frozen);
    const lift = this.bats.length ? 0 : BODY_Y;   // the bat swarm is centered on its position
    this.group.position.set(this.pos.x, this.pos.y - lift + Math.sin(this.time * 2) * 0.04, this.pos.z);
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
      else if (this.type === 'shadow') this.audio.softStep(this.feet, this.pitch);
      else if (this.type === 'werewolf') this.audio.pawStep(this.feet);
      else if (this.type === 'zombie') this.audio.dragStep(this.feet, this.pitch);
      else this.audio.footstep(this.feet, this.pitch);
      if (this.type === 'skeleton' && Math.random() < 0.6) this.audio.boneRattle(this.body);
      if (this.type === 'werewolf' && this.bursting > 0) this.soundTimer = Math.min(this.soundTimer, 0.16);   // galloping
      event.kind = 'foot';
      if (demon) event.color = 0xff3020;
      event.at = this.pos.clone().addScaledVector(_side, 0.12 * this.stepSide).setY(0);
    } else if (this.type === 'bats') {
      this.soundTimer += 0.12 + Math.random() * 0.08;
      this.audio.flutter(this.body);
      event.kind = 'wisp';
      event.at = this.pos.clone();
      if (Math.random() < 0.7) return null;   // fluttering is constant; leave a trace only now and then
    } else if (this.type === 'flyer' || this.type === 'wraith') {
      this.soundTimer += THREE.MathUtils.clamp(0.5 / this.speed, 0.45, 0.9);
      this.audio.whoosh(this.body, this.pitch * (this.type === 'wraith' ? 0.7 : 1));
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
    if (this.solid) {
      // a body is always there to see while it hunts; it only fades when banished
      const k = this.state === 'hunting' || this.state === 'scare' ? 1 : o;
      for (const mat of this.figureMats) mat.opacity = k;
      this.group.visible = k > 0.001;
      return;
    }
    this.bodyMat.opacity = o * 0.75;
    // the demon's and shadow's eyes burn brighter than their faint bodies
    this.eyeMat.opacity = ['demon', 'shadow', 'werewolf', 'wraith'].includes(this.type) ? Math.min(1, o * 3) : o;
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
    for (const mat of this.figureMats || []) mat.dispose();
    for (const geo of this.figureGeos || []) geo.dispose();
    this.audio.releaseVoice(this.feet);
    this.audio.releaseVoice(this.body);
  }
}
