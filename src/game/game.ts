/**
 * Game orchestrator: owns the renderer and all systems, runs the fixed-step
 * simulation, and drives modes (Jam, Score Attack, Challenges, Free Ride,
 * Daily Huck), results, replays and persistence.
 */
import * as THREE from 'three';
import { COURSE, groundY, profileY } from '../physics/course';
import { RunSim, sampleFrames, PHASE_FROM_CODE, type Frame } from './run';
import { RiderModel, defaultPose } from '../render/riderModel';
import { buildVenue, type Venue } from '../render/environment';
import { CameraRig, REPLAY_ANGLES, type CamMode } from '../render/camera';
import { Particles } from '../render/effects';
import { Input, type InputState } from '../input/input';
import { AudioEngine, LINES, pick } from '../audio/audio';
import { Hud } from '../ui/hud';
import { Screens, fmt, ordinal } from '../ui/screens';
import { commitToMemory, newSessionMemory, scoreRun, sickTier, type RunScore, type SessionMemory } from '../scoring/scoring';
import { BOARDS, effectiveStats, levelForXp, type Loadout } from '../data/gear';
import { CHALLENGES, RIVALS, SCORE_ATTACK, challengeById } from '../data/challenges';
import { loadSave, newlyUnlocked, writeSave, defaultSave, type SaveData } from '../state/save';
import { GRAB_NAME, type GrabId } from '../tricks/tricks';
import { rng } from '../render/textures';
import type { Conditions } from '../physics/rider';

type Mode = 'jam' | 'attack' | 'challenge' | 'free' | 'daily';
type State = 'menu' | 'garage' | 'run' | 'results' | 'replay' | 'summary' | 'paused' | 'tutorial';

interface Session {
  mode: Mode;
  attempts: number;
  attempt: number;
  results: (RunScore | null)[];
  totals: number[];
  mem: SessionMemory;
  level?: number;
  challengeId?: string;
  cond: Conditions;
  boardOverride?: string;
  bonusGrab?: GrabId;
  rivals?: { name: string; score: number }[];
  startedLevel: number;
}

const SIM_DT = 1 / 120;
const DEMO_SCRIPTS: ((t: number, z: number, air: number, phase: string) => Partial<InputState>)[] = [
  // Frontside 720 Melon
  (_t, z, air, ph) => ph === 'air' ? { x: air < 0.95 ? -1 : 0, grab: air > 0.35 && air < 1.9 ? 'melon' : null, tweak: air > 0.9 && air < 1.6 ? 1 : 0 } : { y: z < 60 ? 0.5 : 0, pop: z > 80 && z < 86.6 },
  // Backside Cork 540 Indy
  (_t, z, air, ph) => ph === 'air' ? { x: air < 0.75 ? 1 : 0, y: air < 0.55 ? -1 : 0, grab: air > 0.3 && air < 1.7 ? 'indy' : null } : { y: z < 60 ? 0.3 : 0, pop: z > 80 && z < 86.4 },
  // Late Backside 360 Method
  (_t, z, air, ph) => ph === 'air' ? { x: air > 1.4 && air < 2.1 ? 1 : 0, grab: air > 0.2 && air < 1.5 ? 'method' : null, tweak: air > 0.5 && air < 1.4 ? 1 : 0 } : { y: z < 60 ? 0.4 : 0, pop: z > 80 && z < 86.8 },
];

export class Game {
  renderer!: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  rig = new CameraRig();
  venue!: Venue;
  rider!: RiderModel;
  particles!: Particles;
  input: Input;
  audio = new AudioEngine();
  hud: Hud;
  screens: Screens;
  save: SaveData;
  state: State = 'menu';
  session: Session | null = null;
  run: RunSim | null = null;
  sick = 0;
  private acc = 0;
  private timeScale = 1;
  private slowTimer = 0;
  private last = performance.now();
  private t = 0;
  private demo: { frames: Frame[]; t: number; idx: number; cam: number } = { frames: [], t: 0, idx: 0, cam: 0 };
  private pendingScore: RunScore | null = null;
  private replay = { t: 0, end: 0, slow: true, angle: 0, ui: null as null | { setLabel(l: string): void } };
  private lastResults: (() => void) | null = null;
  private frameTimes: number[] = [];
  private pixelRatio = 1;
  private touch = false;
  private hopFx = 0;
  private lastSpinWhoosh = 0;
  private dropAnnounced = false;
  private totalFill: HTMLElement | null = null;
  private garageReturn: State = 'menu';
  private fallbackPos = new THREE.Vector3();
  /** ?bot=N drives runs with a scripted rider (used for automated visual testing). */
  private bot: number | null = (() => { const v = new URLSearchParams(location.search).get('bot'); return v === null ? null : Number(v) % DEMO_SCRIPTS.length; })();

  constructor() {
    this.save = loadSave();
    this.input = new Input(document.getElementById('touch')!);
    this.hud = new Hud(document.getElementById('hud')!);
    this.screens = new Screens(document.getElementById('ui')!, this.makeHost());
    this.touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    document.body.classList.toggle('no-touch', !this.touch);
    this.hud.setTouch(this.touch);
    this.audio.onCaption = t => this.hud.say(t);
    this.input.onAnyInput = () => this.audio.unlock();
  }

  async init(progress: (p: number, msg: string) => void) {
    const canvas = document.getElementById('gl') as HTMLCanvasElement;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    } catch {
      throw new Error('WebGL unavailable');
    }
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.save.settings.quality === 'low' ? 1 : 2);
    progress(0.3, 'Sculpting the knuckle…');
    await nextFrame();
    this.venue = buildVenue(this.scene);
    progress(0.6, 'Waxing boards…');
    await nextFrame();
    this.rider = new RiderModel(this.save.loadout);
    this.scene.add(this.rider.root);
    this.particles = new Particles(this.scene);
    this.particles.scale = this.save.settings.quality === 'low' ? 0.5 : 1;
    progress(0.8, 'Warming up the crowd…');
    await nextFrame();
    this.buildDemo();
    this.computeSpeedBand();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.audio.suspend(); if (this.state === 'run') this.pause(); }
      else this.audio.resume();
    });
    // unlock audio on any gesture anywhere (iOS)
    const unlock = () => { this.audio.unlock(); this.audio.applySettingsFrom(this.save.settings); this.audio.playMusic(this.state === 'run' ? 'run' : 'menu'); };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchend', unlock, { passive: true });
    this.applySettings();
    // warm up shaders
    this.rig.update(0.016, this.rider.root.position, new THREE.Vector3());
    r.compile(this.scene, this.rig.cam);
    progress(1, 'Drop in!');
    this.toMenu();
    requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------------ host for screens
  private makeHost() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const g = this;
    return {
      get save() { return g.save; },
      tap: (k: 'tap' | 'back' = 'tap') => { g.audio.unlock(); g.audio.ui(k); },
      startMode: (m: Mode, arg?: number | string) => g.startSession(m, arg),
      openGarage: () => g.openGarage(),
      closeGarage: () => g.closeGarage(),
      previewLoadout: (l: Loadout) => g.rider.applyLoadout(l),
      commitLoadout: (l: Loadout) => { g.save.loadout = { ...l }; g.persist(); },
      applySettings: () => g.applySettings(),
      resetProgress: () => { const s = defaultSave(); s.tutorialDone = true; g.save = s; g.persist(); g.rider.applyLoadout(s.loadout); },
      menu: () => g.toMenu(),
      dailyInfo: () => g.dailyInfo(),
    };
  }

  private persist() { writeSave(this.save); }

  applySettings() {
    const s = this.save.settings;
    this.audio.applySettingsFrom(s);
    this.input.leftHanded = s.leftHanded;
    (document.getElementById('touch')!).dataset.lefty = s.leftHanded ? '1' : '0';
    if (this.renderer) {
      const maxPR = s.quality === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, 2);
      this.pixelRatio = Math.min(this.pixelRatio, maxPR);
      if (s.quality === 'high') this.pixelRatio = maxPR;
      if (s.quality === 'low') this.pixelRatio = 1;
      this.renderer.shadowMap.enabled = s.quality !== 'low';
      this.particles.scale = s.quality === 'low' ? 0.5 : 1;
      this.resize();
    }
    this.persist();
  }

  private resize() {
    if (!this.renderer) return;
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.rig.resize(w, h);
  }

  // ------------------------------------------------------------------ helpers
  private stats(boardOverride?: string) {
    const l = { ...this.save.loadout };
    if (boardOverride) l.board = boardOverride;
    return effectiveStats(l);
  }

  dailyInfo() {
    const d = new Date();
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let h = 0; for (const c of date) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const R = rng(h);
    const grabs: GrabId[] = ['indy', 'mute', 'melon', 'method', 'stalefish', 'nose', 'tail'];
    const bonusGrab = grabs[Math.floor(R() * grabs.length)];
    const wind = Math.round((R() - 0.5) * 2.4 * 10) / 10;
    const snowSpeed = Math.round((0.85 + R() * 0.3) * 100) / 100;
    const board = ['stock', 'twig', 'gun', 'grid', 'split'][Math.floor(R() * 5)];
    const windTxt = Math.abs(wind) < 0.3 ? 'calm' : `${Math.abs(wind) > 0.8 ? 'gusty ' : ''}${wind > 0 ? 'left' : 'right'}-to-${wind > 0 ? 'right' : 'left'} wind`;
    const snowTxt = snowSpeed < 0.95 ? 'fast snow' : snowSpeed > 1.05 ? 'sticky snow' : 'chalky snow';
    const rivals = RIVALS.slice(0, 5).map(r => ({ name: r.name, score: Math.round((7000 + R() * 16000) / 10) * 10 }));
    return {
      date, wind, snowSpeed, board, bonusGrab,
      title: `${GRAB_NAME[bonusGrab]} ×2 · ${snowTxt}`,
      desc: `Loaner board: ${BOARDS.find(b => b.id === board)!.name}. ${windTxt}, ${snowTxt}. ${GRAB_NAME[bonusGrab]} grabs score double style. 3 attempts, best counts.`,
      best: this.save.daily[date] ?? 0,
      rivals,
    };
  }

  /** Ideal approach speed band shown on the speedo, found by simulating perfect pops. */
  private computeSpeedBand() {
    const stats = this.stats();
    const okSpeeds: number[] = [];
    for (let tuck = -1; tuck <= 1.001; tuck += 0.25) {
      const sim = new RunSim(stats.board, stats.response, { wind: 0, snowSpeed: 1 });
      sim.drop();
      let deckSpeed = 0;
      const inp = blankInput();
      for (let i = 0; i < 120 * 20 && sim.phase !== 'done'; i++) {
        const z = sim.phys.pos.z;
        inp.y = z < COURSE.deckStartZ - 6 ? tuck : 0;
        inp.pop = z > COURSE.knuckleZ - 6 && z < COURSE.knuckleZ;
        if (!deckSpeed && z > COURSE.deckStartZ - 6) deckSpeed = sim.phys.speed;
        sim.step(SIM_DT, inp);
        if ((sim.phase as string) !== 'ride' && (sim.phase as string) !== 'air' && (sim.phase as string) !== 'ready') break;
      }
      const res = sim.result;
      if (res.landing && (res.landing.grade === 'clean' || res.landing.grade === 'stomped') && res.landing.zone === 'sweet') okSpeeds.push(deckSpeed * 3.6);
    }
    if (okSpeeds.length) this.hud.setBand(Math.min(...okSpeeds) - 2, Math.max(...okSpeeds) + 2);
  }

  private buildDemo() {
    const stats = effectiveStats(this.save.loadout);
    const idx = this.demo.idx % DEMO_SCRIPTS.length;
    const script = DEMO_SCRIPTS[idx];
    const sim = new RunSim(stats.board, stats.response, { wind: 0, snowSpeed: 1 });
    sim.drop();
    const inp = blankInput();
    for (let i = 0; i < 120 * 22 && sim.phase !== 'done'; i++) {
      const p = script(sim.t, sim.phys.pos.z, sim.tricks.airTime, sim.phase);
      inp.x = p.x ?? 0; inp.y = p.y ?? 0; inp.pop = !!p.pop; inp.grab = (p.grab as GrabId) ?? null; inp.tweak = p.tweak ?? 0;
      sim.step(SIM_DT, inp);
    }
    this.demo.frames = sim.frames;
    this.demo.t = 0;
  }

  // ------------------------------------------------------------------ state changes
  toMenu() {
    this.state = 'menu';
    this.session = null; this.run = null;
    this.input.setMode('off');
    this.hud.show(false);
    this.hud.clearTransient();
    this.rig.setMode('replay-broadcast');
    this.screens.menu();
    this.audio.playMusic('menu');
    this.audio.musicIntensity(0.3);
    this.audio.stopRide();
    this.particles.clear();
    this.demo.t = 0;
  }

  openGarage() {
    this.garageReturn = this.state === 'garage' ? this.garageReturn : this.state;
    this.state = 'garage';
    this.rider.applyLoadout(this.save.loadout);
    this.rig.setMode('garage');
    this.screens.garage(this.save.loadout);
  }
  closeGarage() {
    this.persist();
    this.buildDemo();
    this.computeSpeedBand();
    this.toMenu();
  }

  startSession(mode: Mode, arg?: number | string) {
    this.audio.unlock();
    if (!this.save.tutorialDone) {
      this.state = 'tutorial';
      this.screens.tutorial(() => this.startSession(mode, arg));
      return;
    }
    const lvl = levelForXp(this.save.xp).level;
    const s: Session = {
      mode, attempts: Infinity, attempt: 0, results: [], totals: [], mem: newSessionMemory(this.save.signatures),
      cond: { wind: 0, snowSpeed: 1 }, startedLevel: lvl,
    };
    if (mode === 'jam') {
      s.attempts = 4;
      const R = rng(Date.now() & 0xffff);
      const base = 7000 + Math.min(14, lvl) * 1500;
      s.rivals = RIVALS.map(r => ({ name: `${r.name} · ${r.country}`, score: Math.round(base * (0.55 + R() * 0.95) / 10) * 10 }));
    } else if (mode === 'attack') {
      s.level = typeof arg === 'number' ? arg : this.save.attackLevel;
      s.attempts = SCORE_ATTACK[s.level - 1].attempts;
    } else if (mode === 'challenge') {
      s.challengeId = String(arg ?? CHALLENGES[0].id);
    } else if (mode === 'daily') {
      const d = this.dailyInfo();
      s.attempts = 3; s.cond = { wind: d.wind, snowSpeed: d.snowSpeed }; s.boardOverride = d.board; s.bonusGrab = d.bonusGrab;
      s.rivals = d.rivals;
    }
    this.session = s;
    this.sick = mode === 'free' ? 20 : 10;
    this.screens.clear();
    this.startAttempt();
  }

  private startAttempt() {
    const s = this.session!;
    s.attempt++;
    const st = this.stats(s.boardOverride);
    const run = new RunSim(st.board, st.response, s.cond);
    this.run = run;
    this.state = 'run';
    this.pendingScore = null;
    this.dropAnnounced = false;
    this.screens.clear();
    this.hud.show(true);
    this.hud.inResults(false);
    this.hud.clearTransient();
    this.hud.setLegend(!this.touch);
    this.input.reset();
    this.input.setMode('ground');
    const loadoutRide = { ...this.save.loadout };
    if (s.boardOverride) loadoutRide.board = s.boardOverride;
    this.rider.applyLoadout(loadoutRide);
    this.particles.clear();
    this.rig.setMode('follow', true);
    this.timeScale = 1; this.slowTimer = 0;
    this.hud.setMode(this.modeName(), this.modeSub());
    const total = Number.isFinite(s.attempts) ? `ATTEMPT ${s.attempt} / ${s.attempts}` : `RUN ${s.attempt}`;
    let sub = 'Hold POP · release on the blue line';
    if (s.mode === 'challenge') sub = challengeById(s.challengeId!)!.desc;
    if (s.mode === 'daily') sub = this.dailyInfo().desc;
    if (s.mode === 'attack') { const L = SCORE_ATTACK[s.level! - 1]; sub = `Target ${fmt(L.target)} · ${fmt(sum(s.totals))} so far`; }
    this.hud.readyBanner(total, 'DROP IN', sub);
    this.audio.playMusic('run');
    this.audio.musicIntensity(0.4 + this.sick / 200);
    this.hud.sickMeter(this.sick);
  }

  private modeName() {
    const s = this.session!;
    return { jam: 'BIG AIR JAM', attack: `SCORE ATTACK ${s.level ?? ''}`, challenge: 'CHALLENGE', free: 'FREE RIDE', daily: 'DAILY HUCK' }[s.mode];
  }
  private modeSub() {
    const s = this.session!;
    if (s.mode === 'jam') return `Run ${s.attempt}/${s.attempts} · ${fmt(this.jamTotal(s))}`;
    if (s.mode === 'attack') { const L = SCORE_ATTACK[s.level! - 1]; return `Run ${s.attempt}/${s.attempts} · ${fmt(sum(s.totals))} / ${fmt(L.target)}`; }
    if (s.mode === 'challenge') return challengeById(s.challengeId!)!.name;
    if (s.mode === 'daily') return `Run ${s.attempt}/${s.attempts} · best ${fmt(Math.max(0, ...s.totals))}`;
    return `Run ${s.attempt} · best ${fmt(Math.max(0, ...s.totals))}`;
  }

  private jamTotal(s: Session) {
    const scored = s.results.map((r, i) => ({ r, v: s.totals[i] ?? 0 })).filter(x => x.r).sort((a, b) => b.v - a.v);
    if (!scored.length) return 0;
    const first = scored[0];
    const second = scored.find(x => x !== first && x.r!.trick.signature !== first.r!.trick.signature);
    const dupe = scored.find(x => x !== first);
    return first.v + (second ? second.v : dupe ? Math.round(dupe.v * 0.5) : 0);
  }

  pause() {
    if (this.state !== 'run') return;
    this.state = 'paused';
    this.input.setMode('off');
    this.audio.stopRide();
    this.screens.pause(
      () => { this.screens.clear(); this.state = 'run'; this.input.reset(); this.input.setMode(this.run?.airborne ? 'air' : 'ground'); this.last = performance.now(); },
      () => { this.session!.attempt--; this.startAttempt(); },
      () => this.toMenu(),
    );
  }

  // ------------------------------------------------------------------ main loop
  private frame = (now: number) => {
    requestAnimationFrame(this.frame);
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.1) dt = 0.1;
    this.t += dt;
    this.trackPerf(dt);
    const inp = this.input.update();

    if (inp.pause && (this.state === 'run')) this.pause();
    else if (inp.pause && this.state === 'paused') { this.screens.clear(); this.state = 'run'; this.input.setMode('ground'); }

    switch (this.state) {
      case 'run': this.updateRun(dt, inp); break;
      case 'menu': case 'tutorial': this.updateDemo(dt); break;
      case 'garage': this.updateGarage(dt); break;
      case 'results': case 'summary':
        this.updateIdleRider(dt);
        if (inp.confirm || inp.retry) (document.querySelector('[data-next], [data-again]') as HTMLElement | null)?.click();
        break;
      case 'replay': this.updateReplay(dt, inp); break;
      case 'paused': break;
    }
    this.particles.update(dt);
    this.venue.update(dt, this.t, this.rig.cam, this.sick / 100);
    // shadow follows the rider
    const rp = this.rider.root.position;
    this.venue.sun.position.set(rp.x - 30, rp.y + 60, rp.z - 20);
    this.venue.sun.target.position.copy(rp);
    this.renderer.render(this.scene, this.rig.cam);
    // test hook: freeze on a condition so automated screenshots can catch exact moments
    const w = window as unknown as { __freeze?: (r: RunSim) => boolean; __frozen?: boolean };
    if (w.__freeze && this.state === 'run' && this.run && w.__freeze(this.run)) { w.__freeze = undefined; w.__frozen = true; this.state = 'paused'; }
  };

  private trackPerf(dt: number) {
    if (this.save.settings.quality !== 'auto') return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    const maxPR = Math.min(window.devicePixelRatio || 1, 2);
    if (avg > 0.024 && this.pixelRatio > 1) { this.pixelRatio = Math.max(1, this.pixelRatio - 0.25); this.resize(); }
    else if (avg > 0.03 && this.pixelRatio <= 1 && this.renderer.shadowMap.enabled) { this.renderer.shadowMap.enabled = false; this.particles.scale = 0.5; }
    else if (avg < 0.0135 && this.pixelRatio < maxPR) { this.pixelRatio = Math.min(maxPR, this.pixelRatio + 0.25); this.resize(); }
  }

  private updateRun(dt: number, inp: InputState) {
    const run = this.run!;
    if (this.bot !== null) {
      const p = DEMO_SCRIPTS[this.bot](run.t, run.phys.pos.z, run.tricks.airTime, run.phase);
      inp = { ...inp, x: p.x ?? 0, y: p.y ?? 0, pop: !!p.pop, grab: (p.grab as GrabId) ?? null, tweak: p.tweak ?? 0 };
    }
    // slow-motion dip
    if (this.slowTimer > 0) { this.slowTimer -= dt; this.timeScale += (0.45 - this.timeScale) * Math.min(1, dt * 12); }
    else this.timeScale += (1 - this.timeScale) * Math.min(1, dt * 5);
    this.acc += dt * this.timeScale;
    let first = true;
    while (this.acc >= SIM_DT) {
      this.acc -= SIM_DT;
      const stepInp = first ? inp : { ...inp, switchStance: false };
      first = false;
      run.step(SIM_DT, stepInp);
      this.handleEvents();
      if (this.state !== 'run') return;
    }
    this.input.setMode(run.airborne ? 'air' : run.phase === 'ride' || run.phase === 'ready' ? 'ground' : 'off');
    this.syncRider(run.pos, run.quat, run.pose);
    this.runFx(dt, run);
    // camera
    const mode: CamMode = run.phase === 'air' ? 'air' : run.phase === 'landed' || run.phase === 'done' ? 'land' : run.phase === 'crash' ? 'crash' : 'follow';
    if (this.rig.mode !== mode) this.rig.setMode(mode);
    this.rig.update(dt, run.pos, run.vel, { landing: run.landingPoint, airTime: run.tricks.airTime, speed: run.speed });
    this.updateHud(run, inp);
    // audio
    const ph = run.phys;
    this.audio.ride(run.speed, ph.grounded && run.phase !== 'crash', Math.abs(ph.turnRate) * 0.5 + (ph.loading ? 0.3 : 0), run.speed);
    if (run.airborne && Math.abs(run.tricks.spinRate) > 300 && this.t - this.lastSpinWhoosh > 0.45) { this.lastSpinWhoosh = this.t; this.audio.spinWhoosh(Math.abs(run.tricks.spinRate)); }
    this.audio.crowd(Math.min(1, this.sick / 100 + (run.airborne ? 0.3 : 0)));
  }

  private syncRider(pos: THREE.Vector3, quat: THREE.Quaternion, pose: typeof this.rider.pose) {
    this.rider.root.position.copy(pos);
    this.rider.root.quaternion.copy(quat);
    Object.assign(this.rider.pose, pose);
    this.rider.update();
  }

  private runFx(dt: number, run: RunSim) {
    const ph = run.phys;
    if (!ph.grounded || run.phase === 'ready') return;
    if (run.phase === 'crash') return;
    const sp = ph.speed;
    const turn = Math.abs(ph.turnRate);
    const rate = (turn * sp * 3 + sp * 0.4 + (ph.loading ? 10 : 0)) * dt;
    this.hopFx += rate;
    if (this.hopFx >= 1) {
      const n = Math.floor(this.hopFx); this.hopFx -= n;
      const p = new THREE.Vector3(ph.pos.x, ph.pos.y + 0.05, ph.pos.z);
      const side = Math.sign(ph.turnRate || 1);
      const v = new THREE.Vector3(ph.vel.x * 0.3 - Math.cos(ph.heading) * side * turn * 2.4, 1.2, ph.vel.z * 0.3 + Math.sin(ph.heading) * side * turn * 2.4);
      this.particles.emit(p, v, 1.6, n, { life: 0.7, size: 0.32, grav: 4 });
    }
  }

  private handleEvents() {
    const run = this.run!;
    const ev = run.events.splice(0);
    for (const e of ev) {
      const p = new THREE.Vector3(run.phys.pos.x, run.phys.pos.y, run.phys.pos.z);
      switch (e.type) {
        case 'drop':
          this.hud.readyBanner('', '', '');
          if (!this.dropAnnounced) { this.dropAnnounced = true; this.audio.announce(pick(LINES.drop)); }
          this.audio.musicIntensity(0.5 + this.sick / 200);
          break;
        case 'load': this.audio.load(); break;
        case 'butter': this.hud.toast('BUTTER', 'pressed into the pop'); break;
        case 'switch':
          this.audio.ui('tap');
          this.hud.stamp(e.toSwitch ? 'SWITCH' : 'REGULAR', 'good');
          this.particles.emit(p, new THREE.Vector3(0, 1, 0), 3, 14, { life: 0.6 });
          break;
        case 'pop': {
          const q = e.pop.timing;
          this.audio.pop(e.pop.quality);
          const label: Record<string, [string, string]> = {
            perfect: ['PERFECT POP', 'perfect'], good: ['GOOD POP', 'good'], early: ['EARLY', 'bad'], late: ['LATE', 'bad'],
            'way-early': ['WAY EARLY', 'bad'], 'way-late': ['WAY LATE', 'bad'], none: ['OLLIE', 'good'],
          };
          const [txt, cls] = label[q];
          this.hud.stamp(txt, cls, e.pop.press === 'nose' ? 'nollie!' : e.pop.press === 'tail' ? 'tail-loaded ollie' : '');
          if (q === 'perfect') { this.slowTimer = 0.28; this.audio.announce(pick(LINES.perfectPop)); this.hud.doFlash(); }
          else if (q === 'early' || q === 'way-early') this.audio.announce(pick(LINES.early));
          else if (q === 'late' || q === 'way-late') this.audio.announce(pick(LINES.late));
          this.particles.emit(p, new THREE.Vector3(run.phys.vel.x * 0.2, 0.5, run.phys.vel.z * 0.2), 3.5, 28, { life: 0.8, size: 0.38 });
          this.haptic(18);
          break;
        }
        case 'takeoff':
          if (!e.popped && run.phys.pos.z > COURSE.deckStartZ) { this.hud.stamp('NO POP', 'bad', 'scraped the knuckle'); this.audio.announce(pick(LINES.noPop)); }
          this.input.setMode('air');
          this.audio.musicIntensity(0.75 + this.sick / 300);
          break;
        case 'grab': this.audio.grab(); this.haptic(8); break;
        case 'hop': this.particles.emit(p, new THREE.Vector3(0, 1, 0), 2, 16, { life: 0.5 }); this.audio.land(2, true); break;
        case 'land': {
          const L = e.landing;
          this.audio.land(L.impact, L.grade !== 'sketchy');
          this.rig.shake(Math.min(0.5, L.impact * 0.03));
          this.particles.emit(p, new THREE.Vector3(run.phys.vel.x * 0.35, 2, run.phys.vel.z * 0.35), 5, 45 + L.impact * 2.5, { life: 0.9, size: 0.42 });
          const score = this.scoreCurrent();
          this.pendingScore = score;
          const label = { stomped: ['STOMPED!', 'stomped'], clean: ['CLEAN!', 'perfect'], sketchy: ['SKETCHY', 'bad'], crash: ['BAIL', 'crash'] }[L.grade];
          this.hud.stamp(label[0], label[1], L.zone === 'deck' ? 'knuckled' : L.zone === 'flat' ? 'overshot' : '');
          if (score) this.hud.scorePop(`+${fmt(score.total)}`);
          const lines = L.grade === 'stomped' ? LINES.stomped : L.grade === 'clean' ? LINES.clean : L.zone === 'deck' ? LINES.knuckled : L.zone === 'flat' ? LINES.flat : LINES.sketchy;
          this.audio.announce(pick(lines), true);
          const hype = score ? Math.min(1, 0.25 + score.total / 30000 + (L.grade === 'stomped' ? 0.3 : 0)) : 0.2;
          this.venue.crowdJump(hype);
          this.audio.cheer(hype);
          if (sickTier(this.sick + (score?.sickDelta ?? 0)).tier >= 3) {
            this.hud.doFlash();
            for (const s of [-1, 1]) this.particles.emit(new THREE.Vector3(s * 26, profileY(190) + 1, 190), new THREE.Vector3(0, 14, 0), 4, 80, { life: 2.2, size: 0.6, color: s > 0 ? [1, 0.35, 0.12] : [0.85, 0.95, 0.3], grav: 5, drag: 0.6 });
          }
          this.haptic(L.grade === 'sketchy' ? 40 : 25);
          break;
        }
        case 'crash': {
          this.audio.crash();
          this.audio.groan();
          this.rig.shake(0.6);
          this.particles.emit(p, new THREE.Vector3(run.phys.vel.x * 0.3, 2.5, run.phys.vel.z * 0.3), 6, 70, { life: 1.0, size: 0.45 });
          this.hud.stamp('BAIL!', 'crash', e.reason);
          this.audio.announce(pick(LINES.crash), true);
          this.pendingScore = run.result.trick ? this.scoreCurrent() : null;
          this.haptic(60);
          this.input.setMode('off');
          break;
        }
        case 'done': this.finishAttempt(); return;
      }
    }
  }

  private haptic(ms: number) { if (this.save.settings.haptics && navigator.vibrate) try { navigator.vibrate(ms); } catch { /* */ } }

  private scoreCurrent(): RunScore | null {
    const r = this.run!.result, s = this.session!;
    if (!r.trick || !r.landing) return null;
    const bonus = s.bonusGrab ? { grab: s.bonusGrab, mult: 2 } : undefined;
    return scoreRun(r.trick, r.landing, r.pop, r.height, s.mem, this.sick, bonus);
  }

  private updateHud(run: RunSim, inp: InputState) {
    const ph = run.phys;
    const z = ph.pos.z;
    this.hud.speed(run.speed, z, run.phase === 'ride' || run.phase === 'ready');
    this.input.setSwitchAllowed(z < COURSE.deckStartZ - 3);
    const showTiming = ph.grounded && run.phase === 'ride' && z > COURSE.knuckleZ - 16 && z < COURSE.knuckleZ + 8;
    this.hud.timingMeter(z, ph.loading ? ph.charge : 0, showTiming);
    if (showTiming) {
      const d = z - COURSE.knuckleZ;
      this.input.setPopFeedback(ph.loading ? ph.charge : 0, Math.abs(d) <= 1.6 ? 'perfect' : Math.abs(d) <= 3.6 ? 'good' : d > 3.6 ? 'late' : 'early');
    } else this.input.setPopFeedback(ph.loading ? ph.charge : 0, 'none');
    if (run.airborne) {
      const sum = run.tricks.summary();
      const chips: string[] = [];
      if (sum.switchTakeoff) chips.push('switch');
      if (sum.pressPop === 'nose') chips.push('nollie');
      if (sum.butter) chips.push('butter');
      if (sum.late) chips.push('late');
      if (sum.offAxis) chips.push('off-axis');
      if (run.tricks.grab && run.tricks.tweak > 0.6) chips.push('tweak!');
      const elements = (sum.spinDeg >= 180 ? 1 : 0) + (sum.flips ? 1 : 0) + (sum.offAxis ? 1 : 0) + sum.grabs.length + (sum.maxTweak > 0.65 ? 1 : 0) + (sum.switchTakeoff ? 1 : 0) + (sum.late ? 1 : 0) + (sum.pressPop !== 'none' ? 1 : 0) + (sum.butter ? 1 : 0);
      const live = run.tricks.grab ? `${sum.name}${sum.grabs.length === 0 ? ' ' + GRAB_NAME[run.tricks.grab] : ''}` : sum.name;
      this.hud.trickLive(live === 'Straight Air' && run.tricks.airTime < 0.4 ? '' : live, chips, 1 + Math.max(0, elements - 1) * 0.2, true);
      // landing indicator
      const gy = groundY(ph.pos.x, ph.pos.z);
      const hag = ph.pos.y - gy;
      const falling = ph.vel.y < 0;
      const prepared = run.tricks.neutralTime > 0.12;
      const { yawErr, flipErr } = run.tricks.landingErrors();
      const ok = prepared && yawErr < 20 && flipErr < 25;
      const v = run.pos.clone().project(this.rig.cam);
      const sx = (v.x * 0.5 + 0.5) * window.innerWidth, sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
      this.hud.landIndicator(sx, sy, falling && hag < 7, ok, ok ? 'READY' : run.tricks.grab ? 'LET GO!' : 'LAND IT!');
    } else {
      this.hud.trickLive('', [], 1, false);
      this.hud.landIndicator(0, 0, false, true, '');
    }
    this.hud.setMode(this.modeName(), this.modeSub());
    // contextual hints for new riders
    if (this.save.settings.showTutorialHints && this.save.totalRuns < 6) {
      let h = '';
      const keys = !this.touch;
      if (run.phase === 'ride' && z < 40) h = keys ? '<b>← →</b> steer · <b>↑</b> tuck for speed' : 'Drag the <b>left side</b> to steer · up to tuck';
      else if (run.phase === 'ride' && z > COURSE.deckStartZ - 14 && !ph.loading && z < COURSE.knuckleZ - 1) h = keys ? '<b>HOLD SPACE</b> to load the pop' : '<b>HOLD POP</b> to load';
      else if (run.phase === 'ride' && ph.loading && z > COURSE.knuckleZ - 5) h = '<b>RELEASE</b> on the blue line!';
      else if (run.airborne && run.tricks.airTime < 1.2) h = keys ? '<b>Arrows</b> spin/flip · <b>J U O P L I K</b> grab' : '<b>Stick</b> = spin/flip · <b>wheel</b> = grab';
      else if (run.airborne && ph.vel.y < 0 && run.tricks.neutralTime < 0.1) h = '<b>LET GO</b> of everything to land';
      this.hud.setHint(h);
      void inp;
    } else this.hud.setHint('');
  }

  // ------------------------------------------------------------------ end of attempt
  private finishAttempt() {
    const s = this.session!, run = this.run!;
    const before = JSON.parse(JSON.stringify(this.save)) as SaveData;
    before.challengesDone = [...this.save.challengesDone];
    const score = this.pendingScore;
    const total = score ? score.total : 0;
    s.results.push(score);
    s.totals.push(total);
    // Sick meter
    if (score) this.sick = Math.max(0, Math.min(100, this.sick + score.sickDelta));
    else this.sick = Math.max(0, this.sick - 6);
    if (this.sick >= 100 && !this.save.achievements.includes('unreal')) this.save.achievements.push('unreal');
    if (score) commitToMemory(s.mem, score);
    // Save
    this.save.totalRuns++;
    if (score && score.landing.grade !== 'crash') {
      this.save.totalLanded++;
      if (!this.save.signatures.includes(score.trick.signature)) this.save.signatures.push(score.trick.signature);
    }
    let pb = false;
    if (score && total > 0 && (!this.save.bestTrick || total > this.save.bestTrick.score)) { this.save.bestTrick = { name: score.trick.name, score: total }; pb = true; }
    const xpGain = Math.round(total / 8) + 60;
    this.save.xp += xpGain;
    // Challenges (any mode)
    const newly: string[] = [];
    if (score) {
      const hist = s.results.slice(0, -1).filter(Boolean) as RunScore[];
      for (const c of CHALLENGES) {
        if (this.save.challengesDone.includes(c.id)) continue;
        if (c.test(score, hist)) {
          this.save.challengesDone.push(c.id); newly.push(c.name);
          const xp = /XP \+(\d+)/.exec(c.reward); if (xp) this.save.xp += Number(xp[1]);
        }
      }
    }
    if (s.mode === 'free' && total > this.save.best.free) this.save.best.free = total;
    this.persist();
    for (const n of newly) { this.hud.toast('CHALLENGE', n); this.audio.ui('unlock'); }
    const unlocks = newlyUnlocked(before, this.save);
    const lvAfter = levelForXp(this.save.xp).level;
    if (lvAfter > levelForXp(before.xp).level) this.hud.toast('LEVEL UP', `Level ${lvAfter}`);
    for (const u of unlocks.slice(0, 4)) this.hud.toast('UNLOCKED', u);

    this.audio.stopRide();
    this.audio.musicIntensity(0.35);
    this.input.setMode('off');
    this.hud.clearTransient();
    this.hud.setLegend(false);
    this.hud.sickMeter(this.sick);

    // Session completion?
    let isLast = Number.isFinite(s.attempts) && s.attempt >= s.attempts;
    let extra = `+${fmt(xpGain)} XP`;
    let challengeDone = false;
    if (s.mode === 'attack') {
      const L = SCORE_ATTACK[s.level! - 1];
      const tot = sum(s.totals);
      extra += ` · ${fmt(tot)} / ${fmt(L.target)}`;
      if (tot >= L.target) isLast = true;
    }
    if (s.mode === 'challenge' && this.save.challengesDone.includes(s.challengeId!) && newly.includes(challengeById(s.challengeId!)!.name)) { isLast = true; challengeDone = true; }
    if (s.mode === 'jam') extra += ` · Jam total ${fmt(this.jamTotal(s))}`;
    if (newly.length) extra += ` · Challenge: ${newly.join(', ')}`;
    const missedReason = run.result.reason;
    this.state = 'results';
    this.rig.setMode('results');
    this.lastResults = () => {
      this.state = 'results';
      this.rig.setMode('results');
      this.hud.show(true);
      this.hud.inResults(true);
      this.hud.clearTransient();
      this.totalFill = this.screens.results({
        score, missedReason, attempt: s.attempt, attempts: s.attempts, sessionScores: s.totals, pb,
        modeLine: `${this.modeName()} · ${Number.isFinite(s.attempts) ? `attempt ${s.attempt} of ${s.attempts}` : `run ${s.attempt}`}`,
        isLast, extra,
        onNext: () => { if (isLast) this.endSession(challengeDone); else this.startAttempt(); },
        onReplay: () => this.startReplay(),
        onMenu: () => this.toMenu(),
      });
      this.countUp(total);
    };
    this.lastResults();
  }

  private countUp(total: number) {
    const el = this.totalFill; if (!el) return;
    const start = performance.now(), dur = Math.min(1400, 500 + total / 20);
    let lastTick = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(total * e);
      if (now - lastTick > 60 && k < 1) { lastTick = now; this.audio.ui('tick'); }
      if (k < 1) requestAnimationFrame(step); else if (total > 0) this.audio.ui('score');
    };
    requestAnimationFrame(step);
  }

  private endSession(challengeDone: boolean) {
    const s = this.session!;
    this.state = 'summary';
    this.hud.show(false);
    const notes: string[] = [];
    let title = 'SESSION OVER', total = 0, rows: { name: string; score: number; me?: boolean }[] | undefined;
    const sub = this.modeName();
    if (s.mode === 'jam') {
      total = this.jamTotal(s);
      rows = [...s.rivals!, { name: `${this.save.name} (you)`, score: total, me: true }].sort((a, b) => b.score - a.score);
      const place = rows.findIndex(r => r.me) + 1;
      title = place === 1 ? 'YOU WON THE JAM!' : place <= 3 ? `PODIUM — ${ordinal(place)}!` : `${ordinal(place)} PLACE`;
      notes.push('Best two runs with different tricks count. Repeats count half.');
      this.save.jamHistory.push({ date: new Date().toISOString().slice(0, 10), score: total, place });
      if (total > this.save.best.jam) { this.save.best.jam = total; notes.push('New best jam!'); }
      if (place === 1 && !this.save.achievements.includes('jamwin')) { this.save.achievements.push('jamwin'); notes.push('Unlocked: Podium Gold jacket'); }
      this.audio.cheer(place === 1 ? 1 : 0.5);
      if (place === 1) this.audio.announce('And that takes the win! What a session!', true);
    } else if (s.mode === 'attack') {
      const L = SCORE_ATTACK[s.level! - 1];
      total = sum(s.totals);
      const passed = total >= L.target;
      title = passed ? 'TARGET SMASHED' : 'SO CLOSE';
      notes.push(`${L.name}: ${fmt(total)} / ${fmt(L.target)}`);
      if (passed && this.save.attackLevel === L.id && L.id < SCORE_ATTACK.length) { this.save.attackLevel = L.id + 1; notes.push(`Unlocked level ${L.id + 1}: ${SCORE_ATTACK[L.id].name}`); }
      if (total > this.save.best.attack) this.save.best.attack = total;
    } else if (s.mode === 'daily') {
      const d = this.dailyInfo();
      total = Math.max(0, ...s.totals);
      const prev = this.save.daily[d.date] ?? 0;
      if (total > prev) { this.save.daily[d.date] = total; notes.push('New daily best!'); }
      rows = [...d.rivals, { name: `${this.save.name} (you)`, score: Math.max(total, prev), me: true }].sort((a, b) => b.score - a.score);
      title = `DAILY HUCK · ${ordinal(rows.findIndex(r => r.me) + 1)}`;
      notes.push(d.title);
    } else if (s.mode === 'challenge') {
      const c = challengeById(s.challengeId!)!;
      title = challengeDone ? 'CHALLENGE COMPLETE' : c.name;
      total = Math.max(0, ...s.totals);
      notes.push(c.desc, `Reward: ${c.reward}`);
    }
    this.persist();
    this.screens.summary({
      title, sub, total, rows, notes,
      onAgain: () => {
        if (s.mode === 'challenge' && challengeDone) { this.toMenu(); this.screens.challenges(); return; }
        this.startSession(s.mode, s.mode === 'attack' ? Math.min(this.save.attackLevel, s.level! + (total >= SCORE_ATTACK[s.level! - 1].target ? 1 : 0)) : s.challengeId);
      },
      onMenu: () => this.toMenu(),
    });
  }

  // ------------------------------------------------------------------ replay
  private startReplay() {
    const run = this.run!;
    if (!run.frames.length) return;
    this.state = 'replay';
    this.hud.show(false);
    this.replay.t = run.frames[0].t + 0.5;
    this.replay.end = run.frames[run.frames.length - 1].t;
    this.replay.angle = 0;
    this.rig.setMode(REPLAY_ANGLES[0].mode, true);
    this.replay.ui = this.screens.replayControls(REPLAY_ANGLES[0].label, this.replay.slow,
      () => { this.replay.angle = (this.replay.angle + 1) % REPLAY_ANGLES.length; const a = REPLAY_ANGLES[this.replay.angle]; this.rig.setMode(a.mode, true); this.replay.ui?.setLabel(a.label); },
      () => { this.replay.slow = !this.replay.slow; },
      () => this.lastResults?.(),
    );
    this.particles.clear();
  }

  private updateReplay(dt: number, inp: InputState) {
    const run = this.run!;
    const pose = defaultPose();
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), vel = new THREE.Vector3();
    const f = sampleFrames(run.frames, this.replay.t, pose, pos, quat, vel);
    const phase = PHASE_FROM_CODE[f.phase];
    const rate = this.replay.slow && phase === 'air' ? 0.35 : 1;
    this.replay.t += dt * rate;
    this.syncRider(pos, quat, pose);
    this.rig.update(dt * rate, pos, vel, { landing: run.landingPoint, airTime: 1, speed: f.speed });
    if (inp.confirm || inp.pause) { this.lastResults?.(); return; }
    if (this.replay.t > this.replay.end + 0.3) {
      // loop to the next angle automatically
      this.replay.t = run.frames[0].t + 0.5;
      this.replay.angle = (this.replay.angle + 1) % REPLAY_ANGLES.length;
      const a = REPLAY_ANGLES[this.replay.angle];
      this.rig.setMode(a.mode, true);
      this.replay.ui?.setLabel(a.label);
    }
  }

  // ------------------------------------------------------------------ menu demo / garage
  private updateDemo(dt: number) {
    const D = this.demo;
    if (!D.frames.length) return;
    D.t += dt;
    const end = D.frames[D.frames.length - 1].t;
    const pose = defaultPose();
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), vel = new THREE.Vector3();
    const f = sampleFrames(D.frames, D.t, pose, pos, quat, vel);
    this.syncRider(pos, quat, pose);
    const phase = PHASE_FROM_CODE[f.phase];
    const cams: CamMode[] = ['replay-broadcast', 'replay-landing', 'replay-follow'];
    const want = cams[D.cam % cams.length];
    if (this.rig.mode !== want) this.rig.setMode(want, true);
    this.rig.update(dt, pos, vel, { speed: f.speed, airTime: 1 });
    if (phase === 'ride' && f.speed > 4 && Math.random() < 0.5) this.particles.emit(new THREE.Vector3(pos.x, pos.y - 0.8, pos.z), new THREE.Vector3(0, 1, 0), 1.2, 1, { life: 0.5 });
    if (D.t > end + 0.5) {
      D.idx++; D.cam++;
      this.buildDemo();
    }
  }

  private updateGarage(dt: number) {
    const z = COURSE.deckStartZ + 4, x = -3;
    this.fallbackPos.set(x, groundY(x, z) + 0.87, z);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -0.35 + Math.sin(this.t * 0.4) * 0.55);
    const pose = defaultPose(); pose.time = this.t; pose.crouch = 0.12; pose.armsOut = 0.15; pose.look = 0.5 + Math.sin(this.t * 0.7) * 0.5;
    this.syncRider(this.fallbackPos, q, pose);
    this.rig.update(dt, this.fallbackPos, new THREE.Vector3(0, 0, 1));
  }

  private updateIdleRider(dt: number) {
    const run = this.run;
    if (!run) return;
    // keep the rider standing where they stopped, celebrating or lying in the snow
    run.step(dt, blankInput());
    this.syncRider(run.pos, run.quat, run.pose);
    this.rig.update(dt, run.pos, run.vel, {});
  }
}

function blankInput(): InputState {
  return { x: 0, y: 0, pop: false, grab: null, tweak: 0, switchStance: false, pause: false, retry: false, confirm: false, source: 'keys' };
}
function sum(a: number[]) { return a.reduce((x, y) => x + y, 0); }
function nextFrame() { return new Promise<void>(r => requestAnimationFrame(() => r())); }

