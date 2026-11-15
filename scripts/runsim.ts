/** Headless balance check: sweeps approach speed, hop timing and huck timing and prints the outcome of each run. */
import { RunSim } from '../src/game/run';
import { effectiveStats, DEFAULT_LOADOUT } from '../src/data/gear';
import { newSessionMemory, scoreRun } from '../src/scoring/scoring';
const st = effectiveStats(DEFAULT_LOADOUT);
let bad = 0;
for (const dt of [1 / 120, 0.4 / 120])
for (const tuck of [0, 1]) for (const hopAt of [0, 68, 71, 74, 75.4]) for (const rel of [84, 86.5, 89]) for (const spin of [0, 1]) {
  if (spin && !hopAt) continue;
  const s = new RunSim(st.board, st.response, { wind: 0, snowSpeed: 1 });
  s.drop();
  const inp: any = { x: 0, y: 0, pop: false, grab: null, tweak: 0, switchStance: false, pause: false, retry: false, confirm: false, source: 'keys' };
  let log = '';
  for (let i = 0; i < 120 * 60 && s.phase !== 'done'; i++) {
    const z = s.phys.pos.z;
    const deck = z > 63 && z < 97 && (s.phase === 'ride' || s.hopAir);
    inp.y = s.phase === 'ride' ? (z < 60 ? tuck : 0) : 0;
    inp.x = s.hopAir && spin ? 1 : 0;
    inp.pop = (s.phase === "ride" || s.hopAir) && ((hopAt > 0 && z > hopAt && z < hopAt + 0.6) || (z > Math.max(rel - 6, hopAt + 1.5) && (z < rel || (s.hopAir || s.phys.loadTime < 0.03))));
    s.step(deck ? dt : 1 / 120, inp);
    for (const e of s.events.splice(0)) {
      const a = e as any;
      log += e.type + (e.type === 'pop' ? `:${a.pop.timing}/c${a.pop.charge.toFixed(2)}` : e.type === 'hopoff' ? `:${a.hop.timing}` : e.type === 'hop' ? `@${z.toFixed(1)}${a.spin ? '/180' : ''}` : e.type === 'land' ? `:${a.landing.grade}/${a.landing.zone}/${a.landing.impact.toFixed(1)}` : e.type === 'crash' ? `:${a.reason}` : '') + ' ';
    }
  }
  const r = s.result;
  const sc = r.trick && r.landing ? scoreRun(r.trick, r.landing, r.pop, r.height, newSessionMemory(), 10) : null;
  if (r.crashed) bad++;
  console.log(`${dt < 0.005 ? 'slow' : 'full'} tuck ${tuck} hop ${hopAt} rel ${rel}${spin ? ' spin' : ''} -> ${log}| air ${s.tricks.airTime.toFixed(2)}s h ${r.height.toFixed(1)}m ${r.trick?.name ?? ''} = ${sc?.total ?? 0}`);
}
console.log(bad ? `${bad} runs crashed` : 'no crashes');
