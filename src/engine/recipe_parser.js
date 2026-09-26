/**
 * Rezept-Parser Engine
 * Extrahiert Zutaten aus Rezept-Websites (z. B. Chefkoch, Food-Blogs) via W3C Schema.org JSON-LD
 * und bereinigt Zutatenangaben für die Supermarkt-Angebotssuche.
 */

const UNIT_PATTERNS = [
  'esslöffel', 'el',
  'teelöffel', 'tl',
  'messerspitze', 'msp',
  'prise', 'prisen',
  'gramm', 'g',
  'kilogramm', 'kilo', 'kg',
  'milliliter', 'ml',
  'liter', 'l',
  'bund', 'bündel',
  'dose', 'dosen',
  'packung', 'packungen', 'pck', 'päckchen', 'pkg',
  'becher',
  'glas', 'gläser',
  'zehe', 'zehen',
  'knolle', 'knollen',
  'stange', 'stangen',
  'scheibe', 'scheiben',
  'stück', 'stk',
  'schuss', 'spritzer',
  'tropfen',
  'zweig', 'zweige',
  'blatt', 'blätter',
];

const PREPARATION_WORDS = [
  'gewürfelt', 'fein gewürfelt', 'in würfel', 'in würfeln', 'in scheiben', 'in streifen', 'in ringe',
  'gehackt', 'fein gehackt', 'grob gehackt', 'gerieben', 'fein gerieben', 'geriebener', 'geriebene',
  'geschält', 'geschälte', 'geschälter', 'geschältes',
  'gemischt', 'gemischtes', 'gemischter',
  'in flocken', 'flocken', 'zerlassen', 'flüssig', 'flüssige', 'flüssiges',
  'kalt', 'kalte', 'kaltes', 'warm', 'warme', 'warmes', 'zimmerwarm',
  'frisch', 'frische', 'frischer', 'frisches', 'frisch gemahlen', 'frisch geriebene',
  'getrocknet', 'getrocknete', 'getrockneter', 'getrocknetes',
  'nach belieben', 'nach geschmack', 'zum bestreuen', 'zum servieren',
  'zum anbraten', 'zum garnieren', 'zum verfeinern', 'nach bedarf',
  'etwas', 'ca.', 'circa', 'evtl.', 'eventuell', 'optional',
  'gute qualität', 'extra nativ', 'nativ extra',
  'fein', 'grob', 'mittelgroß', 'mittelgroße', 'klein', 'kleine', 'groß', 'große',
];

/**
 * Wandelt Brüche in Dezimalzahlen um
 */
function parseFraction(str) {
  if (!str) return null;
  const trimmed = str.trim();
  if (trimmed === '½' || trimmed === '1/2') return 0.5;
  if (trimmed === '¼' || trimmed === '1/4') return 0.25;
  if (trimmed === '¾' || trimmed === '3/4') return 0.75;
  if (trimmed === '⅓' || trimmed === '1/3') return 0.33;
  if (trimmed === '⅔' || trimmed === '2/3') return 0.67;
  if (trimmed === '⅛' || trimmed === '1/8') return 0.125;

  const match = trimmed.match(/^(\d+)\/(\d+)$/);
  if (match) {
    return parseFloat(match[1]) / parseFloat(match[2]);
  }

  const num = parseFloat(trimmed.replace(',', '.'));
  return isNaN(num) ? null : num;
}

/**
 * Analysiert eine einzelne Zutat und extrahiert Menge, Einheit und einen sauberen Suchbegriff
 */
export function parseIngredient(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return { original: '', name: '', query: '', amount: '', unit: '' };
  }

  const original = rawText.trim();
  let working = original;

  // Spezifisch für Chefkoch: "(n)", "(en)", "(s)" auflösen, z.B. "Zwiebel(n)" -> "Zwiebeln"
  working = working.replace(/\(([nes]+)\)/gi, '$1');

  // Text in Klammern entfernen (z. B. "(oder TK)", "(800 g)", "(z. B. Gouda)")
  working = working.replace(/\([^)]*\)/g, ' ');
  working = working.replace(/\[[^\]]*\]/g, ' ');

  // 2. Mengenangabe am Anfang extrahieren (Dezimalzahlen VOR Brüchen/Ganzzahlen!)
  let amount = '';
  let unit = '';

  const amountRegex = /^(\d+[.,]\d+|[\d¼½¾⅓⅔⅛]+(?:\s*[\/,-]\s*[\d¼½¾⅓⅔⅛]+)?)\s*/i;
  const amountMatch = working.match(amountRegex);
  if (amountMatch) {
    amount = amountMatch[1].trim();
    working = working.slice(amountMatch[0].length).trim();
  }

  // 3. Einheit extrahieren
  const words = working.split(/\s+/);
  if (words.length > 0) {
    const firstWordLower = words[0].toLowerCase().replace(/[.,;]$/, '');
    if (UNIT_PATTERNS.includes(firstWordLower)) {
      unit = words[0];
      words.shift();
      working = words.join(' ');
    }
  }

  // 4. Zubereitungshinweise und Füllwörter bereinigen
  let cleanQuery = working;
  for (const prep of PREPARATION_WORDS) {
    const regex = new RegExp(`\\b${prep}\\b`, 'gi');
    cleanQuery = cleanQuery.replace(regex, ' ');
  }

  // Satzzeichen und überflüssige Leerzeichen säubern
  cleanQuery = cleanQuery
    .replace(/[,;.:\-_/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 5. Spezielle Begriffsharmonisierungen für Supermarkt-Suchen
  const lowerQuery = cleanQuery.toLowerCase();
  let finalQuery = cleanQuery;

  if (lowerQuery.includes('knoblauch')) {
    finalQuery = 'Knoblauch';
  } else if (lowerQuery.includes('zwiebel') && !lowerQuery.includes('frühlings') && !lowerQuery.includes('lauch')) {
    finalQuery = 'Zwiebeln';
  } else if (lowerQuery === 'eier' || lowerQuery === 'ei') {
    finalQuery = 'Eier';
  } else if (lowerQuery.includes('butter') && !lowerQuery.includes('erdnuss')) {
    finalQuery = 'Butter';
  } else if (lowerQuery.includes('olivenöl')) {
    finalQuery = 'Olivenöl';
  } else if (lowerQuery.includes('weizenmehl') || lowerQuery === 'mehl') {
    finalQuery = 'Mehl';
  } else if (lowerQuery.includes('haferflocken')) {
    finalQuery = 'Haferflocken';
  } else if (lowerQuery.includes('hähnchenbrust')) {
    finalQuery = 'Hähnchenbrust';
  } else if (lowerQuery.includes('hackfleisch')) {
    finalQuery = 'Hackfleisch';
  } else if (lowerQuery.includes('tomatenmark')) {
    finalQuery = 'Tomatenmark';
  } else if (lowerQuery.includes('lasagne')) {
    finalQuery = 'Lasagneplatten';
  } else if (lowerQuery.includes('muskat')) {
    finalQuery = 'Muskatnuss';
  } else if (lowerQuery.includes('zitronensaft')) {
    finalQuery = 'Zitronensaft';
  } else if (lowerQuery.includes('petersilie')) {
    finalQuery = 'Petersilie';
  } else if (lowerQuery.includes('rotwein')) {
    finalQuery = 'Rotwein';
  } else if (lowerQuery.includes('käse') || lowerQuery.includes('gouda') || lowerQuery.includes('mozzarella')) {
    finalQuery = 'Käse gerieben';
  } else if (lowerQuery.includes('tomaten')) {
    finalQuery = 'Tomaten';
  } else if (lowerQuery.includes('milch') && !lowerQuery.includes('reis')) {
    finalQuery = 'Milch';
  }

  // Fallback: Falls die Bereinigung leer war, das Originalwort verwenden
  if (!finalQuery && working.trim()) {
    finalQuery = working.trim();
  }

  return {
    original,
    name: finalQuery,
    query: finalQuery,
    amount,
    unit,
  };
}

/**
 * Extrahiert Schema.org JSON-LD Recipe-Objekte aus HTML-Inhalt
 */
export function extractRecipeFromHtml(html) {
  if (!html || typeof html !== 'string') return null;

  const jsonLdRegex = /<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  let foundRecipe = null;

  while ((match = jsonLdRegex.exec(html)) !== null) {
    try {
      const rawJson = match[1].trim();
      const parsed = JSON.parse(rawJson);

      const findRecipeInObj = (obj) => {
        if (!obj || typeof obj !== 'object') return null;

        // Prüfe ob @type Recipe ist
        const type = obj['@type'];
        const isRecipe = (typeof type === 'string' && type.toLowerCase() === 'recipe') ||
          (Array.isArray(type) && type.some(t => String(t).toLowerCase() === 'recipe'));

        if (isRecipe && (Array.isArray(obj.recipeIngredient) || Array.isArray(obj.ingredients))) {
          return obj;
        }

        // Falls verschachtelt in @graph
        if (Array.isArray(obj['@graph'])) {
          for (const item of obj['@graph']) {
            const res = findRecipeInObj(item);
            if (res) return res;
          }
        }

        // Falls Array
        if (Array.isArray(obj)) {
          for (const item of obj) {
            const res = findRecipeInObj(item);
            if (res) return res;
          }
        }

        return null;
      };

      const recipe = findRecipeInObj(parsed);
      if (recipe) {
        foundRecipe = recipe;
        break;
      }
    } catch {
      // Ignoriere unvollständiges oder ungültiges JSON-LD
    }
  }

  if (!foundRecipe) return null;

  const rawIngredients = foundRecipe.recipeIngredient || foundRecipe.ingredients || [];
  const parsedIngredients = rawIngredients
    .map(ing => parseIngredient(ing))
    .filter(p => p.query && p.query.length > 1);

  let imageUrl = null;
  if (typeof foundRecipe.image === 'string') {
    imageUrl = foundRecipe.image;
  } else if (Array.isArray(foundRecipe.image) && foundRecipe.image.length > 0) {
    imageUrl = typeof foundRecipe.image[0] === 'string' ? foundRecipe.image[0] : foundRecipe.image[0]?.url;
  } else if (foundRecipe.image && typeof foundRecipe.image.url === 'string') {
    imageUrl = foundRecipe.image.url;
  }

  return {
    title: foundRecipe.name || 'Rezept',
    description: foundRecipe.description || '',
    servings: foundRecipe.recipeYield || '',
    imageUrl,
    ingredients: parsedIngredients,
    rawIngredients,
  };
}

/**
 * Liest Rezept-Zutaten entweder aus einer URL oder aus eingegebenem Freitext
 */
export async function parseRecipeInput({ url, text, fetchFn = fetch }) {
  if (url && typeof url === 'string' && url.trim().startsWith('http')) {
    const cleanUrl = url.trim();
    const response = await fetchFn(cleanUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    if (!response.ok) {
      throw new Error(`Konnte Rezept von URL nicht laden: HTTP ${response.status}`);
    }

    const html = await response.text();
    const recipe = extractRecipeFromHtml(html);

    if (recipe && recipe.ingredients.length > 0) {
      return recipe;
    }

    // Fallback: Falls kein Schema.org JSON-LD gefunden wurde
    throw new Error('Keine strukturierten Rezept-Zutaten auf dieser Seite gefunden. Bitte nutze die Text-Eingabe.');
  }

  if (text && typeof text === 'string' && text.trim()) {
    const lines = text
      .split(/[\n\r]+/)
      .map(l => l.trim())
      .filter(Boolean);

    const parsedIngredients = lines
      .map(line => parseIngredient(line))
      .filter(p => p.query && p.query.length > 1);

    return {
      title: 'Eigene Zutatenliste',
      description: '',
      servings: '',
      imageUrl: null,
      ingredients: parsedIngredients,
      rawIngredients: lines,
    };
  }

  throw new Error('Weder gültige URL noch Zutaten-Text angegeben');
}
