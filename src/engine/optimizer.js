/**
 * Einkaufslisten-Optimierer (Warenkorb-Split & Single-Store-Champion)
 * Berechnet die kostengünstigste Einkaufsstrategie für mehrere Artikel.
 */

import { filterAndSortOffers, getStandardizedReferencePrice, isGenuineSupermarket } from './comparator.js';

/**
 * Bereinigt einen Einkaufslisten-Eintrag für die Supermarkt-Suche
 * Entfernt Mengenangaben und Zubereitungsklauseln wie "zum Anbraten", "fein gewürfelt" etc.
 */
export function sanitizeItemForSearch(raw) {
  if (!raw) return '';
  let clean = String(raw).trim();

  // 1. Spezifische Plural-Klammern auflösen: Tomate(n) -> Tomaten, Knoblauchzehe(n) -> Knoblauch
  clean = clean.replace(/Tomatenmark/gi, '__TOMATENMARK__');
  clean = clean.replace(/Tomate\(n\)/gi, 'Tomaten');
  clean = clean.replace(/Lasagneplatte\(n\)/gi, 'Lasagneplatten');
  clean = clean.replace(/Knoblauchzehe\(n\)?/gi, 'Knoblauch');
  clean = clean.replace(/\(n\)/gi, 'n');
  clean = clean.replace(/\(s\)/gi, 's');
  clean = clean.replace(/[()]/g, ' ');

  // 2. Mengenangaben & Einheiten am Anfang entfernen (z. B. "2 EL", "500g", "0.5 Liter", "1 Zwiebel")
  clean = clean.replace(/^(\d+[.,]\d+|\d+)\s*(?:liter|litre|flaschen|flasche|gläser|glas|becher|dosen|dose|bund|packung|pckg|pkg|stück|stk|zehen|zehe|msp|prise|tl|el|kg|mg|ml|g|l)\b\s*/i, '');
  clean = clean.replace(/^(?:ca\.?|circa|etwas|ein|eine|einen)?\s*(\d+[.,]\d+|\d+)?\s*(?:liter|litre|flaschen|flasche|gläser|glas|becher|dosen|dose|bund|packung|pckg|pkg|stück|stk|zehen|zehe|msp|prise|tl|el|kg|mg|ml|g|l)\b\s*/i, '');
  clean = clean.replace(/^\d+\s+/, '');

  // 3. Koch- & Zubereitungsklauseln entfernen
  const prepPhrases = [
    /\b(zum|beim|fürs?|nach|aus|vom|im|in)\s+(anbraten|braten|kochen|backen|frittieren|grillen|verfeinern|servieren|garnieren|belieben|geschmack|bedarf|form|pfanne|topf)\b/gi,
    /\b(fein|grob|frisch|gehackt|gewürfelt|gerieben|gemahlen|geschnitten|zerlassen|flüssig|kalt|warm|trocken|geschält|geschälte|geschälten|passiert|passierte|passierten)\b/gi,
    /\b(etwas|ca\.?|circa|evtl\.?|eventuell|optional|nach bedarf|nach belieben)\b/gi,
    /\b(für die form|in der pfanne|im ofen|aus der dose|aus dem glas)\b/gi,
  ];

  for (const pattern of prepPhrases) {
    clean = clean.replace(pattern, ' ');
  }

  // Französische Akzente ersetzen (Crème fraîche -> Creme Fraiche), aber deutsche Umlaute (ä, ö, ü, ß) behalten!
  clean = clean
    .replace(/[éèêë]/gi, 'e')
    .replace(/[îï]/gi, 'i')
    .replace(/[àâ]/gi, 'a')
    .replace(/[ô]/gi, 'o')
    .replace(/[ç]/gi, 'c');

  clean = clean.replace(/__TOMATENMARK__/g, 'Tomatenmark');
  clean = clean.replace(/[,;.:\-_/]/g, ' ').replace(/\s+/g, ' ').trim();

  // 4. Spezifische Normalisierungen für typische Einkaufszettel-Begriffe
  const lower = clean.toLowerCase();
  if (lower === 'öl' || lower.includes('speiseöl') || lower.includes('pflanzenöl') || lower.includes('bratöl')) {
    return 'Öl';
  }
  if (lower.includes('olivenöl')) {
    return 'Olivenöl';
  }
  if (lower.includes('knoblauch')) {
    return 'Knoblauch';
  }
  if (lower.includes('tomatenmark')) {
    return 'Tomatenmark';
  }
  if (lower.includes('tomate')) {
    return 'Tomaten';
  }
  if (lower.includes('creme fraiche')) {
    return 'Creme Fraiche';
  }

  return clean || raw;
}

/**
 * Prüft strikt, ob ein gefundener Supermarkt-Artikel thematisch zur Suchanfrage passt.
 * Verhindert grobe Heuristik-Fehler wie "Tillman's Cevapcici" für die Suchanfrage "Öl zum anbraten".
 */
export function isOfferRelevantToQuery(query, offer) {
  if (!query || !offer || !offer.title) return false;
  const cleanQ = sanitizeItemForSearch(query).toLowerCase();
  const title = (offer.title || '').toLowerCase();

  // 1. Spezieller Schutz für Öl:
  if (cleanQ === 'öl' || cleanQ.includes('speiseöl') || cleanQ.includes('pflanzenöl') || cleanQ.includes('bratöl')) {
    if (/\b(cevapcici|hack|hackfleisch|steak|schnitzel|wurst|bratwurst|braten|fleisch|fisch|lachs|pizza|käse|chips)\b/i.test(title)) {
      return false;
    }
    // Muss ein echtes Speiseöl im Titel sein
    if (!/\b(öl|oel|olivenöl|rapsöl|sonnenblumenöl|leinöl|bratöl|frittieröl|distelöl|kokosöl|sesamöl)\b/i.test(title)) {
      return false;
    }
  }

  // 2. Spezieller Schutz für Essig:
  if (cleanQ === 'essig' || cleanQ.includes('balsamico')) {
    if (!/\b(essig|balsamico|aceto)\b/i.test(title)) return false;
  }

  // 3. Spezieller Schutz für Butter:
  if (cleanQ === 'butter') {
    if (/\b(erdnussbutter|kräuterbutter|buttermilch)\b/i.test(title)) return false;
    if (!/\b(butter|margarine|streichzart)\b/i.test(title)) return false;
  }

  // 4. Spezieller Schutz für Milch: Schokolade, Milchreis, Dessert ausschließen
  if (cleanQ === 'milch' || cleanQ === 'frische milch' || cleanQ === 'vollmilch') {
    if (/\b(milchreis|milch-reis|milchschnitte|milch-schnitte|milchmädchen|schokolade|riegel|eis|joghurt|dessert|pudding)\b/i.test(title)) {
      return false;
    }
  }

  // 5. Allgemeiner Token-Abgleich: Mindestens ein Wort aus cleanQ muss im Titel vorkommen
  const qWords = cleanQ.split(/\s+/).filter(w => w.length >= 3);
  if (qWords.length > 0) {
    const hasWordMatch = qWords.some(w => title.includes(w));
    if (!hasWordMatch) return false;
  }

  return true;
}

/**
 * Wählt das beste Angebot für eine Suchanfrage bei einem bestimmten Händler aus
 */
function getBestOfferForStore(offers, storeName, options = {}, query = '') {
  const { preferReferencePrice = true, excludeAppOnly = false } = options;

  let relevantOffers = offers;
  if (query) {
    relevantOffers = offers.filter(o => isOfferRelevantToQuery(query, o));
  }

  const storeOffers = filterAndSortOffers(relevantOffers, {
    retailers: [storeName],
    excludeAppOnly,
    sortBy: preferReferencePrice ? 'refPrice' : 'price',
    validNowOnly: true,
  });

  return storeOffers.length > 0 ? storeOffers[0] : null;
}

/**
 * Ermittelt bis zu 3 beste alternative Angebote für einen Artikel
 * Bevorzugt Händlervielfalt und unterschiedliche Produkte/Marken.
 */
export function getTopAlternativesForItem(query, allOffers, chosenOffer = null, options = {}) {
  if (!Array.isArray(allOffers) || allOffers.length === 0) return [];

  const allowedClean = (Array.isArray(options.retailers) ? options.retailers : [options.retailers || []])
    .map(r => String(r).toLowerCase().trim())
    .filter(Boolean);

  const relevant = allOffers.filter(o => {
    if (!o || !o.title) return false;
    if (chosenOffer && o.id && o.id === chosenOffer.id) return false;
    if (!isGenuineSupermarket(o.retailer)) return false;
    if (!isOfferRelevantToQuery(query, o)) return false;
    if (options.excludeAppOnly && o.requiresApp) return false;

    if (allowedClean.length > 0) {
      const retLower = (o.retailer || '').toLowerCase();
      const isAllowed = allowedClean.some(al => retLower.includes(al) || al.includes(retLower));
      if (!isAllowed) return false;
    }
    return true;
  });

  const sorted = filterAndSortOffers(relevant, {
    sortBy: options.preferReferencePrice ? 'refPrice' : 'price',
    strictSupermarketOnly: true,
    validNowOnly: true,
  });

  const alternatives = [];
  const seenStores = new Set();
  if (chosenOffer && chosenOffer.retailer) {
    seenStores.add(chosenOffer.retailer.toLowerCase());
  }
  const seenTitles = new Set();
  if (chosenOffer && chosenOffer.title) {
    seenTitles.add(chosenOffer.title.toLowerCase().trim());
  }

  // Pass 1: Bevorzuge Angebote von anderen Händlern (Händlervielfalt)
  for (const o of sorted) {
    const storeKey = (o.retailer || '').toLowerCase();
    const titleKey = (o.title || '').toLowerCase().trim();
    if (!seenStores.has(storeKey) && !seenTitles.has(titleKey)) {
      alternatives.push(o);
      seenStores.add(storeKey);
      seenTitles.add(titleKey);
      if (alternatives.length >= 3) break;
    }
  }

  // Pass 2: Falls weniger als 3, mit weiteren Top-Angeboten auffüllen (z. B. andere Marke im selben Markt)
  if (alternatives.length < 3) {
    for (const o of sorted) {
      const titleKey = (o.title || '').toLowerCase().trim();
      if (!alternatives.some(a => a.id === o.id) && !seenTitles.has(titleKey)) {
        alternatives.push(o);
        seenTitles.add(titleKey);
        if (alternatives.length >= 3) break;
      }
    }
  }

  return alternatives.slice(0, 3);
}

/**
 * Analysiert die Angebote für jeden Händler über alle Suchanfragen
 */
export function analyzeStoreCoverage(itemQueries, itemResultsMap, options = {}) {
  // itemResultsMap: { [query]: normalizedOffers[] }
  const { retailers = [] } = options;
  const allowedClean = (Array.isArray(retailers) ? retailers : [retailers])
    .map(r => String(r).toLowerCase().trim())
    .filter(Boolean);

  const allRetailers = new Set();

  for (const query of itemQueries) {
    const offers = itemResultsMap[query] || [];
    for (const offer of offers) {
      if (offer.retailer && isGenuineSupermarket(offer.retailer)) {
        if (allowedClean.length > 0) {
          const retLower = offer.retailer.toLowerCase();
          const isAllowed = allowedClean.some(al => retLower.includes(al) || al.includes(retLower));
          if (!isAllowed) continue;
        }
        allRetailers.add(offer.retailer);
      }
    }
  }

  const storeSummaries = [];

  for (const store of allRetailers) {
    const matchedItems = [];
    const missingItems = [];
    let totalPrice = 0;
    let totalSavings = 0;

    for (const query of itemQueries) {
      const offers = itemResultsMap[query] || [];
      const best = getBestOfferForStore(offers, store, options, query);

      if (best) {
        const alternatives = getTopAlternativesForItem(query, offers, best, options);
        matchedItems.push({
          query,
          offer: best,
          alternatives,
        });
        totalPrice += best.price;
        if (best.oldPrice && best.oldPrice > best.price) {
          totalSavings += (best.oldPrice - best.price);
        }
      } else {
        missingItems.push(query);
      }
    }

    storeSummaries.push({
      retailer: store,
      matchedCount: matchedItems.length,
      missingCount: missingItems.length,
      matchedItems,
      missingItems,
      totalPrice: parseFloat(totalPrice.toFixed(2)),
      totalSavings: parseFloat(totalSavings.toFixed(2)),
      coveragePercent: Math.round((matchedItems.length / itemQueries.length) * 100),
    });
  }

  // Sortierung: Zuerst nach meiste Treffer, dann nach niedrigstem Korbpreis
  return storeSummaries.sort((a, b) => {
    if (b.matchedCount !== a.matchedCount) {
      return b.matchedCount - a.matchedCount;
    }
    return a.totalPrice - b.totalPrice;
  });
}

/**
 * Berechnet den Single-Store Champion (Bester Einzelladen)
 */
export function calculateSingleStoreChampion(itemQueries, storeSummaries) {
  if (!storeSummaries || storeSummaries.length === 0) {
    return null;
  }
  return storeSummaries[0];
}

/**
 * Berechnet den Smart Split (Optimale Kombination aus 2 Supermärkten)
 */
export function calculateSmartSplit(itemQueries, itemResultsMap, storeSummaries, options = {}) {
  if (!storeSummaries || storeSummaries.length < 2) {
    return null;
  }

  // Wir testen alle 2er-Kombinationen der Top-Händler (begrenzt auf Top 8 zur Performance-Optimierung)
  const candidateStores = storeSummaries.slice(0, 8).map(s => s.retailer);
  let bestSplit = null;

  for (let i = 0; i < candidateStores.length; i++) {
    for (let j = i + 1; j < candidateStores.length; j++) {
      const storeA = candidateStores[i];
      const storeB = candidateStores[j];

      const splitAllocation = {
        [storeA]: [],
        [storeB]: [],
      };
      const missingItems = [];
      let totalSplitPrice = 0;
      let totalSavings = 0;

      for (const query of itemQueries) {
        const offers = itemResultsMap[query] || [];
        const offerA = getBestOfferForStore(offers, storeA, options, query);
        const offerB = getBestOfferForStore(offers, storeB, options, query);

        if (!offerA && !offerB) {
          missingItems.push(query);
          continue;
        }

        // Entscheide welcher Laden günstiger ist
        let chosenStore = null;
        let chosenOffer = null;

        if (offerA && offerB) {
          const compA = options.preferReferencePrice
            ? getStandardizedReferencePrice(offerA).pricePerBaseUnit
            : offerA.price;
          const compB = options.preferReferencePrice
            ? getStandardizedReferencePrice(offerB).pricePerBaseUnit
            : offerB.price;

          if (compA <= compB) {
            chosenStore = storeA;
            chosenOffer = offerA;
          } else {
            chosenStore = storeB;
            chosenOffer = offerB;
          }
        } else if (offerA) {
          chosenStore = storeA;
          chosenOffer = offerA;
        } else {
          chosenStore = storeB;
          chosenOffer = offerB;
        }

        const alternatives = getTopAlternativesForItem(query, offers, chosenOffer, options);

        splitAllocation[chosenStore].push({
          query,
          offer: chosenOffer,
          alternatives,
        });

        totalSplitPrice += chosenOffer.price;
        if (chosenOffer.oldPrice && chosenOffer.oldPrice > chosenOffer.price) {
          totalSavings += (chosenOffer.oldPrice - chosenOffer.price);
        }
      }

      const totalMatched = splitAllocation[storeA].length + splitAllocation[storeB].length;
      const coveragePercent = Math.round((totalMatched / itemQueries.length) * 100);

      // Treffer für fehlende Artikel bei anderen aktiven Märkten sammeln (damit kein Artikel verloren geht!)
      const otherStoreMatches = [];
      for (const mQuery of missingItems) {
        const mOffers = itemResultsMap[mQuery] || [];
        const altBest = getTopAlternativesForItem(mQuery, mOffers, null, options);
        if (altBest.length > 0) {
          otherStoreMatches.push({
            query: mQuery,
            offer: altBest[0],
            alternatives: altBest.slice(1, 4),
          });
        }
      }

      const splitCandidate = {
        stores: [storeA, storeB],
        allocations: {
          [storeA]: {
            items: splitAllocation[storeA],
            subtotal: parseFloat(
              splitAllocation[storeA].reduce((sum, item) => sum + item.offer.price, 0).toFixed(2)
            ),
          },
          [storeB]: {
            items: splitAllocation[storeB],
            subtotal: parseFloat(
              splitAllocation[storeB].reduce((sum, item) => sum + item.offer.price, 0).toFixed(2)
            ),
          },
        },
        otherStoreMatches,
        matchedCount: totalMatched,
        missingCount: missingItems.length,
        missingItems,
        totalPrice: parseFloat(totalSplitPrice.toFixed(2)),
        totalSavings: parseFloat(totalSavings.toFixed(2)),
        coveragePercent,
      };

      // Bewertungsfunktion: Maximale Abdeckung, danach minimaler Gesamtpreis
      if (
        !bestSplit ||
        splitCandidate.matchedCount > bestSplit.matchedCount ||
        (splitCandidate.matchedCount === bestSplit.matchedCount &&
          splitCandidate.totalPrice < bestSplit.totalPrice)
      ) {
        bestSplit = splitCandidate;
      }
    }
  }

  return bestSplit;
}

/**
 * Hauptfunktion zur Optimierung des gesamten Einkaufs
 */
export function optimizeBasket(itemQueries, itemResultsMap, options = {}) {
  const storeSummaries = analyzeStoreCoverage(itemQueries, itemResultsMap, options);
  const singleStoreChampion = calculateSingleStoreChampion(itemQueries, storeSummaries);
  const smartSplit = calculateSmartSplit(itemQueries, itemResultsMap, storeSummaries, options);

  // Bestes Angebot je Artikel über alle aktiven Supermärkte
  const bestPerItem = [];
  for (const query of itemQueries) {
    const offers = itemResultsMap[query] || [];
    const topOffers = getTopAlternativesForItem(query, offers, null, options);
    if (topOffers.length > 0) {
      bestPerItem.push({
        query,
        offer: topOffers[0],
        alternatives: topOffers.slice(1, 4),
      });
    }
  }

  let splitSavingsVsSingle = 0;
  if (singleStoreChampion && smartSplit && smartSplit.totalPrice < singleStoreChampion.totalPrice) {
    splitSavingsVsSingle = parseFloat((singleStoreChampion.totalPrice - smartSplit.totalPrice).toFixed(2));
  }

  return {
    itemQueries,
    totalItemsRequested: itemQueries.length,
    singleStoreChampion,
    smartSplit,
    bestPerItem,
    splitSavingsVsSingle,
    allStores: storeSummaries,
  };
}
