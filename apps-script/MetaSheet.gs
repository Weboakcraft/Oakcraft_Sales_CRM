/**
 * Meta Leads  ->  clean "Meta_Leads" sheet tab (mirror).
 * ----------------------------------------------------------------------------
 * Ye file ADDITIVE hai. Code.gs ko bilkul nahi chhua gaya.
 * Ye CRM ke 'metaLeads' collection ko (existing _readAll se) padh kar ek saaf
 * "Meta_Leads" tab banata/refresh karta hai jisme wahi 7 columns hote hain jo
 * CRM dikhata hai. Ye SIRF isi ek naye tab ko likhta hai — kisi existing
 * collection tab ya data ko kabhi touch nahi karta. Poori tarah safe.
 */
var META_MIRROR_TAB  = 'Meta_Leads';
var META_MIRROR_COLS = ['created_time_ist','platform','full_name','phone_number','city_state','lead_status','assigned_to'];

function mirrorMetaLeadsToSheet_() {
  try {
    var recs = (typeof _readAll === 'function') ? (_readAll('metaLeads') || []) : [];
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(META_MIRROR_TAB);
    if (!sh) sh = ss.insertSheet(META_MIRROR_TAB);
    sh.clearContents();
    sh.getRange(1, 1, 1, META_MIRROR_COLS.length).setValues([META_MIRROR_COLS]).setFontWeight('bold');
    var rows = recs.map(function (d) {
      d = (d && d.data !== undefined) ? d.data : d;
      return META_MIRROR_COLS.map(function (c) { return (d && d[c] != null) ? String(d[c]) : ''; });
    });
    if (rows.length) sh.getRange(2, 1, rows.length, META_MIRROR_COLS.length).setValues(rows);
    sh.setFrozenRows(1);
    try { sh.autoResizeColumns(1, META_MIRROR_COLS.length); } catch (e) {}
    Logger.log('Meta_Leads tab refreshed: ' + rows.length + ' leads');
    return rows.length;
  } catch (err) {
    Logger.log('mirrorMetaLeadsToSheet_ error: ' + err);
    return -1;
  }
}

// Isse EK BAAR run kijiye -> Meta_Leads tab har 15 min me auto-refresh hoga.
function installMetaMirrorTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'mirrorMetaLeadsToSheet_') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('mirrorMetaLeadsToSheet_').timeBased().everyMinutes(15).create();
  return 'Meta_Leads auto-refresh trigger installed (every 15 min).';
}

// Undo: trigger hatana ho to ye run kijiye.
function removeMetaMirrorTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'mirrorMetaLeadsToSheet_') { ScriptApp.deleteTrigger(t); n++; }
  });
  return 'Removed ' + n + ' trigger(s).';
}

// Ise Run dropdown se chalaiye -> Meta_Leads tab abhi bana/refresh kar do.
function runMetaMirrorNow() {
  var n = mirrorMetaLeadsToSheet_();
  Logger.log('runMetaMirrorNow -> ' + n + ' leads');
  return n;
}
