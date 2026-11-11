import crypto from 'node:crypto';
import { globalPersistentCache } from './cache.js';
import { isBioProduct, isNonFoodProduct } from './aldinord.js';
import { validateAndSanitizeOldPrice } from '../engine/comparator.js';

const PAGE = 'https://www.selgros.de/markt-sortiment';
const SEARCH = 'https://www.selgros.de/proxy/schaufenster/docs/search.post.search?api-version=2024-07-01';

// The public website derives its request key from the current UTC date.
export function selgrosDailyKey(date = new Date()) {
  const datePart = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }).format(date).replaceAll('/', '.');
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' }).format(date);
  return crypto.createHash('sha256').update(`${datePart}-${weekday}`).digest('hex');
}

export function parseSelgrosMarkets(html) {
  const settingsMatch = html.match(/<script type="application\/json" data-drupal-selector="drupal-settings-json">([\s\S]*?)<\/script>/);
  if (!settingsMatch) throw new Error('Selgros Marktdaten fehlen');
  const map = JSON.parse(settingsMatch[1]).schaufenster?.marketsMap;
  if (!map || typeof map !== 'object') throw new Error('Selgros Marktzuordnung fehlt');
  const markets = [];
  for (const match of html.matchAll(/<tg-option\s+value=['"](\d+)['"]\s+data-lon=['"]([^'"]+)['"]\s+data-lat=['"]([^'"]+)['"]\s*>([^<]+)<\/tg-option>/g)) {
    const id = String(map[match[1]] || '');
    if (!/^\d{1,4}$/.test(id) || markets.some(m => m.id === id)) continue;
    markets.push({ id, name: match[4].trim().replace(/&amp;/g, '&'), lat: Number(match[3]), lon: Number(match[2]) });
  }
  if (!markets.length) throw new Error('Selgros Marktliste ist leer');
  return markets.filter(m => Number.isFinite(m.lat) && Number.isFinite(m.lon));
}

export async function fetchSelgrosMarkets({ fetchFn = fetch, cache = globalPersistentCache } = {}) {
  const cached = cache?.get('selgros_markets_v1');
  if (cached) return cached;
  const response = await fetchFn(PAGE, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Selgros Marktliste HTTP ${response.status}`);
  const markets = parseSelgrosMarkets(await response.text());
  cache?.set('selgros_markets_v1', markets, 24 * 60 * 60 * 1000);
  return markets;
}

export function normalizeSelgrosOffer(item, marketId, query = '', now = new Date()) {
  if (!item?.productId || !item.title || item.priceDataInvalid || !Array.isArray(item.units) || !Array.isArray(item.prices)) return null;
  const unit = item.units.find(u => u.baseUnit && ['ST', 'KG'].includes(u.unit?.code));
  if (!unit || (item.minSellUnit && item.minSellUnit !== unit.unit.code)) return null;
  const entry = item.prices.find(p => p.unit === unit.unit.code && Number(p.plant) === Number(marketId));
  const offer = entry?.offerPrice;
  if (!offer || !Number.isFinite(offer.grossPrice) || offer.grossPrice <= 0 || !offer.offerFrom || !offer.offerUntil) return null;
  const from = Date.parse(offer.offerFrom), to = Date.parse(offer.offerUntil);
  if (!Number.isFinite(from) || !Number.isFinite(to) || now.getTime() < from || now.getTime() > to) return null;
  const price = offer.grossPrice;
  const categories = Array.isArray(item.category) ? item.category : [];
  const isNonFood = isNonFoodProduct(item.title, item.productBrand, item.description, categories);
  const oldPrice = validateAndSanitizeOldPrice(price, entry.price?.grossPrice, isNonFood);
  const label = unit.unit.code === 'KG' ? '1 kg' : '1 Stück';
  return {
    id: `selgros-${marketId}-${item.productId}`, title: item.title, productName: item.title,
    brand: item.productBrand || null, retailer: 'Selgros', retailerSlug: 'selgros', price,
    formattedPrice: `${price.toFixed(2).replace('.', ',')} €`, oldPrice,
    formattedOldPrice: oldPrice ? `${oldPrice.toFixed(2).replace('.', ',')} €` : null,
    discountPercent: oldPrice ? Math.round((oldPrice - price) / oldPrice * 100) : null,
    referencePrice: unit.unit.code === 'KG' ? price : null, referenceUnit: unit.unit.code === 'KG' ? 'kg' : '',
    disableEstimatedReferencePrice: true, packageSize: label,
    description: `Brutto je ${label} · Großhandel, Kundenkarte erforderlich`,
    requiresApp: false, validFrom: offer.offerFrom, validTo: offer.offerUntil,
    imageUrl: item.images?.[0]?.url || null, query, categories,
    isBio: isBioProduct(item.title, item.productBrand, item.description, categories), isNonFood,
  };
}

export async function searchSelgrosOffers({ query = '', marketId, fetchFn = fetch, cache = globalPersistentCache }) {
  const markets = await fetchSelgrosMarkets({ fetchFn, cache });
  if (!markets.some(m => m.id === String(marketId))) throw new Error('Ungültiger Selgros-Markt');
  const cleanQuery = String(query).replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().slice(0, 100);
  const key = `selgros_v1_${marketId}_${cleanQuery.toLowerCase()}`;
  const cached = cache?.get(key);
  if (cached) return cached;
  const body = { top: 100, skip: 0, search: cleanQuery || '*', searchFields: 'title,productBrand',
    filter: `markets/any(m: m eq ${marketId}) and visible eq true and offer eq true and (stock/any(s: s/status eq true) or orderable eq true)`, count: true };
  const response = await fetchFn(SEARCH, { method: 'POST', headers: { 'Content-Type': 'application/json', 'api-key': selgrosDailyKey() }, body: JSON.stringify(body), signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Selgros Suche HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data.value)) throw new Error('Ungültige Selgros Antwort');
  const fetchedAt = new Date().toISOString();
  const offers = data.value.map(item => normalizeSelgrosOffer(item, marketId, cleanQuery)).filter(Boolean);
  offers.forEach(offer => { offer.sourceFetchedAt = fetchedAt; });
  const ttl = Math.max(0, Math.min(30 * 60 * 1000, ...offers.map(o => Date.parse(o.validTo) - Date.now())));
  if (ttl > 0) cache?.set(key, offers, ttl);
  return offers;
}
