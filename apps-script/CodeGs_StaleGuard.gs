/**
 * STALE-WRITE GUARD -- purani copy kabhi naye data ko overwrite na kare (22-10-2026)
 * ----------------------------------------------------------------------------
 * DIKKAT
 *   Ek hi login (mis@oakcraft.in) kai devices par khula hai. Jis device ka tab
 *   ghanton / dinon se refresh nahi hua, uske browser me leads ki PURANI copy
 *   padi rehti hai. Us copy se koi bhi "poori list save" (saveMany 1481 records)
 *   sheet par pahunchti thi to server bina dekhe sab likh deta tha -- 22-10 ko
 *   10:32 par yahi hua: 142 leads ke status wapas New / purane ho gaye.
 *   Client (index.html) me guard hain, par purana khula tab PURANA code chalata
 *   hai -- isliye pehra server par hona chahiye, jo har device / har version par
 *   lagta hai.
 *
 * NIYAM (sirf web app ke save / saveMany par -- Apps Script ke apne imports,
 * MetaAutoSyncV2, IndiaMartAutoSync waghera par koi asar nahi)
 *   Har aate record ka `updatedAt` (jis version se device ne copy li thi, ya
 *   device par edit ka time) sheet ke maujooda record ke `updatedAt` se tulna:
 *     a) sheet par record nahi hai            -> naya record, likho
 *     b) aata record sheet se PURANA hai      -> NAHI likha jaata (sheet wala
 *        (updatedAt < sheet ka updatedAt)        naya data bacha rehta hai).
 *        Agar content alag tha to "CRM Stale Write Log" spreadsheet me poora
 *        record darj hota hai, taaki kuch bhi hamesha ke liye na khoye.
 *     c) content bilkul wahi hai jo sheet par hai -> likhne ki zaroorat nahi
 *        (isse bekaar ka updatedAt badalna band -- doosre devices ki copy
 *        bina wajah "purani" nahi banti)
 *     d) baaki (asli edit, naye time ke saath)  -> likho, pehle jaisa
 *   Server ka jawab: { ..., staleBlocked: n } -- purana client ise andekha karta
 *   hai, "ok" maanta hai, aur agle pull par sheet ka naya data le leta hai.
 *
 * KAISE LAGAYEIN
 *   1. Apps Script project (Web_Sales_CRM) me nayi file: CodeGs_StaleGuard --
 *      ye poora code paste -> Save. File list me SABSE NEECHE.
 *   2. `sg_setup` Run (log spreadsheet banata hai) -> `sg_selfTest` Run ->
 *      sab PASS.
 *   3. ZAROORI: Deploy > Manage deployments > pencil > Version: New version >
 *      Deploy. (doPost me pehra tabhi lagta hai.) URL wahi rehta hai.
 *
 * WAPAS HATANA HO
 *   `var SG_ON = false;` -> Save -> dobara New version deploy.
 */

var SG_ON    = true;
var SG_COLLS = ['metaLeads', 'indiamartLeads', 'enquiries', 'quotations', 'orders', 'dispatch', 'customers'];
/* Sheets me date-time ki precision ke liye 1 second ki chhoot */
var SG_TOL_MS = 1000;
var SG_LOG_PROP = 'SG_LOG_SS_ID';
var SG_LOG_NAME = 'CRM Stale Write Log (blocked old-copy saves)';
var SG_LOG_MAX_ROWS_PER_SAVE = 300;
/* ye field tulna me nahi aate -- server khud likhta hai */
var SG_META = { updatedAt: 1, updatedBy: 1, _cPhone: 1, _cContact: 1 };

var SG_WEB_ = 0;          /* >0 = abhi web app ka save chal raha hai */
var SG_REQ_ = null;       /* { sid, coll, blocked, same, logged } -- isi request ka hisaab */

function sg_s_(v){ return v == null ? '' : String(v); }
function sg_body_(r){
  if(typeof _body === 'function'){ try{ var b = _body(r); if(b && typeof b === 'object') return b; }catch(e){} }
  return (r && r.data && typeof r.data === 'object') ? r.data : (r || {});
}
/** koi bhi timestamp -> ms (na bane to NaN) */
function sg_ms_(v){
  if(v instanceof Date) return v.getTime();
  var s = sg_s_(v).trim(); if(!s) return NaN;
  var t = new Date(s).getTime();
  return isNaN(t) ? NaN : t;
}
/** value ko tulna-yogya string me (Date -> ISO, object -> JSON, khaali = '') */
function sg_norm_(v){
  if(v == null) return '';
  if(v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString();
  if(typeof v === 'object'){ try{ return JSON.stringify(v); }catch(e){ return String(v); } }
  return String(v).trim();
}
/** dono records me kaunse field alag hain (server ke meta field chhod kar) */
function sg_diff_(a, b){
  var keys = {}, k, out = [];
  for(k in a) if(Object.prototype.hasOwnProperty.call(a, k)) keys[k] = 1;
  for(k in b) if(Object.prototype.hasOwnProperty.call(b, k)) keys[k] = 1;
  for(k in keys){
    if(SG_META[k]) continue;
    var x = sg_norm_(a[k]), y = sg_norm_(b[k]);
    if(x === y) continue;
    /* number vs string ("12" / 12, "12.0") ko barabar maano */
    if(x !== '' && y !== '' && !isNaN(+x) && !isNaN(+y) && +x === +y) continue;
    out.push(k);
  }
  return out;
}

/**
 * Pure faisla (selfTest bhi isi ko chalata hai).
 * cur = sheet ka record body (ya null), inc = aata record body
 * -> { act: 'write' | 'same' | 'stale', diff: [fields], inT, curT }
 */
function sg_decide_(cur, inc){
  if(!cur) return { act: 'write', diff: [] };
  var diff = sg_diff_(inc, cur);
  if(!diff.length) return { act: 'same', diff: diff };
  var inT = sg_ms_(inc.updatedAt), curT = sg_ms_(cur.updatedAt);
  if(!isNaN(inT) && !isNaN(curT) && inT < curT - SG_TOL_MS){
    return { act: 'stale', diff: diff, inT: inT, curT: curT };
  }
  return { act: 'write', diff: diff };
}

/** aate records ko chhanto: { keep, stale:[{rec,cur,diff}], same } */
function sg_filter_(coll, recs){
  var ex = [];
  try{ ex = _readAll(coll) || []; }catch(e){ return { keep: recs, stale: [], same: 0, err: String(e) }; }
  var byId = {}, i;
  for(i = 0; i < ex.length; i++){
    var b = sg_body_(ex[i]);
    var id = sg_s_(b && b.id != null ? b.id : (ex[i] && ex[i].id));
    if(id) byId[id] = b;
  }
  var keep = [], stale = [], same = 0;
  for(i = 0; i < recs.length; i++){
    var r = recs[i]; if(!r){ continue; }
    var nb = sg_body_(r);
    var rid = sg_s_(r.id != null ? r.id : nb.id);
    var cur = rid ? byId[rid] : null;
    /* aata record apna updatedAt kabhi wrapper par rakhta hai */
    if(nb && nb.updatedAt == null && r.updatedAt != null){ nb = JSON.parse(JSON.stringify(nb)); nb.updatedAt = r.updatedAt; }
    var d = sg_decide_(cur, nb || {});
    if(d.act === 'stale'){ stale.push({ rec: nb, cur: cur, diff: d.diff, id: rid }); continue; }
    if(d.act === 'same'){ same++; continue; }
    keep.push(r);
  }
  return { keep: keep, stale: stale, same: same };
}

function sg_ist_(ms){
  try{ return Utilities.formatDate(new Date(ms), 'Asia/Kolkata', 'dd-MM-yyyy HH:mm:ss'); }catch(e){ return sg_s_(ms); }
}
/** roke gaye (content alag) records log spreadsheet me */
function sg_log_(coll, stale){
  if(!stale.length) return 0;
  /* wahi purana tab baar-baar wahi copy bhejta hai -- ek record + ek version
     6 ghante me ek hi baar darj ho */
  try{
    var cache = CacheService.getScriptCache();
    var keys = stale.map(function(x){ return ('sg|' + coll + '|' + x.id + '|' + sg_s_(x.rec.updatedAt)).slice(0, 240); });
    var hit = cache.getAll(keys) || {}, fresh = [], put = {};
    stale.forEach(function(x, i){ if(!hit[keys[i]]){ fresh.push(x); put[keys[i]] = '1'; } });
    if(Object.keys(put).length) cache.putAll(put, 21600);
    stale = fresh;
  }catch(e){}
  if(!stale.length) return 0;
  var id = PropertiesService.getScriptProperties().getProperty(SG_LOG_PROP);
  if(!id){ Logger.log('StaleGuard: log spreadsheet nahi hai (sg_setup chalaiye). Roke: ' + stale.length); return 0; }
  var who = '';
  try{ var u = (SG_REQ_ && SG_REQ_.sid) ? _verify(SG_REQ_.sid) : null; who = u ? sg_s_(u.email) : ''; }catch(e){}
  var now = sg_ist_(Date.now());
  var rows = stale.slice(0, SG_LOG_MAX_ROWS_PER_SAVE).map(function(x){
    var ch = x.diff.slice(0, 12).map(function(k){
      return k + ': ' + sg_norm_(x.cur[k]).slice(0, 40) + ' <- ' + sg_norm_(x.rec[k]).slice(0, 40);
    }).join(' | ');
    var js = ''; try{ js = JSON.stringify(x.rec); }catch(e){}
    return [now, who, coll, x.id,
            isNaN(sg_ms_(x.rec.updatedAt)) ? sg_s_(x.rec.updatedAt) : sg_ist_(sg_ms_(x.rec.updatedAt)),
            isNaN(sg_ms_(x.cur.updatedAt)) ? sg_s_(x.cur.updatedAt) : sg_ist_(sg_ms_(x.cur.updatedAt)),
            sg_s_(x.cur.lead_status || x.cur.stage || ''), sg_s_(x.rec.lead_status || x.rec.stage || ''),
            ch.slice(0, 2000), js.slice(0, 45000)];
  });
  try{
    var sh = SpreadsheetApp.openById(id).getSheets()[0];
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    return rows.length;
  }catch(e){ Logger.log('StaleGuard log fail: ' + e); return 0; }
}

/* ------------------------------------------------------------------ *
 * pehra lagana (load hote hi)                                         *
 * ------------------------------------------------------------------ */
(function(){ try{ sg_install_(); }catch(e){ Logger.log('StaleGuard install fail: ' + e); } })();

function sg_install_(){
  var done = [];
  if(typeof _upsertMany === 'function' && !_upsertMany.__ocSg){
    var origMany = _upsertMany;
    var wm = function(coll, recs){
      try{
        if(SG_ON && SG_WEB_ > 0 && SG_COLLS.indexOf(coll) >= 0 && recs && recs.length){
          var f = sg_filter_(coll, recs);
          if(SG_REQ_){ SG_REQ_.blocked += f.stale.length; SG_REQ_.same += f.same; }
          if(f.stale.length){
            var n = sg_log_(coll, f.stale);
            if(SG_REQ_) SG_REQ_.logged += n;
            Logger.log('StaleGuard: ' + coll + ' -- ' + f.stale.length + ' purane record roke (sheet par naya data hai), '
                       + f.same + ' bina badlaav, ' + f.keep.length + ' likhe');
          }
          if(!f.keep.length) return 0;
          var args = Array.prototype.slice.call(arguments); args[1] = f.keep;
          return origMany.apply(this, args);
        }
      }catch(e){ Logger.log('StaleGuard _upsertMany: ' + e); }
      return origMany.apply(this, arguments);
    };
    wm.__ocSg = true; wm.__orig = origMany;
    _upsertMany = wm; done.push('_upsertMany');
  }
  if(typeof _route === 'function' && !_route.__ocSg){
    var origRoute = _route;
    var wr = function(p, verb){
      var act = p && p.action;
      var isW = (act === 'save' || act === 'saveMany');
      if(!isW) return origRoute.apply(this, arguments);
      var prev = SG_REQ_;
      SG_REQ_ = { sid: p.sid, coll: p.collection, blocked: 0, same: 0, logged: 0 };
      SG_WEB_++;
      try{
        var res = origRoute.apply(this, arguments);
        try{
          if(res && typeof res === 'object' && !(res instanceof Array) && (SG_REQ_.blocked || SG_REQ_.same)){
            res.staleBlocked = SG_REQ_.blocked;
            res.unchanged = SG_REQ_.same;
          }
        }catch(e){}
        return res;
      }finally{
        SG_WEB_--; SG_REQ_ = prev;
      }
    };
    wr.__ocSg = true; wr.__orig = origRoute;
    _route = wr; done.push('_route');
  }
  return done;
}

/* ------------------------------------------------------------------ *
 * Run se chalane wale                                                 *
 * ------------------------------------------------------------------ */
/** log spreadsheet banata hai (ek baar). CRM data ko chhuta nahi. */
function sg_setup(){
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(SG_LOG_PROP), ss = null;
  if(id){ try{ ss = SpreadsheetApp.openById(id); }catch(e){ ss = null; } }
  if(!ss){
    ss = SpreadsheetApp.create(SG_LOG_NAME);
    var sh = ss.getSheets()[0];
    sh.setName('blocked');
    sh.getRange(1, 1, 1, 10).setValues([['Blocked at (IST)', 'Login', 'Collection', 'Record ID',
      'Device copy updatedAt (IST)', 'Sheet updatedAt (IST)', 'Sheet status (kept)', 'Device status (blocked)',
      'Fields that differed (sheet <- device)', 'Full device record (JSON)']]);
    sh.setFrozenRows(1);
    props.setProperty(SG_LOG_PROP, ss.getId());
  }
  Logger.log('StaleGuard log spreadsheet: ' + ss.getName() + '  id ' + ss.getId());
  return ss.getId();
}

function sg_status(){
  var L = ['===== STALE-WRITE GUARD ====='];
  L.push('on            : ' + (SG_ON ? 'HAAN' : 'NAHI (SG_ON = false)'));
  L.push('collections   : ' + SG_COLLS.join(', '));
  L.push('_upsertMany   : ' + ((typeof _upsertMany === 'function' && _upsertMany.__ocSg) ? 'HAAN' : 'NAHI'));
  L.push('_route        : ' + ((typeof _route === 'function' && _route.__ocSg) ? 'HAAN' : 'NAHI'));
  L.push('log sheet id  : ' + (PropertiesService.getScriptProperties().getProperty(SG_LOG_PROP) || '(nahi -- sg_setup chalaiye)'));
  L.push('Sab HAAN ho to: Deploy > Manage deployments > pencil > Version: New version > Deploy');
  Logger.log(L.join('\n'));
  return L.join('\n');
}

/** Kuch nahi likhta -- sirf niyam ki jaanch + asli metaLeads par "agar purani copy aaye to" */
function sg_selfTest(){
  var out = [], pass = 0, fail = 0;
  function ok(name, cond){ if(cond){ pass++; out.push('PASS  ' + name); } else { fail++; out.push('FAIL  ' + name); } }
  var cur = { id: 'X1', lead_status: 'NOT_QUALIFIED', stage: 'Not Qualified', owner: 'a@x.in', updatedAt: '2026-10-21T10:00:00.000Z', updatedBy: 'a@x.in' };
  ok('naya record likha jaata hai', sg_decide_(null, { id: 'N1', updatedAt: '2026-01-01T00:00:00Z' }).act === 'write');
  ok('purani copy (status CREATED, 20-10) roki', sg_decide_(cur, { id: 'X1', lead_status: 'CREATED', stage: 'New', owner: 'a@x.in', updatedAt: '2026-10-20T08:00:00.000Z' }).act === 'stale');
  ok('wahi content -> likhna nahi (same)', sg_decide_(cur, { id: 'X1', lead_status: 'NOT_QUALIFIED', stage: 'Not Qualified', owner: 'a@x.in', updatedAt: '2026-10-19T00:00:00Z' }).act === 'same');
  ok('asli edit (naya time) likha', sg_decide_(cur, { id: 'X1', lead_status: 'WON', stage: 'Won', owner: 'a@x.in', updatedAt: '2026-10-21T10:05:00.000Z' }).act === 'write');
  ok('wahi version + edit (updatedAt barabar) likha', sg_decide_(cur, { id: 'X1', lead_status: 'WON', stage: 'Won', owner: 'a@x.in', updatedAt: '2026-10-21T10:00:00.000Z' }).act === 'write');
  ok('Date object vs ISO, 0.4 s farak -> purana nahi', sg_decide_({ id: 'X1', a: 1, updatedAt: new Date('2026-10-21T10:00:00.400Z') }, { id: 'X1', a: 2, updatedAt: '2026-10-21T10:00:00.000Z' }).act === 'write');
  ok('updatedAt nahi -> likha (faisla nahi ho sakta)', sg_decide_(cur, { id: 'X1', lead_status: 'WON' }).act === 'write');
  ok('number "12" vs 12 barabar', sg_diff_({ id: 'X', v: '12' }, { id: 'X', v: 12 }).length === 0);
  ok('updatedBy / updatedAt tulna me nahi', sg_diff_({ id: 'X', updatedBy: 'b', updatedAt: '1' }, { id: 'X', updatedBy: 'a', updatedAt: '2' }).length === 0);
  ok('khaali vs missing barabar', sg_diff_({ id: 'X', note: '' }, { id: 'X' }).length === 0);
  ok('guard laga hai (_upsertMany + _route)', !!(_upsertMany && _upsertMany.__ocSg && _route && _route.__ocSg));
  ok('Apps Script ke apne writes par guard nahi (SG_WEB_ 0)', SG_WEB_ === 0);

  /* asli data par naqli "purani copy" -- likhta kuch nahi */
  try{
    var rows = (_readAll('metaLeads') || []).map(sg_body_).filter(function(b){ return b && b.id && b.updatedAt; });
    var fake = rows.map(function(b){
      var c = JSON.parse(JSON.stringify(b));
      c.updatedAt = new Date(sg_ms_(b.updatedAt) - 3 * 86400000).toISOString();   /* 3 din purani copy */
      if(String(c.lead_status).toUpperCase() !== 'CREATED'){ c.lead_status = 'CREATED'; c.stage = 'New'; }
      return { id: c.id, data: c };
    });
    var f = sg_filter_('metaLeads', fake);
    out.push('asli metaLeads: ' + rows.length + ' records -- 3 din purani copy bheji to: ' + f.stale.length + ' roke, '
             + f.same + ' bina badlaav, ' + f.keep.length + ' likhe');
    ok('purani copy ka ek bhi record nahi likha jaata', f.keep.length === 0);
    var same = rows.map(function(b){ return { id: b.id, data: JSON.parse(JSON.stringify(b)) }; });
    var g = sg_filter_('metaLeads', same);
    out.push('wahi taaza copy dobara bheji to: ' + g.same + ' bina badlaav, ' + g.keep.length + ' likhe, ' + g.stale.length + ' roke');
    ok('taaza copy -> sab "bina badlaav" (kuch nahi likha)', g.keep.length === 0 && g.stale.length === 0);
  }catch(e){ fail++; out.push('FAIL  asli data jaanch: ' + e); }

  out.unshift('StaleGuard selfTest: ' + pass + ' PASS, ' + fail + ' FAIL');
  Logger.log(out.join('\n'));
  return fail === 0;
}
