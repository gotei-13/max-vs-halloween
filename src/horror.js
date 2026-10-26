import * as THREE from '../vendor/three.module.js';

// Bigger horror moments during a game, one at a time, every 20-35 seconds:
//   blackout - the candle and fire sputter, the room goes almost black for a few seconds
//   shadow   - a tall shadow figure stands in a far corner; when you look at it, it's gone
//   writing  - bloody words fade in on a wall
//   behind   - someone whispers right behind your head
//   door     - the door creaks open by itself... then slams shut

const EVENTS = ['blackout', 'shadow', 'writing', 'behind', 'door'];
const WORDS = ['GET OUT', 'BEHIND YOU', 'I SEE YOU', 'MAXIM...', 'HELP ME', 'RUN'];

const _head = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _v = new THREE.Vector3();

function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 512;
  const ctx = c.getContext('2d');
  // a tall thin figure: head, narrow shoulders, long arms, fading into the floor
  ctx.filter = 'blur(6px)';
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(128, 70, 34, 42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(78, 140);
  ctx.quadraticCurveTo(128, 100, 178, 140);
  ctx.lineTo(196, 360);
  ctx.lineTo(176, 500);
  ctx.lineTo(80, 500);
  ctx.lineTo(60, 360);
  ctx.closePath();
  ctx.fill();
  ctx.filter = 'none';
  // a faint dark-red rim so it shows in the outline room too
  ctx.globalCompositeOperation = 'destination-over';
  ctx.shadowColor = 'rgba(120, 0, 30, 0.9)';
  ctx.shadowBlur = 30;
  ctx.fillRect(100, 140, 56, 300);
  ctx.globalCompositeOperation = 'source-over';
  ctx.shadowBlur = 0;
  // glowing red eyes
  for (const x of [114, 142]) {
    const g = ctx.createRadialGradient(x, 70, 1, x, 70, 9);
    g.addColorStop(0, '#ffd0c0');
    g.addColorStop(0.4, '#ff2010');
    g.addColorStop(1, 'rgba(255,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 10, 60, 20, 20);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function writingTexture(text) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 320;
  const ctx = c.getContext('2d');
  ctx.font = "150px 'Creepster', Impact, fantasy";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#7a0006';
  ctx.shadowColor = '#3a0000';
  ctx.shadowBlur = 8;
  const width = Math.min(980, ctx.measureText(text).width);
  ctx.fillText(text, 512, 130, 980);
  // drips running down from the letters
  ctx.shadowBlur = 0;
  for (let i = 0; i < 18; i++) {
    const x = 512 - width / 2 + Math.random() * width;
    const top = 150 + Math.random() * 30;
    const len = 30 + Math.random() * 120;
    const w = 3 + Math.random() * 5;
    ctx.fillRect(x - w / 2, top, w, len);
    ctx.beginPath();
    ctx.arc(x, top + len, w * 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Horror {
  constructor(scene, audio, room) {
    this.scene = scene;
    this.audio = audio;
    this.intensity = 1;   // more than 1: scary moments come more often
    this.allowDoor = true; // false once the bedroom door is the way out
    this.shadowMat = new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, opacity: 0, depthWrite: false });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 2.1), this.shadowMat);
    this.shadow.visible = false;
    scene.add(this.shadow);
    this.writing = null;
    this.setArea(room);
  }

  // the area of the house the player is in now (its walls, and a door that can slam)
  setArea(room) {
    this.room = room;
    this.bounds = room.info.bounds;
    this.door = room.info.horrorDoor ? new THREE.Vector3().copy(room.info.horrorDoor) : null;
    this.reset();
  }

  reset() {
    this.timer = 18 + Math.random() * 8;
    this.event = null;
    this.shadow.visible = false;
    this._removeWriting();
    this.room.setDarkness(0);
    if (this.door && this.allowDoor) this.room.setDoor(0);
  }

  update(dt, camera, playing) {
    if (this.event) {
      this.event.t += dt;
      this[`_${this.event.type}`](this.event, camera, dt);
    } else if (playing) {
      this.timer -= dt * this.intensity;
      if (this.timer <= 0) {
        this.timer = 20 + Math.random() * 15;
        const events = EVENTS.filter((name) => name !== 'door' || (this.door && this.allowDoor));
        this.event = { type: events[Math.floor(Math.random() * events.length)], t: 0, started: false };
      }
    }
    if (!playing && this.event) this.reset();
  }

  _end() {
    this.event = null;
  }

  // ---- the events (called every frame while they run) ----------------------

  _blackout(e, camera) {
    if (!e.started) {
      e.started = true;
      this.audio.candleOut();
    }
    const t = e.t;
    let k;
    if (t < 0.9) k = Math.random() < 0.5 ? 1 : 0.2;   // sputtering
    else if (t < 3.6) k = 0.97;                        // almost pitch black
    else if (t < 4.4) k = Math.random() < 0.5 ? 0.9 : 0;
    else k = 0;
    this.room.setDarkness(k);
    if (t > 1.5 && !e.whispered) {
      e.whispered = true;
      camera.getWorldPosition(_head);
      const a = Math.random() * Math.PI * 2;
      this.audio.at(_v.set(_head.x + Math.sin(a) * 2, 1.6, _head.z + Math.cos(a) * 2), (voice) => this.audio.whisper(voice));
    }
    if (t > 4.4) this._end();
  }

  _shadow(e, camera, dt) {
    camera.getWorldPosition(_head);
    camera.getWorldDirection(_dir);
    if (!e.started) {
      e.started = true;
      // stand far away at the edge of the player's view
      const look = Math.atan2(_dir.x, -_dir.z);
      const angle = look + (0.8 + Math.random() * 0.4) * (Math.random() < 0.5 ? -1 : 1);
      const dist = this._toWall(_head, angle, 5.5) - 0.4;
      this.shadow.position.set(_head.x + Math.sin(angle) * dist, 1.05, _head.z - Math.cos(angle) * dist);
      this.shadow.lookAt(_head.x, 1.05, _head.z);
      this.shadow.visible = true;
      this.shadowMat.opacity = 0;
    }
    const s = this.shadow.position;
    const toShadow = _v.set(s.x - _head.x, 0, s.z - _head.z).normalize();
    const flatLook = _dir.setY(0).normalize();
    const lookedAt = toShadow.dot(flatLook) > Math.cos(THREE.MathUtils.degToRad(22));
    if ((lookedAt && e.t > 0.6) || e.t > 9) {
      // you turn to look... and it's gone
      this.shadow.visible = false;
      if (lookedAt) this.audio.at(s, (voice) => this.audio.whisper(voice));
      this._end();
      return;
    }
    this.shadowMat.opacity = Math.min(0.92, this.shadowMat.opacity + dt * 1.5);
  }

  _writing(e, camera) {
    if (!e.started) {
      e.started = true;
      camera.getWorldPosition(_head);
      camera.getWorldDirection(_dir);
      // on the wall roughly where the player is looking
      const angle = Math.atan2(_dir.x, -_dir.z) + (Math.random() - 0.5) * 0.9;
      const hit = this._wallHit(_head, angle);
      const x = _head.x + Math.sin(angle) * hit.dist, z = _head.z - Math.cos(angle) * hit.dist;
      const mat = new THREE.MeshBasicMaterial({
        map: writingTexture(WORDS[Math.floor(Math.random() * WORDS.length)]), transparent: true, opacity: 0, depthWrite: false,
      });
      // as wide as fits on that wall (narrow at the ends of the hallway)
      const b = this.bounds;
      const wallLength = hit.wall === 'x' ? b.maxZ - b.minZ : b.maxX - b.minX;
      const width = Math.min(3.8, wallLength - 0.4);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width * 0.313), mat);
      // stick it flat on the wall that was hit, facing into the room
      const half = width / 2 + 0.1;
      if (hit.wall === 'x') {
        const wx = x > (b.minX + b.maxX) / 2 ? b.maxX - 0.07 : b.minX + 0.07;
        mesh.position.set(wx, 1.7, THREE.MathUtils.clamp(z, b.minZ + half, b.maxZ - half));
        mesh.rotation.y = wx > 0 ? -Math.PI / 2 : Math.PI / 2;
      } else {
        const wz = z > (b.minZ + b.maxZ) / 2 ? b.maxZ - 0.07 : b.minZ + 0.07;
        mesh.position.set(THREE.MathUtils.clamp(x, b.minX + half, b.maxX - half), 1.7, wz);
        mesh.rotation.y = wz > 0 ? Math.PI : 0;
      }
      this.scene.add(mesh);
      this.writing = { mesh, mat };
      this.audio.at(mesh.position, (voice) => this.audio.whisper(voice));
    }
    const t = e.t;
    this.writing.mat.opacity = t < 2.5 ? t / 2.5 : t < 8 ? 1 : Math.max(0, 1 - (t - 8) / 2);
    if (t > 10) {
      this._removeWriting();
      this._end();
    }
  }

  _behind(e, camera) {
    camera.getWorldPosition(_head);
    camera.getWorldDirection(_dir).setY(0).normalize();
    this.audio.at(_v.copy(_head).addScaledVector(_dir, -0.45), (voice) => this.audio.whisper(voice));
    this._end();
  }

  _door(e) {
    if (!e.started) {
      e.started = true;
      this.audio.at(this.door, (voice) => this.audio.doorCreak(voice));
    }
    const t = e.t;
    if (t < 3) this.room.setDoor(1.1 * (t / 3) * (t / 3));   // slowly creaks open
    else if (t < 5.5) this.room.setDoor(1.1);                  // stays open... pitch black behind it
    else if (t < 5.65) this.room.setDoor(1.1 * (1 - (t - 5.5) / 0.15));
    else {
      this.room.setDoor(0);
      this.audio.at(this.door, (voice) => this.audio.slam(voice));
      this.room.flash(0.4);
      this._end();
    }
  }

  // ---- helpers ------------------------------------------------------------

  // distance from p along a floor angle until a wall (at most max)
  _toWall(p, angle, max) {
    return Math.min(max, this._wallHit(p, angle).dist);
  }

  // where a line from p along a floor angle meets the walls: distance, and
  // whether it hits a wall across x (left/right) or across z (front/back)
  _wallHit(p, angle) {
    const b = this.bounds;
    const dx = Math.sin(angle), dz = -Math.cos(angle);
    const tx = dx ? ((dx > 0 ? b.maxX - 0.05 : b.minX + 0.05) - p.x) / dx : Infinity;
    const tz = dz ? ((dz > 0 ? b.maxZ - 0.05 : b.minZ + 0.05) - p.z) / dz : Infinity;
    return tx < tz ? { dist: tx, wall: 'x' } : { dist: tz, wall: 'z' };
  }

  _removeWriting() {
    if (!this.writing) return;
    this.scene.remove(this.writing.mesh);
    this.writing.mat.map.dispose();
    this.writing.mat.dispose();
    this.writing = null;
  }
}
