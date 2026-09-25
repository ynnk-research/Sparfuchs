import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateItemSavings, calculateBasketTotals } from '../src/engine/comparator.js';

test('T8.1: calculateItemSavings berechnet Ersparnis mit Streichpreis direkt', () => {
  const itemWithOld = { id: '1', price: 1.79, oldPrice: 2.99 };
  const res = calculateItemSavings(itemWithOld);
  assert.equal(res.savings, 1.20);
  assert.equal(res.originalPrice, 2.99);
  assert.equal(res.isEstimated, false);
});

test('T8.2: calculateItemSavings nutzt Marktpreis-Vergleich wenn kein Streichpreis existiert (z. B. bei REWE)', () => {
  const reweItem = { id: 'rewe-1', title: 'Original Irische Butter', price: 1.79, oldPrice: null };
  const marketOffers = [
    { id: 'other-1', title: 'Original Irische Butter 250g', price: 2.79, oldPrice: null },
    { id: 'other-2', title: 'Original Irische Butter', price: 2.99, oldPrice: 3.29 },
  ];

  const res = calculateItemSavings(reweItem, marketOffers);
  // Vergleicht mit dem höchsten Marktpreis (3.29 €)
  assert.equal(res.savings, 1.50);
  assert.equal(res.originalPrice, 3.29);
  assert.equal(res.isEstimated, true);
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
