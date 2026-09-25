import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateHouseholdStats } from '../src/engine/history.js';

test('T11.1: calculateHouseholdStats berechnet Kennzahlen für leere Historie sicher', () => {
  const stats = calculateHouseholdStats([]);
  assert.equal(stats.totalSpent, 0);
  assert.equal(stats.totalSavings, 0);
  assert.equal(stats.receiptCount, 0);
  assert.equal(stats.overallSavingsPercent, 0);
  assert.deepEqual(stats.storesBreakdown, []);
});

test('T11.2: calculateHouseholdStats aggregiert Einkäufe, Ersparnisse und Supermarkt-Rangliste', () => {
  const mockReceipts = [
    {
      id: 'r1',
      date: '2026-09-20T10:00:00Z',
      stores: ['Lidl'],
      totalPaid: 20.00,
      totalRegular: 30.00,
      totalSavings: 10.00,
      items: [
        { title: 'Kaffee', retailer: 'Lidl', price: 5.00, oldPrice: 8.00 },
        { title: 'Schokolade', retailer: 'Lidl', price: 15.00, oldPrice: 22.00 },
      ],
    },
    {
      id: 'r2',
      date: '2026-09-22T14:30:00Z',
      stores: ['Aldi Nord', 'PENNY'],
      totalPaid: 30.00,
      totalRegular: 45.00,
      totalSavings: 15.00,
      items: [
        { title: 'Butter', retailer: 'Aldi Nord', price: 10.00, oldPrice: 16.00 }, // 6€ Ersparnis
        { title: 'Limonade', retailer: 'PENNY', price: 20.00, oldPrice: 29.00 },   // 9€ Ersparnis
      ],
    },
    {
      id: 'r3',
      date: '2026-08-15T09:00:00Z', // Vormonat
      stores: ['Lidl'],
      totalPaid: 10.00,
      totalRegular: 15.00,
      totalSavings: 5.00,
      items: [
        { title: 'Brot', retailer: 'Lidl', price: 10.00, oldPrice: 15.00 },
      ],
    },
  ];

  const stats = calculateHouseholdStats(mockReceipts);

  // Gesamtkennzahlen
  assert.equal(stats.receiptCount, 3);
  assert.equal(stats.totalSpent, 60.00);
  assert.equal(stats.totalSavings, 30.00);
  assert.equal(stats.totalRegular, 90.00);
  assert.equal(stats.overallSavingsPercent, 33); // 30 / 90 = 33%
  assert.equal(stats.averageSpentPerTrip, 20.00);
  assert.equal(stats.averageSavingsPerTrip, 10.00);

  // Supermärkte Rangliste (sortiert nach höchster Ersparnis)
  // Lidl: 10€ + 5€ = 15€
  // PENNY: 9€
  // Aldi Nord: 6€
  assert.equal(stats.storesBreakdown[0].store, 'Lidl');
  assert.equal(stats.storesBreakdown[0].savings, 15.00);
  assert.equal(stats.storesBreakdown[1].store, 'PENNY');
  assert.equal(stats.storesBreakdown[1].savings, 9.00);
  assert.equal(stats.storesBreakdown[2].store, 'Aldi Nord');
  assert.equal(stats.storesBreakdown[2].savings, 6.00);

  // Monatsaufteilung
  assert.equal(stats.monthlyBreakdown.length, 2);
  // Neueste zuerst: 2026-09 vor 2026-08
  assert.equal(stats.monthlyBreakdown[0].month, '2026-09');
  assert.equal(stats.monthlyBreakdown[0].spent, 50.00);
  assert.equal(stats.monthlyBreakdown[0].savings, 25.00);
  assert.equal(stats.monthlyBreakdown[1].month, '2026-08');
  assert.equal(stats.monthlyBreakdown[1].spent, 10.00);
});

test('T11.3: E2E - POST, GET und DELETE /api/history verbucht Einkaufszettel und berechnet Statistiken', async () => {
  const { createApp } = await import('../src/server.js');
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;

  try {
    // 1. POST /api/history: Einen neuen Einkauf buchen
    const newReceipt = {
      date: '2026-09-25T12:00:00Z',
      stores: ['Lidl', 'Aldi Nord'],
      itemCount: 2,
      totalPaid: 15.50,
      totalRegular: 22.00,
      totalSavings: 6.50,
      items: [
        { title: 'Bio Butter', retailer: 'Lidl', price: 2.29, oldPrice: 3.29 },
        { title: 'Kaffee Crema', retailer: 'Aldi Nord', price: 13.21, oldPrice: 18.71 },
      ],
    };

    const postRes = await fetch(`http://127.0.0.1:${port}/api/history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newReceipt),
    });

    assert.equal(postRes.status, 201);
    const postData = await postRes.json();
    assert.equal(postData.success, true);
    assert.ok(postData.receipt.id);
    assert.equal(postData.receipt.totalPaid, 15.50);
    assert.equal(postData.receipt.totalSavings, 6.50);
    assert.ok(postData.stats.totalSavings >= 6.50);

    const bookedId = postData.receipt.id;

    // 2. GET /api/history: Abrufen und prüfen
    const getRes = await fetch(`http://127.0.0.1:${port}/api/history`);
    assert.equal(getRes.status, 200);
    const getData = await getRes.json();
    assert.ok(Array.isArray(getData.history));
    const found = getData.history.find(r => r.id === bookedId);
    assert.ok(found, 'Der soeben gebuchte Beleg muss in der Historie existieren');
    assert.deepEqual(found.stores, ['Lidl', 'Aldi Nord']);

    // 3. DELETE /api/history/:id: Den Beleg wieder entfernen
    const delRes = await fetch(`http://127.0.0.1:${port}/api/history/${encodeURIComponent(bookedId)}`, {
      method: 'DELETE',
    });
    assert.equal(delRes.status, 200);
    const delData = await delRes.json();
    assert.equal(delData.success, true);
    const notFound = delData.history.find(r => r.id === bookedId);
    assert.equal(notFound, undefined, 'Der gelöschte Beleg darf nicht mehr existieren');
  } finally {
    server.close();
  }
});

test('T11.4: POST /api/history/sync synchronisiert Client-Belege bei Neustart oder Spin-Down', async () => {
  const { createApp } = await import('../src/server.js');
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const clientReceipts = [
      {
        id: 'offline-receipt-1',
        date: new Date().toISOString(),
        stores: ['Lidl'],
        itemCount: 1,
        totalPaid: 10.0,
        totalRegular: 15.0,
        totalSavings: 5.0,
        items: [{ title: 'Butter', price: 10.0 }],
      },
    ];

    const syncRes = await fetch(`http://127.0.0.1:${port}/api/history/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientHistory: clientReceipts }),
    });

    assert.equal(syncRes.status, 200);
    const syncData = await syncRes.json();
    assert.equal(syncData.success, true);
    assert.ok(syncData.history.some(r => r.id === 'offline-receipt-1'));
    assert.ok(syncData.stats.totalSavings >= 5.0);

    // Clean up
    await fetch(`http://127.0.0.1:${port}/api/history/offline-receipt-1`, { method: 'DELETE' });
  } finally {
    server.close();
  }
});


