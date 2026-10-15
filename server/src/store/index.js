'use strict';
/* store/index.js – chooses where the data lives and hands the rest of the server one object.

   STORAGE=sqlite  (default)  a single file, nothing to set up
   STORAGE=sheets             a Google Spreadsheet, through a service account

   Every repository talks to this and nothing else, so the two drivers cannot drift apart. */

const config = require('../config');
const { SqliteStore } = require('./sqlite');
const { SheetsStore } = require('./sheets');

let store = null;

function build() {
  if (config.storage === 'sheets') {
    return new SheetsStore({
      spreadsheetId: config.sheets.spreadsheetId,
      credentials: SheetsStore.readCredentials(config.sheets.credentials),
      apiBase: config.sheets.apiBase,
      tokenUrl: config.sheets.tokenUrl,
      cacheMs: config.sheets.cacheMs,
    });
  }
  return new SqliteStore(config.dbFile);
}

/** Open the storage once and create any missing tables or tabs. */
async function init(log = () => {}) {
  if (store) return store;
  store = build();
  await store.init();
  log(`storage: ${store.describe()}`);
  return store;
}

function get() {
  if (!store) throw new Error('Storage is not open yet – call store.init() first');
  return store;
}

async function close() {
  if (store) { await store.close(); store = null; }
}

/** Replace the driver – used by the tests to run the same suite against both. */
function use(replacement) { store = replacement; return store; }

const nowIso = () => new Date().toISOString();

module.exports = { init, get, close, use, build, nowIso, SqliteStore, SheetsStore };
