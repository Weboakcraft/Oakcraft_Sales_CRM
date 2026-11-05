/**
 * OakCraft CRM — GEM ALAG TAB (Gem split) — 05-11-2026
 * ----------------------------------------------------------------------------
 * KYA
 *   Gem leads ab `metaLeads` tab me nahi, apne alag tab **`Gem`** me save hoti
 *   hain. Meta leads `metaLeads` tab me hi rehti hain.
 *
 * CRM APP ME KOI BADLAAV NAHI
 *   App (index.html / Android) ke liye Gem pehle jaisa `metaLeads` collection
 *   ka hissa hai. Ye file sirf backend me data ko do tabs me baant-ti hai:
 *     padhna   _readAll('metaLeads')  = metaLeads tab + Gem tab (ek hi list)
 *     likhna   Gem record (id GEM-... ya platform = gem) -> Gem tab
 *              baaki (Meta) record                       -> metaLeads tab
 *     delete   dono tabs me dhoondh kar
 *   Isliye Gem section, Qualified, Follow-ups, Dashboard, Lead Coordinator,
 *   notification emails, Meta import, StaleGuard -- sab pehle jaisa chalte hain.
 *
 * CHALU / BAND
 *   Script Property GEM_SPLIT = '1' hone par hi kaam karta hai. Ye property
 *   `gemSplitMigrate` lagata hai (data move karne ke baad). Property na ho to
 *   ye file kuch nahi karti -- sab Code.gs ke purane raaste par.
 *   Wapas pehle jaisa: `gemSplitUndo` (Gem rows wapas metaLeads me, flag band).
 *
 * LAGANA
 *   1. Ye file project me SABSE NEECHE (CodeGs_StaleGuard ke baad). Save.
 *   2. Deploy > Manage deployments > pencil > Version: New version > Deploy.
 *   3. `gemSplitMigrate` Run -> log me "HO GAYA". (Backup tab pehle banta hai.)
 *   Jaanch kabhi bhi: `gemSplitStatus`.
 */

var GS_TAB  = 'Gem';
var GS_COLL = 'metaLeads';
var GS_PROP = 'GEM_SPLIT';
var GS_LIVE_SS_ID = '1MBhP94OUWWvJ_Vhty3-PNyppMimgMrdLnkhPLkMF0jQ';

var _GS_ON = null, _GS_DEPTH = 0;

(function(){ try{ gs_install_(); }catch(e){ Logger.log('GemSplit install fail: ' + e); } })();

/* ------------------------------------------------------------------ helpers */
function gs_on_(){
  if(_GS_ON === null){
    try{ _GS_ON = PropertiesService.getScriptProperties().getProperty(GS_PROP) === '1'; }
    catch(e){ _GS_ON = false; }
  }
  return _GS_ON;
}
function gs_b_(r){
  if(!r) return null;
  try{ if(typeof _body === 'function'){ var b = _body(r); if(b) return b; } }catch(e){}
  return (r.data !== undefined && r.data !== null && typeof r.data === 'object') ? r.data : r;
}
function gs_id_(r){
  var b = gs_b_(r) || {};
  var id = (b.id != null && b.id !== '') ? b.id : (r && r.id != null ? r.id : '');
  return String(id == null ? '' : id).trim();
}
function gs_isGem_(r){
  var b = gs_b_(r); if(!b) return false;
  if(/^GEM-/i.test(gs_id_(r))) return true;
  return String(b.platform == null ? '' : b.platform).trim().toLowerCase() === 'gem';
}
function gs_split_(recs){
  var out = { meta: [], gem: [] };
  for(var i = 0; i < recs.length; i++){
    if(!recs[i]) continue;
    (gs_isGem_(recs[i]) ? out.gem : out.meta).push(recs[i]);
  }
  return out;
}
/** metaLeads + Gem; ek hi id dono me ho to Gem tab wali (naya ghar) jeet-ti hai */
function gs_union_(metaRows, gemRows){
  metaRows = metaRows || []; gemRows = gemRows || [];
  var inGem = {}, i, out = [];
  for(i = 0; i < gemRows.length; i++){ var g = gs_id_(gemRows[i]); if(g) inGem[g] = 1; }
  for(i = 0; i < metaRows.length; i++){ if(!inGem[gs_id_(metaRows[i])]) out.push(metaRows[i]); }
  return out.concat(gemRows);
}
function gs_inner_(f, self, args){
  _GS_DEPTH++;
  try{ return f.apply(self, args); } finally { _GS_DEPTH--; }
}
function gs_fresh_(d){ try{ if(typeof _FM_FRESH !== 'undefined') _FM_FRESH += d; }catch(e){} }
function gs_bump_(){ try{ if(typeof fmBump_ === 'function'){ fmBump_(GS_COLL); fmBump_(GS_TAB); } }catch(e){} }

/* ------------------------------------------------------------------ wrappers */
function gs_install_(){
  if(typeof _readAll !== 'function' || _readAll.__ocGem) return false;

  /* StaleGuard (purani copy ko rokna) Gem tab par bhi lage */
  try{ if(typeof SG_COLLS !== 'undefined' && SG_COLLS.indexOf(GS_TAB) < 0) SG_COLLS.push(GS_TAB); }catch(e){}

  var oRead = _readAll, oMany = _upsertMany, oOne = _upsert, oRem = _remove, oRemMany = _removeMany;
  var oRebuild = (typeof _rebuild === 'function') ? _rebuild : null;

  var wRead = function(name){
    if(name !== GS_COLL || _GS_DEPTH > 0 || !gs_on_()) return oRead.apply(this, arguments);
    var m = gs_inner_(oRead, this, [GS_COLL]) || [];
    var g = gs_inner_(oRead, this, [GS_TAB]) || [];
    return gs_union_(m, g);
  };
  wRead.__ocGem = 1; wRead.__orig = oRead; _readAll = wRead;

  var wMany = function(name, recs){
    if(name !== GS_COLL || !gs_on_() || !recs || !recs.length) return oMany.apply(this, arguments);
    var sp = gs_split_(recs), n = 0, a;
    if(sp.meta.length){ a = Array.prototype.slice.call(arguments); a[1] = sp.meta; n += Number(gs_inner_(oMany, this, a)) || 0; }
    if(sp.gem.length){  a = Array.prototype.slice.call(arguments); a[0] = GS_TAB; a[1] = sp.gem; n += Number(gs_inner_(oMany, this, a)) || 0; }
    return n;
  };
  wMany.__ocGem = 1; wMany.__orig = oMany; _upsertMany = wMany;

  var wOne = function(name, rec){
    if(name !== GS_COLL || !gs_on_() || !rec) return oOne.apply(this, arguments);
    var a = Array.prototype.slice.call(arguments);
    if(gs_isGem_(rec)) a[0] = GS_TAB;
    return gs_inner_(oOne, this, a);
  };
  wOne.__ocGem = 1; wOne.__orig = oOne; _upsert = wOne;

  var wRem = function(name, id){
    if(name !== GS_COLL || !gs_on_()) return oRem.apply(this, arguments);
    var a = gs_inner_(oRem, this, [GS_COLL, id]);
    var b = gs_inner_(oRem, this, [GS_TAB, id]);
    return !!(a || b);
  };
  wRem.__ocGem = 1; wRem.__orig = oRem; _remove = wRem;

  var wRemMany = function(name, list){
    if(name !== GS_COLL || !gs_on_() || !list || !list.length) return oRemMany.apply(this, arguments);
    var gemIds = [], metaIds = [];
    for(var i = 0; i < list.length; i++){
      var id = String(list[i] == null ? '' : list[i]);
      (/^GEM-/i.test(id) ? gemIds : metaIds).push(list[i]);
    }
    var n = 0;
    /* GEM- id sirf Gem tab me; baaki dono me dhoondo (platform=gem wali purani id ho sakti hai) */
    if(metaIds.length) n += Number(gs_inner_(oRemMany, this, [GS_COLL, metaIds])) || 0;
    var g = gemIds.concat(metaIds);
    if(g.length) n += Number(gs_inner_(oRemMany, this, [GS_TAB, g])) || 0;
    return n;
  };
  wRemMany.__ocGem = 1; wRemMany.__orig = oRemMany; _removeMany = wRemMany;

  if(oRebuild){
    var wReb = function(name){
      if(name !== GS_COLL || !gs_on_()) return oRebuild.apply(this, arguments);
      return { collection: GS_COLL, meta: gs_inner_(oRebuild, this, [GS_COLL]), gem: gs_inner_(oRebuild, this, [GS_TAB]) };
    };
    wReb.__ocGem = 1; wReb.__orig = oRebuild; _rebuild = wReb;
  }
  return true;
}

/* ------------------------------------------------------------------ check */
/** records (bodies) -> {id: normalised JSON} */
function gs_sig_(rows){
  var m = {};
  (rows || []).forEach(function(r){
    var b = gs_b_(r); if(!b) return;
    var id = gs_id_(r);
    var s; try{ s = JSON.stringify(typeof _norm === 'function' ? _norm(b) : b); }catch(e){ s = String(Math.random()); }
    m[id] = s;
  });
  return m;
}
/** want ke har record ka got me bilkul wahi copy hai? -> farak wali ids */
function gs_diff_(want, got){
  var a = gs_sig_(want), b = gs_sig_(got), bad = [];
  Object.keys(a).forEach(function(id){ if(a[id] !== b[id]) bad.push(id); });
  Object.keys(b).forEach(function(id){ if(!(id in a)) bad.push('+' + id); });
  return bad;
}
function gs_readTab_(name){
  _GS_DEPTH++; gs_fresh_(1);
  try{ return _readAll(name) || []; } finally { gs_fresh_(-1); _GS_DEPTH--; }
}

function gemSplitStatus(){
  var out = [];
  var on = PropertiesService.getScriptProperties().getProperty(GS_PROP) === '1';
  var hasTab = !!SS.getSheetByName(GS_TAB);
  var m = gs_readTab_(GS_COLL), g = hasTab ? gs_readTab_(GS_TAB) : [];
  var gemInMeta = m.filter(gs_isGem_).length, metaInGem = g.filter(function(r){ return !gs_isGem_(r); }).length;
  var ids = {}, dup = 0;
  m.concat(g).forEach(function(r){ var id = gs_id_(r); if(ids[id]) dup++; ids[id] = 1; });
  out.push('GEM_SPLIT flag      : ' + (on ? 'CHALU' : 'band'));
  out.push('wrappers laga       : ' + ((_readAll.__ocGem && _upsertMany.__ocGem) ? 'haan' : 'NAHI'));
  out.push('metaLeads tab rows  : ' + m.length + '  (inme Gem: ' + gemInMeta + ')');
  out.push('Gem tab rows        : ' + (hasTab ? g.length : '(tab nahi hai)') + '  (inme Meta: ' + metaInGem + ')');
  out.push('dono me same id     : ' + dup);
  out.push('CRM ko dikhega      : ' + (on ? gs_union_(m, g).length : m.length) + ' leads (Meta + Gem)');
  var s = out.join('\n'); Logger.log(s); return s;
}

/* ------------------------------------------------------------------ move */
function gs_gemPaths_(shM, gem){
  var sc = _schemaOf(shM), used = {}, keep = ['id', 'owner', 'updatedBy', 'updatedAt', 'createdAt', 'source', 'platform'];
  gem.forEach(function(b){
    var mm = _flatten(GS_TAB, b);
    for(var p in mm){ if(Object.prototype.hasOwnProperty.call(mm, p)) used[p] = 1; }
  });
  var out = [], seen = {};
  sc.paths.forEach(function(p){ if(p && !seen[p] && (used[p] || keep.indexOf(p) >= 0)){ seen[p] = 1; out.push(p); } });
  Object.keys(used).forEach(function(p){ if(!seen[p]){ seen[p] = 1; out.push(p); } });
  return out;
}

function gemSplitMigrate(){
  var lk = LockService.getScriptLock(); lk.waitLock(60000);
  var props = PropertiesService.getScriptProperties();
  _GS_DEPTH++; gs_fresh_(1);
  try{
    if(props.getProperty(GS_PROP) === '1'){ _GS_ON = true; return 'Pehle se CHALU hai -- kuch nahi kiya.\n' + gemSplitStatus(); }
    var shM = _sheet(GS_COLL);
    var old = SS.getSheetByName(GS_TAB);
    if(old && old.getLastRow() >= 3) return 'RUKA: "' + GS_TAB + '" tab pehle se maujood hai aur usme data hai. Kuch nahi badla.';

    /* 1. backup */
    var bname = 'bak_metaLeads_gemsplit_' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd_HHmm');
    var cp = shM.copyTo(SS); cp.setName(bname); try{ cp.hideSheet(); }catch(e){}

    /* 2. padho + baanto */
    var all = (_readAll(GS_COLL) || []).map(gs_b_).filter(Boolean);
    var gem = all.filter(gs_isGem_), meta = all.filter(function(b){ return !gs_isGem_(b); });
    if(!gem.length) return 'metaLeads me koi Gem lead nahi mili -- kuch nahi badla. (backup: ' + bname + ')';

    /* 3. Gem tab banao + likho + jaancho (metaLeads abhi tak nahi chhua) */
    var shG = old || SS.insertSheet(GS_TAB);
    _initSheet(shG, GS_TAB, gs_gemPaths_(shM, gem));
    _writeMerged(GS_TAB, shG, gem);
    SpreadsheetApp.flush();
    var badG = gs_diff_(gem, _readAll(GS_TAB) || []);
    if(badG.length){
      try{ SS.deleteSheet(shG); }catch(e){}
      return 'RUKA: Gem tab ki jaanch fail (' + badG.length + ': ' + badG.slice(0, 5).join(', ') + '). metaLeads ko chhua nahi. Backup: ' + bname;
    }

    /* 4. flag CHALU -- ab padhne par dono tab (same id = Gem tab wali) */
    props.setProperty(GS_PROP, '1'); _GS_ON = true;

    /* 5. metaLeads se Gem rows hatao + jaancho */
    _writeMerged(GS_COLL, shM, meta);
    SpreadsheetApp.flush();
    var badM = gs_diff_(meta, _readAll(GS_COLL) || []);
    if(badM.length){
      _writeMerged(GS_COLL, shM, meta.concat(gem));
      SpreadsheetApp.flush();
      props.deleteProperty(GS_PROP); _GS_ON = false;
      return 'RUKA: metaLeads ki jaanch fail (' + badM.length + ': ' + badM.slice(0, 5).join(', ') + ') -> sab wapas metaLeads me, flag band. Backup: ' + bname;
    }
    gs_bump_();
    var msg = 'HO GAYA: ' + gem.length + ' Gem leads -> "' + GS_TAB + '" tab, ' + meta.length + ' Meta leads metaLeads me. Backup tab: ' + bname;
    Logger.log(msg);
    return msg + '\n' + gemSplitStatus();
  } finally {
    gs_fresh_(-1); _GS_DEPTH--;
    lk.releaseLock();
  }
}

/** Wapas pehle jaisa: Gem rows metaLeads me, flag band, Gem tab -> bak_Gem_<time> (chhupa) */
function gemSplitUndo(){
  var lk = LockService.getScriptLock(); lk.waitLock(60000);
  var props = PropertiesService.getScriptProperties();
  _GS_DEPTH++; gs_fresh_(1);
  try{
    var shG = SS.getSheetByName(GS_TAB);
    if(props.getProperty(GS_PROP) !== '1' && !shG) return 'Split chalu hi nahi hai -- kuch nahi kiya.';
    var shM = _sheet(GS_COLL);
    var m = (_readAll(GS_COLL) || []), g = shG ? (_readAll(GS_TAB) || []) : [];
    var all = gs_union_(m, g).map(gs_b_).filter(Boolean);
    _writeMerged(GS_COLL, shM, all);
    SpreadsheetApp.flush();
    var bad = gs_diff_(all, _readAll(GS_COLL) || []);
    if(bad.length) return 'RUKA: metaLeads me wapas likhne ki jaanch fail (' + bad.slice(0, 5).join(', ') + '). Flag CHALU chhoda, Gem tab nahi hataya.';
    props.deleteProperty(GS_PROP); _GS_ON = false;
    if(shG){
      shG.setName('bak_Gem_' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd_HHmm'));
      try{ shG.hideSheet(); }catch(e){}
    }
    gs_bump_();
    var msg = 'WAPAS: ' + all.length + ' leads metaLeads me (Gem ' + all.filter(gs_isGem_).length + '), flag band.';
    Logger.log(msg); return msg;
  } finally {
    gs_fresh_(-1); _GS_DEPTH--;
    lk.releaseLock();
  }
}

/* ------------------------------------------------------------------ test (SIRF COPY par) */
/**
 * Poora end-to-end test. Live spreadsheet par chalne se mana karta hai --
 * database ki COPY (uske saath copy hua Apps Script) me chalaiye.
 */
function gemSplitE2ETest(){
  if(SS.getId() === GS_LIVE_SS_ID) throw new Error('Ye test LIVE database par nahi chalega. Copy par chalaiye.');
  var log = [], pass = 0, fail = 0;
  function ok(c, m){ if(c){ pass++; log.push('PASS  ' + m); } else { fail++; log.push('FAIL  ' + m); } }
  function tab(name){ return gs_readTab_(name); }
  function ids(rows){ var o = {}; rows.forEach(function(r){ o[gs_id_(r)] = 1; }); return o; }
  var props = PropertiesService.getScriptProperties();

  /* pure logic */
  ok(gs_isGem_({ id: 'GEM-AB12CD' }) && gs_isGem_({ id: 'X1', platform: 'Gem ' }) && !gs_isGem_({ id: 'ML-AB12CD', platform: 'ig' }), 'Gem pehchaan (id / platform)');
  ok(gs_isGem_({ id: 'GEM-1', data: { id: 'GEM-1' } }), 'Gem pehchaan {id,data} wrapper');
  var u = gs_union_([{ id: 'A' }, { id: 'GEM-1', v: 'old' }], [{ id: 'GEM-1', v: 'new' }]);
  ok(u.length === 2 && u[1].v === 'new', 'union: same id -> Gem tab wali');

  if(props.getProperty(GS_PROP) === '1') gemSplitUndo();
  _GS_ON = null;
  var before = tab(GS_COLL), bIds = ids(before);
  var nGem = before.filter(gs_isGem_).length, nAll = before.length;
  ok(nGem > 0, 'shuru: metaLeads me ' + nAll + ' rows, Gem ' + nGem);
  var sigBefore = gs_sig_(before);

  /* migrate */
  var r = gemSplitMigrate(); log.push('      ' + r.split('\n')[0]);
  ok(/^HO GAYA/.test(r), 'migrate HO GAYA');
  var m1 = tab(GS_COLL), g1 = tab(GS_TAB);
  ok(m1.length === nAll - nGem && !m1.filter(gs_isGem_).length, 'metaLeads tab me sirf Meta (' + m1.length + ')');
  ok(g1.length === nGem && !g1.filter(function(x){ return !gs_isGem_(x); }).length, 'Gem tab me sirf Gem (' + g1.length + ')');
  var un = _readAll(GS_COLL) || [];
  ok(un.length === nAll, 'CRM ko pehle jitni leads (' + un.length + ')');
  ok(gs_diff_(before, un).length === 0, 'har lead ka har field bilkul wahi (updatedAt bhi)');

  /* Gem edit -> Gem tab */
  var gRec = JSON.parse(JSON.stringify(gs_b_(g1[0]))); gRec.note = 'e2e gem ' + Date.now(); gRec.updatedAt = new Date().toISOString();
  _upsertMany(GS_COLL, [gRec]);
  var g2 = tab(GS_TAB), m2 = tab(GS_COLL);
  ok(gs_b_(g2.filter(function(x){ return gs_id_(x) === gRec.id; })[0]).note === gRec.note, 'Gem edit (saveMany) Gem tab me gaya');
  ok(!ids(m2)[gRec.id], 'Gem edit metaLeads tab me nahi aaya');

  /* Meta edit -> metaLeads tab */
  var mRec = JSON.parse(JSON.stringify(gs_b_(m1[0]))); mRec.note = 'e2e meta ' + Date.now(); mRec.updatedAt = new Date().toISOString();
  _upsertMany(GS_COLL, [mRec]);
  var m3 = tab(GS_COLL), g3 = tab(GS_TAB);
  ok(gs_b_(m3.filter(function(x){ return gs_id_(x) === mRec.id; })[0]).note === mRec.note, 'Meta edit metaLeads tab me gaya');
  ok(!ids(g3)[mRec.id], 'Meta edit Gem tab me nahi aaya');

  /* bada saveMany (FastMode ka poori-sheet raasta) -- 12 records mix */
  var mix = m3.slice(0, 6).concat(g3.slice(0, 6)).map(function(x){ var b = JSON.parse(JSON.stringify(gs_b_(x))); b.e2eTouch = 'mix'; return b; });
  _upsertMany(GS_COLL, mix);
  var m4 = tab(GS_COLL), g4 = tab(GS_TAB);
  ok(m4.length === nAll - nGem && g4.length === nGem, 'bada saveMany (12 mix): ginti sahi');
  ok(m4.filter(function(x){ return gs_b_(x).e2eTouch === 'mix'; }).length === 6 && g4.filter(function(x){ return gs_b_(x).e2eTouch === 'mix'; }).length === 6, 'bada saveMany: 6 + 6 sahi tab me');

  /* single _upsert + naya Gem + delete */
  var nRec = { id: 'GEM-E2E' + Date.now().toString(36).toUpperCase().slice(-5), platform: 'gem', source: 'Gem', full_name: 'E2E Test', phone_number: '9000000001', lead_status: 'CREATED' };
  _upsert(GS_COLL, nRec);
  ok(ids(tab(GS_TAB))[nRec.id] && !ids(tab(GS_COLL))[nRec.id], 'naya Gem (_upsert) Gem tab me');
  _removeMany(GS_COLL, [nRec.id]);
  ok(!ids(tab(GS_TAB))[nRec.id] && !ids(_readAll(GS_COLL))[nRec.id], 'Gem delete (_removeMany) ho gaya');
  var nMeta = { id: 'ML-E2E' + Date.now().toString(36).toUpperCase().slice(-4), platform: 'fb', source: 'Meta', full_name: 'E2E Meta', phone_number: '9000000002', lead_status: 'CREATED' };
  _upsertMany(GS_COLL, [nMeta]);
  ok(ids(tab(GS_COLL))[nMeta.id] && !ids(tab(GS_TAB))[nMeta.id], 'naya Meta metaLeads tab me');
  _remove(GS_COLL, nMeta.id);
  ok(!ids(_readAll(GS_COLL))[nMeta.id], 'Meta delete (_remove) ho gaya');

  /* StaleGuard raasta (web save jaisa) */
  if(typeof SG_WEB_ !== 'undefined' && typeof SG_COLLS !== 'undefined'){
    ok(SG_COLLS.indexOf(GS_TAB) >= 0, 'StaleGuard Gem tab par bhi');
    var cur = gs_b_(tab(GS_TAB)[1]), stale = JSON.parse(JSON.stringify(cur));
    stale.lead_status = 'E2E_STALE'; stale.updatedAt = '2020-01-01T00:00:00.000Z';
    SG_WEB_++; try{ _upsertMany(GS_COLL, [stale]); } finally { SG_WEB_--; }
    ok(gs_b_(tab(GS_TAB).filter(function(x){ return gs_id_(x) === cur.id; })[0]).lead_status === cur.lead_status, 'StaleGuard ne purani Gem copy roki');
  }

  /* undo + dobara */
  var und = gemSplitUndo(); log.push('      ' + und);
  var m5 = tab(GS_COLL);
  ok(/^WAPAS/.test(und) && m5.length === nAll && m5.filter(gs_isGem_).length === nGem && !SS.getSheetByName(GS_TAB), 'undo: sab wapas metaLeads me');
  var r2 = gemSplitMigrate();
  ok(/^HO GAYA/.test(r2), 'dobara migrate HO GAYA');
  var fin = _readAll(GS_COLL) || [], fIds = ids(fin);
  ok(fin.length === nAll && Object.keys(bIds).every(function(k){ return fIds[k]; }), 'aakhir me saari ' + nAll + ' ids maujood');
  void sigBefore;

  log.push('==> ' + pass + ' PASS, ' + fail + ' FAIL');
  var s = log.join('\n'); Logger.log(s); return s;
}
