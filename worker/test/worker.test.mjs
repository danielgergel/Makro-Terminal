import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {
  __test, parseCandles, computeVwap, findSwings, factorTag, factorH1, factorLage, factorVwap,
  combineBias, computeRegime, computeRisk, parseVixCsv, analyze, buildSnapshot, handle, _resetState,
} from '../worker.js';

const { nyToEpoch, nyParts, sessionByClock } = __test;

// ---------- Fixture-Helfer ----------
const pad = (n) => String(n).padStart(2, '0');
function tdValues(dateStr, startMin, count, fn) {
  // erzeugt Twelve-Data-aehnliche values (neueste zuerst, alles Text)
  const arr = [];
  for (let i = 0; i < count; i++) {
    const m = startMin + i * 5;
    const [o, h, l, c, v] = fn(i);
    arr.push({ datetime: `${dateStr} ${pad(Math.floor(m / 60))}:${pad(m % 60)}:00`, open: String(o), high: String(h), low: String(l), close: String(c), volume: String(v) });
  }
  return arr.reverse();
}
const trendFn = (i) => { const c = 500 + i * 0.3; return [c - 0.2, c + 0.1, c - 0.3, c, 1000]; };
const rangeFn = (i) => { const c = 500 + (i % 2 ? 0.3 : -0.3); return [c, c + 0.2, c - 0.2, c, 1000]; };

function dailyValues(n, endDate, fn) {
  const out = [];
  const base = Date.UTC(+endDate.slice(0, 4), +endDate.slice(5, 7) - 1, +endDate.slice(8, 10));
  for (let i = 0; i < n; i++) {
    const d = new Date(base - i * 86400e3).toISOString().slice(0, 10);
    const k = fn(n - 1 - i); // i=0 ist neueste
    out.push({ datetime: d, open: String(k.o), high: String(k.h), low: String(k.l), close: String(k.c), volume: '1' });
  }
  return out;
}
const upDaily = (i) => ({ o: 400 + i, h: 402 + i, l: 398 + i, c: 401 + i });
const downDaily = (i) => ({ o: 600 - i, h: 602 - i, l: 598 - i, c: 599 - i });

// ---------- Zeit / Sitzung ----------
test('nyToEpoch beachtet Sommer- und Winterzeit', () => {
  assert.equal(new Date(nyToEpoch('2026-07-15 09:30:00')).toISOString(), '2026-07-15T13:30:00.000Z'); // EDT = UTC-4
  assert.equal(new Date(nyToEpoch('2026-01-15 09:30:00')).toISOString(), '2026-01-15T14:30:00.000Z'); // EST = UTC-5
  assert.equal(new Date(nyToEpoch('2026-11-13 19:55:00')).toISOString(), '2026-11-14T00:55:00.000Z');
});
test('Sitzungserkennung inkl. Zeitumstellung', () => {
  const at = (s) => sessionByClock(nyToEpoch(s));
  assert.equal(at('2026-07-15 03:59:00'), 'geschlossen');
  assert.equal(at('2026-07-15 04:00:00'), 'vorboerse');
  assert.equal(at('2026-07-15 09:29:00'), 'vorboerse');
  assert.equal(at('2026-07-15 09:30:00'), 'regulaer');
  assert.equal(at('2026-07-15 15:59:00'), 'regulaer');
  assert.equal(at('2026-07-15 16:00:00'), 'nachboerse');
  assert.equal(at('2026-07-15 20:00:00'), 'geschlossen');
  assert.equal(at('2026-01-15 09:30:00'), 'regulaer');
  assert.equal(at('2026-07-18 11:00:00'), 'geschlossen'); // Samstag
  // 13:30 UTC im Sommer = 09:30 NY, im Winter erst 08:30 NY
  assert.equal(sessionByClock(Date.UTC(2026, 6, 15, 13, 30)), 'regulaer');
  assert.equal(sessionByClock(Date.UTC(2026, 0, 15, 13, 30)), 'vorboerse');
});

// ---------- VWAP ----------
test('VWAP gewichtet mit Volumen und ignoriert Kerzen ohne Volumen', () => {
  const v = computeVwap([
    { h: 11, l: 9, c: 10, v: 100 },   // tp 10
    { h: 21, l: 19, c: 20, v: 300 },  // tp 20
    { h: 99, l: 99, c: 99, v: 0 },
  ]);
  assert.equal(v, (10 * 100 + 20 * 300) / 400);
  assert.equal(computeVwap([{ h: 1, l: 1, c: 1, v: 0 }]), null);
});

// ---------- Swings / h1 ----------
test('Swings und Stundenstruktur steigend/fallend', () => {
  const mk = (arr) => arr.map((c, i) => ({ t: i, h: c + 1, l: c - 1, c }));
  const up = mk([10, 12, 11, 10.5, 11.5, 14, 12, 11.5, 12.5, 16, 14, 13, 15, 18, 15, 14]);
  const s = findSwings(up);
  assert.ok(s.highs.length >= 2 && s.lows.length >= 2);
  assert.equal(factorH1(up).side, 'Long');
  const dn = mk([20, 18, 19, 19.5, 18.5, 16, 18, 18.5, 17.5, 14, 16, 17, 15, 12, 15, 16]);
  assert.equal(factorH1(dn).side, 'Short');
  assert.equal(factorH1(mk([1, 2, 3])).side, 'Neutral');
});

// ---------- Tag, Lage, VWAP, Bias ----------
test('Tagesstruktur: Aufwaertstrend = Long, Abwaertstrend = Short', () => {
  const up = parseCandles(dailyValues(30, '2026-11-12', upDaily), true);
  const dn = parseCandles(dailyValues(30, '2026-11-12', downDaily), true);
  assert.equal(factorTag(up).side, 'Long');
  assert.equal(factorTag(dn).side, 'Short');
  assert.equal(factorTag(up.slice(0, 2)).side, 'Neutral');
});
test('Lage und VWAP mit Totband', () => {
  const prev = { h: 100, l: 90 };
  assert.equal(factorLage(101, prev).side, 'Long');
  assert.equal(factorLage(89, prev).side, 'Short');
  assert.equal(factorLage(95, prev).side, 'Neutral');
  assert.equal(factorLage(95, null).side, 'Neutral');
  assert.equal(factorVwap(100.2, 100).side, 'Long');
  assert.equal(factorVwap(99.8, 100).side, 'Short');
  assert.equal(factorVwap(100.03, 100).side, 'Neutral');
  assert.equal(factorVwap(100, null).side, 'Neutral');
});
test('Bias-Label und Konfidenz', () => {
  const f = (...s) => s.map((side, i) => ({ key: 'x' + i, name: 'F' + i, side, detail: '' }));
  let b = combineBias(f('Long', 'Long', 'Long', 'Neutral'));
  assert.deepEqual([b.label, b.score, b.confidence], ['Long', 3, 'hoch']);
  b = combineBias(f('Long', 'Long', 'Long', 'Short'));
  assert.deepEqual([b.label, b.score, b.confidence], ['Long', 2, 'mittel']);
  b = combineBias(f('Short', 'Short', 'Neutral', 'Neutral'));
  assert.deepEqual([b.label, b.score], ['Short', -2]);
  b = combineBias(f('Long', 'Short', 'Neutral', 'Long'));
  assert.deepEqual([b.label, b.confidence], ['Neutral', 'niedrig']);
  b = combineBias(f('Short', 'Short', 'Short', 'Short'));
  assert.equal(b.score, -4);
});

// ---------- Regime ----------
test('Regime: Trend = Imbalance Long, Pendeln = Balance', () => {
  const trend = parseCandles(tdValues('2026-11-13', 570, 40, trendFn));
  const r = computeRegime(trend);
  assert.equal(r.label, 'Imbalance');
  assert.equal(r.direction, 'Long');
  assert.equal(r.text, 'Trend Long (Imbalance)');
  assert.ok(r.efficiency > 0.38);
  assert.ok(r.since);
  const range = parseCandles(tdValues('2026-11-13', 570, 40, rangeFn));
  const b = computeRegime(range);
  assert.equal(b.label, 'Balance');
  assert.equal(b.direction, null);
  assert.equal(b.text, 'Range (Balance)');
  assert.equal(computeRegime(trend.slice(0, 10)).label, 'Balance');
});
test('Regime: Hysterese - kleiner Ruecksetzer kippt das Label nicht, Short-Trend dreht es', () => {
  // 30 Kerzen hoch, dann 3 kleine Gegenkerzen: bleibt Imbalance
  const vals = tdValues('2026-11-13', 570, 33, (i) => {
    const c = i < 30 ? 500 + i * 0.3 : 500 + 29 * 0.3 - (i - 29) * 0.15;
    return [c, c + 0.1, c - 0.1, c, 1000];
  });
  const r = computeRegime(parseCandles(vals));
  assert.equal(r.label, 'Imbalance');
  assert.equal(r.direction, 'Long');
  // anschliessend lange Abwaertsbewegung: dreht auf Short
  const vals2 = tdValues('2026-11-13', 570, 70, (i) => {
    const c = i < 30 ? 500 + i * 0.3 : 509 - (i - 29) * 0.4;
    return [c, c + 0.1, c - 0.1, c, 1000];
  });
  const r2 = computeRegime(parseCandles(vals2));
  assert.equal(r2.label, 'Imbalance');
  assert.equal(r2.direction, 'Short');
});

// ---------- Risk / VIX ----------
test('Risk-Score: Risk-On, Risk-Off, fehlende Komponenten', () => {
  const on = computeRisk({ QQQ: 1.5, VIX: -10, TLT: -1, UUP: -0.5 }, { value: 16, date: 'x', changePct: -10 });
  assert.equal(on.score, 100);
  assert.equal(on.label, 'Risk-On');
  assert.equal(on.expectedMovePct, 1);
  const off = computeRisk({ QQQ: -1.5, VIX: 10, TLT: 1, UUP: 0.5 }, null);
  assert.equal(off.score, 0);
  assert.equal(off.label, 'Risk-Off');
  const flat = computeRisk({ QQQ: 0, VIX: 0, TLT: 0, UUP: 0 }, null);
  assert.equal(flat.score, 50);
  assert.equal(flat.label, 'Neutral');
  const few = computeRisk({ QQQ: 1, VIX: null, TLT: null, UUP: null }, null);
  assert.equal(few.score, null);
  assert.equal(few.label, null);
});
test('VIX-CSV Parser ueberspringt Punkte und leere Werte', () => {
  const v = parseVixCsv('observation_date,VIXCLS\n2026-11-10,19.46\n2026-11-11,.\n2026-11-12,18.70\n');
  assert.equal(v.date, '2026-11-12');
  assert.equal(v.value, 18.7);
  assert.ok(Math.abs(v.changePct - (18.7 / 19.46 - 1) * 100) < 1e-9);
  assert.equal(parseVixCsv('<html>'), null);
});

// ---------- analyze (Schnittstellenform) ----------
test('analyze liefert die vereinbarte Struktur', () => {
  const now = nyToEpoch('2026-11-13 11:00:00');
  const c5 = parseCandles(tdValues('2026-11-13', 570, 19, trendFn)); // 09:30..11:00
  const d = parseCandles(dailyValues(30, '2026-11-12', upDaily), true);
  const s = analyze({ c5, c1h: [], d1: { QQQ: d, TLT: d, UUP: d }, vix: { value: 18, date: '2026-11-12', changePct: -2 }, now, errors: [] });
  assert.equal(s.version, 2);
  assert.equal(s.market.session, 'regulaer');
  assert.equal(s.market.extendedHours, false);
  assert.equal(s.market.proxy, 'QQQ');
  assert.ok(s.levels.vwap > 0);
  assert.equal(s.levels.todayOpen, c5[0].o);
  assert.equal(s.levels.prevClose, d[d.length - 1].c);
  assert.ok(['ueber_vortageshoch', 'im_vortagesbereich', 'unter_vortagestief'].includes(s.levels.position));
  assert.equal(s.bias.factors.length, 4);
  assert.deepEqual(s.bias.factors.map((f) => f.key), ['tag', 'h1', 'lage', 'vwap']);
  assert.ok(s.bias.score >= -4 && s.bias.score <= 4);
  assert.equal(s.risk.expectedMovePct, 1.13);
  assert.ok(s.levels.atrPct14 > 0);
});
test('Sitzung geschlossen bei altem Datenstand (Feiertag)', () => {
  const now = nyToEpoch('2026-11-13 12:00:00');
  const c5 = parseCandles(tdValues('2026-11-12', 570, 78, rangeFn));
  const s = analyze({ c5, c1h: [], d1: {}, now, errors: [] });
  assert.equal(s.market.session, 'geschlossen');
  assert.equal(s.regime.label, 'Balance');
});

// ---------- Worker mit gemocktem fetch ----------
const ENV = { TWELVEDATA_API_KEY: 'GEHEIM123' };
function makeFetch({ prepostRejected = false, failTd = false, failFred = false, calls = [] } = {}) {
  return async (input) => {
    const u = new URL(String(input));
    calls.push(u.toString());
    if (u.host === 'fred.stlouisfed.org') {
      if (failFred) throw new Error('netz weg');
      return new Response('observation_date,VIXCLS\n2026-11-11,17.49\n2026-11-12,18.70\n', { status: 200 });
    }
    if (failTd) return new Response(JSON.stringify({ code: 429, message: 'You have run out of API credits for the current minute. apikey=GEHEIM123', status: 'error' }), { status: 200 });
    const iv = u.searchParams.get('interval');
    if (iv === '5min') {
      if (u.searchParams.get('prepost') && prepostRejected) {
        return new Response(JSON.stringify({ code: 403, message: 'prepost is available exclusively with Pro plan', status: 'error' }), { status: 200 });
      }
      return new Response(JSON.stringify({ meta: {}, status: 'ok', values: tdValues('2026-11-13', 570, 40, trendFn) }));
    }
    if (iv === '1h') return new Response(JSON.stringify({ status: 'ok', values: tdValues('2026-11-13', 570, 6, trendFn) }));
    return new Response(JSON.stringify({ status: 'ok', values: dailyValues(40, '2026-11-13', upDaily) }));
  };
}
const NOW = nyToEpoch('2026-11-13 12:50:00');

test('buildSnapshot: Erfolg mit prepost', async () => {
  _resetState();
  const calls = [];
  globalThis.fetch = makeFetch({ calls });
  const s = await buildSnapshot(ENV, NOW);
  assert.equal(s.market.stale, false);
  assert.equal(s.market.lastPrice, 500 + 39 * 0.3);
  assert.match(s.diagnostics.twelve.prepost, /prepost|angefragt|aktiv/);
  assert.ok(calls.some((c) => c.includes('prepost=true')));
  assert.ok(!JSON.stringify(s).includes('GEHEIM123'));
  assert.equal(s.risk.vix.value, 18.7);
});
test('buildSnapshot: prepost abgelehnt -> Rueckfall, danach nicht erneut versucht', async () => {
  _resetState();
  const calls = [];
  globalThis.fetch = makeFetch({ prepostRejected: true, calls });
  const s = await buildSnapshot(ENV, NOW);
  assert.match(s.diagnostics.twelve.prepost, /abgelehnt/);
  assert.equal(s.market.stale, false);
  assert.equal(s.market.lastPrice, 500 + 39 * 0.3);
  const withPre = calls.filter((c) => c.includes('prepost=true')).length;
  assert.equal(withPre, 1);
  const s2 = await buildSnapshot(ENV, NOW + 200e3); // 5min-Cache (120 s) abgelaufen
  assert.equal(calls.filter((c) => c.includes('prepost=true')).length, 1);
  assert.equal(s2.market.stale, false);
});
test('buildSnapshot: Cache verhindert erneuten Abruf innerhalb der TTL', async () => {
  _resetState();
  const calls = [];
  globalThis.fetch = makeFetch({ calls });
  await buildSnapshot(ENV, NOW);
  const n = calls.length;
  await buildSnapshot(ENV, NOW + 30e3);
  assert.equal(calls.length, n);
});
test('buildSnapshot: Fehler/Rate-Limit liefert letzten guten Stand mit stale:true, ohne Schluessel in der Antwort', async () => {
  _resetState();
  globalThis.fetch = makeFetch();
  const good = await buildSnapshot(ENV, NOW);
  globalThis.fetch = makeFetch({ failTd: true, failFred: true });
  const s = await buildSnapshot(ENV, NOW + 400e3);
  assert.equal(s.market.stale, true);
  assert.equal(s.market.lastPrice, good.market.lastPrice);
  assert.ok(s.diagnostics.errors.length > 0);
  assert.ok(s.risk.vix, 'VIX aus Zwischenspeicher');
  assert.ok(!JSON.stringify(s).includes('GEHEIM123'));
});
test('buildSnapshot: ohne Cache und mit Fehlern kein Absturz, VIX null', async () => {
  _resetState();
  globalThis.fetch = makeFetch({ failTd: true, failFred: true });
  const s = await buildSnapshot(ENV, NOW);
  assert.equal(s.market.lastPrice, null);
  assert.equal(s.market.stale, true);
  assert.equal(s.risk.vix, null);
  assert.equal(s.bias.label, 'Neutral');
  assert.equal(s.regime.label, 'Balance');
  assert.ok(!JSON.stringify(s).includes('GEHEIM123'));
});
test('Routing, CORS, 404 und Health', async () => {
  _resetState();
  globalThis.fetch = makeFetch();
  const req = (path, init) => new Request('https://x.workers.dev' + path, init);
  let r = await handle(req('/api/v2/snapshot', { headers: { Origin: 'https://danielgergel.github.io' } }), ENV, NOW);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://danielgergel.github.io');
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
  assert.equal((await r.json()).version, 2);
  r = await handle(req('/api/v2/snapshot', { headers: { Origin: 'http://localhost:5173' } }), ENV, NOW);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'http://localhost:5173');
  r = await handle(req('/api/v2/snapshot', { headers: { Origin: 'http://127.0.0.1:8080' } }), ENV, NOW);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'http://127.0.0.1:8080');
  r = await handle(req('/api/v2/snapshot', { headers: { Origin: 'https://evil.example' } }), ENV, NOW);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), null);
  r = await handle(req('/api/v2/snapshot', { method: 'OPTIONS', headers: { Origin: 'https://danielgergel.github.io' } }), ENV, NOW);
  assert.equal(r.status, 204);
  assert.match(r.headers.get('Access-Control-Allow-Methods'), /GET/);
  r = await handle(req('/nope'), ENV, NOW);
  assert.equal(r.status, 404);
  assert.equal((await r.json()).error, 'not_found');
  r = await handle(req('/api/health'), ENV, NOW);
  const h = await r.json();
  assert.equal(h.ok, true);
  assert.equal(h.secrets.twelveData, true);
  assert.ok(!JSON.stringify(h).includes('GEHEIM123'));
  const d = await worker.fetch(req('/api/health'), ENV);
  assert.equal(d.status, 200);
});
