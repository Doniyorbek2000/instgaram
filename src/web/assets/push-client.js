/* Panel: service worker va Web Push obunasi (operator bildirishnomalari). */
(function () {
  "use strict";
  if (!("serviceWorker" in navigator)) return;
  var btn = document.getElementById("obxPush");
  navigator.serviceWorker.register("/sw.js").catch(function () {});
  if (!btn || !("PushManager" in window) || !("Notification" in window)) return;

  function b64ToBytes(b64) {
    var pad = "=".repeat((4 - (b64.length % 4)) % 4);
    var raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function setState(on) {
    btn.style.display = "";
    btn.textContent = on ? "🔔 Yoqilgan" : "🔔 Bildirishnoma";
    btn.dataset.on = on ? "1" : "";
  }
  navigator.serviceWorker.ready.then(function (reg) {
    return reg.pushManager.getSubscription().then(function (sub) { setState(Boolean(sub) && Notification.permission === "granted"); });
  }).catch(function () {});

  btn.addEventListener("click", function () {
    btn.disabled = true;
    navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.getSubscription().then(function (existing) {
        if (existing && btn.dataset.on) {
          return fetch("/push/test", { method: "POST" }).then(function () { alert("Sinov bildirishnomasi yuborildi"); });
        }
        return Notification.requestPermission().then(function (perm) {
          if (perm !== "granted") throw new Error("Brauzer bildirishnomaga ruxsat bermadi");
          return fetch("/push/key").then(function (r) { return r.json(); }).then(function (d) {
            return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(d.publicKey) });
          }).then(function (sub) {
            return fetch("/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub) });
          }).then(function (r) {
            if (!r.ok) throw new Error("Saqlab bo'lmadi");
            setState(true);
            return fetch("/push/test", { method: "POST" });
          });
        });
      });
    }).catch(function (err) { alert(err.message || "Xatolik"); }).then(function () { btn.disabled = false; });
  });
})();
