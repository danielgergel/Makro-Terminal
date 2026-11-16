/* Makro-Terminal – Seite 2: Trading-Cockpit */
(function () {
  "use strict";
  var h = MT.h, BERLIN = MT.TZ_BERLIN, NY = MT.TZ_NY;
  function $(id) { return document.getElementById(id); }
  var K = { set: "mt.cockpit.einst", nq: "mt.cockpit.nq", cnt: "mt.cockpit.zaehler", chk: "mt.cockpit.check", calc: "mt.cockpit.rechner" };
  var DEF = { pre: 60, post: 5, evb: 5, eva: 5, stars: 4, loss: "" };
  var cal = null, calErr = null, hol = null, holErr = null, snapData = null;

  function settings() { var s = MT.store.get(K.set, {}) || {}; var o = {}; Object.keys(DEF).forEach(function (k) { o[k] = s[k] !== undefined && s[k] !== null ? s[k] : DEF[k]; }); return o; }
  function nyToday() { return MT.dayKey(Date.now(), NY); }
  function numIn(el, g) { return MT.parseNum(el.value, g); }
  function atasLive() { return MT.isAtas(snapData); }
  /* Mit ATAS-Daten ist der NQ-Kurs schon im Snapshot, sonst manuell eingetippt (QQQ-Ersatzdaten) */
  function nqPrice() {
    if (atasLive() && MT.isNum(snapData.market.lastPrice) && snapData.market.lastPrice > 0) return snapData.market.lastPrice;
    var v = numIn($("nq"), true); return v && v > 0 ? v : null;
  }
  function syncNqField() {
    var on = atasLive(), el = $("nq"), box = el.closest ? el.closest(".field") : null;
    el.disabled = on;
    if (box) box.hidden = on;
  }

  /* ---------- Zähler ---------- */
  function counters() {
    var c = MT.store.get(K.cnt, null);
    if (!c || c.day !== nyToday() || !Array.isArray(c.trades)) c = { day: nyToday(), trades: [] };
    return c;
  }
  function saveCounters(c) { MT.store.set(K.cnt, c); }
  function stats() {
    var c = counters();
    var losses = c.trades.filter(function (t) { return t.r === "L"; }).length;
    var pnl = c.trades.reduce(function (a, t) { return a + (MT.isNum(t.amt) ? (t.r === "L" ? -Math.abs(t.amt) : Math.abs(t.amt)) : 0); }, 0);
    return { n: c.trades.length, losses: losses, wins: c.trades.length - losses, pnl: pnl, c: c };
  }
  function renderRegeln() {
    var s = stats(), set = settings();
    var lim = MT.parseNum(String(set.loss), true);
    var box = $("regeln-body");
    MT.clear(box);
    box.appendChild(h("div", { class: "kv" }, h("span", { class: "k" }, "Trades heute"), h("span", { class: "v" }, s.n + " von 2" + (s.n >= 2 ? " – Limit erreicht" : ""))));
    box.appendChild(h("div", { class: "kv" }, h("span", { class: "k" }, "Verluste"), h("span", { class: "v" }, s.losses + " von 2" + (s.losses >= 2 ? " – Schluss für heute" : ""))));
    box.appendChild(h("div", { class: "kv" }, h("span", { class: "k" }, "Ergebnis in $ (nur eingetippte Beträge)"), h("span", { class: "v" }, MT.signed(s.pnl, 0, " $"))));
    if (lim && lim > 0) box.appendChild(h("div", { class: "kv" }, h("span", { class: "k" }, "Tagesverlustlimit"), h("span", { class: "v" }, MT.num(lim, 0) + " $" + (s.pnl <= -lim ? " – erreicht" : ""))));
    if (s.n) {
      box.appendChild(h("p", { class: "small muted", style: "margin-top:8px" }, "Verlauf: " + s.c.trades.map(function (t) { return (t.r === "W" ? "Gewinn" : "Verlust") + (MT.isNum(t.amt) ? " " + MT.num(t.amt, 0) + " $" : ""); }).join(", ")));
    }
  }
  function addTrade(r) {
    var c = counters();
    var amt = numIn($("amt"), true);
    c.trades.push({ r: r, amt: amt !== null ? Math.abs(amt) : null });
    saveCounters(c);
    $("amt").value = "";
    resetChecks();
    renderRegeln(); renderAmpel();
  }

  /* ---------- Sechs Fragen ---------- */
  var FRAGEN = [
    ["Welcher Tag ist heute?", "Trend oder Range – siehe Regime oben."],
    ["An welchem Level bin ich?", "Vortageshoch/-tief, VWAP, Eröffnung, Balance-Rand."],
    ["Wer ist gefangen?", "Welche Seite sitzt im Verlust und muss raus?"],
    ["Wo liege ich falsch (Stop)?", "Ohne Stop kein Trade."],
    ["Wohin kann der Preis laufen (Ziel)?", "Mindestens 2:1 zum Stop."],
    ["Würde ich den Trade bei jedem Kontostand nehmen?", "Wenn nein: Größe oder Trade überdenken."]
  ];
  function checks() {
    var c = MT.store.get(K.chk, null);
    if (!c || c.day !== nyToday() || !Array.isArray(c.c) || c.c.length !== 6) c = { day: nyToday(), c: [false, false, false, false, false, false] };
    return c;
  }
  function resetChecks() { MT.store.set(K.chk, { day: nyToday(), c: [false, false, false, false, false, false] }); buildChecks(); }
  function buildChecks() {
    var c = checks(), box = $("check-list");
    MT.clear(box);
    FRAGEN.forEach(function (f, i) {
      var id = "q" + i;
      var inp = h("input", { type: "checkbox", id: id, onchange: function () { var cc = checks(); cc.c[i] = inp.checked; MT.store.set(K.chk, cc); lab.className = "check" + (inp.checked ? " done" : ""); renderCheckResult(); } });
      inp.checked = !!c.c[i];
      var lab = h("label", { class: "check" + (inp.checked ? " done" : ""), for: id, style: "color:var(--text);font-size:1rem;margin-bottom:8px" }, inp, h("span", null, (i + 1) + ". " + f[0], h("span", { class: "hint" }, f[1])));
      box.appendChild(lab);
    });
    renderCheckResult();
  }
  var ampelBlocked = false;
  function renderCheckResult() {
    var c = checks(), n = c.c.filter(Boolean).length, box = $("check-result");
    MT.clear(box);
    if (n === 6) {
      if (ampelBlocked) { box.className = "result short"; box.appendChild(h("p", { class: "big" }, "Alle sechs abgehakt – aber Sperre aktiv"));
        box.appendChild(h("p", { class: "small" }, "Die Ampel steht auf Rot. Kein Trade, solange der Grund oben gilt.")); }
      else { box.className = "result long"; box.appendChild(h("p", { class: "big" }, "✔ Trade erlaubt")); box.appendChild(h("p", { class: "small" }, "Stop und Ziel stehen, Risiko ist gerechnet. Der Pfeil ist ein Hinweis, kein Einstieg.")); }
    } else { box.className = "result"; box.appendChild(h("p", { class: "big", style: "font-size:1.2rem" }, "Noch nicht erlaubt"));
      box.appendChild(h("p", { class: "small muted" }, n + " von 6 Fragen beantwortet.")); }
  }

  /* ---------- Ampel ---------- */
  function ampel(now) {
    var set = settings(), lvl = 0, reasons = [], endMs = 0, nextStart = null;
    function bump(l) { if (l > lvl) lvl = l; }
    function block(startTs, endTs, text) {
      if (now >= startTs && now < endTs) { bump(2); reasons.push(text + " (bis " + MT.hm(endTs, BERLIN) + " Uhr)"); endMs = Math.max(endMs, endTs); }
      else if (now < startTs) { if (nextStart === null || startTs < nextStart.ts) nextStart = { ts: startTs, text: text }; if (startTs - now <= 15 * 60000) { bump(1); reasons.push(text + " beginnt in " + MT.countdown(startTs - now)); } }
    }
    var day = nyToday(), wd = MT.weekday(day), closed = false;
    if (wd === 0 || wd === 6) { bump(2); closed = true; reasons.push("Wochenende – kein regulärer Handel."); }
    if (holErr) { bump(1); reasons.push("Feiertagsdaten nicht verfügbar – Handelstag selbst prüfen."); }
    else if (hol) {
      var hd = hol.filter(function (x) { return x.date === day; })[0];
      if (hd) {
        if (hd.status === "verkuerzt") { bump(1); reasons.push("Verkürzter Handel: " + hd.name + (hd.note ? " – " + hd.note : "")); }
        else { bump(2); closed = true; reasons.push("Börse geschlossen: " + hd.name + (hd.note ? " – " + hd.note : "")); }
      }
    }
    if (!closed && wd >= 1 && wd <= 5) {
      var open = MT.zonedToUtc(day, "09:30", NY);
      block(open - set.pre * 60000, open + set.post * 60000, "Sperrzeit um die US-Eröffnung");
    }
    if (calErr) { bump(1); reasons.push("Kalender nicht verfügbar – Terminsperre unbekannt."); }
    else if (cal) {
      cal.events.forEach(function (e) {
        if (e.sterne >= set.stars) block(e.ts - set.evb * 60000, e.ts + set.eva * 60000, "Termin „" + e.title + "“ (" + e.sterne + " Sterne, " + e.timeDE + " Uhr)");
      });
    }
    var s = stats(), lim = MT.parseNum(String(set.loss), true);
    var hard = false;
    if (s.n >= 2) { bump(2); hard = true; reasons.push("Tageslimit erreicht: 2 Trades."); }
    if (s.losses >= 2) { bump(2); hard = true; reasons.push("Stopp nach 2 Verlusten – Schluss für heute."); }
    if (lim && lim > 0 && s.pnl <= -lim) { bump(2); hard = true; reasons.push("Tagesverlustlimit von " + MT.num(lim, 0) + " $ erreicht."); }
    return { lvl: lvl, reasons: reasons, endMs: endMs, nextStart: nextStart, hard: hard || closed };
  }
  function renderAmpel() {
    var a = ampel(Date.now()), box = $("ampel-body");
    ampelBlocked = a.lvl === 2;
    var cls = ["gruen", "gelb", "rot"][a.lvl];
    var word = ["Ja – Fenster offen", "Vorsicht", "Nein – jetzt nicht handeln"][a.lvl];
    var key = a.lvl + "|" + a.reasons.join("|");
    var cd = "";
    if (a.lvl === 2 && a.endMs && !a.hard) cd = "Sperre endet in " + MT.countdown(a.endMs - Date.now());
    else if (a.lvl === 0 && a.nextStart) cd = "Nächste Sperre in " + MT.countdown(a.nextStart.ts - Date.now()) + " (" + a.nextStart.text + ")";
    if (box.getAttribute("data-key") !== key) {
      box.setAttribute("data-key", key);
      MT.clear(box);
      box.appendChild(h("div", { class: "lamp " + cls }, h("span", { class: "dot", "aria-hidden": "true" }), h("div", null, h("p", { class: "word", role: "status" }, word), h("p", { class: "countdown small", id: "amp-cd" }, cd))));
      if (a.reasons.length) box.appendChild(h("ul", { class: "reasons" }, a.reasons.map(function (r) { return h("li", null, r); })));
      else box.appendChild(h("p", { class: "muted small" }, "Keine Sperre aktiv. Das ersetzt die sechs Fragen nicht."));
    } else { var el = $("amp-cd"); if (el) el.textContent = cd; }
    if (checkedLevel !== ampelBlocked) { checkedLevel = ampelBlocked; renderCheckResult(); }
  }
  var checkedLevel = null;

  /* ---------- Sitzungen ---------- */
  var SESS = [
    { n: "Asien (Tokio)", tz: "Asia/Tokyo", f: "09:00", t: "15:30", main: true },
    { n: "London", tz: "Europe/London", f: "08:00", t: "16:30", main: true },
    { n: "New York gesamt", tz: NY, f: "09:30", t: "16:00", main: true },
    { n: "NY Eröffnung", tz: NY, f: "09:30", t: "10:30", sub: true },
    { n: "NY Mittagsflaute", tz: NY, f: "11:30", t: "13:30", sub: true },
    { n: "NY Schluss", tz: NY, f: "15:00", t: "16:00", sub: true }
  ];
  function intervals(def, now) {
    var base = MT.dayKey(now, def.tz), out = [];
    for (var i = -1; i <= 4; i++) {
      var k = MT.addDays(base, i), w = MT.weekday(k);
      if (w === 0 || w === 6) continue;
      out.push({ s: MT.zonedToUtc(k, def.f, def.tz), e: MT.zonedToUtc(k, def.t, def.tz) });
    }
    return out;
  }
  function renderSessions() {
    var now = Date.now(), today = MT.dayKey(now, BERLIN), box = $("sess-body");
    var rows = [], active = [], nxt = null;
    SESS.forEach(function (d) {
      var iv = intervals(d, now);
      var cur = iv.filter(function (x) { return x.s <= now && now < x.e; })[0];
      var nx = iv.filter(function (x) { return x.s > now; })[0];
      var pick = cur || nx;
      if (cur && d.main) active.push(d.n);
      if (nx && (!nxt || nx.s < nxt.s)) nxt = { s: nx.s, n: d.n };
      var dayTxt = MT.dayKey(pick.s, BERLIN) !== today ? MT.WT[MT.weekday(MT.dayKey(pick.s, BERLIN))].slice(0, 2) + " " : "";
      rows.push(h("div", { class: "session" + (cur ? " on" : ""), style: d.sub ? "padding-left:22px" : "" },
        h("span", { class: "sname" }, d.n),
        h("span", { class: "stime" }, dayTxt + MT.hm(pick.s, BERLIN) + "–" + MT.hm(pick.e, BERLIN) + " Uhr"),
        h("span", { class: "small " + (cur ? "c-long" : "muted") }, cur ? "läuft, noch " + MT.countdown(cur.e - now) : "folgt in " + MT.countdown(pick.s - now))));
    });
    MT.clear(box);
    box.appendChild(h("p", null, h("strong", null, "Jetzt: "), active.length ? active.join(" + ") : "keine Hauptsitzung (ruhige Phase)"));
    if (nxt) box.appendChild(h("p", { class: "countdown" }, nxt.n + " in " + MT.countdown(nxt.s - now)));
    box.appendChild(h("p", { class: "small muted" }, "Zeiten in deutscher Zeit, Sommerzeit je Region berücksichtigt."));
    rows.forEach(function (r) { box.appendChild(r); });
  }

  /* ---------- Lage zum Vortag / Erwartete Bewegung ---------- */
  var POS = { ueber_vortageshoch: "Über dem Vortageshoch", im_vortagesbereich: "Im Vortagesbereich", unter_vortagestief: "Unter dem Vortagestief" };
  function pts(p, nq) { return nq && MT.isNum(p) ? MT.signed(nq * p / 100, 1, " Pkt") : null; }
  function renderLage() {
    var d = snapData, L = d && d.levels, box = $("lage-body"), nq = nqPrice(), atas = atasLive();
    syncNqField();
    MT.clear(box);
    if (!L) { box.appendChild(h("p", { class: "muted" }, "Keine Level-Daten (der Worker liefert sie erst mit v2).")); return; }
    var pos = L.position ? POS[L.position] || L.position : "unbekannt";
    var cls = L.position === "ueber_vortageshoch" ? "long" : L.position === "unter_vortagestief" ? "short" : "neutral";
    box.appendChild(h("p", null, h("span", { class: "badge " + cls }, pos)));
    function row(name, price, p) {
      var pt = atas && MT.isNum(price) && nq ? MT.signed(nq - price, 1, " Pkt") : pts(p, nq);
      box.appendChild(h("div", { class: "kv" }, h("span", { class: "k" }, name + (MT.isNum(price) ? " (" + MT.num(price, 2) + ")" : "")),
        h("span", { class: "v" }, atas && pt ? pt + " · " + MT.signed(p, 2, " %") : MT.signed(p, 2, " %") + (pt ? " ≈ " + pt : ""))));
    }
    row("Vortageshoch", L.prevHigh, L.distPrevHighPct);
    row("Vortagestief", L.prevLow, L.distPrevLowPct);
    row("VWAP", L.vwap, L.distVwapPct);
    box.appendChild(h("p", { class: "small muted" }, "Abstand zum Kurs, Vorzeichen: + = Kurs über dem Level. " + (atas ? "Preise in NQ-Punkten, live aus ATAS (Kurs " + MT.num(nq, 2) + ")." : "Preise in QQQ" + (nq ? "; Punkte mit NQ " + MT.num(nq, 2) + " umgerechnet." : "; NQ-Kurs eintippen für Punkte."))));
    var g = L.gapPct;
    box.appendChild(h("div", { class: "kv" }, h("span", { class: "k" }, "Eröffnungslücke"),
      h("span", { class: "v" }, MT.isNum(g) ? (Math.abs(g) < 0.05 ? "keine nennenswerte Lücke" : (g > 0 ? "Gap-Up " : "Gap-Down ") + MT.signed(g, 2, " %")) + (pts(g, nq) ? " ≈ " + pts(g, nq) : "") : "–")));
    if (MT.isNum(L.rangeTodayPct) && MT.isNum(L.atrPct14) && L.atrPct14 > 0) {
      var share = L.rangeTodayPct / L.atrPct14 * 100, rest = L.atrPct14 - L.rangeTodayPct;
      box.appendChild(h("p", { style: "margin-top:10px" }, h("strong", null, MT.num(share, 0) + " %"), " der üblichen Tagesspanne schon gelaufen"));
      box.appendChild(h("div", { class: "bar", role: "img", "aria-label": MT.num(share, 0) + " Prozent der üblichen Tagesspanne" }, h("i", { style: "width:" + Math.min(100, share) + "%" })));
      box.appendChild(h("p", { class: "small muted" }, "Heute " + MT.num(L.rangeTodayPct, 2) + " % (" + (pts(L.rangeTodayPct, nq) || "–") + ") von üblich " + MT.num(L.atrPct14, 2) + " % (ATR 14)." + (rest > 0 ? " Noch Luft: " + MT.num(rest, 2) + " %" + (nq ? " ≈ " + MT.num(nq * rest / 100, 0) + " Pkt." : ".") : " Spanne schon über dem Üblichen.")));
    } else box.appendChild(h("p", { class: "muted small" }, "Tagesspanne gegen ATR nicht verfügbar."));
  }
  function renderErw() {
    var R = snapData && snapData.risk, box = $("erw-body"), nq = nqPrice();
    syncNqField();
    MT.clear(box);
    if (!R) { box.appendChild(h("p", { class: "muted" }, "Keine Risiko-Daten (der Worker liefert sie erst mit v2).")); return; }
    if (MT.isNum(R.expectedMovePct)) {
      box.appendChild(h("p", { class: "hero-word", style: "font-size:2rem" }, "± " + MT.num(R.expectedMovePct, 2) + " %"));
      box.appendChild(h("p", { class: "muted" }, nq ? "≈ ± " + MT.num(nq * R.expectedMovePct / 100, 0) + " NQ-Punkte (bei NQ " + MT.num(nq, 0) + ")" : "NQ-Kurs oben eintippen für Punkte."));
    } else box.appendChild(h("p", { class: "muted" }, "Erwartete Tagesbewegung nicht verfügbar."));
    if (MT.isNum(R.score)) {
      var side = R.score >= 60 ? "long" : R.score <= 40 ? "short" : "neutral";
      box.appendChild(h("p", { style: "margin-top:10px" }, h("strong", null, side === "long" ? "Risk-On" : side === "short" ? "Risk-Off" : "Neutral"), " · Score " + MT.num(R.score, 0) + " von 100" + ""));
      box.appendChild(h("div", { class: "bar" }, h("i", { class: side, style: "width:" + Math.max(2, Math.min(100, R.score)) + "%" })));
      box.appendChild(h("p", { class: "small muted" }, "Hoher Score = Risk-On (Anleger nehmen Risiko), niedriger Score = Risk-Off."));
    }
    if (R.vix && MT.isNum(R.vix.value)) box.appendChild(h("div", { class: "kv" }, h("span", { class: "k" }, "VIX" + (R.vix.date ? " (" + R.vix.date + ")" : "")), h("span", { class: "v" }, MT.num(R.vix.value, 2), MT.isNum(R.vix.changePct) ? " (" + MT.signed(R.vix.changePct, 1, " %") + ")" : "")));
    (Array.isArray(R.components) ? R.components : []).forEach(function (c) {
      box.appendChild(h("div", { class: "kv" }, h("span", { class: "k" }, c.name || "Komponente"), h("span", { class: "v" }, (function () { var sd = MT.normSide(c.side); return h("span", { class: "side " + sd }, MT.SIDE_SYM[sd] + " " + (c.side || MT.SIDE_WORD[sd])); })(), " ", MT.isNum(c.changePct) ? MT.signed(c.changePct, 2, " %") : "")));
    });
  }

  /* ---------- Risikorechner ---------- */
  var PV = { NQ: 20, MNQ: 2 };
  function calc() {
    var pv = PV[$("inst").value] || 20;
    var stop = numIn($("stop")), ctr = numIn($("ctr")), mx = numIn($("maxrisk"), true), tgt = numIn($("target"));
    MT.store.set(K.calc, { inst: $("inst").value, stop: $("stop").value, ctr: $("ctr").value, maxrisk: $("maxrisk").value, target: $("target").value });
    var o1 = $("risk-out"), o2 = $("ctr-out"), o3 = $("rr-out");
    o1.textContent = stop > 0 && ctr > 0 ? "Risiko: " + MT.num(stop * ctr * pv, 2) + " $  (" + MT.num(stop, 2) + " Pkt × " + MT.num(ctr, 0) + " × " + pv + " $)" : "Stop und Kontrakte eintippen.";
    if (stop > 0 && mx > 0) {
      var n = Math.floor(mx / (stop * pv));
      o2.textContent = n >= 1 ? "Maximal " + n + " Kontrakt" + (n === 1 ? "" : "e") + " (Risiko " + MT.num(n * stop * pv, 2) + " $)" : "Schon 1 Kontrakt überschreitet das Risiko (" + MT.num(stop * pv, 2) + " $).";
    } else o2.textContent = "Stop und maximales Risiko eintippen.";
    if (stop > 0 && tgt > 0) {
      var rr = tgt / stop;
      o3.textContent = "Chance-Risiko 1 : " + MT.num(rr, 2) + (rr < 2 ? " – unter 2:1, nicht nehmen" : " – ok (mindestens 2:1)");
      o3.className = rr < 2 ? "c-short" : "c-long";
    } else { o3.textContent = "Stop und Ziel eintippen."; o3.className = ""; }
  }

  /* ---------- Merksatz ---------- */
  var SAETZE = [
    "Der Preis läuft von Liquidität zu Liquidität.",
    "Ein Sweep ist erst ein Sweep, wenn der Preis zurück unter dem Level schließt.",
    "Zwei Schlusskurse außerhalb = Akzeptanz, kein Sweep.",
    "Viel Volumen ohne Fortschritt = jemand nimmt die Gegenseite.",
    "In der Balance handle ich die Ränder, in der Imbalance die Richtung.",
    "Außerhalb der Value Area zieht es den Preis oft zurück zum POC – wenn er abgelehnt wird.",
    "Kein Stop, kein Trade.",
    "Nach zwei Verlusten ist Schluss.",
    "Der Pfeil ist ein Hinweis, kein Einstieg."
  ];
  var shift = 0;
  function renderQuote() {
    var d = MT.diffDays("1970-01-01", nyToday());
    var i = (((d + shift) % SAETZE.length) + SAETZE.length) % SAETZE.length;
    $("quote").textContent = "„" + SAETZE[i] + "“";
    $("quote-n").textContent = (i + 1) + " von " + SAETZE.length;
  }

  /* ---------- Start ---------- */
  function bindInput(id, key) {
    var el = $(id); var s = settings();
    el.value = s[key];
    el.addEventListener("input", function () {
      var cur = MT.store.get(K.set, {}) || {};
      var v = el.value;
      cur[key] = key === "loss" ? v : (MT.parseNum(v) === null ? DEF[key] : Math.max(0, MT.parseNum(v)));
      MT.store.set(K.set, cur); renderAmpel(); renderRegeln();
    });
  }
  function init() {
    MT.startLive(function (st) {
      snapData = st.data;
      MT.clear($("cockbar"));
      $("cockbar").appendChild(MT.biasView(snapData, true));
      $("cockbar").appendChild(MT.regimeView(snapData, true));
      renderLage(); renderErw();
    });
    $("cockbar").appendChild(MT.biasView(null, true)); $("cockbar").appendChild(MT.regimeView(null, true));
    $("nq").value = MT.store.get(K.nq, "") || "";
    syncNqField();
    $("nq").addEventListener("input", function () { MT.store.set(K.nq, $("nq").value); renderLage(); renderErw(); });
    var c = MT.store.get(K.calc, null);
    if (c) { $("inst").value = c.inst || "NQ"; $("stop").value = c.stop || ""; $("ctr").value = c.ctr || ""; $("maxrisk").value = c.maxrisk || ""; $("target").value = c.target || ""; }
    ["inst", "stop", "ctr", "maxrisk", "target"].forEach(function (id) { $(id).addEventListener("input", calc); $(id).addEventListener("change", calc); });
    calc();
    bindInput("s-pre", "pre"); bindInput("s-post", "post"); bindInput("s-evb", "evb"); bindInput("s-eva", "eva"); bindInput("s-stars", "stars"); bindInput("s-loss", "loss");
    $("btn-win").addEventListener("click", function () { addTrade("W"); });
    $("btn-loss").addEventListener("click", function () { addTrade("L"); });
    $("btn-undo").addEventListener("click", function () { var cc = counters(); cc.trades.pop(); saveCounters(cc); renderRegeln(); renderAmpel(); });
    $("btn-reset-day").addEventListener("click", function () { if (confirm("Zähler für heute auf null setzen?")) { saveCounters({ day: nyToday(), trades: [] }); renderRegeln(); renderAmpel(); } });
    $("check-reset").addEventListener("click", resetChecks);
    $("q-next").addEventListener("click", function () { shift++; renderQuote(); });
    $("q-prev").addEventListener("click", function () { shift--; renderQuote(); });
    buildChecks(); renderRegeln(); renderQuote(); renderSessions(); renderAmpel(); renderLage(); renderErw();
    MT.loadCalendar().then(function (x) { cal = x; }, function (e) { calErr = e.message || "Fehler"; }).then(renderAmpel);
    MT.loadHolidays().then(function (x) { hol = x; }, function (e) { holErr = e.message || "Fehler"; }).then(renderAmpel);
    setInterval(function () { renderAmpel(); renderSessions(); }, 1000);
  }
  init();
})();
