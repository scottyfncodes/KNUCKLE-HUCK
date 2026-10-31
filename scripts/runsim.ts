import { RunSim } from '../src/game/run';
import { effectiveStats, DEFAULT_LOADOUT } from '../src/data/gear';
const st = effectiveStats(DEFAULT_LOADOUT);
for (const tuck of [-1, 0, 1]) for (const rel of [84, 86.5, 89]) {
  const s = new RunSim(st.board, st.response, { wind: 0, snowSpeed: 1 });
  s.drop();
  const inp: any = { x: 0, y: 0, pop: false, grab: null, tweak: 0, switchStance: false, pause: false, retry: false, confirm: false, source: 'keys' };
  let deck = 0, log = '';
  for (let i = 0; i < 120 * 25 && s.phase !== 'done'; i++) {
    const z = s.phys.pos.z;
    inp.y = s.phase === 'ride' ? (z < 64 ? tuck : 0) : 0;
    inp.pop = s.phase === 'ride' && z > rel - 5 && z < rel;
    if (!deck && z > 64) deck = s.phys.speed;
    s.step(1 / 120, inp);
    for (const e of s.events.splice(0)) log += e.type + (e.type === 'pop' ? ':' + (e as any).pop.timing : '') + (e.type==='land'? ':'+(e as any).landing.grade+'/'+(e as any).landing.zone+'/'+(e as any).landing.impact.toFixed(1):'') + ' ';
  }
  console.log(`tuck ${tuck} rel ${rel} deck ${(deck * 3.6).toFixed(0)}kmh -> ${log} | air ${s.tricks.airTime.toFixed(2)} h ${s.result.height.toFixed(1)} ${s.result.reason}`);
}
