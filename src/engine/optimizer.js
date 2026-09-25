/**
 * Einkaufslisten-Optimierer (Warenkorb-Split & Single-Store-Champion)
 * Berechnet die kostengünstigste Einkaufsstrategie für mehrere Artikel.
 */

import { filterAndSortOffers, getStandardizedReferencePrice } from './comparator.js';

/**
 * Wählt das beste Angebot für eine Suchanfrage bei einem bestimmten Händler aus
 */
function getBestOfferForStore(offers, storeName, options = {}) {
  const { preferReferencePrice = true, excludeAppOnly = false } = options;

  const storeOffers = filterAndSortOffers(offers, {
    retailers: [storeName],
    excludeAppOnly,
    sortBy: preferReferencePrice ? 'refPrice' : 'price',
    validNowOnly: true,
  });

  return storeOffers.length > 0 ? storeOffers[0] : null;
}

/**
 * Analysiert die Angebote für jeden Händler über alle Suchanfragen
 */
export function analyzeStoreCoverage(itemQueries, itemResultsMap, options = {}) {
  // itemResultsMap: { [query]: normalizedOffers[] }
  const allRetailers = new Set();

  for (const query of itemQueries) {
    const offers = itemResultsMap[query] || [];
    for (const offer of offers) {
      if (offer.retailer) {
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
      const best = getBestOfferForStore(offers, store, options);

      if (best) {
        matchedItems.push({
          query,
          offer: best,
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
        const offerA = getBestOfferForStore(offers, storeA, options);
        const offerB = getBestOfferForStore(offers, storeB, options);

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

        splitAllocation[chosenStore].push({
          query,
          offer: chosenOffer,
        });

        totalSplitPrice += chosenOffer.price;
        if (chosenOffer.oldPrice && chosenOffer.oldPrice > chosenOffer.price) {
          totalSavings += (chosenOffer.oldPrice - chosenOffer.price);
        }
      }

      const totalMatched = splitAllocation[storeA].length + splitAllocation[storeB].length;
      const coveragePercent = Math.round((totalMatched / itemQueries.length) * 100);

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

  let splitSavingsVsSingle = 0;
  if (singleStoreChampion && smartSplit && smartSplit.totalPrice < singleStoreChampion.totalPrice) {
    splitSavingsVsSingle = parseFloat((singleStoreChampion.totalPrice - smartSplit.totalPrice).toFixed(2));
  }

  return {
    itemQueries,
    totalItemsRequested: itemQueries.length,
    singleStoreChampion,
    smartSplit,
    splitSavingsVsSingle,
    allStores: storeSummaries,
  };
}
