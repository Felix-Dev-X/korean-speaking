/* 离线缓存（Service Worker）。由 scripts/stamp-assets.mjs 按这个模板生成 app/sw.js，不要直接改 sw.js。
 * - 第一次打开后，把页面、课程数据、词库都缓存下来，之后没网也能练
 * - 带 ?v=版本号 的文件内容不会变：先用缓存
 * - 页面本身（index.html）：先联网取最新的，没网才用缓存，所以更新照常生效
 * - 新版本生效后删掉旧缓存 */
const VERSION = '__VERSION__';
const CACHE = 'kss-' + VERSION;
const ASSETS = __ASSETS__;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', ...ASSETS])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k.startsWith('kss-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // AI 接口等外部请求不管
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put('./', copy)); }
      return r;
    }).catch(() => caches.match('./')));
    return;
  }
  if (url.searchParams.has('v')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return r;
    })));
    return;
  }
  e.respondWith(fetch(req).catch(() => caches.match(req)));
});
