import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

test('T5.1: E2E - Server liefert Frontend-Dateien (HTML, CSS, JS) mit HTTP 200 aus', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;

  try {
    // 1. Index HTML
    const resHtml = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(resHtml.status, 200);
    const html = await resHtml.text();
    assert.match(html, /<title>SparFuchs/);
    assert.match(html, /id="searchForm"/);

    // 2. CSS
    const resCss = await fetch(`http://127.0.0.1:${port}/style.css`);
    assert.equal(resCss.status, 200);
    const css = await resCss.text();
    assert.match(css, /--accent-gradient/);

    // 3. JavaScript
    const resJs = await fetch(`http://127.0.0.1:${port}/app.js`);
    assert.equal(resJs.status, 200);
    const js = await resJs.text();
    assert.match(js, /fetchOffers/);
  } finally {
    server.close();
  }
});

test('T5.2: E2E - Live-Suche & Filterung nach Grundpreis', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/offers?q=Butter&zip=10115&sortBy=refPrice`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.query, 'Butter');
    assert.equal(data.zipCode, '10115');
    assert.ok(Array.isArray(data.offers));
    assert.ok(data.offers.length > 0, 'Sollte reale Angebote für Butter finden');

    // Prüfe, ob jedes Angebot über die nötigen Normalisierungsfelder verfügt
    const first = data.offers[0];
    assert.ok(first.id);
    assert.ok(first.title);
    assert.ok(first.retailer);
    assert.ok(typeof first.price === 'number');

    // Wenn Grundpreis vorhanden ist, muss aufsteigend sortiert sein
    for (let i = 0; i < data.offers.length - 1; i++) {
      const a = data.offers[i];
      const b = data.offers[i + 1];
      if (typeof a.referencePrice === 'number' && typeof b.referencePrice === 'number' && a.referenceUnit === b.referenceUnit) {
        assert.ok(a.referencePrice <= b.referencePrice, `Grundpreis sollte aufsteigend sein: ${a.referencePrice} <= ${b.referencePrice}`);
      }
    }
  } finally {
    server.close();
  }
});

test('T5.3: E2E - Multimarkt-Optimierung für einen realen Warenkorb', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: ['Butter', 'Kaffee'],
        zipCode: '10115',
        preferReferencePrice: true,
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.optimization);
    assert.equal(data.optimization.totalItemsRequested, 2);
    assert.ok(data.optimization.singleStoreChampion, 'Single-Store Champion sollte berechnet werden');
    assert.ok(data.optimization.singleStoreChampion.retailer);
    assert.ok(data.optimization.singleStoreChampion.totalPrice > 0);
  } finally {
    server.close();
  }
});
