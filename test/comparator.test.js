import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterAndSortOffers,
  getStandardizedReferencePrice,
  extractPackageAmountAndUnit,
  isOfferCurrentlyValid,
  isGenuineSupermarket,
  isMatchingRetailer,
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

test('T15.1: isGenuineSupermarket und Whitelist filtern Non-Food-Möbelhäuser und Baumärkte zuverlässig aus', () => {
  // 1. Whitelist Prüfung
  assert.equal(isGenuineSupermarket('Lidl'), true);
  assert.equal(isGenuineSupermarket('Aldi Nord'), true);
  assert.equal(isGenuineSupermarket('REWE City'), true);
  assert.equal(isGenuineSupermarket('EDEKA Center'), true);
  assert.equal(isGenuineSupermarket('Kaufland'), true);
  assert.equal(isGenuineSupermarket('dm-drogerie markt'), true);
  assert.equal(isGenuineSupermarket('Rossmann'), true);

  // 2. Blacklist / Non-Supermarket Prüfung
  assert.equal(isGenuineSupermarket('XXXLutz'), false);
  assert.equal(isGenuineSupermarket('Mömax'), false);
  assert.equal(isGenuineSupermarket('POCO'), false);
  assert.equal(isGenuineSupermarket('IKEA'), false);
  assert.equal(isGenuineSupermarket('OBI'), false);
  assert.equal(isGenuineSupermarket('Bauhaus'), false);
  assert.equal(isGenuineSupermarket('MediaMarkt'), false);

  // 3. filterAndSortOffers schließt Angebote von Non-Supermärkten automatisch aus
  const mixedOffers = [
    { id: '1', title: 'Deutsche Markenbutter', retailer: 'Lidl', price: 1.49 },
    { id: '2', title: 'Butterdose Porzellan', retailer: 'XXXLutz', price: 9.99 },
    { id: '3', title: 'Kaffeetasse', retailer: 'POCO', price: 2.99 },
    { id: '4', title: 'Bio Butter', retailer: 'REWE', price: 1.79 },
    { id: '5', title: 'Bohrmaschine', retailer: 'OBI', price: 49.99 },
  ];

  const filtered = filterAndSortOffers(mixedOffers, { strictSupermarketOnly: true });
  assert.equal(filtered.length, 2);
  assert.equal(filtered[0].retailer, 'Lidl');
  assert.equal(filtered[1].retailer, 'REWE');
});

test('T15.2: filterAndSortOffers filtert präzise nach Mindestrabatt (minDiscount)', () => {
  const deals = [
    { id: 'd1', title: 'Deal 10%', price: 9.00, oldPrice: 10.00, discountPercent: 10 },
    { id: 'd2', title: 'Deal 25%', price: 7.50, oldPrice: 10.00, discountPercent: 25 },
    { id: 'd3', title: 'Deal 35%', price: 6.50, oldPrice: 10.00, discountPercent: 35 },
    { id: 'd4', title: 'Deal 50%', price: 5.00, oldPrice: 10.00, discountPercent: 50 },
  ];

  const min20 = filterAndSortOffers(deals, { minDiscount: 20 });
  assert.equal(min20.length, 3);
  assert.ok(min20.every(d => d.discountPercent >= 20));

  const min30 = filterAndSortOffers(deals, { minDiscount: 30 });
  assert.equal(min30.length, 2);
  assert.ok(min30.every(d => d.discountPercent >= 30));

  const min50 = filterAndSortOffers(deals, { minDiscount: 50 });
  assert.equal(min50.length, 1);
  assert.equal(min50[0].id, 'd4');
});

test('T15.3: filterAndSortOffers filtert nach dynamischer Liste aktiver Supermärkte (allowedRetailers)', () => {
  const multiStoreOffers = [
    { id: 's1', title: 'Butter', retailer: 'Lidl', price: 1.49 },
    { id: 's2', title: 'Butter', retailer: 'Aldi Nord', price: 1.49 },
    { id: 's3', title: 'Butter', retailer: 'REWE', price: 1.79 },
    { id: 's4', title: 'Butter', retailer: 'EDEKA', price: 1.79 },
    { id: 's5', title: 'Butter', retailer: 'Kaufland', price: 1.69 },
  ];

  // Nur Lidl und Aldi Nord aktiv
  const activeSelected = filterAndSortOffers(multiStoreOffers, {
    allowedRetailers: ['Lidl', 'Aldi Nord'],
  });

  assert.equal(activeSelected.length, 2);
  const retailers = activeSelected.map(o => o.retailer);
  assert.ok(retailers.includes('Lidl'));
  assert.ok(retailers.includes('Aldi Nord'));
  assert.ok(!retailers.includes('REWE'));
  assert.ok(!retailers.includes('EDEKA'));
});

test('T15.4: extractPackageAmountAndUnit erkennt Einzelmengen, Multipacks und Stückzahlen', () => {
  // 1. Einzelmengen
  const g250 = extractPackageAmountAndUnit('250 g');
  assert.equal(g250.baseAmount, 0.25);
  assert.equal(g250.baseUnit, 'kg');

  const l15 = extractPackageAmountAndUnit('1,5 l');
  assert.equal(l15.baseAmount, 1.5);
  assert.equal(l15.baseUnit, 'l');

  const ml500 = extractPackageAmountAndUnit('', 'Olivenöl', 'je 500-ml-Flasche');
  assert.equal(ml500.baseAmount, 0.5);
  assert.equal(ml500.baseUnit, 'l');

  // 2. Multipacks
  const sixPack = extractPackageAmountAndUnit('', 'Bier 6 x 0,5 l');
  assert.equal(sixPack.baseAmount, 3.0);
  assert.equal(sixPack.baseUnit, 'l');

  // 3. Stückzahlen
  const eggs = extractPackageAmountAndUnit('10 Stück');
  assert.equal(eggs.baseAmount, 10);
  assert.equal(eggs.baseUnit, 'Stück');
});

test('T15.5: getStandardizedReferencePrice berechnet Grundpreis aus Mengenangaben wenn referencePrice fehlt', () => {
  // Angebot ohne referencePrice, aber mit Mengenangabe 250g im Titel
  const butterOffer = {
    title: 'Deutsche Markenbutter 250g',
    price: 1.49,
    // referencePrice fehlt!
  };
  const std = getStandardizedReferencePrice(butterOffer);
  // 1.49 € für 250g = 5.96 € / kg
  assert.equal(std.pricePerBaseUnit, 5.96);
  assert.equal(std.baseUnit, 'kg');
  assert.equal(std.isEstimated, false);

  // Getränk 1,5 Liter für 0,99 €
  const drinkOffer = {
    title: 'Eistee Pfirsich',
    packageSize: '1,5 l',
    price: 0.99,
  };
  const stdDrink = getStandardizedReferencePrice(drinkOffer);
  // 0.99 € für 1.5 l = 0.66 € / l
  assert.equal(stdDrink.pricePerBaseUnit, 0.66);
  assert.equal(stdDrink.baseUnit, 'l');
  assert.equal(stdDrink.isEstimated, false);
});

test('T15.6: Strikte Unterscheidung zwischen REWE und REWE Center', () => {
  // 1. isMatchingRetailer Logik-Tests
  assert.equal(isMatchingRetailer('REWE', 'rewe', 'rewe'), true);
  assert.equal(isMatchingRetailer('REWE Markt', 'rewe', 'rewe'), true);
  assert.equal(isMatchingRetailer('REWE Center', 'rewe-center', 'rewe'), false, 'REWE Center darf NICHT unter REWE erscheinen');
  assert.equal(isMatchingRetailer('REWE', 'rewe', 'rewe center'), false, 'REWE darf NICHT unter REWE Center erscheinen');
  assert.equal(isMatchingRetailer('REWE Center', 'rewe-center', 'rewe center'), true);
  assert.equal(isMatchingRetailer('REWE Center Darmstadt', 'rewe-center', 'rewe center'), true);

  // Edeka vs Edeka Center
  assert.equal(isMatchingRetailer('EDEKA', 'edeka', 'edeka'), true);
  assert.equal(isMatchingRetailer('EDEKA Center', 'edeka-center', 'edeka'), false);
  assert.equal(isMatchingRetailer('EDEKA Center', 'edeka-center', 'edeka center'), true);

  // 2. filterAndSortOffers Test mit gemischten REWE und REWE Center Angeboten
  const mixedOffers = [
    {
      id: 'r1',
      title: 'Vollmilch 1L',
      retailer: 'REWE',
      retailerSlug: 'rewe',
      price: 1.09,
      validFrom: '2026-09-20T00:00:00Z',
      validTo: '2026-09-30T23:59:59Z',
    },
    {
      id: 'rc1',
      title: 'Vollmilch 1L Großpackung',
      retailer: 'REWE Center',
      retailerSlug: 'rewe-center',
      price: 0.99,
      validFrom: '2026-09-20T00:00:00Z',
      validTo: '2026-09-30T23:59:59Z',
    },
    {
      id: 'l1',
      title: 'Vollmilch 1L',
      retailer: 'Lidl',
      retailerSlug: 'lidl',
      price: 1.05,
      validFrom: '2026-09-20T00:00:00Z',
      validTo: '2026-09-30T23:59:59Z',
    },
  ];

  // Filter nach 'REWE': nur r1
  const reweResults = filterAndSortOffers(mixedOffers, { retailer: 'REWE' });
  assert.equal(reweResults.length, 1);
  assert.equal(reweResults[0].id, 'r1');
  assert.equal(reweResults[0].retailer, 'REWE');

  // Filter nach 'REWE Center': nur rc1
  const reweCenterResults = filterAndSortOffers(mixedOffers, { retailer: 'REWE Center' });
  assert.equal(reweCenterResults.length, 1);
  assert.equal(reweCenterResults[0].id, 'rc1');
  assert.equal(reweCenterResults[0].retailer, 'REWE Center');

  // Filter mit allowedRetailers: ['REWE'] schließt REWE Center aus
  const allowedReweResults = filterAndSortOffers(mixedOffers, { allowedRetailers: ['REWE'] });
  assert.equal(allowedReweResults.length, 1);
  assert.equal(allowedReweResults[0].id, 'r1');

  // Filter mit allowedRetailers: ['REWE Center'] schließt REWE aus
  const allowedReweCenterResults = filterAndSortOffers(mixedOffers, { allowedRetailers: ['REWE Center'] });
  assert.equal(allowedReweCenterResults.length, 1);
  assert.equal(allowedReweCenterResults[0].id, 'rc1');
});


