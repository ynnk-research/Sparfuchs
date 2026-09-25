import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

test('T4.1: Server liefert vordefinierte Kategorien über /api/categories', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/categories`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data));
    assert.ok(data.length >= 5);
    const dairy = data.find(c => c.id === 'dairy');
    assert.ok(dairy);
    assert.ok(dairy.items.includes('Butter'));
    assert.ok(data.some(c => c.id === 'all'));
  } finally {
    server.close();
  }
});

test('T4.2: GET /api/offers liefert Alle-Angebote-Feed bei leerem Suchbegriff', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/offers?q=`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.offers));
    assert.ok(data.offers.length > 0, 'Sollte den Alle-Angebote-Feed liefern');
  } finally {
    server.close();
  }
});

test('T4.4: POST /api/calculate-basket berechnet Ersparnisse für den Einkaufswagen', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/calculate-basket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [
          { id: '1', title: 'Butter', price: 1.49, oldPrice: 2.49 },
        ],
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.totalPrice, 1.49);
    assert.equal(data.totalSavings, 1.00);
  } finally {
    server.close();
  }
});

test('T4.3: POST /api/optimize validiert fehlerhafte Eingaben mit HTTP 400', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [] }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error);
  } finally {
    server.close();
  }
});
