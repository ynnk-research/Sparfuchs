/**
 * Kategorisierungs-Engine für Supermarkt-Angebote
 * Teilt Angebote intelligent in standardisierte Warengruppen ein
 * und ermöglicht echtes Filtern nach Molkerei, Obst/Gemüse, Fleisch, Getränken etc.
 */

export const CATEGORY_DEFINITIONS = [
  {
    id: 'dairy',
    icon: '🧀',
    title: 'Molkerei & Eier',
    description: 'Milch, Butter, Käse, Joghurt, Quark & Eier',
    searchKeywords: ['Milch', 'Butter', 'Käse', 'Joghurt', 'Eier', 'Quark', 'Sahne', 'Frischkäse'],
    items: ['Milch', 'Butter', 'Käse', 'Joghurt', 'Eier', 'Quark', 'Sahne', 'Frischkäse'],
    regex: /(milch|butter|käse|kaese|joghurt|quark|sahne|schmand|eier|frischkäse|frischkaese|margarine|pudding|skyr|mozzarella|gouda|emmentaler|parmesan|camembert|brie|feta|hirtenkäse|ayran|kefir|dessert|rahm)/i,
  },
  {
    id: 'produce',
    icon: '🍎',
    title: 'Obst & Gemüse',
    description: 'Frisches Obst, Gemüse, Salate & Kräuter',
    searchKeywords: ['Äpfel', 'Bananen', 'Tomaten', 'Gurken', 'Kartoffeln', 'Paprika', 'Salat', 'Beeren'],
    items: ['Äpfel', 'Bananen', 'Tomaten', 'Gurken', 'Kartoffeln', 'Paprika', 'Salat', 'Beeren'],
    regex: /(apfel|äpfel|aepfel|banane|tomate|gurke|kartoffel|zwiebel|salat|paprika|beere|erdbeer|himbeer|blaubeer|heidelbeer|orange|mandarine|möhre|moehre|karotte|zitron|avocado|pilz|champignon|traube|kiwi|mango|ananas|zucchini|kohl|blumenkohl|brokkoli|radieschen|lauch|spargel|melone|nektarin|pfirsich|pflaume|kirsch)/i,
  },
  {
    id: 'meat',
    icon: '🥩',
    title: 'Fleisch & Fisch',
    description: 'Fleisch, Geflügel, Wurst, Fisch & Veggie-Alternativen',
    searchKeywords: ['Hähnchen', 'Rinderhack', 'Lachs', 'Bratwurst', 'Tofu', 'Schinken', 'Salami'],
    items: ['Hähnchen', 'Rinderhack', 'Lachs', 'Bratwurst', 'Tofu', 'Schinken', 'Salami'],
    regex: /(fleisch|hack|steak|schnitzel|kotelett|gulasch|braten|wurst|würst|salami|schinken|leberkäse|bacon|hähnchen|haehnchen|huhn|hühner|pute|ente|gans|rind|schwein|lachs|forelle|thunfisch|garnel|shrimp|fisch|kabeljau|seelachs|hering|matjes|tofu|seitan|veggie.*wurst|vegan.*schnitzel|backfisch)/i,
  },
  {
    id: 'drinks',
    icon: '☕',
    title: 'Kaffee & Getränke',
    description: 'Kaffee, Tee, Wasser, Säfte, Softdrinks, Bier & Wein',
    searchKeywords: ['Kaffee', 'Bier', 'Cola', 'Mineralwasser', 'Tee', 'Orangensaft', 'Wein'],
    items: ['Kaffee', 'Bier', 'Cola', 'Mineralwasser', 'Tee', 'Orangensaft', 'Wein'],
    regex: /(kaffee|espresso|cappuccino|bohne|tee|wasser|mineralwasser|sprudel|saft|nektar|bier|pils|weizen|radler|wein|sekt|prosecco|champagner|cola|limo|energy|sirup|getränk|drink)/i,
  },
  {
    id: 'snacks',
    icon: '🍫',
    title: 'Süßes & Snacks',
    description: 'Schokolade, Chips, Kekse, Eis & Knabbereien',
    searchKeywords: ['Schokolade', 'Chips', 'Kekse', 'Gummibärchen', 'Eis', 'Nüsse'],
    items: ['Schokolade', 'Chips', 'Kekse', 'Gummibärchen', 'Eis', 'Nüsse'],
    regex: /(schoko|praline|chips|keks|cookie|bonbon|gummi|fruchtgummi|bärchen|baerchen|haribo|katjes|speiseeis|cremissimo|snack|popcorn|nuss|nüss|erdnuss|mandel|cashew|pistazie|salzstange|brezel|waffel|riegel|toffifee|knoppers|hanuta|duplo|kinder|milka|ritter|donut|cronut)/i,
  },
  {
    id: 'pantry',
    icon: '🍝',
    title: 'Vorrat & Grundnahrung',
    description: 'Nudeln, Reis, Mehl, Öle, Saucen, Konserven & Brot',
    searchKeywords: ['Nudeln', 'Reis', 'Haferflocken', 'Olivenöl', 'Passierte Tomaten', 'Brot', 'Mehl'],
    items: ['Nudeln', 'Reis', 'Haferflocken', 'Olivenöl', 'Passierte Tomaten', 'Brot', 'Mehl'],
    regex: /(nudel|pasta|spaghetti|penne|fusilli|reis|basmati|mehl|zucker|salz|haferflocke|müsli|cornflakes|öl|oel|olivenöl|rapsöl|sonnenblumenöl|essig|sauce|soße|ketchup|senf|mayo|tomatensauce|passierte|konserve|dose|erbse|linse|bohne|kichererbse|gewürz|pfeffer|brot|toast|brötchen|broetchen|baguette|backmischung|hefe|backshop|tasche|laugen|gebäck|gebaeck|kuchen)/i,
  },
  {
    id: 'nonfood',
    icon: '📦',
    title: 'Nicht-Lebensmittel & Aktionsware',
    description: 'Drogerie, Haushalt, Werkzeug, Garten, Kleidung & Deko',
    searchKeywords: ['Werkzeug', 'Garten', 'Kleidung', 'Küche', 'Elektronik', 'Haushalt', 'Drogerie'],
    items: ['Werkzeug', 'Garten', 'Kleidung', 'Küche', 'Elektronik', 'Haushalt', 'Drogerie'],
    regex: /(drogerie|shampoo|duschgel|seife|zahnpasta|zahnbürste|deo|haarspray|waschmittel|weichspüler|spülmittel|geschirr|reiniger|putzmittel|toilettenpapier|klopapier|küchenrolle|taschentuch|taschentücher|windel|werkzeug|bohrer|schraube|akku|batterie|garten|pflanze|blume|erde|dünger|kleidung|shirt|hose|socke|jacke|schuh|küche|pfanne|topf|messer|elektronik|kabel|lampe|leuchte|deko|kerze|tierfutter|katzenfutter|hundefutter)/i,
  },
];

/**
 * Ordnet ein beliebiges Angebot eindeutig einer Warengruppe zu
 */
export function classifyOffer(offer) {
  if (!offer) {
    return {
      categoryId: 'other',
      categoryLabel: 'Sonstiges',
      categoryIcon: '🛒',
    };
  }

  // 1. Wenn explizit Non-Food deklariert ist
  if (offer.isNonFood) {
    return {
      categoryId: 'nonfood',
      categoryLabel: 'Nicht-Lebensmittel & Aktionsware',
      categoryIcon: '📦',
    };
  }

  const rawCats = Array.isArray(offer.categories) ? offer.categories.join(' ') : '';
  const text = `${offer.title || ''} ${offer.brand || ''} ${offer.description || ''} ${rawCats}`.toLowerCase();

  // Prioritäts-Reihenfolge:
  // Non-Food -> Snacks -> Dairy -> Meat -> Produce -> Drinks -> Pantry
  const order = ['nonfood', 'snacks', 'dairy', 'meat', 'produce', 'drinks', 'pantry'];
  for (const id of order) {
    const def = CATEGORY_DEFINITIONS.find(c => c.id === id);
    if (def && def.regex.test(text)) {
      return {
        categoryId: def.id,
        categoryLabel: def.title,
        categoryIcon: def.icon,
      };
    }
  }

  return {
    categoryId: 'other',
    categoryLabel: 'Sonstiges',
    categoryIcon: '🛒',
  };
}

/**
 * Filtert eine Liste von Angeboten nach einer Warengruppe
 */
export function filterOffersByCategory(offers = [], categoryId = 'all') {
  if (!Array.isArray(offers)) return [];
  if (!categoryId || categoryId === 'all') return offers;

  return offers.filter(offer => {
    if (offer.categoryId) {
      return offer.categoryId === categoryId;
    }
    const c = classifyOffer(offer);
    return c.categoryId === categoryId;
  });
}
