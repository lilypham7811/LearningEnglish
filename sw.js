// Service worker: lets the installed app open offline (library dialogs, saved items, practice log).
// App files: network first, so updates show up right away; the cached copy is used only when offline.
// Google Fonts: cache first. Google AI and YouTube requests are never cached.
const CACHE = "shadow-english-v21";
const SHELL = [
  "./", "./index.html", "./styles.css?v=22", "./dialogs.js?v=22", "./app.js?v=22", "./live.js?v=22", "./library.js?v=22", "./words.js?v=22", "./handoff.js?v=22", "./sync.js?v=22",
  "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // cache: "no-cache" = always ask GitHub whether there is a newer version (GitHub lets browsers keep
    // pages for 10 minutes otherwise, so updates seemed not to arrive).
    e.respondWith(fetch(req, { cache: "no-cache" }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: req.mode === "navigate" }).then((r) => r || caches.match("./index.html"))));
  } else if (/^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    })));
  }
});
