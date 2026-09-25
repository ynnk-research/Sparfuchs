import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PersistentCache } from '../src/api/cache.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_CACHE_DIR = path.join(__dirname, '../.test_cache');

test('T10.1: PersistentCache speichert Daten im RAM und auf der Festplatte', async () => {
  const cache = new PersistentCache(1000, TEST_CACHE_DIR);
  cache.set('key1', { message: 'Hallo Supermarkt-Sparer' });

  // 1. Aus Memory abrufen
  const val1 = cache.get('key1');
  assert.deepEqual(val1, { message: 'Hallo Supermarkt-Sparer' });

  // 2. Neue Instanz mit demselben Verzeichnis erstellen (simuliert Server-Neustart)
  const freshCache = new PersistentCache(1000, TEST_CACHE_DIR);
  const valDisk = freshCache.get('key1');
  assert.deepEqual(valDisk, { message: 'Hallo Supermarkt-Sparer' }, 'Sollte von der Festplatte geladen werden');

  // Aufräumen
  cache.clear();
  try {
    if (fs.existsSync(TEST_CACHE_DIR)) {
      fs.rmdirSync(TEST_CACHE_DIR);
    }
  } catch (e) {}
});

test('T10.2: PersistentCache respektiert abgelaufene TTL', async () => {
  const shortCache = new PersistentCache(50, TEST_CACHE_DIR); // 50ms TTL
  shortCache.set('tempKey', 'Flüchtige Daten');

  assert.equal(shortCache.get('tempKey'), 'Flüchtige Daten');

  // Warten bis TTL abläuft
  await new Promise(r => setTimeout(r, 70));

  assert.equal(shortCache.get('tempKey'), null, 'Abgelaufener Eintrag muss null liefern');

  shortCache.clear();
  try {
    if (fs.existsSync(TEST_CACHE_DIR)) {
      fs.rmdirSync(TEST_CACHE_DIR);
    }
  } catch (e) {}
});
