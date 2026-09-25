import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNormaHtml } from '../src/api/norma.js';

test('T7.1: parseNormaHtml parst Produktboxen mit Grundpreis und UVP korrekt', () => {
  const sampleHtml = `
    <article class="b463 produktBoxContainer" id="of_123456">
      <a href="/de/angebote/detail-123456/">
        <div class="produktBox">
          <div class="produktBox-img">
            <img src="/ext/img/product/angebote/sample_butter.png" alt="Bio Butter" />
          </div>
          <div class="produktBox-txt">
            <h3 class="produktBox-txt-headline">Bio Sonne Deutsche Markenbutter</h3>
            <p class="produktBox-txt-description">mild gesäuert, 250g Packung</p>
            <ul>
              <li class="produktBox-txt-price">1 kg = 7,16</li>
              <li class="produktBox-txt-ref">250g Packung</li>
            </ul>
          </div>
          <div class="produktBox-cont">
            <div class="produktBox-cont-wrapper">
              <ul>
                <li class="produktBox-cont-wrapper-uvp">UVP 2,49</li>
                <li class="produktBox-cont-wrapper-price">
                  <span aria-label="1,79 Euro">1,79</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </a>
    </article>
  `;

  const offers = parseNormaHtml(sampleHtml);

  assert.equal(offers.length, 1);
  const o = offers[0];
  assert.equal(o.id, 'norma-of_123456');
  assert.equal(o.title, 'Bio Sonne Deutsche Markenbutter');
  assert.equal(o.brand, 'Bio Sonne');
  assert.equal(o.retailer, 'Norma');
  assert.equal(o.price, 1.79);
  assert.equal(o.oldPrice, 2.49);
  assert.equal(o.discountPercent, 28);
  assert.equal(o.referencePrice, 7.16);
  assert.equal(o.referenceUnit, 'kg');
  assert.equal(o.formattedRefPrice, '7,16 € / kg');
  assert.equal(o.imageUrl, 'https://www.norma-online.de/ext/img/product/angebote/sample_butter.png');
  assert.equal(o.isBio, true);
  assert.equal(o.isNonFood, false);
});
