/**
 * Supermarkt-Sparer Backend Server
 * Express Server mit REST API und statischem Frontend-Hosting.
 */

import express from 'express';
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { searchOffers } from './api/marktguru.js';
import { searchAldiNordOffers } from './api/aldinord.js';
import { searchNormaOffers } from './api/norma.js';
import { searchEdekaOffers } from './api/edeka.js';
import { searchNettoMitHundOffers } from './api/nettomithund.js';
import { searchNearbyMarkets } from './api/markets.js';
import { filterAndSortOffers, calculateBasketTotals, isMatchingRetailer } from './engine/comparator.js';
import { optimizeBasket, sanitizeItemForSearch } from './engine/optimizer.js';
import { loadHistoryFromFile, saveHistoryToFile, calculateHouseholdStats, reconcileReceipt } from './engine/history.js';
import { CATEGORY_DEFINITIONS } from './engine/categories.js';
import { parseRecipeInput } from './engine/recipe_parser.js';
import QRCode from 'qrcode';
import os from 'os';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Top-Supermarktketten in Marktguru für einen reichhaltigen "Alle Angebote"-Feed
const MARKTGURU_STORES = ['Lidl', 'REWE', 'REWE Center', 'PENNY', 'Netto', 'Kaufland', 'EDEKA', 'Edeka Center', 'ALDI SÜD'];

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
const SHARES_DIR = path.join(__dirname, '../.cache/shares');

function getSharePath(id) {
  if (!/^b-[A-Za-z0-9_-]{16,32}$/.test(id)) return null;
  return path.join(SHARES_DIR, `${id}.json`);
}

function saveSharedBasket(share) {
  fs.mkdirSync(SHARES_DIR, { recursive: true });
  fs.writeFileSync(getSharePath(share.id), JSON.stringify(share), 'utf8');
  sharedBaskets.set(share.id, share);
}

function loadSharedBasket(id) {
  const file = getSharePath(id);
  if (!file) return null;
  let data = sharedBaskets.get(id);
  if (!data && fs.existsSync(file)) {
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  }
  if (!data || data.expiresAt < Date.now()) {
    sharedBaskets.delete(id);
    try { fs.unlinkSync(file); } catch {}
    return null;
  }
  sharedBaskets.set(id, data);
  return data;
}

// Bereinigt abgelaufene QR-Shares periodisch alle 30 Minuten
setInterval(() => {
  const now = Date.now();
  for (const [id, data] of sharedBaskets.entries()) {
    if (data.expiresAt < now) {
      sharedBaskets.delete(id);
    }
  }
  try {
    for (const file of fs.readdirSync(SHARES_DIR)) {
      if (file.endsWith('.json')) loadSharedBasket(file.slice(0, -5));
    }
  } catch {}
}, 30 * 60 * 1000).unref();

export function createApp() {
  const app = express();

  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../public')));
  app.use('/vendor/leaflet', express.static(path.join(__dirname, '../node_modules/leaflet/dist')));

  // A random browser token keeps receipts separate without requiring an account.
  // The token is never used as a file name directly.
  app.use('/api/history', (req, res, next) => {
    const token = req.get('X-Sparfuchs-Device') || '';
    if (!/^[a-f0-9-]{32,64}$/i.test(token)) {
      return res.status(401).json({ error: 'Gerätekennung fehlt' });
    }
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    req.historyFile = path.join(__dirname, '../.cache/history', `${hash}.json`);
    next();
  });

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
        minDiscount = '',
        activeRetailers = '',
        limit = '60',
      } = req.query;
      if (!/^\d{5}$/.test(String(zip))) {
        return res.status(400).json({ error: 'Bitte eine gültige deutsche PLZ angeben' });
      }

      const favList = favs ? favs.split(',').map(f => f.trim()).filter(Boolean) : [];
      const activeStoreList = activeRetailers ? activeRetailers.split(',').map(r => r.trim()).filter(Boolean) : [];
      const parsedMinDiscount = minDiscount ? parseFloat(minDiscount) : null;
      const searchQuery = q.trim();
      const isBioOnly = onlyBio === 'true';

      const retailerList = retailers
        ? retailers.split(',').map(r => r.trim()).filter(r => r && r.toLowerCase() !== 'all')
        : [];
      const retailerListLower = retailerList.map(r => r.toLowerCase());

      const activeStoreListLower = activeStoreList.map(r => r.toLowerCase());

      const shouldIncludeStore = (name) => {
        if (activeStoreList.length > 0) {
          const isAllowed = activeStoreList.some(r => isMatchingRetailer(name, '', r));
          if (!isAllowed) return false;
        }
        if (retailerList.length === 0) return true;
        return retailerList.some(r => isMatchingRetailer(name, '', r));
      };

      let combinedOffers = [];
      const retailerMap = new Map();
      const seenIds = new Set();
      const sourceReports = new Map();
      const sourceScope = { Marktguru: 'PLZ', EDEKA: 'Filiale nahe PLZ', 'Aldi Nord': 'Kettenfeed', Norma: 'Kettenfeed', 'Netto mit dem Hund': 'Kettenfeed' };
      const sourceError = (source) => {
        const previous = sourceReports.get(source);
        sourceReports.set(source, { source, scope: sourceScope[source],
          status: previous?.count ? 'partial' : 'unavailable', count: previous?.count || 0,
          lastFetchedAt: previous?.lastFetchedAt || null });
      };

      const addOffers = (offerList, source) => {
        if (!Array.isArray(offerList)) return;
        if (source) {
          const previous = sourceReports.get(source);
          sourceReports.set(source, {
            source, scope: sourceScope[source], status: previous?.status === 'unavailable' || previous?.status === 'partial' ? 'partial' : 'ok',
            count: (previous?.count || 0) + offerList.length,
            lastFetchedAt: [previous?.lastFetchedAt, ...offerList.map(o => o?.sourceFetchedAt)].filter(Boolean).sort().at(-1) || null,
          });
        }
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
          fetchTasks.push(searchAldiNordOffers('').then(r => addOffers(r, 'Aldi Nord')).catch(err => {
            sourceError('Aldi Nord');
            console.warn('Aldi Nord Feed Fehler:', err.message);
          }));
        }

        // 2. Norma (falls nicht ausgeschlossen)
        if (shouldIncludeStore('Norma')) {
          fetchTasks.push(searchNormaOffers('').then(r => addOffers(r, 'Norma')).catch(err => {
            sourceError('Norma');
            console.warn('Norma Feed Fehler:', err.message);
          }));
        }

        // 3. EDEKA (falls nicht ausgeschlossen)
        if (shouldIncludeStore('EDEKA')) {
          fetchTasks.push(searchEdekaOffers('', zip).then(r => addOffers(r, 'EDEKA')).catch(err => {
            sourceError('EDEKA');
            console.warn('EDEKA Feed Fehler:', err.message);
          }));
        }

        // 4. Netto mit dem Hund (falls nicht ausgeschlossen)
        if (shouldIncludeStore('Netto mit dem Hund')) {
          fetchTasks.push(searchNettoMitHundOffers('', zip).then(r => addOffers(r, 'Netto mit dem Hund')).catch(err => {
            sourceError('Netto mit dem Hund');
            console.warn('Netto mit dem Hund Feed Fehler:', err.message);
          }));
        }

        // 4. Marktguru Angebote holen
        if (isBioOnly) {
          // Wenn "Nur Bio" aktiv ist: gezielt Bio-Angebote bei Marktguru abfragen (Penny, Kaufland, Lidl, REWE etc.)
          fetchTasks.push(
            searchOffers({ query: 'Bio', zipCode: zip, limit: 100 })
              .then(r => addOffers(r.offers, 'Marktguru'))
              .catch(err => { sourceError('Marktguru'); console.warn('Marktguru Bio Feed Fehler:', err.message); })
          );
        } else if (retailerListLower.length > 0) {
          // Gezielter Händlerfilter gewählt (z. B. PENNY oder Netto)
          for (const ret of retailerList) {
            const retLower = ret.toLowerCase();
            let mgQuery = ret;
            if (retLower === 'rewe center' || retLower.includes('rewe center')) mgQuery = 'REWE Center';
            else if (retLower.includes('rewe')) mgQuery = 'REWE';
            else if (retLower.includes('penny')) mgQuery = 'PENNY';
            else if (retLower.includes('netto marken') || retLower === 'netto') mgQuery = 'Netto';
            else if (retLower.includes('lidl')) mgQuery = 'Lidl';
            else if (retLower.includes('kaufland')) mgQuery = 'Kaufland';
            else if (retLower.includes('edeka center') || retLower === 'e center') mgQuery = 'E center';
            else if (retLower.includes('edeka')) mgQuery = 'EDEKA';
            else if (retLower.includes('aldi süd') || retLower.includes('aldi sued')) mgQuery = 'ALDI SÜD';
            else if (retLower === 'aldi' || retLower === 'aldi nord') mgQuery = 'Aldi';

            fetchTasks.push(
              searchOffers({ query: mgQuery, zipCode: zip, limit: 100 })
                .then(r => addOffers(r.offers, 'Marktguru'))
                .catch(err => { sourceError('Marktguru'); console.warn(`Marktguru Feed Fehler für ${mgQuery}:`, err.message); })
            );
          }
        } else {
          // Alle Märkte: Parallele Händler-Abfragen in Marktguru für maximale Angebotsvielfalt
          for (const store of MARKTGURU_STORES) {
            if (!shouldIncludeStore(store)) continue;
            fetchTasks.push(
              searchOffers({ query: store, zipCode: zip, limit: 60 })
                .then(r => addOffers(r.offers, 'Marktguru'))
                .catch(err => { sourceError('Marktguru'); console.warn(`Marktguru Feed Fehler für ${store}:`, err.message); })
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
            .then(r => addOffers(r.offers, 'Marktguru'))
            .catch(err => { sourceError('Marktguru'); console.warn('Marktguru Suche Fehler:', err.message); })
        );

        // Falls "Nur Bio" aktiv ist und der Suchbegriff nicht ohnehin "bio" enthält, auch Bio-Varianten suchen
        if (isBioOnly && !searchQuery.toLowerCase().includes('bio')) {
          fetchTasks.push(
            searchOffers({ query: `${searchQuery} Bio`, zipCode: zip, limit: 40 })
              .then(r => addOffers(r.offers, 'Marktguru'))
              .catch(() => { sourceError('Marktguru'); })
          );
        }

        // 2. Aldi Nord
        if (shouldIncludeStore('Aldi Nord')) {
          fetchTasks.push(
            searchAldiNordOffers(searchQuery)
              .then(r => addOffers(r, 'Aldi Nord'))
              .catch(err => { sourceError('Aldi Nord'); console.warn('Aldi Nord Suche Fehler:', err.message); })
          );
        }

        // 3. Norma
        if (shouldIncludeStore('Norma')) {
          fetchTasks.push(
            searchNormaOffers(searchQuery)
              .then(r => addOffers(r, 'Norma'))
              .catch(err => { sourceError('Norma'); console.warn('Norma Suche Fehler:', err.message); })
          );
        }

        // 4. EDEKA
        if (shouldIncludeStore('EDEKA')) {
          fetchTasks.push(
            searchEdekaOffers(searchQuery, zip)
              .then(r => addOffers(r, 'EDEKA'))
              .catch(err => { sourceError('EDEKA'); console.warn('EDEKA Suche Fehler:', err.message); })
          );
        }

        // 5. Netto mit dem Hund
        if (shouldIncludeStore('Netto mit dem Hund')) {
          fetchTasks.push(
            searchNettoMitHundOffers(searchQuery, zip)
              .then(r => addOffers(r, 'Netto mit dem Hund'))
              .catch(err => { sourceError('Netto mit dem Hund'); console.warn('Netto mit dem Hund Suche Fehler:', err.message); })
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
        allowedRetailers: activeStoreList,
        strictSupermarketOnly: true,
        excludeAppOnly: excludeAppOnly === 'true',
        validNowOnly: validNowOnly === 'true',
        onlyBio: isBioOnly,
        onlyFood: onlyFood === 'true',
        onlyNonFood: onlyNonFood === 'true',
        onlyFavorites: onlyFavorites === 'true',
        favoriteKeywords: favList,
        minDiscount: parsedMinDiscount,
      });

      res.json({
        query: searchQuery,
        zipCode: zip,
        totalCount: combinedOffers.length,
        filteredCount: filteredOffers.length,
        offers: filteredOffers,
        sources: Array.from(sourceReports.values()),
        checkedAt: new Date().toISOString(),
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
        activeRetailers = [],
        excludeAppOnly = false,
        preferReferencePrice = true,
        extraStoreCost = 0,
      } = req.body;
      if (!/^\d{5}$/.test(String(zipCode))) {
        return res.status(400).json({ error: 'Bitte eine gültige deutsche PLZ angeben' });
      }

      const effectiveRetailers = Array.isArray(activeRetailers) && activeRetailers.length > 0
        ? activeRetailers
        : (Array.isArray(retailers) ? retailers : []);

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'items muss ein nicht-leeres Array von Suchbegriffen sein.' });
      }

      // Unterstütze sowohl Strings (abwärtskompatibel) als auch Objekte { query, quantity } / { title, quantity }
      const parsedItems = items.map(it => {
        if (typeof it === 'string') {
          return { query: it.trim(), quantity: 1 };
        }
        if (it && typeof it === 'object') {
          const q = String(it.query || it.title || '').trim();
          const qty = (typeof it.quantity === 'number' && it.quantity > 0) ? it.quantity : 1;
          return { query: q, quantity: qty };
        }
        return null;
      }).filter(it => it && it.query);

      if (parsedItems.length === 0) {
        return res.status(400).json({ error: 'Keine gültigen Artikel angegeben.' });
      }

      // Dubletten zusammenführen und Mengen aufsummieren
      const quantitiesMap = Object.create(null);
      for (const { query, quantity } of parsedItems) {
        quantitiesMap[query] = (quantitiesMap[query] || 0) + quantity;
      }
      const cleanItems = Object.keys(quantitiesMap);

      const isStoreAllowed = (name) => {
        if (!effectiveRetailers || effectiveRetailers.length === 0) return true;
        return effectiveRetailers.some(r => isMatchingRetailer(name, '', String(r)));
      };

      // Paralleles Abrufen aller Artikelangebote über Marktguru, Aldi Nord, Norma und EDEKA
      const fetchTasks = cleanItems.map(async (rawQuery) => {
        const query = sanitizeItemForSearch(rawQuery);
        try {
          const tasks = [
            searchOffers({ query, zipCode, limit: 80 }).then(r => r.offers).catch(() => []),
          ];
          if (isStoreAllowed('Aldi Nord')) {
            tasks.push(searchAldiNordOffers(query).catch(() => []));
          } else {
            tasks.push(Promise.resolve([]));
          }
          if (isStoreAllowed('Norma')) {
            tasks.push(searchNormaOffers(query).catch(() => []));
          } else {
            tasks.push(Promise.resolve([]));
          }
          if (isStoreAllowed('EDEKA')) {
            tasks.push(searchEdekaOffers(query, zipCode).catch(() => []));
          } else {
            tasks.push(Promise.resolve([]));
          }

          if (isStoreAllowed('Netto mit dem Hund')) {
            tasks.push(searchNettoMitHundOffers(query, zipCode).catch(() => []));
          } else {
            tasks.push(Promise.resolve([]));
          }

          const results = await Promise.all(tasks);
          return { query: rawQuery, offers: results.flat() };
        } catch (err) {
          console.error(`Fehler bei Optimierungs-Abfrage für "${query}":`, err.message);
          return { query: rawQuery, offers: [] };
        }
      });

      const results = await Promise.all(fetchTasks);
      const itemResultsMap = {};
      for (const { query, offers } of results) {
        itemResultsMap[query] = offers;
      }

      const optimization = optimizeBasket(cleanItems, itemResultsMap, {
        retailers: effectiveRetailers,
        quantities: quantitiesMap,
        excludeAppOnly,
        preferReferencePrice,
        extraStoreCost: Math.min(100, Math.max(0, Number(extraStoreCost) || 0)),
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

  // 2b. Rezept-Parser (Chefkoch & Web-Standard Schema.org JSON-LD / Text)
  app.post('/api/recipe/parse', async (req, res) => {
    try {
      const { url, text } = req.body || {};
      if (!url && !text) {
        return res.status(400).json({ error: 'Bitte gib eine Rezept-URL oder Zutaten-Text ein.' });
      }

      const recipe = await parseRecipeInput({ url, text });
      res.json({
        success: true,
        recipe,
      });
    } catch (err) {
      console.error('Fehler bei /api/recipe/parse:', err.message);
      res.status(400).json({ error: err.message });
    }
  });

  // 3. Einkaufs-Historie & Haushaltsplanung
  app.get('/api/history', (req, res) => {
    try {
      const history = loadHistoryFromFile(req.historyFile);
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

      const history = loadHistoryFromFile(req.historyFile);
      const paid = typeof receipt.totalPaid === 'number' ? receipt.totalPaid : parseFloat(receipt.totalPaid) || 0;
      const savings = typeof receipt.totalSavings === 'number' ? receipt.totalSavings : parseFloat(receipt.totalSavings) || 0;
      const regular = typeof receipt.totalRegular === 'number' ? receipt.totalRegular : (paid + savings);

      const newEntry = reconcileReceipt({
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
      });

      // Neueste Einkäufe zuerst
      history.unshift(newEntry);
      if (!saveHistoryToFile(history, req.historyFile)) {
        throw new Error('Beleg konnte nicht gespeichert werden');
      }

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
      let serverHistory = loadHistoryFromFile(req.historyFile);

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

      const unifiedHistory = Array.from(mergedMap.values()).map(reconcileReceipt).sort((a, b) => {
        return new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime();
      });

      if (!saveHistoryToFile(unifiedHistory, req.historyFile)) {
        throw new Error('Historie konnte nicht gespeichert werden');
      }
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
      let history = loadHistoryFromFile(req.historyFile);
      history = history.filter(r => r.id !== id);
      if (!saveHistoryToFile(history, req.historyFile)) {
        throw new Error('Historie konnte nicht gespeichert werden');
      }
      const stats = calculateHouseholdStats(history);
      res.json({ success: true, history, stats });
    } catch (err) {
      console.error('Fehler bei DELETE /api/history/:id:', err);
      res.status(500).json({ error: 'Fehler beim Löschen des Belegs', message: err.message });
    }
  });

  app.delete('/api/history', (req, res) => {
    try {
      if (!saveHistoryToFile([], req.historyFile)) {
        throw new Error('Historie konnte nicht gelöscht werden');
      }
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

  app.get('/api/markets', async (req, res) => {
    try {
      res.json(await searchNearbyMarkets({
        zipCode: req.query.zip,
        radiusKm: req.query.radius || 5,
        chain: req.query.chain || '',
        lat: req.query.lat,
        lon: req.query.lon,
      }));
    } catch (err) {
      res.status(/gültige|Radius|gefunden/.test(err.message) ? 400 : 503)
        .json({ error: err.message });
    }
  });

  // 5. QR-Code Warenkorb-Übertragung (PC ➔ Smartphone)
  app.post('/api/basket/share', async (req, res) => {
    try {
      const { items, zipCode = '10115' } = req.body || {};
      if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
        return res.status(400).json({ error: 'Einkaufszettel ist leer' });
      }

      // Eindeutige, kurze Share-ID (z. B. b-7k9p3)
      const shareId = `b-${crypto.randomBytes(12).toString('base64url')}`;
      const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 Stunden

      saveSharedBasket({
        id: shareId,
        items,
        zipCode,
        createdAt: new Date().toISOString(),
        expiresAt,
      });

      // The link must point at the same server that holds this share.
      const requestHost = req.get('host') || 'localhost:3000';
      const localHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(requestHost);
      const host = localHost ? `${getLocalIpAddress()}${requestHost.includes(':') ? requestHost.slice(requestHost.lastIndexOf(':')) : ''}` : requestHost;
      const forwardedProtocol = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
      const protocol = localHost ? 'http' : (forwardedProtocol === 'https' ? 'https' : 'http');
      const baseUrl = process.env.PUBLIC_BASE_URL || `${protocol}://${host}`;
      const shareUrl = new URL(`/?basket_share=${shareId}`, baseUrl).href;

      // Hochwertigen QR-Code als PNG Data-URL erzeugen (mit Fallback falls qrcode-Paket nicht vorhanden ist)
      const qrDataUrl = await QRCode.toDataURL(shareUrl, {
          errorCorrectionLevel: 'M',
          margin: 2,
          scale: 7,
          color: {
            dark: '#051410',
            light: '#ffffff',
          },
        });

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
      const data = loadSharedBasket(id);

      if (!data) {
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
