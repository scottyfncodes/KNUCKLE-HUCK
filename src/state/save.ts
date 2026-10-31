/** Persistent player progress. localStorage, guarded for private mode. */
import { BINDINGS, BOARDS, DEFAULT_LOADOUT, SLOTS, levelForXp, type Loadout, type Unlock } from '../data/gear';

export interface Settings {
  master: number; music: number; sfx: number; announcer: boolean; voice: boolean;
  quality: 'auto' | 'low' | 'high'; haptics: boolean; showTutorialHints: boolean; leftHanded: boolean;
}

export interface SaveData {
  version: 1;
  name: string;
  xp: number;
  loadout: Loadout;
  challengesDone: string[];
  achievements: string[];
  signatures: string[];
  bestTrick: { name: string; score: number } | null;
  best: { jam: number; attack: number; free: number };
  attackLevel: number;          // highest unlocked score-attack level
  daily: Record<string, number>; // date -> best
  totalRuns: number;
  totalLanded: number;
  tutorialDone: boolean;
  settings: Settings;
  jamHistory: { date: string; score: number; place: number }[];
}

const KEY = 'knucklehuck.save.v1';

export function defaultSave(): SaveData {
  return {
    version: 1, name: 'YOU', xp: 0, loadout: { ...DEFAULT_LOADOUT }, challengesDone: [], achievements: [], signatures: [],
    bestTrick: null, best: { jam: 0, attack: 0, free: 0 }, attackLevel: 1, daily: {}, totalRuns: 0, totalLanded: 0,
    tutorialDone: false,
    settings: { master: 0.8, music: 0.55, sfx: 0.9, announcer: true, voice: true, quality: 'auto', haptics: true, showTutorialHints: true, leftHanded: false },
    jamHistory: [],
  };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const d = JSON.parse(raw);
    const def = defaultSave();
    return { ...def, ...d, loadout: { ...def.loadout, ...d.loadout }, settings: { ...def.settings, ...d.settings }, best: { ...def.best, ...d.best } };
  } catch { return defaultSave(); }
}

export function writeSave(d: SaveData) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* storage unavailable: play on */ }
}

export function playerLevel(d: SaveData) { return levelForXp(d.xp); }

export function isUnlocked(d: SaveData, u?: Unlock) {
  if (!u) return true;
  if (u.level && playerLevel(d).level < u.level) return false;
  if (u.challenge && !d.challengesDone.includes(u.challenge)) return false;
  if (u.achievement && !d.achievements.includes(u.achievement)) return false;
  return true;
}

export function unlockLabel(u?: Unlock) {
  if (!u) return '';
  if (u.level) return `Reach level ${u.level}`;
  if (u.challenge) return 'Complete a challenge';
  if (u.achievement === 'unreal') return 'Max out the Sick Meter';
  if (u.achievement === 'jamwin') return 'Win a Big Air Jam';
  return 'Locked';
}

/** Everything that became unlocked between two saves (for "NEW GEAR" toasts). */
export function newlyUnlocked(before: SaveData, after: SaveData): string[] {
  const out: string[] = [];
  for (const b of BOARDS) if (!isUnlocked(before, b.unlock) && isUnlocked(after, b.unlock)) out.push(`Board: ${b.name}`);
  for (const b of BINDINGS) if (!isUnlocked(before, b.unlock) && isUnlocked(after, b.unlock)) out.push(`Bindings: ${b.name}`);
  for (const [slot, items] of Object.entries(SLOTS)) {
    for (const i of items) if (!isUnlocked(before, i.unlock) && isUnlocked(after, i.unlock)) out.push(`${slot[0].toUpperCase() + slot.slice(1)}: ${i.name}`);
  }
  return out;
}
