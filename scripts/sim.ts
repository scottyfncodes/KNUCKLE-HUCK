import { RiderPhysics } from '../src/physics/rider';
import { COURSE, profileY } from '../src/physics/course';
const dt = 1/120;
console.log('profile: start', profileY(0).toFixed(1), 'deck', profileY(80).toFixed(1), 'knuckle', profileY(COURSE.knuckleZ).toFixed(1), 'landEnd', profileY(146).toFixed(1));
function run(popZ: number | null, scrub = 0) {
  const r = new RiderPhysics(); r.reset(0);
  let t = 0, holding = false, speedAtK = 0, res: any = null, tookoff = -1;
  while (t < 30) {
    t += dt;
    if (r.grounded) {
      const load = popZ !== null && r.pos.z > popZ - 6 && r.pos.z < popZ;
      if (r.pos.z > COURSE.knuckleZ - 1 && !speedAtK) speedAtK = r.speed;
      const steer = scrub && r.pos.z > 40 && r.pos.z < 80 ? (Math.sin(t*3)>0?1:-1)*scrub : 0;
      r.stepGround(dt, { steer, press: 0, load });
      if (!r.grounded) tookoff = r.pos.z;
    } else {
      const c = r.stepAir(dt);
      if (c && r.airTime > 0.3) { res = { ...c, air: r.airTime, h: r.maxHeightAboveGround, tookoff, t, pop: r.lastPop?.timing }; break; }
    }
  }
  return { speedAtK, res };
}
for (const scrub of [0, 0.5, 1]) for (const pz of [null, 76, 81, 84.5, 86.5, 88, 91, 94]) {
  const { speedAtK, res } = run(pz, scrub);
  console.log(`scrub ${scrub} pop@${pz} vK=${speedAtK.toFixed(1)} t=${res?.t.toFixed(1)} off=${res?.tookoff.toFixed(1)} ${res?.pop} air=${res?.air.toFixed(2)} h=${res?.h.toFixed(1)} landZ=${res?.z.toFixed(1)} ${res?.zone} impact=${res?.impact.toFixed(1)}`);
}
