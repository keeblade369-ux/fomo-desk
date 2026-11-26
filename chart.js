// Step 10 charts on <canvas>, devicePixelRatio aware. Real data only: no points = nothing drawn.
(function (W) {
  function setup(cv) {
    var dpr = W.devicePixelRatio || 1, r = cv.getBoundingClientRect();
    cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr));
    var g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, r.width, r.height);
    return { g: g, w: r.width, h: r.height };
  }
  var COLORS = { blue: "#0a84ff", green: "#00d35a", red: "#ff453a" };
  // pts: [[ts, value]], opts: {start: value|null, marks: [{ts,text,color}], from, to, progress 0..1}
  function line(cv, pts, opts) {
    var c = setup(cv), g = c.g, w = c.w, h = c.h, o = opts || {};
    if (!pts || pts.length < 1) return;
    var top = 34, bot = h - 8, pad = 4;
    var t0 = o.from != null ? o.from : pts[0][0], t1 = o.to != null ? o.to : pts[pts.length - 1][0];
    if (t1 <= t0) t1 = t0 + 1;
    var vs = pts.map(function (p) { return p[1]; }); if (o.start != null) vs.push(o.start);
    var lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs);
    if (hi - lo < 1e-9) { hi += Math.max(0.01, Math.abs(hi) * 0.002); lo -= Math.max(0.01, Math.abs(lo) * 0.002); }
    var X = function (t) { return pad + (w - 2 * pad) * (t - t0) / (t1 - t0); };
    var Y = function (v) { return bot - (bot - top) * (v - lo) / (hi - lo); };
    var n = pts.length, prog = o.progress == null ? 1 : o.progress;
    var xy = pts.map(function (p) { return [X(p[0]), Y(p[1])]; });
    if (n > 1 && prog < 1) { var a = xy[n - 2], b = xy[n - 1]; xy[n - 1] = [a[0] + (b[0] - a[0]) * prog, a[1] + (b[1] - a[1]) * prog]; }
    if (o.start != null) {
      g.save(); g.setLineDash([4, 4]); g.strokeStyle = "rgba(235,235,245,0.3)"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, Y(o.start)); g.lineTo(w, Y(o.start)); g.stroke(); g.restore();
    }
    var grad = g.createLinearGradient(0, top, 0, bot);
    grad.addColorStop(0, "rgba(0,211,90,0.28)"); grad.addColorStop(1, "rgba(0,211,90,0)");
    g.beginPath(); g.moveTo(xy[0][0], bot);
    xy.forEach(function (p) { g.lineTo(p[0], p[1]); }); g.lineTo(xy[n - 1][0], bot); g.closePath();
    g.fillStyle = grad; g.fill();
    g.beginPath(); xy.forEach(function (p, i) { i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); });
    g.strokeStyle = "#00d35a"; g.lineWidth = 2; g.lineJoin = "round"; g.stroke();
    // marks above the line; a later mark that would overlap moves up a row
    var rows = [];
    g.font = "600 11px -apple-system, Arial"; g.textBaseline = "middle";
    (o.marks || []).forEach(function (m) {
      if (m.ts < t0 || m.ts > t1) return;
      var x = X(m.ts), tw = g.measureText(m.text).width + 12, x0 = Math.min(Math.max(2, x - tw / 2), w - tw - 2);
      var r = 0; while (rows[r] && rows[r].some(function (s) { return !(x0 + tw < s[0] || x0 > s[1]); })) r++;
      (rows[r] = rows[r] || []).push([x0 - 3, x0 + tw + 3]);
      var y = 10 + r * 20; if (y > top - 6 && r > 0) y = top - 6 - (r % 2) * 20;
      g.fillStyle = COLORS[m.color] || "#fff"; g.globalAlpha = 0.18; roundRect(g, x0, y - 8, tw, 16, 8); g.fill();
      g.globalAlpha = 1; g.fillText(m.text, x0 + 6, y);
    });
  }
  function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  // candles: [[minute_ts, o, h, l, c]], exit: price|null (orange dashed)
  function candles(cv, cs, exit) {
    var c = setup(cv), g = c.g, w = c.w, h = c.h;
    if (!cs || !cs.length) return;
    var top = 8, bot = h - 8, vals = [];
    cs.forEach(function (k) { vals.push(k[2], k[3]); }); if (exit) vals.push(exit);
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals); if (hi - lo < 1e-15) { hi *= 1.01; lo *= 0.99; }
    var Y = function (v) { return bot - (bot - top) * (v - lo) / (hi - lo); };
    var n = cs.length, step = (w - 8) / Math.max(n, 20), bw = Math.max(1, step * 0.65);
    cs.forEach(function (k, i) {
      var x = 4 + (w - 8) - (n - i) * step + step / 2, col = k[4] >= k[1] ? "#00d35a" : "#ff453a";
      g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, Y(k[2])); g.lineTo(x, Y(k[3])); g.stroke();
      var y1 = Y(Math.max(k[1], k[4])), y2 = Y(Math.min(k[1], k[4]));
      g.fillRect(x - bw / 2, y1, bw, Math.max(1, y2 - y1));
    });
    if (exit) {
      g.save(); g.setLineDash([5, 4]); g.strokeStyle = "#ff9f0a"; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(0, Y(exit)); g.lineTo(w, Y(exit)); g.stroke(); g.restore();
    }
  }
  function ring(cv, score, pass) {
    var c = setup(cv), g = c.g, w = c.w, r = w / 2 - 4;
    g.lineWidth = 5; g.strokeStyle = "#2c2c2e"; g.beginPath(); g.arc(w / 2, w / 2, r, 0, Math.PI * 2); g.stroke();
    if (score == null) return;
    g.strokeStyle = score >= pass ? "#00d35a" : "#ff453a"; g.lineCap = "round";
    g.beginPath(); g.arc(w / 2, w / 2, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * score / 100); g.stroke();
    g.fillStyle = "#fff"; g.font = "600 15px -apple-system, Arial"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(String(score), w / 2, w / 2 + 1);
  }
  W.DeskChart = { line: line, candles: candles, ring: ring };
})(window);
