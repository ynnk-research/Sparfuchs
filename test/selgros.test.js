import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { globalPersistentCache } from '../src/api/cache.js';
import { parseSelgrosMarkets, normalizeSelgrosOffer, searchSelgrosOffers, selgrosDailyKey } from '../src/api/selgros.js';
import { filterAndSortOffers, calculateItemSavings } from '../src/engine/comparator.js';

const marketsHtml = `<tg-option value='10' data-lon='13.5' data-lat='52.5'>Berlin-Lichtenberg</tg-option>
<script type="application/json" data-drupal-selector="drupal-settings-json">{"schaufenster":{"marketsMap":{"10":"128"}}}</script>`;
const sample = {
  productId: '42', title: 'Käse 20g', productBrand: 'Marke', visible: true,
  category: ['Milchprodukte'], minSellUnit: '', units: [{ baseUnit: true, unit: { code: 'ST' } }],
  prices: [{ plant: '0128', unit: 'ST', price: { grossPrice: 9.62 }, offerPrice: {
    grossPrice: 8.01, netPrice: 7.49, offerFrom: '2026-11-01T00:00:00Z', offerUntil: '2026-12-01T00:00:00Z',
  } }], images: [],
};
const now = new Date('2026-11-09T12:00:00Z');

test('Selgros maps official branch IDs and uses the public UTC request key', () => {
  assert.deepEqual(parseSelgrosMarkets(marketsHtml), [{ id: '128', name: 'Berlin-Lichtenberg', lat: 52.5, lon: 13.5 }]);
  assert.equal(selgrosDailyKey(now), '467d062b2f31210df29bd93316b5f2cc990fece343736c4d9c13042b9f109d3b');
  assert.throws(() => parseSelgrosMarkets('<html></html>'), /Marktdaten/);
});

test('only active gross prices for a verified selling unit enter the comparison', () => {
  const offer = normalizeSelgrosOffer(sample, '128', 'Käse', now);
  assert.equal(offer.price, 8.01);
  assert.equal(offer.oldPrice, 9.62);
  assert.match(offer.description, /Brutto je 1 Stück/);
  const filtered = filterAndSortOffers([offer], { allowedRetailers: ['Selgros'], validNowOnly: false });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].referencePrice, null, '20g in the title may describe one slice rather than the pack');
  assert.equal(calculateItemSavings({ ...offer, oldPrice: null }, [{ ...offer, id: 'other', retailer: 'REWE', price: 10 }]).isEstimated, false);
  assert.equal(normalizeSelgrosOffer({ ...sample, minSellUnit: 'CO' }, '128', '', now), null);
  assert.equal(normalizeSelgrosOffer(sample, '106', '', now), null);
  assert.equal(normalizeSelgrosOffer(sample, '128', '', new Date('2027-01-01')), null);
  assert.equal(normalizeSelgrosOffer({ ...sample, priceDataInvalid: true }, '128', '', now), null);
  const kg = structuredClone(sample); kg.units[0].unit.code = 'KG'; kg.prices[0].unit = 'KG';
  assert.equal(normalizeSelgrosOffer(kg, '128', '', now).referencePrice, 8.01);
});

test('Selgros request uses selected branch and rejects unknown IDs', async () => {
  const calls = [];
  const fetchFn = async (url, options = {}) => {
    calls.push({ url, options });
    if (calls.length === 1) return new Response(marketsHtml);
    return Response.json({ value: [] });
  };
  assert.deepEqual(await searchSelgrosOffers({ query: 'Butter', marketId: '128', fetchFn, cache: null }), []);
  assert.match(JSON.parse(calls[1].options.body).filter, /m eq 128/);
  assert.equal(JSON.parse(calls[1].options.body).search, 'Butter');
  await assert.rejects(searchSelgrosOffers({ marketId: '128) or true', fetchFn: async () => new Response(marketsHtml), cache: null }), /Ungültiger/);
});

test('server includes selected Selgros offers and excludes them when inactive', async () => {
  const offer = normalizeSelgrosOffer({ ...sample, prices: [{ ...sample.prices[0], offerPrice: { ...sample.prices[0].offerPrice, offerFrom: '2020-01-01T00:00:00Z', offerUntil: '2090-01-01T00:00:00Z' } }] }, '128');
  const fixture = value => ({ value, expiresAt: Date.now() + 60_000 });
  globalPersistentCache.memoryCache.set('selgros_markets_v1', fixture([{ id: '128', name: 'Berlin', lat: 52.5, lon: 13.5 }]));
  globalPersistentCache.memoryCache.set('selgros_v1_128_käse', fixture([offer]));
  const originalFetch = globalThis.fetch;
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  globalThis.fetch = (url, options) => String(url).startsWith('http://127.0.0.1:')
    ? originalFetch(url, options) : Promise.resolve(Response.json({ results: [] }));
  try {
    const read = async (active) => (await globalThis.fetch(`http://127.0.0.1:${port}/api/offers?q=K%C3%A4se&zip=10115&activeRetailers=${active}&selgrosMarket=128`)).json();
    const selected = await read('Selgros');
    assert.ok(selected.offers.some(o => o.id === offer.id));
    assert.equal(selected.sources.find(s => s.source === 'Selgros').scope, 'gewählte Filiale, Brutto');
    const inactive = await read('Lidl');
    assert.ok(!inactive.offers.some(o => o.retailer === 'Selgros'));
  } finally {
    globalThis.fetch = originalFetch;
    globalPersistentCache.memoryCache.delete('selgros_markets_v1');
    globalPersistentCache.memoryCache.delete('selgros_v1_128_käse');
    server.close();
  }
});
