// NQ News Masterliste – 1:1 aus "news masterliste.pdf" (Liste des Mentors) übernommen.
// Schreibweise und Regeln stammen aus der PDF und wurden nicht verändert.
// typ:   "zahl" = Ist gegen Prognose; "ton" = dovish/hawkish/wie erwartet; "inhalt" = kein pauschaler Bias
// regel: "hoeher_short" | "hoeher_long" | "dovish_long" | null (bei typ "inhalt" bzw. reinen Zins-Fällen)
// trendMin/trendMax = Trendtage-Wahrscheinlichkeit in Prozent (null = in der PDF nicht angegeben)
window.MASTERLISTE = [
  // ⭐⭐⭐⭐⭐ Sehr wichtig – Bestimmt den Bias häufig deutlich
  { id: "fomc_zins", name: "Fed-Zinsentscheidung / FOMC", sterne: 5, trendMin: 80, trendMax: 90,
    typ: "ton", regel: "dovish_long",
    hinweis: "Dovisher als erwartet = LONG NQ; Hawkisher als erwartet = SHORT NQ. Nicht die reine Zinsentscheidung zählt, sondern Entscheidung vs. Markterwartung. Zusätzlich auf Statement, Dot Plot und Pressekonferenz achten.",
    optionen: [
      { text: "Größere Zinssenkung als erwartet", ergebnis: "Long" },
      { text: "Zinssenkung wie erwartet", ergebnis: "Neutral" },
      { text: "Kleinere Zinssenkung als erwartet", ergebnis: "Short" },
      { text: "Keine Senkung trotz erwarteter Senkung", ergebnis: "Short" },
      { text: "Zinsen unverändert wie erwartet", ergebnis: "Neutral" },
      { text: "Keine Erhöhung trotz erwarteter Erhöhung", ergebnis: "Long" },
      { text: "Unerwartete Zinserhöhung", ergebnis: "Short" }
    ] },
  { id: "cpi_monat", name: "Verbraucherpreisindex (VPI / CPI) Monat", sterne: 5, trendMin: 70, trendMax: 80,
    typ: "zahl", regel: "hoeher_short",
    hinweis: "Misst die Inflation beim Verbraucher. Höher als Prognose = SHORT NQ; niedriger als Prognose = LONG NQ.", optionen: null },
  { id: "cpi_jahr", name: "Verbraucherpreisindex (VPI / CPI) Jahr", sterne: 5, trendMin: 70, trendMax: 80,
    typ: "zahl", regel: "hoeher_short",
    hinweis: "Einer der wichtigsten Inflationsindikatoren.", optionen: null },
  { id: "core_cpi", name: "Verbraucherpreisindex Kernrate (Core CPI)", sterne: 5, trendMin: 70, trendMax: 80,
    typ: "zahl", regel: "hoeher_short",
    hinweis: "Besonders wichtig, weil volatile Komponenten herausgerechnet werden.", optionen: null },
  { id: "core_pce", name: "PCE Kernrate (Monat / Jahr)", sterne: 5, trendMin: 65, trendMax: 75,
    typ: "zahl", regel: "hoeher_short",
    hinweis: "Zentraler Inflationsindikator für die Fed.", optionen: null },
  { id: "nfp", name: "Non-Farm Payrolls (NFP)", sterne: 5, trendMin: 60, trendMax: 70,
    typ: "zahl", regel: "hoeher_short",
    hinweis: "Einer der wichtigsten Arbeitsmarktberichte. Beispiel: Prognose 55K, tatsächlicher Wert 162K = Arbeitsmarkt deutlich stärker als erwartet = SHORT-Bias NQ.", optionen: null },
  { id: "stundenloehne", name: "Durchschnittliche Stundenlöhne", sterne: 5, trendMin: 60, trendMax: 70,
    typ: "zahl", regel: "hoeher_short",
    hinweis: "Höhere Löhne können zusätzlichen Inflationsdruck bedeuten.", optionen: null },
  { id: "arbeitslosenquote", name: "Arbeitslosenquote", sterne: 5, trendMin: 60, trendMax: 70,
    typ: "zahl", regel: "hoeher_long",
    hinweis: "Hier läuft die Logik umgekehrt: höhere Arbeitslosigkeit = schwächerer Arbeitsmarkt. Höher = LONG NQ; niedriger = SHORT NQ.", optionen: null },

  // ⭐⭐⭐⭐ Wichtig – Bestimmt den Bias häufig
  { id: "bip", name: "Bruttoinlandsprodukt (BIP / GDP)", sterne: 4, trendMin: 55, trendMax: 65,
    typ: "zahl", regel: "hoeher_short",
    hinweis: "Zeigt das Wirtschaftswachstum.", optionen: null },
  { id: "claims", name: "Erstanträge Arbeitslosenhilfe", sterne: 4, trendMin: 50, trendMax: 60,
    typ: "zahl", regel: "hoeher_long",
    hinweis: "Mehr Anträge = schwächerer Arbeitsmarkt. Höher = LONG NQ; niedriger = SHORT NQ.", optionen: null },
  { id: "einzelhandel", name: "Einzelhandelsumsätze / Kernrate", sterne: 4, trendMin: 40, trendMax: 50,
    typ: "zahl", regel: "hoeher_short",
    hinweis: "Zeigt die Stärke des Konsums.", optionen: null },
  { id: "jolts", name: "JOLTS Stellenangebote", sterne: 4, trendMin: 40, trendMax: 50,
    typ: "zahl", regel: "hoeher_short",
    hinweis: "Mehr offene Stellen sprechen tendenziell für einen stärkeren Arbeitsmarkt.", optionen: null },
  { id: "adp", name: "ADP Beschäftigungsänderung", sterne: 4, trendMin: 40, trendMax: 50,
    typ: "zahl", regel: "hoeher_short",
    hinweis: "Privater Arbeitsmarktbericht vor den offiziellen Arbeitsmarktdaten.", optionen: null },

  // ⭐⭐⭐ Mittlere Bedeutung
  { id: "ism_pmi", name: "PMI / EMI / ISM", sterne: 3, trendMin: 35, trendMax: 45,
    typ: "zahl", regel: "hoeher_short",
    hinweis: "Zeigt die Aktivität in Industrie und Dienstleistungen.", optionen: null },
  { id: "verbrauchervertrauen", name: "CB Verbrauchervertrauen", sterne: 3, trendMin: 35, trendMax: 45,
    typ: "zahl", regel: "hoeher_short",
    hinweis: "Zeigt die Stimmung der Verbraucher.", optionen: null },
  { id: "philly", name: "Philly Fed", sterne: 3, trendMin: 30, trendMax: 40,
    typ: "zahl", regel: "hoeher_short",
    hinweis: "Regionaler Frühindikator für die Industrie.", optionen: null },

  // ⭐⭐ Geringere Bedeutung
  { id: "ppi", name: "Erzeugerpreisindex (EPI / PPI)", sterne: 2, trendMin: 30, trendMax: 40,
    typ: "zahl", regel: "hoeher_short",
    hinweis: "Misst die Preisentwicklung auf Produzentenebene.", optionen: null },
  { id: "neubau", name: "Verkäufe neuer Häuser", sterne: 2, trendMin: 20, trendMax: 30,
    typ: "zahl", regel: "hoeher_short",
    hinweis: "Zeigt die Stärke des Immobilienmarktes.", optionen: null },

  // ⭐ Ereignisse
  { id: "fed_chef", name: "Fed-Chef spricht", sterne: 1, trendMin: null, trendMax: null,
    typ: "ton", regel: "dovish_long",
    hinweis: "Dovisher als erwartet = LONG NQ; Hawkisher als erwartet = SHORT NQ; keine neuen Informationen = NEUTRAL. Kann besonders bei Aussagen zum zukünftigen Zinspfad starke Bewegungen auslösen.", optionen: null },
  { id: "dot_plot", name: "Fed Dot Plot", sterne: 1, trendMin: null, trendMax: null,
    typ: "ton", regel: "dovish_long",
    hinweis: "Niedrigerer Zinspfad als erwartet = LONG NQ; höherer Zinspfad als erwartet = SHORT NQ; wie erwartet = NEUTRAL. Zeigt, welchen zukünftigen Zinspfad die FOMC-Mitglieder für angemessen halten.", optionen: null },
  { id: "us_praesident", name: "US-Präsident spricht", sterne: 1, trendMin: null, trendMax: null,
    typ: "inhalt", regel: null,
    hinweis: "Besonders relevant bei Aussagen zu Zöllen, Handel, Steuern, Wirtschaft, Fed und geopolitischen Entscheidungen mit Marktfolgen. Kein pauschaler LONG-/SHORT-Bias – der Inhalt der Aussage entscheidet.", optionen: null }
];

// Zuordnung Kalendertermin (id in kalender.json) -> Masterlisten-Einträge
window.KALENDER_GRUPPEN = {
  fomc: ["fomc_zins", "dot_plot", "fed_chef"],
  cpi: ["cpi_monat", "cpi_jahr", "core_cpi"],
  pce: ["core_pce"],
  arbeitsmarkt: ["nfp", "stundenloehne", "arbeitslosenquote"],
  bip: ["bip"],
  claims: ["claims"],
  einzelhandel: ["einzelhandel"],
  jolts: ["jolts"],
  adp: ["adp"],
  ism_industrie: ["ism_pmi"],
  ism_dienste: ["ism_pmi"],
  verbrauchervertrauen: ["verbrauchervertrauen"],
  philly: ["philly"],
  ppi: ["ppi"],
  neubau: ["neubau"]
};
