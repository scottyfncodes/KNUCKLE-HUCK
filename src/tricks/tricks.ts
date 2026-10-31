/**
 * Trick controller: modular rotation + grab + tweak state that drives the
 * rider's real orientation and pose. Nothing here is a canned animation —
 * spin/flip angles are integrated from input, grabs are hand targets on the
 * board, tweaks are board offsets relative to the body.
 */

export type GrabId = 'indy' | 'mute' | 'melon' | 'method' | 'stalefish' | 'nose' | 'tail';

export const GRABS: { id: GrabId; name: string; key: string; hint: string }[] = [
  { id: 'nose', name: 'Nose', key: 'I', hint: 'front hand, nose' },
  { id: 'mute', name: 'Mute', key: 'U', hint: 'front hand, toe edge' },
  { id: 'indy', name: 'Indy', key: 'J', hint: 'back hand, toe edge' },
  { id: 'tail', name: 'Tail', key: 'K', hint: 'back hand, tail' },
  { id: 'stalefish', name: 'Stalefish', key: 'L', hint: 'back hand, heel edge' },
  { id: 'melon', name: 'Melon', key: 'O', hint: 'front hand, heel edge' },
  { id: 'method', name: 'Method', key: 'P', hint: 'front hand, heel, board up' },
];

export const GRAB_NAME: Record<GrabId, string> = Object.fromEntries(GRABS.map(g => [g.id, g.name])) as Record<GrabId, string>;

export interface AirInput {
  spin: number;   // -1..1 (left = +)
  flip: number;   // -1..1 (up = frontflip +)
  grab: GrabId | null;
  tweak: number;  // 0..1
}

export interface GrabRecord { id: GrabId; start: number; duration: number; tweakMax: number; tweakSum: number }

export interface RotationStats { spin: number; response: number }

export interface TrickSummary {
  name: string;
  spinDeg: number;      // rounded to 180s
  spinRaw: number;
  flips: number;
  flipRaw: number;
  direction: 'frontside' | 'backside' | 'none';
  flipDir: 'back' | 'front' | 'none';
  offAxis: boolean;
  switchTakeoff: boolean;
  late: boolean;
  grabs: GrabRecord[];  // only counted grabs (>= 0.2s)
  maxTweak: number;
  pressPop: 'none' | 'nose' | 'tail';
  butter: boolean;
  airTime: number;
  signature: string;    // used for repetition detection
}

const SPIN_MAX = 600;   // deg/s
const FLIP_MAX = 470;   // deg/s
const SPIN_COMMIT = 300;
const FLIP_COMMIT = 330;

function nearestMult(v: number, m: number) { return Math.round(v / m) * m; }

export class TrickController {
  spin = 0; spinRate = 0;
  flip = 0; flipRate = 0;
  grab: GrabId | null = null;
  tweak = 0;
  grabs: GrabRecord[] = [];
  airTime = 0;
  switchTakeoff = false;
  travelSign = 1;
  spinStart = -1;
  flipStart = -1;
  apexTime = -1;
  pressPop: 'none' | 'nose' | 'tail' = 'none';
  butter = false;
  /** seconds since the player was last rotating or grabbing */
  neutralTime = 0;
  stats: RotationStats = { spin: 1, response: 1 };
  /** Latest pose blend for grabs (0..1), smoothed for animation */
  grabBlend = 0;
  shownGrab: GrabId | null = null;

  begin(switchStance: boolean, press: 'none' | 'nose' | 'tail', butter = false) {
    this.butter = butter;
    this.spin = 0; this.spinRate = 0; this.flip = 0; this.flipRate = 0;
    this.grab = null; this.tweak = 0; this.grabs = [];
    this.airTime = 0; this.switchTakeoff = switchStance; this.travelSign = switchStance ? -1 : 1;
    this.spinStart = -1; this.flipStart = -1; this.apexTime = -1;
    this.pressPop = press; this.neutralTime = 0; this.grabBlend = 0; this.shownGrab = null;
  }

  step(dt: number, inp: AirInput, apexReached: boolean) {
    this.airTime += dt;
    if (apexReached && this.apexTime < 0) this.apexTime = this.airTime;
    const resp = 7 * this.stats.response;

    // --- Spin ---
    const spinMax = SPIN_MAX * this.stats.spin;
    if (Math.abs(inp.spin) > 0.15) {
      const target = inp.spin * spinMax;
      this.spinRate += (target - this.spinRate) * Math.min(1, dt * resp);
      if (this.spinStart < 0 && Math.abs(this.spin) > 15) this.spinStart = this.airTime;
    } else {
      this.spinRate = this.commit(this.spin, this.spinRate, 180, SPIN_COMMIT * this.stats.spin, dt, resp);
    }
    const prevSpin = this.spin;
    this.spin += this.spinRate * dt;
    if (Math.abs(inp.spin) <= 0.15) this.spin = this.snapIfCrossed(prevSpin, this.spin, 180, 'spin');
    if (this.spinStart < 0 && Math.abs(this.spin) > 15) this.spinStart = this.airTime;

    // --- Flip ---
    if (Math.abs(inp.flip) > 0.2) {
      const target = inp.flip * FLIP_MAX * (0.9 + 0.1 * this.stats.spin);
      this.flipRate += (target - this.flipRate) * Math.min(1, dt * resp * 0.8);
    } else {
      this.flipRate = this.commit(this.flip, this.flipRate, 360, FLIP_COMMIT, dt, resp);
    }
    const prevFlip = this.flip;
    this.flip += this.flipRate * dt;
    if (Math.abs(inp.flip) <= 0.2) this.flip = this.snapIfCrossed(prevFlip, this.flip, 360, 'flip');
    if (this.flipStart < 0 && Math.abs(this.flip) > 20) this.flipStart = this.airTime;

    // --- Grabs ---
    if (inp.grab !== this.grab) {
      this.grab = inp.grab;
      if (inp.grab) this.grabs.push({ id: inp.grab, start: this.airTime, duration: 0, tweakMax: 0, tweakSum: 0 });
    }
    if (this.grab) {
      const g = this.grabs[this.grabs.length - 1];
      g.duration += dt;
      g.tweakMax = Math.max(g.tweakMax, inp.tweak);
      g.tweakSum += inp.tweak * dt;
      this.shownGrab = this.grab;
    }
    this.tweak += ((this.grab ? inp.tweak : 0) - this.tweak) * Math.min(1, dt * 9);
    this.grabBlend += ((this.grab ? 1 : 0) - this.grabBlend) * Math.min(1, dt * 14);

    const rotating = Math.abs(this.spinRate) > 30 || Math.abs(this.flipRate) > 30;
    if (rotating || this.grab) this.neutralTime = 0; else this.neutralTime += dt;
  }

  /** Arcade assist: when input is released, finish the rotation to the next clean angle. */
  private commit(angle: number, rate: number, mult: number, minRate: number, dt: number, resp: number) {
    const rem = angle - nearestMult(angle, mult);
    if (Math.abs(rem) < 2 && Math.abs(rate) < minRate * 1.2) return 0;
    if (Math.abs(rate) < 5 && Math.abs(rem) < mult * 0.5) {
      // nudge toward nearest
      return -Math.sign(rem) * minRate * 0.6;
    }
    const dir = Math.sign(rate) || -Math.sign(rem) || 1;
    const target = dir * Math.max(minRate, Math.min(Math.abs(rate), minRate * 1.4));
    return rate + (target - rate) * Math.min(1, dt * resp * 0.6);
  }

  private snapIfCrossed(prev: number, cur: number, mult: number, which: 'spin' | 'flip') {
    const a = Math.floor(prev / mult), b = Math.floor(cur / mult);
    const near = nearestMult(cur, mult);
    if (a !== b || Math.abs(cur - near) < 1.5) {
      if (Math.abs(cur - near) < 12) {
        if (which === 'spin') this.spinRate = 0; else this.flipRate = 0;
        return near;
      }
    }
    return cur;
  }

  /** Errors (deg) from a clean landing orientation. */
  landingErrors() {
    const yawErr = Math.abs(this.spin - nearestMult(this.spin, 180));
    const flipErr = Math.abs(this.flip - nearestMult(this.flip, 360));
    return { yawErr, flipErr };
  }

  /** True if the rider will ride away switch relative to takeoff. */
  landsSwitch() {
    return Math.round(Math.abs(this.spin) / 180) % 2 === 1;
  }

  summary(): TrickSummary {
    const spinDeg = Math.round(Math.abs(this.spin) / 180) * 180;
    const flips = Math.round(Math.abs(this.flip) / 360);
    const fullFlipish = Math.abs(this.flip) > 270 ? Math.max(1, flips) : flips;
    const direction = spinDeg >= 180 ? (this.spin * this.travelSign > 0 ? 'frontside' : 'backside') : 'none';
    const flipDir = fullFlipish > 0 ? (this.flip > 0 ? 'front' : 'back') : 'none';
    const grabs = this.grabs.filter(g => g.duration >= 0.2);
    // merge consecutive same grabs
    const merged: GrabRecord[] = [];
    for (const g of grabs) {
      const last = merged[merged.length - 1];
      if (last && last.id === g.id) { last.duration += g.duration; last.tweakMax = Math.max(last.tweakMax, g.tweakMax); last.tweakSum += g.tweakSum; }
      else merged.push({ ...g });
    }
    const maxTweak = merged.reduce((m, g) => Math.max(m, g.tweakMax), 0);
    const late = (this.spinStart >= 0 && this.apexTime >= 0 && this.spinStart > this.apexTime && spinDeg >= 180)
      || (this.flipStart >= 0 && this.apexTime >= 0 && this.flipStart > this.apexTime && fullFlipish > 0);
    const offAxis = fullFlipish > 0 && spinDeg >= 180;
    const name = nameTrick({
      spinDeg, flips: fullFlipish, direction, flipDir, offAxis,
      switchTakeoff: this.switchTakeoff, late, grabs: merged, maxTweak, pressPop: this.pressPop, butter: this.butter,
    });
    const signature = `${this.switchTakeoff ? 'sw' : ''}${direction}${spinDeg}|${flipDir}${fullFlipish}|${merged.map(g => g.id).join('>')}`;
    return {
      name, spinDeg, spinRaw: this.spin, flips: fullFlipish, flipRaw: this.flip, direction, flipDir, offAxis,
      switchTakeoff: this.switchTakeoff, late, grabs: merged, maxTweak, pressPop: this.pressPop, butter: this.butter, airTime: this.airTime, signature,
    };
  }
}

const MULTI = ['', '', 'Double ', 'Triple ', 'Quad '];

export function nameTrick(t: {
  spinDeg: number; flips: number; direction: string; flipDir: string; offAxis: boolean;
  switchTakeoff: boolean; late: boolean; grabs: GrabRecord[]; maxTweak: number; pressPop: string; butter?: boolean;
}): string {
  const parts: string[] = [];
  if (t.butter) parts.push('Butter to');
  if (t.pressPop === 'nose') parts.push('Nollie');
  if (t.late) parts.push('Late');
  const fs = t.direction === 'frontside';
  let dirWord = '';
  if (t.spinDeg >= 180) {
    if (t.switchTakeoff) dirWord = fs ? 'Cab' : 'Switch Backside';
    else dirWord = fs ? 'Frontside' : 'Backside';
  } else if (t.switchTakeoff) dirWord = 'Switch';

  if (t.flips > 0 && t.spinDeg >= 180) {
    const multi = MULTI[Math.min(4, t.flips)];
    let kind: string;
    if (t.flipDir === 'front') kind = 'Misty';
    else kind = fs ? 'Rodeo' : 'Cork';
    parts.push(`${dirWord} ${multi}${kind} ${t.spinDeg}`.trim());
  } else if (t.flips > 0) {
    const multi = MULTI[Math.min(4, t.flips)];
    parts.push(`${dirWord ? dirWord + ' ' : ''}${multi}${t.flipDir === 'front' ? 'Frontflip' : 'Backflip'}`);
  } else if (t.spinDeg >= 180) {
    parts.push(`${dirWord} ${t.spinDeg}`);
  } else {
    parts.push(t.switchTakeoff ? 'Switch Straight Air' : t.grabs.length ? '' : 'Straight Air');
  }

  if (t.grabs.length) {
    const tweaked = t.maxTweak > 0.65;
    const names = t.grabs.map(g => GRAB_NAME[g.id]);
    let gs = names.slice(0, 3).join(' to ');
    if (names.length > 3) gs += ` +${names.length - 3}`;
    if (tweaked) gs = (t.grabs.length === 1 && t.grabs[0].id === 'method' ? 'Boned ' : 'Tweaked ') + gs;
    parts.push(gs);
  }
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}
