/**
 * Aldi Nord Scraper & Normalizer
 * Lädt offizielle wöchentliche Angebote direkt von aldi-nord.de/angebote.html
 */

import { globalPersistentCache } from './cache.js';
import { validateAndSanitizeOldPrice } from '../engine/comparator.js';

export const aldiCache = globalPersistentCache;

// Schlagwörter für Bio-Erkennung
const BIO_PATTERNS = [
  /\bbio\b/i,
  /\bbioland\b/i,
  /\bdemeter\b/i,
  /\bnaturland\b/i,
  /\bgut bio\b/i,
  /\bk-bio\b/i,
  /\balnatura\b/i,
  /\böko\b/i,
  /\bnaturgut\b/i,
  /\bbiobio\b/i,
  /\bvemondo\b/i,
];

// Schlagwörter für Non-Food / Aktionsware
const NON_FOOD_PATTERNS = [
  /werkzeug/i, /garten/i, /kleidung/i, /mode/i, /haushalt/i, /elektronik/i,
  /heimwerker/i, /deko/i, /bettwäsche/i, /shirt/i, /hose/i, /socken/i,
  /leuchte/i, /lampe/i, /kissen/i, /schuhe/i, /spielzeug/i, /koffer/i,
  /küche/i, /topf/i, /pfanne/i, /bohrer/i, /akku/i, /reinigung/i, /drogerie/i,
  /zahnpasta/i, /shampoo/i, /duschgel/i, /waschmittel/i, /toilettenpapier/i,
  /maler/i, /krepp/i, /klebeband/i, /serviette/i, /workzone/i, /deco craft/i,
  /ferrex/i, /gardenline/i, /up2fashion/i, /dormia/i, /quigg/i, /parkside/i,
  /silvercrest/i, /crivit/i, /esmara/i, /livergy/i, /livarno/i, /kraft werkzeuge/i,
  /farbe/i, /pinsel/i, /schraube/i, /dübel/i, /batterie/i, /tasche/i, /handtuch/i,
  /bad/i, /creme/i, /seife/i, /kosmetik/i, /rasier/i, /auto/i, /fahrrad/i,
  /sport/i, /fitness/i, /möbel/i, /kabel/i, /led/i, /blume/i, /pflanze/i,
  /tuch/i, /tücher/i, /müllbeutel/i, /folie/i, /schwamm/i, /spülmittel/i,
  /kerze/i, /geschirr/i, /besteck/i, /glas/i, /becher/i, /regal/i,
];

/**
 * Erkennt, ob ein Produkt ein Bio-Produkt ist
 */
export function isBioProduct(title, brand, description = '', categories = []) {
  const combined = `${title || ''} ${brand || ''} ${description || ''} ${(categories || []).join(' ')}`;
  return BIO_PATTERNS.some(p => p.test(combined));
}

/**
 * Erkennt, ob ein Produkt Non-Food / Nicht-Lebensmittel ist
 */
export function isNonFoodProduct(title, brand, description = '', categories = []) {
  const combined = `${title || ''} ${brand || ''} ${description || ''} ${(categories || []).join(' ')}`;
  return NON_FOOD_PATTERNS.some(p => p.test(combined));
}

/**
 * Wandelt ein Roh-Objekt aus Aldi Nords algoliaDataMap in unser Standard-Offer-Schema um
 */
export function normalizeAldiItem(item, query = '') {
  if (!item || !item.name) return null;

  const id = `aldi-nord-${item.objectID || Math.random().toString(36).slice(2)}`;
  const brandName = item.brandName || null;
  const productName = item.name || '';
  
  let title = productName;
  if (brandName && !productName.toLowerCase().includes(brandName.toLowerCase())) {
    title = `${brandName} ${productName}`;
  }

  const currentPrice = item.currentPrice || {};
  const price = typeof currentPrice.priceValue === 'number' ? currentPrice.priceValue : parseFloat(currentPrice.priceValue) || 0;
  
  const desc = item.shortDescription || item.longDescription || '';
  const categories = Array.isArray(item.categoryIDs) ? item.categoryIDs : [];
  const isBio = isBioProduct(title, brandName, desc, categories);
  const isNonFood = isNonFoodProduct(title, brandName, desc, categories);

  let oldPrice = null;
  if (currentPrice.strikePrice && typeof currentPrice.strikePrice.strikePriceValue === 'number') {
    oldPrice = validateAndSanitizeOldPrice(price, currentPrice.strikePrice.strikePriceValue, isNonFood);
  }

  let discountPercent = null;
  if (oldPrice && oldPrice > price) {
    discountPercent = Math.round(((oldPrice - price) / oldPrice) * 100);
  } else if (currentPrice.priceTagLabels?.promoText1) {
    const match = currentPrice.priceTagLabels.promoText1.match(/(\d+)\s*%/);
    if (match) {
      const parsedPct = parseInt(match[1], 10);
      if (parsedPct > 0 && parsedPct <= 65) {
        discountPercent = parsedPct;
        const calcOld = parseFloat((price / (1 - parsedPct / 100)).toFixed(2));
        oldPrice = validateAndSanitizeOldPrice(price, calcOld, isNonFood);
      }
    }
  }

  // Grundpreis
  let referencePrice = null;
  let referenceUnit = '';
  if (Array.isArray(currentPrice.basePrice) && currentPrice.basePrice.length > 0) {
    referencePrice = currentPrice.basePrice[0].basePriceValue || null;
    referenceUnit = currentPrice.basePrice[0].basePriceScale || '';
  }

  let formattedRefPrice = null;
  if (referencePrice && referenceUnit) {
    formattedRefPrice = `${referencePrice.toFixed(2).replace('.', ',')} € / ${referenceUnit}`;
  } else if (referencePrice) {
    formattedRefPrice = `${referencePrice.toFixed(2).replace('.', ',')} €`;
  }

  // Bild URL
  let imageUrl = null;
  if (Array.isArray(item.assets) && item.assets.length > 0) {
    const primary = item.assets.find(a => a.type === 'primary') || item.assets[0];
    if (primary.url) {
      imageUrl = primary.url;
    }
  }

  // Datumsangaben
  let validFrom = null;
  let validTo = null;
  if (Array.isArray(item.promotionPrices) && item.promotionPrices.length > 0) {
    const promo = item.promotionPrices[0];
    if (promo.validFromLocalDate) validFrom = `${promo.validFromLocalDate}T00:00:00Z`;
    if (promo.validUntilLocalDate) validTo = `${promo.validUntilLocalDate}T23:59:59Z`;
  } else if (currentPrice.validFrom) {
    validFrom = new Date(currentPrice.validFrom * 1000).toISOString();
    validTo = currentPrice.validUntil ? new Date(currentPrice.validUntil * 1000).toISOString() : null;
  }

  const packageSize = item.salesUnit || null;

  return {
    id,
    title,
    productName,
    brand: brandName,
    retailer: 'Aldi Nord',
    retailerSlug: 'aldi-nord',
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
    description: desc.replace(/\n+/g, ' ').trim(),
    requiresApp: false,
    validFrom,
    validTo,
    imageUrl,
    query,
    categories,
    isBio,
    isNonFood,
  };
}

/**
 * Lädt alle aktuellen Angebote von Aldi Nord
 */
export async function fetchAllAldiNordOffers(fetchFn = fetch, cache = aldiCache) {
  const cacheKey = 'aldi_nord_all_offers';
  if (cache) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }

  try {
    const res = await fetchFn('https://www.aldi-nord.de/angebote.html', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (!res.ok) {
      console.warn(`Aldi Nord Fetch fehlgeschlagen: HTTP ${res.status}`);
      return [];
    }

    const html = await res.text();
    const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
    if (!nextMatch) {
      console.warn('Kein __NEXT_DATA__ auf aldi-nord.de gefunden');
      return [];
    }

    const json = JSON.parse(nextMatch[1]);
    const apiDataRaw = json?.props?.pageProps?.apiData;
    if (!apiDataRaw) return [];

    const apiData = typeof apiDataRaw === 'string' ? JSON.parse(apiDataRaw) : apiDataRaw;
    const offers = [];

    if (Array.isArray(apiData)) {
      for (const entry of apiData) {
        const payload = Array.isArray(entry) ? entry[1] : entry;
        const algoliaMap = payload?.res?.algoliaDataMap;
        if (algoliaMap && typeof algoliaMap === 'object') {
          for (const key of Object.keys(algoliaMap)) {
            const rawItem = algoliaMap[key];
            const normalized = normalizeAldiItem(rawItem);
            if (normalized) offers.push(normalized);
          }
        }
      }
    }

    if (cache && offers.length > 0) {
      cache.set(cacheKey, offers);
    }

    return offers;
  } catch (err) {
    console.error('Fehler beim Laden der Aldi Nord Angebote:', err.message);
    return [];
  }
}

/**
 * Sucht Angebote bei Aldi Nord anhand eines Suchbegriffs oder Tags
 */
export async function searchAldiNordOffers(query = '', options = {}) {
  const allOffers = await fetchAllAldiNordOffers(options.fetchFn || fetch);
  if (!query || !query.trim()) {
    return allOffers;
  }

  const cleanQuery = query.toLowerCase().trim();
  const tokens = cleanQuery.split(/\s+/).filter(Boolean);

  return allOffers.filter(offer => {
    const text = `${offer.title} ${offer.brand || ''} ${offer.description} ${(offer.categories || []).join(' ')}`.toLowerCase();
    return tokens.every(token => text.includes(token));
  });
}
