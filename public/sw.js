/* School Management System service worker: offline pages for the driver/parent app + web push. */
const CACHE = "sms-v1";
const OFFLINE_PAGES = ["/driver/emergency", "/offline"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/offline"]).catch(() => {})));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// Network first; cache GET navigations for offline-capable pages; fall back to cache, then /offline.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const cacheable = OFFLINE_PAGES.some((p) => url.pathname.startsWith(p)) || url.pathname.startsWith("/api/driver/emergency") || url.pathname.startsWith("/_next/static");
  if (req.mode === "navigate" || cacheable) {
    e.respondWith(
      fetch(req).then((res) => {
        if (cacheable && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(async () => (await caches.match(req)) || (req.mode === "navigate" ? caches.match("/offline") : Response.error()))
    );
  }
});

self.addEventListener("push", (e) => {
  let data = { title: "School update", body: "", link: "/" };
  try { data = { ...data, ...e.data.json() }; } catch {}
  e.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: "/icon-192.png", badge: "/icon-192.png", data: { link: data.link } }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((list) => {
    for (const c of list) if ("focus" in c) { c.navigate(link); return c.focus(); }
    return self.clients.openWindow(link);
  }));
});
