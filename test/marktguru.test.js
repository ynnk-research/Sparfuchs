import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOffer, OfferCache, searchOffers, MARKTGURU_BASE_URL, MARKTGURU_HEADERS } from '../src/api/marktguru.js';

test('T1.1: normalizeOffer wandelt vollständiges Marktguru-Item korrekt um', () => {
  const rawItem = {
    id: 24991618,
    brand: { id: 114952, name: 'Kerrygold' },
    advertisers: [{ id: 'retailers/126802', name: 'REWE', uniqueName: 'rewe' }],
    product: { id: 321769, name: 'Original Irische Butter' },
    description: 'oder Extra versch. Sorten, je 250-g-Pckg./Becher',
    price: 1.79,
    oldPrice: 2.99,
    referencePrice: 7.16,
    unit: { shortName: 'kg', name: 'Kilogramm' },
    volume: 0.25,
    requiresLoyalityMembership: false,
    validityDates: [{ from: '2026-09-20T22:00:00Z', to: '2026-09-26T21:59:59Z' }],
    categories: [{ id: 166, name: 'Butter' }],
  };

  const offer = normalizeOffer(rawItem, 'Butter');

  assert.equal(offer.id, '24991618');
  assert.equal(offer.title, 'Kerrygold Original Irische Butter');
  assert.equal(offer.brand, 'Kerrygold');
  assert.equal(offer.retailer, 'REWE');
  assert.equal(offer.retailerSlug, 'rewe');
  assert.equal(offer.price, 1.79);
  assert.equal(offer.formattedPrice, '1,79 €');
  assert.equal(offer.oldPrice, 2.99);
  assert.equal(offer.formattedOldPrice, '2,99 €');
  assert.equal(offer.discountPercent, 40); // (2.99 - 1.79) / 2.99 = 40%
  assert.equal(offer.referencePrice, 7.16);
  assert.equal(offer.referenceUnit, 'kg');
  assert.equal(offer.formattedRefPrice, '7,16 € / kg');
  assert.equal(offer.packageSize, '250 g');
  assert.equal(offer.requiresApp, false);
  assert.equal(offer.validFrom, '2026-09-20T22:00:00Z');
  assert.equal(offer.validTo, '2026-09-26T21:59:59Z');
  assert.equal(offer.imageUrl, 'https://cdn.marktguru.de/api/v1/offers/24991618/images/default/0/medium.webp');
  assert.deepEqual(offer.categories, ['Butter']);
});

test('T1.2: normalizeOffer fängt fehlende Felder sicher ab und berechnet Grundpreis aus Volumen', () => {
  const partialItem = {
    id: 999999,
    advertisers: [{ name: 'Lidl' }],
    price: '2.50',
    volume: 0.5,
    unit: { shortName: 'l' },
    requiresLoyalityMembership: true,
  };

  const offer = normalizeOffer(partialItem, 'Milch');

  assert.equal(offer.id, '999999');
  assert.equal(offer.retailer, 'Lidl');
  assert.equal(offer.price, 2.5);
  assert.equal(offer.requiresApp, true);
  // Automatisch berechneter Referenzpreis: 2.50 / 0.5 = 5.00 € / l
  assert.equal(offer.referencePrice, 5.0);
  assert.equal(offer.formattedRefPrice, '5,00 € / l');
  assert.equal(offer.packageSize, '500 ml');
  assert.equal(offer.oldPrice, null);
  assert.equal(offer.discountPercent, null);
});

test('T1.3: OfferCache speichert und respektiert TTL', async () => {
  const cache = new OfferCache(50); // 50ms TTL
  cache.set('test-key', { data: 'test-value' });

  assert.deepEqual(cache.get('test-key'), { data: 'test-value' });

  // Nach Ablauf der TTL sollte null zurückkommen
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(cache.get('test-key'), null);
});

test('T1.4: searchOffers nutzt Cache und sendet korrekte Request-Parameter', async () => {
  let callCount = 0;
  const mockFetch = async (url, options) => {
    callCount++;
    assert.match(url, new RegExp(MARKTGURU_BASE_URL));
    assert.match(url, /q=butter/);
    assert.match(url, /zipCode=10115/);
    assert.equal(options.headers['x-clientkey'], MARKTGURU_HEADERS['x-clientkey']);

    return {
      ok: true,
      json: async () => ({
        totalResults: 1,
        results: [
          {
            id: 12345,
            price: 1.99,
            product: { name: 'Deutsche Markenbutter' },
            advertisers: [{ name: 'Aldi Nord' }],
          },
        ],
        filters: {
          retailers: [{ id: 1, name: 'Aldi Nord', resultsCount: 1 }],
          categories: [{ id: 1, name: 'Butter', resultsCount: 1 }],
        },
      }),
    };
  };

  const testCache = new OfferCache();

  // Erster Aufruf -> Ruft fetch auf
  const res1 = await searchOffers({
    query: 'butter',
    zipCode: '10115',
    fetchFn: mockFetch,
    cache: testCache,
  });

  assert.equal(callCount, 1);
  assert.equal(res1.offers.length, 1);
  assert.equal(res1.offers[0].retailer, 'Aldi Nord');

  // Zweiter Aufruf -> Kommt aus Cache, kein zweiter Fetch!
  const res2 = await searchOffers({
    query: 'butter',
    zipCode: '10115',
    fetchFn: mockFetch,
    cache: testCache,
  });

  assert.equal(callCount, 1);
  assert.equal(res2.offers[0].retailer, 'Aldi Nord');
});
