/**
 * Supermarkt-Sparer Backend Server
 * Express Server mit REST API und statischem Frontend-Hosting.
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { searchOffers } from './api/marktguru.js';
import { searchAldiNordOffers } from './api/aldinord.js';
import { searchNormaOffers } from './api/norma.js';
import { searchEdekaOffers } from './api/edeka.js';
import { filterAndSortOffers, calculateBasketTotals } from './engine/comparator.js';
import { optimizeBasket } from './engine/optimizer.js';
import { loadHistoryFromFile, saveHistoryToFile, calculateHouseholdStats } from './engine/history.js';
import { CATEGORY_DEFINITIONS } from './engine/categories.js';
let QRCode = null;
try {
  QRCode = (await import('qrcode')).default;
} catch (err) {
  console.warn('⚠️ Paket "qrcode" nicht gefunden – verwende automatischen Online-Fallback.');
}
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Top-Supermarktketten in Marktguru für einen reichhaltigen "Alle Angebote"-Feed
const MARKTGURU_STORES = ['Lidl', 'REWE', 'PENNY', 'Netto', 'Kaufland'];

// Ermittelt die lokale LAN-IPv4-Adresse des PCs (für WLAN-Transfer im lokalen Netzwerk)
export function getLocalIpAddress() {
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
  } catch {}
  return 'localhost';
}

// In-Memory Speicher für QR-Code Warenkorb-Übertragungen (24h TTL)
export const sharedBaskets = new Map();

// Bereinigt abgelaufene QR-Shares periodisch alle 30 Minuten
setInterval(() => {
  const now = Date.now();
  for (const [id, data] of sharedBaskets.entries()) {
    if (data.expiresAt < now) {
      sharedBaskets.delete(id);
    }
  }
}, 30 * 60 * 1000).unref();

export function createApp() {
  const app = express();

  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../public')));

  // 1. Suche & Filterung (unterstützt leere Suche für "Alle Angebote", Händler-Feeds & Bio-Tag)
  app.get('/api/offers', async (req, res) => {
    try {
      const {
        q = '',
        zip = '10115',
        sortBy = 'refPrice',
        category = 'all',
        retailers = '',
        excludeAppOnly = 'false',
        validNowOnly = 'true',
        onlyBio = 'false',
        onlyFood = 'false',
        onlyNonFood = 'false',
        onlyFavorites = 'false',
        favs = '',
        limit = '60',
      } = req.query;

      const favList = favs ? favs.split(',').map(f => f.trim()).filter(Boolean) : [];
      const searchQuery = q.trim();
      const isBioOnly = onlyBio === 'true';

      const retailerList = retailers
        ? retailers.split(',').map(r => r.trim()).filter(Boolean)
        : [];
      const retailerListLower = retailerList.map(r => r.toLowerCase());

      const shouldIncludeStore = (name) => {
        if (retailerListLower.length === 0) return true;
        const n = name.toLowerCase();
        return retailerListLower.some(r => n.includes(r) || r.includes(n));
      };

      let combinedOffers = [];
      const retailerMap = new Map();
      const seenIds = new Set();

      const addOffers = (offerList) => {
        if (!Array.isArray(offerList)) return;
        for (const offer of offerList) {
          if (!offer || !offer.id) continue;
          if (!seenIds.has(offer.id)) {
            seenIds.add(offer.id);
            combinedOffers.push(offer);
            retailerMap.set(offer.retailer, (retailerMap.get(offer.retailer) || 0) + 1);
          }
        }
      };

      if (!searchQuery) {
        // LEER-SUCHE / ALLE ANGEBOTE:
        const fetchTasks = [];

        // 1. Aldi Nord (falls nicht durch Händlerfilter ausgeschlossen)
        if (shouldIncludeStore('Aldi Nord')) {
          fetchTasks.push(searchAldiNordOffers('').then(addOffers).catch(err => {
            console.warn('Aldi Nord Feed Fehler:', err.message);
          }));
        }

        // 2. Norma (falls nicht ausgeschlossen)
        if (shouldIncludeStore('Norma')) {
          fetchTasks.push(searchNormaOffers('').then(addOffers).catch(err => {
            console.warn('Norma Feed Fehler:', err.message);
          }));
        }

        // 3. EDEKA (falls nicht ausgeschlossen)
        if (shouldIncludeStore('EDEKA')) {
          fetchTasks.push(searchEdekaOffers('', zip).then(addOffers).catch(err => {
            console.warn('EDEKA Feed Fehler:', err.message);
          }));
        }

        // 4. Marktguru Angebote holen
        if (isBioOnly) {
          // Wenn "Nur Bio" aktiv ist: gezielt Bio-Angebote bei Marktguru abfragen (Penny, Kaufland, Lidl, REWE etc.)
          fetchTasks.push(
            searchOffers({ query: 'Bio', zipCode: zip, limit: 100 })
              .then(r => addOffers(r.offers))
              .catch(err => console.warn('Marktguru Bio Feed Fehler:', err.message))
          );
        } else if (retailerListLower.length > 0) {
          // Gezielter Händlerfilter gewählt (z. B. PENNY oder Netto)
          for (const ret of retailerList) {
            const retLower = ret.toLowerCase();
            let mgQuery = ret;
            if (retLower.includes('penny')) mgQuery = 'PENNY';
            else if (retLower.includes('netto')) mgQuery = 'Netto';
            else if (retLower.includes('lidl')) mgQuery = 'Lidl';
            else if (retLower.includes('rewe')) mgQuery = 'REWE';
            else if (retLower.includes('kaufland')) mgQuery = 'Kaufland';

            if (['PENNY', 'Netto', 'Lidl', 'REWE', 'Kaufland'].includes(mgQuery)) {
              fetchTasks.push(
                searchOffers({ query: mgQuery, zipCode: zip, limit: 100 })
                  .then(r => addOffers(r.offers))
                  .catch(err => console.warn(`Marktguru Feed Fehler für ${mgQuery}:`, err.message))
              );
            }
          }
        } else {
          // Alle Märkte: Parallele Händler-Abfragen in Marktguru für maximale Angebotsvielfalt
          for (const store of MARKTGURU_STORES) {
            fetchTasks.push(
              searchOffers({ query: store, zipCode: zip, limit: 60 })
                .then(r => addOffers(r.offers))
                .catch(err => console.warn(`Marktguru Feed Fehler für ${store}:`, err.message))
            );
          }
        }

        await Promise.all(fetchTasks);
      } else {
        // GEZIELTE SUCHE (z. B. "Butter", "Kaffee", "Milch", "Bio")
        const fetchTasks = [];

        // 1. Marktguru Standard-Suche
        fetchTasks.push(
          searchOffers({ query: searchQuery, zipCode: zip, limit: Math.min(parseInt(limit, 10) || 60, 100) })
            .then(r => addOffers(r.offers))
            .catch(err => console.warn('Marktguru Suche Fehler:', err.message))
        );

        // Falls "Nur Bio" aktiv ist und der Suchbegriff nicht ohnehin "bio" enthält, auch Bio-Varianten suchen
        if (isBioOnly && !searchQuery.toLowerCase().includes('bio')) {
          fetchTasks.push(
            searchOffers({ query: `${searchQuery} Bio`, zipCode: zip, limit: 40 })
              .then(r => addOffers(r.offers))
              .catch(() => {})
          );
        }

        // 2. Aldi Nord
        if (shouldIncludeStore('Aldi Nord')) {
          fetchTasks.push(
            searchAldiNordOffers(searchQuery)
              .then(addOffers)
              .catch(err => console.warn('Aldi Nord Suche Fehler:', err.message))
          );
        }

        // 3. Norma
        if (shouldIncludeStore('Norma')) {
          fetchTasks.push(
            searchNormaOffers(searchQuery)
              .then(addOffers)
              .catch(err => console.warn('Norma Suche Fehler:', err.message))
          );
        }

        // 4. EDEKA
        if (shouldIncludeStore('EDEKA')) {
          fetchTasks.push(
            searchEdekaOffers(searchQuery, zip)
              .then(addOffers)
              .catch(err => console.warn('EDEKA Suche Fehler:', err.message))
          );
        }

        await Promise.all(fetchTasks);
      }

      const combinedRetailers = Array.from(retailerMap.entries()).map(([name, count]) => ({
        id: name,
        name,
        count,
      }));

      const filteredOffers = filterAndSortOffers(combinedOffers, {
        sortBy,
        category,
        retailers: retailerList,
        excludeAppOnly: excludeAppOnly === 'true',
        validNowOnly: validNowOnly === 'true',
        onlyBio: isBioOnly,
        onlyFood: onlyFood === 'true',
        onlyNonFood: onlyNonFood === 'true',
        onlyFavorites: onlyFavorites === 'true',
        favoriteKeywords: favList,
      });

      res.json({
        query: searchQuery,
        zipCode: zip,
        totalCount: combinedOffers.length,
        filteredCount: filteredOffers.length,
        offers: filteredOffers,
        retailers: combinedRetailers,
        categories: [],
      });
    } catch (err) {
      console.error('Fehler bei /api/offers:', err);
      res.status(500).json({ error: 'Fehler beim Abrufen der Angebote', message: err.message });
    }
  });

  // 2. Ersparnisberechnung für den Einkaufswagen
  app.post('/api/calculate-basket', (req, res) => {
    try {
      const { items = [] } = req.body;
      const totals = calculateBasketTotals(items);
      res.json(totals);
    } catch (err) {
      console.error('Fehler bei /api/calculate-basket:', err);
      res.status(500).json({ error: 'Fehler bei der Ersparnisberechnung', message: err.message });
    }
  });

  // 2. Einkaufslisten-Optimierer
  app.post('/api/optimize', async (req, res) => {
    try {
      const {
        items = [],
        zipCode = '10115',
        retailers = [],
        excludeAppOnly = false,
        preferReferencePrice = true,
      } = req.body;

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'items muss ein nicht-leeres Array von Suchbegriffen sein.' });
      }

      // Artikel bereinigen und Dubletten entfernen
      const cleanItems = [...new Set(items.map(item => String(item).trim()).filter(Boolean))];

      if (cleanItems.length === 0) {
        return res.status(400).json({ error: 'Keine gültigen Artikel angegeben.' });
      }

      // Paralleles Abrufen aller Artikelangebote über Marktguru, Aldi Nord, Norma und EDEKA
      const fetchTasks = cleanItems.map(async (query) => {
        try {
          const [mgResult, aldiOffers, normaOffers, edekaOffers] = await Promise.all([
            searchOffers({ query, zipCode, limit: 30 }),
            searchAldiNordOffers(query),
            searchNormaOffers(query),
            searchEdekaOffers(query, zipCode),
          ]);
          return { query, offers: [...mgResult.offers, ...aldiOffers, ...normaOffers, ...edekaOffers] };
        } catch (err) {
          console.error(`Fehler bei Optimierungs-Abfrage für "${query}":`, err.message);
          return { query, offers: [] };
        }
      });

      const results = await Promise.all(fetchTasks);
      const itemResultsMap = {};
      for (const { query, offers } of results) {
        itemResultsMap[query] = offers;
      }

      const optimization = optimizeBasket(cleanItems, itemResultsMap, {
        retailers,
        excludeAppOnly,
        preferReferencePrice,
      });

      res.json({
        zipCode,
        optimization,
      });
    } catch (err) {
      console.error('Fehler bei /api/optimize:', err);
      res.status(500).json({ error: 'Fehler bei der Einkaufs-Optimierung', message: err.message });
    }
  });

  // 3. Einkaufs-Historie & Haushaltsplanung
  app.get('/api/history', (req, res) => {
    try {
      const history = loadHistoryFromFile();
      const stats = calculateHouseholdStats(history);
      res.json({ history, stats });
    } catch (err) {
      console.error('Fehler bei GET /api/history:', err);
      res.status(500).json({ error: 'Fehler beim Abrufen der Historie', message: err.message });
    }
  });

  app.post('/api/history', (req, res) => {
    try {
      const receipt = req.body;
      if (!receipt || (receipt.totalPaid === undefined && !receipt.items)) {
        return res.status(400).json({ error: 'Ungültiger Beleg' });
      }

      const history = loadHistoryFromFile();
      const paid = typeof receipt.totalPaid === 'number' ? receipt.totalPaid : parseFloat(receipt.totalPaid) || 0;
      const savings = typeof receipt.totalSavings === 'number' ? receipt.totalSavings : parseFloat(receipt.totalSavings) || 0;
      const regular = typeof receipt.totalRegular === 'number' ? receipt.totalRegular : (paid + savings);

      const newEntry = {
        id: receipt.id || `receipt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        date: receipt.date || new Date().toISOString(),
        stores: Array.isArray(receipt.stores) ? receipt.stores : [],
        itemCount: receipt.itemCount || (receipt.items ? receipt.items.length : 0),
        totalPaid: parseFloat(paid.toFixed(2)),
        totalRegular: parseFloat(regular.toFixed(2)),
        totalSavings: parseFloat(savings.toFixed(2)),
        savingsPercent: regular > 0 ? Math.round((savings / regular) * 100) : 0,
        items: Array.isArray(receipt.items) ? receipt.items : [],
        note: receipt.note || '',
      };

      // Neueste Einkäufe zuerst
      history.unshift(newEntry);
      saveHistoryToFile(history);

      const stats = calculateHouseholdStats(history);
      res.status(201).json({ success: true, receipt: newEntry, history, stats });
    } catch (err) {
      console.error('Fehler bei POST /api/history:', err);
      res.status(500).json({ error: 'Fehler beim Speichern des Belegs', message: err.message });
    }
  });

  // 3.1 Synchronisation / Rehydrierung (schützt Daten bei Server-Neustarts & Render Spin-Downs)
  app.post('/api/history/sync', (req, res) => {
    try {
      const clientHistory = Array.isArray(req.body.clientHistory) ? req.body.clientHistory : [];
      let serverHistory = loadHistoryFromFile();

      const mergedMap = new Map();
      // Server-Einträge einfügen
      serverHistory.forEach(item => {
        if (item && item.id) mergedMap.set(item.id, item);
      });
      // Client-Einträge hinzufügen (falls auf dem Server noch fehlend)
      clientHistory.forEach(item => {
        if (item && item.id && !mergedMap.has(item.id)) {
          mergedMap.set(item.id, item);
        }
      });

      const unifiedHistory = Array.from(mergedMap.values()).sort((a, b) => {
        return new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime();
      });

      saveHistoryToFile(unifiedHistory);
      const stats = calculateHouseholdStats(unifiedHistory);
      res.json({ success: true, history: unifiedHistory, stats });
    } catch (err) {
      console.error('Fehler bei POST /api/history/sync:', err);
      res.status(500).json({ error: 'Fehler bei der Historie-Synchronisation', message: err.message });
    }
  });

  app.delete('/api/history/:id', (req, res) => {
    try {
      const { id } = req.params;
      let history = loadHistoryFromFile();
      history = history.filter(r => r.id !== id);
      saveHistoryToFile(history);
      const stats = calculateHouseholdStats(history);
      res.json({ success: true, history, stats });
    } catch (err) {
      console.error('Fehler bei DELETE /api/history/:id:', err);
      res.status(500).json({ error: 'Fehler beim Löschen des Belegs', message: err.message });
    }
  });

  app.delete('/api/history', (req, res) => {
    try {
      saveHistoryToFile([]);
      const stats = calculateHouseholdStats([]);
      res.json({ success: true, history: [], stats });
    } catch (err) {
      console.error('Fehler bei DELETE /api/history:', err);
      res.status(500).json({ error: 'Fehler beim Zurücksetzen der Historie', message: err.message });
    }
  });

  // 4. Vordefinierte Warengruppen & Kategorien
  app.get('/api/categories', (req, res) => {
    res.json([
      {
        id: 'all',
        title: 'Alle Kategorien',
        icon: '🌟',
        description: 'Alle Angebote ohne Warengruppen-Einschränkung',
        searchKeywords: [],
      },
      ...CATEGORY_DEFINITIONS,
    ]);
  });

  // 5. QR-Code Warenkorb-Übertragung (PC ➔ Smartphone)
  app.post('/api/basket/share', async (req, res) => {
    try {
      const { items, zipCode = '10115', targetHost } = req.body;
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Einkaufszettel ist leer' });
      }

      // Eindeutige, kurze Share-ID (z. B. b-7k9p3)
      const shareId = `b-${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 5)}`;
      const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 Stunden

      sharedBaskets.set(shareId, {
        id: shareId,
        items,
        zipCode,
        createdAt: new Date().toISOString(),
        expiresAt,
      });

      // Bestimme die URL für das Smartphone
      let protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
      let host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';

      if (targetHost && typeof targetHost === 'string' && targetHost.trim()) {
        const cleanHost = targetHost.trim().replace(/^https?:\/\//, '');
        protocol = targetHost.trim().startsWith('http://') ? 'http' : 'https';
        host = cleanHost;
      }

      const shareUrl = `${protocol}://${host}/?basket_share=${shareId}`;

      // Hochwertigen QR-Code als PNG Data-URL erzeugen (mit Fallback falls qrcode-Paket nicht vorhanden ist)
      let qrDataUrl = '';
      if (QRCode) {
        qrDataUrl = await QRCode.toDataURL(shareUrl, {
          errorCorrectionLevel: 'M',
          margin: 2,
          scale: 7,
          color: {
            dark: '#051410',
            light: '#ffffff',
          },
        });
      } else {
        qrDataUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(shareUrl)}`;
      }

      res.json({
        success: true,
        shareId,
        shareUrl,
        qrDataUrl,
        itemCount: items.length,
        expiresAt: new Date(expiresAt).toISOString(),
        localIp: getLocalIpAddress(),
      });
    } catch (err) {
      console.error('Fehler bei POST /api/basket/share:', err);
      res.status(500).json({ error: 'Fehler beim Erstellen des QR-Codes', message: err.message });
    }
  });

  app.get('/api/basket/share/:id', (req, res) => {
    try {
      const { id } = req.params;
      const data = sharedBaskets.get(id);

      if (!data || data.expiresAt < Date.now()) {
        if (data) sharedBaskets.delete(id);
        return res.status(404).json({ error: 'Einkaufszettel nicht gefunden oder abgelaufen' });
      }

      res.json({
        success: true,
        items: data.items,
        zipCode: data.zipCode,
        createdAt: data.createdAt,
      });
    } catch (err) {
      console.error('Fehler bei GET /api/basket/share/:id:', err);
      res.status(500).json({ error: 'Fehler beim Abrufen des Einkaufszettels', message: err.message });
    }
  });

  app.get('/api/qr', async (req, res) => {
    try {
      const text = req.query.text;
      if (!text) {
        return res.status(400).send('Query parameter "text" fehlt');
      }

      if (!QRCode) {
        return res.redirect(`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(text)}`);
      }

      const format = req.query.format || 'png';
      if (format === 'svg') {
        const svg = await QRCode.toString(text, {
          type: 'svg',
          margin: 2,
          color: { dark: '#051410', light: '#ffffff' },
        });
        res.setHeader('Content-Type', 'image/svg+xml');
        return res.send(svg);
      }

      const buffer = await QRCode.toBuffer(text, {
        margin: 2,
        scale: 7,
        color: { dark: '#051410', light: '#ffffff' },
      });
      res.setHeader('Content-Type', 'image/png');
      res.send(buffer);
    } catch (err) {
      console.error('Fehler bei GET /api/qr:', err);
      res.status(500).send('Fehler beim Generieren des QR-Codes');
    }
  });

  return app;
}

// Server nur starten, wenn direkt ausgeführt
if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  const PORT = process.env.PORT || 3000;
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`🛒 Supermarkt-Sparer läuft auf: http://localhost:${PORT}`);
  });
}
