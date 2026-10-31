/** Snow spray, landing bursts and celebration flares — one pooled particle system. */
import * as THREE from 'three';
import { flakeTexture } from './textures';

const MAX = 1600;

export class Particles {
  points: THREE.Points;
  private pos = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private maxLife = new Float32Array(MAX);
  private size = new Float32Array(MAX);
  private alpha = new Float32Array(MAX);
  private color = new Float32Array(MAX * 3);
  private drag = new Float32Array(MAX);
  private grav = new Float32Array(MAX);
  private head = 0;
  scale = 1;

  constructor(scene: THREE.Scene) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3));
    const m = new THREE.ShaderMaterial({
      uniforms: { map: { value: flakeTexture() }, pr: { value: Math.min(2, window.devicePixelRatio) } },
      vertexShader: `
        attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
        varying float vA; varying vec3 vC; uniform float pr;
        void main(){ vA = aAlpha; vC = aColor; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = min(aSize * pr * 210.0 / max(1.0, -mv.z), 90.0 * pr); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying float vA; varying vec3 vC;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); if (t.a * vA < 0.01) discard; gl_FragColor = vec4(vC, t.a * vA); }`,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, spread: number, n: number, opts: { life?: number; size?: number; color?: [number, number, number]; drag?: number; grav?: number; up?: number } = {}) {
    n = Math.round(n * this.scale);
    for (let k = 0; k < n; k++) {
      const i = this.head; this.head = (this.head + 1) % MAX;
      this.pos[i * 3] = p.x + (Math.random() - 0.5) * 0.3;
      this.pos[i * 3 + 1] = p.y + Math.random() * 0.1;
      this.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * 0.3;
      this.vel[i * 3] = v.x + (Math.random() - 0.5) * spread;
      this.vel[i * 3 + 1] = v.y + Math.random() * spread * 0.6 + (opts.up ?? 0);
      this.vel[i * 3 + 2] = v.z + (Math.random() - 0.5) * spread;
      const life = (opts.life ?? 0.8) * (0.6 + Math.random() * 0.8);
      this.life[i] = life; this.maxLife[i] = life;
      this.size[i] = (opts.size ?? 0.35) * (0.6 + Math.random() * 0.9);
      const c = opts.color ?? [1, 1, 1];
      this.color[i * 3] = c[0]; this.color[i * 3 + 1] = c[1]; this.color[i * 3 + 2] = c[2];
      this.drag[i] = opts.drag ?? 2.2;
      this.grav[i] = opts.grav ?? 6;
    }
  }

  update(dt: number) {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt; this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = Math.min(1, t * 2.2) * 0.9;
      this.size[i] *= 1 + dt * 0.5;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.aAlpha.needsUpdate = true; g.attributes.aSize.needsUpdate = true; g.attributes.aColor.needsUpdate = true;
  }

  clear() { this.life.fill(0); this.alpha.fill(0); }
}
