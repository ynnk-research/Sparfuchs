# 🛒 SparFuchs – Intelligenter Supermarkt- & Grundpreis-Vergleich

Ein modernes, hocheffizientes Open-Source-Tool für preisbewusstes Einkaufen in Deutschland. 
**SparFuchs** aggregiert und vergleicht aktuelle Wochenangebote von **Lidl, Aldi Nord, REWE, Kaufland, Penny, Edeka, Netto und Norma** postleitzahlgenau, standardisiert sie auf den echten **Grundpreis (€/kg oder €/l)**, optimiert Einkaufsrouten und bietet ein vollständiges digitales Haushaltsbuch inklusive Jahresersparnis-Projektion.

---

## ✨ Features & Highlights

### 1. 🏆 Echte Vergleichbarkeit durch Grundpreis-Sortierung
- **Schluss mit Mogelpackungen:** Standardisierte Umrechnung aller Angebote auf Basiseinheiten (€/kg, €/l), unabhängig von Packungsgrößen (z. B. 150g vs. 250g vs. 500g).
- **Grundpreis-Champion:** Automatische visuelle Hervorhebung des Produkts mit dem absolut günstigsten Grundpreis in jeder Suchanfrage.
- **Plausibilitätsprüfung & Preisbereinigung:** Erkennt und filtert unplausible Streichpreise und API-Ausreißer automatisch heraus.

### 2. 🏪 Händlerübergreifend & Multikanal-Anbindung
- **Discounter & Vollsortimenter:** Direkte Filter für **Aldi Nord, Lidl, REWE, Norma, Kaufland, EDEKA, Penny und Netto**.
- **Direktanbindungen:**
  - **Aldi Nord:** Eigener Algolia-Search-Crawler mit über 200+ frischen Wochenartikeln.
  - **Norma:** Automatischer Web-Parser mit über 380+ Angeboten inklusive Aktionsware.
  - **Marktguru & EDEKA-Schnittstelle:** Umfassende Prospekt- und Filialdaten für maximale Marktabdeckung.

### 3. ⚡ Favoriten-Radar & Deal-Alarm
- **Automatischer Prospekt-Abgleich:** Sobald du Artikel mit dem Stern ⭐ favorisierst, durchleuchtet der Radar alle aktuellen Wochenangebote deiner PLZ nach Treffern.
- **Prominentes Startseiten-Banner:** Pulsierendes Deal-Alarm-Widget mit Direktanzeige von Supermarkt, Streichpreis, Ersparnis und 1-Klick-Übernahme in die Einkaufsliste.

### 4. 🛒 Smarter Einkaufszettel mit Mengen-Auswahl (`+/-`)
- **Stückzahl-Steuerung:** Flexibles Einstellen der Stückzahlen (`[-] 1 [+]`) direkt auf dem Einkaufszettel.
- **Dynamische Skalierung:** Automatische Neuberechnung von Stückpreisen, Filial-Zwischensummen, Regulärwerten und Gesamtersparnissen in Echtzeit.
- **Supermarkt-Gruppierung:** Übersichtliche Aufteilung der Artikel nach Filiale für den schnellen Rundgang im Geschäft.
- **One-Tap Checkboxen:** Artikel direkt im Supermarkt beim Durchlaufen der Regale mit einem Fingertipp abhaken.

### 5. 📤 1-Klick Einkaufsliste Teilen (WhatsApp & Messenger)
- **Web Share API Integration:** Auf Smartphones öffnet ein Klick direkt das native Teilen-Menü (WhatsApp, Telegram, Signal, Apple Notizen). Am Desktop wird der Text sauber in die Zwischenablage kopiert.
- **Strukturierter Format-Export:** Gruppiert nach Märkten, mit Kontrollkästchen (◻️/☑️), Stückzahlen, Einzelpreisen und Gesamtersparnis.

### 6. 🧠 Multimarkt-Einkaufsoptimierer (Single-Store vs. Smart-Split)
- **Single-Store Champion:** Ermittelt den Supermarkt, der den günstigsten Gesamtpreis für deine gesamte Wunschliste bietet (wenn du nur in einen Laden möchtest).
- **Smart Split (2 Läden):** Berechnet die mathematisch beste Aufteilung auf zwei Geschäfte und zeigt dir exakt, wie viel Geld du durch den zweiten Stop sparst.

### 7. 📊 Haushaltsbuch, Beleg-Historie & Vorrats-Kalkulator
- **Einkauf verbuchen:** Verbuchte Einkaufszettel werden dauerhaft als digitale Belege archiviert.
- **Haushalts-Dashboard:**
  - Kumulierte Gesamtersparnis und Durchschnitts-Sparquote in Prozent.
  - **Top-Sparmärkte:** Visuelles Ranking, in welchen Supermärkten du absolut am meisten sparst.
  - **Monatsverlauf:** Historische Haushaltsentwicklung und Ausgabenübersicht.
  - **Vorrats-Kalkulator (Jahres-Projektion):** Empirische Hochrechnung der Jahresersparnis ($\varnothing\text{ Ersparnis je Einkauf} \times 52\text{ Wochen}$) und monatlichen Budgetentlastung.

### 8. 🏷️ Echte Warengruppen & semantische Filter
- **8 vordefinierte Kategorien:** *Molkerei & Eier, Obst & Gemüse, Fleisch & Fisch, Kaffee & Getränke, Vorrat & Grundnahrung, Süßes & Snacks, Drogerie & Haushalt, Aktionsware*.
- **Spezialfilter:** *Nur Lebensmittel*, *🌱 Bio-Produkte* (Gut Bio, K-Bio, Alnatura etc.), *📦 Non-Food* und *Kein App-Zwang* (schließt Angebote aus, die Kundenkarten-Apps wie Lidl Plus erfordern).

### 9. 📱 Mobile-First Glassmorphic Design
- Ausgelegt für mobile Nutzung direkt im Supermarkt: Schwebender Floating Action Button (FAB) für schnellen Zugriff auf den Einkaufszettel, intuitive Drawer-Navigation und haptisch optimierte Touch-Targets ($\ge 44$px).

---

## 🚀 Schnellstart

### Voraussetzungen
* **Node.js**: Version 18 oder neuer (Version 20+ empfohlen)
* **npm**: Standardmäßig bei Node.js enthalten

### Installation

```bash
# Im Projektverzeichnis
npm install
```

### Server starten

```bash
# Startet den Server im Produktionsmodus
npm start

# Alternativ für die Entwicklung mit automatischem Reload
npm run dev
```

Öffne anschließend deinen Browser unter:  
👉 **[http://localhost:3000](http://localhost:3000)**

---

## 🧪 Automatisierte Testsuite

Das Projekt nutzt den nativen, schnellen Test-Runner von Node.js (`node --test`). Es sind **42 Unit- und End-to-End-Tests** implementiert:

```bash
npm test
```

### Test-Abdeckung nach Modulen:
* **`test/history.test.js`**: Haushaltsbuch-KPIs, Monatsaggregation, Supermarkt-Ranking, Spin-Down-Sync und Vorrats-Jahresprojektion.
* **`test/comparator.test.js`**: Grundpreis-Standardisierung, Gültigkeitsprüfung, Händler-, Bio- und App-Zwang-Filter.
* **`test/categories.test.js`**: Automatische Erkennung und Klassifizierung von Angeboten in Warengruppen.
* **`test/pricing_sanitization.test.js`**: Erkennung und Filterung unrealistischer Streichpreise und Fake-Marken (`thisisnobrand123`).
* **`test/optimizer.test.js`**: Single-Store-Champion, Smart-Split-Optimierung und Behandlung fehlender Artikel.
* **`test/savings.test.js`**: Berechnung von Streichpreis- und Markt-Benchmark-Ersparnissen.
* **`test/cache.test.js`**: Multi-Tier-Speicher (In-Memory + Disk-Persistenz mit automatischer TTL-Invalidierung).
* **`test/aldinord.test.js` & `test/norma.test.js` & `test/edeka.test.js`**: Parser- und Normalisierungs-Logik für externe Marktdaten.
* **`test/server.test.js` & `test/e2e.test.js`**: Vollständige REST-API-Validierung und E2E-Flows.

---

## 🌐 24/7 Hosting (Render.com & UptimeRobot)

SparFuchs kann vollständig kostenlos in der Cloud gehostet werden (z. B. auf **Render.com**):

1. **Repository verbinden:** Repository auf GitHub pushen und bei Render als *Web Service* anlegen, Free Tier.
2. **Spin-Down-Schutz:** Damit der kostenlose Render-Dienst nicht einschläft, kann ein kostenloser Monitor auf [UptimeRobot.com](https://uptimerobot.com) mit einem **14-Minuten-Intervall** auf deine URL  eingerichtet werden.
3. **Resiliente Datenhaltung:** Bei einem eventuellen Kaltstart des Servers synchronisiert der Client Belege und Einkaufsstatistiken automatisch via `POST /api/history/sync` aus dem `localStorage`.

---

## 📁 Projektarchitektur

```
j:/Einkaufen/
├── public/                       # Responsives Frontend (Vanilla JS & Modern CSS)
│   ├── index.html                # Semantische HTML5-Struktur mit Drawers & Radar
│   ├── style.css                 # Glassmorphic Design-System, Mobile-Optimierung & KPIs
│   └── app.js                    # Client-State, Mengensteuerung, WhatsApp-Share & Radar
├── src/
│   ├── api/                      # Anbindung externer Supermarkt-Datenquellen
│   │   ├── aldinord.js           # Direkte Algolia-Anbindung für Aldi Nord
│   │   ├── cache.js              # Multi-Tier Persistent Cache (RAM + Disk)
│   │   ├── edeka.js              # EDEKA Prospekt-Schnittstelle
│   │   ├── marktguru.js          # Marktguru API-Client (Lidl, REWE, Kaufland etc.)
│   │   └── norma.js              # HTML-Parser für Norma-Angebote
│   ├── engine/                   # Business-Logik & Algorithmen
│   │   ├── categories.js         # Intelligente Warengruppen-Klassifizierung
│   │   ├── comparator.js         # Grundpreis-Berechnung, Validierung & Filter
│   │   ├── history.js            # Haushaltsbuch, KPIs & Jahresersparnis-Projektion
│   │   └── optimizer.js          # Single-Store & Smart-Split-Algorithmus
│   └── server.js                 # Express REST-API Server & Endpunkte
├── test/                         # 42 Automatisierte Unit- & E2E-Tests
│   ├── aldinord.test.js
│   ├── cache.test.js
│   ├── categories.test.js
│   ├── comparator.test.js
│   ├── e2e.test.js
│   ├── edeka.test.js
│   ├── history.test.js
│   ├── marktguru.test.js
│   ├── norma.test.js
│   ├── optimizer.test.js
│   ├── pricing_sanitization.test.js
│   ├── savings.test.js
│   └── server.test.js
├── package.json
└── README.md
```

---

## 🛡️ Datenschutz & Unabhängigkeit
- **100 % werbefrei und unabhängig.**
- Keine Tracker, keine Cookies von Drittanbietern.
- Alle Einkaufszettel und Favoriten werden lokal im Browser (`localStorage`) gespeichert. Verbuchte Belege verbleiben im privaten Server-Speicher.
