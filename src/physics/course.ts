/**
 * The venue's jump profile. Pure math, no rendering.
 *
 * World axes: +Z is downhill (the direction of travel), +Y is up, X is lateral.
 * The course is described by a slope function dh/dz built from key points that
 * are interpolated smoothly, then integrated into a height table. Because the
 * slope is continuous, curvature is finite everywhere — which is what lets the
 * knuckle act as a real, physical rollover instead of a scripted launch line.
 */

export interface SlopeKey { z: number; s: number }

// Slope key points (z in metres, s = dh/dz). Tuned with scripts/sim.ts.
export const SLOPE_KEYS: SlopeKey[] = [
  { z: -20, s: 0 },
  { z: 2, s: 0 },      // start deck on the tower
  { z: 9, s: -0.34 },  // drop-in
  { z: 50, s: -0.34 }, // in-run
  { z: 68, s: 0.03 },  // takeoff transition (concave) into the deck
  { z: 79, s: 0.0 },   // the deck / table
  { z: 84, s: -0.06 }, // knuckle crest begins
  { z: 97, s: -0.72 }, // rounded knuckle rollover (convex)
  { z: 140, s: -0.72 },// landing
  { z: 160, s: 0.0 },  // landing transition (concave)
  { z: 235, s: 0.0 },  // outrun
  { z: 275, s: 0.1 },  // run-out berm
  { z: 320, s: 0.2 },
];

export const COURSE = {
  zMin: -20,
  zMax: 320,
  startZ: 1.5,
  /** Ideal pop point: the top of the knuckle where the deck starts rolling over. */
  knuckleZ: 86.5,
  deckStartZ: 70,
  landingStartZ: 97,
  landingEndZ: 146,
  outrunZ: 162,
  /** Where the run ends if you just ride out. */
  finishZ: 215,
};

const RES = 0.1;
const N = Math.ceil((COURSE.zMax - COURSE.zMin) / RES) + 1;
const heights = new Float32Array(N);

function smoothstep(t: number) { return t * t * (3 - 2 * t); }

export function slopeAt(z: number): number {
  const k = SLOPE_KEYS;
  if (z <= k[0].z) return k[0].s;
  for (let i = 0; i < k.length - 1; i++) {
    const a = k[i], b = k[i + 1];
    if (z <= b.z) {
      const t = (z - a.z) / (b.z - a.z);
      return a.s + (b.s - a.s) * smoothstep(t);
    }
  }
  return k[k.length - 1].s;
}

(function build() {
  let h = 0;
  heights[0] = 0;
  for (let i = 1; i < N; i++) {
    const z0 = COURSE.zMin + (i - 1) * RES;
    // midpoint integration
    h += slopeAt(z0 + RES * 0.5) * RES;
    heights[i] = h;
  }
  // Offset so the outrun sits at y = 0
  const iOut = Math.round((COURSE.outrunZ + 10 - COURSE.zMin) / RES);
  const off = heights[iOut];
  for (let i = 0; i < N; i++) heights[i] -= off;
})();

/** Height of the course centreline profile at z. */
export function profileY(z: number): number {
  const f = (z - COURSE.zMin) / RES;
  if (f <= 0) return heights[0];
  if (f >= N - 1) return heights[N - 1] + (z - COURSE.zMax) * SLOPE_KEYS[SLOPE_KEYS.length - 1].s;
  const i = Math.floor(f);
  const t = f - i;
  return heights[i] * (1 - t) + heights[i + 1] * t;
}

function lerpKeys(keys: [number, number][], z: number): number {
  if (z <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (z <= b[0]) {
      const t = (z - a[0]) / (b[0] - a[0]);
      return a[1] + (b[1] - a[1]) * smoothstep(t);
    }
  }
  return keys[keys.length - 1][1];
}

// Half-width of the groomed, rideable feature.
const HALF_W: [number, number][] = [
  [-20, 3.2], [3, 3.2], [12, 4.5], [50, 5.5], [70, 9], [80, 10.5], [97, 12], [146, 14], [166, 24], [320, 30],
];
// How far the side terrain sits below the feature (the jump is built up out of snow).
const SIDE_DEPTH: [number, number][] = [
  [-20, 9], [3, 9], [14, 4], [48, 2.5], [70, 6], [84, 8], [100, 6], [130, 3], [152, 1], [166, 0], [320, 0],
];

export function halfWidth(z: number) { return lerpKeys(HALF_W, z); }
export function sideDepth(z: number) { return lerpKeys(SIDE_DEPTH, z); }

/** Snow height anywhere in the venue. */
export function groundY(x: number, z: number): number {
  const h = profileY(z);
  const hw = halfWidth(z);
  const ax = Math.abs(x);
  if (ax <= hw) return h;
  const over = ax - hw;
  // Rounded shoulder, then a steep built-up wall down to the natural terrain.
  const shoulder = over < 1.2 ? (over * over) / 2.4 * 0.9 : 0.54 + (over - 1.2) * 1.35;
  const wall = h - shoulder;
  const floor = h - sideDepth(z) - Math.max(0, over - 14) * 0.05;
  let y = Math.max(wall, floor);
  // Outrun spectator banks rise up on the sides.
  if (z > 152) {
    const bank = Math.max(0, ax - 32) * 0.35 * Math.min(1, (z - 152) / 20);
    y = Math.max(y, h + bank);
  }
  return y;
}

/** Surface normal (not normalised by callers — returned unit length). */
export function groundNormal(x: number, z: number, out: { x: number; y: number; z: number }) {
  const e = 0.15;
  const dx = (groundY(x + e, z) - groundY(x - e, z)) / (2 * e);
  const dz = (groundY(x, z + e) - groundY(x, z - e)) / (2 * e);
  const l = Math.hypot(dx, 1, dz);
  out.x = -dx / l; out.y = 1 / l; out.z = -dz / l;
  return out;
}

export function isOnFeature(x: number, z: number) {
  return Math.abs(x) <= halfWidth(z) + 0.6;
}

export type Zone = 'inrun' | 'deck' | 'knuckle' | 'landing' | 'flat' | 'side';
export function zoneAt(x: number, z: number): Zone {
  if (!isOnFeature(x, z)) return 'side';
  if (z < COURSE.deckStartZ) return 'inrun';
  if (z < COURSE.knuckleZ - 1) return 'deck';
  if (z < COURSE.landingStartZ + 2) return 'knuckle';
  if (z < COURSE.landingEndZ + 4) return 'landing';
  return 'flat';
}
