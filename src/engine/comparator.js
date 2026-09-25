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
 * Standardisiert den Grundpreis auf Basiseinheiten (kg, l, Stück),
 * falls abweichende Einheiten wie g oder ml angegeben sind.
 */
export function getStandardizedReferencePrice(offer) {
  if (!offer || typeof offer.referencePrice !== 'number' || isNaN(offer.referencePrice)) {
    // Wenn kein Grundpreis vorhanden ist, nutzen wir den Endpreis als Fallback
    return {
      pricePerBaseUnit: typeof offer?.price === 'number' ? offer.price : Infinity,
      baseUnit: offer?.referenceUnit || 'Stück',
      isEstimated: true,
    };
  }

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
    pricePerBaseUnit: offer.referencePrice * factor,
    baseUnit: baseUnit || 'Einheit',
    isEstimated: false,
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
 * Filtert und sortiert eine Liste von normalisierten Angeboten
 */
export function filterAndSortOffers(offers, options = {}) {
  if (!Array.isArray(offers)) return [];

  const {
    sortBy = 'refPrice', // 'refPrice' | 'price' | 'discount' | 'validTo' | 'title'
    retailers = [],       // z. B. ['Lidl', 'Aldi', 'Rewe']
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

  const retailerFilters = (Array.isArray(retailers) ? retailers : [retailers])
    .map(r => String(r).toLowerCase().trim())
    .filter(Boolean);

  const cleanFavs = (Array.isArray(favoriteKeywords) ? favoriteKeywords : [favoriteKeywords])
    .map(f => String(f).toLowerCase().trim())
    .filter(Boolean);

  // 1. Filtern
  const filtered = offers.filter(offer => {
    // Händlerfilter
    if (retailerFilters.length > 0) {
      const offerRetailer = (offer.retailer || '').toLowerCase();
      const offerSlug = (offer.retailerSlug || '').toLowerCase();
      const matches = retailerFilters.some(
        filter => offerRetailer.includes(filter) || offerSlug.includes(filter)
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

    // Mindestrabatt
    if (typeof minDiscount === 'number') {
      if (!offer.discountPercent || offer.discountPercent < minDiscount) {
        return false;
      }
    }

    return true;
  });

  // 2. Preis-Konsistenz: Jedes Angebot mit vollständigen, validierten Preis- und Sparangaben anreichern
  const enriched = filtered.map(offer => {
    const catInfo = classifyOffer(offer);
    let oldPrice = validateAndSanitizeOldPrice(offer.price, offer.oldPrice, offer.isNonFood);
    let isEstimatedOldPrice = false;

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
      }
    }

    let discountPercent = offer.discountPercent;
    let savings = null;
    let formattedOldPrice = null;
    let savingsFormatted = null;

    if (oldPrice && oldPrice > offer.price) {
      savings = parseFloat((oldPrice - offer.price).toFixed(2));
      formattedOldPrice = `${oldPrice.toFixed(2).replace('.', ',')} €`;
      savingsFormatted = `${savings.toFixed(2).replace('.', ',')} €`;
      if (!discountPercent) {
        discountPercent = Math.round(((oldPrice - offer.price) / oldPrice) * 100);
      }
    }

    return {
      ...offer,
      oldPrice,
      formattedOldPrice,
      isEstimatedOldPrice,
      discountPercent,
      savings,
      savingsFormatted,
      categoryId: catInfo.categoryId,
      categoryLabel: catInfo.categoryLabel,
      categoryIcon: catInfo.categoryIcon,
    };
  });

  // 3. Sortieren
  return enriched.sort((a, b) => {
    switch (sortBy) {
      case 'refPrice': {
        // Primär nach standardisiertem Grundpreis sortieren
        const stdA = getStandardizedReferencePrice(a);
        const stdB = getStandardizedReferencePrice(b);
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
  const sanitizedDirect = validateAndSanitizeOldPrice(item.price, item.oldPrice, item.isNonFood);
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

  // 3. Marktpreis-Vergleich NUR bei echter Produktgleichheit
  // Bereinigt generische Ketten-Präfixe wie "thisisnobrand123", "Lidl Backshop", "Ja!", "Gut & Günstig"
  if (Array.isArray(referenceOffers) && referenceOffers.length > 0) {
    const cleanItemTitle = (item.title || '')
      .replace(/^(thisisnobrand123|lidl backshop|k-classic|gut & günstig|gut und günstig|ja!|edeka bio|rewe beste wahl|rewe bio|milbona)\s*/i, '')
      .trim()
      .toLowerCase();

    // Nur suchen, wenn der bereinigte Name mindestens 4 Zeichen hat und kein Stopwort ist
    if (cleanItemTitle.length >= 4 && !/^(bio|frische|deutsches|speise|feine|echte|unsere)$/i.test(cleanItemTitle)) {
      const matches = referenceOffers.filter(o => {
        if (o.id === item.id || typeof o.price !== 'number' || o.price <= item.price) return false;
        const cleanOTitle = (o.title || '')
          .replace(/^(thisisnobrand123|lidl backshop|k-classic|gut & günstig|gut und günstig|ja!|edeka bio|rewe beste wahl|rewe bio|milbona)\s*/i, '')
          .trim()
          .toLowerCase();

        const isMatch = (cleanOTitle.includes(cleanItemTitle) || cleanItemTitle.includes(cleanOTitle)) && cleanOTitle.length >= 4;
        if (!isMatch) return false;

        // Plausibilität: Vergleichsangebot darf max. 2.2x so teuer sein (keine Packung vs. Kiste)
        return (o.price / item.price) <= 2.2;
      });

      if (matches.length > 0) {
        const candidatePrices = matches
          .map(m => validateAndSanitizeOldPrice(item.price, m.oldPrice, item.isNonFood) || m.price)
          .filter(p => p > item.price && (p / item.price) <= 2.2);

        if (candidatePrices.length > 0) {
          const maxMarketPrice = parseFloat(Math.max(...candidatePrices).toFixed(2));
          return {
            savings: parseFloat((maxMarketPrice - item.price).toFixed(2)),
            originalPrice: maxMarketPrice,
            isEstimated: true,
            reason: 'Vergleich mit Marktpreis',
          };
        }
      }
    }
  }

  // 4. Konservative Marktschätzung für Aktionspreise (~20-25% unter Normalpreis)
  const estimatedOriginal = parseFloat((item.price * 1.25).toFixed(2));
  const estimatedSavings = parseFloat((estimatedOriginal - item.price).toFixed(2));

  return {
    savings: estimatedSavings,
    originalPrice: estimatedOriginal,
    isEstimated: true,
    reason: 'Geschätzter Normalpreis (~20% Ersparnis)',
  };
}

/**
 * Berechnet Gesamtkosten, Gesamtersparnis und detaillierte Ersparnis-Aufschlüsselung für einen Warenkorb
 */
export function calculateBasketTotals(basketItems = [], referenceOffers = []) {
  if (!Array.isArray(basketItems) || basketItems.length === 0) {
    return {
      totalPrice: 0,
      totalSavings: 0,
      directSavings: 0,
      estimatedSavings: 0,
      totalOriginalPrice: 0,
      savingsPercent: 0,
      itemsBreakdown: [],
    };
  }

  let totalPrice = 0;
  let directSavings = 0;
  let estimatedSavings = 0;
  let totalOriginalPrice = 0;
  const itemsBreakdown = [];

  for (const item of basketItems) {
    const price = typeof item.price === 'number' ? item.price : parseFloat(item.price) || 0;
    totalPrice += price;

    if (price > 0) {
      const res = calculateItemSavings(item, referenceOffers);
      if (res.isEstimated) {
        estimatedSavings += res.savings;
      } else {
        directSavings += res.savings;
      }
      totalOriginalPrice += (res.originalPrice || price);

      itemsBreakdown.push({
        id: item.id,
        title: item.title,
        retailer: item.retailer,
        price,
        originalPrice: res.originalPrice,
        savings: res.savings,
        isEstimated: res.isEstimated,
        reason: res.reason,
      });
    }
  }

  const totalSavings = parseFloat((directSavings + estimatedSavings).toFixed(2));
  const savingsPercent = totalOriginalPrice > 0 ? Math.round((totalSavings / totalOriginalPrice) * 100) : 0;

  return {
    totalPrice: parseFloat(totalPrice.toFixed(2)),
    totalSavings,
    directSavings: parseFloat(directSavings.toFixed(2)),
    estimatedSavings: parseFloat(estimatedSavings.toFixed(2)),
    totalOriginalPrice: parseFloat(totalOriginalPrice.toFixed(2)),
    savingsPercent,
    itemsBreakdown,
  };
}
