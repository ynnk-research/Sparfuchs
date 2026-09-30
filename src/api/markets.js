import { globalPersistentCache } from './cache.js';

const OVERPASS_ENDPOINTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

const CHAIN_PATTERNS = [
  [/\brewe\s*center\b/i, 'REWE Center'],
  [/\brewe\b/i, 'REWE'],
  [/\be\s*center\b|\bedeka\s*center\b/i, 'Edeka Center'],
  [/\bedeka\b/i, 'Edeka'],
  [/\baldi\s*(nord|north)\b/i, 'Aldi Nord'],
  [/\baldi\s*(süd|sued|south)\b/i, 'Aldi Süd'],
  [/\blidl\b/i, 'Lidl'],
  [/\bkaufland\b/i, 'Kaufland'],
  [/\bpenny\b/i, 'Penny'],
  [/\bnetto\s*marken/i, 'Netto Marken-Discount'],
  [/\bnetto\s*(mit dem hund|mit dem scottie|scottie)\b/i, 'Netto mit dem Hund'],
  [/\bnorma\b/i, 'Norma'],
];

export function identifyMarketChain(tags = {}) {
  const brandId = String(tags['brand:wikidata'] || '').trim().toUpperCase();
  const knownBrands = {
    Q552652: 'Netto mit dem Hund',
    Q879858: 'Netto Marken-Discount',
    Q41171373: 'Aldi Nord',
    Q41171672: 'Aldi Süd',
  };
  if (knownBrands[brandId]) return knownBrands[brandId];
  // The operator may be the parent company of a different store brand.
  for (const label of [[tags.brand, tags.name].filter(Boolean).join(' '), tags.operator || '']) {
    for (const [pattern, chain] of CHAIN_PATTERNS) {
      if (pattern.test(label)) return chain;
    }
  }
  return null;
}

export function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) *
    Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function normalizeOsmMarket(element, origin) {
  const tags = element.tags || {};
  const chain = identifyMarketChain(tags);
  const lat = Number(element.lat ?? element.center?.lat);
  const lon = Number(element.lon ?? element.center?.lon);
  if (!chain || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const address = [
    [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' '),
    [tags['addr:postcode'], tags['addr:city']].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ');
  const name = String(tags.name || tags.brand || chain);
  // Coordinates identify this OSM branch even when its street address is missing.
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lon}`)}`;
  return {
    id: `osm-${element.type}-${element.id}`,
    chain,
    name,
    address,
    lat,
    lon,
    distanceKm: Number(distanceKm(origin, { lat, lon }).toFixed(1)),
    mapsUrl,
    source: 'OpenStreetMap',
  };
}

export async function searchNearbyMarkets({ zipCode, radiusKm = 5, chain = '', lat, lon, fetchFn = fetch, cache = globalPersistentCache }) {
  const zip = String(zipCode || '').trim();
  if (!/^\d{5}$/.test(zip)) throw new Error('Bitte eine gültige deutsche PLZ eingeben');
  const radius = Number(radiusKm);
  if (!Number.isFinite(radius) || radius < 1 || radius > 30) throw new Error('Radius muss zwischen 1 und 30 km liegen');
  const centerProvided = lat !== undefined || lon !== undefined;
  const center = { lat: Number(lat), lon: Number(lon) };
  if (centerProvided && (!Number.isFinite(center.lat) || !Number.isFinite(center.lon) ||
    center.lat < 47 || center.lat > 56 || center.lon < 5 || center.lon > 16)) {
    throw new Error('Kartenmittelpunkt muss in Deutschland liegen');
  }
  const requestedChain = String(chain || '').trim();
  if (requestedChain.length > 80) throw new Error('Ungültige Marktkette');
  const cacheKey = `nearby_markets_osm_v4_${zip}_${radius}_${requestedChain}_${centerProvided ? `${center.lat.toFixed(3)}_${center.lon.toFixed(3)}` : 'plz'}`;
  const cached = cache?.get(cacheKey);
  if (cached) return cached;

  let origin = center;
  if (!centerProvided) {
    const postalResponse = await fetchFn(`https://api.zippopotam.us/de/${zip}`, { signal: AbortSignal.timeout(8000) });
    if (!postalResponse.ok) throw new Error('PLZ konnte nicht gefunden werden');
    const postal = await postalResponse.json();
    const place = postal.places?.[0];
    origin = { lat: Number(place?.latitude), lon: Number(place?.longitude) };
    if (!Number.isFinite(origin.lat) || !Number.isFinite(origin.lon)) throw new Error('PLZ hat keine Koordinaten');
  }

  const query = `[out:json][timeout:12];nwr["shop"~"^(supermarket|discount)$"](around:${Math.round(radius * 1000)},${origin.lat},${origin.lon});out center tags;`;
  let osm = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetchFn(`${endpoint}?data=${encodeURIComponent(query)}`, {
        headers: { 'User-Agent': 'SparFuchs/1.0 nearby-markets' },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) continue;
      const data = await response.json();
      if (Array.isArray(data.elements)) {
        osm = data;
        break;
      }
    } catch {
      // Public instances can be unavailable; try the next one.
    }
  }
  if (!osm) throw new Error('Kartendienst ist gerade nicht erreichbar. Bitte später erneut versuchen.');
  const markets = (Array.isArray(osm.elements) ? osm.elements : [])
    .map(element => normalizeOsmMarket(element, origin))
    .filter(Boolean)
    .filter(market => !requestedChain || market.chain.toLowerCase() === requestedChain.toLowerCase())
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 60);
  const result = { zipCode: zip, radiusKm: radius, chain: requestedChain, origin, markets, source: 'OpenStreetMap' };
  cache?.set(cacheKey, result, 24 * 60 * 60 * 1000);
  return result;
}
