/**
 * IndiaMART — sirf 31/08/2026 22:38:08 ke BAAD ka data (pehra + safai)
 * ----------------------------------------------------------------------------
 * DIKKAT (25-09-2026 ki jaanch)
 *   `indiamartLeads` tab me 2,648 rows thi. Sahi sirf 301 (jo aapne GREEN ki
 *   hain -- rows 3 se 303, sab 01-09-2026 ke baad, enquiry no ke saath).
 *   Neeche ki 2,347 rows purani thi:
 *     - 2,073 rows 31/08/2026 22:38:08 se PEHLE ki (April - August)
 *     -   274 rows green rows ki hi duplicate copy (wahi mobile + wahi time,
 *         bina enquiry no, alag id)
 *   `audit` tab: 25-09-2026 10:21 se har 1-2 minute "saveMany 2347 records"
 *   (login: mis@oakcraft.in). Yaani koi browser apni PURANI cached copy
 *   baar-baar sheet par wapas likh raha tha. Apps Script ka IMS_START_AFTER
 *   sirf IMPORT rokta tha; web app (doPost) ke raaste aane wali rows ko koi
 *   nahi rokta tha.
 *
 * YE FILE KYA KARTI HAI
 *   1. PEHRA (apne aap, load hote hi):
 *      Code.gs ke `_upsertMany` / `_upsert` ko lapet deta hai -- sirf
 *      `indiamartLeads` par. Aisi row sheet me LIKHI HI NAHI jaati:
 *        a) jiska query_time cut-off se pehle ya barabar hai
 *        b) jo sheet me NAYI hai (id nahi mili) aur jiska mobile + query_time
 *           kisi maujooda row se milta hai (purani duplicate copy)
 *      Baaki collections par koi asar nahi.
 *   2. SAFAI (haath se, ek baar):
 *        previewIndiaMartCleanup()  -- kuch nahi badalta, sirf Logs me ginti
 *        cleanIndiaMartLeads()      -- backup tab banata hai, phir hataata hai
 *      Sirf wo rows hatti hain jo GREEN NAHI hain aur (cut-off se pehle ki
 *      hain YA kisi rakhi gayi row ki duplicate hain). GREEN row kabhi nahi
 *      hatti -- chahe kuch bhi ho.
 *
 * KAISE LAGAYEIN
 *   1. Ye poori file CRM ke Apps Script project me nayi file ki tarah paste
 *      kijiye (Code.gs aur IndiaMartAutoSync.gs ke saath). Save.
 *   2. `checkIndiaMartGuard` chalaiye -- "HAAN" aana chahiye.
 *   3. ZAROORI: Deploy > Manage deployments > pencil > Version: New version >
 *      Deploy. (Pehra web app ke doPost me tabhi lagta hai.)
 *   4. `previewIndiaMartCleanup` -> Logs dekhiye -> theek lage to
 *      `cleanIndiaMartLeads`.
 *   Kram zaroori hai: pehle Deploy (3), phir safai (4) -- warna purana
 *   browser safai ke baad rows dobara likh dega.
 *
 * WAPAS HATANA HO
 *   `var IMG_ON = false;` kar dijiye aur dobara Deploy.
 */

var IMG_ON   = true;
var IMG_COLL = 'indiamartLeads';
/* Cut-off -- IndiaMartAutoSync.gs ka IMS_START_AFTER hi (dono ek jaisa). */
var IMG_START_AFTER = (typeof IMS_START_AFTER !== 'undefined' && IMS_START_AFTER) ? IMS_START_AFTER : '31/08/2026 22:38:08';
/* Aapka "sahi" rang (Google Sheets: light green 3). */
var IMG_KEEP_COLORS = ['#b6d7a8'];

/* ------------------------------------------------------------------ *
 * helpers                                                             *
 * ------------------------------------------------------------------ */
function img_s_(v){ return v == null ? '' : String(v); }
function img_p2_(n){ return (n < 10 ? '0' : '') + n; }
/** koi bhi timestamp -> 'YYYYMMDDHHMMSS' (tulna ke liye); na bane to ''. */
function img_key_(v){
  if(v instanceof Date && !isNaN(v.getTime())){
    return Utilities.formatDate(v, Session.getScriptTimeZone() || 'Asia/Kolkata', 'yyyyMMddHHmmss');
  }
  var s = img_s_(v).trim(); if(!s) return '';
  var m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if(m) return m[3] + img_p2_(+m[2]) + img_p2_(+m[1]) + img_p2_(+(m[4] || 0)) + (m[5] || '00') + (m[6] || '00');
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if(m) return m[1] + m[2] + m[3] + img_p2_(+(m[4] || 0)) + (m[5] || '00') + (m[6] || '00');
  return '';
}
var IMG_CUT = img_key_(IMG_START_AFTER);
function img_tooOld_(d){
  var k = img_key_(d && d.query_time);
  return !!(k && IMG_CUT && k <= IMG_CUT);
}
function img_mob_(v){ var d = img_s_(v).replace(/\D/g, ''); return d.length > 10 ? d.slice(-10) : d; }
function img_dupKey_(d){
  var p = img_mob_(d && (d.sender_mobile || d.mobile || d.phone));
  var t = img_key_(d && d.query_time);
  return (p && t) ? (p + '|' + t) : '';
}
function img_data_(r){ return (r && r.data !== undefined && typeof r.data === 'object') ? r.data : r; }

/* ------------------------------------------------------------------ *
 * 1. PEHRA                                                            *
 * ------------------------------------------------------------------ */
(function(){ try{ ocImGuardPatch_(); }catch(e){} })();

function ocImGuardPatch_(){
  var done = [];
  /* NOTE: _readAll ko jaan-boojh kar NAHI lapeta. Code.gs ka _upsertMany
     _readAll se poora tab padh kar _writeMerged se DOBARA likhta hai -- agar
     _readAll purani rows chhupata to har save par wo chupchaap sheet se mit
     jaatin. Dikhne se rokne ka kaam app (ocImTooOld) karta hai; sheet ki
     safai sirf cleanIndiaMartLeads() karta hai, backup ke saath. */
  if(typeof _upsertMany === 'function' && !_upsertMany.__ocImg){
    var origMany = _upsertMany;
    var wm = function(coll, recs){
      try{
        if(IMG_ON && coll === IMG_COLL && recs && recs.length){
          var f = img_filter_(recs);
          if(f.dropped) Logger.log('IndiaMartGuard: ' + f.dropped + ' row roki (' + f.old + ' purani, ' + f.dup + ' duplicate)');
          if(!f.keep.length) return [];
          var args = Array.prototype.slice.call(arguments); args[1] = f.keep;
          return origMany.apply(this, args);
        }
      }catch(e){ Logger.log('IndiaMartGuard _upsertMany: ' + e); }
      return origMany.apply(this, arguments);
    };
    wm.__ocImg = true; wm.__orig = origMany;
    _upsertMany = wm; done.push('_upsertMany');
  }
  if(typeof _upsert === 'function' && !_upsert.__ocImg){
    var origOne = _upsert;
    var wo = function(coll, rec){
      try{
        if(IMG_ON && coll === IMG_COLL && rec){
          var f = img_filter_([rec]);
          if(!f.keep.length){ Logger.log('IndiaMartGuard: 1 row roki (purani / duplicate)'); return null; }
        }
      }catch(e){ Logger.log('IndiaMartGuard _upsert: ' + e); }
      return origOne.apply(this, arguments);
    };
    wo.__ocImg = true; wo.__orig = origOne;
    _upsert = wo; done.push('_upsert');
  }
  return done;
}

/** likhne se pehle chhanti: purani rows aur NAYI duplicate rows bahar. */
function img_filter_(recs){
  var existing = [];
  try{
    existing = _readAll(IMG_COLL) || [];
  }catch(e){ existing = []; }
  var ids = {}, keys = {};
  existing.forEach(function(r){
    var d = img_data_(r); if(!d) return;
    var id = img_s_((r && r.id) || d.id);
    if(id) ids[id] = 1;
    var k = img_dupKey_(d); if(k && id && !keys[k]) keys[k] = id;
  });
  var keep = [], old = 0, dup = 0;
  recs.forEach(function(r){
    var d = img_data_(r), id = img_s_((r && r.id) || (d && d.id));
    if(img_tooOld_(d)){ old++; return; }
    if(!ids[id]){                                   /* sheet me nayi row */
      var k = img_dupKey_(d);
      if(k && keys[k] && keys[k] !== id){ dup++; return; }
      if(k) keys[k] = id;
    }
    keep.push(r);
  });
  return { keep: keep, old: old, dup: dup, dropped: old + dup };
}

function checkIndiaMartGuard(){
  var L = ['===== INDIAMART GUARD ====='];
  L.push('cut-off          : ' + IMG_START_AFTER + '  (key ' + IMG_CUT + ')');
  L.push('_upsertMany patch: ' + ((typeof _upsertMany === 'function' && _upsertMany.__ocImg) ? 'HAAN' : 'NAHI'));
  L.push('_upsert patch    : ' + ((typeof _upsert === 'function' && _upsert.__ocImg) ? 'HAAN' : (typeof _upsert === 'function' ? 'NAHI' : '(function hi nahi hai)')));
  try{
    var raw = _readAll(IMG_COLL) || [], old = 0;
    raw.forEach(function(r){ if(img_tooOld_(img_data_(r))) old++; });
    L.push('sheet me rows    : ' + raw.length + '   |   cut-off se pehle ki: ' + old);
  }catch(e){ L.push('read error: ' + e); }
  try{
    var t = img_filter_([
      { id:'TEST-OLD', data:{ id:'TEST-OLD', query_time:'15-08-2026 10:00:00', sender_mobile:'9999999999' } },
      { id:'TEST-NEW', data:{ id:'TEST-NEW', query_time:'25-09-2026 10:00:00', sender_mobile:'9999999998' } }
    ]);
    L.push('naqli jaanch     : ' + t.keep.length + ' rakhi, ' + t.old + ' purani roki   (1 rakhi, 1 roki aana chahiye)');
  }catch(e){ L.push('test error: ' + e); }
  L.push('');
  L.push('Sab HAAN ho to: Deploy > Manage deployments > pencil > Version: New version > Deploy');
  L.push('=====');
  Logger.log(L.join('\n'));
}

/* ------------------------------------------------------------------ *
 * 2. SAFAI -- green rows kabhi nahi hatti                             *
 * ------------------------------------------------------------------ */
function previewIndiaMartCleanup(){ return img_clean_(true); }
function cleanIndiaMartLeads(){ return img_clean_(false); }

function img_clean_(dryRun){
  var lock = LockService.getScriptLock();
  lock.waitLock(60000);
  try{
    var ss = (typeof SS !== 'undefined' && SS) ? SS : SpreadsheetApp.getActive();
    var sh = ss.getSheetByName(IMG_COLL);
    if(!sh){ Logger.log('IndiaMartCleanup: "' + IMG_COLL + '" tab nahi mila.'); return; }
    var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
    if(lastRow < 2){ Logger.log('IndiaMartCleanup: tab khaali hai.'); return; }

    /* field-key wali header row dhoondo (jisme 'id' aur 'query_time' ho) */
    var top = sh.getRange(1, 1, Math.min(5, lastRow), lastCol).getValues();
    var hr = -1, head = null;
    for(var i = 0; i < top.length; i++){
      var h = top[i].map(function(v){ return img_s_(v).trim(); });
      if(h.indexOf('id') >= 0 && h.indexOf('query_time') >= 0){ hr = i + 1; head = h; break; }
    }
    if(hr < 0){ Logger.log('IndiaMartCleanup: header row (id / query_time) nahi mili — kuch nahi kiya.'); return; }
    var cId = head.indexOf('id'), cQt = head.indexOf('query_time'),
        cMob = head.indexOf('sender_mobile'), cEnq = head.indexOf('enquiry_no');

    var first = hr + 1, n = lastRow - hr;
    if(n <= 0){ Logger.log('IndiaMartCleanup: data nahi hai.'); return; }
    var vals = sh.getRange(first, 1, n, lastCol).getValues();
    var bgs  = sh.getRange(first, 1, n, lastCol).getBackgrounds();
    var keepCol = IMG_KEEP_COLORS.map(function(c){ return c.toLowerCase(); });

    var rows = vals.map(function(v, k){
      var green = bgs[k].some(function(c){ return keepCol.indexOf(img_s_(c).toLowerCase()) >= 0; });
      var d = { query_time: v[cQt], sender_mobile: cMob >= 0 ? v[cMob] : '' };
      return { row: first + k, id: img_s_(v[cId]).trim(), green: green,
               enq: cEnq >= 0 ? img_s_(v[cEnq]).trim() : '', old: img_tooOld_(d), key: img_dupKey_(d) };
    });

    /* har mobile+time ke liye ek "asli" row: green > enquiry no wali > pehli */
    var best = {};
    rows.forEach(function(r){
      if(!r.id || !r.key || r.old) return;
      var b = best[r.key];
      var score = (r.green ? 2 : 0) + (r.enq ? 1 : 0);
      if(!b || score > b.score) best[r.key] = { row: r.row, score: score };
    });

    var del = [], why = { old: 0, dup: 0 }, greens = 0, greenOld = 0, greenDup = 0, blank = 0;
    rows.forEach(function(r){
      if(r.green){                                     /* green = sahi, kabhi nahi */
        greens++;
        if(r.old) greenOld++;
        else if(r.key && best[r.key] && best[r.key].row !== r.row) greenDup++;
        return;
      }
      if(!r.id){ blank++; return; }                    /* khaali row -- chhodo */
      if(r.old){ del.push(r.row); why.old++; return; }
      if(r.key && best[r.key] && best[r.key].row !== r.row){ del.push(r.row); why.dup++; }
    });

    var L = [];
    L.push('IndiaMartCleanup' + (dryRun ? ' (PREVIEW — kuch nahi badla)' : '') + ':');
    L.push('  kul data rows      : ' + rows.length + '  (header row ' + hr + ')');
    L.push('  GREEN (chhui nahi) : ' + greens);
    L.push('  hatengi            : ' + del.length + '  = ' + why.old + ' cut-off (' + IMG_START_AFTER + ') se pehle ki + '
           + why.dup + ' duplicate (mobile + time)');
    L.push('  bachengi           : ' + (rows.length - blank - del.length) + ' (green + cut-off ke baad ki nayi leads — ye kabhi nahi hatti)');
    if(greenOld) L.push('  DHYAN: ' + greenOld + ' GREEN row cut-off se pehle ki hain — green hone ki wajah se chhodi.');
    if(greenDup) L.push('  DHYAN: ' + greenDup + ' GREEN row aapas me duplicate hain — green hone ki wajah se chhodi.');
    if(blank) L.push('  ' + blank + ' bina id ki row — chhodi.');
    if(del.length) L.push('  pehli kuch rows: ' + del.slice(0, 15).join(', ') + (del.length > 15 ? ' …' : ''));

    if(dryRun || !del.length){ Logger.log(L.join('\n')); return { del: del.length, keep: rows.length - blank - del.length }; }

    /* backup pehle */
    var bname = 'bak_' + IMG_COLL + '_clean_' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd_HHmm');
    var cp = sh.copyTo(ss); cp.setName(bname);
    try{ cp.hideSheet(); }catch(e){}
    try{ var fl = sh.getFilter(); if(fl) fl.remove(); }catch(e){}

    /* neeche se upar, lagataar rows ek saath */
    del.sort(function(a, b){ return b - a; });
    var groups = [], g = null;
    del.forEach(function(r){
      if(g && r === g.start - 1){ g.start = r; g.len++; return; }
      g = { start: r, len: 1 }; groups.push(g);
    });
    groups.forEach(function(x){ sh.deleteRows(x.start, x.len); });
    SpreadsheetApp.flush();

    L.push('  backup tab         : "' + bname + '" (chhupa hua)');
    L.push('  HO GAYA — ' + del.length + ' row hatayi, ' + groups.length + ' block me.');
    Logger.log(L.join('\n'));
    return { del: del.length, keep: rows.length - blank - del.length, backup: bname };
  }finally{
    try{ lock.releaseLock(); }catch(e){}
  }
}
