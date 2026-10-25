import * as THREE from '../vendor/three.module.js';
import { SpookyAudio } from './audio.js';
import { createRoom } from './room.js';
import { Ghost, GHOST_TYPES } from './ghost.js';
import { Hud } from './hud.js';
import { Trail } from './trail.js';
import { SpellFx } from './fx.js';
import { VrMenu } from './vrmenu.js';
import { Shield } from './shield.js';
import { Scares } from './scares.js';
import { Horror } from './horror.js';
import { Potion } from './potion.js';
import { makeWand } from './wand.js';
import { walk, floorDirections, snapTurn } from './movement.js';

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

// the player's "rig": moving it moves the player (camera and VR hands) through the room.
// A game starts near the door, facing the pentagram.
const START_POS = new THREE.Vector3(0, 0, 3.5);
const rig = new THREE.Group();
rig.position.copy(START_POS);
rig.add(camera);
scene.add(rig);

const audio = new SpookyAudio();
const room = createRoom();
scene.add(room.group);
const hud = new Hud(camera);
const trail = new Trail(scene);
const fx = new SpellFx(scene);
const vrMenu = new VrMenu(scene);
const shield = new Shield(scene);
const scares = new Scares(scene, audio);
const potion = new Potion(scene, audio);
const horror = new Horror(scene, audio, room);

// shown the first time each kind of ghost appears in a game
const GHOST_INTROS = {
  flyer: 'Something is flying above you… look up!',
  crawler: 'Something is knocking under the floor… look down!',
  demon: 'A RED DEMON is coming! 3 hits to banish it, it takes 2 lives!',
};
const DEMON_CHANCE = 0.25;   // once the player has banished DEMON_FROM ghosts
const DEMON_FROM = 2;

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
let ghostCount = 0;
const seenTypes = new Set();
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
  ghosts = [];
  spells = [];
  spawnTimes = [];
}

function showReady() {
  clearWorld();
  shield.reset();
  state = 'ready';
  if (mode === 'vr') {
    hud.setMessage();
    vrMenu.show({ title: 'Maxim VS Halloween', subtitle: 'Listen for the ghosts… and banish them!', action: 'START' }, camera);
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
  if (state === 'over') {
    if (now - overAt > RESTART_DELAY) startGame();
    return true;
  }
  return false;
}

function resetPlayer() {
  rig.position.copy(START_POS);
  rig.rotation.set(0, 0, 0);
  rig.updateMatrixWorld(true);
  yaw = 0;
  pitch = 0;
}

function startGame() {
  clearWorld();
  resetPlayer();
  shield.reset();
  lives = START_LIVES;
  score = 0;
  ghostCount = 0;
  seenTypes.clear();
  state = 'playing';
  vrMenu.hide();
  hud.setMessage();
  hud.toast('Listen! Tip: stand in the pentagram for 10 s of protection', 3.5);
  audio.start();
  scheduleSpawn(2.2);
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
  const banished = `You banished ${score} ghost${score === 1 ? '' : 's'}`;
  // in VR the menu panel with "Play again" follows shortly (see updateGame)
  hud.setMessage('GAME OVER', mode === 'vr' ? banished : `${banished}\nClick to play again`);
}

function scheduleSpawn(delay) {
  spawnTimes.push(now + delay);
}

function playerYaw() {
  camera.getWorldDirection(_v1);
  return Math.atan2(_v1.x, -_v1.z);
}

// first a walker, then a flyer, then a crawler, then any kind
function nextGhostType() {
  if (ghostCount < GHOST_TYPES.length) return GHOST_TYPES[ghostCount];
  return GHOST_TYPES[Math.floor(Math.random() * GHOST_TYPES.length)];
}

function spawnGhost() {
  // now and then, once the player is warmed up, the red demon comes instead
  const demonAround = huntingGhosts().some((g) => g.type === 'demon');
  const type = score >= DEMON_FROM && !demonAround && Math.random() < DEMON_CHANCE ? 'demon' : nextGhostType();
  if (type === 'demon') audio.stinger();
  else ghostCount++;
  let angle;
  if (!seenTypes.has(type)) {
    // the first ghost of each kind comes from roughly in front, so it is easy to learn
    angle = playerYaw() + (Math.random() - 0.5) * 1.0;
    seenTypes.add(type);
    if (GHOST_INTROS[type]) hud.toast(GHOST_INTROS[type], 3);
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
  const speed = ghostSpeed() * (type === 'demon' ? 1.15 : 1);
  ghosts.push(new Ghost(scene, audio, {
    type, angle, elevation, speed, pitch: 0.85 + Math.random() * 0.3, head: player,
  }));
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
    hud.toast(`The demon is hurt! ${ghost.hp} more hit${ghost.hp === 1 ? '' : 's'}!`, 1.8);
    if (controller) pulse(controller, 0.9, 150);
    return;
  }
  ghost.banish();
  room.flash(1);
  score++;
  hud.toast('Ghost banished!', 1.2);
  if (controller) pulse(controller, 0.7, 120);
}

function onMiss() {
  if (state !== 'playing') return;
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
  if (state === 'playing') {
    const due = spawnTimes.filter((t) => t <= now);
    spawnTimes = spawnTimes.filter((t) => t > now);
    for (let i = 0; i < due.length; i++) spawnGhost();
    if (huntingGhosts().length === 0 && spawnTimes.length === 0) scheduleSpawn(1.6);
  }

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
    const ev = g.update(dt, player, shield.barrier, potion.visionActive);
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
      subtitle: `You banished ${score} ghost${score === 1 ? '' : 's'}!`,
      action: 'PLAY AGAIN',
    }, camera);
  }

  updateSpells(dt);
  hud.setStatus({
    lives, maxLives: START_LIVES, score,
    shield: state === 'playing' ? { state: shield.state, seconds: shield.secondsLeft, progress: shield.progress } : null,
    vision: potion.visionActive ? potion.secondsLeft : 0,
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
  if (paused || state !== 'playing') return;
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
  else if (kind === 'start') startGame();
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
  laptopWand.visible = mode === 'laptop' && state === 'playing';
  wandKick = Math.max(0, wandKick - dt * 4);
  laptopWand.quaternion.copy(laptopWandRest);
  laptopWand.rotateX(Math.sin(wandKick * Math.PI) * 0.45);
  laptopWand.position.z = -0.38 - 0.06 * Math.sin(wandKick * Math.PI);
}

// open with ?debug to inspect performance from the browser console (debug.renderer.info)
if (new URLSearchParams(location.search).has('debug')) window.debug = {
  renderer, scene, camera, vrMenu, rig, shield, scares, potion, horror,
  info: () => ({ lives, score, state, dread: Boolean(audio.dread) }),
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
