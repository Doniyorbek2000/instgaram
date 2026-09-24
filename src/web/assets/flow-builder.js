/* Vizual Flow Builder — brauzer qismi (framework'siz).
 * Bloklar sudraladi, chiqish nuqtasidan (port) boshqa blokka tortib ulanadi,
 * o'ng panelda tahrirlanadi va /flows/:id/save ga JSON sifatida saqlanadi. */
(function () {
  "use strict";

  var flow = JSON.parse(document.getElementById("fbData").textContent);
  var meta = JSON.parse(document.getElementById("fbMeta").textContent);
  var wrap = document.getElementById("fbWrap");
  var canvas = document.getElementById("fbCanvas");
  var edges = document.getElementById("fbEdges");
  var side = document.getElementById("fbSide");
  var statusEl = document.getElementById("fbStatus");

  var view = { x: 40, y: 70, k: 1 };
  var selected = null;
  var dirty = false;
  var saving = false;

  if (Array.isArray(flow.nodes)) {
    var map = {};
    flow.nodes.forEach(function (n) { map[n.id] = n; });
    flow.nodes = map;
  }
  flow.nodes = flow.nodes || {};
  flow.triggers = flow.triggers || [];

  var ICONS = { message: "💬", input: "📝", condition: "🔀", action: "⚡", delay: "⏱️", ai: "🧠", redirect: "↪️" };

  // ---------- yordamchilar ----------

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else if (k === "value") el.value = v;
      else if (k === "checked") el.checked = Boolean(v);
      else el.setAttribute(k, v === true ? "" : v);
    });
    [].concat(children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return el;
  }

  function uid(prefix) {
    return prefix + "_" + Math.random().toString(36).slice(2, 8);
  }

  function setStatus(text, color) {
    statusEl.textContent = text;
    statusEl.style.color = color || "";
  }

  function markDirty() {
    dirty = true;
    setStatus("● Saqlanmagan o'zgarishlar", "#fbbf24");
  }

  function snippet(n) {
    switch (n.type) {
      case "message": return n.text || "(bo'sh xabar)";
      case "input": return (n.text || "(savol)") + "\n→ {" + (n.varName || "javob") + "}";
      case "condition":
        return (n.conditions || []).map(condLabel).join(n.match === "any" ? "\nYOKI " : "\nVA ") || "(shart yo'q — doim Ha)";
      case "action": return (n.actions || []).map(actionLabel).join("\n") || "(amal yo'q)";
      case "delay": return n.minutes + " daqiqa kutish";
      case "ai": return n.prompt || "AI biznes ma'lumotlari asosida javob beradi";
      case "redirect":
        var f = meta.otherFlows.filter(function (x) { return x.id === n.flowId; })[0];
        return f ? "→ " + f.name : "(flow tanlanmagan)";
      default: return "";
    }
  }

  function condLabel(c) {
    var k = meta.conditionKinds[c.kind] || c.kind;
    switch (c.kind) {
      case "tag": return k + (c.op === "not" ? " yo'q: " : " bor: ") + c.value;
      case "weekday": return k + ": " + c.value;
      case "time": return k + ": " + c.value;
      case "date": return k + ": " + (c.value || "…") + " — " + (c.value2 || "…");
      case "points": return k + " " + (c.op === "lte" ? "≤ " : c.op === "eq" ? "= " : "≥ ") + c.value;
      case "var": return "{" + c.key + "} " + (c.op === "not_exists" ? "bo'sh" : c.op === "eq" ? "= " + c.value : c.op === "contains" ? "∋ " + c.value : "to'ldirilgan");
      case "channel": return k + ": " + c.value;
      default: return k;
    }
  }

  function actionLabel(a) {
    var k = meta.actionKinds[a.kind] || a.kind;
    if (a.kind === "set_var") return k + ": {" + a.key + "} = " + a.value;
    if (a.kind === "handoff") return k;
    return k + (a.value ? ": " + a.value : "");
  }

  /** Blokning chiqish portlari: [{port, label, cls, target}] */
  function outputs(n) {
    var outs = [];
    if (n.type === "message") {
      (n.buttons || []).forEach(function (b) {
        if (b.url || b._mode === "url") outs.push({ port: null, label: "🔗 " + b.title, cls: "url" });
        else outs.push({ port: "btn:" + b.id, label: "🔘 " + b.title, cls: "btn", target: b.next });
      });
      var hasStepBtn = (n.buttons || []).some(function (b) { return !b.url; });
      if (!hasStepBtn) outs.push({ port: "next", label: "Keyingi", cls: "", target: n.next });
    } else if (n.type === "condition") {
      outs.push({ port: "yes", label: "✅ Ha", cls: "yes", target: n.yes });
      outs.push({ port: "no", label: "❌ Yo'q", cls: "no", target: n.no });
    } else if (n.type !== "redirect") {
      outs.push({ port: "next", label: n.type === "input" ? "Javobdan keyin" : n.type === "delay" ? "Kutgandan keyin" : "Keyingi", cls: "", target: n.next });
    }
    return outs;
  }

  function setTarget(n, port, target) {
    if (port === "next") n.next = target;
    else if (port === "yes") n.yes = target;
    else if (port === "no") n.no = target;
    else if (port && port.indexOf("btn:") === 0) {
      var id = port.slice(4);
      (n.buttons || []).forEach(function (b) { if (b.id === id) b.next = target; });
    }
  }

  // ---------- chizish ----------

  function applyView() {
    canvas.style.transform = "translate(" + view.x + "px," + view.y + "px) scale(" + view.k + ")";
  }

  function renderNodes() {
    Array.prototype.slice.call(canvas.querySelectorAll(".fb-node")).forEach(function (el) { el.remove(); });
    var counts = (flow.stats && flow.stats.nodes) || {};
    Object.keys(flow.nodes).forEach(function (id) {
      var n = flow.nodes[id];
      var el = h("div", { class: "fb-node t-" + n.type + (selected === id ? " sel" : ""), "data-id": id });
      el.style.left = (n.x || 0) + "px";
      el.style.top = (n.y || 0) + "px";
      if (flow.start === id) el.appendChild(h("span", { class: "start", text: "▶ START" }));
      el.appendChild(h("span", { class: "in" }));
      el.appendChild(h("header", {}, [
        (ICONS[n.type] || "") + " " + String(meta.nodeTypes[n.type] || n.type).replace(/^\S+\s/, ""),
        h("span", { class: "cnt", text: counts[id] ? "👥 " + counts[id] : "#" + id }),
      ]));
      el.appendChild(h("div", { class: "body", text: snippet(n) }));
      var outs = outputs(n);
      if (outs.length) {
        el.appendChild(h("div", { class: "fb-outs" }, outs.map(function (o) {
          return h("div", { class: "fb-out " + o.cls }, [
            h("span", { text: o.label }),
            o.port ? h("span", { class: "port", "data-port": o.port, "data-node": id, title: "Tortib boshqa blokka ulang" }) : null,
          ]);
        })));
      }
      canvas.appendChild(el);
    });
    renderEdges();
  }

  function portPoint(nodeId, port) {
    var el = canvas.querySelector('.port[data-node="' + nodeId + '"][data-port="' + port + '"]');
    if (!el) return null;
    return centerOf(el);
  }

  function centerOf(el) {
    var r = el.getBoundingClientRect();
    var c = canvas.getBoundingClientRect();
    return { x: (r.left + r.width / 2 - c.left) / view.k, y: (r.top + r.height / 2 - c.top) / view.k };
  }

  function inPoint(nodeId) {
    var el = canvas.querySelector('.fb-node[data-id="' + nodeId + '"] .in');
    return el ? centerOf(el) : null;
  }

  function curve(a, b) {
    var dx = Math.max(60, Math.abs(b.x - a.x) / 2);
    return "M" + a.x + "," + a.y + " C" + (a.x + dx) + "," + a.y + " " + (b.x - dx) + "," + b.y + " " + b.x + "," + b.y;
  }

  function renderEdges() {
    var paths = [];
    Object.keys(flow.nodes).forEach(function (id) {
      outputs(flow.nodes[id]).forEach(function (o) {
        if (!o.port || !o.target || !flow.nodes[o.target]) return;
        var a = portPoint(id, o.port);
        var b = inPoint(o.target);
        if (a && b) paths.push('<path class="' + o.cls + '" d="' + curve(a, b) + '"/>');
      });
    });
    if (drag && drag.kind === "link" && drag.to) {
      paths.push('<path class="drag" d="' + curve(drag.from, drag.to) + '"/>');
    }
    edges.innerHTML = paths.join("");
  }

  function renderAll() {
    renderNodes();
    renderSide();
  }

  // ---------- sichqoncha / sensor ----------

  var drag = null;

  function toCanvas(e) {
    var c = canvas.getBoundingClientRect();
    return { x: (e.clientX - c.left) / view.k, y: (e.clientY - c.top) / view.k };
  }

  wrap.addEventListener("pointerdown", function (e) {
    if (e.button !== 0) return;
    if (e.target.closest(".fb-toolbar, .fb-zoom")) return;
    var port = e.target.closest(".port");
    var nodeEl = e.target.closest(".fb-node");
    if (port) {
      drag = { kind: "link", node: port.getAttribute("data-node"), port: port.getAttribute("data-port"), from: centerOf(port), to: null };
    } else if (nodeEl) {
      var id = nodeEl.getAttribute("data-id");
      if (selected !== id) {
        selected = id;
        Array.prototype.forEach.call(canvas.querySelectorAll(".fb-node.sel"), function (el) { el.classList.remove("sel"); });
        nodeEl.classList.add("sel");
        renderSide();
      }
      drag = { kind: "node", id: id, sx: e.clientX, sy: e.clientY, ox: flow.nodes[id].x || 0, oy: flow.nodes[id].y || 0, moved: false };
    } else {
      drag = { kind: "pan", sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false };
    }
    wrap.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  wrap.addEventListener("pointermove", function (e) {
    if (!drag) return;
    if (drag.kind === "node") {
      var n = flow.nodes[drag.id];
      var dx = (e.clientX - drag.sx) / view.k;
      var dy = (e.clientY - drag.sy) / view.k;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      n.x = Math.round(drag.ox + dx);
      n.y = Math.round(drag.oy + dy);
      var el = canvas.querySelector('.fb-node[data-id="' + drag.id + '"]');
      el.style.left = n.x + "px";
      el.style.top = n.y + "px";
      renderEdges();
    } else if (drag.kind === "pan") {
      view.x = drag.ox + (e.clientX - drag.sx);
      view.y = drag.oy + (e.clientY - drag.sy);
      if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 3) drag.moved = true;
      applyView();
    } else if (drag.kind === "link") {
      drag.to = toCanvas(e);
      Array.prototype.forEach.call(canvas.querySelectorAll(".fb-node.drop"), function (el) { el.classList.remove("drop"); });
      var over = document.elementFromPoint(e.clientX, e.clientY);
      var target = over && over.closest && over.closest(".fb-node");
      if (target && target.getAttribute("data-id") !== drag.node) target.classList.add("drop");
      renderEdges();
    }
  });

  function endDrag(e) {
    if (!drag) return;
    var d = drag;
    drag = null;
    if (d.kind === "node" && d.moved) markDirty();
    if (d.kind === "pan" && !d.moved && selected) {
      selected = null;
      renderAll();
    }
    if (d.kind === "link") {
      var over = document.elementFromPoint(e.clientX, e.clientY);
      var target = over && over.closest && over.closest(".fb-node");
      var targetId = target ? target.getAttribute("data-id") : null;
      setTarget(flow.nodes[d.node], d.port, targetId && targetId !== d.node ? targetId : null);
      markDirty();
      renderAll();
    }
  }

  wrap.addEventListener("pointerup", endDrag);
  wrap.addEventListener("pointercancel", endDrag);

  wrap.addEventListener("wheel", function (e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.1 : 1 / 1.1);
    } else {
      view.x -= e.deltaX;
      view.y -= e.deltaY;
      applyView();
    }
  }, { passive: false });

  function zoomAt(cx, cy, factor) {
    var r = wrap.getBoundingClientRect();
    var k = Math.min(2, Math.max(0.3, view.k * factor));
    var px = cx - r.left;
    var py = cy - r.top;
    view.x = px - ((px - view.x) * k) / view.k;
    view.y = py - ((py - view.y) * k) / view.k;
    view.k = k;
    applyView();
  }

  function fitView() {
    var ids = Object.keys(flow.nodes);
    if (!ids.length) return;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    ids.forEach(function (id) {
      var n = flow.nodes[id];
      minX = Math.min(minX, n.x || 0);
      minY = Math.min(minY, n.y || 0);
      maxX = Math.max(maxX, (n.x || 0) + 260);
      maxY = Math.max(maxY, (n.y || 0) + 200);
    });
    var r = wrap.getBoundingClientRect();
    var top = (document.querySelector(".fb-toolbar").getBoundingClientRect().height || 40) + 28;
    // Juda kichraytirib yubormaymiz — matn o'qiladigan bo'lsin; sig'masa, surib ko'riladi
    var k = Math.min(1, Math.max(0.6, Math.min((r.width - 60) / (maxX - minX), (r.height - top - 20) / (maxY - minY))));
    view.k = k;
    view.x = 30 - minX * k;
    view.y = top - minY * k;
    applyView();
    renderEdges();
  }

  Array.prototype.forEach.call(document.querySelectorAll("[data-zoom]"), function (b) {
    b.addEventListener("click", function () {
      var z = Number(b.getAttribute("data-zoom"));
      var r = wrap.getBoundingClientRect();
      if (z === 0) fitView();
      else zoomAt(r.left + r.width / 2, r.top + r.height / 2, z > 0 ? 1.15 : 1 / 1.15);
    });
  });

  // ---------- bloklarni boshqarish ----------

  function defaults(type) {
    switch (type) {
      case "message": return { text: "", buttons: [], next: null };
      case "input": return { text: "Telefon raqamingizni yozing:", varName: "phone", validate: "phone", retryText: "", next: null };
      case "condition": return { match: "all", conditions: [{ kind: "tag", op: "has", value: "" }], yes: null, no: null };
      case "action": return { actions: [{ kind: "add_tag", key: "", value: "" }], next: null };
      case "delay": return { minutes: 60, next: null };
      case "ai": return { prompt: "", next: null };
      case "redirect": return { flowId: meta.otherFlows[0] ? meta.otherFlows[0].id : "" };
      default: return {};
    }
  }

  function addNode(type) {
    var r = wrap.getBoundingClientRect();
    var id = uid("n");
    var n = Object.assign({ id: id, type: type }, defaults(type));
    var prev = selected && flow.nodes[selected];
    if (prev) {
      n.x = (prev.x || 0) + 320;
      n.y = prev.y || 0;
      if ("next" in prev && !prev.next && !(prev.buttons || []).some(function (b) { return !b.url; })) prev.next = id;
      else if (prev.type === "condition" && !prev.yes) prev.yes = id;
      else if (prev.type === "condition" && !prev.no) prev.no = id;
    } else {
      n.x = Math.round((r.width / 2 - view.x) / view.k - 130);
      n.y = Math.round((r.height / 2 - view.y) / view.k - 60);
    }
    flow.nodes[id] = n;
    if (!flow.start) flow.start = id;
    selected = id;
    markDirty();
    renderAll();
    ensureVisible(n);
  }

  /** Blok ko'rinish maydonidan tashqarida bo'lsa, ko'rinishni unga suradi. */
  function ensureVisible(n) {
    var r = wrap.getBoundingClientRect();
    var sx = n.x * view.k + view.x;
    var sy = n.y * view.k + view.y;
    var w = 260 * view.k;
    if (sx < 20 || sx + w > r.width - 20 || sy < 70 || sy > r.height - 120) {
      view.x = r.width / 2 - (n.x + 130) * view.k;
      view.y = r.height / 2 - (n.y + 60) * view.k;
      applyView();
      renderEdges();
    }
  }

  function deleteNode(id) {
    delete flow.nodes[id];
    Object.keys(flow.nodes).forEach(function (k) {
      var n = flow.nodes[k];
      if (n.next === id) n.next = null;
      if (n.yes === id) n.yes = null;
      if (n.no === id) n.no = null;
      (n.buttons || []).forEach(function (b) { if (b.next === id) b.next = null; });
    });
    if (flow.start === id) flow.start = Object.keys(flow.nodes)[0] || null;
    selected = null;
    markDirty();
    renderAll();
  }

  function duplicateNode(id) {
    var src = flow.nodes[id];
    var copy = JSON.parse(JSON.stringify(src));
    copy.id = uid("n");
    copy.x = (src.x || 0) + 40;
    copy.y = (src.y || 0) + 40;
    (copy.buttons || []).forEach(function (b) { b.id = uid("b"); });
    flow.nodes[copy.id] = copy;
    selected = copy.id;
    markDirty();
    renderAll();
  }

  Array.prototype.forEach.call(document.querySelectorAll("[data-add]"), function (b) {
    b.addEventListener("click", function () { addNode(b.getAttribute("data-add")); });
  });

  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
      return;
    }
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || "");
    if (!typing && selected && (e.key === "Delete" || e.key === "Backspace")) {
      e.preventDefault();
      if (confirm("Blok o'chirilsinmi?")) deleteNode(selected);
    }
  });

  // ---------- o'ng panel (inspektor) ----------

  var sideTimer = null;
  function changed(rerenderSide) {
    markDirty();
    clearTimeout(sideTimer);
    sideTimer = setTimeout(function () {
      renderNodes();
      if (rerenderSide) renderSide();
    }, 120);
  }

  function field(label, input, hint) {
    return h("div", {}, [h("label", { text: label }), input, hint ? h("p", { class: "fb-hint", text: hint }) : null]);
  }

  function textInput(obj, key, attrs) {
    return h("input", Object.assign({ type: "text", value: obj[key] || "", oninput: function (e) { obj[key] = e.target.value; changed(); } }, attrs || {}));
  }

  function numberInput(obj, key, min, max) {
    return h("input", { type: "number", min: min, max: max, value: obj[key], oninput: function (e) { obj[key] = Number(e.target.value); changed(); } });
  }

  function textArea(obj, key, rows, placeholder) {
    var ta = h("textarea", { rows: rows || 4, placeholder: placeholder || "", oninput: function (e) { obj[key] = e.target.value; changed(); } });
    ta.value = obj[key] || "";
    var box = h("div", {}, [ta]);
    if (meta.ai) box.appendChild(aiBar(ta, obj, key));
    return box;
  }

  function aiBar(ta, obj, key) {
    var modes = [["improve", "✨ Yaxshilash"], ["shorter", "Qisqa"], ["friendly", "Do'stona"], ["sell", "Sotuvchi"], ["ru", "RU"], ["en", "EN"]];
    return h("div", { style: "display:flex; gap:4px; flex-wrap:wrap" }, modes.map(function (m) {
      return h("button", {
        type: "button", class: "secondary ai-btn", text: m[1],
        onclick: function (e) {
          var btn = e.target;
          if (!ta.value.trim()) return;
          btn.disabled = true;
          var old = btn.textContent;
          btn.textContent = "…";
          fetch("/ai/rewrite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: ta.value, mode: m[0] }) })
            .then(function (r) { return r.json(); })
            .then(function (d) {
              if (d.ok && d.text) {
                ta.value = d.text;
                obj[key] = d.text;
                changed();
              } else alert(d.error || "AI xatosi");
            })
            .catch(function () { alert("Tarmoq xatosi"); })
            .then(function () { btn.disabled = false; btn.textContent = old; });
        },
      });
    }));
  }

  function select(options, value, onChange) {
    var s = h("select", { onchange: function (e) { onChange(e.target.value); } }, options.map(function (o) {
      return h("option", { value: o[0], text: o[1] });
    }));
    s.value = value === undefined || value === null ? "" : value;
    return s;
  }

  function targetSelect(n, port, value) {
    var opts = [["", "— (tugaydi)"]].concat(Object.keys(flow.nodes).filter(function (id) { return id !== n.id; }).map(function (id) {
      var t = flow.nodes[id];
      return [id, (ICONS[t.type] || "") + " " + snippet(t).split("\n")[0].slice(0, 32) + " · #" + id];
    }));
    return select(opts, value || "", function (v) { setTarget(n, port, v || null); changed(); });
  }

  function objEntries(o) {
    return Object.keys(o).map(function (k) { return [k, o[k]]; });
  }

  function renderSide() {
    side.innerHTML = "";
    if (!selected || !flow.nodes[selected]) {
      renderFlowSettings();
      return;
    }
    var n = flow.nodes[selected];
    side.appendChild(h("div", { style: "display:flex; justify-content:space-between; align-items:center" }, [
      h("h3", { text: (ICONS[n.type] || "") + " " + String(meta.nodeTypes[n.type] || n.type).replace(/^\S+\s/, "") }),
      h("button", { type: "button", class: "secondary", style: "margin:0; padding:4px 10px; font-size:12px", text: "✕", onclick: function () { selected = null; renderAll(); } }),
    ]));
    side.appendChild(h("div", { style: "display:flex; gap:6px; flex-wrap:wrap" }, [
      flow.start === n.id
        ? h("span", { class: "status-tag", text: "▶ Boshlanish bloki" })
        : h("button", { type: "button", class: "secondary", style: "margin:0; padding:5px 10px; font-size:12px", text: "▶ Start qilish", onclick: function () { flow.start = n.id; markDirty(); renderAll(); } }),
      h("button", { type: "button", class: "secondary", style: "margin:0; padding:5px 10px; font-size:12px", text: "⧉ Nusxa", onclick: function () { duplicateNode(n.id); } }),
      h("button", { type: "button", class: "secondary", style: "margin:0; padding:5px 10px; font-size:12px; color:#f87171", text: "🗑️ O'chirish", onclick: function () { if (confirm("Blok o'chirilsinmi?")) deleteNode(n.id); } }),
    ]));

    if (n.type === "message") {
      side.appendChild(field("Xabar matni", textArea(n, "text", 5, "Salom, {name|do'stim}! 👋"), "O'zgaruvchilar: {name|zaxira}, {first_name}, {username}, {phone}, {points}, {business} va yig'ilgan maydonlar."));
      side.appendChild(h("label", { text: "Tugmalar" }));
      (n.buttons = n.buttons || []).forEach(function (b, i) {
        var isUrl = Boolean(b.url) || b._mode === "url";
        side.appendChild(h("div", { class: "fb-item" }, [
          h("div", { class: "fb-row" }, [
            h("input", { type: "text", maxlength: 20, value: b.title, placeholder: "Tugma matni", oninput: function (e) { b.title = e.target.value; changed(); } }),
            select([["step", "➡️ Keyingi qadam"], ["url", "🔗 Havola"]], isUrl ? "url" : "step", function (v) {
              if (v === "url") { b._mode = "url"; b.next = null; } else { b._mode = "step"; b.url = ""; }
              changed(true);
            }),
            h("button", { type: "button", class: "fb-x", text: "✕", onclick: function () { n.buttons.splice(i, 1); changed(true); } }),
          ]),
          isUrl
            ? h("input", { type: "url", value: b.url || "", placeholder: "https://...", style: "margin-top:6px", oninput: function (e) { b.url = e.target.value; changed(); } })
            : h("div", { style: "margin-top:6px" }, [targetSelect(n, "btn:" + b.id, b.next)]),
        ]));
      });
      if (n.buttons.length < 10) {
        side.appendChild(h("button", { type: "button", class: "secondary fb-add", text: "+ Tugma", onclick: function () { n.buttons.push({ id: uid("b"), title: "Tugma " + (n.buttons.length + 1), next: null, url: "" }); changed(true); } }));
      }
      side.appendChild(h("p", { class: "fb-hint", text: "Instagram: havola tugmalari 3 tagacha. \"Keyingi qadam\" tugmasi bo'lsa, bot mijoz bosishini kutadi." }));
      if (!n.buttons.some(function (b) { return !b.url; })) side.appendChild(field("Keyingi blok", targetSelect(n, "next", n.next)));
    }

    if (n.type === "input") {
      side.appendChild(field("Savol", textArea(n, "text", 3)));
      side.appendChild(field("Javob qaysi o'zgaruvchiga saqlansin", textInput(n, "varName", { placeholder: "phone" }), "Keyin xabarlarda {" + (n.varName || "phone") + "} deb ishlatiladi va kontakt kartasida ko'rinadi."));
      side.appendChild(field("Tekshiruv", select(objEntries(meta.inputValidations), n.validate, function (v) { n.validate = v; changed(); })));
      side.appendChild(field("Noto'g'ri javobda xabar (ixtiyoriy)", textArea(n, "retryText", 2)));
      side.appendChild(field("Javobdan keyin", targetSelect(n, "next", n.next)));
    }

    if (n.type === "condition") {
      side.appendChild(field("Mantiq", select([["all", "Barcha shartlar bajarilsa (VA)"], ["any", "Istalgan biri bajarilsa (YOKI)"]], n.match, function (v) { n.match = v; changed(); })));
      (n.conditions = n.conditions || []).forEach(function (c, i) { side.appendChild(conditionEditor(n, c, i)); });
      side.appendChild(h("button", { type: "button", class: "secondary fb-add", text: "+ Shart", onclick: function () { n.conditions.push({ kind: "tag", op: "has", value: "" }); changed(true); } }));
      side.appendChild(field("✅ Ha bo'lsa", targetSelect(n, "yes", n.yes)));
      side.appendChild(field("❌ Yo'q bo'lsa", targetSelect(n, "no", n.no)));
    }

    if (n.type === "action") {
      (n.actions = n.actions || []).forEach(function (a, i) { side.appendChild(actionEditor(n, a, i)); });
      side.appendChild(h("button", { type: "button", class: "secondary fb-add", text: "+ Amal", onclick: function () { n.actions.push({ kind: "add_tag", key: "", value: "" }); changed(true); } }));
      side.appendChild(field("Keyingi blok", targetSelect(n, "next", n.next)));
    }

    if (n.type === "delay") {
      side.appendChild(field("Necha daqiqa kutilsin", numberInput(n, "minutes", 1, 1380), "Maksimum 23 soat (Meta'ning 24 soatlik xabar oynasi)."));
      side.appendChild(field("Kutgandan keyin", targetSelect(n, "next", n.next)));
    }

    if (n.type === "ai") {
      side.appendChild(field("AI uchun ko'rsatma (ixtiyoriy)", textArea(n, "prompt", 4, "Masalan: mijozga mos tarifni tavsiya qil"), "AI biznesingiz bilim bazasi va mijoz xabari asosida javob beradi."));
      side.appendChild(field("Keyingi blok", targetSelect(n, "next", n.next)));
    }

    if (n.type === "redirect") {
      side.appendChild(field("Qaysi flow'ga o'tilsin", select([["", "— tanlang —"]].concat(meta.otherFlows.map(function (f) { return [f.id, f.name]; })), n.flowId, function (v) { n.flowId = v; changed(); })));
    }
  }

  function conditionEditor(n, c, i) {
    var box = h("div", { class: "fb-item" });
    box.appendChild(h("div", { class: "fb-row" }, [
      select(objEntries(meta.conditionKinds), c.kind, function (v) { c.kind = v; c.op = ""; c.value = ""; c.value2 = ""; c.key = ""; changed(true); }),
      h("button", { type: "button", class: "fb-x", text: "✕", onclick: function () { n.conditions.splice(i, 1); changed(true); } }),
    ]));
    var row = h("div", { class: "fb-row", style: "margin-top:6px" });
    if (c.kind === "tag") {
      row.appendChild(select([["has", "bor"], ["not", "yo'q"]], c.op || "has", function (v) { c.op = v; changed(); }));
      var inp = textInput(c, "value", { placeholder: "teg", list: "fbTags" });
      row.appendChild(inp);
    } else if (c.kind === "weekday") {
      var days = ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"];
      var chosen = String(c.value || "").split(",").filter(Boolean);
      days.forEach(function (d, idx) {
        var num = String(idx + 1);
        row.appendChild(h("label", { style: "display:flex; align-items:center; gap:2px; margin:0; font-size:11.5px; flex:0 0 auto" }, [
          h("input", { type: "checkbox", checked: chosen.indexOf(num) >= 0, style: "width:auto; margin:0", onchange: function (e) {
            chosen = chosen.filter(function (x) { return x !== num; });
            if (e.target.checked) chosen.push(num);
            c.value = chosen.sort().join(",");
            changed();
          } }),
          d,
        ]));
      });
    } else if (c.kind === "time") {
      var parts = String(c.value || "09:00-18:00").split("-");
      var from = h("input", { type: "time", value: parts[0] || "09:00" });
      var to = h("input", { type: "time", value: parts[1] || "18:00" });
      var upd = function () { c.value = from.value + "-" + to.value; changed(); };
      from.addEventListener("input", upd);
      to.addEventListener("input", upd);
      if (!c.value) c.value = from.value + "-" + to.value;
      row.appendChild(from);
      row.appendChild(to);
    } else if (c.kind === "date") {
      row.appendChild(h("input", { type: "date", value: c.value || "", oninput: function (e) { c.value = e.target.value; changed(); } }));
      row.appendChild(h("input", { type: "date", value: c.value2 || "", oninput: function (e) { c.value2 = e.target.value; changed(); } }));
    } else if (c.kind === "points") {
      row.appendChild(select([["gte", "≥"], ["lte", "≤"], ["eq", "="]], c.op || "gte", function (v) { c.op = v; changed(); }));
      row.appendChild(numberInput(c, "value", 0, 1000000));
    } else if (c.kind === "var") {
      row.appendChild(textInput(c, "key", { placeholder: "o'zgaruvchi" }));
      row.appendChild(select([["exists", "to'ldirilgan"], ["not_exists", "bo'sh"], ["eq", "teng"], ["contains", "ichida bor"]], c.op || "exists", function (v) { c.op = v; changed(true); }));
      if (c.op === "eq" || c.op === "contains") row.appendChild(textInput(c, "value", { placeholder: "qiymat" }));
    } else if (c.kind === "channel") {
      row.appendChild(select([["ig", "Instagram"], ["tg", "Telegram"], ["wa", "WhatsApp"], ["fb", "Messenger"]], c.value || "ig", function (v) { c.value = v; changed(); }));
      if (!c.value) c.value = "ig";
    } else if (c.kind === "follows") {
      row.appendChild(h("p", { class: "fb-hint", text: "Instagram'da sahifaga, Telegram'da kanalga obunani tekshiradi." }));
    }
    box.appendChild(row);
    return box;
  }

  function actionEditor(n, a, i) {
    var box = h("div", { class: "fb-item" });
    box.appendChild(h("div", { class: "fb-row" }, [
      select(objEntries(meta.actionKinds), a.kind, function (v) { a.kind = v; changed(true); }),
      h("button", { type: "button", class: "fb-x", text: "✕", onclick: function () { n.actions.splice(i, 1); changed(true); } }),
    ]));
    var hints = {
      add_tag: "teg (vergul bilan bir nechta)", remove_tag: "teg", add_points: "masalan 10 yoki -5",
      conversion: "konversiya nomi (masalan: Lid)", notify: "Yangi lid: {name}, {phone}", webhook: "hodisa belgisi",
    };
    if (a.kind === "set_var") {
      box.appendChild(h("div", { class: "fb-row", style: "margin-top:6px" }, [
        textInput(a, "key", { placeholder: "o'zgaruvchi" }),
        textInput(a, "value", { placeholder: "qiymat" }),
      ]));
    } else if (a.kind !== "handoff") {
      box.appendChild(h("div", { style: "margin-top:6px" }, [textInput(a, "value", { placeholder: hints[a.kind] || "qiymat", list: a.kind.indexOf("tag") >= 0 ? "fbTags" : null })]));
    } else {
      box.appendChild(h("p", { class: "fb-hint", text: "Bot jim bo'ladi, suhbat Live Inbox'da operatorga o'tadi." }));
    }
    return box;
  }

  function renderFlowSettings() {
    side.appendChild(h("h3", { text: "⚙️ Flow sozlamalari" }));
    side.appendChild(field("Nomi", textInput(flow, "name")));
    side.appendChild(h("label", { style: "display:flex; gap:8px; align-items:center; cursor:pointer; margin-top:12px" }, [
      h("input", { type: "checkbox", checked: flow.enabled, style: "width:auto; margin:0", onchange: function (e) { flow.enabled = e.target.checked; markDirty(); } }),
      "Flow faol (triggerlar ishlaydi)",
    ]));

    side.appendChild(h("h3", { text: "🎯 Triggerlar", style: "margin-top:18px" }));
    flow.triggers.forEach(function (t, i) {
      var box = h("div", { class: "fb-item" });
      box.appendChild(h("div", { class: "fb-row" }, [
        select(objEntries(meta.triggerTypes), t.type, function (v) { t.type = v; changed(true); }),
        h("button", { type: "button", class: "fb-x", text: "✕", onclick: function () { flow.triggers.splice(i, 1); changed(true); } }),
      ]));
      var needsKw = ["keyword", "comment", "live_comment", "story_reply"].indexOf(t.type) >= 0;
      if (needsKw) {
        box.appendChild(field("Moslik", select(objEntries(meta.matchTypes), t.matchType || "contains", function (v) { t.matchType = v; changed(true); })));
        if (t.matchType === "ai") box.appendChild(field("Ma'no tavsifi", textInput(t, "aiIntent", { placeholder: "Mijoz narx yoki yetkazib berish haqida so'rayapti" })));
        else if (t.matchType !== "any") box.appendChild(field("Kalit so'zlar (vergul bilan)", textInput(t, "keyword", { placeholder: "narx, price, цена" })));
      }
      if (t.type === "ref") box.appendChild(field("Referal kodi", textInput(t, "keyword", { placeholder: "promo2026" }), "Havola: ig.me/m/<username>?ref=<kod>. Bo'sh — istalgan kod."));
      if (t.type === "comment" || t.type === "live_comment") {
        box.appendChild(field("Post / Reels ID (bo'sh — barcha postlar)", textInput(t, "mediaId", { placeholder: "*" })));
      }
      if (t.type === "comment") {
        var ta = h("textarea", { rows: 3, placeholder: "Direct'ni tekshiring 📩\nYubordik ✨", oninput: function (e) { t.publicReplies = e.target.value.split("\n"); changed(); } });
        ta.value = (t.publicReplies || []).join("\n");
        box.appendChild(field("Ochiq komment javoblari (har qatorda bittasi, tasodifiy)", ta));
      }
      side.appendChild(box);
    });
    side.appendChild(h("button", { type: "button", class: "secondary fb-add", text: "+ Trigger", onclick: function () { flow.triggers.push({ type: "keyword", keyword: "", matchType: "contains", publicReplies: [] }); changed(true); } }));

    var s = flow.stats || {};
    side.appendChild(h("h3", { text: "📊 Statistika", style: "margin-top:18px" }));
    side.appendChild(h("div", { class: "fb-item" }, [
      "Boshlandi: " + (s.started || 0) + " · Yakunlandi: " + (s.completed || 0) + " · Konversiya: " + (s.conversions || 0) +
        (s.started ? " (" + Math.round(((s.conversions || 0) / s.started) * 100) + "%)" : ""),
    ]));
    side.appendChild(h("p", { class: "fb-hint", text: "Maslahat: blokni tanlang va chapdan yangi blok qo'shing — u avtomatik ulanadi. Portni (rangli nuqta) tortib boshqa blokka tashlang. Bo'sh joyga tashlash — ulanishni uzadi. Ctrl+S — saqlash, Delete — blokni o'chirish." }));
  }

  // ---------- saqlash ----------

  function serialize() {
    return {
      name: flow.name,
      enabled: flow.enabled,
      triggers: flow.triggers,
      start: flow.start,
      nodes: Object.keys(flow.nodes).map(function (id) {
        var n = JSON.parse(JSON.stringify(flow.nodes[id]));
        (n.buttons || []).forEach(function (b) { delete b._mode; });
        return n;
      }),
    };
  }

  function save() {
    if (saving) return;
    saving = true;
    setStatus("Saqlanmoqda…", "#94a3b8");
    fetch(location.pathname + "/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(serialize()) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok || !res.d.ok) throw new Error(res.d.error || "Saqlab bo'lmadi");
        var keepModes = {};
        Object.keys(flow.nodes).forEach(function (id) {
          (flow.nodes[id].buttons || []).forEach(function (b) { if (b._mode) keepModes[b.id] = b._mode; });
        });
        flow = res.d.flow;
        Object.keys(flow.nodes).forEach(function (id) {
          (flow.nodes[id].buttons || []).forEach(function (b) { if (keepModes[b.id]) b._mode = keepModes[b.id]; });
        });
        if (selected && !flow.nodes[selected]) selected = null;
        dirty = false;
        setStatus("✓ Saqlandi " + new Date().toLocaleTimeString().slice(0, 5), "#34d399");
        renderAll();
      })
      .catch(function (err) { setStatus("⚠️ " + err.message, "#f87171"); })
      .then(function () { saving = false; });
  }

  document.getElementById("fbSave").addEventListener("click", save);
  window.addEventListener("beforeunload", function (e) {
    if (dirty) { e.preventDefault(); e.returnValue = ""; }
  });

  var tagList = h("datalist", { id: "fbTags" }, (meta.tags || []).map(function (t) { return h("option", { value: t }); }));
  document.body.appendChild(tagList);

  applyView();
  renderAll();
  setTimeout(fitView, 30);
  if (/[?&]ai=1/.test(location.search)) setStatus("✨ AI flow yaratdi — tekshirib, faollashtiring", "#a78bfa");
})();
