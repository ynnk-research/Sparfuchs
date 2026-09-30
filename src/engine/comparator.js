import { classifyOffer } from './categories.js';

/**
 * Validiert und bereinigt Altpreise / Streichpreise / UVP.
 * Verhindert unrealistische Phantasiepreise (z.B. 45 € Streichpreis für ein 1,29 € Produkt
 * oder Kastenpreise für Einzelflaschen).
 */
export function validateAndSanitizeOldPrice(price, oldPrice, isNonFood = false) {
  if (typeof price !== 'number' || price <= 0) return null;
  if (typeof oldPrice !== 'number' || isNaN(oldPrice)) return null;
  if (oldPrice <= price) return null;

  // Maximaler realistischer Faktor für Streichpreise / UVP:
  // Für Lebensmittel: max. Faktor 2.3 (entspricht ca. 56% Rabatt)
  // Für Non-Food / Aktionsware: max. Faktor 3.0 (entspricht ca. 67% Rabatt)
  const maxRatio = isNonFood ? 3.0 : 2.3;
  const ratio = oldPrice / price;

  if (ratio > maxRatio) {
    // Unplausibler Ausreißer (z.B. Einzelflasche vs. Kasten oder falscher Match)
    return null;
  }

  // Absoluter Schutz bei Kleinstpreisen unter 1 Euro:
  // Ein 0,49 € Radieschen-Bund hat niemals einen Normalpreis von 2,22 € (+1,73 € Aufschlag)
  if (price < 1.00 && (oldPrice - price) > 1.25) {
    return null;
  }

  return parseFloat(oldPrice.toFixed(2));
}

/**
 * Extrahiert Menge, Einheit und Basisnormierung aus Textangaben
 * (z. B. "250 g", "500g", "1,5 l", "6 x 0,5 l", "10 Stück")
 */
export function extractPackageAmountAndUnit(str = '', title = '', description = '') {
  const combined = `${str || ''} ${title || ''} ${description || ''}`.trim();
  if (!combined) return null;

  // 1. Multipacks / Gebinde prüfen (z. B. "6 x 0,5 l", "20 x 0,5 l", "6x330ml", "4x100g")
  const multiMatch = combined.match(/(\d+)\s*[xX*]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|gramm|l|liter|litre|ml|milliliter)\b/i);
  if (multiMatch) {
    const count = parseInt(multiMatch[1], 10);
    const amountPerUnit = parseFloat(multiMatch[2].replace(',', '.'));
    const unitRaw = multiMatch[3].toLowerCase();
    let baseUnit = 'kg';
    let baseAmount = 0;

    if (unitRaw === 'g' || unitRaw === 'gramm') {
      baseAmount = (count * amountPerUnit) / 1000;
      baseUnit = 'kg';
    } else if (unitRaw === 'kg') {
      baseAmount = count * amountPerUnit;
      baseUnit = 'kg';
    } else if (unitRaw === 'ml' || unitRaw === 'milliliter') {
      baseAmount = (count * amountPerUnit) / 1000;
      baseUnit = 'l';
    } else if (unitRaw === 'l' || unitRaw === 'liter' || unitRaw === 'litre') {
      baseAmount = count * amountPerUnit;
      baseUnit = 'l';
    }

    if (baseAmount > 0) {
      return { baseAmount, baseUnit, rawAmount: count * amountPerUnit, rawUnit: unitRaw };
    }
  }

  // 2. Einzelpackungsmuster (z. B. "250-g-Pckg.", "250 g", "500g", "1,5 l", "750 ml", "1 kg")
  const searchTexts = [str, description, title].filter(Boolean);
  for (const text of searchTexts) {
    const singleMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(?:-|\s)?(kg|g|gramm|l|liter|litre|ml|milliliter)\b/i);
    if (singleMatch) {
      const amount = parseFloat(singleMatch[1].replace(',', '.'));
      const unitRaw = singleMatch[2].toLowerCase();
      let baseAmount = 0;
      let baseUnit = 'kg';

      if (unitRaw === 'g' || unitRaw === 'gramm') {
        baseAmount = amount / 1000;
        baseUnit = 'kg';
      } else if (unitRaw === 'kg') {
        baseAmount = amount;
        baseUnit = 'kg';
      } else if (unitRaw === 'ml' || unitRaw === 'milliliter') {
        baseAmount = amount / 1000;
        baseUnit = 'l';
      } else if (unitRaw === 'l' || unitRaw === 'liter' || unitRaw === 'litre') {
        baseAmount = amount;
        baseUnit = 'l';
      }

      if (baseAmount > 0) {
        return { baseAmount, baseUnit, rawAmount: amount, rawUnit: unitRaw };
      }
    }
  }

  // 3. Stück-Angaben (z.B. "10 Stück", "6er Packung", "10 Eier")
  for (const text of searchTexts) {
    const pieceMatch = text.match(/(\d+)\s*(?:stück|stk|er\s*pack|eier|beutel|rollen|flaschen|dosen)\b/i);
    if (pieceMatch) {
      const count = parseInt(pieceMatch[1], 10);
      if (count > 0) {
        return { baseAmount: count, baseUnit: 'Stück', rawAmount: count, rawUnit: 'Stück' };
      }
    }
  }

  return null;
}

/**
 * Standardisiert den Grundpreis auf Basiseinheiten (kg, l, Stück),
 * falls abweichende Einheiten wie g oder ml angegeben sind,
 * oder berechnet ihn aus den Mengenangaben, falls er vom Händler nicht bereitgestellt wurde.
 */
export function getStandardizedReferencePrice(offer) {
  if (!offer) {
    return { pricePerBaseUnit: Infinity, baseUnit: 'Stück', isEstimated: true };
  }

  // 1. Wenn expliziter Grundpreis vorhanden ist
  if (typeof offer.referencePrice === 'number' && !isNaN(offer.referencePrice) && offer.referencePrice > 0) {
    const unit = (offer.referenceUnit || '').toLowerCase().trim();
    let factor = 1;
    let baseUnit = unit;

    if (unit === 'g' || unit === 'gramm') {
      factor = 1000;
      baseUnit = 'kg';
    } else if (unit === '100g' || unit === '100 g') {
      factor = 10;
      baseUnit = 'kg';
    } else if (unit === 'ml' || unit === 'milliliter') {
      factor = 1000;
      baseUnit = 'l';
    } else if (unit === '100ml' || unit === '100 ml') {
      factor = 10;
      baseUnit = 'l';
    }

    return {
      pricePerBaseUnit: parseFloat((offer.referencePrice * factor).toFixed(2)),
      baseUnit: baseUnit || 'kg',
      isEstimated: false,
    };
  }

  // 2. Fallback: Versuch, Packungsgröße aus packageSize, title oder description zu extrahieren
  const offerPrice = typeof offer.price === 'number' ? offer.price : parseFloat(offer.price);
  if (typeof offerPrice === 'number' && offerPrice > 0) {
    const pkg = extractPackageAmountAndUnit(offer.packageSize, offer.title, offer.description);
    if (pkg && pkg.baseAmount > 0) {
      const calcRef = parseFloat((offerPrice / pkg.baseAmount).toFixed(2));
      return {
        pricePerBaseUnit: calcRef,
        baseUnit: pkg.baseUnit,
        isEstimated: true,
        extractedPackage: pkg,
      };
    }
  }

  // 3. Wenn kein Grundpreis vorhanden und keine Menge ermittelbar ist
  return {
    pricePerBaseUnit: typeof offer?.price === 'number' ? offer.price : Infinity,
    baseUnit: offer?.referenceUnit || 'Stück',
    isEstimated: true,
  };
}

/**
 * Prüft, ob ein Angebot zum aktuellen Zeitpunkt gültig ist
 */
export function isOfferCurrentlyValid(offer, referenceDate = new Date()) {
  if (!offer.validFrom && !offer.validTo) {
    return true; // Keine Zeitbeschränkung angegeben -> als gültig werten
  }

  const nowMs = referenceDate.getTime();

  if (offer.validFrom) {
    const fromMs = new Date(offer.validFrom).getTime();
    if (!isNaN(fromMs) && nowMs < fromMs) {
      return false; // Noch nicht begonnen
    }
  }

  if (offer.validTo) {
    const toMs = new Date(offer.validTo).getTime();
    if (!isNaN(toMs) && nowMs > toMs) {
      return false; // Bereits abgelaufen
    }
  }

  return true;
}

/**
 * Whitelist echter Supermärkte, Discounter, Drogerien und Bio-Supermärkte in Deutschland
 */
export const SUPERMARKET_WHITELIST = [
  'aldi', 'lidl', 'rewe', 'rewe center', 'edeka', 'kaufland', 'penny', 'netto',
  'marktkauf', 'norma', 'tegut', 'globus', 'hit', 'konsum',
  'feneberg', 'famila', 'combi', 'wasgau', 'v-markt', 'bünting',
  'dm', 'rossmann', 'müller', 'budni',
  'alnatura', 'denns', 'bio company',
];

/**
 * Blacklist von Möbelhäusern, Baumärkten, Elektronik- und Bekleidungsgeschäften
 */
export const NON_SUPERMARKET_BLACKLIST = [
  'xxxlutz', 'mömax', 'moemax', 'poco', 'ikea', 'roller', 'höffner', 'hoeffner',
  'porta', 'jysk', 'dänisches bettenlager', 'sconto', 'segmüller', 'segmueller',
  'obi', 'bauhaus', 'hornbach', 'toom', 'hellweg', 'hagebau',
  'mediamarkt', 'saturn', 'expert', 'euronics', 'cyberport', 'conrad',
  'ernsting', 'kik', 'takko', 'woolworth', 'tedi', 'action', 'thomas philipps',
  'decathlon', 'intersport', 'atu', 'pitstop',
];

/**
 * Prüft, ob ein Händler ein echter Lebensmittel- oder Drogeriemarkt ist
 */
export function isGenuineSupermarket(retailerName) {
  if (!retailerName || typeof retailerName !== 'string') return true; // Keine Händlerangabe (z.B. in Test-Mocks)
  const lower = retailerName.toLowerCase().trim();

  // 1. Blacklist hat absolute Priorität (Möbelhäuser, Baumärkte, Elektronik etc.)
  if (NON_SUPERMARKET_BLACKLIST.some(bl => lower.includes(bl))) {
    return false;
  }

  // 2. Muss in der Supermarkt-/Drogerie-Whitelist enthalten sein
  return SUPERMARKET_WHITELIST.some(wl => lower.includes(wl));
}

/**
 * Prüft, ob ein Händlername (und optional dessen Slug) zu einem Händlerfilter passt.
 * Unterscheidet strikt zwischen ähnlichen Ketten wie "REWE" vs. "REWE Center",
 * damit REWE-Center-Angebote nicht versehentlich unter REWE auftauchen.
 */
export function isMatchingRetailer(offerRetailer, offerSlug = '', filterRetailer = '') {
  const oName = (offerRetailer || '').toLowerCase().trim();
  const oSlug = (offerSlug || '').toLowerCase().trim();
  const f = (filterRetailer || '').toLowerCase().trim();

  if (!f) return false;
  if (oName === f || oSlug === f) return true;

  // Strikte Unterscheidung: "REWE" vs. "REWE Center"
  if (f === 'rewe') {
    // REWE Filter darf NICHT auf REWE Center matchen!
    return (oName.includes('rewe') || oSlug.includes('rewe')) &&
           !oName.includes('center') &&
           !oSlug.includes('center');
  }
  if (f === 'rewe center' || f === 'rewe-center') {
    return (oName.includes('rewe') && oName.includes('center')) ||
           (oSlug.includes('rewe') && oSlug.includes('center'));
  }

  // Strikte Unterscheidung: "Edeka" vs. "Edeka Center"
  if (f === 'edeka') {
    return (oName.includes('edeka') || oSlug.includes('edeka')) &&
           !oName.includes('center') &&
           !oSlug.includes('center');
  }
  if (f === 'edeka center' || f === 'edeka-center') {
    return (oName.includes('edeka') && oName.includes('center')) ||
           (oSlug.includes('edeka') && oSlug.includes('center'));
  }

  // Strikte Unterscheidung: "Aldi Süd" vs. "Aldi Nord"
  if (f === 'aldi sued' || f === 'aldi süd') {
    return (oName.includes('süd') || oName.includes('sued') || oSlug.includes('sued') || oSlug.includes('süd')) &&
           !oName.includes('nord') && !oSlug.includes('nord');
  }
  if (f === 'aldi nord') {
    return (oName.includes('nord') || oSlug.includes('nord')) &&
           !oName.includes('süd') && !oName.includes('sued') && !oSlug.includes('sued');
  }

  // Strikte Unterscheidung: "Netto Marken-Discount" vs. "Netto mit dem Hund"
  if (f.includes('hund') || f.includes('scottie')) {
    return oName.includes('hund') || oName.includes('scottie') || oSlug.includes('scottie') || oSlug.includes('hund') || oSlug.includes('aps');
  }
  if (f === 'netto marken-discount' || f === 'netto') {
    return (oName.includes('netto') || oSlug.includes('netto')) &&
           !oName.includes('hund') && !oName.includes('scottie') && !oSlug.includes('scottie') && !oSlug.includes('hund');
  }

  // Mehrwort-Ketten (z.B. "Netto Marken-Discount")
  if (f.includes(' ') || f.includes('-')) {
    return oName.includes(f) || oSlug.includes(f);
  }

  // Einwort-Ketten mit Wortgrenze
  return new RegExp(`\\b${f}\\b`, 'i').test(oName) || oSlug === f;
}

/**
 * Filtert und sortiert eine Liste von normalisierten Angeboten
 */
export function filterAndSortOffers(offers, options = {}) {
  if (!Array.isArray(offers)) return [];

  const {
    sortBy = 'refPrice', // 'refPrice' | 'price' | 'discount' | 'validTo' | 'title' | 'retailer'
    retailers = options.retailer ? [options.retailer] : [],       // z. B. ['Lidl', 'Aldi', 'Rewe', 'REWE Center']
    allowedRetailers = [], // wenn gesetzt: nur Angebote von diesen aktiven Supermärkten
    strictSupermarketOnly = true, // wenn true, Non-Supermärkte (Möbelhäuser, Baumärkte) ausschließen
    category = 'all',     // 'all' | 'dairy' | 'produce' | 'meat' | 'drinks' | 'snacks' | 'pantry' | 'nonfood'
    excludeAppOnly = false, // wenn true, Angebote mit requiresApp ausschließen
    validNowOnly = false, // wenn true, nur aktuell gültige Angebote
    onlyBio = false,      // wenn true, nur Bio-Produkte
    onlyFood = false,     // wenn true, nur Lebensmittel (kein Non-Food)
    onlyNonFood = false,  // wenn true, nur Nicht-Lebensmittel / Aktionsware
    onlyFavorites = false,// wenn true, nur Favoriten
    favoriteKeywords = [],// Liste der Favoriten
    referenceDate = new Date(),
    maxPrice = null,
    minDiscount = null,
  } = options;

  const rawRetailers = (retailers && retailers.length > 0) ? retailers : (options.retailer ? [options.retailer] : []);
  const retailerFilters = (Array.isArray(rawRetailers) ? rawRetailers : [rawRetailers])
    .map(r => String(r).toLowerCase().trim())
    .filter(r => Boolean(r) && r !== 'all');

  const cleanFavs = (Array.isArray(favoriteKeywords) ? favoriteKeywords : [favoriteKeywords])
    .map(f => String(f).toLowerCase().trim())
    .filter(Boolean);

  // 1. Filtern
  const filtered = offers.filter(offer => {
    // Strikte Supermarkt-Prüfung (XXXLutz, Möbelhäuser, Baumärkte etc. ausschließen)
    if (strictSupermarketOnly && !isGenuineSupermarket(offer.retailer)) {
      return false;
    }

    // Aktive Händlerauswahl (AP 2: Supermärkte aktivieren / deaktivieren)
    if (Array.isArray(allowedRetailers) && allowedRetailers.length > 0) {
      const isAllowed = allowedRetailers.some(
        al => isMatchingRetailer(offer.retailer, offer.retailerSlug, al)
      );
      if (!isAllowed) return false;
    }

    // Händlerfilter (explizite Auswahl)
    if (retailerFilters.length > 0) {
      const matches = retailerFilters.some(
        filter => isMatchingRetailer(offer.retailer, offer.retailerSlug, filter)
      );
      if (!matches) return false;
    }

    // App-Zwang Filter
    if (excludeAppOnly && offer.requiresApp) {
      return false;
    }

    // Gültigkeit prüfen
    if (validNowOnly && !isOfferCurrentlyValid(offer, referenceDate)) {
      return false;
    }

    // Bio Filter
    if (onlyBio && !offer.isBio) {
      return false;
    }

    // Nur Lebensmittel Filter (komplementär zu Non-Food)
    if (onlyFood && offer.isNonFood) {
      return false;
    }

    // Non-Food Filter
    if (onlyNonFood && !offer.isNonFood) {
      return false;
    }

    // Warengruppen- / Kategorie-Filter
    if (category && category !== 'all') {
      const catInfo = classifyOffer(offer);
      if (catInfo.categoryId !== category) {
        return false;
      }
    }

    // Favoriten Filter
    if (onlyFavorites) {
      if (cleanFavs.length === 0) return false;
      const text = `${offer.title} ${offer.brand || ''}`.toLowerCase();
      const isFav = cleanFavs.some(fav => text.includes(fav));
      if (!isFav) return false;
    }

    // Maximalpreis
    if (typeof maxPrice === 'number' && offer.price > maxPrice) {
      return false;
    }

    return true;
  });

  // 2. Preis-Konsistenz: Jedes Angebot mit vollständigen, validierten Preis- und Sparangaben anreichern
  const enriched = filtered.map(offer => {
    const catInfo = classifyOffer(offer);
    const standardizedRef = getStandardizedReferencePrice(offer);
    const referencePriceSource = typeof offer.referencePrice === 'number' && offer.referencePrice > 0
      ? 'retailer' : (standardizedRef.extractedPackage ? 'package' : 'unknown');
    let oldPrice = validateAndSanitizeOldPrice(offer.price, offer.oldPrice, offer.isNonFood);
    let isEstimatedOldPrice = false;
    let comparisonRetailer = null;

    if (oldPrice && oldPrice > offer.price) {
      isEstimatedOldPrice = false;
    } else if (offer.discountPercent && offer.discountPercent > 0 && offer.discountPercent <= 65 && offer.price > 0) {
      const calcOld = parseFloat((offer.price / (1 - offer.discountPercent / 100)).toFixed(2));
      oldPrice = validateAndSanitizeOldPrice(offer.price, calcOld, offer.isNonFood);
      isEstimatedOldPrice = false;
    } else {
      const savingsInfo = calculateItemSavings(offer, offers);
      if (savingsInfo.originalPrice && savingsInfo.originalPrice > offer.price) {
        oldPrice = validateAndSanitizeOldPrice(offer.price, savingsInfo.originalPrice, offer.isNonFood);
        isEstimatedOldPrice = savingsInfo.isEstimated;
        comparisonRetailer = savingsInfo.comparisonRetailer || null;
      }
    }

    let discountPercent = offer.discountPercent;
    let savings = null;
    let formattedOldPrice = null;
    let savingsFormatted = null;

    if (oldPrice && oldPrice > offer.price) {
      formattedOldPrice = `${oldPrice.toFixed(2).replace('.', ',')} €`;
      if (!isEstimatedOldPrice) {
        savings = parseFloat((oldPrice - offer.price).toFixed(2));
        savingsFormatted = `${savings.toFixed(2).replace('.', ',')} €`;
        if (!discountPercent) {
          discountPercent = Math.round(((oldPrice - offer.price) / oldPrice) * 100);
        }
      }
    } else {
      discountPercent = null;
    }
    if (isEstimatedOldPrice) discountPercent = null;

    return {
      ...offer,
      oldPrice,
      formattedOldPrice,
      isEstimatedOldPrice,
      comparisonRetailer,
      discountPercent,
      savings,
      savingsFormatted,
      categoryId: catInfo.categoryId,
      categoryLabel: catInfo.categoryLabel,
      categoryIcon: catInfo.categoryIcon,
      referencePrice: referencePriceSource === 'unknown' ? null : standardizedRef.pricePerBaseUnit,
      referenceUnit: standardizedRef.baseUnit,
      formattedRefPrice: referencePriceSource === 'unknown' ? null
        : `${standardizedRef.pricePerBaseUnit.toFixed(2).replace('.', ',')} €/${standardizedRef.baseUnit}`,
      referencePriceSource,
    };
  });

  // Optional: Nach Mindestrabatt filtern (nachdem alle Rabatte finalisiert wurden)
  let resultOffers = enriched;
  if (typeof minDiscount === 'number' && minDiscount > 0) {
    resultOffers = resultOffers.filter(offer => {
      return typeof offer.discountPercent === 'number' && offer.discountPercent >= minDiscount;
    });
  }

  // 3. Sortieren
  return resultOffers.sort((a, b) => {
    switch (sortBy) {
      case 'refPrice': {
        // Primär nach standardisiertem Grundpreis sortieren
        const stdA = getStandardizedReferencePrice(a);
        const stdB = getStandardizedReferencePrice(b);
        if (stdA.baseUnit !== stdB.baseUnit) {
          return stdA.baseUnit.localeCompare(stdB.baseUnit, 'de');
        }
        if (stdA.pricePerBaseUnit !== stdB.pricePerBaseUnit) {
          return stdA.pricePerBaseUnit - stdB.pricePerBaseUnit;
        }
        // Bei gleichem Grundpreis gewinnt der absolute Endpreis
        return a.price - b.price;
      }

      case 'price':
        return a.price - b.price;

      case 'discount': {
        const discA = a.discountPercent || 0;
        const discB = b.discountPercent || 0;
        if (discB !== discA) {
          return discB - discA; // Höchster Rabatt zuerst
        }
        return a.price - b.price;
      }

      case 'validTo': {
        if (!a.validTo) return 1;
        if (!b.validTo) return -1;
        return new Date(a.validTo).getTime() - new Date(b.validTo).getTime();
      }

      case 'title':
        return (a.title || '').localeCompare(b.title || '', 'de');

      case 'retailer': {
        const retComp = (a.retailer || '').localeCompare(b.retailer || '', 'de');
        if (retComp !== 0) return retComp;
        return a.price - b.price;
      }

      default:
        return 0;
    }
  });
}

/**
 * Berechnet die Ersparnis für einen Artikel.
 * Findet Vergleichspreise über Streichpreis, Beschreibung oder Marktvergleiche (z. B. bei REWE).
 * Schützt vor unrealistischen Ausreißern.
 */
export function calculateItemSavings(item, referenceOffers = []) {
  if (!item || typeof item.price !== 'number' || item.price <= 0) {
    return { savings: 0, originalPrice: null, isEstimated: false };
  }

  // 1. Echter Streichpreis / UVP vorhanden (und plausibel!)
  const sanitizedDirect = item.isEstimatedOldPrice ? null
    : validateAndSanitizeOldPrice(item.price, item.oldPrice, item.isNonFood);
  if (sanitizedDirect && sanitizedDirect > item.price) {
    const savings = parseFloat((sanitizedDirect - item.price).toFixed(2));
    return {
      savings,
      originalPrice: sanitizedDirect,
      isEstimated: false,
      reason: 'Direkter Streichpreis / UVP',
    };
  }

  // 2. Streichpreis aus Beschreibung extrahieren (z. B. "UVP 2,99" oder "statt 2.49")
  if (item.description) {
    const matchUvp = item.description.match(/(?:uvp|statt|bisher|normalpreis)\s*[:]?\s*(\d+[.,]\d{2})/i);
    if (matchUvp) {
      const parsedOld = parseFloat(matchUvp[1].replace(',', '.'));
      const sanitizedDesc = validateAndSanitizeOldPrice(item.price, parsedOld, item.isNonFood);
      if (sanitizedDesc && sanitizedDesc > item.price) {
        return {
          savings: parseFloat((sanitizedDesc - item.price).toFixed(2)),
          originalPrice: sanitizedDesc,
          isEstimated: false,
          reason: 'Aus Beschreibung extrahiert',
        };
      }
    }
  }

  // 3. Current price at another retailer. This is a comparison, not a regular price.
  if (Array.isArray(referenceOffers) && referenceOffers.length > 0) {
    const normalizeTitle = title => String(title || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const cleanItemTitle = normalizeTitle(item.title);
    const itemPackage = extractPackageAmountAndUnit(item.packageSize, item.title, item.description);
    if (cleanItemTitle.length >= 4 && !/^(bio|frische|deutsches|speise|feine|echte|unsere)$/i.test(cleanItemTitle)) {
      const matches = referenceOffers.filter(o => {
        if (o.id === item.id || !o.retailer || o.retailer === item.retailer ||
          typeof o.price !== 'number' || o.price <= item.price || o.price / item.price > 2.2) return false;
        if (normalizeTitle(o.title) !== cleanItemTitle) return false;
        const otherPackage = extractPackageAmountAndUnit(o.packageSize, o.title, o.description);
        if (itemPackage || otherPackage) {
          if (!itemPackage || !otherPackage || itemPackage.baseUnit !== otherPackage.baseUnit ||
            Math.abs(itemPackage.baseAmount - otherPackage.baseAmount) > itemPackage.baseAmount * 0.01) return false;
        }
        return true;
      });

      if (matches.length > 0) {
        const closestOtherOffer = matches.sort((a, b) => a.price - b.price)[0];
        return {
          savings: parseFloat((closestOtherOffer.price - item.price).toFixed(2)),
          originalPrice: closestOtherOffer.price,
          isEstimated: true,
          comparisonRetailer: closestOtherOffer.retailer,
          reason: 'Aktuelles Angebot einer anderen Kette',
        };
      }
    }
  }

  return {
    savings: 0,
    originalPrice: item.price,
    isEstimated: false,
    reason: 'Kein verlässlicher Vergleichspreis',
  };
}

/**
 * Erkennt automatisch deutsches Einweg- und Mehrweg-Pfand für Getränke
 * (Dosen, PET-Einweg, Bierflaschen, Kästen)
 */
export function detectDeposit(item) {
  if (!item || !item.title) return 0;
  const text = `${item.title} ${item.description || ''} ${item.packageSize || ''}`.toLowerCase();

  // Nicht-Getränke ausschließen (z. B. Suppendosen, Tierfutter, Malerbedarf)
  if (/(suppe|ravioli|gulasch|eintopf|bohne|erbse|mais|thunfisch|tomat|tierfutter|hundefutter|katzenfutter|farbdose|lack)/i.test(text)) {
    return 0;
  }

  // 1. Getränkekästen / Kisten
  if (/\b(kasten|kiste)\b/i.test(text)) {
    if (/\bbügel/i.test(text)) return 4.50;
    if (/\b(wasser|mineralwasser|sprudel)\b/i.test(text)) return 3.30;
    return 3.10; // Standard Bierkasten (20x0.5l oder 24x0.33l)
  }

  // 2. Sixpack / Gebinde
  const sixMatch = text.match(/\b(?:6\s*[xX*]\s*0,[35]|sixpack|6er\s*träger)\b/i);
  if (sixMatch) {
    if (/\b(dose|dosen|can|energy|cola|pepsi)\b/i.test(text)) return 1.50; // 6x 0.25€
    return 0.48; // 6x 0.08€ Mehrweg-Bier
  }

  // 3. Joghurt/Milch im Mehrweg-Pfandglas (0,15 €)
  if (/\b(pfandglas|mehrwegglas)\b/i.test(text) || (/\bjoghurt\b/i.test(text) && /\bglas\b/i.test(text))) {
    return 0.15;
  }

  // 4. Einweg-Dosen (0,25 €)
  if (/\b(dose|dosen|can|energy|red bull|monster|rockstar|booster|dr pepper|coca[- ]cola|cola|pepsi|fanta|sprite|mezzo mix|schweppes)\b/i.test(text)) {
    return 0.25;
  }

  // 5. Einweg-PET-Flaschen (0,25 €)
  if (/\b(pet|einweg|volvic|vio|gerolsteiner.*pet|vittel)\b/i.test(text)) {
    return 0.25;
  }

  // 6. Bierflaschen (Mehrweg 0,08 € oder 0,15 €)
  if (/\b(bier|pils|pilsener|pilsner|weizen|helles|export|radler|kölsch|altbier|brauerei)\b/i.test(text) || /\bbügel/i.test(text)) {
    if (/\b(bügel|flensburger|mönchshof)/i.test(text)) {
      return 0.15;
    }
    // Einzelflasche Bier
    if (/\b(0,33|0,5|flasche)\b/i.test(text)) {
      return 0.08;
    }
    return 0.08;
  }

  // 7. Allgemeine Glasflaschen Mehrweg für Wasser / Saft (0,15 €)
  if (/\b(mehrweg|brunnen|quelle|mineralwasser|saft)\b/i.test(text) && /\bglas\b/i.test(text)) {
    return 0.15;
  }

  return 0;
}

/**
 * Berechnet Gesamtkosten, Gesamtersparnis, Pfand und detaillierte Ersparnis-Aufschlüsselung für einen Warenkorb
 */
export function calculateBasketTotals(basketItems = [], referenceOffers = []) {
  if (!Array.isArray(basketItems) || basketItems.length === 0) {
    return {
      totalPrice: 0,
      totalDeposit: 0,
      grandTotalWithDeposit: 0,
      totalSavings: 0,
      directSavings: 0,
      estimatedSavings: 0,
      totalOriginalPrice: 0,
      savingsPercent: 0,
      itemsBreakdown: [],
    };
  }

  let totalPrice = 0;
  let totalDeposit = 0;
  let directSavings = 0;
  let estimatedSavings = 0;
  let totalOriginalPrice = 0;
  const itemsBreakdown = [];

  for (const item of basketItems) {
    const qty = (typeof item.quantity === 'number' && item.quantity > 0) ? item.quantity : 1;
    const price = typeof item.price === 'number' ? item.price : parseFloat(item.price) || 0;
    const itemTotal = price * qty;
    totalPrice += itemTotal;

    const depositPerUnit = detectDeposit(item);
    const itemDeposit = depositPerUnit * qty;
    totalDeposit += itemDeposit;

    if (price > 0) {
      const res = calculateItemSavings(item, referenceOffers);
      const itemDirectSavings = res.isEstimated ? 0 : (res.savings * qty);
      const itemEstSavings = res.isEstimated ? (res.savings * qty) : 0;
      directSavings += itemDirectSavings;
      estimatedSavings += itemEstSavings;
      totalOriginalPrice += (price + (res.isEstimated ? 0 : res.savings)) * qty;

      itemsBreakdown.push({
        id: item.id,
        title: item.title,
        retailer: item.retailer,
        price,
        quantity: qty,
        itemTotal: parseFloat(itemTotal.toFixed(2)),
        depositPerUnit,
        itemDeposit: parseFloat(itemDeposit.toFixed(2)),
        originalPrice: res.originalPrice,
        savings: parseFloat(((res.isEstimated ? 0 : res.savings) * qty).toFixed(2)),
        comparisonDifference: res.isEstimated ? parseFloat((res.savings * qty).toFixed(2)) : 0,
        isEstimated: res.isEstimated,
        reason: res.reason,
      });
    }
  }

  const totalSavings = parseFloat(directSavings.toFixed(2));
  const savingsPercent = totalOriginalPrice > 0 ? Math.round((totalSavings / totalOriginalPrice) * 100) : 0;
  const grandTotalWithDeposit = parseFloat((totalPrice + totalDeposit).toFixed(2));

  return {
    totalPrice: parseFloat(totalPrice.toFixed(2)),
    totalDeposit: parseFloat(totalDeposit.toFixed(2)),
    grandTotalWithDeposit,
    totalSavings,
    directSavings: parseFloat(directSavings.toFixed(2)),
    estimatedSavings: parseFloat(estimatedSavings.toFixed(2)),
    totalOriginalPrice: parseFloat(totalOriginalPrice.toFixed(2)),
    savingsPercent,
    itemsBreakdown,
  };
}
