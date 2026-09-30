import test from 'node:test';
import assert from 'node:assert/strict';
import { identifyMarketChain, normalizeOsmMarket, searchNearbyMarkets } from '../src/api/markets.js';

test('nearby markets are real branch records with coordinates and Google Maps links', async () => {
  assert.equal(identifyMarketChain({ name: 'REWE Center Berlin' }), 'REWE Center');
  assert.equal(identifyMarketChain({ name: 'EDEKA Center Berlin' }), 'Edeka Center');
  assert.equal(identifyMarketChain({ name: 'Netto', 'brand:wikidata': 'Q552652' }), 'Netto mit dem Hund');
  assert.equal(identifyMarketChain({ brand: 'Netto Marken-Discount', operator: 'EDEKA' }), 'Netto Marken-Discount');
  assert.equal(identifyMarketChain({ name: 'Unknown Shop' }), null);
  assert.equal(normalizeOsmMarket({ type: 'node', id: 1, lat: 52.5, lon: 13.4, tags: { name: 'Unknown Shop' } }, { lat: 52.5, lon: 13.4 }), null);

  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push(url);
    if (url.includes('zippopotam')) {
      return new Response(JSON.stringify({ places: [{ latitude: '52.52', longitude: '13.40' }] }), { status: 200 });
    }
    assert.equal(options.method, undefined);
    assert.match(url, /\?data=/);
    return new Response(JSON.stringify({ elements: [
      { type: 'node', id: 123, lat: 52.521, lon: 13.401, tags: { name: 'Lidl', 'addr:street': 'Hauptstraße', 'addr:housenumber': '1', 'addr:city': 'Berlin' } },
      { type: 'node', id: 124, lat: 52.522, lon: 13.402, tags: { name: 'Hardware Shop' } },
    ] }), { status: 200 });
  };
  const data = await searchNearbyMarkets({ zipCode: '10115', fetchFn, cache: null });
  assert.equal(calls.length, 2);
  assert.equal(data.markets.length, 1);
  assert.equal(data.markets[0].id, 'osm-node-123');
  assert.equal(data.markets[0].chain, 'Lidl');
  assert.match(data.markets[0].mapsUrl, /^https:\/\/www\.google\.com\/maps\/search/);
  assert.ok(data.markets[0].distanceKm < 1);
});

test('market lookup rejects an invalid postcode before external requests', async () => {
  await assert.rejects(searchNearbyMarkets({ zipCode: 'Berlin', fetchFn: () => { throw new Error('unexpected'); } }), /PLZ/);
});

test('map search returns only the requested chain around the chosen map center', async () => {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify({ elements: [
      { type: 'node', id: 1, lat: 52.52, lon: 13.4, tags: { name: 'Lidl' } },
      { type: 'node', id: 2, lat: 52.521, lon: 13.401, tags: { name: 'REWE' } },
    ] }), { status: 200 });
  };
  const result = await searchNearbyMarkets({ zipCode: '10115', lat: 52.52, lon: 13.4, chain: 'Lidl', fetchFn, cache: null });
  assert.equal(calls.length, 1);
  assert.equal(result.markets.length, 1);
  assert.equal(result.markets[0].chain, 'Lidl');
  await assert.rejects(searchNearbyMarkets({ zipCode: '10115', lat: 99, lon: 13.4, fetchFn }), /Kartenmittelpunkt/);
});

test('market search uses a second Overpass instance if the first is unavailable', async () => {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    if (url.includes('zippopotam')) return new Response(JSON.stringify({ places: [{ latitude: '52.52', longitude: '13.4' }] }), { status: 200 });
    if (url.includes('maps.mail.ru')) throw new Error('offline');
    return new Response(JSON.stringify({ elements: [{ type: 'node', id: 4, lat: 52.52, lon: 13.4, tags: { name: 'Lidl' } }] }), { status: 200 });
  };
  const result = await searchNearbyMarkets({ zipCode: '10115', chain: 'Lidl', fetchFn, cache: null });
  assert.equal(result.markets.length, 1);
  assert.equal(calls.length, 3);
});
