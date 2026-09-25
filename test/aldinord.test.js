import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAldiItem, isBioProduct, isNonFoodProduct } from '../src/api/aldinord.js';
import { filterAndSortOffers } from '../src/engine/comparator.js';

test('T6.1: normalizeAldiItem wandelt Aldi-Nord Algolia-Objekt korrekt um', () => {
  const rawItem = {
    objectID: '12345',
    name: 'Kuchenriegel',
    brandName: 'YES',
    currentPrice: {
      priceValue: 1.49,
      strikePrice: { strikePriceValue: 1.99 },
      basePrice: [{ basePriceValue: 15.52, basePriceScale: 'kg' }],
      priceTagLabels: { promoText1: '-25 %' },
    },
    salesUnit: '3x32-g-Packung',
    assets: [{ type: 'primary', url: 'https://s7g10.scene7.com/is/image/aldinord/test_img' }],
    promotionPrices: [{ validFromLocalDate: '2026-09-21', validUntilLocalDate: '2026-09-26' }],
    categoryIDs: ['Angebote', 'Süßwaren'],
  };

  const offer = normalizeAldiItem(rawItem);

  assert.equal(offer.id, 'aldi-nord-12345');
  assert.equal(offer.title, 'YES Kuchenriegel');
  assert.equal(offer.brand, 'YES');
  assert.equal(offer.retailer, 'Aldi Nord');
  assert.equal(offer.retailerSlug, 'aldi-nord');
  assert.equal(offer.price, 1.49);
  assert.equal(offer.oldPrice, 1.99);
  assert.equal(offer.discountPercent, 25);
  assert.equal(offer.referencePrice, 15.52);
  assert.equal(offer.referenceUnit, 'kg');
  assert.equal(offer.formattedRefPrice, '15,52 € / kg');
  assert.equal(offer.packageSize, '3x32-g-Packung');
  assert.equal(offer.imageUrl, 'https://s7g10.scene7.com/is/image/aldinord/test_img');
  assert.equal(offer.isBio, false);
  assert.equal(offer.isNonFood, false);
});

test('T6.2: isBioProduct und isNonFoodProduct erkennen Attribute zuverlässig', () => {
  // Bio Erkennung
  assert.ok(isBioProduct('Bio Haferflocken', 'Gut Bio'));
  assert.ok(isBioProduct('Bioland Gouda', 'Alnatura'));
  assert.ok(!isBioProduct('Kuchenriegel', 'YES'));

  // Non-Food Erkennung
  assert.ok(isNonFoodProduct('Akku-Bohrschrauber 20V', 'FERREX', 'mit Zubehör und Koffer'));
  assert.ok(isNonFoodProduct('Gartenschere Bypass', 'GARDENLINE'));
  assert.ok(!isNonFoodProduct('Irische Butter 250g', 'Kerrygold'));
});

test('T6.3: filterAndSortOffers unterstützt onlyBio, onlyNonFood und Favoriten', () => {
  const items = [
    { id: '1', title: 'Bio Butter', brand: 'Gut Bio', price: 1.99, isBio: true, isNonFood: false },
    { id: '2', title: 'Konventionelle Butter', brand: 'Kerrygold', price: 1.79, isBio: false, isNonFood: false },
    { id: '3', title: 'Akku-Schrauber', brand: 'FERREX', price: 29.99, isBio: false, isNonFood: true },
  ];

  // Nur Bio
  const bioOnly = filterAndSortOffers(items, { onlyBio: true });
  assert.equal(bioOnly.length, 1);
  assert.equal(bioOnly[0].id, '1');

  // Nur Non-Food
  const nonFoodOnly = filterAndSortOffers(items, { onlyNonFood: true });
  assert.equal(nonFoodOnly.length, 1);
  assert.equal(nonFoodOnly[0].id, '3');

  // Nur Favoriten
  const favOnly = filterAndSortOffers(items, { onlyFavorites: true, favoriteKeywords: ['kerrygold'] });
  assert.equal(favOnly.length, 1);
  assert.equal(favOnly[0].id, '2');
});
