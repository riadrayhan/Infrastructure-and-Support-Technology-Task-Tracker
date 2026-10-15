/**
 * Task and Project Tracker – LOADER
 * =================================
 * Paste THIS SHORT FILE into Apps Script, not the big one.
 *
 * It downloads the real code from the repository and runs it, which means two things:
 *   · there is almost nothing to paste, so the wrong file cannot end up here by mistake;
 *   · improvements arrive on their own. When the code in the repository changes, this picks it
 *     up within an hour, or straight away if you run refreshTrackerCode.
 *
 * Setup, once:
 *   1. Extensions → Apps Script, select everything in Code.gs, paste this over it, save.
 *   2. Run  setupTracker  and allow the permissions it asks for.
 *   3. Run  addSampleData  if you would like some example rows.
 *   4. Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 *      (If you already have a deployment: Deploy → Manage deployments → ✏ → New version.)
 */

var TRACKER_SOURCE = 'https://raw.githubusercontent.com/sajalkumar-byte/Infrastructure-and-Support-Technology-Task-Tracker/main/google-apps-script/Code.gs';
var TRACKER_CACHE_MINUTES = 60;

var _tracker = null;

/** Fetch the tracker code (cached), run it, and hand back the functions it exposes. */
function tracker_() {
  if (_tracker) return _tracker;

  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) { cache = null; }

  var source = cache ? cache.get('tracker_src') : null;
  if (!source) {
    var res = UrlFetchApp.fetch(TRACKER_SOURCE, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      throw new Error('Could not download the tracker code: HTTP ' + res.getResponseCode());
    }
    source = res.getContentText();
    if (source.indexOf('var SHEETS') === -1) {
      throw new Error('The downloaded file does not look like the tracker code');
    }
    if (cache) { try { cache.put('tracker_src', source, TRACKER_CACHE_MINUTES * 60); } catch (e) {} }
  }

  _tracker = eval('(function(){' + source + '\nreturn {' +
    'doGet: doGet, doPost: doPost, setupTracker: setupTracker, addSampleData: addSampleData,' +
    'addSampleUsers: addSampleUsers, checkDeployment: checkDeployment, cleanUpSessions: cleanUpSessions' +
    '};})()');
  return _tracker;
}

/* ---- what the web app and the editor call ---- */
function doGet(e) { return tracker_().doGet(e); }
function doPost(e) { return tracker_().doPost(e); }

function setupTracker() { return tracker_().setupTracker(); }
function addSampleData() { return tracker_().addSampleData(); }
function addSampleUsers() { return tracker_().addSampleUsers(); }
function checkDeployment() { return tracker_().checkDeployment(); }
function cleanUpSessions() { return tracker_().cleanUpSessions(); }

/** Run this to pick up a code change straight away instead of waiting for the cache to expire. */
function refreshTrackerCode() {
  try { CacheService.getScriptCache().remove('tracker_src'); } catch (e) {}
  _tracker = null;
  var fresh = tracker_();
  Logger.log('Latest tracker code loaded. Health: %s', JSON.stringify(fresh.doGet({ parameter: {} }).getContent()));
  return 'Latest tracker code loaded.';
}
