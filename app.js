// Desk app · STEP 10. Two data sources, one renderer:
//   plan A: the desk API. The link carries #t=<APP_TOKEN> once; it moves to localStorage and leaves the address bar.
//   plan B: GitHub Pages. The link carries #d=<path>.<key>. Files are AES-256-GCM, AAD = file name.
//   In Safari (not standalone) the #d= fragment stays in the address bar so Add to Home Screen captures it
//   (iOS home-screen apps have their own localStorage, separate from Safari). In standalone, #d= is read
//   into localStorage on launch; the fragment may stay. The key never goes to the server (it is a hash).
// Never a made-up number: anything the desk doesn't send renders as an empty state.
(function () {
  "use strict";
  var LS = window.localStorage, H = location.hash;
  var mt = H.match(/[#&]t=([A-Za-z0-9_\-.~]+)/), md = H.match(/[#&]d=([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)/);
  var route0 = (H.match(/[#&]r=([^&]+)/) || [])[1];
  if (mt) { LS.setItem("desk_t", mt[1]); LS.removeItem("desk_d"); }
  if (md) { LS.setItem("desk_d", JSON.stringify({ p: md[1], k: md[2] })); LS.removeItem("desk_t"); }
  var TOKEN = LS.getItem("desk_t"), DK = null;
  try { DK = JSON.parse(LS.getItem("desk_d") || "null"); } catch (e) {}
  var PLAN = TOKEN ? "A" : (DK ? "B" : null);
  function isStandalone() {
    return (window.navigator && navigator.standalone === true) ||
      (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
  }
  // Safari: keep or restore #d=<path>.<key> so Share > Add to Home Screen saves the key.
  // Standalone: leave the fragment as-is (already stored if it was present).
  if (DK && DK.p && DK.k && !isStandalone()) {
    var keep = "#d=" + DK.p + "." + DK.k;
    var rt = route0 ? decodeURIComponent(route0) : "";
    if (!rt) {
      var legacy = H.replace(/^#/, "");
      if (legacy.charAt(0) === "/" && legacy.indexOf("d=") < 0 && legacy.indexOf("t=") < 0) rt = legacy;
    }
    if (rt && rt !== "/home") keep += "&r=" + rt;
    history.replaceState(null, "", location.pathname + location.search + keep);
  } else if (mt) {
    history.replaceState(null, "", location.pathname + location.search + "#" + (route0 ? decodeURIComponent(route0) : "/home"));
  }
  var RM = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- data ----------
  function b64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function b64u(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return b64(s); }
  var keyP = DK ? crypto.subtle.importKey("raw", b64u(DK.k), { name: "AES-GCM" }, false, ["decrypt"]) : null;
  var macP = DK ? crypto.subtle.importKey("raw", b64u(DK.k), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]) : null;
  function coinName(mint) {   // same as publish.coin_name: c/{HMAC-SHA256(key, "coin:"+mint) hex[:32]}.json
    return macP.then(function (k) { return crypto.subtle.sign("HMAC", k, new TextEncoder().encode("coin:" + mint)); }).then(function (sig) {
      return "c/" + Array.prototype.map.call(new Uint8Array(sig), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("").slice(0, 32) + ".json";
    });
  }
  function dec(name) {
    return fetch("d/" + DK.p + "/" + name + ".enc?c=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
      .then(function (e) { return keyP.then(function (k) { return crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(e.iv), additionalData: new TextEncoder().encode(name) }, k, b64(e.ct)); }); });
  }
  function decJSON(name) { return dec(name).then(function (b) { return JSON.parse(new TextDecoder().decode(b)); }); }
  function api(path, body) {
    var o = { headers: { Authorization: "Bearer " + TOKEN }, cache: "no-store" };
    if (body !== undefined) { o.method = "POST"; o.headers["Content-Type"] = "application/json"; o.body = JSON.stringify(body); }
    return fetch(path, o).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.error || ("http " + r.status)); e.status = r.status; throw e; } return j; });
    });
  }
  var D = {
    state: function () { return PLAN === "A" ? api("/api/state") : decJSON("state.json"); },
    chart: function () { return PLAN === "A" ? api("/api/chart") : decJSON("chart.json"); },
    activity: function () { return PLAN === "A" ? api("/api/activity?limit=50") : decJSON("activity.json"); },
    coin: function (m) { return PLAN === "A" ? api("/api/coin/" + encodeURIComponent(m)) : coinName(m).then(decJSON); },
    search: function (q) {
      if (PLAN === "A") return api("/api/search?q=" + encodeURIComponent(q));
      q = q.toLowerCase();
      return decJSON("coins.json").then(function (cs) { return cs.filter(function (c) { return c.mint === q || (c.symbol || "").toLowerCase().indexOf(q) >= 0 || (c.name || "").toLowerCase().indexOf(q) >= 0; }).slice(0, 20); });
    },
    frame: function () {   // -> {url, ts}
      if (PLAN === "A") return fetch("/api/screen.jpg", { headers: { Authorization: "Bearer " + TOKEN }, cache: "no-store" }).then(function (r) {
        if (!r.ok) throw new Error("no frame");
        var ts = parseFloat(r.headers.get("X-Frame-Ts") || "0");
        return r.blob().then(function (b) { return { url: URL.createObjectURL(b), ts: ts }; });
      });
      return Promise.all([dec("screen.jpg"), decJSON("screen.json").catch(function () { return {}; })]).then(function (a) {
        return { url: URL.createObjectURL(new Blob([a[0]], { type: "image/jpeg" })), ts: a[1].ts || 0, coin: a[1] };
      });
    },
    frameCoin: function () { return PLAN === "A" ? api("/api/screen/coin") : decJSON("screen.json"); }
  };

  // ---------- helpers ----------
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  function usd(v, d) { if (v == null || isNaN(v)) return null; var a = Math.abs(v), dd = d != null ? d : (a >= 1 ? 2 : a >= 0.01 ? 4 : 8); return (v < 0 ? "-" : "") + "$" + a.toLocaleString("en-US", { minimumFractionDigits: dd, maximumFractionDigits: dd }); }
  function compact(v) { if (v == null) return null; var a = Math.abs(v); return a >= 1e9 ? "$" + (v / 1e9).toFixed(2) + "B" : a >= 1e6 ? "$" + (v / 1e6).toFixed(2) + "M" : a >= 1e3 ? "$" + (v / 1e3).toFixed(1) + "K" : "$" + v.toFixed(0); }
  function pct(v) { return v == null ? null : (v >= 0 ? "+" : "") + v.toFixed(2) + "%"; }
  function tm(ts) { if (!ts) return ""; var t = typeof ts === "number" ? new Date(ts * 1000) : new Date(String(ts).replace(" ", "T")); return t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
  function age(s) { if (s == null) return null; s = Math.max(0, s); return s < 3600 ? Math.round(s / 60) + "m" : s < 86400 ? Math.round(s / 3600) + "h" : Math.round(s / 86400) + "d"; }
  function short(m) { return m ? m.slice(0, 4) + "…" + m.slice(-4) : ""; }
  var BOTN = { scanner: "Scanner", analyst: "Analyst", brain: "Brain", executor: "Executor", risk: "Risk" };
  var BOTC = { scanner: "#64d2ff", analyst: "#ffd60a", brain: "#bf5af2", executor: "#00d35a", risk: "#ff6b9a" };
  function fomoA(link, label) { return link ? '<a class="fomo" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer" data-stop>' + esc(label || "Open on FOMO") + "</a>" : ""; }
  function toast(t) { var e = document.createElement("div"); e.className = "toast"; e.textContent = t; document.body.appendChild(e); setTimeout(function () { e.remove(); }, 1800); }
  var ICON = {
    home: '<svg viewBox="0 0 24 24"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
    bots: '<svg viewBox="0 0 24 24"><rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M9 12h.01M15 12h.01M9 16h6"/></svg>',
    activity: '<svg viewBox="0 0 24 24"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>',
    account: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
    bell: '<svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"/></svg>'
  };

  // ---------- odometer ----------
  function odo(el, text) {
    if (el._t === text) return; var prev = el._t; el._t = text;
    if (RM || prev == null || prev.length !== text.length) {
      el.innerHTML = text.split("").map(function (ch) {
        if (!/\d/.test(ch)) return "<span>" + esc(ch) + "</span>";
        return '<span class="d"><span class="col" style="transform:translateY(-' + (+ch) * 1.05 + 'em)">' + "0123456789".split("").map(function (n) { return "<span>" + n + "</span>"; }).join("") + "</span></span>";
      }).join("");
      return;
    }
    var cols = el.querySelectorAll(".col"), di = 0, k = 0;
    text.split("").forEach(function (ch, i) {
      if (!/\d/.test(ch)) return; var c = cols[di++]; if (!c) return;
      if (ch !== prev[i]) { c.style.transitionDelay = (k++ * 30) + "ms"; c.style.transform = "translateY(-" + (+ch) * 1.05 + "em)"; }
    });
  }

  // ---------- app state ----------
  var S = { state: null, chart: null, activity: null, coin: {}, lastOk: 0, err: null, retryAt: 0, range: LS.getItem("desk_range") || "LIVE", frame: null, frameCoin: null, prevPts: 0, sell: null };
  var view;
  function route() {
    var raw = location.hash.replace(/^#/, "");
    var rMatch = raw.match(/(?:^|&)r=([^&]*)/);
    var path;
    if (rMatch) path = decodeURIComponent(rMatch[1] || "");
    else if (!raw || /^(?:d|t)=/.test(raw)) path = "/home";
    else path = raw.charAt(0) === "/" ? raw : "/" + raw;
    var p = path.split("/").filter(Boolean);
    return { name: p[0] || "home", arg: p[1] };
  }
  function go(path) {
    if (path.charAt(0) !== "/") path = "/" + path;
    var h = "#" + path;
    if (DK && DK.p && DK.k) {
      h = "#d=" + DK.p + "." + DK.k;
      if (path !== "/home") h += "&r=" + path;
    }
    location.hash = h;
  }

  // ---------- shell ----------
  function shell() {
    document.body.innerHTML = '<div id="view"></div><nav class="tabbar">' + ["home", "bots", "activity", "account"].map(function (t) {
      var label = { home: "Home", bots: "Agents", activity: "Activity", account: "Account" }[t];
      return '<button data-tab="' + t + '" aria-label="' + label + '">' + ICON[t] + "<span>" + label + "</span></button>";
    }).join("") + "</nav>";
    view = $("#view");
    document.body.addEventListener("click", onClick);
    window.addEventListener("hashchange", render);
    window.addEventListener("resize", function () { drawChart(); drawCoin(); });
  }
  function errRow() {
    if (!S.err) return "";
    var n = Math.max(0, Math.ceil((S.retryAt - Date.now()) / 1000));
    return '<div class="errrow num" id="errrow">Desk offline · retrying in ' + n + "s · last update " + (S.lastOk ? tm(S.lastOk / 1000) : "never") + "</div>";
  }
  function navbar(title, back) {
    var left = back ? '<button class="back" data-back>‹ Back</button>' : '<button class="avatar" data-go="/account" aria-label="Account">K</button>';
    return '<div class="nav">' + left + '<div class="title">' + title + "</div>" +
      '<button class="iconbtn" data-search aria-label="Search">' + ICON.search + "</button>" +
      '<button class="iconbtn" data-go="/activity" aria-label="Activity">' + ICON.bell + (S.activity && S.activity.length && S.activity[0].ts * 1000 > (+LS.getItem("desk_seen") || 0) ? '<span class="dot"></span>' : "") + "</button></div>" + errRow();
  }
  function sk(h, w, mt) { return '<div class="sk" style="height:' + h + "px;" + (w ? "width:" + w + ";" : "") + "margin-top:" + (mt || 10) + 'px"></div>'; }

  // ---------- HOME ----------
  function home() {
    var s = S.state;
    if (!s) return navbar('Grok Bot <span class="chev">›</span>') + sk(70, "70%", 8) + sk(18, "40%") + sk(220, null, 14) + sk(190, null, 14) + sk(168, null, 26) + sk(300, null, 26);
    var paper = s.mode === "PAPER" ? '<span class="pill paper">PAPER</span>' : "";
    var mult = s.multiplier != null ? '<span class="pill mult mono num">' + s.multiplier.toFixed(2) + "×</span>" : "";
    var tp = s.todayPct != null ? '<span class="' + (s.todayPct >= 0 ? "up" : "down") + ' num">' + pct(s.todayPct) + "</span> <span>today</span>" : '<span>Today: no balance history yet</span>';
    var lane = s.lane && s.lane.bot ? '<span style="color:' + BOTC[s.lane.bot] + '">' + esc(BOTN[s.lane.bot] + " · " + (s.lane.action || "")) + "</span>" : "Idle";
    var lo = s.lastOrder, ck = function (k, l) { var v = lo && lo.checks[k]; return '<span class="ck ' + (v === true ? "ok" : v === false ? "no" : "") + '">' + (v === true ? "✓ " : v === false ? "✗ " : "") + l + "</span>"; };
    var loTxt = lo ? esc(lo.text) + " · " + (lo.status === "verified" ? "verified" : lo.paper ? "PAPER" : esc(lo.status)) : "No orders yet";
    var bots = ["scanner", "analyst", "brain", "executor", "risk"];
    return navbar('Grok Bot <span class="chev">›</span>') +
      '<div class="bal"><span class="big num odo" id="bal"></span>' + paper + "</div>" +
      '<div class="sub">' + tp + mult + "</div>" +
      '<div class="chartwrap"><canvas id="chart"></canvas><div id="chartEmpty" class="empty hidden" style="position:absolute;inset:40px 0 0">Waiting for the first trade</div></div>' +
      '<div class="ranges">' + ["LIVE", "1H", "4H", "1D", "1W", "ALL"].map(function (r) { return '<button data-range="' + r + '" class="' + (S.range === r ? "on" : "") + '">' + r + "</button>"; }).join("") + "</div>" +
      '<div class="live" data-full><img id="f0" alt=""><img id="f1" alt=""><div class="tl" id="ftl"><span class="ldot grey"></span>No frame yet</div><div class="tr">' + lane + "</div></div>" +
      '<div class="lastorder"><span class="num">' + loTxt + '</span><span class="checks">' + ck("screen", "screen") + ck("api", "api") + ck("chain", "chain") + "</span></div>" +
      '<div class="sect"><h2>Agents · ' + s.botsRunning + ' running</h2><button data-go="/bots">See all</button></div>' +
      '<div class="carousel">' + bots.map(function (b) { return botCard(b, s.bots[b]); }).join("") + "</div>" +
      '<div class="sect"><h2>Activity</h2><button data-go="/activity">See all</button></div>' + actRows((S.activity || []).slice(0, 5), "Waiting for the first trade");
  }
  function aico(b, c) {
    var st = c && c.paused ? "pz" : (c && c.alive) ? "run" : "off";
    return '<span class="aico ' + st + " " + b + '" aria-hidden="true"><img src="icons/agents/' + b + '.webp?v=8e" alt=""></span>';
  }
  function botHd(b, c) { return '<div class="hd">' + aico(b, c) + '<span class="nm" style="color:' + c.color + '">' + BOTN[b] + "</span></div>"; }
  function botCard(b, c) {
    var body = "";
    if (b === "scanner") body = '<div class="feed">' + (c.feed.slice(0, 3).map(scanLine).join("") || '<span>No pools yet tonight</span>') + "</div>";
    if (b === "analyst") {
      var l = c.last;
      body = l ? '<div style="display:flex;gap:12px;align-items:center"><canvas class="ring" data-ring="' + (l.score == null ? "" : l.score) + '"></canvas><div style="flex:1"><div class="strips">' +
        (l.layers || []).map(function (x) { return '<span class="strip ' + (x.pass === true ? "ok" : x.pass === false ? "no" : "") + '"></span>'; }).join("") + '</div><div class="feed" style="margin-top:6px"><span class="p">' + esc(l.symbol) + "</span><span>" + (l.socialPts != null ? "Social +" + l.socialPts : "Social: off") + "</span></div></div></div>" : '<div class="feed"><span>No audits yet tonight</span></div>';
    }
    if (b === "brain") {
      var lb = c.last;
      body = '<div class="feed">' + (lb && lb.sizeUsd ? '<span class="p num">' + usd(lb.sizeUsd, 2) + (lb.pctOfCash != null ? " · " + lb.pctOfCash + "% of cash" : "") + "</span>" : lb ? "<span>" + esc(lb.reason || "No size") + "</span>" : "<span>Nothing sized yet</span>") +
        "<span>" + esc(c.rule) + "</span><span>" + esc(c.rule2) + "</span></div>";
    }
    if (b === "executor") body = '<div class="bar">' + esc(c.bar || "Idle") + "</div>";
    if (b === "risk") body = '<div class="pills">' + c.pills.map(function (p) { return '<span class="tp ' + p.color + '">' + esc(p.text) + "</span>"; }).join("") + "</div>";
    return '<div class="card bc">' + botHd(b, c) + '<div class="hl num">' + esc(c.headline) + "</div>" + body + "</div>";
  }
  function scanLine(f) {
    if (f.verdict === "kill") return '<span><span class="k">' + esc(f.symbol) + "</span> " + esc(f.reason || "") + "</span>";
    if (f.verdict === "pass") return '<span><span class="p">' + esc(f.symbol) + "</span> → Analyst</span>";
    return "<span>" + esc(f.symbol) + " · " + esc(f.verdict) + (f.reason ? " · " + esc(f.reason) : "") + "</span>";
  }
  function actIcon(k) { var m = { bought: ["↓", "#0a84ff"], sold: ["↑", "#00d35a"], stopped: ["✕", "#ff453a"], rejected: ["–", "rgba(235,235,245,0.6)"] }[k] || ["•", "#fff"]; return '<span class="ic" style="color:' + m[1] + ';background:#2c2c2e">' + m[0] + "</span>"; }
  function actRows(rows, emptyText) {
    if (!rows.length) return '<div class="rows"><div class="empty">' + esc(emptyText) + "</div></div>";
    return '<div class="rows">' + rows.map(function (r) {
      var cls = r.kind === "sold" ? "up" : r.kind === "stopped" ? "down" : "";
      return '<div class="row tap" data-go="/' + (r.opens || "coin") + "/" + esc(r.mint || "") + '">' + actIcon(r.kind) + '<div class="m"><div class="t">' + esc(r.title) + '</div><div class="s">' + esc(r.subtitle || "") + '</div></div><div class="v num ' + cls + '">' + esc(r.value || "") + fomoA(r.link) + "</div></div>";
    }).join("") + "</div>";
  }

  // ---------- chart ----------
  var RANGE_S = { LIVE: 1800, "1H": 3600, "4H": 14400, "1D": 86400, "1W": 604800 };
  function drawChart(progress) {
    var cv = $("#chart"); if (!cv || !S.chart) return;
    var pts = S.chart.points || [], now = Date.now() / 1000, from = S.range === "ALL" ? (pts[0] ? pts[0][0] : now) : now - RANGE_S[S.range];
    if (S.range === "LIVE") { var fp = pts.filter(function (p) { return p[0] >= from; })[0]; if (fp) from = fp[0]; }
    var vis = pts.filter(function (p) { return p[0] >= from; });
    if (vis.length && vis[0][0] > from && pts.length > vis.length) vis.unshift([from, pts[pts.length - vis.length - 1][1]]);
    var empty = vis.length < 2 && !(S.chart.marks || []).length;
    var e = $("#chartEmpty"); if (e) e.classList.toggle("hidden", !empty);
    DeskChart.line(cv, vis.length >= 2 ? vis : [], { start: S.state && S.state.nightStartBalance, marks: S.chart.marks, from: from, to: S.range === "ALL" || S.range === "LIVE" ? undefined : now, progress: progress });
  }
  function slideIn() {
    if (RM) return drawChart(1);
    var t0 = performance.now(); (function f(t) { var p = Math.min(1, (t - t0) / 250); drawChart(1 - Math.pow(1 - p, 3)); if (p < 1) requestAnimationFrame(f); })(t0);
  }

  // ---------- live frame (double buffered) ----------
  var fb = 0, frameBusy = false;
  function pullFrame() {
    if (frameBusy || !$("#f0")) return; frameBusy = true;
    D.frame().then(function (f) {
      var nxt = $("#f" + (1 - fb)), cur = $("#f" + fb);
      if (!nxt) return;
      nxt.onload = function () { nxt.classList.add("show"); cur.classList.remove("show"); if (cur._u) URL.revokeObjectURL(cur._u); fb = 1 - fb; };
      nxt._u = f.url; nxt.src = f.url; S.frame = f; if (f.coin) S.frameCoin = f.coin; frameLabel();
    }).catch(function () { frameLabel(); }).then(function () { frameBusy = false; });
  }
  function frameLabel() {
    var e = $("#ftl"); if (!e) return; var f = S.frame;
    if (!f || !f.ts) { e.innerHTML = '<span class="ldot grey"></span>No frame yet'; return; }
    var fresh = Date.now() / 1000 - f.ts < 5;
    e.innerHTML = fresh ? '<span class="ldot"></span>Live · Bot\'s computer' : '<span class="ldot grey"></span>Last frame ' + tm(f.ts);
  }
  function fullScreen() {
    if (!S.frame) return;
    var d = document.createElement("div"); d.className = "full";
    d.innerHTML = '<div class="bar2"><button class="back" data-close>Done</button><span id="fullfomo"></span></div><div class="zoom"><img src="' + S.frame.url + '" alt="desk screen"></div>';
    document.body.appendChild(d);
    var put = function (c) { var x = $("#fullfomo"); if (x && c && c.link) x.innerHTML = '<a class="back" href="' + esc(c.link) + '" target="_blank" rel="noopener noreferrer">Open on FOMO</a>'; };
    put(S.frameCoin); D.frameCoin().then(function (c) { S.frameCoin = c; put(c); }).catch(function () {});
  }

  // ---------- BOTS ----------
  function bots() {
    var s = S.state;
    var head = navbar("Agents") + '<h1 class="pg">Agents</h1>';
    if (!s) return head + sk(260) + sk(260) + sk(260);
    return head + ["scanner", "analyst", "brain", "executor", "risk"].map(function (b) {
      var c = s.bots[b], ro = PLAN !== "A";
      var status = c.paused ? "Paused" : c.alive ? "Running" : "Not running";
      var feed = c.feed || [];
      var line = function (f) {
        var txt = b === "scanner" ? (f.verdict === "kill" ? '<span class="k">' + esc(f.symbol) + "</span> " + esc(f.reason || "") : esc(f.symbol) + " · " + esc(f.verdict) + (f.reason ? " · " + esc(f.reason) : "")) :
          b === "analyst" ? esc(f.symbol) + " · " + (f.score == null ? "no score" : f.score + (f.passed ? " pass" : " fail")) + (f.reason ? " · " + esc(f.reason) : "") :
          b === "brain" ? esc(f.symbol) + " · " + (f.sizeUsd ? usd(f.sizeUsd, 2) : esc(f.reason || "no size")) :
          b === "executor" ? esc(f.symbol) + " · " + esc(f.side || "") + " " + esc(f.status || "") + (f.reason ? " · " + esc(f.reason) : "") :
          esc(f.symbol) + " · " + esc(f.action);
        return '<div class="dec"><span class="num">' + txt + ' <span style="color:var(--ter)">' + tm(f.ts) + "</span></span>" + fomoA(f.link, "FOMO") + "</div>";
      };
      return '<div class="card bfull"><div class="top">' + aico(b, c) + '<div style="flex:1"><div style="font-weight:600;color:' + c.color + '">' + BOTN[b] + '</div><div class="s" style="color:var(--sec);font-size:13px">' + status + " · " + esc(c.headline) + " today</div></div>" +
        '<div class="swwrap" ' + (ro || c.pauseLocked ? "" : 'data-pause="' + b + '"') + ' title="' + (c.pauseLocked ? "Locked while a position is open" : "Pause") + '"><span class="sw ' + (c.paused ? "" : "on") + (c.pauseLocked || ro ? " locked" : "") + '"></span></div></div>' +
        (c.pauseLocked ? '<div class="note" style="padding:6px 0">Locked while a position is open</div>' : "") +
        '<div style="margin-top:8px">' + (feed.slice(0, 20).map(line).join("") || '<div class="dec"><span style="color:var(--sec)">Nothing yet tonight</span></div>') + "</div>" +
        '<div class="dec"><button style="color:var(--blue);min-height:44px" data-go="/account/' + b + '">Settings</button></div></div>';
    }).join("") + (PLAN !== "A" ? '<div class="note">Read-only copy: pause through Telegram (Step 11).</div>' : "");
  }

  // ---------- ACTIVITY ----------
  function activity() {
    LS.setItem("desk_seen", String(Date.now()));
    var head = navbar("Activity") + '<h1 class="pg">Activity</h1>';
    if (!S.activity) return head + sk(60) + sk(60) + sk(60) + sk(60);
    return head + actRows(S.activity, "Nothing yet tonight");
  }

  // ---------- AUDIT ----------
  function audit(mint) {
    var c = S.coin[mint];
    var head = navbar("Audit", true);
    if (c === undefined) { loadCoin(mint); return head + sk(40, "60%") + sk(260) + sk(50); }
    if (c === null) return head + '<div class="empty">This coin is not in the desk data.</div>';
    if (c._err) { return head + '<div class="empty">Can\'t reach the desk right now · ' + esc(c._err) + ' · it retries on its own</div>'; }
    var L = c.layers;
    var title = '<h1 class="pg">' + esc(c.symbol || c.name || short(mint)) + '</h1><div class="sub">' + esc(c.name || "") + " · " + short(mint) + "</div>";
    if (!L) return head + title + '<div class="empty">Not audited yet</div>';
    var sc = c.score;
    return head + title + '<div class="discs">' + L.map(function (l, i) {
      var st = l.pass === true ? "ok" : l.pass === false ? "no" : "na";
      return '<div class="disc"><div class="c ' + st + '" data-i="' + i + '"><span class="reveal">' + (st === "ok" ? "✓" : st === "no" ? "✕" : "–") + '</span></div><div class="lv">' + esc(l.name) + '</div><div class="vv reveal num ' + (st === "ok" ? "up" : st === "no" ? "down" : "") + '">' + esc(l.value) + "</div></div>";
    }).join("") + "</div>" +
      '<div class="rows"><div class="row"><div class="m"><div class="t">' + (sc && sc.socialPts != null && c.social ? "Social +" + sc.socialPts : "Social: off") + "</div></div></div>" +
      (sc ? '<div class="row"><div class="m"><div class="t">Score ' + (sc.score == null ? "–" : sc.score) + '</div><div class="s">' + (sc.passed ? "Passed" : "Failed") + (sc.reason ? " · " + esc(sc.reason) : "") + '</div></div>' + (sc.score == null ? "" : '<canvas class="ring" data-ring="' + sc.score + '"></canvas>') + '</div>' : "") +
      '<div class="row"><div class="m"><div class="s">' + esc((L.find(function (l) { return l.source; }) || {}).source || "") + '</div></div><div class="v">' + fomoA(c.link) + "</div></div></div>";
  }
  function animateAudit() {
    var ds = view.querySelectorAll(".disc");
    ds.forEach(function (d, i) {
      var go = function () { d.querySelectorAll(".reveal").forEach(function (r) { r.classList.add("in"); }); };
      if (RM) return go();
      setTimeout(function () { var b = document.createElement("span"); b.className = "beam"; d.querySelector(".c").appendChild(b); setTimeout(go, 500); }, i * 350);
    });
  }

  // ---------- COIN ----------
  function coin(mint) {
    var c = S.coin[mint], s = S.state;
    var head = navbar("", true);
    if (c === undefined) { loadCoin(mint); return head + sk(34, "50%") + sk(18, "70%") + sk(60, "60%", 14) + sk(220, null, 14) + sk(60, null, 14); }
    if (c === null) return head + '<div class="empty">This coin is not in the desk data.</div>';
    if (c._err) { return head + '<div class="empty">Can\'t reach the desk right now · ' + esc(c._err) + ' · it retries on its own</div>'; }
    var p = c.position, open = p && p.open;
    var paper = s && s.mode === "PAPER" ? ' <span class="pill paper">PAPER</span>' : "";
    var shield = c.shield ? '<span class="chip' + (c.shield === "8/8" ? "" : " bad") + '">' + c.shield + "</span>" : "";
    var se = p && p.sinceEntryPct != null ? '<div class="sub ' + (p.sinceEntryPct >= 0 ? "up" : "down") + ' num">' + (p.sinceEntryPct >= 0 ? "▲ " : "▼ ") + Math.abs(p.sinceEntryPct).toFixed(2) + "% since entry</div>" : "";
    var tile = function (l, v) { return '<div class="tile"><div class="l">' + l + '</div><div class="x num">' + (v == null ? '<span style="color:var(--ter)">No data</span>' : esc(v)) + "</div></div>"; };
    var canSell = open && PLAN === "A";
    return head + '<div style="display:flex;align-items:center;gap:8px"><h1 class="pg" style="margin:0">' + esc(c.name || c.symbol || short(mint)) + "</h1>" + paper + "</div>" +
      '<div class="sub">' + esc([c.symbol, c.chain, c.ageS != null ? age(c.ageS) + " old" : null].filter(Boolean).join(" · ")) + " " + shield + "</div>" +
      '<div class="big num" style="margin-top:10px;font-size:' + (c.price != null ? "44px" : "22px") + '">' + (c.price != null ? usd(c.price) : '<span style="color:var(--sec)">No price yet</span>') + "</div>" + se +
      '<div class="chartwrap" style="height:220px;margin-top:14px"><canvas id="candles"></canvas>' + (c.candles && c.candles.length ? "" : '<div class="empty" style="position:absolute;inset:60px 0 0">No price ticks in the desk yet</div>') + "</div>" +
      '<div class="tiles">' + tile("Market cap", compact(c.marketCap)) + tile("Liquidity", compact(c.liquidity)) + tile("Holders", c.holders != null ? c.holders.toLocaleString() : null) + "</div>" +
      (p ? '<div class="rows" style="margin-top:14px"><div class="row"><div class="m"><div class="t num">Your position · ' + usd(p.sizeUsd, 2) + " in · " + p.bot + '</div><div class="s">' + (open ? "Open · stop " + usd(p.stop) : "Closed · " + esc(p.exitReason || "") + (p.pnlUsd != null ? " · " + usd(p.pnlUsd, 2) + " net" : "")) + (p.feesUsd != null ? " · " + usd(p.feesUsd, 2) + " fees" : "") + "</div></div></div></div>" :
        '<div class="rows" style="margin-top:14px"><div class="row"><div class="m"><div class="s">No position in this coin</div></div><button style="color:var(--blue);min-height:44px" data-go="/audit/' + esc(mint) + '">Audit</button></div></div>') +
      '<div class="btns"><a class="btn blue" href="' + esc(c.link) + '" target="_blank" rel="noopener noreferrer">Open on FOMO</a><button class="btn red" data-sell="' + esc(mint) + '"' + (canSell ? "" : " disabled") + ">Sell now</button></div>" +
      (open && PLAN !== "A" ? '<div class="note">Read-only copy: sell through Telegram (Step 11).</div>' : "") +
      '<div class="note" style="text-align:center">' + short(mint) + "</div>";
  }
  function drawCoin() {
    var cv = $("#candles"), r = route(); if (!cv) return; var c = S.coin[r.arg]; if (!c) return;
    DeskChart.candles(cv, c.candles, c.position && c.position.open ? c.position.stop : null);
  }
  function loadCoin(m) {
    if (S.coin["_l" + m]) return; S.coin["_l" + m] = 1;
    D.coin(m).then(function (c) { S.coin[m] = c; }).catch(function (e) { S.coin[m] = e && e.status === 404 ? null : { _err: (e && e.message) || "offline" }; }).then(function () { delete S.coin["_l" + m]; render(); });
  }
  function sellSheet(mint) {
    var d = document.createElement("div"); d.className = "scrim"; S.sell = { mint: mint, pct: 100 };
    d.innerHTML = '<div class="sheet"><h3>Sell ' + esc((S.coin[mint] || {}).symbol || short(mint)) + "</h3>" +
      '<div class="pcts">' + [25, 50, 100].map(function (p) { return '<button data-pct="' + p + '" class="' + (p === 100 ? "on" : "") + '">' + p + "%</button>"; }).join("") + "</div>" +
      '<button class="btn red" style="width:100%" data-confirm>Confirm sell</button><div class="note" id="sellmsg">' + (S.state && S.state.mode === "PAPER" ? "PAPER: a paper sell only" : "Executor clicks it on FOMO") + "</div>" +
      '<button class="btn" style="width:100%;margin-top:6px" data-close>Cancel</button></div>';
    document.body.appendChild(d);
  }
  function confirmSell() {
    var m = S.sell; if (!m) return; var msg = $("#sellmsg");
    api("/api/sell", { mint: m.mint, pct: m.pct }).then(function (r) {
      msg.textContent = "Queued · order " + r.order;
      var n = 0, poll = setInterval(function () {
        api("/api/order/" + r.order).then(function (o) { msg.textContent = "Order " + o.id + " · " + o.status + (o.error ? " · " + o.error : ""); if (!/queued|clicking/.test(o.status) || ++n > 60) { clearInterval(poll); delete S.coin[m.mint]; } });
      }, 2000);
    }).catch(function (e) { msg.textContent = e.message; });
  }

  // ---------- ACCOUNT ----------
  var GROUP_BOT = { scanner: "Scanner", analyst: "Analyst", social: "Analyst · social", brain: "Brain", executor: "Executor", risk: "Risk", desk: "Desk" };
  function account(focus) {
    var s = S.state, ro = PLAN !== "A";
    var head = navbar("Account") + '<h1 class="pg">Account</h1>';
    if (!s) return head + sk(50) + sk(120) + sk(400);
    var row = function (t, sub, right, attrs) { return '<div class="row' + (attrs ? " tap" : "") + '" ' + (attrs || "") + '><div class="m"><div class="t">' + t + "</div>" + (sub ? '<div class="s">' + sub + "</div>" : "") + '</div><div class="v">' + (right || "") + "</div></div>"; };
    var cp = s.copyPicks || { every: "off", at: null };
    var html = head +
      '<div class="seg"><button data-mode="PAPER" class="' + (s.mode === "PAPER" ? "on" : "") + '"' + (ro ? " disabled" : "") + '>PAPER</button><button data-mode="LIVE" class="' + (s.mode === "LIVE" ? "on" : "") + '"' + (ro ? " disabled" : "") + ">LIVE</button></div>" +
      '<div class="grp">Money</div><div class="rows">' + row("Cash", esc(s.cashSource || ""), s.cash != null ? '<span class="num">' + usd(s.cash, 2) + "</span>" : '<span style="color:var(--ter)">Not read yet</span>') +
      row("Balance", s.mode === "PAPER" ? "cash + open positions, PAPER" : "", s.balance != null ? '<span class="num">' + usd(s.balance, 2) + "</span>" : '<span style="color:var(--ter)">Not read yet</span>') + "</div>" +
      '<div class="grp">FOMO</div><div class="rows">' +
      (s.links.profile ? row("Your FOMO profile", "", "›", 'data-href="' + esc(s.links.profile) + '"') : row("Your FOMO profile", "fomo_handle not set", "")) +
      row("Invite a friend", "", "›", 'data-share="' + esc(s.links.invite) + '"') + "</div>" +
      '<div class="grp">Copy picks</div><div class="rows"><div class="set"><div class="h"><span class="n">Every</span><select data-cp="every"' + (ro ? " disabled" : "") + ">" +
      [["off", "Off"], ["24h", "Every 24h"], ["12h", "Every 12h"], ["6h", "Every 6h"]].map(function (o) { return '<option value="' + o[0] + '"' + (cp.every === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") +
      '</select></div><div class="h" style="margin-top:8px"><span class="n">Time</span><input type="time" data-cp="at" value="' + esc(cp.at || "") + '"' + (ro ? " disabled" : "") + "></div></div></div>" +
      '<div class="grp">Pushes</div><div class="rows">' + row("Telegram", esc(s.pushes.note), s.pushes.telegram ? '<span class="up">Connected</span>' : '<span style="color:var(--ter)">Not connected</span>') +
      row("Notifications on this phone", PLAN === "B" ? "Plan B: Telegram only" : "Home screen app only · Step 11", s.pushes.webpush ? '<span class="up">On</span>' : '<span style="color:var(--ter)">Off</span>') +
      row("Send test push", s.pushes.count ? "Last: " + esc(s.pushes.recent[s.pushes.recent.length - 1]) : "Queued for Telegram (sent once the bot token is set) · logs/push.log", ro ? "" : '<span style="color:var(--blue)">Send</span>', ro ? "" : "data-testpush") + "</div>" +
      '<div class="grp">Grok Bot</div><div class="rows">' + row("Watch in Grok Bot", "Your own computer preview · link not set yet", '<span style="color:var(--ter)">Not set</span>') + "</div>";
    var props = s.proposals || [];
    if (props.length) {
      html += '<div class="grp">Pending proposals</div><div class="rows">';
      props.forEach(function (p) {
        html += '<div class="set"><div class="h"><span class="n">' + esc((p.key || "").replace(/_/g, " ")) + '</span></div>' +
          '<div class="s num">' + esc(String(p.old)) + ' → ' + esc(String(p.new)) + '</div>' +
          '<div class="s">' + esc(p.reason || "") + '</div>' +
          (ro ? '<div class="note">Read-only copy: approve in the live app or through Telegram.</div>'
              : '<div class="h" style="margin-top:8px;gap:8px"><button class="btn" data-approve="' + p.id + '">Approve</button>' +
                '<button class="btn" data-reject="' + p.id + '">Reject</button></div>') +
          "</div>";
      });
      html += "</div>";
    }
    Object.keys(s.settings).forEach(function (g) {
      html += '<div class="grp" id="set-' + g + '">' + (BOTN[g] ? aico(g, (s.bots && s.bots[g]) || {}) : "") + esc(GROUP_BOT[g] || g) + ' settings</div><div class="rows">' + s.settings[g].map(function (x) { return setting(x, ro); }).join("") + "</div>";
    });
    if (ro) html += '<div class="note">Read-only copy (plan B): settings, mode, pause and sell go through Telegram (Step 11).</div>';
    return html;
  }
  function setting(x, ro) {
    var dis = ro ? " disabled" : "", v = x.value, id = ' data-key="' + esc(x.key) + '"';
    var label = '<span class="n">' + esc(x.name.replace(/_/g, " ")) + "</span>";
    if (x.kind === "bool") return '<div class="set"><div class="h">' + label + '<div class="swwrap"' + (ro ? "" : id + ' data-bool="' + (v ? 1 : 0) + '"') + '><span class="sw ' + (v ? "on" : "") + (ro ? " locked" : "") + '"></span></div></div></div>';
    if (x.choices) return '<div class="set"><div class="h">' + label + "<select" + id + dis + ">" + x.choices.map(function (c) { return "<option" + (String(c) === String(v) ? " selected" : "") + ">" + esc(c) + "</option>"; }).join("") + "</select></div></div>";
    if (x.min == null || x.max == null || typeof v === "string" || v == null && x.kind !== "number")
      return '<div class="set"><div class="h">' + label + '<input type="text"' + id + ' value="' + esc(v == null ? "" : v) + '" placeholder="not set"' + dis + "></div>" + (x.note ? '<div class="mm"><span>' + esc(x.note) + "</span></div>" : "") + "</div>";
    var step = (Math.round(x.min) === x.min && Math.round(x.max) === x.max && Math.round(v) === v && x.max - x.min > 2) ? 1 : (x.max - x.min) / 100;
    return '<div class="set"><div class="h">' + label + '<input type="number" class="num"' + id + ' value="' + v + '" min="' + x.min + '" max="' + x.max + '" step="any"' + dis + "></div>" +
      '<input type="range"' + id + ' min="' + x.min + '" max="' + x.max + '" step="' + step + '" value="' + v + '"' + dis + '><div class="mm num"><span>' + x.min + "</span><span>" + x.max + "</span></div></div>";
  }
  function saveSetting(key, value, el) {
    api("/api/settings", { key: key, value: value }).then(function (r) {
      toast(key.split(".")[1].replace(/_/g, " ") + " " + r.old + " → " + r.new);
      view.querySelectorAll('[data-key="' + key + '"]').forEach(function (e) { if (e.type === "number" || e.type === "range") e.value = r.new; });
      refresh();
    }).catch(function (e) { toast(e.message); refresh(); });
  }
  function liveSheet() {
    var d = document.createElement("div"); d.className = "scrim";
    d.innerHTML = '<div class="sheet"><h3>Switch to LIVE</h3><div class="note" style="padding:0 0 10px">Real money on FOMO. Type LIVE to confirm.</div><input class="field" style="width:100%" id="livein" autocomplete="off" autocapitalize="characters" placeholder="LIVE"><button class="btn red" style="width:100%;margin-top:10px" data-golive>Switch to LIVE</button><div class="note" id="livemsg"></div><button class="btn" style="width:100%" data-close>Cancel</button></div>';
    document.body.appendChild(d);
  }

  // ---------- search ----------
  function searchOverlay() {
    var d = document.createElement("div"); d.className = "search";
    d.innerHTML = '<div style="display:flex;gap:8px"><input id="q" placeholder="Name, symbol or mint" autocomplete="off"><button class="back" data-close>Cancel</button></div><div id="qr" style="margin-top:12px"></div>';
    document.body.appendChild(d); var q = $("#q"), t; q.focus();
    q.addEventListener("input", function () {
      clearTimeout(t); t = setTimeout(function () {
        if (!q.value.trim()) { $("#qr").innerHTML = ""; return; }
        D.search(q.value.trim()).then(function (rs) {
          $("#qr").innerHTML = rs.length ? '<div class="rows">' + rs.map(function (r) { return '<div class="row tap" data-go="/coin/' + esc(r.mint) + '" data-close><div class="m"><div class="t">' + esc(r.symbol || r.name || short(r.mint)) + '</div><div class="s">' + esc(r.name || "") + " · " + short(r.mint) + '</div></div><div class="v">' + fomoA(r.link) + "</div></div>"; }).join("") + "</div>" : '<div class="empty">No coin in the desk matches. Paste the mint.</div>';
        }).catch(function (e) { $("#qr").innerHTML = '<div class="empty">' + esc(e.message) + "</div>"; });
      }, 250);
    });
  }

  // ---------- events ----------
  function onClick(ev) {
    var t = ev.target.closest("[data-stop],[data-tab],[data-go],[data-back],[data-range],[data-full],[data-close],[data-search],[data-sell],[data-pct],[data-confirm],[data-pause],[data-mode],[data-golive],[data-bool],[data-share],[data-href],[data-testpush],[data-approve],[data-reject]");
    if (!t) return;
    if (t.hasAttribute("data-stop")) return;
    var ov = t.closest(".scrim,.full,.search");
    if (t.hasAttribute("data-close") && ov) { ov.remove(); if (!t.dataset.go) return; }
    if (t.dataset.tab) return go("/" + t.dataset.tab);
    if (t.dataset.go) return go(t.dataset.go);
    if (t.hasAttribute("data-back")) return history.length > 1 ? history.back() : go("/home");
    if (t.dataset.range) { S.range = t.dataset.range; LS.setItem("desk_range", S.range); view.querySelectorAll("[data-range]").forEach(function (b) { b.classList.toggle("on", b === t); }); return drawChart(); }
    if (t.hasAttribute("data-full")) return fullScreen();
    if (t.hasAttribute("data-search")) return searchOverlay();
    if (t.dataset.sell) return sellSheet(t.dataset.sell);
    if (t.dataset.pct) { S.sell.pct = +t.dataset.pct; t.parentNode.querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", b === t); }); return; }
    if (t.hasAttribute("data-confirm")) return confirmSell();
    if (t.dataset.pause) { var c = S.state.bots[t.dataset.pause]; return api("/api/pause", { bot: t.dataset.pause, paused: !c.paused }).then(function () { refresh(); }).catch(function (e) { toast(e.message); }); }
    if (t.dataset.mode) {
      if (t.dataset.mode === S.state.mode) return;
      if (t.dataset.mode === "LIVE") return liveSheet();
      return api("/api/mode", { mode: "PAPER" }).then(refresh).catch(function (e) { toast(e.message); });
    }
    if (t.hasAttribute("data-golive")) {
      return api("/api/mode", { mode: "LIVE", confirm: ($("#livein").value || "").trim() }).then(function () { ov && ov.remove(); refresh(); }).catch(function (e) { $("#livemsg").textContent = e.message; });
    }
    if (t.dataset.bool != null) return saveSetting(t.dataset.key, t.dataset.bool !== "1");
    if (t.dataset.href) return window.open(t.dataset.href, "_blank", "noopener,noreferrer");
    if (t.dataset.share) {
      var u = t.dataset.share;
      if (navigator.share) return navigator.share({ url: u }).catch(function () {});
      var done = function () { toast("Link copied"); };
      if (navigator.clipboard) return navigator.clipboard.writeText(u).then(done, function () { fallbackCopy(u); done(); });
      fallbackCopy(u); return done();
    }
    if (t.hasAttribute("data-testpush")) return api("/api/push/test", {}).then(function (r) { toast("Test push · " + r.sent_to); refresh(); }).catch(function (e) { toast(e.message); });
    if (t.dataset.approve) return api("/api/proposals/" + t.dataset.approve + "/approve", {}).then(function () { toast("Proposal approved"); refresh(); }).catch(function (e) { toast(e.message); });
    if (t.dataset.reject) return api("/api/proposals/" + t.dataset.reject + "/reject", {}).then(function () { toast("Proposal rejected"); refresh(); }).catch(function (e) { toast(e.message); });
  }
  function fallbackCopy(u) { var i = document.createElement("textarea"); i.value = u; document.body.appendChild(i); i.select(); try { document.execCommand("copy"); } catch (e) {} i.remove(); }
  document.addEventListener("change", function (ev) {
    var e = ev.target;
    if (e.dataset && e.dataset.cp) {
      var every = $('[data-cp="every"]').value, at = $('[data-cp="at"]').value || null;
      return api("/api/prefs/copy_picks", { every: every, at: at }).then(function () { toast("Copy picks saved"); }).catch(function (x) { toast(x.message); });
    }
    if (e.dataset && e.dataset.key) {
      var v = e.type === "number" || e.type === "range" ? parseFloat(e.value) : e.value;
      if (e.type === "text" && e.value === "") v = null;
      saveSetting(e.dataset.key, v, e);
    }
  });
  document.addEventListener("input", function (ev) {   // slider and exact number stay in sync while dragging
    var e = ev.target; if (!e.dataset || !e.dataset.key || (e.type !== "range" && e.type !== "number")) return;
    view.querySelectorAll('[data-key="' + e.dataset.key + '"]').forEach(function (o) { if (o !== e && (o.type === "range" || o.type === "number")) o.value = e.value; });
  });

  // ---------- render + loop ----------
  var lastRoute = "";
  function render() {
    if (!PLAN) { view.innerHTML = '<div class="nav"><div class="title">Grok Bot</div></div><div class="card" style="margin-top:20px"><div style="font-weight:600">Not connected</div><div class="s" style="color:var(--sec);margin-top:6px">Open the desk link once on this phone to connect.</div></div>'; return; }
    var r = route(), key = r.name + "/" + (r.arg || "");
    var y = key === lastRoute ? window.scrollY : 0;
    document.querySelectorAll(".tabbar button").forEach(function (b) { b.classList.toggle("on", b.dataset.tab === (r.name === "coin" || r.name === "audit" ? "" : r.name)); });
    var html = r.name === "bots" ? bots() : r.name === "activity" ? activity() : r.name === "account" ? account(r.arg) : r.name === "coin" ? coin(r.arg) : r.name === "audit" ? audit(r.arg) : home();
    view.innerHTML = html;
    if (r.name === "home" && S.state) {
      var b = $("#bal"); b._t = null;
      if (S.state.balance != null) { odo(b, usd(S.state.balance, 2)); } else b.innerHTML = '<span style="color:var(--sec);font-size:28px">Balance not read yet</span>';
      drawChart(); if (S.frame) { var f = $("#f0"); f.src = S.frame.url; f.classList.add("show"); fb = 0; frameLabel(); }
    }
    view.querySelectorAll("canvas[data-ring]").forEach(function (c) { var v = c.dataset.ring; DeskChart.ring(c, v === "" ? null : +v, 70); });
    if (r.name === "coin") drawCoin();
    if (r.name === "audit" && key !== lastRoute) animateAudit(); else if (r.name === "audit") view.querySelectorAll(".reveal").forEach(function (e) { e.classList.add("in"); });
    if (r.name === "account" && r.arg && key !== lastRoute) { var g = $("#set-" + r.arg); if (g) g.scrollIntoView(); y = null; }
    if (y != null) window.scrollTo(0, y);
    lastRoute = key;
  }
  function softUpdate() {   // update numbers in place on Home so the odometer rolls instead of re-rendering
    var r = route();
    if (r.name !== "home" || !$("#bal") || document.activeElement && /INPUT|SELECT/.test(document.activeElement.tagName)) return false;
    return true;
  }
  var POLL = PLAN === "A" ? 3000 : 15000, inflight = false;
  function refresh() {
    if (inflight || !PLAN) return; inflight = true;
    Promise.all([D.state(), D.chart(), D.activity()]).then(function (a) {
      var grew = S.chart && a[1].points.length > S.chart.points.length;
      var stale = PLAN === "B" && Date.now() / 1000 - a[0].ts > 600;
      S.state = a[0]; S.chart = a[1]; S.activity = a[2]; S.lastOk = a[0].ts * 1000; S.nextAt = Date.now() + POLL;
      if (stale) { S.err = "stale"; S.retryAt = Date.now() + POLL; } else S.err = null;
      var r = route();
      if (r.name === "coin" || r.name === "audit") delete S.coin[r.arg];
      if (r.name === "account" && document.activeElement && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
      if (softUpdate() && !stale) {
        var tmp = document.createElement("div"); tmp.innerHTML = home();
        // keep the canvas, frame and balance node; swap the rest
        var keep = { bal: $("#bal"), chart: $(".chartwrap"), live: $(".live") };
        tmp.querySelector("#bal").replaceWith(keep.bal); tmp.querySelector(".chartwrap").replaceWith(keep.chart); tmp.querySelector(".live").replaceWith(keep.live);
        view.replaceChildren.apply(view, Array.prototype.slice.call(tmp.childNodes));
        if (S.state.balance != null) odo(keep.bal, usd(S.state.balance, 2));
        var tr = keep.live.querySelector(".tr"), lane = S.state.lane && S.state.lane.bot;
        tr.innerHTML = lane ? '<span style="color:' + BOTC[lane] + '">' + esc(BOTN[lane] + " · " + (S.state.lane.action || "")) + "</span>" : "Idle";
        view.querySelectorAll("canvas[data-ring]").forEach(function (c) { var v = c.dataset.ring; DeskChart.ring(c, v === "" ? null : +v, 70); });
        grew ? slideIn() : drawChart();
      } else render();
    }).catch(function () {
      S.err = "offline"; S.retryAt = Date.now() + 5000; render();
    }).then(function () { inflight = false; });
  }
  shell(); render();
  if (PLAN) {
    refresh();
    setInterval(function () { if (Date.now() >= (S.err ? S.retryAt : S.nextAt || 0)) refresh(); var e = $("#errrow"); if (e && S.err) e.textContent = errRow().replace(/<[^>]+>/g, ""); }, 1000);
    setInterval(function () { if (route().name === "home" && !S.err || route().name === "home" && PLAN === "B") pullFrame(); }, PLAN === "A" ? 1000 : 15000);
    setTimeout(pullFrame, 300);
    if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js?v=8e").catch(function () {});
  }
})();
