/** Third-person camera rig with approach, launch, mid-air, landing, crash and replay framings. */
import * as THREE from 'three';
import { COURSE, profileY } from '../physics/course';
import { visualY } from './environment';

export type CamMode = 'menu' | 'garage' | 'follow' | 'air' | 'land' | 'crash' | 'replay-follow' | 'replay-broadcast' | 'replay-landing' | 'replay-drone' | 'results';

export const REPLAY_ANGLES: { mode: CamMode; label: string }[] = [
  { mode: 'replay-broadcast', label: 'BROADCAST' },
  { mode: 'replay-follow', label: 'FOLLOW CAM' },
  { mode: 'replay-landing', label: 'LANDING CAM' },
  { mode: 'replay-drone', label: 'DRONE' },
];

const V = () => new THREE.Vector3();

export class CameraRig {
  cam: THREE.PerspectiveCamera;
  mode: CamMode = 'menu';
  private pos = V(); private look = V(); private anchor = V();
  private dir = new THREE.Vector3(0, 0, 1);
  private shakeAmt = 0;
  private t = 0;
  private fov = 60;
  private airSide = 1;
  private snap = true;

  constructor() {
    this.cam = new THREE.PerspectiveCamera(60, 1, 0.1, 5000);
    this.pos.set(20, profileY(100) + 10, 70);
    this.look.set(0, profileY(COURSE.knuckleZ), COURSE.knuckleZ);
  }

  setMode(m: CamMode, snap = false) {
    if (m === 'air' && this.mode !== 'air') this.airSide = Math.random() < 0.5 ? -1 : 1;
    this.mode = m;
    if (snap) this.snap = true;
  }
  shake(a: number) { this.shakeAmt = Math.max(this.shakeAmt, a); }
  resize(w: number, h: number) {
    this.cam.aspect = w / h;
    // Portrait phones get a wider view so the jump stays readable
    this.fov = this.cam.aspect < 0.8 ? 74 : this.cam.aspect < 1.2 ? 66 : 58;
    this.cam.updateProjectionMatrix();
  }

  update(dt: number, rider: THREE.Vector3, vel: THREE.Vector3, opts: { landing?: THREE.Vector3; airTime?: number; speed?: number } = {}) {
    this.t += dt;
    const hv = new THREE.Vector3(vel.x, 0, vel.z);
    if (hv.lengthSq() > 1) this.dir.lerp(hv.normalize(), 1 - Math.exp(-dt * 2.2)).normalize();
    const dir = this.dir;
    const side = new THREE.Vector3(dir.z, 0, -dir.x);
    const tp = V(), tl = V();
    let rate = 5, fovTarget = this.fov;
    const portrait = this.cam.aspect < 0.8;
    switch (this.mode) {
      case 'menu': {
        const a = this.t * 0.06;
        const c = new THREE.Vector3(0, profileY(COURSE.knuckleZ), COURSE.knuckleZ + 8);
        tp.set(c.x + Math.sin(a) * 34, c.y + 9 + Math.sin(a * 0.7) * 3, c.z - Math.cos(a) * 30);
        tl.copy(c).add(new THREE.Vector3(0, -3, 6));
        rate = 1.5; fovTarget = portrait ? 70 : 55;
        break;
      }
      case 'garage': {
        tp.copy(rider).add(portrait ? new THREE.Vector3(-1.8, 0.3, 4.4) : new THREE.Vector3(-1.5, 0.5, 3.6));
        tl.copy(rider).add(portrait ? new THREE.Vector3(0, -1.15, 0) : new THREE.Vector3(1.0, -0.3, 0));
        rate = 4; fovTarget = portrait ? 60 : 40;
        break;
      }
      case 'results': {
        tp.copy(rider).add(new THREE.Vector3(-4.5, 1.6, 5));
        tl.copy(rider).add(new THREE.Vector3(0, 0.6, 0));
        rate = 2; fovTarget = 50;
        break;
      }
      case 'follow': {
        const sp = opts.speed ?? 10;
        const back = 6.4 + sp * 0.08;
        tp.copy(rider).addScaledVector(dir, -back).add(new THREE.Vector3(0, 2.5 + sp * 0.03, 0));
        // keep above snow
        tl.copy(rider).addScaledVector(dir, 7).add(new THREE.Vector3(0, -0.2, 0));
        rate = 6; fovTarget = this.fov + Math.min(10, sp * 0.4);
        break;
      }
      case 'air': {
        const at = opts.airTime ?? 0;
        const k = Math.min(1, at / 0.7);
        const land = opts.landing ?? rider;
        tp.copy(rider).addScaledVector(dir, -7.5 + k * 1.5).addScaledVector(side, this.airSide * 4.5 * k).add(new THREE.Vector3(0, 2.6 + k * 1.2, 0));
        tl.copy(rider).lerp(land, 0.18 * k).add(new THREE.Vector3(0, 0.3, 0));
        rate = 3.6; fovTarget = this.fov + 4;
        break;
      }
      case 'land': {
        tp.copy(rider).addScaledVector(dir, -6.5).add(new THREE.Vector3(0, 2.2, 0)).addScaledVector(side, this.airSide * 1.5);
        tl.copy(rider).addScaledVector(dir, 4);
        rate = 3; fovTarget = this.fov + 2;
        break;
      }
      case 'crash': {
        tp.copy(rider).addScaledVector(dir, -8).add(new THREE.Vector3(0, 3.5, 0)).addScaledVector(side, 3);
        tl.copy(rider);
        rate = 2.2; fovTarget = this.fov;
        break;
      }
      case 'replay-follow': {
        tp.copy(rider).addScaledVector(dir, -5.5).add(new THREE.Vector3(0, 1.8, 0)).addScaledVector(side, 1.4);
        tl.copy(rider).addScaledVector(dir, 2);
        rate = 5; fovTarget = this.fov;
        break;
      }
      case 'replay-broadcast': {
        const x = 26, z = Math.min(Math.max(rider.z - 4, 40), 175);
        tp.set(x, visualY(x, z) + 6, z);
        tl.copy(rider);
        rate = 3; fovTarget = 30 + Math.min(20, Math.abs(rider.z - z) * 0.4);
        if (portrait) fovTarget += 14;
        break;
      }
      case 'replay-landing': {
        const z = COURSE.landingEndZ + 8, x = -7;
        tp.set(x, profileY(z) + 1.3, z);
        tl.copy(rider);
        rate = 8; fovTarget = rider.z < 60 ? 22 : 40 + Math.max(0, 50 - Math.abs(rider.z - z)) * 0.3;
        if (portrait) fovTarget += 14;
        break;
      }
      case 'replay-drone': {
        const a = this.t * 0.35;
        tp.copy(rider).add(new THREE.Vector3(Math.sin(a) * 9, 4.5, Math.cos(a) * 9));
        tl.copy(rider);
        rate = 4; fovTarget = this.fov;
        break;
      }
    }
    // keep camera above the snow
    const gy = visualY(tp.x, tp.z) + 0.8;
    if (tp.y < gy) tp.y = gy;

    const k = this.snap ? 1 : 1 - Math.exp(-dt * rate);
    const kl = this.snap ? 1 : 1 - Math.exp(-dt * rate * 1.6);
    this.snap = false;
    const relative = !(this.mode === 'menu' || this.mode === 'replay-broadcast' || this.mode === 'replay-landing');
    if (relative) {
      // Smooth the offset from the rider, not the absolute position: no lag at 60+ km/h.
      const curOff = this.pos.clone().sub(this.anchor);
      const curLook = this.look.clone().sub(this.anchor);
      curOff.lerp(tp.clone().sub(rider), k);
      curLook.lerp(tl.clone().sub(rider), kl);
      this.pos.copy(rider).add(curOff);
      this.look.copy(rider).add(curLook);
    } else {
      this.pos.lerp(tp, k);
      this.look.lerp(tl, kl);
    }
    this.anchor.copy(rider);
    const gy2 = visualY(this.pos.x, this.pos.z) + 0.6;
    if (this.pos.y < gy2) this.pos.y = gy2;
    this.cam.fov += (fovTarget - this.cam.fov) * (1 - Math.exp(-dt * 3));
    this.cam.updateProjectionMatrix();

    this.cam.position.copy(this.pos);
    if (this.shakeAmt > 0.001) {
      const s = this.shakeAmt;
      this.cam.position.add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
      this.shakeAmt *= Math.exp(-dt * 7);
    }
    this.cam.lookAt(this.look);
  }
}
