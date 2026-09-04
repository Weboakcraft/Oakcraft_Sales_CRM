/**
 * final_meta_leads  ->  CRM Meta Leads  (auto sync, har 1 minute)
 * ----------------------------------------------------------------------------
 * Ye file ADDITIVE hai — Code.gs ko bilkul nahi chhua gaya.
 *
 * Kya karta hai
 *   Sheet ke `final_meta_leads` tab me jo bhi NAYA lead aata hai, use apne
 *   aap CRM ke Meta Leads me daal deta hai aur us user ke naam par assign
 *   kar deta hai jo column G (assigned_to) me likha hai.
 *
 *   Column layout (jaisa abhi hai):
 *     A = Timestamp        B = platform      C = full_name
 *     D = phone_number     E = city_state    F = lead_status   G = assigned_to
 *
 * Duplicate check (dono field par)
 *   Kisi bhi lead ko daalne se pehle uska Timestamp (col A) aur Mobile (col D)
 *   CRM ke maujooda Meta Leads se milaya jaata hai.
 *     -> Mobile YA Timestamp me se koi bhi match ho gaya  =>  SKIP.
 *     -> Sirf tab daalta hai jab dono naye hon.
 *   Ek hi run me aayi aapas ki duplicate rows bhi skip hoti hain.
 *
 * Kahan se shuru
 *   Ye record pehle hi sync ho chuka hai, isse aage se shuru hota hai:
 *     04-09-2026 09:45:17 | ig | Arvind Shivhare | 9783895182 | Rajasthan |
 *     CREATED | Ujala Rajput
 *   `installMetaAutoSync` chalane par script isi row ko dhoondh kar pointer
 *   set kar deta hai — isse upar ka kuch bhi dobara import nahi hota.
 *
 * Ek baar ka setup (Apps Script editor me)
 *   1. Ye file paste karein (Code.gs ke saath, alag file).
 *   2. `previewMetaAutoSync` chalayein — kuch likhta nahi, sirf Logs me
 *      dikhata hai ki kaun se leads jaayenge aur kaun se skip honge.
 *   3. Theek lage to `installMetaAutoSync` EK BAAR chalayein — pointer set
 *      ho jayega aur 1-minute ka trigger lag jayega.
 *
 *   Band karna ho:  `removeMetaAutoSync`
 *   Abhi chalana ho: `runMetaAutoSyncNow`
 *   Pointer dubara set karna ho: `resetMetaAutoSyncPointer`
 *
 * SAFETY
 *   - Sirf metaLeads collection me NAYI rows add karta hai. Kisi maujooda
 *     lead ko na badalta hai na hataata hai.
 *   - Agar metaLeads ka storage tab pehchaana na ja sake to kuch nahi likhta,
 *     sirf error log karta hai (fail-safe).
 *   - LockService se do run kabhi ek saath nahi chalte.
 */

var MAS_SRC_ID     = '1rS2cHWuC7bKNC5zzrhbEfdzTX5D6Sp_RbKN5cJDLy6Q';
var MAS_SRC_TAB    = 'final_meta_leads';
var MAS_COLL       = 'metaLeads';
var MAS_MINUTES    = 1;
var MAS_MAX_PER_RUN = 100;         // ek run me itne se zyada nahi (safety)
var MAS_PROP_ROW   = 'mas_lastRow';

/* Yahan tak ka data pehle hi sync ho chuka hai. */
var MAS_START_AFTER_TS    = '04-09-2026 09:45:17';
var MAS_START_AFTER_PHONE = '9783895182';

var MAS_STATUS_STAGE = {
  CREATED:'New', NEW:'New', OPEN:'New', FRESH:'New',
  CONTACTED:'Contacted', FOLLOW_UP:'Contacted', FOLLOWUP:'Contacted', CALLED:'Contacted',
  QUALIFIED:'Qualified', INTERESTED:'Qualified',
  PROPOSAL:'Proposal', QUOTED:'Proposal', QUOTATION:'Proposal',
  WON:'Won', CONVERTED:'Won', CLOSED_WON:'Won',
  LOST:'Lost', CLOSED:'Lost', REJECTED:'Lost', NOT_INTERESTED:'Lost', CLOSED_LOST:'Lost'
};

/* ------------------------------------------------------------------ *
 * chhote helpers                                                      *
 * ------------------------------------------------------------------ */
function mas_str_(v){ return v == null ? '' : String(v); }
function mas_lc_(v){ return mas_str_(v).trim().toLowerCase(); }
function mas_code_(v){ return mas_str_(v).trim().toUpperCase().replace(/\s+/g, '_'); }

/** Timestamp ko ek hi shakal me lao — cell Date ho ya text, dono chalein. */
function mas_ts_(v){
  if(v instanceof Date && !isNaN(v.getTime())){
    return Utilities.formatDate(v, Session.getScriptTimeZone() || 'Asia/Kolkata', 'dd-MM-yyyy HH:mm:ss');
  }
  return mas_str_(v).trim();
}
/** Do timestamps ko compare karne ke liye sirf ank rakho (format ka farak na pade). */
function mas_tsKey_(v){ return mas_ts_(v).replace(/[^0-9]/g, ''); }

/** Phone ka aakhri 10 ank — +91 / 0 / space / dash sab hat jaate hain. */
function mas_phone_(v){
  var d = mas_str_(v).replace(/[^0-9]/g, '');
  if(d.length > 10) d = d.slice(-10);
  return d;
}

function mas_stage_(status){
  var c = mas_code_(status);
  return MAS_STATUS_STAGE[c] || 'New';
}
function mas_id_(){
  return 'ML-' + Utilities.getUuid().replace(/-/g, '').slice(0, 6).toUpperCase();
}

/** CRM ka koi collection padho ({id,data} unwrap karke). */
function mas_read_(collection){
  var rows = [];
  try{
    if(typeof _readAll === 'function') rows = _readAll(collection) || [];
  }catch(e){ Logger.log('mas_read_ ' + collection + ' error: ' + e); }
  return rows.map(function(d){ return (d && d.data !== undefined) ? d.data : d; })
             .filter(function(d){ return d && typeof d === 'object'; });
}

/* ------------------------------------------------------------------ *
 * source tab                                                          *
 * ------------------------------------------------------------------ */
function mas_srcSheet_(){
  var ss = null;
  try{ ss = SpreadsheetApp.openById(MAS_SRC_ID); }
  catch(e){ try{ ss = SpreadsheetApp.getActiveSpreadsheet(); }catch(e2){} }
  if(!ss) throw new Error('Source spreadsheet nahi khul paayi (ID: ' + MAS_SRC_ID + ')');
  var sh = ss.getSheetByName(MAS_SRC_TAB);
  if(!sh) throw new Error('Tab "' + MAS_SRC_TAB + '" nahi mila');
  return sh;
}

/** final_meta_leads ki saari rows (header chhod kar) -> {row, ts, platform, ...} */
function mas_srcRows_(){
  var sh = mas_srcSheet_(), last = sh.getLastRow();
  if(last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, 7).getValues();
  var out = [];
  for(var i = 0; i < vals.length; i++){
    var v = vals[i];
    var ts = mas_ts_(v[0]), ph = mas_phone_(v[3]);
    if(!ts && !ph && !mas_str_(v[2]).trim()) continue;      // khaali row
    out.push({
      row: i + 2,
      ts: ts, tsKey: mas_tsKey_(v[0]),
      platform: mas_str_(v[1]).trim(),
      full_name: mas_str_(v[2]).trim(),
      phone: ph, phoneRaw: mas_str_(v[3]).trim(),
      city_state: mas_str_(v[4]).trim(),
      lead_status: mas_code_(v[5]) || 'CREATED',
      assigned_to: mas_str_(v[6]).trim()
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * target: metaLeads ka storage tab                                    *
 * ------------------------------------------------------------------ */
/**
 * CRM har collection ko ek tab me {id, data(JSON), updatedAt} ki tarah rakhta
 * hai. Tab ka naam / column order guess nahi karte — runtime par dhoondte
 * hain. Na mile to kuch likhte hi nahi.
 */
function mas_targetTab_(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if(!ss) throw new Error('Active spreadsheet nahi mila — ye script CRM ki sheet se bound honi chahiye');

  var want = ['metaleads', 'meta_leads_data', 'meta_leads_store'];
  var sheets = ss.getSheets(), sh = null;
  for(var i = 0; i < sheets.length; i++){
    var nm = mas_lc_(sheets[i].getName()).replace(/\s+/g, '');
    if(want.indexOf(nm) >= 0){ sh = sheets[i]; break; }
  }
  if(!sh) throw new Error('metaLeads ka storage tab nahi mila. Tab ka naam bata dijiye, script me set kar denge.');

  var lastCol = sh.getLastColumn();
  if(lastCol < 2) throw new Error('Tab "' + sh.getName() + '" me expected columns nahi hain');
  var head = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h){ return mas_lc_(h); });
  var iId = head.indexOf('id'), iData = head.indexOf('data');
  if(iId < 0 || iData < 0){
    throw new Error('Tab "' + sh.getName() + '" me "id" / "data" column nahi mila — header: ' + head.join(' | '));
  }
  return { sheet: sh, head: head, cols: lastCol, iId: iId, iData: iData, iUpd: head.indexOf('updatedat') };
}

/* ------------------------------------------------------------------ *
 * roster: assigned_to ka naam -> user ka email                        *
 * ------------------------------------------------------------------ */
function mas_roster_(){
  var byName = {}, byEmail = {};
  mas_read_('users').forEach(function(u){
    var em = mas_lc_(u.email); if(!em) return;
    byEmail[em] = mas_str_(u.name) || em;
    var nm = mas_lc_(u.name);
    if(nm && !byName[nm]) byName[nm] = em;
  });
  return { byName: byName, byEmail: byEmail };
}
function mas_ownerFor_(assignedTo, roster){
  var nm = mas_lc_(assignedTo);
  if(!nm) return '';
  if(roster.byName[nm]) return roster.byName[nm];
  if(nm.indexOf('@') > 0 && roster.byEmail[nm]) return nm;
  /* naam thoda alag likha ho (extra space / half naam) to prefix se match */
  var keys = Object.keys(roster.byName);
  for(var i = 0; i < keys.length; i++){
    if(keys[i].indexOf(nm) === 0 || nm.indexOf(keys[i]) === 0) return roster.byName[keys[i]];
  }
  return '';
}

/* ------------------------------------------------------------------ *
 * pointer (kahan tak sync ho chuka hai)                               *
 * ------------------------------------------------------------------ */
function mas_props_(){ return PropertiesService.getScriptProperties(); }
function mas_getPointer_(){ var v = mas_props_().getProperty(MAS_PROP_ROW); return v ? parseInt(v, 10) || 0 : 0; }
function mas_setPointer_(n){ mas_props_().setProperty(MAS_PROP_ROW, String(n)); }

/** Jo aakhri record pehle se sync hai, uski row dhoondo. */
function mas_findStartRow_(rows){
  var wantTs = mas_tsKey_(MAS_START_AFTER_TS), wantPh = mas_phone_(MAS_START_AFTER_PHONE);
  for(var i = 0; i < rows.length; i++){
    if(rows[i].tsKey === wantTs && rows[i].phone === wantPh) return rows[i].row;
  }
  /* exact row na mile to sirf phone se */
  for(var j = 0; j < rows.length; j++){ if(rows[j].phone === wantPh) return rows[j].row; }
  return 0;
}

/* ------------------------------------------------------------------ *
 * main                                                                *
 * ------------------------------------------------------------------ */
function mas_run_(dryRun){
  var lock = LockService.getScriptLock();
  try{ if(!lock.tryLock(20000)){ Logger.log('MetaAutoSync: pehle wala run chal raha hai, skip.'); return; } }
  catch(e){}

  try{
    var rows = mas_srcRows_();
    if(!rows.length){ Logger.log('MetaAutoSync: ' + MAS_SRC_TAB + ' khaali hai.'); return; }

    var ptr = mas_getPointer_();
    if(!ptr){
      ptr = mas_findStartRow_(rows);
      if(ptr){ Logger.log('MetaAutoSync: pointer row ' + ptr + ' par set hua (Arvind Shivhare wali row).'); }
      else {
        ptr = rows[rows.length - 1].row;
        Logger.log('MetaAutoSync: WARNING — start wali row nahi mili. Safety ke liye pointer aakhri row ('
                   + ptr + ') par set kar diya, purana kuch import nahi hoga.');
      }
      if(!dryRun) mas_setPointer_(ptr);
    }

    /* CRM me pehle se kya hai — phone aur timestamp dono ke set */
    var existing = mas_read_(MAS_COLL);
    var havePhone = {}, haveTs = {};
    existing.forEach(function(l){
      var p = mas_phone_(l.phone_number); if(p) havePhone[p] = 1;
      var t = mas_tsKey_(l.created_time_ist); if(t) haveTs[t] = 1;
    });

    var roster = mas_roster_();
    var fresh = [], skipped = [], noOwner = [];

    for(var i = 0; i < rows.length; i++){
      var r = rows[i];
      if(r.row <= ptr) continue;                                  /* pehle hi ho chuka */
      if(!r.phone && !r.tsKey) continue;                          /* kaam ka nahi */

      /* --- duplicate check: phone YA timestamp match => skip --- */
      if(r.phone && havePhone[r.phone]){ skipped.push(r.row + ': phone ' + r.phone + ' pehle se hai'); continue; }
      if(r.tsKey && haveTs[r.tsKey]){   skipped.push(r.row + ': timestamp ' + r.ts + ' pehle se hai'); continue; }

      var owner = mas_ownerFor_(r.assigned_to, roster);
      if(!owner && r.assigned_to) noOwner.push(r.row + ': "' + r.assigned_to + '" roster me nahi mila');

      fresh.push({
        row: r.row,
        rec: {
          id: mas_id_(),
          created_time_ist: r.ts,
          platform: r.platform,
          full_name: r.full_name,
          phone_number: r.phoneRaw || r.phone,
          city_state: r.city_state,
          lead_status: r.lead_status,
          stage: mas_stage_(r.lead_status),
          assigned_to: r.assigned_to,
          owner: owner,
          createdAt: new Date().toISOString(),
          source: MAS_SRC_TAB
        }
      });

      /* isi run ki aapas ki duplicate rows bhi rok do */
      if(r.phone) havePhone[r.phone] = 1;
      if(r.tsKey) haveTs[r.tsKey] = 1;

      if(fresh.length >= MAS_MAX_PER_RUN) break;
    }

    if(skipped.length) Logger.log('MetaAutoSync: ' + skipped.length + ' duplicate skip —\n  ' + skipped.join('\n  '));
    if(noOwner.length) Logger.log('MetaAutoSync: owner resolve nahi hua —\n  ' + noOwner.join('\n  '));

    if(!fresh.length){ Logger.log('MetaAutoSync: koi naya lead nahi (pointer row ' + ptr + ').'); return; }

    if(dryRun){
      Logger.log('MetaAutoSync (PREVIEW): ' + fresh.length + ' lead jaate —\n  '
        + fresh.map(function(f){
            return 'row ' + f.row + ': ' + f.rec.full_name + ' | ' + f.rec.phone_number
                 + ' | ' + f.rec.created_time_ist + ' -> ' + (f.rec.owner || '(owner nahi mila)');
          }).join('\n  '));
      return;
    }

    /* --- likho --- */
    var t = mas_targetTab_();
    var now = new Date();
    var block = fresh.map(function(f){
      var line = new Array(t.cols);
      for(var c = 0; c < t.cols; c++) line[c] = '';
      line[t.iId]   = f.rec.id;
      line[t.iData] = JSON.stringify(f.rec);
      if(t.iUpd >= 0) line[t.iUpd] = now;
      return line;
    });
    t.sheet.getRange(t.sheet.getLastRow() + 1, 1, block.length, t.cols).setValues(block);
    SpreadsheetApp.flush();

    mas_setPointer_(fresh[fresh.length - 1].row);

    Logger.log('MetaAutoSync: ' + fresh.length + ' naya lead add hua —\n  '
      + fresh.map(function(f){
          return f.rec.full_name + ' | ' + f.rec.phone_number + ' -> ' + (f.rec.owner || '(owner nahi mila)');
        }).join('\n  '));
  }catch(err){
    Logger.log('MetaAutoSync ERROR: ' + err);
  }finally{
    try{ lock.releaseLock(); }catch(e){}
  }
}

/** Trigger yahi chalata hai. */
function metaAutoSyncTick(){ mas_run_(false); }

/** Kuch likhta nahi — sirf Logs me dikhata hai ki kya hota. */
function previewMetaAutoSync(){ mas_run_(true); }

/** Abhi turant chala do. */
function runMetaAutoSyncNow(){ mas_run_(false); }

/* ------------------------------------------------------------------ *
 * setup                                                               *
 * ------------------------------------------------------------------ */
/** EK BAAR chalayein: pointer set + 1-minute ka trigger. */
function installMetaAutoSync(){
  removeMetaAutoSync();
  var rows = mas_srcRows_();
  var start = mas_findStartRow_(rows);
  if(start){
    mas_setPointer_(start);
    Logger.log('MetaAutoSync: pointer row ' + start + ' par set (Arvind Shivhare | 9783895182). '
             + 'Isse upar ka kuch import nahi hoga.');
  } else if(rows.length){
    mas_setPointer_(rows[rows.length - 1].row);
    Logger.log('MetaAutoSync: WARNING — start wali row nahi mili, pointer aakhri row par set kar diya.');
  }
  ScriptApp.newTrigger('metaAutoSyncTick').timeBased().everyMinutes(MAS_MINUTES).create();
  Logger.log('MetaAutoSync: trigger lag gaya (har ' + MAS_MINUTES + ' minute).');
}

/** Trigger hata do. */
function removeMetaAutoSync(){
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function(t){
    if(t.getHandlerFunction() === 'metaAutoSyncTick'){ ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log('MetaAutoSync: ' + n + ' trigger hataye.');
}

/** Pointer dobara Arvind Shivhare wali row par le jao. */
function resetMetaAutoSyncPointer(){
  var rows = mas_srcRows_(), start = mas_findStartRow_(rows);
  if(!start){ Logger.log('MetaAutoSync: start wali row nahi mili.'); return; }
  mas_setPointer_(start);
  Logger.log('MetaAutoSync: pointer wapas row ' + start + ' par set.');
}

/** Abhi ki haalat dekhne ke liye. */
function statusMetaAutoSync(){
  var rows = mas_srcRows_(), ptr = mas_getPointer_();
  var pending = rows.filter(function(r){ return r.row > ptr; }).length;
  var tab = '';
  try{ tab = mas_targetTab_().sheet.getName(); }catch(e){ tab = 'NAHI MILA — ' + e; }
  Logger.log('MetaAutoSync status:\n  source rows : ' + rows.length
           + '\n  pointer row : ' + ptr
           + '\n  pending     : ' + pending
           + '\n  target tab  : ' + tab
           + '\n  CRM leads   : ' + mas_read_(MAS_COLL).length);
}
