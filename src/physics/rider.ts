/**
 * Rider physics. Physics-informed arcade model, independent of rendering.
 *
 * Grounded: the rider is a point that follows the snow surface with a heading
 * (carving) and a speed along that heading. Gravity along the slope, snow
 * friction, carve scrub and air drag shape speed. Every step we test whether a
 * ballistic path would leave the surface — on the convex knuckle at speed it
 * does, so the rider can genuinely get launched (or scrape) without popping.
 *
 * Pop: releasing the load adds an impulse along the surface normal, scaled by
 * charge and by how close to the knuckle crest the rider is. Pop early on the
 * flat deck and you go up but not out; pop late on the rollover and the normal
 * already points down the landing — less amplitude.
 */
import { COURSE, groundNormal, groundY, halfWidth, slopeAt } from './course';

export const PHYS = {
  g: 9.81,
  airGravity: 9.0,      // a touch floaty, for hang time
  mu: 0.035,            // snow friction
  drag: 0.0028,         // air drag coefficient (per metre)
  turnRate: 1.9,        // rad/s at full steer
  maxHeading: 1.05,     // rad
  carveScrub: 0.9,      // speed scrub from turning
  pressScrub: 0.25,
  popBase: 5.6,         // m/s pop impulse at full charge
  chargeTime: 0.42,     // s to full load
  suction: 0.06,        // m: small gaps snap back to the snow
  minAirForTrick: 0.35, // s
};

export interface Vec3 { x: number; y: number; z: number }

export type PopTiming = 'perfect' | 'good' | 'early' | 'late' | 'way-early' | 'way-late' | 'none';

export interface PopResult {
  timing: PopTiming;
  /** signed metres from ideal (negative = early) */
  offset: number;
  charge: number;
  quality: number; // 0..1
  press: 'none' | 'nose' | 'tail';
}

export interface BoardStats {
  pop: number;        // 0.8 .. 1.25 multiplier
  flex: number;       // 0..1 (soft..stiff) — soft is easier to load, stiff holds speed
  stability: number;  // 0..1 — less speed wobble, better high-speed landings
  spin: number;       // 0.8 .. 1.25 rotation responsiveness
  forgiveness: number;// 0..1
}

export interface GroundInput {
  steer: number;    // -1..1
  press: number;    // -1 (tail) .. 1 (nose)
  load: boolean;    // pop button held
}

export interface Conditions {
  wind: number;     // lateral m/s² (positive pushes +x)
  snowSpeed: number;// friction multiplier (1 = normal, <1 = fast snow)
}

export interface LandingContact {
  impact: number;          // normal velocity into the surface (m/s)
  normal: Vec3;
  tangentSpeed: number;
  zone: 'deck' | 'knuckle' | 'sweet' | 'flat' | 'side';
  z: number;
  x: number;
}

const tmpN: Vec3 = { x: 0, y: 1, z: 0 };

export class RiderPhysics {
  pos: Vec3 = { x: 0, y: 0, z: 0 };
  vel: Vec3 = { x: 0, y: 0, z: 0 };
  heading = 0;      // rad, 0 = straight down the fall line (+z)
  speed = 0;        // m/s along heading (grounded)
  grounded = true;
  airTime = 0;
  charge = 0;
  loading = false;
  loadTime = 0;
  turnRate = 0;
  press = 0;
  maxHeightAboveGround = 0;
  takeoffY = 0;
  apexReached = false;
  apexTime = 0;
  lastPop: PopResult | null = null;
  cond: Conditions = { wind: 0, snowSpeed: 1 };
  stats: BoardStats = { pop: 1, flex: 0.5, stability: 0.5, spin: 1, forgiveness: 0.5 };
  /** Set the moment we go airborne */
  onTakeoff: ((popped: boolean) => void) | null = null;
  onLand: ((c: LandingContact) => void) | null = null;

  reset(x = 0) {
    this.pos = { x, y: groundY(x, COURSE.startZ), z: COURSE.startZ };
    this.vel = { x: 0, y: 0, z: 0 };
    this.heading = 0;
    this.speed = 2.2; // a little push off the start
    this.grounded = true;
    this.airTime = 0;
    this.charge = 0;
    this.loading = false;
    this.loadTime = 0;
    this.turnRate = 0;
    this.press = 0;
    this.maxHeightAboveGround = 0;
    this.apexReached = false;
    this.apexTime = 0;
    this.lastPop = null;
  }

  /** Signed slope along current heading. */
  private slopeAlongHeading() {
    const e = 0.2;
    const sx = Math.sin(this.heading), cz = Math.cos(this.heading);
    const y1 = groundY(this.pos.x + sx * e, this.pos.z + cz * e);
    const y0 = groundY(this.pos.x - sx * e, this.pos.z - cz * e);
    return (y1 - y0) / (2 * e);
  }

  stepGround(dt: number, inp: GroundInput) {
    const P = PHYS;
    // Steering with a light self-centering assist toward the fall line
    const targetTurn = inp.steer * P.turnRate * (0.75 + 0.25 * this.stats.spin);
    this.turnRate += (targetTurn - this.turnRate) * Math.min(1, dt * 10);
    this.heading += this.turnRate * dt;
    if (Math.abs(inp.steer) < 0.05) this.heading -= this.heading * Math.min(1, dt * 0.6);
    this.heading = Math.max(-P.maxHeading, Math.min(P.maxHeading, this.heading));

    this.press += (inp.press - this.press) * Math.min(1, dt * 8);

    const s = this.slopeAlongHeading();
    const cosA = 1 / Math.sqrt(1 + s * s);
    const sinA = s * cosA;
    let a = -P.g * sinA;
    a -= P.mu * this.cond.snowSpeed * P.g * cosA * Math.sign(this.speed);
    a -= P.drag * this.speed * Math.abs(this.speed) * (1 - 0.15 * this.stats.flex);
    a -= Math.abs(this.turnRate) * P.carveScrub * Math.max(0, this.speed) * 0.12;
    a -= Math.abs(this.press) * P.pressScrub;
    this.speed = Math.max(0.6, this.speed + a * dt);

    // Lateral slope pushes you off a shoulder
    const lat = (groundY(this.pos.x + 0.2, this.pos.z) - groundY(this.pos.x - 0.2, this.pos.z)) / 0.4;
    const latA = -P.g * lat * 0.6 + this.cond.wind;

    const hs = this.speed * cosA; // horizontal speed
    const vx = Math.sin(this.heading) * hs + latA * dt * 6;
    const vz = Math.cos(this.heading) * hs;

    // Loading
    if (inp.load) {
      if (!this.loading) { this.loading = true; this.loadTime = 0; }
      this.loadTime += dt;
      const ct = P.chargeTime * (0.8 + 0.4 * this.stats.flex);
      this.charge = Math.min(1, this.loadTime / ct);
      // Overloading too long makes you stiff — slight decay after 1.4s
      if (this.loadTime > 1.4) this.charge = Math.max(0.7, 1 - (this.loadTime - 1.4) * 0.25);
    }

    // Ballistic candidate: would we leave the surface this step?
    const yPrev = this.pos.y;
    const nx = this.pos.x + vx * dt;
    const nz = this.pos.z + vz * dt;
    const gy = groundY(nx, nz);
    const vyGround = (gy - yPrev) / dt;
    const vyBallistic = this.vel.y - P.g * dt;
    const yBallistic = yPrev + vyBallistic * dt;

    this.vel.x = vx; this.vel.z = vz;

    if (yBallistic > gy + P.suction && this.vel.y > vyGround) {
      // The snow falls away faster than gravity can pull us down: natural air.
      this.pos.x = nx; this.pos.z = nz; this.pos.y = yBallistic;
      this.vel.y = vyBallistic;
      this.takeoff(false);
      return;
    }
    this.pos.x = nx; this.pos.z = nz; this.pos.y = gy;
    this.vel.y = vyGround;

    if (this.loading && !inp.load) {
      this.loading = false;
      this.pop();
    }
  }

  /** Evaluate pop timing relative to the knuckle crest. */
  evaluatePopTiming(): PopResult {
    const z = this.pos.z;
    const off = z - COURSE.knuckleZ;
    const ad = Math.abs(off);
    let timing: PopTiming;
    if (z < COURSE.deckStartZ - 6 || z > COURSE.landingStartZ + 4) timing = 'none';
    else if (ad <= 1.6) timing = 'perfect';
    else if (ad <= 3.6) timing = 'good';
    else if (off < 0) timing = ad <= 8 ? 'early' : 'way-early';
    else timing = ad <= 7 ? 'late' : 'way-late';
    const quality = timing === 'none' ? 0 : Math.max(0, 1 - ad / 9);
    const press: PopResult['press'] = this.press > 0.45 ? 'nose' : this.press < -0.45 ? 'tail' : 'none';
    return { timing, offset: off, charge: this.charge, quality, press };
  }

  pop() {
    const res = this.evaluatePopTiming();
    const n = groundNormal(this.pos.x, this.pos.z, tmpN);
    const timingMult = res.timing === 'perfect' ? 1.12 : res.timing === 'good' ? 1.0 : res.timing === 'none' ? 0.7 : 0.88;
    const pressMult = res.press === 'tail' ? 1.06 : res.press === 'nose' ? 0.98 : 1;
    const v = PHYS.popBase * this.stats.pop * (0.3 + 0.7 * this.charge) * timingMult * pressMult;
    this.vel.x += n.x * v;
    this.vel.y += n.y * v;
    this.vel.z += n.z * v;
    // Perfect pops carry speed off the lip
    if (res.timing === 'perfect') {
      const hs = Math.hypot(this.vel.x, this.vel.z);
      const k = (hs + 0.6) / hs;
      this.vel.x *= k; this.vel.z *= k;
    }
    this.pos.y += 0.02;
    this.lastPop = res;
    this.charge = 0;
    this.takeoff(true);
  }

  private takeoff(popped: boolean) {
    this.grounded = false;
    this.airTime = 0;
    this.takeoffY = this.pos.y;
    this.maxHeightAboveGround = 0;
    this.apexReached = false;
    this.apexTime = 0;
    this.loading = false;
    if (!popped) this.lastPop = null;
    this.onTakeoff?.(popped);
  }

  stepAir(dt: number) {
    const P = PHYS;
    this.airTime += dt;
    const prevVy = this.vel.y;
    this.vel.y -= P.airGravity * dt;
    const sp = Math.hypot(this.vel.x, this.vel.y, this.vel.z);
    const d = P.drag * 0.7 * sp;
    this.vel.x -= this.vel.x * d * dt;
    this.vel.z -= this.vel.z * d * dt;
    this.vel.x += this.cond.wind * dt;
    if (!this.apexReached && prevVy > 0 && this.vel.y <= 0) { this.apexReached = true; this.apexTime = this.airTime; }
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;
    const gy = groundY(this.pos.x, this.pos.z);
    const hag = this.pos.y - gy;
    // Height above the knuckle crest line is a fair amplitude measure
    if (hag > this.maxHeightAboveGround) this.maxHeightAboveGround = hag;
    if (hag <= 0) {
      this.pos.y = gy;
      return this.touchdown();
    }
    return null;
  }

  /** Computes contact, converts to ground motion. Caller decides crash/clean. */
  private touchdown(): LandingContact {
    const n = groundNormal(this.pos.x, this.pos.z, { x: 0, y: 1, z: 0 });
    const vn = this.vel.x * n.x + this.vel.y * n.y + this.vel.z * n.z;
    const impact = Math.max(0, -vn);
    const tx = this.vel.x - n.x * vn, ty = this.vel.y - n.y * vn, tz = this.vel.z - n.z * vn;
    const tangentSpeed = Math.hypot(tx, ty, tz);
    const z = this.pos.z, x = this.pos.x;
    let zone: LandingContact['zone'];
    if (Math.abs(x) > halfWidthSafe(z)) zone = 'side';
    else if (z < COURSE.knuckleZ - 1) zone = 'deck';
    else if (z < COURSE.landingStartZ + 1.5) zone = 'knuckle';
    else if (z < COURSE.landingEndZ + 3) zone = 'sweet';
    else zone = 'flat';
    this.grounded = true;
    this.heading = Math.atan2(tx, tz);
    this.heading = Math.max(-PHYS.maxHeading, Math.min(PHYS.maxHeading, this.heading));
    // Absorb part of the impact
    this.speed = tangentSpeed * (0.94 - Math.min(0.25, impact * 0.012));
    this.vel.y = ty;
    const c = { impact, normal: n, tangentSpeed, zone, z, x };
    this.onLand?.(c);
    return c;
  }
}

function halfWidthSafe(z: number) { return halfWidth(z) + 0.4; }

export { slopeAt };
