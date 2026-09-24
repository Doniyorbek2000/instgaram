/* AI Kontent studiya — brauzer qismi: forma, natijani chizish, karusel PNG. */
(function () {
  "use strict";
  var form = document.getElementById("csForm");
  var out = document.getElementById("csOut");
  var go = document.getElementById("csGo");
  var items = JSON.parse(document.getElementById("csItems").textContent);
  var brand = JSON.parse(document.getElementById("csBrand").textContent);

  var THEMES = [
    { name: "Binafsha", bg: ["#4c1d95", "#be185d"], fg: "#ffffff", accent: "#fbcfe8" },
    { name: "Tun", bg: ["#0f172a", "#1e293b"], fg: "#f8fafc", accent: "#a78bfa" },
    { name: "Krem", bg: ["#fef3c7", "#fde68a"], fg: "#1c1917", accent: "#b45309" },
  ];

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function copyBtn(getText) {
    var b = el("button", "secondary cs-copy", "📋 Nusxa");
    b.type = "button";
    b.onclick = function () {
      navigator.clipboard.writeText(getText()).then(function () { b.textContent = "✓"; setTimeout(function () { b.textContent = "📋 Nusxa"; }, 1200); });
    };
    return b;
  }

  function block(title, text) {
    var d = el("div", "cs-block");
    d.appendChild(copyBtn(function () { return text; }));
    d.appendChild(el("h4", "", title));
    d.appendChild(document.createTextNode(text));
    return d;
  }

  var tags = function (arr) { return (arr || []).map(function (h) { return "#" + String(h).replace(/^#/, "").replace(/\s+/g, ""); }).join(" "); };

  // ---------- tablar ----------
  Array.prototype.forEach.call(document.querySelectorAll("#csTabs [data-tool]"), function (b) {
    b.addEventListener("click", function () {
      var tool = b.getAttribute("data-tool");
      form.tool.value = tool;
      Array.prototype.forEach.call(document.querySelectorAll("#csTabs [data-tool]"), function (x) { x.className = x === b ? "" : "secondary"; });
      Array.prototype.forEach.call(form.querySelectorAll("[data-for]"), function (x) {
        x.style.display = x.getAttribute("data-for") === tool ? "" : "none";
      });
    });
  });

  // ---------- yaratish ----------
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var data = {};
    new FormData(form).forEach(function (v, k) { data[k] = v; });
    go.disabled = true;
    out.innerHTML = '<p style="text-align:center; padding:30px 0"><span class="cs-spin"></span> AI tayyorlamoqda… (10–30 soniya)</p>';
    fetch("/content/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || "Xatolik");
        items.unshift(d.item);
        render(d.item);
      })
      .catch(function (err) {
        out.innerHTML = "";
        out.appendChild(el("div", "error", "⚠️ " + err.message));
      })
      .then(function () { go.disabled = false; });
  });

  Array.prototype.forEach.call(document.querySelectorAll("[data-open]"), function (a) {
    a.addEventListener("click", function (e) {
      e.preventDefault();
      var it = items.filter(function (x) { return x.id === a.getAttribute("data-open"); })[0];
      if (it) { render(it); out.scrollIntoView({ behavior: "smooth" }); }
    });
  });

  // ---------- natijani chizish ----------
  function render(item) {
    out.innerHTML = "";
    var d = item.data || {};
    out.appendChild(el("h3", "", item.title || ""));
    if (item.tool === "reels") renderReels(item, d);
    else if (item.tool === "carousel") renderCarousel(d);
    else if (item.tool === "caption") {
      (d.captions || []).forEach(function (c, i) { out.appendChild(block("Variant " + (i + 1), c)); });
      if (d.hashtags) out.appendChild(block("Xeshteglar", tags(d.hashtags)));
      if (d.firstComment) out.appendChild(block("Birinchi komment", d.firstComment));
    } else if (item.tool === "plan") {
      var table = el("table");
      table.style.cssText = "width:100%; border-collapse:collapse; font-size:13.5px";
      var head = el("tr");
      ["Kun", "Format", "Mavzu", "Hook", "CTA"].forEach(function (h) { var th = el("th", "", h); th.style.cssText = "text-align:left; color:#94a3b8; font-size:12px; padding:6px"; head.appendChild(th); });
      table.appendChild(head);
      (d.plan || []).forEach(function (p) {
        var tr = el("tr");
        tr.style.borderTop = "1px solid rgba(255,255,255,0.08)";
        [p.day, p.format, p.topic, p.hook, p.cta].forEach(function (v) { var td = el("td", "", v || ""); td.style.padding = "7px 6px"; tr.appendChild(td); });
        table.appendChild(tr);
      });
      var wrap = el("div");
      wrap.style.overflowX = "auto";
      wrap.appendChild(table);
      out.appendChild(wrap);
    } else if (item.tool === "ideas") {
      (d.ideas || []).forEach(function (x, i) {
        out.appendChild(block((i + 1) + ". " + (x.title || "") + " · " + (x.format || ""), "Hook: " + (x.hook || "") + "\n\nNega ishlaydi: " + (x.why || "")));
      });
    }
  }

  function renderReels(item, d) {
    if (d.hooks) out.appendChild(block("🎣 Hook variantlari (birinchi 2 soniya)", d.hooks.map(function (h, i) { return (i + 1) + ". " + h; }).join("\n")));
    var sc = el("div", "cs-block");
    sc.appendChild(el("h4", "", "🎬 Kadrlar"));
    (d.scenes || []).forEach(function (s) {
      var row = el("div", "cs-scene");
      row.appendChild(el("b", "", s.time || ""));
      var c = el("div");
      c.appendChild(el("div", "", "🎥 " + (s.visual || "")));
      c.appendChild(el("div", "", "🗣️ " + (s.voice || "")));
      if (s.onScreenText) c.appendChild(el("div", "hint", "🔤 " + s.onScreenText));
      row.appendChild(c);
      sc.appendChild(row);
    });
    out.appendChild(sc);
    if (d.caption) out.appendChild(block("✍️ Caption", d.caption + (d.hashtags ? "\n\n" + tags(d.hashtags) : "")));
    if (d.cta) out.appendChild(block("📣 CTA", d.cta));
    if (d.commentKeyword) {
      var box = el("div", "cs-block");
      box.style.borderColor = "#7c3aed";
      box.appendChild(el("h4", "", "🤖 Komment → DM avtomatizatsiyasi"));
      box.appendChild(el("div", "", "Tomoshabinlar «" + d.commentKeyword + "» deb komment yozsa, bot Direct'ga: " + (d.dmGift || "sovg'a") + " yuboradi."));
      var f = el("form");
      f.method = "post";
      f.action = "/content/" + encodeURIComponent(item.id) + "/flow";
      f.style.margin = "10px 0 0";
      var b = el("button", "btn", "🧩 Shu uchun flow yaratish");
      b.style.margin = "0";
      f.appendChild(b);
      box.appendChild(f);
      out.appendChild(box);
    }
  }

  // ---------- karusel: 1080×1350 PNG ----------
  function wrapLines(ctx, text, maxW) {
    var words = String(text || "").split(/\s+/);
    var lines = [];
    var line = "";
    words.forEach(function (w) {
      var test = line ? line + " " + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
      else line = test;
    });
    if (line) lines.push(line);
    return lines;
  }

  function drawSlide(canvas, slide, i, n, theme) {
    var W = 1080, H = 1350;
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext("2d");
    var g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, theme.bg[0]);
    g.addColorStop(1, theme.bg[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    var font = "'Plus Jakarta Sans', system-ui, sans-serif";
    ctx.fillStyle = theme.accent;
    ctx.font = "700 34px " + font;
    ctx.fillText((i + 1) + " / " + n, 90, 120);
    var headSize = i === 0 ? 96 : 76;
    ctx.fillStyle = theme.fg;
    ctx.font = "800 " + headSize + "px " + font;
    var y = i === 0 ? 420 : 300;
    wrapLines(ctx, slide.heading, W - 180).slice(0, 5).forEach(function (l) { ctx.fillText(l, 90, y); y += headSize * 1.15; });
    y += 30;
    ctx.font = "500 44px " + font;
    ctx.globalAlpha = 0.9;
    wrapLines(ctx, slide.body, W - 180).slice(0, 9).forEach(function (l) { ctx.fillText(l, 90, y); y += 60; });
    ctx.globalAlpha = 1;
    ctx.fillStyle = theme.accent;
    ctx.font = "700 36px " + font;
    var sign = brand.handle ? "@" + brand.handle : brand.name;
    if (sign) ctx.fillText(sign, 90, H - 90);
    if (i < n - 1) {
      ctx.textAlign = "right";
      ctx.fillText("→", W - 90, H - 90);
      ctx.textAlign = "left";
    }
  }

  function renderCarousel(d) {
    var slides = d.slides || [];
    var themeIdx = 0;
    var bar = el("div");
    bar.style.cssText = "display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px";
    var grid = el("div", "cs-slides");
    var canvases = [];
    function draw() {
      canvases.forEach(function (c, i) { drawSlide(c, slides[i], i, slides.length, THEMES[themeIdx]); });
    }
    THEMES.forEach(function (t, i) {
      var b = el("button", i ? "secondary" : "", "🎨 " + t.name);
      b.type = "button";
      b.style.cssText = "margin:0; padding:5px 12px; font-size:12px";
      b.onclick = function () {
        themeIdx = i;
        Array.prototype.forEach.call(bar.querySelectorAll("button[data-theme]"), function (x, j) { x.className = j === i ? "" : "secondary"; });
        draw();
      };
      b.setAttribute("data-theme", i);
      bar.appendChild(b);
    });
    var dl = el("button", "btn", "⬇️ Barchasini yuklab olish (PNG)");
    dl.type = "button";
    dl.style.cssText = "margin:0 0 0 auto; padding:5px 12px; font-size:12px";
    dl.onclick = function () {
      canvases.forEach(function (c, i) {
        setTimeout(function () {
          var a = document.createElement("a");
          a.download = "karusel-" + (i + 1) + ".png";
          a.href = c.toDataURL("image/png");
          a.click();
        }, i * 250);
      });
    };
    bar.appendChild(dl);
    out.appendChild(bar);
    slides.forEach(function () {
      var c = document.createElement("canvas");
      canvases.push(c);
      grid.appendChild(c);
    });
    out.appendChild(grid);
    (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(draw);
    draw();
    var text = slides.map(function (s, i) { return (i + 1) + ". " + s.heading + "\n" + s.body; }).join("\n\n");
    out.appendChild(block("Slaydlar matni", text));
    if (d.caption) out.appendChild(block("✍️ Caption", d.caption + (d.hashtags ? "\n\n" + tags(d.hashtags) : "")));
  }

  if (items[0]) render(items[0]);
})();
