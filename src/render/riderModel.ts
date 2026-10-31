/**
 * Procedural rider puppet. Joints are solved every frame (2-bone IK for legs
 * to the bindings and for arms to grab points on the board), then limb meshes
 * are stretched between joints. Grabs and tweaks therefore genuinely change
 * the silhouette: the board is rotated about the rider's centre of mass and
 * the body follows it.
 *
 * Local frame (= board frame): +X nose, +Y up, +Z toe side (the rider faces +Z).
 */
import * as THREE from 'three';
import type { GrabId } from '../tricks/tricks';
import { boardById, itemById, type Loadout } from '../data/gear';
import { boardTexture, clothTexture, shade, toonRamp } from './textures';

export interface RiderPose {
  crouch: number;     // 0..1
  lean: number;       // -1 heel .. 1 toe (carve)
  twist: number;      // upper-body twist (rad)
  grab: GrabId | null;
  grabBlend: number;
  tweak: number;
  armsOut: number;    // balance arms
  flail: number;      // crash
  time: number;
  look: number;       // head yaw toward nose (rad)
  flex: number;       // board flex -1..1 (+ = loaded)
  press: number;      // -1 tail .. 1 nose
  extend: number;     // landing prep 0..1
  wave: number;       // celebration arm wave 0..1
}

export function defaultPose(): RiderPose {
  return { crouch: 0.25, lean: 0, twist: 0, grab: null, grabBlend: 0, tweak: 0, armsOut: 0.3, flail: 0, time: 0, look: 1.2, flex: 0, press: 0, extend: 0, wave: 0 };
}

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

const THIGH = 0.46, SHIN = 0.45, UPPER_ARM = 0.33, FOREARM = 0.33;
const BOARD_LEN = 1.56;
const STANCE = 0.27;

/** Where each grab puts which hand, in board-local coords (before tweak). */
const GRAB_TARGET: Record<GrabId, { hand: 'front' | 'rear'; p: [number, number, number] }> = {
  indy: { hand: 'rear', p: [-0.02, 0.05, 0.13] },
  mute: { hand: 'front', p: [0.08, 0.05, 0.13] },
  melon: { hand: 'front', p: [0.05, 0.05, -0.13] },
  method: { hand: 'front', p: [0.02, 0.05, -0.13] },
  stalefish: { hand: 'rear', p: [-0.1, 0.05, -0.13] },
  nose: { hand: 'front', p: [0.72, 0.08, 0.0] },
  tail: { hand: 'rear', p: [-0.72, 0.08, 0.0] },
};
/** Board rotation relative to body: [roll about X, yaw about Y, pitch about Z] base and tweak extra */
const GRAB_TWEAK: Record<GrabId, { base: [number, number, number]; tweak: [number, number, number]; tuck: number; lean: number }> = {
  indy: { base: [-0.15, 0, 0], tweak: [-0.15, 0.45, -0.25], tuck: 0.95, lean: 0.25 },
  mute: { base: [-0.25, 0, -0.1], tweak: [-0.2, -0.3, -0.35], tuck: 0.95, lean: 0.35 },
  melon: { base: [0.3, 0, 0], tweak: [0.35, -0.45, 0.15], tuck: 0.85, lean: -0.1 },
  method: { base: [0.55, 0, 0.1], tweak: [0.75, 0.15, 0.25], tuck: 0.55, lean: -0.45 },
  stalefish: { base: [0.35, 0, -0.15], tweak: [0.35, 0.35, -0.3], tuck: 0.9, lean: -0.1 },
  nose: { base: [0, 0, 0.42], tweak: [0, 0.1, 0.4], tuck: 0.8, lean: 0.15 },
  tail: { base: [0, 0, -0.42], tweak: [0, -0.1, -0.4], tuck: 0.8, lean: 0.1 },
};

const outlineMat = new THREE.ShaderMaterial({
  uniforms: { t: { value: 0.014 } },
  vertexShader: 'uniform float t; void main(){ vec3 p = position + normal * t; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }',
  fragmentShader: 'void main(){ gl_FragColor = vec4(0.05,0.06,0.09,1.0); }',
  side: THREE.BackSide,
});

const ramp = toonRamp();
function toon(color: string | THREE.Color, map?: THREE.Texture) {
  return new THREE.MeshToonMaterial({ color, gradientMap: ramp, map: map ?? null });
}

class Limb {
  mesh: THREE.Mesh; outline: THREE.Mesh;
  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, outline = true) {
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = true;
    parent.add(this.mesh);
    this.outline = new THREE.Mesh(geo, outlineMat);
    this.outline.visible = outline;
    this.mesh.add(this.outline);
  }
  between(a: THREE.Vector3, b: THREE.Vector3, extra = 0) {
    const d = tmp.subVectors(b, a);
    const len = d.length();
    this.mesh.position.addVectors(a, b).multiplyScalar(0.5);
    if (len > 1e-5) this.mesh.quaternion.setFromUnitVectors(UP, d.multiplyScalar(1 / len));
    this.mesh.scale.set(1, len + extra, 1);
  }
}
const tmp = V();

function solveIK(root: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number, hint: THREE.Vector3, outMid: THREE.Vector3, outEnd: THREE.Vector3) {
  const d = tmp2.subVectors(target, root);
  let dist = d.length();
  const maxR = (l1 + l2) * 0.999;
  if (dist > maxR) { d.multiplyScalar(maxR / dist); dist = maxR; }
  if (dist < 0.05) { dist = 0.05; }
  outEnd.copy(root).add(d);
  const dir = d.clone().normalize();
  // law of cosines
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const bend = hint.clone().sub(dir.clone().multiplyScalar(hint.dot(dir))).normalize();
  outMid.copy(root).addScaledVector(dir, a).addScaledVector(bend, h);
}
const tmp2 = V();

export class RiderModel {
  root = new THREE.Group();
  boardPivot = new THREE.Group();
  boardGroup = new THREE.Group();
  body = new THREE.Group();
  private parts: Record<string, Limb> = {};
  private head = new THREE.Group();
  private boardTop!: THREE.Mesh; private boardBase!: THREE.Mesh; private boardEdge!: THREE.Mesh;
  private boardGeos: { geo: THREE.BufferGeometry; base: Float32Array }[] = [];
  private mats: Record<string, THREE.Material> = {};
  private accessories = new THREE.Group();
  private hood!: THREE.Mesh; private pack!: THREE.Mesh; private gaiter!: THREE.Mesh; private bandana!: THREE.Mesh; private tallTee!: Limb;
  private beanie!: THREE.Mesh; private pom!: THREE.Mesh;
  pose: RiderPose = defaultPose();
  /** World-space hand/foot points updated every frame (for effects). */
  readonly joints = { hipL: V(), hipR: V(), kneeL: V(), kneeR: V(), ankleL: V(), ankleR: V(), pelvis: V(), chest: V(), neck: V(), shL: V(), shR: V(), elL: V(), elR: V(), haL: V(), haR: V() };

  constructor(loadout: Loadout) {
    this.root.add(this.boardPivot);
    this.boardPivot.add(this.boardGroup);
    this.root.add(this.body);
    this.buildBoard();
    this.buildBody();
    this.applyLoadout(loadout);
  }

  private buildBoard() {
    const nx = 40, nz = 6;
    const halfL = BOARD_LEN / 2;
    const widthAt = (x: number) => {
      const ax = Math.abs(x) / halfL;
      const side = 0.125 + 0.022 * ax * ax; // sidecut
      if (ax > 0.86) { const t = (ax - 0.86) / 0.14; return side * Math.sqrt(Math.max(0, 1 - t * t)) + 0.0; }
      return side;
    };
    const kick = (x: number) => { const ax = Math.abs(x); return ax > 0.6 ? Math.pow((ax - 0.6) / (halfL - 0.6), 2) * 0.075 : 0; };
    const makeSurf = (top: boolean) => {
      const pos: number[] = [], uv: number[] = [], idx: number[] = [];
      for (let i = 0; i <= nx; i++) {
        const x = -halfL + (i / nx) * BOARD_LEN;
        const w = widthAt(x);
        for (let j = 0; j <= nz; j++) {
          const z = (j / nz - 0.5) * 2 * w;
          pos.push(x, kick(x) + (top ? 0.012 : 0), z);
          uv.push(i / nx, top ? j / nz : 1 - j / nz);
        }
      }
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const a = i * (nz + 1) + j, b = a + nz + 1;
        if (top) idx.push(a, a + 1, b, b, a + 1, b + 1); else idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    const edge = () => {
      const pos: number[] = [], idx: number[] = [];
      const ring: [number, number][] = [];
      for (let i = 0; i <= nx; i++) { const x = -halfL + (i / nx) * BOARD_LEN; ring.push([x, widthAt(x)]); }
      for (let i = nx; i >= 0; i--) { const x = -halfL + (i / nx) * BOARD_LEN; ring.push([x, -widthAt(x)]); }
      for (const [x, z] of ring) { pos.push(x, kick(x), z, x, kick(x) + 0.012, z); }
      const n = ring.length;
      for (let i = 0; i < n; i++) { const a = i * 2, b = ((i + 1) % n) * 2; idx.push(a, b, a + 1, a + 1, b, b + 1); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx); g.computeVertexNormals();
      return g;
    };
    const top = makeSurf(true), base = makeSurf(false), ed = edge();
    for (const g of [top, base, ed]) this.boardGeos.push({ geo: g, base: (g.attributes.position.array as Float32Array).slice() });
    this.boardTop = new THREE.Mesh(top, toon('#ffffff'));
    this.boardBase = new THREE.Mesh(base, toon('#ffffff'));
    this.boardEdge = new THREE.Mesh(ed, new THREE.MeshToonMaterial({ color: '#15171c', gradientMap: ramp, side: THREE.DoubleSide }));
    for (const m of [this.boardTop, this.boardBase, this.boardEdge]) { m.castShadow = true; this.boardGroup.add(m); }
    // Bindings
    const bindMat = toon('#1b1d21');
    for (const sx of [STANCE, -STANCE]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.26), bindMat);
      plate.position.set(sx, 0.027, 0); plate.rotation.y = sx > 0 ? 0.25 : -0.2;
      const hb = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.18, 0.2), bindMat);
      hb.position.set(sx, 0.11, -0.1); hb.rotation.set(-0.25, sx > 0 ? 0.25 : -0.2, 0, 'YXZ');
      hb.position.z = -0.11;
      plate.castShadow = hb.castShadow = true;
      this.boardGroup.add(plate, hb);
    }
  }

  private buildBody() {
    const cyl = (rt: number, rb: number, seg = 10) => { const g = new THREE.CylinderGeometry(rt, rb, 1, seg, 1); return g; };
    const caps = (r: number, l: number) => new THREE.CapsuleGeometry(r, l, 6, 12);
    const m = this.mats;
    m.jacket = toon('#2f6fb5'); m.jacketTrim = toon('#e9eef5'); m.pants = toon('#1d2b46');
    m.helmet = toon('#e9eef5'); m.lens = new THREE.MeshPhongMaterial({ color: '#ff8a3d', shininess: 120, specular: '#ffffff' });
    m.strap = toon('#1a1a1a'); m.gloves = toon('#1b1d21'); m.boots = toon('#3a3f47'); m.skin = toon('#e0b48f');
    m.acc = toon('#1d2b46'); m.acc2 = toon('#ff5a1f');

    const p = this.parts;
    // Jacket torso (unit height, centred)
    const torsoGeo = caps(0.205, 0.5); torsoGeo.scale(1.18, 1 / 0.91, 0.92);
    p.torso = new Limb(torsoGeo, m.jacket, this.body);
    // Pants
    p.pelvis = new Limb(new THREE.SphereGeometry(0.19, 14, 10), m.pants, this.body);
    p.thighL = new Limb(cyl(0.125, 0.11), m.pants, this.body);
    p.thighR = new Limb(cyl(0.125, 0.11), m.pants, this.body);
    p.shinL = new Limb(cyl(0.11, 0.128), m.pants, this.body);
    p.shinR = new Limb(cyl(0.11, 0.128), m.pants, this.body);
    p.kneeL = new Limb(new THREE.SphereGeometry(0.115, 10, 8), m.pants, this.body, false);
    p.kneeR = new Limb(new THREE.SphereGeometry(0.115, 10, 8), m.pants, this.body, false);
    // Boots
    const bootGeo = new THREE.BoxGeometry(0.13, 0.15, 0.3, 1, 1, 1); bootGeo.translate(0, 0, 0.02);
    p.bootL = new Limb(bootGeo, m.boots, this.body);
    p.bootR = new Limb(bootGeo, m.boots, this.body);
    // Arms
    p.upL = new Limb(cyl(0.085, 0.078), m.jacket, this.body);
    p.upR = new Limb(cyl(0.085, 0.078), m.jacket, this.body);
    p.foreL = new Limb(cyl(0.078, 0.07), m.jacket, this.body);
    p.foreR = new Limb(cyl(0.078, 0.07), m.jacket, this.body);
    p.elbowL = new Limb(new THREE.SphereGeometry(0.08, 8, 6), m.jacket, this.body, false);
    p.elbowR = new Limb(new THREE.SphereGeometry(0.08, 8, 6), m.jacket, this.body, false);
    p.shoulderL = new Limb(new THREE.SphereGeometry(0.095, 8, 6), m.jacket, this.body, false);
    p.shoulderR = new Limb(new THREE.SphereGeometry(0.095, 8, 6), m.jacket, this.body, false);
    const gloveGeo = new THREE.SphereGeometry(0.07, 10, 8); gloveGeo.scale(1, 1.2, 0.85);
    p.handL = new Limb(gloveGeo, m.gloves, this.body);
    p.handR = new Limb(gloveGeo, m.gloves, this.body);
    p.cuffL = new Limb(cyl(0.06, 0.06), m.jacketTrim, this.body, false);
    p.cuffR = new Limb(cyl(0.06, 0.06), m.jacketTrim, this.body, false);
    p.neck = new Limb(cyl(0.085, 0.1), m.acc, this.body, false);

    // Head: helmet + goggles. Face points +Z in head space.
    this.body.add(this.head);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.155, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), m.helmet);
    helmet.scale.set(1, 1.02, 1.1); helmet.position.y = 0.02; helmet.castShadow = true;
    const hOut = new THREE.Mesh(helmet.geometry, outlineMat); helmet.add(hOut);
    const chin = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), m.skin); chin.position.set(0, -0.04, 0.03); chin.scale.set(1, 1.05, 1);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.157, 0.022, 6, 28), m.strap);
    band.rotation.set(Math.PI / 2 - 0.12, 0, 0); band.scale.set(1, 1.1, 1);
    const lensGeo = new THREE.SphereGeometry(0.16, 16, 6, Math.PI / 2 - 0.8, 1.6, Math.PI * 0.42, Math.PI * 0.16);
    const lens = new THREE.Mesh(lensGeo, m.lens); lens.rotation.y = Math.PI * 0; lens.position.set(0, 0.0, 0.012); lens.scale.set(1.04, 1.25, 1.12);
    const frame = new THREE.Mesh(new THREE.SphereGeometry(0.163, 16, 6, Math.PI / 2 - 0.85, 1.7, Math.PI * 0.4, Math.PI * 0.2), m.strap); frame.scale.set(1.0, 1.25, 1.08); frame.position.z = 0.004;
    this.head.add(chin, helmet, band, frame, lens);
    // Accessories
    this.beanie = new THREE.Mesh(new THREE.SphereGeometry(0.168, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), m.acc2); this.beanie.position.y = 0.035; this.beanie.scale.set(1, 1.1, 1.08);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.165, 0.06, 18, 1, true), m.acc); cuff.position.y = 0.02; this.beanie.add(cuff);
    this.pom = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), m.jacketTrim); this.pom.position.y = 0.2;
    this.head.add(this.beanie, this.pom);
    this.hood = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.6), m.acc); this.hood.position.set(0, 0.0, -0.035); this.hood.scale.set(1.05, 1.08, 1.12);
    this.gaiter = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.13, 0.12, 14), m.acc); this.gaiter.position.set(0, -0.1, 0.02);
    this.bandana = new THREE.Mesh(new THREE.CylinderGeometry(0.118, 0.15, 0.13, 14), m.acc); this.bandana.position.set(0, -0.08, 0.025);
    this.head.add(this.hood, this.gaiter, this.bandana);
    this.pack = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.34, 0.12), m.acc); this.pack.castShadow = true;
    const packStripe = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.05, 0.125), m.acc2); this.pack.add(packStripe);
    this.accessories.add(this.pack);
    this.body.add(this.accessories);
    const teeGeo = new THREE.CylinderGeometry(0.235, 0.27, 1, 14, 1, true);
    this.tallTee = new Limb(teeGeo, toon('#f2f2f2'), this.body);
    (this.tallTee.mesh.material as THREE.MeshToonMaterial).side = THREE.DoubleSide;
  }

  applyLoadout(l: Loadout) {
    const m = this.mats as Record<string, THREE.MeshToonMaterial>;
    const jacket = itemById('jacket', l.jacket);
    m.jacket.map?.dispose();
    m.jacket.map = jacket.pattern ? clothTexture(jacket) : null;
    m.jacket.color.set(jacket.pattern ? '#ffffff' : jacket.colors[0]);
    m.jacket.needsUpdate = true;
    m.jacketTrim.color.set(jacket.colors[1] ?? '#ffffff');
    const pants = itemById('pants', l.pants);
    m.pants.map?.dispose();
    m.pants.map = pants.pattern ? clothTexture(pants) : null;
    m.pants.color.set(pants.pattern ? '#ffffff' : pants.colors[0]);
    m.pants.needsUpdate = true;
    const helmet = itemById('helmet', l.helmet);
    const hm = m.helmet;
    hm.color.set(helmet.colors[0]);
    this.beanie.visible = helmet.pattern === 'beanie' || helmet.pattern === 'pom';
    this.pom.visible = helmet.pattern === 'pom';
    if (this.beanie.visible) { (this.mats.acc2 as THREE.MeshToonMaterial).color.set(helmet.colors[0]); }
    const g = itemById('goggles', l.goggles);
    (this.mats.lens as THREE.MeshPhongMaterial).color.set(g.colors[0]);
    m.strap.color.set(g.colors[1] ?? '#1a1a1a');
    m.gloves.color.set(itemById('gloves', l.gloves).colors[0]);
    m.boots.color.set(shade(itemById('pants', l.pants).colors[0], -30));
    const acc = itemById('accessory', l.accessory);
    m.acc.color.set(acc.colors[0] ?? '#1d2b46');
    if (acc.colors[1]) m.acc2.color.set(acc.colors[1]);
    this.hood.visible = acc.id === 'a-hood';
    this.gaiter.visible = acc.id === 'a-gaiter';
    this.bandana.visible = acc.id === 'a-bandana';
    this.pack.visible = acc.id === 'a-pack';
    this.tallTee.mesh.visible = acc.id === 'a-tall';
    if (this.hood.visible) { this.beanie.visible = false; this.pom.visible = false; }
    const board = boardById(l.board);
    const sticker = itemById('sticker', l.sticker);
    const tm = this.boardTop.material as THREE.MeshToonMaterial, bm = this.boardBase.material as THREE.MeshToonMaterial;
    tm.map?.dispose(); bm.map?.dispose();
    tm.map = boardTexture(board, sticker, true); bm.map = boardTexture(board, sticker, false);
    tm.needsUpdate = bm.needsUpdate = true;
  }

  private q = new THREE.Quaternion();
  private e = new THREE.Euler();

  /** Solve the pose. Call after setting root transform. */
  update() {
    const P = this.pose;
    const t = P.time;
    const gb = P.grabBlend;
    const gt = P.grab ? GRAB_TWEAK[P.grab] : null;

    // ---- Board relative to body ----
    let roll = 0, yaw = 0, pitch = 0;
    if (gt) {
      roll = (gt.base[0] + gt.tweak[0] * P.tweak) * gb;
      yaw = (gt.base[1] + gt.tweak[1] * P.tweak) * gb;
      pitch = (gt.base[2] + gt.tweak[2] * P.tweak) * gb;
    }
    pitch += -P.press * 0.22;
    if (P.flail > 0) { roll += Math.sin(t * 9.1) * 0.5 * P.flail; pitch += Math.sin(t * 7.3) * 0.4 * P.flail; }
    this.e.set(roll, yaw, pitch, 'XYZ');
    this.boardPivot.quaternion.setFromEuler(this.e);
    const tuck = gt ? gt.tuck * gb : 0;
    const stand = 0.9 - 0.3 * P.crouch - 0.38 * tuck + 0.06 * P.extend;
    // sit the base a few cm proud of the snow so it never z-fights the surface
    this.boardGroup.position.set(0, -stand + 0.04, 0);
    this.updateFlex(P.flex);
    this.root.updateMatrixWorld(true);

    // Feet in body space
    const footF = V(STANCE, 0.1, 0.0), footR = V(-STANCE, 0.1, 0.0);
    this.boardGroup.localToWorld(footF); this.boardGroup.localToWorld(footR);
    this.root.worldToLocal(footF); this.root.worldToLocal(footR);

    // ---- Spine ----
    const lean = P.lean;
    const fwd = 0.18 + 0.55 * P.crouch + 0.85 * tuck * (gt ? 1 : 0) + (gt ? gt.lean * gb : 0);
    const pelvis = V(0, -0.02 - 0.05 * P.crouch, -0.05 - 0.04 * P.crouch);
    pelvis.z += lean * 0.03;
    const spineDir = V(Math.sin(P.twist) * 0.0 + -P.press * 0.25, Math.cos(fwd), Math.sin(fwd) + lean * 0.12).normalize();
    if (P.flail > 0) spineDir.add(V(Math.sin(t * 5) * 0.3 * P.flail, 0, Math.cos(t * 6.1) * 0.4 * P.flail)).normalize();
    const chest = pelvis.clone().addScaledVector(spineDir, 0.46);
    const neck = chest.clone().addScaledVector(spineDir, 0.12);
    // Shoulder axis: twist about spine
    const twist = P.twist + (P.flail ? Math.sin(t * 4) * 0.6 * P.flail : 0);
    const shAxis = V(Math.cos(twist), 0, -Math.sin(twist));
    const shL = chest.clone().addScaledVector(shAxis, 0.215).addScaledVector(spineDir, -0.05);
    const shR = chest.clone().addScaledVector(shAxis, -0.215).addScaledVector(spineDir, -0.05);

    // ---- Legs ----
    const hipL = pelvis.clone().add(V(0.12, -0.04, 0)), hipR = pelvis.clone().add(V(-0.12, -0.04, 0));
    const kneeL = V(), kneeR = V(), ankL = V(), ankR = V();
    const kneeHintF = V(0.3, 0, 1).normalize(), kneeHintR = V(-0.15, 0, 1).normalize();
    if (P.flail > 0) { kneeHintF.x += Math.sin(t * 8) * P.flail; kneeHintR.x -= Math.cos(t * 7) * P.flail; }
    solveIK(hipL, footF, THIGH, SHIN, kneeHintF, kneeL, ankL);
    solveIK(hipR, footR, THIGH, SHIN, kneeHintR, kneeR, ankR);

    // ---- Arms ----
    const handL = V(), handR = V();
    // balance pose: arms out in front-ish, swinging slightly
    const sway = Math.sin(t * 1.7) * 0.05;
    const armsOut = P.armsOut;
    handL.copy(shL).add(V(0.25 + armsOut * 0.2, -0.38 + armsOut * 0.2 + sway, 0.18 + armsOut * 0.05));
    handR.copy(shR).add(V(-0.25 - armsOut * 0.25, -0.38 + armsOut * 0.25 - sway, 0.14 - armsOut * 0.05));
    if (P.wave > 0) {
      handL.lerp(shL.clone().add(V(0.15, 0.55 + Math.sin(t * 9) * 0.05, 0.1)), P.wave);
      handR.lerp(shR.clone().add(V(-0.15, 0.55 + Math.cos(t * 9) * 0.05, 0.1)), P.wave);
    }
    if (P.flail > 0) {
      handL.add(V(Math.sin(t * 11) * 0.4, Math.cos(t * 9) * 0.5, Math.sin(t * 7) * 0.3).multiplyScalar(P.flail));
      handR.add(V(Math.cos(t * 10) * 0.4, Math.sin(t * 8.5) * 0.5, Math.cos(t * 6.3) * 0.3).multiplyScalar(P.flail));
    }
    if (P.grab && gb > 0.01) {
      const g = GRAB_TARGET[P.grab];
      const gp = V(...g.p);
      this.boardGroup.localToWorld(gp); this.root.worldToLocal(gp);
      if (g.hand === 'front') handL.lerp(gp, gb); else handR.lerp(gp, gb);
      // free hand styles out
      const free = g.hand === 'front' ? handR : handL;
      const sh = g.hand === 'front' ? shR : shL;
      const out = V(g.hand === 'front' ? -0.45 : 0.45, 0.15 + P.tweak * 0.2, -0.05);
      free.lerp(sh.clone().add(out), gb * 0.8);
    }
    const elL = V(), elR = V(), hL = V(), hR = V();
    solveIK(shL, handL, UPPER_ARM, FOREARM, V(0.4, -0.6, -0.4).normalize(), elL, hL);
    solveIK(shR, handR, UPPER_ARM, FOREARM, V(-0.4, -0.6, -0.4).normalize(), elR, hR);

    // ---- Place meshes ----
    const p = this.parts;
    const torsoBottom = pelvis.clone().addScaledVector(spineDir, -0.12);
    const torsoTop = chest.clone().addScaledVector(spineDir, 0.06);
    p.torso.between(torsoBottom, torsoTop);
    p.torso.mesh.scale.set(1, 1, 1);
    // orient torso so its width runs along the shoulder axis
    const zAxis = new THREE.Vector3().crossVectors(shAxis, spineDir).normalize();
    const xAxis = new THREE.Vector3().crossVectors(spineDir, zAxis).normalize();
    const mtx = new THREE.Matrix4().makeBasis(xAxis, spineDir, zAxis);
    p.torso.mesh.quaternion.setFromRotationMatrix(mtx);
    p.pelvis.mesh.position.copy(pelvis).add(V(0, -0.02, 0)); p.pelvis.mesh.scale.set(1.3, 0.85, 1.0);
    p.pelvis.mesh.quaternion.identity();
    p.thighL.between(hipL, kneeL, 0.05); p.thighR.between(hipR, kneeR, 0.05);
    p.shinL.between(kneeL, ankL.clone().add(V(0, 0.02, 0)), 0.02); p.shinR.between(kneeR, ankR.clone().add(V(0, 0.02, 0)), 0.02);
    p.kneeL.mesh.position.copy(kneeL); p.kneeR.mesh.position.copy(kneeR);
    // boots sit on the bindings, aligned to the board
    const bq = this.boardPivot.quaternion;
    for (const [limb, a, sx] of [[p.bootL, ankL, STANCE], [p.bootR, ankR, -STANCE]] as [Limb, THREE.Vector3, number][]) {
      limb.mesh.position.copy(a).add(V(0, -0.03, 0.0).applyQuaternion(bq));
      limb.mesh.quaternion.copy(bq).multiply(this.q.setFromAxisAngle(UP, sx > 0 ? 0.25 : -0.2));
      limb.mesh.scale.set(1, 1, 1);
    }
    p.upL.between(shL, elL, 0.04); p.upR.between(shR, elR, 0.04);
    p.foreL.between(elL, hL); p.foreR.between(elR, hR);
    p.elbowL.mesh.position.copy(elL); p.elbowR.mesh.position.copy(elR);
    p.shoulderL.mesh.position.copy(shL); p.shoulderR.mesh.position.copy(shR);
    p.handL.mesh.position.copy(hL); p.handR.mesh.position.copy(hR);
    p.handL.mesh.quaternion.copy(p.foreL.mesh.quaternion); p.handR.mesh.quaternion.copy(p.foreR.mesh.quaternion);
    const cuffL = elL.clone().lerp(hL, 0.86), cuffR = elR.clone().lerp(hR, 0.86);
    p.cuffL.between(cuffL, elL.clone().lerp(hL, 0.95)); p.cuffR.between(cuffR, elR.clone().lerp(hR, 0.95));
    p.neck.between(chest.clone().addScaledVector(spineDir, 0.04), neck.clone().addScaledVector(spineDir, 0.06));
    // head looks toward the nose (direction of travel)
    const headPos = neck.clone().addScaledVector(spineDir, 0.17);
    this.head.position.copy(headPos);
    const look = P.look + (P.flail ? Math.sin(t * 6) * 0.8 * P.flail : 0);
    this.head.quaternion.setFromRotationMatrix(mtx).multiply(this.q.setFromAxisAngle(UP, look));
    // backpack
    this.pack.position.copy(chest).addScaledVector(zAxis, -0.21).addScaledVector(spineDir, -0.1);
    this.pack.quaternion.setFromRotationMatrix(mtx);
    this.tallTee.between(pelvis.clone().addScaledVector(spineDir, -0.32), pelvis.clone().addScaledVector(spineDir, 0.1));
    this.tallTee.mesh.quaternion.setFromRotationMatrix(mtx);
    this.tallTee.mesh.scale.set(1.15, 0.42, 0.95);

    // export joints (world)
    const J = this.joints;
    const w = (v: THREE.Vector3, o: THREE.Vector3) => o.copy(v).applyMatrix4(this.root.matrixWorld);
    w(pelvis, J.pelvis); w(chest, J.chest); w(neck, J.neck); w(hL, J.haL); w(hR, J.haR); w(ankL, J.ankleL); w(ankR, J.ankleR);
  }

  private lastFlex = 999;
  private updateFlex(flex: number) {
    if (Math.abs(flex - this.lastFlex) < 0.01) return;
    this.lastFlex = flex;
    const halfL = BOARD_LEN / 2;
    for (const { geo, base } of this.boardGeos) {
      const pos = geo.attributes.position.array as Float32Array;
      for (let i = 0; i < pos.length; i += 3) {
        const x = base[i] / halfL;
        pos[i] = base[i];
        pos[i + 1] = base[i + 1] + flex * 0.045 * (x * x - 0.35);
        pos[i + 2] = base[i + 2];
      }
      geo.attributes.position.needsUpdate = true;
    }
  }

  /** Hide outlines at low quality. */
  setOutline(on: boolean) { outlineMat.visible = on; }
}
