import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNettoMitHundHtml } from '../src/api/nettomithund.js';
import { isMatchingRetailer, filterAndSortOffers } from '../src/engine/comparator.js';

const mockNettoHtml = `
<!DOCTYPE html>
<html>
<body>
  <span>Angebote vom: 28-09-2026 bis 02-10-2026</span>
  <div class="rounded-2xl" aria-label="product-0">
    <img src="https://media.umbraco.io/sample/gurke.png" />
    <h4>Gurke</h4>
    <p class="leading-3">Spanien, Kl. I 350 g + Stück</p>
    <h3>0<!-- -->.<span>55</span></h3>
  </div>
  <div class="rounded-2xl" aria-label="product-1">
    <img src="https://media.umbraco.io/sample/milch.png" />
    <h4>frija\nH-Milch 3,5 % Fett</h4>
    <p class="leading-3">12 x 1 Liter\n1 Liter = 0.75\n1 Packung = 0.95</p>
    <span>statt 11.40</span>
    <span>-21%</span>
    <h3>9<!-- -->.<span>-</span></h3>
  </div>
</body>
</html>
`;

test('T17.1: parseNettoMitHundHtml parst Produktkarten und berechnet Preise korrekt', () => {
  const offers = parseNettoMitHundHtml(mockNettoHtml, 'https://netto.de/angebote/');

  assert.equal(offers.length, 2);

  // Produkt 1: Gurke
  const gurke = offers[0];
  assert.equal(gurke.title, 'Gurke');
  assert.equal(gurke.price, 0.55);
  assert.equal(gurke.formattedPrice, '0,55 €');
  assert.equal(gurke.retailer, 'Netto mit dem Hund');
  assert.equal(gurke.retailerSlug, 'netto-mit-dem-hund');
  assert.equal(gurke.packageSize, '350 g');
  assert.equal(gurke.imageUrl, 'https://media.umbraco.io/sample/gurke.png');
  assert.equal(gurke.validFrom, '2026-09-28T00:00:00.000Z');
  assert.equal(gurke.validTo, '2026-10-02T23:59:59.000Z');

  // Produkt 2: frija Milch
  const milch = offers[1];
  assert.equal(milch.title, 'H-Milch 3,5 % Fett');
  assert.equal(milch.brand, 'frija');
  assert.equal(milch.price, 9.00);
  assert.equal(milch.oldPrice, 11.40);
  assert.equal(milch.discountPercent, 21);
  assert.equal(milch.referencePrice, 0.75);
  assert.equal(milch.referenceUnit, 'l');
  assert.equal(milch.formattedRefPrice, '0,75 € / l');
});

test('T17.2: isMatchingRetailer und filterAndSortOffers trennen Netto Marken-Discount und Netto mit dem Hund strikt', () => {
  // 1. isMatchingRetailer
  assert.equal(isMatchingRetailer('Netto mit dem Hund', 'netto-mit-dem-hund', 'Netto mit dem Hund'), true);
  assert.equal(isMatchingRetailer('Netto Marken-Discount', 'netto-marken-discount', 'Netto mit dem Hund'), false);
  assert.equal(isMatchingRetailer('Netto mit dem Hund', 'netto-mit-dem-hund', 'Netto Marken-Discount'), false);
  assert.equal(isMatchingRetailer('Netto Marken-Discount', 'netto-marken-discount', 'Netto Marken-Discount'), true);

  // 2. filterAndSortOffers
  const mixed = [
    {
      id: 'n-md-1',
      title: 'Butter Netto Marken-Discount',
      retailer: 'Netto Marken-Discount',
      retailerSlug: 'netto-marken-discount',
      price: 1.49,
      validFrom: '2026-09-20T00:00:00Z',
      validTo: '2026-10-10T23:59:59Z',
    },
    {
      id: 'n-hund-1',
      title: 'Butter Netto mit Hund',
      retailer: 'Netto mit dem Hund',
      retailerSlug: 'netto-mit-dem-hund',
      price: 1.39,
      validFrom: '2026-09-20T00:00:00Z',
      validTo: '2026-10-10T23:59:59Z',
    },
  ];

  const hundOnly = filterAndSortOffers(mixed, { retailer: 'Netto mit dem Hund' });
  assert.equal(hundOnly.length, 1);
  assert.equal(hundOnly[0].id, 'n-hund-1');

  const markenOnly = filterAndSortOffers(mixed, { retailer: 'Netto Marken-Discount' });
  assert.equal(markenOnly.length, 1);
  assert.equal(markenOnly[0].id, 'n-md-1');
});
