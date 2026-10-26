// All sounds are synthesized with Web Audio, so the game needs no sound files.
// They aim to sound natural and spooky (wind, wood, voices, bells, heartbeats),
// not like synth beeps. Ghost sounds go through HRTF panners: with headphones
// you can hear direction.

// vocal-tract resonances for a few vowels, used to make oscillators sound like voices
const VOWELS = {
  a: [[800, 1], [1150, 0.6], [2900, 0.25]],
  o: [[450, 1], [800, 0.5], [2830, 0.15]],
  u: [[325, 1], [700, 0.35], [2530, 0.1]],
  i: [[300, 0.8], [2300, 0.6], [3000, 0.3]],
};

// a slow lullaby in A minor for the music box: [midi note or 0 for a rest, beats]
const LULLABY = [
  [81, 1], [84, 1], [88, 1], [84, 1], [86, 1], [83, 1], [79, 2],
  [81, 1], [84, 1], [88, 1], [91, 1], [89, 1], [88, 1], [86, 2],
  [84, 1], [83, 1], [81, 1], [80, 1], [81, 1], [83, 1], [76, 2],
  [77, 1], [76, 1], [74, 1], [72, 1], [71, 1], [68, 1], [69, 3], [0, 3],
];
// low choir chords under it (Am, F, Dm, E)
const PAD_CHORDS = [[110, 164.8], [87.3, 130.8], [73.4, 110], [82.4, 123.5]];

export class SpookyAudio {
  constructor() {
    this.stereoBoost = 0.8;  // 0 = realistic 3D sound only, 1 = fully into one ear
    this.head = null;
    this.dread = null;
    this.music = null;
    this.musicTension = 0;   // 0 calm .. 1 frantic: the music speeds up deeper in the house
    this.heartTimer = 0;
  }

  init() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.ratio.value = 8;
      this.master.connect(limiter).connect(this.ctx.destination);
      this.noise = this._makeNoise(2);
      this._startAmbience();
      this._startMusic();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  // ---- 3D voices -------------------------------------------------------

  // A voice is: input -> muffle (lowpass) -> HRTF panner -> stereo boost -> master.
  // HRTF alone is subtle, so on top of it we push sounds harder to the
  // left/right ear and muffle sounds that are behind the listener.
  createVoice() {
    const ctx = this.ctx;
    const input = ctx.createGain();
    const muffle = this._filter('lowpass', 18000);
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 2;
    panner.maxDistance = 40;
    panner.rolloffFactor = 1;
    const boost = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    input.connect(muffle).connect(panner);
    if (boost) panner.connect(boost).connect(this.master);
    else panner.connect(this.master);
    // sounds connect to the input node; the rest of the chain rides along on it
    input.chain = { muffle, panner, boost };
    return input;
  }

  releaseVoice(voice, delay = 2500) {
    // let sound tails finish before cutting the chain off
    setTimeout(() => {
      const { muffle, panner, boost } = voice.chain;
      voice.disconnect();
      muffle.disconnect();
      panner.disconnect();
      boost?.disconnect();
    }, delay);
  }

  setVoicePosition(voice, v) {
    const { muffle, panner, boost } = voice.chain;
    if (panner.positionX) {
      panner.positionX.value = v.x;
      panner.positionY.value = v.y;
      panner.positionZ.value = v.z;
    } else {
      panner.setPosition(v.x, v.y, v.z);
    }

    // direction relative to the head, on the floor plane
    const h = this.head;
    if (!h) return;
    const dx = v.x - h.x, dz = v.z - h.z;
    const len = Math.hypot(dx, dz) || 1;
    const side = (dx * h.rx + dz * h.rz) / len;   // -1 left .. 1 right
    const front = (dx * h.fx + dz * h.fz) / len;  // 1 ahead .. -1 behind
    const t = this.ctx.currentTime;
    if (boost) boost.pan.setTargetAtTime(side * this.stereoBoost, t, 0.03);
    // ahead: crisp, behind: muffled (down to 900 Hz straight behind)
    const freq = front >= 0 ? 18000 : 18000 * Math.pow(900 / 18000, -front);
    muffle.frequency.setTargetAtTime(freq, t, 0.05);
  }

  updateListener(matrixWorld) {
    if (!this.ctx) return;
    const e = matrixWorld.elements;
    const L = this.ctx.listener;
    const fwd = [-e[8], -e[9], -e[10]];
    const up = [e[4], e[5], e[6]];
    const flat = Math.hypot(fwd[0], fwd[2]);
    if (flat > 0.1) {
      const fx = fwd[0] / flat, fz = fwd[2] / flat;
      this.head = { x: e[12], z: e[14], fx, fz, rx: -fz, rz: fx };
    }
    if (L.positionX) {
      L.positionX.value = e[12]; L.positionY.value = e[13]; L.positionZ.value = e[14];
      L.forwardX.value = fwd[0]; L.forwardY.value = fwd[1]; L.forwardZ.value = fwd[2];
      L.upX.value = up[0]; L.upY.value = up[1]; L.upZ.value = up[2];
    } else {
      L.setPosition(e[12], e[13], e[14]);
      L.setOrientation(...fwd, ...up);
    }
  }

  // a one-off 3D sound somewhere in the room (ambient horror sounds)
  at(position, play) {
    const voice = this.createVoice();
    this.setVoicePosition(voice, position);
    play(voice);
    this.releaseVoice(voice, 4000);
  }

  // ---- ghost sounds (positional) ---------------------------------------

  footstep(voice, pitch = 1) {
    const ctx = this.ctx, t = ctx.currentTime;

    // scuff: broadband noise, the high frequencies are what make direction audible
    const scuff = this._noiseSource(t, 0.25);
    const hp = this._filter('highpass', 180);
    const lp = this._filter('lowpass', 3200 * pitch);
    const sg = this._envelope(t, 0.006, 0.2, 1.3);
    scuff.connect(hp).connect(lp).connect(sg).connect(voice);

    // thud: the low body of the step on wooden boards
    this._thud(voice, t, 180 * pitch, 1.6, 0.16);

    // old floorboards creak now and then
    if (Math.random() < 0.25) this._creak(voice, t + 0.03, 0.35, 0.12);
  }

  // a shadow person: a barely-there step, soft and muffled
  softStep(voice, pitch = 1) {
    const t = this.ctx.currentTime;
    const scuff = this._noiseSource(t, 0.2);
    const lp = this._filter('lowpass', 1400 * pitch);
    const g = this._envelope(t, 0.01, 0.16, 0.55);
    scuff.connect(lp).connect(g).connect(voice);
    this._thud(voice, t, 140 * pitch, 0.6, 0.12);
  }

  // a bat swarm: wings beating (short bursts of air)
  flutter(voice) {
    const t = this.ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const t0 = t + i * 0.05;
      const n = this._noiseSource(t0, 0.05);
      const bp = this._filter('bandpass', 700 + Math.random() * 600, 1.2);
      const g = this._envelope(t0, 0.004, 0.04, 0.5 + Math.random() * 0.3);
      n.connect(bp).connect(g).connect(voice);
    }
  }

  // a bat squeaks: very high and short, like a tiny voice
  screech(voice) {
    const t = this.ctx.currentTime;
    for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
      const f = 1500 + Math.random() * 500;
      this._vocal(voice, t + i * 0.09, 0.07, f, f * 1.15, 'i', 0.25, { attack: 0.005 });
    }
  }

  // a skeleton: dry bones clattering (short hollow wooden clicks)
  boneRattle(voice) {
    const t = this.ctx.currentTime;
    const clicks = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < clicks; i++) {
      const t0 = t + i * (0.03 + Math.random() * 0.04);
      const n = this._noiseSource(t0, 0.03);
      const bp = this._filter('bandpass', 1800 + Math.random() * 1600, 9);
      const g = this._envelope(t0, 0.001, 0.025, 1.3 + Math.random());
      n.connect(bp).connect(g).connect(voice);
    }
  }

  // a zombie climbing out of its grave: earth crumbling, then a groan
  graveRise(voice) {
    const t = this.ctx.currentTime;
    for (let i = 0; i < 10; i++) {
      const t0 = t + i * 0.18 + Math.random() * 0.1;
      const n = this._noiseSource(t0, 0.12);
      const lp = this._filter('lowpass', 500 + Math.random() * 500);
      const g = this._envelope(t0, 0.005, 0.1, 0.9);
      n.connect(lp).connect(g).connect(voice);
    }
    this.zombieGroan(voice, 0.9, t + 0.9);
  }

  // a zombie's groan: low, wet and rough
  zombieGroan(voice, pitch = 1, at = this.ctx.currentTime) {
    const dur = 1.3 + Math.random() * 0.6;
    this._vocal(voice, at, dur, 115 * pitch, 85 * pitch, 'o', 0.6, { vibrato: 17, depth: 9, attack: 0.25 });
    const n = this._noiseSource(at, dur);
    const bp = this._filter('bandpass', 400, 2);
    const g = this._envelope(at, 0.2, dur, 0.3);
    n.connect(bp).connect(g).connect(voice);
  }

  // a zombie's step: a heavy foot and the other one dragging over the ground
  dragStep(voice, pitch = 1) {
    const t = this.ctx.currentTime;
    this._thud(voice, t, 150 * pitch, 1.4, 0.15);
    const n = this._noiseSource(t + 0.1, 0.4);
    const bp = this._filter('bandpass', 900, 1.2);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t + 0.1);
    g.gain.linearRampToValueAtTime(0.45, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.48);
    n.connect(bp).connect(g).connect(voice);
  }

  // a werewolf: a long howl rising and falling
  howl(voice) {
    const t = this.ctx.currentTime;
    this._vocal(voice, t, 2.6, 320, 260, 'u', 0.6, { vibrato: 5, depth: 10, attack: 0.5, peakAt: 0.9, peakFreq: 560 });
  }

  // a werewolf's paws: quick heavy thuds with claws on the floor
  pawStep(voice) {
    const t = this.ctx.currentTime;
    this._thud(voice, t, 150, 1.8, 0.14);
    const n = this._noiseSource(t + 0.02, 0.05);
    const hp = this._filter('highpass', 3000);
    const g = this._envelope(t + 0.02, 0.002, 0.04, 0.5);
    n.connect(hp).connect(g).connect(voice);
  }

  // a werewolf panting
  pant(voice) {
    const t = this.ctx.currentTime;
    for (const dt of [0, 0.22]) {
      const n = this._noiseSource(t + dt, 0.18);
      const bp = this._filter('bandpass', 700, 1.2);
      const g = this._envelope(t + dt, 0.03, 0.17, 0.7);
      n.connect(bp).connect(g).connect(voice);
    }
  }

  // a werewolf is hit: a sharp yelp and a snarl
  yelp(voice) {
    const t = this.ctx.currentTime;
    this._vocal(voice, t, 0.35, 900, 600, 'i', 0.6, { attack: 0.01 });
    this.growl(voice, 1.4);
  }

  // a wraith: rattling chains
  chains(voice) {
    const t = this.ctx.currentTime;
    for (let i = 0; i < 9; i++) {
      const t0 = t + i * 0.05 + Math.random() * 0.03;
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 2400 + Math.random() * 1800;
      const g = this._envelope(t0, 0.001, 0.08, 0.12);
      o.connect(g).connect(voice);
      o.start(t0);
      o.stop(t0 + 0.1);
      const n = this._noiseSource(t0, 0.03);
      const hp = this._filter('highpass', 4000);
      const ng = this._envelope(t0, 0.001, 0.025, 0.5);
      n.connect(hp).connect(ng).connect(voice);
    }
  }

  // the demon: heavy stomp that shakes the floor
  stomp(voice, pitch = 1) {
    const ctx = this.ctx, t = ctx.currentTime;
    const scuff = this._noiseSource(t, 0.3);
    const lp = this._filter('lowpass', 1600 * pitch);
    const sg = this._envelope(t, 0.004, 0.25, 1.6);
    scuff.connect(lp).connect(sg).connect(voice);
    this._thud(voice, t, 110 * pitch, 2.6, 0.32);
    if (Math.random() < 0.4) this._creak(voice, t + 0.05, 0.5, 0.18);
  }

  // the demon: a deep, rough growl
  growl(voice, pitch = 1) {
    const ctx = this.ctx, t = ctx.currentTime;
    const dur = 1.1 + Math.random() * 0.5;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(62 * pitch, t);
    o.frequency.linearRampToValueAtTime(48 * pitch, t + dur);
    // fast irregular wobble makes it rough, like a throat
    const rough = ctx.createOscillator();
    rough.type = 'triangle';
    rough.frequency.value = 23;
    const roughGain = ctx.createGain();
    roughGain.gain.value = 14;
    rough.connect(roughGain).connect(o.frequency);
    const lp = this._filter('lowpass', 520, 2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1.0, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(lp).connect(g).connect(voice);
    const n = this._noiseSource(t, dur);
    const bp = this._filter('bandpass', 380, 1.5);
    const ng = this._envelope(t, 0.2, dur, 0.5);
    n.connect(bp).connect(ng).connect(voice);
    o.start(t); rough.start(t);
    o.stop(t + dur + 0.05); rough.stop(t + dur + 0.05);
  }

  // the demon is hit: a pained roar
  roar(voice) {
    const t = this.ctx.currentTime;
    this._vocal(voice, t, 1.0, 170, 85, 'a', 1.0, { vibrato: 21, depth: 22, attack: 0.03, peakAt: 0.15, peakFreq: 210 });
    this.growl(voice, 1.3);
  }

  // an evil witch cackling "heh-heh-heh-heeee"
  cackle(voice) {
    const t = this.ctx.currentTime;
    const n = 7 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const f = 720 - i * 28 + Math.random() * 30;
      this._vocal(voice, t + i * 0.13, 0.1, f * 1.08, f, i % 2 ? 'a' : 'i', 0.5, { attack: 0.01 });
    }
    const end = t + n * 0.13;
    this._vocal(voice, end, 0.9, 760, 520, 'i', 0.45, { vibrato: 8, depth: 30, attack: 0.04 });
  }

  // flyer: a cloak swooshing through the air
  whoosh(voice, pitch = 1) {
    const t = this.ctx.currentTime;
    const n = this._noiseSource(t, 0.7);
    const bp = this._filter('bandpass', 700 * pitch, 1.5);
    bp.frequency.exponentialRampToValueAtTime(3000 * pitch, t + 0.25);
    bp.frequency.exponentialRampToValueAtTime(900 * pitch, t + 0.6);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1.1, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
    n.connect(bp).connect(g).connect(voice);
  }

  // flyer: a long ghostly "ooooh"
  moan(voice, pitch = 1) {
    const t = this.ctx.currentTime;
    this._vocal(voice, t, 1.7, 300 * pitch, 215 * pitch, 'u', 0.5, { vibrato: 5, depth: 8, attack: 0.4 });
  }

  // crawler under the floor: knock-knock from below
  knock(voice, pitch = 1) {
    const t = this.ctx.currentTime;
    for (const dt of [0, 0.18]) {
      const n = this._noiseSource(t + dt, 0.15);
      const lp = this._filter('lowpass', 450 * pitch);
      const ng = this._envelope(t + dt, 0.003, 0.12, 1.4);
      n.connect(lp).connect(ng).connect(voice);
      this._thud(voice, t + dt, 130 * pitch, 1.6, 0.15);
    }
  }

  // crawler out of the floor: claws scratching
  scratch(voice, pitch = 1) {
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const t0 = t + i * 0.07;
      const n = this._noiseSource(t0, 0.08);
      const bp = this._filter('bandpass', 3000 * pitch, 2);
      const g = this._envelope(t0, 0.005, 0.06, 0.7);
      n.connect(bp).connect(g).connect(voice);
    }
  }

  breath(voice, pitch = 1) {
    const t = this.ctx.currentTime;
    const n = this._noiseSource(t, 1.5);
    const bp = this._filter('bandpass', 800 * pitch, 0.9);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.7, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
    n.connect(bp).connect(g).connect(voice);
  }

  // a missed spell: the ghost laughs "ha-ha-ha"
  laugh(voice, pitch = 1) {
    const t = this.ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      const f = (250 - i * 18) * pitch;
      this._vocal(voice, t + i * 0.18, 0.15, f * 1.1, f, 'a', 0.6, { attack: 0.015 });
    }
  }

  // banished: a fading wail plus an airy rush
  banish(voice) {
    const t = this.ctx.currentTime;
    this._vocal(voice, t, 1.1, 480, 150, 'o', 0.55, { vibrato: 7, depth: 18, attack: 0.02 });
    const n = this._noiseSource(t, 1);
    const bp = this._filter('bandpass', 2400, 0.7);
    bp.frequency.exponentialRampToValueAtTime(500, t + 0.9);
    const g = this._envelope(t, 0.02, 0.9, 0.5);
    n.connect(bp).connect(g).connect(voice);
  }

  // ---- player sounds (not positional) ----------------------------------

  // casting: a gust of wind and a soft magical hiss, no "laser"
  cast() {
    const t = this.ctx.currentTime;
    const n = this._noiseSource(t, 0.6);
    const bp = this._filter('bandpass', 300, 0.8);
    bp.frequency.exponentialRampToValueAtTime(1600, t + 0.18);
    bp.frequency.exponentialRampToValueAtTime(500, t + 0.5);
    const g = this._envelope(t, 0.04, 0.5, 0.8);
    n.connect(bp).connect(g).connect(this.master);

    const low = this._noiseSource(t, 0.4);
    const lp = this._filter('lowpass', 260);
    const lg = this._envelope(t, 0.01, 0.35, 1.0);
    low.connect(lp).connect(lg).connect(this.master);

    const air = this._noiseSource(t, 0.5);
    const hp = this._filter('highpass', 6500);
    const ag = this._envelope(t + 0.03, 0.06, 0.45, 0.12);
    air.connect(hp).connect(ag).connect(this.master);
  }

  fizzle() {
    const t = this.ctx.currentTime;
    const n = this._noiseSource(t, 0.4);
    const hp = this._filter('highpass', 2500);
    const g = this._envelope(t, 0.01, 0.35, 0.25);
    n.connect(hp).connect(g).connect(this.master);
  }

  // caught: a scream in your face
  scream() {
    const t = this.ctx.currentTime;
    this._vocal(this.master, t, 1.0, 620, 520, 'a', 0.55, { vibrato: 9, depth: 40, attack: 0.02, peakAt: 0.25, peakFreq: 900 });
    const n = this._noiseSource(t, 0.6);
    const bp = this._filter('bandpass', 1500, 1);
    const ng = this._envelope(t, 0.005, 0.5, 0.5);
    n.connect(bp).connect(ng).connect(this.master);
  }

  // a deep church bell
  start() {
    this._bell(this.master, 196, this.ctx.currentTime, 0.35, 3.5);
  }

  // three slow, low bell tolls
  gameOver() {
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) this._bell(this.master, 131, t + i * 1.3, 0.4, 3.5);
  }

  // ---- pentagram shield ---------------------------------------------------

  // a ghostly choir "aah" with a gong underneath
  shieldUp() {
    const t = this.ctx.currentTime;
    for (const f of [196, 247, 294, 392]) {
      this._vocal(this.master, t, 2.6, f, f, 'a', 0.09, { vibrato: 4.5, depth: 2, attack: 0.6 });
    }
    this._bell(this.master, 98, t, 0.3, 4);
  }

  // protection fading: a falling sigh and a low gong
  shieldDown() {
    const t = this.ctx.currentTime;
    const n = this._noiseSource(t, 1.2);
    const bp = this._filter('bandpass', 1400, 1);
    bp.frequency.exponentialRampToValueAtTime(250, t + 1.1);
    const g = this._envelope(t, 0.1, 1.1, 0.4);
    n.connect(bp).connect(g).connect(this.master);
    this._bell(this.master, 73, t, 0.28, 3);
  }

  shieldReady() {
    this._bell(this.master, 660, this.ctx.currentTime, 0.12, 1.6);
  }

  // countdown in the last seconds: a wooden clock "tock"
  tick() {
    const t = this.ctx.currentTime;
    const n = this._noiseSource(t, 0.08);
    const bp = this._filter('bandpass', 1500, 10);
    const g = this._envelope(t, 0.002, 0.07, 2.5);
    n.connect(bp).connect(g).connect(this.master);
  }

  // a ghost bumps into the shield: crackling sparks, like a fire
  zap(voice) {
    const t = this.ctx.currentTime;
    for (let i = 0; i < 7; i++) {
      const t0 = t + Math.random() * 0.25;
      const n = this._noiseSource(t0, 0.03);
      const hp = this._filter('highpass', 1500 + Math.random() * 2500);
      const g = this._envelope(t0, 0.001, 0.02 + Math.random() * 0.03, 0.6 + Math.random() * 0.6);
      n.connect(hp).connect(g).connect(voice);
    }
    const hiss = this._noiseSource(t, 0.35);
    const bp = this._filter('bandpass', 4000, 0.8);
    const hg = this._envelope(t, 0.01, 0.3, 0.25);
    hiss.connect(bp).connect(hg).connect(voice);
  }

  // a ghost glitches: a burst of crackling radio static from where it is
  radioStatic(voice) {
    const t = this.ctx.currentTime;
    let t0 = t;
    while (t0 < t + 0.45) {
      const len = 0.02 + Math.random() * 0.07;
      const n = this._noiseSource(t0, len + 0.01);
      const bp = this._filter('bandpass', 1200 + Math.random() * 2500, 0.6);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(Math.random() < 0.25 ? 0 : 0.35 + Math.random() * 0.6, t0);
      g.gain.setValueAtTime(0, t0 + len);
      n.connect(bp).connect(g).connect(voice);
      t0 += len;
    }
  }

  // ---- the fire crystal ------------------------------------------------------

  // a crystal appears: a deep whoomph of flame
  crystalAppear(voice) {
    const t = this.ctx.currentTime;
    const n = this._noiseSource(t, 1);
    const lp = this._filter('lowpass', 300);
    lp.frequency.exponentialRampToValueAtTime(2000, t + 0.4);
    const g = this._envelope(t, 0.1, 0.9, 1);
    n.connect(lp).connect(g).connect(voice);
  }

  // the waiting crystal crackles like a campfire
  crackle(voice) {
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const t0 = t + Math.random() * 0.3;
      const n = this._noiseSource(t0, 0.02);
      const hp = this._filter('highpass', 1500 + Math.random() * 3000);
      const g = this._envelope(t0, 0.001, 0.015 + Math.random() * 0.02, 0.8 + Math.random() * 0.8);
      n.connect(hp).connect(g).connect(voice);
    }
    const roar = this._noiseSource(t, 0.4);
    const lp = this._filter('lowpass', 400);
    const rg = this._envelope(t, 0.1, 0.4, 0.25);
    roar.connect(lp).connect(rg).connect(voice);
  }

  // picking up the crystal: the wand bursts into flame
  firePickup() {
    const t = this.ctx.currentTime;
    const n = this._noiseSource(t, 1.4);
    const bp = this._filter('bandpass', 200, 0.6);
    bp.frequency.exponentialRampToValueAtTime(2500, t + 0.5);
    bp.frequency.exponentialRampToValueAtTime(600, t + 1.3);
    const g = this._envelope(t, 0.05, 1.3, 1.4);
    n.connect(bp).connect(g).connect(this.master);
    this._thud(this.master, t, 120, 2.5, 0.5);
    this._bell(this.master, 330, t + 0.2, 0.15, 2);
  }

  // casting a fireball: a short roar of flame
  fireCast() {
    const t = this.ctx.currentTime;
    const n = this._noiseSource(t, 0.5);
    const bp = this._filter('bandpass', 300, 0.7);
    bp.frequency.exponentialRampToValueAtTime(1400, t + 0.12);
    bp.frequency.exponentialRampToValueAtTime(300, t + 0.45);
    const g = this._envelope(t, 0.01, 0.45, 1.1);
    n.connect(bp).connect(g).connect(this.master);
    this._thud(this.master, t, 140, 1.2, 0.2);
  }

  // the fire runs out: a hiss, like water on embers
  fireEnd() {
    const t = this.ctx.currentTime;
    const n = this._noiseSource(t, 1.2);
    const hp = this._filter('highpass', 3000);
    hp.frequency.exponentialRampToValueAtTime(800, t + 1.1);
    const g = this._envelope(t, 0.02, 1.1, 0.5);
    n.connect(hp).connect(g).connect(this.master);
  }

  // ---- adrenaline -------------------------------------------------------------

  // level 0..1: how close the danger is. Plays a heartbeat that gets louder and
  // faster; returns true on each beat (for a controller pulse). Call every frame.
  updateHeart(dt, level) {
    if (!this.ctx || this.dread || level < 0.05) {
      this.heartTimer = Math.min(this.heartTimer, 0.3);
      return false;
    }
    this.heartTimer -= dt;
    if (this.heartTimer > 0) return false;
    this.heartTimer = 1.0 - 0.55 * level;
    this._heartbeat(0.45 + 0.8 * level);
    return true;
  }

  // the player out of breath after running
  playerPant() {
    const t = this.ctx.currentTime;
    for (const [dt, f] of [[0, 900], [0.35, 600], [0.7, 900], [1.05, 600]]) {
      const n = this._noiseSource(t + dt, 0.3);
      const bp = this._filter('bandpass', f, 1);
      const g = this._envelope(t + dt, 0.05, 0.28, 0.35);
      n.connect(bp).connect(g).connect(this.master);
    }
  }

  // entering a new part of the house: a deep bell and a drum hit
  areaStinger() {
    const t = this.ctx.currentTime;
    this._bell(this.master, 98, t, 0.35, 4);
    this._thud(this.master, t, 80, 3, 0.9);
  }

  // ---- keys, doors and escaping ---------------------------------------------

  // a key appears: a soft bell
  keyAppear(voice) {
    const t = this.ctx.currentTime;
    this._bell(voice, 880, t, 0.22, 2);
    this._bell(voice, 1318, t + 0.18, 0.14, 1.6);
  }

  // the waiting key chimes now and then, so it can be found by ear
  keyChime(voice) {
    this._bell(voice, 1760, this.ctx.currentTime, 0.08, 0.9);
  }

  // picking the key up: a little jingle
  keyPickup() {
    const t = this.ctx.currentTime;
    [1046, 1318, 1568, 2093].forEach((f, i) => this._bell(this.master, f, t + i * 0.07, 0.1, 0.8));
  }

  // a door unlocks: a heavy lock clunks, then it creaks open
  unlock(voice) {
    const t = this.ctx.currentTime;
    this._thud(voice, t, 400, 1.2, 0.12);
    const n = this._noiseSource(t + 0.05, 0.1);
    const bp = this._filter('bandpass', 2500, 4);
    const g = this._envelope(t + 0.05, 0.002, 0.08, 0.8);
    n.connect(bp).connect(g).connect(voice);
    this._creak(voice, t + 0.35, 2.4, 0.4);
  }

  // walking down the stairs during the fade
  stairsDown() {
    const t = this.ctx.currentTime;
    for (let i = 0; i < 6; i++) {
      const t0 = t + i * 0.32;
      const n = this._noiseSource(t0, 0.15);
      const lp = this._filter('lowpass', 1800);
      const g = this._envelope(t0, 0.005, 0.14, 0.7);
      n.connect(lp).connect(g).connect(this.master);
      this._thud(this.master, t0, 160, 1.1, 0.14);
      if (i % 2) this._creak(this.master, t0 + 0.02, 0.35, 0.1);
    }
  }

  // an extra life: a warm chord of bells and a short choir "aah"
  lifePickup() {
    const t = this.ctx.currentTime;
    [523, 659, 784].forEach((f, i) => this._bell(this.master, f, t + i * 0.08, 0.16, 1.6));
    for (const f of [262, 330, 392]) this._vocal(this.master, t + 0.1, 1.4, f, f, 'a', 0.07, { vibrato: 5, depth: 2, attack: 0.3 });
  }

  // the waiting Holy Bell rings softly
  bellTinkle(voice) {
    const t = this.ctx.currentTime;
    this._bell(voice, 1568, t, 0.12, 1.2);
    this._bell(voice, 2093, t + 0.12, 0.08, 1);
  }

  // ringing the Holy Bell: a huge church bell, a rush of air and a choir
  bellBlast() {
    const t = this.ctx.currentTime;
    this._bell(this.master, 110, t, 0.6, 6);
    this._bell(this.master, 220, t + 0.02, 0.35, 5);
    this._thud(this.master, t, 90, 3.5, 1.4);
    const n = this._noiseSource(t, 1.8);
    const bp = this._filter('bandpass', 300, 0.6);
    bp.frequency.exponentialRampToValueAtTime(4000, t + 0.6);
    bp.frequency.exponentialRampToValueAtTime(500, t + 1.7);
    const g = this._envelope(t, 0.05, 1.7, 1.2);
    n.connect(bp).connect(g).connect(this.master);
    for (const f of [262, 330, 392, 523]) this._vocal(this.master, t + 0.3, 3, f, f, 'a', 0.1, { vibrato: 5, depth: 2, attack: 0.4 });
  }

  // escaped! bells and a bright choir
  win() {
    const t = this.ctx.currentTime;
    [523, 659, 784, 1046].forEach((f, i) => this._bell(this.master, f, t + i * 0.25, 0.25, 3));
    for (const f of [262, 330, 392, 523]) {
      this._vocal(this.master, t + 0.9, 3.2, f, f, 'a', 0.08, { vibrato: 5, depth: 2, attack: 0.8 });
    }
  }

  // ---- potion of visibility ------------------------------------------------

  // a potion appears: a soft bell and a sparkly shimmer
  potionAppear(voice) {
    const t = this.ctx.currentTime;
    this._bell(voice, 1046, t, 0.15, 1.8);
    const n = this._noiseSource(t, 1);
    const hp = this._filter('highpass', 5000);
    const g = this._envelope(t, 0.2, 1, 0.25);
    n.connect(hp).connect(g).connect(voice);
  }

  // one bubble popping in the bottle: a quick watery "blup"
  bubble(voice) {
    const t = this.ctx.currentTime;
    const n = this._noiseSource(t, 0.08);
    const bp = this._filter('bandpass', 350 + Math.random() * 300, 18);
    bp.frequency.exponentialRampToValueAtTime(1100 + Math.random() * 600, t + 0.05);
    const g = this._envelope(t, 0.003, 0.06, 2.2);
    n.connect(bp).connect(g).connect(voice);
  }

  // drinking: two gulps and a magical rush
  drink() {
    const t = this.ctx.currentTime;
    for (const dt of [0, 0.28]) {
      const n = this._noiseSource(t + dt, 0.2);
      const bp = this._filter('bandpass', 300, 4);
      bp.frequency.exponentialRampToValueAtTime(180, t + dt + 0.15);
      const g = this._envelope(t + dt, 0.01, 0.16, 1.4);
      n.connect(bp).connect(g).connect(this.master);
    }
    const rush = this._noiseSource(t + 0.5, 1.2);
    const bp = this._filter('bandpass', 400, 1);
    bp.frequency.exponentialRampToValueAtTime(5000, t + 1.4);
    const g = this._envelope(t + 0.5, 0.4, 1.4, 0.45);
    rush.connect(bp).connect(g).connect(this.master);
    this._vocal(this.master, t + 0.6, 1.6, 523, 523, 'a', 0.07, { vibrato: 5, depth: 2, attack: 0.5 });
    this._vocal(this.master, t + 0.6, 1.6, 659, 659, 'a', 0.06, { vibrato: 5, depth: 2, attack: 0.5 });
  }

  // a potion nobody picked up vanishes in a puff
  poof(voice) {
    const t = this.ctx.currentTime;
    const n = this._noiseSource(t, 0.5);
    const bp = this._filter('bandpass', 1800, 0.8);
    bp.frequency.exponentialRampToValueAtTime(300, t + 0.4);
    const g = this._envelope(t, 0.01, 0.45, 0.8);
    n.connect(bp).connect(g).connect(voice);
  }

  // the sight fades: a falling breath
  visionEnd() {
    const t = this.ctx.currentTime;
    const n = this._noiseSource(t, 0.9);
    const bp = this._filter('bandpass', 2500, 1);
    bp.frequency.exponentialRampToValueAtTime(300, t + 0.8);
    const g = this._envelope(t, 0.05, 0.85, 0.35);
    n.connect(bp).connect(g).connect(this.master);
  }

  // ---- horror atmosphere (positional, see scares.js) ----------------------

  // a creepy child-like giggle
  giggle(voice) {
    const t = this.ctx.currentTime;
    for (let i = 0; i < 5; i++) {
      const f = 470 + Math.random() * 90 + (i % 2) * 40;
      this._vocal(voice, t + i * 0.11, 0.09, f, f * 0.92, 'i', 0.35, { attack: 0.01 });
    }
  }

  // unintelligible whispering
  whisper(voice) {
    const t = this.ctx.currentTime;
    let t0 = t;
    for (let i = 0; i < 7; i++) {
      const len = 0.08 + Math.random() * 0.14;
      const vowel = Object.values(VOWELS)[Math.floor(Math.random() * 4)];
      const n = this._noiseSource(t0, len + 0.05);
      const g = this._envelope(t0, 0.02, len, 0.9);
      for (const [f, level] of vowel) {
        const bp = this._filter('bandpass', f * (0.9 + Math.random() * 0.2), 6);
        const lg = this.ctx.createGain();
        lg.gain.value = level;
        n.connect(bp).connect(lg).connect(g);
      }
      g.connect(voice);
      t0 += len + 0.03 + Math.random() * 0.08;
    }
  }

  // the lights go out: a gust of wind blowing out the candle
  candleOut() {
    const t = this.ctx.currentTime;
    const n = this._noiseSource(t, 1.2);
    const bp = this._filter('bandpass', 500, 0.8);
    bp.frequency.exponentialRampToValueAtTime(1800, t + 0.3);
    bp.frequency.exponentialRampToValueAtTime(200, t + 1.1);
    const g = this._envelope(t, 0.15, 1.1, 0.9);
    n.connect(bp).connect(g).connect(this.master);
  }

  // the door opening slowly by itself
  doorCreak(voice) {
    this._creak(voice, this.ctx.currentTime, 3, 0.45);
  }

  // ...and slamming shut: a heavy bang, a wooden crack and a rattle
  slam(voice) {
    const t = this.ctx.currentTime;
    this._thud(voice, t, 140, 4, 0.5);
    const n = this._noiseSource(t, 0.25);
    const bp = this._filter('bandpass', 900, 1);
    const g = this._envelope(t, 0.002, 0.22, 1.6);
    n.connect(bp).connect(g).connect(voice);
    for (const dt of [0.12, 0.2, 0.26]) {
      const r = this._noiseSource(t + dt, 0.05);
      const rbp = this._filter('bandpass', 2200, 3);
      const rg = this._envelope(t + dt, 0.002, 0.04, 0.5);
      r.connect(rbp).connect(rg).connect(voice);
    }
  }

  // a slow door creak
  creak(voice) {
    this._creak(voice, this.ctx.currentTime, 1.4, 0.35);
  }

  // knocking inside the wall
  wallKnock(voice) {
    const t = this.ctx.currentTime;
    for (const dt of [0, 0.3, 0.6]) {
      const n = this._noiseSource(t + dt, 0.12);
      const bp = this._filter('bandpass', 700, 1.5);
      const g = this._envelope(t + dt, 0.002, 0.1, 1.2);
      n.connect(bp).connect(g).connect(voice);
    }
  }

  // a scream far away, muffled by walls
  distantScream(voice) {
    const t = this.ctx.currentTime;
    const lp = this._filter('lowpass', 1300);
    lp.connect(voice);
    this._vocal(lp, t, 1.4, 700, 560, 'a', 0.22, { vibrato: 6, depth: 25, attack: 0.08, peakAt: 0.3, peakFreq: 950 });
  }

  // ---- dread music for the red demon ---------------------------------------

  // a "DUN!" hit when the demon appears
  stinger() {
    const t = this.ctx.currentTime;
    for (const f of [87, 92, 130]) this._vocal(this.master, t, 2.4, f, f * 0.97, 'a', 0.22, { vibrato: 5, depth: 1.5, attack: 0.02 });
    this._thud(this.master, t, 90, 3, 1.2);
    this._thud(this.master, t + 0.02, 160, 1.5, 0.6);
  }

  // level 0..1: how close the demon is. Low horror strings swell and a
  // heartbeat speeds up as it gets closer. Call every frame while it hunts.
  updateDread(dt, level) {
    if (!this.dread) this._startDread();
    const d = this.dread;
    const t = this.ctx.currentTime;
    d.out.gain.setTargetAtTime(0.2 + 0.35 * level, t, 0.3);
    d.filter.frequency.setTargetAtTime(220 + 1300 * level, t, 0.3);
    d.high.gain.setTargetAtTime(0.5 * level * level, t, 0.3);
    d.howl.frequency.setTargetAtTime(500 + 900 * level, t, 0.5);
    d.beatTimer -= dt;
    if (d.beatTimer <= 0) {
      d.beatTimer = 1.05 - 0.6 * level;
      this._heartbeat(0.6 + 0.6 * level);
    }
  }

  stopDread() {
    const d = this.dread;
    if (!d) return;
    this.dread = null;
    const t = this.ctx.currentTime;
    d.out.gain.cancelScheduledValues(t);
    d.out.gain.setTargetAtTime(0, t, 0.4);
    for (const o of d.oscillators) o.stop(t + 2);
    setTimeout(() => d.out.disconnect(), 2200);
  }

  _startDread() {
    const ctx = this.ctx, t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.master);
    // a deep choir humming "ooo" a semitone apart: buzzing sources shaped by vowel resonances
    const filter = this._filter('lowpass', 300, 0.8);
    filter.connect(out);
    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 4.5;
    const vibratoGain = ctx.createGain();
    vibratoGain.gain.value = 0.6;
    vibrato.connect(vibratoGain);
    const oscillators = [vibrato];
    const choir = ctx.createGain();
    choir.gain.value = 0.9;
    for (const [f, level] of VOWELS.o) {
      const bp = this._filter('bandpass', f * 0.8, 4);
      const g = ctx.createGain();
      g.gain.value = level;
      choir.connect(bp).connect(g).connect(filter);
    }
    for (const f of [55, 58.3, 82.4, 110.5]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      vibratoGain.connect(o.frequency);
      o.connect(choir);
      oscillators.push(o);
    }
    // howling wind that rises as the demon closes in
    const high = ctx.createGain();
    high.gain.value = 0;
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    const howl = this._filter('bandpass', 600, 6);
    const swell = ctx.createOscillator();
    swell.frequency.value = 0.3;
    const swellGain = ctx.createGain();
    swellGain.gain.value = 250;
    swell.connect(swellGain).connect(howl.frequency);
    wind.connect(howl).connect(high).connect(out);
    oscillators.push(wind, swell);
    for (const o of oscillators) o.start(t);
    this.dread = { out, filter, high, howl, oscillators, beatTimer: 0 };
  }

  // a muffled heartbeat: "lub-dub"
  _heartbeat(strength) {
    const t = this.ctx.currentTime;
    this._thud(this.master, t, 75, 1.4 * strength, 0.2);
    this._thud(this.master, t + 0.2, 85, 1.0 * strength, 0.18);
  }

  // ---- background music: an out-of-tune music-box lullaby over a low choir ----

  _startMusic() {
    const t = this.ctx.currentTime;
    const out = this.ctx.createGain();
    out.gain.value = 0;
    out.connect(this.master);
    this.music = { out, next: t + 1.5, index: 0, padNext: t + 0.5, pad: 0 };
  }

  // call every frame; quiet: lower the music (e.g. while the demon's music plays)
  updateMusic(quiet = false) {
    const m = this.music;
    if (!m) return;
    const t = this.ctx.currentTime;
    m.out.gain.setTargetAtTime(quiet ? 0.04 : 0.32, t, 1.2);
    // schedule a little ahead so notes land on time
    while (m.next < t + 0.4) {
      const [note, beats] = LULLABY[m.index % LULLABY.length];
      if (note) {
        const detune = 1 + (Math.random() - 0.5) * 0.012;  // a worn, slightly out-of-tune music box
        this._musicBox(m.out, 440 * Math.pow(2, (note - 69) / 12) * detune, m.next);
      }
      // the tune drags a little, as if the box is winding down
      m.next += beats * 0.42 * (1 - 0.35 * this.musicTension) * (0.96 + Math.random() * 0.12);
      m.index++;
      // deeper in the house a slow drum joins in, like a heart under the floor
      if (this.musicTension > 0.3 && m.index % 4 === 0) this._thud(m.out, m.next, 90, 2.2 * this.musicTension, 0.3);
    }
    while (m.padNext < t + 0.5) {
      const chord = PAD_CHORDS[m.pad % PAD_CHORDS.length];
      for (const f of chord) this._vocal(m.out, m.padNext, 9.5, f, f, 'o', 0.16, { vibrato: 4, depth: 0.8, attack: 2.5 });
      m.padNext += 8;
      m.pad++;
    }
  }

  _musicBox(dest, freq, t) {
    for (const [ratio, level, decay] of [[1, 0.5, 1.6], [3, 0.12, 0.5], [5.04, 0.05, 0.25]]) {
      const o = this.ctx.createOscillator();
      o.frequency.value = freq * ratio;
      const g = this._envelope(t, 0.003, decay, level);
      o.connect(g).connect(dest);
      o.start(t);
      o.stop(t + decay + 0.05);
    }
  }

  // ---- helpers ----------------------------------------------------------

  // a voice-like sound: a buzzing source shaped by vowel resonances, gliding
  // from f0 to f1 over dur seconds
  _vocal(dest, t, dur, f0, f1, vowel, peak, { vibrato = 0, depth = 0, attack = 0.05, peakAt = 0, peakFreq = 0 } = {}) {
    const ctx = this.ctx;
    const src = ctx.createOscillator();
    src.type = 'sawtooth';
    src.frequency.setValueAtTime(f0, t);
    if (peakAt) src.frequency.linearRampToValueAtTime(peakFreq, t + peakAt);
    src.frequency.linearRampToValueAtTime(f1, t + dur);
    let lfo = null;
    if (vibrato) {
      lfo = ctx.createOscillator();
      lfo.frequency.value = vibrato;
      const lg = ctx.createGain();
      lg.gain.value = depth;
      lfo.connect(lg).connect(src.frequency);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + Math.max(attack, dur * 0.6));
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    for (const [f, level] of VOWELS[vowel]) {
      const bp = this._filter('bandpass', f, 5);
      const lg = ctx.createGain();
      lg.gain.value = level;
      src.connect(bp).connect(lg).connect(g);
    }
    // a little breath noise makes it less buzzy
    const n = this._noiseSource(t, dur);
    const nbp = this._filter('bandpass', VOWELS[vowel][1][0], 1);
    const ng = ctx.createGain();
    ng.gain.value = 0.25;
    n.connect(nbp).connect(ng).connect(g);
    g.connect(dest);
    src.start(t);
    src.stop(t + dur + 0.05);
    if (lfo) { lfo.start(t); lfo.stop(t + dur + 0.05); }
  }

  // a muffled thud (step, knock, heartbeat, boom): low filtered noise, no pitched "kick"
  _thud(dest, t, freq, peak, decay) {
    const n = this._noiseSource(t, decay + 0.05);
    const lp = this._filter('lowpass', freq, 1.2);
    const lp2 = this._filter('lowpass', freq * 1.5);
    const g = this._envelope(t, 0.004, decay, peak);
    n.connect(lp).connect(lp2).connect(g).connect(dest);
  }

  // a struck bell: a few out-of-tune partials that ring out
  _bell(dest, freq, t, peak, decay) {
    [[1, 1], [2, 0.5], [2.76, 0.4], [4.07, 0.22], [5.4, 0.12]].forEach(([ratio, level], i) => {
      const o = this.ctx.createOscillator();
      o.frequency.value = freq * ratio;
      const g = this._envelope(t, 0.005, decay / (1 + i * 0.6), peak * level);
      o.connect(g).connect(dest);
      o.start(t);
      o.stop(t + decay + 0.1);
    });
  }

  // wood creaking under weight: a slow, jittery rasp through a resonant filter
  _creak(dest, t, dur, peak) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(40 + Math.random() * 20, t);
    o.frequency.linearRampToValueAtTime(70 + Math.random() * 40, t + dur);
    const jitter = ctx.createOscillator();
    jitter.frequency.value = 9 + Math.random() * 6;
    const jg = ctx.createGain();
    jg.gain.value = 18;
    jitter.connect(jg).connect(o.frequency);
    const bp = this._filter('bandpass', 900 + Math.random() * 500, 4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(bp).connect(g).connect(dest);
    o.start(t); jitter.start(t);
    o.stop(t + dur + 0.05); jitter.stop(t + dur + 0.05);
  }

  // night wind, rising and falling
  _startAmbience() {
    const ctx = this.ctx;
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    const lp = this._filter('lowpass', 260, 2);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 140;
    lfo.connect(lfoGain).connect(lp.frequency);
    const g = ctx.createGain();
    g.gain.value = 0.03;
    wind.connect(lp).connect(g).connect(this.master);
    wind.start();
    lfo.start();
  }

  _makeNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  _noiseSource(t, duration) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.start(t, Math.random() * Math.max(0, this.noise.duration - duration), duration);
    return s;
  }

  _filter(type, freq, q = 0.7) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  // gain node with a quick attack and exponential decay
  _envelope(t, attack, decay, peak) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    return g;
  }
}
