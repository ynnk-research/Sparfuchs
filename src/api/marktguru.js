/**
 * Marktguru API Client & Normalizer
 * Stellt standardisierte Angebotsdaten für deutsche Supermärkte bereit.
 */

import { globalPersistentCache } from './cache.js';
import { validateAndSanitizeOldPrice } from '../engine/comparator.js';

export const MARKTGURU_BASE_URL = 'https://api.marktguru.de/api/v1/offers/search';

export const MARKTGURU_HEADERS = {
  'x-clientkey': 'WU/RH+PMGDi+gkZer3WbMelt6zcYHSTytNB7VpTia90=',
  'x-apikey': '8Kk+pmbf7TgJ9nVj2cXeA7P5zBGv8iuutVVMRfOfvNE=',
  'Accept': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

/**
 * In-Memory TTL Cache für API-Anfragen (respektiert für Tests)
 */
export class OfferCache {
  constructor(defaultTtlMs = 30 * 60 * 1000) { // 30 Minuten
    this.cache = new Map();
    this.defaultTtlMs = defaultTtlMs;
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  clear() {
    this.cache.clear();
  }

  get size() {
    return this.cache.size;
  }
}

// Persistenter Disk- und Memory-Cache als Standard
export const defaultCache = globalPersistentCache;

/**
 * Formatiert Mengenangaben und Packungsgrößen
 */
function extractPackageSize(volume, unit, description) {
  if (volume && unit) {
    if (unit.shortName === 'kg' && volume < 1) {
      return `${Math.round(volume * 1000)} g`;
    }
    if (unit.shortName === 'l' && volume < 1) {
      return `${Math.round(volume * 1000)} ml`;
    }
    return `${volume} ${unit.shortName || unit.name || ''}`.trim();
  }
  // Fallback: Versuch aus der Beschreibung zu extrahieren (z. B. "je 250-g-Pckg.")
  if (description) {
    const match = description.match(/(\d+(?:[.,]\d+)?\s*(?:g|kg|ml|l|Liter|Gramm|Stück|er))/i);
    if (match) return match[1].trim();
  }
  return null;
}

/**
 * Normalisiert ein einzelnes Roh-Angebot aus der Marktguru-API
 */
export function normalizeOffer(entry, defaultQuery = '') {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const id = String(entry.id || '');
  const brandName = entry.brand?.name || null;
  const productName = entry.product?.name || null;
  const rawDesc = entry.description || '';

  // Titel zusammensetzen: Wenn Marke vorhanden, oft Kombination aus Marke & Produkt
  let title = productName || rawDesc || brandName || 'Unbenanntes Angebot';
  if (brandName && productName && !productName.toLowerCase().includes(brandName.toLowerCase())) {
    title = `${brandName} ${productName}`;
  }

  // Händler
  let retailer = 'Unbekannt';
  let retailerSlug = '';
  if (Array.isArray(entry.advertisers) && entry.advertisers.length > 0) {
    retailer = entry.advertisers[0].name || 'Unbekannt';
    retailerSlug = entry.advertisers[0].uniqueName || '';
  } else if (entry.retailerName) {
    retailer = entry.retailerName;
  }

  // Non-Food und Bio vorab ermitteln für Preis-Validierung
  const rawCats = Array.isArray(entry.categories) ? entry.categories.map(c => c.name).filter(Boolean) : [];
  const isBio = /\b(bio|bioland|demeter|naturland|gut bio|k-bio|alnatura|öko|naturgut|biobio|vemondo)\b/i.test(`${title} ${brandName || ''} ${rawDesc}`);
  const isNonFood = /(drogerie|haushalt|werkzeug|garten|kleidung|mode|elektronik|deko|heimwerker|waschmittel|zahnpasta|shampoo|duschgel|baumarkt|technik|möbel|parkside|silvercrest|crivit|workzone|maler|krepp|klebeband|serviette|handtuch|farbe|pflanze|blume|auto|fahrrad|sport|batterie|kerze)/i.test(`${title} ${rawDesc} ${rawCats.join(' ')}`);

  // Preis & alter Preis mit Plausibilitätsprüfung
  const price = typeof entry.price === 'number' ? entry.price : parseFloat(entry.price) || 0;
  const rawOld = typeof entry.oldPrice === 'number' ? entry.oldPrice : (entry.oldPrice ? parseFloat(entry.oldPrice) : null);
  const oldPrice = validateAndSanitizeOldPrice(price, rawOld, isNonFood);
  
  // Rabatt in %
  let discountPercent = null;
  if (oldPrice && oldPrice > price) {
    discountPercent = Math.round(((oldPrice - price) / oldPrice) * 100);
  }

  // Grundpreis / Referenzpreis
  let referencePrice = typeof entry.referencePrice === 'number' ? entry.referencePrice : (entry.referencePrice ? parseFloat(entry.referencePrice) : null);
  const unitShort = entry.unit?.shortName || entry.unit?.name || '';
  
  // Wenn Referenzpreis fehlt, aber Volume + Unit existieren, selbst berechnen
  if (!referencePrice && entry.volume && entry.volume > 0 && price > 0) {
    referencePrice = parseFloat((price / entry.volume).toFixed(2));
  }

  let formattedRefPrice = null;
  if (referencePrice && unitShort) {
    formattedRefPrice = `${referencePrice.toFixed(2).replace('.', ',')} € / ${unitShort}`;
  } else if (referencePrice) {
    formattedRefPrice = `${referencePrice.toFixed(2).replace('.', ',')} €`;
  }

  // Packungsgröße
  const packageSize = extractPackageSize(entry.volume, entry.unit, rawDesc);

  // Gültigkeitszeitraum
  let validFrom = null;
  let validTo = null;
  if (Array.isArray(entry.validityDates) && entry.validityDates.length > 0) {
    validFrom = entry.validityDates[0].from || null;
    validTo = entry.validityDates[0].to || null;
  }

  // Bild URL
  const imageUrl = id ? `https://cdn.marktguru.de/api/v1/offers/${id}/images/default/0/medium.webp` : null;

  // App-Zwang / Loyalty Membership
  const requiresApp = Boolean(entry.requiresLoyalityMembership);

  return {
    id,
    title,
    productName,
    brand: brandName,
    retailer,
    retailerSlug,
    price,
    formattedPrice: `${price.toFixed(2).replace('.', ',')} €`,
    oldPrice,
    formattedOldPrice: oldPrice ? `${oldPrice.toFixed(2).replace('.', ',')} €` : null,
    discountPercent,
    referencePrice,
    referenceUnit: unitShort,
    formattedRefPrice,
    packageSize,
    volume: entry.volume || null,
    description: rawDesc,
    requiresApp,
    validFrom,
    validTo,
    imageUrl,
    query: defaultQuery,
    categories: rawCats,
    isBio,
    isNonFood,
  };
}

/**
 * Führt eine Suche bei der Marktguru API aus
 */
export async function searchOffers({
  query,
  zipCode = '10115',
  limit = 40,
  offset = 0,
  fetchFn = fetch,
  cache = defaultCache,
  useCache = true,
}) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    return { totalResults: 0, offers: [], retailers: [], categories: [] };
  }

  const cleanQuery = query.trim();
  const cleanZip = String(zipCode).trim() || '10115';
  const cacheKey = `${cleanZip}:${cleanQuery.toLowerCase()}:${limit}:${offset}`;

  if (useCache && cache) {
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const params = new URLSearchParams({
    as: 'web',
    limit: String(limit),
    offset: String(offset),
    q: cleanQuery,
    zipCode: cleanZip,
  });

  const url = `${MARKTGURU_BASE_URL}?${params.toString()}`;

  const response = await fetchFn(url, {
    method: 'GET',
    headers: MARKTGURU_HEADERS,
  });

  if (!response.ok) {
    throw new Error(`Marktguru API Fehler: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const rawResults = Array.isArray(data.results) ? data.results : [];

  const offers = rawResults
    .map(item => normalizeOffer(item, cleanQuery))
    .filter(Boolean);

  const retailers = Array.isArray(data.filters?.retailers)
    ? data.filters.retailers.map(r => ({ id: r.id, name: r.name, count: r.resultsCount }))
    : [];

  const categories = Array.isArray(data.filters?.categories)
    ? data.filters.categories.map(c => ({ id: c.id, name: c.name, count: c.resultsCount }))
    : [];

  const result = {
    query: cleanQuery,
    zipCode: cleanZip,
    totalResults: data.totalResults || offers.length,
    offers,
    retailers,
    categories,
  };

  if (useCache && cache) {
    cache.set(cacheKey, result);
  }

  return result;
}
