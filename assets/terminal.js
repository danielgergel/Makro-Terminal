/* Makro-Terminal – Seite 1 */
(function () {
  "use strict";
  var h = MT.h, BERLIN = MT.TZ_BERLIN, NY = MT.TZ_NY;
  function $(id) { return document.getElementById(id); }

  var cal = null, calErr = null, hol = null, holErr = null, weekOffset = 0;
  var PROTO_KEY = "mt.protokoll.v1";
  var inputs = {}, currentEntries = [], currentLabel = null, currentDate = null;

  /* ---------- Live: Bias und Regime ---------- */
  function renderLive(state) {
    var d = state.data;
    MT.clear($("bias-slot")); $("bias-slot").appendChild(MT.biasView(d, false));
    MT.clear($("regime-slot")); $("regime-slot").appendChild(MT.regimeView(d, false));
  }

  /* ---------- Kalender ---------- */
  function renderCalendar() {
    var box = $("kal-body");
    MT.clear(box);
    if (calErr) { box.appendChild(h("p", { class: "banner warn" }, "Kalender nicht verfügbar (" + calErr + "). Die Auswertung unten funktioniert trotzdem.")); return; }
    if (!cal) { box.appendChild(h("p", { class: "muted" }, "Lade Kalender …")); return; }
    var now = Date.now();
    var today = MT.dayKey(now, BERLIN);
    var su = cal.meta.seriesUntil;
    if (su && typeof su === "object") {
      // Nur die Reihen nennen, deren veröffentlichte Termine wirklich zu Ende sind.
      var NAMEN = { cpi: "CPI", ppi: "PPI", arbeitsmarkt: "Arbeitsmarktbericht", jolts: "JOLTS", bip: "BIP", pce: "PCE",
        einzelhandel: "Einzelhandel", neubau: "Neubauverkäufe", fomc: "FOMC", claims: "Erstanträge", adp: "ADP",
        ism_industrie: "ISM Industrie", ism_dienste: "ISM Dienste", philly: "Philly Fed", verbrauchervertrauen: "Verbrauchervertrauen" };
      var aus = Object.keys(su).filter(function (k) { return su[k] < today; }).map(function (k) { return NAMEN[k] || k; });
      if (aus.length) box.appendChild(h("p", { class: "banner warn" }, "Für diese Reihen sind keine weiteren Termine hinterlegt: " + aus.join(", ") + ". Dafür das Kalender-Fenster unten nutzen."));
    } else if (cal.meta.validUntil && cal.meta.validUntil < today) {
      box.appendChild(h("p", { class: "banner warn" }, "Kalender abgelaufen (gültig bis " + cal.meta.validUntil + "). Termine können fehlen."));
    }
    var wd = MT.weekday(today);
    // Am Wochenende zählt schon die kommende Handelswoche als "diese Woche".
    var wochenende = wd === 6 || wd === 0;
    var monday = MT.addDays(today, -((wd + 6) % 7) + 7 * (weekOffset + (wochenende ? 1 : 0)));
    var days = [];
    for (var i = 0; i < 7; i++) days.push(MT.addDays(monday, i));
    $("kal-range").textContent = MT.dateDE(days[0], true).replace(/^\S+\s/, "") + " – " + MT.dateDE(days[6], true).replace(/^\S+\s/, "");
    var nxt = cal.events.filter(function (e) { return e.ts > now; })[0];
    var nb = h("div", { class: "nextev" });
    if (nxt) {
      nb.appendChild(h("p", { class: "small muted" }, "Nächster Termin"));
      nb.appendChild(h("p", null, h("strong", null, nxt.title), " · " + MT.dateDE(nxt.dayDE, true) + ", " + nxt.timeDE + " Uhr"));
      nb.appendChild(h("p", { class: "countdown", id: "cd-next", "aria-live": "off" }, MT.countdown(nxt.ts - now)));
    } else nb.appendChild(h("p", null, "Kein weiterer Termin im Kalender."));
    box.appendChild(nb);
    nextTs = nxt ? nxt.ts : null;

    days.forEach(function (day) {
      var evs = cal.events.filter(function (e) { return e.dayDE === day; });
      var dow = MT.weekday(day);
      if ((dow === 0 || dow === 6) && !evs.length) return;
      var isToday = day === today;
      var sec = h("section", { class: "day" + (isToday ? " today" : ""), "aria-label": MT.dateDE(day) });
      sec.appendChild(h("h3", null, MT.dateDE(day), isToday ? h("span", { class: "badge warn" }, "Heute") : null));
      if (!evs.length) sec.appendChild(h("p", { class: "muted small" }, "Keine Termine."));
      evs.forEach(function (e) {
        var idx = cal.events.indexOf(e);
        var past = e.ts < now;
        sec.appendChild(h("div", { class: "ev" + (past ? " past" : "") },
          h("span", { class: "time" }, e.timeDE),
          h("span", { class: "title" }, e.title, past ? h("span", { class: "muted small" }, " (vorbei)") : null),
          h("span", { class: "meta" },
            e.sterne ? MT.stars(e.sterne) : h("span", null, "keine Sterne"),
            e.quote ? h("span", null, "Trendtag-Quote " + e.quote) : null,
            e.master.length ? h("button", { class: "btn small", type: "button", onclick: function () { selectEvent(idx, true); } }, "Auswerten") : null)));
      });
      box.appendChild(sec);
    });
  }
  var nextTs = null;
  function tick() {
    var el = $("cd-next");
    if (el && nextTs) {
      var ms = nextTs - Date.now();
      if (ms <= 0) renderCalendar(); else el.textContent = MT.countdown(ms);
    }
  }

  /* ---------- Auswahl und Auswertung ---------- */
  function masterList() {
    return (window.MASTERLISTE || []).slice().sort(function (a, b) { return String(a.name).localeCompare(String(b.name), "de"); });
  }
  function buildSelect() {
    var sel = $("ev-select");
    MT.clear(sel);
    sel.appendChild(h("option", { value: "" }, "– Termin wählen –"));
    var now = Date.now(), today = MT.dayKey(now, BERLIN);
    if (cal) {
      var todays = cal.events.filter(function (e) { return e.dayDE === today; });
      var later = cal.events.filter(function (e) { return e.dayDE > today && e.dayDE <= MT.addDays(today, 14); });
      var mk = function (e) { return h("option", { value: "ev:" + cal.events.indexOf(e) }, e.dayDE.slice(8) + "." + e.dayDE.slice(5, 7) + ". " + e.timeDE + " · " + e.title); };
      if (todays.length) sel.appendChild(h("optgroup", { label: "Heute" }, todays.map(mk)));
      if (later.length) sel.appendChild(h("optgroup", { label: "Kommende Termine" }, later.map(mk)));
    }
    var ml = masterList();
    if (ml.length) sel.appendChild(h("optgroup", { label: "Alle Listen-Einträge (frei wählbar)" }, ml.map(function (e) {
      return h("option", { value: "ml:" + e.id }, e.name + " (" + (e.sterne || 0) + " ★)");
    })));
    MT.clear($("ev-chips"));
    if (cal) {
      var td = cal.events.filter(function (e) { return e.dayDE === today && e.master.length; });
      if (td.length) {
        $("ev-chips").appendChild(h("span", { class: "muted small" }, "Heute:"));
        td.forEach(function (e) {
          $("ev-chips").appendChild(h("button", { class: "btn small", type: "button", onclick: function () { selectEvent(cal.events.indexOf(e), false); } }, e.timeDE + " " + e.title));
        });
      }
    }
  }
  function selectEvent(idx, scroll) {
    var sel = $("ev-select"), val = "ev:" + idx;
    sel.value = val;
    if (sel.value !== val && cal && cal.events[idx]) {
      // Vergangene Termine stehen nicht in der Auswahlliste: bei Bedarf nachtragen.
      var e = cal.events[idx];
      sel.insertBefore(h("option", { value: val }, MT.dateDE(e.dayDE, true).replace(/^\S+\s/, "").slice(0, 6) + " " + e.timeDE + " · " + e.title + " (vorbei)"), sel.children[1] || null);
      sel.value = val;
    }
    applySelection();
    if (scroll) $("auswertung").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function preselect() {
    if (!cal) return;
    var now = Date.now(), today = MT.dayKey(now, BERLIN);
    var td = cal.events.filter(function (e) { return e.dayDE === today && e.master.length; });
    if (!td.length) return;
    var pick = td.filter(function (e) { return e.ts > now - 30 * 60000; })[0] || td[td.length - 1];
    $("ev-select").value = "ev:" + cal.events.indexOf(pick);
    applySelection();
  }
  function applySelection() {
    var v = $("ev-select").value;
    var entries = [], label = null, date = MT.dayKey(Date.now(), BERLIN), info = "";
    if (v.indexOf("ev:") === 0 && cal) {
      var e = cal.events[+v.slice(3)];
      if (e) { entries = e.master; label = e.title; date = e.dayDE; info = MT.dateDE(e.dayDE, true) + ", " + e.timeDE + " Uhr"; }
    } else if (v.indexOf("ml:") === 0) {
      var m = masterList().filter(function (x) { return x.id === v.slice(3); })[0];
      if (m) { entries = [m]; label = m.name; }
    }
    buildEval(entries, label, date, info, v !== "");
  }

  function buildEval(entries, label, date, info, chosen) {
    var body = $("eval-body");
    MT.clear(body);
    inputs = {}; currentEntries = entries; currentLabel = label; currentDate = date;
    if (!entries.length) {
      body.appendChild(h("p", { class: "muted" }, chosen ? "Zu diesem Termin gibt es keine Einträge in der Masterliste." : (window.MASTERLISTE && window.MASTERLISTE.length ? "Termin wählen, dann Ist- und Prognosewerte eintippen." : "Masterliste nicht geladen (assets/masterliste.js fehlt oder ist leer).")));
      return;
    }
    body.appendChild(h("p", { class: "small muted" }, (label || "") + (info ? " · " + info : "")));
    var refreshers = [];
    entries.forEach(function (en) {
      var st = inputs[en.id] = { ist: "", prog: "", opt: null, manual: null };
      var badge = h("span", { class: "badge", "aria-live": "polite" }, "Offen");
      var warn = h("p", { class: "small", style: "color:var(--warn);margin:4px 0 0" });
      var ctl = h("div", { class: "row" });
      var opts = Array.isArray(en.optionen) && en.optionen.length ? en.optionen : null;
      if (opts) {
        var btns = opts.map(function (o, i) {
          var b = h("button", { class: "btn", type: "button", "aria-pressed": "false", onclick: function () { st.opt = st.opt === i ? null : i; sync(); upd(); } }, o.text);
          return b;
        });
        function sync() { btns.forEach(function (b, i) { b.setAttribute("aria-pressed", st.opt === i ? "true" : "false"); }); }
        btns.forEach(function (b) { ctl.appendChild(b); });
      } else if (en.typ === "zahl") {
        ctl.className = "fields";
        ctl.style.width = "100%";
        ["ist", "prog"].forEach(function (k) {
          var id = "in-" + k + "-" + en.id;
          var inp = h("input", { type: "text", inputmode: "decimal", autocomplete: "off", id: id, placeholder: k === "ist" ? "z. B. 3,2 %" : "z. B. 3,0 %", oninput: function () { st[k] = inp.value; upd(); } });
          ctl.appendChild(h("div", { class: "field" }, h("label", { for: id }, k === "ist" ? "Ist" : "Prognose"), inp));
        });
      } else if (en.typ === "ton") {
        var tb = ["long", "short", "neutral"].map(function (s) {
          return h("button", { class: "btn " + s, type: "button", "aria-pressed": "false", "data-s": s, onclick: function () { st.manual = st.manual === s ? null : s; tb.forEach(function (b) { b.setAttribute("aria-pressed", st.manual === b.getAttribute("data-s") ? "true" : "false"); }); upd(); } }, MT.SIDE_SYM[s] + " " + MT.SIDE_WORD[s]);
        });
        tb.forEach(function (b) { ctl.appendChild(b); });
      }
      var card = h("div", { class: "entry" },
        h("div", { class: "head" }, h("strong", null, en.name), h("span", null, MT.stars(en.sterne), " ", badge)),
        en.hinweis ? h("p", { class: "small muted" }, en.hinweis) : null,
        (en.trendMin != null || en.trendMax != null) ? h("p", { class: "small muted" }, "Trendtag-Quote " + (en.trendMin === en.trendMax ? MT.num(en.trendMin, 0) : MT.num(en.trendMin, 0) + "–" + MT.num(en.trendMax, 0)) + " %") : null,
        en.typ === "inhalt" && !opts ? h("p", { class: "small" }, "Nur Hinweis, kein Urteil.") : ctl,
        warn);
      body.appendChild(card);
      function upd() {
        var u = MT.einzelurteil(en, st);
        warn.textContent = "";
        if (en.typ === "zahl" && !opts) {
          if ((st.ist && MT.parseNum(st.ist) === null) || (st.prog && MT.parseNum(st.prog) === null)) warn.textContent = "Zahl nicht lesbar (Beispiele: 3,2 – 3.2% – 215K).";
        }
        badge.className = "badge" + (u ? " " + u : "");
        badge.textContent = u ? MT.SIDE_SYM[u] + " " + MT.SIDE_WORD[u] : (en.typ === "inhalt" && !opts ? "Hinweis" : "Offen");
        refreshResult();
      }
      refreshers.push(upd);
    });
    body.appendChild(h("div", { id: "result" }));
    refreshResult();
  }

  var lastVerdict = null;
  function refreshResult() {
    var box = $("result");
    if (!box) return;
    var urteile = currentEntries.map(function (en) { return MT.einzelurteil(en, inputs[en.id]); });
    var g = MT.gesamturteil(urteile);
    lastVerdict = { g: g, urteile: urteile };
    var top = currentEntries.slice().sort(function (a, b) { return (b.sterne || 0) - (a.sterne || 0); })[0];
    var sterne = top ? top.sterne || 0 : 0;
    var q = quoteOf(currentEntries);
    MT.clear(box);
    box.className = "result " + g.typ;
    var sym = g.typ === "long" || g.typ === "short" || g.typ === "neutral" ? MT.SIDE_SYM[g.typ] + " " : "";
    box.appendChild(h("p", { class: "eyebrow" }, "Gesamturteil"));
    box.appendChild(h("p", { class: "big" }, sym + g.text));
    box.appendChild(h("p", { class: "small" }, sterne ? MT.stars(sterne) : "", q ? "  Trendtag-Quote " + q : ""));
    box.appendChild(h("p", { class: "callout" }, "Das ist die erwartete erste Reaktion laut Liste, kein Einstieg."));
    var can = g.typ !== "leer";
    box.appendChild(h("div", { class: "row", style: "margin-top:10px" },
      h("button", { class: "btn primary", type: "button", disabled: !can, onclick: saveRecord }, "Im Protokoll speichern")));
  }
  function quoteOf(list) {
    var top = list.slice().sort(function (a, b) { return (b.sterne || 0) - (a.sterne || 0); })[0];
    if (!top || (top.trendMin == null && top.trendMax == null)) return null;
    var lo = top.trendMin == null ? top.trendMax : top.trendMin, hi = top.trendMax == null ? top.trendMin : top.trendMax;
    return lo === hi ? MT.num(lo, 0) + " %" : MT.num(lo, 0) + "–" + MT.num(hi, 0) + " %";
  }

  /* ---------- Protokoll ---------- */
  function loadProto() { var p = MT.store.get(PROTO_KEY, []); return Array.isArray(p) ? p : []; }
  function saveProto(p) { if (!MT.store.set(PROTO_KEY, p)) alert("Speichern im Browser nicht möglich (Speicher gesperrt?)."); }
  function saveRecord() {
    if (!lastVerdict || lastVerdict.g.typ === "leer") return;
    var top = currentEntries.slice().sort(function (a, b) { return (b.sterne || 0) - (a.sterne || 0); })[0];
    var details = currentEntries.map(function (en, i) {
      var st = inputs[en.id] || {};
      var o = Array.isArray(en.optionen) && en.optionen.length && st.opt != null ? en.optionen[st.opt].text : "";
      return en.name + ": " + (lastVerdict.urteile[i] ? MT.SIDE_WORD[lastVerdict.urteile[i]] : "offen") + (st.ist || st.prog ? " (Ist " + (st.ist || "?") + ", Prognose " + (st.prog || "?") + ")" : "") + (o ? " (" + o + ")" : "");
    });
    var p = loadProto();
    p.unshift({ id: Date.now() + "-" + Math.floor(Math.random() * 1e4), savedAt: new Date().toISOString(), date: currentDate, title: currentLabel || "Termin", urteil: lastVerdict.g.typ, sterne: top ? top.sterne || 0 : 0, quote: quoteOf(currentEntries) || "", details: details, nq: null });
    saveProto(p);
    renderProto();
  }
  var NQ_WORD = { long: "Long", short: "Short", seitwaerts: "Seitwärts" };
  var URT_WORD = { long: "Long", short: "Short", neutral: "Neutral", gemischt: "Gemischt" };
  function renderProto() {
    var box = $("proto-body");
    MT.clear(box);
    var p = loadProto();
    if (!p.length) { box.appendChild(h("p", { class: "muted" }, "Noch nichts gespeichert. Nach einer Auswertung auf „Im Protokoll speichern“ tippen.")); $("proto-actions").hidden = true; return; }
    $("proto-actions").hidden = false;
    /* Trefferquote je Termin */
    var stats = {};
    p.forEach(function (r) {
      var s = stats[r.title] || (stats[r.title] = { n: 0, hit: 0, open: 0 });
      if (r.urteil === "long" || r.urteil === "short") { if (r.nq) { s.n++; if (r.nq === r.urteil) s.hit++; } else s.open++; }
    });
    var names = Object.keys(stats).filter(function (k) { return stats[k].n || stats[k].open; });
    if (names.length) {
      var sb = h("div", { class: "result", style: "margin-top:0" }, h("p", { class: "eyebrow" }, "Trefferquote je Termin (nur Long/Short-Urteile)"));
      names.forEach(function (k) {
        var s = stats[k];
        sb.appendChild(h("div", { class: "stat" }, h("span", null, k), h("span", { class: "num" }, s.n ? s.hit + " von " + s.n + " (" + MT.num(100 * s.hit / s.n, 0) + " %)" : "noch keine Auswertung", s.open ? " · " + s.open + " offen" : "")));
      });
      box.appendChild(sb);
    }
    p.forEach(function (r) {
      var item = h("div", { class: "logitem" },
        h("div", { class: "head row", style: "justify-content:space-between" },
          h("strong", null, r.title), h("span", { class: "badge " + (r.urteil === "long" || r.urteil === "short" || r.urteil === "neutral" ? r.urteil : "warn") }, (MT.SIDE_SYM[r.urteil] ? MT.SIDE_SYM[r.urteil] + " " : "") + (URT_WORD[r.urteil] || r.urteil))),
        h("p", { class: "small muted" }, MT.dateDE(r.date, true) + " · " + (r.sterne ? r.sterne + " Sterne" : "ohne Sterne") + (r.quote ? " · Trendtag-Quote " + r.quote : "")),
        h("p", { class: "small" }, (r.details || []).join(" | ")),
        h("p", { class: "small muted", style: "margin-top:8px" }, "Was hat NQ gemacht?"));
      var row = h("div", { class: "row" });
      ["long", "short", "seitwaerts"].forEach(function (k) {
        row.appendChild(h("button", { class: "btn " + (k === "seitwaerts" ? "" : k), type: "button", "aria-pressed": r.nq === k ? "true" : "false", onclick: function () {
          var all = loadProto(); var t = all.filter(function (x) { return x.id === r.id; })[0];
          if (t) { t.nq = t.nq === k ? null : k; saveProto(all); renderProto(); }
        } }, NQ_WORD[k]));
      });
      row.appendChild(h("button", { class: "btn danger small", type: "button", onclick: function () {
        if (!confirm("Diesen Protokolleintrag löschen?")) return;
        saveProto(loadProto().filter(function (x) { return x.id !== r.id; })); renderProto();
      } }, "Löschen"));
      item.appendChild(row);
      box.appendChild(item);
    });
  }
  function csvEsc(v) { v = String(v === null || v === undefined ? "" : v); return /[;"\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function exportCsv() {
    var rows = [["Gespeichert", "Datum", "Termin", "Urteil", "Sterne", "Trendtag-Quote", "NQ-Reaktion", "Details"]];
    loadProto().forEach(function (r) {
      rows.push([r.savedAt, r.date, r.title, URT_WORD[r.urteil] || r.urteil, r.sterne, r.quote, r.nq ? NQ_WORD[r.nq] : "", (r.details || []).join(" | ")]);
    });
    var csv = "﻿" + rows.map(function (r) { return r.map(csvEsc).join(";"); }).join("\r\n");
    var a = h("a", { href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })), download: "makro-protokoll.csv" });
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ---------- Feiertage ---------- */
  function renderHolidays() {
    var box = $("hol-body");
    MT.clear(box);
    if (holErr) { box.appendChild(h("p", { class: "banner warn" }, "Feiertage nicht verfügbar (" + holErr + ").")); return; }
    if (!hol) { box.appendChild(h("p", { class: "muted" }, "Lade Feiertage …")); return; }
    var today = MT.dayKey(Date.now(), NY);
    var up = hol.filter(function (x) { return x.date >= today; });
    if (!up.length) { box.appendChild(h("p", { class: "muted" }, "Keine kommenden Feiertage in der Datei.")); return; }
    function when(x) { var n = MT.diffDays(today, x.date); return n === 0 ? "heute" : n === 1 ? "morgen" : "in " + n + " Tagen"; }
    function status(x) { return x.status === "verkuerzt" ? "verkürzter Handel" : "Börse geschlossen"; }
    var n0 = up[0], dn = MT.diffDays(today, n0.date);
    if (dn <= 1) box.appendChild(h("p", { class: "banner warn", role: "alert" }, h("strong", null, "Achtung: "), n0.name + " " + when(n0) + " – " + status(n0) + "."));
    box.appendChild(h("div", { class: "nextev" },
      h("p", { class: "small muted" }, "Nächster Börsenfeiertag"),
      h("p", null, h("strong", null, n0.name), " · " + MT.dateDE(n0.date)),
      h("p", { class: "countdown" }, when(n0)),
      h("p", { class: "small" }, status(n0) + (n0.note ? " – " + n0.note : ""))));
    up.slice(1, 9).forEach(function (x) {
      box.appendChild(h("div", { class: "kv" }, h("span", { class: "k" }, MT.dateDE(x.date, true) + " · " + x.name), h("span", { class: "v" }, when(x) + " · " + status(x))));
    });
  }

  /* ---------- Start ---------- */
  function init() {
    MT.startLive(renderLive);
    renderLive(MT.state);
    $("week-prev").addEventListener("click", function () { weekOffset = 0; renderCalendar(); setWeekBtns(); });
    $("week-next").addEventListener("click", function () { weekOffset = 1; renderCalendar(); setWeekBtns(); });
    function setWeekBtns() { $("week-prev").setAttribute("aria-pressed", weekOffset === 0 ? "true" : "false"); $("week-next").setAttribute("aria-pressed", weekOffset === 1 ? "true" : "false"); }
    setWeekBtns();
    $("ev-select").addEventListener("change", applySelection);
    $("proto-csv").addEventListener("click", exportCsv);
    $("proto-clear").addEventListener("click", function () {
      if (!loadProto().length) return;
      if (confirm("Das gesamte Protokoll unwiderruflich löschen?")) { saveProto([]); renderProto(); }
    });
    var wd = $("widget");
    wd.addEventListener("toggle", function () {
      var slot = $("widget-slot");
      if (wd.open && !slot.firstChild) {
        var src = MT.cfg.widgetSrc;
        if (!src) { slot.appendChild(h("p", { class: "muted", style: "padding:12px" }, "Kein Widget konfiguriert (widgetSrc in config.js).")); return; }
        slot.appendChild(h("iframe", { src: src, title: "Investing.com Wirtschaftskalender", loading: "lazy", referrerpolicy: "no-referrer" }));
      }
    });
    renderCalendar(); renderHolidays(); renderProto(); buildSelect(); applySelection();
    MT.loadCalendar().then(function (c) { cal = c; }, function (e) { calErr = e.message || "Fehler"; })
      .then(function () { renderCalendar(); buildSelect(); preselect(); });
    MT.loadHolidays().then(function (x) { hol = x; }, function (e) { holErr = e.message || "Fehler"; })
      .then(renderHolidays);
    setInterval(tick, 1000);
    setInterval(function () { renderCalendar(); renderHolidays(); }, 60000);
  }
  init();
})();
