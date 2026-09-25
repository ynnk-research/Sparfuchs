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
