/** In-run HUD: minimal, out of the rider's way. */
import { COURSE } from '../physics/course';
import { sickTier } from '../scoring/scoring';

const SEGS = 12;

export class Hud {
  el: HTMLElement;
  private q = <T extends HTMLElement>(s: string) => this.el.querySelector(s) as T;
  private speedV!: HTMLElement; private speedCur!: HTMLElement; private speedHint!: HTMLElement; private speedOk!: HTMLElement;
  private timing!: HTMLElement; private mark!: HTMLElement; private chargeBar!: HTMLElement;
  private trick!: HTMLElement; private trickName!: HTMLElement; private trickChips!: HTMLElement;
  private land!: HTMLElement; private landTxt!: HTMLElement;
  private sick!: HTMLElement; private sickLbl!: HTMLElement; private sickBars: HTMLElement[] = [];
  private mode!: HTMLElement; private modeSub!: HTMLElement;
  private msg!: HTMLElement; private caption!: HTMLElement; private hint!: HTMLElement; private ready!: HTMLElement;
  private flash!: HTMLElement; private vignette!: HTMLElement; private toasts!: HTMLElement; private legend!: HTMLElement;
  private captionTimer = 0; private hintText = '';
  onPause: (() => void) | null = null;
  /** ideal speed band km/h */
  band = [50, 62];

  constructor(el: HTMLElement) {
    this.el = el;
    el.innerHTML = `
      <div class="hud-tl"><button class="icon-btn" data-pause aria-label="Pause"><span>II</span></button><div class="hud-mode"><div class="m"></div><div class="s"></div></div></div>
      <div class="hud-tr"><div class="sick"><div class="lbl">SICK METER · <b></b></div><div class="bar">${'<i></i>'.repeat(SEGS)}</div></div></div>
      <div class="timing"><div class="track"><div class="zone g"></div><div class="zone p"></div><div class="mark"></div><div class="charge"></div></div><div class="lbls"><span>Early</span><span>Knuckle</span><span>Late</span></div></div>
      <div class="speedo"><span class="v">0</span><span class="u">KM/H</span><div class="band"><div class="ok"></div><div class="cur"></div></div><div class="hint"></div></div>
      <div class="trick-live"><div class="name"></div><div class="chips"></div></div>
      <div class="land-ind"><span></span></div>
      <div class="pop-msg"></div>
      <div class="caption"></div>
      <div class="hint-banner"></div>
      <div class="ready-banner"></div>
      <div class="flash"></div>
      <div class="vignette"></div>
      <div class="toast-stack"></div>
      <div class="key-legend"></div>
    `;
    this.speedV = this.q('.speedo .v'); this.speedCur = this.q('.speedo .cur'); this.speedHint = this.q('.speedo .hint'); this.speedOk = this.q('.speedo .ok');
    this.timing = this.q('.timing'); this.mark = this.q('.timing .mark'); this.chargeBar = this.q('.timing .charge');
    this.trick = this.q('.trick-live'); this.trickName = this.q('.trick-live .name'); this.trickChips = this.q('.trick-live .chips');
    this.land = this.q('.land-ind'); this.landTxt = this.q('.land-ind span');
    this.sick = this.q('.sick'); this.sickLbl = this.q('.sick .lbl b'); this.sickBars = Array.from(this.el.querySelectorAll('.sick .bar i'));
    this.mode = this.q('.hud-mode .m'); this.modeSub = this.q('.hud-mode .s');
    this.msg = this.q('.pop-msg'); this.caption = this.q('.caption'); this.hint = this.q('.hint-banner'); this.ready = this.q('.ready-banner');
    this.flash = this.q('.flash'); this.vignette = this.q('.vignette'); this.toasts = this.q('.toast-stack'); this.legend = this.q('.key-legend');
    this.q('[data-pause]').addEventListener('click', () => this.onPause?.());
    // timing zones: track spans knuckleZ-12 .. knuckleZ+10
    const span = (z: number) => ((z - (COURSE.knuckleZ - 12)) / 22) * 100;
    const g = this.q<HTMLElement>('.zone.g'); g.style.left = `${span(COURSE.knuckleZ - 3.6)}%`; g.style.width = `${span(COURSE.knuckleZ + 3.6) - span(COURSE.knuckleZ - 3.6)}%`;
    const p = this.q<HTMLElement>('.zone.p'); p.style.left = `${span(COURSE.knuckleZ - 1.6)}%`; p.style.width = `${span(COURSE.knuckleZ + 1.6) - span(COURSE.knuckleZ - 1.6)}%`;
    this.setBand(this.band[0], this.band[1]);
    this.legend.innerHTML = `<kbd>←→</kbd> steer / spin · <kbd>↑↓</kbd> tuck·press / flip<br><kbd>SPACE</kbd> hold &amp; release to pop · <kbd>E</kbd> switch<br>Grabs <kbd>J</kbd>indy <kbd>U</kbd>mute <kbd>O</kbd>melon <kbd>P</kbd>method <kbd>L</kbd>stale <kbd>I</kbd>nose <kbd>K</kbd>tail · <kbd>SHIFT</kbd> tweak`;
  }

  show(on: boolean) { this.el.style.display = on ? '' : 'none'; }
  inResults(on: boolean) { this.el.classList.toggle('in-results', on); }
  setTouch(touch: boolean) { this.el.classList.toggle('touch-ui', touch); }
  setLegend(on: boolean) { this.legend.style.display = on ? '' : 'none'; }

  setMode(name: string, sub: string) { this.mode.textContent = name; this.modeSub.textContent = sub; }

  setBand(lo: number, hi: number) {
    this.band = [lo, hi];
    const max = 90;
    this.speedOk.style.left = `${(lo / max) * 100}%`;
    this.speedOk.style.width = `${((hi - lo) / max) * 100}%`;
  }

  speed(ms: number, z: number, visible: boolean) {
    const kmh = Math.round(ms * 3.6);
    this.speedV.textContent = String(kmh);
    this.speedCur.style.left = `${Math.min(100, (kmh / 90) * 100)}%`;
    const [lo, hi] = this.band;
    let h = '';
    if (z < COURSE.deckStartZ - 6) h = kmh < lo ? '↑ tuck for speed' : kmh > hi ? '↓ check speed' : 'speed is good';
    else if (z < COURSE.knuckleZ + 4) h = 'hold pop · release on blue line';
    this.speedHint.textContent = h;
    (this.el.querySelector('.speedo') as HTMLElement).style.opacity = visible ? '1' : '0';
  }

  timingMeter(z: number, charge: number, visible: boolean) {
    this.timing.classList.toggle('on', visible);
    if (!visible) return;
    const pct = Math.max(0, Math.min(100, ((z - (COURSE.knuckleZ - 12)) / 22) * 100));
    this.mark.style.left = `calc(${pct}% - 2px)`;
    const d = Math.abs(z - COURSE.knuckleZ);
    this.mark.style.background = d <= 1.6 ? 'var(--acid)' : d <= 3.6 ? 'var(--sky)' : '#fff';
    this.chargeBar.style.width = `${charge * 100}%`;
  }

  trickLive(name: string, chips: string[], mult: number, visible: boolean) {
    this.trick.style.opacity = visible && name ? '1' : '0';
    if (!visible) return;
    if (this.trickName.textContent !== name) this.trickName.textContent = name;
    const html = chips.map(c => `<span class="chip on">${c}</span>`).join('') + (mult > 1.01 ? `<span class="mult">×${mult.toFixed(1)}</span>` : '');
    if (this.trickChips.innerHTML !== html) this.trickChips.innerHTML = html;
  }

  landIndicator(x: number, y: number, on: boolean, ok: boolean, text: string) {
    this.land.classList.toggle('on', on);
    if (!on) return;
    this.land.style.left = `${x}px`; this.land.style.top = `${y}px`;
    this.land.classList.toggle('warn', !ok);
    this.landTxt.textContent = text;
  }

  sickMeter(level: number) {
    const t = sickTier(level);
    this.sick.dataset.tier = String(t.tier);
    this.sickLbl.textContent = t.name;
    const n = Math.round((level / 100) * SEGS);
    this.sickBars.forEach((b, i) => b.classList.toggle('on', i < n));
    this.vignette.className = `vignette ${t.tier >= 2 ? 't' + t.tier : ''}`;
  }

  stamp(text: string, cls: string, sub = '') {
    this.msg.innerHTML = `<div class="stamp ${cls}">${text}</div>${sub ? `<div class="sub">${sub}</div>` : ''}`;
  }
  scorePop(text: string) {
    const d = document.createElement('div');
    d.className = 'score-pop'; d.textContent = text;
    this.el.appendChild(d);
    setTimeout(() => d.remove(), 1700);
  }
  say(text: string) {
    this.caption.textContent = text;
    this.caption.classList.add('on');
    clearTimeout(this.captionTimer);
    this.captionTimer = window.setTimeout(() => this.caption.classList.remove('on'), 2400);
  }
  setHint(html: string) {
    if (html === this.hintText) return;
    this.hintText = html;
    this.hint.innerHTML = html;
    this.hint.classList.toggle('on', !!html);
  }
  readyBanner(a: string, b: string, c: string) {
    this.ready.innerHTML = b ? `<div class="a">${a}</div><div class="b">${b}</div><div class="c">${c}</div>` : '';
  }
  doFlash() { this.flash.classList.remove('go'); void this.flash.offsetWidth; this.flash.classList.add('go'); }
  private toastQueue: [string, string][] = [];
  private toastBusy = false;
  toast(title: string, text: string) {
    this.toastQueue.push([title, text]);
    if (!this.toastBusy) this.nextToast();
  }
  private nextToast() {
    const t = this.toastQueue.shift();
    if (!t) { this.toastBusy = false; return; }
    this.toastBusy = true;
    const d = document.createElement('div');
    d.className = 'toast'; d.innerHTML = `<b>${t[0]}</b>${t[1]}`;
    this.toasts.appendChild(d);
    setTimeout(() => d.remove(), 3700);
    setTimeout(() => this.nextToast(), 1300);
  }
  clearTransient() {
    this.msg.innerHTML = ''; this.trick.style.opacity = '0'; this.land.classList.remove('on'); this.timing.classList.remove('on'); this.setHint(''); this.readyBanner('', '', '');
  }
}
