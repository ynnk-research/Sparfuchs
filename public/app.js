/**
 * SparFuchs – Frontend Application Logic
 * Verwaltet Suche, Filterung, Bio/Non-Food Tags, Favoriten und nach Supermarkt gruppierten Einkaufszettel.
 */

// Anonymous browser identity for private receipt storage. It is not a login.
function getHistoryDeviceToken() {
  let token = localStorage.getItem('sparfuchs_device_token');
  if (!token || !/^[a-f0-9-]{32,64}$/i.test(token)) {
    token = crypto.randomUUID();
    localStorage.setItem('sparfuchs_device_token', token);
  }
  return token;
}
const historyHeaders = () => ({ 'X-Sparfuchs-Device': getHistoryDeviceToken() });

// Sanitize every dynamic HTML fragment before adding it to the page. This also
// covers retailer data, saved lists, imported QR baskets and recipe metadata.
function sanitizeHtml(input, ...values) {
  const html = Array.isArray(input) && Object.prototype.hasOwnProperty.call(input, 'raw')
    ? input.reduce((out, part, index) => out + part + (index < values.length ? String(values[index] ?? '') : ''), '')
    : String(input ?? '');
  const template = document.createElement('template');
  template.innerHTML = html;
  const blocked = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'BASE', 'META', 'LINK', 'FORM', 'SVG', 'MATH', 'TEMPLATE']);
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT);
  const elementsToRemove = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (blocked.has(node.tagName)) {
      elementsToRemove.push(node);
      continue;
    }
    for (const attr of [...node.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (name.startsWith('on') || ['srcdoc', 'srcset', 'formaction', 'action', 'xlink:href', 'xmlns', 'is'].includes(name)) {
        node.removeAttribute(attr.name);
      } else if (name === 'style' && /url\s*\(|expression\s*\(|@import/i.test(value)) {
        node.removeAttribute(attr.name);
      } else if (['href', 'src'].includes(name) && !/^(https?:|data:image\/(?:png|jpeg|webp|gif);base64,|\/|#)/i.test(value)) {
        node.removeAttribute(attr.name);
      }
    }
  }
  for (const node of elementsToRemove) node.remove();
  return template.innerHTML;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function safeView(record) {
  const copy = { ...record };
  for (const key of ['id', 'title', 'brand', 'retailer', 'description', 'packageSize', 'formattedPrice',
    'formattedOldPrice', 'formattedRefPrice', 'categoryLabel', 'categoryIcon', 'imageUrl']) {
    if (typeof copy[key] === 'string') copy[key] = escapeHtml(copy[key]);
  }
  return copy;
}

function readStoredJson(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || 'null');
    return Array.isArray(fallback) ? (Array.isArray(parsed) ? parsed : fallback) : (parsed ?? fallback);
  } catch {
    return fallback;
  }
}

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
  // Basket stores items with retailer, price & quantity: [{ id, title, retailer, price, formattedPrice, quantity, checked }]
  basket: readStoredJson('sparfuchs_basket_v2', []).filter(item => item && typeof item === 'object').map(item => ({
    ...item,
    quantity: (typeof item.quantity === 'number' && item.quantity > 0) ? item.quantity : 1,
  })),
  // Favorites store array of strings / keywords
  favorites: readStoredJson('sparfuchs_favorites', []).filter(v => typeof v === 'string'),
  radarDismissed: false,
  // Shopping list history & household stats
  history: readStoredJson('sparfuchs_history', []).filter(v => v && typeof v === 'object'),
  householdStats: null,
  offers: [],
  offerSources: [],
  isLoading: false,
  activeShareUrl: '',
  incomingSharedBasket: null,
  // Update v2.0 State
  minDiscount: 0,
  activeStores: readStoredJson('sparfuchs_active_stores', []),
  selectedMarkets: readStoredJson('sparfuchs_selected_markets', []).filter(m => m && typeof m === 'object' && typeof m.chain === 'string'),
  nearbyMarkets: [],
  tableSort: { key: 'refPrice', dir: 'asc' },
  dealSwapTargetItem: null,
  recipeIngredients: [],
  // Phase 2 & 3 State
  storeMode: false,
  wakeLock: null,
  aisleSort: false,
  budget: parseFloat(localStorage.getItem('sparfuchs_budget') || '0'),
  searchHistory: readStoredJson('sparfuchs_search_history', []).filter(v => typeof v === 'string'),
  basketTemplates: readStoredJson('sparfuchs_basket_templates', []).filter(t => t && typeof t === 'object' && Array.isArray(t.items)),
  extraStoreCost: Number(localStorage.getItem('sparfuchs_extra_store_cost') || 0),
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

function getVerifiedOldPrice(item) {
  if (!item || item.isEstimatedOldPrice) return null;
  return validateAndSanitizeClientPrice(item.price, item.oldPrice, item.isNonFood);
}

// DOM Elements
const elements = {
  plzInput: document.getElementById('plzInput'),
  plzUpdateBtn: document.getElementById('plzUpdateBtn'),
  allOffersTag: document.getElementById('allOffersTag'),
  favCountBadge: document.getElementById('favCountBadge'),
  favoritesSearchTag: document.getElementById('favoritesSearchTag'),
  openHistoryBtn: document.getElementById('openHistoryBtn'),
  closeHistoryBtn: document.getElementById('closeHistoryBtn'),
  historyDrawer: document.getElementById('historyDrawer'),
  historyCountBadge: document.getElementById('historyCountBadge'),
  bookBasketBtn: document.getElementById('bookBasketBtn'),
  checkoutReviewDialog: document.getElementById('checkoutReviewDialog'),
  checkoutReviewItems: document.getElementById('checkoutReviewItems'),
  cancelCheckoutReviewBtn: document.getElementById('cancelCheckoutReviewBtn'),
  confirmCheckoutReviewBtn: document.getElementById('confirmCheckoutReviewBtn'),
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
  templateNameInput: document.getElementById('templateNameInput'),
  basketTemplateSelect: document.getElementById('basketTemplateSelect'),
  saveBasketTemplateBtn: document.getElementById('saveBasketTemplateBtn'),
  loadBasketTemplateBtn: document.getElementById('loadBasketTemplateBtn'),
  deleteBasketTemplateBtn: document.getElementById('deleteBasketTemplateBtn'),
  basketGroupedContainer: document.getElementById('basketGroupedContainer'),
  basketTotalBar: document.getElementById('basketTotalBar'),
  basketGrandTotal: document.getElementById('basketGrandTotal'),
  basketSavingsRow: document.getElementById('basketSavingsRow'),
  basketTotalSavings: document.getElementById('basketTotalSavings'),
  basketSavingsPercentBadge: document.getElementById('basketSavingsPercentBadge'),
  basketSavingsNote: document.getElementById('basketSavingsNote'),
  optimizeBasketBtn: document.getElementById('optimizeBasketBtn'),
  extraStoreCostInput: document.getElementById('extraStoreCostInput'),
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
  resultsSources: document.getElementById('resultsSources'),
  activeTagPills: document.getElementById('activeTagPills'),
  loadingSpinner: document.getElementById('loadingSpinner'),
  emptyState: document.getElementById('emptyState'),
  emptyStateText: document.getElementById('emptyStateText'),
  offersGrid: document.getElementById('offersGrid'),
  offersTableContainer: document.getElementById('offersTableContainer'),
  offersTableBody: document.getElementById('offersTableBody'),
  toast: document.getElementById('toast'),
  // Favoriten-Radar (Deal-Alarm)
  favoritesRadarContainer: document.getElementById('favoritesRadarContainer'),
  radarTitleText: document.getElementById('radarTitleText'),
  radarCardsGrid: document.getElementById('radarCardsGrid'),
  closeRadarBtn: document.getElementById('closeRadarBtn'),
  // Einkaufsliste Toolbar (Teilen, QR-Code & Leeren)
  headerQrBtn: document.getElementById('headerQrBtn'),
  shareBasketBtn: document.getElementById('shareBasketBtn'),
  qrBasketBtn: document.getElementById('qrBasketBtn'),
  basketBottomQrBtn: document.getElementById('basketBottomQrBtn'),
  clearBasketBtn: document.getElementById('clearBasketBtn'),
  // Vorrats-Kalkulator / Jahres-Projektion
  kpiAnnualSavings: document.getElementById('kpiAnnualSavings'),
  kpiMonthlySavings: document.getElementById('kpiMonthlySavings'),
  kpiAvgSavingsPerTrip: document.getElementById('kpiAvgSavingsPerTrip'),
  // QR-Code Transfer & Smartphone Import
  qrTransferModal: document.getElementById('qrTransferModal'),
  closeQrModalBtn: document.getElementById('closeQrModalBtn'),
  qrCodeImg: document.getElementById('qrCodeImg'),
  qrCodeSpinner: document.getElementById('qrCodeSpinner'),
  qrItemCountBadge: document.getElementById('qrItemCountBadge'),
  qrExpiresText: document.getElementById('qrExpiresText'),
  copyShareLinkBtn: document.getElementById('copyShareLinkBtn'),
  copyShareLinkText: document.getElementById('copyShareLinkText'),
  openMobileLinkBtn: document.getElementById('openMobileLinkBtn'),
  importBasketModal: document.getElementById('importBasketModal'),
  closeImportModalBtn: document.getElementById('closeImportModalBtn'),
  importModalSummary: document.getElementById('importModalSummary'),
  importItemsPreview: document.getElementById('importItemsPreview'),
  confirmImportAppendBtn: document.getElementById('confirmImportAppendBtn'),
  confirmImportReplaceBtn: document.getElementById('confirmImportReplaceBtn'),
  // Update v2.0 DOM Elements
  openStoresBtn: document.getElementById('openStoresBtn'),
  storesCountBadge: document.getElementById('storesCountBadge'),
  storesModal: document.getElementById('storesModal'),
  closeStoresModalBtn: document.getElementById('closeStoresModalBtn'),
  selectedMarketsList: document.getElementById('selectedMarketsList'),
  marketChainSelect: document.getElementById('marketChainSelect'),
  marketSearchZipInput: document.getElementById('marketSearchZipInput'),
  marketMap: document.getElementById('marketMap'),
  searchMapAreaBtn: document.getElementById('searchMapAreaBtn'),
  marketRadiusSelect: document.getElementById('marketRadiusSelect'),
  findNearbyMarketsBtn: document.getElementById('findNearbyMarketsBtn'),
  nearbyMarketsStatus: document.getElementById('nearbyMarketsStatus'),
  nearbyMarketsList: document.getElementById('nearbyMarketsList'),
  saveStoresBtn: document.getElementById('saveStoresBtn'),
  openFavHubBtn: document.getElementById('openFavHubBtn'),
  favHubModal: document.getElementById('favHubModal'),
  closeFavHubModalBtn: document.getElementById('closeFavHubModalBtn'),
  addGenericFavForm: document.getElementById('addGenericFavForm'),
  genericFavInput: document.getElementById('genericFavInput'),
  favListContainer: document.getElementById('favListContainer'),
  dealSwapModal: document.getElementById('dealSwapModal'),
  closeDealSwapModalBtn: document.getElementById('closeDealSwapModalBtn'),
  swapCurrentItemBox: document.getElementById('swapCurrentItemBox'),
  swapAlternativesList: document.getElementById('swapAlternativesList'),
  insertFavsToOptBtn: document.getElementById('insertFavsToOptBtn'),
  recipeUrlInput: document.getElementById('recipeUrlInput'),
  recipeParseBtn: document.getElementById('recipeParseBtn'),
  recipeParseSpinner: document.getElementById('recipeParseSpinner'),
  recipeResultPreview: document.getElementById('recipeResultPreview'),
  drawerResizeHandle: document.getElementById('drawerResizeHandle'),
  recipeImportCard: document.getElementById('recipeImportCard'),
  recipeHeaderToggle: document.getElementById('recipeHeaderToggle'),
  btnToggleRecipeCard: document.getElementById('btnToggleRecipeCard'),
  recipeCountBadge: document.getElementById('recipeCountBadge'),
  // Supermarkt-Modus & Laufweg
  toggleStoreModeBtn: document.getElementById('toggleStoreModeBtn'),
  storeModeBtnText: document.getElementById('storeModeBtnText'),
  storeModeLiveBar: document.getElementById('storeModeLiveBar'),
  liveBarCheckedCount: document.getElementById('liveBarCheckedCount'),
  liveBarCheckedAmount: document.getElementById('liveBarCheckedAmount'),
  exitStoreModeBtn: document.getElementById('exitStoreModeBtn'),
  toggleAisleSortBtn: document.getElementById('toggleAisleSortBtn'),
  aisleSortText: document.getElementById('aisleSortText'),
  // Budget & Pfand
  basketBudgetInput: document.getElementById('basketBudgetInput'),
  basketBudgetBarBox: document.getElementById('basketBudgetBarBox'),
  budgetStatusText: document.getElementById('budgetStatusText'),
  budgetPercentPill: document.getElementById('budgetPercentPill'),
  budgetProgressFill: document.getElementById('budgetProgressFill'),
  basketDepositRow: document.getElementById('basketDepositRow'),
  basketTotalDeposit: document.getElementById('basketTotalDeposit'),
  basketGrandTotalWithDepositRow: document.getElementById('basketGrandTotalWithDepositRow'),
  basketGrandTotalWithDeposit: document.getElementById('basketGrandTotalWithDeposit'),
  printBasketBtn: document.getElementById('printBasketBtn'),
  // Suchverlauf & Export
  searchHistoryRow: document.getElementById('searchHistoryRow'),
  searchHistoryChips: document.getElementById('searchHistoryChips'),
  clearSearchHistoryBtn: document.getElementById('clearSearchHistoryBtn'),
  exportCsvBtn: document.getElementById('exportCsvBtn'),
  exportHistoryJsonBtn: document.getElementById('exportHistoryJsonBtn'),
  importHistoryJsonBtn: document.getElementById('importHistoryJsonBtn'),
  importHistoryFileInput: document.getElementById('importHistoryFileInput'),
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
 * Ermittelt Dringlichkeits-Informationen für Angebote ("Nur noch heute!", "Endet morgen!")
 */
function getUrgencyBadgeInfo(validTo, validFrom) {
  if (!validTo) return null;
  const now = new Date();
  const to = new Date(validTo);
  if (isNaN(to.getTime())) return null;

  // Zukünftiges Angebot (z.B. ab Donnerstag)
  if (validFrom) {
    const from = new Date(validFrom);
    if (!isNaN(from.getTime()) && from > now) {
      return {
        className: 'urgent-upcoming',
        label: `Ab ${formatShortDate(validFrom)}`,
        icon: '🗓️',
      };
    }
  }

  const diffMs = to.getTime() - now.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours <= 0) {
    return {
      className: 'urgent-today',
      label: 'Läuft heute ab!',
      icon: '⏰',
    };
  } else if (diffHours <= 24) {
    return {
      className: 'urgent-today',
      label: 'Nur noch heute!',
      icon: '🔥',
    };
  } else if (diffHours <= 48) {
    return {
      className: 'urgent-tomorrow',
      label: 'Endet morgen!',
      icon: '⏳',
    };
  }
  return null;
}

/**
 * Erkennt automatisch deutsches Einweg- und Mehrwegpfand für Getränke
 */
function detectDepositClient(item) {
  if (!item) return 0;
  const text = `${item.title || ''} ${item.description || ''} ${item.packageSize || ''}`.toLowerCase();

  // Nicht-Getränke ausschließen
  if (/(suppe|ravioli|gulasch|eintopf|bohne|erbse|mais|thunfisch|tomat|tierfutter|hundefutter|katzenfutter|farbdose|lack)/i.test(text)) {
    return 0;
  }

  // 1. Getränkekästen / Kisten
  if (/\b(kasten|kiste)\b/i.test(text)) {
    if (/\bbügel/i.test(text)) return 4.50;
    if (/\b(wasser|mineralwasser|sprudel)\b/i.test(text)) return 3.30;
    return 3.10;
  }

  // 2. Sixpack / Gebinde
  const sixMatch = text.match(/\b(?:6\s*[xX*]\s*0,[35]|sixpack|6er\s*träger)\b/i);
  if (sixMatch) {
    if (/\b(dose|dosen|can|energy|cola|pepsi)\b/i.test(text)) return 1.50;
    return 0.48;
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
    return 0.08;
  }

  // 7. Allgemeine Glasflaschen Mehrweg (0,15 €)
  if (/\b(mehrweg|brunnen|quelle|mineralwasser|saft)\b/i.test(text) && /\bglas\b/i.test(text)) {
    return 0.15;
  }

  return 0;
}

/**
 * Supermarkt-Gänge Zuordnung & Laufweg
 */
const AISLE_ORDER_MAP = {
  produce: { order: 1, label: 'Obst & Gemüse', icon: '🍎' },
  meat: { order: 2, label: 'Fleisch & Frische', icon: '🥩' },
  dairy: { order: 3, label: 'Kühlregal & Molkerei', icon: '🧀' },
  pantry: { order: 4, label: 'Vorrat & Grundnahrung', icon: '🍝' },
  snacks: { order: 5, label: 'Süßes & Snacks', icon: '🍫' },
  drinks: { order: 6, label: 'Kaffee & Getränke', icon: '☕' },
  nonfood: { order: 7, label: 'Drogerie & Aktionsware', icon: '📦' },
  other: { order: 8, label: 'Sonstiges', icon: '🛒' },
};

function getItemAisle(item) {
  if (!item) return { id: 'other', ...AISLE_ORDER_MAP.other };
  if (item.categoryId && AISLE_ORDER_MAP[item.categoryId]) {
    return { id: item.categoryId, ...AISLE_ORDER_MAP[item.categoryId] };
  }
  const text = `${item.title || ''} ${item.description || ''}`.toLowerCase();
  if (/(apfel|banan|tomat|gurk|kartoffel|salat|beere|möhre|karotte|avocado|zwiebel|orange|zitron)/i.test(text)) {
    return { id: 'produce', ...AISLE_ORDER_MAP.produce };
  }
  if (/(fleisch|hack|steak|schnitzel|wurst|salami|schinken|hähnchen|huhn|lachs|fisch|tofu)/i.test(text)) {
    return { id: 'meat', ...AISLE_ORDER_MAP.meat };
  }
  if (/(milch|butter|käse|joghurt|quark|sahne|eier|frischkäse|skyr|gouda)/i.test(text)) {
    return { id: 'dairy', ...AISLE_ORDER_MAP.dairy };
  }
  if (/(kaffee|espresso|tee|wasser|bier|cola|limo|saft|wein|sekt|drink)/i.test(text)) {
    return { id: 'drinks', ...AISLE_ORDER_MAP.drinks };
  }
  if (/(schoko|chips|keks|eis|gummi|haribo|knoppers|hanuta)/i.test(text)) {
    return { id: 'snacks', ...AISLE_ORDER_MAP.snacks };
  }
  if (/(nudel|pasta|spaghetti|reis|mehl|zucker|öl|essig|sauce|ketchup|brot|toast|brötchen|hafer)/i.test(text)) {
    return { id: 'pantry', ...AISLE_ORDER_MAP.pantry };
  }
  if (/(drogerie|shampoo|seife|zahnpasta|deo|waschmittel|spülmittel|klopapier|küchenrolle|werkzeug|deko|tierfutter)/i.test(text) || item.isNonFood) {
    return { id: 'nonfood', ...AISLE_ORDER_MAP.nonfood };
  }
  return { id: 'other', ...AISLE_ORDER_MAP.other };
}

/**
 * Schaltet den Supermarkt-Modus um (Screen Wake Lock, Fokus-Ansicht & Daumen-Bedienung)
 */
async function toggleStoreMode() {
  state.storeMode = !state.storeMode;
  document.body.classList.toggle('store-mode-active', state.storeMode);

  if (elements.toggleStoreModeBtn) {
    elements.toggleStoreModeBtn.classList.toggle('active', state.storeMode);
  }
  if (elements.storeModeBtnText) {
    elements.storeModeBtnText.textContent = state.storeMode ? 'Markt-Modus An' : 'Markt-Modus';
  }

  if (state.storeMode) {
    if ('wakeLock' in navigator) {
      try {
        state.wakeLock = await navigator.wakeLock.request('screen');
        state.wakeLock.addEventListener('release', () => {
          if (!state.storeMode) state.wakeLock = null;
        });
      } catch (err) {
        console.warn('Wake Lock konnte nicht aktiviert werden:', err);
      }
    }
    showToast('🛒 Supermarkt-Modus aktiv: Display bleibt an!');
  } else {
    if (state.wakeLock) {
      try {
        await state.wakeLock.release();
      } catch (_) {}
      state.wakeLock = null;
    }
    showToast('Supermarkt-Modus beendet.');
  }

  renderBasket();
}

/**
 * Fügt einen Suchbegriff zum Verlauf der letzten Suchen hinzu
 */
function addQueryToSearchHistory(q) {
  if (!q || q.trim().length < 2) return;
  const clean = q.trim();
  state.searchHistory = (state.searchHistory || []).filter(item => item.toLowerCase() !== clean.toLowerCase());
  state.searchHistory.unshift(clean);
  if (state.searchHistory.length > 6) {
    state.searchHistory = state.searchHistory.slice(0, 6);
  }
  localStorage.setItem('sparfuchs_search_history', JSON.stringify(state.searchHistory));
  renderSearchHistoryChips();
}

/**
 * Rendert die Klick-Chips der letzten Suchbegriffe
 */
function renderSearchHistoryChips() {
  if (!elements.searchHistoryRow || !elements.searchHistoryChips) return;
  if (!state.searchHistory || state.searchHistory.length === 0) {
    elements.searchHistoryRow.style.display = 'none';
    return;
  }
  elements.searchHistoryRow.style.display = 'flex';
  elements.searchHistoryChips.innerHTML = sanitizeHtml(state.searchHistory.map(term => {
    return `<button type="button" class="history-chip" data-query="${escapeHtml(term)}">${escapeHtml(term)}</button>`;
  }).join(''));

  elements.searchHistoryChips.querySelectorAll('.history-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const q = chip.getAttribute('data-query');
      elements.searchInput.value = q;
      elements.clearSearchBtn.style.display = 'block';
      state.query = q;
      state.onlyFavorites = false;
      elements.toggleFavFilterBtn.classList.remove('active');
      fetchOffers();
    });
  });
}

/**
 * Exportiert die verbuchte Haushalts-Historie als CSV (für Excel & Tabellen-Kalkulation)
 */
function exportHistoryAsCsv() {
  if (!state.history || state.history.length === 0) {
    showToast('⚠️ Keine verbuchten Einkäufe zum Exportieren vorhanden.');
    return;
  }

  const rows = [];
  rows.push(['Datum', 'Uhrzeit', 'Supermarkt', 'Artikel', 'Menge', 'Einzelpreis (€)', 'Gesamtpreis (€)', 'Gespart (€)'].join(';'));

  state.history.forEach(receipt => {
    const dateObj = new Date(receipt.date);
    const dateStr = !isNaN(dateObj.getTime())
      ? `${String(dateObj.getDate()).padStart(2, '0')}.${String(dateObj.getMonth() + 1).padStart(2, '0')}.${dateObj.getFullYear()}`
      : (receipt.date || '');
    const timeStr = !isNaN(dateObj.getTime())
      ? `${String(dateObj.getHours()).padStart(2, '0')}:${String(dateObj.getMinutes()).padStart(2, '0')}`
      : '';

    const storeStr = Array.isArray(receipt.stores) ? receipt.stores.join(' + ') : 'Supermarkt';

    if (Array.isArray(receipt.items) && receipt.items.length > 0) {
      receipt.items.forEach(it => {
        const title = (it.title || '').replace(/;/g, ',');
        const store = (it.retailer || storeStr).replace(/;/g, ',');
        const qty = it.quantity || 1;
        const price = (typeof it.price === 'number') ? it.price.toFixed(2).replace('.', ',') : '0,00';
        const lineTotal = (typeof it.price === 'number') ? (it.price * qty).toFixed(2).replace('.', ',') : '0,00';
        const lineSavings = (typeof it.oldPrice === 'number' && it.oldPrice > it.price)
          ? ((it.oldPrice - it.price) * qty).toFixed(2).replace('.', ',') : '0,00';

        rows.push([dateStr, timeStr, store, title, qty, price, lineTotal, lineSavings].map(safeCsvCell).join(';'));
      });
    } else {
      const paid = (receipt.totalPaid || 0).toFixed(2).replace('.', ',');
      const sav = (receipt.totalSavings || 0).toFixed(2).replace('.', ',');
      rows.push([dateStr, timeStr, storeStr, 'Gesamter Einkauf', receipt.itemCount || 1, paid, paid, sav].map(safeCsvCell).join(';'));
    }
  });

  const csvContent = '\uFEFF' + rows.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `SparFuchs-Einkaufshistorie-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('📥 Einkaufshistorie erfolgreich als CSV heruntergeladen!');
}

function safeCsvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function exportHistoryJson() {
  const blob = new Blob([JSON.stringify({ version: 1, history: state.history }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `SparFuchs-Backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function importHistoryJson(file) {
  if (!file || file.size > 2_000_000) {
    showToast('Backup-Datei fehlt oder ist zu groß.');
    return;
  }
  try {
    const parsed = JSON.parse(await file.text());
    if (parsed.version !== 1 || !Array.isArray(parsed.history) || parsed.history.length > 2000) {
      throw new Error('Ungültiges Backup');
    }
    const receipts = parsed.history.filter(r => r && typeof r.id === 'string' && typeof r.date === 'string' && Array.isArray(r.items));
    const merged = new Map([...state.history, ...receipts].map(r => [r.id, r]));
    const response = await fetch('/api/history/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...historyHeaders() },
      body: JSON.stringify({ clientHistory: [...merged.values()] }),
    });
    if (!response.ok) throw new Error('Synchronisierung fehlgeschlagen');
    const data = await response.json();
    state.history = data.history;
    state.householdStats = data.stats;
    localStorage.setItem('sparfuchs_history', JSON.stringify(state.history));
    renderHistoryUI(state.householdStats, state.history);
    updateHistoryBadge();
    showToast(`${receipts.length} Belege aus Backup gelesen.`);
  } catch (error) {
    showToast(`Backup konnte nicht geladen werden: ${error.message}`);
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
    state.radarDismissed = false; // Wieder anzeigen wenn neue Favoriten hinzukommen
  }

  saveFavorites();
  renderFavoritesBadge();
  renderOffers(state.offers);
  updateFavoritesRadar(state.offers);
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

  container.innerHTML = sanitizeHtml(pills.join(''));

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
let offersRequestId = 0;
let offersAbortController = null;
async function fetchOffers() {
  const requestId = ++offersRequestId;
  offersAbortController?.abort();
  offersAbortController = new AbortController();
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

    if (state.minDiscount && state.minDiscount > 0) {
      params.append('minDiscount', String(state.minDiscount));
    }

    if (Array.isArray(state.activeStores) && state.activeStores.length > 0) {
      params.append('activeRetailers', state.activeStores.join(','));
    }

    const response = await fetch(`/api/offers?${params.toString()}`, { signal: offersAbortController.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    if (requestId !== offersRequestId) return;
    state.offers = data.offers || [];
    state.offerSources = Array.isArray(data.sources) ? data.sources : [];

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
    elements.resultsCount.textContent = `${data.filteredCount} Treffer für PLZ ${state.zip}`;
    if (elements.resultsSources) {
      const reports = Array.isArray(data.sources) ? data.sources : [];
      const details = reports.map(s => {
        const fetched = s.lastFetchedAt ? new Date(s.lastFetchedAt).toLocaleString('de-DE') : 'unbekannt';
        return `${s.source}: ${s.count} (${s.scope}, Datenabruf ${fetched}${s.status === 'unavailable' ? ', nicht erreichbar' : s.status === 'partial' ? ', teils erreichbar' : ''})`;
      });
      elements.resultsSources.textContent = details.length
        ? `Quellen: ${details.join(' · ')}. Kettenangebote sind nicht für eine gewählte Filiale bestätigt.`
        : 'Keine Angebotsquelle hat Daten geliefert.';
    }

    renderOffers(state.offers);
  } catch (error) {
    if (requestId !== offersRequestId || error.name === 'AbortError') return;
    console.error('Fehler beim Laden:', error);
    showToast('⚠️ Fehler beim Abrufen der Angebote');
  } finally {
    if (requestId === offersRequestId) {
      state.isLoading = false;
      elements.loadingSpinner.style.display = 'none';
    }
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
    } else if (state.offerSources.length && state.offerSources.every(source => source.status === 'unavailable' || source.count === 0)) {
      elements.emptyStateText.textContent = 'Die Angebotsquellen liefern gerade keine Treffer. Versuche es später erneut oder prüfe eine andere Suche.';
    } else {
      elements.emptyStateText.textContent = 'Probiere einen anderen Suchbegriff oder passe deine Filter an.';
    }
    return;
  }
  offers = offers.map(safeView);
  elements.emptyState.style.display = 'none';

  // Finde das Angebot mit dem absolut niedrigsten Grundpreis
  const pricedOffers = offers.filter(o => typeof o.referencePrice === 'number' && o.referencePrice > 0);
  const comparable = Boolean(state.query && pricedOffers.length >= 2 &&
    new Set(pricedOffers.map(o => o.referenceUnit)).size === 1 &&
    new Set(pricedOffers.map(o => o.categoryId)).size === 1);
  const minRefPrice = comparable ? Math.min(...pricedOffers.map(o => o.referencePrice)) : Infinity;

  // 1. Grid Cards
  const gridHtml = offers.map(offer => {
    const isBestRef = (offer.referencePrice && offer.referencePrice === minRefPrice);
    const validToStr = formatShortDate(offer.validTo);
    const fallbackImage = `https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=400&q=80`;
    const cleanTitle = (offer.title || '').replace(/\bthisisnobrand123\b/gi, '').trim();
    const cleanBrand = offer.brand ? (offer.brand.toLowerCase() === 'thisisnobrand123' ? 'Eigenmarke' : offer.brand) : '';
    const favActive = isFavorite(cleanTitle, cleanBrand);

    return `
      <div class="offer-card ${isBestRef ? 'best-ref-price' : ''}" data-id="${offer.id}">
        <div class="card-image-box">
          <span class="badge-retailer" data-retailer="${offer.retailer}">${offer.retailer}</span>
          
          <!-- Favorite Star Button -->
          <button class="btn-card-fav ${favActive ? 'favorited' : ''}" title="Zu Favoriten hinzufügen" data-title="${cleanTitle.replace(/"/g, '&quot;')}">
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
            alt="${cleanTitle}" 
            loading="lazy"
            onerror="this.src='${fallbackImage}'"
          >
        </div>
        
        <div class="card-body">
          ${cleanBrand ? `<div class="card-brand">${cleanBrand}</div>` : ''}
          <h3 class="card-title" title="${cleanTitle}">${cleanTitle}</h3>
          <p class="card-desc" title="${offer.description}">${offer.description || offer.packageSize || ''}</p>
          
          <div class="card-pricing">
            <div class="price-row">
              <div class="price-stack">
                <div class="price-main-line">
                  <span class="price-main">${offer.formattedPrice}</span>
                  ${offer.formattedOldPrice ? `
                    <span class="price-old" title="${offer.isEstimatedOldPrice ? 'Geschätzter Vergleichspreis, keine belegte Ersparnis' : 'Statt-Preis'}">
                      ${offer.isEstimatedOldPrice ? 'Vergleich ~' : 'statt '}${offer.formattedOldPrice}
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
                <div class="badge-grundpreis ${isBestRef ? 'highlight' : ''}" title="${offer.referencePriceSource === 'package' ? 'Aus Packungsgröße berechnet' : 'Grundpreis aus Angebotsquelle'}">
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
            ${(() => {
              const urgency = getUrgencyBadgeInfo(offer.validTo, offer.validFrom);
              return urgency ? `
                <div class="deal-urgency-badge ${urgency.className}">
                  <span>${urgency.icon}</span>
                  <span>${urgency.label}</span>
                </div>
              ` : '';
            })()}

            <button class="btn-card-add" 
              data-id="${offer.id}"
              data-title="${cleanTitle.replace(/"/g, '&quot;')}"
              data-retailer="${offer.retailer.replace(/"/g, '&quot;')}"
              data-price="${offer.price}"
              data-formatted-price="${offer.formattedPrice}"
              data-old-price="${offer.oldPrice || ''}"
              data-formatted-old-price="${offer.formattedOldPrice || ''}"
              data-estimated-old-price="${offer.isEstimatedOldPrice ? 'true' : 'false'}"
              data-image-url="${offer.imageUrl || ''}">
              <span>➕ Auf Einkaufsliste (${offer.retailer})</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  elements.offersGrid.innerHTML = sanitizeHtml(gridHtml);

  // 2. Table Rows erstellen
  const tableHtml = offers.map(offer => {
    const isBestRef = (offer.referencePrice && offer.referencePrice === minRefPrice);
    const validToStr = formatShortDate(offer.validTo);
    const fallbackImage = `https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=100&q=80`;
    const cleanTitle = (offer.title || '').replace(/\bthisisnobrand123\b/gi, '').trim();
    const cleanBrand = offer.brand ? (offer.brand.toLowerCase() === 'thisisnobrand123' ? 'Eigenmarke' : offer.brand) : '';
    const favActive = isFavorite(cleanTitle, cleanBrand);

    return `
      <tr>
        <td>
          <button class="btn-table-fav ${favActive ? 'favorited' : ''}" data-title="${cleanTitle.replace(/"/g, '&quot;')}">
            ⭐
          </button>
        </td>
        <td>
          <div class="table-product-cell">
            <img class="table-img" src="${offer.imageUrl || fallbackImage}" alt="${cleanTitle}" onerror="this.src='${fallbackImage}'">
            <div>
              <div class="table-product-title">${cleanTitle}</div>
              <div class="table-product-brand">${cleanBrand || offer.packageSize || ''}</div>
            </div>
          </div>
        </td>
        <td><strong>${offer.retailer}</strong></td>
        <td>
          <div class="table-price-stack">
            <strong class="table-price-main">${offer.formattedPrice}</strong>
            ${offer.formattedOldPrice ? `
              <div class="table-price-old-line">
                <span class="table-price-old" title="${offer.isEstimatedOldPrice ? 'Geschätzter Vergleichspreis, keine belegte Ersparnis' : 'Statt-Preis'}">
                  ${offer.isEstimatedOldPrice ? 'Vergleich ~' : 'statt '}${offer.formattedOldPrice}
                </span>
                ${offer.discountPercent ? `<span class="table-price-discount">(-${offer.discountPercent}%)</span>` : ''}
              </div>
            ` : ''}
          </div>
        </td>
        <td class="table-refprice-cell">
          ${isBestRef ? '🏆 ' : ''}${offer.formattedRefPrice || '—'}${offer.referencePriceSource === 'package' ? ' (berechnet)' : ''}
        </td>
        <td>
          <div style="display:flex; gap:0.25rem;">
            ${offer.isBio ? `<span class="badge-tag bio">🌱</span>` : ''}
            ${offer.isNonFood ? `<span class="badge-tag nonfood">📦</span>` : ''}
            ${offer.discountPercent ? `<span class="savings-tag">-${offer.discountPercent}%</span>` : ''}
          </div>
        </td>
        <td>
          <div>${validToStr || 'Aktuell'}</div>
          ${(() => {
            const urgency = getUrgencyBadgeInfo(offer.validTo, offer.validFrom);
            return urgency ? `<div class="deal-urgency-badge ${urgency.className}" style="font-size:0.68rem; padding:0.12rem 0.4rem; margin-top:0.25rem;">${urgency.icon} ${urgency.label}</div>` : '';
          })()}
        </td>
        <td>
          <button class="btn-card-add" style="margin:0; padding:0.4rem 0.7rem;" 
            data-id="${offer.id}"
            data-title="${cleanTitle.replace(/"/g, '&quot;')}"
            data-retailer="${offer.retailer.replace(/"/g, '&quot;')}"
            data-price="${offer.price}"
            data-formatted-price="${offer.formattedPrice}"
            data-old-price="${offer.oldPrice || ''}"
            data-formatted-old-price="${offer.formattedOldPrice || ''}"
            data-estimated-old-price="${offer.isEstimatedOldPrice ? 'true' : 'false'}"
            data-image-url="${offer.imageUrl || ''}">
            ➕ ${offer.retailer}
          </button>
        </td>
      </tr>
    `;
  }).join('');

  elements.offersTableBody.innerHTML = sanitizeHtml(tableHtml);

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
        imageUrl: btn.getAttribute('data-image-url') || null,
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

  // Favoriten-Radar aktualisieren (Deal-Alarm)
  updateFavoritesRadar(offers);
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

    elements.categoryChips.innerHTML = sanitizeHtml(chipsHtml);

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
 * Warenkorb Verwaltung (Supermarkt-Gruppiert mit Mengen-Auswahl!)
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
      imageUrl: null,
      quantity: 1,
      checked: false,
    };
  } else {
    item = {
      ...itemOrTitle,
      imageUrl: itemOrTitle.imageUrl || null,
      quantity: (typeof itemOrTitle.quantity === 'number' && itemOrTitle.quantity > 0) ? itemOrTitle.quantity : 1,
    };
  }

  if (!item.title) return;

  // Prüfen ob bereits exakt dieses Angebot auf der Liste ist -> Menge erhöhen!
  const existingIdx = state.basket.findIndex(b => b.id === item.id || (b.title === item.title && b.retailer === item.retailer));
  if (existingIdx !== -1) {
    state.basket[existingIdx].quantity = (state.basket[existingIdx].quantity || 1) + (item.quantity || 1);
    saveBasket();
    renderBasket();
    showToast(`➕ Menge erhöht: "${item.title}" (${state.basket[existingIdx].quantity}x)`);
  } else {
    state.basket.push(item);
    saveBasket();
    renderBasket();
    showToast(`✅ "${item.title}" (${item.retailer}) hinzugefügt!`);
  }
}

function renderBasketTemplates() {
  const select = elements.basketTemplateSelect;
  if (!select) return;
  select.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Gespeicherte Listen';
  select.append(placeholder);
  for (const template of state.basketTemplates) {
    const option = document.createElement('option');
    option.value = template.id;
    option.textContent = `${template.name} (${template.items.length})`;
    select.append(option);
  }
}

function saveBasketTemplate() {
  const name = elements.templateNameInput?.value.trim();
  if (!name || !state.basket.length) {
    showToast('Name und Artikel für eine Vorlage eingeben.');
    return;
  }
  const items = state.basket.map(it => ({ title: it.title, quantity: it.quantity || 1 }));
  const existing = state.basketTemplates.find(t => t.name.toLowerCase() === name.toLowerCase());
  if (existing) existing.items = items;
  else state.basketTemplates.push({ id: crypto.randomUUID(), name, items });
  localStorage.setItem('sparfuchs_basket_templates', JSON.stringify(state.basketTemplates));
  renderBasketTemplates();
  elements.templateNameInput.value = '';
  showToast(`Vorlage „${name}“ gespeichert.`);
}

function loadBasketTemplate() {
  const template = state.basketTemplates.find(t => t.id === elements.basketTemplateSelect?.value);
  if (!template) return;
  for (const it of template.items) {
    const title = String(it.title || '').trim();
    if (!title) continue;
    const quantity = Number.isFinite(it.quantity) && it.quantity > 0 ? it.quantity : 1;
    const existing = state.basket.find(item => item.title.toLowerCase() === title.toLowerCase() && item.price === 0);
    if (existing) existing.quantity += quantity;
    else state.basket.push({ id: crypto.randomUUID(), title, quantity, retailer: 'Einkaufsnotiz (Ohne Festlegung)', price: 0, formattedPrice: '—', checked: false });
  }
  saveBasket();
  renderBasket();
  showToast(`Vorlage „${template.name}“ geladen. Aktuelle Angebote werden gesucht.`);
  optimizeBasket();
}

function deleteBasketTemplate() {
  const id = elements.basketTemplateSelect?.value;
  if (!id) return;
  state.basketTemplates = state.basketTemplates.filter(t => t.id !== id);
  localStorage.setItem('sparfuchs_basket_templates', JSON.stringify(state.basketTemplates));
  renderBasketTemplates();
}

/**
 * Erhöht oder verringert die Stückzahl eines Artikels im Warenkorb
 */
function updateItemQuantity(id, delta) {
  const item = state.basket.find(i => i.id === id);
  if (!item) return;
  const currentQty = (typeof item.quantity === 'number' && item.quantity > 0) ? item.quantity : 1;
  const newQty = currentQty + delta;
  if (newQty <= 0) {
    removeFromBasket(id);
  } else {
    item.quantity = newQty;
    saveBasket();
    renderBasket();
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

    // Haptisches Feedback auf dem Smartphone
    if (navigator.vibrate) {
      try { navigator.vibrate(18); } catch (_) {}
    }

    renderBasket();
  }
}

function saveBasket() {
  localStorage.setItem('sparfuchs_basket_v2', JSON.stringify(state.basket));
  const totalCount = state.basket.reduce((sum, it) => sum + (it.quantity || 1), 0);
  elements.basketCountBadge.textContent = totalCount;
  if (elements.mobileBasketBadge) {
    elements.mobileBasketBadge.textContent = totalCount;
  }
}

/**
 * Leert den gesamten Einkaufszettel nach Bestätigung
 */
function clearAllBasket() {
  if (!state.basket || state.basket.length === 0) {
    showToast('Dein Einkaufszettel ist bereits leer.');
    return;
  }
  if (confirm('Möchtest du wirklich alle Artikel von deinem Einkaufszettel entfernen?')) {
    state.basket = [];
    saveBasket();
    renderBasket();
    showToast('🗑️ Einkaufszettel vollständig geleert');
  }
}

/**
 * Berechnet die Ersparnis für einen Artikel (direkt oder über sauberen Marktvergleich)
 */
function getItemSavings(item) {
  if (!item || !item.price || item.price <= 0) return 0;
  
  // 1. Echter Streichpreis (validiert)
  const sanitized = getVerifiedOldPrice(item);
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

  return 0;
}

/**
 * Rendert die Einkaufsliste GRUPPIERT nach Supermarkt mit Mengen-Steuerung (+/-),
 * Laufweg-Sortierung nach Gängen, Supermarkt-Modus und automatischer Pfand- & Budget-Kalkulation!
 */
function renderBasket() {
  const totalUnits = state.basket.reduce((sum, it) => sum + (it.quantity || 1), 0);
  elements.basketCountBadge.textContent = totalUnits;
  elements.basketPlzDisplay.textContent = state.zip;

  if (state.basket.length === 0) {
    elements.basketGroupedContainer.innerHTML = `
      <div style="text-align:center; padding: 2rem 1rem; color: var(--text-dim); font-size: 0.9rem;">
        🛒 Deine Einkaufsliste ist noch leer.<br><br>
        Klicke bei einem Angebot auf <strong>„➕ Auf Einkaufsliste“</strong> oder notiere Artikel oben im Textfeld.
      </div>
    `;
    elements.basketTotalBar.style.display = 'none';
    if (elements.storeModeLiveBar) elements.storeModeLiveBar.style.display = 'none';
    if (elements.basketBudgetBarBox) elements.basketBudgetBarBox.style.display = 'none';
    elements.optimizationResultContainer.style.display = 'none';
    return;
  }

  // Gruppiere Artikel nach Supermarkt
  const groups = {};
  let grandTotal = 0;
  let grandOriginalTotal = 0;
  let grandDeposit = 0;
  let checkedCount = 0;
  let checkedAmount = 0;

  state.basket.forEach(item => {
    const store = item.retailer || 'Einkaufsnotizen';
    if (!groups[store]) {
      groups[store] = [];
    }
    groups[store].push(item);
    
    const qty = (typeof item.quantity === 'number' && item.quantity > 0) ? item.quantity : 1;
    const dep = detectDepositClient(item);
    grandDeposit += dep * qty;

    if (item.checked) {
      checkedCount += qty;
      if (typeof item.price === 'number' && item.price > 0) {
        checkedAmount += (item.price + dep) * qty;
      }
    }

    if (typeof item.price === 'number' && item.price > 0) {
      grandTotal += item.price * qty;
      const sanitizedOld = getVerifiedOldPrice(item);
      const effectiveOld = (sanitizedOld && sanitizedOld > item.price)
        ? sanitizedOld : item.price;
      grandOriginalTotal += effectiveOld * qty;
    }
  });

  const grandSavings = Math.max(0, grandOriginalTotal - grandTotal);

  // Helper zum Rendern einer einzelnen Artikel-Zeile
  const renderItemHtml = (rawItem) => {
    const it = safeView(rawItem);
    const qty = (typeof it.quantity === 'number' && it.quantity > 0) ? it.quantity : 1;
    const hasOld = (typeof it.oldPrice === 'number' && it.oldPrice > it.price);
    const oldPriceVal = hasOld ? getVerifiedOldPrice(it) : null;
    const itemSavingsPerUnit = (oldPriceVal && oldPriceVal > it.price) ? (oldPriceVal - it.price) : 0;
    const itemTotalSavings = itemSavingsPerUnit * qty;
    const itemDiscountPct = (oldPriceVal && oldPriceVal > it.price) ? Math.round((itemSavingsPerUnit / oldPriceVal) * 100) : null;
    const lineTotal = (it.price > 0) ? (it.price * qty) : 0;
    const lineTotalFormatted = lineTotal > 0 ? `${lineTotal.toFixed(2).replace('.', ',')} €` : '—';
    const unitPriceFormatted = it.formattedPrice || (it.price > 0 ? `${it.price.toFixed(2).replace('.', ',')} €` : '');
    const cleanTitle = (it.title || '').replace(/\bthisisnobrand123\b/gi, '').trim();
    const betterDealRaw = findBetterDeal(rawItem);
    const betterDeal = betterDealRaw ? safeView(betterDealRaw) : null;
    const itemDeposit = detectDepositClient(rawItem) * qty;
    const aisle = getItemAisle(rawItem);

    return `
      <div class="basket-item-wrapper" data-id="${it.id}">
        <div class="basket-item-row ${it.checked ? 'checked' : ''}" data-id="${it.id}">
          <div class="basket-item-left">
            <input 
              type="checkbox" 
              class="basket-checkbox" 
              data-id="${it.id}" 
              ${it.checked ? 'checked' : ''}
              title="Als erledigt abhaken"
            >
            <div class="basket-item-thumb-col">
              ${it.imageUrl ? `
                <img class="basket-item-img" src="${it.imageUrl}" alt="${cleanTitle.replace(/"/g, '&quot;')}" onerror="this.style.display='none';">
              ` : `
                <div class="basket-item-img-placeholder">🛒</div>
              `}
              <div class="basket-qty-control" title="Stückzahl anpassen">
                <button type="button" class="btn-qty btn-qty-minus" data-id="${it.id}" title="1 weniger">−</button>
                <span class="qty-num">${qty}</span>
                <button type="button" class="btn-qty btn-qty-plus" data-id="${it.id}" title="1 mehr">+</button>
              </div>
            </div>
            <div class="basket-item-info">
              <span class="basket-item-name">${cleanTitle}</span>
              ${state.aisleSort ? `
                <div class="aisle-badge" title="Supermarkt-Gang">
                  <span>${aisle.icon}</span>
                  <span>${aisle.label}</span>
                </div>
              ` : ''}
              ${qty > 1 && it.price > 0 ? `
                <div class="basket-item-single-calc">${qty} × ${unitPriceFormatted}</div>
              ` : ''}
              ${itemDeposit > 0 ? `
                <div class="basket-item-deposit-calc" style="font-size:0.75rem; color:#60a5fa; margin-top:0.15rem;">
                  +${itemDeposit.toFixed(2).replace('.', ',')} € Pfand (${qty > 1 ? `${qty}× ` : ''}${(itemDeposit / qty).toFixed(2).replace('.', ',')} €)
                </div>
              ` : ''}
              ${itemTotalSavings > 0 ? `
                <div class="basket-item-subprice">
                  <span class="basket-item-statt">statt ${(oldPriceVal * qty).toFixed(2).replace('.', ',')} €</span>
                  <span class="basket-item-saving">Du sparst ${itemTotalSavings.toFixed(2).replace('.', ',')} €</span>
                </div>
              ` : ''}
            </div>
          </div>
          <div class="basket-item-right">
            ${it.price > 0 ? `
              <div class="basket-item-price-col">
                <span class="basket-item-price">${lineTotalFormatted}</span>
                ${itemDiscountPct ? `<span class="basket-item-discount-pill">-${itemDiscountPct}%</span>` : ''}
              </div>
            ` : ''}
            <button class="btn-item-del" data-id="${it.id}" title="Entfernen">✕</button>
          </div>
        </div>

        ${it.previousState ? `
          <div class="basket-swapped-notice">
            <span>✅ Getauscht von <em>${it.previousState.title} (${it.previousState.retailer})</em></span>
            <button type="button" class="btn-undo-swap" data-id="${it.id}" title="Ursprünglichen Artikel wiederherstellen">
              ↩️ Rückgängig
            </button>
          </div>
        ` : (betterDeal ? `
          <div class="basket-deal-swap-alert">
            <div class="deal-swap-alert-text">
              💡 <strong>Günstiger bei ${betterDeal.retailer}:</strong> ${betterDeal.title} für <strong>${betterDeal.formattedPrice}</strong>
              ${betterDeal.formattedSavingsVsItem ? `<span class="deal-swap-saving">(Ersparnis: ${betterDeal.formattedSavingsVsItem})</span>` : ''}
            </div>
            <button type="button" class="btn-swap-deal" data-target-id="${it.id}" data-deal-id="${betterDeal.id}" title="Direkt gegen dieses Angebot austauschen">
              🔄 Tauschen
            </button>
          </div>
        ` : '')}
      </div>
    `;
  };

  // HTML für jeden Supermarkt generieren
  const groupHtml = Object.keys(groups).map(store => {
    let items = groups[store];
    const storeOfferTotal = items.reduce((sum, it) => sum + ((it.price || 0) * (it.quantity || 1)), 0);
    const storeOriginalTotal = items.reduce((sum, it) => {
      const qty = it.quantity || 1;
      const sanitizedOld = getVerifiedOldPrice(it);
      if (sanitizedOld && sanitizedOld > it.price) return sum + (sanitizedOld * qty);
      if (it.price > 0) return sum + (it.price * qty);
      return sum;
    }, 0);
    const storeSavings = Math.max(0, storeOriginalTotal - storeOfferTotal);

    const subtotalStr = storeOfferTotal > 0 ? `${storeOfferTotal.toFixed(2).replace('.', ',')} €` : '';
    const oldSubtotalStr = storeOriginalTotal > storeOfferTotal ? `${storeOriginalTotal.toFixed(2).replace('.', ',')} €` : '';
    const savingsStr = storeSavings > 0 ? `${storeSavings.toFixed(2).replace('.', ',')} €` : '';

    // Wenn Laufweg-Sortierung aktiv: nach Abteilungen sortieren
    if (state.aisleSort) {
      items = [...items].sort((a, b) => getItemAisle(a).order - getItemAisle(b).order);
    }

    // Wenn Supermarkt-Modus aktiv: Aufteilung in "Noch zu besorgen" vs "Bereits im Wagen"
    let listContentHtml = '';
    if (state.storeMode) {
      const pendingItems = items.filter(it => !it.checked);
      const doneItems = items.filter(it => it.checked);

      listContentHtml = `
        ${pendingItems.length > 0 ? `
          <div class="store-mode-section-title">
            <span>🛒 Noch zu besorgen (${pendingItems.length})</span>
          </div>
          ${pendingItems.map(renderItemHtml).join('')}
        ` : `
          <div class="store-mode-section-title" style="color:var(--accent-primary);">
            <span>🎉 Alle Artikel bei ${escapeHtml(store)} im Wagen!</span>
          </div>
        `}

        ${doneItems.length > 0 ? `
          <div class="store-mode-section-title" style="margin-top:1rem; opacity:0.8;">
            <span>✅ Im Einkaufswagen (${doneItems.length})</span>
          </div>
          ${doneItems.map(renderItemHtml).join('')}
        ` : ''}
      `;
    } else {
      listContentHtml = items.map(renderItemHtml).join('');
    }

    return `
      <div class="store-group-card" data-store="${escapeHtml(store)}">
        <div class="store-group-header">
          <div class="store-badge-title">
            <span>🏪</span>
            <strong>${escapeHtml(store)}</strong>
            <span style="font-size:0.75rem; color:var(--text-dim);">(${items.length} Posten)</span>
          </div>
          <div class="store-totals-block">
            <div class="store-subtotal">${subtotalStr ? `Angebot: ${subtotalStr}` : ''}</div>
            ${oldSubtotalStr ? `<div class="store-old-subtotal">regulär: ${oldSubtotalStr}</div>` : ''}
            ${savingsStr ? `<div class="store-savings-badge">Ersparnis: -${savingsStr}</div>` : ''}
          </div>
        </div>
        
        <div class="store-items-list">
          ${listContentHtml}
        </div>
      </div>
    `;
  }).join('');

  elements.basketGroupedContainer.innerHTML = sanitizeHtml(groupHtml);

  // Live Supermarkt-Modus Wagenleiste aktualisieren
  if (state.storeMode && elements.storeModeLiveBar) {
    elements.storeModeLiveBar.style.display = 'flex';
    if (elements.liveBarCheckedCount) {
      elements.liveBarCheckedCount.textContent = `${checkedCount} von ${totalUnits} Artikeln im Wagen`;
    }
    if (elements.liveBarCheckedAmount) {
      elements.liveBarCheckedAmount.textContent = `${checkedAmount.toFixed(2).replace('.', ',')} € im Wagen`;
    }
  } else if (elements.storeModeLiveBar) {
    elements.storeModeLiveBar.style.display = 'none';
  }

  // Budget Tracker aktualisieren
  if (state.budget > 0 && elements.basketBudgetBarBox) {
    elements.basketBudgetBarBox.style.display = 'block';
    const effectiveTotal = grandTotal + grandDeposit;
    const ratio = effectiveTotal / state.budget;
    const pct = Math.round(ratio * 100);
    const diff = state.budget - effectiveTotal;

    if (elements.budgetPercentPill) elements.budgetPercentPill.textContent = `${pct}%`;
    if (elements.budgetProgressFill) elements.budgetProgressFill.style.width = `${Math.min(100, Math.max(0, pct))}%`;

    if (diff >= 0) {
      if (ratio <= 0.80) {
        if (elements.budgetPercentPill) elements.budgetPercentPill.className = 'budget-pill ok';
        if (elements.budgetProgressFill) elements.budgetProgressFill.style.background = 'var(--accent-primary)';
        if (elements.budgetStatusText) elements.budgetStatusText.textContent = `Noch ${diff.toFixed(2).replace('.', ',')} € bis zum Limit`;
      } else {
        if (elements.budgetPercentPill) elements.budgetPercentPill.className = 'budget-pill warn';
        if (elements.budgetProgressFill) elements.budgetProgressFill.style.background = '#f59e0b';
        if (elements.budgetStatusText) elements.budgetStatusText.textContent = `Fast erreicht: Noch ${diff.toFixed(2).replace('.', ',')} € frei`;
      }
    } else {
      if (elements.budgetPercentPill) elements.budgetPercentPill.className = 'budget-pill danger';
      if (elements.budgetProgressFill) elements.budgetProgressFill.style.background = '#ef4444';
      if (elements.budgetStatusText) elements.budgetStatusText.textContent = `⚠️ Limit um ${Math.abs(diff).toFixed(2).replace('.', ',')} € überschritten!`;
    }
  } else if (elements.basketBudgetBarBox) {
    elements.basketBudgetBarBox.style.display = 'none';
  }

  // Pfand & Gesamtsumme
  if (grandDeposit > 0) {
    if (elements.basketDepositRow) {
      elements.basketDepositRow.style.display = 'flex';
      elements.basketTotalDeposit.textContent = `+${grandDeposit.toFixed(2).replace('.', ',')} €`;
    }
    if (elements.basketGrandTotalWithDepositRow) {
      elements.basketGrandTotalWithDepositRow.style.display = 'flex';
      elements.basketGrandTotalWithDeposit.textContent = `${(grandTotal + grandDeposit).toFixed(2).replace('.', ',')} €`;
    }
  } else {
    if (elements.basketDepositRow) elements.basketDepositRow.style.display = 'none';
    if (elements.basketGrandTotalWithDepositRow) elements.basketGrandTotalWithDepositRow.style.display = 'none';
  }

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
    elements.mobileBasketBadge.textContent = totalUnits;
  }

  // Event Listener für Mengen-Steuerung (+/-)
  elements.basketGroupedContainer.querySelectorAll('.btn-qty-minus').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      updateItemQuantity(btn.getAttribute('data-id'), -1);
    });
  });

  elements.basketGroupedContainer.querySelectorAll('.btn-qty-plus').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      updateItemQuantity(btn.getAttribute('data-id'), 1);
    });
  });

  // Event Listener für Checkboxen
  elements.basketGroupedContainer.querySelectorAll('.basket-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      toggleItemChecked(cb.getAttribute('data-id'));
    });
  });

  // Event Listener für Direkt-Deal-Swap Tauschen-Button
  elements.basketGroupedContainer.querySelectorAll('.btn-swap-deal').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const targetId = btn.getAttribute('data-target-id');
      const dealId = btn.getAttribute('data-deal-id');
      applyDirectDealSwap(targetId, dealId);
    });
  });

  // Event Listener für Tausch-Rückgängig-Button
  elements.basketGroupedContainer.querySelectorAll('.btn-undo-swap').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      undoDealSwap(id);
    });
  });

  // Mobile-Optimierung: Tippen auf die gesamte Zeile hakt den Artikel ab (außer Buttons & Checkbox)
  elements.basketGroupedContainer.querySelectorAll('.basket-item-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (
        e.target.closest('.btn-item-del') ||
        e.target.closest('.basket-qty-control') ||
        e.target.closest('.btn-swap-deal') ||
        e.target.closest('.btn-undo-swap') ||
        e.target.classList.contains('basket-checkbox')
      ) return;
      const id = row.getAttribute('data-id');
      if (id) toggleItemChecked(id);
    });
  });

  // Event Listener für Löschen
  elements.basketGroupedContainer.querySelectorAll('.btn-item-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromBasket(btn.getAttribute('data-id'));
    });
  });
}

/**
 * Formatiert den aktuellen Einkaufszettel als übersichtliche Text-Nachricht (z. B. für WhatsApp)
 */
function formatBasketShareText() {
  if (!state.basket || state.basket.length === 0) return '';

  const groups = {};
  let grandTotal = 0;
  let grandOriginalTotal = 0;

  state.basket.forEach(item => {
    const store = item.retailer || 'Einkaufsnotizen';
    if (!groups[store]) groups[store] = [];
    groups[store].push(item);

    const qty = (typeof item.quantity === 'number' && item.quantity > 0) ? item.quantity : 1;
    if (typeof item.price === 'number' && item.price > 0) {
      grandTotal += item.price * qty;
      const sanitizedOld = getVerifiedOldPrice(item);
      const effectiveOld = (sanitizedOld && sanitizedOld > item.price) ? sanitizedOld : item.price;
      grandOriginalTotal += effectiveOld * qty;
    }
  });

  const grandSavings = Math.max(0, grandOriginalTotal - grandTotal);
  const totalUnits = state.basket.reduce((sum, it) => sum + (it.quantity || 1), 0);

  let text = `🛒 *Mein SparFuchs Einkaufszettel* (PLZ: ${state.zip})\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━\n`;

  Object.keys(groups).forEach(store => {
    const items = groups[store];
    const storeTotal = items.reduce((sum, it) => sum + ((it.price || 0) * (it.quantity || 1)), 0);
    text += `🏪 *${store.toUpperCase()}* (${items.length} Posten)\n`;
    
    items.forEach(it => {
      const qty = it.quantity || 1;
      const checkMark = it.checked ? '☑️' : '◻️';
      const priceStr = it.price > 0 ? ` (${(it.price * qty).toFixed(2).replace('.', ',')} €)` : '';
      const qtyStr = qty > 1 ? `${qty}x ` : '';
      text += `${checkMark} ${qtyStr}${it.title}${priceStr}\n`;
    });

    if (storeTotal > 0) {
      text += `👉 Zwischensumme: ${storeTotal.toFixed(2).replace('.', ',')} €\n`;
    }
    text += `\n`;
  });

  text += `━━━━━━━━━━━━━━━━━━━━━\n`;
  if (grandTotal > 0) {
    text += `💰 *Gesamtsumme:* ${grandTotal.toFixed(2).replace('.', ',')} € (${totalUnits} Artikel)\n`;
    if (grandSavings > 0) {
      const pct = Math.round((grandSavings / grandOriginalTotal) * 100);
      text += `🎉 *Ersparnis:* -${grandSavings.toFixed(2).replace('.', ',')} € (-${pct}%)\n`;
    }
  } else {
    text += `📝 *Gesamt:* ${totalUnits} Artikel notiert\n`;
  }
  text += `\nErstellt mit SparFuchs 🦊`;

  return text;
}

/**
 * 1-Klick Teilen (WhatsApp / Text via Web Share API oder Clipboard)
 */
async function shareBasket() {
  if (!state.basket || state.basket.length === 0) {
    showToast('⚠️ Dein Einkaufszettel ist noch leer!');
    return;
  }

  const shareText = formatBasketShareText();

  if (navigator.share) {
    try {
      await navigator.share({
        title: 'Mein SparFuchs Einkaufszettel',
        text: shareText,
      });
      showToast('📤 Einkaufszettel geteilt!');
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      console.warn('Navigator share fehlgeschlagen:', err);
    }
  }

  try {
    await navigator.clipboard.writeText(shareText);
    showToast('📋 In die Zwischenablage kopiert! Bereit für WhatsApp.');
  } catch (err) {
    const ta = document.createElement('textarea');
    ta.value = shareText;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('📋 In die Zwischenablage kopiert!');
  }
}

/**
 * ==========================================================================
 * QR-Code Übertragung & Smartphone-Import (PC ➔ Handy ohne Account)
 * ==========================================================================
 */

/**
 * Öffnet das QR-Code Modal und fordert einen Share-Code vom Server an
 */
async function openQrModal() {
  if (!state.basket || state.basket.length === 0) {
    showToast('⚠️ Dein Einkaufszettel ist leer! Füge zuerst Artikel hinzu.');
    return;
  }

  if (!elements.qrTransferModal) return;
  elements.qrTransferModal.style.display = 'flex';
  elements.qrTransferModal.setAttribute('aria-hidden', 'false');

  if (elements.qrCodeSpinner) elements.qrCodeSpinner.style.display = 'block';
  if (elements.qrCodeImg) elements.qrCodeImg.style.display = 'none';

  const totalUnits = state.basket.reduce((sum, it) => sum + (it.quantity || 1), 0);
  if (elements.qrItemCountBadge) {
    elements.qrItemCountBadge.textContent = `🛒 ${totalUnits} Artikel (${state.basket.length} Posten)`;
  }

  try {
    const res = await fetch('/api/basket/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: state.basket,
        zipCode: state.zip,
      }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    state.activeShareUrl = data.shareUrl;

    if (elements.qrCodeImg) {
      elements.qrCodeImg.src = data.qrDataUrl;
      elements.qrCodeImg.style.display = 'block';
    }
    if (elements.openMobileLinkBtn) {
      elements.openMobileLinkBtn.href = data.shareUrl;
    }
  } catch (err) {
    console.error('Fehler beim Generieren des QR-Codes:', err);
    showToast('⚠️ QR-Code konnte nicht generiert werden');
  } finally {
    if (elements.qrCodeSpinner) elements.qrCodeSpinner.style.display = 'none';
  }
}

/**
 * Schließt das QR-Code Modal
 */
function closeQrModal() {
  if (elements.qrTransferModal) {
    elements.qrTransferModal.style.display = 'none';
    elements.qrTransferModal.setAttribute('aria-hidden', 'true');
  }
}

/**
 * Kopiert den generierten Smartphone-Link in die Zwischenablage
 */
async function copyShareLink() {
  if (!state.activeShareUrl) return;

  try {
    await navigator.clipboard.writeText(state.activeShareUrl);
    if (elements.copyShareLinkText) {
      const orig = elements.copyShareLinkText.textContent;
      elements.copyShareLinkText.textContent = '✅ Link kopiert!';
      setTimeout(() => {
        elements.copyShareLinkText.textContent = orig;
      }, 2000);
    }
    showToast('📋 Link kopiert! Kann direkt im mobilen Browser geöffnet werden.');
  } catch (err) {
    showToast('⚠️ Link konnte nicht kopiert werden');
  }
}

/**
 * Prüft beim Laden der Seite, ob ein geteilter Warenkorb per URL empfangen wurde
 */
async function checkForIncomingBasketShare() {
  const urlParams = new URLSearchParams(window.location.search);
  const shareId = urlParams.get('basket_share');
  if (!shareId) return;

  try {
    const res = await fetch(`/api/basket/share/${encodeURIComponent(shareId)}`);
    if (!res.ok) {
      showToast('⚠️ Der gescannte Einkaufszettel existiert nicht mehr oder ist abgelaufen');
      return;
    }

    const data = await res.json();
    const incomingItems = Array.isArray(data.items) ? data.items : [];
    if (incomingItems.length === 0) return;

    state.incomingSharedBasket = incomingItems;

    // Wenn der lokale Zettel auf dem Handy noch leer ist: Direkt importieren!
    if (!state.basket || state.basket.length === 0) {
      applyImportedBasket('replace');
      showToast(`🎉 ${incomingItems.length} Artikel vom PC erfolgreich übernommen!`);
      if (elements.basketDrawer) {
        elements.basketDrawer.classList.add('open');
        elements.basketDrawer.setAttribute('aria-hidden', 'false');
      }
      if (elements.drawerBackdrop) elements.drawerBackdrop.classList.add('active');
    } else {
      // Wenn bereits Artikel vorhanden sind: Nachfragen (Hinzufügen oder Ersetzen)
      showImportModal(incomingItems);
    }
  } catch (err) {
    console.error('Fehler beim Importieren des Einkaufszettels:', err);
  } finally {
    // Bereinige URL, damit Neuladen die Aktion nicht erneut auslöst
    const cleanUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);
  }
}

/**
 * Zeigt das Smartphone-Import Modal mit Vorschau der empfangenen Artikel
 */
function showImportModal(items) {
  if (!elements.importBasketModal) return;

  const totalUnits = items.reduce((sum, it) => sum + (it.quantity || 1), 0);
  if (elements.importModalSummary) {
    elements.importModalSummary.innerHTML = `
      Es wurden <strong>${totalUnits} Artikel</strong> (${items.length} Posten) von deinem PC empfangen.<br>
      Möchtest du diese zu deiner aktuellen Liste hinzufügen oder die bestehende Liste ersetzen?
    `;
  }

  if (elements.importItemsPreview) {
    elements.importItemsPreview.innerHTML = sanitizeHtml(items.map(it => {
      const qtyStr = (it.quantity && it.quantity > 1) ? `<strong>${it.quantity}x</strong> ` : '';
      const priceStr = it.formattedPrice ? ` – ${it.formattedPrice}` : '';
      return `
        <div class="import-preview-item">
          <span class="import-preview-title">${qtyStr}${escapeHtml(it.title)}</span>
          <span class="import-preview-meta">${escapeHtml(it.retailer || 'Supermarkt')}${escapeHtml(priceStr)}</span>
        </div>
      `;
    }).join(''));
  }

  elements.importBasketModal.style.display = 'flex';
  elements.importBasketModal.setAttribute('aria-hidden', 'false');
}

/**
 * Schließt das Smartphone-Import Modal
 */
function closeImportModal() {
  if (elements.importBasketModal) {
    elements.importBasketModal.style.display = 'none';
    elements.importBasketModal.setAttribute('aria-hidden', 'true');
  }
  state.incomingSharedBasket = null;
}

/**
 * Wendet die empfangenen Artikel an ('replace' oder 'append')
 */
function applyImportedBasket(mode) {
  if (!state.incomingSharedBasket || state.incomingSharedBasket.length === 0) {
    closeImportModal();
    return;
  }

  if (mode === 'replace') {
    state.basket = state.incomingSharedBasket.map(it => ({
      ...it,
      quantity: (typeof it.quantity === 'number' && it.quantity > 0) ? it.quantity : 1,
      checked: false,
    }));
  } else {
    // 'append' / 'merge'
    state.incomingSharedBasket.forEach(incoming => {
      const qty = (typeof incoming.quantity === 'number' && incoming.quantity > 0) ? incoming.quantity : 1;
      const idx = state.basket.findIndex(b => b.id === incoming.id || (b.title === incoming.title && b.retailer === incoming.retailer));
      if (idx !== -1) {
        state.basket[idx].quantity = (state.basket[idx].quantity || 1) + qty;
      } else {
        state.basket.push({
          ...incoming,
          quantity: qty,
          checked: false,
        });
      }
    });
  }

  saveBasket();
  renderBasket();
  closeImportModal();

  // Öffne den Warenkorb-Drawer zur Bestätigung
  if (elements.basketDrawer) {
    elements.basketDrawer.classList.add('open');
    elements.basketDrawer.setAttribute('aria-hidden', 'false');
  }
  if (elements.drawerBackdrop) elements.drawerBackdrop.classList.add('active');

  showToast('🎉 Einkaufszettel erfolgreich übertragen & geladen!');
}

/**
 * Aktualisiert den Favoriten-Radar (Deal-Alarm Banner auf der Startseite)
 */
function updateFavoritesRadar(offers) {
  const container = elements.favoritesRadarContainer;
  const grid = elements.radarCardsGrid;
  const title = elements.radarTitleText;
  if (!container || !grid) return;

  if (!state.favorites || state.favorites.length === 0 || state.radarDismissed) {
    container.style.display = 'none';
    return;
  }

  const pool = Array.isArray(offers) && offers.length > 0 ? offers : state.offers;
  if (!pool || pool.length === 0) {
    container.style.display = 'none';
    return;
  }

  // Finde alle Angebote, die zu einem Favoriten passen
  const matchingDeals = pool.filter(o => isFavorite(o.title, o.brand));

  if (matchingDeals.length === 0) {
    container.style.display = 'none';
    return;
  }

  // Deduplizieren & Top-Angebote auswählen (max 6)
  const uniqueDeals = [];
  const seen = new Set();
  for (const deal of matchingDeals) {
    const key = `${deal.retailer}-${deal.title}`.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      uniqueDeals.push(deal);
    }
    if (uniqueDeals.length >= 6) break;
  }

  if (title) {
    title.textContent = `${uniqueDeals.length} deiner Lieblingsprodukte diese Woche im Angebot!`;
  }

  grid.innerHTML = sanitizeHtml(uniqueDeals.map(rawDeal => {
    const deal = safeView(rawDeal);
    const sanitizedOld = validateAndSanitizeClientPrice(deal.price, deal.oldPrice, deal.isNonFood);
    const hasOld = sanitizedOld && sanitizedOld > deal.price;
    const oldPriceFormatted = hasOld ? `${sanitizedOld.toFixed(2).replace('.', ',')} €` : '';
    const discountText = deal.discountPercent ? `-${deal.discountPercent}%` : (hasOld ? `-${Math.round(((sanitizedOld - deal.price) / sanitizedOld) * 100)}%` : '');

    return `
      <div class="radar-card" data-id="${deal.id}">
        <div class="radar-card-top">
          <span class="radar-store-tag">${deal.retailer}</span>
          ${discountText ? `<span class="radar-discount-badge">${discountText}</span>` : ''}
        </div>
        <div class="radar-product-title" title="${deal.title.replace(/"/g, '&quot;')}">${deal.title}</div>
        <div class="radar-price-row">
          <span class="radar-price">${deal.formattedPrice}</span>
          ${oldPriceFormatted ? `<span class="radar-old-price">${oldPriceFormatted}</span>` : ''}
          ${deal.formattedReferencePrice ? `<span class="radar-ref-price">${deal.formattedReferencePrice}</span>` : ''}
        </div>
        <button 
          type="button" 
          class="btn-radar-add" 
          data-id="${deal.id}"
          data-title="${deal.title.replace(/"/g, '&quot;')}"
          data-retailer="${deal.retailer}"
          data-price="${deal.price || 0}"
          data-formatted-price="${deal.formattedPrice || ''}"
          data-old-price="${sanitizedOld || ''}"
          data-formatted-old-price="${oldPriceFormatted}"
          data-estimated-old-price="${deal.isEstimatedOldPrice ? 'true' : 'false'}"
          data-image-url="${deal.imageUrl || ''}"
        >
          ➕ Auf Einkaufsliste
        </button>
      </div>
    `;
  }).join(''));

  container.style.display = 'block';

  // Event Listener für Quick-Add Buttons im Radar
  grid.querySelectorAll('.btn-radar-add').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
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
        imageUrl: btn.getAttribute('data-image-url') || null,
        quantity: 1,
        checked: false,
      };
      addToBasket(item);
    });
  });
}

/**
 * Bereinigt Notiz-Einträge für die Supermarkt-Suche (entfernt z. B. "zum Anbraten", "fein gewürfelt")
 */
function cleanShoppingItemForSearch(raw) {
  if (!raw) return '';
  let clean = String(raw).trim();

  // 1. Spezifische Plural-Klammern auflösen
  clean = clean.replace(/Tomatenmark/gi, '__TOMATENMARK__');
  clean = clean.replace(/Tomate\(n\)/gi, 'Tomaten');
  clean = clean.replace(/Lasagneplatte\(n\)/gi, 'Lasagneplatten');
  clean = clean.replace(/Knoblauchzehe\(n\)?/gi, 'Knoblauch');
  clean = clean.replace(/\(n\)/gi, 'n');
  clean = clean.replace(/\(s\)/gi, 's');
  clean = clean.replace(/[()]/g, ' ');

  // 2. Mengenangaben & Einheiten am Anfang entfernen
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

  // Französische Akzente ersetzen
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
 * Führt die Multimarkt-Einkaufsoptimierung aus
 */
async function optimizeBasket() {
  if (state.basket.length === 0) {
    showToast('Füge zuerst Artikel zu deiner Liste hinzu!');
    return;
  }

  const itemsPayload = state.basket.map(i => ({
    query: cleanShoppingItemForSearch(i.title) || i.title,
    quantity: (typeof i.quantity === 'number' && i.quantity > 0) ? i.quantity : 1,
  }));

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
        items: itemsPayload,
        zipCode: state.zip,
        excludeAppOnly: state.excludeAppOnly,
        preferReferencePrice: state.sortBy === 'refPrice',
        extraStoreCost: state.extraStoreCost,
        activeRetailers: (Array.isArray(state.activeStores) && state.activeStores.length > 0) ? state.activeStores : undefined,
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
 * Hilfsfunktionen zur Bereinigung von Produkttiteln und Marken
 */
function cleanProductTitle(title) {
  if (!title) return '';
  return title
    .replace(/\bthisisnobrand123\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function cleanBrandName(brand) {
  if (!brand) return '';
  if (brand.toLowerCase().includes('thisisnobrand123')) return 'Eigenmarke';
  return brand.trim();
}

/**
 * Rendert die Ergebnisse des Optimierers im Drawer direkt unter dem Button mit
 * echter Produktanzeige, Supermarkt-Tag, 3 besten Alternativen und Auswahl-Checkboxen.
 */
function renderOptimizationResult(opt) {
  if (!opt) return;

  const container = elements.optimizationResultContainer;
  if (!container) return;
  container.style.display = 'flex';

  const champion = opt.singleStoreChampion;
  const split = opt.smartSplit;
  const bestPerItem = opt.bestPerItem || [];
  const splitSavings = opt.splitNetSaving;

  // Bestimme den primär empfohlenen Plan ('split' oder 'champion' oder 'best') - Smart Split ist Standard
  const hasSplit = split && split.stores && split.stores.length === 2;
  let activePlan = hasSplit && splitSavings > 0 ? 'split' : (champion ? 'champion' : (bestPerItem.length > 0 ? 'best' : null));

  // Wir halten eine lokale Kopie der Plan-Items für den interaktiven Deal-Tausch (Alternativen)
  const planItemsCache = {};

  function getPlanItems(plan) {
    if (planItemsCache[plan]) {
      return planItemsCache[plan];
    }

    let items = [];
    if (plan === 'split' && hasSplit) {
      const [sA, sB] = split.stores;
      const allocA = (split.allocations && split.allocations[sA]) ? split.allocations[sA].items : [];
      const allocB = (split.allocations && split.allocations[sB]) ? split.allocations[sB].items : [];
      const primaryItems = [...allocA, ...allocB].filter(it => it && it.offer);

      // Ergänzungen aus weiteren Supermärkten für Artikel, die in den 2 Läden fehlen
      const additionalItems = (split.otherStoreMatches || []).map(it => ({
        ...it,
        isAdditionalStore: true,
      }));

      items = [...primaryItems, ...additionalItems];
    } else if (plan === 'champion' && champion) {
      items = (champion.matchedItems || []).filter(it => it && it.offer);
    } else if (plan === 'best' && bestPerItem.length > 0) {
      items = bestPerItem.filter(it => it && it.offer);
    }

    planItemsCache[plan] = items.map(item => ({
      query: item.query,
      quantity: item.quantity || 1,
      offer: { ...item.offer },
      isAdditionalStore: Boolean(item.isAdditionalStore),
      alternatives: Array.isArray(item.alternatives) ? item.alternatives.map(a => ({ ...a })) : [],
    }));

    return planItemsCache[plan];
  }

  function renderPlanContent() {
    const items = getPlanItems(activePlan);

    let html = `
      <div class="opt-plans-tabs" style="display:flex; gap:0.5rem; margin-bottom:0.75rem; flex-wrap:wrap;">
        ${hasSplit ? `
          <button type="button" class="btn-plan-tab ${activePlan === 'split' ? 'active' : ''}" data-plan="split" style="flex:1; min-width:140px; padding:0.6rem 0.5rem; border-radius:var(--radius-sm); border:1px solid ${activePlan === 'split' ? 'var(--accent-primary)' : 'var(--border-subtle)'}; background:${activePlan === 'split' ? 'rgba(0,229,153,0.12)' : 'rgba(255,255,255,0.03)'}; color:${activePlan === 'split' ? 'var(--accent-primary)' : 'var(--text-muted)'}; font-weight:700; font-size:0.8rem; cursor:pointer; text-align:left;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span>⚡ Smart Split (2 Läden)</span>
              ${splitSavings !== null ? `<span style="font-size:0.72rem; color:var(--accent-primary); background:rgba(0,229,153,0.18); padding:0.1rem 0.35rem; border-radius:4px;">${splitSavings > 0 ? '+' : ''}${splitSavings.toFixed(2).replace('.', ',')} € nach Zusatzkosten</span>` : ''}
            </div>
            <div style="font-size:0.85rem; font-weight:700; color:#e2e8f0; margin-top:0.25rem;">
              🛒 ${split.stores.map(escapeHtml).join(' + ')} · ${split.matchedCount}/${opt.totalItemsRequested} Treffer
            </div>
          </button>
        ` : ''}
        ${champion ? `
          <button type="button" class="btn-plan-tab ${activePlan === 'champion' ? 'active' : ''}" data-plan="champion" style="flex:1; min-width:140px; padding:0.6rem 0.5rem; border-radius:var(--radius-sm); border:1px solid ${activePlan === 'champion' ? 'var(--accent-primary)' : 'var(--border-subtle)'}; background:${activePlan === 'champion' ? 'rgba(0,229,153,0.12)' : 'rgba(255,255,255,0.03)'}; color:${activePlan === 'champion' ? 'var(--accent-primary)' : 'var(--text-muted)'}; font-weight:700; font-size:0.8rem; cursor:pointer; text-align:left;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span>🏆 Single-Store Sieger</span>
              <span style="font-size:0.72rem; color:var(--text-dim);">${champion.matchedCount}/${opt.totalItemsRequested} Treffer</span>
            </div>
            <div style="font-size:0.85rem; font-weight:700; color:#e2e8f0; margin-top:0.25rem;">
              🛒 ${escapeHtml(champion.retailer)}
            </div>
          </button>
        ` : ''}
        ${bestPerItem.length > 0 ? `
          <button type="button" class="btn-plan-tab ${activePlan === 'best' ? 'active' : ''}" data-plan="best" style="flex:1; min-width:140px; padding:0.6rem 0.5rem; border-radius:var(--radius-sm); border:1px solid ${activePlan === 'best' ? 'var(--accent-primary)' : 'var(--border-subtle)'}; background:${activePlan === 'best' ? 'rgba(0,229,153,0.12)' : 'rgba(255,255,255,0.03)'}; color:${activePlan === 'best' ? 'var(--accent-primary)' : 'var(--text-muted)'}; font-weight:700; font-size:0.8rem; cursor:pointer; text-align:left;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span>🌐 Alle Märkte</span>
              <span style="font-size:0.72rem; color:var(--text-dim);">${bestPerItem.length}/${opt.totalItemsRequested} Treffer</span>
            </div>
            <div style="font-size:0.85rem; font-weight:700; color:#e2e8f0; margin-top:0.25rem;">
              🛒 Bester Preis je Artikel
            </div>
          </button>
        ` : ''}
      </div>
    `;

    const planMissing = activePlan === 'split' ? (split?.missingItems || [])
      : activePlan === 'champion' ? (champion?.missingItems || [])
        : (opt.itemQueries || []).filter(query => !bestPerItem.some(it => it.query === query));
    if (planMissing.length) {
      html += `<p class="opt-missing-note">⚠️ Für ${planMissing.length} Artikel kein passendes Angebot: ${planMissing.map(escapeHtml).join(', ')}. Diese Artikel bleiben auf deiner Liste.</p>`;
    }
    const planStores = activePlan === 'split' ? (split?.stores || [])
      : activePlan === 'champion' ? [champion?.retailer] : [...new Set(items.map(it => it.offer?.retailer))];
    const branchLinks = planStores.map(chain => state.selectedMarkets.find(m => m.chain?.toLowerCase() === chain?.toLowerCase())).filter(Boolean);
    if (branchLinks.length) {
      html += `<div class="opt-branch-links">${branchLinks.map(m => `<a href="${escapeHtml(m.mapsUrl)}" target="_blank" rel="noopener noreferrer">📍 ${escapeHtml(m.name)} (${m.distanceKm} km) in Google Maps</a>`).join('')}</div>`;
    }

    if (items.length === 0) {
      html += `
        <div style="color:var(--text-dim); padding:1rem; text-align:center; font-size:0.85rem;">
          Keine passenden Angebote gefunden.
        </div>
      `;
      container.innerHTML = sanitizeHtml(html);
      return;
    }

    html += `
      <div class="opt-select-header-bar">
        <span><strong>${items.length} Angebote gefunden</strong> (Auswahl anpassen):</span>
        <button type="button" class="btn-opt-select-all" id="btnOptToggleAll">Alle abwählen</button>
      </div>

      <div class="opt-items-selection-box" id="optItemsList">
        ${items.map((it, idx) => {
          const off = safeView(it.offer);
          const cleanTitle = cleanProductTitle(off.title);
          const brandText = cleanBrandName(off.brand);
          const alts = Array.isArray(it.alternatives) ? it.alternatives : [];

          return `
            <div class="opt-item-select-row" data-idx="${idx}">
              <div class="opt-item-main-row">
                <label class="opt-item-checkbox-label">
                  <input type="checkbox" class="opt-item-checkbox" data-deal-id="${off.id}" checked>
                  ${off.imageUrl ? `
                    <img src="${off.imageUrl}" class="opt-item-thumb" alt="${cleanTitle.replace(/"/g, '&quot;')}" onerror="this.style.display='none';">
                  ` : `
                    <div class="opt-item-thumb" style="display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.05);font-size:1.1rem;">🛒</div>
                  `}
                  <div class="opt-item-details">
                    <div class="opt-item-title">${it.quantity && it.quantity > 1 ? `<span class="opt-qty-badge" style="background:rgba(0,229,153,0.15); color:var(--accent-primary); padding:0.1rem 0.4rem; border-radius:4px; font-weight:700; margin-right:0.35rem; font-size:0.8rem;">${it.quantity}x</span>` : ''}${cleanTitle}</div>
                    <div class="opt-item-sub">
                      <span class="opt-item-store-tag" data-retailer="${off.retailer}">${off.retailer}</span>
                      <span>für <em>„${escapeHtml(it.query)}“</em></span>
                      ${brandText && brandText !== 'Eigenmarke' ? `<span>• ${brandText}</span>` : ''}
                    </div>
                    ${it.isAdditionalStore ? `
                      <div class="opt-additional-note">🏪 Ergänzung: Gefunden bei ${off.retailer}</div>
                    ` : ''}
                  </div>
                </label>
                <div class="opt-item-pricing">
                  <span class="opt-item-price">${it.quantity && it.quantity > 1 ? `${(off.price * it.quantity).toFixed(2).replace('.', ',')} € <small style="font-size:0.75rem; color:var(--text-dim); font-weight:normal;">(${it.quantity}x à ${(off.formattedPrice || (off.price.toFixed(2).replace('.', ',') + ' €'))})</small>` : (off.formattedPrice || (off.price.toFixed(2).replace('.', ',') + ' €'))}</span>
                  ${off.formattedOldPrice ? `<span class="opt-item-old">${it.quantity && it.quantity > 1 && off.oldPrice ? `${(off.oldPrice * it.quantity).toFixed(2).replace('.', ',')} €` : off.formattedOldPrice}</span>` : ''}
                </div>
              </div>

              ${alts.length > 0 ? `
                <div class="opt-item-alts-box">
                  <div class="opt-alts-header">
                    <span>💡 ${alts.length} Alternative${alts.length > 1 ? 'n' : ''}:</span>
                    <span style="font-size:0.68rem; color:#64748b;">(Klick zum Tauschen)</span>
                  </div>
                  <div class="opt-alts-list">
                    ${alts.map((alt, altIdx) => {
                      const altView = safeView(alt);
                      const altCleanTitle = cleanProductTitle(altView.title);
                      const altPriceStr = alt.formattedPrice || (alt.price.toFixed(2).replace('.', ',') + ' €');
                      return `
                        <button type="button" class="btn-opt-swap-alt" data-item-idx="${idx}" data-alt-idx="${altIdx}" title="Zu ${altView.retailer}: ${altCleanTitle} (${escapeHtml(altPriceStr)}) wechseln">
                          <div class="opt-alt-left">
                            <span class="opt-alt-badge" data-retailer="${altView.retailer}">${altView.retailer}</span>
                            <span class="opt-alt-name">${altCleanTitle}</span>
                          </div>
                          <div class="opt-alt-right">
                            <span class="opt-alt-price">${escapeHtml(altPriceStr)}</span>
                            ${altView.formattedOldPrice ? `<span class="opt-alt-old">${altView.formattedOldPrice}</span>` : ''}
                            <span class="opt-alt-action">Tauschen ⇄</span>
                          </div>
                        </button>
                      `;
                    }).join('')}
                  </div>
                </div>
              ` : ''}
            </div>
          `;
        }).join('')}
      </div>

      <div style="margin-top:0.75rem;">
        <button type="button" id="applyOptimizedOffersBtn" class="btn-apply-optimized">
          🛒 Ausgewählte Angebote (${items.length}) in Einkaufszettel übernehmen
        </button>
      </div>
    `;

    container.innerHTML = sanitizeHtml(html);

    // Listener für Plan-Tabs (Switch zwischen Single-Store, Smart Split und Alle Märkte)
    container.querySelectorAll('.btn-plan-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        activePlan = btn.getAttribute('data-plan');
        renderPlanContent();
      });
    });

    // Listener für Deal-Tausch (Top-Alternativen)
    container.querySelectorAll('.btn-opt-swap-alt').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const itemIdx = parseInt(btn.getAttribute('data-item-idx'), 10);
        const altIdx = parseInt(btn.getAttribute('data-alt-idx'), 10);
        const targetItem = items[itemIdx];
        if (!targetItem || !targetItem.alternatives || !targetItem.alternatives[altIdx]) return;

        const oldOffer = targetItem.offer;
        const newOffer = targetItem.alternatives[altIdx];

        targetItem.offer = newOffer;
        targetItem.alternatives[altIdx] = oldOffer;

        renderPlanContent();
        showToast(`🔄 Getauscht: ${newOffer.retailer} – ${cleanProductTitle(newOffer.title)} (${newOffer.formattedPrice || newOffer.price.toFixed(2).replace('.', ',') + ' €'})`);
      });
    });

    // Toggle All Checkboxes
    const toggleAllBtn = container.querySelector('#btnOptToggleAll');
    const checkboxes = container.querySelectorAll('.opt-item-checkbox');
    const applyBtn = container.querySelector('#applyOptimizedOffersBtn');

    function updateApplyButton() {
      const selected = Array.from(checkboxes).filter(cb => cb.checked);
      if (applyBtn) {
        applyBtn.textContent = `🛒 Ausgewählte Angebote (${selected.length}) in Einkaufszettel übernehmen`;
        applyBtn.disabled = selected.length === 0;
        applyBtn.style.opacity = selected.length === 0 ? '0.5' : '1';
      }
      if (toggleAllBtn) {
        toggleAllBtn.textContent = selected.length === 0 ? 'Alle auswählen' : 'Alle abwählen';
      }
    }

    if (toggleAllBtn) {
      toggleAllBtn.addEventListener('click', () => {
        const anyChecked = Array.from(checkboxes).some(cb => cb.checked);
        checkboxes.forEach(cb => { cb.checked = !anyChecked; });
        updateApplyButton();
      });
    }

    checkboxes.forEach(cb => {
      cb.addEventListener('change', updateApplyButton);
    });

    if (applyBtn) {
      applyBtn.addEventListener('click', () => {
        const selectedDealIds = new Set(
          Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.getAttribute('data-deal-id'))
        );
        const selectedItems = items.filter(it => it.offer && selectedDealIds.has(it.offer.id));
        applyOptimizedOffersToBasket(selectedItems);
      });
    }
  }

  renderPlanContent();
  container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Wendet die vom Optimierer ausgewählten Deals auf den Einkaufszettel an
 */
function applyOptimizedOffersToBasket(selectedItems) {
  if (!selectedItems || selectedItems.length === 0) return;

  let addedCount = 0;
  selectedItems.forEach(item => {
    const deal = item.offer;
    const query = (item.query || '').toLowerCase().trim();

    // Check if an existing basket item can be updated (e.g. manual note or old deal)
    const existingIdx = state.basket.findIndex(b => {
      if (b.id === deal.id) return true;
      const bTitle = (b.title || '').toLowerCase().trim();
      if (query && (bTitle === query || bTitle.includes(query) || query.includes(bTitle))) return true;
      const dTitle = (deal.title || '').toLowerCase().trim();
      return bTitle.includes(dTitle) || dTitle.includes(bTitle);
    });

    if (existingIdx !== -1) {
      const currentQty = state.basket[existingIdx].quantity || item.quantity || 1;
      state.basket[existingIdx] = {
        id: deal.id,
        title: cleanProductTitle(deal.title),
        retailer: deal.retailer,
        price: deal.price,
        formattedPrice: deal.formattedPrice,
        oldPrice: deal.oldPrice || null,
        formattedOldPrice: deal.formattedOldPrice || null,
        isEstimatedOldPrice: deal.isEstimatedOldPrice || false,
        imageUrl: deal.imageUrl || state.basket[existingIdx].imageUrl || null,
        quantity: currentQty,
        checked: false,
      };
    } else {
      state.basket.push({
        id: deal.id,
        title: cleanProductTitle(deal.title),
        retailer: deal.retailer,
        price: deal.price,
        formattedPrice: deal.formattedPrice,
        oldPrice: deal.oldPrice || null,
        formattedOldPrice: deal.formattedOldPrice || null,
        isEstimatedOldPrice: deal.isEstimatedOldPrice || false,
        imageUrl: deal.imageUrl || null,
        quantity: (typeof item.quantity === 'number' && item.quantity > 0) ? item.quantity : 1,
        checked: false,
      });
    }
    addedCount++;
  });

  saveBasket();
  renderBasket();

  // Schließe und leere die Optimierungs-Vorschlagsliste nach der Übernahme
  if (elements.optimizationResultContainer) {
    elements.optimizationResultContainer.style.display = 'none';
    elements.optimizationResultContainer.innerHTML = '';
  }

  showToast(`🎉 ${addedCount} ausgewählte Angebote in deine Einkaufsliste übernommen!`);
}

/**
 * Fügt alle Favoriten in den Einkaufszettel ein und startet die Optimierung
 */
function insertFavoritesToOptimizer() {
  if (!state.favorites || state.favorites.length === 0) {
    showToast('⚠️ Du hast noch keine Favoriten gespeichert. Klicke auf ⭐ oder öffne den Favoriten-Manager.');
    return;
  }

  let count = 0;
  state.favorites.forEach(fav => {
    if (!state.basket.some(b => b.title.toLowerCase() === fav.toLowerCase())) {
      addToBasket(fav);
      count++;
    }
  });

  showToast(`⭐ ${state.favorites.length} Favoriten im Einkaufszettel bereit! Starte Optimierung...`);
  optimizeBasket();
}

/**
 * Extrahiert signifikante Suchbegriffe aus einem Produkttitel für Ähnlichkeitsvergleiche
 */
function extractSignificantKeywords(title) {
  if (!title) return [];
  const clean = title.toLowerCase()
    .replace(/[,\.\(\)\/\-\+]/g, ' ')
    .replace(/\b(thisisnobrand123|lidl|aldi|nord|süd|rewe|kaufland|edeka|penny|netto|norma|k-classic|gut & günstig|gut und günstig|ja!|milbona|alnatura|bio|frisch|frische|deutsches|speise|feine|echte|unsere|original|premium|deluxe|beste|wahl|und|mit|oder|der|die|das|den|dem|des|ein|eine|einen|von|aus|kg|gramm|liter|ml|packung|beutel|tafel|dose|flasche)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return clean.split(' ').map(w => w.trim()).filter(w => w.length >= 3);
}

/**
 * Ausschlussregeln für inkompatible Produkt-Kategorien und Verarbeitungsstufen.
 * Verhindert gravierende Falsch-Zuordnungen wie frische Rispentomaten vs. passierte Tomaten,
 * Olivenöl vs. Rapsöl, Butter vs. Kräuterbutter/Erdnussbutter etc.
 */
const CONTRADICTORY_MODIFIER_GROUPS = [
  // 1. Frische Tomaten vs. verarbeitete Tomatenprodukte / Konserven
  {
    groupA: ['rispen', 'strauch', 'cherry', 'cocktail', 'roma', 'fleisch', 'snack', 'lose', 'strauchtomaten', 'rispentomaten', 'cherrytomaten', 'cocktailtomaten', 'fleischtomaten', 'salattomaten'],
    groupB: ['passiert', 'passierte', 'passiertes', 'gehackt', 'gehackte', 'gehacktes', 'geschält', 'geschälte', 'mark', 'püree', 'sauce', 'soße', 'suppe', 'ketchup', 'dose', 'konserve', 'stückig', 'stückige', 'pizza-tomaten'],
    label: 'Frische Tomaten vs. verarbeitete Tomatenprodukte'
  },
  // 2. Verschiedene Ölsorten
  {
    groupA: ['olivenöl', 'olive', 'oliven'],
    groupB: ['sonnenblumenöl', 'rapsöl', 'frittieröl', 'bratöl', 'distelöl', 'leinöl', 'kokosöl', 'sesamöl'],
    label: 'Verschiedene Ölsorten'
  },
  // 3. Butter-Varianten
  {
    groupA: ['erdnussbutter', 'peanut', 'erdnusscreme'],
    groupB: ['markenbutter', 'weidebutter', 'butter', 'süßrahm', 'sauerrahm', 'margarine'],
    label: 'Erdnussbutter vs. Speisebutter'
  },
  {
    groupA: ['kräuterbutter', 'knoblauchbutter'],
    groupB: ['markenbutter', 'weidebutter', 'butter', 'süßrahm', 'sauerrahm'],
    label: 'Kräuterbutter vs. Speisebutter'
  },
  // 4. Pflanzendrinks vs. Milch
  {
    groupA: ['hafermilch', 'mandelmilch', 'sojadrink', 'haferdrink', 'mandeldrink', 'sojamilch', 'reismilch', 'kokosdrink', 'pflanzendrink'],
    groupB: ['kuhmilch', 'weidemilch', 'vollmilch', 'frischmilch', 'h-milch', 'alpenmilch'],
    label: 'Pflanzendrink vs. Kuhmilch'
  },
  {
    groupA: ['buttermilch', 'kefir'],
    groupB: ['vollmilch', 'frischmilch', 'h-milch', 'weidemilch'],
    label: 'Buttermilch vs. Milch'
  },
  // 5. Backmehl vs. Paniermehl
  {
    groupA: ['paniermehl', 'semmelbrösel', 'panade'],
    groupB: ['weizenmehl', 'dinkelmehl', 'roggenmehl', 'mehl type 405', 'mehl type 550'],
    label: 'Paniermehl vs. Backmehl'
  },
  // 6. Fleischformen
  {
    groupA: ['hackfleisch', 'faschiertes', 'hack'],
    groupB: ['gulasch', 'schnitzel', 'steak', 'filet', 'braten', 'roulade', 'kotelett'],
    label: 'Hackfleisch vs. Fleischstücke'
  },
  // 7. Frische Früchte / Gemüse vs. verarbeitete Produkte
  {
    groupA: ['apfel', 'äpfel'],
    groupB: ['apfelsaft', 'apfelmus', 'apfelmark', 'apfelstrudel', 'apfelessig'],
    label: 'Frischer Apfel vs. Apfelprodukt'
  },
  {
    groupA: ['kartoffeln', 'speisekartoffeln'],
    groupB: ['kartoffelsalat', 'kartoffelchips', 'kartoffelpüree', 'pommes', 'kroketten'],
    label: 'Frische Kartoffeln vs. Kartoffelfertiggericht'
  },
  // 8. Speiseöl vs. Fleisch / Fertiggerichte (verhindert z.B. Cevapcici für Öl zum anbraten)
  {
    groupA: ['öl', 'olivenöl', 'rapsöl', 'sonnenblumenöl', 'leinöl', 'speiseöl', 'pflanzenöl', 'bratöl'],
    groupB: ['cevapcici', 'hackfleisch', 'steak', 'schnitzel', 'wurst', 'bratwurst', 'braten', 'fleisch', 'fisch', 'lachs', 'pizza', 'gouda', 'käse', 'chips'],
    label: 'Speiseöl vs. Fleisch/Fertiggerichte'
  }
];

/**
 * Prüft strikt, ob ein alternatives Angebot tatsächlich als Ersatz für das aktuelle Produkt taugt.
 */
function isCompatibleDeal(targetTitle, candidateTitle) {
  if (!targetTitle || !candidateTitle) return false;
  const tNorm = targetTitle.toLowerCase();
  const cNorm = candidateTitle.toLowerCase();

  // 1. Widersprüchliche Gruppen ausschließen
  for (const rule of CONTRADICTORY_MODIFIER_GROUPS) {
    const targetInA = rule.groupA.some(w => tNorm.includes(w));
    const targetInB = rule.groupB.some(w => tNorm.includes(w));
    const candInA = rule.groupA.some(w => cNorm.includes(w));
    const candInB = rule.groupB.some(w => cNorm.includes(w));

    if ((targetInA && candInB) || (targetInB && candInA)) {
      return false;
    }
  }

  // 2. Keyword-Token Matching mit strikterer Ähnlichkeitsprüfung
  const targetWords = extractSignificantKeywords(tNorm);
  const candWords = extractSignificantKeywords(cNorm);

  if (targetWords.length === 0 || candWords.length === 0) return false;

  let strongMatches = 0;
  for (const tw of targetWords) {
    for (const cw of candWords) {
      if (tw === cw) {
        strongMatches++;
        break;
      }
      // Plural/Flexions-Abgleich (z. B. tomate / tomaten, apfel / äpfel, gurke / gurken)
      const lenDiff = Math.abs(tw.length - cw.length);
      if (lenDiff <= 2 && (tw.includes(cw) || cw.includes(tw))) {
        strongMatches++;
        break;
      }
      // Komposita-Prüfung (z. B. "rispentomaten" und "strauchtomaten")
      if ((tw.includes(cw) && tw.endsWith(cw)) || (cw.includes(tw) && cw.endsWith(tw))) {
        strongMatches++;
        break;
      }
    }
  }

  return strongMatches > 0;
}

/**
 * Findet günstigere Alternativen für ein Produkt im Warenkorb unter Berücksichtigung
 * von aktiven Supermärkten und strikter semantischer Kompatibilität.
 */
function findAllBetterDeals(item) {
  if (!item || !item.title || typeof item.price !== 'number' || item.price <= 0) return [];
  const pool = Array.isArray(state.offers) ? state.offers : [];
  if (pool.length === 0) return [];

  const results = [];
  const seen = new Set();

  pool.forEach(o => {
    if (o.id === item.id) return;
    if (o.retailer === item.retailer) return;
    if (Array.isArray(state.activeStores) && state.activeStores.length > 0) {
      const isStoreActive = state.activeStores.some(s => s.toLowerCase() === (o.retailer || '').toLowerCase());
      if (!isStoreActive) return;
    }
    if (typeof o.price !== 'number' || o.price >= item.price) return;

    // Kategorie-Konsistenz prüfen (z. B. keine Drogerie für Molkerei vorschlagen)
    if (item.categoryId && o.categoryId && item.categoryId !== o.categoryId) return;

    // Stringenter Kompatibilitätscheck (z.B. keine Passierten Tomaten für Rispentomaten)
    if (!isCompatibleDeal(item.title, o.title)) return;

    const key = `${o.retailer}-${o.title}-${o.price}`;
    if (!seen.has(key)) {
      seen.add(key);
      const unitDiff = item.price - o.price;
      results.push({
        ...o,
        title: cleanProductTitle(o.title),
        brand: cleanBrandName(o.brand),
        savingsVsItem: unitDiff,
        formattedSavingsVsItem: `${(unitDiff * (item.quantity || 1)).toFixed(2).replace('.', ',')} €`,
      });
    }
  });

  results.sort((a, b) => a.price - b.price);
  return results.slice(0, 5);
}

function findBetterDeal(item) {
  const deals = findAllBetterDeals(item);
  return deals.length > 0 ? deals[0] : null;
}

/**
 * Tauscht ein Produkt direkt in der Zeile gegen das günstigere Alternativ-Angebot aus (ohne störendes Modal)
 */
function applyDirectDealSwap(targetId, dealId) {
  const targetIdx = state.basket.findIndex(i => i.id === targetId);
  if (targetIdx === -1) return;

  const targetItem = state.basket[targetIdx];
  const deal = (state.offers || []).find(o => o.id === dealId);
  if (!deal) return;

  // Speichere den vorherigen Zustand für den "Rückgängig"-Knopf
  const previousState = {
    id: targetItem.id,
    title: targetItem.title,
    retailer: targetItem.retailer,
    price: targetItem.price,
    formattedPrice: targetItem.formattedPrice,
    oldPrice: targetItem.oldPrice,
    formattedOldPrice: targetItem.formattedOldPrice,
    imageUrl: targetItem.imageUrl,
    quantity: targetItem.quantity || 1,
  };

  state.basket[targetIdx] = {
    id: deal.id,
    title: cleanProductTitle(deal.title),
    retailer: deal.retailer,
    price: deal.price,
    formattedPrice: deal.formattedPrice,
    oldPrice: deal.oldPrice || null,
    formattedOldPrice: deal.formattedOldPrice || null,
    isEstimatedOldPrice: deal.isEstimatedOldPrice || false,
    imageUrl: deal.imageUrl || null,
    quantity: targetItem.quantity || 1,
    checked: targetItem.checked || false,
    previousState: previousState,
  };

  saveBasket();
  renderBasket();
  showToast(`🔄 Ausgetauscht zu ${deal.title} (${deal.retailer})!`);
}

/**
 * Macht einen vorherigen Tausch rückgängig und stellt das ursprüngliche Produkt wieder her
 */
function undoDealSwap(itemId) {
  const idx = state.basket.findIndex(i => i.id === itemId);
  if (idx === -1) return;

  const currentItem = state.basket[idx];
  if (!currentItem.previousState) return;

  const prev = currentItem.previousState;
  state.basket[idx] = {
    id: prev.id,
    title: prev.title,
    retailer: prev.retailer,
    price: prev.price,
    formattedPrice: prev.formattedPrice,
    oldPrice: prev.oldPrice,
    formattedOldPrice: prev.formattedOldPrice,
    imageUrl: prev.imageUrl,
    quantity: currentItem.quantity || prev.quantity || 1,
    checked: currentItem.checked || false,
  };

  saveBasket();
  renderBasket();
  showToast(`↩️ Ursprünglichen Artikel "${prev.title}" wiederhergestellt!`);
}

/**
 * Fallback-Funktionen für das DealSwap-Modal
 */
function openDealSwapModal(targetId, dealId) {
  const targetItem = state.basket.find(i => i.id === targetId);
  if (!targetItem) return;

  state.dealSwapTargetItem = targetItem;
  const alternatives = findAllBetterDeals(targetItem);

  if (alternatives.length > 0) {
    applyDirectDealSwap(targetItem.id, alternatives[0].id);
  }
}

function applyDealSwap(targetId, newOffer) {
  if (newOffer && newOffer.id) {
    applyDirectDealSwap(targetId, newOffer.id);
  }
}

function closeDealSwapModal() {
  if (elements.dealSwapModal) {
    elements.dealSwapModal.style.display = 'none';
    elements.dealSwapModal.setAttribute('aria-hidden', 'true');
  }
  state.dealSwapTargetItem = null;
}

/**
 * ==========================================================================
 * Meine Supermärkte (Aktivieren / Deaktivieren)
 * ==========================================================================
 */
const ALL_SUPERMARKETS = [
  'Lidl', 'Aldi Nord', 'Aldi Süd', 'REWE', 'REWE Center', 'Kaufland',
  'Edeka', 'Edeka Center', 'Penny', 'Netto Marken-Discount', 'Netto mit dem Hund',
  'Norma'
];

const DISCOUNTER_STORES = ['Lidl', 'Aldi Nord', 'Aldi Süd', 'Penny', 'Netto Marken-Discount', 'Netto mit dem Hund', 'Norma'];

const DISCONTINUED_STORES = ['Alnatura', 'Denns BioMarkt', 'tegut...', 'Globus', 'Hit'];

function initActiveStores() {
  if (Array.isArray(state.selectedMarkets) && state.selectedMarkets.length > 0) {
    state.activeStores = [...new Set(state.selectedMarkets.map(m => m.chain).filter(Boolean))];
    localStorage.setItem('sparfuchs_active_stores', JSON.stringify(state.activeStores));
    updateStoresBadge();
    renderRetailerChips();
    return;
  }
  if (!state.activeStores || !Array.isArray(state.activeStores) || state.activeStores.length === 0) {
    state.activeStores = [...ALL_SUPERMARKETS];
    localStorage.setItem('sparfuchs_active_stores', JSON.stringify(state.activeStores));
  } else {
    // Bereinigung: Veraltete Märkte ohne API-Angebote entfernen
    state.activeStores = state.activeStores.filter(s => !DISCONTINUED_STORES.includes(s));

    // Migration: Wenn der Nutzer REWE aktiv hatte, aber REWE Center noch fehlt, automatisch ergänzen
    if (state.activeStores.includes('REWE') && !state.activeStores.includes('REWE Center')) {
      const idx = state.activeStores.indexOf('REWE');
      state.activeStores.splice(idx + 1, 0, 'REWE Center');
    }
    if (state.activeStores.includes('Edeka') && !state.activeStores.includes('Edeka Center')) {
      const idx = state.activeStores.indexOf('Edeka');
      state.activeStores.splice(idx + 1, 0, 'Edeka Center');
    }
    // Migration: Netto mit dem Hund ergänzen falls fehlt
    if (!state.activeStores.includes('Netto mit dem Hund')) {
      const idx = state.activeStores.indexOf('Netto Marken-Discount');
      if (idx !== -1) {
        state.activeStores.splice(idx + 1, 0, 'Netto mit dem Hund');
      } else {
        state.activeStores.push('Netto mit dem Hund');
      }
    }
    localStorage.setItem('sparfuchs_active_stores', JSON.stringify(state.activeStores));
  }
  updateStoresBadge();
  renderRetailerChips();
}

function updateStoresBadge() {
  if (elements.storesCountBadge) {
    elements.storesCountBadge.textContent = state.activeStores.length;
  }
}

/**
 * Rendert die Händler-Filter-Chips dynamisch anhand der ausgewählten aktiven Supermärkte
 */
function renderRetailerChips() {
  if (!elements.retailerChipsContainer) return;

  const activeStores = Array.isArray(state.activeStores) && state.activeStores.length > 0
    ? state.activeStores
    : ALL_SUPERMARKETS;

  // Wenn der aktuell gewählte Händlerfilter nicht mehr in den aktiven Läden ist, zurücksetzen
  if (state.retailer !== 'all') {
    const isStillActive = activeStores.some(s => s.toLowerCase() === state.retailer.toLowerCase());
    if (!isStillActive) {
      state.retailer = 'all';
    }
  }

  const isAllActive = state.retailer === 'all';

  elements.retailerChipsContainer.innerHTML = sanitizeHtml`
    <button type="button" class="chip-retailer ${isAllActive ? 'active' : ''}" data-retailer="all">
      Alle aktiven Märkte (${activeStores.length})
    </button>
    ${activeStores.map(store => {
      const isActive = state.retailer.toLowerCase() === store.toLowerCase();
      return `
        <button type="button" class="chip-retailer ${isActive ? 'active' : ''}" data-retailer="${store}">
          ${store}
        </button>
      `;
    }).join('')}
    <button type="button" class="chip-retailer-manage" id="btnManageStoresFromChips" title="Meine Supermärkte anpassen">
      ⚙️ Märkte anpassen
    </button>
  `;

  // Click-Listener für die Händler-Filterchips
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

  const manageBtn = elements.retailerChipsContainer.querySelector('#btnManageStoresFromChips');
  if (manageBtn) {
    manageBtn.addEventListener('click', openStoresModal);
  }
}

function openStoresModal() {
  if (!elements.storesModal) return;
  marketSelectionDraft = new Map(state.selectedMarkets.map(market => [market.chain, market]));
  elements.marketChainSelect.replaceChildren();
  for (const chain of ALL_SUPERMARKETS) {
    const option = document.createElement('option');
    option.value = chain;
    option.textContent = chain;
    elements.marketChainSelect.append(option);
  }
  elements.marketChainSelect.value = state.selectedMarkets[0]?.chain || ALL_SUPERMARKETS[0];
  elements.marketSearchZipInput.value = state.zip;
  renderSelectedMarketDraft();
  state.nearbyMarkets = [];
  renderNearbyMarkets();
  elements.storesModal.style.display = 'flex';
  elements.storesModal.setAttribute('aria-hidden', 'false');
  ensureMarketMap();
  requestAnimationFrame(() => marketMap?.invalidateSize());
  loadNearbyMarkets();
}

let marketMap = null;
let marketMarkers = null;
let marketSelectionDraft = new Map();
let marketSearchRequestId = 0;

function ensureMarketMap() {
  if (marketMap || !window.L || !elements.marketMap) return;
  marketMap = L.map(elements.marketMap).setView([51.16, 10.45], 6);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap-Mitwirkende</a>',
  }).addTo(marketMap);
  marketMarkers = L.layerGroup().addTo(marketMap);
}

function renderSelectedMarketDraft() {
  const container = elements.selectedMarketsList;
  if (!container) return;
  container.replaceChildren();
  if (!marketSelectionDraft.size) {
    const empty = document.createElement('p');
    empty.textContent = 'Noch keine Filiale gewählt. Wähle zuerst eine Kette.';
    container.append(empty);
    return;
  }
  for (const [chain, market] of marketSelectionDraft) {
    const row = document.createElement('div');
    row.className = 'selected-market-row';
    const label = document.createElement('span');
    label.textContent = `${chain}: ${market.name}${market.address ? ` · ${market.address}` : ''}`;
    const mapLink = document.createElement('a');
    mapLink.href = market.mapsUrl;
    mapLink.target = '_blank';
    mapLink.rel = 'noopener noreferrer';
    mapLink.textContent = 'Google Maps';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Entfernen';
    remove.setAttribute('aria-label', `${chain} entfernen`);
    remove.addEventListener('click', () => {
      marketSelectionDraft.delete(chain);
      renderSelectedMarketDraft();
      renderNearbyMarkets();
    });
    row.append(label, mapLink, remove);
    container.append(row);
  }
}

function selectMarketForChain(market) {
  marketSelectionDraft.set(market.chain, market);
  renderSelectedMarketDraft();
  renderNearbyMarkets();
  elements.nearbyMarketsStatus.textContent = `${market.name} für ${market.chain} vorgemerkt. Mit „Auswahl speichern“ übernehmen.`;
}

function renderNearbyMarkets() {
  const container = elements.nearbyMarketsList;
  if (!container) return;
  container.replaceChildren();
  marketMarkers?.clearLayers();
  const markets = state.nearbyMarkets;
  const selectedId = marketSelectionDraft.get(elements.marketChainSelect.value)?.id;
  if (!markets.length) {
    return;
  }
  for (const market of markets) {
    const row = document.createElement('div');
    row.className = `nearby-market-row${selectedId === market.id ? ' selected' : ''}`;
    const details = document.createElement('div');
    details.className = 'market-details';
    const name = document.createElement('strong');
    name.textContent = market.name;
    const meta = document.createElement('small');
    meta.textContent = `${market.address || market.chain} · ${market.distanceKm} km`;
    details.append(name, meta);
    const select = document.createElement('button');
    select.type = 'button';
    select.textContent = selectedId === market.id ? 'Gewählt' : 'Wählen';
    select.addEventListener('click', () => selectMarketForChain(market));
    const mapLink = document.createElement('a');
    mapLink.href = market.mapsUrl;
    mapLink.target = '_blank';
    mapLink.rel = 'noopener noreferrer';
    mapLink.textContent = 'Google Maps';
    row.append(details, select, mapLink);
    container.append(row);
    if (marketMarkers) {
      const chosen = selectedId === market.id;
      const marker = L.circleMarker([market.lat, market.lon], {
        radius: chosen ? 11 : 8,
        color: chosen ? '#ffffff' : '#073b2a',
        weight: 2,
        fillColor: chosen ? '#00e599' : '#24a5f4',
        fillOpacity: 0.95,
      }).addTo(marketMarkers);
      const tooltip = document.createElement('span');
      tooltip.textContent = `${market.name}${market.address ? ` · ${market.address}` : ''}`;
      marker.bindTooltip(tooltip, { direction: 'top' });
      marker.on('click', () => selectMarketForChain(market));
    }
  }
}

async function loadNearbyMarkets(useMapCenter = false) {
  const button = elements.findNearbyMarketsBtn;
  if (!button) return;
  const zip = elements.marketSearchZipInput.value.trim();
  if (!/^\d{5}$/.test(zip)) {
    elements.nearbyMarketsStatus.textContent = 'Bitte eine gültige fünfstellige PLZ eingeben.';
    return;
  }
  const requestId = ++marketSearchRequestId;
  button.disabled = true;
  elements.nearbyMarketsStatus.textContent = 'Suche Filialen…';
  try {
    const params = new URLSearchParams({ zip, radius: elements.marketRadiusSelect.value, chain: elements.marketChainSelect.value });
    if (useMapCenter && marketMap) {
      const center = marketMap.getCenter();
      params.set('lat', String(center.lat));
      params.set('lon', String(center.lng));
    }
    const response = await fetch(`/api/markets?${params}`);
    const data = await response.json();
    if (requestId !== marketSearchRequestId) return;
    if (!response.ok) throw new Error(data.error || 'Filialen konnten nicht geladen werden');
    state.nearbyMarkets = data.markets || [];
    if (!useMapCenter && marketMap) {
      const zoom = Number(elements.marketRadiusSelect.value) > 15 ? 10 : 12;
      marketMap.setView([data.origin.lat, data.origin.lon], zoom);
    }
    renderNearbyMarkets();
    elements.nearbyMarketsStatus.textContent = `${state.nearbyMarkets.length} Filialen von ${elements.marketChainSelect.value} gefunden. Marker anklicken, dann Auswahl speichern.`;
  } catch (error) {
    if (requestId === marketSearchRequestId) elements.nearbyMarketsStatus.textContent = `Filialsuche fehlgeschlagen: ${error.message}`;
  } finally {
    if (requestId === marketSearchRequestId) button.disabled = false;
  }
}

function closeStoresModal() {
  if (elements.storesModal) {
    elements.storesModal.style.display = 'none';
    elements.storesModal.setAttribute('aria-hidden', 'true');
  }
}

function saveActiveStores() {
  if (!marketSelectionDraft.size) {
    showToast('⚠️ Bitte wähle mindestens eine Filiale auf der Karte aus.');
    return;
  }
  state.selectedMarkets = [...marketSelectionDraft.values()];
  state.activeStores = [...marketSelectionDraft.keys()];
  const zip = elements.marketSearchZipInput.value.trim();
  if (/^\d{5}$/.test(zip)) {
    state.zip = zip;
    elements.plzInput.value = zip;
    elements.basketPlzDisplay.textContent = zip;
    localStorage.setItem('sparfuchs_zip', zip);
  }
  localStorage.setItem('sparfuchs_selected_markets', JSON.stringify(state.selectedMarkets));
  localStorage.setItem('sparfuchs_active_stores', JSON.stringify(state.activeStores));
  updateStoresBadge();
  renderRetailerChips();
  closeStoresModal();
  showToast(`✅ ${state.selectedMarkets.length} Filialen gespeichert`);
  fetchOffers();
}

/**
 * ==========================================================================
 * Favoriten-Manager (Konkrete & Generische Favoriten)
 * ==========================================================================
 */
function openFavHubModal() {
  if (!elements.favHubModal) return;
  renderFavHubList();
  elements.favHubModal.style.display = 'flex';
  elements.favHubModal.setAttribute('aria-hidden', 'false');
}

function closeFavHubModal() {
  if (elements.favHubModal) {
    elements.favHubModal.style.display = 'none';
    elements.favHubModal.setAttribute('aria-hidden', 'true');
  }
}

function renderFavHubList() {
  if (!elements.favListContainer) return;
  if (!state.favorites || state.favorites.length === 0) {
    elements.favListContainer.innerHTML = `
      <div style="color:var(--text-dim); text-align:center; padding:1.5rem;">
        Du hast noch keine Favoriten gespeichert.<br>
        Trage oben ein Lieblingsprodukt ein (z. B. <em>Bio Eier</em>, <em>Kaffee</em>) oder klicke bei einem Angebot auf das Sternchen ⭐.
      </div>
    `;
    return;
  }

  elements.favListContainer.innerHTML = sanitizeHtml(state.favorites.map((fav, idx) => `
    <div class="fav-hub-item">
      <div class="fav-hub-item-left">
        <span class="fav-hub-star">⭐</span>
        <span class="fav-hub-text">${escapeHtml(fav)}</span>
      </div>
      <button type="button" class="btn-fav-hub-delete" data-index="${idx}" title="Favorit entfernen">✕</button>
    </div>
  `).join(''));

  elements.favListContainer.querySelectorAll('.btn-fav-hub-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-index'), 10);
      const removed = state.favorites.splice(idx, 1);
      saveFavorites();
      renderFavoritesBadge();
      renderFavHubList();
      renderOffers(state.offers);
      updateFavoritesRadar(state.offers);
      showToast(`⭐ "${removed[0]}" aus Favoriten entfernt`);
    });
  });
}

function addGenericFavorite(val) {
  if (!val) return;
  const clean = val.trim();
  if (!clean) return;

  if (state.favorites.some(f => f.toLowerCase() === clean.toLowerCase())) {
    showToast(`"${clean}" ist bereits in deinen Favoriten`);
    return;
  }

  state.favorites.unshift(clean);
  saveFavorites();
  renderFavoritesBadge();
  renderFavHubList();
  renderOffers(state.offers);
  updateFavoritesRadar(state.offers);
  state.radarDismissed = false;
  showToast(`⭐ "${clean}" zu Favoriten hinzugefügt!`);
}

/**
 * ==========================================================================
 * Sortierbare Tabelle (In-Memory Spaltensortierung)
 * ==========================================================================
 */
function handleTableSort(sortKey) {
  if (state.tableSort.key === sortKey) {
    state.tableSort.dir = state.tableSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    state.tableSort.key = sortKey;
    state.tableSort.dir = (sortKey === 'discount') ? 'desc' : 'asc';
  }

  sortOffersInState();
  updateTableSortIcons();
  renderOffers(state.offers);
}

function sortOffersInState() {
  const { key, dir } = state.tableSort;
  const mult = dir === 'desc' ? -1 : 1;

  state.offers.sort((a, b) => {
    switch (key) {
      case 'title':
        return mult * (a.title || '').localeCompare(b.title || '');
      case 'retailer':
        return mult * (a.retailer || '').localeCompare(b.retailer || '');
      case 'price': {
        const pA = typeof a.price === 'number' ? a.price : 999999;
        const pB = typeof b.price === 'number' ? b.price : 999999;
        return mult * (pA - pB);
      }
      case 'refPrice': {
        const rA = typeof a.referencePrice === 'number' && a.referencePrice > 0 ? a.referencePrice : 999999;
        const rB = typeof b.referencePrice === 'number' && b.referencePrice > 0 ? b.referencePrice : 999999;
        return mult * (rA - rB);
      }
      case 'discount': {
        const dA = typeof a.discountPercent === 'number' ? a.discountPercent : -1;
        const dB = typeof b.discountPercent === 'number' ? b.discountPercent : -1;
        return mult * (dA - dB);
      }
      case 'validTo': {
        const tA = a.validTo ? new Date(a.validTo).getTime() : 9999999999999;
        const tB = b.validTo ? new Date(b.validTo).getTime() : 9999999999999;
        return mult * (tA - tB);
      }
      default:
        return 0;
    }
  });
}

function updateTableSortIcons() {
  document.querySelectorAll('.th-sortable').forEach(th => {
    const k = th.getAttribute('data-sort');
    const iconSpan = th.querySelector('.sort-icon');
    if (k === state.tableSort.key) {
      th.classList.add('th-highlight');
      if (iconSpan) iconSpan.textContent = state.tableSort.dir === 'asc' ? '▲' : '▼';
    } else {
      th.classList.remove('th-highlight');
      if (iconSpan) iconSpan.textContent = '⇅';
    }
  });
}

/**
 * ==========================================================================
 * Rezept-Import (Chefkoch & Freitext Schema.org JSON-LD Parser)
 * ==========================================================================
 */
async function parseRecipeFromInput() {
  const val = elements.recipeUrlInput ? elements.recipeUrlInput.value.trim() : '';
  if (!val) {
    showToast('⚠️ Bitte einen Chefkoch-Link oder Zutaten eingeben');
    return;
  }

  if (elements.recipeParseSpinner) elements.recipeParseSpinner.style.display = 'block';
  if (elements.recipeResultPreview) elements.recipeResultPreview.style.display = 'none';

  try {
    const isUrl = /^https?:\/\//i.test(val);
    const payload = isUrl ? { url: val } : { text: val };

    const res = await fetch('/api/recipe/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    renderRecipePreview(data.recipe);
  } catch (err) {
    console.error('Rezept-Import Fehler:', err);
    showToast('⚠️ Rezept konnte nicht geladen werden. Probiere es mit reinem Text.');
  } finally {
    if (elements.recipeParseSpinner) elements.recipeParseSpinner.style.display = 'none';
  }
}

function renderRecipePreview(recipe) {
  if (!elements.recipeResultPreview) return;
  if (!recipe || !recipe.ingredients || recipe.ingredients.length === 0) {
    elements.recipeResultPreview.innerHTML = `
      <div style="color:var(--text-dim); padding:0.6rem; font-size:0.85rem; text-align:center;">
        Keine Zutaten erkannt. Bitte Format oder Link überprüfen.
      </div>
    `;
    elements.recipeResultPreview.style.display = 'block';
    return;
  }

  state.recipeIngredients = recipe.ingredients;

  elements.recipeResultPreview.innerHTML = sanitizeHtml`
    <div class="recipe-preview-header">
      <strong>🍲 ${escapeHtml(recipe.title || 'Rezept-Zutaten')}</strong>
      <span class="recipe-count-badge">${recipe.ingredients.length} Zutaten</span>
    </div>
    <ul class="recipe-ing-list">
      ${recipe.ingredients.map(ing => {
        const ingName = ing.name || ing.query || ing.original;
        return `
          <li>
            <span>${escapeHtml(ing.amount ? ing.amount + ' ' : '')}${escapeHtml(ing.unit ? ing.unit + ' ' : '')}<strong>${escapeHtml(ingName)}</strong></span>
          </li>
        `;
      }).join('')}
    </ul>
    <button type="button" id="applyRecipeToBasketBtn" class="btn-apply-recipe">
      🛒 Alle ${recipe.ingredients.length} Zutaten in Einkaufszettel übernehmen & optimieren
    </button>
  `;
  elements.recipeResultPreview.style.display = 'block';

  const btn = document.getElementById('applyRecipeToBasketBtn');
  if (btn) {
    btn.addEventListener('click', () => {
      let count = 0;
      recipe.ingredients.forEach(ing => {
        const ingName = ing.name || ing.query || ing.original;
        if (ingName) {
          addToBasket(ingName);
          count++;
        }
      });

      state.importedRecipesCount = (state.importedRecipesCount || 0) + 1;
      if (elements.recipeCountBadge) {
        elements.recipeCountBadge.style.display = 'inline-block';
        elements.recipeCountBadge.textContent = `${state.importedRecipesCount} importiert`;
      }

      if (elements.recipeUrlInput) {
        elements.recipeUrlInput.value = '';
      }

      elements.recipeResultPreview.innerHTML = sanitizeHtml`
        <div class="recipe-success-box" style="background:rgba(0,229,153,0.1); border:1px solid rgba(0,229,153,0.3); border-radius:var(--radius-sm); padding:0.75rem; text-align:center;">
          <div style="font-weight:700; color:var(--accent-primary); font-size:0.85rem;">
            ✅ „${escapeHtml(recipe.title || 'Rezept')}“ hinzugefügt (${count} Zutaten)!
          </div>
          <p style="font-size:0.75rem; color:var(--text-dim); margin:0.3rem 0 0.5rem 0;">
            Du kannst nun direkt ein weiteres Rezept oben einfügen.
          </p>
          <button type="button" id="btnNextRecipe" class="btn-next-recipe">
            ➕ Weiteres Rezept hinzufügen
          </button>
        </div>
      `;

      const nextBtn = document.getElementById('btnNextRecipe');
      if (nextBtn) {
        nextBtn.addEventListener('click', () => {
          elements.recipeResultPreview.style.display = 'none';
          elements.recipeResultPreview.innerHTML = '';
          if (elements.recipeUrlInput) elements.recipeUrlInput.focus();
        });
      }

      showToast(`🍳 ${count} Zutaten von „${recipe.title || 'Rezept'}“ übernommen!`);
      optimizeBasket();
    });
  }
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
    const res = await fetch('/api/history', { headers: historyHeaders() });
    if (res.ok) {
      const data = await res.json();
      const serverHistory = Array.isArray(data.history) ? data.history : [];

      // Wenn der Server frisch gestartet ist (z. B. nach Render Spin-Down) und leer ist,
      // aber der Client im localStorage noch Belege hat: Automatisch wiederherstellen!
      if (serverHistory.length === 0 && state.history && state.history.length > 0) {
        try {
          const syncRes = await fetch('/api/history/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...historyHeaders() },
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
function openCheckoutReview() {
  if (!state.basket?.length) {
    showToast('⚠️ Dein Einkaufszettel ist leer! Füge zuerst Artikel hinzu.');
    return;
  }
  const container = elements.checkoutReviewItems;
  container.replaceChildren();
  state.basket.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'checkout-review-row';
    row.dataset.index = String(index);
    const bought = document.createElement('input');
    bought.type = 'checkbox';
    bought.checked = true;
    bought.className = 'checkout-bought';
    bought.setAttribute('aria-label', `${item.title} gekauft`);
    const description = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = `${item.quantity || 1}× ${item.title}`;
    const store = document.createElement('small');
    store.textContent = item.retailer || 'Einkaufsnotiz';
    description.append(title, store);
    const price = document.createElement('input');
    price.type = 'number';
    price.min = '0';
    price.step = '0.01';
    price.value = item.price > 0 ? item.price.toFixed(2) : '';
    price.placeholder = 'Preis €';
    price.className = 'checkout-actual-price';
    price.setAttribute('aria-label', `Tatsächlicher Einzelpreis für ${item.title}`);
    row.append(bought, description, price);
    container.append(row);
  });
  elements.checkoutReviewDialog.showModal();
}

function confirmCheckoutReview() {
  const purchased = [];
  const remaining = [];
  for (const row of elements.checkoutReviewItems.querySelectorAll('.checkout-review-row')) {
    const original = state.basket[Number(row.dataset.index)];
    if (!row.querySelector('.checkout-bought').checked) {
      remaining.push(original);
      continue;
    }
    const actualPrice = Number(row.querySelector('.checkout-actual-price').value);
    if (!Number.isFinite(actualPrice) || actualPrice <= 0) {
      showToast(`Bitte einen bezahlten Preis für „${original.title}“ eingeben.`);
      return;
    }
    purchased.push({ ...original, price: actualPrice, formattedPrice: `${actualPrice.toFixed(2).replace('.', ',')} €` });
  }
  if (!purchased.length) {
    showToast('Kein gekaufter Artikel ausgewählt.');
    return;
  }
  elements.checkoutReviewDialog.close();
  bookCurrentBasket(purchased, remaining);
}

async function bookCurrentBasket(itemsToBook, remainingItems = []) {
  if (!itemsToBook?.length) return;

  // Berechnung der Gesamtsummen und Ersparnisse
  let totalPaid = 0;
  let totalRegular = 0;
  let totalUnits = 0;
  const storesSet = new Set();

  itemsToBook.forEach(it => {
    const store = it.retailer || 'Einkaufsnotizen';
    storesSet.add(store);
    const qty = (typeof it.quantity === 'number' && it.quantity > 0) ? it.quantity : 1;
    totalUnits += qty;

    if (typeof it.price === 'number' && it.price > 0) {
      totalPaid += it.price * qty;
      const sanitizedOld = getVerifiedOldPrice(it);
      const effectiveOld = (sanitizedOld && sanitizedOld > it.price)
        ? sanitizedOld : it.price;
      totalRegular += effectiveOld * qty;
    }
  });

  const totalSavings = Math.max(0, totalRegular - totalPaid);
  const stores = Array.from(storesSet);

  // Snapshot der Artikel
  const itemsSnapshot = itemsToBook.map(it => {
    const qty = (typeof it.quantity === 'number' && it.quantity > 0) ? it.quantity : 1;
    const sanitizedOld = getVerifiedOldPrice(it);
    const effectiveOld = (sanitizedOld && sanitizedOld > it.price)
      ? sanitizedOld : null;
    return {
      title: it.title,
      retailer: it.retailer || 'Einkaufsnotizen',
      quantity: qty,
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
    itemCount: totalUnits,
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
      headers: { 'Content-Type': 'application/json', ...historyHeaders() },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    state.history = data.history || [];
    state.householdStats = data.stats || null;
    localStorage.setItem('sparfuchs_history', JSON.stringify(state.history));

    // Einkaufszettel leeren
    state.basket = remainingItems;
    saveBasket();
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
    const res = await fetch(`/api/history/${encodeURIComponent(receiptId)}`, { method: 'DELETE', headers: historyHeaders() });
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
    const res = await fetch('/api/history', { method: 'DELETE', headers: historyHeaders() });
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

  // Vorrats-Kalkulator & Ersparnis-Projektion auf 1 Jahr
  if (elements.kpiAnnualSavings) {
    elements.kpiAnnualSavings.textContent = `~${(s.projectedAnnualSavings || 0).toFixed(2).replace('.', ',')} €`;
  }
  if (elements.kpiMonthlySavings) {
    elements.kpiMonthlySavings.textContent = `~${(s.projectedMonthlySavings || 0).toFixed(2).replace('.', ',')} €`;
  }
  if (elements.kpiAvgSavingsPerTrip) {
    elements.kpiAvgSavingsPerTrip.textContent = `${(s.averageSavingsPerTrip || 0).toFixed(2).replace('.', ',')} €`;
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
                <span>🛒</span> ${escapeHtml(st.store)}
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
      elements.historyStoreBarsContainer.innerHTML = sanitizeHtml(storeHtml);
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
            <strong>${escapeHtml(m.label)}</strong>
            <span class="monthly-badge-count">(${m.tripsCount} ${m.tripsCount === 1 ? 'Einkauf' : 'Einkäufe'})</span>
          </div>
          <div class="monthly-col-stats">
            <span class="monthly-stat-spent">${m.spent.toFixed(2).replace('.', ',')} €</span>
            <span class="monthly-stat-saved">-${m.savings.toFixed(2).replace('.', ',')} € (${m.savingsPercent}%)</span>
          </div>
        </div>
      `).join('');
      elements.historyMonthlyContainer.innerHTML = sanitizeHtml(monthHtml);
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
          <div class="receipt-card" data-receipt-id="${escapeHtml(rc.id)}">
            <div class="receipt-header-row">
              <div class="receipt-date-group">
                <span class="receipt-date">${escapeHtml(dateFormatted)}</span>
                <div class="receipt-stores">
                  ${stores.map(st => `<span class="receipt-stores-tag">${escapeHtml(st)}</span>`).join('')}
                </div>
              </div>
              <div class="receipt-actions">
                <button class="btn-del-receipt" data-receipt-id="${escapeHtml(rc.id)}" title="Beleg aus Historie löschen">🗑️</button>
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
              <button type="button" class="receipt-accordion-toggle" data-receipt-id="${escapeHtml(rc.id)}">
                <span>📋</span>
                <span>${items.length} Artikel anzeigen ▾</span>
              </button>
              <div class="receipt-details-list" id="receipt-details-${escapeHtml(rc.id)}">
                ${items.map(it => {
                  const itPriceStr = it.formattedPrice || (it.price ? `${it.price.toFixed(2).replace('.', ',')} €` : '');
                  const itOldStr = it.formattedOldPrice || (it.oldPrice ? `${it.oldPrice.toFixed(2).replace('.', ',')} €` : '');
                  return `
                    <div class="receipt-detail-item">
                      <span class="item-title">
                        ${it.checked ? '✓ ' : '• '} ${it.quantity && it.quantity > 1 ? `<strong>${it.quantity}x</strong> ` : ''}${escapeHtml(it.title)} 
                        <small style="color:var(--text-dim);">(${escapeHtml(it.retailer)})</small>
                      </span>
                      <span>
                        <strong>${escapeHtml(itPriceStr)}</strong>
                        ${itOldStr && itOldStr !== itPriceStr ? `<span style="font-size:0.72rem; color:var(--text-dim); text-decoration:line-through; margin-left:0.3rem;">${escapeHtml(itOldStr)}</span>` : ''}
                      </span>
                    </div>
                  `;
                }).join('')}
              </div>
            ` : ''}
          </div>
        `;
      }).join('');

      elements.receiptsListContainer.innerHTML = sanitizeHtml(receiptsHtml);

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
    addQueryToSearchHistory(val);
    fetchOffers();
  });

  // Such-Input mit 350ms Live-Debounce & Clear Button
  let searchDebounceTimer = null;
  elements.searchInput.addEventListener('input', () => {
    elements.clearSearchBtn.style.display = elements.searchInput.value ? 'block' : 'none';
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      const val = elements.searchInput.value.trim();
      if (val.length >= 2 && val !== state.query) {
        state.query = val;
        state.onlyFavorites = false;
        elements.toggleFavFilterBtn.classList.remove('active');
        addQueryToSearchHistory(val);
        fetchOffers();
      } else if (val.length === 0 && state.query !== '') {
        state.query = '';
        fetchOffers();
      }
    }, 350);
  });

  elements.clearSearchBtn.addEventListener('click', () => {
    elements.searchInput.value = '';
    elements.clearSearchBtn.style.display = 'none';
    elements.searchInput.focus();
    if (state.query !== '') {
      state.query = '';
      fetchOffers();
    }
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
      renderRetailerChips();
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
    if (elements.favoritesSearchTag) elements.favoritesSearchTag.classList.toggle('active', state.onlyFavorites);

    if (state.onlyFavorites && state.favorites.length === 0) {
      showToast('Füge zuerst Produkte mit dem Stern ⭐ zu deinen Favoriten hinzu!');
    }
    fetchOffers();
  };

  elements.toggleFavFilterBtn.addEventListener('click', activateFavoritesFilter);
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
      if (val !== state.zip) {
        // Exact branches belong to the previous location; keep the chain choices.
        state.nearbyMarkets = [];
        state.selectedMarkets = [];
        localStorage.removeItem('sparfuchs_selected_markets');
      }
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

  const backBasket = document.getElementById('backToOffersBtnBasket');
  if (backBasket) backBasket.addEventListener('click', closeAllDrawers);

  if (elements.openHistoryBtn) {
    elements.openHistoryBtn.addEventListener('click', openHistoryDrawer);
  }
  if (elements.closeHistoryBtn) {
    elements.closeHistoryBtn.addEventListener('click', closeHistoryDrawer);
  }

  const backHistory = document.getElementById('backToOffersBtnHistory');
  if (backHistory) backHistory.addEventListener('click', closeAllDrawers);

  elements.drawerBackdrop.addEventListener('click', closeAllDrawers);

  // ESC-Taste schließt geöffnete Drawer & Modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllDrawers();
      closeQrModal();
      closeImportModal();
      closeStoresModal();
      closeFavHubModal();
      closeDealSwapModal();
    }
  });

  // Mindestrabatt Chips
  document.querySelectorAll('.chip-discount').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip-discount').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.minDiscount = parseInt(chip.getAttribute('data-min-discount'), 10) || 0;
      fetchOffers();
    });
  });

  // Sortierbare Tabellen-Spaltenköpfe
  document.querySelectorAll('.th-sortable').forEach(th => {
    th.addEventListener('click', () => {
      const sortKey = th.getAttribute('data-sort');
      if (sortKey) handleTableSort(sortKey);
    });
  });

  // Meine Supermärkte Modal
  if (elements.openStoresBtn) {
    elements.openStoresBtn.addEventListener('click', openStoresModal);
  }
  if (elements.closeStoresModalBtn) {
    elements.closeStoresModalBtn.addEventListener('click', closeStoresModal);
  }
  if (elements.saveStoresBtn) {
    elements.saveStoresBtn.addEventListener('click', saveActiveStores);
  }
  if (elements.findNearbyMarketsBtn) {
    elements.findNearbyMarketsBtn.addEventListener('click', () => loadNearbyMarkets(false));
  }
  elements.searchMapAreaBtn?.addEventListener('click', () => loadNearbyMarkets(true));
  elements.marketChainSelect?.addEventListener('change', () => {
    state.nearbyMarkets = [];
    renderNearbyMarkets();
    loadNearbyMarkets(false);
  });

  // Favoriten-Manager Modal
  if (elements.openFavHubBtn) {
    elements.openFavHubBtn.addEventListener('click', openFavHubModal);
  }
  if (elements.closeFavHubModalBtn) {
    elements.closeFavHubModalBtn.addEventListener('click', closeFavHubModal);
  }
  if (elements.addGenericFavForm) {
    elements.addGenericFavForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = elements.genericFavInput ? elements.genericFavInput.value : '';
      addGenericFavorite(val);
      if (elements.genericFavInput) elements.genericFavInput.value = '';
    });
  }

  // Deal-Swap Modal
  if (elements.closeDealSwapModalBtn) {
    elements.closeDealSwapModalBtn.addEventListener('click', closeDealSwapModal);
  }

  // Favoriten in Optimierer einfügen
  if (elements.insertFavsToOptBtn) {
    elements.insertFavsToOptBtn.addEventListener('click', insertFavoritesToOptimizer);
  }

  // Rezept-Import
  if (elements.recipeParseBtn) {
    elements.recipeParseBtn.addEventListener('click', parseRecipeFromInput);
  }
  if (elements.recipeUrlInput) {
    elements.recipeUrlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        parseRecipeFromInput();
      }
    });
  }

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

  // Einkaufsliste Quick Actions: Teilen, QR-Code & Leeren
  if (elements.headerQrBtn) {
    elements.headerQrBtn.addEventListener('click', () => {
      if (!state.basket || state.basket.length === 0) {
        if (elements.basketDrawer) {
          elements.basketDrawer.classList.add('open');
          elements.basketDrawer.setAttribute('aria-hidden', 'false');
        }
        if (elements.drawerBackdrop) elements.drawerBackdrop.classList.add('active');
        showToast('🛒 Notiere zuerst Angebote auf deiner Einkaufsliste!');
      } else {
        openQrModal();
      }
    });
  }
  if (elements.shareBasketBtn) {
    elements.shareBasketBtn.addEventListener('click', shareBasket);
  }
  if (elements.qrBasketBtn) {
    elements.qrBasketBtn.addEventListener('click', openQrModal);
  }
  if (elements.basketBottomQrBtn) {
    elements.basketBottomQrBtn.addEventListener('click', openQrModal);
  }
  if (elements.clearBasketBtn) {
    elements.clearBasketBtn.addEventListener('click', clearAllBasket);
  }
  elements.saveBasketTemplateBtn?.addEventListener('click', saveBasketTemplate);
  elements.loadBasketTemplateBtn?.addEventListener('click', loadBasketTemplate);
  elements.deleteBasketTemplateBtn?.addEventListener('click', deleteBasketTemplate);
  elements.extraStoreCostInput?.addEventListener('change', () => {
    state.extraStoreCost = Math.min(100, Math.max(0, Number(elements.extraStoreCostInput.value) || 0));
    localStorage.setItem('sparfuchs_extra_store_cost', String(state.extraStoreCost));
  });

  // QR-Code Modal Buttons
  if (elements.closeQrModalBtn) {
    elements.closeQrModalBtn.addEventListener('click', closeQrModal);
  }
  if (elements.copyShareLinkBtn) {
    elements.copyShareLinkBtn.addEventListener('click', copyShareLink);
  }
  // Smartphone Import Modal Buttons
  if (elements.closeImportModalBtn) {
    elements.closeImportModalBtn.addEventListener('click', closeImportModal);
  }
  if (elements.confirmImportAppendBtn) {
    elements.confirmImportAppendBtn.addEventListener('click', () => applyImportedBasket('append'));
  }
  if (elements.confirmImportReplaceBtn) {
    elements.confirmImportReplaceBtn.addEventListener('click', () => applyImportedBasket('replace'));
  }

  // Favoriten-Radar Schließen-Button
  if (elements.closeRadarBtn) {
    elements.closeRadarBtn.addEventListener('click', () => {
      state.radarDismissed = true;
      if (elements.favoritesRadarContainer) {
        elements.favoritesRadarContainer.style.display = 'none';
      }
    });
  }

  // Einkauf abschließen & verbuchen Button
  if (elements.bookBasketBtn) {
    elements.bookBasketBtn.addEventListener('click', openCheckoutReview);
  }
  elements.cancelCheckoutReviewBtn?.addEventListener('click', () => elements.checkoutReviewDialog.close());
  elements.confirmCheckoutReviewBtn?.addEventListener('click', confirmCheckoutReview);

  // Historie leeren Button
  if (elements.clearHistoryBtn) {
    elements.clearHistoryBtn.addEventListener('click', clearAllHistory);
  }

  // Supermarkt-Modus Umschalter
  if (elements.toggleStoreModeBtn) {
    elements.toggleStoreModeBtn.addEventListener('click', toggleStoreMode);
  }
  if (elements.exitStoreModeBtn) {
    elements.exitStoreModeBtn.addEventListener('click', toggleStoreMode);
  }

  // Laufweg-Sortierung Umschalter
  if (elements.toggleAisleSortBtn) {
    elements.toggleAisleSortBtn.addEventListener('click', () => {
      state.aisleSort = !state.aisleSort;
      if (elements.aisleSortText) {
        elements.aisleSortText.textContent = state.aisleSort ? 'Laufweg-Sortierung: An 🧭' : 'Laufweg-Sortierung: Aus';
      }
      elements.toggleAisleSortBtn.classList.toggle('active', state.aisleSort);
      showToast(state.aisleSort ? '🧭 Laufweg-Sortierung nach Gängen aktiviert' : 'Laufweg-Sortierung deaktiviert');
      renderBasket();
    });
  }

  // Budget-Eingabe im Warenkorb
  if (elements.basketBudgetInput) {
    if (state.budget > 0) {
      elements.basketBudgetInput.value = state.budget;
    }
    elements.basketBudgetInput.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value) || 0;
      state.budget = val;
      if (val > 0) {
        localStorage.setItem('sparfuchs_budget', String(val));
      } else {
        localStorage.removeItem('sparfuchs_budget');
      }
      renderBasket();
    });
  }

  // Drucken Button
  if (elements.printBasketBtn) {
    elements.printBasketBtn.addEventListener('click', () => {
      window.print();
    });
  }

  // Suchverlauf leeren
  if (elements.clearSearchHistoryBtn) {
    elements.clearSearchHistoryBtn.addEventListener('click', () => {
      state.searchHistory = [];
      localStorage.removeItem('sparfuchs_search_history');
      renderSearchHistoryChips();
      showToast('Suchverlauf gelöscht');
    });
  }

  // CSV Export im Haushaltsplan
  if (elements.exportCsvBtn) {
    elements.exportCsvBtn.addEventListener('click', exportHistoryAsCsv);
  }
  elements.exportHistoryJsonBtn?.addEventListener('click', exportHistoryJson);
  elements.importHistoryJsonBtn?.addEventListener('click', () => elements.importHistoryFileInput?.click());
  elements.importHistoryFileInput?.addEventListener('change', (event) => {
    importHistoryJson(event.target.files?.[0]);
    event.target.value = '';
  });
}

/**
 * Ermöglicht das stufenlose Skalieren der Einkaufslisten-Breite im Desktop
 */
function initDrawerResizing() {
  const savedWidth = localStorage.getItem('sparfuchs_drawer_width');
  if (savedWidth && Number(savedWidth) >= 380) {
    document.documentElement.style.setProperty('--basket-drawer-width', `${savedWidth}px`);
  }

  const handle = elements.drawerResizeHandle;
  const drawer = elements.basketDrawer;
  if (!handle || !drawer) return;

  let isResizing = false;
  let startX = 0;
  let startWidth = 480;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isResizing = true;
    drawer.classList.add('resizing');
    handle.classList.add('active');
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';

    startX = e.clientX;
    startWidth = drawer.getBoundingClientRect().width;

    function onMouseMove(moveEvent) {
      if (!isResizing) return;
      const deltaX = startX - moveEvent.clientX;
      const maxAllowed = Math.round(window.innerWidth * 0.88);
      const newWidth = Math.max(380, Math.min(maxAllowed, startWidth + deltaX));
      document.documentElement.style.setProperty('--basket-drawer-width', `${newWidth}px`);
    }

    function onMouseUp() {
      if (!isResizing) return;
      isResizing = false;
      drawer.classList.remove('resizing');
      handle.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);

      const finalWidth = drawer.getBoundingClientRect().width;
      localStorage.setItem('sparfuchs_drawer_width', Math.round(finalWidth));
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });
}

/**
 * Initialisiert das Ein- und Ausklappen der Rezept-Import-Box
 */
function initRecipeToggle() {
  const toggleBtn = elements.btnToggleRecipeCard;
  const header = elements.recipeHeaderToggle;
  const card = elements.recipeImportCard;
  if (!card) return;

  function toggle() {
    card.classList.toggle('collapsed');
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggle();
    });
  }

  if (header) {
    header.addEventListener('click', toggle);
  }
}

function checkForSharedRecipe() {
  const params = new URLSearchParams(window.location.search);
  const shared = params.get('url') || params.get('text');
  if (!shared || !elements.recipeUrlInput) return;
  elements.recipeUrlInput.value = shared.slice(0, 4000);
  elements.recipeImportCard?.classList.remove('collapsed');
  elements.basketDrawer?.classList.add('open');
  elements.basketDrawer?.setAttribute('aria-hidden', 'false');
  elements.drawerBackdrop?.classList.add('active');
  window.history.replaceState({}, document.title, window.location.pathname);
  parseRecipeFromInput();
}

// Screen Wake Lock bei Tab-Wechsel reaktivieren (falls im Supermarkt-Modus)
document.addEventListener('visibilitychange', async () => {
  if (state.storeMode && document.visibilityState === 'visible' && 'wakeLock' in navigator) {
    try {
      state.wakeLock = await navigator.wakeLock.request('screen');
    } catch (_) {}
  }
});

// PWA Service Worker für Offline-Resilienz im Supermarkt registrieren
if ('serviceWorker' in navigator && (window.location.protocol === 'http:' || window.location.protocol === 'https:')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('ServiceWorker-Registrierung nicht möglich:', err);
    });
  });
}

// Initialisierung beim Laden
document.addEventListener('DOMContentLoaded', () => {
  elements.plzInput.value = state.zip;
  elements.searchInput.value = state.query;
  elements.clearSearchBtn.style.display = state.query ? 'block' : 'none';
  
  if (elements.basketBudgetInput && state.budget > 0) {
    elements.basketBudgetInput.value = state.budget;
  }
  if (elements.extraStoreCostInput) elements.extraStoreCostInput.value = state.extraStoreCost;

  initActiveStores();
  initEvents();
  initDrawerResizing();
  initRecipeToggle();
  renderFavoritesBadge();
  renderSearchHistoryChips();
  renderBasket();
  renderBasketTemplates();
  fetchAndRenderHistory();
  loadCategories();
  fetchOffers();
  checkForIncomingBasketShare();
  checkForSharedRecipe();
});
