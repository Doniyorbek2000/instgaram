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
    if ((d.scenes || []).length) out.appendChild(videoMaker(item, d));
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

  // ---------- Reels video: kadrlar brauzerda chiziladi, MP4 serverda yasaladi ----------
  var media = JSON.parse(document.getElementById("csMedia").textContent);
  var VW = 1080, VH = 1920, MAX_FRAMES = 12;

  function sceneSeconds(s, fallback) {
    var m = /(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/.exec(String(s.time || ""));
    var sec = m ? Number(m[2]) - Number(m[1]) : fallback;
    return Math.min(8, Math.max(1.5, sec || fallback));
  }

  function loadImg(file) {
    return new Promise(function (resolve) {
      if (!file) return resolve(null);
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = "/u/" + file;
    });
  }

  // Emoji ffmpeg/kanvas shriftida "kvadrat" bo'lib chiqmasin
  var stripEmoji = function (t) { return String(t || "").replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, "").replace(/\u{FE0F}/gu, "").trim(); };

  function drawReelFrame(canvas, img, text, theme) {
    canvas.width = VW;
    canvas.height = VH;
    var ctx = canvas.getContext("2d");
    if (img) {
      var s = Math.max(VW / img.width, VH / img.height);
      ctx.drawImage(img, (VW - img.width * s) / 2, (VH - img.height * s) / 2, img.width * s, img.height * s);
    } else {
      var g = ctx.createLinearGradient(0, 0, VW, VH);
      g.addColorStop(0, theme.bg[0]);
      g.addColorStop(1, theme.bg[1]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, VW, VH);
    }
    // Matn o'qilishi uchun pastga qorong'u gradient (Reels tugmalari pastki 320px'ni yopadi)
    var shade = ctx.createLinearGradient(0, VH * 0.45, 0, VH);
    shade.addColorStop(0, "rgba(0,0,0,0)");
    shade.addColorStop(1, "rgba(0,0,0,0.78)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, VW, VH);
    var font = "'Plus Jakarta Sans', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 18;
    var size = 76;
    ctx.font = "800 " + size + "px " + font;
    var lines = wrapLines(ctx, stripEmoji(text), VW - 160).slice(0, 5);
    var y = 1480 - (lines.length - 1) * size * 1.18;
    lines.forEach(function (l) { ctx.fillText(l, VW / 2, y); y += size * 1.18; });
    var sign = brand.handle ? "@" + brand.handle : brand.name;
    if (sign) {
      ctx.font = "700 40px " + font;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillText(sign, VW / 2, 150);
    }
    ctx.shadowBlur = 0;
    ctx.textAlign = "left";
  }

  function videoMaker(item, d) {
    var scenes = (d.scenes || []).slice(0, MAX_FRAMES);
    var fallback = (item.input && item.input.duration ? item.input.duration : 30) / scenes.length;
    var picked = [];
    var box = el("div", "cs-block");
    box.style.cssText = "border-color:#22c55e; white-space:normal";
    box.appendChild(el("h4", "", "🎥 Videoga aylantirish va Instagram'ga joylash"));
    box.appendChild(el("div", "hint", "Mahsulot rasmlarini tanlang (tanlash tartibi = kadrlar tartibi). Rasm kam bo'lsa takrorlanadi, umuman tanlanmasa rangli fon ishlatiladi. Har kadrga ekrandagi matn yoziladi."));

    var grid = el("div");
    grid.style.cssText = "display:grid; grid-template-columns:repeat(auto-fill,minmax(72px,1fr)); gap:6px; margin:10px 0";
    function thumb(m) {
      var t = el("div");
      t.style.cssText = "position:relative; aspect-ratio:9/16; border-radius:8px; overflow:hidden; cursor:pointer; border:2px solid transparent; background:#0f172a";
      var im = document.createElement("img");
      im.src = "/u/" + m.file;
      im.alt = m.name || "";
      im.loading = "lazy";
      im.style.cssText = "width:100%; height:100%; object-fit:cover; display:block";
      var badge = el("span");
      badge.style.cssText = "position:absolute; top:4px; left:4px; background:#22c55e; color:#fff; font-size:11px; font-weight:700; border-radius:10px; padding:1px 7px; display:none";
      t.appendChild(im);
      t.appendChild(badge);
      t.onclick = function () {
        var i = picked.indexOf(m.file);
        if (i >= 0) picked.splice(i, 1); else if (picked.length < MAX_FRAMES) picked.push(m.file);
        refresh();
      };
      t._file = m.file;
      t._badge = badge;
      return t;
    }
    function refresh() {
      Array.prototype.forEach.call(grid.children, function (t) {
        var i = picked.indexOf(t._file);
        t.style.borderColor = i >= 0 ? "#22c55e" : "transparent";
        t._badge.style.display = i >= 0 ? "" : "none";
        t._badge.textContent = i + 1;
      });
    }
    media.forEach(function (m) { grid.appendChild(thumb(m)); });
    box.appendChild(grid);

    var upLabel = el("label", "btn secondary", "📤 Rasm yuklash");
    upLabel.style.cssText = "display:inline-block; margin:0 6px 0 0; cursor:pointer; padding:6px 12px; font-size:12.5px";
    var up = document.createElement("input");
    up.type = "file";
    up.accept = "image/jpeg,image/png,image/webp";
    up.multiple = true;
    up.hidden = true;
    upLabel.appendChild(up);
    up.onchange = function () {
      var files = Array.prototype.slice.call(up.files || []);
      status.textContent = "⏳ Rasmlar yuklanmoqda...";
      Promise.all(files.map(function (f) {
        var fd = new FormData();
        fd.append("file", f);
        return fetch("/media/upload", { method: "POST", body: fd }).then(function (r) { return r.json(); });
      })).then(function (rs) {
        rs.forEach(function (r) {
          if (!r.ok) return;
          var m = { file: r.item.file, name: r.item.name };
          media.unshift(m);
          grid.insertBefore(thumb(m), grid.firstChild);
          if (picked.length < MAX_FRAMES) picked.push(m.file);
        });
        refresh();
        var bad = rs.filter(function (r) { return !r.ok; })[0];
        status.textContent = bad ? "⚠️ " + bad.error : "";
      }).catch(function () { status.textContent = "⚠️ Tarmoq xatosi"; });
      up.value = "";
    };

    var make = el("button", "btn", "🎬 Video yasash");
    make.type = "button";
    make.style.cssText = "margin:0; padding:6px 14px; font-size:12.5px";
    var status = el("span", "hint");
    status.style.cssText = "margin-left:8px; font-size:12.5px";
    var bar = el("div");
    bar.appendChild(upLabel);
    bar.appendChild(make);
    bar.appendChild(status);
    box.appendChild(bar);
    var result = el("div");
    result.style.marginTop = "10px";
    box.appendChild(result);

    function showReady(v) {
      result.innerHTML = "";
      var vid = document.createElement("video");
      vid.src = "/u/" + v.file;
      vid.controls = true;
      vid.playsInline = true;
      vid.style.cssText = "width:100%; max-width:270px; border-radius:10px; display:block; background:#000";
      result.appendChild(vid);
      if (!v.voice) result.appendChild(el("div", "hint", "🔇 Ovozsiz video — Instagram ilovasida musiqa qo'shishingiz mumkin."));
      var dl = el("a", "btn secondary", "⬇️ Yuklab olish");
      dl.href = "/u/" + v.file;
      dl.download = "reels.mp4";
      dl.style.cssText = "display:inline-block; margin:8px 6px 0 0; padding:6px 12px; font-size:12.5px";
      result.appendChild(dl);
      if (!brand.igConnected) {
        result.appendChild(el("div", "hint", "Instagram'ga avtomatik joylash uchun avval Instagram akkauntini ulang."));
        return;
      }
      var when = document.createElement("input");
      when.type = "datetime-local";
      when.style.cssText = "width:auto; margin:8px 6px 0 0; padding:5px 8px; font-size:12.5px";
      when.title = "Bo'sh qoldirsangiz — hozir joylanadi";
      var pub = el("button", "btn", "📲 Reels qilib joylash");
      pub.type = "button";
      pub.style.cssText = "margin:8px 0 0; padding:6px 14px; font-size:12.5px";
      var pubStatus = el("div", "hint");
      pubStatus.style.marginTop = "6px";
      pub.onclick = function () {
        pub.disabled = true;
        pubStatus.textContent = "⏳ Instagram'ga yuborilmoqda...";
        var body = { publishAt: when.value ? new Date(when.value).toISOString() : "" };
        fetch("/content/" + encodeURIComponent(item.id) + "/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
          .then(function (r) { return r.json(); })
          .then(function (r) {
            if (!r.ok) throw new Error(r.error || "Xatolik");
            pubStatus.innerHTML = "";
            pubStatus.appendChild(document.createTextNode(r.scheduled
              ? "🗓️ Rejalashtirildi. "
              : "✅ Instagram qabul qildi — video qayta ishlangach (1–5 daqiqa) Reels chiqadi. "));
            var a = el("a", "", "Rejalashtiruvchida ko'rish →");
            a.href = "/scheduler";
            pubStatus.appendChild(a);
          })
          .catch(function (err) { pubStatus.textContent = "⚠️ " + err.message; pub.disabled = false; });
      };
      result.appendChild(when);
      result.appendChild(pub);
      result.appendChild(pubStatus);
    }

    function poll() {
      fetch("/content/" + encodeURIComponent(item.id) + "/video")
        .then(function (r) { return r.json(); })
        .then(function (r) {
          var v = r.video || {};
          if (v.status === "rendering") { setTimeout(poll, 3000); return; }
          make.disabled = false;
          if (v.status === "ready") { item.video = v; status.textContent = "✅ Video tayyor"; showReady(v); }
          else if (v.status === "failed") status.textContent = "⚠️ " + (v.error || "Video yasalmadi");
        })
        .catch(function () { setTimeout(poll, 5000); });
    }

    make.onclick = function () {
      make.disabled = true;
      result.innerHTML = "";
      status.textContent = "⏳ Kadrlar chizilmoqda...";
      var theme = THEMES[0];
      Promise.all(scenes.map(function (_, i) { return loadImg(picked.length ? picked[i % picked.length] : ""); }))
        .then(function (imgs) {
          return Promise.all(scenes.map(function (s, i) {
            var text = s.onScreenText || (i === 0 && d.hooks && d.hooks[0]) || s.voice || "";
            var c = document.createElement("canvas");
            drawReelFrame(c, imgs[i], text, theme);
            return new Promise(function (res) { c.toBlob(res, "image/jpeg", 0.9); });
          }));
        })
        .then(function (blobs) {
          var fd = new FormData();
          blobs.forEach(function (b, i) { fd.append("frames", b, "f" + i + ".jpg"); });
          fd.append("durations", JSON.stringify(scenes.map(function (s) { return sceneSeconds(s, fallback); })));
          status.textContent = "⏳ Video yasalmoqda (30–90 soniya)...";
          return fetch("/content/" + encodeURIComponent(item.id) + "/video", { method: "POST", body: fd }).then(function (r) { return r.json(); });
        })
        .then(function (r) {
          if (!r.ok) throw new Error(r.error || "Xatolik");
          poll();
        })
        .catch(function (err) { status.textContent = "⚠️ " + err.message; make.disabled = false; });
    };

    if (item.video && item.video.status === "ready") showReady(item.video);
    else if (item.video && item.video.status === "rendering") { make.disabled = true; status.textContent = "⏳ Video yasalmoqda..."; poll(); }
    return box;
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
