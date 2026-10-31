/**
 * Fully synthesized audio: board-on-snow, pops, landings, crowd, announcer
 * (Web Speech) and a generative snowboard-film soundtrack. No sample assets,
 * nothing to download. AudioContext is unlocked on the first user gesture.
 */

type Song = 'menu' | 'run';

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode; private music!: GainNode; private sfx!: GainNode;
  private noise!: AudioBuffer;
  private carve: { src: AudioBufferSourceNode; filt: BiquadFilterNode; gain: GainNode } | null = null;
  private wind: { src: AudioBufferSourceNode; filt: BiquadFilterNode; gain: GainNode } | null = null;
  private crowdBed: { gain: GainNode; filt: BiquadFilterNode } | null = null;
  private seq: Sequencer | null = null;
  settings = { master: 0.8, music: 0.55, sfx: 0.9, announcer: true, voice: true };
  private voiceReady = false;
  private voices: SpeechSynthesisVoice[] = [];
  onCaption: ((text: string) => void) | null = null;
  private lastSpeak = 0;

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.music = ctx.createGain(); this.music.connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = w * 0.6 + b * 2.2; }
    this.applySettings();
    this.startLoops();
    this.seq = new Sequencer(ctx, this.music, this.noise);
    if ('speechSynthesis' in window) {
      const load = () => { this.voices = speechSynthesis.getVoices(); this.voiceReady = true; };
      load(); speechSynthesis.onvoiceschanged = load;
      // iOS needs a first utterance inside a gesture
      try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch { /* ignore */ }
    }
  }

  applySettingsFrom(s: { master: number; music: number; sfx: number; announcer: boolean; voice: boolean }) {
    this.settings = { master: s.master, music: s.music, sfx: s.sfx, announcer: s.announcer, voice: s.voice };
    this.applySettings();
  }

  applySettings() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.master, t, 0.05);
    this.music.gain.setTargetAtTime(this.settings.music * 0.55, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.settings.sfx, t, 0.05);
  }

  private loopNoise(type: BiquadFilterType, f: number, q: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const filt = ctx.createBiquadFilter(); filt.type = type; filt.frequency.value = f; filt.Q.value = q;
    const gain = ctx.createGain(); gain.gain.value = 0;
    src.connect(filt); filt.connect(gain); gain.connect(this.sfx);
    src.start();
    return { src, filt, gain };
  }

  private startLoops() {
    this.carve = this.loopNoise('bandpass', 900, 0.8);
    this.wind = this.loopNoise('bandpass', 500, 0.6);
    const c = this.loopNoise('bandpass', 1100, 0.5);
    this.crowdBed = { gain: c.gain, filt: c.filt };
  }

  /** Continuous board-on-snow + wind. */
  ride(speed: number, grounded: boolean, edge: number, airSpeed: number) {
    if (!this.ctx || !this.carve || !this.wind) return;
    const t = this.ctx.currentTime;
    const g = grounded ? Math.min(0.5, speed * 0.022) * (1 + edge * 1.6) : 0;
    this.carve.gain.gain.setTargetAtTime(g, t, 0.04);
    this.carve.filt.frequency.setTargetAtTime(500 + speed * 45 + edge * 1600, t, 0.05);
    this.wind.gain.gain.setTargetAtTime(Math.min(0.35, airSpeed * 0.012) * (grounded ? 0.5 : 1.2), t, 0.1);
    this.wind.filt.frequency.setTargetAtTime(300 + airSpeed * 40, t, 0.1);
  }
  stopRide() { this.ride(0, true, 0, 0); }

  crowd(level: number) {
    if (!this.ctx || !this.crowdBed) return;
    const t = this.ctx.currentTime;
    this.crowdBed.gain.gain.setTargetAtTime(0.02 + level * 0.1, t, 0.4);
    this.crowdBed.filt.frequency.setTargetAtTime(900 + level * 600, t, 0.4);
  }

  private burst(dur: number, f: number, q: number, vol: number, type: BiquadFilterType = 'bandpass', fEnd?: number, delay = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filt = ctx.createBiquadFilter(); filt.type = type; filt.frequency.setValueAtTime(f, t); filt.Q.value = q;
    if (fEnd) filt.frequency.exponentialRampToValueAtTime(fEnd, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt); filt.connect(g); g.connect(this.sfx);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }
  private tone(f: number, dur: number, vol: number, type: OscillatorType = 'sine', fEnd?: number, delay = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
    if (fEnd) o.frequency.exponentialRampToValueAtTime(fEnd, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + dur + 0.05);
  }

  load() { this.burst(0.25, 400, 1, 0.25, 'lowpass', 180); }
  pop(quality: number) {
    this.tone(120, 0.12, 0.5, 'sine', 50);
    this.burst(0.09, 2600, 1.2, 0.5 + quality * 0.3);
    this.burst(0.35, 1200, 0.6, 0.25, 'bandpass', 3000);
    if (quality > 0.8) this.tone(880, 0.25, 0.08, 'triangle', 1320);
  }
  grab() { this.burst(0.05, 1800, 2, 0.18); this.tone(260, 0.06, 0.12, 'square', 180); }
  spinWhoosh(rate: number) { this.burst(0.3, 500 + rate, 1.5, 0.08 + Math.min(0.12, rate / 6000)); }
  land(impact: number, clean: boolean) {
    const v = Math.min(1, impact / 16);
    this.tone(90, 0.25, 0.4 + v * 0.5, 'sine', 40);
    this.burst(0.5, 900, 0.5, 0.35 + v * 0.4, 'lowpass', 200);
    this.burst(0.7, 3000, 0.4, 0.2, 'highpass');
    if (clean) this.tone(660, 0.3, 0.05, 'triangle', 990, 0.05);
  }
  crash() {
    for (let i = 0; i < 6; i++) this.burst(0.25 + Math.random() * 0.2, 400 + Math.random() * 800, 0.7, 0.4, 'lowpass', 150, i * 0.13);
    this.tone(70, 0.5, 0.5, 'sine', 35);
  }
  cheer(intensity: number) {
    if (!this.ctx) return;
    const n = 3 + Math.round(intensity * 4);
    for (let i = 0; i < n; i++) this.burst(1.2 + intensity, 900 + Math.random() * 900, 0.6, 0.12 + intensity * 0.15, 'bandpass', 1500 + Math.random() * 600, i * 0.04);
    // whistles
    if (intensity > 0.5) for (let i = 0; i < 2; i++) this.tone(1800 + Math.random() * 600, 0.4, 0.04, 'sine', 2600, 0.1 + i * 0.3);
  }
  groan() { this.burst(1.2, 500, 0.8, 0.2, 'bandpass', 250); }
  ui(kind: 'tap' | 'back' | 'unlock' | 'tick' | 'score') {
    if (kind === 'tap') this.tone(520, 0.06, 0.08, 'triangle', 700);
    else if (kind === 'back') this.tone(400, 0.07, 0.08, 'triangle', 280);
    else if (kind === 'tick') this.tone(1200, 0.025, 0.035, 'square');
    else if (kind === 'score') { this.tone(523, 0.12, 0.08, 'triangle'); this.tone(784, 0.2, 0.08, 'triangle', undefined, 0.08); }
    else { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.25, 0.07, 'triangle', undefined, i * 0.07)); }
  }

  playMusic(song: Song) { this.seq?.play(song); }
  musicIntensity(v: number) { this.seq?.setIntensity(v); }
  musicDuck(on: boolean) { if (this.ctx) this.music.gain.setTargetAtTime(this.settings.music * 0.55 * (on ? 0.4 : 1), this.ctx.currentTime, 0.2); }

  announce(text: string, priority = false) {
    if (!this.settings.announcer) return;
    this.onCaption?.(text);
    if (!this.settings.voice || !('speechSynthesis' in window) || !this.voiceReady) return;
    const now = performance.now();
    if (!priority && now - this.lastSpeak < 1800) return;
    this.lastSpeak = now;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const v = this.voices.find(v => /en-(US|GB|AU)/.test(v.lang) && /Male|Daniel|Alex|Fred|Aaron|Arthur|Gordon/i.test(v.name)) ?? this.voices.find(v => v.lang.startsWith('en'));
      if (v) u.voice = v;
      u.rate = 1.12; u.pitch = 0.85; u.volume = Math.min(1, this.settings.master * 1.1);
      speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }

  suspend() { this.ctx?.suspend(); try { speechSynthesis.cancel(); } catch { /* */ } }
  resume() { this.ctx?.resume(); }
}

/**
 * Generative soundtrack: breakbeat drums, distorted bass, power-chord stabs
 * and a lead hook. Two songs — a laid-back menu groove and the run track.
 */
class Sequencer {
  private ctx: AudioContext; private noise: AudioBuffer;
  private song: Song | null = null;
  private step = 0; private nextTime = 0; private timer = 0;
  private bpm = 128; private intensity = 0.5;
  private bus: GainNode; private dist: WaveShaperNode;

  constructor(ctx: AudioContext, out: GainNode, noise: AudioBuffer) {
    this.ctx = ctx; this.noise = noise;
    this.bus = ctx.createGain(); this.bus.gain.value = 0.8; this.bus.connect(out);
    this.dist = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 3.2); }
    this.dist.curve = curve;
    const dg = ctx.createGain(); dg.gain.value = 0.35; this.dist.connect(dg); dg.connect(this.bus);
  }
  setIntensity(v: number) { this.intensity = Math.max(0, Math.min(1, v)); }
  play(song: Song) {
    if (this.song === song) return;
    this.song = song;
    this.bpm = song === 'menu' ? 96 : 138;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    if (!this.timer) this.timer = window.setInterval(() => this.schedule(), 25);
  }
  private schedule() {
    const spb = 60 / this.bpm / 4; // 16ths
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      this.tick(this.step, this.nextTime);
      this.nextTime += spb;
      this.step = (this.step + 1) % 128;
    }
  }
  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  private kick(t: number, v = 1) {
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    this.env(g, t, 0.002, 0.9 * v, 0.28); o.connect(g); g.connect(this.bus); o.start(t); o.stop(t + 0.35);
  }
  private snare(t: number, v = 1) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.7;
    const g = this.ctx.createGain(); this.env(g, t, 0.001, 0.5 * v, 0.17);
    s.connect(f); f.connect(g); g.connect(this.bus); s.start(t, Math.random()); s.stop(t + 0.25);
    const o = this.ctx.createOscillator(); o.frequency.value = 190; const og = this.ctx.createGain(); this.env(og, t, 0.001, 0.25 * v, 0.08); o.connect(og); og.connect(this.bus); o.start(t); o.stop(t + 0.12);
  }
  private hat(t: number, open = false, v = 1) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500;
    const g = this.ctx.createGain(); this.env(g, t, 0.001, 0.16 * v, open ? 0.2 : 0.04);
    s.connect(f); f.connect(g); g.connect(this.bus); s.start(t, Math.random()); s.stop(t + 0.3);
  }
  private synth(t: number, freq: number, dur: number, vol: number, type: OscillatorType, dest: AudioNode, cutoff = 2400, detune = 0) {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = detune;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(cutoff, t); f.frequency.exponentialRampToValueAtTime(Math.max(200, cutoff * 0.3), t + dur);
    const g = this.ctx.createGain(); this.env(g, t, 0.005, vol, dur);
    o.connect(f); f.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }
  private tick(step: number, t: number) {
    const s16 = step % 16, bar = Math.floor(step / 16) % 8;
    const I = this.intensity;
    const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
    if (this.song === 'menu') {
      // laid-back boom-bap with a jazzy loop
      if (s16 === 0 || s16 === 10) this.kick(t, 0.8);
      if (s16 === 4 || s16 === 12) this.snare(t, 0.6);
      if (s16 % 2 === 0) this.hat(t, false, s16 % 4 === 2 ? 0.7 : 0.4);
      const chords = [[57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65], [52, 55, 59, 62]];
      const ch = chords[Math.floor(bar / 2) % 4];
      if (s16 === 0 || s16 === 7) ch.forEach((n, i) => this.synth(t + i * 0.012, midi(n), 0.9, 0.035, 'triangle', this.bus, 1600));
      if (s16 === 0 || s16 === 8 || s16 === 11) this.synth(t, midi(ch[0] - 24), 0.35, 0.18, 'sine', this.bus, 600);
      return;
    }
    // run track: punchy breakbeat + overdriven bass + stabs
    const kickPat = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0];
    const snarePat = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1];
    if (kickPat[s16]) this.kick(t);
    if (snarePat[s16]) this.snare(t, s16 === 15 ? 0.4 : 1);
    if (I > 0.15) this.hat(t, s16 % 4 === 2, s16 % 2 ? 0.5 : 0.9);
    if (bar === 7 && s16 >= 12) this.snare(t, 0.5 + (s16 - 12) * 0.12);
    const roots = [40, 40, 43, 38, 40, 40, 45, 43];
    const r = roots[bar];
    const bassPat = [1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
    if (bassPat[s16]) this.synth(t, midi(r + (s16 === 13 ? 12 : 0)), 0.16, 0.25, 'sawtooth', this.dist, 900 + I * 1200);
    if (I > 0.35 && (s16 === 0 || s16 === 6 || s16 === 10)) {
      [0, 7, 12].forEach(iv => this.synth(t, midi(r + 12 + iv), 0.22, 0.05, 'square', this.dist, 2600, (Math.random() - 0.5) * 10));
    }
    if (I > 0.65) {
      const lead = [64, 0, 67, 0, 69, 67, 0, 64, 0, 62, 64, 0, 67, 0, 71, 0];
      const n = lead[s16];
      if (n && bar % 2 === 1) this.synth(t, midi(n + 12), 0.14, 0.05, 'square', this.bus, 3200);
    }
  }
}

export const LINES = {
  drop: ['Dropping in!', 'Here we go!', 'Next rider up, let\'s see it!', 'All eyes on the knuckle.', 'Big moment, here it comes.'],
  perfectPop: ['Perfect pop!', 'Nailed the knuckle!', 'Look at that pop!'],
  early: ['Popped early!', 'A little early on that one.'],
  late: ['Late on the pop!', 'Rolled over it late.'],
  noPop: ['No pop! Just let it ride!', 'Scrubbed the knuckle!'],
  stomped: ['Stomped it!', 'Absolutely stomped!', 'Bolts! Did you see that?', 'That is how you land!'],
  clean: ['Clean landing!', 'Rode it away!', 'Smooth!', 'Very nice.'],
  sketchy: ['Sketchy, but they hold on!', 'Saved it!', 'Ooh, a little loose.', 'Hand drag but still riding!'],
  crash: ['Oh no! Yard sale!', 'That\'s gonna leave a mark!', 'Ouch! Shake it off!', 'Down goes the rider!', 'Full send, full slam!'],
  big: ['The crowd is losing it!', 'That is huge!', 'Unreal amplitude!'],
  repeat: ['Again? The judges want something new.', 'We\'ve seen that one.'],
  sick: ['The place is going off!', 'Sick meter is maxed!'],
  knuckled: ['Knuckled it! Needed more speed!', 'Came up short on the knuckle!'],
  flat: ['Overshot to flat! Ouch!', 'Way too much speed!'],
};

export function pick<T>(a: T[]) { return a[Math.floor(Math.random() * a.length)]; }
