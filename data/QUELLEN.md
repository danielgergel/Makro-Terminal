# Quellen und Datenstand

Abruf aller Quellen: 15.11.2026. Zeitzone `timeET` = New Yorker Ortszeit. Alle Zeiten stammen von der jeweiligen Stelle (BEA-ICS in UTC, von mir in ET umgerechnet).

## Kalender (data/kalender.json)

| Reihe (id) | Quelle / URL | Stand bis | Art |
|---|---|---|---|
| cpi, arbeitsmarkt, ppi, jolts | BLS Release Calendar, https://www.bls.gov/schedule/news_release/cpi.htm, .../empsit.htm, .../ppi.htm, .../jolts.htm | 10.12.2027 (CPI), 03.12.2027 (NFP), 15.12.2027 (PPI), 01.12.2027 (JOLTS) | offiziell. Per curl gesperrt (403 Bot-Schutz), Abruf nur über den Browser. |
| bip, pce | BEA, https://www.bea.gov/news/schedule und ICS https://www.bea.gov/news/schedule/ics/online-calendar-subscription.ics | 22.12.2027 | offiziell, alle drei BIP-Schätzungen und Personal Income and Outlays (PCE) |
| fomc | Federal Reserve, https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm (Stand der Seite 12.11.2026) | 17.11.2027 | offiziell, Entscheidungstag = zweiter Sitzungstag, 14:00 ET. Die Fed nennt alle Termine "tentativ, bis zur Bestätigung in der vorherigen Sitzung". Für 2027 sind keine Projektions-Sitzungen (Sternchen) markiert, Dot Plot daher nur für 09.12.2026 belegt. |
| einzelhandel, neubau | Census Bureau, https://www.census.gov/economic-indicators/calendar-listview-2026.html und https://www.census.gov/economic-indicators/calendar-listview.html (2027) | 15.12.2027 bzw. 22.12.2027 | offiziell |
| adp | ADP Research, https://adpemploymentreport.com/ (Abschnitt "Calendar") | 01.12.2027 | offiziell. Uhrzeit 08:15 ET laut ADP-Pressemitteilung. |
| claims | DOL/ETA, https://oui.doleta.gov/unemploy/claims_arch.asp | 30.12.2027 | **regelbasiert** (donnerstags 08:30 ET, `"regel": true`). Die offizielle Ausnahmeliste nennt Mittwoch 25.11.2026, Mittwoch 10.11.2027, Mittwoch 24.11.2027. Diese drei sind belegt (ohne `regel`). |
| ism_industrie, ism_dienste | ISM, https://www.ismworld.org/supply-management-news-and-reports/reports/rob-report-calendar/ | 01.12.2026 (Industrie), 03.12.2026 (Dienste) | offiziell nur für 2026 veröffentlicht, 10:00 ET. |
| philly | Philadelphia Fed, https://www.philadelphiafed.org/calendar-of-events?release=manufacturing-business-outlook-survey | 17.12.2026 | offiziell nur für 2026 veröffentlicht, 08:30 ET. |
| verbrauchervertrauen | Conference Board, https://www.conference-board.org/topics/consumer-confidence (Economic Indicator Calendar) | 22.12.2026 | offiziell nur bis Dez. 2026 veröffentlicht, 10:00 ET. |

`validUntil` in kalender.json steht bewusst konservativ auf 2026-12-17 (bis dahin sind alle Reihen vollständig). Pro Reihe steht das echte Ende in `seriesUntil`.

## Fehlt (nicht veröffentlicht oder nicht belegbar, bewusst weggelassen)

- ISM Manufacturing/Services PMI ab Januar 2027: ISM hat keinen Plan für 2027 veröffentlicht. Es gilt nur die allgemeine Regel (1. bzw. 3. Werktag, mit Feiertagsausnahmen), daraus wurden keine Termine abgeleitet.
- Philly Fed ab Januar 2027 und Conference Board ab Januar 2027: nicht veröffentlicht.
- Bereits vergangene Termine vor dem 15.11.2026, die die Quellen nicht mehr listen (z. B. ADP-Bericht am 04.11.2026, JOLTS im November 2026): weggelassen.
- Konsens/Prognosen: nicht Teil dieser Dateien.

## Feiertage (data/feiertage.json)

- NYSE: https://www.nyse.com/trade/hours-calendars (Feiertage 2026 bis 2028, verkürzte Tage: 27.11.2026, 24.12.2026, 26.11.2027 jeweils 13:00 ET). Keine weiteren Frühschlüsse im Zeitraum laut NYSE-Fußnoten.
- CME Globex: https://www.cmegroup.com/trading-hours.html (nur per Browser erreichbar, curl 403). Belegt ist nur, dass CME für Thanksgiving, Weihnachten und Neujahr 2026/27 und die 2027-Feiertage eigene Feiertagspläne führt ("Trading hours are subject to change, usually finalized about two weeks prior"). Konkrete Globex-Uhrzeiten für NQ wurden **nicht** übernommen (nur über die interaktive Tabelle je Datum bzw. Download-Kalender abrufbar); in den Notizen steht deshalb "dünne Liquidität" und der Hinweis, die CME-Zeiten zu prüfen.

## Nicht erreichbar / eingeschränkt

- bls.gov und cmegroup.com: per curl blockiert, nur über den Browser des Desktop-Clients gelesen.
- ismworld.org: per curl CAPTCHA (nicht umgangen), über den Browser lesbar.
- DOL-PDF https://www.dol.gov/ui/data.pdf: 403. Stattdessen die Seite oui.doleta.gov verwendet.
- Philly-Fed-URL /mbos-release-dates: 404, stattdessen Produktseite und Kalender.

## Masterliste (assets/masterliste.js)

Quelle: `C:\Users\deeng\Downloads\news masterliste.pdf` (Liste des Mentors), 1:1 übernommen, Schreibweise "Dovisher/Hawkisher" in den Hinweisen aus der PDF. Die Zuordnung `KALENDER_GRUPPEN` ist eine Zuordnung von mir (Kalendertermin zu Einträgen); `fed_chef` und `dot_plot` hängen an `fomc`, obwohl ein Dot Plot nur bei Sitzungen mit Projektionen erscheint.
