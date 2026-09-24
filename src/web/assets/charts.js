/* Yengil SVG grafiklar (kutubxonasiz): ustunli va chiziqli, hover tooltip bilan.
 * Ranglar dataviz ma'lumotnomasidagi tekshirilgan palitradan (to'q fon uchun):
 * 1-seriya ko'k #3987e5, 2-seriya to'q sariq #d95926. Matn hech qachon seriya
 * rangida emas — identifikatsiya belgi (chiziq/kvadrat) orqali. */
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var SERIES = ["#3987e5", "#d95926"];
  var GRID = "rgba(255,255,255,0.08)";
  var MUTED = "#94a3b8";

  function el(tag, attrs) {
    var e = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }

  /** 4 ta teng, "chiroyli" qadamli o'q maksimumi (1/2/2.5/5 × 10^n). */
  function niceMax(v) {
    if (v <= 4) return 4;
    var raw = v / 4;
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / mag;
    var step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
    return step * mag * 4;
  }

  function fmt(n) { return Number(n).toLocaleString("en-US").replace(/,/g, " "); }
  function shortDate(d) { var p = d.split("-"); return p[2] + "." + p[1]; }

  function tooltip(host) {
    var t = document.createElement("div");
    t.className = "viz-tip";
    t.style.display = "none";
    host.appendChild(t);
    return {
      show: function (x, y, date, rows) {
        t.innerHTML = "";
        var head = document.createElement("div");
        head.className = "viz-tip-date";
        head.textContent = date;
        t.appendChild(head);
        rows.forEach(function (r) {
          var row = document.createElement("div");
          row.className = "viz-tip-row";
          var key = document.createElement("span");
          key.className = "viz-key";
          key.style.background = r.color;
          var val = document.createElement("b");
          val.textContent = fmt(r.value);
          var lab = document.createElement("span");
          lab.textContent = r.label;
          row.appendChild(key); row.appendChild(val); row.appendChild(lab);
          t.appendChild(row);
        });
        t.style.display = "block";
        var hw = host.clientWidth;
        var left = Math.min(Math.max(8, x + 12), hw - t.offsetWidth - 8);
        t.style.left = left + "px";
        t.style.top = Math.max(0, y - t.offsetHeight - 8) + "px";
      },
      hide: function () { t.style.display = "none"; },
    };
  }

  function frame(host, data, maxVal) {
    var W = Math.max(320, host.clientWidth);
    var H = 240;
    var m = { l: 40, r: 44, t: 14, b: 26 };
    var svg = el("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img" });
    var max = niceMax(maxVal);
    var iw = W - m.l - m.r;
    var ih = H - m.t - m.b;
    for (var i = 0; i <= 4; i++) {
      var v = (max / 4) * i;
      var y = m.t + ih - (v / max) * ih;
      svg.appendChild(el("line", { x1: m.l, x2: W - m.r, y1: y, y2: y, stroke: GRID, "stroke-width": 1 }));
      var tx = el("text", { x: m.l - 8, y: y + 4, "text-anchor": "end", fill: MUTED, "font-size": 11 });
      tx.textContent = fmt(Math.round(v));
      svg.appendChild(tx);
    }
    var every = Math.ceil(data.length / 8);
    data.forEach(function (d, i) {
      if (i % every !== 0) return;
      var x = m.l + (iw * (i + 0.5)) / data.length;
      var t = el("text", { x: x, y: H - 8, "text-anchor": "middle", fill: MUTED, "font-size": 11 });
      t.textContent = shortDate(d.date);
      svg.appendChild(t);
    });
    return { svg: svg, W: W, H: H, m: m, iw: iw, ih: ih, max: max };
  }

  function barChart(host, data, key, label) {
    host.innerHTML = "";
    var f = frame(host, data, Math.max.apply(null, data.map(function (d) { return d[key]; }).concat([1])));
    var band = f.iw / data.length;
    var bw = Math.min(24, Math.max(3, band - 2));
    var tip = tooltip(host);
    data.forEach(function (d, i) {
      var v = d[key];
      var cx = f.m.l + band * (i + 0.5);
      var h = (v / f.max) * f.ih;
      var y = f.m.t + f.ih - h;
      if (v > 0) {
        var r = Math.min(4, h, bw / 2);
        var x0 = cx - bw / 2, x1 = cx + bw / 2, yb = f.m.t + f.ih;
        f.svg.appendChild(el("path", {
          d: "M" + x0 + "," + yb + " V" + (y + r) + " Q" + x0 + "," + y + " " + (x0 + r) + "," + y +
             " H" + (x1 - r) + " Q" + x1 + "," + y + " " + x1 + "," + (y + r) + " V" + yb + " Z",
          fill: SERIES[0], class: "viz-bar", "data-i": i,
        }));
      }
      var hit = el("rect", { x: cx - band / 2, y: f.m.t, width: band, height: f.ih, fill: "transparent", tabindex: 0 });
      var show = function () {
        var bar = f.svg.querySelector('.viz-bar[data-i="' + i + '"]');
        Array.prototype.forEach.call(f.svg.querySelectorAll(".viz-bar"), function (b) { b.style.opacity = 1; });
        if (bar) bar.style.opacity = 0.75;
        tip.show(cx, y, d.date, [{ color: SERIES[0], value: v, label: label }]);
      };
      hit.addEventListener("pointermove", show);
      hit.addEventListener("focus", show);
      hit.addEventListener("pointerleave", function () { tip.hide(); var bar = f.svg.querySelector('.viz-bar[data-i="' + i + '"]'); if (bar) bar.style.opacity = 1; });
      hit.addEventListener("blur", tip.hide);
      f.svg.appendChild(hit);
    });
    host.insertBefore(f.svg, host.firstChild);
  }

  function lineChart(host, data, series) {
    host.innerHTML = "";
    var maxVal = 1;
    data.forEach(function (d) { series.forEach(function (s) { maxVal = Math.max(maxVal, d[s.key]); }); });
    var f = frame(host, data, maxVal);
    var X = function (i) { return f.m.l + (f.iw * (i + 0.5)) / data.length; };
    var Y = function (v) { return f.m.t + f.ih - (v / f.max) * f.ih; };
    var cross = el("line", { y1: f.m.t, y2: f.m.t + f.ih, stroke: "rgba(255,255,255,0.35)", "stroke-width": 1, visibility: "hidden" });
    f.svg.appendChild(cross);
    series.forEach(function (s, si) {
      var color = SERIES[si];
      var d = data.map(function (p, i) { return (i ? "L" : "M") + X(i) + "," + Y(p[s.key]); }).join(" ");
      f.svg.appendChild(el("path", { d: d, fill: "none", stroke: color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
      var last = data[data.length - 1];
      f.svg.appendChild(el("circle", { cx: X(data.length - 1), cy: Y(last[s.key]), r: 4, fill: color, stroke: "#151d30", "stroke-width": 2 }));
    });
    // Oxirgi qiymatlar — to'qnashsa faqat legend + tooltip qoladi
    var lastY = series.map(function (s) { return Y(data[data.length - 1][s.key]); });
    if (series.length < 2 || Math.abs(lastY[0] - lastY[1]) > 14) {
      series.forEach(function (s, si) {
        var t = el("text", { x: X(data.length - 1) + 8, y: lastY[si] + 4, fill: "#e2e8f0", "font-size": 11.5, "font-weight": 700 });
        t.textContent = fmt(data[data.length - 1][s.key]);
        f.svg.appendChild(t);
      });
    }
    var tip = tooltip(host);
    var hit = el("rect", { x: f.m.l, y: f.m.t, width: f.iw, height: f.ih, fill: "transparent", tabindex: 0 });
    var at = function (clientX) {
      var r = f.svg.getBoundingClientRect();
      var i = Math.min(data.length - 1, Math.max(0, Math.floor(((clientX - r.left - f.m.l) / f.iw) * data.length)));
      cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i));
      cross.setAttribute("visibility", "visible");
      var top = Math.min.apply(null, series.map(function (s) { return Y(data[i][s.key]); }));
      tip.show(X(i), top, data[i].date, series.map(function (s, si) { return { color: SERIES[si], value: data[i][s.key], label: s.label }; }));
    };
    hit.addEventListener("pointermove", function (e) { at(e.clientX); });
    hit.addEventListener("focus", function () { var r = f.svg.getBoundingClientRect(); at(r.left + f.m.l + f.iw - 1); });
    var hide = function () { tip.hide(); cross.setAttribute("visibility", "hidden"); };
    hit.addEventListener("pointerleave", hide);
    hit.addEventListener("blur", hide);
    f.svg.appendChild(hit);
    host.insertBefore(f.svg, host.firstChild);
  }

  function draw() {
    var data = JSON.parse(document.getElementById("vizData").textContent);
    var msg = document.getElementById("vizMessages");
    var fl = document.getElementById("vizFlows");
    if (msg) barChart(msg, data, "messages", "xabar");
    if (fl) lineChart(fl, data, [{ key: "started", label: "boshlandi" }, { key: "conversions", label: "konversiya" }]);
  }

  var resizeTimer;
  window.addEventListener("resize", function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(draw, 150); });
  draw();
})();
