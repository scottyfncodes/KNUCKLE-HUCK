/**
 * Unified input: touch (floating stick + pop button / grab wheel), keyboard and
 * gamepad all resolve into one InputState each frame.
 */
import type { GrabId } from '../tricks/tricks';

export interface InputState {
  x: number;          // -1..1 (right +)
  y: number;          // -1..1 (up +)
  pop: boolean;
  grab: GrabId | null;
  tweak: number;      // 0..1
  switchStance: boolean; // edge
  pause: boolean;     // edge
  retry: boolean;     // edge
  confirm: boolean;   // edge
  source: 'touch' | 'keys' | 'pad';
}

export type InputMode = 'ground' | 'air' | 'off';

// Wheel layout mirrors a board seen from above: nose up, tail down, toe edge left, heel edge right.
export const WHEEL: { id: GrabId; label: string; angle: number }[] = [
  { id: 'nose', label: 'NOSE', angle: -90 },
  { id: 'mute', label: 'MUTE', angle: -145 },
  { id: 'indy', label: 'INDY', angle: 155 },
  { id: 'tail', label: 'TAIL', angle: 90 },
  { id: 'stalefish', label: 'STALE', angle: 30 },
  { id: 'method', label: 'METHOD', angle: -10 },
  { id: 'melon', label: 'MELON', angle: -50 },
];

const KEY_GRABS: Record<string, GrabId> = {
  KeyJ: 'indy', KeyK: 'tail', KeyL: 'stalefish', KeyI: 'nose', KeyU: 'mute', KeyO: 'melon', KeyP: 'method',
  Digit1: 'indy', Digit2: 'mute', Digit3: 'melon', Digit4: 'method', Digit5: 'stalefish', Digit6: 'nose', Digit7: 'tail',
};

interface StickTouch { id: number; ox: number; oy: number; x: number; y: number }

export class Input {
  state: InputState = { x: 0, y: 0, pop: false, grab: null, tweak: 0, switchStance: false, pause: false, retry: false, confirm: false, source: 'touch' };
  mode: InputMode = 'off';
  private keys = new Set<string>();
  private keyGrabOrder: GrabId[] = [];
  private edges = { switchStance: false, pause: false, retry: false, confirm: false };
  private stick: StickTouch | null = null;
  private action: { id: number; x: number; y: number } | null = null;
  private padPrev: boolean[] = [];
  private root: HTMLElement;
  private stickEl: HTMLElement; private knobEl: HTMLElement;
  private popEl: HTMLElement; private wheelEl: HTMLElement;
  private wheelSectors = new Map<GrabId, HTMLElement>();
  touchSeen = false;
  leftHanded = false;
  onAnyInput: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = `
      <div class="t-stick" aria-hidden="true"><div class="t-knob"></div></div>
      <div class="t-switch" role="button" aria-label="Switch stance">SWITCH</div>
      <div class="t-pop" aria-label="Pop"><div class="t-pop-ring"></div><div class="t-pop-fill"></div><span>POP</span><small>hold · release</small></div>
      <div class="t-wheel" aria-hidden="true"><div class="t-wheel-center">GRAB</div></div>
    `;
    this.stickEl = root.querySelector('.t-stick')!;
    this.knobEl = root.querySelector('.t-knob')!;
    this.popEl = root.querySelector('.t-pop')!;
    this.wheelEl = root.querySelector('.t-wheel')!;
    for (const s of WHEEL) {
      const el = document.createElement('div');
      el.className = 't-sector';
      el.textContent = s.label;
      const r = 62;
      el.style.transform = `translate(-50%,-50%) translate(${Math.cos(s.angle * Math.PI / 180) * r}px, ${Math.sin(s.angle * Math.PI / 180) * r}px)`;
      this.wheelEl.appendChild(el);
      this.wheelSectors.set(s.id, el);
    }
    root.dataset.mode = 'off';
    this.bindTouch();
    this.bindKeys();
  }

  setMode(m: InputMode) {
    if (m === this.mode) return;
    this.mode = m;
    this.root.dataset.mode = m;
    if (m !== 'air') this.state.grab = null;
  }

  setSwitchAllowed(on: boolean) { this.root.dataset.noswitch = on ? '0' : '1'; }

  /** Pop button charge feedback 0..1 and timing hint colour */
  setPopFeedback(charge: number, zone: 'none' | 'early' | 'good' | 'perfect' | 'late') {
    this.popEl.style.setProperty('--charge', String(charge));
    this.popEl.dataset.zone = zone;
  }

  private isActionSide(x: number) {
    const w = window.innerWidth;
    return this.leftHanded ? x < w * 0.5 : x >= w * 0.5;
  }

  private bindTouch() {
    const opts = { passive: false } as AddEventListenerOptions;
    const el = this.root;
    el.addEventListener('touchstart', e => {
      if (this.mode === 'off') return;
      e.preventDefault();
      this.touchSeen = true; this.state.source = 'touch';
      this.onAnyInput?.();
      for (const t of Array.from(e.changedTouches)) {
        const tgt = t.target as HTMLElement;
        if (tgt.closest('.t-switch')) { this.edges.switchStance = true; continue; }
        if (this.isActionSide(t.clientX) && !this.action) {
          this.action = { id: t.identifier, x: t.clientX, y: t.clientY };
          this.updateWheel();
        } else if (!this.stick) {
          this.stick = { id: t.identifier, ox: t.clientX, oy: t.clientY, x: t.clientX, y: t.clientY };
          this.stickEl.style.left = `${t.clientX}px`;
          this.stickEl.style.top = `${t.clientY}px`;
          this.stickEl.classList.add('on');
        }
      }
    }, opts);
    el.addEventListener('touchmove', e => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        if (this.stick && t.identifier === this.stick.id) { this.stick.x = t.clientX; this.stick.y = t.clientY; }
        if (this.action && t.identifier === this.action.id) { this.action.x = t.clientX; this.action.y = t.clientY; this.updateWheel(); }
      }
    }, opts);
    const end = (e: TouchEvent) => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        if (this.stick && t.identifier === this.stick.id) { this.stick = null; this.stickEl.classList.remove('on'); }
        if (this.action && t.identifier === this.action.id) { this.action = null; this.updateWheel(); }
      }
    };
    el.addEventListener('touchend', end, opts);
    el.addEventListener('touchcancel', end, opts);
    // Mouse fallback (desktop testing / trackpads)
    el.addEventListener('mousedown', e => {
      if (this.mode === 'off' || this.touchSeen) return;
      if ((e.target as HTMLElement).closest('.t-switch')) { this.edges.switchStance = true; return; }
      if (this.isActionSide(e.clientX)) { this.action = { id: -1, x: e.clientX, y: e.clientY }; this.updateWheel(); }
    });
    window.addEventListener('mousemove', e => { if (this.action?.id === -1) { this.action.x = e.clientX; this.action.y = e.clientY; this.updateWheel(); } });
    window.addEventListener('mouseup', () => { if (this.action?.id === -1) { this.action = null; this.updateWheel(); } });
  }

  private wheelCenter() {
    const r = this.wheelEl.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 };
  }

  private touchGrab: GrabId | null = null;
  private touchTweak = 0;
  private updateWheel() {
    this.touchGrab = null; this.touchTweak = 0;
    if (this.action && this.mode === 'air') {
      const c = this.wheelCenter();
      const dx = this.action.x - c.x, dy = this.action.y - c.y;
      const d = Math.hypot(dx, dy);
      if (d < c.r * 0.22) this.touchGrab = 'indy';
      else {
        const a = Math.atan2(dy, dx) * 180 / Math.PI;
        let best: GrabId = 'indy', bd = 999;
        for (const s of WHEEL) {
          let diff = Math.abs(((a - s.angle) % 360 + 540) % 360 - 180);
          if (diff < bd) { bd = diff; best = s.id; }
        }
        this.touchGrab = best;
        this.touchTweak = Math.max(0, Math.min(1, (d - c.r * 0.85) / (c.r * 0.7)));
      }
    }
    for (const [id, el] of this.wheelSectors) el.classList.toggle('on', id === this.touchGrab);
    this.wheelEl.style.setProperty('--tweak', String(this.touchTweak));
    this.popEl.classList.toggle('down', !!this.action);
  }

  private bindKeys() {
    window.addEventListener('keydown', e => {
      if (e.repeat) { if (this.mode !== 'off' && (e.code === 'Space' || e.code.startsWith('Arrow'))) e.preventDefault(); return; }
      this.keys.add(e.code);
      this.state.source = 'keys';
      this.onAnyInput?.();
      const g = KEY_GRABS[e.code];
      if (g) { this.keyGrabOrder = this.keyGrabOrder.filter(x => x !== g); this.keyGrabOrder.push(g); }
      if (e.code === 'KeyE' || e.code === 'KeyQ') this.edges.switchStance = true;
      if (e.code === 'Escape') this.edges.pause = true;
      if (e.code === 'KeyR') this.edges.retry = true;
      if (e.code === 'Enter') this.edges.confirm = true;
      if (this.mode !== 'off' && (e.code === 'Space' || e.code.startsWith('Arrow'))) e.preventDefault();
    });
    window.addEventListener('keyup', e => {
      this.keys.delete(e.code);
      const g = KEY_GRABS[e.code];
      if (g) this.keyGrabOrder = this.keyGrabOrder.filter(x => x !== g);
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.keyGrabOrder = []; });
  }

  /** Poll everything into this.state. Call once per frame. */
  update() {
    const s = this.state;
    let x = 0, y = 0, pop = false, grab: GrabId | null = null, tweak = 0;
    const k = this.keys;
    // Keyboard
    if (k.has('ArrowLeft') || k.has('KeyA')) x -= 1;
    if (k.has('ArrowRight') || k.has('KeyD')) x += 1;
    if (k.has('ArrowUp') || k.has('KeyW')) y += 1;
    if (k.has('ArrowDown') || k.has('KeyS')) y -= 1;
    if (k.has('Space')) pop = true;
    if (this.keyGrabOrder.length) grab = this.keyGrabOrder[this.keyGrabOrder.length - 1];
    if (k.has('ShiftLeft') || k.has('ShiftRight')) tweak = 1;

    // Touch
    if (this.stick) {
      const dx = this.stick.x - this.stick.ox, dy = this.stick.y - this.stick.oy;
      const R = 58;
      const d = Math.hypot(dx, dy);
      const cl = Math.min(1, d / R);
      const nx = d > 0 ? dx / d : 0, ny = d > 0 ? dy / d : 0;
      // dead zone + response curve
      const mag = cl < 0.12 ? 0 : (cl - 0.12) / 0.88;
      x += nx * mag; y += -ny * mag;
      // drag origin follows if you overshoot, so the stick never "runs out"
      if (d > R * 1.25) { this.stick.ox = this.stick.x - nx * R * 1.25; this.stick.oy = this.stick.y - ny * R * 1.25; this.stickEl.style.left = `${this.stick.ox}px`; this.stickEl.style.top = `${this.stick.oy}px`; }
      this.knobEl.style.transform = `translate(-50%,-50%) translate(${nx * cl * R}px, ${ny * cl * R}px)`;
    }
    if (this.action) {
      if (this.mode === 'air') { grab = this.touchGrab ?? grab; tweak = Math.max(tweak, this.touchTweak); }
      else pop = true;
    }

    // Gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = pads && Array.from(pads).find(Boolean);
    if (p) {
      const ax = p.axes[0] ?? 0, ay = p.axes[1] ?? 0;
      const btn = (i: number) => !!p.buttons[i]?.pressed;
      const val = (i: number) => p.buttons[i]?.value ?? 0;
      if (Math.abs(ax) > 0.15 || Math.abs(ay) > 0.15) { x += ax; y += -ay; s.source = 'pad'; }
      if (btn(14)) x -= 1; if (btn(15)) x += 1; if (btn(12)) y += 1; if (btn(13)) y -= 1;
      if (this.mode === 'air') {
        if (btn(2)) grab = 'indy'; else if (btn(3)) grab = 'nose'; else if (btn(1)) grab = 'melon'; else if (btn(0)) grab = 'tail';
        else if (btn(4)) grab = 'mute'; else if (btn(5)) grab = 'method'; else if (val(6) > 0.4) grab = 'stalefish';
        tweak = Math.max(tweak, val(7));
      } else if (btn(0)) pop = true;
      const edge = (i: number) => btn(i) && !this.padPrev[i];
      if (this.mode !== 'air' && edge(3)) this.edges.switchStance = true;
      if (edge(9)) this.edges.pause = true;
      if (edge(8)) this.edges.retry = true;
      if (this.mode === 'off' && edge(0)) this.edges.confirm = true;
      if (p.buttons.some(b => b.pressed)) { s.source = 'pad'; this.onAnyInput?.(); }
      this.padPrev = p.buttons.map(b => b.pressed);
    }

    s.x = Math.max(-1, Math.min(1, x));
    s.y = Math.max(-1, Math.min(1, y));
    s.pop = pop; s.grab = grab; s.tweak = tweak;
    s.switchStance = this.edges.switchStance; s.pause = this.edges.pause; s.retry = this.edges.retry; s.confirm = this.edges.confirm;
    this.edges.switchStance = this.edges.pause = this.edges.retry = this.edges.confirm = false;
    return s;
  }

  reset() {
    this.stick = null; this.action = null; this.keyGrabOrder = [];
    this.stickEl.classList.remove('on');
    this.updateWheel();
  }
}
