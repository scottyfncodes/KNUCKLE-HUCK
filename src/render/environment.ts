/**
 * The venue: an Aspen-inspired Big Air knuckle-huck setup. Everything is
 * generated procedurally at boot (terrain, mountains, scaffold, fences,
 * crowd, chairlift) so there are no asset downloads.
 */
import * as THREE from 'three';
import { COURSE, groundY, halfWidth, profileY } from '../physics/course';
import { archTexture, bannerTexture, corduroyTexture, dyeTexture, fenceTexture, flakeTexture, rng, signTexture, skyTexture, snowTexture, toonRamp } from './textures';

// ---------- noise ----------
function hash(x: number, y: number) { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); }
function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
function fbm(x: number, y: number, o = 4) { let s = 0, a = 1, f = 1, n = 0; for (let i = 0; i < o; i++) { s += vnoise(x * f, y * f) * a; n += a; a *= 0.5; f *= 2.03; } return s / n; }
function smooth(a: number, b: number, x: number) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

/** Visual terrain height — identical to physics near the feature, natural further out. */
export function visualY(x: number, z: number) {
  let y = groundY(x, z);
  const ax = Math.abs(x);
  const hw = halfWidth(z);
  const far = smooth(hw + 16, hw + 46, ax);
  y += (fbm(x * 0.025, z * 0.025) * 5 + fbm(x * 0.09, z * 0.09, 2) * 1.0) * far;
  y += Math.max(0, ax - (hw + 42)) * 0.3 * far;
  // the mountain the venue is carved into rises behind the start
  if (z < 4) y = Math.max(y, profileY(z) - 9 + Math.max(0, -z - 2) * 0.55 + far * 0) + (ax > hw + 2 ? Math.max(0, -z - 6) * 0.25 : 0);
  return y;
}

export interface Venue {
  group: THREE.Group;
  sun: THREE.DirectionalLight;
  update(dt: number, t: number, camera: THREE.Camera, excitement: number): void;
  crowdJump(amount: number): void;
  setQuality(q: 'low' | 'high'): void;
}

const ramp = toonRamp();

export function buildVenue(scene: THREE.Scene): Venue {
  const group = new THREE.Group();
  scene.add(group);
  const R = rng(42);

  // ---------- sky + fog ----------
  scene.background = new THREE.Color('#cfe3f4');
  scene.fog = new THREE.Fog('#d9e8f5', 160, 1500);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2400, 32, 16), new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10;
  group.add(sky);

  // ---------- lights ----------
  const hemi = new THREE.HemisphereLight('#bcd8ff', '#ffffff', 1.25);
  group.add(hemi);
  const sun = new THREE.DirectionalLight('#fff4e0', 2.4);
  sun.position.set(-60, 120, -40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = -6; sc.right = 6; sc.top = 6; sc.bottom = -6; sc.near = 1; sc.far = 300;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  group.add(sun, sun.target);

  // ---------- terrain ----------
  const snowTex = snowTexture(); snowTex.repeat.set(1, 1);
  const cordTex = corduroyTexture();
  const D = [0.25, 0.6, 1.0, 1.5, 2.2, 3.0, 4.2, 5.8, 8, 11, 15, 20, 27, 36, 48, 64, 86, 115, 155, 210, 280];
  const FEAT = 12;
  const zs: number[] = [];
  for (let z = -70; z < -10; z += 3) zs.push(z);
  for (let z = -10; z < 60; z += 1) zs.push(z);
  for (let z = 60; z < 170; z += 0.5) zs.push(z);
  for (let z = 170; z <= 420; z += 2) zs.push(z);

  const buildStrip = (cols: (z: number) => number[], material: THREE.Material, colorFn: (x: number, z: number, ny: number) => [number, number, number], uvScale: [number, number]) => {
    const pos: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [];
    let ncol = 0;
    zs.forEach((z, r) => {
      const xs = cols(z);
      ncol = xs.length;
      for (const x of xs) {
        const y = visualY(x, z);
        pos.push(x, y, z);
        const e = 0.3;
        const dx = (visualY(x + e, z) - visualY(x - e, z)) / (2 * e);
        const dz = (visualY(x, z + e) - visualY(x, z - e)) / (2 * e);
        const ny = 1 / Math.hypot(dx, 1, dz);
        const c = colorFn(x, z, ny);
        col.push(c[0], c[1], c[2]);
        uv.push(x * uvScale[0], z * uvScale[1]);
      }
      if (r > 0) {
        const a0 = (r - 1) * ncol, b0 = r * ncol;
        for (let i = 0; i < ncol - 1; i++) idx.push(a0 + i, b0 + i, a0 + i + 1, a0 + i + 1, b0 + i, b0 + i + 1);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true;
    group.add(m);
    return m;
  };

  const featMat = new THREE.MeshLambertMaterial({ map: cordTex, vertexColors: true });
  buildStrip(z => { const hw = halfWidth(z); const xs: number[] = []; for (let i = 0; i <= FEAT; i++) xs.push(-hw + (i / FEAT) * 2 * hw); return xs; },
    featMat, (_x, z, ny) => { const k = 1 - ny; const t = z > COURSE.deckStartZ - 4 && z < COURSE.landingStartZ ? 0.985 : 1; return [t - k * 0.5, t - k * 0.3, t]; }, [0.55, 0.35]);
  const outerMat = new THREE.MeshLambertMaterial({ map: snowTex, vertexColors: true });
  for (const side of [-1, 1]) {
    buildStrip(z => { const hw = halfWidth(z); const xs = [hw, ...D.map(d => hw + d)].map(x => x * side); return side < 0 ? xs.reverse() : xs; },
      outerMat, (x, z, ny) => {
        const k = Math.max(0, 1 - ny) * 1.6; const n = fbm(x * 0.05, z * 0.05, 2) * 0.04;
        return [0.93 - k * 0.38 + n, 0.96 - k * 0.22 + n, 1.0];
      }, [0.08, 0.08]);
  }

  // ---------- dye lines (blue lines painted on the snow) ----------
  const dyeTex = dyeTexture();
  const dyeMat = new THREE.MeshBasicMaterial({ map: dyeTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, color: '#ffffff' });
  const crossLine = (z: number, width: number, w = 0.45) => {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const n = 24;
    for (let i = 0; i <= n; i++) {
      const x = -width + (i / n) * 2 * width;
      for (const dz of [-w / 2, w / 2]) { pos.push(x, groundY(x, z + dz) + 0.03, z + dz); uv.push(i / n * 4, dz > 0 ? 1 : 0); }
    }
    for (let i = 0; i < n; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    const m = new THREE.Mesh(g, dyeMat); m.renderOrder = 1; group.add(m);
  };
  const sideLine = (x0: (z: number) => number, z0: number, z1: number, w = 0.35) => {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const n = Math.ceil((z1 - z0) / 1);
    for (let i = 0; i <= n; i++) {
      const z = z0 + (i / n) * (z1 - z0); const x = x0(z);
      for (const dx of [-w / 2, w / 2]) { pos.push(x + dx, groundY(x + dx, z) + 0.03, z); uv.push(i * 0.25, dx > 0 ? 1 : 0); }
    }
    for (let i = 0; i < n; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    const m = new THREE.Mesh(g, dyeMat); m.renderOrder = 1; group.add(m);
  };
  crossLine(COURSE.knuckleZ, halfWidth(COURSE.knuckleZ) - 0.2, 0.7);       // THE knuckle line
  crossLine(COURSE.knuckleZ - 0.9, halfWidth(COURSE.knuckleZ) - 0.2, 0.25);
  crossLine(COURSE.deckStartZ, halfWidth(COURSE.deckStartZ) - 0.4, 0.3);
  for (const z of [112, 124, 136]) crossLine(z, halfWidth(z) - 0.5, 0.22);
  for (const s of [-1, 1]) {
    sideLine(z => s * (halfWidth(z) - 0.5), 8, COURSE.outrunZ + 6);
  }

  // ---------- mountains ----------
  const mountMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, fog: true });
  const ring = (radius: number, minH: number, maxH: number, seed: number, rocky: number, cx = 0, cz = 140) => {
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const segs = 140, rows = 6;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const n = fbm(Math.cos(a) * 2 + seed, Math.sin(a) * 2 + seed, 5) * 0.5 + 0.5;
      const peak = Math.pow(Math.max(0, fbm(a * 3 + seed * 2, seed, 3)), 1.5) * 1.6;
      const H = minH + (maxH - minH) * Math.min(1.3, n * 0.8 + peak);
      for (let j = 0; j <= rows; j++) {
        const t = j / rows;
        const rr = radius + (1 - t) * radius * 0.12 + fbm(i * 0.31 + seed, j * 0.7, 2) * radius * 0.02;
        const h = -60 + H * Math.pow(t, 0.9) * (1 + fbm(i * 0.17, j * 0.5 + seed, 2) * 0.12);
        pos.push(cx + Math.sin(a) * rr, h, cz + Math.cos(a) * rr);
        const snowLine = 0.45 + fbm(i * 0.4 + seed, j * 0.3, 2) * 0.25;
        const rock = t < snowLine ? rocky * (0.8 + fbm(i * 0.9, j * 1.3 + seed, 2) * 0.4) : rocky * 0.15 * (1 + fbm(i * 1.7, j * 2.1, 1));
        const c = new THREE.Color().setRGB(0.95 - rock * 0.62, 0.97 - rock * 0.55, 1.0 - rock * 0.42);
        col.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < segs; i++) for (let j = 0; j < rows; j++) {
      const a = i * (rows + 1) + j, b = (i + 1) * (rows + 1) + j;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mountMat);
    group.add(m);
  };
  ring(1900, 260, 820, 3.1, 0.55);
  ring(1250, 120, 440, 7.7, 0.75);
  ring(760, 40, 200, 1.9, 0.9);

  // ---------- trees ----------
  const treeGeo = (() => {
    const parts: THREE.BufferGeometry[] = [];
    const trunk = new THREE.CylinderGeometry(0.18, 0.25, 1.6, 5); trunk.translate(0, 0.8, 0); parts.push(trunk);
    for (let i = 0; i < 4; i++) { const c = new THREE.ConeGeometry(2.1 - i * 0.42, 2.8, 7); c.translate(0, 1.9 + i * 1.5, 0); parts.push(c); }
    return mergeGeos(parts);
  })();
  const snowCapGeo = (() => {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) { const c = new THREE.ConeGeometry(1.5 - i * 0.32, 1.2, 7); c.translate(0, 2.75 + i * 1.5, 0); parts.push(c); }
    return mergeGeos(parts);
  })();
  const treeMat = new THREE.MeshLambertMaterial({ color: '#21443b', flatShading: true });
  const capMat = new THREE.MeshLambertMaterial({ color: '#f3f7fb', flatShading: true });
  const trees: THREE.Matrix4[] = [];
  const tries = 1400;
  for (let i = 0; i < tries && trees.length < 520; i++) {
    const z = -60 + R() * 470;
    const side = R() < 0.5 ? -1 : 1;
    const x = side * (halfWidth(z) + 30 + Math.pow(R(), 1.4) * 200);
    if (Math.abs(x + 70) < 8) continue; // lift line
    if (z > 160 && Math.abs(x) < 62) continue; // crowd area
    if (fbm(x * 0.02, z * 0.02, 2) < -0.15) continue; // clearings
    const s = 0.7 + R() * 0.9;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, visualY(x, z) - 0.3, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * 6), new THREE.Vector3(s, s * (0.9 + R() * 0.4), s));
    trees.push(m);
  }
  const treeIM = new THREE.InstancedMesh(treeGeo, treeMat, trees.length);
  const capIM = new THREE.InstancedMesh(snowCapGeo, capMat, trees.length);
  trees.forEach((m, i) => { treeIM.setMatrixAt(i, m); capIM.setMatrixAt(i, m); });
  group.add(treeIM, capIM);

  // ---------- materials for props ----------
  const steel = new THREE.MeshLambertMaterial({ color: '#7d8794' });
  const darkSteel = new THREE.MeshLambertMaterial({ color: '#3a4049' });
  const orangeMat = new THREE.MeshLambertMaterial({ color: '#ff5a1f' });

  // ---------- start tower ----------
  const startY = profileY(0);
  const tower = new THREE.Group();
  const H = 11;
  const legGeo = new THREE.CylinderGeometry(0.09, 0.09, 1, 6);
  const addBar = (a: THREE.Vector3, b: THREE.Vector3, mat: THREE.Material = steel, r = 1) => {
    const m = new THREE.Mesh(legGeo, mat);
    const d = new THREE.Vector3().subVectors(b, a); const len = d.length();
    m.position.addVectors(a, b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    m.scale.set(r, len, r);
    tower.add(m);
  };
  const tw = 4, tz0 = -9, tz1 = 3;
  for (const x of [-tw, tw]) for (const z of [tz0, tz1]) addBar(new THREE.Vector3(x, startY - H, z), new THREE.Vector3(x, startY + 4.2, z));
  for (let lvl = 0; lvl <= 5; lvl++) {
    const y = startY - H + lvl * (H / 5);
    for (const x of [-tw, tw]) { addBar(new THREE.Vector3(x, y, tz0), new THREE.Vector3(x, y, tz1)); if (lvl < 5) addBar(new THREE.Vector3(x, y, tz0), new THREE.Vector3(x, y + H / 5, tz1)); }
    addBar(new THREE.Vector3(-tw, y, tz0), new THREE.Vector3(tw, y, tz0));
  }
  // roof + DROP IN banner
  const roof = new THREE.Mesh(new THREE.BoxGeometry(tw * 2 + 1, 0.3, tz1 - tz0 + 1), darkSteel);
  roof.position.set(0, startY + 4.3, (tz0 + tz1) / 2); tower.add(roof);
  const startBanner = new THREE.Mesh(new THREE.PlaneGeometry(tw * 2, 1.5), new THREE.MeshBasicMaterial({ map: archTexture('DROP IN', 'KNUCKLE HUCK · ASPEN-STYLE BIG AIR'), side: THREE.DoubleSide }));
  startBanner.position.set(0, startY + 3.3, tz1 + 0.05); startBanner.rotation.y = 0; tower.add(startBanner);
  const startBack = startBanner.clone(); startBack.position.z = tz1 + 0.02; startBack.rotation.y = Math.PI; tower.add(startBack);
  // tower side wraps
  for (const x of [-tw - 0.05, tw + 0.05]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(tz1 - tz0, 2.2), new THREE.MeshBasicMaterial({ map: bannerTexture(x < 0 ? 1 : 2), side: THREE.DoubleSide }));
    w.position.set(x, startY - 2.5, (tz0 + tz1) / 2); w.rotation.y = Math.PI / 2; tower.add(w);
  }
  group.add(tower);

  // ---------- fences + banners ----------
  const fenceTex = fenceTexture();
  const fenceMat = new THREE.MeshLambertMaterial({ map: fenceTex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide });
  const fence = (pts: [number, number][], h = 1.2) => {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    let acc = 0;
    pts.forEach(([x, z], i) => {
      if (i > 0) acc += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
      const y = visualY(x, z);
      pos.push(x, y, z, x, y + h, z); uv.push(acc / 2, 0, acc / 2, 1);
      if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    group.add(new THREE.Mesh(g, fenceMat));
  };
  for (const s of [-1, 1]) {
    const pts: [number, number][] = [];
    for (let z = 4; z <= 240; z += 2) pts.push([s * (halfWidth(z) + (z > 150 ? 3.5 : 1.3)), z]);
    fence(pts);
  }
  fence(Array.from({ length: 31 }, (_, i) => [-32 + i * (64 / 30), 238] as [number, number]), 1.3);

  const bannerGeo = new THREE.PlaneGeometry(3.2, 0.85);
  for (const s of [-1, 1]) {
    let k = s > 0 ? 0 : 3;
    for (let z = 74; z <= 225; z += 7) {
      const off = z > 150 ? 3.0 : 1.0;
      const x = s * (halfWidth(z) + off);
      const y = visualY(x, z);
      const b = new THREE.Mesh(bannerGeo, new THREE.MeshLambertMaterial({ map: bannerTexture(k++), side: THREE.DoubleSide }));
      const dz = (visualY(x, z + 1.6) - visualY(x, z - 1.6)) / 3.2;
      b.position.set(x, y + 0.55, z);
      b.rotation.set(0, s > 0 ? -Math.PI / 2 : Math.PI / 2, 0);
      b.rotateX(-0.25 * 0); b.rotateZ(s > 0 ? -Math.atan(dz) : Math.atan(dz));
      group.add(b);
    }
  }

  // ---------- knuckle flags ----------
  const flagCloth: THREE.Mesh[] = [];
  const flag = (x: number, z: number, color: string, h = 4.2) => {
    const y = visualY(x, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, h, 6), darkSteel);
    pole.position.set(x, y + h / 2, z); group.add(pole);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 2.2, 6, 1), new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
    cloth.geometry.translate(0.45, 0, 0);
    cloth.position.set(x, y + h - 1.15, z);
    group.add(cloth); flagCloth.push(cloth);
  };
  for (const s of [-1, 1]) {
    flag(s * (halfWidth(COURSE.knuckleZ) + 0.6), COURSE.knuckleZ, '#2b6cff', 4.6);
    flag(s * (halfWidth(COURSE.deckStartZ) + 0.6), COURSE.deckStartZ, '#ff5a1f', 3.6);
    flag(s * (halfWidth(COURSE.landingEndZ) + 1.2), COURSE.landingEndZ, '#d8f34a', 3.6);
  }

  // ---------- judges tower ----------
  {
    const jx = halfWidth(118) + 12, jz = 116;
    const jy = visualY(jx, jz);
    const legs = new THREE.Group();
    for (const dx of [-2, 2]) for (const dz of [-2, 2]) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 9, 6), steel); l.position.set(jx + dx, jy + 4.5, jz + dz); legs.add(l);
    }
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(5.4, 3, 5.4), new THREE.MeshLambertMaterial({ color: '#e9eef5' }));
    cabin.position.set(jx, jy + 10.5, jz);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(5.5, 1.2, 5.5), new THREE.MeshPhongMaterial({ color: '#203a5a', shininess: 90 }));
    glass.position.set(jx, jy + 10.8, jz);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.3), new THREE.MeshBasicMaterial({ map: signTexture('JUDGES', '#0f1c30', '#ffffff') }));
    sign.position.set(jx - 2.76, jy + 12.7, jz); sign.rotation.y = -Math.PI / 2;
    const roofJ = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.35, 6.4), orangeMat); roofJ.position.set(jx, jy + 12.1, jz);
    group.add(legs, cabin, glass, sign, roofJ);
  }

  // ---------- finish arch ----------
  {
    const z = 204, w = halfWidth(z) + 2;
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 7, 12), new THREE.MeshLambertMaterial({ color: '#0f1c30' }));
      p.position.set(s * w, visualY(s * w, z) + 3.5, z); group.add(p);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(w * 2 + 1.6, 2.4, 1.2), new THREE.MeshLambertMaterial({ color: '#0f1c30' }));
    top.position.set(0, profileY(z) + 7.6, z); group.add(top);
    const fin = new THREE.Mesh(new THREE.PlaneGeometry(w * 2, 2.2), new THREE.MeshBasicMaterial({ map: archTexture('KNUCKLE HUCK', 'PRESENTED BY HAVEANAPP · FROSTBYTE · SUMMIT SODA'), side: THREE.DoubleSide }));
    fin.position.set(0, profileY(z) + 7.6, z - 0.62); fin.rotation.y = Math.PI; group.add(fin);
    const fin2 = fin.clone(); fin2.position.z = z + 0.62; fin2.rotation.y = 0; group.add(fin2);
  }

  // ---------- DJ booth + speakers ----------
  {
    const bx = -halfWidth(186) - 9, bz = 186, by = visualY(bx, bz);
    const booth = new THREE.Mesh(new THREE.BoxGeometry(5, 2, 3), new THREE.MeshLambertMaterial({ color: '#1b1d21' }));
    booth.position.set(bx, by + 1, bz); group.add(booth);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.4), new THREE.MeshBasicMaterial({ map: bannerTexture(6) }));
    front.position.set(bx + 1.51, by + 1, bz); front.rotation.y = Math.PI / 2; group.add(front);
    for (const dz of [-3.5, 3.5]) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(1.4, 3.2, 1.4), new THREE.MeshLambertMaterial({ color: '#111216' }));
      sp.position.set(bx, by + 1.6, bz + dz); group.add(sp);
    }
  }

  // ---------- crowd ----------
  const crowdPos: { x: number; y: number; z: number; ph: number; rate: number }[] = [];
  for (let i = 0; i < 2000 && crowdPos.length < 620; i++) {
    let x: number, z: number;
    const k = R();
    if (k < 0.72) { const s = R() < 0.5 ? -1 : 1; z = 160 + R() * 76; x = s * (halfWidth(z) + 4.6 + R() * 13); }
    else { z = 239.5 + R() * 9; x = -34 + R() * 68; }
    // spectators also line the landing
    if (R() < 0.12) { const s = R() < 0.5 ? -1 : 1; z = 120 + R() * 40; x = s * (halfWidth(z) + 2.6 + R() * 4); }
    crowdPos.push({ x, y: visualY(x, z), z, ph: R() * 10, rate: 2 + R() * 3 });
  }
  const bodyGeo = new THREE.CylinderGeometry(0.24, 0.3, 1.25, 6); bodyGeo.translate(0, 0.62, 0);
  const headGeo = new THREE.IcosahedronGeometry(0.19, 0); headGeo.translate(0, 1.42, 0);
  const crowdBodyMat = new THREE.MeshToonMaterial({ gradientMap: ramp });
  const crowdHeadMat = new THREE.MeshToonMaterial({ gradientMap: ramp });
  const bodies = new THREE.InstancedMesh(bodyGeo, crowdBodyMat, crowdPos.length);
  const heads = new THREE.InstancedMesh(headGeo, crowdHeadMat, crowdPos.length);
  const palette = ['#ff5a1f', '#2f6fb5', '#d8f34a', '#1b1d21', '#e9eef5', '#ff3e7f', '#1ba39c', '#6b3fa0', '#ffd23f', '#c0392b', '#34383f', '#7fd3ff'];
  const hats = ['#1b1d21', '#e9eef5', '#ff5a1f', '#2bc4ff', '#c0392b', '#d8f34a', '#e0b48f'];
  const col = new THREE.Color();
  crowdPos.forEach((c, i) => {
    bodies.setColorAt(i, col.set(palette[Math.floor(R() * palette.length)]));
    heads.setColorAt(i, col.set(hats[Math.floor(R() * hats.length)]));
  });
  group.add(bodies, heads);
  const cm = new THREE.Matrix4(), cq = new THREE.Quaternion(), cs = new THREE.Vector3(1, 1, 1), cp = new THREE.Vector3();
  let jump = 0;

  // ---------- chairlift ----------
  const liftX = -70;
  const liftPts: THREE.Vector3[] = [];
  for (let z = 330; z >= -70; z -= 50) liftPts.push(new THREE.Vector3(liftX, visualY(liftX, z), z));
  const towerH = 11;
  for (const p of liftPts) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, towerH, 8), steel); t.position.set(p.x, p.y + towerH / 2, p.z); group.add(t);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(5, 0.35, 0.35), darkSteel); arm.position.set(p.x, p.y + towerH, p.z); group.add(arm);
  }
  const cableUp = new THREE.CatmullRomCurve3(liftPts.map(p => new THREE.Vector3(p.x + 2.2, p.y + towerH - 0.3, p.z)));
  const cableDown = new THREE.CatmullRomCurve3(liftPts.slice().reverse().map(p => new THREE.Vector3(p.x - 2.2, p.y + towerH - 0.3, p.z)));
  const cableMat = new THREE.LineBasicMaterial({ color: '#30353d' });
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(cableUp.getPoints(120)), cableMat));
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(cableDown.getPoints(120)), cableMat));
  const chairGeo = (() => {
    const parts: THREE.BufferGeometry[] = [];
    const hang = new THREE.CylinderGeometry(0.04, 0.04, 2.2, 4); hang.translate(0, -1.1, 0); parts.push(hang);
    const seat = new THREE.BoxGeometry(1.6, 0.12, 0.6); seat.translate(0, -2.2, 0); parts.push(seat);
    const back = new THREE.BoxGeometry(1.6, 0.7, 0.08); back.translate(0, -1.85, -0.3); parts.push(back);
    return mergeGeos(parts);
  })();
  const nChairs = 24;
  const chairs = new THREE.InstancedMesh(chairGeo, darkSteel, nChairs * 2);
  group.add(chairs);

  // ---------- snowfall ----------
  const flakes = 900;
  const fpos = new Float32Array(flakes * 3);
  for (let i = 0; i < flakes; i++) { fpos[i * 3] = (R() - 0.5) * 60; fpos[i * 3 + 1] = R() * 30; fpos[i * 3 + 2] = (R() - 0.5) * 60; }
  const fgeo = new THREE.BufferGeometry(); fgeo.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
  const snow = new THREE.Points(fgeo, new THREE.PointsMaterial({ map: flakeTexture(), size: 0.16, transparent: true, depthWrite: false, opacity: 0.85 }));
  snow.frustumCulled = false;
  group.add(snow);
  const snowOrigin = new THREE.Vector3();

  return {
    group, sun,
    crowdJump(a: number) { jump = Math.max(jump, a); },
    setQuality(q) { snow.visible = q === 'high' || true; (snow.material as THREE.PointsMaterial).size = q === 'high' ? 0.16 : 0.2; },
    update(dt, t, camera, excitement) {
      // flags
      for (const [i, f] of flagCloth.entries()) f.rotation.y = Math.sin(t * 2.3 + i) * 0.35 + 0.4;
      // crowd
      jump = Math.max(0, jump - dt * 0.35);
      const ex = Math.min(1, excitement * 0.6 + jump);
      for (let i = 0; i < crowdPos.length; i++) {
        const c = crowdPos[i];
        const bounce = Math.max(0, Math.sin(t * c.rate * (1 + ex) + c.ph)) * (0.04 + ex * 0.45);
        cp.set(c.x, c.y + bounce, c.z);
        cq.setFromAxisAngle(UPV, Math.atan2(-c.x, 0) + Math.sin(t * 0.5 + c.ph) * 0.2);
        cm.compose(cp, cq, cs);
        bodies.setMatrixAt(i, cm); heads.setMatrixAt(i, cm);
      }
      bodies.instanceMatrix.needsUpdate = true; heads.instanceMatrix.needsUpdate = true;
      // chairlift
      for (let i = 0; i < nChairs; i++) {
        const u = ((i / nChairs) + t * 0.006) % 1;
        const pu = cableUp.getPointAt(u), pd = cableDown.getPointAt(u);
        cm.compose(pu, cq.setFromAxisAngle(UPV, 0), cs); chairs.setMatrixAt(i, cm);
        cm.compose(pd, cq.setFromAxisAngle(UPV, Math.PI), cs); chairs.setMatrixAt(i + nChairs, cm);
      }
      chairs.instanceMatrix.needsUpdate = true;
      // snowfall wraps around the camera
      snowOrigin.copy(camera.position);
      const arr = fgeo.attributes.position.array as Float32Array;
      for (let i = 0; i < flakes; i++) {
        let x = arr[i * 3], y = arr[i * 3 + 1], z = arr[i * 3 + 2];
        y -= dt * (1.2 + (i % 7) * 0.12);
        x += Math.sin(t * 0.7 + i) * dt * 0.4 + dt * 0.3;
        const rx = x - snowOrigin.x, ry = y - snowOrigin.y, rz = z - snowOrigin.z;
        if (ry < -10) y += 30; if (ry > 20) y -= 30;
        if (rx < -30) x += 60; if (rx > 30) x -= 60;
        if (rz < -30) z += 60; if (rz > 30) z -= 60;
        arr[i * 3] = x; arr[i * 3 + 1] = y; arr[i * 3 + 2] = z;
      }
      fgeo.attributes.position.needsUpdate = true;
    },
  };
}
const UPV = new THREE.Vector3(0, 1, 0);

function mergeGeos(geos: THREE.BufferGeometry[]) {
  // Minimal merge for non-indexed + indexed geometries with position/normal only
  const pos: number[] = [], nor: number[] = [];
  for (const g0 of geos) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    for (let i = 0; i < p.length; i++) { pos.push(p[i]); nor.push(n[i]); }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}
