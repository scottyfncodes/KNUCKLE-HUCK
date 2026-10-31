/**
 * One attempt, from drop-in to ride-away or slam. Pure simulation: it owns the
 * physics + trick controller, produces the rider transform and pose each tick
 * and records replay frames. Rendering, audio and UI listen to its events.
 */
import * as THREE from 'three';
import { COURSE, groundNormal, groundY, halfWidth, slopeAt } from '../physics/course';
import { PHYS, RiderPhysics, type BoardStats, type Conditions, type LandingContact, type PopResult } from '../physics/rider';
import { TrickController, type GrabId, type TrickSummary } from '../tricks/tricks';
import { evaluateLanding, type LandingResult } from '../scoring/scoring';
import { defaultPose, type RiderPose } from '../render/riderModel';
import type { InputState } from '../input/input';

export type RunPhase = 'ready' | 'ride' | 'air' | 'landed' | 'crash' | 'done';

export type RunEvent =
  | { type: 'drop' }
  | { type: 'load' }
  | { type: 'pop'; pop: PopResult }
  | { type: 'takeoff'; popped: boolean }
  | { type: 'grab'; id: GrabId }
  | { type: 'hop' }
  | { type: 'land'; landing: LandingResult; contact: LandingContact }
  | { type: 'crash'; reason: string }
  | { type: 'switch'; toSwitch: boolean }
  | { type: 'butter' }
  | { type: 'done' };

export interface RunOutcome {
  trick: TrickSummary | null;
  landing: LandingResult | null;
  pop: PopResult | null;
  height: number;
  crashed: boolean;
  reason: string;
  missed: boolean;
}

const GRAB_IDS: GrabId[] = ['indy', 'mute', 'melon', 'method', 'stalefish', 'nose', 'tail'];

export interface Frame {
  t: number; x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number;
  crouch: number; grab: number; grabBlend: number; tweak: number; lean: number; twist: number; armsOut: number;
  flail: number; look: number; flex: number; press: number; extend: number; wave: number; phase: number; speed: number;
  vx: number; vy: number; vz: number;
}

const PH: Record<RunPhase, number> = { ready: 0, ride: 1, air: 2, landed: 3, crash: 4, done: 5 };
export const PHASE_FROM_CODE: RunPhase[] = ['ready', 'ride', 'air', 'landed', 'crash', 'done'];

const Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);

export class RunSim {
  phys = new RiderPhysics();
  tricks = new TrickController();
  phase: RunPhase = 'ready';
  t = 0;
  phaseT = 0;
  events: RunEvent[] = [];
  frames: Frame[] = [];
  pose: RiderPose = defaultPose();
  pos = new THREE.Vector3();
  quat = new THREE.Quaternion();
  vel = new THREE.Vector3();
  switchStance = false;
  /** Ground 180 animation progress (rad offset) */
  private groundSpin = 0;
  private groundSpinTarget = 0;
  private pitch = 0;
  private roll = 0;
  private outcome: RunOutcome = { trick: null, landing: null, pop: null, height: 0, crashed: false, reason: '', missed: false };
  private crash = { vel: new THREE.Vector3(), axis: new THREE.Vector3(1, 0, 0), rate: 0, q: new THREE.Quaternion(), pos: new THREE.Vector3() };
  private recordAcc = 0;
  private airHeading = 0;
  private landFlex = 0;
  private wasGrab: GrabId | null = null;
  private loadEmitted = false;
  private stats: BoardStats;
  private hadMainAir = false;
  private butterTime = 0;
  private stall = 0;
  autoDrop = true;
  /** Predicted landing point (for camera) */
  landingPoint = new THREE.Vector3();

  constructor(stats: BoardStats, response: number, cond: Conditions, startSwitch = false) {
    this.stats = stats;
    this.phys.stats = stats;
    this.phys.cond = cond;
    this.tricks.stats = { spin: stats.spin, response };
    this.phys.reset(0);
    this.phys.speed = 0;
    this.switchStance = startSwitch;
    this.groundSpin = this.groundSpinTarget = startSwitch ? Math.PI : 0;
    this.computeTransform();
  }

  get airborne() { return this.phase === 'air'; }
  get speed() { return this.phase === 'air' ? Math.hypot(this.phys.vel.x, this.phys.vel.y, this.phys.vel.z) : this.phys.speed; }
  get result() { return this.outcome; }

  drop() {
    if (this.phase !== 'ready') return;
    this.phase = 'ride'; this.phaseT = 0;
    this.phys.speed = 2.4;
    this.events.push({ type: 'drop' });
  }

  step(dt: number, inp: InputState) {
    this.t += dt; this.phaseT += dt;
    const P = this.pose;
    P.time = this.t;
    switch (this.phase) {
      case 'ready':
        if (this.autoDrop && this.phaseT > 0.9) this.drop();
        if (inp.pop || Math.abs(inp.x) > 0.3 || Math.abs(inp.y) > 0.3) this.drop();
        this.idlePose(dt);
        break;
      case 'ride': this.stepRide(dt, inp); break;
      case 'air': this.stepAir(dt, inp); break;
      case 'landed': this.stepLanded(dt); break;
      case 'crash': this.stepCrash(dt); break;
      case 'done': if (this.outcome.crashed) this.stepCrash(dt); else this.stepLanded(dt); break;
    }
    if (this.phase !== 'crash' && !(this.phase === 'done' && this.outcome.crashed)) this.computeTransform();
    this.record(dt);
  }

  private idlePose(dt: number) {
    const P = this.pose;
    P.crouch = 0.2; P.armsOut = 0.25; P.flail = 0; P.grab = null; P.grabBlend = 0; P.tweak = 0;
    P.look = this.switchStance ? -1.25 : 1.25; P.lean = 0; P.twist = 0; P.flex = 0; P.extend = 0;
    P.wave = Math.max(0, P.wave - dt * 3);
  }

  private stepRide(dt: number, inp: InputState) {
    const ph = this.phys, P = this.pose;
    const onInrun = ph.pos.z < COURSE.deckStartZ - 6;
    const press = onInrun ? 0 : inp.y;
    const tuck = onInrun ? Math.max(0, inp.y) : 0;
    const brake = onInrun ? Math.max(0, -inp.y) : 0;
    // Switch stance: quick ground 180 while on the in-run
    if (inp.switchStance && ph.pos.z < COURSE.deckStartZ - 3 && Math.abs(this.groundSpin - this.groundSpinTarget) < 0.3) {
      this.switchStance = !this.switchStance;
      this.groundSpinTarget = this.switchStance ? Math.PI : 0;
      this.events.push({ type: 'switch', toSwitch: this.switchStance });
    }
    const gs = this.groundSpinTarget - this.groundSpin;
    this.groundSpin += Math.sign(gs) * Math.min(Math.abs(gs), dt * 11);

    if (inp.pop && !ph.loading && !this.loadEmitted) { this.loadEmitted = true; this.events.push({ type: 'load' }); }
    if (!inp.pop) this.loadEmitted = false;

    ph.stepGround(dt, { steer: -inp.x, press, load: inp.pop });
    // Butter: pressing while turning on the deck
    if (!onInrun && Math.abs(ph.press) > 0.45 && Math.abs(ph.turnRate) > 0.45) this.butterTime += dt;
    else this.butterTime = Math.max(0, this.butterTime - dt * 0.5);
    // tuck / speed check on the in-run
    if (tuck > 0) ph.speed += tuck * 0.9 * dt;
    if (brake > 0) ph.speed = Math.max(3, ph.speed - brake * 3.5 * dt);

    // pose
    const charge = ph.loading ? ph.charge : 0;
    P.crouch += ((0.22 + tuck * 0.45 + charge * 0.62) - P.crouch) * Math.min(1, dt * 12);
    P.press = ph.press;
    P.lean += ((-inp.x * (this.switchStance ? -1 : 1) * 0.7) - P.lean) * Math.min(1, dt * 6);
    P.twist += (((ph.loading ? inp.x * 0.5 : 0)) - P.twist) * Math.min(1, dt * 8);
    P.armsOut += ((0.25 + Math.abs(inp.x) * 0.25) - P.armsOut) * Math.min(1, dt * 5);
    P.look = this.switchStance ? -1.25 : 1.25;
    P.grab = null; P.grabBlend = Math.max(0, P.grabBlend - dt * 6); P.tweak = 0; P.flail = 0; P.extend = 0;
    this.landFlex *= Math.exp(-dt * 8);
    P.flex = charge * 0.9 + this.landFlex;

    if (!ph.grounded) {
      this.beginAir(ph.lastPop !== null);
      return;
    }
    // out of bounds / stalled
    if (Math.abs(ph.pos.x) > halfWidth(ph.pos.z) + 5) { this.miss('Missed the feature'); return; }
    if (ph.speed < 1.2) { this.stall += dt; if (this.stall > 1.5) { this.miss('Ran out of speed'); return; } } else this.stall = 0;
    if (ph.pos.z > COURSE.landingStartZ + 6 && !this.hadMainAir) { this.miss('Rolled the knuckle — no air'); return; }
  }

  private beginAir(popped: boolean) {
    const ph = this.phys;
    this.phase = 'air'; this.phaseT = 0;
    if (popped && ph.lastPop) this.events.push({ type: 'pop', pop: ph.lastPop });
    this.events.push({ type: 'takeoff', popped });
    const press = ph.lastPop?.press ?? 'none';
    this.tricks.begin(this.switchStance, press, this.butterTime > 0.35);
    if (this.butterTime > 0.35) this.events.push({ type: 'butter' });
    this.butterTime = 0;
    this.airHeading = ph.heading;
    this.wasGrab = null;
    this.predictLanding();
  }

  private predictLanding() {
    // simple ballistic prediction for the camera
    const p = { ...this.phys.pos }, v = { ...this.phys.vel };
    for (let i = 0; i < 400; i++) {
      v.y -= PHYS.airGravity / 60; p.x += v.x / 60; p.y += v.y / 60; p.z += v.z / 60;
      if (p.y <= groundY(p.x, p.z)) break;
    }
    this.landingPoint.set(p.x, groundY(p.x, p.z), p.z);
  }

  private stepAir(dt: number, inp: InputState) {
    const ph = this.phys, P = this.pose, tr = this.tricks;
    tr.step(dt, { spin: -inp.x, flip: inp.y, grab: inp.grab, tweak: inp.tweak }, ph.apexReached);
    if (tr.grab && tr.grab !== this.wasGrab) this.events.push({ type: 'grab', id: tr.grab });
    this.wasGrab = tr.grab;
    const c = ph.stepAir(dt);

    // pose in the air
    const gy = groundY(ph.pos.x, ph.pos.z);
    const hag = ph.pos.y - gy;
    const prepared = tr.neutralTime > 0.12;
    P.grab = tr.shownGrab; P.grabBlend = tr.grabBlend; P.tweak = tr.tweak;
    if (!tr.grab && tr.grabBlend < 0.02) P.grab = null;
    P.crouch += ((tr.grab ? 0.35 : 0.42 + Math.min(0.3, Math.abs(tr.flipRate) / 900)) - P.crouch) * Math.min(1, dt * 8);
    P.extend += (((prepared && hag < 3 && ph.vel.y < 0) ? 1 : 0) - P.extend) * Math.min(1, dt * 8);
    P.armsOut += ((tr.grab ? 0.3 : 0.75) - P.armsOut) * Math.min(1, dt * 6);
    P.twist += ((Math.sign(tr.spinRate) * Math.min(0.55, Math.abs(tr.spinRate) / 900)) - P.twist) * Math.min(1, dt * 6);
    P.press *= Math.exp(-dt * 6);
    P.lean *= Math.exp(-dt * 4);
    P.flex *= Math.exp(-dt * 6);
    P.look = (this.switchStance ? -1 : 1) * 1.1;

    if (this.phaseT % 0.25 < dt) this.predictLanding();

    if (c) this.onTouchdown(c);
  }

  private onTouchdown(c: LandingContact) {
    const ph = this.phys, tr = this.tricks;
    const { yawErr, flipErr } = tr.landingErrors();
    const landing = evaluateLanding(c.impact, c.zone, yawErr, flipErr, !!tr.grab, tr.neutralTime, this.stats.forgiveness, this.stats.stability);
    const isHop = !this.hadMainAir && ph.pos.z < COURSE.deckStartZ - 2 && tr.airTime < 1.0;
    if (landing.grade === 'crash') {
      this.outcome = { trick: tr.summary(), landing, pop: ph.lastPop, height: ph.maxHeightAboveGround, crashed: true, reason: landing.reason, missed: false };
      this.startCrash(landing.reason);
      return;
    }
    if (tr.landsSwitch()) {
      this.switchStance = !this.switchStance;
    }
    // board is now aligned to the clean angle
    this.groundSpin = this.groundSpinTarget = this.switchStance ? Math.PI : 0;
    this.landFlex = -Math.min(1, c.impact / 12);
    this.pose.crouch = Math.min(1, 0.4 + c.impact / 14);
    if (isHop) {
      this.phase = 'ride'; this.phaseT = 0;
      this.events.push({ type: 'hop' });
      return;
    }
    this.hadMainAir = true;
    this.outcome = { trick: tr.summary(), landing, pop: ph.lastPop, height: ph.maxHeightAboveGround, crashed: false, reason: landing.reason, missed: false };
    this.phase = 'landed'; this.phaseT = 0;
    this.events.push({ type: 'land', landing, contact: c });
  }

  private stepLanded(dt: number) {
    const ph = this.phys, P = this.pose;
    const braking = ph.pos.z > COURSE.outrunZ + 12 || this.phaseT > 1.6;
    ph.stepGround(dt, { steer: braking ? 0.25 : 0, press: 0, load: false });
    if (braking) ph.speed = Math.max(0.6, ph.speed - dt * 7);
    if (!ph.grounded) { ph.stepAir(dt); }
    const sketch = this.outcome.landing?.grade === 'sketchy';
    P.crouch += ((sketch ? 0.65 : 0.3) - P.crouch) * Math.min(1, dt * 3);
    P.extend = 0; P.press *= 0.9; P.grab = null; P.grabBlend = Math.max(0, P.grabBlend - dt * 6);
    this.landFlex *= Math.exp(-dt * 6); P.flex = this.landFlex;
    P.armsOut = sketch ? 0.9 + Math.sin(this.t * 8) * 0.1 : 0.4;
    P.lean = sketch ? Math.sin(this.t * 5) * 0.6 : P.lean * 0.95;
    P.look = this.switchStance ? -1.25 : 1.25;
    P.twist *= 0.9;
    if (!sketch && this.phaseT > 0.5) P.wave = Math.min(1, P.wave + dt * 3);
    if (this.phase === 'landed' && (this.phaseT > 2.4 || ph.pos.z > COURSE.finishZ)) { this.phase = 'done'; this.events.push({ type: 'done' }); }
  }

  private startCrash(reason: string) {
    const ph = this.phys;
    this.phase = 'crash'; this.phaseT = 0;
    this.crash.pos.copy(this.pos);
    const n = groundNormal(ph.pos.x, ph.pos.z, { x: 0, y: 1, z: 0 });
    const vn = ph.vel.x * n.x + ph.vel.y * n.y + ph.vel.z * n.z;
    this.crash.vel.set(ph.vel.x - n.x * vn * 1.35, ph.vel.y - n.y * vn * 1.35 + 2.5, ph.vel.z - n.z * vn * 1.35).multiplyScalar(0.75);
    this.crash.q.copy(this.quat);
    const spinDir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.4, Math.random() - 0.5).normalize();
    this.crash.axis.crossVectors(Y, new THREE.Vector3(ph.vel.x, 0, ph.vel.z).normalize()).add(spinDir.multiplyScalar(0.6)).normalize();
    this.crash.rate = 9 + Math.random() * 5;
    this.events.push({ type: 'crash', reason });
  }

  private stepCrash(dt: number) {
    const c = this.crash, P = this.pose;
    c.vel.y -= 9.81 * dt;
    c.pos.addScaledVector(c.vel, dt);
    const gy = groundY(c.pos.x, c.pos.z) + 0.35;
    if (c.pos.y < gy) {
      c.pos.y = gy;
      const n = groundNormal(c.pos.x, c.pos.z, { x: 0, y: 1, z: 0 });
      const nv = new THREE.Vector3(n.x, n.y, n.z);
      const vn = c.vel.dot(nv);
      if (vn < 0) c.vel.addScaledVector(nv, -vn * 1.35); // small bounce
      // slide downhill along the slope with snow friction
      c.vel.multiplyScalar(Math.exp(-dt * 1.4));
      const s = slopeAt(c.pos.z);
      c.vel.z += -s * 9.81 * dt * 0.55;
      c.rate *= Math.exp(-dt * 1.6);
    }
    c.q.premultiply(new THREE.Quaternion().setFromAxisAngle(c.axis, c.rate * dt));
    this.pos.copy(c.pos);
    this.quat.copy(c.q);
    this.vel.copy(c.vel);
    P.flail = Math.max(0.15, 1 - this.phaseT * 0.45);
    P.grab = null; P.grabBlend = 0; P.crouch = 0.3; P.extend = 0; P.wave = 0;
    if (this.phase === 'crash' && this.phaseT > 2.3) { this.phase = 'done'; this.events.push({ type: 'done' }); }
    // keep physics position in sync for camera
    this.phys.pos.x = c.pos.x; this.phys.pos.y = c.pos.y; this.phys.pos.z = c.pos.z;
  }

  private miss(reason: string) {
    this.outcome = { trick: null, landing: null, pop: this.phys.lastPop, height: 0, crashed: true, reason, missed: true };
    this.startCrash(reason);
    this.crash.rate = 3;
    this.crash.vel.multiplyScalar(0.5);
  }

  /** Builds the rider's world transform from heading, slope, lean and trick angles. */
  private computeTransform() {
    const ph = this.phys, P = this.pose;
    const stand = 0.9 - 0.3 * P.crouch + 0.06 * P.extend;
    let heading = ph.heading;
    let spin = this.groundSpin, flip = 0;
    if (this.phase === 'air') {
      heading = this.airHeading;
      spin += this.tricks.spin * Math.PI / 180;
      flip = this.tricks.flip * Math.PI / 180;
      // pitch: blend toward the slope under the rider so the board meets the landing
      const s = slopeAt(Math.max(ph.pos.z, this.landingPoint.z - 4));
      const target = Math.atan(-s);
      this.pitch += (target - this.pitch) * 0.04;
      this.roll *= 0.95;
    } else {
      const s = this.slopeAlong(heading);
      const target = Math.atan(-s);
      this.pitch += (target - this.pitch) * 0.35;
      this.roll += ((-ph.turnRate * 0.22) - this.roll) * 0.2;
    }
    const q = this.quat;
    q.setFromAxisAngle(Y, heading);
    q.multiply(tq.setFromAxisAngle(X, this.pitch));
    q.multiply(tq.setFromAxisAngle(Z, this.roll));
    q.multiply(tq.setFromAxisAngle(Y, spin));
    q.multiply(tq.setFromAxisAngle(X, flip));
    q.multiply(tq.setFromAxisAngle(Y, -Math.PI / 2)); // stance: board nose → travel
    // position: centre of mass above the board along the board's up axis
    // In the air the physics point is the board's flight path; the body rotates about the COM above it.
    this.pos.set(ph.pos.x, ph.pos.y + stand, ph.pos.z);
    if (this.phase !== 'air') {
      // on snow, keep COM above board contact along surface normal
      const n = groundNormal(ph.pos.x, ph.pos.z, { x: 0, y: 1, z: 0 });
      this.pos.set(ph.pos.x + n.x * stand, ph.pos.y + n.y * stand, ph.pos.z + n.z * stand);
    }
    this.vel.set(ph.vel.x, ph.vel.y, ph.vel.z);
  }

  private slopeAlong(h: number) {
    const e = 0.3, p = this.phys.pos;
    const sx = Math.sin(h), cz = Math.cos(h);
    return (groundY(p.x + sx * e, p.z + cz * e) - groundY(p.x - sx * e, p.z - cz * e)) / (2 * e);
  }

  private record(dt: number) {
    this.recordAcc += dt;
    if (this.recordAcc < 1 / 60 && this.frames.length) return;
    this.recordAcc = 0;
    const P = this.pose, q = this.quat, p = this.pos;
    this.frames.push({
      t: this.t, x: p.x, y: p.y, z: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w,
      crouch: P.crouch, grab: P.grab ? GRAB_IDS.indexOf(P.grab) : -1, grabBlend: P.grabBlend, tweak: P.tweak, lean: P.lean, twist: P.twist,
      armsOut: P.armsOut, flail: P.flail, look: P.look, flex: P.flex, press: P.press, extend: P.extend, wave: P.wave,
      phase: PH[this.phase], speed: this.speed, vx: this.vel.x, vy: this.vel.y, vz: this.vel.z,
    });
  }
}

const tq = new THREE.Quaternion();

/** Interpolated playback of recorded frames. */
export function sampleFrames(frames: Frame[], t: number, pose: RiderPose, pos: THREE.Vector3, quat: THREE.Quaternion, vel: THREE.Vector3): Frame {
  if (!frames.length) return null as unknown as Frame;
  let lo = 0, hi = frames.length - 1;
  if (t <= frames[0].t) hi = 0;
  else if (t >= frames[hi].t) lo = hi;
  else { while (hi - lo > 1) { const m = (lo + hi) >> 1; if (frames[m].t <= t) lo = m; else hi = m; } }
  const a = frames[lo], b = frames[hi];
  const k = hi === lo ? 0 : (t - a.t) / (b.t - a.t);
  const L = (x: number, y: number) => x + (y - x) * k;
  pos.set(L(a.x, b.x), L(a.y, b.y), L(a.z, b.z));
  quat.set(a.qx, a.qy, a.qz, a.qw).slerp(tq.set(b.qx, b.qy, b.qz, b.qw), k);
  vel.set(L(a.vx, b.vx), L(a.vy, b.vy), L(a.vz, b.vz));
  pose.crouch = L(a.crouch, b.crouch); pose.grabBlend = L(a.grabBlend, b.grabBlend); pose.tweak = L(a.tweak, b.tweak);
  pose.lean = L(a.lean, b.lean); pose.twist = L(a.twist, b.twist); pose.armsOut = L(a.armsOut, b.armsOut);
  pose.flail = L(a.flail, b.flail); pose.look = L(a.look, b.look); pose.flex = L(a.flex, b.flex); pose.press = L(a.press, b.press);
  pose.extend = L(a.extend, b.extend); pose.wave = L(a.wave, b.wave);
  const g = k < 0.5 ? a.grab : b.grab;
  pose.grab = g >= 0 ? GRAB_IDS[g] : null;
  pose.time = t;
  return k < 0.5 ? a : b;
}
