# Makro-Terminal Worker v2

Ein einzelnes Cloudflare-Worker-Modul (`worker.js`), keine Abhaengigkeiten, keine Pflicht-Bindings (nur Secrets; ein KV-Speicher ist optional, siehe unten).
Liefert `GET /api/v2/snapshot`, `POST /api/v2/ingest` (Daten vom ATAS-Indikator) und `GET /api/health`. Der Snapshot enthält Bias Long/Short und Balance/Imbalance (für NQ), normalerweise per QQQ-Proxy, bei frischen ATAS-Daten direkt aus NQ.

## Einfuegen im Cloudflare-Dashboard

1. Cloudflare-Dashboard, Workers & Pages, Worker `makro-terminal-api`, Button "Code bearbeiten" (Edit code).
2. Den kompletten alten Code im Editor markieren und loeschen.
3. Den gesamten Inhalt von `worker/worker.js` einfuegen.
4. "Deploy" klicken.
5. Secrets bleiben unveraendert: `TWELVEDATA_API_KEY` wird benutzt, `FINNHUB_API_KEY` bleibt ungenutzt.
6. Pruefen: `https://makro-terminal-api.danielgergel.workers.dev/api/health` muss `"ok": true` und `"twelveData": true` zeigen. Dann `/api/v2/snapshot` aufrufen.

Hinweis: Der Worker ist als ES-Modul geschrieben (`export default { fetch }`). Die zusaetzlichen Exporte (`buildSnapshot`, `analyze` usw.) ignoriert Cloudflare, sie dienen nur den Tests.
Der Worker braucht keine `wrangler.toml`-Bindings (KV ist optional).

## ATAS-Brücke einrichten (NQ live statt QQQ)

Der ATAS-Indikator schickt alle paar Sekunden NQ-Daten an den Worker. Solange die Daten frisch sind (jünger als 3 Minuten), zeigt das Terminal NQ live aus ATAS an. Kommt nichts mehr an, schaltet es von selbst auf die QQQ-Ersatzdaten zurück.

**Wichtig: Der Worker-Code muss nach dieser Änderung noch einmal komplett eingefügt werden** (Schritte 1 bis 4 oben mit der neuen `worker/worker.js`), sonst kennt der Worker den neuen Weg `/api/v2/ingest` nicht.

### 1. Brücken-Kennwort als Secret anlegen (Pflicht)

1. Du denkst dir selbst ein langes, zufälliges Kennwort aus (mindestens 30 Zeichen, Buchstaben und Zahlen gemischt, am besten aus einem Passwort-Manager). Es ist kein Schlüssel von irgendeinem Dienst, du bestimmst es selbst.
2. Cloudflare-Dashboard, Workers & Pages, Worker `makro-terminal-api`, Reiter **Settings**, Bereich **Variables and Secrets**, **Add**.
3. Typ **Secret**, Name genau `BRIDGE_KEY`, Wert = dein Kennwort. Speichern und deployen.
4. Dasselbe Kennwort trägst du im ATAS-Indikator unter der Einstellung **„Brücken-Kennwort“** ein.
5. Das Kennwort steht nirgends im Code und wird vom Worker nie ausgegeben. Ohne `BRIDGE_KEY` antwortet der Worker auf Daten vom Indikator mit „503 bridge_not_configured“, mit falschem Kennwort mit „401“.

### 2. KV-Speicher anlegen (optional)

Ohne KV merkt sich der Worker die letzten Daten nur im Zwischenspeicher des jeweiligen Cloudflare-Standorts. Das reicht meistens. Mit KV überleben die Daten auch einen Standortwechsel oder Neustart des Workers.

1. Cloudflare-Dashboard, **Storage & Databases**, **KV**, **Create a namespace**, Name z. B. `makro-bridge`.
2. Worker `makro-terminal-api`, **Settings**, **Bindings**, **Add**, **KV namespace**. Variablenname genau `BRIDGE`, Namespace `makro-bridge` auswählen, speichern und deployen.
3. Der Worker schreibt höchstens alle 120 Sekunden in KV (sofort nur, wenn sich Bias oder Regime ändern) und nie mehr als 900-mal pro Tag, damit die Gratis-Grenze von 1000 Schreibzugriffen nicht erreicht wird.

### 3. Prüfen

- `https://makro-terminal-api.danielgergel.workers.dev/api/health` zeigt unter `bridge` ob das Kennwort (`configured`) und KV (`kv`) erkannt wurden.
- Läuft der Indikator, steht in `/api/v2/snapshot` unter `market`: `"source": "atas"` und `"proxy": "NQ"`. Unter `diagnostics.bridge.lastReceivedAgeSeconds` steht, wie lange der letzte Empfang her ist.
- Das Risiko (VIX, Anleihen, Dollar) kommt weiterhin aus den QQQ-Daten. Fällt diese Quelle aus, liefert der Worker die ATAS-Daten trotzdem, nur ohne Risiko-Wert.

## Datenquellen

- Kerzen: Twelve Data `time_series` fuer **QQQ** (NQ-Futures gibt es im Gratis-Tarif nicht), dazu TLT und UUP als Tageskerzen fuer den Risk-Score.
- VIX: FRED-CSV `VIXCLS` (`https://fred.stlouisfed.org/graph/fredgraph.csv?id=VIXCLS`), kein Schluessel. Tagesstand, erscheint mit etwa einem Tag Verzug. Faellt die Quelle aus, ist `risk.vix` `null`.
- Erweiterte Handelszeiten: der Worker fragt 5-Minuten-Kerzen zuerst mit `prepost=true`. Laut Twelve-Data-Doku ist `prepost` nur im Pro-Tarif (und hoeher) verfuegbar. Lehnt der Tarif ab (HTTP/JSON-Code 403, oder 400 mit Hinweis auf Plan/prepost), merkt sich der Worker das 6 Stunden und holt regulaere Zeiten. Was gerade gilt, steht in `diagnostics.twelve.prepost` und `market.extendedHours`.
- Ohne erweiterte Zeiten: ausserhalb 9:30-16:00 New York bleibt der Kurs auf dem letzten regulaeren Stand (`ageSeconds` waechst). Vor 9:30 beziehen sich die Tageswerte (Open, VWAP) noch auf die letzte regulaere Sitzung.

## Abrufbudget (Gratis-Tarif: 8 Credits pro Minute, 800 pro Tag)

Jeder `time_series`-Abruf kostet 1 Credit pro Symbol. Der Worker cached pro Datenart, die Seite darf also alle 30 s fragen, ohne dass Twelve Data jedes Mal gefragt wird.

| Datenart | Abrufe | TTL regulaer (9:30-16:00) | TTL Vor-/Nachboerse | TTL geschlossen |
|---|---|---|---|---|
| QQQ 5 Min | 1 | 120 s | 300 s (ohne prepost: 1800 s) | 3600 s |
| QQQ 1 Std | 1 | 600 s | 1800 s | 7200 s |
| QQQ, TLT, UUP Tag | 3 | 3600 s | 3600 s | 10800 s |
| VIX (FRED) | 0 Credits | 3600 s | 3600 s | 3600 s |

Rechnung fuer einen Handelstag bei ganztags offener Seite (Vorboerse 5,5 h, regulaer 6,5 h, Nachboerse 4 h, geschlossen 8 h):

- 5 Min: regulaer 6,5 h x 30 = 195, Vor-/Nachboerse 9,5 h x 12 = 114 (nur wenn prepost klappt, sonst 9,5 h x 2 = 19), geschlossen 8 = **317** (Gratis-Tarif realistisch ca. 222)
- 1 Std: 6,5 h x 6 = 39, 9,5 h x 2 = 19, geschlossen 4 = **62**
- Tageskerzen: 3 Symbole x (16 h Handelszeit + 3 geschlossen) = **57**
- Summe: ca. **436 Credits** (Gratis-Tarif ohne prepost ca. 341), also unter 800.
- Wochenende bei offener Seite: ca. 24 + 24 + 15 = 63 Credits pro Tag.
- Pro Minute: ein Kaltstart braucht 5 Credits (5 Min, 1 Std, 3 x Tag), plus 1 bei der prepost-Ablehnung, also hoechstens 6 von 8.

Einschraenkungen und Schutz:
- Cloudflares Cache gilt pro Rechenzentrum. Nutzt Daniel das Terminal abwechselnd ueber Orte/Netze mit verschiedenen Rechenzentren, kann sich der Verbrauch vervielfachen (zwei Standorte ca. 870). Deshalb zaehlt der Worker die Abrufe pro Standort und UTC-Tag und liefert ab **700 Abrufen** nur noch gespeicherte Daten (`stale: true`, Hinweis in `diagnostics.errors`).
- Bei Fehler oder Rate-Limit (429) wird 60 s bzw. 120 s nicht erneut abgerufen und der letzte gute Stand mit `stale: true` geliefert.
- Der Tag-Reset bei Twelve Data (UTC-Mitternacht) ist nicht in der Doku bestaetigt; der Worker nimmt UTC an.

## Logik

### Bias (vier Faktoren, je +1 / -1 / 0)

- **tag (Tagesstruktur)**: letzter abgeschlossener Tag. Schluss ueber/unter 20-Tage-Durchschnitt = +1/-1, und hoehere Hochs und Tiefs gegenueber dem Vortag = +1, tiefere = -1. Nur wenn beide gleiche Richtung zeigen (Summe +-2), zaehlt der Faktor, sonst neutral.
- **h1 (Stundenstruktur)**: Swing-Hochs/-Tiefs der Stundenkerzen (ein Swing ist hoeher bzw. tiefer als je 2 Kerzen links und rechts). Die letzten zwei Hochs und die letzten zwei Tiefs beide steigend = Long, beide fallend = Short, sonst neutral.
- **lage**: Kurs ueber Vortageshoch = Long, unter Vortagestief = Short, dazwischen neutral.
- **vwap**: Kurs ueber/unter dem Sitzungs-VWAP der 5-Minuten-Kerzen (regulaere Zeit, Typischer Preis x Volumen) um mehr als 0,05 % = Long/Short, sonst neutral.

Label: Summe >= 2 Long, <= -2 Short, sonst Neutral. Konfidenz: `hoch` bei Betrag >= 3 ohne Gegenfaktor, `mittel` bei Long/Short sonst, `niedrig` bei Neutral.
"Vortag" ist der letzte abgeschlossene Tag vor dem Datum der letzten 5-Minuten-Kerze (am Wochenende also der Donnerstag, wenn Freitag die letzte Sitzung war).

### Regime (Balance / Imbalance)

Fenster: die letzten 24 Fuenf-Minuten-Kerzen (2 Stunden) des Handelstags.
- Effizienz = |Nettobewegung der Schlusskurse| / Summe der Einzelbewegungen. Nahe 0 = Hin und Her, nahe 1 = gerade Linie.
- Imbalance (mit Richtung) beginnt, wenn Effizienz >= 0,38, der Kurs ausserhalb der Spanne (Hoch/Tief) der 18 aeltesten Kerzen des Fensters liegt (Ausbruch), der Ausbruch in Richtung der Nettobewegung zeigt und die Nettobewegung mindestens 0,12 % betraegt.
- Hysterese: die Entscheidung laeuft als Zustandsautomat ueber alle Fenster des Tages. Imbalance bleibt, bis die Effizienz unter 0,28 faellt. Die Richtung wechselt nur bei einem vollstaendigen Gegen-Ausbruch. `since` ist der Zeitpunkt des letzten Wechsels. Ist die letzte Kerze aelter als 30 Minuten, gibt es keine Einordnung (Balance mit Hinweis).
- Alle Schwellen stehen als Konstanten oben in `worker.js`.

### Risk-Score (50 = neutral)

Tagesaenderung in Prozent, jeweils begrenzt auf die "volle Wirkung" und gewichtet: QQQ (Gewicht 30, voll bei +-1,5 %, steigt = Risk-On), VIX (30, +-10 %, steigt = Risk-Off), TLT (20, +-1 %, steigt = Risk-Off) und UUP (20, +-0,5 %, steigt = Risk-Off). Score = 50 + 50 x gewichteter Mittelwert, also 0 bis 100. >= 60 Risk-On, <= 40 Risk-Off. Fehlen Komponenten, wird ueber die vorhandenen gemittelt (mindestens 2 noetig, sonst `null`). `expectedMovePct` = VIX / 16 (erwartete Tagesschwankung).
Die Komponenten-`side` ist `Risk-On`, `Risk-Off` oder `Neutral`.

### Sitzung

Nach Uhrzeit in `America/New_York` (Sommerzeit automatisch): 4:00-9:30 `vorboerse`, 9:30-16:00 `regulaer`, 16:00-20:00 `nachboerse`, sonst und am Wochenende `geschlossen`. Feiertage: Ist die letzte Kerze in der regulaeren Zeit aelter als 20 Minuten (bei vorhandenen erweiterten Daten in Vor-/Nachboerse aelter als 30 Minuten), meldet der Worker `geschlossen`.

## Tests

```
cd worker
node --test test/worker.test.mjs
```

Pruefen die reine Rechenlogik (Zeit/Sommerzeit, Sitzung, VWAP, Swings, Bias, Regime inkl. Hysterese, Risk, VIX-Parser) mit Fixture-Kerzen sowie Cache, prepost-Rueckfall, Fehler-Rueckfall (`stale`) und CORS/Routing mit gemocktem `fetch`. Echte Schluessel kommen darin nicht vor.
