import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, sharedBaskets } from '../src/server.js';

test('T14.1: POST /api/basket/share erstellt QR-Share Session mit Data-URL', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://localhost:${port}/api/basket/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [
          { title: 'Kerrygold Butter', retailer: 'Lidl', price: 1.79, quantity: 2 },
          { title: 'Haferflocken', retailer: 'Aldi Nord', price: 0.79, quantity: 1 },
        ],
        zipCode: '10115',
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.shareId.startsWith('b-'));
    assert.ok(data.shareUrl.includes(data.shareId));
    assert.ok(data.qrDataUrl.startsWith('data:image/png;base64,'));
    assert.equal(data.itemCount, 2);
  } finally {
    server.close();
  }
});

test('T14.2: POST /api/basket/share validiert leere Einkaufszettel', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://localhost:${port}/api/basket/share`, {
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

test('T14.3: GET /api/basket/share/:id ruft geteilten Einkaufszettel ab und fängt 404 ab', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;

  try {
    // 1. Erstellen
    const createRes = await fetch(`http://localhost:${port}/api/basket/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ title: 'Bananen', retailer: 'EDEKA', price: 1.29, quantity: 3 }],
        zipCode: '04109',
      }),
    });
    const createData = await createRes.json();
    const shareId = createData.shareId;

    // 2. Abrufen
    const getRes = await fetch(`http://localhost:${port}/api/basket/share/${shareId}`);
    assert.equal(getRes.status, 200);
    const getData = await getRes.json();
    assert.equal(getData.success, true);
    assert.equal(getData.items.length, 1);
    assert.equal(getData.items[0].title, 'Bananen');
    assert.equal(getData.items[0].quantity, 3);
    assert.equal(getData.zipCode, '04109');

    // 3. Unbekannte ID
    const notFoundRes = await fetch(`http://localhost:${port}/api/basket/share/unknown-99999`);
    assert.equal(notFoundRes.status, 404);
  } finally {
    server.close();
  }
});

test('T14.4: GET /api/qr generiert PNG und SVG QR-Code', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;

  try {
    // PNG
    const pngRes = await fetch(`http://localhost:${port}/api/qr?text=https://sparfuchs.test`);
    assert.equal(pngRes.status, 200);
    assert.equal(pngRes.headers.get('content-type'), 'image/png');
    const pngBuffer = await pngRes.arrayBuffer();
    assert.ok(pngBuffer.byteLength > 100);

    // SVG
    const svgRes = await fetch(`http://localhost:${port}/api/qr?text=https://sparfuchs.test&format=svg`);
    assert.equal(svgRes.status, 200);
    assert.ok(svgRes.headers.get('content-type').includes('svg'));
    const svgText = await svgRes.text();
    assert.ok(svgText.includes('<svg'));
  } finally {
    server.close();
  }
});
