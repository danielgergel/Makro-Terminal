/* Makro-Terminal – gemeinsame Funktionen (Zeit, Format, Daten, Bias/Regime-Anzeige) */
var MT = (function (root) {
  "use strict";
  var CFG = root.MAKRO_CONFIG || {};
  var TZ_BERLIN = "Europe/Berlin";
  var TZ_NY = "America/New_York";
  var HAS_DOM = typeof document !== "undefined";
  var ROOT_URL = "";
  try {
    if (HAS_DOM && document.currentScript && document.currentScript.src) {
      ROOT_URL = new URL("../", document.currentScript.src).href;
    }
  } catch (e) { ROOT_URL = ""; }
  var SEARCH = (root.location && root.location.search) || "";
  var MOCK_M = /(^|[?&])mock=(1|bridge)(&|$)/.exec(SEARCH);
  var MOCK = !!MOCK_M;
  var MOCK_KIND = MOCK_M ? MOCK_M[2] : "";   /* "1" = QQQ-Testdaten, "bridge" = ATAS-Testdaten */

  /* ---------- kleine Helfer ---------- */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? "" : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { append(el, x); });
    else if (c.nodeType) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  var store = {
    get: function (k, def) {
      try { var v = root.localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch (e) { return def; }
    },
    set: function (k, v) {
      try { root.localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
    }
  };

  /* ---------- Zahlenformat (deutsch) ---------- */
  var nfCache = {};
  function nf(d) {
    if (!nfCache[d]) nfCache[d] = new Intl.NumberFormat("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
    return nfCache[d];
  }
  function isNum(n) { return typeof n === "number" && isFinite(n); }
  function num(n, d) { return isNum(n) ? nf(d === undefined ? 2 : d).format(n) : "–"; }
  function signed(n, d, unit) {
    if (!isNum(n)) return "–";
    var s = nf(d === undefined ? 2 : d).format(n);
    if (n > 0 && s.charAt(0) !== "+") s = "+" + s;
    return s + (unit || "");
  }
  function pct(n, d, withSign) { return withSign ? signed(n, d === undefined ? 2 : d, " %") : (isNum(n) ? num(n, d === undefined ? 2 : d) + " %" : "–"); }

  /* ---------- Zeit ---------- */
  var dtfCache = {};
  function dtf(tz) {
    if (!dtfCache[tz]) {
      dtfCache[tz] = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit"
      });
    }
    return dtfCache[tz];
  }
  function parts(ts, tz) {
    var p = {};
    dtf(tz).formatToParts(new Date(ts)).forEach(function (x) { p[x.type] = x.value; });
    return { y: +p.year, mo: +p.month, d: +p.day, h: (+p.hour) % 24, mi: +p.minute, s: +p.second };
  }
  function tzOffset(ts, tz) {
    var p = parts(ts, tz);
    return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ts / 1000) * 1000;
  }
  /* Wanduhrzeit einer Zeitzone -> UTC-Millisekunden (korrekt über Sommerzeitwechsel) */
  function zonedToUtc(dateStr, timeStr, tz) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ""));
    var t = /^(\d{1,2}):(\d{2})$/.exec(String(timeStr || ""));
    if (!m || !t) return NaN;
    var guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +t[1], +t[2]);
    var off = tzOffset(guess, tz);
    var ts = guess - off;
    var off2 = tzOffset(ts, tz);
    if (off2 !== off) ts = guess - off2;
    return ts;
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function dayKey(ts, tz) { var p = parts(ts, tz); return p.y + "-" + pad(p.mo) + "-" + pad(p.d); }
  function hm(ts, tz) { var p = parts(ts, tz); return pad(p.h) + ":" + pad(p.mi); }
  function addDays(key, n) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n));
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }
  function weekday(key) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key); return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay(); }
  function diffDays(a, b) {
    var ma = /^(\d{4})-(\d{2})-(\d{2})$/.exec(a), mb = /^(\d{4})-(\d{2})-(\d{2})$/.exec(b);
    return Math.round((Date.UTC(+mb[1], +mb[2] - 1, +mb[3]) - Date.UTC(+ma[1], +ma[2] - 1, +ma[3])) / 86400000);
  }
  var WT = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  var WT_KURZ = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  function dateDE(key, kurz) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || "");
    if (!m) return "–";
    return (kurz ? WT_KURZ : WT)[weekday(key)] + ", " + m[3] + "." + m[2] + "." + m[1];
  }
  function countdown(ms) {
    if (!isFinite(ms)) return "–";
    if (ms < 0) ms = 0;
    var s = Math.floor(ms / 1000);
    var d = Math.floor(s / 86400); s -= d * 86400;
    var hh = Math.floor(s / 3600); s -= hh * 3600;
    var mm = Math.floor(s / 60); s -= mm * 60;
    return (d ? d + " T " : "") + pad(hh) + ":" + pad(mm) + ":" + pad(s);
  }
  function ageText(sec) {
    if (!isFinite(sec)) return "unbekannt";
    sec = Math.max(0, Math.round(sec));
    if (sec < 120) return "vor " + sec + " s";
    var m = Math.floor(sec / 60), s = sec % 60;
    if (m < 60) return "vor " + m + " min " + pad(s) + " s";
    return "vor " + Math.floor(m / 60) + " h " + pad(m % 60) + " min";
  }

  /* ---------- Seiten (Long/Short/Neutral) ---------- */
  function normSide(s) {
    s = String(s === null || s === undefined ? "" : s).toLowerCase();
    if (/short|bear|risk.?off|verkauf|abw[aä]rts|tief/.test(s)) return "short";
    if (/long|bull|risk.?on|kauf|aufw[aä]rts|hoch/.test(s)) return "long";
    return "neutral";
  }
  var SIDE_WORD = { long: "Long", short: "Short", neutral: "Neutral" };
  var SIDE_SYM = { long: "▲", short: "▼", neutral: "●" };
  function sideBadge(side, extra) {
    return h("span", { class: "side " + side }, SIDE_SYM[side] + " " + SIDE_WORD[side] + (extra || ""));
  }
  function stars(n) {
    n = Math.max(0, Math.min(5, Math.round(n || 0)));
    return h("span", { class: "stars", role: "img", "aria-label": n + " von 5 Sternen" }, "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n));
  }

  /* ---------- Zahlen aus Texten (Ist / Prognose) ---------- */
  function parseNum(str, ganzzahlig) {
    if (str === null || str === undefined) return null;
    var s = String(str).trim().replace(/−/g, "-").replace(/\s+/g, "");
    if (!s) return null;
    var mult = 1;
    var m = /([kmbt])$/i.exec(s.replace(/%$/, ""));
    s = s.replace(/%/g, "");
    if (m) {
      mult = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[m[1].toLowerCase()];
      s = s.slice(0, s.length - 1);
    }
    s = s.replace(/^\+/, "");
    if (!/^-?[\d.,]+$/.test(s)) return null;
    /* Geldbeträge/Kurse: "21.350" ist 21350 (Punkt = Tausendertrenner) */
    if (ganzzahlig && /^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
    var lc = s.lastIndexOf(","), ld = s.lastIndexOf(".");
    if (lc >= 0 && ld >= 0) {
      if (lc > ld) s = s.replace(/\./g, "").replace(",", ".");
      else s = s.replace(/,/g, "");
    } else if (lc >= 0) {
      if ((s.match(/,/g) || []).length > 1) s = s.replace(/,/g, "");
      else s = s.replace(",", ".");
    } else if ((s.match(/\./g) || []).length > 1) {
      s = s.replace(/\./g, "");
    }
    var v = parseFloat(s);
    return isFinite(v) ? v * mult : null;
  }

  /* Einzelurteil: 'long' | 'short' | 'neutral' | null (kein Urteil möglich) */
  function einzelurteil(entry, st) {
    st = st || {};
    var opts = entry && Array.isArray(entry.optionen) && entry.optionen.length ? entry.optionen : null;
    if (opts) {
      var o = opts[st.opt];
      return o ? normSide(o.ergebnis) : null;
    }
    if (entry.typ === "zahl") {
      var ist = parseNum(st.ist), prog = parseNum(st.prog);
      if (ist === null || prog === null) return null;
      var eps = Math.max(Math.abs(ist), Math.abs(prog), 1) * 1e-9;
      if (Math.abs(ist - prog) <= eps) return "neutral";
      var hoeher = ist > prog;
      if (entry.regel === "hoeher_long") return hoeher ? "long" : "short";
      /* hoeher_short und dovish_long (höher = restriktiver): höher -> Short */
      return hoeher ? "short" : "long";
    }
    if (entry.typ === "ton") return st.manual ? normSide(st.manual) : null;
    return null; /* inhalt */
  }
  function gesamturteil(urteile) {
    var l = urteile.filter(function (u) { return u === "long" || u === "short" || u === "neutral"; });
    if (!l.length) return { typ: "leer", text: "Noch keine Eingabe" };
    var first = l[0];
    if (l.every(function (u) { return u === first; })) {
      return { typ: first, text: first === "long" ? "Long" : first === "short" ? "Short" : "Neutral" };
    }
    return { typ: "gemischt", text: "Gemischt – Reaktion abwarten" };
  }

  /* ---------- Daten laden ---------- */
  function url(path) { return (ROOT_URL || "") + path; }
  function fetchJSON(u, timeoutMs) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 10000) : null;
    return fetch(u, { cache: "no-store", signal: ctrl ? ctrl.signal : undefined }).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }, function (e) { if (timer) clearTimeout(timer); throw e; });
  }
  function normalizeLegacy(d) {
    d = d || {};
    var b = (d.bias && d.bias.nq) || null;
    var p = (d.phase && d.phase.nq) || null;
    var out = { version: 1, legacy: true, generatedAt: d.generatedAt || d.asOf || d.updatedAt || null };
    if (b) {
      out.bias = {
        label: b.label || null, score: null, confidence: null, summary: null,
        factors: (Array.isArray(b.chips) ? b.chips : []).map(function (c) { return { name: c.name, side: c.side, detail: c.note }; })
      };
    }
    if (p && p.label) {
      var lab = String(p.label);
      var low = lab.toLowerCase();
      var reg = { label: null, direction: null, text: null, rawLabel: lab };
      if (/range|balance/.test(low)) reg.label = "Balance";
      else if (/trend|imbalance/.test(low)) { reg.label = "Imbalance"; reg.direction = /short/.test(low) ? "Short" : /long/.test(low) ? "Long" : null; }
      out.regime = reg;
    }
    return out;
  }
  function loadSnapshot() {
    if (MOCK) {
      return fetchJSON(url(MOCK_KIND === "bridge" ? "data/mock-bridge-snapshot.json" : "data/mock-snapshot.json")).then(function (d) {
        var now = Date.now();
        var agoMs = MOCK_KIND === "bridge" ? 4000 : 9000;
        d.generatedAt = new Date(now - agoMs).toISOString();
        if (d.market) { d.market.ageSeconds = Math.round(agoMs / 1000); d.market.lastTime = new Date(now - agoMs).toISOString(); }
        return { kind: "mock", data: d };
      });
    }
    var base = (CFG.apiBase || "").replace(/\/+$/, "");
    if (!base) return Promise.reject(new Error("apiBase fehlt in config.js"));
    return fetchJSON(base + "/api/v2/snapshot").then(function (d) {
      if (!d || typeof d !== "object" || (d.version !== 2 && !d.bias && !d.regime)) throw new Error("v2 unbrauchbar");
      return { kind: "v2", data: d };
    }).catch(function () {
      return fetchJSON(base + "/api/snapshot").then(function (d) { return { kind: "legacy", data: normalizeLegacy(d) }; });
    });
  }

  /* ---------- Live-Zustand ---------- */
  var state = { kind: null, data: null, fetchedAt: null, error: null, loading: false, mock: MOCK, mockKind: MOCK_KIND, seenAtas: false, lastTry: 0 };
  var POLL_MS = 30000, POLL_ATAS_MS = 10000;
  function isAtas(d) { return !!(d && d.market && d.market.source === "atas"); }
  var listeners = [];
  var lastBanner = null;
  function doLoad() {
    if (state.loading) return Promise.resolve();
    state.loading = true;
    state.lastTry = Date.now();
    return loadSnapshot().then(function (r) {
      state.kind = r.kind; state.data = r.data; state.fetchedAt = Date.now(); state.error = null;
      if (isAtas(r.data)) state.seenAtas = true;
    }).catch(function (e) {
      state.error = (e && e.message) || "Fehler";
    }).then(function () {
      state.loading = false;
      updateStatus();
      listeners.forEach(function (fn) { try { fn(state); } catch (e) { if (root.console) console.error(e); } });
    });
  }
  function startLive(cb) {
    if (cb) listeners.push(cb);
    doLoad();
    /* Takt: 10 s solange ATAS-Daten kommen, sonst 30 s (wechselt von selbst mit der Quelle) */
    setInterval(function () {
      if (document.hidden) return;
      if (Date.now() - state.lastTry >= (isAtas(state.data) ? POLL_ATAS_MS : POLL_MS) - 500) doLoad();
    }, 2000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) doLoad(); });
    var btn = document.getElementById("refresh");
    if (btn) btn.addEventListener("click", function () { doLoad(); });
    setInterval(updateStatus, 1000);
    document.querySelectorAll("a[data-nav]").forEach(function (a) { if (MOCK) a.setAttribute("href", a.getAttribute("href") + "?mock=" + MOCK_KIND); });
  }
  function dataAgeSec() {
    var d = state.data;
    var g = d && d.generatedAt ? Date.parse(d.generatedAt) : NaN;
    var ref = isNaN(g) ? state.fetchedAt : g;
    return ref ? Math.max(0, (Date.now() - ref) / 1000) : NaN;
  }
  var SESSION_TEXT = {
    vorboerse: "Vorbörse (erweiterte Handelszeit)", regulaer: "reguläre Handelszeit",
    nachboerse: "Nachbörse (erweiterte Handelszeit)", geschlossen: "Börse geschlossen"
  };
  function updateStatus() {
    var st = document.getElementById("stand");
    var px = document.getElementById("proxy");
    var bn = document.getElementById("banner");
    var d = state.data;
    var age = dataAgeSec();
    if (st) {
      if (!d) st.textContent = state.loading || !state.error ? "Lade Daten …" : "Keine Daten";
      else st.textContent = "Stand " + ageText(age) + (state.mock ? " (Testdaten)" : "");
    }
    if (px) {
      var m = d && d.market;
      if (m) {
        var bits = isAtas(d) ? ["NQ live aus ATAS"] : ["Proxy " + (m.proxy || "QQQ") + " statt NQ"];
        if (isAtas(d) && m.instrument) bits.push(m.instrument);
        if (SESSION_TEXT[m.session]) bits.push(SESSION_TEXT[m.session]);
        else if (m.extendedHours) bits.push("erweiterte Handelszeit");
        if (isNum(m.lastPrice)) bits.push("Kurs " + num(m.lastPrice, 2));
        px.textContent = bits.join(" · ");
      } else px.textContent = d && d.legacy ? "Proxy QQQ statt NQ" : "";
    }
    if (bn) {
      var items = [], level = "";
      if (state.error) { level = "err"; items.push(d ? "Verbindung fehlgeschlagen (" + state.error + "). Angezeigt werden die letzten Daten, " + ageText(age) + "." : "Daten konnten nicht geladen werden (" + state.error + ")."); }
      if (d) {
        var mk = d.market || {};
        if (state.kind === "legacy") { level = level || "warn"; items.push("Alter Datenstand, Worker noch nicht aktualisiert. Nur Bias und Marktphase verfügbar."); }
        if (state.mock) { level = level || "info"; items.push("Testdaten (?mock=" + MOCK_KIND + ") – keine Live-Daten."); }
        if (age > 300) { level = level === "err" ? level : "warn"; items.push("Daten älter als 5 Minuten – nicht blind darauf handeln."); }
        if (mk.stale === true || (isNum(mk.ageSeconds) && mk.ageSeconds > 300)) {
          if (mk.session === "geschlossen") { level = level || "info"; items.push("Börse geschlossen – letzter Kurs ist nicht aktuell."); }
          else { level = level === "err" ? level : "warn"; items.push("Kurs veraltet (stale)" + (isNum(mk.ageSeconds) ? ", letzter Kurs " + ageText(mk.ageSeconds) : "") + "."); }
        }
        if (state.seenAtas && !isAtas(d) && state.kind === "v2") { level = level || "info"; items.push("ATAS-Brücke sendet nicht – Anzeige läuft auf QQQ-Ersatzdaten."); }
        if (d.diagnostics && Array.isArray(d.diagnostics.errors) && d.diagnostics.errors.length) {
          level = level || "warn"; items.push("Worker meldet Fehler: " + d.diagnostics.errors.slice(0, 3).map(function (e) { return typeof e === "string" ? e : JSON.stringify(e); }).join("; "));
        }
      }
      var key = level + "|" + items.join("|");
      if (key !== lastBanner) {
        lastBanner = key;
        clear(bn);
        bn.className = "banner" + (level ? " " + level : "");
        bn.setAttribute("role", level === "err" || level === "warn" ? "alert" : "status");
        items.forEach(function (t, i) { bn.appendChild(h("p", { class: i ? "small" : "" }, i === 0 && level !== "info" ? h("strong", null, level === "err" ? "Achtung: " : "Warnung: ") : null, t)); });
      }
    }
  }

  /* ---------- Bias / Regime anzeigen ---------- */
  var NEUTRAL_SATZ = "Kein Bias: nur an Leveln handeln, beide Richtungen möglich.";
  var REGIME_TEXT = {
    Balance: {
      was: "Balance: Der Markt pendelt in einer Spanne, beide Seiten sind im Gleichgewicht.",
      trade: "Typisch handelbar: Sweeps an den Rändern zurück zur Mitte."
    },
    Imbalance: {
      was: "Imbalance: Eine Seite dominiert, der Markt läuft gerichtet (Trendphase).",
      trade: "Typisch handelbar: mit dem Trend, Rückläufer kaufen/verkaufen, keine Gegenrichtung ohne Strukturbruch."
    }
  };
  // Texte vom Worker lesbar machen: Umlaute und deutsches Dezimalkomma.
  function schoen(t) {
    if (typeof t !== "string") return t;
    return t.replace(/ueber/g, "über").replace(/hoehere/g, "höhere").replace(/verfuegbar/g, "verfügbar")
      .replace(/\bfuer\b/g, "für").replace(/bestaetigt/g, "bestätigt").replace(/(\d)\.(\d)/g, "$1,$2");
  }
  // Markt gerade nicht im regulären Handel? Dann sind Bias und Regime Werte vom letzten Handelstag.
  function ausserHandel(d) {
    var m = d && d.market;
    if (isAtas(d)) return m.session === "geschlossen";   /* ATAS liefert rund um die Uhr */
    return !!(m && m.session && m.session !== "regulaer");
  }
  function biasView(d, compact) {
    var b = d && d.bias;
    var side = b && b.label ? normSide(b.label) : "neutral";
    var known = !!(b && b.label);
    var cls = "card hero " + (known ? side : "neutral") + (compact ? " compact" : "");
    var word = known ? SIDE_WORD[side] : "Keine Daten";
    var sub = [];
    if (b && b.confidence) sub.push("Sicherheit: " + b.confidence);
    if (b && isNum(b.score)) sub.push("Score " + signed(b.score, 0) + " von ±4");
    var node = h("section", { class: cls, "aria-label": "Bias" },
      h("p", { class: "eyebrow" }, compact ? "Bias" : "1 · Bias"),
      h("p", { class: "hero-word" }, known ? SIDE_SYM[side] + " " + word : word),
      sub.length ? h("p", { class: "hero-sub" }, sub.join(" · ")) : null);
    if (known && ausserHandel(d)) {
      node.appendChild(h("p", { class: "callout" }, h("b", null, "Stand vom letzten Handelstag. "),
        compact ? "Gilt erst ab 15:30 Uhr neu." : "Die Börse ist gerade nicht im regulären Handel. Dieser Bias ist nur eine Vorab-Tendenz und wird erst nach der Eröffnung um 15:30 Uhr mit heutigen Daten neu berechnet."));
    }
    if (compact) return node;
    if (known && side === "neutral") node.appendChild(h("p", { class: "callout" }, h("b", null, "Neutral. "), NEUTRAL_SATZ));
    if (b && b.summary) node.appendChild(h("p", { class: "sentence" }, schoen(b.summary)));
    var f = b && Array.isArray(b.factors) ? b.factors : [];
    if (f.length) {
      node.appendChild(h("ul", { class: "factors" }, f.map(function (x) {
        var sd = normSide(x.side);
        return h("li", null, sideBadge(sd), h("span", { class: "fname" }, x.name || x.key || "Faktor"), x.detail ? h("span", { class: "detail" }, schoen(x.detail)) : null);
      })));
    } else if (known) node.appendChild(h("p", { class: "muted small" }, "Keine Einzelfaktoren geliefert."));
    return node;
  }
  function regimeView(d, compact) {
    var r = d && d.regime;
    var mk = d && d.market;
    // Ohne frische Kerzen gibt es keine Einordnung: nicht "Balance" behaupten.
    if (r && r.label && mk && !d.legacy && (mk.session === "geschlossen" || (ausserHandel(d) && isNum(mk.ageSeconds) && mk.ageSeconds > 1800))) {
      var zu = h("section", { class: "card hero regime neutral" + (compact ? " compact" : ""), "aria-label": "Trend oder Range" },
        h("p", { class: "eyebrow" }, compact ? "Regime" : "2 · Trend oder Range"),
        h("p", { class: "hero-word" }, "Keine Einordnung"),
        h("p", { class: "hero-sub" }, "Markt geschlossen"));
      if (!compact) zu.appendChild(h("p", { class: "sentence" }, "Trend oder Range lässt sich nur im laufenden Handel bestimmen. Die Anzeige startet nach der Eröffnung um 15:30 Uhr, sobald genug Kerzen da sind."));
      return zu;
    }
    var known = !!(r && r.label);
    var dir = r && r.direction ? normSide(r.direction) : null;
    var kind = known ? (r.label === "Balance" ? "neutral" : dir || "neutral") : "neutral";
    var word = known ? r.label : (r && r.rawLabel ? r.rawLabel : "Keine Daten");
    if (known && r.label === "Imbalance" && dir && dir !== "neutral") word += " · " + SIDE_WORD[dir];
    var node = h("section", { class: "card hero regime " + kind + (compact ? " compact" : ""), "aria-label": "Trend oder Range" },
      h("p", { class: "eyebrow" }, compact ? "Regime" : "2 · Trend oder Range"),
      h("p", { class: "hero-word" }, (known && r.label === "Imbalance" && dir && dir !== "neutral" ? SIDE_SYM[dir] + " " : "") + word));
    if (compact) return node;
    var sub = [];
    if (known) sub.push(r.label === "Balance" ? "Range" : "Trend");
    if (r && isNum(r.efficiency)) sub.push("Effizienz " + num(r.efficiency * 100, 0) + " %");
    if (r && r.timeframe) sub.push(r.timeframe);
    if (r && r.since) { var t = Date.parse(r.since); if (!isNaN(t)) sub.push("seit " + hm(t, TZ_BERLIN) + " Uhr"); }
    if (sub.length) node.appendChild(h("p", { class: "hero-sub" }, sub.join(" · ")));
    if (known) {
      var tx = REGIME_TEXT[r.label];
      node.appendChild(h("p", { class: "sentence" }, r.text || (tx ? tx.was : "")));
      if (r.detail) node.appendChild(h("p", { class: "muted small" }, schoen(r.detail)));
      if (tx) node.appendChild(h("p", { class: "callout" }, h("b", null, "Was man hier handelt. "), tx.trade));
      if (r.label === "Imbalance" && dir && dir !== "neutral") node.appendChild(h("p", { class: "small muted" }, "Richtung: " + SIDE_WORD[dir] + (dir === "long" ? " – Rückläufer kaufen." : " – Rückläufer verkaufen.")));
    } else if (r && r.rawLabel) {
      node.appendChild(h("p", { class: "sentence" }, "Marktphase laut altem Worker: " + r.rawLabel));
    } else node.appendChild(h("p", { class: "muted" }, "Keine Marktphase geliefert."));
    return node;
  }

  /* ---------- Kalender / Masterliste / Feiertage ---------- */
  function masterById() {
    var m = {};
    (root.MASTERLISTE || []).forEach(function (e) { if (e && e.id) m[e.id] = e; });
    return m;
  }
  function masterFor(ev) {
    var map = masterById();
    var ids = root.KALENDER_GRUPPEN && root.KALENDER_GRUPPEN[ev.id];
    var list = Array.isArray(ids) ? ids.map(function (i) { return map[i]; }).filter(Boolean) : [];
    if (!list.length && map[ev.id]) list = [map[ev.id]];
    return list;
  }
  function evStars(list) { return list.reduce(function (a, e) { return Math.max(a, e.sterne || 0); }, 0); }
  function evQuote(list) {
    if (!list.length) return null;
    var top = list.slice().sort(function (a, b) { return (b.sterne || 0) - (a.sterne || 0); })[0];
    if (!isNum(top.trendMin) && !isNum(top.trendMax)) return null;
    var lo = isNum(top.trendMin) ? top.trendMin : top.trendMax, hi = isNum(top.trendMax) ? top.trendMax : top.trendMin;
    return lo === hi ? num(lo, 0) + " %" : num(lo, 0) + "–" + num(hi, 0) + " %";
  }
  function loadCalendar() {
    return fetchJSON(url("data/kalender.json")).then(function (d) {
      var evs = (d && Array.isArray(d.events) ? d.events : []).map(function (e) {
        var ts = zonedToUtc(e.date, e.timeET, TZ_NY);
        if (isNaN(ts)) return null;
        var list = masterFor(e);
        return {
          raw: e, id: e.id, title: e.title || e.id || "Termin", source: e.source, regel: e.regel, ts: ts,
          dayDE: dayKey(ts, TZ_BERLIN), timeDE: hm(ts, TZ_BERLIN), master: list, sterne: evStars(list), quote: evQuote(list)
        };
      }).filter(Boolean).sort(function (a, b) { return a.ts - b.ts; });
      return { meta: d || {}, events: evs };
    });
  }
  function loadHolidays() {
    return fetchJSON(url("data/feiertage.json")).then(function (d) {
      var hs = (d && Array.isArray(d.holidays) ? d.holidays : []).filter(function (x) { return x && /^\d{4}-\d{2}-\d{2}$/.test(x.date); })
        .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      return hs;
    });
  }

  var api = {
    cfg: CFG, TZ_BERLIN: TZ_BERLIN, TZ_NY: TZ_NY, mock: MOCK, state: state, isAtas: isAtas,
    h: h, clear: clear, store: store, num: num, signed: signed, pct: pct, isNum: isNum,
    zonedToUtc: zonedToUtc, dayKey: dayKey, hm: hm, addDays: addDays, weekday: weekday, diffDays: diffDays,
    dateDE: dateDE, countdown: countdown, ageText: ageText, parts: parts,
    normSide: normSide, SIDE_WORD: SIDE_WORD, SIDE_SYM: SIDE_SYM, sideBadge: sideBadge, stars: stars,
    parseNum: parseNum, einzelurteil: einzelurteil, gesamturteil: gesamturteil,
    fetchJSON: fetchJSON, url: url, normalizeLegacy: normalizeLegacy,
    startLive: startLive, updateStatus: updateStatus, reload: doLoad,
    biasView: biasView, regimeView: regimeView,
    masterFor: masterFor, loadCalendar: loadCalendar, loadHolidays: loadHolidays, WT: WT
  };
  return api;
})(typeof window !== "undefined" ? window : globalThis);
if (typeof module !== "undefined" && module.exports) module.exports = MT;
