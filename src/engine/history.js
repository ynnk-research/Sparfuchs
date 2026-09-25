/**
 * Einkaufszettel-Historie & Haushaltsplanungs-Engine
 * Verwaltet verbuchte Einkäufe, aggregiert Langzeit-Ersparnisse und berechnet Haushaltsstatistiken.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HISTORY_FILE = path.join(__dirname, '../../.cache/history.json');

/**
 * Lädt alle bisher verbuchten Einkäufe aus der JSON-Datei
 */
export function loadHistoryFromFile(filePath = HISTORY_FILE) {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (err) {
    console.warn('Historie konnte nicht gelesen werden:', err.message);
  }
  return [];
}

/**
 * Speichert die Liste der Einkaufszettel persistent auf der Festplatte
 */
export function saveHistoryToFile(history = [], filePath = HISTORY_FILE) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(history, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Historie konnte nicht geschrieben werden:', err.message);
    return false;
  }
}

/**
 * Berechnet spannende Statistiken für die Haushaltsplanung:
 * - Gesamt gespart über Zeit
 * - Gesamtausgaben
 * - Sparquote in %
 * - Durchschnittliche Ersparnis je Einkauf
 * - Top-Sparmärkte (Wo wurde am meisten gespart?)
 * - Monatsübersicht (Entwicklung über Zeit)
 */
export function calculateHouseholdStats(receipts = []) {
  if (!Array.isArray(receipts) || receipts.length === 0) {
    return {
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
  }

  let totalSpent = 0;
  let totalSavings = 0;
  let totalRegular = 0;
  let totalItemsPurchased = 0;
  const storeMap = new Map();
  const monthMap = new Map();

  for (const receipt of receipts) {
    const paid = typeof receipt.totalPaid === 'number' ? receipt.totalPaid : parseFloat(receipt.totalPaid) || 0;
    const savings = typeof receipt.totalSavings === 'number' ? receipt.totalSavings : parseFloat(receipt.totalSavings) || 0;
    const regular = typeof receipt.totalRegular === 'number' && receipt.totalRegular > 0 
      ? receipt.totalRegular 
      : (paid + savings);
    const count = receipt.itemCount || (receipt.items ? receipt.items.length : 0);

    totalSpent += paid;
    totalSavings += savings;
    totalRegular += regular;
    totalItemsPurchased += count;

    // Supermärkte erfassen
    const stores = Array.isArray(receipt.stores) && receipt.stores.length > 0
      ? receipt.stores
      : (receipt.items ? [...new Set(receipt.items.map(it => it.retailer).filter(Boolean))] : ['Gemischt']);

    for (const store of stores) {
      if (!storeMap.has(store)) {
        storeMap.set(store, { store, tripsCount: 0, spent: 0, savings: 0 });
      }
      const entry = storeMap.get(store);
      entry.tripsCount += 1;
    }

    // Wenn Artikel im Beleg vorhanden sind, genaue Supermarkt-Anteile erfassen
    if (Array.isArray(receipt.items) && receipt.items.length > 0) {
      for (const item of receipt.items) {
        const storeName = item.retailer || 'Einkaufsnotizen';
        if (!storeMap.has(storeName)) {
          storeMap.set(storeName, { store: storeName, tripsCount: 1, spent: 0, savings: 0 });
        }
        const entry = storeMap.get(storeName);
        const itemPrice = typeof item.price === 'number' ? item.price : parseFloat(item.price) || 0;
        const itemOld = typeof item.oldPrice === 'number' && item.oldPrice > itemPrice
          ? item.oldPrice
          : (itemPrice > 0 ? itemPrice * 1.25 : 0);
        entry.spent += itemPrice;
        entry.savings += Math.max(0, itemOld - itemPrice);
      }
    } else {
      // Gleichmäßig auf beteiligte Stores aufteilen falls keine Einzelartikel hinterlegt
      const shareSpent = paid / Math.max(1, stores.length);
      const shareSavings = savings / Math.max(1, stores.length);
      for (const store of stores) {
        const entry = storeMap.get(store);
        entry.spent += shareSpent;
        entry.savings += shareSavings;
      }
    }

    // Monatliche Verteilung für Haushaltsplanung
    const dateStr = receipt.date || new Date().toISOString();
    const monthKey = dateStr.slice(0, 7); // z.B. "2026-09"
    if (!monthMap.has(monthKey)) {
      monthMap.set(monthKey, { month: monthKey, spent: 0, savings: 0, tripsCount: 0 });
    }
    const mEntry = monthMap.get(monthKey);
    mEntry.spent += paid;
    mEntry.savings += savings;
    mEntry.tripsCount += 1;
  }

  const overallSavingsPercent = totalRegular > 0 ? Math.round((totalSavings / totalRegular) * 100) : 0;
  const averageSpentPerTrip = receipts.length > 0 ? parseFloat((totalSpent / receipts.length).toFixed(2)) : 0;
  const averageSavingsPerTrip = receipts.length > 0 ? parseFloat((totalSavings / receipts.length).toFixed(2)) : 0;

  const storesBreakdown = Array.from(storeMap.values()).map(s => {
    const sRegular = s.spent + s.savings;
    const sPct = sRegular > 0 ? Math.round((s.savings / sRegular) * 100) : 0;
    return {
      store: s.store,
      tripsCount: s.tripsCount,
      spent: parseFloat(s.spent.toFixed(2)),
      savings: parseFloat(s.savings.toFixed(2)),
      savingsPercent: sPct,
    };
  }).sort((a, b) => b.savings - a.savings);

  // Monatsnamen auf Deutsch formatieren
  const monthNames = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const monthlyBreakdown = Array.from(monthMap.values()).map(m => {
    const [y, mon] = m.month.split('-');
    const mIdx = parseInt(mon, 10) - 1;
    const label = `${monthNames[mIdx] || mon} ${y}`;
    const mRegular = m.spent + m.savings;
    const mPct = mRegular > 0 ? Math.round((m.savings / mRegular) * 100) : 0;
    return {
      month: m.month,
      label,
      spent: parseFloat(m.spent.toFixed(2)),
      savings: parseFloat(m.savings.toFixed(2)),
      savingsPercent: mPct,
      tripsCount: m.tripsCount,
    };
  }).sort((a, b) => b.month.localeCompare(a.month));

  return {
    totalSpent: parseFloat(totalSpent.toFixed(2)),
    totalSavings: parseFloat(totalSavings.toFixed(2)),
    totalRegular: parseFloat(totalRegular.toFixed(2)),
    overallSavingsPercent,
    receiptCount: receipts.length,
    totalItemsPurchased,
    averageSpentPerTrip,
    averageSavingsPerTrip,
    storesBreakdown,
    monthlyBreakdown,
  };
}
