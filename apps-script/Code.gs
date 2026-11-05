/**
 * Job Fit Overlay - "Log to tracker" web app.
 *
 * Paste this file into the tracker sheet (Extensions > Apps Script), set the
 * script property JFO_TOKEN, and deploy as a web app (see README).
 *
 * The extension POSTs { token, record, force } where record comes from
 * JobFitScorer.buildTrackerRecord(). This script:
 *   1. takes a document lock so two writers never pick the same row,
 *   2. refuses duplicates (same posting URL, or same title + company),
 *   3. finds the next free row from the data itself and re-checks it is empty,
 *   4. writes only the columns named in the record (matched by header text),
 *   5. copies the JD into the JD Archive, reads it back, then sets JD Saved = Yes.
 */

var TRACKER_TAB = 'Job Applications';
var ARCHIVE_TAB = 'JD Archive';

/* ---------- pure helpers (also loaded by tests/test-tracker.js) ---------- */

function normalizeUrl(url) {
  var s = String(url || '').trim().toLowerCase();
  var li = s.match(/linkedin\.com\/jobs\/view\/(?:[^\/]*?-)?(\d{6,})/) || s.match(/currentjobid=(\d{6,})/);
  if (li) return 'linkedin:' + li[1];
  var jk = s.match(/indeed\.[a-z.]+\/.*[?&]v?jk=([0-9a-f]+)/);
  if (jk) return 'indeed:' + jk[1];
  return s.replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[?#]/)[0].replace(/\/+$/, '');
}

function normalizeText(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * rows: data rows (row 2 onward) as arrays; col: header -> 0-based index.
 * Returns { row, status, title, company, reason } for the first match, or null.
 */
function findDuplicate(rows, col, fields) {
  var url = normalizeUrl(fields['Posting URL']);
  var title = normalizeText(fields['Role Title']);
  var company = normalizeText(fields['Company Name']);
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var rUrl = col['Posting URL'] !== undefined ? normalizeUrl(r[col['Posting URL']]) : '';
    var rTitle = col['Role Title'] !== undefined ? normalizeText(r[col['Role Title']]) : '';
    var rCompany = col['Company Name'] !== undefined ? normalizeText(r[col['Company Name']]) : '';
    var reason = null;
    if (url && rUrl && url === rUrl) reason = 'same posting URL';
    else if (title && company && title === rTitle && company === rCompany) reason = 'same title and company';
    if (reason) {
      return {
        row: i + 2,
        status: col['Status'] !== undefined ? String(r[col['Status']] || '') : '',
        title: r[col['Role Title']] || '',
        company: r[col['Company Name']] || '',
        reason: reason
      };
    }
  }
  return null;
}

/** Last 1-based row index (from row 2) with anything in any of keyCols; 1 if none. */
function lastDataRow(rows, keyCols) {
  for (var i = rows.length - 1; i >= 0; i--) {
    for (var k = 0; k < keyCols.length; k++) {
      var v = rows[i][keyCols[k]];
      if (v !== '' && v !== null && v !== undefined) return i + 2;
    }
  }
  return 1;
}

function headerIndex(headerRow) {
  var col = {};
  for (var i = 0; i < headerRow.length; i++) {
    var h = String(headerRow[i] || '').trim();
    if (h && col[h] === undefined) col[h] = i;
  }
  return col;
}

/* ---------- Apps Script entry points ---------- */

function doPost(e) {
  var out;
  try {
    var body = JSON.parse(e.postData.contents);
    // Script property first; else the Token.gs that setup-tracker.sh generates
    // (it is pushed to the bound script only, never committed).
    var expected = PropertiesService.getScriptProperties().getProperty('JFO_TOKEN') ||
      (typeof JFO_TOKEN_FALLBACK !== 'undefined' ? JFO_TOKEN_FALLBACK : '');
    if (!expected || body.token !== expected) {
      out = { ok: false, error: 'Bad or missing token. Check the token in the extension popup matches script property JFO_TOKEN.' };
    } else {
      out = logRecord_(body.record, !!body.force);
    }
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: 'job-fit-overlay tracker logger' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function sheetByName_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('No tab named "' + name + '"');
  return sheet;
}

function logRecord_(record, force) {
  if (!record || !record.fields) return { ok: false, error: 'No record sent.' };
  var lock = LockService.getDocumentLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var tracker = sheetByName_(ss, TRACKER_TAB);
    var lastCol = tracker.getLastColumn();
    var col = headerIndex(tracker.getRange(1, 1, 1, lastCol).getValues()[0]);

    var missing = Object.keys(record.fields).filter(function (h) { return col[h] === undefined; });

    var lastRow = Math.max(tracker.getLastRow(), 2);
    var rows = tracker.getRange(2, 1, lastRow - 1, lastCol).getValues();

    if (!force) {
      var dup = findDuplicate(rows, col, record.fields);
      if (dup) return { ok: false, duplicate: dup };
    }

    // Next free row = one below the last row that has a URL or a title.
    var keyCols = [col['Posting URL'], col['Role Title']].filter(function (c) { return c !== undefined; });
    var target = lastDataRow(rows, keyCols) + 1;
    // Never overwrite: step down until the whole row is empty.
    for (var guard = 0; guard < 50; guard++) {
      var existing = tracker.getRange(target, 1, 1, lastCol).getValues()[0];
      if (existing.every(function (v) { return v === '' || v === null; })) break;
      target++;
    }

    var rowValues = tracker.getRange(target, 1, 1, lastCol).getValues()[0];
    Object.keys(record.fields).forEach(function (h) {
      if (col[h] !== undefined) rowValues[col[h]] = record.fields[h];
    });
    tracker.getRange(target, 1, 1, lastCol).setValues([rowValues]);

    // JD Archive: next row below the last non-empty cell in column A or C.
    var archive = sheetByName_(ss, ARCHIVE_TAB);
    var aLast = Math.max(archive.getLastRow(), 2);
    var aRows = archive.getRange(2, 1, aLast - 1, 7).getValues();
    var aTarget = lastDataRow(aRows, [0, 2]) + 1;
    for (var g2 = 0; g2 < 50; g2++) {
      var aExisting = archive.getRange(aTarget, 1, 1, 7).getValues()[0];
      if (aExisting.every(function (v) { return v === '' || v === null; })) break;
      aTarget++;
    }
    var a = record.archive || {};
    var archiveRow = [String(target), a.company || '', a.role || '', a.url || '', a.dateSaved || '', a.postedDate || '', a.jdText || ''];
    archive.getRange(aTarget, 1, 1, 7).setValues([archiveRow]);
    SpreadsheetApp.flush();

    var readBack = archive.getRange(aTarget, 7).getValue();
    var archived = String(readBack).length === String(a.jdText || '').length && String(readBack).length > 0;
    if (archived && col['JD Saved'] !== undefined) {
      tracker.getRange(target, col['JD Saved'] + 1).setValue('Yes');
    }

    return { ok: true, row: target, archiveRow: aTarget, jdSaved: archived, unknownColumns: missing };
  } finally {
    lock.releaseLock();
  }
}

/* Lets tests/test-tracker.js load the pure helpers under Node. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { normalizeUrl: normalizeUrl, normalizeText: normalizeText, findDuplicate: findDuplicate, lastDataRow: lastDataRow, headerIndex: headerIndex };
}
