/**
 * SparFuchs – Frontend Application Logic
 * Verwaltet Suche, Filterung, Bio/Non-Food Tags, Favoriten und nach Supermarkt gruppierten Einkaufszettel.
 */

// Global State
const state = {
  query: '',
  zip: localStorage.getItem('sparfuchs_zip') || '10115',
  sortBy: 'refPrice',
  retailer: 'all',
  excludeAppOnly: false,
  validNowOnly: true,
  onlyBio: false,
  onlyFood: false,
  onlyNonFood: false,
  onlyFavorites: false,
  viewMode: 'grid', // 'grid' | 'table'
  category: 'all',
  availableCategories: [],
  // Basket stores items with retailer & price: [{ id, title, retailer, price, formattedPrice, checked }]
  basket: JSON.parse(localStorage.getItem('sparfuchs_basket_v2') || '[]'),
  // Favorites store array of strings / keywords
  favorites: JSON.parse(localStorage.getItem('sparfuchs_favorites') || '[]'),
  // Shopping list history & household stats
  history: JSON.parse(localStorage.getItem('sparfuchs_history') || '[]'),
  householdStats: null,
  offers: [],
  isLoading: false,
};

/**
 * Validiert und bereinigt Altpreise / Streichpreise auf dem Client.
 * Verhindert, dass fehlerhafte API-Daten oder Ausreißer unrealistische Ersparnisse erzeugen.
 */
function validateAndSanitizeClientPrice(price, oldPrice, isNonFood = false) {
  if (typeof price !== 'number' || price <= 0) return null;
  if (typeof oldPrice !== 'number' || isNaN(oldPrice) || oldPrice <= price) return null;

  // Maximaler realistischer Faktor (Lebensmittel: 2.3x, Non-Food: 3.0x)
  const maxRatio = isNonFood ? 3.0 : 2.3;
  if ((oldPrice / price) > maxRatio) return null;

  // Schutz bei Kleinstpreisen unter 1 Euro
  if (price < 1.00 && (oldPrice - price) > 1.25) return null;

  return parseFloat(oldPrice.toFixed(2));
}

// DOM Elements
const elements = {
  plzInput: document.getElementById('plzInput'),
  plzUpdateBtn: document.getElementById('plzUpdateBtn'),
  allOffersTag: document.getElementById('allOffersTag'),
  favQuickBtn: document.getElementById('favQuickBtn'),
  favCountBadge: document.getElementById('favCountBadge'),
  favoritesSearchTag: document.getElementById('favoritesSearchTag'),
  openHistoryBtn: document.getElementById('openHistoryBtn'),
  closeHistoryBtn: document.getElementById('closeHistoryBtn'),
  historyDrawer: document.getElementById('historyDrawer'),
  historyCountBadge: document.getElementById('historyCountBadge'),
  bookBasketBtn: document.getElementById('bookBasketBtn'),
  clearHistoryBtn: document.getElementById('clearHistoryBtn'),
  kpiTotalSavings: document.getElementById('kpiTotalSavings'),
  kpiSavingsPct: document.getElementById('kpiSavingsPct'),
  kpiTotalSpent: document.getElementById('kpiTotalSpent'),
  kpiTotalRegular: document.getElementById('kpiTotalRegular'),
  kpiAvgSpent: document.getElementById('kpiAvgSpent'),
  kpiAvgSavings: document.getElementById('kpiAvgSavings'),
  kpiReceiptCount: document.getElementById('kpiReceiptCount'),
  kpiItemCount: document.getElementById('kpiItemCount'),
  historyStoreBarsContainer: document.getElementById('historyStoreBarsContainer'),
  historyMonthlyContainer: document.getElementById('historyMonthlyContainer'),
  receiptsListContainer: document.getElementById('receiptsListContainer'),
  basketPlzDisplay: document.getElementById('basketPlzDisplay'),
  openBasketBtn: document.getElementById('openBasketBtn'),
  closeBasketBtn: document.getElementById('closeBasketBtn'),
  mobileBasketFab: document.getElementById('mobileBasketFab'),
  mobileBasketBadge: document.getElementById('mobileBasketBadge'),
  basketDrawer: document.getElementById('basketDrawer'),
  drawerBackdrop: document.getElementById('drawerBackdrop'),
  basketCountBadge: document.getElementById('basketCountBadge'),
  basketItemInput: document.getElementById('basketItemInput'),
  basketAddForm: document.getElementById('basketAddForm'),
  basketGroupedContainer: document.getElementById('basketGroupedContainer'),
  basketTotalBar: document.getElementById('basketTotalBar'),
  basketGrandTotal: document.getElementById('basketGrandTotal'),
  basketSavingsRow: document.getElementById('basketSavingsRow'),
  basketTotalSavings: document.getElementById('basketTotalSavings'),
  basketSavingsPercentBadge: document.getElementById('basketSavingsPercentBadge'),
  basketSavingsNote: document.getElementById('basketSavingsNote'),
  optimizeBasketBtn: document.getElementById('optimizeBasketBtn'),
  optimizationResultContainer: document.getElementById('optimizationResultContainer'),
  searchForm: document.getElementById('searchForm'),
  searchInput: document.getElementById('searchInput'),
  clearSearchBtn: document.getElementById('clearSearchBtn'),
  quickTagsContainer: document.getElementById('quickTagsContainer'),
  categoryChips: document.getElementById('categoryChips'),
  sortBySelect: document.getElementById('sortBySelect'),
  toggleFoodFilterBtn: document.getElementById('toggleFoodFilterBtn'),
  toggleBioFilterBtn: document.getElementById('toggleBioFilterBtn'),
  toggleNonFoodFilterBtn: document.getElementById('toggleNonFoodFilterBtn'),
  toggleFavFilterBtn: document.getElementById('toggleFavFilterBtn'),
  excludeAppOnlyToggle: document.getElementById('excludeAppOnlyToggle'),
  validNowOnlyToggle: document.getElementById('validNowOnlyToggle'),
  retailerChipsContainer: document.getElementById('retailerChipsContainer'),
  viewGridBtn: document.getElementById('viewGridBtn'),
  viewTableBtn: document.getElementById('viewTableBtn'),
  resultsTitle: document.getElementById('resultsTitle'),
  resultsCount: document.getElementById('resultsCount'),
  activeTagPills: document.getElementById('activeTagPills'),
  loadingSpinner: document.getElementById('loadingSpinner'),
  emptyState: document.getElementById('emptyState'),
  emptyStateText: document.getElementById('emptyStateText'),
  offersGrid: document.getElementById('offersGrid'),
  offersTableContainer: document.getElementById('offersTableContainer'),
  offersTableBody: document.getElementById('offersTableBody'),
  toast: document.getElementById('toast'),
};

/**
 * Toast Benachrichtigung anzeigen
 */
function showToast(message) {
  if (!elements.toast) return;
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  setTimeout(() => {
    elements.toast.classList.remove('show');
  }, 2600);
}

/**
 * Formatiert ein ISO-Datum leserlich (z.B. "Sa, 26.09.")
 */
function formatShortDate(isoString) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    const days = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
    const dayName = days[d.getDay()];
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${dayName}, ${day}.${month}.`;
  } catch (e) {
    return '';
  }
}

/**
 * Prüft, ob ein Angebot in den Favoriten gespeichert ist
 */
function isFavorite(title, brand) {
  const text = `${title || ''} ${brand || ''}`.toLowerCase();
  return state.favorites.some(fav => text.includes(fav.toLowerCase()));
}

/**
 * Fügt ein Angebot zu den Favoriten hinzu oder entfernt es
 */
function toggleFavorite(title) {
  if (!title) return;
  const clean = title.trim();
  const idx = state.favorites.findIndex(f => f.toLowerCase() === clean.toLowerCase());

  if (idx !== -1) {
    state.favorites.splice(idx, 1);
    showToast(`⭐ "${clean}" aus Favoriten entfernt`);
  } else {
    state.favorites.push(clean);
    showToast(`⭐ "${clean}" zu Favoriten hinzugefügt!`);
  }

  saveFavorites();
  renderFavoritesBadge();
  renderOffers(state.offers);
}

function saveFavorites() {
  localStorage.setItem('sparfuchs_favorites', JSON.stringify(state.favorites));
}

function renderFavoritesBadge() {
  if (elements.favCountBadge) {
    elements.favCountBadge.textContent = state.favorites.length;
  }
}

/**
 * Aktualisiert die aktiven Tag-Pills im Header
 */
function updateActiveTagPills() {
  const container = elements.activeTagPills;
  if (!container) return;

  const pills = [];

  if (state.category && state.category !== 'all') {
    const catObj = (state.availableCategories || []).find(c => c.id === state.category);
    const catLabel = catObj ? `${catObj.icon} ${catObj.title}` : state.category;
    pills.push(`<span class="tag-pill category-pill">${catLabel} <button type="button" class="btn-pill-remove" id="removeCategoryFilterBtn" title="Kategorie-Filter entfernen">✕</button></span>`);
  }

  if (state.onlyFood) pills.push('<span class="tag-pill food">🍎 Nur Lebensmittel</span>');
  if (state.onlyBio) pills.push('<span class="tag-pill bio">🌱 Nur Bio</span>');
  if (state.onlyNonFood) pills.push('<span class="tag-pill nonfood">📦 Nicht-Lebensmittel</span>');
  if (state.onlyFavorites) pills.push('<span class="tag-pill fav">⭐ Favoriten</span>');

  container.innerHTML = pills.join('');

  const removeCatBtn = document.getElementById('removeCategoryFilterBtn');
  if (removeCatBtn) {
    removeCatBtn.addEventListener('click', () => {
      state.category = 'all';
      if (elements.categoryChips) {
        elements.categoryChips.querySelectorAll('.category-chip').forEach(c => {
          c.classList.toggle('active', c.getAttribute('data-id') === 'all');
        });
      }
      fetchOffers();
    });
  }
}

/**
 * Holt Angebote vom Backend Server (unterstützt auch leere Suche für "Alle Angebote")
 */
async function fetchOffers() {
  state.isLoading = true;
  elements.loadingSpinner.style.display = 'block';
  elements.emptyState.style.display = 'none';
  elements.offersGrid.innerHTML = '';
  elements.offersTableBody.innerHTML = '';
  updateActiveTagPills();

  try {
    const params = new URLSearchParams({
      q: state.query,
      zip: state.zip,
      sortBy: state.sortBy,
      category: state.category || 'all',
      excludeAppOnly: String(state.excludeAppOnly),
      validNowOnly: String(state.validNowOnly),
      onlyBio: String(state.onlyBio),
      onlyFood: String(state.onlyFood),
      onlyNonFood: String(state.onlyNonFood),
      onlyFavorites: String(state.onlyFavorites),
      favs: state.favorites.join(','),
    });

    if (state.retailer !== 'all') {
      params.append('retailers', state.retailer);
    }

    const response = await fetch(`/api/offers?${params.toString()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    state.offers = data.offers || [];

    const catObj = (state.availableCategories || []).find(c => c.id === state.category);
    const catLabel = catObj && catObj.id !== 'all' ? `${catObj.icon} ${catObj.title}` : null;

    let titleText = `Angebote für "${state.query}"`;
    if (!state.query) {
      if (catLabel) {
        titleText = `${catLabel} – Alle aktuellen Angebote`;
      } else if (state.retailer !== 'all') {
        titleText = `🌟 Alle aktuellen Angebote von ${state.retailer}`;
      } else {
        titleText = `🌟 Alle aktuellen Angebote (Lidl, Aldi Nord, REWE, Norma & Co.)`;
      }
    } else {
      if (catLabel) {
        titleText = `${catLabel}: Treffer für "${state.query}"`;
      }
    }

    if (state.onlyFavorites) titleText = `⭐ Angebote aus meinen Favoriten`;
    if (state.onlyFood && !state.query && !catLabel) titleText = `🍎 Aktuelle Lebensmittel-Angebote`;
    if (state.onlyNonFood && !state.query && !catLabel) titleText = `📦 Aktuelle Nicht-Lebensmittel & Aktionsware`;
    if (state.onlyBio && !state.query) titleText = `🌱 Alle aktuellen Bio-Angebote`;

    elements.resultsTitle.textContent = titleText;
    elements.resultsCount.textContent = `${data.filteredCount} Treffer in PLZ ${state.zip}`;

    renderOffers(state.offers);
  } catch (error) {
    console.error('Fehler beim Laden:', error);
    showToast('⚠️ Fehler beim Abrufen der Angebote');
  } finally {
    state.isLoading = false;
    elements.loadingSpinner.style.display = 'none';
  }
}

/**
 * Rendert die Angebote in Grid- und Tabellenansicht
 */
function renderOffers(offers) {
  if (!offers || offers.length === 0) {
    elements.emptyState.style.display = 'block';
    if (state.onlyFavorites && state.favorites.length === 0) {
      elements.emptyStateText.textContent = 'Du hast noch keine Favoriten gespeichert. Klicke auf den Stern ⭐ bei einem Produkt!';
    } else {
      elements.emptyStateText.textContent = 'Probiere einen anderen Suchbegriff oder passe deine Filter an.';
    }
    return;
  }
  elements.emptyState.style.display = 'none';

  // Finde das Angebot mit dem absolut niedrigsten Grundpreis
  let minRefPrice = Infinity;
  offers.forEach(o => {
    if (typeof o.referencePrice === 'number' && o.referencePrice > 0 && o.referencePrice < minRefPrice) {
      minRefPrice = o.referencePrice;
    }
  });

  // 1. Grid Cards erstellen
  const gridHtml = offers.map(offer => {
    const isBestRef = (offer.referencePrice && offer.referencePrice === minRefPrice);
    const validToStr = formatShortDate(offer.validTo);
    const fallbackImage = `https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=400&q=80`;
    const favActive = isFavorite(offer.title, offer.brand);

    return `
      <div class="offer-card ${isBestRef ? 'best-ref-price' : ''}" data-id="${offer.id}">
        <div class="card-image-box">
          <span class="badge-retailer" data-retailer="${offer.retailer}">${offer.retailer}</span>
          
          <!-- Favorite Star Button -->
          <button class="btn-card-fav ${favActive ? 'favorited' : ''}" title="Zu Favoriten hinzufügen" data-title="${offer.title.replace(/"/g, '&quot;')}">
            ⭐
          </button>

          ${offer.discountPercent ? `<span class="badge-discount-percent">-${offer.discountPercent}%</span>` : ''}

          <div class="badge-tags-row">
            ${offer.categoryLabel ? `<span class="badge-tag category">${offer.categoryIcon || '🏷️'} ${offer.categoryLabel}</span>` : ''}
            ${offer.isBio ? `<span class="badge-tag bio">🌱 Bio</span>` : ''}
            ${offer.isNonFood ? `<span class="badge-tag nonfood">📦 Non-Food</span>` : ''}
            ${offer.requiresApp ? `<span class="badge-tag app">📱 App</span>` : ''}
          </div>

          <img 
            class="card-image" 
            src="${offer.imageUrl || fallbackImage}" 
            alt="${offer.title}" 
            loading="lazy"
            onerror="this.src='${fallbackImage}'"
          >
        </div>
        
        <div class="card-body">
          ${offer.brand ? `<div class="card-brand">${offer.brand}</div>` : ''}
          <h3 class="card-title" title="${offer.title}">${offer.title}</h3>
          <p class="card-desc" title="${offer.description}">${offer.description || offer.packageSize || ''}</p>
          
          <div class="card-pricing">
            <div class="price-row">
              <div class="price-stack">
                <div class="price-main-line">
                  <span class="price-main">${offer.formattedPrice}</span>
                  ${offer.formattedOldPrice ? `
                    <span class="price-old" title="${offer.isEstimatedOldPrice ? 'Referenz-Normalpreis' : 'Statt-Preis'}">
                      ${offer.isEstimatedOldPrice ? 'UVP ' : 'statt '}${offer.formattedOldPrice}
                    </span>
                  ` : ''}
                </div>
                ${offer.savings && offer.savings > 0 ? `
                  <div class="price-savings-sub">
                    <span class="savings-text">Du sparst ${offer.savingsFormatted || (offer.savings.toFixed(2).replace('.', ',') + ' €')}</span>
                    ${offer.discountPercent ? `<span class="savings-badge-inline">-${offer.discountPercent}%</span>` : ''}
                  </div>
                ` : ''}
              </div>
              ${offer.formattedRefPrice ? `
                <div class="badge-grundpreis ${isBestRef ? 'highlight' : ''}" title="Grundpreis pro Einheit">
                  ${isBestRef ? '🏆 ' : ''}${offer.formattedRefPrice}
                </div>
              ` : ''}
            </div>

            ${validToStr ? `
              <div class="card-validity">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
                <span>Gültig bis ${validToStr}</span>
              </div>
            ` : ''}

            <button class="btn-card-add" 
              data-id="${offer.id}"
              data-title="${offer.title.replace(/"/g, '&quot;')}"
              data-retailer="${offer.retailer.replace(/"/g, '&quot;')}"
              data-price="${offer.price}"
              data-formatted-price="${offer.formattedPrice}"
              data-old-price="${offer.oldPrice || ''}"
              data-formatted-old-price="${offer.formattedOldPrice || ''}"
              data-estimated-old-price="${offer.isEstimatedOldPrice ? 'true' : 'false'}">
              <span>➕ Auf Einkaufsliste (${offer.retailer})</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  elements.offersGrid.innerHTML = gridHtml;

  // 2. Table Rows erstellen
  const tableHtml = offers.map(offer => {
    const isBestRef = (offer.referencePrice && offer.referencePrice === minRefPrice);
    const validToStr = formatShortDate(offer.validTo);
    const fallbackImage = `https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=100&q=80`;
    const favActive = isFavorite(offer.title, offer.brand);

    return `
      <tr>
        <td>
          <button class="btn-table-fav ${favActive ? 'favorited' : ''}" data-title="${offer.title.replace(/"/g, '&quot;')}">
            ⭐
          </button>
        </td>
        <td>
          <div class="table-product-cell">
            <img class="table-img" src="${offer.imageUrl || fallbackImage}" alt="${offer.title}" onerror="this.src='${fallbackImage}'">
            <div>
              <div class="table-product-title">${offer.title}</div>
              <div class="table-product-brand">${offer.brand || offer.packageSize || ''}</div>
            </div>
          </div>
        </td>
        <td><strong>${offer.retailer}</strong></td>
        <td>
          <div class="table-price-stack">
            <strong class="table-price-main">${offer.formattedPrice}</strong>
            ${offer.formattedOldPrice ? `
              <div class="table-price-old-line">
                <span class="table-price-old" title="${offer.isEstimatedOldPrice ? 'Referenz-Normalpreis' : 'Statt-Preis'}">
                  ${offer.isEstimatedOldPrice ? 'UVP ' : 'statt '}${offer.formattedOldPrice}
                </span>
                ${offer.discountPercent ? `<span class="table-price-discount">(-${offer.discountPercent}%)</span>` : ''}
              </div>
            ` : ''}
          </div>
        </td>
        <td class="table-refprice-cell">
          ${isBestRef ? '🏆 ' : ''}${offer.formattedRefPrice || '—'}
        </td>
        <td>
          <div style="display:flex; gap:0.25rem;">
            ${offer.isBio ? `<span class="badge-tag bio">🌱</span>` : ''}
            ${offer.isNonFood ? `<span class="badge-tag nonfood">📦</span>` : ''}
            ${offer.discountPercent ? `<span class="savings-tag">-${offer.discountPercent}%</span>` : ''}
          </div>
        </td>
        <td>${validToStr || 'Aktuell'}</td>
        <td>
          <button class="btn-card-add" style="margin:0; padding:0.4rem 0.7rem;" 
            data-id="${offer.id}"
            data-title="${offer.title.replace(/"/g, '&quot;')}"
            data-retailer="${offer.retailer.replace(/"/g, '&quot;')}"
            data-price="${offer.price}"
            data-formatted-price="${offer.formattedPrice}"
            data-old-price="${offer.oldPrice || ''}"
            data-formatted-old-price="${offer.formattedOldPrice || ''}"
            data-estimated-old-price="${offer.isEstimatedOldPrice ? 'true' : 'false'}">
            ➕ ${offer.retailer}
          </button>
        </td>
      </tr>
    `;
  }).join('');

  elements.offersTableBody.innerHTML = tableHtml;

  // Event Listener für "Auf Einkaufsliste" Buttons
  document.querySelectorAll('.btn-card-add').forEach(btn => {
    btn.addEventListener('click', () => {
      const oldPriceRaw = btn.getAttribute('data-old-price');
      const oldPrice = oldPriceRaw ? parseFloat(oldPriceRaw) : null;
      const item = {
        id: btn.getAttribute('data-id'),
        title: btn.getAttribute('data-title'),
        retailer: btn.getAttribute('data-retailer'),
        price: parseFloat(btn.getAttribute('data-price')) || 0,
        formattedPrice: btn.getAttribute('data-formatted-price'),
        oldPrice: (typeof oldPrice === 'number' && !isNaN(oldPrice)) ? oldPrice : null,
        formattedOldPrice: btn.getAttribute('data-formatted-old-price') || null,
        isEstimatedOldPrice: btn.getAttribute('data-estimated-old-price') === 'true',
        checked: false,
      };
      addToBasket(item);
    });
  });

  // Event Listener für Favoriten-Sterne
  document.querySelectorAll('.btn-card-fav, .btn-table-fav').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const title = btn.getAttribute('data-title');
      toggleFavorite(title);
    });
  });
}

/**
 * Lädt die Warengruppen / Kategorien vom Server und ermöglicht echtes Filtern
 */
async function loadCategories() {
  try {
    const res = await fetch('/api/categories');
    if (!res.ok) return;
    const categories = await res.json();
    state.availableCategories = categories;

    const chipsHtml = categories.map(cat => `
      <button class="category-chip ${state.category === cat.id ? 'active' : (cat.id === 'all' && state.category === 'all' ? 'active' : '')}" data-id="${cat.id}">
        <span class="category-icon">${cat.icon}</span>
        <span>${cat.title}</span>
      </button>
    `).join('');

    elements.categoryChips.innerHTML = chipsHtml;

    elements.categoryChips.querySelectorAll('.category-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const catId = chip.getAttribute('data-id');

        // Toggle: Wenn dieselbe Kategorie erneut angeklickt wird, zurück zu 'all'
        if (state.category === catId && catId !== 'all') {
          state.category = 'all';
        } else {
          state.category = catId;
        }

        elements.categoryChips.querySelectorAll('.category-chip').forEach(c => {
          c.classList.toggle('active', c.getAttribute('data-id') === state.category);
        });

        // Wenn Non-Food Kategorie gewählt wurde, nonfood-Tag synchronisieren
        if (state.category === 'nonfood') {
          state.onlyNonFood = true;
          state.onlyFood = false;
          elements.toggleNonFoodFilterBtn.classList.add('active');
          if (elements.toggleFoodFilterBtn) elements.toggleFoodFilterBtn.classList.remove('active');
        } else if (state.onlyNonFood && state.category !== 'all') {
          state.onlyNonFood = false;
          elements.toggleNonFoodFilterBtn.classList.remove('active');
        }

        fetchOffers();
      });
    });
  } catch (e) {
    console.warn('Kategorien konnten nicht geladen werden', e);
  }
}

/**
 * Warenkorb Verwaltung (Supermarkt-Gruppiert!)
 */
function addToBasket(itemOrTitle) {
  let item = null;
  if (typeof itemOrTitle === 'string') {
    item = {
      id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: itemOrTitle.trim(),
      retailer: 'Einkaufsnotiz (Ohne Festlegung)',
      price: 0,
      formattedPrice: '—',
      checked: false,
    };
  } else {
    item = itemOrTitle;
  }

  if (!item.title) return;

  // Prüfen ob bereits exakt dieses Angebot auf der Liste ist
  const exists = state.basket.some(b => b.id === item.id || (b.title === item.title && b.retailer === item.retailer));
  if (!exists) {
    state.basket.push(item);
    saveBasket();
    renderBasket();
    showToast(`✅ "${item.title}" (${item.retailer}) hinzugefügt!`);
  } else {
    showToast(`ℹ️ "${item.title}" ist bereits bei ${item.retailer} notiert`);
  }
}

function removeFromBasket(id) {
  state.basket = state.basket.filter(item => item.id !== id);
  saveBasket();
  renderBasket();
}

function toggleItemChecked(id) {
  const item = state.basket.find(i => i.id === id);
  if (item) {
    item.checked = !item.checked;
    saveBasket();
    renderBasket();
  }
}

function saveBasket() {
  localStorage.setItem('sparfuchs_basket_v2', JSON.stringify(state.basket));
  elements.basketCountBadge.textContent = state.basket.length;
  if (elements.mobileBasketBadge) {
    elements.mobileBasketBadge.textContent = state.basket.length;
  }
}

/**
 * Berechnet die Ersparnis für einen Artikel (direkt oder über sauberen Marktvergleich)
 */
function getItemSavings(item) {
  if (!item || !item.price || item.price <= 0) return 0;
  
  // 1. Echter Streichpreis (validiert)
  const sanitized = validateAndSanitizeClientPrice(item.price, item.oldPrice, item.isNonFood);
  if (sanitized && sanitized > item.price) {
    return sanitized - item.price;
  }

  // 2. Suche in aktuellen Angeboten nach sauberem Marktpreis (ohne Prefix-Matching)
  if (Array.isArray(state.offers) && state.offers.length > 0) {
    const cleanItemTitle = (item.title || '')
      .replace(/^(thisisnobrand123|lidl backshop|k-classic|gut & günstig|gut und günstig|ja!|edeka bio|rewe beste wahl|rewe bio|milbona)\s*/i, '')
      .trim()
      .toLowerCase();

    if (cleanItemTitle.length >= 4 && !/^(bio|frische|deutsches|speise|feine|echte|unsere)$/i.test(cleanItemTitle)) {
      const matches = state.offers.filter(o => {
        if (o.id === item.id || typeof o.price !== 'number' || o.price <= item.price) return false;
        const cleanOTitle = (o.title || '')
          .replace(/^(thisisnobrand123|lidl backshop|k-classic|gut & günstig|gut und günstig|ja!|edeka bio|rewe beste wahl|rewe bio|milbona)\s*/i, '')
          .trim()
          .toLowerCase();

        return (cleanOTitle.includes(cleanItemTitle) || cleanItemTitle.includes(cleanOTitle)) && (o.price / item.price) <= 2.2;
      });

      if (matches.length > 0) {
        const candidatePrices = matches
          .map(m => validateAndSanitizeClientPrice(item.price, m.oldPrice, item.isNonFood) || m.price)
          .filter(p => p > item.price && (p / item.price) <= 2.2);

        if (candidatePrices.length > 0) {
          const maxP = Math.max(...candidatePrices);
          return maxP - item.price;
        }
      }
    }
  }

  // 3. Konservativer Schätzwert für Aktionsangebote (~20% Ersparnis)
  return item.price * 0.25;
}

/**
 * Rendert die Einkaufsliste GRUPPIERT nach Supermarkt und berechnet die Gesamtersparnis!
 */
function renderBasket() {
  elements.basketCountBadge.textContent = state.basket.length;
  elements.basketPlzDisplay.textContent = state.zip;

  if (state.basket.length === 0) {
    elements.basketGroupedContainer.innerHTML = `
      <div style="text-align:center; padding: 2rem 1rem; color: var(--text-dim); font-size: 0.9rem;">
        🛒 Deine Einkaufsliste ist noch leer.<br><br>
        Klicke bei einem Angebot auf <strong>„➕ Auf Einkaufsliste“</strong> oder notiere Artikel oben im Textfeld.
      </div>
    `;
    elements.basketTotalBar.style.display = 'none';
    elements.optimizationResultContainer.style.display = 'none';
    return;
  }

  // Gruppiere Artikel nach Supermarkt
  const groups = {};
  let grandTotal = 0;
  let grandOriginalTotal = 0;

  state.basket.forEach(item => {
    const store = item.retailer || 'Einkaufsnotizen';
    if (!groups[store]) {
      groups[store] = [];
    }
    groups[store].push(item);
    
    if (typeof item.price === 'number' && item.price > 0) {
      grandTotal += item.price;
      const sanitizedOld = validateAndSanitizeClientPrice(item.price, item.oldPrice, item.isNonFood);
      const effectiveOld = (sanitizedOld && sanitizedOld > item.price)
        ? sanitizedOld
        : (item.price * 1.25);
      grandOriginalTotal += effectiveOld;
    }
  });

  const grandSavings = Math.max(0, grandOriginalTotal - grandTotal);

  // HTML für jeden Supermarkt generieren
  const groupHtml = Object.keys(groups).map(store => {
    const items = groups[store];
    const storeOfferTotal = items.reduce((sum, it) => sum + (it.price || 0), 0);
    const storeOriginalTotal = items.reduce((sum, it) => {
      const sanitizedOld = validateAndSanitizeClientPrice(it.price, it.oldPrice, it.isNonFood);
      if (sanitizedOld && sanitizedOld > it.price) return sum + sanitizedOld;
      if (it.price > 0) return sum + (it.price * 1.25);
      return sum;
    }, 0);
    const storeSavings = Math.max(0, storeOriginalTotal - storeOfferTotal);

    const subtotalStr = storeOfferTotal > 0 ? `${storeOfferTotal.toFixed(2).replace('.', ',')} €` : '';
    const oldSubtotalStr = storeOriginalTotal > storeOfferTotal ? `${storeOriginalTotal.toFixed(2).replace('.', ',')} €` : '';
    const savingsStr = storeSavings > 0 ? `${storeSavings.toFixed(2).replace('.', ',')} €` : '';

    return `
      <div class="store-group-card" data-store="${store}">
        <div class="store-group-header">
          <div class="store-badge-title">
            <span>🏪</span>
            <strong>${store}</strong>
            <span style="font-size:0.75rem; color:var(--text-dim);">(${items.length} Artikel)</span>
          </div>
          <div class="store-totals-block">
            <div class="store-subtotal">${subtotalStr ? `Angebot: ${subtotalStr}` : ''}</div>
            ${oldSubtotalStr ? `<div class="store-old-subtotal">regulär: ${oldSubtotalStr}</div>` : ''}
            ${savingsStr ? `<div class="store-savings-badge">Ersparnis: -${savingsStr}</div>` : ''}
          </div>
        </div>
        
        <div class="store-items-list">
          ${items.map(it => {
            const hasOld = (typeof it.oldPrice === 'number' && it.oldPrice > it.price);
            const oldPriceVal = hasOld ? it.oldPrice : (it.price > 0 ? it.price * 1.25 : null);
            const itemSavings = (oldPriceVal && oldPriceVal > it.price) ? (oldPriceVal - it.price) : 0;
            const itemDiscountPct = (oldPriceVal && oldPriceVal > it.price) ? Math.round((itemSavings / oldPriceVal) * 100) : null;
            const oldPriceFormatted = it.formattedOldPrice || (oldPriceVal ? `${oldPriceVal.toFixed(2).replace('.', ',')} €` : '');

            return `
              <div class="basket-item-row ${it.checked ? 'checked' : ''}" data-id="${it.id}">
                <div class="basket-item-left">
                  <input 
                    type="checkbox" 
                    class="basket-checkbox" 
                    data-id="${it.id}" 
                    ${it.checked ? 'checked' : ''}
                    title="Als erledigt abhaken"
                  >
                  <div class="basket-item-info">
                    <span class="basket-item-name">${it.title}</span>
                    ${itemSavings > 0 ? `
                      <div class="basket-item-subprice">
                        <span class="basket-item-statt">statt ${oldPriceFormatted}</span>
                        <span class="basket-item-saving">Du sparst ${itemSavings.toFixed(2).replace('.', ',')} €</span>
                      </div>
                    ` : ''}
                  </div>
                </div>
                <div class="basket-item-right">
                  ${it.price > 0 ? `
                    <div class="basket-item-price-col">
                      <span class="basket-item-price">${it.formattedPrice}</span>
                      ${itemDiscountPct ? `<span class="basket-item-discount-pill">-${itemDiscountPct}%</span>` : ''}
                    </div>
                  ` : ''}
                  <button class="btn-item-del" data-id="${it.id}" title="Entfernen">✕</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');

  elements.basketGroupedContainer.innerHTML = groupHtml;

  // Gesamtsumme & Gesamtersparnis anzeigen
  if (grandTotal > 0) {
    elements.basketTotalBar.style.display = 'flex';
    elements.basketGrandTotal.textContent = `${grandTotal.toFixed(2).replace('.', ',')} €`;

    if (grandSavings > 0) {
      elements.basketSavingsRow.style.display = 'flex';
      elements.basketTotalSavings.textContent = `-${grandSavings.toFixed(2).replace('.', ',')} €`;
      const pct = Math.round((grandSavings / grandOriginalTotal) * 100);
      elements.basketSavingsPercentBadge.textContent = `-${pct}%`;
      if (elements.basketSavingsNote) {
        elements.basketSavingsNote.textContent = `Regulärer Gesamtwert: ${grandOriginalTotal.toFixed(2).replace('.', ',')} € (Ersparnis berechnet aus Streichpreisen, UVP & Markt-Benchmarks)`;
      }
    } else {
      elements.basketSavingsRow.style.display = 'none';
    }
  } else {
    elements.basketTotalBar.style.display = 'none';
  }

  if (elements.mobileBasketBadge) {
    elements.mobileBasketBadge.textContent = state.basket.length;
  }

  // Event Listener für Checkboxen
  elements.basketGroupedContainer.querySelectorAll('.basket-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      toggleItemChecked(cb.getAttribute('data-id'));
    });
  });

  // Mobile-Optimierung: Tippen auf die gesamte Zeile hakt den Artikel ab
  elements.basketGroupedContainer.querySelectorAll('.basket-item-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.btn-item-del') || e.target.classList.contains('basket-checkbox')) return;
      const id = row.getAttribute('data-id');
      if (id) toggleItemChecked(id);
    });
  });

  // Event Listener für Löschen
  elements.basketGroupedContainer.querySelectorAll('.btn-item-del').forEach(btn => {
    btn.addEventListener('click', () => {
      removeFromBasket(btn.getAttribute('data-id'));
    });
  });
}

/**
 * Führt die Multimarkt-Einkaufsoptimierung aus
 */
async function optimizeBasket() {
  if (state.basket.length === 0) {
    showToast('Füge zuerst Artikel zu deiner Liste hinzu!');
    return;
  }

  const itemNames = state.basket.map(i => i.title);

  elements.optimizeBasketBtn.disabled = true;
  elements.optimizeBasketBtn.innerHTML = `
    <div class="spinner" style="width:18px; height:18px; margin:0; border-width:2px;"></div>
    <span>Berechne Spar-Strategie...</span>
  `;

  try {
    const res = await fetch('/api/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: itemNames,
        zipCode: state.zip,
        excludeAppOnly: state.excludeAppOnly,
        preferReferencePrice: state.sortBy === 'refPrice',
      }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    renderOptimizationResult(data.optimization);
  } catch (err) {
    console.error('Optimierungs-Fehler:', err);
    showToast('⚠️ Fehler bei der Berechnung der Optimierung');
  } finally {
    elements.optimizeBasketBtn.disabled = false;
    elements.optimizeBasketBtn.innerHTML = `
      <span class="icon-sparkle">⚡</span>
      <span>Einkauf jetzt optimieren</span>
    `;
  }
}

/**
 * Rendert die Ergebnisse des Optimierers im Drawer
 */
function renderOptimizationResult(opt) {
  if (!opt) return;

  const container = elements.optimizationResultContainer;
  container.style.display = 'flex';

  const champion = opt.singleStoreChampion;
  const split = opt.smartSplit;
  const splitSavings = opt.splitSavingsVsSingle;

  let html = '';

  // 1. Single-Store Champion
  if (champion) {
    html += `
      <div class="card-champion">
        <div class="champion-header">
          <span class="champion-title">🏆 Single-Store Sieger</span>
          <span class="savings-tag">${champion.matchedCount}/${opt.totalItemsRequested} Treffer</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:baseline;">
          <div class="champion-store">${champion.retailer}</div>
          <div class="champion-price">${champion.totalPrice.toFixed(2).replace('.', ',')} €</div>
        </div>
        <p style="font-size:0.8rem; color:var(--text-dim); margin-top:0.3rem;">
          Wenn du nur in einen einzigen Laden möchtest.
        </p>
      </div>
    `;
  }

  // 2. Smart Split (2 Läden)
  if (split && split.stores.length === 2) {
    const [storeA, storeB] = split.stores;
    const allocA = split.allocations[storeA];
    const allocB = split.allocations[storeB];

    html += `
      <div class="card-champion" style="border-color: var(--accent-primary);">
        <div class="champion-header">
          <span class="champion-title">⚡ Smart Split (2 Läden)</span>
          ${splitSavings > 0 ? `<span class="savings-tag">+${splitSavings.toFixed(2).replace('.', ',')} € Ersparnis</span>` : ''}
        </div>
        <div style="display:flex; justify-content:space-between; align-items:baseline;">
          <div class="champion-store">${storeA} + ${storeB}</div>
          <div class="champion-price" style="color:var(--accent-primary);">${split.totalPrice.toFixed(2).replace('.', ',')} €</div>
        </div>
        <p style="font-size:0.8rem; color:var(--text-muted); margin-top:0.3rem;">
          Optimale Aufteilung für maximales Sparen:
        </p>

        <!-- Store A Details -->
        <div class="split-store-block">
          <div class="split-store-name">
            <span>🛒 ${storeA}</span>
            <span>${allocA.subtotal.toFixed(2).replace('.', ',')} €</span>
          </div>
          <ul class="split-item-list">
            ${allocA.items.map(it => `
              <li>
                <span>${it.query}</span>
                <span><strong>${it.offer.formattedPrice}</strong></span>
              </li>
            `).join('')}
          </ul>
        </div>

        <!-- Store B Details -->
        <div class="split-store-block">
          <div class="split-store-name">
            <span>🛒 ${storeB}</span>
            <span>${allocB.subtotal.toFixed(2).replace('.', ',')} €</span>
          </div>
          <ul class="split-item-list">
            ${allocB.items.map(it => `
              <li>
                <span>${it.query}</span>
                <span><strong>${it.offer.formattedPrice}</strong></span>
              </li>
            `).join('')}
          </ul>
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

/**
 * ==========================================================================
 * Haushaltsplan & Einkaufs-Historie
 * ==========================================================================
 */

/**
 * Öffnet den Haushaltsplan-Drawer
 */
function openHistoryDrawer() {
  if (elements.basketDrawer) {
    elements.basketDrawer.classList.remove('open');
    elements.basketDrawer.setAttribute('aria-hidden', 'true');
  }
  if (elements.historyDrawer) {
    elements.historyDrawer.classList.add('open');
    elements.historyDrawer.setAttribute('aria-hidden', 'false');
  }
  if (elements.drawerBackdrop) {
    elements.drawerBackdrop.classList.add('active');
  }
  if (elements.openHistoryBtn) {
    elements.openHistoryBtn.classList.add('active');
  }
  fetchAndRenderHistory();
}

/**
 * Schließt den Haushaltsplan-Drawer
 */
function closeHistoryDrawer() {
  if (elements.historyDrawer) {
    elements.historyDrawer.classList.remove('open');
    elements.historyDrawer.setAttribute('aria-hidden', 'true');
  }
  if (elements.drawerBackdrop && (!elements.basketDrawer || !elements.basketDrawer.classList.contains('open'))) {
    elements.drawerBackdrop.classList.remove('active');
  }
  if (elements.openHistoryBtn) {
    elements.openHistoryBtn.classList.remove('active');
  }
}

/**
 * Schließt alle geöffneten Drawer
 */
function closeAllDrawers() {
  if (elements.basketDrawer) {
    elements.basketDrawer.classList.remove('open');
    elements.basketDrawer.setAttribute('aria-hidden', 'true');
  }
  if (elements.historyDrawer) {
    elements.historyDrawer.classList.remove('open');
    elements.historyDrawer.setAttribute('aria-hidden', 'true');
  }
  if (elements.drawerBackdrop) {
    elements.drawerBackdrop.classList.remove('active');
  }
  if (elements.openHistoryBtn) {
    elements.openHistoryBtn.classList.remove('active');
  }
}

/**
 * Formatiert Datums- und Zeitangabe für Einkaufsbelege
 */
function formatReceiptDateTime(isoString) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    const days = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
    const dayName = days[d.getDay()];
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${dayName}, ${day}.${month}.${year}, ${hours}:${mins} Uhr`;
  } catch {
    return isoString;
  }
}

/**
 * Aktualisiert das Zähler-Badge im Header
 */
function updateHistoryBadge() {
  if (!elements.historyCountBadge) return;
  const count = state.history ? state.history.length : 0;
  if (count > 0) {
    elements.historyCountBadge.style.display = 'inline-flex';
    elements.historyCountBadge.textContent = count;
  } else {
    elements.historyCountBadge.style.display = 'none';
  }
}

/**
 * Lädt die Historie und Haushalts-Statistiken vom Backend
 */
async function fetchAndRenderHistory() {
  try {
    const res = await fetch('/api/history');
    if (res.ok) {
      const data = await res.json();
      const serverHistory = Array.isArray(data.history) ? data.history : [];

      // Wenn der Server frisch gestartet ist (z. B. nach Render Spin-Down) und leer ist,
      // aber der Client im localStorage noch Belege hat: Automatisch wiederherstellen!
      if (serverHistory.length === 0 && state.history && state.history.length > 0) {
        try {
          const syncRes = await fetch('/api/history/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientHistory: state.history }),
          });
          if (syncRes.ok) {
            const syncData = await syncRes.json();
            state.history = syncData.history || state.history;
            state.householdStats = syncData.stats || state.householdStats;
            localStorage.setItem('sparfuchs_history', JSON.stringify(state.history));
            renderHistoryUI(state.householdStats, state.history);
            updateHistoryBadge();
            return;
          }
        } catch (syncErr) {
          console.warn('Sync nach Spin-Down fehlgeschlagen:', syncErr);
        }
      }

      state.history = serverHistory;
      state.householdStats = data.stats || null;
      localStorage.setItem('sparfuchs_history', JSON.stringify(state.history));
      renderHistoryUI(data.stats, data.history);
      updateHistoryBadge();
      return;
    }
  } catch (err) {
    console.warn('Backend nicht erreichbar, verwende lokale Historie:', err.message);
  }

  // Fallback auf lokale Daten
  renderHistoryUI(state.householdStats, state.history);
  updateHistoryBadge();
}

/**
 * Bucht den aktuellen Einkaufszettel verbindlich in die Historie ein
 */
async function bookCurrentBasket() {
  if (!state.basket || state.basket.length === 0) {
    showToast('⚠️ Dein Einkaufszettel ist leer! Füge zuerst Artikel hinzu.');
    return;
  }

  // Berechnung der Gesamtsummen und Ersparnisse
  let totalPaid = 0;
  let totalRegular = 0;
  const storesSet = new Set();

  state.basket.forEach(it => {
    const store = it.retailer || 'Einkaufsnotizen';
    storesSet.add(store);

    if (typeof it.price === 'number' && it.price > 0) {
      totalPaid += it.price;
      const sanitizedOld = validateAndSanitizeClientPrice(it.price, it.oldPrice, it.isNonFood);
      const effectiveOld = (sanitizedOld && sanitizedOld > it.price)
        ? sanitizedOld
        : (it.price * 1.25);
      totalRegular += effectiveOld;
    }
  });

  const totalSavings = Math.max(0, totalRegular - totalPaid);
  const stores = Array.from(storesSet);

  // Snapshot der Artikel
  const itemsSnapshot = state.basket.map(it => {
    const sanitizedOld = validateAndSanitizeClientPrice(it.price, it.oldPrice, it.isNonFood);
    const effectiveOld = (sanitizedOld && sanitizedOld > it.price)
      ? sanitizedOld
      : (it.price > 0 ? it.price * 1.25 : null);
    return {
      title: it.title,
      retailer: it.retailer || 'Einkaufsnotizen',
      price: it.price || 0,
      formattedPrice: it.formattedPrice || (it.price ? `${it.price.toFixed(2).replace('.', ',')} €` : ''),
      oldPrice: sanitizedOld,
      formattedOldPrice: sanitizedOld ? `${sanitizedOld.toFixed(2).replace('.', ',')} €` : (effectiveOld ? `${effectiveOld.toFixed(2).replace('.', ',')} €` : null),
      checked: it.checked || false,
    };
  });

  const payload = {
    date: new Date().toISOString(),
    stores,
    itemCount: itemsSnapshot.length,
    totalPaid: parseFloat(totalPaid.toFixed(2)),
    totalRegular: parseFloat(totalRegular.toFixed(2)),
    totalSavings: parseFloat(totalSavings.toFixed(2)),
    items: itemsSnapshot,
  };

  if (elements.bookBasketBtn) {
    elements.bookBasketBtn.disabled = true;
    elements.bookBasketBtn.innerHTML = `<span>⏳ Verbucht Einkauf...</span>`;
  }

  try {
    const res = await fetch('/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    state.history = data.history || [];
    state.householdStats = data.stats || null;
    localStorage.setItem('sparfuchs_history', JSON.stringify(state.history));

    // Einkaufszettel leeren
    state.basket = [];
    localStorage.removeItem('sparfuchs_basket_v2');
    renderBasket();

    // Drawer wechseln
    if (elements.basketDrawer) elements.basketDrawer.classList.remove('open');
    openHistoryDrawer();

    const savedStr = totalSavings > 0 ? `${totalSavings.toFixed(2).replace('.', ',')} €` : '0,00 €';
    showToast(`🎉 Einkauf verbucht! Du hast ${savedStr} gespart.`);
  } catch (err) {
    console.error('Fehler beim Buchen des Einkaufs:', err);
    showToast('⚠️ Fehler beim Verbuchen des Einkaufs');
  } finally {
    if (elements.bookBasketBtn) {
      elements.bookBasketBtn.disabled = false;
      elements.bookBasketBtn.innerHTML = `
        <span class="btn-book-icon">✅</span>
        <span class="btn-book-text">Einkauf abschließen & verbuchen</span>
      `;
    }
  }
}

/**
 * Löscht einen einzelnen Beleg aus der Historie
 */
async function deleteReceipt(receiptId) {
  if (!confirm('Diesen Einkaufsbeleg wirklich aus der Historie entfernen?')) return;

  try {
    const res = await fetch(`/api/history/${encodeURIComponent(receiptId)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    state.history = data.history || [];
    state.householdStats = data.stats || null;
    localStorage.setItem('sparfuchs_history', JSON.stringify(state.history));

    renderHistoryUI(data.stats, data.history);
    updateHistoryBadge();
    showToast('🗑️ Beleg gelöscht');
  } catch (err) {
    console.error('Fehler beim Löschen des Belegs:', err);
    showToast('⚠️ Fehler beim Löschen des Belegs');
  }
}

/**
 * Löscht die gesamte Historie
 */
async function clearAllHistory() {
  if (!confirm('Möchtest du wirklich die gesamte Einkaufs-Historie und alle Haushaltsstatistiken unwiderruflich löschen?')) return;

  try {
    const res = await fetch('/api/history', { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    state.history = [];
    state.householdStats = data.stats || null;
    localStorage.setItem('sparfuchs_history', JSON.stringify([]));

    renderHistoryUI(data.stats, []);
    updateHistoryBadge();
    showToast('🧹 Historie vollständig zurückgesetzt');
  } catch (err) {
    console.error('Fehler beim Zurücksetzen der Historie:', err);
    showToast('⚠️ Fehler beim Zurücksetzen');
  }
}

/**
 * Rendert das Dashboard: KPIs, Supermarkt-Ranking, Monatsverlauf und Belegliste
 */
function renderHistoryUI(stats, receipts = []) {
  const s = stats || {
    totalSpent: 0,
    totalSavings: 0,
    totalRegular: 0,
    overallSavingsPercent: 0,
    receiptCount: 0,
    totalItemsPurchased: 0,
    averageSpentPerTrip: 0,
    averageSavingsPerTrip: 0,
    storesBreakdown: [],
    monthlyBreakdown: [],
  };

  // 1. KPI-Karten aktualisieren
  if (elements.kpiTotalSavings) {
    elements.kpiTotalSavings.textContent = `${(s.totalSavings || 0).toFixed(2).replace('.', ',')} €`;
  }
  if (elements.kpiSavingsPct) {
    elements.kpiSavingsPct.textContent = `${s.overallSavingsPercent || 0}%`;
  }
  if (elements.kpiTotalSpent) {
    elements.kpiTotalSpent.textContent = `${(s.totalSpent || 0).toFixed(2).replace('.', ',')} €`;
  }
  if (elements.kpiTotalRegular) {
    elements.kpiTotalRegular.textContent = `statt ${(s.totalRegular || 0).toFixed(2).replace('.', ',')} € regulär`;
  }
  if (elements.kpiAvgSpent) {
    elements.kpiAvgSpent.textContent = `Ø ${(s.averageSpentPerTrip || 0).toFixed(2).replace('.', ',')} €`;
  }
  if (elements.kpiAvgSavings) {
    elements.kpiAvgSavings.textContent = `Ø ${(s.averageSavingsPerTrip || 0).toFixed(2).replace('.', ',')} € gespart`;
  }
  if (elements.kpiReceiptCount) {
    elements.kpiReceiptCount.textContent = s.receiptCount || 0;
  }
  if (elements.kpiItemCount) {
    elements.kpiItemCount.textContent = `${s.totalItemsPurchased || 0} Artikel verbucht`;
  }

  // 2. Top-Sparmärkte (Store Breakdown)
  if (elements.historyStoreBarsContainer) {
    if (!s.storesBreakdown || s.storesBreakdown.length === 0) {
      elements.historyStoreBarsContainer.innerHTML = `
        <div style="font-size:0.84rem; color:var(--text-dim); text-align:center; padding:1rem 0;">
          Noch keine Supermarkt-Daten erfasst.
        </div>
      `;
    } else {
      const maxStoreSavings = Math.max(...s.storesBreakdown.map(st => st.savings), 1);
      const storeHtml = s.storesBreakdown.map(st => {
        const barWidth = Math.max(8, Math.round((st.savings / maxStoreSavings) * 100));
        return `
          <div class="store-bar-item">
            <div class="store-bar-header">
              <span class="store-bar-name">
                <span>🛒</span> ${st.store}
                <span style="font-size:0.75rem; color:var(--text-dim); font-weight:normal;">(${st.tripsCount} ${st.tripsCount === 1 ? 'Einkauf' : 'Einkäufe'})</span>
              </span>
              <div class="store-bar-figures">
                <span class="store-bar-savings">-${st.savings.toFixed(2).replace('.', ',')} € (-${st.savingsPercent}%)</span>
                <span class="store-bar-spend">(${st.spent.toFixed(2).replace('.', ',')} € bezahlt)</span>
              </div>
            </div>
            <div class="store-bar-track">
              <div class="store-bar-fill" style="width: ${barWidth}%;"></div>
            </div>
          </div>
        `;
      }).join('');
      elements.historyStoreBarsContainer.innerHTML = storeHtml;
    }
  }

  // 3. Monatsverlauf (Haushaltsentwicklung)
  if (elements.historyMonthlyContainer) {
    if (!s.monthlyBreakdown || s.monthlyBreakdown.length === 0) {
      elements.historyMonthlyContainer.innerHTML = `
        <div style="font-size:0.84rem; color:var(--text-dim); text-align:center; padding:1rem 0;">
          Noch keine Monatsdaten vorhanden.
        </div>
      `;
    } else {
      const monthHtml = s.monthlyBreakdown.map(m => `
        <div class="monthly-row-item">
          <div class="monthly-col-date">
            <span>🗓️</span>
            <strong>${m.label}</strong>
            <span class="monthly-badge-count">(${m.tripsCount} ${m.tripsCount === 1 ? 'Einkauf' : 'Einkäufe'})</span>
          </div>
          <div class="monthly-col-stats">
            <span class="monthly-stat-spent">${m.spent.toFixed(2).replace('.', ',')} €</span>
            <span class="monthly-stat-saved">-${m.savings.toFixed(2).replace('.', ',')} € (${m.savingsPercent}%)</span>
          </div>
        </div>
      `).join('');
      elements.historyMonthlyContainer.innerHTML = monthHtml;
    }
  }

  // 4. Verbuchte Einkaufsbelege
  if (elements.receiptsListContainer) {
    if (!receipts || receipts.length === 0) {
      elements.receiptsListContainer.innerHTML = `
        <div style="text-align:center; padding: 2.5rem 1rem; color: var(--text-dim); font-size: 0.88rem;">
          🧾 Noch keine Einkäufe verbucht.<br><br>
          Füge Angebote zu deiner Einkaufsliste hinzu und klicke auf<br>
          <strong style="color:var(--accent-primary);">„✅ Einkauf abschließen & verbuchen“</strong>.
        </div>
      `;
    } else {
      const receiptsHtml = receipts.map(rc => {
        const dateFormatted = formatReceiptDateTime(rc.date);
        const stores = rc.stores && rc.stores.length > 0 ? rc.stores : ['Einkauf'];
        const items = rc.items || [];
        const hasItems = items.length > 0;

        return `
          <div class="receipt-card" data-receipt-id="${rc.id}">
            <div class="receipt-header-row">
              <div class="receipt-date-group">
                <span class="receipt-date">${dateFormatted}</span>
                <div class="receipt-stores">
                  ${stores.map(st => `<span class="receipt-stores-tag">${st}</span>`).join('')}
                </div>
              </div>
              <div class="receipt-actions">
                <button class="btn-del-receipt" data-receipt-id="${rc.id}" title="Beleg aus Historie löschen">🗑️</button>
              </div>
            </div>

            <div class="receipt-summary-bar">
              <div>
                <span>Ausgaben: </span>
                <span class="receipt-spent-num">${(rc.totalPaid || 0).toFixed(2).replace('.', ',')} €</span>
              </div>
              <div>
                <span>Ersparnis: </span>
                <span class="receipt-savings-num">-${(rc.totalSavings || 0).toFixed(2).replace('.', ',')} € (${rc.savingsPercent || 0}%)</span>
              </div>
            </div>

            ${hasItems ? `
              <button type="button" class="receipt-accordion-toggle" data-receipt-id="${rc.id}">
                <span>📋</span>
                <span>${items.length} Artikel anzeigen ▾</span>
              </button>
              <div class="receipt-details-list" id="receipt-details-${rc.id}">
                ${items.map(it => {
                  const itPriceStr = it.formattedPrice || (it.price ? `${it.price.toFixed(2).replace('.', ',')} €` : '');
                  const itOldStr = it.formattedOldPrice || (it.oldPrice ? `${it.oldPrice.toFixed(2).replace('.', ',')} €` : '');
                  return `
                    <div class="receipt-detail-item">
                      <span class="item-title">
                        ${it.checked ? '✓ ' : '• '} ${it.title} 
                        <small style="color:var(--text-dim);">(${it.retailer})</small>
                      </span>
                      <span>
                        <strong>${itPriceStr}</strong>
                        ${itOldStr && itOldStr !== itPriceStr ? `<span style="font-size:0.72rem; color:var(--text-dim); text-decoration:line-through; margin-left:0.3rem;">${itOldStr}</span>` : ''}
                      </span>
                    </div>
                  `;
                }).join('')}
              </div>
            ` : ''}
          </div>
        `;
      }).join('');

      elements.receiptsListContainer.innerHTML = receiptsHtml;

      // Event Listener für Accordion Toggle
      elements.receiptsListContainer.querySelectorAll('.receipt-accordion-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-receipt-id');
          const detailsList = document.getElementById(`receipt-details-${id}`);
          if (detailsList) {
            const isOpen = detailsList.classList.toggle('open');
            const itemsCount = detailsList.querySelectorAll('.receipt-detail-item').length;
            btn.innerHTML = `<span>📋</span> <span>${itemsCount} Artikel ${isOpen ? 'verbergen ▴' : 'anzeigen ▾'}</span>`;
          }
        });
      });

      // Event Listener für Beleg löschen
      elements.receiptsListContainer.querySelectorAll('.btn-del-receipt').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-receipt-id');
          deleteReceipt(id);
        });
      });
    }
  }
}

/**
 * Event Listeners Registrierung
 */
function initEvents() {
  // Suche absenden
  elements.searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = elements.searchInput.value.trim();
    if (!val) return;
    state.query = val;
    state.onlyFavorites = false;
    elements.toggleFavFilterBtn.classList.remove('active');
    fetchOffers();
  });

  // Such-Input Clear Button
  elements.searchInput.addEventListener('input', () => {
    elements.clearSearchBtn.style.display = elements.searchInput.value ? 'block' : 'none';
  });

  elements.clearSearchBtn.addEventListener('click', () => {
    elements.searchInput.value = '';
    elements.clearSearchBtn.style.display = 'none';
    elements.searchInput.focus();
  });

  // Quick Tags
  elements.quickTagsContainer.querySelectorAll('.tag-btn:not(.tag-btn-special):not(.tag-btn-highlight)').forEach(btn => {
    btn.addEventListener('click', () => {
      const q = btn.getAttribute('data-query');
      elements.searchInput.value = q;
      elements.clearSearchBtn.style.display = 'block';
      state.query = q;
      state.onlyFavorites = false;
      elements.toggleFavFilterBtn.classList.remove('active');
      fetchOffers();
    });
  });

  // Alle Angebote Button
  if (elements.allOffersTag) {
    elements.allOffersTag.addEventListener('click', () => {
      elements.searchInput.value = '';
      elements.clearSearchBtn.style.display = 'none';
      state.query = '';
      state.retailer = 'all';
      elements.retailerChipsContainer.querySelectorAll('.chip-retailer').forEach(c => {
        c.classList.toggle('active', c.getAttribute('data-retailer') === 'all');
      });
      state.onlyFavorites = false;
      state.onlyBio = false;
      state.onlyFood = false;
      state.onlyNonFood = false;
      if (elements.toggleFoodFilterBtn) elements.toggleFoodFilterBtn.classList.remove('active');
      elements.toggleBioFilterBtn.classList.remove('active');
      elements.toggleNonFoodFilterBtn.classList.remove('active');
      elements.toggleFavFilterBtn.classList.remove('active');
      fetchOffers();
    });
  }

  // Favoriten Quick Tag / Button
  const activateFavoritesFilter = () => {
    state.onlyFavorites = !state.onlyFavorites;
    elements.toggleFavFilterBtn.classList.toggle('active', state.onlyFavorites);
    if (elements.favQuickBtn) elements.favQuickBtn.classList.toggle('active', state.onlyFavorites);
    if (elements.favoritesSearchTag) elements.favoritesSearchTag.classList.toggle('active', state.onlyFavorites);

    if (state.onlyFavorites && state.favorites.length === 0) {
      showToast('Füge zuerst Produkte mit dem Stern ⭐ zu deinen Favoriten hinzu!');
    }
    fetchOffers();
  };

  elements.toggleFavFilterBtn.addEventListener('click', activateFavoritesFilter);
  if (elements.favQuickBtn) elements.favQuickBtn.addEventListener('click', activateFavoritesFilter);
  if (elements.favoritesSearchTag) elements.favoritesSearchTag.addEventListener('click', activateFavoritesFilter);

  // Food Filter Toggle (komplementär zu Non-Food)
  if (elements.toggleFoodFilterBtn) {
    elements.toggleFoodFilterBtn.addEventListener('click', () => {
      state.onlyFood = !state.onlyFood;
      elements.toggleFoodFilterBtn.classList.toggle('active', state.onlyFood);
      if (state.onlyFood) {
        state.onlyNonFood = false;
        elements.toggleNonFoodFilterBtn.classList.remove('active');
      }
      if (!elements.searchInput.value.trim()) {
        state.query = '';
      }
      fetchOffers();
    });
  }

  // Bio Filter Toggle
  elements.toggleBioFilterBtn.addEventListener('click', () => {
    state.onlyBio = !state.onlyBio;
    elements.toggleBioFilterBtn.classList.toggle('active', state.onlyBio);
    if (!elements.searchInput.value.trim()) {
      state.query = '';
    }
    fetchOffers();
  });

  // Non-Food Filter Toggle
  elements.toggleNonFoodFilterBtn.addEventListener('click', () => {
    state.onlyNonFood = !state.onlyNonFood;
    elements.toggleNonFoodFilterBtn.classList.toggle('active', state.onlyNonFood);
    if (state.onlyNonFood) {
      state.onlyFood = false;
      if (elements.toggleFoodFilterBtn) {
        elements.toggleFoodFilterBtn.classList.remove('active');
      }
    }
    if (!elements.searchInput.value.trim()) {
      state.query = '';
    }
    fetchOffers();
  });

  // Sortierung Dropdown
  elements.sortBySelect.addEventListener('change', () => {
    state.sortBy = elements.sortBySelect.value;
    fetchOffers();
  });

  // Toggles
  elements.excludeAppOnlyToggle.addEventListener('change', () => {
    state.excludeAppOnly = elements.excludeAppOnlyToggle.checked;
    fetchOffers();
  });

  elements.validNowOnlyToggle.addEventListener('change', () => {
    state.validNowOnly = elements.validNowOnlyToggle.checked;
    fetchOffers();
  });

  // Retailer Filter Chips
  elements.retailerChipsContainer.querySelectorAll('.chip-retailer').forEach(chip => {
    chip.addEventListener('click', () => {
      elements.retailerChipsContainer.querySelectorAll('.chip-retailer').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.retailer = chip.getAttribute('data-retailer');
      if (!elements.searchInput.value.trim()) {
        state.query = '';
      }
      fetchOffers();
    });
  });

  // View Switcher
  elements.viewGridBtn.addEventListener('click', () => {
    state.viewMode = 'grid';
    elements.viewGridBtn.classList.add('active');
    elements.viewTableBtn.classList.remove('active');
    elements.offersGrid.style.display = 'grid';
    elements.offersTableContainer.style.display = 'none';
  });

  elements.viewTableBtn.addEventListener('click', () => {
    state.viewMode = 'table';
    elements.viewTableBtn.classList.add('active');
    elements.viewGridBtn.classList.remove('active');
    elements.offersGrid.style.display = 'none';
    elements.offersTableContainer.style.display = 'block';
  });

  // PLZ Update
  const updateZip = () => {
    const val = elements.plzInput.value.trim();
    if (/^[0-9]{5}$/.test(val)) {
      state.zip = val;
      localStorage.setItem('sparfuchs_zip', val);
      elements.basketPlzDisplay.textContent = val;
      showToast(`📍 PLZ auf ${val} aktualisiert`);
      fetchOffers();
    } else {
      showToast('⚠️ Bitte eine gültige 5-stellige PLZ eingeben');
    }
  };

  elements.plzUpdateBtn.addEventListener('click', updateZip);
  elements.plzInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') updateZip();
  });

  // Drawer Open / Close
  const openBasketDrawer = () => {
    if (elements.historyDrawer) {
      elements.historyDrawer.classList.remove('open');
      elements.historyDrawer.setAttribute('aria-hidden', 'true');
    }
    if (elements.openHistoryBtn) {
      elements.openHistoryBtn.classList.remove('active');
    }
    elements.basketDrawer.classList.add('open');
    elements.drawerBackdrop.classList.add('active');
    elements.basketDrawer.setAttribute('aria-hidden', 'false');
  };

  elements.openBasketBtn.addEventListener('click', openBasketDrawer);
  if (elements.mobileBasketFab) {
    elements.mobileBasketFab.addEventListener('click', openBasketDrawer);
  }
  elements.closeBasketBtn.addEventListener('click', closeAllDrawers);

  if (elements.openHistoryBtn) {
    elements.openHistoryBtn.addEventListener('click', openHistoryDrawer);
  }
  if (elements.closeHistoryBtn) {
    elements.closeHistoryBtn.addEventListener('click', closeHistoryDrawer);
  }

  elements.drawerBackdrop.addEventListener('click', closeAllDrawers);

  // Basket Manual Item Add Form
  elements.basketAddForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = elements.basketItemInput.value.trim();
    if (val) {
      const items = val.split(',').map(s => s.trim()).filter(Boolean);
      items.forEach(it => addToBasket(it));
      elements.basketItemInput.value = '';
    }
  });

  // Optimize Button
  elements.optimizeBasketBtn.addEventListener('click', optimizeBasket);

  // Einkauf abschließen & verbuchen Button
  if (elements.bookBasketBtn) {
    elements.bookBasketBtn.addEventListener('click', bookCurrentBasket);
  }

  // Historie leeren Button
  if (elements.clearHistoryBtn) {
    elements.clearHistoryBtn.addEventListener('click', clearAllHistory);
  }
}

// Initialisierung beim Laden
document.addEventListener('DOMContentLoaded', () => {
  elements.plzInput.value = state.zip;
  elements.searchInput.value = state.query;
  elements.clearSearchBtn.style.display = state.query ? 'block' : 'none';
  
  initEvents();
  renderFavoritesBadge();
  renderBasket();
  fetchAndRenderHistory();
  loadCategories();
  fetchOffers();
});

