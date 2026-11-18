/* 离线缓存（Service Worker）。这个文件由 scripts/stamp-assets.mjs 按 sw-template.js 生成，不要直接改。
 * - 第一次打开后，把页面、课程数据、词库都缓存下来，之后没网也能练
 * - 带 ?v=版本号 的文件内容不会变：先用缓存
 * - 页面本身（index.html）：先联网取最新的，没网才用缓存，所以更新照常生效
 * - 新版本生效后删掉旧缓存 */
const VERSION = "a8102159";
const CACHE = 'kss-' + VERSION;
const ASSETS = [
  "gate.js?v=301ee842",
  "style.css?v=87c3b56e",
  "data/vocab-nikl.js?v=3242adb5",
  "errors.js?v=e24340ac",
  "data/week1-2.js?v=0e81ab82",
  "data/week3-4.js?v=21fd50cf",
  "data/week5-6.js?v=2db0d584",
  "data/week7-8.js?v=bbe20ff5",
  "data/week9-10.js?v=ac21ce06",
  "data/week11-12.js?v=85794abd",
  "data/week13-14.js?v=b0df2f98",
  "data/week15-16.js?v=8644646f",
  "data/week17-18.js?v=1e5aaa3d",
  "data/week19-20.js?v=d557ff78",
  "data/units-extra-1.js?v=74b6c927",
  "data/order.js?v=95ee2433",
  "data/banmal.js?v=17cc1421",
  "data/units-extra-2.js?v=b40413bd",
  "data/scenes-1.js?v=d69afb29",
  "data/scenes-2.js?v=c18abae0",
  "data/scenes-3.js?v=028092f8",
  "data/scenes-4.js?v=0c67d8ed",
  "data/scenes-5.js?v=8358a880",
  "data/scenes-6.js?v=099bdd59",
  "data/scenes-7.js?v=c354b9b1",
  "data/scenes-8.js?v=2ce9fad6",
  "data/phrasebank.js?v=17fde898",
  "data/phrasebank-2.js?v=d1f7029e",
  "data/phrasebank-3.js?v=b237e4d6",
  "data/phrasebank-4.js?v=5ee48a89",
  "data/shadowing.js?v=987434d8",
  "data/shadowing-2.js?v=2861134f",
  "data/shadowing-3.js?v=97e9d7ab",
  "data/qa.js?v=90119286",
  "data/qa-2.js?v=4eee3584",
  "data/replies.js?v=e1d97a9e",
  "data/listening.js?v=58f3ab4a",
  "data/listening-2.js?v=3e1da3b7",
  "data/spoken.js?v=217c6860",
  "data/models-1.js?v=059346db",
  "data/models-2.js?v=aa2c4723",
  "data/models-3.js?v=4d8573af",
  "data/models-4.js?v=dbfd4e02",
  "data/testmodels-1.js?v=be6767cc",
  "data/testmodels-2.js?v=2688369b",
  "data/vocab-topik.js?v=ac133ab0",
  "data/vocab-daily.js?v=17152f05",
  "data/vocab-index.js?v=890bd678",
  "data/styles.js?v=209222c3",
  "data/pairs.js?v=c6c4d4a2",
  "data/pronunciation.js?v=f6f5d8ec",
  "data/pronunciation-2.js?v=d48d159f",
  "data/ai-scenarios.js?v=b89542f4",
  "app.js?v=09552e3c",
  "manifest.webmanifest",
  "icon-180.png",
  "icon-192.png",
  "icon-512.png"
];

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
