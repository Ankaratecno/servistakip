/* YAPILACAKLAR3 #48 – çevrimdışı kabuk (offline shell).
 * Tünelde / kapsama boşluğunda sayfa yenilenirse uygulama yine açılsın diye
 * sayfa gezinmeleri "önce ağ, olmazsa önbellek" mantığıyla servis edilir.
 * Statik dosyalar (js/css/font/görsel) önbellekten hızlı döner, arka planda tazelenir.
 */
const CACHE = "acrob-shell-v1";
const SHELL = ["/", "/manifest.webmanifest", "/favicon.ico"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

function isStatic(url) {
  return /\.(?:js|mjs|css|woff2?|ttf|png|jpg|jpeg|svg|webp|ico|mp3|ogg)$/.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Sayfa gezinmeleri: önce ağ, çevrimdışıysa önbellekteki kabuk
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/", copy).catch(() => undefined));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("/"))),
    );
    return;
  }

  if (!isStatic(url)) return;

  // Statikler: önbellekten ver, arka planda tazele
  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy).catch(() => undefined));
          }
          return res;
        })
        .catch(() => hit);
      return hit || network;
    }),
  );
});
