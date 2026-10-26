import * as THREE from '../vendor/three.module.js';
import { SpookyAudio } from './audio.js';
import { createRoom } from './room.js';
import { createHallway, createStairwell, createFoyer } from './house.js';
import { Ghost } from './ghost.js';
import { Key } from './key.js';
import { Hud } from './hud.js';
import { Trail } from './trail.js';
import { SpellFx } from './fx.js';
import { VrMenu } from './vrmenu.js';
import { Shield } from './shield.js';
import { Scares } from './scares.js';
import { Horror } from './horror.js';
import { Potion } from './potion.js';
import { makeWand } from './wand.js';
import { sparkle } from './textures.js';
import { walk, floorDirections, snapTurn, setArea as setWalkArea } from './movement.js';

const EYE_HEIGHT = 1.6;
const START_LIVES = 3;
const CAST_COOLDOWN = 0.5;

// aim: how many degrees off the ghost a spell may be and still hit
// stereo: how hard sounds are pushed into the left/right ear (0 = real 3D sound only)
// glitch: seconds between a ghost briefly glitching into view (a clue where it is)
// horror: how often the big scary moments come (blackout, shadow figure, writing, door)
const DIFFICULTIES = {
  easy: {
    aim: 35, speed: 0.35, speedStep: 0.03, maxSpeed: 1.0, maxGhosts: 1, trail: 0.9, stereo: 0.8, glitch: [5, 8], horror: 0.8,
    note: 'Glowing traces show where ghosts move · slow ghosts · one at a time',
  },
  normal: {
    aim: 22, speed: 0.45, speedStep: 0.05, maxSpeed: 1.4, maxGhosts: 2, trail: 0.35, stereo: 0.5, glitch: [7, 11], horror: 1,
    note: 'Faint traces · a miss brings a second ghost',
  },
  hard: {
    aim: 15, speed: 0.55, speedStep: 0.06, maxSpeed: 1.7, maxGhosts: 2, trail: 0, stereo: 0, glitch: [10, 16], horror: 1.3,
    note: 'Sound only · fast ghosts',
  },
};
// The haunted house, one area after another. In each area banish `goal` creatures
// (first the ones in `plan`, then any of `types`); then a key appears (or, in the
// last area, the boss comes) and the way to the next area opens.
const AREAS = [
  {
    build: createRoom, label: 'Bedroom', goal: 5,
    plan: ['walker', 'flyer', 'crawler', 'walker', 'flyer'], types: ['walker', 'flyer', 'crawler'],
    intro: 'Escape the haunted house! Banish 5 ghosts to find the key to the door',
  },
  {
    build: createHallway, label: 'Hallway', goal: 4,
    plan: ['shadow', 'shadow', 'walker', 'shadow'], types: ['shadow', 'shadow', 'walker'],
    intro: 'The Hallway: banish 4 creatures. Shadow people only move when you are NOT looking at them!',
  },
  {
    build: createStairwell, label: 'Stairs', goal: 4,
    plan: ['bats', 'bats', 'flyer', 'bats'], types: ['bats', 'bats', 'flyer', 'crawler'],
    intro: 'The Staircase: chase away 4 bat swarms to clear the way down',
  },
  {
    build: createFoyer, label: 'Front hall', goal: 3,
    plan: ['walker', 'crawler', 'flyer'], types: ['walker', 'flyer', 'crawler', 'shadow'],
    boss: { hp: 5 },
    intro: 'The Entrance Hall: banish 3 ghosts… then face the guardian of the front door',
  },
];
const FADE = 0.6;   // seconds to fade to black (and back) between areas

const SPELL_SPEED = 10;
const SPELL_STEER = 7;  // how fast a spell curves toward its ghost
const RESTART_DELAY = 1.5;
const WALK_SPEED = 1.8;  // meters per second

// ---- renderer, scene, camera ---------------------------------------------

// alpha so mixed reality can show the real room behind the game
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation(1);
// we update the headset pose ourselves at the start of each frame, so game
// logic and 3D audio use this frame's head position
renderer.xr.cameraAutoUpdate = false;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 100);
camera.rotation.order = 'YXZ';

// the player's "rig": moving it moves the player (camera and VR hands) through the house.
// Each area puts it at its entrance (loadArea); before a game it stands in the bedroom.
const rig = new THREE.Group();
rig.position.set(0, 0, 3.5);
rig.add(camera);
scene.add(rig);

const audio = new SpookyAudio();
let room = createRoom();   // the area of the house the player is in (see loadArea)
scene.add(room.group);
const hud = new Hud(camera);
const trail = new Trail(scene);
const fx = new SpellFx(scene);
const vrMenu = new VrMenu(scene);
const shield = new Shield(scene);
const scares = new Scares(scene, audio);
const potion = new Potion(scene, audio);
const horror = new Horror(scene, audio, room);
const key = new Key(scene, audio);

// a glowing golden ring on the floor, with sparkles rising from it, where the way out is
const exitMarker = (() => {
  const marker = new THREE.Group();
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.58, 40), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  const count = 36;
  const pos = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  const reset = (i, y) => {
    const a = Math.random() * Math.PI * 2;
    const r = 0.3 + Math.random() * 0.25;
    pos.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3);
    speeds[i] = 0.3 + Math.random() * 0.5;
  };
  for (let i = 0; i < count; i++) reset(i, Math.random() * 1.8);
  const geo = new THREE.BufferGeometry();
  const attr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', attr);
  const sparkMat = new THREE.PointsMaterial({ map: sparkle(), color: 0xffd36b, size: 0.07, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const sparks = new THREE.Points(geo, sparkMat);
  sparks.frustumCulled = false;
  marker.add(ring, sparks);
  marker.userData = {
    ringMat,
    update(dt) {
      for (let i = 0; i < count; i++) {
        pos[i * 3 + 1] += speeds[i] * dt;
        if (pos[i * 3 + 1] > 1.9) reset(i, 0);
      }
      attr.needsUpdate = true;
    },
  };
  marker.visible = false;
  scene.add(marker);
  return marker;
})();

// shown the first time each kind of ghost appears in a game
const GHOST_INTROS = {
  flyer: 'Something is flying above you… look up!',
  crawler: 'Something is knocking under the floor… look down!',
  demon: 'THE GUARDIAN! A red demon: 5 hits to banish it, it takes 2 lives!',
  shadow: 'A shadow person! It only moves when you are NOT looking. Turn to its soft steps to freeze it',
  bats: 'Bats! Listen for the fluttering wings above and below you',
};

// ---- VR controllers -------------------------------------------------------

// a magic wand in each VR hand, with a pointer line that only shows for the VR menu
function makeHandWand() {
  const wand = makeWand();
  const ray = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, wand.userData.tipZ), new THREE.Vector3(0, 0, -2.2)]),
    new THREE.LineBasicMaterial({ color: 0x8a7cff, transparent: true, opacity: 0.35 }),
  );
  wand.add(ray);
  wand.userData.ray = ray;
  return wand;
}

// on the laptop the wand shows in the lower right, like in a first-person game
const laptopWand = makeWand({ onTop: true });
laptopWand.position.set(0.2, -0.17, -0.38);
laptopWand.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-0.2, 0.17, -6).normalize());
const laptopWandRest = laptopWand.quaternion.clone();
laptopWand.visible = false;
camera.add(laptopWand);
let wandKick = 0;   // 1 right after casting, then back to 0

const controllers = [0, 1].map((i) => {
  const c = renderer.xr.getController(i);
  c.userData.source = null;
  c.addEventListener('connected', (e) => { c.userData.source = e.data; });
  c.addEventListener('disconnected', () => { c.userData.source = null; });
  c.addEventListener('selectstart', () => onTrigger(c));
  const wand = makeHandWand();
  c.add(wand);
  c.userData.wand = wand;
  rig.add(c);
  return c;
});

function pulse(controller, strength, ms) {
  const actuator = controller.userData.source?.gamepad?.hapticActuators?.[0];
  if (actuator?.pulse) actuator.pulse(strength, ms)?.catch?.(() => {});
}

// ---- game state -----------------------------------------------------------

let mode = 'none';      // 'laptop' | 'vr' (any headset session)
let mixedReality = false;
let roomStyle = 'realistic';
let state = 'ready';    // 'ready' | 'playing' | 'over'
let paused = false;
let now = 0;
let lives = START_LIVES;
let score = 0;
let lastCast = -10;
let overAt = 0;
let ghosts = [];
let spells = [];
let spawnTimes = [];
const seenTypes = new Set();
let areaIndex = 0;      // which area of the house
let phase = 'fight';    // 'fight' -> 'key' -> 'exit' (or 'fight' -> 'boss' -> 'exit' in the last area)
let goalDone = 0;       // creatures banished in this area
let areaSpawns = 0;     // creatures sent in this area
let exitOpen = 0;       // 0..1 how far the way out has opened
let transition = null;  // { t, target, swapped } while fading between areas
let playStart = 0;
let progress = 0;       // the furthest area reached (saved)
let startArea = 0;      // where the next game starts
try { progress = Math.min(AREAS.length - 1, Number(localStorage.getItem('maxiween-progress')) || 0); } catch {}
startArea = progress;
const lookDir = new THREE.Vector3();
let level = 'easy';
let cfg = DIFFICULTIES.easy;
let restartOnContinue = false;

const player = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

function huntingGhosts() {
  return ghosts.filter((g) => g.alive);
}

function ghostSpeed() {
  return Math.min(cfg.speed + score * cfg.speedStep, cfg.maxSpeed);
}

function clearWorld() {
  for (const g of ghosts) g.dispose();
  for (const s of spells) fx.removeOrb(s.orb);
  trail.clear();
  fx.clear();
  scares.reset();
  potion.reset();
  horror.reset();
  audio.stopDread();
  key.hide();
  exitMarker.visible = false;
  ghosts = [];
  spells = [];
  spawnTimes = [];
}

// throw away an area's meshes, materials and textures (frees memory on the Quest)
function disposeGroup(group) {
  group.traverse((o) => {
    o.geometry?.dispose();
    for (const mat of [].concat(o.material || [])) {
      for (const value of Object.values(mat)) if (value?.isTexture) value.dispose();
      mat.dispose();
    }
  });
}

// build an area of the house and put the player at its entrance
function loadArea(index) {
  scene.remove(room.group);
  disposeGroup(room.group);
  areaIndex = index;
  room = AREAS[index].build();
  scene.add(room.group);
  applyRoomStyle();
  const info = room.info;
  setWalkArea(info);
  shield.setCenter(info.circle.x, info.circle.z);
  potion.setArea(info);
  scares.setArea(info);
  horror.allowDoor = true;
  horror.setArea(room);
  rig.position.set(info.entry.x, 0, info.entry.z);
  rig.rotation.set(0, mode === 'vr' ? info.entry.yaw : 0, 0);
  rig.updateMatrixWorld(true);
  yaw = info.entry.yaw;
  pitch = 0;
}

// start (or restart) an area: full lives, its creatures come
function beginArea(index) {
  clearWorld();
  loadArea(index);
  shield.reset();
  lives = START_LIVES;
  phase = 'fight';
  goalDone = 0;
  areaSpawns = 0;
  exitOpen = 0;
  state = 'playing';
  vrMenu.hide();
  hud.setMessage();
  hud.toast(AREAS[index].intro, 4.5);
  scheduleSpawn(3);
  if (index > progress) {
    progress = index;
    try { localStorage.setItem('maxiween-progress', String(progress)); } catch {}
  }
  updateAreaChoice();
}

// the area's ghosts are banished: a key appears, or the boss comes, or (stairs) the way opens
function onGoalReached() {
  for (const g of ghosts) if (g.alive) g.vanish();
  spawnTimes = [];
  const a = AREAS[areaIndex];
  const info = room.info;
  if (a.boss) {
    phase = 'boss';
    hud.toast('The house shakes… something huge is coming through the front door!', 3);
    setTimeout(() => { if (phase === 'boss' && state === 'playing') spawnBoss(); }, 3000);
  } else if (info.noKey) {
    openExit('The way down is clear! Walk to the top of the stairs');
  } else {
    phase = 'key';
    key.show(info.keySpot.x, info.keySpot.z);
    hud.toast('A key appeared! Listen for its chime and walk over it', 3);
  }
}

// the way to the next area opens
function openExit(message) {
  phase = 'exit';
  horror.allowDoor = false;
  horror.reset();
  const info = room.info;
  audio.at(info.exitPoint, (voice) => audio.unlock(voice));
  exitMarker.position.set(info.exitZone.x, 0, info.exitZone.z);
  exitMarker.visible = true;
  hud.toast(message, 3.5);
}

// the player walks through the open exit: fade to black and on to the next area
function goToNextArea() {
  if (areaIndex === AREAS.length - 1) {
    escape();
    return;
  }
  state = 'transition';
  if (room.info.id === 'stairwell') audio.stairsDown();
  transition = { t: 0, target: areaIndex + 1, swapped: false };
}

function updateTransition(dt) {
  if (!transition) return;
  transition.t += dt;
  const t = transition.t;
  hud.setFade(t < FADE ? t / FADE : Math.max(0, 1 - (t - FADE - 0.3) / FADE));
  if (t >= FADE && !transition.swapped) {
    transition.swapped = true;
    if (transition.escape) {
      // the view out of the front door, with celebration sparkles
      rig.position.set(0, 0, -1.6);
      rig.rotation.set(0, 0, 0);
      rig.updateMatrixWorld(true);
      yaw = 0;
      pitch = 0.05;
      for (let i = 0; i < 4; i++) setTimeout(() => fx.hit(_v3.set((Math.random() - 0.5) * 1.5, 1.6 + Math.random() * 0.6, -4.4), false), 300 + i * 450);
    } else {
      beginArea(transition.target);
      state = 'transition';
    }
  }
  if (t >= FADE * 2 + 0.3) {
    const escaped = transition.escape;
    transition = null;
    hud.setFade(0);
    if (!escaped) state = 'playing';
  }
}

// out of the front door: the end! Fade to black, then stand in the hall
// looking out through the open front door at the moonlit night
function escape() {
  state = 'escaped';
  overAt = now;
  exitMarker.visible = false;
  audio.stopDread();
  audio.win();
  transition = { t: 0, escape: true, swapped: false };
  const seconds = Math.round(now - playStart);
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const line = `You banished ${score} creatures in ${time}`;
  if (mode === 'vr') {
    setTimeout(() => vrMenu.show({ title: 'YOU ESCAPED!', subtitle: line, action: 'PLAY AGAIN' }, camera), 2500);
  } else {
    hud.setMessage('YOU ESCAPED!', `${line}\nClick to play again`);
  }
}

// the red demon guards the front door
function spawnBoss() {
  audio.stinger();
  const from = room.info.bossFrom;
  const angle = Math.atan2(from.x - player.x, -(from.z - player.z));
  spawnGhost('demon', { angle, hp: AREAS[areaIndex].boss.hp, boss: true });
}

function showReady() {
  clearWorld();
  shield.reset();
  state = 'ready';
  if (mode === 'vr') {
    hud.setMessage();
    vrMenu.show({ title: 'Maxim VS Halloween', subtitle: 'Escape the haunted house!', action: 'START' }, camera);
  } else {
    hud.setMessage('Maxim VS Halloween', 'Click to start');
  }
}

// trigger/click while not playing starts or restarts the game; returns true if it did
function tryStart() {
  if (state === 'ready') {
    startGame();
    return true;
  }
  if (state === 'over' || state === 'escaped') {
    if (now - overAt > RESTART_DELAY) {
      if (state === 'over') beginArea(areaIndex);   // checkpoint: try this area again
      else startGame(0);
    }
    return true;
  }
  return false;
}

// a new run through the house, from the chosen area
function startGame(from = startArea) {
  score = 0;
  seenTypes.clear();
  playStart = now;
  audio.start();
  beginArea(from);
}

function gameOver() {
  state = 'over';
  overAt = now;
  for (const g of ghosts) if (g.alive) g.vanish();
  spawnTimes = [];
  audio.stopDread();
  potion.reset();
  horror.reset();
  audio.gameOver();
  key.hide();
  exitMarker.visible = false;
  const where = `The ${AREAS[areaIndex].label.toLowerCase()} got you…`;
  // in VR the menu panel with "Try again" follows shortly (see updateGame)
  hud.setMessage('GAME OVER', mode === 'vr' ? where : `${where}\nClick to try this part again`);
}

function scheduleSpawn(delay) {
  spawnTimes.push(now + delay);
}

function playerYaw() {
  camera.getWorldDirection(_v1);
  return Math.atan2(_v1.x, -_v1.z);
}

// the area's creatures: first its plan, then any of its kinds
function nextAreaType() {
  const a = AREAS[areaIndex];
  const type = areaSpawns < a.plan.length ? a.plan[areaSpawns] : a.types[Math.floor(Math.random() * a.types.length)];
  areaSpawns++;
  return type;
}

const SPEEDS = { demon: 1.15, shadow: 1.35, bats: 1.1 };

function spawnGhost(type = nextAreaType(), { angle: fixedAngle, hp, boss = false } = {}) {
  let angle = fixedAngle;
  const spawnAngles = room.info.spawnAngles;
  if (angle !== undefined) {
    seenTypes.add(type);
    if (GHOST_INTROS[type]) hud.toast(GHOST_INTROS[type], 3);
  } else if (!seenTypes.has(type)) {
    // the first ghost of each kind comes from roughly in front, so it is easy to learn
    angle = playerYaw() + (Math.random() - 0.5) * 1.0;
    seenTypes.add(type);
    if (GHOST_INTROS[type]) hud.toast(GHOST_INTROS[type], 3);
  } else if (spawnAngles) {
    // narrow areas: come down the corridor, ahead or behind
    angle = spawnAngles[Math.floor(Math.random() * spawnAngles.length)] + (Math.random() - 0.5) * 0.5;
  } else {
    // pick a direction away from the other ghosts so they can be told apart
    const others = huntingGhosts().map((g) => Math.atan2(g.pos.x, -g.pos.z));
    for (let tries = 0; tries < 10; tries++) {
      angle = Math.random() * Math.PI * 2;
      const tooClose = others.some((o) => Math.abs(Math.atan2(Math.sin(angle - o), Math.cos(angle - o))) < 0.9);
      if (!tooClose) break;
    }
  }
  // flyers come from 35-70° above, crawlers from 35-65° below
  let elevation = 0;
  if (type === 'flyer') elevation = THREE.MathUtils.randFloat(0.6, 1.2);
  else if (type === 'crawler') elevation = -THREE.MathUtils.randFloat(0.6, 1.1);
  else if (type === 'bats') elevation = THREE.MathUtils.randFloat(0.5, 1.0) * (Math.random() < 0.5 ? -1 : 1);   // up the stairwell or up from the stairs
  const speed = ghostSpeed() * (SPEEDS[type] || 1);
  const ghost = new Ghost(scene, audio, {
    type, angle, elevation, speed, pitch: 0.85 + Math.random() * 0.3, head: player, hp,
  });
  ghost.isBoss = boss;
  ghosts.push(ghost);
}

// ---- casting spells -------------------------------------------------------

function cast(origin, dir, controller = null) {
  if (now - lastCast < CAST_COOLDOWN) return;
  lastCast = now;
  audio.cast();
  room.flash(0.5);
  fx.cast(origin, dir);
  if (controller) {
    pulse(controller, 0.3, 40);
    controller.userData.wand.userData.power = 3;
  } else {
    laptopWand.userData.power = 3;
    wandKick = 1;
  }

  // aim assist: the ghost nearest to where you pointed (up, down or around), within the cone
  let target = null;
  let harmless = false;
  let best = THREE.MathUtils.degToRad(cfg.aim);
  for (const g of ghosts) {
    if (g.state !== 'hunting') continue;
    for (const p of g.bodyPoints()) {
      const angle = dir.angleTo(p.sub(origin));
      if (angle < best) {
        best = angle;
        target = g;
      }
    }
  }
  // a second spell at a ghost that is already being hit doesn't count as a miss
  if (target?.doomed) {
    harmless = true;
    target = null;
  }
  if (target) target.doomed = true;

  const orb = fx.makeOrb();
  orb.position.copy(origin);
  const vel = dir.clone().normalize().multiplyScalar(SPELL_SPEED);
  spells.push({ orb, vel, target, harmless, life: target ? 2 : 0.6, controller });
}

function updateSpells(dt) {
  for (const s of spells) {
    s.life -= dt;
    if (s.target) {
      // curve toward the ghost: steer the velocity a bit more each frame
      const to = s.target.chestPosition(_v1).sub(s.orb.position);
      const dist = to.length();
      if (dist < SPELL_SPEED * dt + 0.25 || s.life <= 0) {
        fx.hit(s.target.chestPosition(_v1), s.target.type === 'demon');
        onHit(s.target, s.controller);
        s.done = true;
      } else {
        s.vel.lerp(to.multiplyScalar(SPELL_SPEED / dist), Math.min(1, dt * SPELL_STEER)).setLength(SPELL_SPEED);
      }
    } else if (s.life <= 0) {
      s.done = true;
      fx.fizzle(s.orb.position);
      audio.fizzle();
      if (!s.harmless) onMiss();
    }
    if (s.done) {
      fx.removeOrb(s.orb);
    } else {
      s.orb.position.addScaledVector(s.vel, dt);
      fx.trail(s.orb, _v2.copy(s.vel).normalize());
    }
  }
  spells = spells.filter((s) => !s.done);
}

function onHit(ghost, controller) {
  if (ghost.state !== 'hunting') return;
  if (ghost.hp > 1) {
    // the demon needs more than one hit
    ghost.hurt(player);
    room.flash(0.8);
    hud.toast(`The ${ghost.isBoss ? 'guardian' : 'demon'} is hurt! ${ghost.hp} more hit${ghost.hp === 1 ? '' : 's'}!`, 1.8);
    if (controller) pulse(controller, 0.9, 150);
    return;
  }
  ghost.banish();
  room.flash(1);
  score++;
  if (controller) pulse(controller, 0.7, 120);
  if (ghost.isBoss) {
    room.setExit(0);
    openExit('You beat the guardian! The front door is opening… ESCAPE!');
    return;
  }
  if (phase !== 'fight') return;
  goalDone++;
  const need = AREAS[areaIndex].goal;
  if (goalDone >= need) onGoalReached();
  else hud.toast(`Banished! ${goalDone} of ${need}`, 1.4);
}

function onMiss() {
  if (state !== 'playing' || phase !== 'fight') return;
  const hunting = huntingGhosts();
  if (hunting[0]) audio.laugh(hunting[0].body, hunting[0].pitch);
  if (hunting.length + spawnTimes.length < cfg.maxGhosts) {
    hud.toast('Missed! Another ghost is coming…', 2);
    scheduleSpawn(0.8);
  } else {
    hud.toast('Missed! The ghosts are getting angry…', 2);
    for (const g of hunting) g.speed *= 1.1;
  }
}

function onCaught(ghost) {
  ghost.jumpScare(camera);
  audio.scream();
  hud.flash();
  for (const c of controllers) pulse(c, 1, 400);
  lives = Math.max(0, lives - ghost.damage);
  if (lives <= 0) gameOver();
  else hud.toast(`${ghost.damage > 1 ? 'The demon got you! ' : 'Caught! '}${lives} ${lives === 1 ? 'life' : 'lives'} left`, 2);
}

// when a ghost takes a step close to you, buzz the controller on its side
function onGhostStep(ghost, dist) {
  if (mode !== 'vr' || dist > 2.5) return;
  const closeness = 1 - dist / 2.5;
  camera.getWorldDirection(_v1);
  const right = _v3.set(-_v1.z, 0, _v1.x);
  const onRight = right.dot(_v2.copy(ghost.pos).sub(player)) > 0;
  for (const c of controllers) {
    const hand = c.userData.source?.handedness;
    const sameSide = (hand === 'right') === onRight;
    pulse(c, (sameSide ? 0.5 : 0.15) * closeness + 0.05, 50);
  }
}

function updateGame(dt) {
  if (state === 'playing' && phase === 'fight') {
    const due = spawnTimes.filter((t) => t <= now);
    spawnTimes = spawnTimes.filter((t) => t > now);
    for (let i = 0; i < due.length; i++) spawnGhost();
    if (huntingGhosts().length === 0 && spawnTimes.length === 0) scheduleSpawn(1.6);
  }
  if (state === 'playing' && phase === 'key' && key.update(dt, player) === 'picked') {
    openExit(room.info.id === 'bedroom' ? 'The door unlocked! Walk through it' : 'The door at the end unlocked! Walk through it');
  }
  // the way out swings open, glows, and leads on when you step into it
  if (phase === 'exit') {
    exitOpen = Math.min(1, exitOpen + dt / 2.5);
    room.setExit(exitOpen);
    const z = room.info.exitZone;
    exitMarker.userData.ringMat.opacity = 0.5 + 0.4 * (0.5 + 0.5 * Math.sin(now * 4));
    exitMarker.userData.update(dt);
    if (state === 'playing' && exitOpen > 0.6 && Math.hypot(player.x - z.x, player.z - z.z) < z.r) goToNextArea();
  }
  camera.getWorldDirection(lookDir);

  updateShield(dt);
  updatePotion(dt);
  const safe = shield.active && shield.contains(player);

  // dread music while the red demon hunts: louder and faster the closer it gets
  const demon = ghosts.find((g) => g.type === 'demon' && g.alive);
  if (demon && state === 'playing') {
    const dist = Math.hypot(demon.pos.x - player.x, demon.pos.z - player.z);
    audio.updateDread(dt, THREE.MathUtils.clamp(1 - dist / 7, 0.1, 1));
  } else {
    audio.stopDread();
  }

  for (const g of ghosts) {
    // now and then each ghost glitches into view for a split second
    if (g.alive && state === 'playing') {
      g.glitchTimer -= dt;
      if (g.glitchTimer <= 0) {
        if (g.glitchTimer > -1) g.glitch();  // (a brand-new ghost starts below -1: just set its timer)
        g.glitchTimer = THREE.MathUtils.randFloat(...cfg.glitch);
      }
    }
    const ev = g.update(dt, player, shield.barrier, potion.visionActive, lookDir);
    if (g.justBlocked) {
      // the ghost bumped into the pentagram's dome
      g.justBlocked = false;
      fx.zap(g.chestPosition(_v1));
      audio.zap(g.body);
    }
    if (!ev) continue;
    if (ev.type === 'step') {
      trail.add(ev.kind, ev.at, ev.dir, ev.color);
      onGhostStep(g, ev.dist);
    }
    else if (ev.type === 'caught' && state === 'playing' && !safe) onCaught(g);
  }
  ghosts = ghosts.filter((g) => g.state !== 'gone');

  if (state === 'over' && mode === 'vr' && !vrMenu.visible && now - overAt > RESTART_DELAY) {
    hud.setMessage();
    vrMenu.show({
      title: 'GAME OVER',
      subtitle: `The ${AREAS[areaIndex].label.toLowerCase()} got you… try this part again`,
      action: 'TRY AGAIN',
    }, camera);
  }

  updateSpells(dt);
  hud.setStatus({
    lives, maxLives: START_LIVES, score,
    shield: state === 'playing' ? { state: shield.state, seconds: shield.secondsLeft, progress: shield.progress } : null,
    vision: potion.visionActive ? potion.secondsLeft : 0,
    goal: state === 'playing' && phase === 'fight' ? { done: goalDone, need: AREAS[areaIndex].goal } : null,
  });
}

// the potion of visibility: walk over it to see the ghosts for 15 seconds
function updatePotion(dt) {
  const event = potion.update(dt, player, state === 'playing');
  if (event === 'appear') {
    hud.toast('A potion of visibility! Listen for the bubbling and walk over it', 3);
  } else if (event === 'drink') {
    hud.toast('You can see the ghosts for 15 seconds!', 2.2);
    hud.flash(0x3dff9a, 0.35);
    for (const c of controllers) pulse(c, 0.5, 120);
  } else if (event === 'gone') {
    hud.toast('The potion vanished…', 1.6);
  } else if (event === 'tick') {
    audio.tick();
  } else if (event === 'visionEnd') {
    audio.visionEnd();
    hud.toast('The ghosts are invisible again', 1.6);
  }
}

// the pentagram: step in while it is charged for 10 seconds of protection
function updateShield(dt) {
  const event = shield.update(dt, player, state === 'playing');
  if (event === 'up') {
    audio.shieldUp();
    hud.toast('The pentagram protects you for 10 seconds!', 2);
    for (const c of controllers) pulse(c, 0.6, 150);
  } else if (event === 'down') {
    audio.shieldDown();
    hud.toast('Protection gone! The pentagram is recharging…', 2.2);
  } else if (event === 'ready' && state === 'playing') {
    audio.shieldReady();
    hud.toast('The pentagram is ready again', 1.8);
  } else if (event === 'tick') {
    audio.tick();
  }
  room.setCircle(shield.state, shield.progress);
}

// VR colors: some Quest Browser versions convert colors for the display a second
// time, which makes everything look pale and washed out. The B / Y button switches
// to "vivid" (the game skips its own conversion); the choice is remembered.
let vividColors = false;
try { vividColors = localStorage.getItem('maxiween-vivid') === '1'; } catch {}

function updateVrColors() {
  for (const c of controllers) {
    const pressed = Boolean(c.userData.source?.gamepad?.buttons?.[5]?.pressed);   // B (right) or Y (left)
    if (pressed && !c.userData.colorButtonDown) {
      vividColors = !vividColors;
      try { localStorage.setItem('maxiween-vivid', vividColors ? '1' : '0'); } catch {}
      hud.toast(vividColors ? 'Colors: vivid (press B again to switch back)' : 'Colors: normal (press B for vivid)', 2);
    }
    c.userData.colorButtonDown = pressed;
  }
  // in VR the render target is the headset's framebuffer; its color space decides the conversion
  const target = renderer.getRenderTarget();
  if (target?.isXRRenderTarget) target.texture.colorSpace = vividColors ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;
}

// walking: W A S D on the laptop; in VR the left stick walks and the right stick turns
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
function updateLocomotion(dt) {
  if (paused || state !== 'playing') return;   // (not while fading between areas)
  let ahead = 0, side = 0;
  if (mode === 'laptop') {
    ahead = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    side = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  } else if (mode === 'vr') {
    for (const c of controllers) {
      const source = c.userData.source;
      const axes = source?.gamepad?.axes;
      if (!axes) continue;
      const x = (axes.length >= 4 ? axes[2] : axes[0]) || 0;
      const y = (axes.length >= 4 ? axes[3] : axes[1]) || 0;
      if (source.handedness === 'right') {
        // snap turn 30° once per push of the stick
        if (Math.abs(x) > 0.7 && c.userData.turnReady !== false) {
          snapTurn(rig, camera, -Math.sign(x) * Math.PI / 6);
          c.userData.turnReady = false;
        } else if (Math.abs(x) < 0.3) {
          c.userData.turnReady = true;
        }
      } else if (Math.hypot(x, y) > 0.15) {
        ahead = -y;
        side = x;
      }
    }
  }
  const amount = Math.hypot(ahead, side);
  if (amount === 0) return;
  const scale = (Math.min(1, amount) / amount) * WALK_SPEED * dt;  // diagonals aren't faster
  floorDirections(camera, _fwd, _right);
  walk(rig, camera, (_fwd.x * ahead + _right.x * side) * scale, (_fwd.z * ahead + _right.z * side) * scale);
}

// ---- input ----------------------------------------------------------------

function onTrigger(controller) {
  audio.init();
  if (vrMenu.visible) {
    onMenuPick(vrMenu.pick(controller));
    return;
  }
  if (state !== 'playing') return;
  // spells fly out of the wand's crystal
  const origin = controller.userData.wand.userData.tip.getWorldPosition(new THREE.Vector3());
  const dir = controller.getWorldDirection(new THREE.Vector3()).negate();  // controllers point down -Z
  cast(origin, dir, controller);
}

// a button on the VR menu panel was clicked
function onMenuPick(id) {
  if (!id) return;
  const [kind, value] = id.split(':');
  if (kind === 'level') setLevel(value);
  else if (kind === 'style') setRoomStyle(value);
  else if (kind === 'area') setStartArea(Number(value));
  else if (kind === 'start') {
    if (state === 'over') beginArea(areaIndex);   // TRY AGAIN: this part of the house
    else startGame(state === 'escaped' ? 0 : startArea);
  }
}

// laptop: the mouse stands in for turning your head
let yaw = 0;
let pitch = 0;
const keys = new Set();
const canvas = renderer.domElement;

function laptopCast() {
  if (tryStart()) return;
  const dir = camera.getWorldDirection(new THREE.Vector3());
  // spells fly out of the wand's crystal
  const origin = laptopWand.userData.tip.getWorldPosition(new THREE.Vector3());
  cast(origin, dir);
}

canvas.addEventListener('mousedown', (e) => {
  if (mode !== 'laptop' || paused) return;
  if (document.pointerLockElement !== canvas) {
    canvas.requestPointerLock()?.catch?.(() => {});
    return;
  }
  if (e.button === 0) laptopCast();
});

document.addEventListener('mousemove', (e) => {
  if (mode !== 'laptop' || document.pointerLockElement !== canvas) return;
  yaw -= e.movementX * 0.0022;
  pitch = THREE.MathUtils.clamp(pitch - e.movementY * 0.0022, -1.55, 1.55);
});

document.addEventListener('keydown', (e) => {
  if (mode !== 'laptop') return;
  if (e.code === 'Space' && !e.repeat && !paused) { e.preventDefault(); laptopCast(); }
  if (e.code === 'Escape') pause();
  if (e.code === 'KeyR' && !e.repeat && !paused) {
    setRoomStyle(roomStyle === 'realistic' ? 'outline' : 'realistic');
    hud.toast(`Room: ${roomStyle === 'realistic' ? 'Realistic' : 'Glow outlines'} (press R to switch)`, 1.8);
  }
  keys.add(e.code);
});
document.addEventListener('keyup', (e) => keys.delete(e.code));

document.addEventListener('pointerlockchange', () => {
  if (mode === 'laptop' && document.pointerLockElement !== canvas) pause();
});

// ---- menu -----------------------------------------------------------------

const menu = document.getElementById('menu');
const splash = document.getElementById('splash');
const vrStatus = document.getElementById('vr-status');
const laptopBtn = document.getElementById('play-laptop');
const vrBtn = document.getElementById('play-vr');
const mrBtn = document.getElementById('play-mr');
const vrNote = document.getElementById('vr-note');
const styleButtons = document.querySelectorAll('#styles button');
const levelButtons = document.querySelectorAll('#levels .level');
const levelNote = document.getElementById('level-note');

function setLevel(name, remember = true) {
  if (!DIFFICULTIES[name]) return;
  if (name !== level && mode === 'laptop') restartOnContinue = true;
  level = name;
  cfg = DIFFICULTIES[name];
  audio.stereoBoost = cfg.stereo;
  horror.intensity = cfg.horror;
  trail.brightness = cfg.trail;
  levelNote.textContent = cfg.note;
  vrMenu.setSelection({ level: name, levelNote: cfg.note });
  for (const b of levelButtons) b.classList.toggle('selected', b.dataset.level === name);
  if (remember) {
    try { localStorage.setItem('maxiween-level', name); } catch {}
  }
}

for (const b of levelButtons) b.addEventListener('click', () => setLevel(b.dataset.level));

// where in the house the next game starts: any part already reached
const areaBox = document.getElementById('areas');
function setStartArea(index) {
  if (index > progress) return;
  if (index !== startArea && mode === 'laptop') restartOnContinue = true;
  startArea = index;
  updateAreaChoice();
}
function updateAreaChoice() {
  areaBox.innerHTML = '';
  AREAS.forEach((a, i) => {
    const button = document.createElement('button');
    button.textContent = i <= progress ? a.label : `🔒 ${a.label}`;
    button.disabled = i > progress;
    button.classList.toggle('selected', i === startArea);
    button.addEventListener('click', () => setStartArea(i));
    areaBox.appendChild(button);
  });
  vrMenu.setSelection({ areas: AREAS.map((a, i) => ({ label: a.label, unlocked: i <= progress })), start: startArea });
}
updateAreaChoice();
let savedLevel = 'easy';
try { savedLevel = localStorage.getItem('maxiween-level') || 'easy'; } catch {}
setLevel(savedLevel, false);

function pause() {
  if (paused || mode !== 'laptop') return;
  paused = true;
  audio.suspend();
  laptopBtn.textContent = 'Continue';
  menu.classList.remove('hidden');
}

// splash -> menu; the click also unlocks sound, so the menu has spooky wind
splash.addEventListener('click', () => {
  audio.init();
  audio.start();
  splash.classList.add('leaving');
  setTimeout(() => {
    splash.classList.add('hidden');
    // buttons ignore clicks while the menu slides in, so a double-click on
    // the splash can't land on whatever button appears under the mouse
    menu.classList.add('arming');
    menu.classList.remove('hidden');
    setTimeout(() => menu.classList.remove('arming'), 900);
  }, 450);
}, { once: true });

laptopBtn.addEventListener('click', () => {
  audio.init();
  menu.classList.add('hidden');
  canvas.requestPointerLock()?.catch?.(() => {});
  hud.setCrosshair(true);
  if (mode !== 'laptop' || restartOnContinue) {
    mode = 'laptop';
    restartOnContinue = false;
    startGame();
  }
  paused = false;
});

// realistic/outline room, or nothing at all in mixed reality so the real room shows
function applyRoomStyle() {
  room.setStyle(mixedReality ? 'mr' : roomStyle);
  scene.background = mixedReality ? null : new THREE.Color(0x000000);
}

// not remembered between visits: every launch starts in the realistic room,
// so a stray click on "Glow outlines" can't stick
function setRoomStyle(name) {
  if (name !== 'realistic' && name !== 'outline') return;
  roomStyle = name;
  for (const b of styleButtons) b.classList.toggle('selected', b.dataset.style === name);
  vrMenu.setSelection({ style: name });
  applyRoomStyle();
}

for (const b of styleButtons) b.addEventListener('click', () => setRoomStyle(b.dataset.style));
setRoomStyle('realistic');

async function startHeadset(sessionType) {
  audio.init();
  try {
    const session = await navigator.xr.requestSession(sessionType, { optionalFeatures: ['local-floor'] });
    await renderer.xr.setSession(session);
    mode = 'vr';
    splash.classList.add('hidden');
    mixedReality = sessionType === 'immersive-ar';
    vrMenu.setSelection({ mixedReality });
    applyRoomStyle();
    paused = false;
    menu.classList.add('hidden');
    hud.setCrosshair(false);
    showReady();
    session.addEventListener('end', () => {
      mode = 'none';
      mixedReality = false;
      vrMenu.hide();
      applyRoomStyle();
      laptopBtn.textContent = 'Play on laptop';
      menu.classList.remove('hidden');
      showReady();
    });
  } catch (err) {
    vrNote.textContent = `Could not start: ${err.message}`;
  }
}

vrBtn.addEventListener('click', () => startHeadset('immersive-vr'));

// launched as an installed app on the Quest: the headset offers a VR session
// right away, so the game starts in VR like any other game, no button needed
navigator.xr?.addEventListener?.('sessiongranted', () => startHeadset('immersive-vr'));

// keep a copy of the game on the device so the installed app works offline (see sw.js)
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
mrBtn.addEventListener('click', () => startHeadset('immersive-ar'));

if (navigator.xr) {
  Promise.all([
    navigator.xr.isSessionSupported('immersive-vr').catch(() => false),
    navigator.xr.isSessionSupported('immersive-ar').catch(() => false),
  ]).then(([vr, ar]) => {
    vrBtn.disabled = !vr;
    mrBtn.disabled = !ar;
    vrStatus.classList.toggle('ok', vr);
    if (!vr) vrNote.textContent = 'No VR headset found. Play on the laptop, or install the Immersive Web Emulator extension to fake one.';
    else if (!ar) vrNote.textContent = 'VR headset found. Mixed reality needs a headset that can show your real room (Quest 2, 3 or Pro).';
    else vrNote.textContent = 'Headset found. Mixed reality shows your real room; ghosts come through your real walls.';
  });
} else {
  vrNote.textContent = window.isSecureContext
    ? 'VR is not available in this browser.'
    : 'VR needs https:// or localhost.';
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- main loop ------------------------------------------------------------

// wand tips flare when casting, shrink while recharging, then gently pulse when ready
function updateWandTips(dt) {
  const ready = now - lastCast >= CAST_COOLDOWN;
  const goal = ready ? 1 + 0.3 * Math.sin(now * 6) : 0.4;
  const time = performance.now() / 1000;
  for (const wand of [...controllers.map((c) => c.userData.wand), laptopWand]) {
    wand.userData.power += (goal - wand.userData.power) * Math.min(1, dt * 6);
    wand.userData.update(time, wand.userData.power);
  }
  // no laser line in the game, only as a pointer for the menu
  for (const c of controllers) c.userData.wand.userData.ray.visible = vrMenu.visible;

  // the laptop wand flicks up and forward when casting
  laptopWand.visible = mode === 'laptop' && (state === 'playing' || state === 'transition');
  wandKick = Math.max(0, wandKick - dt * 4);
  laptopWand.quaternion.copy(laptopWandRest);
  laptopWand.rotateX(Math.sin(wandKick * Math.PI) * 0.45);
  laptopWand.position.z = -0.38 - 0.06 * Math.sin(wandKick * Math.PI);
}

// open with ?debug to inspect performance from the browser console (debug.renderer.info)
if (new URLSearchParams(location.search).has('debug')) window.debug = {
  renderer, scene, camera, vrMenu, rig, shield, scares, potion, horror, key,
  room: () => room,
  info: () => ({ lives, score, state, dread: Boolean(audio.dread), area: room.info.id, phase, goalDone, progress }),
  // jump to a part of the house: debug.goto(1)
  goto: (index) => beginArea(index),
  reachGoal: () => { goalDone = AREAS[areaIndex].goal; onGoalReached(); },
  moveTo: (x, z) => { rig.position.set(x, 0, z); rig.updateMatrixWorld(true); },
  hitAll: () => ghosts.filter((g) => g.alive).forEach((g) => onHit(g)),
  ghosts: () => ghosts.map((g) => ({ type: g.type, hp: g.hp, x: +g.pos.x.toFixed(2), z: +g.pos.z.toFixed(2), frozen: g.frozen, boss: Boolean(g.isBoss) })),
  spawn: (type) => spawnGhost(type),
  look: (yawValue) => { yaw = yawValue; },
  glitchAll: () => ghosts.forEach((g) => g.glitch()),
  // try the demon right away: debug.spawnDemon()
  spawnDemon: () => { audio.stinger(); ghosts.push(new Ghost(scene, audio, { type: 'demon', angle: playerYaw(), speed: 0.5, pitch: 1, head: player })); },
};

const clock = new THREE.Clock();
showReady();
hud.setStatus({ lives, maxLives: START_LIVES, score });
hud.setCrosshair(false);

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);

  if (renderer.xr.isPresenting) {
    // move first, then read this frame's headset pose relative to the moved rig
    updateLocomotion(dt);
    rig.updateMatrixWorld(true);
    renderer.xr.updateCamera(camera);
  } else {
    const turn = (keys.has('ArrowLeft') ? 1 : 0) - (keys.has('ArrowRight') ? 1 : 0);
    const tilt = (keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0);
    if (!paused) {
      yaw += turn * 2.2 * dt;
      pitch = THREE.MathUtils.clamp(pitch + tilt * 1.5 * dt, -1.55, 1.55);
    }
    // attract mode: before a game, the room slowly pans behind the menu
    if (mode === 'none') {
      yaw += dt * 0.07;
      pitch += (-0.06 - pitch) * Math.min(1, dt * 2);
    }
    camera.position.set(0, EYE_HEIGHT, 0);
    camera.rotation.set(pitch, yaw, 0);
    rig.updateMatrixWorld(true);
    updateLocomotion(dt);
  }

  camera.getWorldPosition(player);
  audio.updateListener(camera.matrixWorld);

  if (!paused) {
    now += dt;
    updateTransition(dt);
    updateGame(dt);
  }
  room.update(dt);
  if (!paused) {
    trail.update(dt);
    fx.update(dt, camera);
    scares.update(dt, camera, state === 'playing', ghosts.some((g) => g.type === 'demon' && g.alive));
    horror.update(dt, camera, state === 'playing');
    // background music, pushed back while the demon's own music plays
    audio.updateMusic(Boolean(audio.dread));
  }
  updateWandTips(dt);
  vrMenu.update(dt, controllers);
  hud.setVisible(mode !== 'none');
  hud.setCrosshair(mode === 'laptop' && state === 'playing');
  hud.update(dt);
  if (renderer.xr.isPresenting) updateVrColors();
  renderer.render(scene, camera);
});
