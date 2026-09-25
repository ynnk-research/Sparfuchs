/**
 * Persistenter Datei- und Memory-Cache
 * Speichert API-Anfragen im RAM und auf der Festplatte (.cache/),
 * um API-Rate-Limits zu schonen und Server-Neustarts zu überstehen.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_DIR = path.join(__dirname, '../../.cache');

// Standard TTL: 2 Stunden (Supermarkt-Angebote wechseln nur 1-2 mal pro Woche)
export const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000;

export class PersistentCache {
  constructor(ttlMs = DEFAULT_TTL_MS, cacheDir = CACHE_DIR) {
    this.ttlMs = ttlMs;
    this.cacheDir = cacheDir;
    this.memoryCache = new Map();

    // Verzeichnis bei Bedarf erstellen
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
    } catch (e) {
      console.warn('Cache-Verzeichnis konnte nicht erstellt werden:', e.message);
    }
  }

  _getHash(key) {
    return crypto.createHash('md5').update(String(key)).digest('hex');
  }

  _getFilePath(key) {
    return path.join(this.cacheDir, `${this._getHash(key)}.json`);
  }

  get(key) {
    // 1. Zuerst im schnellen RAM prüfen
    const inMem = this.memoryCache.get(key);
    if (inMem) {
      if (Date.now() < inMem.expiresAt) {
        return inMem.value;
      }
      this.memoryCache.delete(key);
    }

    // 2. Falls nicht im RAM, auf der Festplatte prüfen
    try {
      const filePath = this._getFilePath(key);
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const entry = JSON.parse(raw);
        if (Date.now() < entry.expiresAt) {
          // Zurück in den RAM laden für Folgezugriffe
          this.memoryCache.set(key, entry);
          return entry.value;
        }
        // Abgelaufen -> löschen
        fs.unlinkSync(filePath);
      }
    } catch (e) {
      // Fehler beim Lesen ignorieren
    }

    return null;
  }

  set(key, value, ttlMs = this.ttlMs) {
    const expiresAt = Date.now() + ttlMs;
    const entry = { key, value, expiresAt, savedAt: new Date().toISOString() };

    // In RAM speichern
    this.memoryCache.set(key, entry);

    // Auf Festplatte sichern
    try {
      const filePath = this._getFilePath(key);
      fs.writeFileSync(filePath, JSON.stringify(entry), 'utf-8');
    } catch (e) {
      // Fehler beim Schreiben nicht werfen
    }
  }

  clear() {
    this.memoryCache.clear();
    try {
      if (fs.existsSync(this.cacheDir)) {
        const files = fs.readdirSync(this.cacheDir);
        for (const file of files) {
          if (file.endsWith('.json')) {
            fs.unlinkSync(path.join(this.cacheDir, file));
          }
        }
      }
    } catch (e) {
      console.warn('Cache-Bereinigung fehlgeschlagen:', e.message);
    }
  }

  get size() {
    return this.memoryCache.size;
  }
}

// Global geteilte Cache-Instanz
export const globalPersistentCache = new PersistentCache();
