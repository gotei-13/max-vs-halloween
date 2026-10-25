import * as THREE from '../vendor/three.module.js';
import * as tex from './textures.js';

// The bedroom, in two styles built from the same furniture list:
//   realistic - textured, moonlit, lit by a flickering jack-o'-lantern
//   outline   - pitch black with glowing outlines only
// plus 'mr' (mixed reality): no room at all, only the magic circle, so the
// real room shows through.
// A magic circle (the pentagram) lies in the middle of the room, at the origin.

const W = 12, H = 3.2, D = 12;
const HX = W / 2, HZ = D / 2;

// how far from the middle the player may walk, and the furniture to walk
// around, as floor rectangles [minX, maxX, minZ, maxZ]
export const ROOM_HALF = HX;
export const OBSTACLES = [
  [4.05, 5.75, 3.74, 5.98],     // bed
  [-5.9, -4.6, -5.9, -5.3],     // wardrobe
  [5.62, 5.98, -2.2, -0.8],     // bookshelf
  [-5.2, -4.0, 3.7, 5.0],       // table and chair
  [5.0, 5.6, -5.98, -5.55],     // grandfather clock
  [-6.0, -5.5, 2.65, 4.35],     // fireplace
  [-4.9, -4.1, -2.3, -1.5],     // rocking chair
];

const TABLE = { x: -4.6, z: 4.6 };
const PUMPKIN = { x: TABLE.x, y: 0.916, z: TABLE.z };

// Every static piece of furniture as boxes: { size, pos, mat, outline }.
// mat names map to materials in the realistic style; outline: also drawn in the outline style.
function furniture() {
  const list = [];
  const box = (w, h, d, x, y, z, mat, outline = true) => list.push({ w, h, d, x, y, z, mat, outline });

  // door frame on the back wall (the door itself swings, see door())
  box(0.08, 2.16, 0.08, 1.18, 1.08, -HZ + 0.04, 'trim');
  box(0.08, 2.16, 0.08, 2.22, 1.08, -HZ + 0.04, 'trim');
  box(1.12, 0.08, 0.08, 1.7, 2.16, -HZ + 0.04, 'trim');

  // window frame on the left wall, curtains and rod
  const wx = -HX + 0.05;
  box(0.08, 0.08, 2.16, wx, 2.24, 0, 'paint');
  box(0.18, 0.06, 2.3, wx + 0.05, 0.97, 0, 'paint');
  box(0.08, 1.28, 0.08, wx, 1.6, -1.04, 'paint');
  box(0.08, 1.28, 0.08, wx, 1.6, 1.04, 'paint');
  box(0.04, 1.2, 0.04, wx, 1.6, 0, 'paint');
  box(0.04, 0.04, 2, wx, 1.6, 0, 'paint');
  box(0.06, 2.3, 0.6, wx + 0.05, 1.45, -1.35, 'curtain');
  box(0.06, 2.3, 0.6, wx + 0.05, 1.45, 1.35, 'curtain');
  box(0.03, 0.03, 3.3, wx + 0.07, 2.62, 0, 'brass', false);

  // bed in the front-right corner, headboard against the front wall
  box(1.7, 0.3, 2.2, 4.9, 0.15, 4.84, 'wood');
  box(1.6, 0.22, 2.1, 4.9, 0.41, 4.84, 'sheet', false);
  box(1.64, 0.07, 1.45, 4.9, 0.55, 4.49, 'blanket');
  box(1.1, 0.14, 0.42, 4.9, 0.59, 5.59, 'sheet');
  box(1.7, 1.1, 0.08, 4.9, 0.55, 5.93, 'wood');

  // wardrobe in the back-left corner
  box(1.3, 2.2, 0.6, -5.25, 1.1, -5.6, 'darkWood');
  box(1.4, 0.08, 0.66, -5.25, 2.24, -5.6, 'trim', false);
  box(0.012, 2.0, 0.01, -5.25, 1.1, -5.297, 'trim');
  box(0.02, 0.18, 0.03, -5.32, 1.1, -5.285, 'brass', false);
  box(0.02, 0.18, 0.03, -5.18, 1.1, -5.285, 'brass', false);

  // bookshelf on the right wall
  box(0.35, 1.8, 0.04, 5.8, 0.9, -2.18, 'wood');
  box(0.35, 1.8, 0.04, 5.8, 0.9, -0.82, 'wood');
  box(0.02, 1.8, 1.4, 5.97, 0.9, -1.5, 'wood', false);
  for (const y of SHELF_YS) box(0.35, 0.03, 1.36, 5.8, y, -1.5, 'wood');

  // table and chair in the front-left corner
  box(1.2, 0.05, 0.8, TABLE.x, 0.755, TABLE.z, 'wood');
  for (const [lx, lz] of [[-0.55, -0.35], [0.55, -0.35], [-0.55, 0.35], [0.55, 0.35]]) {
    box(0.05, 0.73, 0.05, TABLE.x + lx, 0.365, TABLE.z + lz, 'wood');
  }
  box(0.45, 0.04, 0.45, TABLE.x, 0.45, TABLE.z - 0.65, 'wood');
  box(0.45, 0.5, 0.04, TABLE.x, 0.72, TABLE.z - 0.87, 'wood');
  for (const [lx, lz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) {
    box(0.04, 0.45, 0.04, TABLE.x + lx, 0.225, TABLE.z - 0.65 + lz, 'wood', false);
  }

  // portrait frame on the back wall
  box(0.62, 0.78, 0.04, -1.4, 1.75, -HZ + 0.02, 'frame');

  // grandfather clock against the back wall, near the right corner
  box(0.5, 2.0, 0.35, 5.3, 1.0, -HZ + 0.2, 'darkWood');
  box(0.6, 0.36, 0.42, 5.3, 2.18, -HZ + 0.2, 'trim');

  // stone fireplace on the left wall, with a chimney breast up to the ceiling
  box(0.4, 1.2, 0.25, -HX + 0.2, 0.6, 2.85, 'stone');
  box(0.4, 1.2, 0.25, -HX + 0.2, 0.6, 4.15, 'stone');
  box(0.5, 0.12, 1.75, -HX + 0.25, 1.26, 3.5, 'trim');
  box(0.25, H - 1.32, 1.6, -HX + 0.12, 1.32 + (H - 1.32) / 2, 3.5, 'stone');
  box(0.05, 1.0, 1.05, -HX + 0.03, 0.5, 3.5, 'soot', false);
  return list;
}

const SHELF_YS = [0.02, 0.45, 0.9, 1.35, 1.79];

// The rocking chair by the window (rocks by itself), in its own coordinates.
function rockingChair() {
  const list = [];
  const box = (w, h, d, x, y, z, rx = 0) => list.push({ w, h, d, x, y, z, rx, mat: 'wood', outline: true });
  box(0.5, 0.05, 0.5, 0, 0.45, 0);
  box(0.5, 0.75, 0.04, 0, 0.85, -0.25, -0.18);
  for (const [lx, lz] of [[-0.22, -0.2], [0.22, -0.2], [-0.22, 0.2], [0.22, 0.2]]) box(0.04, 0.38, 0.04, lx, 0.25, lz);
  box(0.04, 0.04, 0.85, -0.22, 0.05, 0);
  box(0.04, 0.04, 0.85, 0.22, 0.05, 0);
  box(0.04, 0.04, 0.5, -0.26, 0.66, 0);
  box(0.04, 0.04, 0.5, 0.26, 0.66, 0);
  return list;
}

// The door, in its own coordinates around the hinge (left edge), so it can swing open.
const DOOR_HINGE = { x: 1.22, z: -HZ + 0.03 };
function door() {
  return [
    { w: 0.96, h: 2.08, d: 0.05, x: 0.48, y: 1.04, z: 0, mat: 'darkWood', outline: true },
    { w: 0.7, h: 0.8, d: 0.012, x: 0.48, y: 1.55, z: 0.03, mat: 'trim', outline: false },
    { w: 0.7, h: 0.75, d: 0.012, x: 0.48, y: 0.58, z: 0.03, mat: 'trim', outline: false },
    { w: 0.04, h: 0.06, d: 0.06, x: 0.83, y: 1.0, z: 0.05, mat: 'brass', outline: true },
  ];
}

// The clock's pendulum, hanging from its pivot.
function pendulum() {
  return [
    { w: 0.015, h: 0.6, d: 0.01, x: 0, y: -0.3, z: 0, mat: 'brass', outline: true },
    { w: 0.12, h: 0.12, d: 0.02, x: 0, y: -0.62, z: 0, mat: 'brass', outline: true },
  ];
}

export function createRoom() {
  const group = new THREE.Group();
  const outline = buildOutline();
  const real = buildRealistic();
  const circle = buildMagicCircle();
  group.add(outline.group, real.group, circle.mesh);
  let glow = 0;
  let time = 0;
  let darkness = 0;   // 0 = normal, 1 = lights out
  let doorAngle = 0;

  return {
    group,
    setStyle(style) {
      real.group.visible = style === 'realistic';
      outline.group.visible = style === 'outline';
      circle.mesh.visible = style !== 'outline';
    },
    // dim the lights (0 = normal, 1 = almost pitch black), for the blackout scare
    setDarkness(k) {
      darkness = k;
    },
    // open the door by this many radians (0 = shut)
    setDoor(angle) {
      doorAngle = angle;
    },
    // briefly light up the room, e.g. when a spell is cast
    flash(amount) {
      glow = Math.max(glow, amount);
    },
    // pentagram look: 'ready' (glowing), 'active' (bright, protecting), 'charging' (dim, filling up 0..1)
    setCircle(state, progress) {
      circle.setState(state, progress);
      outline.setCircle(state, progress);
    },
    update(dt) {
      time += dt;
      glow = Math.max(0, glow - dt * 1.6);
      // the rocking chair rocks on its own, the pendulum swings
      const rock = Math.sin(time * 1.4) * 0.12;
      const swing = Math.sin(time * Math.PI) * 0.22;
      outline.update(glow, rock, swing, darkness, doorAngle);
      real.update(glow, time, rock, swing, darkness, doorAngle);
      circle.update(time);
    },
  };
}

// places the rocking chair, pendulum and door groups (shared by both styles)
function placeAnimated(chair, pend, doorGroup) {
  chair.position.set(-4.5, 0, -1.9);
  chair.rotation.y = 0.9;
  pend.position.set(5.3, 1.75, -HZ + 0.39);
  doorGroup.position.set(DOOR_HINGE.x, 0, DOOR_HINGE.z);
}

// ---- box helpers ------------------------------------------------------------

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);

function placed(geo, x, y, z, rx = 0, ry = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  return g.applyMatrix4(_m4.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, 0)), _one));
}

// box with texture coordinates in meters, so wood grain has the same scale everywhere
function texturedBox(w, h, d) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];  // +x -x +y -y +z -z
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]);
    }
  }
  return geo;
}

function mergeGeometries(geos) {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    if (!geos.every((g) => g.getAttribute(name))) continue;
    const size = geos[0].getAttribute(name).itemSize;
    const total = geos.reduce((n, g) => n + g.getAttribute(name).array.length, 0);
    const data = new Float32Array(total);
    let offset = 0;
    for (const g of geos) {
      data.set(g.getAttribute(name).array, offset);
      offset += g.getAttribute(name).array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(data, size));
  }
  out.computeBoundingSphere();
  return out;
}

// all outline boxes of a list as ONE line mesh (one draw call)
function outlineMesh(list, mat) {
  const geos = list.filter((b) => b.outline)
    .map((b) => placed(new THREE.EdgesGeometry(new THREE.BoxGeometry(b.w, b.h, b.d)), b.x, b.y, b.z, b.rx || 0));
  return new THREE.LineSegments(mergeGeometries(geos), mat);
}

// boxes of a list merged by material: a handful of draw calls instead of dozens
function solidMeshes(list, materials, extra = []) {
  const buckets = new Map();
  const add = (mat, geo) => {
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat).push(geo);
  };
  for (const b of list) add(materials[b.mat], placed(texturedBox(b.w, b.h, b.d), b.x, b.y, b.z, b.rx || 0));
  for (const [mat, geo] of extra) add(mat, geo);
  const group = new THREE.Group();
  for (const [mat, geos] of buckets) group.add(new THREE.Mesh(mergeGeometries(geos), mat));
  return group;
}

// ---- glowing outline style -------------------------------------------------

function buildOutline() {
  const group = new THREE.Group();
  const materials = [];

  function lineMat(color, base) {
    const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity: base });
    m.userData.base = base;
    materials.push(m);
    return m;
  }

  const floorMat = lineMat(0x2c2457, 0.35);
  const wallMat = lineMat(0x4b3d8f, 0.5);
  const furnMat = lineMat(0x8a7cff, 0.6);
  const warmMat = lineMat(0xff7a1a, 0.9);
  const circleMat = lineMat(0x6a4cff, 0.45);
  const moonMat = lineMat(0xfff2c0, 0.8);

  const loop = (points, mat) => group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), mat));
  const circle = (r, n, map) => Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return map(Math.cos(a) * r, Math.sin(a) * r);
  });

  // walls, floor, ceiling
  const room = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W, H, D)), wallMat);
  room.position.y = H / 2;
  group.add(room);

  // floorboards
  const boards = [];
  for (let x = -HX + 0.8; x < HX; x += 0.8) boards.push(new THREE.Vector3(x, 0.002, -HZ), new THREE.Vector3(x, 0.002, HZ));
  group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(boards), floorMat));

  // magic circle with a star
  loop(circle(0.9, 48, (a, b) => new THREE.Vector3(a, 0.01, b)), circleMat);
  loop(circle(0.8, 48, (a, b) => new THREE.Vector3(a, 0.01, b)), circleMat);
  const star = [];
  for (let i = 0; i < 5; i++) {
    const a = (i * 2 * (Math.PI * 2)) / 5 - Math.PI / 2;
    star.push(new THREE.Vector3(Math.cos(a) * 0.8, 0.01, Math.sin(a) * 0.8));
  }
  loop(star, circleMat);

  // the moon in the window, the clock face and the jack-o'-lantern
  loop(circle(0.22, 32, (a, b) => new THREE.Vector3(-HX + 0.02, 1.9 + b, 0.5 + a)), moonMat);
  loop(circle(0.17, 24, (a, b) => new THREE.Vector3(5.3 + a, 1.82 + b, -HZ + 0.38)), furnMat);
  const pumpkin = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.SphereGeometry(0.17, 10, 6), 1), warmMat);
  pumpkin.scale.y = 0.8;
  pumpkin.position.set(PUMPKIN.x, PUMPKIN.y, PUMPKIN.z);
  group.add(pumpkin);
  // embers in the fireplace
  const embers = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.3, 0.1, 0.8)), warmMat);
  embers.position.set(-HX + 0.2, 0.06, 3.5);
  group.add(embers);

  group.add(outlineMesh(furniture(), furnMat));
  const chair = new THREE.Group();
  chair.add(outlineMesh(rockingChair(), furnMat));
  const pend = new THREE.Group();
  pend.add(outlineMesh(pendulum(), furnMat));
  const doorGroup = new THREE.Group();
  doorGroup.add(outlineMesh(door(), furnMat));
  placeAnimated(chair, pend, doorGroup);
  group.add(chair, pend, doorGroup);

  return {
    group,
    setCircle(state, progress) {
      circleMat.color.set(state === 'active' ? 0x66ffd9 : 0x6a4cff);
      circleMat.userData.base = state === 'active' ? 1 : state === 'ready' ? 0.6 : 0.12 + 0.3 * progress;
    },
    update(glow, rock, swing, darkness, doorAngle) {
      const dim = 1 - darkness * 0.85;
      for (const m of materials) m.opacity = Math.min(1, m.userData.base + glow * (1 - m.userData.base)) * (m === circleMat ? 1 : dim);
      chair.rotation.x = rock;
      pend.rotation.z = swing;
      doorGroup.rotation.y = -doorAngle;   // swings into the room
    },
  };
}

// ---- realistic style --------------------------------------------------------

function buildRealistic() {
  const group = new THREE.Group();
  const lambert = (opts) => new THREE.MeshLambertMaterial(opts);
  const repeat = (t, x, y) => { t.repeat.set(x, y); return t; };

  const m = {
    floor: lambert({ map: repeat(tex.woodFloor(), W / 2, D / 2) }),
    wall: lambert({ map: repeat(tex.wallpaper(), W, H) }),
    ceiling: lambert({ map: repeat(tex.plaster(), W / 2, D / 2) }),
    trim: lambert({ map: tex.woodGrain(4, 20, 13) }),
    wood: lambert({ map: tex.woodGrain(3, 24, 24) }),
    darkWood: lambert({ map: tex.woodGrain(8, 18, 14) }),
    paint: lambert({ color: 0xcfc6b4 }),
    sheet: lambert({ map: tex.fabric('#c9c4b8', '#9a948a') }),
    blanket: lambert({ map: tex.fabric('#3b2a5a', '#21173a', 21) }),
    curtain: lambert({ map: tex.velvet() }),
    brass: lambert({ color: 0xa08850 }),
    frame: lambert({ color: 0x6e5020 }),
    stone: lambert({ map: tex.plaster(), color: 0x8a8090 }),
    soot: lambert({ color: 0x0a0806 }),
    stem: lambert({ color: 0x4a3a1a }),
  };

  // floor, ceiling, walls, baseboards and crown molding, plus round bits
  const extra = [
    [m.floor, placed(new THREE.PlaneGeometry(W, D), 0, 0, 0, -Math.PI / 2)],
    [m.ceiling, placed(new THREE.PlaneGeometry(W, D), 0, H, 0, Math.PI / 2)],
  ];
  const wallGeo = new THREE.PlaneGeometry(W, H);
  extra.push(
    [m.wall, placed(wallGeo, 0, H / 2, -HZ)],
    [m.wall, placed(wallGeo, 0, H / 2, HZ, 0, Math.PI)],
    [m.wall, placed(wallGeo, -HX, H / 2, 0, 0, Math.PI / 2)],
    [m.wall, placed(wallGeo, HX, H / 2, 0, 0, -Math.PI / 2)],
  );
  for (const [y, h] of [[0.07, 0.14], [H - 0.06, 0.12]]) {
    extra.push(
      [m.trim, placed(texturedBox(W, h, 0.03), 0, y, -HZ + 0.015)],
      [m.trim, placed(texturedBox(W, h, 0.03), 0, y, HZ - 0.015)],
      [m.trim, placed(texturedBox(0.03, h, D), -HX + 0.015, y, 0)],
      [m.trim, placed(texturedBox(0.03, h, D), HX - 0.015, y, 0)],
    );
  }
  extra.push(
    [m.stem, placed(new THREE.CylinderGeometry(0.015, 0.025, 0.08, 6), PUMPKIN.x, 1.08, PUMPKIN.z)],  // pumpkin stem
    [m.paint, placed(new THREE.CircleGeometry(0.17, 24), 5.3, 1.82, -HZ + 0.38)],                     // clock face
    [m.darkWood, placed(new THREE.CylinderGeometry(0.06, 0.07, 0.8, 8), -HX + 0.25, 0.08, 3.5, Math.PI / 2)],  // logs
  );
  group.add(solidMeshes(furniture(), m, extra));

  // rocking chair and pendulum move, so they are separate
  const chair = new THREE.Group();
  chair.add(solidMeshes(rockingChair(), m));
  const pend = new THREE.Group();
  pend.add(solidMeshes(pendulum(), m));
  const doorGroup = new THREE.Group();
  doorGroup.add(solidMeshes(door(), m));
  placeAnimated(chair, pend, doorGroup);
  group.add(chair, pend, doorGroup);
  // pitch black behind the door, seen when it opens
  const doorway = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 2.08), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  doorway.position.set(1.7, 1.04, -HZ + 0.004);
  group.add(doorway);

  // window: moonlit sky behind the frame
  const skyMat = new THREE.MeshBasicMaterial({ map: tex.nightSky(), color: 0xb0b8d0 });
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 1.2), skyMat);
  sky.position.set(-HX + 0.02, 1.6, 0);
  sky.rotation.y = Math.PI / 2;
  group.add(sky);

  // glowing embers in the fireplace
  const emberMat = new THREE.MeshBasicMaterial({ color: 0xff5a10 });
  const embers = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.8), emberMat);
  embers.position.set(-HX + 0.2, 0.03, 3.5);
  group.add(embers);

  // rug beside the bed
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), lambert({ map: tex.rug() }));
  rug.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
  rug.position.set(3.4, 0.004, 4.6);
  group.add(rug);

  group.add(buildBooks());

  // creepy portrait on the back wall
  const art = tex.portrait();
  const portraitMat = lambert({ map: art.map, emissiveMap: art.glow, emissive: 0xffffff, emissiveIntensity: 0.3 });
  const portrait = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.66), portraitMat);
  portrait.position.set(-1.4, 1.75, -HZ + 0.045);
  group.add(portrait);

  // jack-o'-lantern on the table, carved face toward the middle of the room
  const pumpkinTex = tex.pumpkin();
  const pumpkinMat = lambert({ map: pumpkinTex.map, emissiveMap: pumpkinTex.glow, emissive: 0xffffff });
  const pumpkin = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 16), pumpkinMat);
  pumpkin.scale.y = 0.8;
  pumpkin.position.set(PUMPKIN.x, PUMPKIN.y, PUMPKIN.z);
  pumpkin.rotation.y = -Math.PI / 4;
  group.add(pumpkin);

  group.add(cobweb(new THREE.Vector3(-HX, H, -HZ), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)));
  group.add(cobweb(new THREE.Vector3(HX, H, HZ), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, -1)));
  group.add(cobweb(new THREE.Vector3(-HX, H, HZ), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1)));

  // lights: dim moonlight from the window, a candle in the pumpkin
  const ambient = new THREE.AmbientLight(0x404a70, 0.95);
  const moon = new THREE.DirectionalLight(0x9fb4ff, 1.1);
  moon.position.set(-8, 5, 1);
  const candle = new THREE.PointLight(0xff8a2a, 2.6, 10, 2);
  candle.position.set(PUMPKIN.x + 0.15, 1.05, PUMPKIN.z - 0.15);
  group.add(ambient, moon, candle);

  return {
    group,
    update(glow, time, rock, swing, darkness, doorAngle) {
      const dim = 1 - darkness * 0.92;
      ambient.intensity = (0.95 + glow * 1.6) * dim;
      moon.intensity = 1.1 * dim;
      skyMat.color.setRGB(0.69 * dim, 0.72 * dim, 0.82 * dim);
      // candle and fire flicker from a few mixed sine waves
      const flicker = 0.8 + 0.12 * Math.sin(time * 11) + 0.08 * Math.sin(time * 23 + 1) + 0.05 * Math.sin(time * 37);
      candle.intensity = 2.6 * flicker * (1 - darkness);
      pumpkinMat.emissiveIntensity = flicker * (1 - darkness);
      const ember = 1 - darkness * 0.8;
      emberMat.color.setRGB(ember, (0.25 + 0.15 * Math.sin(time * 7 + 2) + 0.05 * Math.sin(time * 19)) * ember, 0.05 * ember);
      doorGroup.rotation.y = -doorAngle;
      // the portrait's eyes glow up every now and then
      portraitMat.emissiveIntensity = 0.3 + 1.2 * Math.pow(Math.max(0, Math.sin(time * 0.5)), 12);
      chair.rotation.x = rock;
      pend.rotation.z = swing;
    },
  };
}

// one instanced mesh for all books: one draw call
function buildBooks() {
  const books = [];
  let seed = 31;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const y0 of SHELF_YS.slice(0, 4)) {
    let z = -2.14;
    while (z < -0.88) {
      const w = 0.03 + rand() * 0.035;
      if (z + w > -0.86) break;
      if (rand() < 0.08) { z += 0.06; continue; }  // a gap now and then
      books.push({ w, h: 0.18 + rand() * 0.12, d: 0.19 + rand() * 0.07, y0: y0 + 0.015, z: z + w / 2 });
      z += w + 0.003;
    }
  }
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), books.length);
  const mat = new THREE.Matrix4();
  const color = new THREE.Color();
  books.forEach((b, i) => {
    mat.makeScale(b.d, b.h, b.w).setPosition(HX - 0.05 - b.d / 2, b.y0 + b.h / 2, b.z);
    mesh.setMatrixAt(i, mat);
    mesh.setColorAt(i, color.setHSL(rand(), 0.35 + rand() * 0.25, 0.18 + rand() * 0.15));
  });
  return mesh;
}

// a spider web spanning a ceiling corner
function cobweb(corner, alongA, alongB) {
  const down = new THREE.Vector3(0, -1, 0);
  const ends = [];
  const L = 0.8;
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    // sweep the spoke ends from wall A, across the ceiling, down to wall B
    const dir = t < 0.5
      ? alongA.clone().lerp(alongB, t * 2)
      : alongB.clone().lerp(down, (t - 0.5) * 2);
    ends.push(corner.clone().addScaledVector(dir.normalize(), L));
  }
  const pts = [];
  for (const e of ends) pts.push(corner, e);
  for (const r of [0.25, 0.45, 0.65, 0.85]) {
    for (let i = 0; i < ends.length - 1; i++) {
      pts.push(corner.clone().lerp(ends[i], r), corner.clone().lerp(ends[i + 1], r));
    }
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xc8c8d0, transparent: true, opacity: 0.25 }));
}

// glowing magic circle under the player (shown in realistic and mixed-reality)
function buildMagicCircle() {
  const mat = new THREE.MeshBasicMaterial({
    map: tex.magicCircle(), color: 0x8a5cff, transparent: true, opacity: 0.6,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.008;
  const READY = new THREE.Color(0x8a5cff);
  const ACTIVE = new THREE.Color(0x66ffd9);
  let state = 'ready';
  let progress = 1;
  let spin = 0;
  let last = 0;
  return {
    mesh,
    setState(s, p) {
      state = s;
      progress = p;
      mat.color.copy(s === 'active' ? ACTIVE : READY);
    },
    update(time) {
      if (state === 'active') mat.opacity = 0.9 + 0.1 * Math.sin(time * 8);
      else if (state === 'ready') mat.opacity = 0.55 + 0.2 * Math.sin(time * 2.5);
      else mat.opacity = 0.08 + 0.3 * progress;
      const dt = Math.min(0.1, time - last);
      last = time;
      spin += dt * (state === 'active' ? 1.8 : 0.09);
      mesh.rotation.z = spin;
    },
  };
}
