/**
 * Scoring. Transparent categories, a combo multiplier and the Sick Meter.
 */
import type { PopResult } from '../physics/rider';
import type { TrickSummary } from '../tricks/tricks';

export type LandingGrade = 'stomped' | 'clean' | 'sketchy' | 'crash';

export interface LandingResult {
  grade: LandingGrade;
  impact: number;
  zone: 'deck' | 'knuckle' | 'sweet' | 'flat' | 'side';
  yawErr: number;
  flipErr: number;
  grabbing: boolean;
  prepared: boolean;
  reason: string;
}

export interface ScoreLine { label: string; value: number; detail: string }

export interface RunScore {
  trick: TrickSummary;
  landing: LandingResult;
  pop: PopResult | null;
  height: number;
  categories: {
    amplitude: number; difficulty: number; style: number; creativity: number; progression: number;
  };
  lines: ScoreLine[];
  execution: number;      // multiplier from pop + landing
  executionLabel: string;
  combo: number;          // combo multiplier
  comboElements: string[];
  sick: number;           // sick multiplier
  base: number;
  total: number;
  sickDelta: number;
  newTricks: string[];    // novelty notes
}

export interface SessionMemory {
  signatures: string[];        // this session, in order
  names: Set<string>;
  bestDifficulty: number;
  grabsUsed: Set<string>;
  lifetimeSignatures: Set<string>;
}

export function newSessionMemory(lifetime: Iterable<string> = []): SessionMemory {
  return { signatures: [], names: new Set(), bestDifficulty: 0, grabsUsed: new Set(), lifetimeSignatures: new Set(lifetime) };
}

export function evaluateLanding(
  impact: number, zone: LandingResult['zone'], yawErr: number, flipErr: number,
  grabbing: boolean, neutralTime: number, forgiveness: number, stability: number,
): LandingResult {
  const f = 1 + forgiveness * 0.45;
  const prepared = neutralTime >= 0.12 && !grabbing;
  const impactLimitClean = (11.5 + stability * 2.5) * f;
  const impactLimitSketch = (16 + stability * 3) * f;
  let grade: LandingGrade = 'clean';
  let reason = 'Rode away clean';
  const yawClean = 16 * f, yawSketch = 42 * f;
  const flipClean = 22 * f, flipSketch = 55 * f;

  if (flipErr > flipSketch) { grade = 'crash'; reason = flipErr > 120 ? 'Landed on the head' : 'Under-rotated the flip'; }
  else if (yawErr > yawSketch) { grade = 'crash'; reason = yawErr > 70 ? 'Landed sideways' : 'Caught an edge'; }
  else if (impact > impactLimitSketch) { grade = 'crash'; reason = zone === 'flat' ? 'Flat-bottomed it' : zone === 'deck' ? 'Cased the deck' : 'Too much impact'; }
  else {
    if (yawErr > yawClean) { grade = 'sketchy'; reason = 'Skidded out the rotation'; }
    if (flipErr > flipClean) { grade = 'sketchy'; reason = 'Hand drag on the flip'; }
    if (impact > impactLimitClean) { grade = 'sketchy'; reason = zone === 'flat' ? 'Overshot to flat' : 'Heavy landing'; }
    if (grabbing) { grade = 'sketchy'; reason = 'Still grabbing at touchdown'; }
    if (grade === 'clean' && (zone === 'deck' || zone === 'knuckle')) { grade = 'sketchy'; reason = zone === 'deck' ? 'Knuckled it — landed on the deck' : 'Landed on the knuckle'; }
    if (grade === 'clean' && zone === 'side') { grade = 'sketchy'; reason = 'Off the side'; }
    if (grade === 'clean' && prepared && zone === 'sweet' && impact < impactLimitClean * 0.72 && yawErr < 5 && flipErr < 6) {
      grade = 'stomped'; reason = 'Stomped in the sweet spot';
    }
    if (grade === 'clean' && !prepared) reason = 'Clean, a little late on the prep';
  }
  return { grade, impact, zone, yawErr, flipErr, grabbing, prepared, reason };
}

const POP_MULT: Record<string, [number, string]> = {
  perfect: [1.15, 'Perfect pop'],
  good: [1.0, 'Good pop'],
  early: [0.88, 'Early pop'],
  late: [0.88, 'Late pop'],
  'way-early': [0.74, 'Way early'],
  'way-late': [0.74, 'Way late'],
  none: [0.7, 'No pop'],
};
const LAND_MULT: Record<LandingGrade, number> = { stomped: 1.15, clean: 1.0, sketchy: 0.55, crash: 0 };

export function scoreRun(
  trick: TrickSummary, landing: LandingResult, pop: PopResult | null, height: number,
  mem: SessionMemory, sickLevel: number, bonus?: { grab?: string; mult?: number },
): RunScore {
  const lines: ScoreLine[] = [];
  const newTricks: string[] = [];

  // Amplitude
  const amplitude = Math.round(Math.max(0, height) * 42 + trick.airTime * 110);

  // Difficulty
  const halves = trick.spinDeg / 180;
  let difficulty = halves > 0 ? 160 * Math.pow(halves, 1.28) : 0;
  difficulty += trick.flips > 0 ? 520 * Math.pow(trick.flips, 1.35) : 0;
  if (trick.offAxis) difficulty *= 1.25;
  if (trick.switchTakeoff) difficulty *= 1.15;
  if (trick.late) difficulty += 120 + halves * 40;
  difficulty = Math.round(difficulty);

  // Style
  let style = 0;
  const distinctGrabs = new Set(trick.grabs.map(g => g.id));
  for (const g of trick.grabs) {
    const hold = Math.min(2.2, g.duration);
    style += 120 + hold * 210 + g.tweakMax * 260;
  }
  style += Math.max(0, distinctGrabs.size - 1) * 160;
  if (trick.pressPop !== 'none') style += 110;
  if (trick.butter) style += 200;
  if (bonus?.grab && distinctGrabs.has(bonus.grab as never)) style *= bonus.mult ?? 2;
  style = Math.round(style);

  // Creativity
  let creativity = 0;
  const seenThisSession = mem.signatures.includes(trick.signature);
  const lastSig = mem.signatures[mem.signatures.length - 1];
  const notStraight = trick.spinDeg > 0 || trick.flips > 0 || trick.grabs.length > 0;
  if (notStraight && !seenThisSession) { creativity += 380; newTricks.push('New this session'); }
  if (notStraight && !mem.lifetimeSignatures.has(trick.signature)) { creativity += 260; newTricks.push('First time ever'); }
  if (trick.offAxis && trick.grabs.length) creativity += 240;
  if (trick.switchTakeoff) creativity += 160;
  if (trick.late) creativity += 160;
  if (trick.pressPop === 'nose') creativity += 120;
  if (trick.butter) creativity += 140;
  for (const g of distinctGrabs) if (!mem.grabsUsed.has(g)) { creativity += 90; }
  if (trick.direction === 'frontside' && trick.flipDir === 'front') creativity += 100;
  if (seenThisSession) creativity = Math.round(creativity * 0.4);
  creativity = Math.round(creativity);

  // Progression
  let progression = 0;
  if (difficulty > mem.bestDifficulty && landing.grade !== 'crash' && difficulty > 0) {
    progression = Math.round(200 + (difficulty - mem.bestDifficulty) * 0.35);
  }

  // Combo elements
  const comboElements: string[] = [];
  if (trick.spinDeg >= 180) comboElements.push(`${trick.spinDeg}`);
  if (trick.flips > 0) comboElements.push(trick.flips > 1 ? `${trick.flips}x flip` : 'flip');
  if (trick.offAxis) comboElements.push('off-axis');
  for (const g of trick.grabs) comboElements.push(g.id);
  if (trick.maxTweak > 0.65) comboElements.push('tweak');
  if (trick.switchTakeoff) comboElements.push('switch');
  if (trick.late) comboElements.push('late');
  if (trick.pressPop !== 'none') comboElements.push(trick.pressPop === 'nose' ? 'nollie' : 'ollie');
  if (trick.butter) comboElements.push('butter');
  const combo = Math.min(3, 1 + Math.max(0, comboElements.length - 1) * 0.2);

  const popM = pop ? POP_MULT[pop.timing] : POP_MULT.none;
  const landM = LAND_MULT[landing.grade];
  const execution = landing.grade === 'crash' ? 0 : popM[0] * landM;
  const executionLabel = `${popM[1]} · ${landing.grade === 'stomped' ? 'Stomped' : landing.grade === 'clean' ? 'Clean' : landing.grade === 'sketchy' ? 'Sketchy' : 'Bail'}`;

  const sick = sickMultiplier(sickLevel);
  const base = amplitude + difficulty + style + creativity + progression;
  const total = Math.round(base * execution * combo * sick * (bonus?.mult && !bonus.grab ? bonus.mult : 1));

  lines.push({ label: 'Amplitude', value: amplitude, detail: `${height.toFixed(1)}m · ${trick.airTime.toFixed(2)}s air` });
  lines.push({ label: 'Difficulty', value: difficulty, detail: difficultyDetail(trick) });
  lines.push({ label: 'Style', value: style, detail: trick.grabs.length ? `${trick.grabs.length} grab${trick.grabs.length > 1 ? 's' : ''}${trick.maxTweak > 0.65 ? ', tweaked' : ''}` : 'no grab' });
  lines.push({ label: 'Creativity', value: creativity, detail: seenThisSession ? 'repeat — judges yawn' : newTricks[0] ?? 'standard' });
  if (progression) lines.push({ label: 'Progression', value: progression, detail: 'beat your session best' });

  // Sick meter change
  let sickDelta = 0;
  if (landing.grade === 'crash') sickDelta = -8;
  else {
    sickDelta += landing.grade === 'stomped' ? 16 : landing.grade === 'clean' ? 11 : 3;
    sickDelta += Math.min(20, difficulty / 140);
    if (!seenThisSession && notStraight) sickDelta += 12;
    if (progression) sickDelta += 8;
    if (comboElements.length >= 3) sickDelta += 6;
    if (lastSig === trick.signature) sickDelta -= 24;
    else if (seenThisSession) sickDelta -= 10;
    if (!notStraight) sickDelta -= 6;
  }
  sickDelta = Math.round(sickDelta);

  return {
    trick, landing, pop, height,
    categories: { amplitude, difficulty, style, creativity, progression },
    lines, execution, executionLabel, combo, comboElements, sick, base, total, sickDelta, newTricks,
  };
}

function difficultyDetail(t: TrickSummary) {
  const bits: string[] = [];
  if (t.spinDeg) bits.push(`${t.spinDeg}°`);
  if (t.flips) bits.push(`${t.flips} flip${t.flips > 1 ? 's' : ''}`);
  if (t.offAxis) bits.push('off-axis');
  if (t.switchTakeoff) bits.push('switch');
  if (t.late) bits.push('late');
  return bits.join(' · ') || 'straight';
}

export function commitToMemory(mem: SessionMemory, s: RunScore) {
  mem.signatures.push(s.trick.signature);
  mem.names.add(s.trick.name);
  if (s.landing.grade !== 'crash') {
    mem.bestDifficulty = Math.max(mem.bestDifficulty, s.categories.difficulty);
    for (const g of s.trick.grabs) mem.grabsUsed.add(g.id);
    mem.lifetimeSignatures.add(s.trick.signature);
  }
}

export function sickTier(level: number): { name: string; tier: number } {
  if (level >= 100) return { name: 'UNREAL', tier: 3 };
  if (level >= 75) return { name: 'SICK', tier: 2 };
  if (level >= 45) return { name: 'HYPED', tier: 1 };
  return { name: 'WARMING UP', tier: 0 };
}
export function sickMultiplier(level: number) {
  return [1, 1.2, 1.5, 2][sickTier(level).tier];
}
