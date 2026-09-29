import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIngredient, extractRecipeFromHtml, parseRecipeInput } from '../src/engine/recipe_parser.js';
import { createApp } from '../src/server.js';

test('T16.1: parseIngredient extrahiert Mengen, Einheiten und saubere Suchbegriffe', () => {
  // Butter mit Zubereitungshinweisen
  const ing1 = parseIngredient('250 g kalte Butter in Flocken');
  assert.equal(ing1.query, 'Butter');
  assert.equal(ing1.amount, '250');
  assert.equal(ing1.unit, 'g');

  // Mehl mit Klammer
  const ing2 = parseIngredient('500 g Weizenmehl (Type 405)');
  assert.equal(ing2.query, 'Mehl');
  assert.equal(ing2.amount, '500');
  assert.equal(ing2.unit, 'g');

  // Eier
  const ing3 = parseIngredient('3 Eier (Größe M)');
  assert.equal(ing3.query, 'Eier');
  assert.equal(ing3.amount, '3');

  // Olivenöl mit Adjektiven
  const ing4 = parseIngredient('2 EL natives Olivenöl extra');
  assert.equal(ing4.query, 'Olivenöl');
  assert.equal(ing4.amount, '2');
  assert.equal(ing4.unit, 'EL');

  // Knoblauchzehen
  const ing5 = parseIngredient('2 Knoblauchzehen, fein gehackt');
  assert.equal(ing5.query, 'Knoblauch');
  assert.equal(ing5.amount, '2');

  // Haferflocken
  const ing6 = parseIngredient('100g zarte Haferflocken');
  assert.equal(ing6.query, 'Haferflocken');
});

test('T16.2: extractRecipeFromHtml parst Schema.org JSON-LD Rezeptdaten aus HTML', () => {
  const mockHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Klassische Spaghetti Bolognese</title>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Recipe",
          "name": "Klassische Spaghetti Bolognese",
          "description": "Der italienische Klassiker für die ganze Familie",
          "recipeYield": "4 Portionen",
          "image": "https://images.chefkoch.de/spaghetti.jpg",
          "recipeIngredient": [
            "500 g Rinderhackfleisch",
            "1 Packung Spaghetti",
            "1 Zwiebel, fein gewürfelt",
            "2 Knoblauchzehen",
            "1 Dose gehackte Tomaten",
            "2 EL Olivenöl",
            "1 Prise Salz und Pfeffer"
          ]
        }
        </script>
      </head>
      <body><h1>Rezept</h1></body>
    </html>
  `;

  const recipe = extractRecipeFromHtml(mockHtml);
  assert.ok(recipe);
  assert.equal(recipe.title, 'Klassische Spaghetti Bolognese');
  assert.equal(recipe.servings, '4 Portionen');
  assert.equal(recipe.imageUrl, 'https://images.chefkoch.de/spaghetti.jpg');
  assert.equal(recipe.ingredients.length, 7);

  const queries = recipe.ingredients.map(i => i.query);
  assert.ok(queries.includes('Hackfleisch'));
  assert.ok(queries.includes('Zwiebeln'));
  assert.ok(queries.includes('Knoblauch'));
  assert.ok(queries.includes('Olivenöl'));
});

test('T16.3: parseRecipeInput verarbeitet Freitext-Zutatenlisten', async () => {
  const textInput = `
    250g Mehl
    100g Butter
    2 Eier
    100ml Milch
  `;

  const result = await parseRecipeInput({ text: textInput });
  assert.ok(result);
  assert.equal(result.ingredients.length, 4);

  const names = result.ingredients.map(i => i.query);
  assert.ok(names.includes('Mehl'));
  assert.ok(names.includes('Butter'));
  assert.ok(names.includes('Eier'));
});

test('T16.4: POST /api/recipe/parse Endpunkt liefert strukturierte Zutaten zurück', async () => {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await fetch(`http://localhost:${port}/api/recipe/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: '500g Kartoffeln\n250g Quark\n1 Bund Schnittlauch',
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.recipe);
    assert.equal(data.recipe.ingredients.length, 3);
    assert.ok(data.recipe.ingredients.some(i => i.query === 'Kartoffeln'));
  } finally {
    server.close();
  }
});

test('T16.5: parseIngredient liefert immer ein valides name-Attribut und löst Chefkoch-Notation sauber auf', () => {
  const chefkochItems = [
    '1 Zwiebel(n)',
    '2 Knoblauchzehe(n)',
    '1 Bund Petersilie (oder TK)',
    '500 g Hackfleisch, gemischtes',
    '1 Dose Tomaten, geschälte (800 g)',
    '0.5 Liter Milch',
    '300 g Lasagneplatte(n)',
    '200 g Käse, geriebener (z. B. Gouda, Emmentaler oder Mozzarella)'
  ];

  chefkochItems.forEach(line => {
    const parsed = parseIngredient(line);
    assert.ok(parsed.name, `Zutat "${line}" muss ein definiertes .name Attribut haben`);
    assert.notEqual(parsed.name, 'undefined');
    assert.ok(parsed.name.length > 0);
  });

  const parsedMilch = parseIngredient('0.5 Liter Milch');
  assert.equal(parsedMilch.amount, '0.5');
  assert.equal(parsedMilch.unit, 'Liter');
  assert.equal(parsedMilch.name, 'Milch');

  const parsedZwiebel = parseIngredient('1 Zwiebel(n)');
  assert.equal(parsedZwiebel.name, 'Zwiebeln');
});

test('recipe import rejects local network URLs', async () => {
  await assert.rejects(parseRecipeInput({ url: 'http://127.0.0.1/admin' }), /Lokale Rezept-Adressen/);
  await assert.rejects(parseRecipeInput({ url: 'http://localhost/' }), /Lokale Rezept-Adressen/);
});
