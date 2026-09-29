# 🛒 SparFuchs – Intelligenter Supermarkt- & Grundpreis-Vergleich

Ein modernes, hocheffizientes Open-Source-Tool für preisbewusstes Einkaufen in Deutschland. 
**SparFuchs** sammelt aktuelle Wochenangebote von **Lidl, Aldi Nord, REWE, Kaufland, Penny, Edeka, Netto und Norma**, vergleicht Grundpreise, unterstützt Einkaufslisten und zeigt Haushaltsausgaben. Die Ortsgenauigkeit hängt von der Datenquelle ab: Marktguru nutzt die PLZ, EDEKA einen Markt nahe der PLZ; einige Kettenfeeds sind nicht filialgenau.

---

## ✨ Features & Highlights

### 1. 🏆 Echte Vergleichbarkeit durch Grundpreis-Sortierung
- **Schluss mit Mogelpackungen:** Standardisierte Umrechnung aller Angebote auf Basiseinheiten (€/kg, €/l), unabhängig von Packungsgrößen (z. B. 150g vs. 250g vs. 500g).
- **Grundpreis-Champion:** Hervorhebung nur bei einer konkreten Suche mit Angeboten derselben Kategorie und Maßeinheit. Aus Packungsangaben berechnete Grundpreise sind gekennzeichnet.
- **Plausibilitätsprüfung & Preisbereinigung:** Erkennt und filtert unplausible Streichpreise und API-Ausreißer automatisch heraus.

### 2. 🏪 Händlerübergreifend & Multikanal-Anbindung
- **Discounter & Vollsortimenter:** Direkte Filter für **Aldi Nord, Lidl, REWE, Norma, Kaufland, EDEKA, Penny und Netto**.
- **Direktanbindungen:**
  - **Aldi Nord:** Eigener Algolia-Search-Crawler mit über 200+ frischen Wochenartikeln.
  - **Norma:** Automatischer Web-Parser mit über 380+ Angeboten inklusive Aktionsware.
- **Angebotsquellen:** Marktguru und EDEKA liefern Angebotsdaten; weitere Kettenfeeds ergänzen die Suche. Die konkrete Filialsuche nutzt OpenStreetMap.
- **Echte Filialen wählen:** Im Markt-Dialog eine Kette wählen, bei einer PLZ oder im sichtbaren Kartenausschnitt suchen und einen Marker anklicken. Pro Kette wird genau eine Filiale gespeichert; ein Link öffnet ihren Standort in Google Maps. Die Angebotsdaten bleiben Kettendaten und bestätigen nicht die Verfügbarkeit in genau dieser Filiale.

### 3. 🛡️ Strikte Supermarkt-Prüfung & Meine Märkte Manager (v2.0)
- **Echte Supermärkte only:** Verhindert das Auftauchen von Möbelhäusern oder Baumärkten (XXXLutz, POCO, OBI etc.) in Suchergebnissen.
- **Aktive Märkte steuern:** Im Dialog **„🏪 Meine Supermärkte“** wählst du auf einer Karte eine konkrete Filiale je gewünschter Kette. Nur Angebote dieser Ketten erscheinen danach in Suche und Optimierer.

### 4. 💡 Deal-Swap: Günstigere Alternative vergleichen & 1-Klick tauschen (v2.0)
- **Automatischer Preisvergleich im Warenkorb:** Sobald du ein Produkt auf die Liste setzt, prüft SparFuchs, ob dasselbe oder ein vergleichbares Produkt bei einem deiner anderen aktiven Supermärkte günstiger ist.
- **Smartes Tauschen:** Ein Klick auf **„🔄 Tauschen“** öffnet die Übersicht aller verfügbaren Alternativen und tauscht den Artikel mit Ersparnisberechnung sofort aus.

### 5. 🔥 Mindestrabatt-Filter (v2.0)
- **Fokus auf echte Schnäppchen:** Schneller Filter nach Mindestnachlass (`Alle`, `Ab -20%`, `Ab -30% 🔥`, `Ab -50% 💥`).

### 6. ⭐ Favoriten-Manager & Generische Favoriten (v2.0)
- **Zentraler Favoriten-Hub:** Eigener Dialog zur Verwaltung deiner Lieblingsprodukte.
- **Generische Favoriten:** Trage allgemeine Lieblingsartikel wie *„Bio Eier“*, *„Hafermilch“* oder *„Olivenöl“* ein. Der **Favoriten-Radar** schlägt sofort an, sobald ein passender Deal bei deinen Supermärkten erscheint.

### 7. 📊 Interaktiv sortierbare Vergleichstabelle (v2.0)
- **Kopfzeilen-Sortierung:** 1-Klick Sortierung der Vergleichstabelle direkt über die Spaltenköpfe (*Produkt, Händler, Ladenpreis, Grundpreis, Rabatt, Gültigkeit*) mit visuellen Richtungsanzeigern (▲/▼/⇅).

### 8. 🍳 Rezept-Import & Optimierer-Upgrade (v2.0)
- **Chefkoch & offene Rezeptseiten:** Füge einen Link oder eine Freitext-Zutatenliste ein. SparFuchs extrahiert nach offiziellem W3C Schema.org JSON-LD Standard die Zutaten und fügt sie mit 1 Klick in deine Liste ein.
- **Optimierte Angebote übernehmen:** Die vom Optimierer berechneten Champion- oder Smart-Split-Deals können mit 1 Klick direkt in den Einkaufszettel übernommen werden.
- **Favoriten in Optimierer laden:** Mit einem Klick alle deine gespeicherten Favoriten in die Einkaufsoptimierung einspielen.

### 9. 🖼️ Produkt-Thumbnails im Einkaufszettel (v2.0)
- **Bessere Orientierung:** Kompakte Produktbilder direkt neben jedem Artikel auf deiner Einkaufsliste für den schnellen Blick im Supermarktregal.

### 10. ⚡ Favoriten-Radar & Deal-Alarm
- **Automatischer Prospekt-Abgleich:** Sobald du Artikel favorisierst, durchleuchtet der Radar alle aktuellen Wochenangebote deiner PLZ nach Treffern.
- **Prominentes Startseiten-Banner:** Pulsierendes Deal-Alarm-Widget mit Direktanzeige von Supermarkt, Streichpreis, Ersparnis und 1-Klick-Übernahme in die Einkaufsliste.

### 11. 🛒 Smarter Einkaufszettel mit Mengen-Auswahl (`+/-`)
- **Stückzahl-Steuerung:** Flexibles Einstellen der Stückzahlen (`[-] 1 [+]`) direkt auf dem Einkaufszettel.
- **Dynamische Skalierung:** Automatische Neuberechnung von Stückpreisen, Filial-Zwischensummen, Regulärwerten und Gesamtersparnissen in Echtzeit.
- **Supermarkt-Gruppierung:** Übersichtliche Aufteilung der Artikel nach Filiale für den schnellen Rundgang im Geschäft.
- **One-Tap Checkboxen:** Artikel direkt im Supermarkt beim Durchlaufen der Regale mit einem Fingertipp abhaken.

### 12. 📲 Nahtlose QR-Code Übertragung (PC ➔ Smartphone)
- **Zero Friction:** Am PC gemütlich die Angebote durchstöbern und den Einkaufszettel zusammenstellen.
- **1-Klick QR-Code:** Ein Klick auf **„📱 QR-Code“** im Warenkorb generiert einen scanbaren Code auf dem Monitor. Der Link zeigt auf denselben Server, der die Liste speichert.
- **Sofortiger Import:** Einfach mit der Smartphone-Kamera scannen – die Einkaufsliste öffnet sich direkt auf dem Handy. Kein Account, keine App-Installation nötig.
- **Gültigkeit:** Shares laufen nach 24 Stunden ab und liegen in `.cache/shares`. Für eine verlässliche Gültigkeit über Deployments hinweg braucht die Installation persistenten Speicher.

### 13. 📤 1-Klick Einkaufsliste Teilen (WhatsApp & Messenger)
- **Web Share API Integration:** Auf Smartphones öffnet ein Klick direkt das native Teilen-Menü (WhatsApp, Telegram, Signal, Apple Notizen). Am Desktop wird der Text sauber in die Zwischenablage kopiert.
- **Strukturierter Format-Export:** Gruppiert nach Märkten, mit Kontrollkästchen (◻️/☑️), Stückzahlen, Einzelpreisen und Gesamtersparnis.

### 14. 🧠 Multimarkt-Einkaufsoptimierer (Single-Store vs. Smart-Split)
- **Single-Store Champion:** Ermittelt den Supermarkt mit dem günstigsten Gesamtpreis für deine Wunschliste.
- **Smart Split (2 Läden):** Berechnet die beste Aufteilung auf zwei Geschäfte und zeigt dir exakt deine zusätzliche Ersparnis.

### 15. 📊 Haushaltsbuch, Beleg-Historie & Vorrats-Kalkulator
- **Einkauf verbuchen:** Vor dem Speichern lassen sich tatsächlich bezahlte Preise und nicht verfügbare Artikel korrigieren. Nicht gekaufte Artikel bleiben auf der Liste.
- **Haushalts-Dashboard:**
  - Kumulierte Gesamtersparnis und Durchschnitts-Sparquote in Prozent.
  - **Top-Sparmärkte:** Visuelles Ranking, in welchen Supermärkten du absolut am meisten sparst.
  - **Monatsverlauf:** Historische Haushaltsentwicklung und Ausgabenübersicht.
  - **Vorrats-Kalkulator (Jahres-Projektion):** Empirische Hochrechnung der Jahresersparnis ($\varnothing\text{ Ersparnis je Einkauf} \times 52\text{ Wochen}$) und monatlichen Budgetentlastung.

### 16. Wiederkehrende Listen, Wegeaufwand und Import
- Einkaufslisten können als Vorlage gespeichert und später mit aktuellen Angeboten neu optimiert werden.
- Für einen zweiten Markt lässt sich ein eigener Wege- und Zeitkostenbetrag angeben. Die Nettoersparnis wird nur bei gleicher Artikelabdeckung verglichen.
- Haushaltsbelege können als JSON gesichert und wiederhergestellt werden. CSV bleibt für Tabellenprogramme verfügbar.
- Die installierte PWA kann über das Teilen-Menü einen Rezeptlink oder Zutatentext entgegennehmen, sofern der Browser Web Share Target unterstützt.

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

Das Projekt nutzt den nativen Test-Runner von Node.js (`node --test`). Die lokale Suite umfasst derzeit **69 Tests**; drei Tests für echte Angebotsquellen werden standardmäßig übersprungen, damit `npm test` ohne Internet zuverlässig läuft:

```bash
npm test
```

Für eine zusätzliche Prüfung der Live-Anbindungen in PowerShell:

```powershell
$env:LIVE_OFFERS_TESTS = '1'
npm test
Remove-Item Env:LIVE_OFFERS_TESTS
```

Live-Ergebnisse hängen von externen Diensten und deren Verfügbarkeit ab.

### Test-Abdeckung nach Modulen:
* **`test/recipe.test.js`**: Schema.org JSON-LD Parser, Zutatenerkennung und Rezept-Import Endpunkt.
* **`test/comparator.test.js`**: Supermarkt-Whitelist, Non-Food-Schutz, Mindestrabatt, erlaubte Märkte und Grundpreis-Standardisierung.
* **`test/qr_share.test.js`**: Erstellung und Abruf von QR-Code Shares, Verifizierung der Data-URLs und Endpunkte.
* **`test/history.test.js`**: Haushaltsbuch-KPIs, Monatsaggregation, Supermarkt-Ranking, Spin-Down-Sync und Vorrats-Jahresprojektion.
* **`test/categories.test.js`**: Automatische Erkennung und Klassifizierung von Angeboten in Warengruppen.
* **`test/pricing_sanitization.test.js`**: Erkennung und Filterung unrealistischer Streichpreise und Fake-Marken (`thisisnobrand123`).
* **`test/optimizer.test.js`**: Single-Store-Champion, Smart-Split-Optimierung und Behandlung fehlender Artikel.
* **`test/savings.test.js`**: Berechnung von Streichpreis- und Markt-Benchmark-Ersparnissen.
* **`test/cache.test.js`**: Multi-Tier-Speicher (In-Memory + Disk-Persistenz mit automatischer TTL-Invalidierung).
* **`test/aldinord.test.js` & `test/norma.test.js` & `test/edeka.test.js`**: Parser- und Normalisierungs-Logik für externe Marktdaten.
* **`test/server.test.js` & `test/e2e.test.js`**: Vollständige REST-API-Validierung und E2E-Flows.

---

## 🌐 Betrieb

- Für veröffentlichte Installationen HTTPS verwenden. Service Worker, Teilen und Wake Lock benötigen einen sicheren Browser-Kontext.
- `.cache` muss persistent sein, wenn QR-Shares und Belege einen Neustart oder ein Deployment überstehen sollen. Bei flüchtigem Speicher kann der Browser eigene Belege nach einem Server-Neustart wieder synchronisieren; QR-Shares aus einem gelöschten Server-Speicher gehen verloren.
- Hinter einem Reverse Proxy kann `PUBLIC_BASE_URL=https://deine-domain.example` gesetzt werden, damit QR-Links die richtige öffentliche Adresse enthalten.
- Die Filialsuche nutzt die öffentliche Overpass-API und Zippopotam.us mit einem 24-Stunden-Cache. Für größere Nutzung eine eigene oder vertraglich geeignete Datenschnittstelle vorsehen. OpenStreetMap-Attribution muss sichtbar bleiben.
- Der Server benötigt ausgehende HTTPS-Verbindungen zu den Angebotsquellen, Zippopotam.us und Overpass. Die Kartenkacheln lädt der Browser von OpenStreetMap.

---

## 📁 Projektarchitektur

```
j:/Einkaufen/
├── public/                       # Responsives Frontend (Vanilla JS & Modern CSS)
│   ├── index.html                # Semantische HTML5-Struktur mit Drawers & Modals
│   ├── style.css                 # Glassmorphic Design-System, Mobile-Optimierung & KPIs
│   └── app.js                    # Client-State, Meine Märkte, Deal-Swap, Rezepte & Sortierung
├── src/
│   ├── api/                      # Anbindung externer Supermarkt-Datenquellen
│   │   ├── aldinord.js           # Direkte Algolia-Anbindung für Aldi Nord
│   │   ├── cache.js              # Multi-Tier Persistent Cache (RAM + Disk)
│   │   ├── edeka.js              # EDEKA Prospekt-Schnittstelle
│   │   ├── marktguru.js          # Marktguru API-Client (Lidl, REWE, Kaufland etc.)
│   │   ├── markets.js            # PLZ- und Filialsuche (OSM, Google-Maps-Links)
│   │   ├── nettomithund.js       # Netto-Kettenangebote
│   │   └── norma.js              # HTML-Parser für Norma-Angebote
│   ├── engine/                   # Business-Logik & Algorithmen
│   │   ├── categories.js         # Intelligente Warengruppen-Klassifizierung
│   │   ├── comparator.js         # Supermarkt-Whitelist, Grundpreis, Rabattfilter & Validierung
│   │   ├── history.js            # Haushaltsbuch, KPIs & Jahresersparnis-Projektion
│   │   ├── optimizer.js          # Single-Store & Smart-Split-Algorithmus
│   │   └── recipe_parser.js      # Schema.org JSON-LD & Zutaten-Parser
│   └── server.js                 # Express REST-API Server & Endpunkte
├── test/                         # Unit-, API- und optionale Live-Tests
│   ├── aldinord.test.js
│   ├── cache.test.js
│   ├── categories.test.js
│   ├── comparator.test.js
│   ├── e2e.test.js
│   ├── edeka.test.js
│   ├── history.test.js
│   ├── marktguru.test.js
│   ├── markets.test.js
│   ├── nettomithund.test.js
│   ├── norma.test.js
│   ├── optimizer.test.js
│   ├── pricing_sanitization.test.js
│   ├── qr_share.test.js
│   ├── recipe.test.js
│   ├── savings.test.js
│   └── server.test.js
├── package.json
└── README.md
```

---

## 🛡️ Datenschutz & Unabhängigkeit
- **100 % werbefrei und unabhängig.**
- Einkaufszettel, Favoriten, Vorlagen und eine Kopie der Belege liegen lokal im Browser (`localStorage`).
- Der Server trennt gespeicherte Belege über eine zufällige Gerätekennung. Es gibt keinen Account und keine gemeinsame öffentliche Historie. Ein JSON-Backup ermöglicht die Wiederherstellung auf einem neuen Gerät.
- QR-Shares sind durch einen zufälligen Link zugänglich und laufen nach 24 Stunden ab. Teile Links nur mit Personen, die deine Liste sehen sollen.
- Angebotsbilder können von externen Bild-Hosts geladen werden. Google Maps wird erst nach Klick auf einen Filial-Link geöffnet. Die Filialsuche verwendet OpenStreetMap-Daten.
- Ältere Belege werden, soweit ihre Artikelpreise vorliegen, aus Einzelpreisen neu berechnet. Bereits gespeicherte Vergleichspreise ohne Herkunftskennzeichnung lassen sich rückwirkend nicht immer sicher prüfen.
