/**
 * EDEKA API Client & Normalizer
 * Nutzt die offizielle EDEKA Web-API (Marktsuche & Filialangebote) für jede deutsche PLZ.
 */

import { globalPersistentCache } from './cache.js';
import { isBioProduct, isNonFoodProduct } from './aldinord.js';
import { validateAndSanitizeOldPrice } from '../engine/comparator.js';

const EDEKA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
};

/**
 * Sucht EDEKA-Märkte anhand einer PLZ
 */
export async function fetchEdekaMarkets(zipCode = '10115', fetchFn = fetch, cache = globalPersistentCache) {
  const cleanZip = String(zipCode).trim() || '10115';
  const cacheKey = `edeka_markets_${cleanZip}`;

  if (cache) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }

  try {
    const url = `https://www.edeka.de/api/marketsearch/markets?searchstring=${encodeURIComponent(cleanZip)}`;
    const res = await fetchFn(url, { headers: EDEKA_HEADERS });
    if (!res.ok) return [];

    const data = await res.json();
    const markets = Array.isArray(data.markets) ? data.markets : [];

    if (cache && markets.length > 0) {
      // Märkte ändern sich selten -> 24 Stunden cachen
      cache.set(cacheKey, markets, 24 * 60 * 60 * 1000);
    }

    return markets;
  } catch (err) {
    console.error('Fehler bei EDEKA Marktsuche:', err.message);
    return [];
  }
}

/**
 * Normalisiert ein einzelnes EDEKA-Angebot
 */
export function normalizeEdekaDoc(doc, query = '') {
  if (!doc || !doc.titel) return null;

  const id = `edeka-${doc.angebotid || Math.random().toString(36).slice(2)}`;
  const title = (doc.titel || '').trim();
  const price = typeof doc.preis === 'number' ? doc.preis : parseFloat(doc.preis) || 0;
  if (price <= 0) return null;

  const desc = (doc.beschreibung || '').trim();

  // Marke extrahieren
  let brand = 'EDEKA';
  const brandCandidates = ['Gut & Günstig', 'EDEKA Bio', 'Alnatura', 'Bauerngut', 'Kerrygold', 'Milram', 'Weihenstephan'];
  for (const cand of brandCandidates) {
    if (title.toLowerCase().includes(cand.toLowerCase()) || desc.toLowerCase().includes(cand.toLowerCase())) {
      brand = cand;
      break;
    }
  }

  const isBio = isBioProduct(title, brand, desc, [doc.warengruppe || '']);
  const isNonFood = isNonFoodProduct(title, brand, desc, [doc.warengruppe || '']);

  // Rabatt berechnen / extrahieren
  let discountPercent = null;
  if (doc.nachlass) {
    const match = String(doc.nachlass).match(/(\d+)\s*%/);
    if (match) discountPercent = parseInt(match[1], 10);
  }

  let oldPrice = null;
  if (discountPercent && discountPercent > 0 && discountPercent <= 65) {
    const calcOld = parseFloat((price / (1 - discountPercent / 100)).toFixed(2));
    oldPrice = validateAndSanitizeOldPrice(price, calcOld, isNonFood);
  }

  // Packungsgröße
  let packageSize = '';
  const sizeMatch = desc.match(/(\d+(?:[.,]\d+)?\s*(?:kg|g|l|ml|Stück|er))/i);
  if (sizeMatch) {
    packageSize = sizeMatch[1];
  }

  // Grundpreis
  let referencePrice = null;
  let referenceUnit = '';
  if (doc.basicPrice) {
    const bpMatch = String(doc.basicPrice).match(/(\d+[.,]\d{2})\s*€?\s*(?:\/|pro)?\s*(1?\s*(?:kg|l|100g|100ml|stk))/i);
    if (bpMatch) {
      referencePrice = parseFloat(bpMatch[1].replace(',', '.'));
      referenceUnit = bpMatch[2].replace(/^1\s*/, '').trim();
    }
  }

  // Fallback: Grundpreis aus Beschreibung berechnen
  if (!referencePrice && sizeMatch) {
    const rawVal = parseFloat(sizeMatch[1].replace(',', '.'));
    const unit = sizeMatch[1].replace(/[\d.,\s]/g, '').toLowerCase();
    if (unit === 'kg' && rawVal > 0) {
      referencePrice = parseFloat((price / rawVal).toFixed(2));
      referenceUnit = 'kg';
    } else if (unit === 'g' && rawVal > 0) {
      referencePrice = parseFloat(((price / rawVal) * 1000).toFixed(2));
      referenceUnit = 'kg';
    } else if (unit === 'l' && rawVal > 0) {
      referencePrice = parseFloat((price / rawVal).toFixed(2));
      referenceUnit = 'l';
    }
  }

  let formattedRefPrice = null;
  if (referencePrice && referenceUnit) {
    formattedRefPrice = `${referencePrice.toFixed(2).replace('.', ',')} € / ${referenceUnit}`;
  } else if (referencePrice) {
    formattedRefPrice = `${referencePrice.toFixed(2).replace('.', ',')} €`;
  }

  // Bild URL
  const imageUrl = doc.bild_app || doc.bild_web130 || doc.bild_web90 || null;

  // App-Preis Kriterium prüfen
  const requiresApp = Array.isArray(doc.kriterien) && doc.kriterien.some(k => 
    (k.name || '').toLowerCase().includes('app')
  );

  // Gültigkeitsdatum
  let validTo = null;
  if (doc.gueltig_bis) {
    validTo = new Date(doc.gueltig_bis).toISOString();
  }

  return {
    id,
    title,
    productName: title,
    brand,
    retailer: 'EDEKA',
    retailerSlug: 'edeka',
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
    requiresApp,
    validFrom: null,
    validTo,
    imageUrl,
    query,
    categories: doc.warengruppe ? [doc.warengruppe] : ['EDEKA Angebote'],
    isBio,
    isNonFood,
  };
}

/**
 * Lädt alle aktuellen Angebote des nächsten EDEKA-Marktes für eine PLZ
 */
export async function fetchAllEdekaOffers(zipCode = '10115', fetchFn = fetch, cache = globalPersistentCache) {
  const cleanZip = String(zipCode).trim() || '10115';
  const markets = await fetchEdekaMarkets(cleanZip, fetchFn, cache);
  if (!markets || markets.length === 0) return [];

  const market = markets[0];
  const marketId = market.id;
  const cacheKey = `edeka_offers_${marketId}`;

  if (cache) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }

  try {
    const url = `https://www.edeka.de/eh/service/eh/offers?marketId=${marketId}`;
    const res = await fetchFn(url, { headers: EDEKA_HEADERS });
    if (!res.ok) return [];

    const data = await res.json();
    const docs = Array.isArray(data.docs) ? data.docs : [];

    const offers = docs
      .map(d => normalizeEdekaDoc(d))
      .filter(Boolean);

    if (cache && offers.length > 0) {
      cache.set(cacheKey, offers, 2 * 60 * 60 * 1000); // 2 Stunden Cache
    }

    return offers;
  } catch (err) {
    console.error('Fehler beim Abrufen der EDEKA-Angebote:', err.message);
    return [];
  }
}

/**
 * Durchsucht die EDEKA-Angebote nach einem Suchbegriff
 */
export async function searchEdekaOffers(query = '', zipCode = '10115', options = {}) {
  const allOffers = await fetchAllEdekaOffers(zipCode, options.fetchFn || fetch, options.cache || globalPersistentCache);
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
