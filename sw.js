// CACHE_V=8d · no asset cache; version query busts the registered script.
// Service worker · web push lands in Step 11 (POST /api/push, VAPID public key only here).
// Until then it only shows a push if one arrives; no caching of desk data.
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener("push", function (e) {
  var d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) {}
  if (!d.text) return;
  e.waitUntil(self.registration.showNotification("Grok Bot", { body: d.text, data: { link: d.link || null } }));
});
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var l = e.notification.data && e.notification.data.link;
  if (l) e.waitUntil(self.clients.openWindow(l));
});
