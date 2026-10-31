import type { RunScore } from '../scoring/scoring';

export interface Challenge {
  id: string; name: string; desc: string; reward: string;
  test: (s: RunScore, history: RunScore[]) => boolean;
}

const landed = (s: RunScore) => s.landing.grade !== 'crash';

export const CHALLENGES: Challenge[] = [
  { id: 'firstair', name: 'Send It', desc: 'Land anything off the knuckle with 2+ seconds of air.', reward: 'XP +500',
    test: s => landed(s) && s.trick.airTime >= 2 },
  { id: 'perfect', name: 'Pop Science', desc: 'Get a PERFECT pop and ride away clean.', reward: 'Smoke goggles',
    test: s => s.pop?.timing === 'perfect' && (s.landing.grade === 'clean' || s.landing.grade === 'stomped') },
  { id: 'method720', name: 'The Classic', desc: 'Land a 720 with a Method grab.', reward: 'Knuckle Dragger board',
    test: s => landed(s) && s.trick.spinDeg === 720 && s.trick.grabs.some(g => g.id === 'method') },
  { id: 'late360', name: 'Fashionably Late', desc: 'Land a late 360 — start spinning after the apex.', reward: 'Liftie Hi-Vis jacket',
    test: s => landed(s) && s.trick.late && s.trick.spinDeg >= 360 },
  { id: 'threegrabs', name: 'Grab Bag', desc: 'Land three different grabs in one trick.', reward: 'Woodland camo pants',
    test: s => landed(s) && new Set(s.trick.grabs.map(g => g.id)).size >= 3 },
  { id: 'switch', name: 'Other Foot', desc: 'Hit the knuckle switch and land a spin.', reward: 'Double Agent board',
    test: s => landed(s) && s.trick.switchTakeoff && s.trick.spinDeg >= 180 },
  { id: 'cork', name: 'Pop the Cork', desc: 'Land any off-axis cork or rodeo.', reward: 'Chrome helmet',
    test: s => landed(s) && s.trick.offAxis },
  { id: 'nodupes', name: 'No Repeats', desc: 'Land three tricks in a row, all different.', reward: 'Tall tee',
    test: (s, h) => {
      const last = [...h, s].slice(-3);
      return last.length === 3 && last.every(landed) && new Set(last.map(x => x.trick.signature)).size === 3;
    } },
  { id: 'stomp', name: 'Stomp It', desc: 'Get a STOMPED landing in the sweet spot.', reward: 'XP +800',
    test: s => s.landing.grade === 'stomped' },
  { id: 'double', name: 'Double Trouble', desc: 'Land any double flip.', reward: 'Skull sticker',
    test: s => landed(s) && s.trick.flips >= 2 },
  { id: 'ten80', name: 'Ten-Eighty', desc: 'Land a 1080 or bigger.', reward: 'XP +1500',
    test: s => landed(s) && s.trick.spinDeg >= 1080 },
  { id: 'nollie', name: 'Nose First', desc: 'Nollie off the knuckle (nose press, then pop) and land a spin.', reward: 'XP +600',
    test: s => landed(s) && s.trick.pressPop === 'nose' && s.trick.spinDeg >= 180 },
];

export function challengeById(id: string) { return CHALLENGES.find(c => c.id === id); }

export interface ScoreAttackLevel { id: number; name: string; target: number; attempts: number }
export const SCORE_ATTACK: ScoreAttackLevel[] = [
  { id: 1, name: 'Warm-Up Lap', target: 6000, attempts: 3 },
  { id: 2, name: 'Practice Session', target: 12000, attempts: 3 },
  { id: 3, name: 'Qualifier', target: 20000, attempts: 3 },
  { id: 4, name: 'Semi-Final', target: 30000, attempts: 3 },
  { id: 5, name: 'Final', target: 42000, attempts: 3 },
  { id: 6, name: 'Legend Status', target: 60000, attempts: 3 },
];

/** Fictional Jam rivals. Scores are seeded per session. */
export const RIVALS = [
  { name: 'Mika "Mayday" Lund', country: 'NOR' },
  { name: 'Theo Barrault', country: 'FRA' },
  { name: 'Kenji Arakawa', country: 'JPN' },
  { name: 'Dani Okafor', country: 'CAN' },
  { name: 'Rhys "Gumby" Talbot', country: 'NZL' },
  { name: 'Sasha Ivers', country: 'USA' },
  { name: 'Lotte van Dam', country: 'NED' },
];
