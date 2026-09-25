import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEdekaDoc, searchEdekaOffers } from '../src/api/edeka.js';

test('T9.1: normalizeEdekaDoc standardisiert EDEKA-Rohdaten korrekt', () => {
  const rawDoc = {
    angebotid: '6369029',
    titel: 'Bauerngut Schweinelachsbraten',
    beschreibung: 'besonders zart und mager, 1kg',
    preis: 5.99,
    nachlass: '49 %',
    basicPrice: '5.99 € / 1 kg',
    bild_app: 'https://offer-images.api.edeka/sample.jpg',
    warengruppe: 'Fleisch & Wurst',
    kriterien: [{ name: 'App-Rabatt' }],
    gueltig_bis: '2026-09-26T00:00:00.000Z',
  };

  const offer = normalizeEdekaDoc(rawDoc);

  assert.ok(offer, 'Angebot sollte nicht null sein');
  assert.equal(offer.id, 'edeka-6369029');
  assert.equal(offer.title, 'Bauerngut Schweinelachsbraten');
  assert.equal(offer.retailer, 'EDEKA');
  assert.equal(offer.price, 5.99);
  assert.equal(offer.formattedPrice, '5,99 €');
  assert.equal(offer.discountPercent, 49);
  assert.equal(offer.referencePrice, 5.99);
  assert.equal(offer.referenceUnit, 'kg');
  assert.equal(offer.requiresApp, true, 'App-Kriterium sollte erkannt werden');
  assert.equal(offer.isBio, false);
});

test('T9.2: normalizeEdekaDoc erkennt Bio-Produkte und berechnet Grundpreis aus Grammangaben', () => {
  const bioDoc = {
    angebotid: '778899',
    titel: 'EDEKA Bio Haferflocken',
    beschreibung: 'feine Flocken, 500 g',
    preis: 0.99,
    basicPrice: null,
    warengruppe: 'Grundnahrung',
  };

  const offer = normalizeEdekaDoc(bioDoc);

  assert.ok(offer);
  assert.equal(offer.isBio, true, 'EDEKA Bio sollte als Bio erkannt werden');
  assert.equal(offer.referencePrice, 1.98, '500g für 0.99€ ergibt 1.98€/kg');
  assert.equal(offer.referenceUnit, 'kg');
  assert.equal(offer.requiresApp, false);
});

test('T9.3: searchEdekaOffers filtert nach Suchbegriffen', async () => {
  const mockCache = {
    get: () => [
      { id: '1', title: 'Bio Butter', brand: 'EDEKA Bio', description: '250g', categories: ['Molkerei'] },
      { id: '2', title: 'Kaffee Crema', brand: 'Jacobs', description: '1kg Bohnen', categories: ['Kaffee'] },
    ],
    set: () => {},
  };

  const results = await searchEdekaOffers('butter', '10115', { cache: mockCache });
  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'Bio Butter');
});
