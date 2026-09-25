import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAndSanitizeOldPrice, calculateItemSavings } from '../src/engine/comparator.js';

test('T13.1: validateAndSanitizeOldPrice filtert unrealistische und unplausible Streichpreise aus', () => {
  // 1. Reale Rabatte im normalen Lebensmittelbereich (10% - 50%)
  assert.equal(validateAndSanitizeOldPrice(1.49, 2.49, false), 2.49);
  assert.equal(validateAndSanitizeOldPrice(0.99, 1.79, false), 1.79);
  assert.equal(validateAndSanitizeOldPrice(3.49, 4.99, false), 4.99);

  // 2. Streichpreis kleiner oder gleich Angebotspreis (ungültig)
  assert.equal(validateAndSanitizeOldPrice(1.99, 1.99, false), null);
  assert.equal(validateAndSanitizeOldPrice(2.49, 1.99, false), null);

  // 3. Unrealistische Mondpreise für billige Lebensmittel (z. B. Eiskaffee für 1,29 € mit Streichpreis 45 €)
  assert.equal(validateAndSanitizeOldPrice(1.29, 45.00, false), null);
  assert.equal(validateAndSanitizeOldPrice(0.49, 2.22, false), null); // Radieschen 0.49 € vs 2.22 € Mismatch
  assert.equal(validateAndSanitizeOldPrice(0.89, 5.99, false), null);

  // 4. Nicht-Lebensmittel dürfen etwas höhere Streichpreise (UVP) haben, aber keine Absurditäten
  assert.equal(validateAndSanitizeOldPrice(19.99, 49.99, true), 49.99); // 2.5x bei Non-Food noch plausibel
  assert.equal(validateAndSanitizeOldPrice(10.00, 150.00, true), null);  // 15x absurd

  // 5. Ungültige Eingaben
  assert.equal(validateAndSanitizeOldPrice(-1, 5, false), null);
  assert.equal(validateAndSanitizeOldPrice(1.49, 'kein-preis', false), null);
  assert.equal(validateAndSanitizeOldPrice(1.49, null, false), null);
});

test('T13.2: calculateItemSavings verhindert Mismatches durch generische Marken-Präfixe wie thisisnobrand123', () => {
  // Simuliere den Marktguru-Bug: Zwei ungleiche Produkte mit Präfix "thisisnobrand123"
  const item = {
    title: 'thisisnobrand123 Radieschen Bund',
    price: 0.49,
    retailer: 'Markt A',
  };

  const expensiveOtherItem = {
    title: 'thisisnobrand123 Bio Champignons braun 400g',
    price: 2.29,
    retailer: 'Markt B',
  };

  const savings = calculateItemSavings(item, [item, expensiveOtherItem]);
  // Es darf KEIN Mismatch-Vergleich von 2.29 € für 0.49 € Radieschen stattfinden!
  assert.notEqual(savings.originalPrice, 2.29);
  assert.ok(savings.originalPrice < 1.00, 'Originalpreis muss unter 1,00 € bleiben');
});
