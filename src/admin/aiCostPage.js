/**
 * Admin → "AI xarajati": haqiqiy token sarfi asosida har biznes va har tarif bo'yicha
 * AI tannarxi, sof tushum va foyda. Narxlar (kurs, model narxlari, QQS, Payme) shu
 * sahifada sozlanadi.
 */
import { esc } from "../web/layout.js";
import { adminPage, money } from "./layout.js";
import { audit } from "./auth.js";
import { listUsers, listOrders } from "../db.js";
import { getPlans } from "../subscription.js";
import { AI_QUOTA, currentPlan, savePlatformSettings, getCreditPacks } from "../credits.js";
import { aiPricing, DEFAULT_AI_PRICING, monthCost, netRevenue, toSom, usdCost, monthKey } from "../aiCost.js";

// Ma'lumot yo'q paytdagi taxminiy 1 kredit tannarxi: 3 300 kiruvchi + 150 chiquvchi token
const TYPICAL = { inTok: 3300, outTok: 150 };
const som = (v) => money(Math.round(v));
const pct = (a, b) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");
const flashOf = (req) => (req.query.ok ? [String(req.query.ok), "ok"] : req.query.err ? [String(req.query.err), "bad"] : ["", "ok"]);
const go = (res, msg, key = "ok") => res.redirect(`/admin/ai-cost?${key}=${encodeURIComponent(msg)}`);

function monthsAvailable(users) {
  const set = new Set([monthKey()]);
  for (const u of users) for (const m of Object.keys(u.aiUsage?.cost || {})) set.add(m);
  return [...set].sort().reverse().slice(0, 12);
}

export function registerAiCostRoutes(router) {
  router.get("/admin/ai-cost", async (req, res) => {
    const p = aiPricing();
    const users = await listUsers();
    const months = monthsAvailable(users);
    const month = months.includes(String(req.query.m)) ? String(req.query.m) : months[0];
    const orders = (await listOrders({ limit: 5000 })).filter((o) => o.status === "paid" && new Date(o.createdAt).toISOString().slice(0, 7) === month);
    const revenueBy = {};
    for (const o of orders) revenueBy[o.userId] = (revenueBy[o.userId] || 0) + netRevenue(o.amount, p);

    const rows = users.map((u) => {
      const c = monthCost(u, month);
      const cost = toSom(c.usd, p);
      const credits = Number(c.credits) || 0;
      const revenue = revenueBy[u.id] || 0;
      return { u, tier: currentPlan(u), c, cost, credits, revenue, profit: revenue - cost };
    });
    const totalCost = rows.reduce((s, r) => s + r.cost, 0);
    const totalRev = rows.reduce((s, r) => s + r.revenue, 0);
    const totalCredits = rows.reduce((s, r) => s + r.credits, 0);
    const calls = rows.reduce((s, r) => s + r.c.calls, 0);
    const own = rows.reduce((s, r) => s + (r.c.own || 0), 0);
    const freeCost = rows.filter((r) => r.tier === "free" || r.tier === "trial").reduce((s, r) => s + r.cost, 0);
    // Haqiqiy 1 kredit tannarxi (bu oy); ma'lumot kam bo'lsa — taxminiy
    const typicalCredit = toSom(usdCost(Object.keys(p.models)[0], TYPICAL.inTok, TYPICAL.outTok, p), p);
    const perCredit = totalCredits >= 50 ? totalCost / totalCredits : typicalCredit;
    const fallbackCredit = toSom(usdCost(Object.keys(p.models)[1] || "", TYPICAL.inTok, TYPICAL.outTok, p), p);

    const kinds = {};
    for (const r of rows) for (const [k, v] of Object.entries(r.c.kinds || {})) {
      kinds[k] ||= { calls: 0, usd: 0 };
      kinds[k].calls += v.calls;
      kinds[k].usd += v.usd;
    }
    const models = {};
    for (const r of rows) for (const [k, v] of Object.entries(r.c.models || {})) models[k] = (models[k] || 0) + v;

    // Tarif bo'yicha: haqiqiy natija va kvota to'liq ishlatilgandagi nazariy hisob
    const plans = Object.values(await getPlans());
    const tierRows = plans.map((pl) => {
      const group = rows.filter((r) => r.tier === pl.id);
      const net = netRevenue(pl.price, p);
      const quota = AI_QUOTA[pl.id] || 0;
      const full = quota * perCredit;
      const worst = quota * Math.max(perCredit, fallbackCredit);
      return { pl, n: group.length, cost: group.reduce((s, r) => s + r.cost, 0), rev: group.reduce((s, r) => s + r.revenue, 0), net, quota, full, worst };
    });
    const packs = (await getCreditPacks()).map((pk) => {
      const net = netRevenue(pk.price, p);
      return { pk, net, full: pk.credits * perCredit, worst: pk.credits * Math.max(perCredit, fallbackCredit) };
    });
    const trialCost = (AI_QUOTA.trial || 0) * perCredit;

    const kpi = (l, v, sub = "", cls = "") => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div>${sub ? `<div class="s ${cls}">${sub}</div>` : ""}</div>`;
    const flag = (v) => (v < 0 ? `<span class="pill bad">${som(v)}</span>` : `<b>${som(v)}</b>`);
    const kindName = { reply: "Mijozga javob", classify: "Qoida tanlash (AI trigger)", text: "Kontent / flow / o'qitish", audit: "Profil auditi", tts: "Ovozli javob (TTS)" };

    const body = `
      <form method="get" class="row" style="margin-bottom:14px">
        <label style="margin:0">Oy</label>
        <select name="m" onchange="this.form.submit()" style="width:auto; margin:0">${months.map((m) => `<option ${m === month ? "selected" : ""}>${m}</option>`).join("")}</select>
        <span class="hint">1 USD = ${esc(p.usdRate)} so'm · QQS ${esc(p.vatPct)}% · Payme ${esc(p.paymePct)}%</span>
      </form>
      <div class="grid kpis">
        ${kpi("AI xarajati", som(totalCost), `${calls.toLocaleString("ru-RU")} ta chaqiruv`)}
        ${kpi("Sof tushum (to'lovlar)", som(totalRev), "QQS va Payme ayirilgan")}
        ${kpi("Yalpi foyda", som(totalRev - totalCost), `marja ${pct(totalRev - totalCost, totalRev)}`, totalRev - totalCost >= 0 ? "up" : "down")}
        ${kpi("1 kredit tannarxi", `${perCredit.toFixed(1)} so'm`, totalCredits >= 50 ? `haqiqiy · ${Math.round(totalCredits).toLocaleString("ru-RU")} kredit` : "taxminiy (ma'lumot hali kam)")}
        ${kpi("Sinov + bepul xarajati", som(freeCost), `1 sinov ≈ ${som(trialCost)}`)}
        ${kpi("O'z kaliti bilan", own.toLocaleString("ru-RU"), "platformaga xarajatsiz chaqiruvlar")}
      </div>

      <div class="card"><h2>📊 Tariflar: zarar qilmaymizmi?</h2>
        <p class="hint" style="margin-top:0">Mijoz oylik kvotani TO'LIQ ishlatgan holat. "Yomon holat" — asosiy model ishlamay zaxira modelga o'tganda (${fallbackCredit.toFixed(1)} so'm/kredit).</p>
        <div class="tw"><table>
          <thead><tr><th>Tarif</th><th>Narx</th><th>Sof tushum</th><th>AI kvota</th><th>AI tannarxi (to'liq)</th><th>Foyda</th><th>Yomon holatda</th><th>Bu oy: bizneslar / xarajat / tushum</th></tr></thead>
          <tbody>${tierRows.map((t) => `<tr>
            <td><b>${esc(t.pl.name)}</b></td><td>${som(t.pl.price)}</td><td>${som(t.net)}</td><td>${t.quota.toLocaleString("ru-RU")}</td>
            <td>${som(t.full)}</td><td>${flag(t.net - t.full)} <span class="hint">${pct(t.net - t.full, t.net)}</span></td>
            <td>${flag(t.net - t.worst)} <span class="hint">${pct(t.net - t.worst, t.net)}</span></td>
            <td class="hint">${t.n} · ${som(t.cost)} · ${som(t.rev)}</td></tr>`).join("")}
            ${packs.map((k) => `<tr>
            <td>🧠 ${k.pk.credits.toLocaleString("ru-RU")} kredit</td><td>${som(k.pk.price)}</td><td>${som(k.net)}</td><td>${k.pk.credits.toLocaleString("ru-RU")}</td>
            <td>${som(k.full)}</td><td>${flag(k.net - k.full)} <span class="hint">${pct(k.net - k.full, k.net)}</span></td>
            <td>${flag(k.net - k.worst)} <span class="hint">${pct(k.net - k.worst, k.net)}</span></td><td class="hint">paket</td></tr>`).join("")}
          </tbody></table></div>
        <p class="hint">Foyda solig'i (15%) va server xarajati bu jadvalda hisobga olinmagan. Tannarx ${totalCredits >= 50 ? "shu oydagi haqiqiy token sarfidan" : `taxminiy (${TYPICAL.inTok} kiruvchi + ${TYPICAL.outTok} chiquvchi token)`} olingan.</p>
      </div>

      <div class="grid half">
        <div class="card"><h2>🧩 Xarajat turlari</h2>
          ${Object.keys(kinds).length ? `<div class="kv">${Object.entries(kinds).sort((a, b) => b[1].usd - a[1].usd).map(([k, v]) => `<div>${esc(kindName[k] || k)}</div><div><b>${som(toSom(v.usd, p))}</b> <span class="hint">· ${v.calls.toLocaleString("ru-RU")} marta</span></div>`).join("")}</div>` : `<p class="hint">Bu oyda AI chaqiruvi yo'q.</p>`}
        </div>
        <div class="card"><h2>🤖 Modellar</h2>
          ${Object.keys(models).length ? `<div class="kv">${Object.entries(models).map(([m, n]) => `<div><code>${esc(m)}</code></div><div>${n.toLocaleString("ru-RU")} marta ${p.models[m] ? `<span class="hint">· $${p.models[m][0]} / $${p.models[m][1]}</span>` : `<span class="pill warn">narx kiritilmagan</span>`}</div>`).join("")}</div>` : `<p class="hint">—</p>`}
        </div>
      </div>

      <div class="card"><h2>🏢 Bizneslar bo'yicha (${esc(month)})</h2>
        <div class="tw"><table>
          <thead><tr><th>Biznes</th><th>Tarif</th><th>Kredit</th><th>Chaqiruv</th><th>Token (kir/chiq)</th><th>AI xarajati</th><th>1 kredit</th><th>Sof tushum</th><th>Foyda</th></tr></thead>
          <tbody>${rows.filter((r) => r.c.calls || r.revenue).sort((a, b) => b.cost - a.cost).slice(0, 300).map((r) => `<tr>
            <td><a href="/admin/businesses/${esc(r.u.id)}">${esc(r.u.businessName || r.u.email)}</a>${r.c.own ? ` <span class="pill info" title="O'z Gemini kaliti">o'z kaliti</span>` : ""}</td>
            <td>${esc(r.tier)}</td><td>${Math.round(r.credits).toLocaleString("ru-RU")}</td><td>${r.c.calls.toLocaleString("ru-RU")}</td>
            <td class="hint">${Math.round(r.c.in / 1000).toLocaleString("ru-RU")}k / ${Math.round(r.c.out / 1000).toLocaleString("ru-RU")}k</td>
            <td>${som(r.cost)}</td><td class="hint">${r.credits ? `${(r.cost / r.credits).toFixed(1)}` : "—"}</td>
            <td>${r.revenue ? som(r.revenue) : `<span class="hint">—</span>`}</td>
            <td>${r.revenue || r.cost ? flag(r.profit) : "—"}</td></tr>`).join("") || `<tr><td colspan="9" class="hint">Bu oyda ma'lumot yo'q</td></tr>`}</tbody>
        </table></div>
        <p class="hint">"Sof tushum" — shu oyda to'langan buyurtmalar. Admin qo'lda bergan obunalarda tushum ko'rinmaydi.</p>
      </div>

      <form method="post" action="/admin/ai-cost" class="card">
        <h2>⚙️ Narxlar va kurs</h2>
        <div class="row">
          <div class="grow"><label>1 USD (so'm)</label><input name="usdRate" type="number" step="1" min="1000" value="${esc(p.usdRate)}"></div>
          <div class="grow"><label>QQS, %</label><input name="vatPct" type="number" step="0.1" min="0" max="50" value="${esc(p.vatPct)}"></div>
          <div class="grow"><label>Payme komissiyasi, %</label><input name="paymePct" type="number" step="0.1" min="0" max="20" value="${esc(p.paymePct)}"></div>
          <div class="grow"><label>TTS, $ / 1M belgi</label><input name="ttsPerMChars" type="number" step="0.01" min="0" value="${esc(p.ttsPerMChars)}"></div>
        </div>
        <label>Model narxlari — har qatorda: <code>model | kiruvchi $ | chiquvchi $</code> (1M token uchun, ai.google.dev/pricing)</label>
        <textarea name="models" rows="4" style="font-family:monospace">${esc(Object.entries(p.models).map(([m, [i, o]]) => `${m} | ${i} | ${o}`).join("\n"))}</textarea>
        <div class="row">
          <div class="grow"><label>1 kredit = kiruvchi token</label><input name="creditIn" type="number" min="500" value="${esc(p.creditIn)}"></div>
          <div class="grow"><label>1 kredit = chiquvchi token</label><input name="creditOut" type="number" min="50" value="${esc(p.creditOut)}"></div>
        </div>
        <p class="hint">Birinchi qatordagi model — asosiy: kredit uning narxida hisoblanadi. Oddiy matnli javob ≈1 kredit; ovoz, video va uzun natijalar hajmiga qarab ko'proq.</p>
        <div class="row"><button class="btn">💾 Saqlash</button><button class="btn sec" name="reset" value="1" onclick="return confirm('Standart qiymatlarga qaytarilsinmi?')">Standartga qaytarish</button></div>
      </form>`;
    const [flash, kind] = flashOf(req);
    res.send(adminPage("AI xarajati va foyda", body, { active: "aicost", flash, flashKind: kind }));
  });

  router.post("/admin/ai-cost", async (req, res) => {
    const b = req.body || {};
    if (b.reset === "1") {
      await savePlatformSettings({ aiPricing: {} });
      await audit(req, "ai_pricing", "reset");
      return go(res, "Standart narxlar tiklandi");
    }
    const num = (v, min, max, def) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= min && n <= max ? n : def;
    };
    const models = {};
    for (const line of String(b.models || "").split("\n")) {
      const [m, i, o] = line.split("|").map((x) => x.trim());
      if (m && /^[\w.\-]{2,60}$/.test(m) && Number(i) >= 0 && Number(o) >= 0 && i !== "" && o !== "") models[m] = [Number(i), Number(o)];
    }
    if (!Object.keys(models).length) return go(res, "Kamida bitta model narxini kiriting", "err");
    const d = DEFAULT_AI_PRICING;
    const aiPricingNext = {
      usdRate: num(b.usdRate, 1000, 100000, d.usdRate),
      vatPct: num(b.vatPct, 0, 50, d.vatPct),
      paymePct: num(b.paymePct, 0, 20, d.paymePct),
      ttsPerMChars: num(b.ttsPerMChars, 0, 1000, d.ttsPerMChars),
      creditIn: Math.round(num(b.creditIn, 500, 100000, d.creditIn)),
      creditOut: Math.round(num(b.creditOut, 50, 20000, d.creditOut)),
      models,
    };
    await savePlatformSettings({ aiPricing: aiPricingNext });
    await audit(req, "ai_pricing", "", `kurs=${aiPricingNext.usdRate} modellar=${Object.keys(models).join(",")}`);
    go(res, "Narxlar saqlandi");
  });
}
