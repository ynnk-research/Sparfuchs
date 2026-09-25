import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyOffer, filterOffersByCategory, CATEGORY_DEFINITIONS } from '../src/engine/categories.js';

test('T12.1: classifyOffer ordnet Produkte zuverlässig realen Kategorien zu', () => {
  // Molkerei
  const butter = classifyOffer({ title: 'Kerrygold Original Irische Butter', description: '250g Packung' });
  assert.equal(butter.categoryId, 'dairy');
  assert.equal(butter.categoryIcon, '🧀');

  const milk = classifyOffer({ title: 'Bio Vollmilch 3,8%', brand: 'Andechser Natur' });
  assert.equal(milk.categoryId, 'dairy');

  // Obst & Gemüse
  const banana = classifyOffer({ title: 'Bananen lose', description: 'Herkunft: Kolumbien' });
  assert.equal(banana.categoryId, 'produce');
  assert.equal(banana.categoryIcon, '🍎');

  const radishes = classifyOffer({ title: 'Radieschen Bund', description: 'Klasse 1' });
  assert.equal(radishes.categoryId, 'produce');

  // Fleisch & Fisch
  const meat = classifyOffer({ title: 'Rinderhackfleisch 500g Packung', description: 'Frisch aus Deutschland' });
  assert.equal(meat.categoryId, 'meat');
  assert.equal(meat.categoryIcon, '🥩');

  const fish = classifyOffer({ title: 'Iglo Backfischstäbchen', description: 'Tiefgekühlt' });
  assert.equal(fish.categoryId, 'meat');

  // Kaffee & Getränke
  const coffee = classifyOffer({ title: 'Dallmayr Prodomo gemahlener Kaffee 500g' });
  assert.equal(coffee.categoryId, 'drinks');
  assert.equal(coffee.categoryIcon, '☕');

  const beer = classifyOffer({ title: 'Krombacher Pils 20x0,5l Kasten' });
  assert.equal(beer.categoryId, 'drinks');

  // Süßes & Snacks
  const chocolate = classifyOffer({ title: 'Milka Tafelschokolade Alpenmilch 100g' });
  assert.equal(chocolate.categoryId, 'snacks');
  assert.equal(chocolate.categoryIcon, '🍫');

  const chips = classifyOffer({ title: 'Funny-Frisch Chio Chips Paprika' });
  assert.equal(chips.categoryId, 'snacks');

  // Vorrat & Grundnahrung
  const pasta = classifyOffer({ title: 'Barilla Spaghetti No. 5 500g' });
  assert.equal(pasta.categoryId, 'pantry');
  assert.equal(pasta.categoryIcon, '🍝');

  // Non-Food
  const tool = classifyOffer({ title: 'Parkside Akku-Bohrschrauber 20V', isNonFood: true });
  assert.equal(tool.categoryId, 'nonfood');
  assert.equal(tool.categoryIcon, '📦');

  const detergent = classifyOffer({ title: 'Ariel Vollwaschmittel Allin1 Pods' });
  assert.equal(detergent.categoryId, 'nonfood');
});

test('T12.2: filterOffersByCategory filtert Angebotslisten präzise', () => {
  const offers = [
    { title: 'Weihenstephan Frische Butter 250g', price: 1.49 },
    { title: 'Spanische Erdbeeren 500g Schale', price: 1.99 },
    { title: 'Barilla Penne Rigate 500g', price: 0.99 },
    { title: 'Coca-Cola 1.5L Einweg', price: 1.19 },
  ];

  const dairyOffers = filterOffersByCategory(offers, 'dairy');
  assert.equal(dairyOffers.length, 1);
  assert.equal(dairyOffers[0].title, 'Weihenstephan Frische Butter 250g');

  const produceOffers = filterOffersByCategory(offers, 'produce');
  assert.equal(produceOffers.length, 1);
  assert.equal(produceOffers[0].title, 'Spanische Erdbeeren 500g Schale');

  const allOffers = filterOffersByCategory(offers, 'all');
  assert.equal(allOffers.length, 4);
});
