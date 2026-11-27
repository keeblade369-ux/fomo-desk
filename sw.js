// CACHE_V=8f · caches agent icons only; version query busts the registered script.
// Desk data is never cached. Web push lands in Step 11 (POST /api/push, VAPID public key only here).
// Until then it only shows a push if one arrives.
var CACHE_V = "8f";
var ICON_CACHE = "desk-icons-" + CACHE_V;
var AGENT_ICONS = ["scanner", "analyst", "brain", "executor", "risk"].map(function (b) {
  return "icons/agents/" + b + ".webp?v=" + CACHE_V;
});
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(ICON_CACHE).then(function (c) { return c.addAll(AGENT_ICONS); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf("desk-icons-") === 0 && k !== ICON_CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  var u = new URL(e.request.url);
  if (u.pathname.indexOf("/icons/agents/") < 0) return;
  e.respondWith(caches.match(e.request).then(function (r) { return r || fetch(e.request); }));
});
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
