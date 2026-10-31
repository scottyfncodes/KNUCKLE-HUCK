/** Menu, results and sub-screens. Plain DOM, strong type, no component library. */
import { BINDINGS, BOARDS, SLOTS, boardById, levelForXp, type CosmeticSlot, type Loadout } from '../data/gear';
import { CHALLENGES, SCORE_ATTACK } from '../data/challenges';
import { isUnlocked, unlockLabel, type SaveData } from '../state/save';
import type { RunScore } from '../scoring/scoring';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export interface ScreenHost {
  save: SaveData;
  tap(kind?: 'tap' | 'back'): void;
  startMode(mode: 'jam' | 'attack' | 'challenge' | 'free' | 'daily', arg?: number | string): void;
  openGarage(): void;
  closeGarage(): void;
  previewLoadout(l: Loadout): void;
  commitLoadout(l: Loadout): void;
  applySettings(): void;
  resetProgress(): void;
  menu(): void;
  dailyInfo(): { date: string; title: string; desc: string; best: number; rivals: { name: string; score: number }[] };
}

export class Screens {
  root: HTMLElement;
  host: ScreenHost;
  constructor(root: HTMLElement, host: ScreenHost) { this.root = root; this.host = host; }

  clear() { this.root.innerHTML = ''; }

  private mount(html: string, cls: string) {
    this.root.innerHTML = `<div class="screen ${cls}">${html}</div>`;
    return this.root.firstElementChild as HTMLElement;
  }
  private on(el: HTMLElement, sel: string, fn: (e: HTMLElement) => void) {
    el.querySelectorAll<HTMLElement>(sel).forEach(b => b.addEventListener('click', ev => { ev.stopPropagation(); fn(b); }));
  }

  // ---------------------------------------------------------------- main menu
  menu() {
    const s = this.host.save;
    const lv = levelForXp(s.xp);
    const today = this.host.dailyInfo();
    const el = this.mount(`
      <div class="menu-top">
        <div>
          <div class="logo" aria-label="Knuckle Huck"><span class="k">KNUCKLE</span><span class="h">HUCK</span></div>
          <div class="logo-sub"><span class="sticker">Aspen-style Big Air</span><span class="sticker white" style="transform:rotate(3deg)">by HaveAnApp</span></div>
        </div>
        <div class="rider-badge">
          <div class="lvl"><small>LEVEL</small>${lv.level}</div>
          <div class="xpbar"><i style="width:${(lv.into / lv.need) * 100}%"></i></div>
          <div class="kicker">${fmt(lv.into)} / ${fmt(lv.need)} XP</div>
        </div>
      </div>
      <div class="menu-main">
        <button class="btn primary play-btn" data-go="jam"><span>Big Air Jam<small>4 attempts · best two count</small></span></button>
        <div class="mode-list">
          <button class="mode-row" data-go="attack">Score Attack <small>Level ${s.attackLevel} · hit the target</small></button>
          <button class="mode-row" data-go="challenges">Trick Challenges <small>${s.challengesDone.length}/${CHALLENGES.length} done</small></button>
          <button class="mode-row" data-go="daily">Daily Huck <span class="tag">${today.date}</span> <small>${esc(today.title)}</small></button>
          <button class="mode-row" data-go="free">Free Ride <small>no pressure, infinite laps</small></button>
        </div>
      </div>
      <div class="menu-bottom">
        <button class="btn small" data-go="garage"><span>Rider</span></button>
        <button class="btn small" data-go="boards"><span>Leaderboards</span></button>
        <button class="btn small" data-go="tutorial"><span>How to Huck</span></button>
        <button class="btn small ghost" data-go="settings"><span>Settings</span></button>
        <div class="menu-foot">${s.bestTrick ? `Best trick: ${esc(s.bestTrick.name)} · ${fmt(s.bestTrick.score)}` : 'The knuckle is the star.'}</div>
      </div>`, 'menu scrim');
    this.on(el, '[data-go]', b => {
      const g = b.dataset.go!;
      this.host.tap();
      if (g === 'jam' || g === 'free' || g === 'daily') this.host.startMode(g);
      else if (g === 'attack') this.attack();
      else if (g === 'challenges') this.challenges();
      else if (g === 'garage') this.host.openGarage();
      else if (g === 'boards') this.leaderboards();
      else if (g === 'settings') this.settings();
      else if (g === 'tutorial') this.tutorial(() => this.menu());
    });
    (el.querySelector('[data-go="jam"]') as HTMLElement).focus({ preventScroll: true });
  }

  private panel(title: string, body: string, cls = '') {
    const el = this.mount(`<div class="panel-head"><button class="icon-btn" data-back aria-label="Back"><span>←</span></button><h2>${title}</h2></div><div class="panel-body">${body}</div>`, `panel scrim-full ${cls}`);
    this.on(el, '[data-back]', () => { this.host.tap('back'); this.menu(); });
    return el;
  }

  attack() {
    const s = this.host.save;
    const body = `<div class="list">${SCORE_ATTACK.map(l => {
      const locked = l.id > s.attackLevel;
      const done = l.id < s.attackLevel;
      return `<button class="row ${locked ? 'locked' : ''} ${done ? 'done' : ''}" data-lvl="${l.id}" ${locked ? 'disabled' : ''}>
        <div class="rank">${l.id}</div><div class="grow"><h3>${l.name}</h3><p>Score ${fmt(l.target)} in ${l.attempts} attempts (total)</p></div>
        <div class="right">${done ? '✓' : locked ? 'LOCKED' : 'GO'}</div></button>`;
    }).join('')}</div>`;
    const el = this.panel('Score Attack', body);
    this.on(el, '[data-lvl]', b => { if ((b as HTMLButtonElement).disabled) return; this.host.tap(); this.host.startMode('attack', Number(b.dataset.lvl)); });
  }

  challenges() {
    const s = this.host.save;
    const body = `<p class="kicker" style="margin:0 0 10px">Pick one — unlimited attempts until you land it.</p><div class="list">${CHALLENGES.map(c => {
      const done = s.challengesDone.includes(c.id);
      return `<button class="row ${done ? 'done' : ''}" data-ch="${c.id}"><div class="grow"><h3>${c.name}</h3><p>${c.desc}</p><div class="reward">${done ? 'Completed' : 'Reward: ' + c.reward}</div></div><div class="right">${done ? '✓' : 'GO'}</div></button>`;
    }).join('')}</div>`;
    const el = this.panel('Trick Challenges', body);
    this.on(el, '[data-ch]', b => { this.host.tap(); this.host.startMode('challenge', b.dataset.ch); });
  }

  leaderboards() {
    const s = this.host.save;
    const d = this.host.dailyInfo();
    const jam = [...s.jamHistory].sort((a, b) => b.score - a.score).slice(0, 8);
    const dailyRows = [...d.rivals, ...(d.best ? [{ name: `${s.name} (you)`, score: d.best }] : [])].sort((a, b) => b.score - a.score);
    const body = `
      <h3 class="kicker" style="margin:4px 0 8px">Daily Huck · ${d.date}</h3>
      <div class="list">${dailyRows.map((r, i) => `<div class="row ${r.name.includes('(you)') ? 'me' : ''}"><div class="rank">${i + 1}</div><div class="grow"><h3>${esc(r.name)}</h3></div><div class="right">${fmt(r.score)}</div></div>`).join('')}</div>
      <p class="kicker" style="margin:8px 0 18px;opacity:.5">Same setup for every rider today. Global boards are coming — for now it's you vs. the regulars.</p>
      <h3 class="kicker" style="margin:4px 0 8px">Your best Big Air Jams</h3>
      <div class="list">${jam.length ? jam.map((j, i) => `<div class="row"><div class="rank">${i + 1}</div><div class="grow"><h3>${fmt(j.score)}</h3><p>${j.date} · finished ${ordinal(j.place)}</p></div></div>`).join('') : '<div class="row"><div class="grow"><p>No jams yet. Go drop in.</p></div></div>'}</div>
      <h3 class="kicker" style="margin:18px 0 8px">Records</h3>
      <div class="list">
        <div class="row"><div class="grow"><h3>Best trick</h3><p>${s.bestTrick ? esc(s.bestTrick.name) : '—'}</p></div><div class="right">${s.bestTrick ? fmt(s.bestTrick.score) : '—'}</div></div>
        <div class="row"><div class="grow"><h3>Best jam</h3></div><div class="right">${fmt(s.best.jam)}</div></div>
        <div class="row"><div class="grow"><h3>Runs · landed</h3></div><div class="right">${s.totalRuns} · ${s.totalLanded}</div></div>
        <div class="row"><div class="grow"><h3>Unique tricks landed</h3></div><div class="right">${s.signatures.length}</div></div>
      </div>`;
    this.panel('Leaderboards', body);
  }

  settings() {
    const s = this.host.save.settings;
    const body = `
      <div class="setting">Master volume <input type="range" min="0" max="1" step="0.05" value="${s.master}" data-k="master"></div>
      <div class="setting">Music <input type="range" min="0" max="1" step="0.05" value="${s.music}" data-k="music"></div>
      <div class="setting">Sound effects <input type="range" min="0" max="1" step="0.05" value="${s.sfx}" data-k="sfx"></div>
      <div class="setting">Announcer captions <button class="toggle ${s.announcer ? 'on' : ''}" data-t="announcer" aria-label="Announcer"></button></div>
      <div class="setting">Announcer voice <button class="toggle ${s.voice ? 'on' : ''}" data-t="voice" aria-label="Announcer voice"></button></div>
      <div class="setting">Hints during runs <button class="toggle ${s.showTutorialHints ? 'on' : ''}" data-t="showTutorialHints" aria-label="Hints"></button></div>
      <div class="setting">Left-handed touch layout <button class="toggle ${s.leftHanded ? 'on' : ''}" data-t="leftHanded" aria-label="Left handed"></button></div>
      <div class="setting">Graphics <div class="seg">${(['auto', 'low', 'high'] as const).map(q => `<button class="${s.quality === q ? 'on' : ''}" data-q="${q}">${q}</button>`).join('')}</div></div>
      <div class="setting">Rider name <input data-name maxlength="12" value="${esc(this.host.save.name)}" style="font:inherit;font-size:18px;width:150px;padding:6px 8px;background:rgba(255,255,255,.1);color:#fff;border:0;user-select:text;-webkit-user-select:text"></div>
      <div class="setting">Reset all progress <button class="btn small ghost" data-reset><span>Reset</span></button></div>
      <p class="kicker" style="margin-top:20px;opacity:.5">KNUCKLE HUCK v1.0 · HaveAnApp · All sponsors are fictional.</p>`;
    const el = this.panel('Settings', body);
    el.querySelectorAll<HTMLInputElement>('input[type=range]').forEach(i => i.addEventListener('input', () => {
      (s as unknown as Record<string, number>)[i.dataset.k!] = Number(i.value); this.host.applySettings();
    }));
    this.on(el, '[data-t]', b => {
      const k = b.dataset.t as keyof typeof s;
      (s as unknown as Record<string, boolean>)[k] = !(s as unknown as Record<string, boolean>)[k];
      b.classList.toggle('on'); this.host.tap(); this.host.applySettings();
    });
    this.on(el, '[data-q]', b => { s.quality = b.dataset.q as typeof s.quality; el.querySelectorAll('[data-q]').forEach(x => x.classList.toggle('on', x === b)); this.host.applySettings(); });
    const name = el.querySelector<HTMLInputElement>('[data-name]')!;
    name.addEventListener('change', () => { this.host.save.name = (name.value.trim() || 'YOU').toUpperCase().slice(0, 12); this.host.applySettings(); });
    name.addEventListener('keydown', e => e.stopPropagation());
    this.on(el, '[data-reset]', b => {
      if (b.dataset.armed) { this.host.resetProgress(); this.menu(); return; }
      b.dataset.armed = '1'; b.querySelector('span')!.textContent = 'Tap again to confirm';
    });
  }

  // ---------------------------------------------------------------- tutorial
  tutorial(done: () => void) {
    const steps = [
      { h: 'Drop in & steer', p: 'Drag anywhere on the <b>left side</b> to steer. Push <b>up to tuck</b> for speed, <b>down to check</b> speed. The green band on the speedo is the knuckle sweet spot.', k: 'Keys: ← → steer · ↑ tuck · ↓ check' },
      { h: 'Load & pop', p: '<b>Hold POP</b> (right side) to compress. <b>Release right on the blue knuckle line</b>. Early = you case the deck. Late = you roll off with no amplitude. Watch the timing bar.', k: 'Keys: hold SPACE, release to pop' },
      { h: 'Spin & flip', p: 'In the air, the <b>left stick spins</b> (left/right) and <b>flips</b> (up = frontflip, down = backflip). Push diagonally for corks, rodeos and mistys. Let go and the rider finishes the rotation.', k: 'Keys: arrows / WASD' },
      { h: 'Grab & tweak', p: 'The POP button becomes a <b>grab wheel</b> — it\'s laid out like your board: nose up, tail down, toe edge left, heel edge right. <b>Drag past the rim to tweak</b>. Chain grabs for combos.', k: 'Keys: J indy · U mute · O melon · P method · L stale · I nose · K tail · SHIFT tweak' },
      { h: 'Land it', p: '<b>Let go of everything before touchdown</b> — the ring turns green when you\'re ready. Land on the steep part of the landing. Stomp it in the sweet spot for bonus points.', k: 'New tricks, switch takeoffs (E / SWITCH) and late spins pump the Sick Meter. Repeats bore the judges.' },
    ];
    let i = 0;
    const render = () => {
      const st = steps[i];
      const el = this.mount(`
        <div class="tut-steps">${steps.map((_, j) => `<i class="${j <= i ? 'on' : ''}"></i>`).join('')}</div>
        <div class="tut-card"><div class="kicker" style="opacity:.6">${i + 1} / ${steps.length}</div><h3>${st.h}</h3><p>${st.p}</p><p class="keys">${st.k}</p></div>
        <div style="display:flex;gap:12px"><button class="btn ghost small" data-skip><span>${i === steps.length - 1 ? 'Back' : 'Skip'}</span></button><button class="btn primary" data-next><span>${i === steps.length - 1 ? 'Let\'s huck' : 'Next'}</span></button></div>`, 'tut scrim-full');
      this.on(el, '[data-next]', () => { this.host.tap(); if (i < steps.length - 1) { i++; render(); } else { this.host.save.tutorialDone = true; this.host.applySettings(); done(); } });
      this.on(el, '[data-skip]', () => { this.host.tap('back'); this.host.save.tutorialDone = true; this.host.applySettings(); done(); });
    };
    render();
  }

  // ---------------------------------------------------------------- garage
  garage(loadout: Loadout) {
    const s = this.host.save;
    const work: Loadout = { ...loadout };
    const tabs: { id: 'board' | 'binding' | CosmeticSlot; label: string }[] = [
      { id: 'board', label: 'Board' }, { id: 'binding', label: 'Bindings' }, { id: 'jacket', label: 'Jacket' }, { id: 'pants', label: 'Pants' },
      { id: 'helmet', label: 'Helmet' }, { id: 'goggles', label: 'Goggles' }, { id: 'gloves', label: 'Gloves' }, { id: 'accessory', label: 'Extras' }, { id: 'sticker', label: 'Stickers' },
    ];
    let tab: typeof tabs[number]['id'] = 'board';
    const el = this.mount(`
      <div class="garage-top"><button class="icon-btn" data-back aria-label="Back"><span>←</span></button><h2>YOUR RIDER</h2></div>
      <div class="garage-sheet"><div class="tabs"></div><div class="blurb"></div><div class="statbox"></div><div class="items"></div></div>`, 'garage');
    const tabsEl = el.querySelector('.tabs')!, items = el.querySelector('.items')!, blurb = el.querySelector('.blurb')!, stats = el.querySelector('.statbox') as HTMLElement;
    const renderStats = () => {
      const b = boardById(work.board);
      const bi = BINDINGS.find(x => x.id === work.binding)!;
      if (tab !== 'board' && tab !== 'binding') { stats.style.display = 'none'; return; }
      stats.style.display = '';
      const st = b.stats;
      const rows: [string, number][] = [['Pop', (st.pop - 0.8) / 0.45], ['Spin', (st.spin - 0.8) / 0.45 * (bi.response)], ['Stability', st.stability + bi.stability], ['Forgiving', st.forgiveness + bi.forgiveness], ['Stiffness', st.flex]];
      stats.innerHTML = rows.map(([n, v]) => `<span>${n}</span><div class="statbar"><i style="width:${Math.max(4, Math.min(100, v * 100))}%"></i></div>`).join('');
    };
    const render = () => {
      tabsEl.innerHTML = tabs.map(t => `<button class="tab ${t.id === tab ? 'on' : ''}" data-tab="${t.id}">${t.label}</button>`).join('');
      let list: { id: string; name: string; colors: string[]; unlock?: { level?: number } ; blurb?: string }[];
      if (tab === 'board') list = BOARDS.map(b => ({ id: b.id, name: b.name, colors: b.graphic.colors, unlock: b.unlock, blurb: b.blurb }));
      else if (tab === 'binding') list = BINDINGS.map(b => ({ id: b.id, name: b.name, colors: ['#1b1d21', '#7d8794'], unlock: b.unlock, blurb: b.blurb }));
      else list = (SLOTS[tab] as unknown as typeof list);
      const cur = work[tab as keyof Loadout];
      items.innerHTML = list.map(it => {
        const un = isUnlocked(s, it.unlock as never);
        const cols = it.colors.length ? it.colors : ['#2a3550'];
        return `<button class="item ${cur === it.id ? 'on' : ''} ${un ? '' : 'locked'}" data-id="${it.id}" ${un ? '' : 'aria-disabled="true"'}>
          <div class="sw">${cols.map(c => `<i style="background:${c}"></i>`).join('')}</div>
          <div class="nm">${esc(it.name)}</div>${un ? '' : `<div class="lk">🔒 ${unlockLabel(it.unlock as never)}</div>`}</button>`;
      }).join('');
      const sel = list.find(x => x.id === cur);
      blurb.textContent = sel?.blurb ?? (sel?.name ?? '');
      renderStats();
      this.on(el, '[data-tab]', b => { tab = b.dataset.tab as typeof tab; this.host.tap(); render(); });
      this.on(el, '.item', b => {
        const it = list.find(x => x.id === b.dataset.id)!;
        if (!isUnlocked(s, it.unlock as never)) { this.host.tap('back'); blurb.textContent = `Locked — ${unlockLabel(it.unlock as never)}.`; return; }
        (work as unknown as Record<string, string>)[tab] = it.id;
        this.host.tap(); this.host.previewLoadout(work); this.host.commitLoadout(work); render();
      });
    };
    render();
    this.on(el, '[data-back]', () => { this.host.tap('back'); this.host.closeGarage(); });
  }

  // ---------------------------------------------------------------- results
  results(opts: {
    score: RunScore | null; missedReason?: string; attempt: number; attempts: number; sessionScores: number[];
    pb: boolean; modeLine: string; isLast: boolean; onNext: () => void; onReplay: () => void; onMenu: () => void; extra?: string;
  }) {
    const s = opts.score;
    const grade = s ? s.landing.grade : 'crash';
    const gradeText = { stomped: 'STOMPED', clean: 'CLEAN', sketchy: 'SKETCHY', crash: 'BAIL' }[grade];
    const name = s ? s.trick.name : 'No Trick';
    const reason = s ? s.landing.reason : opts.missedReason ?? '';
    const lines = s ? s.lines : [];
    const best = Math.max(0, ...opts.sessionScores);
    const dots = Array.from({ length: Number.isFinite(opts.attempts) ? opts.attempts : Math.max(opts.sessionScores.length, 1) }, (_, i) => {
      const v = opts.sessionScores[i];
      return `<span class="${v !== undefined && v === best && best > 0 ? 'best' : ''} ${i === opts.attempt - 1 ? 'cur' : ''}">${v !== undefined ? fmt(v) : '—'}</span>`;
    }).slice(-8).join('');
    const el = this.mount(`
      <div class="res-left">
        <div class="kicker">${esc(opts.modeLine)}</div>
        <div class="grade ${grade}">${gradeText}</div>
        <div class="res-trick">${esc(name)}</div>
        <div class="res-reason">${esc(reason)}</div>
        <div class="res-total ${s && s.total > 0 ? '' : 'zero'}" data-total>0</div>
        ${opts.pb ? '<div class="sticker res-pb">NEW PERSONAL BEST!</div>' : ''}
        ${opts.extra ? `<div class="kicker" style="opacity:.95;color:var(--acid)">${opts.extra}</div>` : ''}
        <div class="attempt-dots">${dots}</div>
      </div>
      <div class="res-right">
        ${lines.map((l, i) => `<div class="res-line" style="animation-delay:${0.15 + i * 0.09}s"><span class="l">${l.label}</span><span class="v">${fmt(l.value)}</span><span class="d">${esc(l.detail)}</span></div>`).join('')}
        ${s ? `<div class="res-line mult" style="animation-delay:${0.2 + lines.length * 0.09}s"><span class="l">Execution</span><span class="v">×${s.execution.toFixed(2)}</span><span class="d">${esc(s.executionLabel)}</span></div>
        <div class="res-line mult" style="animation-delay:${0.29 + lines.length * 0.09}s"><span class="l">Combo</span><span class="v">×${s.combo.toFixed(1)}</span><span class="d">${s.comboElements.map(esc).join(' + ') || 'single element'}</span></div>
        <div class="res-line mult" style="animation-delay:${0.38 + lines.length * 0.09}s"><span class="l">Sick Meter</span><span class="v">×${s.sick.toFixed(1)}</span><span class="d">${s.sickDelta >= 0 ? '+' : ''}${s.sickDelta} hype</span></div>` : '<div class="res-line" style="animation-delay:.2s"><span class="l">Score</span><span class="v">0</span><span class="d">Shake it off. Next one.</span></div>'}
        <div class="res-actions">
          <button class="btn primary" data-next><span>${opts.isLast ? 'Final Results' : 'Next Run'}</span></button>
          <button class="btn" data-replay><span>Replay</span></button>
          <button class="btn ghost small" data-menu><span>Menu</span></button>
        </div>
      </div>`, 'results scrim');
    this.on(el, '[data-next]', () => { this.host.tap(); opts.onNext(); });
    this.on(el, '[data-replay]', () => { this.host.tap(); opts.onReplay(); });
    this.on(el, '[data-menu]', () => { this.host.tap('back'); opts.onMenu(); });
    (el.querySelector('[data-next]') as HTMLElement).focus({ preventScroll: true });
    return el.querySelector('[data-total]') as HTMLElement;
  }

  summary(opts: { title: string; sub: string; total: number; rows?: { name: string; score: number; me?: boolean }[]; notes: string[]; onAgain: () => void; onMenu: () => void }) {
    const el = this.mount(`
      <div class="kicker">${esc(opts.sub)}</div>
      <h2>${esc(opts.title)}</h2>
      <div class="res-total" style="font-size:clamp(48px,12vw,96px)">${fmt(opts.total)}</div>
      ${opts.rows ? `<div class="standings list">${opts.rows.map((r, i) => `<div class="row ${r.me ? 'me' : ''}"><div class="rank">${i + 1}</div><div class="grow"><h3>${esc(r.name)}</h3></div><div class="right">${fmt(r.score)}</div></div>`).join('')}</div>` : ''}
      <div style="display:flex;flex-direction:column;gap:4px">${opts.notes.map(n => `<div class="kicker" style="opacity:.9">${n}</div>`).join('')}</div>
      <div style="display:flex;gap:12px;margin-top:6px"><button class="btn primary" data-again><span>Go Again</span></button><button class="btn ghost" data-menu><span>Menu</span></button></div>`, 'summary scrim-full');
    this.on(el, '[data-again]', () => { this.host.tap(); opts.onAgain(); });
    this.on(el, '[data-menu]', () => { this.host.tap('back'); opts.onMenu(); });
    (el.querySelector('[data-again]') as HTMLElement).focus({ preventScroll: true });
  }

  pause(onResume: () => void, onRestart: () => void, onMenu: () => void) {
    const el = this.mount(`<h2>PAUSED</h2>
      <button class="btn primary" data-r><span>Resume</span></button>
      <button class="btn" data-x><span>Restart Run</span></button>
      <button class="btn ghost" data-m><span>Quit to Menu</span></button>`, 'pause scrim-full');
    this.on(el, '[data-r]', () => { this.host.tap(); onResume(); });
    this.on(el, '[data-x]', () => { this.host.tap(); onRestart(); });
    this.on(el, '[data-m]', () => { this.host.tap('back'); onMenu(); });
  }

  replayControls(label: string, slow: boolean, onAngle: () => void, onSlow: () => void, onExit: () => void) {
    this.root.innerHTML = `<div class="replay-ui"><div class="letterbox t"></div><div class="letterbox b"></div>
      <div class="tag"><span class="rec"></span>REPLAY · <span data-lbl>${label}</span></div>
      <div class="bar"><button class="btn small" data-a><span>Angle</span></button><button class="btn small ${slow ? 'primary' : ''}" data-s><span>Slow-Mo</span></button><button class="btn small ghost" data-e><span>Done</span></button></div></div>`;
    const el = this.root.firstElementChild as HTMLElement;
    this.on(el, '[data-a]', () => { this.host.tap(); onAngle(); });
    this.on(el, '[data-s]', b => { this.host.tap(); onSlow(); b.classList.toggle('primary'); });
    this.on(el, '[data-e]', () => { this.host.tap('back'); onExit(); });
    return { setLabel: (l: string) => { const x = el.querySelector('[data-lbl]'); if (x) x.textContent = l; } };
  }
}

export function ordinal(n: number) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
export { fmt };
