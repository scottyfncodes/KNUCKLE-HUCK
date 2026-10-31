/** Procedural canvas textures — no external image assets needed. */
import * as THREE from 'three';
import type { BoardDef, ColorItem } from '../data/gear';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { c, g: c.getContext('2d')! };
}

function tex(c: HTMLCanvasElement, repeat = false, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  return t;
}

// Small seeded RNG so the venue looks the same every time
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function snowTexture() {
  const { c, g } = canvas(256, 256);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256);
  const r = rng(7);
  for (let i = 0; i < 2600; i++) {
    const v = 232 + Math.floor(r() * 23);
    g.fillStyle = `rgb(${v - 6},${v - 2},${v + 2 > 255 ? 255 : v + 2})`;
    g.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1 + r() * 2);
  }
  return tex(c, true);
}

/** Groomed corduroy for the feature, stripes run downhill. */
export function corduroyTexture() {
  const { c, g } = canvas(128, 128);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
  for (let x = 0; x < 128; x += 4) {
    g.fillStyle = 'rgba(150,175,205,0.22)'; g.fillRect(x, 0, 1.4, 128);
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(x + 2, 0, 1, 128);
  }
  const r = rng(3);
  for (let i = 0; i < 500; i++) {
    g.fillStyle = `rgba(170,190,215,${r() * 0.18})`;
    g.fillRect(r() * 128, r() * 128, 1, 1 + r() * 4);
  }
  return tex(c, true);
}

/** Blue dye spray line (alpha). */
export function dyeTexture() {
  const { c, g } = canvas(256, 32);
  const r = rng(11);
  for (let i = 0; i < 1400; i++) {
    const x = r() * 256, y = 16 + (r() - 0.5) * (8 + r() * 20);
    g.fillStyle = `rgba(30,90,220,${0.15 + r() * 0.5})`;
    g.beginPath(); g.arc(x, y, 0.6 + r() * 2.2, 0, Math.PI * 2); g.fill();
  }
  return tex(c, true);
}

export function fenceTexture() {
  const { c, g } = canvas(128, 64);
  g.clearRect(0, 0, 128, 64);
  g.strokeStyle = '#ff6a1f'; g.lineWidth = 3;
  for (let x = -64; x < 192; x += 12) {
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 32, 64); g.stroke();
    g.beginPath(); g.moveTo(x + 32, 0); g.lineTo(x, 64); g.stroke();
  }
  g.fillStyle = '#ff6a1f'; g.fillRect(0, 0, 128, 4); g.fillRect(0, 60, 128, 4);
  return tex(c, true);
}

/** Fictional sponsor banners. */
export const SPONSORS: { word: string; bg: string; fg: string; accent?: string; font?: string }[] = [
  { word: 'KNUCKLE HUCK', bg: '#0f1c30', fg: '#ffffff', accent: '#ff5a1f' },
  { word: 'HAVEANAPP', bg: '#ff5a1f', fg: '#ffffff', accent: '#0f1c30' },
  { word: 'FROSTBYTE', bg: '#e9eef5', fg: '#0f1c30', accent: '#2bc4ff' },
  { word: 'SUMMIT SODA', bg: '#d8f34a', fg: '#101820' },
  { word: 'POW DEPT.', bg: '#2b59c3', fg: '#ffffff', accent: '#ffd23f' },
  { word: 'KNUX', bg: '#101820', fg: '#d8f34a' },
  { word: 'DROP-IN RADIO', bg: '#ffffff', fg: '#ff3e7f', accent: '#101820' },
  { word: 'GRAVITY TAX', bg: '#1b1d21', fg: '#ffffff', accent: '#ff5a1f' },
];

export function bannerTexture(i: number, w = 512, h = 128) {
  const s = SPONSORS[i % SPONSORS.length];
  const { c, g } = canvas(w, h);
  g.fillStyle = s.bg; g.fillRect(0, 0, w, h);
  if (s.accent) { g.fillStyle = s.accent; g.fillRect(0, h - 14, w, 14); g.fillRect(0, 0, w, 6); }
  g.fillStyle = s.fg;
  g.font = `${Math.floor(h * 0.62)}px Anton, Impact, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(s.word, w / 2, h * 0.5);
  return tex(c);
}

/** The big start-arch / finish banner. */
export function archTexture(text: string, sub: string) {
  const { c, g } = canvas(1024, 192);
  g.fillStyle = '#0f1c30'; g.fillRect(0, 0, 1024, 192);
  g.fillStyle = '#ff5a1f'; g.fillRect(0, 0, 1024, 12); g.fillRect(0, 180, 1024, 12);
  g.fillStyle = '#ffffff';
  g.font = '120px Anton, Impact, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 512, 92);
  g.font = '30px "Barlow Condensed", sans-serif';
  g.fillStyle = '#7fd3ff';
  g.fillText(sub, 512, 160);
  return tex(c);
}

export function signTexture(text: string, bg = '#ffffff', fg = '#0f1c30') {
  const { c, g } = canvas(256, 96);
  g.fillStyle = bg; g.fillRect(0, 0, 256, 96);
  g.fillStyle = fg; g.font = '58px Anton, Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 50);
  return tex(c);
}

export function skyTexture() {
  const { c, g } = canvas(4, 256);
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#1b4f9c');
  grd.addColorStop(0.45, '#5d97d6');
  grd.addColorStop(0.62, '#b9d6f0');
  grd.addColorStop(0.7, '#e6f0f8');
  grd.addColorStop(1, '#e6f0f8');
  g.fillStyle = grd; g.fillRect(0, 0, 4, 256);
  return tex(c);
}

export function flakeTexture() {
  const { c, g } = canvas(32, 32);
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.7)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 32, 32);
  return tex(c);
}

/** Board base/top graphic. Long axis = canvas x. */
export function boardTexture(b: BoardDef, sticker?: ColorItem, top = false) {
  const W = 512, H = 128;
  const { c, g } = canvas(W, H);
  const [a, bcol, ccol] = b.graphic.colors;
  g.fillStyle = a; g.fillRect(0, 0, W, H);
  const r = rng(b.id.length * 97 + (top ? 5 : 0));
  switch (b.graphic.style) {
    case 'stripes':
      for (let i = 0; i < 9; i++) { g.fillStyle = i % 2 ? bcol : ccol; g.fillRect(150 + i * 24, 0, 12, H); }
      break;
    case 'chevron':
      g.fillStyle = bcol;
      for (let i = 0; i < 6; i++) { g.beginPath(); const x = 80 + i * 60; g.moveTo(x, 0); g.lineTo(x + 40, H / 2); g.lineTo(x, H); g.lineTo(x + 20, H); g.lineTo(x + 60, H / 2); g.lineTo(x + 20, 0); g.fill(); }
      g.fillStyle = ccol; g.fillRect(0, H / 2 - 3, W, 6);
      break;
    case 'dots':
      for (let i = 0; i < 70; i++) { g.fillStyle = r() > 0.5 ? bcol : ccol; g.beginPath(); g.arc(r() * W, r() * H, 6 + r() * 18, 0, Math.PI * 2); g.fill(); }
      break;
    case 'flame': {
      g.fillStyle = bcol;
      g.beginPath(); g.moveTo(W, 0);
      for (let x = W; x > 120; x -= 30) g.quadraticCurveTo(x - 15, (x / 30) % 2 ? 10 : 50, x - 30, 64 + Math.sin(x) * 30);
      g.lineTo(120, H); g.lineTo(W, H); g.fill();
      g.fillStyle = ccol;
      g.beginPath(); g.moveTo(W, 30);
      for (let x = W; x > 220; x -= 26) g.quadraticCurveTo(x - 13, 40, x - 26, 64 + Math.cos(x) * 20);
      g.lineTo(220, 100); g.lineTo(W, 100); g.fill();
      break;
    }
    case 'grid':
      g.strokeStyle = bcol; g.lineWidth = 3;
      for (let x = 0; x < W; x += 22) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
      for (let y = 0; y < H; y += 22) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
      g.fillStyle = ccol; g.fillRect(W * 0.42, 0, W * 0.16, H);
      break;
    case 'split':
      g.fillStyle = bcol; g.fillRect(W / 2, 0, W / 2, H);
      g.fillStyle = ccol; g.beginPath(); g.arc(W / 2, H / 2, 40, 0, Math.PI * 2); g.fill();
      break;
    case 'stars':
      for (let i = 0; i < 90; i++) { g.fillStyle = r() > 0.85 ? ccol : bcol; const s = 1 + r() * 3; g.fillRect(r() * W, r() * H, s, s); }
      g.fillStyle = ccol; g.beginPath(); g.arc(W * 0.7, H * 0.45, 26, 0, Math.PI * 2); g.fill();
      g.fillStyle = a; g.beginPath(); g.arc(W * 0.7 + 10, H * 0.4, 22, 0, Math.PI * 2); g.fill();
      break;
    case 'wordmark':
    default:
      g.fillStyle = bcol; g.fillRect(0, H * 0.3, W, H * 0.4);
      g.fillStyle = ccol; g.fillRect(0, H * 0.3, W, 5); g.fillRect(0, H * 0.7 - 5, W, 5);
      break;
  }
  const word = b.graphic.word ?? b.name.toUpperCase();
  g.save();
  g.font = `${top ? 46 : 64}px Anton, Impact, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = top ? bcol : (b.graphic.style === 'wordmark' ? a : '#ffffff');
  g.globalAlpha = top ? 0.85 : 0.95;
  g.fillText(word, W / 2, H / 2 + 2);
  g.restore();
  if (sticker && sticker.colors.length && top) drawSticker(g, sticker, W * 0.18, H * 0.5, 30);
  if (sticker && sticker.colors.length && !top) drawSticker(g, sticker, W * 0.84, H * 0.5, 26);
  return tex(c);
}

export function drawSticker(g: CanvasRenderingContext2D, s: ColorItem, x: number, y: number, r: number) {
  const [a, b] = s.colors;
  g.save();
  g.translate(x, y); g.rotate(-0.2);
  g.fillStyle = a;
  if (s.id === 's-smile') {
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = b; g.beginPath(); g.arc(-r * 0.35, -r * 0.2, r * 0.12, 0, 7); g.arc(r * 0.35, -r * 0.2, r * 0.12, 0, 7); g.fill();
    g.lineWidth = r * 0.12; g.strokeStyle = b; g.beginPath(); g.arc(0, r * 0.05, r * 0.55, 0.2, Math.PI - 0.2); g.stroke();
  } else if (s.id === 's-skull') {
    g.beginPath(); g.arc(0, -r * 0.15, r * 0.8, 0, Math.PI * 2); g.fill(); g.fillRect(-r * 0.45, r * 0.3, r * 0.9, r * 0.5);
    g.fillStyle = b; g.beginPath(); g.arc(-r * 0.32, -r * 0.15, r * 0.22, 0, 7); g.arc(r * 0.32, -r * 0.15, r * 0.22, 0, 7); g.fill();
  } else {
    const text = s.id === 's-haa' ? 'HAA' : s.id === 's-knux' ? 'KNUX' : 'POW';
    g.beginPath(); g.roundRect(-r * 1.3, -r * 0.6, r * 2.6, r * 1.2, r * 0.3); g.fill();
    g.fillStyle = b; g.font = `${r * 0.9}px Anton, Impact, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 0, r * 0.05);
  }
  g.restore();
}

/** Cloth pattern for jackets and pants. */
export function clothTexture(item: ColorItem) {
  const [a, b = a] = item.colors;
  const { c, g } = canvas(128, 128);
  g.fillStyle = a; g.fillRect(0, 0, 128, 128);
  const r = rng(item.id.length * 31);
  switch (item.pattern) {
    case 'camo':
      for (let i = 0; i < 26; i++) { g.fillStyle = i % 2 ? b : shade(a, -18); g.beginPath(); g.ellipse(r() * 128, r() * 128, 8 + r() * 18, 5 + r() * 12, r() * 3, 0, 7); g.fill(); }
      break;
    case 'plaid':
      g.globalAlpha = 0.55; g.fillStyle = b;
      for (let x = 0; x < 128; x += 32) { g.fillRect(x, 0, 12, 128); g.fillRect(0, x, 128, 12); }
      g.globalAlpha = 0.4; g.fillStyle = '#ffffff';
      for (let x = 20; x < 128; x += 32) { g.fillRect(x, 0, 2, 128); g.fillRect(0, x, 128, 2); }
      g.globalAlpha = 1;
      break;
    case 'block':
      g.fillStyle = b; g.fillRect(0, 50, 128, 28);
      g.fillStyle = shade(a, -25); g.fillRect(0, 78, 128, 6);
      break;
    case 'stripe':
      g.fillStyle = b; g.fillRect(0, 40, 128, 10); g.fillRect(0, 80, 128, 10);
      g.fillStyle = '#cfd8e3'; g.fillRect(0, 44, 128, 3); g.fillRect(0, 84, 128, 3);
      break;
    case 'tiedye':
      for (let i = 0; i < 9; i++) { g.strokeStyle = i % 3 === 0 ? b : i % 3 === 1 ? '#ffd23f' : a; g.lineWidth = 9; g.beginPath(); g.arc(64, 64, 8 + i * 10, 0, 7); g.stroke(); }
      break;
    case 'denim':
      for (let y = 0; y < 128; y += 2) { g.fillStyle = y % 4 ? b : a; g.fillRect(0, y, 128, 1); }
      break;
    default:
      for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.06})`; g.fillRect(r() * 128, r() * 128, 2, 2); }
      // seam
      g.fillStyle = shade(a, -20); g.fillRect(0, 62, 128, 3);
  }
  return tex(c, true);
}

export function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const gg = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `#${((r << 16) | (gg << 8) | b).toString(16).padStart(6, '0')}`;
}

/** Three-step toon ramp. */
export function toonRamp() {
  const data = new Uint8Array([90, 170, 255]);
  const t = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}
