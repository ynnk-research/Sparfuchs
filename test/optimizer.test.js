import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizeBasket } from '../src/engine/optimizer.js';

test('T3.1: Single-Store Champion wählt den Supermarkt mit der besten Abdeckung', () => {
  const itemQueries = ['Butter', 'Kaffee', 'Milch'];

  const itemResultsMap = {
    Butter: [
      { id: '1', title: 'Butter', retailer: 'Lidl', price: 1.49, referencePrice: 5.96, referenceUnit: 'kg' },
      { id: '2', title: 'Butter', retailer: 'REWE', price: 1.79, referencePrice: 7.16, referenceUnit: 'kg' },
    ],
    Kaffee: [
      { id: '3', title: 'Kaffee', retailer: 'REWE', price: 4.99, referencePrice: 9.98, referenceUnit: 'kg' },
      { id: '4', title: 'Kaffee', retailer: 'Kaufland', price: 5.49, referencePrice: 10.98, referenceUnit: 'kg' },
    ],
    Milch: [
      { id: '5', title: 'Milch', retailer: 'Lidl', price: 0.89, referencePrice: 0.89, referenceUnit: 'l' },
      { id: '6', title: 'Milch', retailer: 'REWE', price: 1.19, referencePrice: 1.19, referenceUnit: 'l' },
    ],
  };

  const result = optimizeBasket(itemQueries, itemResultsMap);

  // REWE hat alle 3 Artikel (100% Abdeckung)
  // Lidl hat nur 2 Artikel (Butter, Milch)
  assert.equal(result.singleStoreChampion.retailer, 'REWE');
  assert.equal(result.singleStoreChampion.matchedCount, 3);
  assert.equal(result.singleStoreChampion.totalPrice, 7.97);
});

test('T3.2: Smart Split teilt Artikel optimal auf 2 Märkte auf und maximiert Ersparnis', () => {
  const itemQueries = ['Butter', 'Kaffee', 'Milch'];

  const itemResultsMap = {
    Butter: [
      { id: '1', title: 'Butter', retailer: 'Lidl', price: 1.49, referencePrice: 5.96, referenceUnit: 'kg' },
      { id: '2', title: 'Butter', retailer: 'REWE', price: 1.79, referencePrice: 7.16, referenceUnit: 'kg' },
    ],
    Kaffee: [
      { id: '3', title: 'Kaffee', retailer: 'REWE', price: 4.99, referencePrice: 9.98, referenceUnit: 'kg' },
      { id: '4', title: 'Kaffee', retailer: 'Kaufland', price: 5.49, referencePrice: 10.98, referenceUnit: 'kg' },
    ],
    Milch: [
      { id: '5', title: 'Milch', retailer: 'Lidl', price: 0.89, referencePrice: 0.89, referenceUnit: 'l' },
      { id: '6', title: 'Milch', retailer: 'REWE', price: 1.19, referencePrice: 1.19, referenceUnit: 'l' },
    ],
  };

  const result = optimizeBasket(itemQueries, itemResultsMap);

  // Smart Split sollte Lidl + REWE kombinieren:
  // - Lidl: Butter (1.49) + Milch (0.89) = 2.38
  // - REWE: Kaffee (4.99)
  // Gesamtsumme: 7.37 € statt 7.97 € (Ersparnis: 0.60 €)
  assert.ok(result.smartSplit);
  assert.ok(result.smartSplit.stores.includes('Lidl'));
  assert.ok(result.smartSplit.stores.includes('REWE'));
  assert.equal(result.smartSplit.matchedCount, 3);
  assert.equal(result.smartSplit.totalPrice, 7.37);
  assert.equal(result.splitSavingsVsSingle, 0.60);
  const withTrip = optimizeBasket(itemQueries, itemResultsMap, { extraStoreCost: 1.00 });
  assert.equal(withTrip.splitNetSaving, -0.40);
});

test('T3.3: Missing Items werden korrekt erfasst wenn kein Angebot existiert', () => {
  const itemQueries = ['Butter', 'ExotischesGewürzXYZ'];

  const itemResultsMap = {
    Butter: [
      { id: '1', title: 'Butter', retailer: 'Lidl', price: 1.49, referencePrice: 5.96, referenceUnit: 'kg' },
    ],
    ExotischesGewürzXYZ: [], // Keine Treffer
  };

  const result = optimizeBasket(itemQueries, itemResultsMap);

  assert.equal(result.singleStoreChampion.retailer, 'Lidl');
  assert.equal(result.singleStoreChampion.matchedCount, 1);
  assert.equal(result.singleStoreChampion.missingCount, 1);
  assert.deepEqual(result.singleStoreChampion.missingItems, ['ExotischesGewürzXYZ']);
});

test('T3.4: Optimizer liefert Top-3 Alternativen und erfasst Angebote weiterer Supermärkte', () => {
  const itemQueries = ['Butter', 'Mehl'];

  const itemResultsMap = {
    Butter: [
      { id: '1', title: 'Landliebe Butter', retailer: 'Netto', price: 1.00, referencePrice: 4.00, referenceUnit: 'kg' },
      { id: '2', title: 'Rama mit Butter', retailer: 'REWE', price: 1.29, referencePrice: 5.16, referenceUnit: 'kg' },
      { id: '3', title: 'Kerrygold Butter', retailer: 'Lidl', price: 1.69, referencePrice: 6.76, referenceUnit: 'kg' },
      { id: '4', title: 'K-Classic Butter', retailer: 'Kaufland', price: 1.79, referencePrice: 7.16, referenceUnit: 'kg' },
      { id: '5', title: 'Meggle Butter', retailer: 'Penny', price: 1.99, referencePrice: 7.96, referenceUnit: 'kg' },
    ],
    Mehl: [
      { id: '6', title: 'K-Bio Dinkelmehl', retailer: 'Kaufland', price: 1.11, referencePrice: 1.11, referenceUnit: 'kg' },
      { id: '7', title: 'Weizenmehl Type 405', retailer: 'Penny', price: 1.25, referencePrice: 1.25, referenceUnit: 'kg' },
    ],
  };

  const result = optimizeBasket(itemQueries, itemResultsMap, {
    retailers: ['Netto', 'REWE', 'Lidl', 'Kaufland', 'Penny'],
  });

  assert.ok(result.smartSplit);
  // Prüfe dass Butter Alternativen enthält (bis zu 3)
  const storeA = result.smartSplit.stores[0];
  const itemsA = result.smartSplit.allocations[storeA].items;
  if (itemsA.length > 0 && itemsA[0].query === 'Butter') {
    assert.ok(Array.isArray(itemsA[0].alternatives));
    assert.ok(itemsA[0].alternatives.length > 0 && itemsA[0].alternatives.length <= 3);
  }

  // bestPerItem sollte beide Artikel enthalten
  assert.equal(result.bestPerItem.length, 2);
  assert.equal(result.bestPerItem[0].offer.retailer, 'Netto');
});

test('T3.5: sanitizeItemForSearch bereinigt Einheiten mit Liter, Plural-Klammern (n) und Mengenangaben sauber', async () => {
  const { sanitizeItemForSearch } = await import('../src/engine/optimizer.js');

  assert.equal(sanitizeItemForSearch('0.5 Liter Milch'), 'Milch');
  assert.equal(sanitizeItemForSearch('1 Dose Tomate(n), geschälte'), 'Tomaten');
  assert.equal(sanitizeItemForSearch('40 g Mehl'), 'Mehl');
  assert.equal(sanitizeItemForSearch('2 Knoblauchzehe(n)'), 'Knoblauch');
  assert.equal(sanitizeItemForSearch('1 Zwiebel'), 'Zwiebel');
  assert.equal(sanitizeItemForSearch('300 g Lasagneplatte(n)'), 'Lasagneplatten');
  assert.equal(sanitizeItemForSearch('200 g Crème fraîche'), 'Creme Fraiche');
});

test('T3.6: Optimizer multipliziert Zwischensummen und Ersparnisse korrekt mit den Stückzahlen (quantities)', () => {
  const itemQueries = ['Butter', 'Milch'];
  const itemResultsMap = {
    Butter: [
      { id: 'b1', title: 'Butter', retailer: 'Lidl', price: 1.50, oldPrice: 2.00 },
      { id: 'b2', title: 'Butter', retailer: 'REWE', price: 1.80, oldPrice: 2.00 },
    ],
    Milch: [
      { id: 'm1', title: 'Milch', retailer: 'Lidl', price: 1.05, oldPrice: 1.25 },
      { id: 'm2', title: 'Milch', retailer: 'REWE', price: 0.99, oldPrice: 1.25 },
    ],
  };

  // 4x Butter und 2x Milch
  const quantities = { Butter: 4, Milch: 2 };
  const result = optimizeBasket(itemQueries, itemResultsMap, { quantities });

  // Single-Store Champion Lidl:
  // Butter: 4 * 1.50 = 6.00 € (Ersparnis 4 * 0.50 = 2.00 €)
  // Milch:  2 * 1.05 = 2.10 € (Ersparnis 2 * 0.20 = 0.40 €)
  // Gesamt: 8.10 € (Ersparnis 2.40 €)
  assert.equal(result.singleStoreChampion.retailer, 'Lidl');
  assert.equal(result.singleStoreChampion.totalPrice, 8.10);
  assert.equal(result.singleStoreChampion.totalSavings, 2.40);

  // Smart Split (Lidl Butter + REWE Milch):
  // Lidl Butter: 4 * 1.50 = 6.00 €
  // REWE Milch:  2 * 0.99 = 1.98 €
  // Gesamt Split: 7.98 € (Ersparnis: (8.10 - 7.98) = 0.12 € ggü. Single-Store)
  assert.ok(result.smartSplit);
  assert.equal(result.smartSplit.totalPrice, 7.98);
  assert.equal(result.splitSavingsVsSingle, 0.12);
  assert.equal(result.smartSplit.allocations['Lidl'].subtotal, 6.00);
  assert.equal(result.smartSplit.allocations['REWE'].subtotal, 1.98);
});
