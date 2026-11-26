/*
 * オフラインでも開けるよう、アプリのファイルを端末に置いておく（入れたデータはここでは扱わない）。
 * 版を上げたら VERSION を変える。新しい版は、利用者が「更新する」を押したときに切り替わる。
 */
const VERSION = 'kakeibo-0.25.0-1';
const FILES = ['./', 'index.html', 'style.css', 'domain.js', 'data.js', 'report.js', 'app.js', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

// 手元に置いたファイルを先に使う（電波が無くても開ける）。無いものだけネットから取る
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then((c) => c.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request))));
});
