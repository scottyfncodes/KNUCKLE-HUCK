import '@fontsource/anton/400.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/permanent-marker/400.css';
import './style.css';
import { Game } from './game/game';

const boot = document.getElementById('boot')!;
const bar = boot.querySelector('.boot-bar i') as HTMLElement;
const msg = boot.querySelector('.boot-msg') as HTMLElement;
const progress = (p: number, m: string) => { bar.style.width = `${Math.round(p * 100)}%`; msg.textContent = m; };

// Block page-level gestures that fight gameplay (pinch zoom, double-tap zoom, pull to refresh)
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, e => e.preventDefault(), { passive: false } as AddEventListenerOptions);
let lastTouchEnd = 0;
document.addEventListener('touchend', e => { const now = Date.now(); if (now - lastTouchEnd < 300 && !(e.target as HTMLElement).closest('input')) e.preventDefault(); lastTouchEnd = now; }, { passive: false });
document.addEventListener('touchmove', e => { if (!(e.target as HTMLElement).closest('.panel-body, .items, .tabs, .results, .standings, input')) e.preventDefault(); }, { passive: false });
document.addEventListener('contextmenu', e => e.preventDefault());

async function start() {
  progress(0.1, 'Grooming the knuckle…');
  try {
    // Make sure banner/board fonts are ready before textures are painted
    await Promise.race([
      Promise.all([document.fonts.load('64px Anton'), document.fonts.load('700 30px "Barlow Condensed"'), document.fonts.load('20px "Permanent Marker"')]),
      new Promise(r => setTimeout(r, 2500)),
    ]);
    const game = new Game();
    await game.init(progress);
    (window as unknown as { game: Game }).game = game;
    boot.classList.add('gone');
    setTimeout(() => boot.remove(), 600);
  } catch (err) {
    console.error(err);
    const webgl = String(err).includes('WebGL');
    msg.outerHTML = `<div class="boot-err"><b>${webgl ? 'Your browser can\'t start 3D graphics.' : 'Something went sideways.'}</b><br>${webgl ? 'Try a recent Safari or Chrome with hardware acceleration on.' : 'Reload to try again.'}<br><br><button class="btn primary" onclick="location.reload()"><span>Reload</span></button></div>`;
  }
}
start();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => { /* offline support is optional */ }));
}
