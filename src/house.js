import * as THREE from '../vendor/three.module.js';
import * as tex from './textures.js';
import { placed, texturedBox, outlineMesh, solidMeshes, cobweb, buildMagicCircle } from './room.js';

// The rest of the haunted house, one area at a time (only one is loaded, which
// keeps the Quest 1 fast):
//   hallway   - long dark corridor with portraits and candles   (shadow people)
//   stairwell - landing above a staircase going down            (bat swarms)
//   foyer     - entrance hall with the front door               (skeletons, wraiths)
//   yard      - foggy graveyard outside, iron gate at the far end (werewolves, the guardian, then RUN)
// Every area returns the same shape as the bedroom (room.js): { group, info, setExit, ... }.

// ---- shared building blocks ---------------------------------------------------

// a plane whose texture repeats every `tile` meters
function sizedPlane(w, h, tile) {
  const geo = new THREE.PlaneGeometry(w, h);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / tile), uv.getY(i) * (h / tile));
  return geo;
}

// dark grass and dirt for the yard, painted in code
function groundTexture(base, speck, count) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = speck[i % speck.length];
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 2 + Math.random() * 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
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
    grass: lambert({ map: groundTexture('#1a2414', ['#24341a', '#10180c', '#2e3a20'], 2500) }),
    dirt: lambert({ map: groundTexture('#2e2418', ['#3a2e20', '#1e1810', '#4a3a28'], 1500) }),
    siding: lambert({ map: tex.woodGrain(12, 230, 10) }),
    glowWindow: new THREE.MeshBasicMaterial({ color: 0xc87a30 }),
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

// one leaf of an iron gate (bars with rails and spikes), like doorLeaf
function gateLeaf(width, height, dir) {
  const parts = [];
  for (let x = 0.05; x < width; x += 0.15) {
    parts.push({ w: 0.035, h: height, d: 0.035, x: dir * x, y: height / 2, z: 0, mat: 'iron', outline: true });
    parts.push({ w: 0.06, h: 0.12, d: 0.06, x: dir * x, y: height + 0.06, z: 0, ry: Math.PI / 4, mat: 'iron', outline: false });
  }
  for (const y of [0.15, height * 0.5, height - 0.1]) parts.push({ w: width, h: 0.05, d: 0.04, x: dir * width / 2, y, z: 0, mat: 'iron', outline: true });
  return parts;
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
// moon [x, y, z], decorate(ctx) -> { update(time, dim, exit) }, info {...},
// outdoor: no walls or ceiling; floorMat: material name for the floors (default wood)
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
    extra.push([m[spec.floorMat || 'floor'], placed(sizedPlane(x1 - x0, z1 - z0, 2), (x0 + x1) / 2, y, (z0 + z1) / 2, -Math.PI / 2)]);
  }
  const wallY = bottom + wallH / 2;
  if (!spec.outdoor) {
    extra.push([m.ceiling, placed(sizedPlane(W, D, 2), cx, spec.height, cz, Math.PI / 2)]);
    extra.push(
      [m.wall, placed(sizedPlane(W, wallH, 1), cx, wallY, b.minZ)],
      [m.wall, placed(sizedPlane(W, wallH, 1), cx, wallY, b.maxZ, 0, Math.PI)],
      [m.wall, placed(sizedPlane(D, wallH, 1), b.minX, wallY, cz, 0, Math.PI / 2)],
      [m.wall, placed(sizedPlane(D, wallH, 1), b.maxX, wallY, cz, 0, -Math.PI / 2)],
    );
  }
  for (const [y, h] of spec.outdoor ? [] : [[0.07, 0.14], [spec.height - 0.06, 0.12]]) {
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
  const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W, spec.outdoor ? 0.01 : wallH, D)), wallLines);
  box.position.set(cx, spec.outdoor ? 0 : wallY, cz);
  outline.add(box, outlineMesh(spec.furniture, furnLines));

  // ---- doors that open (the way out)
  const leaves = [];
  for (const d of spec.doors || []) {
    const parts = (d.gate ? gateLeaf : doorLeaf)(d.width, d.height, d.dir);
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
  const moonLevel = spec.moonIntensity ?? 0.9;
  const moon = new THREE.DirectionalLight(0x9fb4ff, moonLevel);
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
      moon.intensity = moonLevel * dim;
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
  const HX = 2.4, HZ = 13;
  const list = [];
  doorFrame(list, 0, -HZ + 0.04, 0.96, 2.08);   // the way on, at the far end
  // the bedroom door we came through (behind the player), closed
  list.push({ w: 0.96, h: 2.08, d: 0.05, x: 0, y: 1.04, z: HZ - 0.03, mat: 'darkWood', outline: true });
  doorFrame(list, 0, HZ - 0.04, 0.96, 2.08);
  // locked doors along the walls
  for (const z of [-9, -2, 5]) sideDoor(list, -HX, z);
  for (const z of [-6, 1.5, 9]) sideDoor(list, HX, z);
  // portrait frames
  const portraits = [[-HX, -11], [-HX, -5.5], [-HX, 1.5], [-HX, 9], [HX, -9], [HX, -2.5], [HX, 5]];
  for (const [x, z] of portraits) list.push({ w: 0.04, h: 0.78, d: 0.62, x: x + (x < 0 ? 0.02 : -0.02), y: 1.75, z, mat: 'frame', outline: true });
  // candle sconces
  const sconces = [[-HX, -12], [-HX, -7.2], [-HX, -3.6], [-HX, 3.3], [-HX, 7], [HX, -11], [HX, -7.6], [HX, -4.2], [HX, -0.8], [HX, 3.4], [HX, 7], [HX, 11]];
  for (const [x, z] of sconces) list.push({ w: 0.08, h: 0.14, d: 0.08, x: x + (x < 0 ? 0.05 : -0.05), y: 1.84, z, mat: 'brass', outline: true });
  // a small table with a vase
  list.push({ w: 0.4, h: 0.8, d: 1.0, x: -HX + 0.22, y: 0.4, z: 1.45, mat: 'wood', outline: true });
  // a bench and an old grandfather chair further down
  list.push({ w: 0.45, h: 0.45, d: 1.6, x: HX - 0.25, y: 0.225, z: -1.2, mat: 'darkWood', outline: true });
  list.push({ w: 0.6, h: 0.5, d: 0.6, x: -HX + 0.35, y: 0.25, z: -7.5, mat: 'darkWood', outline: true });
  list.push({ w: 0.6, h: 0.8, d: 0.08, x: -HX + 0.08, y: 0.8, z: -7.5, mat: 'darkWood', outline: true });

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
      const rug = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 2 * HZ - 2), new THREE.MeshLambertMaterial({ map: tex.rug() }));
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
      obstacles: [[-HX, -HX + 0.45, 0.9, 2.0], [HX - 0.5, HX, -2.0, -0.4], [-HX, -HX + 0.7, -7.85, -7.15]],
      circle: { x: 0, z: 0 },
      entry: { x: 0, z: HZ - 1.4, yaw: 0 },
      exitZone: { x: 0, z: -HZ + 0.6, r: 0.75 },
      exitPoint: { x: 0, y: 1.1, z: -HZ + 0.1 },
      keySpot: { x: 0, z: -6 },
      spawnAngles: [0, Math.PI],   // ghosts come from down the corridor, ahead or behind
    },
  });
}

// ---- the stairwell -----------------------------------------------------------------

export function createStairwell() {
  const HX = 5.5, HZ = 5.5;
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
  list.push({ w: 0.9, h: 0.5, d: 0.5, x: -HX + 0.7, y: 0.25, z: -2.6, mat: 'darkWood', outline: true });
  list.push({ w: 0.94, h: 0.06, d: 0.54, x: -HX + 0.7, y: 0.52, z: -2.6, mat: 'brass', outline: false });
  // a broken cupboard and a pile of crates in the corners
  list.push({ w: 1.2, h: 2.0, d: 0.5, x: HX - 0.3, y: 1.0, z: HZ - 1.2, ry: Math.PI / 2, mat: 'darkWood', outline: true });
  list.push({ w: 0.7, h: 0.7, d: 0.7, x: -HX + 0.5, y: 0.35, z: -HZ + 0.5, mat: 'wood', outline: true });
  list.push({ w: 0.6, h: 0.6, d: 0.6, x: -HX + 1.25, y: 0.3, z: -HZ + 0.45, mat: 'wood', outline: true });
  list.push({ w: 0.5, h: 0.5, d: 0.5, x: -HX + 0.55, y: 0.95, z: -HZ + 0.5, ry: 0.4, mat: 'wood', outline: true });
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
    circle: { x: 3.2, z: 3.0 },
    light: { x: 0, y: 2.25, z: -1.4, intensity: 3.0, distance: 12 },
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
      obstacles: [
        [PIT.x0 - 0.15, PIT.x1 + 0.15, PIT.z0 - 0.2, PIT.z1 - 0.05], [-HX, -HX + 1.2, -2.9, -2.3],
        [HX - 0.6, HX, HZ - 1.9, HZ - 0.5], [-HX, -HX + 1.6, -HZ, -HZ + 0.9],
      ],
      circle: { x: 3.2, z: 3.0 },
      entry: { x: -2.5, z: HZ - 0.9, yaw: -0.5 },   // looking toward the stairs
      exitZone: { x: 0, z: PIT.z1 + 0.35, r: 0.6 },
      exitPoint: { x: 0, y: 0.6, z: PIT.z1 },
      noKey: true,   // the stairs open as soon as the bats are gone
    },
  });
}

// ---- the entrance hall --------------------------------------------------------------

export function createFoyer() {
  const HX = 8, HZ = 7, H = 4.6;
  const list = [];
  // the grand staircase we came down (behind the player)
  for (let i = 0; i < 9; i++) {
    const h = (i + 1) * 0.3;
    list.push({ w: 3.0, h, d: 0.13, x: 0, y: h / 2, z: HZ - 1.05 + (i + 0.5) * 0.12, mat: 'wood', outline: true });
  }
  for (const x of [-1.55, 1.55]) {
    list.push({ w: 0.08, h: 1.0, d: 0.08, x, y: 0.5, z: HZ - 1.1, mat: 'darkWood', outline: true });
    list.push({ w: 0.07, h: 0.07, d: 1.2, x, y: 1.0 + 1.3, z: HZ - 0.55, rx: -1.1, mat: 'darkWood', outline: true });
  }
  // pillars holding up the gallery
  for (const x of [-4.5, 4.5]) for (const z of [-3, 2.5]) {
    list.push({ w: 0.5, h: H, d: 0.5, x, y: H / 2, z, mat: 'stone', outline: true });
  }
  // a long dining table with chairs on the right, a cold fireplace on the left
  list.push({ w: 1.0, h: 0.06, d: 3.2, x: 5.8, y: 0.78, z: -0.2, mat: 'wood', outline: true });
  for (const z of [-1.6, 1.2]) list.push({ w: 0.9, h: 0.75, d: 0.08, x: 5.8, y: 0.375, z, mat: 'wood', outline: true });
  for (const z of [-1.2, -0.2, 0.8]) for (const s of [-1, 1]) list.push({ w: 0.4, h: 0.45, d: 0.4, x: 5.8 + s * 0.8, y: 0.225, z, mat: 'darkWood', outline: true });
  list.push({ w: 0.5, h: 1.3, d: 2.2, x: -HX + 0.25, y: 0.65, z: -4.3, mat: 'stone', outline: true });
  list.push({ w: 0.06, h: 0.9, d: 1.3, x: -HX + 0.52, y: 0.45, z: -4.3, mat: 'soot', outline: false });
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
  list.push({ w: 0.06, h: 1.8, d: 0.06, x: HX - 1.2, y: 0.9, z: -HZ + 1.4, mat: 'darkWood', outline: true });
  list.push({ w: 0.5, h: 0.04, d: 0.04, x: HX - 1.2, y: 1.7, z: -HZ + 1.4, mat: 'darkWood', outline: true });
  list.push({ w: 0.5, h: 2.1, d: 0.35, x: -HX + 0.3, y: 1.05, z: HZ - 0.8, mat: 'darkWood', outline: true });
  list.push({ w: 0.6, h: 0.36, d: 0.42, x: -HX + 0.3, y: 2.28, z: HZ - 0.8, mat: 'trim', outline: true });
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
    light: { x: 0, y: 3.3, z: 0, intensity: 4.4, distance: 17 },
    moon: [-8, 5, 2],
    extra: (m) => [
      [m.brass, placed(new THREE.TorusGeometry(0.6, 0.025, 6, 24), 0, 3.3, 0, Math.PI / 2)],   // chandelier ring
      ...[-2.3, 2.3].map((x) => [m.iron, placed(new THREE.SphereGeometry(0.15, 10, 8), x, 1.78, -HZ + 0.6)]),  // helmets
      ...chandelierFlames.map(([x, , z]) => [m.paint, placed(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 6), x, 3.34, z)]),  // candles
    ],
    decorate({ real, group }) {
      const rug = new THREE.Mesh(new THREE.PlaneGeometry(6, 4.4), new THREE.MeshLambertMaterial({ map: tex.rug() }));
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
        [-1.7, 1.7, HZ - 1.2, HZ], [-2.6, -2.0, -HZ, -HZ + 0.9], [2.0, 2.6, -HZ, -HZ + 0.9],
        [HX - 0.5, HX, 0.2, 1.8], [HX - 1.4, HX - 1.0, -HZ + 1.2, -HZ + 1.6], [-HX, -HX + 0.55, HZ - 1.0, HZ],
        [-4.8, -4.2, -3.3, -2.7], [4.2, 4.8, -3.3, -2.7], [-4.8, -4.2, 2.2, 2.8], [4.2, 4.8, 2.2, 2.8],
        [4.9, 6.7, -1.9, 1.5], [-HX, -HX + 0.6, -5.5, -3.1],
      ],
      circle: { x: 0, z: 0.2 },
      entry: { x: 0, z: HZ - 1.7, yaw: 0 },
      exitZone: { x: 0, z: -HZ + 0.6, r: 0.85 },
      exitPoint: { x: 0, y: 1.3, z: -HZ + 0.1 },
      keySpot: { x: 0, z: -3 },
    },
  });
}

// ---- the yard (outside) ----------------------------------------------------------------

export function createYard() {
  const HX = 10, Z0 = -22, Z1 = 6;   // fence left/right at ±HX, gate at Z0, the house at Z1
  const list = [];
  const obstacles = [];

  // iron fence: posts every 1.25 m and two rails, with a gap for the gate
  const post = (x, z) => list.push(
    { w: 0.07, h: 1.7, d: 0.07, x, y: 0.85, z, mat: 'iron', outline: true },
    { w: 0.1, h: 0.14, d: 0.1, x, y: 1.75, z, ry: Math.PI / 4, mat: 'iron', outline: false },
  );
  for (let z = Z0; z <= Z1 - 0.5; z += 1.25) { post(-HX, z); post(HX, z); }
  for (let x = -HX + 1.25; x < HX - 0.5; x += 1.25) if (Math.abs(x) > 1.6) post(x, Z0);
  for (const y of [0.45, 1.45]) {
    for (const x of [-HX, HX]) list.push({ w: 0.04, h: 0.05, d: Z1 - Z0, x, y, z: (Z0 + Z1) / 2, mat: 'iron', outline: true });
    for (const s of [-1, 1]) list.push({ w: HX - 1.65, h: 0.05, d: 0.04, x: s * (1.65 + (HX - 1.65) / 2), y, z: Z0, mat: 'iron', outline: true });
  }
  // gate pillars with lanterns on top
  for (const s of [-1, 1]) {
    list.push(
      { w: 0.45, h: 2.5, d: 0.45, x: s * 1.45, y: 1.25, z: Z0, mat: 'stone', outline: true },
      { w: 0.55, h: 0.1, d: 0.55, x: s * 1.45, y: 2.55, z: Z0, mat: 'stone', outline: true },
      { w: 0.18, h: 0.26, d: 0.18, x: s * 1.45, y: 2.75, z: Z0, mat: 'brass', outline: true },
    );
  }

  // gravestones, some with crosses, leaning a little
  const graves = [
    [-3, -3], [-5.5, -4.5], [-7.8, -2], [3.5, -2.5], [6, -4], [8.2, -1.5], [-3.5, -12], [-8.3, -11],
    [4, -12.5], [6.5, -10], [8.2, -14.5], [-4, -17], [-7, -18.5], [3.5, -17.5], [6.5, -19], [-2.6, -14.5], [2.8, -6.5],
  ];
  graves.forEach(([x, z], i) => {
    const tilt = ((i * 37) % 7 - 3) * 0.04;
    const turn = ((i * 53) % 9 - 4) * 0.06;
    if (i % 3 === 0) {
      list.push(
        { w: 0.1, h: 1.1, d: 0.1, x, y: 0.55, z, rx: tilt, ry: turn, mat: 'stone', outline: true },
        { w: 0.55, h: 0.1, d: 0.1, x, y: 0.82, z, rx: tilt, ry: turn, mat: 'stone', outline: true },
      );
    } else {
      list.push({ w: 0.6, h: 0.85, d: 0.15, x, y: 0.42, z, rx: tilt, ry: turn, mat: 'stone', outline: true });
    }
    list.push({ w: 0.8, h: 0.08, d: 0.4, x, y: 0.04, z, ry: turn, mat: 'stone', outline: false });
    obstacles.push([x - 0.45, x + 0.45, z - 0.3, z + 0.3]);
  });

  // a stone crypt with a dark doorway facing the path
  const CX = -6.6, CZ = -7.5;
  list.push(
    { w: 3.0, h: 2.8, d: 3.4, x: CX, y: 1.4, z: CZ, mat: 'stone', outline: true },
    { w: 3.4, h: 0.3, d: 3.8, x: CX, y: 2.95, z: CZ, mat: 'stone', outline: true },
    { w: 2.2, h: 0.5, d: 2.6, x: CX, y: 3.35, z: CZ, mat: 'stone', outline: true },
    { w: 0.04, h: 1.9, d: 1.1, x: CX + 1.51, y: 0.95, z: CZ, mat: 'soot', outline: true },
  );
  obstacles.push([CX - 1.7, CX + 1.7, CZ - 1.9, CZ + 1.9]);

  // dead trees: a trunk and crooked branches
  const trees = [[5.5, -7.5], [-8.2, 3.2], [7.6, 3.4], [-2.8, -20.2], [8.4, -20]];
  const trunks = [];
  trees.forEach(([x, z], i) => {
    trunks.push([x, z]);
    for (let k = 0; k < 4; k++) {
      const a = k * 1.7 + i;
      list.push({ w: 0.09, h: 1.7 - k * 0.2, d: 0.09, x: x + Math.cos(a) * 0.45, y: 2.6 + k * 0.45, z: z + Math.sin(a) * 0.45, rx: Math.sin(a) * 0.8, ry: a, mat: 'darkWood', outline: true });
    }
    obstacles.push([x - 0.4, x + 0.4, z - 0.4, z + 0.4]);
  });

  // the house we just escaped from, behind the player
  list.push(
    { w: 22, h: 7, d: 3, x: 0, y: 3.5, z: Z1 + 1.5, mat: 'siding', outline: true },
    { w: 23, h: 0.4, d: 4, x: 0, y: 7.2, z: Z1 + 1.4, mat: 'trim', outline: true },
    { w: 2.6, h: 0.2, d: 1.2, x: 0, y: 0.1, z: Z1 - 0.5, mat: 'stone', outline: true },   // porch step
    { w: 0.15, h: 2.9, d: 0.15, x: -1.15, y: 1.45, z: Z1 - 0.05, mat: 'trim', outline: true },
    { w: 0.15, h: 2.9, d: 0.15, x: 1.15, y: 1.45, z: Z1 - 0.05, mat: 'trim', outline: true },
  );

  const lanterns = [[-1.45, 2.8, Z0], [1.45, 2.8, Z0], [-1.9, 2.3, Z1 - 0.15], [1.9, 2.3, Z1 - 0.15]];

  return createArea({
    bounds: { minX: -HX, maxX: HX, minZ: Z0, maxZ: Z1 },
    height: 8,
    outdoor: true,
    floorMat: 'grass',
    floors: [[-45, 45, -75, 35, 0]],
    furniture: list,
    doors: [
      { hinge: { x: -1.22, z: Z0 }, width: 1.2, height: 2.0, dir: 1, gate: true },
      { hinge: { x: 1.22, z: Z0 }, width: 1.2, height: 2.0, dir: -1, gate: true },
    ],
    circle: { x: 0, z: -9 },
    light: { x: 0, y: 2.6, z: Z0 + 0.8, intensity: 3.6, distance: 18 },
    moon: [-20, 25, -40],
    moonIntensity: 1.2,
    extra: (m) => [
      [m.dirt, placed(sizedPlane(2.2, Z1 - Z0, 2), 0, 0.006, (Z0 + Z1) / 2, -Math.PI / 2)],   // the path to the gate
      ...trunks.map(([x, z]) => [m.darkWood, placed(new THREE.CylinderGeometry(0.14, 0.26, 4.2, 8), x, 2.1, z)]),
      // windows of the house: some glowing, some dark
      ...[[-8, 1.8], [-5, 1.8], [5, 1.8], [8, 1.8], [-8, 4.8], [-2.5, 4.8], [2.5, 4.8], [8, 4.8]].map(([x, y], i) =>
        [i % 3 === 1 ? m.soot : m.glowWindow, placed(new THREE.PlaneGeometry(1.0, 1.4), x, y, Z1 - 0.02, 0, Math.PI)]),
      [m.glowWindow, placed(new THREE.PlaneGeometry(2.1, 2.7), 0, 1.35, Z1 - 0.02, 0, Math.PI)],   // the open front door
    ],
    decorate({ group }) {
      // a big moon and stars, never hidden by the fog
      const moonMat = new THREE.SpriteMaterial({ map: tex.sparkle(), color: 0xfff4d0, fog: false, depthWrite: false });
      const moonSprite = new THREE.Sprite(moonMat);
      moonSprite.position.set(-22, 32, -70);
      moonSprite.scale.setScalar(16);
      const stars = [];
      for (let i = 0; i < 260; i++) {
        const a = Math.random() * Math.PI * 2, up = 0.15 + Math.random() * 0.8;
        stars.push(new THREE.Vector3(Math.cos(a) * Math.cos(up) * 90, Math.sin(up) * 90, Math.sin(a) * Math.cos(up) * 90));
      }
      const starPoints = new THREE.Points(
        new THREE.BufferGeometry().setFromPoints(stars),
        new THREE.PointsMaterial({ color: 0xcfd8ff, size: 2, sizeAttenuation: false, fog: false }),
      );
      const fire = flames(lanterns, 0.3);
      group.add(moonSprite, starPoints, fire.obj);
      return {
        update(time, dim) {
          fire.update(time, dim);
        },
      };
    },
    info: {
      id: 'yard',
      name: 'The Graveyard',
      outdoor: true,
      bounds: { minX: -HX + 0.3, maxX: HX - 0.3, minZ: Z0 + 0.3, maxZ: Z1 - 0.7 },
      obstacles: [...obstacles, [-1.8, -1.1, Z0, Z0 + 0.4], [1.1, 1.8, Z0, Z0 + 0.4]],
      circle: { x: 0, z: -9 },
      entry: { x: 0, z: Z1 - 1.8, yaw: 0 },
      exitZone: { x: 0, z: Z0 + 0.7, r: 1.1 },
      exitPoint: { x: 0, y: 1.2, z: Z0 },
      bossFrom: { x: 0, z: Z0 },   // the guardian comes in through the gate
      noKey: true,
    },
  });
}
