# 🛒 SparFuchs – Dein Supermarkt- & Grundpreis-Vergleich

Ein modernes, Open-Source-Tool für effizientes Einkaufen in Deutschland. 
Im Gegensatz zu bestehenden Apps vergleicht **SparFuchs** Angebote von **Lidl, Aldi Nord, REWE, Kaufland, Penny, Edeka, Netto und Norma** postleitzahlgenau und sortiert sie primär nach dem echten **Grundpreis (€/kg oder €/l)**. Zudem optimiert ein intelligenter Algorithmus deine gesamte Einkaufsliste.

---

## ✨ Highlights & Features

1. **🏆 Echte Vergleichbarkeit durch Grundpreis-Sortierung:**
   - Nie wieder von Mogelpackungen (250g vs. 500g) täuschen lassen.
   - Standardisierte Umrechnung aller Angebote auf Basiseinheiten (€/kg, €/l).
   - Hervorhebung des absoluten Grundpreis-Champions mit dem goldenen Badge.

2. **🌟 „Alle Angebote“-Feed & Leere Suche:**
   - Ein Klick auf **„🌟 Alle Angebote“** oder eine leere Suche lädt den kompletten, riesigen Prospekt-Feed (über 700 aktuelle Angebote!) aller Märkte.

3. **🏪 Händlerübergreifend inklusive Aldi Nord & Norma:**
   - Schnelle Filterchips für: **Aldi Nord, Lidl, REWE, Norma, Kaufland, Edeka, Penny, Netto**.
   - Direkte Echtzeit-Anbindung für **Aldi Nord** (230+ Wochenangebote) und **Norma** (380+ Angebote).

4. **💰 Smarte Gesamtersparnis-Berechnung:**
   - Berechnet im Einkaufswagen automatisch, wie viel Geld du insgesamt sparst.
   - Nutzt bei fehlendem Streichpreis (wie oft bei REWE) Quervergleiche mit aktuellen Marktpreisen und Benchmark-Schätzungen.

5. **🌱 Bio & 📦 Non-Food Tag-System:**
   - Schnelles Ein- und Ausblenden von Bio-Produkten (*Gut Bio, K-Bio, Alnatura, Bio Sonne* etc.).
   - Eigener Filter für Nicht-Lebensmittel & Aktionsware (Werkzeug, Garten, Kleidung, Elektronik).

6. **⭐ Favoriten-System:**
   - Produkte mit Stern ⭐ markieren und mit dem Filter **„⭐ Meine Favoriten“** sofort sehen, wenn Lieblingsartikel im Angebot sind.

7. **🛒 Nach Supermarkt gruppierter Einkaufszettel:**
   - Strukturierte Markt-Karten mit Zwischensummen und interaktiver Abhake-Funktion für den Laden.

---

## 🚀 Schnellstart

### Voraussetzungen
* Node.js (v18 oder neuer, v24 empfohlen)

### Installation
```bash
# Im Projektordner
npm install
```

### Starten
```bash
npm start
```
Öffne anschließend deinen Browser unter:  
👉 **[http://localhost:3000](http://localhost:3000)**

---

## 🧪 Tests ausführen

Das Projekt nutzt den nativen Node.js Test-Runner. Es werden alle Unit- und E2E-Tests ausgeführt:

```bash
npm test
```

### Getestete Module:
* **`test/marktguru.test.js`**: Normalisierung von Rohdaten, Fehlerabfang, In-Memory TTL-Caching.
* **`test/comparator.test.js`**: Grundpreis-Standardisierung, Gültigkeitsprüfung, Händler- und App-Filter.
* **`test/optimizer.test.js`**: Single-Store-Champion-Berechnung, Smart-Split-Algorithmus, Missing-Items.
* **`test/server.test.js`**: Express REST-Endpunkte, Validierung, Fehlerbehandlung.
* **`test/e2e.test.js`**: Vollständiger End-to-End Test mit echtem Datenabruf und Frontend-Serving.

---

## 📁 Projektstruktur

```
j:/Einkaufen/
├── public/                 # Modernes Frontend
│   ├── index.html          # Semantische HTML5-Struktur
│   ├── style.css           # Glassmorphism Design-System
│   └── app.js              # Interaktive Client-Logik & Caching
├── src/
│   ├── api/
│   │   └── marktguru.js    # API Client & Normalizer mit TTL-Cache
│   ├── engine/
│   │   ├── comparator.js   # Grundpreis-Sortierung & Filterung
│   │   └── optimizer.js    # Single-Store & Smart-Split-Algorithmus
│   └── server.js           # Express REST API Server
├── test/                   # Automatisierte Testsuite (19 Tests)
│   ├── marktguru.test.js
│   ├── comparator.test.js
│   ├── optimizer.test.js
│   ├── server.test.js
│   └── e2e.test.js
├── package.json
└── README.md
```
