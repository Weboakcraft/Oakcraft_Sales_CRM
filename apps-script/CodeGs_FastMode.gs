/**
 * OakCraft CRM — SERVER FAST MODE (v58)
 * ----------------------------------------------------------------------------
 * DIKKAT (Code.gs padh kar mili)
 *   1. Ek record save karne par bhi `_upsertMany()` poori collection padhta hai
 *      (`_readAll`), sab records flatten karta hai aur POORI sheet dobara likhta
 *      hai (`_writeMerged` -> `_writeBlock`). Quotation save = 150 rows x saare
 *      columns ka rewrite.
 *   2. `_route()` save se pehle bhi wahi collection `_readAll` se padhta hai --
 *      yaani har save par do baar poori sheet padhi jaati thi.
 *   3. Photos (`_driveify`) Drive par usi SCRIPT LOCK ke andar upload hoti hain
 *      jiske peeche CRM ke saare saves line me khade rehte hain.
 *   4. Quotation number (`nextQuoteNo`) bhi wahi script lock leta hai -- isliye
 *      number ke liye bhi doosre saves ka intezaar.
 *   5. `getAll` har baar har sheet poori padhta hai (~3 MB, ~15 sec) -- aur CRM
 *      ka har khula tab ise har minute maangta hai.
 *
 * KYA KARTA HAI (sirf lapet-ta hai -- Code.gs ka ek bhi akshar nahi badalta)
 *   A. `_readAll` -> CacheService me collection ki copy (chunks me). Jab tak koi
 *      likhta nahi, sheet dobara nahi padhi jaati. Har write ke baad us
 *      collection ka "version" badal jaata hai, isliye purani copy kabhi nahi
 *      milti. Sheet me haath se kiya badlaav max FM_CACHE_TTL sec me dikhta hai.
 *   B. `_upsertMany` me FM_ROW_WRITE_MAX tak records ho to sirf unhi ROWS ko
 *      likhta hai (Code.gs ka apna `_upsert`) -- poori sheet nahi.
 *   C. save / saveMany me photos lock lene se PEHLE Drive par chali jaati hain
 *      (login check ke baad). Lock ke andar ab sirf sheet ka kaam.
 *   D. Quotation number ka apna alag lock (Document lock) -- saves ke peeche
 *      line me nahi lagta. Counter wahi Script Property `qno-<FY>`.
 *
 * KAISE LAGAYEIN
 *   1. Apps Script project me nayi file (sabse neeche) -> ye poora code -> Save.
 *   2. `fastModeSelfTest` Run kijiye -> Execution log me sab "OK" hona chahiye.
 *      (Ye sirf ek temporary tab `zz_fastmode_test` me likhta hai aur use
 *      hata deta hai. CRM ka koi data nahi chhuta.)
 *   3. ZAROORI: Deploy > Manage deployments > pencil > Version: New version > Deploy.
 *
 * TURANT BAND KARNA HO (bina deploy)
 *   `fastModeOff` Run kijiye -- Script Property FAST_MODE_OFF = 1 lag jaati hai
 *   aur sab kuch Code.gs ke purane raaste par chalne lagta hai.
 *   Wapas chalu: `fastModeOn`.
 */

var FAST_MODE          = true;
var FM_CACHE_TTL       = 240;     /* sec -- sheet me haath se kiya badlaav itni der me dikhega */
var FM_ROW_WRITE_MAX   = 10;      /* itne tak records -> sirf rows likho, poori sheet nahi */
var FM_CHUNK           = 30000;   /* CacheService: ek value max 100 KB */
var FM_NO_CACHE        = ['users'];   /* login / password -- hamesha seedha sheet se */

var _FM_OFF = null, _FM_MEMO = {}, _FM_DEPTH = 0, _FM_FRESH = 0;

(function(){ try{ ocFastModeInstall_(); }catch(e){ Logger.log('FastMode install fail: ' + e); } })();

function fmOn_(){
  if(!FAST_MODE) return false;
  if(_FM_OFF === null){
    try{ _FM_OFF = PropertiesService.getScriptProperties().getProperty('FAST_MODE_OFF') === '1'; }
    catch(e){ _FM_OFF = false; }
  }
  return !_FM_OFF;
}
function fmVerKey_(n){ return 'fmv:' + n; }
function fmVer_(C, n){
  var v = C.get(fmVerKey_(n));
  if(!v){ v = Utilities.getUuid().slice(0, 8); C.put(fmVerKey_(n), v, 21600); }
  return v;
}
function fmBump_(n){
  if(!n) return;
  try{ CacheService.getScriptCache().put(fmVerKey_(String(n)), Utilities.getUuid().slice(0, 8), 21600); }catch(e){}
}

function ocFastModeInstall_(){
  if(typeof _readAll !== 'function' || _readAll.__ocFast) return !!(typeof _readAll === 'function');

  /* ---------------- A. _readAll cache ---------------- */
  var origRead = _readAll;
  var wRead = function(name){
    /* Likhne ke dauran (save / autosync / rebuild) hamesha SEEDHA sheet se --
       taaki poori sheet dobara likhne wala purana raasta kabhi purani copy par
       na chale (sheet me haath se kiya badlaav kabhi na mite). Cache sirf
       padhne ke liye: getAll / list / login ke alawa sab. */
    if(!fmOn_() || _FM_DEPTH > 0 || _FM_FRESH > 0 || FM_NO_CACHE.indexOf(String(name)) >= 0) return origRead.apply(this, arguments);
    try{
      var C = CacheService.getScriptCache();
      var v0 = fmVer_(C, name), base = 'fmd:' + name + ':' + v0;
      var s = _FM_MEMO[base];
      if(s == null){
        var head = C.get(base + ':n');
        if(head){
          var n = parseInt(head, 10), keys = [], i;
          for(i = 0; i < n; i++) keys.push(base + ':' + i);
          var got = C.getAll(keys), parts = [], ok = true;
          for(i = 0; i < n; i++){ var c = got[keys[i]]; if(c == null){ ok = false; break; } parts.push(c); }
          if(ok) s = parts.join('');
        }
      }
      if(s != null){ _FM_MEMO[base] = s; return JSON.parse(s); }

      var rows = origRead.apply(this, arguments);
      var str = JSON.stringify(rows);
      _FM_MEMO[base] = str;
      /* sirf tab cache karo jab padhte waqt kisi ne likha na ho */
      if(C.get(fmVerKey_(name)) === v0){
        var put = {}, cnt = 0, k = 0;
        for(var off = 0; off < str.length; off += FM_CHUNK){
          put[base + ':' + (k++)] = str.slice(off, off + FM_CHUNK); cnt++;
          if(cnt >= 25){ C.putAll(put, FM_CACHE_TTL); put = {}; cnt = 0; }
        }
        put[base + ':n'] = String(k);
        C.putAll(put, FM_CACHE_TTL);
      }
      return rows;
    }catch(e){
      Logger.log('FastMode _readAll(' + name + ') fallback: ' + e);
      return origRead.apply(this, arguments);
    }
  };
  wRead.__ocFast = 1; wRead.__orig = origRead;
  _readAll = wRead;

  /* ---------------- har write ke baad version badlo ---------------- */
  function wrapWrite(f, nameArg){
    if(typeof f !== 'function' || f.__ocFastW) return f;
    var w = function(){
      var name = arguments[nameArg];
      _FM_DEPTH++;
      try{ return f.apply(this, arguments); }
      finally{
        _FM_DEPTH--;
        fmBump_(name);
        if(_FM_DEPTH === 0){
          try{ SpreadsheetApp.flush(); }catch(e){}
          fmBump_(name);            /* flush ke BAAD bhi -- koi beech me purana na padh le */
        }
        _FM_MEMO = {};
      }
    };
    w.__ocFastW = 1; w.__orig = f;
    return w;
  }

  /* ---------------- B. chhote saves: sirf rows ---------------- */
  var origMany = _upsertMany;
  var wMany = function(name, recs){
    if(fmOn_() && recs && recs.length && recs.length <= FM_ROW_WRITE_MAX && typeof _upsert === 'function'){
      try{
        var sh = _sheet(name);
        if(!_isLegacy(sh)){
          var seen = {}, dup = false, i, id, b;
          for(i = 0; i < recs.length; i++){
            if(!recs[i]) continue;
            b = _body(recs[i]) || {};
            id = String(b.id != null ? b.id : (recs[i].id != null ? recs[i].id : ''));
            if(id && seen[id]){ dup = true; break; }
            if(id) seen[id] = 1;
          }
          if(!dup){
            var n = 0;
            for(i = 0; i < recs.length; i++){ if(recs[i]){ _upsert(name, recs[i]); n++; } }
            return n;
          }
        }
      }catch(e){
        Logger.log('FastMode row-write fallback (' + name + '): ' + e);
      }
    }
    return origMany.apply(this, arguments);
  };
  wMany.__orig = origMany;

  _upsert      = wrapWrite(_upsert, 0);
  _upsertMany  = wrapWrite(wMany, 0);
  _remove      = wrapWrite(_remove, 0);
  _removeMany  = wrapWrite(_removeMany, 0);
  _writeBlock  = wrapWrite(_writeBlock, 1);
  _writeRecords= wrapWrite(_writeRecords, 1);
  _initSheet   = wrapWrite(_initSheet, 1);

  /* ---------------- D. quotation number: apna lock ---------------- */
  if(typeof _nextQuoteNo === 'function' && !_nextQuoteNo.__ocFast){
    var origNext = _nextQuoteNo;
    var wNext = function(fy){
      if(!fmOn_()) return origNext.apply(this, arguments);
      var lock = null;
      try{ lock = LockService.getDocumentLock(); }catch(e){ lock = null; }
      if(!lock) return origNext.apply(this, arguments);
      lock.waitLock(20000);
      try{
        var props = PropertiesService.getScriptProperties();
        var key = 'qno-' + fy;
        var last = parseInt(props.getProperty(key) || '1000', 10);
        var next = last + 1;
        props.setProperty(key, String(next));
        return next;
      }finally{ lock.releaseLock(); }
    };
    wNext.__ocFast = 1; wNext.__orig = origNext;
    _nextQuoteNo = wNext;
  }

  /* ---------------- C + D. _route ---------------- */
  if(typeof _route === 'function' && !_route.__ocFast){
    var origRoute = _route;
    var wRoute = function(p, verb){
      try{
        if(fmOn_() && p && typeof p === 'object'){
          var act = p.action;
          if(act === 'nextQuoteNo'){
            var uq = _verify(p.sid);
            if(uq) return { ok: true, no: _nextQuoteNo(p.fy) };      /* script lock ka intezaar nahi */
          }
          if(act === 'save' || act === 'saveMany'){
            var u = _verify(p.sid), coll = p.collection;
            if(u && COLLECTIONS.indexOf(coll) >= 0 && !(ADMIN_WRITE.indexOf(coll) >= 0 && !u.isAdmin)){
              var recs = (act === 'saveMany') ? (p.records || []) : [p.record || (p.records && p.records[0])];
              for(var i = 0; i < recs.length; i++){
                var r = recs[i]; if(!r) continue;
                var b = _body(r);
                if(b && typeof b === 'object' && b.id != null && String(b.id) !== '') _driveify(coll, b);
              }
            }
          }
        }
      }catch(e){ Logger.log('FastMode route pre-step: ' + e); }
      var isW = p && (p.action === 'save' || p.action === 'saveMany' || p.action === 'delete');
      if(isW) _FM_FRESH++;
      try{ return origRoute.apply(this, arguments); }
      finally{ if(isW) _FM_FRESH--; }
    };
    wRoute.__ocFast = 1; wRoute.__orig = origRoute;
    _route = wRoute;
  }
  return true;
}

/* ============================ helpers (Run se chalaiye) ============================ */

function fastModeOff(){ PropertiesService.getScriptProperties().setProperty('FAST_MODE_OFF', '1'); return 'FAST MODE: OFF (purana raasta). Wapas chalu: fastModeOn'; }
function fastModeOn(){ PropertiesService.getScriptProperties().deleteProperty('FAST_MODE_OFF'); return 'FAST MODE: ON'; }

/**
 * Jaanch: (1) cache wali copy bilkul sheet jaisi hai, (2) chhota save sirf rows
 * likhta hai aur nateeja poore rewrite jaisa hi hai, (3) timing.
 * Sirf temporary tab `zz_fastmode_test` me likhta hai, aur end me use hata deta hai.
 */
function fastModeSelfTest(){
  var L = [], ok = true;
  function say(s){ L.push(s); Logger.log(s); }
  say('install: ' + ocFastModeInstall_() + ' | _readAll fast=' + !!_readAll.__ocFast + ' | ON=' + fmOn_());
  var orig = _readAll.__orig || _readAll;

  /* 1. cache == sheet */
  ['quotations','orders','enquiries','customers','products','dispatch','activity'].forEach(function(c){
    if(COLLECTIONS.indexOf(c) < 0) return;
    var t0 = Date.now(); var a = JSON.stringify(orig(c)); var tSheet = Date.now() - t0;
    _FM_MEMO = {};
    _readAll(c);                                   /* bharo */
    _FM_MEMO = {};
    t0 = Date.now(); var b = JSON.stringify(_readAll(c)); var tCache = Date.now() - t0;
    var same = (a === b); if(!same) ok = false;
    say((same ? 'OK  ' : 'FAIL') + ' cache ' + c + ': sheet ' + tSheet + 'ms -> cache ' + tCache + 'ms (' + Math.round(a.length/1024) + ' KB)');
  });

  /* 2. row-write == full-write (temporary tab) */
  var T = 'zz_fastmode_test';
  try{
    var old = SS.getSheetByName(T); if(old) SS.deleteSheet(old);
    var mk = function(i, extra){ var d = { id: 'T' + i, name: 'Test ' + i, qty: i, items: [{ name: 'A' + i, price: i * 10 }] }; for(var k in (extra || {})) d[k] = extra[k]; return { id: d.id, data: d }; };
    _upsertMany.__orig.__orig(T, [mk(1), mk(2), mk(3), mk(4)]);          /* purana poora rewrite */
    var t1 = Date.now();
    _upsertMany(T, [mk(2, { qty: 99, note: 'changed' }), mk(5, { extra: 'naya column' })]);   /* naya raasta */
    var tRow = Date.now() - t1;
    _FM_MEMO = {};
    var rows = orig(T), by = {};
    rows.forEach(function(r){ by[r.id] = _body(r); });
    var c1 = by.T2 && by.T2.qty == 99 && by.T2.note === 'changed' && by.T2.name === 'Test 2';
    var c2 = by.T5 && by.T5.extra === 'naya column' && by.T5.items && by.T5.items[0].price == 50;
    var c3 = by.T1 && by.T3 && by.T4 && rows.length === 5;
    if(!(c1 && c2 && c3)) ok = false;
    say(((c1 && c2 && c3) ? 'OK  ' : 'FAIL') + ' row-write: update=' + !!c1 + ' insert+naya column=' + !!c2 + ' baaki rows same=' + !!c3 + ' (' + tRow + 'ms)');
  }catch(e){ ok = false; say('FAIL row-write: ' + e); }
  finally{ try{ var s = SS.getSheetByName(T); if(s) SS.deleteSheet(s); }catch(e){} }

  /* 3. numbering lock (sirf dekhte hain, number allocate NAHI karte) */
  var dl = null; try{ dl = LockService.getDocumentLock(); }catch(e){}
  say((dl ? 'OK  ' : 'WARN') + ' document lock ' + (dl ? 'available' : 'nahi mila -- numbering purane script lock par chalegi'));

  say(ok ? '===== SAB OK — ab New version Deploy kijiye =====' : '===== KUCH FAIL — deploy MAT kijiye, log bhejiye =====');
  return L.join('\n');
}

/** getAll jaisa poora read: purana vs cache (kuch likhta nahi). */
function fastModeBench(){
  var orig = _readAll.__orig || _readAll, t0 = Date.now(), sz = 0;
  COLLECTIONS.forEach(function(c){ if(c !== 'meta') sz += JSON.stringify(orig(c)).length; });
  var tSheet = Date.now() - t0;
  _FM_MEMO = {};
  COLLECTIONS.forEach(function(c){ if(c !== 'meta') _readAll(c); });   /* bharo */
  _FM_MEMO = {};
  t0 = Date.now();
  COLLECTIONS.forEach(function(c){ if(c !== 'meta') _readAll(c); });
  var tCache = Date.now() - t0;
  var s = 'getAll-jaisa read: sheet se ' + tSheet + 'ms, cache se ' + tCache + 'ms (' + Math.round(sz/1024) + ' KB)';
  Logger.log(s); return s;
}
