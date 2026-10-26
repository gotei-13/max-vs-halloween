import * as THREE from '../vendor/three.module.js';
import { SpookyAudio } from './audio.js';
import { createRoom } from './room.js';
import { createHallway, createStairwell, createFoyer, createYard } from './house.js';
import { Ghost } from './ghost.js';
import { Key, LifePumpkin, HolyBell } from './key.js';
import { Hud } from './hud.js';
import { Trail } from './trail.js';
import { SpellFx } from './fx.js';
import { VrMenu } from './vrmenu.js';
import { Shield } from './shield.js';
import { Scares } from './scares.js';
import { Horror } from './horror.js';
import { Potion } from './potion.js';
import { FireCrystal } from './powerup.js';
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
// lives / maxLives: pumpkins at the start of a run, and the most you can collect
const DIFFICULTIES = {
  easy: {
    aim: 35, speed: 0.35, speedStep: 0.03, maxSpeed: 1.0, maxGhosts: 1, trail: 0.9, stereo: 0.8, glitch: [5, 8], horror: 0.8, lives: 4, maxLives: 6,
    note: 'Glowing traces show where ghosts move · slow ghosts · one at a time',
  },
  normal: {
    aim: 22, speed: 0.45, speedStep: 0.05, maxSpeed: 1.4, maxGhosts: 2, trail: 0.35, stereo: 0.5, glitch: [7, 11], horror: 1, lives: 3, maxLives: 5,
    note: 'Faint traces · a miss brings a second ghost',
  },
  hard: {
    aim: 15, speed: 0.55, speedStep: 0.06, maxSpeed: 1.7, maxGhosts: 2, trail: 0, stereo: 0, glitch: [10, 16], horror: 1.3, lives: 3, maxLives: 4,
    note: 'Sound only · fast ghosts',
  },
};
// The haunted house, one area after another, each harder than the last. In each
// area banish `goal` creatures (first the ones in `plan`, then any of `types`),
// up to `together` at once, moving `speed` times faster. `life`: an extra life appears
// halfway through (only in some areas). Then a key appears and,
// when you grab it, `chase` creatures come after you: RUN to the door! In the
// yard the guardian comes instead, and after it a horde chases you to the gate.
const AREAS = [
  {
    build: createRoom, label: 'Bedroom', title: 'THE BEDROOM', goal: 5, together: 1, speed: 1.0, chase: 0, chaser: 'walker',
    plan: ['walker', 'flyer', 'crawler', 'walker', 'flyer'], types: ['walker', 'flyer', 'crawler'],
    intro: 'Escape the haunted house! Banish 5 ghosts to find the key',
  },
  {
    build: createHallway, label: 'Hallway', title: 'THE HALLWAY', goal: 6, together: 2, speed: 1.1, chase: 2, chaser: 'walker', life: true,
    plan: ['shadow', 'walker', 'shadow', 'demon', 'flyer', 'shadow'], types: ['shadow', 'walker', 'flyer'],
    intro: 'Banish 6. Shadow people only move when you are NOT looking at them!',
  },
  {
    build: createStairwell, label: 'Stairs', title: 'THE STAIRCASE', goal: 7, together: 2, speed: 1.2, chase: 2, chaser: 'wraith',
    plan: ['bats', 'bats', 'wraith', 'bats', 'demon', 'wraith', 'bats'], types: ['bats', 'wraith', 'flyer', 'crawler'],
    intro: 'Chase away 7 creatures. Beware the wraiths: they blink closer!',
  },
  {
    build: createFoyer, label: 'Front hall', title: 'THE ENTRANCE HALL', goal: 8, together: 2, speed: 1.3, chase: 3, chaser: 'skeleton', life: true,
    plan: ['skeleton', 'walker', 'demon', 'skeleton', 'shadow', 'skeleton', 'demon', 'wraith'],
    types: ['skeleton', 'wraith', 'shadow', 'walker', 'flyer', 'crawler'],
    intro: 'Banish 8. Skeletons need 2 hits! The front door key is here somewhere',
  },
  {
    build: createYard, label: 'Yard', title: 'THE GRAVEYARD', goal: 10, together: 3, speed: 1.4, chase: 0, chaser: 'werewolf',
    plan: ['zombie', 'zombie', 'werewolf', 'demon', 'zombie', 'skeleton', 'zombie', 'werewolf', 'demon', 'werewolf'],
    types: ['zombie', 'zombie', 'werewolf', 'skeleton', 'wraith', 'bats'],
    boss: { hp: 6 }, horde: ['werewolf', 'zombie'],
    intro: 'Almost out! The dead are rising. Banish 10… then the guardian of the gate comes',
  },
];
const RUN_SPEED = 2;       // running is this many times faster than walking
const STAMINA_TIME = 4;    // seconds of running on a full bar
const STAMINA_REFILL = 5;  // seconds to fill it again
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
const fire = new FireCrystal(scene, audio);
const horror = new Horror(scene, audio, room);
const key = new Key(scene, audio);
const lifePumpkin = new LifePumpkin(scene, audio);
const holyBell = new HolyBell(scene, audio);

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
  demon: 'A RED DEMON! 3 hits to banish it, and it takes 2 lives if it catches you!',
  shadow: 'A shadow person! It only moves when you are NOT looking. Turn to its soft steps to freeze it',
  bats: 'Bats! Listen for the fluttering wings above and below you',
  wraith: 'A WRAITH! Listen for its chains. It blinks closer, so be quick!',
  skeleton: 'A SKELETON! Rattling bones. It takes 2 hits!',
  werewolf: 'A WEREWOLF! It howls, then sprints at you. 2 hits!',
  zombie: 'ZOMBIES! They climb out of the graves. 2 hits!',
};
const SPEEDS = { demon: 1.15, shadow: 1.35, bats: 1.1, wraith: 1.25, skeleton: 0.95, werewolf: 1.0, zombie: 0.75 };
const NAMES = { demon: 'demon', skeleton: 'skeleton', werewolf: 'werewolf', zombie: 'zombie' };

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
let runStart = 0;       // where the current run started (only runs from the bedroom set records)
let lifeShown = false;  // this area's extra life has appeared
let bellArea = 1;       // the one area of this run where the Holy Bell appears
let bellShown = false;  // it has appeared this run (it only ever comes once)
let hasBell = false;    // the player carries it, ready to ring
try { progress = Math.min(AREAS.length - 1, Number(localStorage.getItem('maxiween-progress')) || 0); } catch {}
startArea = progress;
const lookDir = new THREE.Vector3();
let stamina = 1;          // 0..1 for running
let exhausted = false;    // ran the bar empty: wait until it refills a bit
let running = 0;          // 0..1, smoothed, for the view edges
let hordeTimer = 0;       // the yard after the boss: seconds until the next chaser
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

// faster in later areas, and a bit faster with every creature banished in the area
function ghostSpeed() {
  return Math.min(cfg.speed + goalDone * cfg.speedStep, cfg.maxSpeed) * AREAS[areaIndex].speed;
}

// how many creatures may hunt at once: the area's number, one less on Easy, one more on Hard
function together() {
  const n = AREAS[areaIndex].together + (level === 'easy' ? -1 : level === 'hard' ? 1 : 0);
  return Math.max(1, Math.min(n, AREAS[areaIndex].goal - goalDone));
}

function clearWorld() {
  for (const g of ghosts) g.dispose();
  for (const s of spells) fx.removeOrb(s.orb);
  trail.clear();
  fx.clear();
  scares.reset();
  potion.reset();
  fire.reset();
  horror.reset();
  audio.stopDread();
  key.hide();
  lifePumpkin.hide();
  holyBell.hide();   // not picked up in its area: gone for this run
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
  fire.setArea(info);
  scares.setArea(info);
  scene.fog = info.outdoor ? new THREE.FogExp2(0x070a14, 0.045) : null;
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
  phase = 'fight';
  lifeShown = false;
  goalDone = 0;
  areaSpawns = 0;
  exitOpen = 0;
  state = 'playing';
  stamina = 1;
  exhausted = false;
  vrMenu.hide();
  hud.setMessage();
  hud.announce(AREAS[index].title, AREAS[index].intro, 5);
  audio.areaStinger();
  audio.musicTension = index / (AREAS.length - 1);
  scheduleSpawn(3.5);
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
    hud.announce('THE GUARDIAN', 'The ground shakes… something huge is coming through the gate!', 3.5);
    fire.soon(0.5);   // a fire crystal to fight it with
    setTimeout(() => { if (phase === 'boss' && state === 'playing') spawnBoss(); }, 4000);
  } else if (info.noKey) {
    openExit(a.chase ? 'The way down is clear! Something is coming… RUN for the stairs!' : 'The way down is clear!', a.chase);
  } else {
    phase = 'key';
    key.show(info.keySpot.x, info.keySpot.z);
    hud.toast('A key appeared! Listen for its chime and walk over it', 3);
  }
}

// the way to the next area opens; chasers: creatures that come after you now, RUN!
function openExit(message, chasers = 0) {
  phase = 'exit';
  horror.allowDoor = false;
  horror.reset();
  const info = room.info;
  audio.at(info.exitPoint, (voice) => audio.unlock(voice));
  exitMarker.position.set(info.exitZone.x, 0, info.exitZone.z);
  exitMarker.visible = true;
  if (chasers > 0) {
    hud.announce('RUN!', message, 3);
    audio.stinger();
    for (let i = 0; i < chasers; i++) setTimeout(() => { if (phase === 'exit' && state === 'playing') spawnChaser(); }, 600 + i * 1400);
  } else {
    hud.toast(message, 3.5);
  }
}

// a creature that comes after you from behind, fast (in the yard: werewolves, or zombies from the graves)
function spawnChaser() {
  const a = AREAS[areaIndex];
  const type = a.horde && phase === 'exit' ? a.horde[Math.floor(Math.random() * a.horde.length)] : a.chaser;
  const angle = playerYaw() + Math.PI + (Math.random() - 0.5) * 0.8;
  spawnGhost(type, { angle, chaser: true });
}

// a grave for a zombie to climb out of: not too close to the player, not too far
function pickGrave() {
  const graves = room.info.graves;
  if (!graves) return null;
  const fits = graves.filter((g) => {
    const d = Math.hypot(g.x - player.x, g.z - player.z);
    return d > 3.5 && d < 11;
  });
  const list = fits.length ? fits : graves;
  return list[Math.floor(Math.random() * list.length)];
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
      // outside the gate: free! the moonlit night, with celebration sparkles
      for (const g of ghosts) g.dispose();
      ghosts = [];
      const gate = room.info.exitPoint;
      rig.position.set(gate.x, 0, gate.z - 2);
      rig.rotation.set(0, 0, 0);
      rig.updateMatrixWorld(true);
      yaw = 0;
      pitch = 0.15;
      for (let i = 0; i < 6; i++) setTimeout(() => fx.hit(_v3.set(gate.x + (Math.random() - 0.5) * 3, 2.2 + Math.random(), gate.z - 6), i % 2 === 0), 300 + i * 400);
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

// out of the gate: the end! Fade to black, then stand outside the graveyard, free
function escape() {
  state = 'escaped';
  overAt = now;
  exitMarker.visible = false;
  audio.stopDread();
  audio.win();
  // nothing may talk over the victory
  potion.reset();
  fire.reset();
  scares.reset();
  horror.reset();
  transition = { t: 0, escape: true, swapped: false };
  const isRecord = recordRun(true);
  const line = `${isRecord ? 'NEW RECORD! ' : ''}${score} banished in ${formatTime(Math.round(now - playStart))}`;
  if (mode === 'vr') {
    setTimeout(() => vrMenu.show({ title: 'YOU ESCAPED!', subtitle: line, action: 'PLAY AGAIN' }, camera), 2500);
  } else {
    hud.setMessage('YOU ESCAPED!', `${line}\nClick to play again`);
  }
}

// ---- best runs (per difficulty, saved on this device) ----------------------

function loadBest(name = level) {
  try { return JSON.parse(localStorage.getItem(`maxiween-best-${name}`)) || null; } catch { return null; }
}

// how good a run is: escaping beats everything (faster is better), then how far you got and how many you banished
function runValue(run) {
  return run.escaped ? 1e6 - run.time : run.area * 1e4 + run.score;
}

function formatTime(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function describeRun(run) {
  if (!run) return '';
  return run.escaped
    ? `escaped in ${formatTime(run.time)} · ${run.score} banished`
    : `reached the ${AREAS[run.area].label.toLowerCase()} · ${run.score} banished`;
}

// save this run if it beats the best one; returns true for a new record
function recordRun(escaped) {
  if (runStart !== 0) return false;   // runs started further in don't count
  const run = { escaped, area: areaIndex, score, time: Math.round(now - playStart) };
  const best = loadBest();
  if (best && runValue(best) >= runValue(run)) return false;
  try { localStorage.setItem(`maxiween-best-${level}`, JSON.stringify(run)); } catch {}
  showBest();
  return true;
}

function showBest() {
  const best = loadBest();
  bestNote.textContent = best ? `Best on ${level}: ${describeRun(best)}` : 'No record yet on this level: escape the house to set one!';
}

// the red demon guards the gate
function spawnBoss() {
  audio.stinger();
  const from = room.info.bossFrom;
  const angle = Math.atan2(from.x - player.x, -(from.z - player.z));
  spawnGhost('demon', { angle, hp: AREAS[areaIndex].boss.hp, boss: true });
  hud.toast(`THE GUARDIAN: a giant red demon! ${AREAS[areaIndex].boss.hp} hits to banish it. Use the fire crystal!`, 3.5);
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
    if (now - overAt > RESTART_DELAY) startGame(state === 'over' ? runStart : 0);   // a whole new run
    return true;
  }
  return false;
}

// a new run through the house, from the chosen area
function startGame(from = startArea) {
  score = 0;
  lives = cfg.lives;
  runStart = from;
  // the Holy Bell hides in one random area of the run (never the bedroom)
  bellArea = Math.max(from, 1) + Math.floor(Math.random() * (AREAS.length - Math.max(from, 1)));
  bellShown = false;
  hasBell = false;
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
  fire.reset();
  horror.reset();
  audio.gameOver();
  key.hide();
  exitMarker.visible = false;
  lifePumpkin.hide();
  const isRecord = recordRun(false);
  gameOverLine = `${isRecord ? 'NEW RECORD! ' : ''}The ${AREAS[areaIndex].label.toLowerCase()} got you · ${score} banished`;
  // in VR the menu panel with "Play again" follows shortly (see updateGame)
  hud.setMessage('GAME OVER', mode === 'vr' ? gameOverLine : `${gameOverLine}\nClick to play again from the start`);
}

let gameOverLine = '';

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

function spawnGhost(type = nextAreaType(), { angle: fixedAngle, hp, boss = false, chaser = false } = {}) {
  let angle = fixedAngle;
  const at = type === 'zombie' ? pickGrave() : null;
  if (at && !seenTypes.has(type)) {
    seenTypes.add(type);
    hud.toast(GHOST_INTROS.zombie, 3);
  }
  const spawnAngles = room.info.spawnAngles;
  if (angle !== undefined) {
    if (!seenTypes.has(type) && GHOST_INTROS[type]) hud.toast(GHOST_INTROS[type], 3);
    seenTypes.add(type);
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
  else if (type === 'wraith') elevation = THREE.MathUtils.randFloat(0.3, 0.8);
  const speed = ghostSpeed() * (SPEEDS[type] || 1) * (chaser ? 1.5 : 1);
  const ghost = new Ghost(scene, audio, {
    type, angle, elevation, speed, pitch: 0.85 + Math.random() * 0.3, head: player, hp, at,
  });
  ghost.isBoss = boss;
  ghosts.push(ghost);
}

// ---- casting spells -------------------------------------------------------

function cast(origin, dir, controller = null) {
  const fireOn = fire.fireActive;
  if (now - lastCast < (fireOn ? 0.2 : CAST_COOLDOWN)) return;
  lastCast = now;
  if (fireOn) audio.fireCast();
  else audio.cast();
  room.flash(fireOn ? 0.8 : 0.5);
  fx.cast(origin, dir, fireOn);
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
  let best = THREE.MathUtils.degToRad(cfg.aim + (fireOn ? 10 : 0));
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

  const orb = fx.makeOrb(fireOn);
  orb.position.copy(origin);
  const vel = dir.clone().normalize().multiplyScalar(SPELL_SPEED);
  spells.push({ orb, vel, target, harmless, life: target ? 2 : 0.6, controller, fire: fireOn });
}

function updateSpells(dt) {
  for (const s of spells) {
    s.life -= dt;
    if (s.target) {
      // curve toward the ghost: steer the velocity a bit more each frame
      const to = s.target.chestPosition(_v1).sub(s.orb.position);
      const dist = to.length();
      if (dist < SPELL_SPEED * dt + 0.25 || s.life <= 0) {
        fx.hit(s.target.chestPosition(_v1), s.target.type === 'demon' || s.fire);
        onHit(s.target, s.controller, s.fire ? 2 : 1);
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

// damage: 2 for a fireball
function onHit(ghost, controller, damage = 1) {
  if (ghost.state !== 'hunting') return;
  if (ghost.hp > damage) {
    // tougher creatures need more than one hit
    ghost.hurt(player, damage);
    room.flash(0.8);
    const name = ghost.isBoss ? 'guardian' : NAMES[ghost.type] || 'creature';
    hud.toast(`The ${name} is hurt! ${ghost.hp} more hit${ghost.hp === 1 ? '' : 's'}!`, 1.8);
    if (controller) pulse(controller, 0.9, 150);
    return;
  }
  ghost.banish();
  room.flash(1);
  score++;
  if (controller) pulse(controller, 0.7, 120);
  if (ghost.isBoss) {
    room.setExit(0);
    hordeTimer = 2;
    openExit('You beat the guardian! The gate is opening… they are all coming. RUN TO THE GATE!', 2);
    return;
  }
  if (phase !== 'fight') return;
  goalDone++;
  const need = AREAS[areaIndex].goal;
  if (areaIndex === bellArea && !bellShown && goalDone >= 2 && goalDone < need) {
    bellShown = true;
    const spot = freeSpot();
    holyBell.show(spot.x, spot.z);
    hud.announce('THE HOLY BELL', 'It appears only ONCE in the whole game! Listen for it and grab it', 3.5);
    return;
  }
  if (goalDone >= need) onGoalReached();
  else if (AREAS[areaIndex].life && !lifeShown && goalDone >= Math.ceil(need / 2)) {
    lifeShown = true;
    const spot = freeSpot();
    lifePumpkin.show(spot.x, spot.z);
    hud.toast('An EXTRA LIFE appeared! Listen for its chime and grab it', 3);
  } else hud.toast(`Banished! ${goalDone} of ${need}`, 1.4);
}

// a free spot in the area: not in furniture, not on the pentagram, not too close to the player
function freeSpot() {
  const { bounds: b, obstacles, circle, keySpot } = room.info;
  const marginX = Math.min(1, (b.maxX - b.minX) / 2 - 0.5);
  for (let tries = 0; tries < 40; tries++) {
    const x = THREE.MathUtils.randFloat(b.minX + marginX, b.maxX - marginX);
    const z = THREE.MathUtils.randFloat(b.minZ + 1, b.maxZ - 1);
    if (Math.hypot(x - circle.x, z - circle.z) < 1.8 || Math.hypot(x - player.x, z - player.z) < 3) continue;
    if (obstacles.some(([x0, x1, z0, z1]) => x > x0 - 0.5 && x < x1 + 0.5 && z > z0 - 0.5 && z < z1 + 0.5)) continue;
    return { x, z };
  }
  return keySpot || { x: circle.x + 1.5, z: circle.z };
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
    if (huntingGhosts().length + spawnTimes.length < together()) scheduleSpawn(1.2 + Math.random() * 1.8);
  }
  if (state === 'playing' && lifePumpkin.update(dt, player) === 'picked') {
    lives = Math.min(cfg.maxLives, lives + 1);
    hud.announce('+1 LIFE', `${lives} lives`, 2);
    hud.flash(0xff9a40, 0.3);
    for (const c of controllers) pulse(c, 0.6, 150);
  }
  if (state === 'playing' && holyBell.update(dt, player) === 'picked') {
    hasBell = true;
    hud.announce('YOU HAVE THE HOLY BELL', mode === 'vr' ? 'Press A or X to ring it: it banishes every creature around you. Only once!'
      : 'Press E to ring it: it banishes every creature around you. Only once!', 4);
    for (const c of controllers) pulse(c, 0.6, 150);
  }
  if (state === 'playing' && phase === 'key' && key.update(dt, player) === 'picked') {
    const a = AREAS[areaIndex];
    const where = room.info.id === 'bedroom' ? 'The door unlocked! Walk through it'
      : room.info.id === 'foyer' ? 'The front door unlocked! Get outside!' : 'The door at the end unlocked!';
    openExit(a.chase ? `${where} Something is coming after you!` : where, a.chase);
  }
  // after the guardian: the dead keep coming until you are out of the gate
  if (state === 'playing' && phase === 'exit' && AREAS[areaIndex].horde) {
    hordeTimer -= dt;
    if (hordeTimer <= 0 && huntingGhosts().length < 4) {
      hordeTimer = 2.4;
      spawnChaser();
    }
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
  updateFire(dt);
  const safe = shield.active && shield.contains(player);
  updateAdrenaline(dt);

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
      subtitle: gameOverLine,
      action: 'PLAY AGAIN',
    }, camera);
  }

  updateSpells(dt);
  hud.setStatus({
    lives, maxLives: Math.max(cfg.lives, lives), score,
    shield: state === 'playing' ? { state: shield.state, seconds: shield.secondsLeft, progress: shield.progress } : null,
    vision: potion.visionActive ? potion.secondsLeft : 0,
    goal: state === 'playing' && phase === 'fight' ? { done: goalDone, need: AREAS[areaIndex].goal } : null,
    fire: fire.fireActive ? fire.secondsLeft : 0,
    stamina,
    bell: hasBell,
  });
}

// the fire crystal: walk over it for 30 seconds of fireballs
function updateFire(dt) {
  const event = fire.update(dt, player, state === 'playing');
  if (event === 'appear') {
    hud.toast('A FIRE CRYSTAL! Listen for the crackling fire and grab it', 3);
  } else if (event === 'pickup') {
    hud.announce('FIRE WAND!', 'Fireballs for 30 seconds: fast and double damage!', 2.5);
    hud.flash(0xff7a20, 0.4);
    for (const c of controllers) pulse(c, 0.8, 200);
  } else if (event === 'gone') {
    hud.toast('The fire crystal burned out…', 1.6);
  } else if (event === 'tick') {
    audio.tick();
  } else if (event === 'fireEnd') {
    audio.fireEnd();
    hud.toast('The fire is out. Back to normal spells', 1.8);
  }
  for (const wand of [...controllers.map((c) => c.userData.wand), laptopWand]) wand.userData.setFire(fire.fireActive);
}

// ring the Holy Bell: every creature around is banished (the guardian loses 3 of its hits)
function ringBell() {
  if (!hasBell || state !== 'playing') return;
  hasBell = false;
  audio.bellBlast();
  room.flash(2);
  hud.flash(0xfff0b0, 0.85);
  for (const c of controllers) pulse(c, 1, 500);
  const targets = huntingGhosts();
  for (const g of targets) {
    fx.hit(g.chestPosition(_v1), true);
    onHit(g, null, g.isBoss ? 3 : 99);
  }
  spawnTimes = spawnTimes.map((t) => Math.max(t, now + 3));   // a moment of peace
  if (state === 'playing' && phase === 'fight') hud.announce('THE BELL RINGS!', `${targets.length} creature${targets.length === 1 ? '' : 's'} banished`, 2.5);
}

// VR: A (right hand) or X (left hand) rings the bell
function updateBellButton() {
  for (const c of controllers) {
    const pressed = Boolean(c.userData.source?.gamepad?.buttons?.[4]?.pressed);
    if (pressed && !c.userData.bellButtonDown) ringBell();
    c.userData.bellButtonDown = pressed;
  }
}

// adrenaline: a heartbeat, pulsing red edges and controller pulses when danger is close
function updateAdrenaline(dt) {
  let danger = 0;
  if (state === 'playing') {
    for (const g of ghosts) {
      if (!g.alive) continue;
      const d = Math.hypot(g.pos.x - player.x, g.pos.z - player.z);
      danger = Math.max(danger, THREE.MathUtils.clamp(1 - (d - 0.7) / 3.5, 0, 1));
    }
    if (lives === 1) danger = Math.max(danger, 0.25);
    if (phase === 'exit' && AREAS[areaIndex].horde) danger = Math.max(danger, 0.4);
  }
  if (audio.updateHeart(dt, danger)) for (const c of controllers) pulse(c, 0.1 + 0.4 * danger, 45);
  hud.setEdges(mode === 'vr' ? running : running * 0.6, danger);
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
  if (paused || state !== 'playing') {   // (not while fading between areas)
    running += (0 - running) * Math.min(1, dt * 6);
    return;
  }
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
  // running: Shift on the laptop; in VR hold a grip button (or click the left stick)
  const wantsRun = mode === 'laptop'
    ? keys.has('ShiftLeft') || keys.has('ShiftRight')
    : controllers.some((c) => c.userData.source?.gamepad?.buttons?.[1]?.pressed || c.userData.source?.gamepad?.buttons?.[3]?.pressed);
  const amount = Math.hypot(ahead, side);
  const isRunning = wantsRun && amount > 0 && !exhausted && stamina > 0;
  if (isRunning) {
    stamina = Math.max(0, stamina - dt / STAMINA_TIME);
    if (stamina === 0) {
      exhausted = true;
      audio.playerPant();
      hud.toast('Out of breath!', 1.2);
    }
  } else {
    stamina = Math.min(1, stamina + dt / STAMINA_REFILL);
    if (stamina > 0.35) exhausted = false;
  }
  running += ((isRunning ? 1 : 0) - running) * Math.min(1, dt * 6);
  if (amount === 0) return;
  const scale = (Math.min(1, amount) / amount) * WALK_SPEED * (isRunning ? RUN_SPEED : 1) * dt;  // diagonals aren't faster
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
    if (state === 'over') startGame(runStart);   // PLAY AGAIN: a whole new run
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
  if (e.code === 'KeyE' && !e.repeat && !paused) ringBell();
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
const bestNote = document.getElementById('best-note');

function setLevel(name, remember = true) {
  if (!DIFFICULTIES[name]) return;
  if (name !== level && mode === 'laptop') restartOnContinue = true;
  level = name;
  cfg = DIFFICULTIES[name];
  audio.stereoBoost = cfg.stereo;
  horror.intensity = cfg.horror;
  trail.brightness = cfg.trail;
  levelNote.textContent = cfg.note;
  showBest();
  const best = loadBest(name);
  vrMenu.setSelection({ level: name, levelNote: best ? `Best: ${describeRun(best)}` : cfg.note });
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
  scene.background = mixedReality ? null : new THREE.Color(room.info.outdoor ? 0x070a14 : 0x000000);
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
  info: () => ({ lives, score, state, dread: Boolean(audio.dread), area: room.info.id, phase, goalDone, progress, best: loadBest() }),
  lifePumpkin,
  // jump to a part of the house: debug.goto(1)
  goto: (index) => beginArea(index),
  reachGoal: () => { goalDone = AREAS[areaIndex].goal; onGoalReached(); },
  fire,
  fireNow: () => { fire.fire = 30; },
  giveBell: () => { hasBell = true; },
  ringBell: () => ringBell(),
  bell: () => ({ bellArea, bellShown, hasBell, active: holyBell.active }),
  stamina: () => stamina,
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
hud.setStatus({ lives, maxLives: cfg.lives, score });
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
  if (renderer.xr.isPresenting) {
    updateVrColors();
    updateBellButton();
  }
  renderer.render(scene, camera);
});
