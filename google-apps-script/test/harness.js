'use strict';
/* harness.js – runs Code.gs inside Node by standing in for the Google Apps Script services.
   It lets the Google Sheets backend be tested properly before it is deployed: the spreadsheet is
   an array in memory, but the code under test is the real file, unmodified. */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const CODE = path.resolve(__dirname, '..', 'Code.gs');

/* ---------- a spreadsheet made of arrays ---------- */
class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    Object.assign(this, { sheet, row, col, numRows, numCols });
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const line = this.sheet.rows[this.row - 1 + r] || [];
      const cells = [];
      for (let c = 0; c < this.numCols; c++) cells.push(line[this.col - 1 + c] ?? '');
      out.push(cells);
    }
    return out;
  }
  setValues(values) {
    values.forEach((line, r) => {
      const target = this.row - 1 + r;
      while (this.sheet.rows.length <= target) this.sheet.rows.push([]);
      line.forEach((v, c) => { this.sheet.rows[target][this.col - 1 + c] = v; });
    });
    return this;
  }
  clearContent() {
    for (let r = 0; r < this.numRows; r++) {
      const line = this.sheet.rows[this.row - 1 + r];
      if (!line) continue;
      for (let c = 0; c < this.numCols; c++) line[this.col - 1 + c] = '';
    }
    return this;
  }
  setFontWeight() { return this; }
}

class FakeSheet {
  constructor(name) { this.name = name; this.rows = []; }
  getLastRow() {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      if ((this.rows[i] || []).some(v => String(v ?? '').length)) return i + 1;
    }
    return 0;
  }
  getRange(row, col, numRows, numCols) { return new FakeRange(this, row, col, numRows, numCols); }
  appendRow(values) { this.rows[this.getLastRow()] = values.slice(); }
  deleteRow(index) { this.rows.splice(index - 1, 1); }
  setFrozenRows() { return this; }
  getName() { return this.name; }
}

class FakeSpreadsheet {
  constructor() { this.sheets = new Map(); }
  getSheetByName(name) { return this.sheets.get(name) || null; }
  insertSheet(name) { const s = new FakeSheet(name); this.sheets.set(name, s); return s; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/fake'; }
}

/* ---------- load Code.gs with the Apps Script services replaced ---------- */
function load({ logs = [], outbox = [] } = {}) {
  const spreadsheet = new FakeSpreadsheet();
  const properties = new Map();
  let uuidCounter = 0;

  const sandbox = {
    console,
    Math,
    Date,
    JSON,
    parseInt,
    isNaN,
    Number,
    String,
    Object,
    Array,
    Error,

    SpreadsheetApp: {
      getActive: () => spreadsheet,
      openById: () => spreadsheet,
    },

    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (properties.has(k) ? properties.get(k) : null),
        setProperty: (k, v) => { properties.set(k, String(v)); },
        deleteProperty: k => { properties.delete(k); },
      }),
    },

    LockService: {
      getScriptLock: () => ({ waitLock() {}, releaseLock() {} }),
    },

    Logger: { log: (...args) => logs.push(args.join(' ')) },

    /* Gmail stands in as an outbox the tests can read. */
    MailApp: {
      sendEmail(options) {
        if (typeof options === 'string') options = { to: options };
        outbox.push(options);
      },
      getRemainingDailyQuota: () => 100 - outbox.length,
    },

    Session: { getScriptTimeZone: () => 'UTC' },

    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: text => ({
        _text: text,
        setMimeType() { return this; },
        getContent() { return this._text; },
      }),
    },

    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest(_algorithm, value) {
        const input = typeof value === 'string'
          ? Buffer.from(value, 'utf8')
          : Buffer.from(value.map(b => (b + 256) % 256));
        const digest = crypto.createHash('sha256').update(input).digest();
        /* Apps Script hands back signed bytes; mirror that so the code is exercised honestly. */
        return Array.from(digest).map(b => (b > 127 ? b - 256 : b));
      },
      base64EncodeWebSafe(bytes) {
        const buf = Buffer.from(bytes.map(b => (b + 256) % 256));
        return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      },
      getUuid() {
        uuidCounter += 1;
        return crypto.randomUUID() + '-' + uuidCounter;
      },
      formatDate(date, _tz, _format) { return date.toISOString().slice(0, 10); },
    },
  };
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(CODE, 'utf8'), sandbox, { filename: 'Code.gs' });

  /** Call an action the way the deployed Web App would, and unwrap the JSON. */
  const call = (action, body = {}) => {
    const output = sandbox.doPost({ postData: { contents: JSON.stringify({ action, ...body }) } });
    return JSON.parse(output.getContent());
  };

  return { sandbox, call, spreadsheet, properties, logs, outbox };
}

module.exports = { load };
