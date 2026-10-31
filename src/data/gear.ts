/**
 * Equipment and cosmetics. Boards and bindings change handling; the rest is
 * look. All brands here are fictional.
 */
import type { BoardStats } from '../physics/rider';

export interface Unlock { level?: number; challenge?: string; achievement?: string }

export interface BoardDef {
  id: string; name: string; blurb: string;
  stats: BoardStats;
  graphic: { style: 'stripes' | 'chevron' | 'dots' | 'flame' | 'grid' | 'split' | 'wordmark' | 'stars'; colors: string[]; word?: string };
  unlock?: Unlock;
}

export const BOARDS: BoardDef[] = [
  { id: 'stock', name: 'Rental Hero', blurb: 'Does everything okay. Smells like the rental shop.',
    stats: { pop: 1.0, flex: 0.5, stability: 0.5, spin: 1.0, forgiveness: 0.55 },
    graphic: { style: 'wordmark', colors: ['#e9eef5', '#1d2b46', '#ff5a1f'], word: 'HUCK' } },
  { id: 'twig', name: 'Twig 147', blurb: 'Soft, short, spins like a top. Gets loose at speed.',
    stats: { pop: 0.95, flex: 0.2, stability: 0.3, spin: 1.2, forgiveness: 0.7 },
    graphic: { style: 'dots', colors: ['#ffd23f', '#1a1a1a', '#ff3e7f'] }, unlock: { level: 2 } },
  { id: 'gun', name: 'Big Mountain Gun', blurb: 'Stiff and planted. Huge pop, slow to wind up.',
    stats: { pop: 1.18, flex: 0.9, stability: 0.9, spin: 0.85, forgiveness: 0.35 },
    graphic: { style: 'chevron', colors: ['#0f1c30', '#7fd3ff', '#ffffff'] }, unlock: { level: 4 } },
  { id: 'knuckle', name: 'Knuckle Dragger', blurb: 'Built for this exact jump. Balanced pop, buttery landings.',
    stats: { pop: 1.08, flex: 0.45, stability: 0.65, spin: 1.05, forgiveness: 0.75 },
    graphic: { style: 'flame', colors: ['#14213d', '#ff5a1f', '#ffd23f'] }, unlock: { challenge: 'method720' } },
  { id: 'grid', name: 'Gridlock', blurb: 'Snappy torsion. The rotation nerd\'s pick.',
    stats: { pop: 1.02, flex: 0.6, stability: 0.55, spin: 1.15, forgiveness: 0.5 },
    graphic: { style: 'grid', colors: ['#d8f34a', '#101820', '#ffffff'] }, unlock: { level: 6 } },
  { id: 'split', name: 'Double Agent', blurb: 'True twin. Rides switch like it\'s regular.',
    stats: { pop: 1.05, flex: 0.5, stability: 0.6, spin: 1.1, forgiveness: 0.65 },
    graphic: { style: 'split', colors: ['#ff3e7f', '#2b59c3', '#ffffff'] }, unlock: { challenge: 'switch' } },
  { id: 'stars', name: 'Night Shift', blurb: 'Pro model. Everything turned up a notch.',
    stats: { pop: 1.15, flex: 0.55, stability: 0.75, spin: 1.15, forgiveness: 0.6 },
    graphic: { style: 'stars', colors: ['#0b0f1e', '#c9d6ff', '#ff5a1f'] }, unlock: { level: 9 } },
  { id: 'plank', name: 'The Plank', blurb: 'Vintage 2001 freestyle stick. Unholy pop. Zero mercy.',
    stats: { pop: 1.25, flex: 0.75, stability: 0.7, spin: 1.0, forgiveness: 0.2 },
    graphic: { style: 'stripes', colors: ['#f2e8cf', '#bc4749', '#386641'] }, unlock: { achievement: 'unreal' } },
];

export interface BindingDef { id: string; name: string; blurb: string; response: number; forgiveness: number; stability: number; unlock?: Unlock }
export const BINDINGS: BindingDef[] = [
  { id: 'std', name: 'Strap-Ins', blurb: 'Medium everything.', response: 1.0, forgiveness: 0, stability: 0 },
  { id: 'surf', name: 'Surfy Highbacks', blurb: 'Loose and forgiving. Slower to whip.', response: 0.88, forgiveness: 0.15, stability: -0.05, unlock: { level: 3 } },
  { id: 'race', name: 'Locked-In', blurb: 'Instant response. Punishes sloppy landings.', response: 1.18, forgiveness: -0.12, stability: 0.1, unlock: { level: 5 } },
  { id: 'step', name: 'Boa Step-Ons', blurb: 'Snappy and stable.', response: 1.08, forgiveness: 0.05, stability: 0.08, unlock: { level: 8 } },
];

export interface ColorItem { id: string; name: string; colors: string[]; pattern?: string; unlock?: Unlock }

export const JACKETS: ColorItem[] = [
  { id: 'j-glacier', name: 'Glacier Shell', colors: ['#2f6fb5', '#e9eef5'] },
  { id: 'j-blaze', name: 'Blaze Anorak', colors: ['#ff5a1f', '#1a1a1a'] },
  { id: 'j-char', name: 'Charcoal Puff', colors: ['#34383f', '#d8f34a'] },
  { id: 'j-camo', name: 'Snow Camo', colors: ['#e7ecef', '#9aa7b4'], pattern: 'camo', unlock: { level: 2 } },
  { id: 'j-plaid', name: 'Lumberjack Flannel', colors: ['#b0302c', '#1b1b1b'], pattern: 'plaid', unlock: { level: 3 } },
  { id: 'j-teal', name: '\'02 Teal Pullover', colors: ['#1ba39c', '#f2e8cf'], pattern: 'block', unlock: { level: 4 } },
  { id: 'j-purple', name: 'Grape Soda', colors: ['#6b3fa0', '#ffd23f'], pattern: 'block', unlock: { level: 5 } },
  { id: 'j-hivis', name: 'Liftie Hi-Vis', colors: ['#d8f34a', '#2b2b2b'], pattern: 'stripe', unlock: { challenge: 'late360' } },
  { id: 'j-tie', name: 'Tie-Dye Tee Over Jacket', colors: ['#ff3e7f', '#2bc4ff'], pattern: 'tiedye', unlock: { level: 7 } },
  { id: 'j-gold', name: 'Podium Gold', colors: ['#d4a017', '#1a1a1a'], unlock: { achievement: 'jamwin' } },
];
export const PANTS: ColorItem[] = [
  { id: 'p-navy', name: 'Navy Cargos', colors: ['#1d2b46'] },
  { id: 'p-khaki', name: 'Work Pant Khaki', colors: ['#b7a57a'] },
  { id: 'p-white', name: 'Bright White Baggies', colors: ['#eef2f6'], unlock: { level: 2 } },
  { id: 'p-black', name: 'Black Bibs', colors: ['#1b1d21'], unlock: { level: 3 } },
  { id: 'p-olive', name: 'Olive Drab', colors: ['#5b6b3a'], unlock: { level: 4 } },
  { id: 'p-orange', name: 'Safety Orange', colors: ['#ff5a1f'], unlock: { level: 6 } },
  { id: 'p-camo', name: 'Woodland Camo', colors: ['#4b5a35', '#2a2e22'], pattern: 'camo', unlock: { challenge: 'threegrabs' } },
  { id: 'p-denim', name: 'Snow Denim', colors: ['#3d5a8a', '#2a3f63'], pattern: 'denim', unlock: { level: 8 } },
];
export const HELMETS: ColorItem[] = [
  { id: 'h-white', name: 'Matte White', colors: ['#e9eef5'] },
  { id: 'h-black', name: 'Matte Black', colors: ['#202226'] },
  { id: 'h-orange', name: 'Signal Orange', colors: ['#ff5a1f'], unlock: { level: 2 } },
  { id: 'h-lime', name: 'Acid Lime', colors: ['#d8f34a'], unlock: { level: 3 } },
  { id: 'h-blue', name: 'Alpine Blue', colors: ['#2f6fb5'], unlock: { level: 4 } },
  { id: 'h-beanie', name: 'Beanie Over Lid', colors: ['#c0392b', '#f2e8cf'], pattern: 'beanie', unlock: { level: 5 } },
  { id: 'h-chrome', name: 'Chrome Dome', colors: ['#cfd8e3'], pattern: 'chrome', unlock: { challenge: 'cork' } },
  { id: 'h-pom', name: 'Pom-Pom Beanie', colors: ['#2bc4ff', '#ffffff'], pattern: 'pom', unlock: { level: 7 } },
];
export const GOGGLES: ColorItem[] = [
  { id: 'g-orange', name: 'Persimmon Lens', colors: ['#ff8a3d', '#1a1a1a'] },
  { id: 'g-mirror', name: 'Blue Mirror', colors: ['#3fa9ff', '#e9eef5'] },
  { id: 'g-gold', name: 'Gold Chrome', colors: ['#f2c14e', '#1a1a1a'], unlock: { level: 2 } },
  { id: 'g-rose', name: 'Rose Tint', colors: ['#ff6fa3', '#ffffff'], unlock: { level: 4 } },
  { id: 'g-green', name: 'Emerald', colors: ['#2ee59d', '#202020'], unlock: { level: 6 } },
  { id: 'g-dark', name: 'Smoke', colors: ['#2a2d33', '#ff5a1f'], unlock: { challenge: 'perfect' } },
];
export const GLOVES: ColorItem[] = [
  { id: 'gl-black', name: 'Black Mitts', colors: ['#1b1d21'] },
  { id: 'gl-tan', name: 'Leather Work Gloves', colors: ['#b98b5a'] },
  { id: 'gl-orange', name: 'Orange Pipes', colors: ['#ff5a1f'], unlock: { level: 2 } },
  { id: 'gl-white', name: 'White Pogies', colors: ['#eef2f6'], unlock: { level: 3 } },
  { id: 'gl-lime', name: 'Lime Lobsters', colors: ['#d8f34a'], unlock: { level: 5 } },
  { id: 'gl-pink', name: 'Hot Pink', colors: ['#ff3e7f'], unlock: { level: 7 } },
];
export const ACCESSORIES: ColorItem[] = [
  { id: 'a-none', name: 'Nothing Extra', colors: [] },
  { id: 'a-gaiter', name: 'Neck Gaiter', colors: ['#1d2b46'] },
  { id: 'a-bandana', name: 'Bandana', colors: ['#c0392b'], unlock: { level: 2 } },
  { id: 'a-pack', name: 'Mini Backpack', colors: ['#202226', '#ff5a1f'], unlock: { level: 4 } },
  { id: 'a-hood', name: 'Hood Up', colors: ['#7a7f87'], unlock: { level: 5 } },
  { id: 'a-tall', name: 'Tall Tee', colors: ['#f2f2f2'], unlock: { challenge: 'nodupes' } },
];
export const STICKERS: ColorItem[] = [
  { id: 's-none', name: 'Bare', colors: [] },
  { id: 's-haa', name: 'HaveAnApp', colors: ['#ff5a1f', '#ffffff'] },
  { id: 's-knux', name: 'KNUX', colors: ['#d8f34a', '#101820'], unlock: { level: 2 } },
  { id: 's-pow', name: 'Pow Dept.', colors: ['#2bc4ff', '#ffffff'], unlock: { level: 3 } },
  { id: 's-smile', name: 'Smiley', colors: ['#ffd23f', '#1a1a1a'], unlock: { level: 5 } },
  { id: 's-skull', name: 'Skull', colors: ['#ffffff', '#1a1a1a'], unlock: { challenge: 'double' } },
];

export const SLOTS = {
  jacket: JACKETS, pants: PANTS, helmet: HELMETS, goggles: GOGGLES, gloves: GLOVES, accessory: ACCESSORIES, sticker: STICKERS,
} as const;
export type CosmeticSlot = keyof typeof SLOTS;

export interface Loadout {
  board: string; binding: string;
  jacket: string; pants: string; helmet: string; goggles: string; gloves: string; accessory: string; sticker: string;
}
export const DEFAULT_LOADOUT: Loadout = {
  board: 'stock', binding: 'std', jacket: 'j-glacier', pants: 'p-navy', helmet: 'h-white', goggles: 'g-orange', gloves: 'gl-black', accessory: 'a-gaiter', sticker: 's-haa',
};

export function boardById(id: string) { return BOARDS.find(b => b.id === id) ?? BOARDS[0]; }
export function bindingById(id: string) { return BINDINGS.find(b => b.id === id) ?? BINDINGS[0]; }
export function itemById(slot: CosmeticSlot, id: string): ColorItem { const l = SLOTS[slot] as ColorItem[]; return l.find(i => i.id === id) ?? l[0]; }

export function effectiveStats(l: Loadout): { board: BoardStats; response: number } {
  const b = boardById(l.board).stats; const bi = bindingById(l.binding);
  return {
    board: { ...b, forgiveness: clamp01(b.forgiveness + bi.forgiveness), stability: clamp01(b.stability + bi.stability) },
    response: bi.response,
  };
}
function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }

/** XP needed for each level */
export function levelForXp(xp: number) {
  let lvl = 1, need = 1500, acc = 0;
  while (xp >= acc + need) { acc += need; lvl++; need = Math.round(need * 1.28); }
  return { level: lvl, into: xp - acc, need };
}
