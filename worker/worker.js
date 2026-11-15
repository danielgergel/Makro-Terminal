// Makro-Terminal API v2 - Cloudflare Worker (ES-Modul, keine Abhaengigkeiten)
// Secrets: TWELVEDATA_API_KEY (Pflicht). Keine Bindings.
// Proxy fuer NQ: QQQ (Twelve Data Gratis-Tarif hat keine Futures).
// Logik und Abrufbudget: siehe README.md

// ============================ Konstanten ============================
const VERSION = 2;
const PROXY = 'QQQ';
const TZ = 'America/New_York';
const TD_BASE = 'https://api.twelvedata.com/time_series';
const FRED_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=VIXCLS';

// Zeiten in Minuten ab Mitternacht (New York)
const PRE_START = 4 * 60;       // 04:00
const REG_START = 9 * 60 + 30;  // 09:30
const REG_END = 16 * 60;        // 16:00
const POST_END = 20 * 60;       // 20:00

// Cache-Zeiten (Sekunden), nach Uhrzeit-Sitzung
const TTL = {
  c5:    { regulaer: 120, vorboerse: 300, nachboerse: 300, geschlossen: 3600 },
  c5NoExt: { vorboerse: 1800, nachboerse: 1800 }, // Tarif ohne prepost: dort aendern sich die Daten nicht
  h1:    { regulaer: 600, vorboerse: 1800, nachboerse: 1800, geschlossen: 7200 },
  d1:    { regulaer: 3600, vorboerse: 3600, nachboerse: 3600, geschlossen: 10800 },
  vix:   { regulaer: 3600, vorboerse: 3600, nachboerse: 3600, geschlossen: 3600 },
};
const PREPOST_REJECT_TTL = 6 * 3600;  // so lange nicht erneut prepost probieren
const FAIL_BACKOFF_S = 60;            // nach Fehler nicht sofort wieder abrufen
const RATELIMIT_BACKOFF_S = 120;
const SOFT_CREDIT_LIMIT = 700;        // ab hier (pro Cache-Standort/UTC-Tag) nur noch gespeicherte Daten

// Bias
const SMA_DAYS = 20;
const VWAP_DEADBAND_PCT = 0.05;       // +-0.05 % um den VWAP = neutral
const SWING_K = 2;                    // Swing = Hoch/Tief gegenueber je 2 Kerzen links und rechts
const BIAS_LONG_MIN = 2;
const BIAS_SHORT_MAX = -2;

// Regime (5-Minuten-Kerzen)
const REGIME_N = 24;                  // Fenster: 24 Kerzen = 2 Stunden
const REGIME_RECENT = 6;              // "Kerzen davor" = die aeltesten 18 des Fensters
const EFF_ENTER = 0.38;               // Effizienz fuer Eintritt in Imbalance
const EFF_EXIT = 0.28;                // Unter diesem Wert zurueck zu Balance (Hysterese)
const MIN_NET_PCT = 0.12;             // Nettobewegung im Fenster mindestens 0.12 %
const REGIME_STALE_S = 30 * 60;       // aeltere Daten: kein Regime

// Risiko-Score: Gewicht, Skala (|%| fuer volle Wirkung), Vorzeichen (+1 = steigt bei Risk-On)
const RISK_COMPONENTS = {
  QQQ: { name: 'QQQ', weight: 30, scale: 1.5, sign: 1 },
  VIX: { name: 'VIX', weight: 30, scale: 10, sign: -1 },
  TLT: { name: 'TLT (Anleihen)', weight: 20, scale: 1.0, sign: -1 },
  UUP: { name: 'UUP (US-Dollar)', weight: 20, scale: 0.5, sign: -1 },
};
const RISK_ON_MIN = 60;
const RISK_OFF_MAX = 40;

const ALLOWED_ORIGIN_EXACT = 'https://danielgergel.github.io';
const ALLOWED_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const CACHE_BASE = 'https://cache.makro-terminal.invalid/';

// ============================ Zeit-Helfer ============================
const NY_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23', weekday: 'short',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function nyParts(ms) {
  const o = {};
  for (const p of NY_FMT.formatToParts(new Date(ms))) o[p.type] = p.value;
  return {
    date: `${o.year}-${o.month}-${o.day}`,
    minutes: (+o.hour) * 60 + (+o.minute),
    dow: DOW.indexOf(o.weekday),
    y: +o.year, mo: +o.month, d: +o.day, h: +o.hour, mi: +o.minute, s: +o.second,
  };
}

// Offset (ms) von New York gegenueber UTC zum Zeitpunkt ms (Sommerzeit-sicher)
function nyOffset(ms) {
  const p = nyParts(ms);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

// "YYYY-MM-DD HH:MM:SS" (New Yorker Ortszeit) -> Epoch ms
function nyToEpoch(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(str || '');
  if (!m) return NaN;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  const t0 = guess - nyOffset(guess);
  return guess - nyOffset(t0);
}

// Sitzung nach Uhrzeit (Feiertage ignoriert)
function sessionByClock(ms) {
  const p = nyParts(ms);
  if (p.dow === 0 || p.dow === 6) return 'geschlossen';
  if (p.minutes >= REG_START && p.minutes < REG_END) return 'regulaer';
  if (p.minutes >= PRE_START && p.minutes < REG_START) return 'vorboerse';
  if (p.minutes >= REG_END && p.minutes < POST_END) return 'nachboerse';
  return 'geschlossen';
}

// ============================ Zahlen-Helfer ============================
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const round = (x, n = 4) => (isNum(x) ? Math.round(x * 10 ** n) / 10 ** n : null);
const pct = (a, b) => (isNum(a) && isNum(b) && b !== 0 ? ((a - b) / b) * 100 : null);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const fmt = (x, n = 2) => (isNum(x) ? x.toFixed(n) : 'n/a');
const fmtSigned = (x, n = 2) => (isNum(x) ? (x > 0 ? '+' : '') + x.toFixed(n) : 'n/a');
const sideOf = (v) => (v > 0 ? 'Long' : v < 0 ? 'Short' : 'Neutral');
const iso = (ms) => (isNum(ms) ? new Date(ms).toISOString() : null);

// ============================ Kerzen parsen ============================
// Twelve Data liefert values neueste zuerst, alle Zahlen als Text.
export function parseCandles(values, daily = false) {
  if (!Array.isArray(values)) return [];
  const out = [];
  for (const v of values) {
    const o = +v.open, h = +v.high, l = +v.low, c = +v.close, vol = +(v.volume ?? 0);
    const dt = String(v.datetime || '');
    if (![o, h, l, c].every(Number.isFinite)) continue;
    const t = daily ? nyToEpoch(dt.slice(0, 10) + ' 16:00:00') : nyToEpoch(dt);
    if (!Number.isFinite(t)) continue;
    const np = nyParts(daily ? t - 3600e3 : t);
    out.push({ t, d: dt.slice(0, 10), min: daily ? 0 : np.minutes, o, h, l, c, v: Number.isFinite(vol) ? vol : 0 });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

const isRegular = (k) => k.min >= REG_START && k.min < REG_END;

// ============================ VWAP ============================
// Sitzungs-VWAP der regulaeren Handelszeit (Typischer Preis * Volumen). Extended-Kerzen haben Volumen 0.
export function computeVwap(regularCandles) {
  let pv = 0, vol = 0;
  for (const k of regularCandles) {
    if (k.v > 0) { pv += ((k.h + k.l + k.c) / 3) * k.v; vol += k.v; }
  }
  return vol > 0 ? pv / vol : null;
}

// ============================ Swings ============================
export function findSwings(candles, k = SWING_K) {
  const highs = [], lows = [];
  for (let i = k; i < candles.length - k; i++) {
    let isH = true, isL = true;
    for (let j = 1; j <= k; j++) {
      if (!(candles[i].h > candles[i - j].h && candles[i].h > candles[i + j].h)) isH = false;
      if (!(candles[i].l < candles[i - j].l && candles[i].l < candles[i + j].l)) isL = false;
    }
    if (isH) highs.push(candles[i].h);
    if (isL) lows.push(candles[i].l);
  }
  return { highs, lows };
}

// ============================ Bias-Faktoren ============================
export function factorTag(completedDaily) {
  const name = 'Tagesstruktur';
  const n = completedDaily.length;
  if (n < 3) return { key: 'tag', name, side: 'Neutral', detail: 'Zu wenige Tageskerzen.' };
  const last = completedDaily[n - 1], p1 = completedDaily[n - 2];
  let smaPart = 0, smaTxt = 'kein 20-Tage-Schnitt';
  if (n >= SMA_DAYS) {
    const sma = completedDaily.slice(n - SMA_DAYS).reduce((s, k) => s + k.c, 0) / SMA_DAYS;
    smaPart = last.c > sma ? 1 : last.c < sma ? -1 : 0;
    smaTxt = `Schluss ${fmt(last.c)} ${smaPart > 0 ? 'ueber' : smaPart < 0 ? 'unter' : 'auf'} 20-Tage-Schnitt ${fmt(sma)}`;
  }
  const hh = last.h > p1.h, hl = last.l > p1.l, lh = last.h < p1.h, ll = last.l < p1.l;
  const strPart = hh && hl ? 1 : lh && ll ? -1 : 0;
  const strTxt = strPart > 0 ? 'hoehere Hochs und Tiefs' : strPart < 0 ? 'tiefere Hochs und Tiefs' : 'keine klare Hoch/Tief-Folge';
  const total = smaPart + strPart;
  const v = total >= 2 ? 1 : total <= -2 ? -1 : 0;
  return { key: 'tag', name, side: sideOf(v), detail: `${smaTxt}; ${strTxt}.` };
}

export function factorH1(hourly) {
  const name = 'Stundenstruktur';
  const { highs, lows } = findSwings(hourly);
  if (highs.length < 2 || lows.length < 2) {
    return { key: 'h1', name, side: 'Neutral', detail: 'Zu wenige Swing-Hochs/-Tiefs in den Stundenkerzen.' };
  }
  const h0 = highs[highs.length - 1], h1 = highs[highs.length - 2];
  const l0 = lows[lows.length - 1], l1 = lows[lows.length - 2];
  const up = h0 > h1 && l0 > l1, down = h0 < h1 && l0 < l1;
  const v = up ? 1 : down ? -1 : 0;
  const txt = up ? 'steigende Swing-Hochs und -Tiefs' : down ? 'fallende Swing-Hochs und -Tiefs' : 'Swing-Hochs/-Tiefs ohne klare Richtung';
  return { key: 'h1', name, side: sideOf(v), detail: `Letztes Swing-Hoch ${fmt(h0)} (davor ${fmt(h1)}), Swing-Tief ${fmt(l0)} (davor ${fmt(l1)}): ${txt}.` };
}

export function factorLage(price, prev) {
  const name = 'Lage zum Vortag';
  if (!isNum(price) || !prev) return { key: 'lage', name, side: 'Neutral', detail: 'Vortageswerte nicht verfuegbar.' };
  if (price > prev.h) return { key: 'lage', name, side: 'Long', detail: `Kurs ${fmt(price)} ueber Vortageshoch ${fmt(prev.h)} (${fmtSigned(pct(price, prev.h))} %).` };
  if (price < prev.l) return { key: 'lage', name, side: 'Short', detail: `Kurs ${fmt(price)} unter Vortagestief ${fmt(prev.l)} (${fmtSigned(pct(price, prev.l))} %).` };
  return { key: 'lage', name, side: 'Neutral', detail: `Kurs ${fmt(price)} im Vortagesbereich ${fmt(prev.l)} bis ${fmt(prev.h)}.` };
}

export function factorVwap(price, vwap) {
  const name = 'VWAP';
  if (!isNum(price) || !isNum(vwap)) return { key: 'vwap', name, side: 'Neutral', detail: 'Sitzungs-VWAP noch nicht verfuegbar.' };
  const d = pct(price, vwap);
  if (d > VWAP_DEADBAND_PCT) return { key: 'vwap', name, side: 'Long', detail: `Kurs ${fmt(price)} ${fmtSigned(d)} % ueber VWAP ${fmt(vwap)}.` };
  if (d < -VWAP_DEADBAND_PCT) return { key: 'vwap', name, side: 'Short', detail: `Kurs ${fmt(price)} ${fmtSigned(d)} % unter VWAP ${fmt(vwap)}.` };
  return { key: 'vwap', name, side: 'Neutral', detail: `Kurs ${fmt(price)} nahe VWAP ${fmt(vwap)} (${fmtSigned(d)} %, Totband +-${VWAP_DEADBAND_PCT} %).` };
}

export function combineBias(factors) {
  const val = (f) => (f.side === 'Long' ? 1 : f.side === 'Short' ? -1 : 0);
  const score = factors.reduce((s, f) => s + val(f), 0);
  const label = score >= BIAS_LONG_MIN ? 'Long' : score <= BIAS_SHORT_MAX ? 'Short' : 'Neutral';
  const against = factors.filter((f) => (label === 'Long' && f.side === 'Short') || (label === 'Short' && f.side === 'Long')).length;
  let confidence = 'niedrig';
  if (label !== 'Neutral') confidence = Math.abs(score) >= 3 && against === 0 ? 'hoch' : 'mittel';
  const agree = factors.filter((f) => f.side === label).map((f) => f.name);
  let summary;
  if (label === 'Neutral') {
    summary = `Kein klarer Bias (Score ${score}): Faktoren sind gemischt oder neutral.`;
  } else {
    summary = `Bias ${label} (Score ${fmtSigned(score, 0)}, Konfidenz ${confidence}): ${agree.join(', ')} zeigen ${label === 'Long' ? 'nach oben' : 'nach unten'}` +
      (against ? `, ${against} Faktor${against > 1 ? 'en' : ''} dagegen.` : '.');
  }
  return { label, score, confidence, factors, summary };
}

// ============================ Regime ============================
// Zustandsautomat ueber alle Fenster der Kerzenfolge: deterministisch, kein gespeicherter Zustand noetig.
export function computeRegime(c5) {
  const base = { label: 'Balance', direction: null, text: 'Range (Balance)', efficiency: 0, timeframe: `5-Min, letzte ${REGIME_N} Kerzen (${REGIME_N * 5 / 60} h)`, detail: '', since: null };
  if (!Array.isArray(c5) || c5.length < REGIME_N) {
    return { ...base, detail: 'Zu wenige 5-Minuten-Kerzen fuer eine Einordnung.' };
  }
  let state = 'Balance', dir = 0, since = null;
  let last = { eff: 0, breakout: 0, net: 0 };
  for (let i = REGIME_N - 1; i < c5.length; i++) {
    const w = c5.slice(i - REGIME_N + 1, i + 1);
    let sum = 0;
    for (let j = 1; j < w.length; j++) sum += Math.abs(w[j].c - w[j - 1].c);
    const net = w[w.length - 1].c - w[0].c;
    const eff = sum > 0 ? Math.abs(net) / sum : 0;
    const older = w.slice(0, w.length - REGIME_RECENT);
    const hi = Math.max(...older.map((k) => k.h)), lo = Math.min(...older.map((k) => k.l));
    const px = w[w.length - 1].c;
    const breakout = px > hi ? 1 : px < lo ? -1 : 0;
    const netSign = net > 0 ? 1 : net < 0 ? -1 : 0;
    const bigEnough = Math.abs(pct(w[w.length - 1].c, w[0].c)) >= MIN_NET_PCT;
    const enter = eff >= EFF_ENTER && breakout !== 0 && breakout === netSign && bigEnough;
    if (state === 'Balance') {
      if (enter) { state = 'Imbalance'; dir = breakout; since = c5[i].t; }
    } else if (eff < EFF_EXIT) {
      state = 'Balance'; dir = 0; since = c5[i].t;
    } else if (enter && breakout !== dir) {
      dir = breakout; since = c5[i].t;
    }
    last = { eff, breakout, net };
  }
  const efficiency = round(last.eff, 3);
  const dirName = dir > 0 ? 'Long' : dir < 0 ? 'Short' : null;
  if (state === 'Imbalance') {
    return {
      ...base, label: 'Imbalance', direction: dirName, text: `Trend ${dirName} (Imbalance)`, efficiency, since: iso(since),
      detail: `Effizienz ${fmt(last.eff)} (Schwelle ${EFF_EXIT}) ueber ${REGIME_N} Kerzen, Kurs ${dir > 0 ? 'ueber' : 'unter'} der Spanne der Vorkerzen: gerichtete Bewegung.`,
    };
  }
  return {
    ...base, efficiency, since: iso(since),
    detail: `Effizienz ${fmt(last.eff)} ueber ${REGIME_N} Kerzen (Eintritt ab ${EFF_ENTER}), kein bestaetigter Ausbruch: Kurs pendelt in der Spanne.`,
  };
}

// ============================ Risk ============================
export function dayChange(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return null;
  return pct(rows[rows.length - 1].c, rows[rows.length - 2].c);
}

export function computeRisk(changes, vix) {
  // changes: { QQQ, TLT, UUP, VIX } in Prozent oder null
  const comps = [];
  let wSum = 0, acc = 0;
  for (const key of ['QQQ', 'VIX', 'TLT', 'UUP']) {
    const cfg = RISK_COMPONENTS[key], ch = changes[key];
    if (!isNum(ch)) continue;
    const contrib = clamp((cfg.sign * ch) / cfg.scale, -1, 1); // -1 = Risk-Off, +1 = Risk-On
    wSum += cfg.weight; acc += contrib * cfg.weight;
    comps.push({ name: cfg.name, changePct: round(ch, 2), side: contrib > 0.1 ? 'Risk-On' : contrib < -0.1 ? 'Risk-Off' : 'Neutral' });
  }
  const vixOut = vix ? { value: vix.value, date: vix.date, changePct: round(vix.changePct, 2) } : null;
  const expectedMovePct = vix && isNum(vix.value) ? round(vix.value / 16, 2) : null;
  if (comps.length < 2) return { score: null, label: null, vix: vixOut, expectedMovePct, components: comps };
  const score = Math.round(50 + 50 * (acc / wSum));
  const label = score >= RISK_ON_MIN ? 'Risk-On' : score <= RISK_OFF_MAX ? 'Risk-Off' : 'Neutral';
  return { score, label, vix: vixOut, expectedMovePct, components: comps };
}

export function parseVixCsv(text) {
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^(\d{4}-\d{2}-\d{2}),\s*([0-9.]+)\s*$/.exec(line.trim());
    if (m && Number.isFinite(+m[2])) rows.push({ date: m[1], value: +m[2] });
  }
  if (!rows.length) return null;
  const l = rows[rows.length - 1], p = rows[rows.length - 2];
  return { value: l.value, date: l.date, changePct: p ? pct(l.value, p.value) : null };
}

// ============================ Gesamtanalyse (rein) ============================
export function analyze(inp) {
  const { c5 = [], c1h = [], d1 = {}, vix = null, now, stale = false, errors = [], diagTwelve = {} } = inp;
  const daily = d1.QQQ || [];
  const last = c5.length ? c5[c5.length - 1] : null;
  const price = last ? last.c : null;
  const S = last ? last.d || nyParts(last.t).date : null;
  const sessionDay = last ? nyParts(last.t).date : null;
  const day5 = last ? c5.filter((k) => nyParts(k.t).date === sessionDay) : [];
  const reg5 = day5.filter(isRegular);
  const hasExt = day5.some((k) => !isRegular(k));
  const ageSeconds = last ? Math.max(0, Math.round((now - last.t) / 1000)) : null;

  // Sitzung
  let session = sessionByClock(now);
  if (last) {
    if (session === 'regulaer' && ageSeconds > 20 * 60) session = 'geschlossen';
    else if ((session === 'vorboerse' || session === 'nachboerse') && hasExt && ageSeconds > 30 * 60) session = 'geschlossen';
  }

  // Levels
  const completed = daily.filter((k) => sessionDay && k.d < sessionDay);
  const prev = completed.length ? completed[completed.length - 1] : null;
  const vwap = computeVwap(reg5);
  const todayOpen = reg5.length ? reg5[0].o : null;
  const todayHigh = reg5.length ? Math.max(...reg5.map((k) => k.h)) : null;
  const todayLow = reg5.length ? Math.min(...reg5.map((k) => k.l)) : null;
  let atrPct14 = null;
  if (completed.length >= 15) {
    const w = completed.slice(-15);
    let s = 0;
    for (let i = 1; i < w.length; i++) s += Math.max(w[i].h - w[i].l, Math.abs(w[i].h - w[i - 1].c), Math.abs(w[i].l - w[i - 1].c));
    atrPct14 = pct(s / 14 + w[w.length - 1].c, w[w.length - 1].c);
  }
  let position = null;
  if (isNum(price) && prev) position = price > prev.h ? 'ueber_vortageshoch' : price < prev.l ? 'unter_vortagestief' : 'im_vortagesbereich';
  const levels = {
    prevHigh: round(prev?.h), prevLow: round(prev?.l), prevClose: round(prev?.c),
    todayOpen: round(todayOpen), todayHigh: round(todayHigh), todayLow: round(todayLow), vwap: round(vwap),
    position,
    gapPct: round(pct(todayOpen, prev?.c), 2),
    atrPct14: round(atrPct14, 2),
    rangeTodayPct: round(pct(todayHigh, todayLow), 2),
    distPrevHighPct: round(pct(price, prev?.h), 2),
    distPrevLowPct: round(pct(price, prev?.l), 2),
    distVwapPct: round(pct(price, vwap), 2),
  };

  // Bias
  const factors = [
    factorTag(completed),
    factorH1(c1h),
    factorLage(price, prev),
    factorVwap(price, vwap),
  ];
  const bias = combineBias(factors);

  // Regime
  let regime;
  if (!last) regime = { ...computeRegime([]), detail: 'Keine 5-Minuten-Daten.' };
  else if (ageSeconds > REGIME_STALE_S) regime = { ...computeRegime([]), detail: 'Daten zu alt (Markt geschlossen), keine Einordnung.' };
  else {
    const series = day5.length >= REGIME_N ? day5 : c5;
    regime = computeRegime(series);
  }

  // Risk
  const changes = { QQQ: dayChange(daily), TLT: dayChange(d1.TLT), UUP: dayChange(d1.UUP), VIX: vix ? vix.changePct : null };
  const risk = computeRisk(changes, vix);

  return {
    version: VERSION,
    generatedAt: iso(now),
    market: {
      proxy: PROXY, session, extendedHours: hasExt,
      lastPrice: round(price, 4), lastTime: last ? iso(last.t) : null, ageSeconds, stale: !!stale,
    },
    bias, regime, levels, risk,
    diagnostics: { twelve: diagTwelve, errors },
  };
}

// ============================ Speicher (Cache API + Modul-Speicher) ============================
const mem = new Map();
const failUntil = new Map();
const inflight = new Map();
export function _resetState() { mem.clear(); failUntil.clear(); inflight.clear(); }

async function storeGet(key) {
  let best = mem.get(key);
  try {
    if (typeof caches !== 'undefined' && caches.default) {
      const r = await caches.default.match(new Request(CACHE_BASE + key));
      if (r) {
        const j = await r.json();
        if (!best || j.savedAt > best.savedAt) best = j;
      }
    }
  } catch (_) { /* Cache optional */ }
  return best;
}

async function storePut(key, entry) {
  mem.set(key, entry);
  try {
    if (typeof caches !== 'undefined' && caches.default) {
      await caches.default.put(new Request(CACHE_BASE + key), new Response(JSON.stringify(entry), { headers: { 'Cache-Control': 'max-age=86400', 'Content-Type': 'application/json' } }));
    }
  } catch (_) { /* ignorieren */ }
}

// ============================ Abruf ============================
class UpstreamError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

function sanitize(msg, env) {
  let s = String(msg || '');
  const key = env && env.TWELVEDATA_API_KEY;
  if (key) s = s.split(key).join('***');
  s = s.replace(/apikey=[^&\s"']+/gi, 'apikey=***');
  return s.slice(0, 300);
}

async function creditsUsed(now) {
  const e = await storeGet('credits:' + new Date(now).toISOString().slice(0, 10));
  return e ? e.data : 0;
}
async function addCredit(now, n = 1) {
  const day = new Date(now).toISOString().slice(0, 10);
  const used = await creditsUsed(now);
  await storePut('credits:' + day, { savedAt: now, data: used + n });
}

async function tdSeries(env, now, symbol, interval, outputsize, prepost) {
  const u = new URL(TD_BASE);
  u.searchParams.set('symbol', symbol);
  u.searchParams.set('interval', interval);
  u.searchParams.set('outputsize', String(outputsize));
  u.searchParams.set('timezone', TZ);
  u.searchParams.set('order', 'desc');
  if (prepost) u.searchParams.set('prepost', 'true');
  u.searchParams.set('apikey', env.TWELVEDATA_API_KEY);
  await addCredit(now, 1);
  let res, json;
  try {
    res = await fetch(u.toString());
    json = await res.json();
  } catch (e) {
    throw new UpstreamError('Twelve Data nicht erreichbar: ' + sanitize(e.message, env), 0);
  }
  if (!json || json.status === 'error' || !Array.isArray(json.values)) {
    throw new UpstreamError(`Twelve Data ${symbol} ${interval}: ${sanitize(json && json.message, env) || 'HTTP ' + res.status}`, (json && json.code) || res.status);
  }
  return json.values;
}

// Frische pruefen, sonst holen; bei Fehler letzten guten Stand (stale) liefern.
async function cached(key, ttlS, now, errors, fetcher, opts = {}) {
  const entry = await storeGet(key);
  if (entry && now - entry.savedAt < ttlS * 1000) return { data: entry.data, stale: false, savedAt: entry.savedAt };
  if (opts.blocked && entry) return { data: entry.data, stale: true, savedAt: entry.savedAt };
  if (failUntil.get(key) > now) {
    return entry ? { data: entry.data, stale: true, savedAt: entry.savedAt } : { data: null, stale: true, savedAt: null };
  }
  let p = inflight.get(key);
  if (!p) {
    p = (async () => fetcher())();
    inflight.set(key, p);
    p.then(() => inflight.delete(key), () => inflight.delete(key));
  }
  try {
    const data = await p;
    await storePut(key, { savedAt: now, data });
    return { data, stale: false, savedAt: now };
  } catch (e) {
    const backoff = e.code === 429 ? RATELIMIT_BACKOFF_S : FAIL_BACKOFF_S;
    failUntil.set(key, now + backoff * 1000);
    errors.push(`${key}: ${e.message}`);
    return entry ? { data: entry.data, stale: true, savedAt: entry.savedAt } : { data: null, stale: true, savedAt: null };
  }
}

async function fetchVix() {
  let text;
  const start = new Date(Date.now() - 45 * 86400e3).toISOString().slice(0, 10);
  try {
    const r = await fetch(`${FRED_URL}&cosd=${start}`);
    if (!r.ok) throw new UpstreamError('FRED HTTP ' + r.status, r.status);
    text = await r.text();
  } catch (e) {
    throw new UpstreamError('VIX-Quelle (FRED) nicht erreichbar: ' + e.message, e.code || 0);
  }
  const v = parseVixCsv(text);
  if (!v) throw new UpstreamError('VIX-Quelle ohne gueltige Daten', 0);
  return v;
}

function isPlanRejection(e) {
  if (e.code === 403) return true;
  return e.code === 400 && /prepost|plan|upgrade|subscription/i.test(e.message);
}

export async function buildSnapshot(env, now = Date.now()) {
  const errors = [];
  const clock = sessionByClock(now);
  const used = await creditsUsed(now);
  const blocked = used >= SOFT_CREDIT_LIMIT;
  if (blocked) errors.push(`Weicher Tageslimit-Schutz aktiv (${used} Abrufe heute an diesem Standort): nur gespeicherte Daten.`);
  const hasKey = !!(env && env.TWELVEDATA_API_KEY);
  if (!hasKey) errors.push('Secret TWELVEDATA_API_KEY fehlt.');
  const tw = { prepost: 'nicht versucht', creditsToday: used };
  const opts = { blocked: blocked || !hasKey };

  const guard = (fn) => (hasKey ? fn : async () => { throw new UpstreamError('kein API-Schluessel', 0); });

  const prepostState = await storeGet('prepostState');
  const prepostRejected = prepostState && now - prepostState.savedAt < PREPOST_REJECT_TTL * 1000 && prepostState.data === 'rejected';

  // 5-Minuten-Kerzen (Zeit-TTL haengt davon ab, ob erweiterte Zeiten tatsaechlich Daten liefern)
  const prevC5 = await storeGet('c5');
  const prevHadExt = !!(prevC5 && prevC5.ext);
  let ttl5 = TTL.c5[clock];
  if ((clock === 'vorboerse' || clock === 'nachboerse') && !prevHadExt) ttl5 = TTL.c5NoExt[clock];

  const c5P = cached('c5', ttl5, now, errors, guard(async () => {
    let values;
    if (!prepostRejected) {
      try {
        values = await tdSeries(env, now, PROXY, '5min', 200, true);
        tw.prepost = 'angefragt';
      } catch (e) {
        if (!isPlanRejection(e)) throw e;
        await storePut('prepostState', { savedAt: now, data: 'rejected' });
        tw.prepost = 'abgelehnt (Tarif), Rueckfall auf regulaere Zeiten';
        values = await tdSeries(env, now, PROXY, '5min', 200, false);
      }
    } else {
      tw.prepost = 'abgelehnt (Tarif, gemerkt), regulaere Zeiten';
      values = await tdSeries(env, now, PROXY, '5min', 200, false);
    }
    return values;
  }), opts);
  const h1P = cached('h1', TTL.h1[clock], now, errors, guard(() => tdSeries(env, now, PROXY, '1h', 60, false)), opts);
  const dP = (sym) => cached('d1:' + sym, TTL.d1[clock], now, errors, guard(() => tdSeries(env, now, sym, '1day', 40, false)), opts);
  const vixP = cached('vix', TTL.vix[clock], now, errors, fetchVix, {});

  const [c5r, h1r, dq, dt, du, vr] = await Promise.all([c5P, h1P, dP('QQQ'), dP('TLT'), dP('UUP'), vixP]);

  const c5 = parseCandles(c5r.data);
  if (c5r.data) {
    const hasExt = c5.some((k) => !isRegular(k));
    const e = await storeGet('c5');
    if (e && e.savedAt === c5r.savedAt) { e.ext = hasExt; await storePut('c5', e); }
  }
  if (tw.prepost === 'angefragt') tw.prepost = c5.some((k) => !isRegular(k)) ? 'aktiv (erweiterte Zeiten in den Daten)' : 'angefragt, aber keine erweiterten Kerzen erhalten';
  if (tw.prepost === 'nicht versucht' && prevHadExt) tw.prepost = 'aktiv (aus Zwischenspeicher)';
  tw.cache = {
    c5: { stale: c5r.stale, ageSeconds: c5r.savedAt ? Math.round((now - c5r.savedAt) / 1000) : null },
    h1: { stale: h1r.stale, ageSeconds: h1r.savedAt ? Math.round((now - h1r.savedAt) / 1000) : null },
    d1: { stale: dq.stale || dt.stale || du.stale, ageSeconds: dq.savedAt ? Math.round((now - dq.savedAt) / 1000) : null },
    vix: { stale: vr.stale, ageSeconds: vr.savedAt ? Math.round((now - vr.savedAt) / 1000) : null },
  };

  return analyze({
    c5, c1h: parseCandles(h1r.data),
    d1: { QQQ: parseCandles(dq.data, true), TLT: parseCandles(dt.data, true), UUP: parseCandles(du.data, true) },
    vix: vr.data, now, stale: c5r.stale || !c5r.data, errors, diagTwelve: tw,
  });
}

// ============================ HTTP ============================
function corsHeaders(origin) {
  const h = { 'Vary': 'Origin' };
  if (origin && (origin === ALLOWED_ORIGIN_EXACT || ALLOWED_ORIGIN_RE.test(origin))) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Content-Type';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(origin) },
  });
}

export async function handle(request, env, now = Date.now()) {
  const origin = request.headers.get('Origin');
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store', ...corsHeaders(origin) } });
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, origin);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path === '/api/v2/snapshot') {
    try {
      return json(await buildSnapshot(env || {}, now), 200, origin);
    } catch (e) {
      return json({ error: 'internal', message: sanitize(e && e.message, env) }, 500, origin);
    }
  }
  if (path === '/api/health') {
    const sess = sessionByClock(now);
    return json({
      ok: true, version: VERSION, time: iso(now), session: sess, proxy: PROXY,
      secrets: { twelveData: !!(env && env.TWELVEDATA_API_KEY) },
      creditsToday: await creditsUsed(now),
    }, 200, origin);
  }
  return json({ error: 'not_found' }, 404, origin);
}

export default {
  async fetch(request, env) {
    return handle(request, env);
  },
};

// Nur fuer Tests (Cloudflare ignoriert zusaetzliche Exporte)
export const __test = { nyParts, nyToEpoch, sessionByClock, nyOffset, constants: { EFF_ENTER, EFF_EXIT, REGIME_N, TTL, SOFT_CREDIT_LIMIT } };
