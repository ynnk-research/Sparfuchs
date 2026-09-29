/**
 * Netto mit dem Hund (Netto ApS & Co. KG / Scottie) Scraper & Normalizer
 * Lädt offizielle wöchentliche Angebote direkt von netto.de/angebote/
 */

import { globalPersistentCache } from './cache.js';
import { isBioProduct, isNonFoodProduct } from './aldinord.js';
import { validateAndSanitizeOldPrice } from '../engine/comparator.js';

export const NETTO_MIT_HUND_PAGES = [
  'https://netto.de/angebote/',
  'https://netto.de/angebote/spar-stars/',
  'https://netto.de/angebote/regionale-produkte/',
  'https://netto.de/angebote/ost-lieblinge/',
  'https://netto.de/angebote/hammer-mittwoch/',
  'https://netto.de/angebote/knaller-wochenende/',
  'https://netto.de/angebote/dauerhaft-reduziert/',
];

const NETTO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
};

/**
 * Parst Produkt-Karten aus dem HTML einer Netto-Angebotsseite
 */
export function parseNettoMitHundHtml(pageHtml, sourceUrl = '') {
  if (!pageHtml || typeof pageHtml !== 'string') return [];

  // Gültigkeitszeitraum extrahieren (z. B. "Angebote vom: 28-09-2026 bis 02-10-2026")
  let validFrom = null;
  let validTo = null;
  const dateMatch = pageHtml.match(/Angebote vom:\s*<\/span>\s*(\d{2})[-.](\d{2})[-.](\d{4})\s*(?:<!-- -->\s*)*bis\s*(?:<!-- -->\s*)*(\d{2})[-.](\d{2})[-.](\d{4})/i) ||
                    pageHtml.match(/Angebote vom:\s*(\d{2})[-.](\d{2})[-.](\d{4})\s*bis\s*(\d{2})[-.](\d{2})[-.](\d{4})/i);

  if (dateMatch) {
    validFrom = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}T00:00:00.000Z`;
    validTo = `${dateMatch[6]}-${dateMatch[5]}-${dateMatch[4]}T23:59:59.000Z`;
  }

  const productBlocks = pageHtml.split(/<div[^>]*aria-label="product-\d+"[^>]*>/i).slice(1);
  const offers = [];

  for (let block of productBlocks) {
    const endIdx = block.indexOf('aria-label="product-');
    const content = endIdx !== -1 ? block.slice(0, endIdx) : block;

    // Bild-URL
    const imgMatch = content.match(/<img[^>]*src="([^"]+)"[^>]*>/i);
    const imageUrl = imgMatch ? imgMatch[1].replace(/&amp;/g, '&') : null;

    // Titel & Marke in <h4>
    const h4Match = content.match(/<h4[^>]*>([\s\S]*?)<\/h4>/i);
    let rawTitle = h4Match ? h4Match[1].replace(/<[^>]+>/g, '').trim() : '';
    if (!rawTitle) continue;

    const titleLines = rawTitle.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    let brand = 'Netto';
    let title = rawTitle.replace(/\s+/g, ' ');

    const knownNettoBrands = [
      'frija', 'MEINE FLEISCHEREI', 'Premieur', 'Premieur Bio', 'Frikadelli',
      'Harzer Grauhof', 'Alina', 'Finax', 'Castell', 'Bakers Best', 'Natura',
      'Scottie', 'Dan Cake', 'Ofterdinger', 'Almzeit', 'Mövenpick', 'Froop',
      'Jacobs', 'Dallmayr', 'Rotkäppchen', 'Almette', 'Kinder', 'Ferrero'
    ];

    if (titleLines.length >= 2) {
      brand = titleLines[0];
      title = titleLines.slice(1).join(' ');
    } else {
      for (const kb of knownNettoBrands) {
        if (title.toLowerCase().startsWith(kb.toLowerCase())) {
          brand = kb;
          break;
        }
      }
    }

    // Beschreibung in <p>
    const pMatch = content.match(/<p[^>]*class="[^"]*leading-3[^"]*"[^>]*>([\s\S]*?)<\/p>/i) ||
                   content.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const desc = pMatch ? pMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    // Preis in <h3 ...>X<!-- -->.<span ...>YY</span></h3>
    const priceMatch = content.match(/<h3[^>]*>\s*(\d+)\s*(?:<!-- -->)?\s*\.\s*<span[^>]*>([^<]+)<\/span>\s*<\/h3>/i);
    let price = 0;
    if (priceMatch) {
      const euro = priceMatch[1];
      const cent = priceMatch[2].trim() === '-' ? '00' : priceMatch[2].trim();
      price = parseFloat(`${euro}.${cent}`);
    }
    if (price <= 0) continue;

    // Bio & Non-Food Prüfung
    const isBio = isBioProduct(title, brand, desc, []);
    const isNonFood = isNonFoodProduct(title, brand, desc, []);

    // Streichpreis (z. B. "statt 1.99")
    const oldPriceMatch = content.match(/statt\s*(\d+[.,]\d{2})/i);
    const parsedOld = oldPriceMatch ? parseFloat(oldPriceMatch[1].replace(',', '.')) : null;
    const oldPrice = validateAndSanitizeOldPrice(price, parsedOld, isNonFood);

    // Rabatt in %
    let discountPercent = null;
    const discountMatch = content.match(/-(\d+)\s*%/);
    if (discountMatch) {
      discountPercent = parseInt(discountMatch[1], 10);
    } else if (oldPrice && price && oldPrice > price) {
      discountPercent = Math.round(((oldPrice - price) / oldPrice) * 100);
    }

    // Grundpreis (z. B. "1 kg = 6.24" oder "1 Liter = 0.75")
    let referencePrice = null;
    let referenceUnit = '';
    const refMatch = desc.match(/1\s*(kg|liter|l|stück)\s*=\s*(\d+[.,]\d{2})/i);
    if (refMatch) {
      referenceUnit = refMatch[1].toLowerCase().replace('liter', 'l');
      referencePrice = parseFloat(refMatch[2].replace(',', '.'));
    }

    // Packungsgröße aus Beschreibung
    let packageSize = '';
    const sizeMatch = desc.match(/(\d+(?:[.,]\d+)?\s*(?:kg|g|l|ml|Stück|x\s*\d+[^,\n]*))/i);
    if (sizeMatch) {
      packageSize = sizeMatch[1].trim();
    }

    let formattedRefPrice = null;
    if (referencePrice && referenceUnit) {
      formattedRefPrice = `${referencePrice.toFixed(2).replace('.', ',')} € / ${referenceUnit}`;
    } else if (referencePrice) {
      formattedRefPrice = `${referencePrice.toFixed(2).replace('.', ',')} €`;
    }

    const cleanTitleSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
    const id = `netto-hund-${cleanTitleSlug}-${price.toFixed(2).replace('.', '-')}`;

    offers.push({
      id,
      title,
      productName: title,
      brand,
      retailer: 'Netto mit dem Hund',
      retailerSlug: 'netto-mit-dem-hund',
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
      validFrom,
      validTo,
      imageUrl,
      query: '',
      categories: ['Netto mit dem Hund Angebote'],
      isBio,
      isNonFood,
      sourceUrl,
    });
  }

  return offers;
}

/**
 * Lädt alle aktuellen Angebote von Netto mit dem Hund (gecacht mit 12h TTL)
 */
export async function fetchAllNettoMitHundOffers(fetchFn = fetch, cache = globalPersistentCache) {
  const cacheKey = 'netto_mit_hund_all_offers_v1';

  if (cache) {
    const cached = cache.get(cacheKey);
    if (cached && Array.isArray(cached) && cached.length > 0) {
      return cached;
    }
  }

  try {
    let failedPages = 0;
    const fetchPromises = NETTO_MIT_HUND_PAGES.map(async url => {
      try {
        const res = await fetchFn(url, { headers: NETTO_HEADERS });
        if (!res.ok) { failedPages++; return []; }
        const html = await res.text();
        return parseNettoMitHundHtml(html, url);
      } catch (err) {
        failedPages++;
        console.warn(`Fehler beim Laden von Netto mit dem Hund (${url}):`, err.message);
        return [];
      }
    });

    const results = await Promise.all(fetchPromises);
    if (failedPages === NETTO_MIT_HUND_PAGES.length) {
      throw new Error('Alle Netto-Filialseiten sind nicht erreichbar');
    }
    const combined = results.flat();

    // Deduplizieren nach Titel + Preis
    const seen = new Set();
    const uniqueOffers = [];

    for (const offer of combined) {
      const key = `${offer.title.toLowerCase().trim()}_${offer.price}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueOffers.push(offer);
      }
    }

    const fetchedAt = new Date().toISOString();
    uniqueOffers.forEach(offer => { offer.sourceFetchedAt = fetchedAt; });
    if (cache && uniqueOffers.length > 0) {
      // 12 Stunden Cache für konservativen Ansatz
      cache.set(cacheKey, uniqueOffers, 12 * 60 * 60 * 1000);
    }

    return uniqueOffers;
  } catch (err) {
    console.error('Fehler bei fetchAllNettoMitHundOffers:', err.message);
    throw err;
  }
}

/**
 * Durchsucht Angebote von Netto mit dem Hund nach einem Suchbegriff
 */
export async function searchNettoMitHundOffers(query = '', zip = '10115', options = {}) {
  const allOffers = await fetchAllNettoMitHundOffers(options.fetchFn || fetch, options.cache || globalPersistentCache);
  if (!query || !query.trim()) {
    return allOffers;
  }

  const cleanQuery = query.toLowerCase().trim();
  const tokens = cleanQuery.split(/\s+/).filter(Boolean);

  return allOffers.filter(offer => {
    const text = `${offer.title} ${offer.brand || ''} ${offer.description || ''}`.toLowerCase();
    return tokens.every(token => text.includes(token));
  });
}
