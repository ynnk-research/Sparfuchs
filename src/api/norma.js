/**
 * Norma Scraper & Normalizer
 * Lädt offizielle wöchentliche Angebote direkt von norma-online.de
 */

import { globalPersistentCache } from './cache.js';
import { isBioProduct, isNonFoodProduct } from './aldinord.js';
import { validateAndSanitizeOldPrice } from '../engine/comparator.js';

export const normaCache = globalPersistentCache;

/**
 * Parst Produkt-Boxen aus dem HTML einer Norma-Angebotsseite
 */
export function parseNormaHtml(pageHtml, sourceUrl = '') {
  if (!pageHtml || typeof pageHtml !== 'string') return [];

  const articles = [];
  const boxRegex = /<article[^>]*class="[^"]*produktBoxContainer[^"]*"[^>]*id="([^"]*)"[\s\S]*?<h3[^>]*class="produktBox-txt-headline"[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<\/article>/gi;

  let match;
  while ((match = boxRegex.exec(pageHtml)) !== null) {
    const id = match[1];
    const block = match[0];
    const title = match[2].replace(/<[^>]+>/g, '').trim();
    if (!title) continue;

    // Beschreibung vorab parsen für NonFood Erkennung
    const descMatch = block.match(/class="produktBox-txt-description"[^>]*>([\s\S]*?)<\/p>/i);
    const desc = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    let brand = 'Norma';
    if (/bio\s*sonne/i.test(`${title} ${desc}`)) {
      brand = 'Bio Sonne';
    }

    const isBio = isBioProduct(title, brand, desc, []);
    const isNonFood = isNonFoodProduct(title, brand, desc, []);

    // Preis
    const priceMatch = block.match(/aria-label="([\d,]+)\s*Euro"/i) || block.match(/class="produktBox-cont-wrapper-price"[^>]*>([\d,]+)/i);
    const priceStr = priceMatch ? priceMatch[1].replace(',', '.') : null;
    const price = priceStr ? parseFloat(priceStr) : 0;
    if (price <= 0) continue;

    // UVP / Streichpreis mit Validierung
    const uvpMatch = block.match(/class="produktBox-cont-wrapper-uvp"[^>]*>[\s\S]*?(\d+[.,]\d{2})/i) || block.match(/UVP\s*(\d+[.,]\d{2})/i);
    const parsedOld = uvpMatch ? parseFloat(uvpMatch[1].replace(',', '.')) : null;
    const oldPrice = validateAndSanitizeOldPrice(price, parsedOld, isNonFood);

    let discountPercent = null;
    if (oldPrice && oldPrice > price) {
      discountPercent = Math.round(((oldPrice - price) / oldPrice) * 100);
    }

    // Grundpreis (z. B. "1 kg = 10,23" oder "1 l = 1,49")
    const refMatch = block.match(/class="produktBox-txt-price"[^>]*>([\s\S]*?)<\/li>/i);
    let referencePrice = null;
    let referenceUnit = '';
    if (refMatch) {
      const refText = refMatch[1].replace(/<[^>]+>/g, '').trim();
      const numMatch = refText.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|Stück)?\s*=\s*(\d+[.,]\d{2})/i);
      if (numMatch) {
        referenceUnit = numMatch[2] || 'kg';
        referencePrice = parseFloat(numMatch[3].replace(',', '.'));
      }
    }

    let formattedRefPrice = null;
    if (referencePrice && referenceUnit) {
      formattedRefPrice = `${referencePrice.toFixed(2).replace('.', ',')} € / ${referenceUnit}`;
    } else if (referencePrice) {
      formattedRefPrice = `${referencePrice.toFixed(2).replace('.', ',')} €`;
    }

    // Packungsgröße / Zusatzinfo
    const pkgMatch = block.match(/class="produktBox-txt-ref"[^>]*>([\s\S]*?)<\/li>/i);
    const packageSize = pkgMatch ? pkgMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    // Bild
    const imgMatch = block.match(/<img[^>]+src="([^"]+)"/i);
    let imageUrl = null;
    if (imgMatch) {
      const rawSrc = imgMatch[1];
      imageUrl = rawSrc.startsWith('http') ? rawSrc : `https://www.norma-online.de${rawSrc}`;
    }



    articles.push({
      id: `norma-${id}`,
      title,
      productName: title,
      brand,
      retailer: 'Norma',
      retailerSlug: 'norma',
      price,
      formattedPrice: `${price.toFixed(2).replace('.', ',')} €`,
      oldPrice,
      formattedOldPrice: oldPrice ? `${oldPrice.toFixed(2).replace('.', ',')} €` : null,
      discountPercent,
      referencePrice,
      referenceUnit,
      formattedRefPrice,
      packageSize,
      volume: null,
      description: desc,
      requiresApp: false,
      validFrom: null,
      validTo: null,
      imageUrl,
      query: '',
      categories: ['Norma Angebote'],
      isBio,
      isNonFood,
    });
  }

  return articles;
}

/**
 * Lädt alle aktuellen Angebote von Norma (Hauptseite + aktuelle Wochenunterseiten)
 */
export async function fetchAllNormaOffers(fetchFn = fetch, cache = normaCache) {
  const cacheKey = 'norma_all_offers';
  if (cache) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }

  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
    };

    const mainRes = await fetchFn('https://www.norma-online.de/de/angebote/', { headers });
    if (!mainRes.ok) return [];

    const mainHtml = await mainRes.text();
    const allOffersMap = new Map();

    // Angebote der Hauptseite parsen
    const mainOffers = parseNormaHtml(mainHtml, 'https://www.norma-online.de/de/angebote/');
    mainOffers.forEach(o => allOffersMap.set(o.id, o));

    // Wichtige Unterseiten extrahieren (Obst/Gemüse, ab-montag, ab-mittwoch, ab-freitag)
    const linkMatches = [...mainHtml.matchAll(/href="(\/de\/angebote\/(?:ab-[a-z0-9,.-]+|obst-und-gemuese)\/)"/gi)];
    const subpages = [...new Set(linkMatches.map(m => m[1]))].slice(0, 5); // Begrenzen auf Top 5 Unterseiten

    // Unterseiten parallel abrufen
    const subTasks = subpages.map(async path => {
      try {
        const url = `https://www.norma-online.de${path}`;
        const subRes = await fetchFn(url, { headers });
        if (subRes.ok) {
          const subHtml = await subRes.text();
          return parseNormaHtml(subHtml, url);
        }
      } catch (err) {
        console.warn(`Fehler beim Abrufen von Norma-Unterseite ${path}:`, err.message);
      }
      return [];
    });

    const subResults = await Promise.all(subTasks);
    subResults.flat().forEach(o => {
      if (!allOffersMap.has(o.id)) {
        allOffersMap.set(o.id, o);
      }
    });

    const allOffers = Array.from(allOffersMap.values());

    if (cache && allOffers.length > 0) {
      cache.set(cacheKey, allOffers);
    }

    return allOffers;
  } catch (err) {
    console.error('Fehler beim Laden der Norma-Angebote:', err.message);
    return [];
  }
}

/**
 * Durchsucht die Norma-Angebote nach einem Suchbegriff
 */
export async function searchNormaOffers(query = '', options = {}) {
  const allOffers = await fetchAllNormaOffers(options.fetchFn || fetch);
  if (!query || !query.trim()) {
    return allOffers;
  }

  const cleanQuery = query.toLowerCase().trim();
  const tokens = cleanQuery.split(/\s+/).filter(Boolean);

  return allOffers.filter(offer => {
    const text = `${offer.title} ${offer.brand || ''} ${offer.description}`.toLowerCase();
    return tokens.every(token => text.includes(token));
  });
}
