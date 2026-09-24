/* Instagram post / Reels tanlagich (Flow Builder triggerlari va Tezkor qoidalar uchun).
 * window.ObxPostPicker.open(selectedIds, onDone) — modal oyna, bir nechta post tanlanadi.
 * window.ObxPostPicker.preview(ids, el)        — tanlangan postlar muqovalarini chizadi. */
(function () {
  "use strict";
  if (window.ObxPostPicker) return;

  var cache = {}; // id → post
  var loaded = null; // { items, next }
  var loading = null;

  var css = document.createElement("style");
  css.textContent = [
    ".pp-ov{position:fixed;inset:0;z-index:200;background:rgba(3,6,15,.72);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px}",
    ".pp-box{width:min(760px,100%);max-height:min(86vh,820px);display:flex;flex-direction:column;background:#0f1628;border:1px solid var(--border,#1e293b);border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.6);overflow:hidden}",
    ".pp-hd{display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid var(--border,#1e293b)}",
    ".pp-hd h3{margin:0;font-size:17px;flex:1}",
    ".pp-tabs{display:flex;gap:6px;padding:12px 18px 0}",
    ".pp-tabs button{margin:0;padding:6px 12px;font-size:12.5px;border-radius:99px}",
    ".pp-tabs button.on{background:linear-gradient(120deg,#7c3aed,#db2777);color:#fff;border-color:transparent}",
    ".pp-grid{flex:1;overflow-y:auto;display:grid;align-content:start;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;padding:14px 18px}",
    ".pp-tile{position:relative;aspect-ratio:1;border-radius:12px;overflow:hidden;cursor:pointer;background:#1e293b;border:2px solid transparent;padding:0;margin:0;text-align:left}",
    ".pp-tile img{width:100%;height:100%;object-fit:cover;display:block}",
    ".pp-tile .ph{position:absolute;inset:0;display:grid;place-items:center;font-size:30px;color:#64748b}",
    ".pp-tile .bd{position:absolute;left:6px;top:6px;background:rgba(0,0,0,.65);color:#fff;font-size:11px;font-weight:700;padding:2px 7px;border-radius:99px}",
    ".pp-tile .cap{position:absolute;left:0;right:0;bottom:0;padding:18px 8px 6px;font-size:11px;line-height:1.3;color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.85));max-height:52px;overflow:hidden}",
    ".pp-tile .ck{position:absolute;right:6px;top:6px;width:24px;height:24px;border-radius:50%;border:2px solid #fff;background:rgba(0,0,0,.35);display:grid;place-items:center;color:#fff;font-size:13px;font-weight:800}",
    ".pp-tile.on{border-color:#a78bfa;box-shadow:0 0 0 3px rgba(139,92,246,.35)}",
    ".pp-tile.on .ck{background:#7c3aed;border-color:#7c3aed}",
    ".pp-ft{display:flex;align-items:center;gap:8px;padding:12px 18px;border-top:1px solid var(--border,#1e293b);flex-wrap:wrap}",
    ".pp-ft .cnt{flex:1;font-size:13px;color:#94a3b8;min-width:120px}",
    ".pp-ft button{margin:0}",
    ".pp-msg{grid-column:1/-1;text-align:center;color:#94a3b8;font-size:13.5px;padding:30px 10px}",
    ".pp-more{grid-column:1/-1;margin:0 auto !important}",
    ".pp-prev{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}",
    ".pp-prev .it{position:relative;width:54px;height:54px;border-radius:9px;overflow:hidden;background:#1e293b;display:grid;place-items:center;font-size:18px;color:#64748b}",
    ".pp-prev .it img{width:100%;height:100%;object-fit:cover}",
    ".pp-prev .it .bd{position:absolute;left:2px;bottom:2px;font-size:9px;background:rgba(0,0,0,.7);color:#fff;border-radius:5px;padding:0 4px}",
    "@media (max-width:560px){.pp-grid{grid-template-columns:repeat(3,1fr);gap:6px;padding:10px}.pp-tile .cap{display:none}.pp-ov{padding:0}.pp-box{max-height:100vh;height:100%;border-radius:0}}",
  ].join("\n");
  document.head.appendChild(css);

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") e.textContent = attrs[k];
      else if (k === "class") e.className = attrs[k];
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }

  function kind(p) {
    if (p.reels) return "reels";
    if (p.type === "VIDEO") return "video";
    if (p.type === "CAROUSEL_ALBUM") return "carousel";
    return "image";
  }
  var BADGE = { reels: "🎬 Reels", video: "🎥 Video", carousel: "🗂️ Karusel", image: "🖼️ Post" };

  function fetchPage(after) {
    return fetch("/media/ig-posts" + (after ? "?after=" + encodeURIComponent(after) : ""))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || "Instagram postlarini olib bo'lmadi");
        d.items.forEach(function (p) { cache[p.id] = p; });
        return d;
      });
  }

  function loadFirst() {
    if (loaded) return Promise.resolve(loaded);
    if (!loading) {
      loading = fetchPage("").then(function (d) {
        loaded = { items: d.items, next: d.next || "" };
        return loaded;
      }).catch(function (err) { loading = null; throw err; });
    }
    return loading;
  }

  function open(selectedIds, onDone) {
    var sel = (selectedIds || []).slice();
    var filter = "all";
    var grid = el("div", { class: "pp-grid" });
    var cnt = el("span", { class: "cnt" });
    var manual = el("input", { type: "text", placeholder: "yoki post ID", style: "margin:0;width:150px;font-size:12.5px" });
    var ov;

    function close() { ov.remove(); document.removeEventListener("keydown", onKey); }
    function onKey(e) { if (e.key === "Escape") close(); }

    function count() {
      cnt.textContent = sel.length ? sel.length + " ta post tanlandi" : "Hech narsa tanlanmagan — barcha postlarda ishlaydi";
    }

    function tile(p) {
      var on = sel.indexOf(p.id) >= 0;
      var k = kind(p);
      var t = el("button", { type: "button", class: "pp-tile" + (on ? " on" : ""), title: p.caption || p.id }, [
        p.thumb ? el("img", { src: p.thumb, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : el("span", { class: "ph", text: k === "image" ? "🖼️" : "🎬" }),
        el("span", { class: "bd", text: BADGE[k] }),
        el("span", { class: "ck", text: on ? "✓" : "" }),
        p.caption ? el("span", { class: "cap", text: p.caption }) : null,
      ]);
      t.addEventListener("click", function () {
        var i = sel.indexOf(p.id);
        if (i >= 0) sel.splice(i, 1); else sel.push(p.id);
        render();
      });
      return t;
    }

    function render() {
      grid.innerHTML = "";
      count();
      if (!loaded) { grid.appendChild(el("div", { class: "pp-msg", text: "Yuklanmoqda…" })); return; }
      var items = loaded.items.filter(function (p) {
        var k = kind(p);
        return filter === "all" || (filter === "reels" ? k === "reels" || k === "video" : k === "image" || k === "carousel");
      });
      if (!items.length) grid.appendChild(el("div", { class: "pp-msg", text: "Bu turdagi postlar topilmadi" }));
      items.forEach(function (p) { grid.appendChild(tile(p)); });
      if (loaded.next) {
        grid.appendChild(el("button", { type: "button", class: "secondary pp-more", text: "Yana yuklash", onclick: function (e) {
          e.target.disabled = true;
          e.target.textContent = "Yuklanmoqda…";
          fetchPage(loaded.next).then(function (d) {
            loaded.items = loaded.items.concat(d.items);
            loaded.next = d.next || "";
            render();
          }).catch(function (err) { e.target.textContent = "⚠️ " + err.message; });
        } }));
      }
    }

    var tabs = el("div", { class: "pp-tabs" }, [["all", "Barchasi"], ["reels", "🎬 Reels / video"], ["posts", "🖼️ Postlar"]].map(function (x) {
      return el("button", { type: "button", class: "secondary" + (x[0] === filter ? " on" : ""), "data-f": x[0], text: x[1], onclick: function (e) {
        filter = x[0];
        Array.prototype.forEach.call(tabs.children, function (b) { b.classList.toggle("on", b.getAttribute("data-f") === filter); });
        render();
      } });
    }));

    ov = el("div", { class: "pp-ov", onclick: function (e) { if (e.target === ov) close(); } }, [
      el("div", { class: "pp-box", role: "dialog", "aria-label": "Post tanlash" }, [
        el("div", { class: "pp-hd" }, [
          el("h3", { text: "Qaysi post yoki Reels uchun?" }),
          el("button", { type: "button", class: "secondary", style: "margin:0;padding:4px 10px", text: "✕", onclick: close }),
        ]),
        tabs,
        grid,
        el("div", { class: "pp-ft" }, [
          cnt,
          manual,
          el("button", { type: "button", class: "secondary", style: "padding:6px 10px;font-size:12.5px", text: "+ ID", onclick: function () {
            var v = manual.value.trim();
            if (/^[\w-]{3,40}$/.test(v) && sel.indexOf(v) < 0) { sel.push(v); manual.value = ""; count(); }
          } }),
          el("button", { type: "button", class: "secondary", text: "Tozalash", onclick: function () { sel = []; render(); } }),
          el("button", { type: "button", class: "btn", text: "✓ Tayyor", onclick: function () { close(); onDone(sel.slice()); } }),
        ]),
      ]),
    ]);
    document.body.appendChild(ov);
    document.addEventListener("keydown", onKey);
    render();
    loadFirst().then(render).catch(function (err) {
      grid.innerHTML = "";
      grid.appendChild(el("div", { class: "pp-msg", text: "⚠️ " + err.message + ". Instagram ulanganini tekshiring yoki post ID'sini qo'lda kiriting." }));
    });
  }

  /** Tanlangan postlar muqovalarini chizadi (kerak bo'lsa ro'yxatni yuklaydi). */
  function preview(ids, box) {
    box.innerHTML = "";
    if (!ids.length) return;
    var draw = function () {
      box.innerHTML = "";
      ids.forEach(function (id) {
        var p = cache[id];
        var k = p ? kind(p) : "image";
        box.appendChild(el("span", { class: "it", title: p ? p.caption || id : "ID: " + id }, [
          p && p.thumb ? el("img", { src: p.thumb, alt: "", referrerpolicy: "no-referrer" }) : document.createTextNode(p ? "🎬" : "#"),
          el("span", { class: "bd", text: p ? BADGE[k].split(" ")[0] : id.slice(-4) }),
        ]));
      });
    };
    draw();
    if (ids.some(function (id) { return !cache[id]; })) loadFirst().then(draw).catch(function () {});
  }

  window.ObxPostPicker = { open: open, preview: preview, kindLabel: function (id) { var p = cache[id]; return p ? BADGE[kind(p)] : ""; } };
})();
