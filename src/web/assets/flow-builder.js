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
  var selectedEdge = null; // { node, port }
  var panel = null; // null | "problems" | "versions" | "sim"
  var dirty = false;
  var saving = false;
  var validation = meta.validation || { errors: [], warnings: [] };
  var sim = null;

  if (Array.isArray(flow.nodes)) {
    var map = {};
    flow.nodes.forEach(function (n) { map[n.id] = n; });
    flow.nodes = map;
  }
  flow.nodes = flow.nodes || {};
  flow.triggers = flow.triggers || [];

  var MEDIA_LABEL = { image: "🖼️ Rasm", video: "🎬 Video", audio: "🎧 Audio", file: "📎 Fayl", post: "📸 Instagram post" };
  var ICONS = { message: "💬", input: "📝", condition: "🔀", action: "⚡", delay: "⏱️", ai: "🧠", redirect: "↪️", note: "🗒️" };

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
    scheduleHistory();
    scheduleValidate();
  }

  // ---------- bekor qilish / qaytarish (undo / redo) ----------

  var history = [];
  var histPos = -1;
  var histTimer = null;

  function snapshotState() {
    return JSON.stringify({ name: flow.name, enabled: flow.enabled, triggers: flow.triggers, start: flow.start, nodes: flow.nodes });
  }

  function commitHistory() {
    clearTimeout(histTimer);
    histTimer = null;
    var snap = snapshotState();
    if (history[histPos] === snap) return;
    history = history.slice(0, histPos + 1);
    history.push(snap);
    if (history.length > 100) history.shift();
    histPos = history.length - 1;
    updateHistButtons();
  }

  function scheduleHistory() {
    clearTimeout(histTimer);
    histTimer = setTimeout(commitHistory, 350);
  }

  function resetHistory() {
    history = [snapshotState()];
    histPos = 0;
    updateHistButtons();
  }

  function restoreState(snap) {
    var st = JSON.parse(snap);
    flow.name = st.name;
    flow.enabled = st.enabled;
    flow.triggers = st.triggers || [];
    flow.start = st.start;
    flow.nodes = st.nodes || {};
    if (selected && !flow.nodes[selected]) selected = null;
    selectedEdge = null;
    dirty = true;
    setStatus("● Saqlanmagan o'zgarishlar", "#fbbf24");
    scheduleValidate();
    renderAll();
  }

  function undo() {
    if (histTimer) commitHistory();
    if (histPos <= 0) return;
    histPos--;
    restoreState(history[histPos]);
    updateHistButtons();
  }

  function redo() {
    if (histPos >= history.length - 1) return;
    histPos++;
    restoreState(history[histPos]);
    updateHistButtons();
  }

  function updateHistButtons() {
    var u = document.querySelector('[data-act="undo"]');
    var r = document.querySelector('[data-act="redo"]');
    if (u) u.disabled = histPos <= 0 && !histTimer;
    if (r) r.disabled = histPos >= history.length - 1;
  }

  // ---------- tekshiruv (serverdagi validateFlow bilan bir xil) ----------

  var valTimer = null;
  var valSeq = 0;

  function scheduleValidate() {
    clearTimeout(valTimer);
    valTimer = setTimeout(runValidate, 700);
  }

  function runValidate() {
    var seq = ++valSeq;
    fetch(location.pathname + "/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(serialize()) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (seq !== valSeq || !d.ok) return;
        validation = d.validation;
        renderValidation();
        if (panel === "problems") renderSide();
      })
      .catch(function () {});
  }

  function problemsOf(id) {
    return {
      err: validation.errors.some(function (x) { return x.nodeId === id; }),
      warn: validation.warnings.some(function (x) { return x.nodeId === id; }),
    };
  }

  function renderValidation() {
    var badge = document.getElementById("fbVal");
    if (badge) {
      var e = validation.errors.length;
      var w = validation.warnings.length;
      badge.textContent = e ? "⛔ " + e + " xato" + (w ? " · " + w + " ⚠️" : "") : w ? "⚠️ " + w + " ogohlantirish" : "✓ Xatosiz";
      badge.className = "secondary fb-val " + (e ? "bad" : w ? "warn" : "good");
    }
    Array.prototype.forEach.call(canvas.querySelectorAll(".fb-node"), function (el) {
      var pr = problemsOf(el.getAttribute("data-id"));
      el.classList.toggle("err", pr.err);
      el.classList.toggle("warn", !pr.err && pr.warn);
    });
  }

  function snippet(n) {
    switch (n.type) {
      case "message": return (n.media ? MEDIA_LABEL[n.media.type] + (n.media.name ? ": " + n.media.name : "") + "\n" : "") + (n.text || (n.media ? "" : "(bo'sh xabar)"));
      case "input": return (n.text || "(savol)") + "\n→ {" + (n.varName || "javob") + "}";
      case "condition":
        return (n.conditions || []).map(condLabel).join(n.match === "any" ? "\nYOKI " : "\nVA ") || "(shart yo'q — doim Ha)";
      case "action": return (n.actions || []).map(actionLabel).join("\n") || "(amal yo'q)";
      case "delay": return n.minutes + " daqiqa kutish";
      case "ai": return n.prompt || "AI biznes ma'lumotlari asosida javob beradi";
      case "redirect":
        var f = meta.otherFlows.filter(function (x) { return x.id === n.flowId; })[0];
        return f ? "→ " + f.name : "(flow tanlanmagan)";
      case "note": return n.text || "Izoh yozing…";
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
      case "follows": return k + (c.value ? ": " + c.value : "");
      case "tg_boost": return k + (c.value ? ": " + c.value : "");
      default: return k;
    }
  }

  function actionLabel(a) {
    var k = meta.actionKinds[a.kind] || a.kind;
    if (a.kind === "set_var") return k + ": {" + a.key + "} = " + a.value;
    if (a.kind === "handoff" || a.kind === "react") return k;
    if (a.kind === "run_flow") {
      var tf = meta.otherFlows.filter(function (x) { return x.id === a.key; })[0];
      return k + ": " + (tf ? tf.name : "?") + (a.value === "referrer" ? " (taklif qilganga)" : "");
    }
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
    } else if (n.type !== "redirect" && n.type !== "note") {
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
      var el = h("div", { class: "fb-node t-" + n.type + (n.type === "note" ? " c-" + (n.color || "yellow") : "") + (selected === id ? " sel" : "") + (sim && sim.cur === id ? " simcur" : ""), "data-id": id });
      el.style.left = (n.x || 0) + "px";
      el.style.top = (n.y || 0) + "px";
      if (flow.start === id) el.appendChild(h("span", { class: "start", text: "▶ START" }));
      if (n.type !== "note") el.appendChild(h("span", { class: "in" }));
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
    renderValidation();
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

  function attr(v) {
    return String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  function renderEdges() {
    var paths = [];
    var mid = null;
    Object.keys(flow.nodes).forEach(function (id) {
      outputs(flow.nodes[id]).forEach(function (o) {
        if (!o.port || !o.target || !flow.nodes[o.target]) return;
        var a = portPoint(id, o.port);
        var b = inPoint(o.target);
        if (!a || !b) return;
        var isSel = selectedEdge && selectedEdge.node === id && selectedEdge.port === o.port;
        var d = curve(a, b);
        paths.push('<path class="' + o.cls + (isSel ? " selected" : "") + '" d="' + d + '"/>');
        paths.push('<path class="hit" data-node="' + attr(id) + '" data-port="' + attr(o.port) + '" d="' + d + '"><title>Tanlash uchun bosing</title></path>');
        if (isSel) {
          var dx = Math.max(60, Math.abs(b.x - a.x) / 2);
          // Kubik egri chiziqning o'rtasi: (P0 + 3P1 + 3P2 + P3) / 8
          mid = { x: (a.x + 3 * (a.x + dx) + 3 * (b.x - dx) + b.x) / 8, y: (a.y + 3 * a.y + 3 * b.y + b.y) / 8 };
        }
      });
    });
    if (drag && drag.kind === "link" && drag.to) {
      paths.push('<path class="drag" d="' + curve(drag.from, drag.to) + '"/>');
    }
    edges.innerHTML = paths.join("");
    var old = canvas.querySelector(".fb-edge-x");
    if (old) old.remove();
    if (mid) {
      var x = h("button", { type: "button", class: "fb-edge-x", title: "Ulanishni uzish (Delete)", text: "✕" });
      x.style.left = mid.x - 13 + "px";
      x.style.top = mid.y - 13 + "px";
      canvas.appendChild(x);
    }
  }

  function deleteSelectedEdge() {
    if (!selectedEdge || !flow.nodes[selectedEdge.node]) return;
    setTarget(flow.nodes[selectedEdge.node], selectedEdge.port, null);
    selectedEdge = null;
    markDirty();
    renderAll();
  }

  function renderAll() {
    renderNodes();
    renderSide();
  }

  /** Mobil: inspektor varag'i blok tanlanganda ochiladi, bo'sh joyga bosilganda yopiladi. */
  var sheetPinned = false; // "⚙️" orqali ochilgan flow sozlamalari tahrirlash paytida yopilmasin
  function syncSheet() {
    side.classList.toggle("open", Boolean(selected || sheetPinned || panel));
  }
  var settingsBtn = document.getElementById("fbSettingsBtn");
  if (settingsBtn) settingsBtn.addEventListener("click", function () {
    selected = null;
    panel = null;
    sheetPinned = true;
    renderAll();
  });

  // ---------- sichqoncha / sensor ----------

  var drag = null;

  function toCanvas(e) {
    var c = canvas.getBoundingClientRect();
    return { x: (e.clientX - c.left) / view.k, y: (e.clientY - c.top) / view.k };
  }

  // Ikki barmoq bilan zoom (pinch) — sensorli ekranlar uchun
  var touches = {};
  var pinch = null;
  function touchCount() { return Object.keys(touches).length; }
  function pinchInfo() {
    var p = Object.keys(touches).map(function (k) { return touches[k]; });
    return { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), cx: (p[0].x + p[1].x) / 2, cy: (p[0].y + p[1].y) / 2 };
  }
  wrap.addEventListener("pointerdown", function (e) {
    if (e.pointerType !== "touch") return;
    touches[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (touchCount() === 2) {
      drag = null; // ikkinchi barmoq — sudrash o'rniga zoom
      edges.querySelectorAll("path.drag").forEach(function (p) { p.remove(); });
      pinch = pinchInfo();
    }
  }, true);
  wrap.addEventListener("pointermove", function (e) {
    if (!touches[e.pointerId]) return;
    touches[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (pinch && touchCount() === 2) {
      var now = pinchInfo();
      if (pinch.d > 0) zoomAt(now.cx, now.cy, now.d / pinch.d);
      view.x += now.cx - pinch.cx;
      view.y += now.cy - pinch.cy;
      applyView();
      renderEdges();
      pinch = now;
    }
  }, true);
  function touchEnd(e) {
    delete touches[e.pointerId];
    if (touchCount() < 2) pinch = null;
  }
  wrap.addEventListener("pointerup", touchEnd, true);
  wrap.addEventListener("pointercancel", touchEnd, true);

  wrap.addEventListener("pointerdown", function (e) {
    if (e.button !== 0) return;
    if (pinch) return;
    if (e.target.closest(".fb-toolbar, .fb-zoom, .fb-quick")) return;
    closeQuick();
    if (e.target.closest(".fb-edge-x")) {
      e.preventDefault();
      deleteSelectedEdge();
      return;
    }
    var hit = e.target.closest("path.hit");
    if (hit) {
      e.preventDefault();
      selectedEdge = { node: hit.getAttribute("data-node"), port: hit.getAttribute("data-port") };
      renderEdges();
      return;
    }
    if (selectedEdge) {
      selectedEdge = null;
      renderEdges();
    }
    var port = e.target.closest(".port");
    var nodeEl = e.target.closest(".fb-node");
    if (port) {
      drag = { kind: "link", node: port.getAttribute("data-node"), port: port.getAttribute("data-port"), from: centerOf(port), to: null };
    } else if (nodeEl) {
      var id = nodeEl.getAttribute("data-id");
      if (selected !== id) {
        selected = id;
        panel = panel === "sim" ? "sim" : null;
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
    if (!drag || pinch) return;
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
    if (d.kind === "pan" && !d.moved && (selected || sheetPinned || (panel && panel !== "sim"))) {
      selected = null;
      sheetPinned = false;
      if (panel !== "sim") panel = null;
      renderAll();
    }
    if (d.kind === "link") {
      var over = document.elementFromPoint(e.clientX, e.clientY);
      var target = over && over.closest && over.closest(".fb-node");
      var targetId = target ? target.getAttribute("data-id") : null;
      setTarget(flow.nodes[d.node], d.port, targetId && targetId !== d.node ? targetId : null);
      markDirty();
      renderAll();
      // Bo'sh joyga tashlandi — shu yerda yangi blok yaratib ulash menyusi
      if (!target && d.to) openQuick(e.clientX, e.clientY, d.to, d.node, d.port);
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
      case "note": return { text: "", color: "yellow" };
      default: return {};
    }
  }

  function addNode(type, opts) {
    opts = opts || {};
    var r = wrap.getBoundingClientRect();
    var id = uid("n");
    var n = Object.assign({ id: id, type: type }, defaults(type));
    var prev = selected && flow.nodes[selected];
    if (type === "note" || opts.at) prev = null; // izoh hech narsaga ulanmaydi
    if (opts.at) {
      n.x = Math.round(opts.at.x + 20);
      n.y = Math.round(opts.at.y - 24);
      if (opts.from && flow.nodes[opts.from.node]) setTarget(flow.nodes[opts.from.node], opts.from.port, id);
    } else if (prev) {
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
    if (!flow.start && type !== "note") flow.start = id;
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

  // ---------- tez qo'shish menyusi (portni bo'sh joyga tortganda) ----------

  var quick = null;

  function closeQuick() {
    if (quick) quick.remove();
    quick = null;
  }

  function openQuick(clientX, clientY, at, fromNode, fromPort) {
    closeQuick();
    var r = wrap.getBoundingClientRect();
    quick = h("div", { class: "fb-quick" }, [h("div", { class: "fb-hint", style: "margin:0 0 4px", text: "Yangi blok qo'shib ulash:" })].concat(
      Object.keys(ICONS).filter(function (t) { return t !== "note"; }).map(function (t) {
        return h("button", { type: "button", class: "secondary", text: ICONS[t] + " " + String(meta.nodeTypes[t] || t).replace(/^\S+\s/, ""), onclick: function () {
          closeQuick();
          addNode(t, { at: at, from: { node: fromNode, port: fromPort } });
        } });
      })
    ));
    quick.style.left = Math.min(clientX - r.left, r.width - 200) + "px";
    quick.style.top = Math.min(clientY - r.top, r.height - 300) + "px";
    wrap.appendChild(quick);
  }

  // ---------- avtomatik tartiblash ----------

  function arrange() {
    var depth = {};
    var order = [];
    var queue = flow.start && flow.nodes[flow.start] ? [flow.start] : [];
    if (queue.length) depth[flow.start] = 0;
    while (queue.length) {
      var id = queue.shift();
      order.push(id);
      outputs(flow.nodes[id]).forEach(function (o) {
        var t = o.target && flow.nodes[o.target];
        if (t && t.type !== "note" && depth[o.target] === undefined) {
          depth[o.target] = depth[id] + 1;
          queue.push(o.target);
        }
      });
    }
    var maxD = order.reduce(function (m, id) { return Math.max(m, depth[id]); }, -1);
    var notes = [];
    Object.keys(flow.nodes).forEach(function (id) {
      if (flow.nodes[id].type === "note") notes.push(id);
      else if (depth[id] === undefined) { depth[id] = maxD + 1; order.push(id); }
    });
    var heightOf = function (id) {
      var el = canvas.querySelector('.fb-node[data-id="' + id + '"]');
      return el ? el.offsetHeight : 160;
    };
    var cols = {};
    order.forEach(function (id) { (cols[depth[id]] = cols[depth[id]] || []).push(id); });
    Object.keys(cols).forEach(function (d) {
      var y = 0;
      cols[d].forEach(function (id) {
        flow.nodes[id].x = Number(d) * 340;
        flow.nodes[id].y = y;
        y += heightOf(id) + 40;
      });
    });
    var ny = 0;
    notes.forEach(function (id) {
      flow.nodes[id].x = -340;
      flow.nodes[id].y = ny;
      ny += heightOf(id) + 30;
    });
    markDirty();
    renderAll();
    fitView();
  }

  // ---------- nusxa olish / qo'yish (boshqa flow'ga ham) ----------

  var clip = null;

  function copyNode(id) {
    if (!flow.nodes[id]) return;
    clip = JSON.stringify(flow.nodes[id]);
    try { localStorage.setItem("fbClip", clip); } catch (err) { /* xotira yopiq — faqat shu sahifada ishlaydi */ }
    setStatus("⧉ Blok nusxalandi — Ctrl+V bilan qo'ying", "#94a3b8");
  }

  function pasteNode() {
    var raw = clip;
    try { raw = localStorage.getItem("fbClip") || clip; } catch (err) { raw = clip; }
    if (!raw) return;
    var n;
    try { n = JSON.parse(raw); } catch (err) { return; }
    if (!n || !ICONS[n.type]) return;
    var r = wrap.getBoundingClientRect();
    n.id = uid("n");
    n.x = Math.round((r.width / 2 - view.x) / view.k - 130 + Math.random() * 40);
    n.y = Math.round((r.height / 2 - view.y) / view.k - 60 + Math.random() * 40);
    if ("next" in n) n.next = null;
    if ("yes" in n) n.yes = null;
    if ("no" in n) n.no = null;
    (n.buttons || []).forEach(function (b) { b.id = uid("b"); b.next = null; });
    if (n.type === "redirect" && n.flowId === flow.id) n.flowId = "";
    flow.nodes[n.id] = n;
    if (!flow.start && n.type !== "note") flow.start = n.id;
    selected = n.id;
    markDirty();
    renderAll();
  }

  document.addEventListener("keydown", function (e) {
    var mod = e.ctrlKey || e.metaKey;
    var key = (e.key || "").toLowerCase();
    if (mod && key === "s") {
      e.preventDefault();
      save();
      return;
    }
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || "");
    if (typing) return;
    if (e.key === "Escape") {
      closeQuick();
      selectedEdge = null;
      renderEdges();
      return;
    }
    if (mod && key === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && key === "y") { e.preventDefault(); redo(); return; }
    if (mod && key === "c" && selected) { e.preventDefault(); copyNode(selected); return; }
    if (mod && key === "v") { e.preventDefault(); pasteNode(); return; }
    if (mod && key === "d" && selected) { e.preventDefault(); duplicateNode(selected); return; }
    if (e.key === "Delete" || e.key === "Backspace") {
      if (selectedEdge) { e.preventDefault(); deleteSelectedEdge(); return; }
      if (selected) {
        e.preventDefault();
        deleteNode(selected); // Ctrl+Z bilan qaytariladi
      }
    }
  });

  Array.prototype.forEach.call(document.querySelectorAll("[data-act]"), function (b) {
    b.addEventListener("click", function () {
      var act = b.getAttribute("data-act");
      if (act === "undo") undo();
      else if (act === "redo") redo();
      else if (act === "arrange") arrange();
      else if (act === "sim") openPanel("sim");
      else if (act === "versions") openPanel("versions");
    });
  });
  var valBadge = document.getElementById("fbVal");
  if (valBadge) valBadge.addEventListener("click", function () { openPanel("problems"); });

  function openPanel(name) {
    selected = null;
    sheetPinned = false;
    panel = name;
    if (name === "sim") simStart();
    renderAll();
  }

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
    syncSheet();
    if (panel === "problems") return renderProblems();
    if (panel === "versions") return renderVersions();
    if (panel === "sim" && !selected) return renderSim();
    if (!selected || !flow.nodes[selected]) {
      renderFlowSettings();
      return;
    }
    var n = flow.nodes[selected];
    side.appendChild(h("div", { style: "display:flex; justify-content:space-between; align-items:center" }, [
      h("h3", { text: (ICONS[n.type] || "") + " " + String(meta.nodeTypes[n.type] || n.type).replace(/^\S+\s/, "") }),
      h("button", { type: "button", class: "secondary", style: "margin:0; padding:4px 10px; font-size:12px", text: "✕", onclick: function () { selected = null; renderAll(); } }),
    ]));
    var nodeProblems = validation.errors.concat(validation.warnings).filter(function (x) { return x.nodeId === n.id; });
    if (nodeProblems.length) {
      side.appendChild(h("div", { class: "fb-problems" }, nodeProblems.map(function (x) {
        var isErr = validation.errors.indexOf(x) >= 0;
        return h("div", { class: isErr ? "bad" : "warn", text: (isErr ? "⛔ " : "⚠️ ") + x.msg.replace(/^[^:]*#\S+: /, "") });
      })));
    }
    side.appendChild(h("div", { style: "display:flex; gap:6px; flex-wrap:wrap" }, [
      n.type === "note"
        ? null
        : flow.start === n.id
        ? h("span", { class: "status-tag", text: "▶ Boshlanish bloki" })
        : h("button", { type: "button", class: "secondary", style: "margin:0; padding:5px 10px; font-size:12px", text: "🏁 Birinchi blok qilish", title: "Trigger ishlaganda flow shu blokdan boshlanadi", onclick: function () {
            var hasIncoming = Object.keys(flow.nodes).some(function (k) {
              var x = flow.nodes[k];
              return k !== n.id && (x.next === n.id || x.yes === n.id || x.no === n.id || (x.buttons || []).some(function (b) { return b.next === n.id; }));
            });
            if (hasIncoming && !confirm("Bu blokka boshqa bloklardan ulanish bor. Flow shu blokdan boshlansinmi?\n\nOldingi bloklar ishlamay qoladi (Ctrl+Z bilan qaytarish mumkin).")) return;
            flow.start = n.id;
            markDirty();
            renderAll();
          } }),
      h("button", { type: "button", class: "secondary", style: "margin:0; padding:5px 10px; font-size:12px", text: "⧉ Nusxa", onclick: function () { duplicateNode(n.id); } }),
      h("button", { type: "button", class: "secondary", style: "margin:0; padding:5px 10px; font-size:12px", text: "📋 Nusxalash", title: "Ctrl+C — boshqa flow'ga ham qo'yish mumkin", onclick: function () { copyNode(n.id); } }),
      h("button", { type: "button", class: "secondary", style: "margin:0; padding:5px 10px; font-size:12px; color:#f87171", text: "🗑️ O'chirish", onclick: function () { deleteNode(n.id); setStatus("🗑️ Blok o'chirildi — Ctrl+Z / ↶ bilan qaytarish mumkin", "#fbbf24"); } }),
    ]));

    if (n.type === "message") {
      side.appendChild(mediaEditor(n));
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

    if (n.type === "note") {
      side.appendChild(field("Izoh matni (faqat siz va jamoangiz ko'radi)", textArea(n, "text", 6, "Masalan: bu tarmoq faqat aksiya davrida ishlaydi")));
      side.appendChild(field("Rang", select([["yellow", "🟨 Sariq"], ["blue", "🟦 Ko'k"], ["pink", "🟪 Pushti"], ["green", "🟩 Yashil"]], n.color || "yellow", function (v) { n.color = v; changed(); })));
    }

    if (n.type === "redirect") {
      side.appendChild(field("Qaysi flow'ga o'tilsin", select([["", "— tanlang —"]].concat(meta.otherFlows.map(function (f) { return [f.id, f.name]; })), n.flowId, function (v) { n.flowId = v; changed(); })));
    }
  }

  /** Xabar blokiga media biriktirish: yuklash, kutubxona, havola yoki Instagram posti. */
  function mediaEditor(n) {
    var box = h("div", { class: "fb-item" });
    box.appendChild(h("b", { text: "📎 Media (ixtiyoriy)", style: "font-size:12.5px" }));
    if (n.media) {
      var preview = n.media.type === "image" && n.media.url
        ? h("img", { src: n.media.url, style: "display:block; max-width:100%; max-height:140px; border-radius:8px; margin-top:8px" })
        : h("div", { style: "margin-top:8px; font-size:13px", text: MEDIA_LABEL[n.media.type] + (n.media.name ? ": " + n.media.name : "") });
      box.appendChild(preview);
      box.appendChild(h("button", { type: "button", class: "secondary", style: "margin:8px 0 0; padding:4px 10px; font-size:12px; color:#f87171", text: "✕ Olib tashlash", onclick: function () { n.media = null; changed(true); } }));
      return box;
    }
    var status = h("p", { class: "fb-hint" });
    var file = h("input", { type: "file", accept: "image/*,video/mp4,video/quicktime,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.pptx,.zip", style: "display:none" });
    file.addEventListener("change", function () {
      if (!file.files[0]) return;
      var fd = new FormData();
      fd.append("file", file.files[0]);
      status.textContent = "Yuklanmoqda…";
      fetch("/media/upload", { method: "POST", body: fd }).then(function (r) { return r.json(); }).then(function (d) {
        if (!d.ok) { status.textContent = "⚠️ " + d.error; return; }
        n.media = { type: d.item.type, url: d.item.url, name: d.item.name };
        if (d.warning) alert(d.warning);
        changed(true);
      }).catch(function () { status.textContent = "⚠️ Tarmoq xatosi"; });
    });
    var list = h("div", { style: "display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin-top:8px" });
    function pickFrom(url, render) {
      list.innerHTML = "";
      status.textContent = "Yuklanmoqda…";
      fetch(url).then(function (r) { return r.json(); }).then(function (d) {
        status.textContent = d.ok ? (d.items.length ? "" : "Bo'sh") : "⚠️ " + (d.error || "xato");
        (d.items || []).forEach(function (it) { list.appendChild(render(it)); });
      }).catch(function () { status.textContent = "⚠️ Tarmoq xatosi"; });
    }
    var tile = function (label, img, onPick) {
      var t = h("button", { type: "button", class: "secondary", style: "margin:0; padding:4px; height:70px; font-size:11px; overflow:hidden", title: label, onclick: onPick });
      if (img) t.appendChild(h("img", { src: img, style: "width:100%; height:100%; object-fit:cover; border-radius:6px" }));
      else t.textContent = label;
      return t;
    };
    box.appendChild(h("div", { style: "display:flex; gap:4px; flex-wrap:wrap; margin-top:8px" }, [
      h("button", { type: "button", class: "secondary", style: "margin:0; padding:5px 10px; font-size:12px", text: "📤 Yuklash", onclick: function () { file.click(); } }),
      h("button", { type: "button", class: "secondary", style: "margin:0; padding:5px 10px; font-size:12px", text: "🗂️ Kutubxona", onclick: function () {
        pickFrom("/media/library", function (it) {
          return tile((MEDIA_LABEL[it.type] || "") + " " + it.name, it.type === "image" ? it.url : "", function () { n.media = { type: it.type, url: it.url, name: it.name }; changed(true); });
        });
      } }),
      h("button", { type: "button", class: "secondary", style: "margin:0; padding:5px 10px; font-size:12px", text: "📸 IG post", onclick: function () {
        pickFrom("/media/ig-posts", function (it) {
          return tile(it.caption || it.id, it.thumb, function () { n.media = { type: "post", postId: it.id, permalink: it.permalink, name: (it.caption || "Post").slice(0, 60) }; changed(true); });
        });
      } }),
      h("button", { type: "button", class: "secondary", style: "margin:0; padding:5px 10px; font-size:12px", text: "🔗 Havola", onclick: function () {
        var url = prompt("Fayl havolasi (https://...)");
        if (!url || !/^https?:\/\//i.test(url)) return;
        var ext = url.split("?")[0].split(".").pop().toLowerCase();
        var type = /^(jpe?g|png|gif|webp)$/.test(ext) ? "image" : /^(mp4|mov)$/.test(ext) ? "video" : /^(mp3|m4a|aac|ogg)$/.test(ext) ? "audio" : "file";
        n.media = { type: type, url: url, name: url.split("/").pop().split("?")[0] };
        changed(true);
      } }),
      file,
    ]));
    box.appendChild(list);
    box.appendChild(status);
    return box;
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
      row.style.flexDirection = "column";
      row.style.alignItems = "stretch";
      row.appendChild(textInput(c, "value", { placeholder: "Telegram: @kanal1, @kanal2 (bo'sh — asosiy kanal)" }));
      row.appendChild(h("p", { class: "fb-hint", text: "Instagram'da sahifaga obunani tekshiradi. Telegram'da ko'rsatilgan barcha kanallarga a'zo bo'lishi shart (bot kanallarda admin bo'lishi kerak)." }));
    } else if (c.kind === "tg_boost") {
      row.style.flexDirection = "column";
      row.style.alignItems = "stretch";
      row.appendChild(textInput(c, "value", { placeholder: "@kanal (bo'sh — asosiy kanal)" }));
      row.appendChild(h("p", { class: "fb-hint", text: "Faqat Telegram. Mijoz kanalga boost bergan bo'lsa — Ha." }));
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
    if (a.kind === "run_flow") {
      box.appendChild(h("div", { class: "fb-row", style: "margin-top:6px" }, [
        select([["", "— flow tanlang —"]].concat(meta.otherFlows.map(function (f) { return [f.id, f.name]; })), a.key, function (v) { a.key = v; changed(); }),
        select([["self", "Shu mijozga"], ["referrer", "Uni taklif qilgan odamga"]], a.value || "self", function (v) { a.value = v; changed(); }),
      ]));
      box.appendChild(h("p", { class: "fb-hint", text: "\"Taklif qilgan odamga\" — xabarlar referal egasiga boradi ({last_referral} — yangi do'st ismi)." }));
    } else if (a.kind === "react") {
      box.appendChild(h("p", { class: "fb-hint", text: "Mijoz xabariga ❤️ (Instagram/Telegram) yoki kommentga layk bosiladi." }));
    } else if (a.kind === "set_var") {
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
      h("input", { type: "checkbox", checked: flow.enabled, style: "width:auto; margin:0", onchange: function (e) {
        if (e.target.checked && validation.errors.length) {
          e.target.checked = false;
          alert("Flow'da " + validation.errors.length + " ta xato bor — avval ularni tuzating (yuqoridagi ⛔ tugmasi).");
          openPanel("problems");
          return;
        }
        flow.enabled = e.target.checked;
        markDirty();
      } }),
      "Flow faol (triggerlar ishlaydi)",
    ]));
    side.appendChild(h("div", { style: "display:flex; gap:6px; flex-wrap:wrap; margin-top:10px" }, [
      h("button", { type: "button", class: "secondary", style: "margin:0; padding:5px 10px; font-size:12px", text: "▶ Sinash", onclick: function () { openPanel("sim"); } }),
      h("button", { type: "button", class: "secondary", style: "margin:0; padding:5px 10px; font-size:12px", text: "🕘 Versiyalar" + (flow.versionCount ? " (" + flow.versionCount + ")" : ""), onclick: function () { openPanel("versions"); } }),
      h("a", { class: "btn secondary", href: location.pathname + "/export", style: "margin:0; padding:5px 10px; font-size:12px", text: "⬇️ Eksport" }),
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
    side.appendChild(h("p", { class: "fb-hint", text: "Maslahat: blokni tanlang va chapdan yangi blok qo'shing — u avtomatik ulanadi. Portni (rangli nuqta) tortib boshqa blokka tashlang; bo'sh joyga tashlasangiz — yangi blok qo'shish menyusi chiqadi. Chiziqni bosib ✕ bilan uzing. Ctrl+Z / Ctrl+Shift+Z — bekor qilish/qaytarish, Ctrl+C / Ctrl+V — nusxa, Ctrl+D — dublikat, Delete — o'chirish, Ctrl+S — saqlash." }));
  }

  // ---------- panellar: xatolar, versiyalar, simulyator ----------

  function panelHeader(title) {
    return h("div", { style: "display:flex; justify-content:space-between; align-items:center" }, [
      h("h3", { text: title }),
      h("button", { type: "button", class: "secondary", style: "margin:0; padding:4px 10px; font-size:12px", text: "✕", onclick: function () { closePanel(); } }),
    ]);
  }

  function closePanel() {
    panel = null;
    if (sim) { sim = null; }
    renderAll();
  }

  function focusNode(id) {
    if (!flow.nodes[id]) return;
    selected = id;
    panel = null;
    renderAll();
    ensureVisible(flow.nodes[id]);
  }

  function renderProblems() {
    side.appendChild(panelHeader("🩺 Flow tekshiruvi"));
    var all = validation.errors.map(function (x) { return { x: x, bad: true }; })
      .concat(validation.warnings.map(function (x) { return { x: x, bad: false }; }));
    if (!all.length) {
      side.appendChild(h("div", { class: "fb-item", style: "color:#34d399", text: "✓ Xato topilmadi — flow'ni yoqishingiz mumkin." }));
      return;
    }
    side.appendChild(h("p", { class: "fb-hint", text: "⛔ xatolar tuzatilmaguncha flow yoqilmaydi. ⚠️ ogohlantirishlar — flow ishlaydi, lekin tekshirib chiqing. Bosing — blokka o'tadi." }));
    all.forEach(function (it) {
      side.appendChild(h("button", {
        type: "button",
        class: "secondary fb-problem " + (it.bad ? "bad" : "warn"),
        text: (it.bad ? "⛔ " : "⚠️ ") + it.x.msg,
        onclick: function () { if (it.x.nodeId) focusNode(it.x.nodeId); else { panel = null; renderAll(); } },
      }));
      if (it.x.fix && it.x.fix.start && flow.nodes[it.x.fix.start]) {
        side.appendChild(h("button", {
          type: "button", class: "btn", style: "margin:4px 0 0; padding:6px 12px; font-size:12.5px; width:100%",
          text: "✓ Tuzatish: START'ni #" + it.x.fix.start + " ga o'tkazish",
          onclick: function () { flow.start = it.x.fix.start; markDirty(); renderAll(); runValidate(); },
        }));
      }
    });
  }

  function renderVersions() {
    side.appendChild(panelHeader("🕘 Versiyalar tarixi"));
    side.appendChild(h("p", { class: "fb-hint", text: "Har saqlashda oldingi holat saqlanadi (oxirgi 15 ta). Tiklangan versiya o'chiq holda ochiladi; joriy holat ham tarixga tushadi." }));
    var box = h("div", { text: "Yuklanmoqda…", class: "fb-hint" });
    side.appendChild(box);
    fetch(location.pathname + "/versions").then(function (r) { return r.json(); }).then(function (d) {
      if (panel !== "versions") return;
      box.textContent = "";
      if (!d.ok || !d.versions.length) { box.textContent = d.ok ? "Hali versiyalar yo'q — flow saqlanganda paydo bo'ladi." : "⚠️ " + d.error; return; }
      d.versions.forEach(function (v) {
        box.appendChild(h("div", { class: "fb-item", style: "display:flex; justify-content:space-between; align-items:center; gap:8px" }, [
          h("div", {}, [
            h("b", { text: new Date(v.at).toLocaleString().slice(0, 17), style: "color:#e2e8f0; font-size:13px" }),
            h("div", { class: "fb-hint", text: v.name + " · " + v.nodes + " blok · " + v.triggers + " trigger" }),
          ]),
          h("button", { type: "button", class: "secondary", style: "margin:0; padding:5px 10px; font-size:12px; flex:none", text: "↺ Tiklash", onclick: function () { restoreVersion(v.idx); } }),
        ]));
      });
    }).catch(function () { box.textContent = "⚠️ Tarmoq xatosi"; });
  }

  function restoreVersion(idx) {
    if (dirty && !confirm("Saqlanmagan o'zgarishlar yo'qoladi. Davom etilsinmi?")) return;
    fetch(location.pathname + "/restore/" + idx, { method: "POST" }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) throw new Error(d.error || "Tiklab bo'lmadi");
      flow = d.flow;
      validation = d.validation;
      selected = null;
      selectedEdge = null;
      panel = null;
      dirty = false;
      resetHistory();
      setStatus("↺ Versiya tiklandi (flow o'chiq — tekshirib yoqing)", "#a78bfa");
      renderAll();
      fitView();
    }).catch(function (err) { alert(err.message); });
  }

  // Simulyator: flow'ni brauzerda qadam-baqadam o'tkazadi. Hech narsa yuborilmaydi,
  // teg/ball o'zgarmaydi; shartlarning natijasini sinovchi o'zi tanlaydi.
  function simStart() {
    sim = { vars: { name: "Aziza", first_name: "Aziza", username: "aziza_test", business: meta.business || "", phone: "", points: "0" }, log: [], wait: null, cur: null, steps: 0 };
    if (!flow.start || !flow.nodes[flow.start]) simPush("sys", "⛔ START bloki yo'q");
    else simRun(flow.start);
  }

  function simPush(who, text, extra) {
    sim.log.push(Object.assign({ who: who, text: text }, extra || {}));
  }

  function fill(text) {
    return String(text || "").replace(/\{([a-z0-9_]+)(?:\|([^}]*))?\}/gi, function (m, key, fb) {
      var v = sim.vars[key.toLowerCase()];
      return v !== undefined && v !== "" ? v : fb !== undefined ? fb : "";
    });
  }

  function simRun(id) {
    sim.wait = null;
    while (id && flow.nodes[id]) {
      if (++sim.steps > 60) { simPush("sys", "⚠️ Juda ko'p qadam — flow siklga tushib qolgan bo'lishi mumkin"); id = null; break; }
      var n = flow.nodes[id];
      sim.cur = id;
      if (n.type === "message") {
        simPush("bot", fill(n.text), { media: n.media ? MEDIA_LABEL[n.media.type] + (n.media.name ? ": " + n.media.name : "") : "", links: (n.buttons || []).filter(function (b) { return b.url; }) });
        var steps = (n.buttons || []).filter(function (b) { return !b.url; });
        if (steps.length) { sim.wait = { kind: "buttons", node: n, buttons: steps }; break; }
        id = n.next;
      } else if (n.type === "input") {
        simPush("bot", fill(n.text));
        sim.wait = { kind: "input", node: n };
        break;
      } else if (n.type === "condition") {
        simPush("sys", "🔀 Shart: " + ((n.conditions || []).map(condLabel).join(n.match === "any" ? " YOKI " : " VA ") || "shart yo'q"));
        if (!(n.conditions || []).length) { id = n.yes; continue; }
        sim.wait = { kind: "cond", node: n };
        break;
      } else if (n.type === "action") {
        (n.actions || []).forEach(function (a) {
          if (a.kind === "set_var" && a.key) sim.vars[a.key.toLowerCase()] = fill(a.value);
          simPush("sys", "⚡ " + actionLabel(a));
        });
        if ((n.actions || []).some(function (a) { return a.kind === "handoff"; })) { simPush("sys", "👤 Suhbat operatorga o'tdi — bot jim"); id = null; break; }
        id = n.next;
      } else if (n.type === "delay") {
        simPush("sys", "⏱️ " + n.minutes + " daqiqa kutish (sinovda o'tkazib yuborildi)");
        id = n.next;
      } else if (n.type === "ai") {
        simPush("bot", "🧠 AI javobi" + (n.prompt ? " — " + n.prompt : " (bilim bazasi asosida)"), { ai: true });
        id = n.next;
      } else if (n.type === "redirect") {
        var rf = meta.otherFlows.filter(function (x) { return x.id === n.flowId; })[0];
        simPush("sys", "↪️ " + (rf ? "\"" + rf.name + "\" flow'iga o'tadi" : "Flow tanlanmagan"));
        id = null;
      } else {
        id = null;
      }
    }
    if (!sim.wait) {
      sim.cur = null;
      simPush("end", "🏁 Flow tugadi");
    }
    renderNodes();
    if (panel === "sim" && !selected) renderSide();
  }

  function simCheck(kind, text) {
    var t = String(text || "").trim();
    if (!t) return false;
    if (kind === "phone") return t.replace(/\D/g, "").length >= 9;
    if (kind === "email") return /^[\w.+-]+@[\w-]+\.[\w.-]{2,}$/i.test(t);
    if (kind === "number") return Number.isFinite(Number(t.replace(/\s/g, "").replace(",", ".")));
    return true;
  }

  function simAnswer(text) {
    var w = sim.wait;
    if (!w || w.kind !== "input") return;
    simPush("user", text);
    if (!simCheck(w.node.validate, text)) {
      simPush("bot", w.node.retryText ? fill(w.node.retryText) : "❗ Javob noto'g'ri (" + (meta.inputValidations[w.node.validate] || "") + ") — qayta so'raladi");
      renderSide();
      return;
    }
    sim.vars[(w.node.varName || "javob").toLowerCase()] = text.trim();
    if (w.node.validate === "phone") sim.vars.phone = text.trim();
    if (w.node.validate === "name") { sim.vars.name = text.trim(); sim.vars.first_name = text.trim(); }
    simRun(w.node.next);
  }

  function renderSim() {
    side.appendChild(panelHeader("▶ Sinov (simulyator)"));
    side.appendChild(h("div", { style: "display:flex; gap:6px; margin-bottom:8px" }, [
      h("button", { type: "button", class: "secondary", style: "margin:0; padding:5px 10px; font-size:12px", text: "↺ Qaytadan", onclick: function () { simStart(); renderAll(); } }),
    ]));
    side.appendChild(h("p", { class: "fb-hint", style: "margin:0 0 8px", text: "Mijozga hech narsa yuborilmaydi. Shartlarda natijani o'zingiz tanlaysiz. Saqlanmagan o'zgarishlar ham sinaladi." }));
    var trig = (flow.triggers || []).map(function (t) { return (meta.triggerTypes[t.type] || t.type) + (t.keyword ? ": " + t.keyword : t.aiIntent ? ": " + t.aiIntent : ""); });
    if (trig.length) side.appendChild(h("div", { class: "fb-hint", style: "margin-bottom:6px", text: "🎯 " + trig.join(" · ") }));
    var chat = h("div", { class: "fb-sim" });
    sim.log.forEach(function (m) {
      if (m.who === "bot") {
        chat.appendChild(h("div", { class: "b bot" + (m.ai ? " ai" : "") }, [
          m.media ? h("div", { class: "media", text: m.media }) : null,
          m.text ? h("div", { text: m.text }) : null,
          (m.links || []).length ? h("div", { class: "links" }, m.links.map(function (b) { return h("a", { href: b.url, target: "_blank", rel: "noopener", text: "🔗 " + b.title }); })) : null,
        ]));
      } else if (m.who === "user") {
        chat.appendChild(h("div", { class: "b user", text: m.text }));
      } else {
        chat.appendChild(h("div", { class: "b sys" + (m.who === "end" ? " end" : ""), text: m.text }));
      }
    });
    side.appendChild(chat);
    var w = sim.wait;
    if (w && w.kind === "buttons") {
      side.appendChild(h("div", { class: "fb-sim-actions" }, w.buttons.map(function (b) {
        return h("button", { type: "button", class: "secondary", text: b.title, onclick: function () { simPush("user", "🔘 " + b.title); simRun(b.next); } });
      })));
    } else if (w && w.kind === "cond") {
      side.appendChild(h("div", { class: "fb-sim-actions" }, [
        h("button", { type: "button", class: "secondary", style: "color:#34d399", text: "✅ Ha", onclick: function () { simPush("sys", "→ Ha"); simRun(w.node.yes); } }),
        h("button", { type: "button", class: "secondary", style: "color:#f87171", text: "❌ Yo'q", onclick: function () { simPush("sys", "→ Yo'q"); simRun(w.node.no); } }),
      ]));
    } else if (w && w.kind === "input") {
      var inp = h("input", { type: "text", placeholder: w.node.validate === "phone" ? "+998 90 123 45 67" : "Javob yozing…", style: "margin:0" });
      var send = function () { if (inp.value.trim()) simAnswer(inp.value); };
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); send(); } });
      side.appendChild(h("div", { class: "fb-row", style: "margin-top:8px" }, [inp, h("button", { type: "button", class: "btn", style: "margin:0; flex:0 0 auto", text: "➤", onclick: send })]));
      setTimeout(function () { inp.focus(); }, 0);
    }
    setTimeout(function () { chat.scrollTop = chat.scrollHeight; }, 0);
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
        if (res.d.validation) validation = res.d.validation;
        dirty = false;
        if (res.d.error) setStatus("⚠️ " + res.d.error, "#fbbf24");
        else setStatus("✓ Saqlandi " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), "#34d399");
        commitHistory();
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
  resetHistory();
  setTimeout(fitView, 30);
  if (/[?&]imported=1/.test(location.search)) setStatus("📥 Flow import qilindi — tekshirib, faollashtiring", "#a78bfa");
  if (/[?&]ai=1/.test(location.search)) setStatus("✨ AI flow yaratdi — tekshirib, faollashtiring", "#a78bfa");
})();
