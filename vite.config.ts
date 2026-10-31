import { defineConfig, type Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Generates an offline-first service worker that precaches every built file. */
function serviceWorker(): Plugin {
  return {
    name: 'knuckle-sw',
    apply: 'build',
    closeBundle() {
      const dist = join(process.cwd(), 'dist');
      const files: string[] = [];
      const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else files.push('/' + relative(dist, p).split('\\').join('/')); } };
      walk(dist);
      const list = files.filter(f => f !== '/sw.js' && !f.endsWith('.map') && !(/\.(woff2?)$/.test(f) && !/-latin-[0-9]+-normal.*\.woff2$/.test(f)));
      const hash = createHash('sha1');
      for (const f of list) hash.update(readFileSync(join(dist, f)));
      const version = hash.digest('hex').slice(0, 10);
      const sw = `const CACHE='kh-${version}';const ASSETS=${JSON.stringify(['/', ...list])};
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);if(u.origin!==location.origin)return;
if(r.mode==='navigate'){e.respondWith(fetch(r).then(res=>{const cl=res.clone();caches.open(CACHE).then(c=>c.put('/',cl));return res}).catch(()=>caches.match('/')));return}
e.respondWith(caches.match(r).then(m=>m||fetch(r).then(res=>{if(res.ok){const cl=res.clone();caches.open(CACHE).then(c=>c.put(r,cl))}return res})))});`;
      writeFileSync(join(dist, 'sw.js'), sw);
    },
  };
}

export default defineConfig({
  plugins: [serviceWorker()],
  build: { target: 'es2020', chunkSizeWarningLimit: 1200, assetsInlineLimit: 0 },
  server: { host: true },
});
