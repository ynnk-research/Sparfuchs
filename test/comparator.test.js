import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterAndSortOffers,
  getStandardizedReferencePrice,
  isOfferCurrentlyValid,
} from '../src/engine/comparator.js';

const mockOffers = [
  {
    id: '1',
    title: 'Markenbutter Kerrygold 250g',
    retailer: 'REWE',
    retailerSlug: 'rewe',
    price: 1.79,
    referencePrice: 7.16,
    referenceUnit: 'kg',
    discountPercent: 30,
    requiresApp: false,
    validFrom: '2026-09-20T00:00:00Z',
    validTo: '2026-09-26T23:59:59Z',
  },
  {
    id: '2',
    title: 'Familienpackung Butter 500g',
    retailer: 'Kaufland',
    retailerSlug: 'kaufland',
    price: 3.29,
    referencePrice: 6.58, // Günstiger pro kg als Kerrygold, aber höherer Gesamtpreis!
    referenceUnit: 'kg',
    discountPercent: 15,
    requiresApp: false,
    validFrom: '2026-09-20T00:00:00Z',
    validTo: '2026-09-26T23:59:59Z',
  },
  {
    id: '3',
    title: 'Discounter Butter 250g',
    retailer: 'Lidl',
    retailerSlug: 'lidl',
    price: 1.49,
    referencePrice: 5.96, // Am günstigsten pro kg
    referenceUnit: 'kg',
    discountPercent: 40,
    requiresApp: false,
    validFrom: '2026-09-20T00:00:00Z',
    validTo: '2026-09-26T23:59:59Z',
  },
  {
    id: '4',
    title: 'Bio-Butter 250g App-Special',
    retailer: 'Lidl',
    retailerSlug: 'lidl',
    price: 1.39,
    referencePrice: 5.56,
    referenceUnit: 'kg',
    discountPercent: 45,
    requiresApp: true, // Nur mit Lidl Plus App!
    validFrom: '2026-09-20T00:00:00Z',
    validTo: '2026-09-26T23:59:59Z',
  },
  {
    id: '5',
    title: 'Altes Butter-Angebot',
    retailer: 'Aldi Nord',
    retailerSlug: 'aldi-nord',
    price: 1.29,
    referencePrice: 5.16,
    referenceUnit: 'kg',
    discountPercent: 50,
    requiresApp: false,
    validFrom: '2026-09-01T00:00:00Z',
    validTo: '2026-09-10T23:59:59Z', // Vorbei!
  },
];

test('T2.1: Sortierung nach Grundpreis (€/kg) identifiziert echtes Schnäppchen über Packungsgrößen hinweg', () => {
  // Sortiere ohne alte Angebote
  const activeOffers = mockOffers.filter(o => o.id !== '5');
  const sorted = filterAndSortOffers(activeOffers, { sortBy: 'refPrice' });

  // Reihenfolge nach Grundpreis:
  // 1. #4 (5.56 €/kg)
  // 2. #3 (5.96 €/kg)
  // 3. #2 (6.58 €/kg - trotz hohem Endpreis von 3.29€!)
  // 4. #1 (7.16 €/kg)
  assert.equal(sorted[0].id, '4');
  assert.equal(sorted[1].id, '3');
  assert.equal(sorted[2].id, '2');
  assert.equal(sorted[3].id, '1');
});

test('T2.2: Sortierung nach absolutem Ladenpreis', () => {
  const activeOffers = mockOffers.filter(o => o.id !== '5');
  const sorted = filterAndSortOffers(activeOffers, { sortBy: 'price' });

  // Reihenfolge nach Endpreis: #4 (1.39€) < #3 (1.49€) < #1 (1.79€) < #2 (3.29€)
  assert.equal(sorted[0].id, '4');
  assert.equal(sorted[1].id, '3');
  assert.equal(sorted[2].id, '1');
  assert.equal(sorted[3].id, '2');
});

test('T2.3: Händlerfilter filtert zuverlässig nach Ketten', () => {
  const sorted = filterAndSortOffers(mockOffers, { retailers: ['Lidl'] });
  assert.equal(sorted.length, 2);
  assert.ok(sorted.every(o => o.retailer === 'Lidl'));
});

test('T2.4: App-Zwang-Filter schließt Angebote mit App-Bindung aus', () => {
  const sorted = filterAndSortOffers(mockOffers, {
    retailers: ['Lidl'],
    excludeAppOnly: true,
  });
  // Von den 2 Lidl-Angeboten fällt #4 (requiresApp: true) raus
  assert.equal(sorted.length, 1);
  assert.equal(sorted[0].id, '3');
  assert.equal(sorted[0].requiresApp, false);
});

test('T2.5: Gültigkeitsprüfung filtert abgelaufene Angebote heraus', () => {
  const fixedNow = new Date('2026-09-24T12:00:00Z');
  const sorted = filterAndSortOffers(mockOffers, {
    validNowOnly: true,
    referenceDate: fixedNow,
  });

  // #5 endete am 10.09.2026 und darf nicht enthalten sein
  assert.ok(!sorted.some(o => o.id === '5'));
  assert.equal(sorted.length, 4);
});

test('T2.6: getStandardizedReferencePrice standardisiert Einheiten wie 100g korrekt auf kg', () => {
  const offer100g = {
    price: 1.50,
    referencePrice: 1.50,
    referenceUnit: '100g',
  };
  const std = getStandardizedReferencePrice(offer100g);
  // 1.50 € pro 100g = 15.00 € pro kg
  assert.equal(std.pricePerBaseUnit, 15.0);
  assert.equal(std.baseUnit, 'kg');
});

test('T2.7: filterAndSortOffers unterstützt onlyFood und schließt Non-Food-Artikel aus', () => {
  const mixedOffers = [
    { id: 'f1', title: 'Bio Vollmilch', price: 1.19, isNonFood: false },
    { id: 'nf1', title: 'Akku-Bohrschrauber', price: 29.99, isNonFood: true },
    { id: 'f2', title: 'Kerrygold Butter', price: 1.79, isNonFood: false },
  ];

  const foodOnly = filterAndSortOffers(mixedOffers, { onlyFood: true });
  assert.equal(foodOnly.length, 2);
  assert.ok(foodOnly.every(o => !o.isNonFood));
  assert.equal(foodOnly[0].id, 'f1');
  assert.equal(foodOnly[1].id, 'f2');
});

test('T2.8: filterAndSortOffers reichert Angebote konsistent mit vollständigen Preis- und Sparangaben an', () => {
  const rawOffers = [
    { id: 'p1', title: 'Schokolade', price: 1.49, oldPrice: 1.99 },
    { id: 'p2', title: 'Kaffee', price: 3.99, discountPercent: 20 },
    { id: 'p3', title: 'Käse', price: 2.00 }, // Kein Streichpreis -> Benchmark-Schätzung
  ];

  const enriched = filterAndSortOffers(rawOffers);
  assert.equal(enriched.length, 3);

  const p1 = enriched.find(o => o.id === 'p1');
  const p2 = enriched.find(o => o.id === 'p2');
  const p3 = enriched.find(o => o.id === 'p3');

  // p1: echter Streichpreis
  assert.equal(p1.oldPrice, 1.99);
  assert.equal(p1.formattedOldPrice, '1,99 €');
  assert.equal(p1.savings, 0.50);
  assert.equal(p1.isEstimatedOldPrice, false);

  // p2: aus discountPercent berechnet
  assert.ok(p2.oldPrice > 3.99);
  assert.ok(p2.savings > 0);
  assert.equal(p2.isEstimatedOldPrice, false);

  // p3: Benchmark-Schätzung
  assert.equal(p3.oldPrice, 2.50);
  assert.equal(p3.formattedOldPrice, '2,50 €');
  assert.equal(p3.savings, 0.50);
  assert.equal(p3.isEstimatedOldPrice, true);
});
