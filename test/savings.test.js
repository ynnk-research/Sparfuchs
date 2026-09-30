import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateItemSavings, calculateBasketTotals, detectDeposit } from '../src/engine/comparator.js';

test('T8.1: calculateItemSavings berechnet Ersparnis mit Streichpreis direkt', () => {
  const itemWithOld = { id: '1', price: 1.79, oldPrice: 2.99 };
  const res = calculateItemSavings(itemWithOld);
  assert.equal(res.savings, 1.20);
  assert.equal(res.originalPrice, 2.99);
  assert.equal(res.isEstimated, false);
});

test('T8.2: Marktvergleich nutzt nur den aktuellen Preis eines identischen Artikels anderer Kette', () => {
  const reweItem = { id: 'rewe-1', title: 'Original Irische Butter', retailer: 'REWE', price: 1.79, oldPrice: null };
  const marketOffers = [
    { id: 'other-1', title: 'Original Irische Butter 250g', retailer: 'Penny', price: 2.79, oldPrice: null },
    { id: 'other-2', title: 'Original Irische Butter', retailer: 'Kaufland', price: 2.99, oldPrice: 3.29 },
  ];

  const res = calculateItemSavings(reweItem, marketOffers);
  assert.equal(res.savings, 1.20);
  assert.equal(res.originalPrice, 2.99);
  assert.equal(res.isEstimated, true);
  assert.equal(res.comparisonRetailer, 'Kaufland');
});

test('T8.3: calculateBasketTotals berechnet Gesamtsumme, Gesamtersparnis und Prozente für den Einkaufswagen', () => {
  const basket = [
    { id: '1', title: 'Butter', price: 1.49, oldPrice: 2.49 }, // 1.00 € Ersparnis
    { id: '2', title: 'Kaffee', price: 4.99, oldPrice: 6.99 }, // 2.00 € Ersparnis
  ];

  const totals = calculateBasketTotals(basket);
  assert.equal(totals.totalPrice, 6.48);
  assert.equal(totals.totalSavings, 3.00);
  assert.equal(totals.savingsPercent, 32); // 3.00 / 9.48 = 32%
});

test('T8.4: detectDeposit erkennt Einweg- und Mehrwegpfand für Getränke präzise', () => {
  // Dosen: 0.25 €
  assert.equal(detectDeposit({ title: 'Coca-Cola Dose 0,33l' }), 0.25);
  assert.equal(detectDeposit({ title: 'Red Bull Energy Drink' }), 0.25);

  // PET-Einweg: 0.25 €
  assert.equal(detectDeposit({ title: 'Volvic Mineralwasser 1,5l PET' }), 0.25);

  // Bierflasche Mehrweg: 0.08 €
  assert.equal(detectDeposit({ title: 'Krombacher Pils 0,5l Flasche' }), 0.08);

  // Bügelverschluss Bier: 0.15 €
  assert.equal(detectDeposit({ title: 'Flensburger Pilsener Bügelflasche' }), 0.15);

  // Kasten Bier: 3.10 €
  assert.equal(detectDeposit({ title: 'Krombacher Pils Kasten 20 x 0,5l' }), 3.10);

  // Wasserkasten: 3.30 €
  assert.equal(detectDeposit({ title: 'Gerolsteiner Mineralwasser Kasten' }), 3.30);

  // Nicht-Getränke: 0.00 €
  assert.equal(detectDeposit({ title: 'Gulaschsuppe in der Dose' }), 0.00);
  assert.equal(detectDeposit({ title: 'Deutsche Markenbutter' }), 0.00);
});

test('T8.5: calculateBasketTotals berechnet Pfand und Stückzahlen korrekt mit Gesamtsumme', () => {
  const basket = [
    { id: '1', title: 'Coca-Cola Dose 0,33l', price: 0.89, quantity: 4 }, // 4x 0.89 = 3.56 €, Pfand 4x 0.25 = 1.00 €
    { id: '2', title: 'Krombacher Pils Kasten', price: 10.99, quantity: 1 }, // 1x 10.99 €, Pfand 1x 3.10 = 3.10 €
    { id: '3', title: 'Butter', price: 1.49, quantity: 2 }, // 2x 1.49 = 2.98 €, Pfand 0 €
  ];

  const totals = calculateBasketTotals(basket);
  // Reiner Warenwert: 3.56 + 10.99 + 2.98 = 17.53 €
  assert.equal(totals.totalPrice, 17.53);
  // Gesamtpfand: 1.00 + 3.10 = 4.10 €
  assert.equal(totals.totalDeposit, 4.10);
  // Kassenbetrag inkl. Pfand: 17.53 + 4.10 = 21.63 €
  assert.equal(totals.grandTotalWithDeposit, 21.63);
});
