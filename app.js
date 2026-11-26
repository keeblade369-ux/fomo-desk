// Desk app. Plan B: the link carries #d=<dataPath>.<key>. The fragment never leaves the phone:
// it is saved in localStorage, removed from the address bar, and used to fetch + decrypt
// d/<dataPath>/state.enc (AES-256-GCM, WebCrypto). Older than 5 minutes = "Desk offline".
(function () {
  var STALE_MS = 5 * 60 * 1000, POLL_MS = 30 * 1000;
  var m = location.hash.match(/[#&]d=([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)/);
  if (m) {
    localStorage.setItem("desk_d", JSON.stringify({ p: m[1], k: m[2] }));
    history.replaceState(null, "", location.pathname + location.search);
  }
  var cfg = null;
  try { cfg = JSON.parse(localStorage.getItem("desk_d") || "null"); } catch (e) {}
  var $ = function (id) { return document.getElementById(id); };
  function offline(why) { $("live").hidden = true; $("offline").hidden = false; $("why").textContent = why; }
  if (!cfg) { offline("Open the desk link once on this phone to connect."); return; }
  function b64u(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return b64(s); }
  function b64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  var keyP = crypto.subtle.importKey("raw", b64u(cfg.k), { name: "AES-GCM" }, false, ["decrypt"]);
  function fetchDec(name) {
    return fetch("d/" + cfg.p + "/" + name + ".enc?c=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
      .then(function (e) {
        return keyP.then(function (k) {
          return crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(e.iv), additionalData: new TextEncoder().encode(name) }, k, b64(e.ct));
        });
      });
  }
  var shotUrl = null;
  function tick() {
    fetchDec("state.json").then(function (buf) {
      var s = JSON.parse(new TextDecoder().decode(buf));
      var age = Date.now() - s.ts * 1000;
      if (age > STALE_MS) return offline("Last update " + Math.round(age / 60000) + " min ago.");
      $("offline").hidden = true; $("live").hidden = false;
      $("mode").textContent = "Desk · " + s.mode;
      $("cash").textContent = s.cash == null ? "-" : "$" + Number(s.cash).toFixed(2);
      $("open").textContent = s.open_positions;
      var hb = s.heartbeats || {}, names = Object.keys(hb);
      $("bots").textContent = names.filter(function (n) { return hb[n].alive; }).length + "/" + names.length;
      $("updated").textContent = "updated " + new Date(s.ts * 1000).toLocaleTimeString();
      return fetchDec("screen.jpg").then(function (img) {
        if (shotUrl) URL.revokeObjectURL(shotUrl);
        shotUrl = URL.createObjectURL(new Blob([img], { type: "image/jpeg" }));
        $("screen").src = shotUrl; $("screen").hidden = false;
      }).catch(function () {});
    }).catch(function (e) { offline("No data (" + e.message + ")."); });
  }
  tick(); setInterval(tick, POLL_MS);
})();
