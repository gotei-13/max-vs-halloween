import * as THREE from '../vendor/three.module.js';
import * as tex from './textures.js';
import { placed, texturedBox, outlineMesh, solidMeshes, cobweb, buildMagicCircle } from './room.js';

// The rest of the haunted house, one area at a time (only one is loaded, which
// keeps the Quest 1 fast):
//   hallway   - long dark corridor with portraits and candles   (shadow people)
//   stairwell - landing above a staircase going down            (bat swarms)
//   foyer     - entrance hall with the front door               (the red demon, then escape)
// Every area returns the same shape as the bedroom (room.js): { group, info, setExit, ... }.

// ---- shared building blocks ---------------------------------------------------

// a plane whose texture repeats every `tile` meters
function sizedPlane(w, h, tile) {
  const geo = new THREE.PlaneGeometry(w, h);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / tile), uv.getY(i) * (h / tile));
  return geo;
}

function materials() {
  const lambert = (opts) => new THREE.MeshLambertMaterial(opts);
  const once = (t) => { t.repeat.set(1, 1); return t; };
  return {
    floor: lambert({ map: once(tex.woodFloor()) }),
    wall: lambert({ map: once(tex.wallpaper()) }),
    ceiling: lambert({ map: once(tex.plaster()) }),
    trim: lambert({ map: tex.woodGrain(4, 20, 13) }),
    wood: lambert({ map: tex.woodGrain(3, 24, 24) }),
    darkWood: lambert({ map: tex.woodGrain(8, 18, 14) }),
    paint: lambert({ color: 0xcfc6b4 }),
    curtain: lambert({ map: tex.velvet() }),
    brass: lambert({ color: 0xa08850 }),
    frame: lambert({ color: 0x6e5020 }),
    stone: lambert({ map: once(tex.plaster()), color: 0x8a8090 }),
    iron: lambert({ color: 0x4a4a56 }),
    soot: lambert({ color: 0x0a0806 }),
  };
}

// one door leaf around its hinge, standing on a wall at the far (-z) end and
// opening into the area; dir = +1: the leaf reaches to +x from the hinge, -1: to -x
function doorLeaf(width, height, dir) {
  return [
    { w: width, h: height, d: 0.05, x: dir * width / 2, y: height / 2, z: 0, mat: 'darkWood', outline: true },
    { w: width * 0.72, h: height * 0.36, d: 0.012, x: dir * width / 2, y: height * 0.74, z: 0.03, mat: 'trim', outline: false },
    { w: width * 0.72, h: height * 0.34, d: 0.012, x: dir * width / 2, y: height * 0.28, z: 0.03, mat: 'trim', outline: false },
    { w: 0.04, h: 0.06, d: 0.06, x: dir * (width - 0.12), y: 1.0, z: 0.05, mat: 'brass', outline: true },
  ];
}

// door frame around an opening centered at x on a wall at z (facing along z)
function doorFrame(list, x, z, width, height) {
  list.push(
    { w: 0.08, h: height + 0.08, d: 0.08, x: x - width / 2 - 0.04, y: (height + 0.08) / 2, z, mat: 'trim', outline: true },
    { w: 0.08, h: height + 0.08, d: 0.08, x: x + width / 2 + 0.04, y: (height + 0.08) / 2, z, mat: 'trim', outline: true },
    { w: width + 0.16, h: 0.08, d: 0.08, x, y: height + 0.04, z, mat: 'trim', outline: true },
  );
}

// a closed door on a side wall (x = wall position, facing into the area)
function sideDoor(list, x, z) {
  const inward = x < 0 ? 1 : -1;
  list.push(
    { w: 0.05, h: 2.08, d: 0.96, x: x + inward * 0.03, y: 1.04, z, mat: 'darkWood', outline: true },
    { w: 0.08, h: 2.16, d: 0.08, x: x + inward * 0.04, y: 1.08, z: z - 0.52, mat: 'trim', outline: true },
    { w: 0.08, h: 2.16, d: 0.08, x: x + inward * 0.04, y: 1.08, z: z + 0.52, mat: 'trim', outline: true },
    { w: 0.08, h: 0.08, d: 1.12, x: x + inward * 0.04, y: 2.16, z, mat: 'trim', outline: true },
    { w: 0.06, h: 0.04, d: 0.04, x: x + inward * 0.07, y: 1.0, z: z + 0.36, mat: 'brass', outline: false },
  );
}

// candle flames: one glowing point each, all in one draw call
function flames(points, size = 0.16) {
  const geo = new THREE.BufferGeometry().setFromPoints(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  const mat = new THREE.PointsMaterial({
    map: tex.sparkle(), color: 0xffa040, size, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const obj = new THREE.Points(geo, mat);
  return {
    obj,
    update(time, dim) {
      const flicker = 0.85 + 0.1 * Math.sin(time * 13) + 0.05 * Math.sin(time * 29);
      mat.opacity = flicker * dim;
      mat.size = size * (0.9 + 0.1 * Math.sin(time * 17));
    },
  };
}

// a creepy portrait whose eyes glow now and then
function portraitMaterial() {
  const art = tex.portrait();
  return new THREE.MeshLambertMaterial({ map: art.map, emissiveMap: art.glow, emissive: 0xffffff, emissiveIntensity: 0.3 });
}

// ---- the area builder ------------------------------------------------------------

// spec: bounds {minX, maxX, minZ, maxZ}, height, bottom (walls start here, below 0 for a stairwell),
// floors [[x0, x1, z0, z1, y]], furniture boxes, doors [{ hinge: {x, z}, width, height, dir }],
// doorways [{ x, z, w, h, sky }] (what you see through an open door), circle {x, z}, light {x, y, z},
// moon [x, y, z], decorate(ctx) -> { update(time, dim, exit) }, info {...}
function createArea(spec) {
  const b = spec.bounds;
  const W = b.maxX - b.minX, D = b.maxZ - b.minZ;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const bottom = spec.bottom ?? 0;
  const wallH = spec.height - bottom;

  const group = new THREE.Group();
  const real = new THREE.Group();
  const outline = new THREE.Group();
  group.add(real, outline);
  const m = materials();

  // outline-style materials (glow lines)
  const lineMats = [];
  const lineMat = (color, base) => {
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: base });
    mat.userData.base = base;
    lineMats.push(mat);
    return mat;
  };
  const wallLines = lineMat(0x4b3d8f, 0.5);
  const furnLines = lineMat(0x8a7cff, 0.6);
  const warmLines = lineMat(0xff7a1a, 0.9);
  const circleLines = lineMat(0x6a4cff, 0.45);

  // ---- realistic shell: floors, walls, ceiling, trim
  const extra = [];
  for (const [x0, x1, z0, z1, y] of spec.floors || [[b.minX, b.maxX, b.minZ, b.maxZ, 0]]) {
    extra.push([m.floor, placed(sizedPlane(x1 - x0, z1 - z0, 2), (x0 + x1) / 2, y, (z0 + z1) / 2, -Math.PI / 2)]);
  }
  extra.push([m.ceiling, placed(sizedPlane(W, D, 2), cx, spec.height, cz, Math.PI / 2)]);
  const wallY = bottom + wallH / 2;
  extra.push(
    [m.wall, placed(sizedPlane(W, wallH, 1), cx, wallY, b.minZ)],
    [m.wall, placed(sizedPlane(W, wallH, 1), cx, wallY, b.maxZ, 0, Math.PI)],
    [m.wall, placed(sizedPlane(D, wallH, 1), b.minX, wallY, cz, 0, Math.PI / 2)],
    [m.wall, placed(sizedPlane(D, wallH, 1), b.maxX, wallY, cz, 0, -Math.PI / 2)],
  );
  for (const [y, h] of [[0.07, 0.14], [spec.height - 0.06, 0.12]]) {
    extra.push(
      [m.trim, placed(texturedBox(W, h, 0.03), cx, y, b.minZ + 0.015)],
      [m.trim, placed(texturedBox(W, h, 0.03), cx, y, b.maxZ - 0.015)],
      [m.trim, placed(texturedBox(0.03, h, D), b.minX + 0.015, y, cz)],
      [m.trim, placed(texturedBox(0.03, h, D), b.maxX - 0.015, y, cz)],
    );
  }
  for (const e of spec.extra?.(m) || []) extra.push(e);
  real.add(solidMeshes(spec.furniture, m, extra));

  // ---- outline shell
  const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W, wallH, D)), wallLines);
  box.position.set(cx, wallY, cz);
  outline.add(box, outlineMesh(spec.furniture, furnLines));

  // ---- doors that open (the way out)
  const leaves = [];
  for (const d of spec.doors || []) {
    const parts = doorLeaf(d.width, d.height, d.dir);
    for (const [target, obj] of [[real, solidMeshes(parts, m)], [outline, outlineMesh(parts, furnLines)]]) {
      const leaf = new THREE.Group();
      leaf.position.set(d.hinge.x, 0, d.hinge.z);
      leaf.add(obj);
      leaf.userData.dir = d.dir;
      target.add(leaf);
      leaves.push(leaf);
    }
  }
  // behind an open door: pitch black, or the night outside
  const skyTex = spec.doorways?.some((w) => w.sky) ? tex.nightSky() : null;
  for (const w of spec.doorways || []) {
    const mat = w.sky ? new THREE.MeshBasicMaterial({ map: skyTex, color: 0xc0c8e0 }) : new THREE.MeshBasicMaterial({ color: 0x000000 });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w.w, w.h), mat);
    plane.position.set(w.x, w.h / 2, w.z);
    real.add(plane);
  }

  // ---- pentagram
  const circle = buildMagicCircle();
  circle.mesh.position.x = spec.circle.x;
  circle.mesh.position.z = spec.circle.z;
  group.add(circle.mesh);
  const ring = [];
  for (const r of [0.9, 0.8]) {
    const pts = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      pts.push(new THREE.Vector3(spec.circle.x + Math.cos(a) * r, 0.01, spec.circle.z + Math.sin(a) * r));
    }
    ring.push(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), circleLines));
  }
  outline.add(...ring);

  // ---- lights: ambient, moonlight and one flickering candle (same set in every area,
  // so the Quest doesn't have to rebuild shaders)
  const ambient = new THREE.AmbientLight(0x404a70, 0.95);
  const moon = new THREE.DirectionalLight(0x9fb4ff, 0.9);
  moon.position.set(...(spec.moon || [-8, 5, 1]));
  const candle = new THREE.PointLight(0xff8a2a, spec.light.intensity || 2.4, spec.light.distance || 9, 2);
  candle.position.set(spec.light.x, spec.light.y, spec.light.z);
  real.add(ambient, moon, candle);

  const deco = spec.decorate?.({ real, outline, group, m, furnLines, warmLines }) || {};

  let glow = 0, time = 0, darkness = 0, exit = 0;
  return {
    group,
    info: spec.info,
    setExit(k) { exit = k; },
    setDoor() {},   // only the bedroom door creaks open by itself
    setStyle(style) {
      real.visible = style === 'realistic';
      outline.visible = style === 'outline';
      circle.mesh.visible = style !== 'outline';
    },
    setDarkness(k) { darkness = k; },
    flash(amount) { glow = Math.max(glow, amount); },
    setCircle(state, progress) {
      circle.setState(state, progress);
      circleLines.color.set(state === 'active' ? 0x66ffd9 : 0x6a4cff);
      circleLines.userData.base = state === 'active' ? 1 : state === 'ready' ? 0.6 : 0.12 + 0.3 * progress;
    },
    update(dt) {
      time += dt;
      glow = Math.max(0, glow - dt * 1.6);
      const dim = 1 - darkness * 0.92;
      ambient.intensity = (0.95 + glow * 1.6) * dim;
      moon.intensity = 0.9 * dim;
      const flicker = 0.8 + 0.12 * Math.sin(time * 11) + 0.08 * Math.sin(time * 23 + 1) + 0.05 * Math.sin(time * 37);
      candle.intensity = (spec.light.intensity || 2.4) * flicker * (1 - darkness);
      for (const mat of lineMats) mat.opacity = Math.min(1, mat.userData.base + glow * (1 - mat.userData.base)) * (mat === circleLines ? 1 : 1 - darkness * 0.85);
      for (const leaf of leaves) leaf.rotation.y = -leaf.userData.dir * exit * 1.3;
      circle.update(time);
      deco.update?.(time, 1 - darkness, exit);
    },
  };
}

// ---- the hallway ------------------------------------------------------------------

export function createHallway() {
  const HX = 1.7, HZ = 9;
  const list = [];
  doorFrame(list, 0, -HZ + 0.04, 0.96, 2.08);   // the way on, at the far end
  // the bedroom door we came through (behind the player), closed
  list.push({ w: 0.96, h: 2.08, d: 0.05, x: 0, y: 1.04, z: HZ - 0.03, mat: 'darkWood', outline: true });
  doorFrame(list, 0, HZ - 0.04, 0.96, 2.08);
  // locked doors along the walls
  sideDoor(list, -HX, -5); sideDoor(list, -HX, 3);
  sideDoor(list, HX, -1); sideDoor(list, HX, 6);
  // portrait frames
  const portraits = [[-HX, -2], [-HX, 6.5], [HX, -6], [HX, 2.5]];
  for (const [x, z] of portraits) list.push({ w: 0.04, h: 0.78, d: 0.62, x: x + (x < 0 ? 0.02 : -0.02), y: 1.75, z, mat: 'frame', outline: true });
  // candle sconces
  const sconces = [[-HX, -7], [-HX, -3.4], [-HX, 0.6], [-HX, 4.8], [HX, -7.6], [HX, -3.4], [HX, 0.6], [HX, 4.2], [HX, 7.6]];
  for (const [x, z] of sconces) list.push({ w: 0.08, h: 0.14, d: 0.08, x: x + (x < 0 ? 0.05 : -0.05), y: 1.84, z, mat: 'brass', outline: true });
  // a small table with a vase
  list.push({ w: 0.4, h: 0.8, d: 1.0, x: -HX + 0.22, y: 0.4, z: 1.45, mat: 'wood', outline: true });

  return createArea({
    bounds: { minX: -HX, maxX: HX, minZ: -HZ, maxZ: HZ },
    height: 3.2,
    furniture: list,
    doors: [{ hinge: { x: -0.48, z: -HZ + 0.03 }, width: 0.96, height: 2.08, dir: 1 }],
    doorways: [{ x: 0, z: -HZ + 0.005, w: 0.96, h: 2.08 }],
    circle: { x: 0, z: 0 },
    light: { x: HX - 0.15, y: 2.0, z: 0.6, intensity: 2.2, distance: 8 },
    moon: [-2, 6, -8],
    extra: (m) => [
      [m.brass, placed(new THREE.CylinderGeometry(0.07, 0.1, 0.3, 10), -HX + 0.22, 0.95, 1.45)],   // vase
    ],
    decorate({ real, group }) {
      // runner carpet down the middle
      const rug = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 16.5), new THREE.MeshLambertMaterial({ map: tex.rug() }));
      rug.rotation.x = -Math.PI / 2;
      rug.position.y = 0.004;
      real.add(rug);
      const pm = portraitMaterial();
      for (const [x, z] of portraits) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.66), pm);
        p.position.set(x + (x < 0 ? 0.045 : -0.045), 1.75, z);
        p.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
        real.add(p);
      }
      const fire = flames(sconces.map(([x, z]) => [x + (x < 0 ? 0.08 : -0.08), 2.0, z]));
      group.add(fire.obj);
      real.add(cobweb(new THREE.Vector3(-HX, 3.2, -HZ), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)));
      real.add(cobweb(new THREE.Vector3(HX, 3.2, HZ), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, -1)));
      return {
        update(time, dim) {
          fire.update(time, dim);
          pm.emissiveIntensity = 0.3 + 1.2 * Math.pow(Math.max(0, Math.sin(time * 0.6 + 1)), 12);
        },
      };
    },
    info: {
      id: 'hallway',
      name: 'The Hallway',
      bounds: { minX: -HX, maxX: HX, minZ: -HZ, maxZ: HZ },
      obstacles: [[-HX, -HX + 0.45, 0.9, 2.0]],
      circle: { x: 0, z: 0 },
      entry: { x: 0, z: 7.6, yaw: 0 },
      exitZone: { x: 0, z: -HZ + 0.6, r: 0.7 },
      exitPoint: { x: 0, y: 1.1, z: -HZ + 0.1 },
      keySpot: { x: 0, z: -3.5 },
      spawnAngles: [0, Math.PI],   // ghosts come from down the corridor, ahead or behind
    },
  });
}

// ---- the stairwell -----------------------------------------------------------------

export function createStairwell() {
  const HX = 4, HZ = 4;
  const PIT = { x0: -1.3, x1: 1.3, z0: -3.6, z1: 0.8 };
  const list = [];
  // the staircase going down into the dark
  for (let i = 0; i < 12; i++) {
    const top = -(i + 1) * 0.25;
    const h = top + 3.2;
    list.push({ w: 2.5, h, d: 0.35, x: 0, y: -3.2 + h / 2, z: PIT.z1 - (i + 0.5) * 0.35, mat: 'wood', outline: true });
  }
  // railing around the opening (open at the top of the stairs)
  for (const x of [PIT.x0 - 0.05, PIT.x1 + 0.05]) {
    for (let z = PIT.z1; z >= PIT.z0 - 0.01; z -= 1.1) list.push({ w: 0.06, h: 1.0, d: 0.06, x, y: 0.5, z, mat: 'darkWood', outline: true });
    list.push({ w: 0.07, h: 0.07, d: PIT.z1 - PIT.z0 + 0.1, x, y: 1.0, z: (PIT.z0 + PIT.z1) / 2, mat: 'darkWood', outline: true });
  }
  list.push({ w: PIT.x1 - PIT.x0 + 0.2, h: 0.07, d: 0.07, x: 0, y: 1.0, z: PIT.z0 - 0.05, mat: 'darkWood', outline: true });
  for (const x of [-0.7, 0, 0.7]) list.push({ w: 0.06, h: 1.0, d: 0.06, x, y: 0.5, z: PIT.z0 - 0.05, mat: 'darkWood', outline: true });
  // the hallway door we came through, closed
  list.push({ w: 0.96, h: 2.08, d: 0.05, x: -2.5, y: 1.04, z: HZ - 0.03, mat: 'darkWood', outline: true });
  doorFrame(list, -2.5, HZ - 0.04, 0.96, 2.08);
  // window frame on the right wall
  for (const z of [-1.9, -0.1]) list.push({ w: 0.08, h: 1.3, d: 0.08, x: HX - 0.05, y: 1.6, z, mat: 'paint', outline: true });
  list.push({ w: 0.08, h: 0.08, d: 1.9, x: HX - 0.05, y: 2.25, z: -1, mat: 'paint', outline: true });
  list.push({ w: 0.18, h: 0.06, d: 2.0, x: HX - 0.1, y: 0.95, z: -1, mat: 'paint', outline: true });
  // an old chest
  list.push({ w: 0.9, h: 0.5, d: 0.5, x: -3.3, y: 0.25, z: -2.6, mat: 'darkWood', outline: true });
  list.push({ w: 0.94, h: 0.06, d: 0.54, x: -3.3, y: 0.52, z: -2.6, mat: 'brass', outline: false });
  // the lantern hanging over the stairs
  list.push({ w: 0.02, h: 0.7, d: 0.02, x: 0, y: 2.85, z: -1.4, mat: 'iron', outline: true });
  list.push({ w: 0.2, h: 0.3, d: 0.2, x: 0, y: 2.35, z: -1.4, mat: 'brass', outline: true });

  return createArea({
    bounds: { minX: -HX, maxX: HX, minZ: -HZ, maxZ: HZ },
    height: 3.2,
    bottom: -3.2,
    floors: [
      [-HX, PIT.x0, -HZ, HZ, 0], [PIT.x1, HX, -HZ, HZ, 0],
      [PIT.x0, PIT.x1, PIT.z1, HZ, 0], [PIT.x0, PIT.x1, -HZ, PIT.z0, 0],
      [-HX, HX, -HZ, HZ, -3.2],
    ],
    furniture: list,
    circle: { x: 2.5, z: 2.3 },
    light: { x: 0, y: 2.25, z: -1.4, intensity: 2.6, distance: 10 },
    moon: [8, 5, -2],
    decorate({ real, group, outline, furnLines }) {
      const sky = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.2), new THREE.MeshBasicMaterial({ map: tex.nightSky(), color: 0xb0b8d0 }));
      sky.position.set(HX - 0.02, 1.6, -1);
      sky.rotation.y = -Math.PI / 2;
      real.add(sky);
      const fire = flames([[0, 2.35, -1.4]], 0.3);
      group.add(fire.obj);
      // thick cobwebs block the stairs until the bats are gone
      const webPts = [];
      for (let i = 0; i <= 8; i++) {
        const x = PIT.x0 + (i / 8) * (PIT.x1 - PIT.x0);
        webPts.push(new THREE.Vector3(x, 0, PIT.z1), new THREE.Vector3(-x * 0.6, 1.9, PIT.z1));
      }
      for (const y of [0.4, 0.9, 1.4]) webPts.push(new THREE.Vector3(PIT.x0, y, PIT.z1), new THREE.Vector3(PIT.x1, y, PIT.z1));
      const webMat = new THREE.LineBasicMaterial({ color: 0xa8a8b4, transparent: true, opacity: 0.35 });
      const web = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(webPts), webMat);
      group.add(web);
      real.add(cobweb(new THREE.Vector3(-HX, 3.2, -HZ), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)));
      return {
        update(time, dim, exit) {
          fire.update(time, dim);
          webMat.opacity = 0.35 * (1 - exit);
          web.visible = exit < 0.99;
        },
      };
    },
    info: {
      id: 'stairwell',
      name: 'The Staircase',
      bounds: { minX: -HX, maxX: HX, minZ: -HZ, maxZ: HZ },
      obstacles: [[PIT.x0 - 0.15, PIT.x1 + 0.15, PIT.z0 - 0.2, PIT.z1 - 0.05], [-3.8, -2.8, -2.9, -2.3]],
      circle: { x: 2.5, z: 2.3 },
      entry: { x: -2.5, z: 3.1, yaw: -0.5 },   // looking toward the stairs
      exitZone: { x: 0, z: PIT.z1 + 0.35, r: 0.6 },
      exitPoint: { x: 0, y: 0.6, z: PIT.z1 },
      noKey: true,   // the stairs open as soon as the bats are gone
    },
  });
}

// ---- the entrance hall --------------------------------------------------------------

export function createFoyer() {
  const HX = 6, HZ = 5, H = 4.2;
  const list = [];
  // the grand staircase we came down (behind the player)
  for (let i = 0; i < 9; i++) {
    const h = (i + 1) * 0.3;
    list.push({ w: 3.0, h, d: 0.13, x: 0, y: h / 2, z: 3.95 + (i + 0.5) * 0.12, mat: 'wood', outline: true });
  }
  for (const x of [-1.55, 1.55]) {
    list.push({ w: 0.08, h: 1.0, d: 0.08, x, y: 0.5, z: 3.9, mat: 'darkWood', outline: true });
    list.push({ w: 0.07, h: 0.07, d: 1.2, x, y: 1.0 + 1.3, z: 4.45, rx: -1.1, mat: 'darkWood', outline: true });
  }
  // the front door frame (double door)
  list.push(
    { w: 0.12, h: 2.8, d: 0.12, x: -1.08, y: 1.4, z: -HZ + 0.05, mat: 'trim', outline: true },
    { w: 0.12, h: 2.8, d: 0.12, x: 1.08, y: 1.4, z: -HZ + 0.05, mat: 'trim', outline: true },
    { w: 2.3, h: 0.16, d: 0.14, x: 0, y: 2.78, z: -HZ + 0.05, mat: 'trim', outline: true },
  );
  // two suits of armor guarding the door
  for (const x of [-2.3, 2.3]) {
    list.push(
      { w: 0.5, h: 0.12, d: 0.4, x, y: 0.06, z: -HZ + 0.6, mat: 'stone', outline: true },
      { w: 0.3, h: 0.85, d: 0.22, x, y: 0.55, z: -HZ + 0.6, mat: 'iron', outline: true },
      { w: 0.46, h: 0.6, d: 0.28, x, y: 1.28, z: -HZ + 0.6, mat: 'iron', outline: true },
      { w: 0.5, h: 0.12, d: 0.3, x, y: 1.6, z: -HZ + 0.6, mat: 'iron', outline: false },
      { w: 0.04, h: 1.9, d: 0.04, x: x + (x < 0 ? 0.32 : -0.32), y: 0.95, z: -HZ + 0.55, mat: 'iron', outline: true },
    );
  }
  // side windows with curtains on the left wall
  for (const z of [-1.5, 2]) {
    list.push(
      { w: 0.08, h: 1.4, d: 0.08, x: -HX + 0.05, y: 1.7, z: z - 0.8, mat: 'paint', outline: true },
      { w: 0.08, h: 1.4, d: 0.08, x: -HX + 0.05, y: 1.7, z: z + 0.8, mat: 'paint', outline: true },
      { w: 0.08, h: 0.08, d: 1.68, x: -HX + 0.05, y: 2.4, z, mat: 'paint', outline: true },
      { w: 0.06, h: 2.4, d: 0.5, x: -HX + 0.1, y: 1.5, z: z - 1.1, mat: 'curtain', outline: true },
      { w: 0.06, h: 2.4, d: 0.5, x: -HX + 0.1, y: 1.5, z: z + 1.1, mat: 'curtain', outline: true },
    );
  }
  // console table, coat rack and a tall clock
  list.push({ w: 0.45, h: 0.8, d: 1.6, x: HX - 0.25, y: 0.4, z: 1, mat: 'wood', outline: true });
  list.push({ w: 0.06, h: 1.8, d: 0.06, x: 4.8, y: 0.9, z: -3.6, mat: 'darkWood', outline: true });
  list.push({ w: 0.5, h: 0.04, d: 0.04, x: 4.8, y: 1.7, z: -3.6, mat: 'darkWood', outline: true });
  list.push({ w: 0.5, h: 2.1, d: 0.35, x: -HX + 0.3, y: 1.05, z: 4.2, mat: 'darkWood', outline: true });
  list.push({ w: 0.6, h: 0.36, d: 0.42, x: -HX + 0.3, y: 2.28, z: 4.2, mat: 'trim', outline: true });
  // chandelier chain
  list.push({ w: 0.03, h: 0.6, d: 0.03, x: 0, y: H - 0.3, z: 0, mat: 'iron', outline: true });
  // portrait frame on the right wall
  list.push({ w: 0.04, h: 0.9, d: 0.72, x: HX - 0.02, y: 2.0, z: -2, mat: 'frame', outline: true });

  const chandelierFlames = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    chandelierFlames.push([Math.cos(a) * 0.6, 3.42, Math.sin(a) * 0.6]);
  }

  return createArea({
    bounds: { minX: -HX, maxX: HX, minZ: -HZ, maxZ: HZ },
    height: H,
    furniture: list,
    doors: [
      { hinge: { x: -1.0, z: -HZ + 0.03 }, width: 1.0, height: 2.6, dir: 1 },
      { hinge: { x: 1.0, z: -HZ + 0.03 }, width: 1.0, height: 2.6, dir: -1 },
    ],
    doorways: [{ x: 0, z: -HZ + 0.005, w: 2.0, h: 2.6, sky: true }],
    circle: { x: 0, z: 0.2 },
    light: { x: 0, y: 3.3, z: 0, intensity: 3.6, distance: 13 },
    moon: [-8, 5, 2],
    extra: (m) => [
      [m.brass, placed(new THREE.TorusGeometry(0.6, 0.025, 6, 24), 0, 3.3, 0, Math.PI / 2)],   // chandelier ring
      ...[-2.3, 2.3].map((x) => [m.iron, placed(new THREE.SphereGeometry(0.15, 10, 8), x, 1.78, -HZ + 0.6)]),  // helmets
      ...chandelierFlames.map(([x, , z]) => [m.paint, placed(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 6), x, 3.34, z)]),  // candles
    ],
    decorate({ real, group }) {
      const rug = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 3.4), new THREE.MeshLambertMaterial({ map: tex.rug() }));
      rug.rotation.x = -Math.PI / 2;
      rug.position.set(0, 0.004, 0.2);
      real.add(rug);
      const skyMat = new THREE.MeshBasicMaterial({ map: tex.nightSky(), color: 0xb0b8d0 });
      for (const z of [-1.5, 2]) {
        const sky = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.3), skyMat);
        sky.position.set(-HX + 0.02, 1.7, z);
        sky.rotation.y = Math.PI / 2;
        real.add(sky);
      }
      const pm = portraitMaterial();
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.76), pm);
      p.position.set(HX - 0.045, 2.0, -2);
      p.rotation.y = -Math.PI / 2;
      real.add(p);
      const fire = flames([...chandelierFlames, [HX - 0.25, 1.05, 0.6], [HX - 0.25, 1.05, 1.4]]);
      group.add(fire.obj);
      real.add(cobweb(new THREE.Vector3(HX, H, -HZ), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1)));
      real.add(cobweb(new THREE.Vector3(-HX, H, -HZ), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)));
      return {
        update(time, dim) {
          fire.update(time, dim);
          pm.emissiveIntensity = 0.3 + 1.2 * Math.pow(Math.max(0, Math.sin(time * 0.5 + 2)), 12);
        },
      };
    },
    info: {
      id: 'foyer',
      name: 'The Entrance Hall',
      bounds: { minX: -HX, maxX: HX, minZ: -HZ, maxZ: HZ },
      obstacles: [
        [-1.7, 1.7, 3.8, HZ], [-2.6, -2.0, -HZ, -HZ + 0.9], [2.0, 2.6, -HZ, -HZ + 0.9],
        [HX - 0.5, HX, 0.2, 1.8], [4.6, 5.0, -3.8, -3.4], [-HX, -HX + 0.55, 4.0, HZ],
      ],
      circle: { x: 0, z: 0.2 },
      entry: { x: 0, z: 3.3, yaw: 0 },
      exitZone: { x: 0, z: -HZ + 0.6, r: 0.85 },
      exitPoint: { x: 0, y: 1.3, z: -HZ + 0.1 },
      bossFrom: { x: 0, z: -HZ },   // the demon comes from the front door
    },
  });
}
