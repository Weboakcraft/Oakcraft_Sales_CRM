/**
 * MetaAutoSyncV2 — Meta leads -> CRM metaLeads, tracked by Meta Lead ID (21-10-2026)
 * ----------------------------------------------------------------------------
 * Replaces the 1-minute import done by MetaAutoSync.gs (metaAutoSyncTick) for
 * NEW leads only. Existing CRM leads are never read for change, never updated,
 * never reassigned. Additive file: Code.gs and the old MetaAutoSync.gs are not
 * edited.
 *
 * Why a new version (audit of 21-10-2026)
 *   - final_meta_leads / Combined rows are a SORT of four tabs. Column S of
 *     Combined (assigned_to) is typed names up to row 618 and, from S619 down,
 *     a formula that gives Amira / Mayank / Ujala by ROW POSITION. When any
 *     row is inserted or the sort order changes, the name on every row below
 *     changes.
 *   - The old import tracked progress with column H ("Sync Status") cells and
 *     a row pointer. Those cells stay on their row while the leads move, so a
 *     late (backfilled) lead could sit next to an old "Sync_Done_CRM" and be
 *     skipped for ever (24 leads of 10-12 Oct 2026).
 *
 * What this version does
 *   1. Reads the source tab `Combined` (same rows final_meta_leads shows, plus
 *      the Meta Lead ID in column `id`). Columns are found by header name.
 *   2. Every lead is identified by its Meta Lead ID (e.g. l:2303706027082689).
 *      If a row has no ID, the key is phone + lead time.
 *   3. Sync tracking = the `MetaSync_Ledger` tab in the CRM spreadsheet: one
 *      row per Lead ID (status, CRM id, salesperson, phone, time ...). A lead
 *      whose ID is in the ledger is never imported again, wherever its row
 *      moves. Row numbers and column H are not used.
 *   4. Salesperson = the assigned_to value on that lead's own source row, read
 *      the first time the Lead ID is seen, copied exactly (outer spaces
 *      trimmed). Owner email = exact name match in CRM users (no partial /
 *      prefix matching). If the name is not a CRM user, the lead is still
 *      imported with that name and an empty owner, and the ledger says so.
 *   5. Same Lead ID more than once in the source (the Sheet4 connector writes
 *      some leads twice): imported once, from the FIRST copy (top-most row);
 *      the ledger note lists every copy and its name.
 *   6. A different Lead ID with a phone that is already in the CRM is not
 *      imported (same rule as before: repeat lead). Ledger: SKIPPED_REPEAT_PHONE.
 *      Rows without a 10-digit phone (Meta test leads) are not imported.
 *   7. After writing, the new CRM records are read back and compared field by
 *      field with the source values (salesperson, owner, name, phone, time,
 *      platform, city). Any difference -> ledger status IMPORTED_CHECK_FAILED.
 *   8. The script lock is taken only when there is a Lead ID not yet in the
 *      ledger (same idea as LockLight), so CRM saves are not kept waiting.
 *   9. Source sheet is only READ (no more writes to column H), so the source
 *      sheet is not modified by the import any more. Set MAS2.WRITE_SOURCE_STATUS
 *      only if you want the old column-H marks back (not recommended).
 *
 * One-time setup (Apps Script editor, project Web_Sales_CRM)
 *   1. mas2_selfTest      -> logic test in memory (writes nothing)
 *   2. mas2_e2eTest       -> full test on temporary zz_ tabs, deleted afterwards
 *   3. mas2_preview       -> what the next run would do on the live data
 *   4. mas2_install       -> creates the ledger, records every lead that exists
 *                            today as BASELINE (never imported by V2), removes
 *                            the old metaAutoSyncTick trigger and adds mas2Tick
 *                            (every minute).
 *   Status any time: mas2_status.   Stop: mas2_uninstall.
 */

var MAS2 = {
  SRC_ID: '1rS2cHWuC7bKNC5zzrhbEfdzTX5D6Sp_RbKN5cJDLy6Q',   /* meta_ads_enquiry */
  SRC_TAB: 'Combined',
  COLL: 'metaLeads',
  LEDGER_TAB: 'MetaSync_Ledger',
  SOURCE_LABEL: 'final_meta_leads',   /* record.source -- same value as before, so CRM filters and dashboards treat new leads the same */
  MAX_PER_RUN: 100,
  MINUTES: 1,
  LOCK_WAIT_MS: 20000,
  WRITE_SOURCE_STATUS: false
};

var MAS2_STAGE = {
  CREATED:'New', NEW:'New', OPEN:'New', FRESH:'New',
  CONTACTED:'Contacted', FOLLOW_UP:'Contacted', FOLLOWUP:'Contacted', CALLED:'Contacted',
  QUALIFIED:'Qualified', INTERESTED:'Qualified',
  SYSTEM_MASTER:'System Master', SYSTEMMASTER:'System Master',
  QUOTATION_SENT:'Quotation Sent', QUOTATIONSENT:'Quotation Sent',
  PROPOSAL:'Proposal', QUOTED:'Proposal', QUOTATION:'Proposal',
  WON:'Won', CONVERTED:'Won', CLOSED_WON:'Won',
  LOST:'Lost', CLOSED:'Lost', REJECTED:'Lost', NOT_INTERESTED:'Lost', CLOSED_LOST:'Lost'
};

var MAS2_LEDGER_HEAD = ['lead_id', 'status', 'crm_id', 'assigned_to', 'owner', 'phone', 'created_time_ist',
                        'full_name', 'source_tab', 'source_row', 'copies_in_source', 'note', 'logged_at'];

/* ======================================================================== *
 * Pure logic (no Google services) -- tested by mas2_selfTest and locally    *
 * ======================================================================== */
function mas2_str_(v){ return v == null ? '' : String(v); }
function mas2_trim_(v){ return mas2_str_(v).replace(/^\s+|\s+$/g, ''); }
function mas2_nameKey_(v){ return mas2_trim_(v).toLowerCase().replace(/\s+/g, ' '); }
function mas2_code_(v){ return mas2_trim_(v).toUpperCase().replace(/\s+/g, '_'); }
function mas2_phone10_(v){ var d = mas2_str_(v).replace(/\D/g, ''); return d.length > 10 ? d.slice(-10) : d; }
function mas2_digits_(v){ return mas2_str_(v).replace(/\D/g, ''); }
function mas2_stage_(status){ return MAS2_STAGE[mas2_code_(status)] || 'New'; }

/**
 * Source display values (2D, header in row 1) -> lead rows.
 * Same filter as final_meta_leads (full_name not blank).
 */
function mas2_parseSource_(values){
  var out = { rows: [], missing: [] };
  if(!values || !values.length) return out;
  var head = values[0].map(function(h){ return mas2_trim_(h).toLowerCase(); });
  var col = function(name){ return head.indexOf(name); };
  var c = {
    tab: col('source_sheet'), id: col('id'), ts: col('created_time_ist'), platform: col('platform'),
    name: col('full_name'), phone: col('phone_number'), city: col('city_state'),
    status: col('lead_status'), assigned: col('assigned_to')
  };
  ['id', 'ts', 'name', 'phone', 'assigned'].forEach(function(k){ if(c[k] < 0) out.missing.push(k); });
  if(out.missing.length) return out;
  var get = function(r, i){ return i < 0 ? '' : mas2_str_(r[i]); };
  for(var i = 1; i < values.length; i++){
    var r = values[i];
    var name = mas2_trim_(get(r, c.name));
    if(!name) continue;                                   /* same rule as the final_meta_leads FILTER */
    var phoneRaw = mas2_trim_(get(r, c.phone));
    var p10 = mas2_phone10_(phoneRaw);
    var ts = mas2_trim_(get(r, c.ts));
    var id = mas2_trim_(get(r, c.id));
    out.rows.push({
      row: i + 1,
      leadId: id || ('nokey:' + p10 + '|' + mas2_digits_(ts)),
      key: p10 + '|' + mas2_digits_(ts),
      ts: ts,
      platform: mas2_trim_(get(r, c.platform)),
      full_name: name,
      phoneRaw: phoneRaw,
      phone10: p10,
      city_state: mas2_trim_(get(r, c.city)),
      lead_status: mas2_code_(get(r, c.status)) || 'CREATED',
      assigned_to: mas2_trim_(get(r, c.assigned)),
      source_tab: mas2_trim_(get(r, c.tab))
    });
  }
  return out;
}

/** CRM records (plain objects) -> lookup by phone and by phone+time (Gem leads excluded, as in the Meta section). */
function mas2_crmIndex_(records){
  var idx = { byPhone: {}, byKey: {}, byId: {} };
  (records || []).forEach(function(l){
    if(!l || typeof l !== 'object') return;
    if(l.id) idx.byId[l.id] = l;
    if(String(l.platform || '').toLowerCase() === 'gem') return;
    var p = mas2_phone10_(l.phone_number || l.phone);
    if(!p) return;
    if(!idx.byPhone[p]) idx.byPhone[p] = l.id;
    var k = p + '|' + mas2_digits_(l.created_time_ist);
    if(!idx.byKey[k]) idx.byKey[k] = l.id;
  });
  return idx;
}

/** CRM users -> exact (case/space-insensitive) name -> email. Ambiguous names map to ''. */
function mas2_roster_(users){
  var map = {};
  (users || []).forEach(function(u){
    if(!u) return;
    var em = mas2_trim_(u.email).toLowerCase();
    var nk = mas2_nameKey_(u.name);
    if(!em || !nk) return;
    if(map[nk] === undefined) map[nk] = em;
    else if(map[nk] !== em) map[nk] = '';                 /* two users with the same name -> no guess */
  });
  return map;
}

/**
 * Decide what to do with every Lead ID that is not in the ledger yet.
 *   rows    : mas2_parseSource_().rows (sheet order)
 *   ledger  : { leadId: true, ... }
 *   crm     : mas2_crmIndex_()
 *   roster  : mas2_roster_()
 *   opts    : { now: ISO string, newId: function(){...}, max: n }
 */
function mas2_plan_(rows, ledger, crm, roster, opts){
  opts = opts || {};
  var max = opts.max || MAS2.MAX_PER_RUN;
  var groups = {}, order = [], lastKnownRow = 0;
  rows.forEach(function(r){
    if(ledger[r.leadId]){ if(r.row > lastKnownRow) lastKnownRow = r.row; return; }
    if(!groups[r.leadId]){ groups[r.leadId] = []; order.push(r.leadId); }
    groups[r.leadId].push(r);
  });
  var plan = { imports: [], ledgerOnly: [], pending: 0 };
  var seenPhone = {};
  for(var i = 0; i < order.length; i++){
    var g = groups[order[i]], r = g[0];                    /* first copy = top-most row */
    var copiesNote = '';
    if(g.length > 1){
      copiesNote = g.length + ' copies in source: ' + g.map(function(x){ return (x.assigned_to || '(blank)') + ' (row ' + x.row + ')'; }).join(', ') + '; first copy used';
    }
    var base = { leadId: r.leadId, row: r.row, copies: g.length, src: r };
    if(r.phone10.length < 10){
      plan.ledgerOnly.push(mas2_merge_(base, { status: 'SKIPPED_NO_VALID_PHONE', crmId: '', note: 'no 10-digit phone (Meta test lead?)' + (copiesNote ? '; ' + copiesNote : '') }));
      continue;
    }
    if(crm.byKey[r.key]){
      plan.ledgerOnly.push(mas2_merge_(base, { status: 'ALREADY_IN_CRM', crmId: crm.byKey[r.key], note: 'same phone + time already in CRM' + (copiesNote ? '; ' + copiesNote : '') }));
      continue;
    }
    if(crm.byPhone[r.phone10] || seenPhone[r.phone10]){
      plan.ledgerOnly.push(mas2_merge_(base, { status: 'SKIPPED_REPEAT_PHONE', crmId: crm.byPhone[r.phone10] || seenPhone[r.phone10], note: 'phone already in CRM (repeat lead)' + (copiesNote ? '; ' + copiesNote : '') }));
      continue;
    }
    if(plan.imports.length >= max){ plan.pending++; continue; }
    var nk = mas2_nameKey_(r.assigned_to);
    var owner = nk && roster[nk] ? roster[nk] : '';
    var notes = [];
    if(!r.assigned_to) notes.push('no salesperson in source');
    else if(!owner) notes.push(roster[nk] === '' ? 'salesperson name matches more than one CRM user' : 'salesperson not found in CRM users');
    if(lastKnownRow && r.row < lastKnownRow) notes.push('arrived above already-synced rows (late/backfilled lead)');
    if(copiesNote) notes.push(copiesNote);
    var rec = {
      id: opts.newId ? opts.newId() : mas2_newId_(),
      created_time_ist: r.ts,
      platform: r.platform,
      full_name: r.full_name,
      phone_number: r.phoneRaw || r.phone10,
      city_state: r.city_state,
      lead_status: r.lead_status,
      stage: mas2_stage_(r.lead_status),
      assigned_to: r.assigned_to,
      owner: owner,
      createdAt: opts.now || new Date().toISOString(),
      source: MAS2.SOURCE_LABEL,
      meta_lead_id: r.leadId
    };
    seenPhone[r.phone10] = rec.id;
    plan.imports.push(mas2_merge_(base, { status: 'IMPORTED', crmId: rec.id, rec: rec, note: notes.join('; ') }));
  }
  return plan;
}
function mas2_merge_(a, b){ var o = {}, k; for(k in a) o[k] = a[k]; for(k in b) o[k] = b[k]; return o; }
function mas2_newId_(){
  var u = (typeof Utilities !== 'undefined') ? Utilities.getUuid() : (Math.random().toString(16).slice(2) + Date.now().toString(16));
  return 'ML-' + u.replace(/-/g, '').slice(0, 6).toUpperCase();
}

/** Compare what was written with what was intended. Returns list of differing field names. */
function mas2_diff_(want, got){
  if(!got) return ['record not found after write'];
  var bad = [];
  ['assigned_to', 'owner', 'full_name', 'phone_number', 'created_time_ist', 'platform', 'city_state', 'meta_lead_id'].forEach(function(f){
    var w = mas2_cell_(want[f]), g = mas2_cell_(got[f]);
    /* the sheet may store a time or a phone as a date / number; compare those by their digits */
    if(w !== g && (f === 'created_time_ist' || f === 'phone_number') && mas2_digits_(w) === mas2_digits_(g)) return;
    if(w !== g) bad.push(f + ' (want "' + w + '", got "' + g + '")');
  });
  return bad;
}
function mas2_cell_(v){
  if(v instanceof Date && typeof Utilities !== 'undefined'){
    return Utilities.formatDate(v, Session.getScriptTimeZone() || 'Asia/Kolkata', 'dd-MM-yyyy HH:mm:ss');
  }
  return mas2_str_(v);
}

function mas2_ledgerRow_(p, now){
  var s = p.src || {};
  return [p.leadId, p.status, p.crmId || '', s.assigned_to || '', (p.rec && p.rec.owner) || '', s.phoneRaw || '',
          s.ts || '', s.full_name || '', s.source_tab || '', String(p.row || ''), String(p.copies || 1), p.note || '', now];
}

/* ======================================================================== *
 * Google services                                                          *
 * ======================================================================== */
function mas2_ss_(){ return SpreadsheetApp.getActiveSpreadsheet(); }

/** Display values of the source tab, only down to the last row that has a Lead ID or a name. */
function mas2_srcValues_(sheetOverride){
  var sh = sheetOverride || SpreadsheetApp.openById(MAS2.SRC_ID).getSheetByName(MAS2.SRC_TAB);
  if(!sh) throw new Error('Source tab "' + MAS2.SRC_TAB + '" not found');
  var last = sh.getLastRow(), lastCol = sh.getLastColumn();
  if(last < 2) return [];
  var head = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(function(h){ return mas2_trim_(h).toLowerCase(); });
  var idCol = head.indexOf('id') + 1, nameCol = head.indexOf('full_name') + 1;
  /* The assigned_to formula fills "" down to the end of the grid, so getLastRow() can be the grid end.
     Find the real last data row from the id and full_name columns first. */
  var realLast = 1;
  [idCol, nameCol].forEach(function(cn){
    if(cn < 1) return;
    var v = sh.getRange(1, cn, last, 1).getDisplayValues();
    for(var i = v.length - 1; i > 0; i--){ if(mas2_trim_(v[i][0])){ if(i + 1 > realLast) realLast = i + 1; break; } }
  });
  return sh.getRange(1, 1, realLast, lastCol).getDisplayValues();
}

function mas2_ledgerSheet_(tabName, create){
  var ss = mas2_ss_(), name = tabName || MAS2.LEDGER_TAB;
  var sh = ss.getSheetByName(name);
  if(!sh && create){
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, sh.getMaxRows(), MAS2_LEDGER_HEAD.length).setNumberFormat('@');   /* keep IDs and phones as text */
    sh.getRange(1, 1, 1, MAS2_LEDGER_HEAD.length).setValues([MAS2_LEDGER_HEAD]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}
function mas2_ledgerIds_(sh){
  var ids = {};
  if(!sh) return ids;
  var last = sh.getLastRow();
  if(last < 2) return ids;
  sh.getRange(2, 1, last - 1, 1).getDisplayValues().forEach(function(r){ var k = mas2_trim_(r[0]); if(k) ids[k] = true; });
  return ids;
}
function mas2_appendLedger_(sh, rows){
  if(!rows.length) return;
  var start = sh.getLastRow() + 1;
  if(start + rows.length - 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), rows.length + 100);
  var rg = sh.getRange(start, 1, rows.length, MAS2_LEDGER_HEAD.length);
  rg.setNumberFormat('@');
  rg.setValues(rows);
}

function mas2_readColl_(name){
  var rows = [];
  if(typeof _readAll !== 'function') throw new Error('Code.gs _readAll not found -- this file must be in the CRM Apps Script project.');
  rows = _readAll(name) || [];
  return rows.map(function(d){ return (d && d.data !== undefined) ? d.data : d; }).filter(function(d){ return d && typeof d === 'object'; });
}
function mas2_write_(coll, recs){
  if(!recs.length) return 0;
  var payload = recs.map(function(r){ return { id: r.id, data: r }; });
  if(typeof _upsertMany === 'function'){ _upsertMany(coll, payload); return payload.length; }
  throw new Error('Code.gs _upsertMany not found -- nothing written.');
}

/**
 * One sync run.
 *   o.dryRun       log the plan, write nothing
 *   o.srcSheet     source tab override (tests)
 *   o.coll         destination collection override (tests)
 *   o.ledgerTab    ledger tab override (tests)
 *   o.max          max imports in this run
 * Returns a summary object.
 */
function mas2_run_(o){
  o = o || {};
  var coll = o.coll || MAS2.COLL, ledgerTab = o.ledgerTab || MAS2.LEDGER_TAB;
  var res = { newIds: 0, imported: 0, ledgerOnly: 0, checkFailed: 0, pending: 0, dryRun: !!o.dryRun, log: [] };

  /* ---- 1. quick check WITHOUT the lock ---- */
  var ledgerSh = mas2_ledgerSheet_(ledgerTab, false);
  if(!ledgerSh){ res.log.push('Ledger tab "' + ledgerTab + '" missing -- run mas2_install first.'); Logger.log(res.log.join('\n')); return res; }
  var src = mas2_parseSource_(mas2_srcValues_(o.srcSheet));
  if(src.missing.length) throw new Error('Source columns missing: ' + src.missing.join(', '));
  var ledger = mas2_ledgerIds_(ledgerSh);
  var fresh = src.rows.filter(function(r){ return !ledger[r.leadId]; });
  res.newIds = Object.keys(fresh.reduce(function(a, r){ a[r.leadId] = 1; return a; }, {})).length;
  if(!res.newIds){ return res; }                           /* nothing new -> no lock, no CRM read */

  /* ---- 2. real work under the script lock ---- */
  var lock = LockService.getScriptLock();
  if(!lock.tryLock(MAS2.LOCK_WAIT_MS)){ res.log.push('Another run holds the lock; will retry next minute.'); Logger.log(res.log.join('\n')); return res; }
  try{
    ledger = mas2_ledgerIds_(ledgerSh);                    /* re-read inside the lock */
    var crm = mas2_crmIndex_(mas2_readColl_(coll));
    var roster = mas2_roster_(mas2_readColl_('users'));
    var plan = mas2_plan_(src.rows, ledger, crm, roster, { max: o.max || MAS2.MAX_PER_RUN });
    res.pending = plan.pending;
    var now = new Date().toISOString();

    if(o.dryRun){
      plan.imports.forEach(function(p){ res.log.push('WOULD IMPORT ' + p.leadId + ' row ' + p.row + ' | ' + p.rec.full_name + ' | ' + p.rec.phone_number + ' | ' + p.rec.created_time_ist + ' | salesperson "' + p.rec.assigned_to + '" -> ' + (p.rec.owner || '(no owner)') + (p.note ? ' | ' + p.note : '')); });
      plan.ledgerOnly.forEach(function(p){ res.log.push('WOULD LOG   ' + p.leadId + ' row ' + p.row + ' ' + p.status + ' ' + (p.crmId || '') + ' | ' + p.note); });
      res.imported = plan.imports.length; res.ledgerOnly = plan.ledgerOnly.length;
      Logger.log('mas2 PREVIEW: ' + JSON.stringify({ newIds: res.newIds, wouldImport: res.imported, wouldLogOnly: res.ledgerOnly, pending: res.pending }) + '\n' + res.log.join('\n'));
      return res;
    }

    var ledgerRows = [];
    if(plan.imports.length){
      mas2_write_(coll, plan.imports.map(function(p){ return p.rec; }));
      SpreadsheetApp.flush();
      /* ---- 3. read back and compare with the source values ---- */
      var back = mas2_crmIndex_(mas2_readColl_(coll)).byId;
      plan.imports.forEach(function(p){
        var bad = mas2_diff_(p.rec, back[p.rec.id]);
        if(bad.length){ p.status = 'IMPORTED_CHECK_FAILED'; p.note = (p.note ? p.note + '; ' : '') + 'check: ' + bad.join(', '); res.checkFailed++; }
        ledgerRows.push(mas2_ledgerRow_(p, now));
      });
    }
    plan.ledgerOnly.forEach(function(p){ ledgerRows.push(mas2_ledgerRow_(p, now)); });
    mas2_appendLedger_(ledgerSh, ledgerRows);              /* only after the CRM write succeeded */
    res.imported = plan.imports.length; res.ledgerOnly = plan.ledgerOnly.length;
    plan.imports.forEach(function(p){ res.log.push(p.status + ' ' + p.leadId + ' -> ' + p.rec.id + ' | ' + p.rec.full_name + ' | salesperson "' + p.rec.assigned_to + '" -> ' + (p.rec.owner || '(no owner)') + (p.note ? ' | ' + p.note : '')); });
    plan.ledgerOnly.forEach(function(p){ res.log.push(p.status + ' ' + p.leadId + ' ' + (p.crmId || '') + ' | ' + p.note); });
    Logger.log('mas2 run: ' + JSON.stringify({ newIds: res.newIds, imported: res.imported, logOnly: res.ledgerOnly, checkFailed: res.checkFailed, pending: res.pending }) + '\n' + res.log.join('\n'));
    return res;
  } finally {
    try{ lock.releaseLock(); }catch(e){}
  }
}

/* ======================================================================== *
 * Entry points                                                             *
 * ======================================================================== */
/** Trigger handler (every minute). */
function mas2Tick(){ try{ mas2_run_({}); }catch(e){ Logger.log('mas2Tick ERROR: ' + (e && e.stack ? e.stack : e)); } }
/** Shows what the next run would do. Writes nothing. */
function mas2_preview(){ return mas2_run_({ dryRun: true }); }
/** Run now. */
function mas2_runNow(){ return mas2_run_({}); }

/**
 * ONE TIME: create the ledger, record every lead that exists today as BASELINE
 * (V2 never imports or changes those), switch the trigger to mas2Tick.
 */
function mas2_install(){
  var sh = mas2_ledgerSheet_(MAS2.LEDGER_TAB, true);
  var log = [];
  if(sh.getLastRow() < 2){
    var src = mas2_parseSource_(mas2_srcValues_());
    if(src.missing.length) throw new Error('Source columns missing: ' + src.missing.join(', '));
    var crm = mas2_crmIndex_(mas2_readColl_(MAS2.COLL));
    var groups = {}, order = [];
    src.rows.forEach(function(r){ if(!groups[r.leadId]){ groups[r.leadId] = []; order.push(r.leadId); } groups[r.leadId].push(r); });
    var now = new Date().toISOString();
    var rows = order.map(function(id){
      var g = groups[id], r = g[0];
      var crmId = crm.byKey[r.key] || crm.byPhone[r.phone10] || '';
      return mas2_ledgerRow_({ leadId: id, status: 'BASELINE', crmId: crmId, src: r, row: r.row, copies: g.length,
        note: 'lead existed before V2 cutover; not imported or changed by V2' + (crmId ? '' : ' (no CRM record with this phone)') }, now);
    });
    mas2_appendLedger_(sh, rows);
    log.push('Ledger created with ' + rows.length + ' BASELINE Lead IDs (from ' + src.rows.length + ' source rows).');
  } else {
    log.push('Ledger already has ' + (sh.getLastRow() - 1) + ' rows -- baseline not repeated.');
  }
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function(t){
    var f = t.getHandlerFunction();
    if(f === 'metaAutoSyncTick' || f === 'mas2Tick'){ ScriptApp.deleteTrigger(t); removed++; }
  });
  ScriptApp.newTrigger('mas2Tick').timeBased().everyMinutes(MAS2.MINUTES).create();
  log.push('Triggers removed: ' + removed + ' (metaAutoSyncTick / old mas2Tick). New trigger: mas2Tick every ' + MAS2.MINUTES + ' min.');
  Logger.log('mas2_install:\n  ' + log.join('\n  '));
  return log;
}

/** Stop V2 (removes its trigger). To go back to the old import, create a trigger for metaAutoSyncTick again. */
function mas2_uninstall(){
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function(t){ if(t.getHandlerFunction() === 'mas2Tick'){ ScriptApp.deleteTrigger(t); n++; } });
  Logger.log('mas2_uninstall: removed ' + n + ' trigger(s).');
  return n;
}

function mas2_status(){
  var sh = mas2_ledgerSheet_(MAS2.LEDGER_TAB, false);
  var counts = {};
  if(sh && sh.getLastRow() > 1){
    sh.getRange(2, 2, sh.getLastRow() - 1, 1).getDisplayValues().forEach(function(r){ counts[r[0]] = (counts[r[0]] || 0) + 1; });
  }
  var trig = ScriptApp.getProjectTriggers().map(function(t){ return t.getHandlerFunction(); })
    .filter(function(f){ return f === 'mas2Tick' || f === 'metaAutoSyncTick'; });
  var src = mas2_parseSource_(mas2_srcValues_());
  var ledger = mas2_ledgerIds_(sh);
  var waiting = {}; src.rows.forEach(function(r){ if(!ledger[r.leadId]) waiting[r.leadId] = 1; });
  var s = { ledgerTab: !!sh, ledgerByStatus: counts, sourceRows: src.rows.length, leadIdsNotInLedger: Object.keys(waiting).length, triggers: trig };
  Logger.log('mas2_status: ' + JSON.stringify(s));
  return s;
}

/* ======================================================================== *
 * Tests                                                                    *
 * ======================================================================== */
/** Logic test in memory. Writes nothing. */
function mas2_selfTest(){ var r = mas2_logicTests_(); Logger.log(r.join('\n')); return r; }

function mas2_logicTests_(){
  var out = [], fails = 0;
  function ok(cond, msg){ out.push((cond ? 'PASS ' : 'FAIL ') + msg); if(!cond) fails++; }
  var H = ['source_sheet', 'id', 'created_time_ist', 'platform', 'full_name', 'phone_number', 'city_state', 'lead_status', 'assigned_to'];
  var users = [{ name: 'Amira Saikh', email: 'a@x' }, { name: 'Mayank Mittal', email: 'm@x' }, { name: 'Ujala Rajput', email: 'u@x' }, { name: 'Ujala', email: 'other@x' }];
  var roster = mas2_roster_(users);
  var n = 0, newId = function(){ n++; return 'ML-T' + ('0000' + n).slice(-5); };

  /* run 1: two new leads, one duplicated with a different name on the 2nd copy, one test lead, one repeat phone */
  var v1 = [H,
    ['Sheet4', 'l:1', '20-10-2026 10:00:00', 'ig', 'Lead One', '9000000001', 'UP', 'CREATED', 'Amira Saikh'],
    ['Sheet4', 'l:2', '20-10-2026 10:05:00', 'fb', 'Lead Two', '9000000002', '', 'CREATED', 'Mayank Mittal'],
    ['Sheet4', 'l:2', '20-10-2026 10:05:00', 'fb', 'Lead Two', '9000000002', '', 'CREATED', 'Ujala Rajput'],
    ['Sheet4', 'l:3', '20-10-2026 10:06:00', '', '<test lead>', '<test lead: dummy data for phone>', '', 'CREATED', 'Amira Saikh'],
    ['Sheet4', 'l:4', '20-10-2026 10:07:00', 'ig', 'Repeat Person', '+91 98765 43210', 'MP', 'CREATED', 'Ujala Rajput'],
    ['Sheet4', 'l:5', '20-10-2026 10:08:00', 'ig', 'Unknown Rep', '9000000005', 'MP', 'CREATED', 'Pinky']];
  var crmRecords = [{ id: 'ML-OLD001', phone_number: '9876543210', created_time_ist: '01-10-2026 09:00:00', platform: 'ig', assigned_to: 'Amira Saikh', owner: 'a@x' }];
  var ledger = {};
  var p1 = mas2_plan_(mas2_parseSource_(v1).rows, ledger, mas2_crmIndex_(crmRecords), roster, { newId: newId, now: 'T1' });
  var imp = {}; p1.imports.forEach(function(p){ imp[p.leadId] = p; });
  var lo = {}; p1.ledgerOnly.forEach(function(p){ lo[p.leadId] = p; });
  ok(p1.imports.length === 3, 'run 1 imports 3 leads (l:1, l:2 once, l:5)');
  ok(imp['l:1'] && imp['l:1'].rec.assigned_to === 'Amira Saikh' && imp['l:1'].rec.owner === 'a@x', 'l:1 salesperson = source name on its own row, owner by exact name');
  ok(imp['l:2'] && imp['l:2'].rec.assigned_to === 'Mayank Mittal' && /2 copies/.test(imp['l:2'].note), 'l:2 duplicated in source -> imported once from first copy, both copies noted');
  ok(lo['l:3'] && lo['l:3'].status === 'SKIPPED_NO_VALID_PHONE', 'test lead without phone not imported');
  ok(lo['l:4'] && lo['l:4'].status === 'SKIPPED_REPEAT_PHONE' && lo['l:4'].crmId === 'ML-OLD001', 'repeat phone not imported, linked to existing CRM record');
  ok(imp['l:5'] && imp['l:5'].rec.assigned_to === 'Pinky' && imp['l:5'].rec.owner === '' && /not found/.test(imp['l:5'].note), 'name not in CRM users: kept exactly, no owner guessed');
  ok(mas2_roster_([{ name: 'Ujala', email: 'x@x' }, { name: 'Ujala Rajput', email: 'u@x' }])['ujala'] === 'x@x', 'no prefix matching: "Ujala" only matches a user named exactly "Ujala"');
  ok(imp['l:1'].rec.source === MAS2.SOURCE_LABEL && imp['l:1'].rec.meta_lead_id === 'l:1' && imp['l:1'].rec.stage === 'New', 'record shape: source label, meta_lead_id, stage');

  /* write run 1 into fake CRM + ledger */
  p1.imports.forEach(function(p){ crmRecords.push(p.rec); ledger[p.leadId] = true; });
  p1.ledgerOnly.forEach(function(p){ ledger[p.leadId] = true; });

  /* run 2: a late lead is inserted at the TOP, the sheet re-sorts and the row-based names move;
     the 2nd copy of l:2 is still there; one new lead at the bottom */
  var v2 = [H,
    ['Sheet4', 'l:9', '19-10-2026 08:00:00', 'fb', 'Late Lead', '9000000009', '', 'CREATED', 'Ujala Rajput'],
    ['Sheet4', 'l:1', '20-10-2026 10:00:00', 'ig', 'Lead One', '9000000001', 'UP', 'CREATED', 'Mayank Mittal'],
    ['Sheet4', 'l:2', '20-10-2026 10:05:00', 'fb', 'Lead Two', '9000000002', '', 'CREATED', 'Ujala Rajput'],
    ['Sheet4', 'l:2', '20-10-2026 10:05:00', 'fb', 'Lead Two', '9000000002', '', 'CREATED', 'Amira Saikh'],
    ['Sheet4', 'l:3', '20-10-2026 10:06:00', '', '<test lead>', '<test lead: dummy data for phone>', '', 'CREATED', 'Mayank Mittal'],
    ['Sheet4', 'l:4', '20-10-2026 10:07:00', 'ig', 'Repeat Person', '+91 98765 43210', 'MP', 'CREATED', 'Ujala Rajput'],
    ['Sheet4', 'l:5', '20-10-2026 10:08:00', 'ig', 'Unknown Rep', '9000000005', 'MP', 'CREATED', 'Amira Saikh'],
    ['Sheet4', 'l:6', '20-10-2026 11:00:00', 'ig', 'New Bottom', '9000000006', 'DL', 'CREATED', 'Mayank Mittal']];
  var before = JSON.stringify(crmRecords);
  var p2 = mas2_plan_(mas2_parseSource_(v2).rows, ledger, mas2_crmIndex_(crmRecords), roster, { newId: newId, now: 'T2' });
  var imp2 = {}; p2.imports.forEach(function(p){ imp2[p.leadId] = p; });
  ok(p2.imports.length === 2 && imp2['l:9'] && imp2['l:6'], 'run 2 imports only the 2 new Lead IDs (late lead + new bottom lead), nothing skipped');
  ok(imp2['l:9'].rec.assigned_to === 'Ujala Rajput' && /late\/backfilled/.test(imp2['l:9'].note), 'late lead: name from its own row, flagged as arrived above synced rows');
  ok(imp2['l:6'].rec.assigned_to === 'Mayank Mittal', 'new bottom lead: name from its own row');
  ok(p2.ledgerOnly.length === 0, 'already-synced Lead IDs (incl. 2nd copy of l:2) are not touched again');
  ok(JSON.stringify(crmRecords) === before, 'planning never changes existing CRM records');

  /* run 3: nothing new */
  p2.imports.forEach(function(p){ crmRecords.push(p.rec); ledger[p.leadId] = true; });
  var p3 = mas2_plan_(mas2_parseSource_(v2).rows, ledger, mas2_crmIndex_(crmRecords), roster, { newId: newId });
  ok(p3.imports.length === 0 && p3.ledgerOnly.length === 0, 'run 3 with no new Lead IDs does nothing (idempotent)');

  /* lead without an ID uses phone + time; same lead twice -> once */
  var v4 = [H, ['Harshu', '', '21-10-2026 09:00:00', 'ig', 'No Id', '9000000010', '', 'CREATED', 'Amira Saikh'],
               ['Harshu', '', '21-10-2026 09:00:00', 'ig', 'No Id', '9000000010', '', 'CREATED', 'Mayank Mittal']];
  var p4 = mas2_plan_(mas2_parseSource_(v4).rows, ledger, mas2_crmIndex_(crmRecords), roster, { newId: newId });
  ok(p4.imports.length === 1 && p4.imports[0].leadId === 'nokey:9000000010|21102026090000' && p4.imports[0].rec.assigned_to === 'Amira Saikh', 'row without Lead ID: keyed by phone+time, imported once');

  /* max per run */
  var many = [H]; for(var i = 0; i < 7; i++) many.push(['Sheet4', 'l:m' + i, '22-10-2026 09:0' + i + ':00', 'ig', 'M' + i, '90000002' + ('0' + i).slice(-2), '', 'CREATED', 'Amira Saikh']);
  var p5 = mas2_plan_(mas2_parseSource_(many).rows, ledger, mas2_crmIndex_(crmRecords), roster, { newId: newId, max: 5 });
  ok(p5.imports.length === 5 && p5.pending === 2, 'MAX_PER_RUN respected; the rest wait for the next run');

  /* missing column */
  ok(mas2_parseSource_([['id', 'full_name']]).missing.length > 0, 'missing source columns are reported, nothing imported');

  /* read-back check */
  ok(mas2_diff_({ assigned_to: 'A', owner: 'a' }, { assigned_to: 'A', owner: 'a' }).length === 0 && mas2_diff_({ assigned_to: 'A' }, { assigned_to: 'B' }).length === 1, 'read-back check detects a changed salesperson');

  out.unshift((fails ? 'SELF-TEST FAILED: ' + fails : 'SELF-TEST OK') + ' (' + out.length + ' checks)');
  return out;
}

/**
 * Full test on temporary tabs in this spreadsheet (deleted at the end):
 *   zz_mas2_test_source  source with the SAME row-position formula as Combined!S619
 *   zz_mas2_test_leads   destination collection, written through Code.gs _upsertMany
 *   zz_mas2_test_ledger  ledger
 * Live metaLeads, the live ledger and the source sheet are not touched.
 */
function mas2_e2eTest(){
  var ss = mas2_ss_(), out = [], fails = 0;
  var T = { src: 'zz_mas2_test_source', coll: 'zz_mas2_test_leads', ledger: 'zz_mas2_test_ledger' };
  function ok(cond, msg){ out.push((cond ? 'PASS ' : 'FAIL ') + msg); if(!cond) fails++; }
  function drop(name){ var s = ss.getSheetByName(name); if(s) ss.deleteSheet(s); }
  [T.src, T.coll, T.ledger].forEach(drop);
  try{
    var src = ss.insertSheet(T.src);
    var H = ['source_sheet', 'id', 'created_time_ist', 'platform', 'full_name', 'phone_number', 'city_state', 'lead_status', 'assigned_to'];
    src.getRange(1, 1, 1, H.length).setValues([H]);
    src.getRange('C:C').setNumberFormat('@'); src.getRange('F:F').setNumberFormat('@');
    var rows1 = [
      ['Sheet4', 'l:e2e-1', '20-10-2026 10:00:00', 'ig', 'E2E One', '9000000101', 'UP', 'CREATED'],
      ['Sheet4', 'l:e2e-2', '20-10-2026 10:05:00', 'fb', 'E2E Two', '9000000102', '', 'CREATED'],
      ['Sheet4', 'l:e2e-2', '20-10-2026 10:05:00', 'fb', 'E2E Two', '9000000102', '', 'CREATED'],
      ['Sheet4', 'l:e2e-3', '20-10-2026 10:06:00', '', '<test lead>', '<test lead: dummy data for phone>', '', 'CREATED'],
      ['Sheet4', 'l:e2e-4', '20-10-2026 10:07:00', 'ig', 'E2E Four', '9000000104', 'MP', 'CREATED']];
    src.getRange(2, 1, rows1.length, 8).setValues(rows1);
    /* same rotation formula as Combined!S619 -> names depend on row position */
    src.getRange('I2').setFormula('=LET(data,C2:C,names,{"Amira Saikh";"Mayank Mittal";"Ujala Rajput"},n,SCAN(0,data,LAMBDA(a,v,a+(v<>""))),MAP(data,n,LAMBDA(d,c,IF(d="","",INDEX(names,MOD(c-1,3)+1)))))');
    SpreadsheetApp.flush();
    mas2_ledgerSheet_(T.ledger, true);

    var readSrcNames = function(){ var m = {}; src.getRange(2, 1, src.getLastRow() - 1, 9).getDisplayValues().forEach(function(r){ if(r[1] && !m[r[1]]) m[r[1]] = r[8]; }); return m; };
    var names1 = readSrcNames();
    var r1 = mas2_run_({ srcSheet: src, coll: T.coll, ledgerTab: T.ledger });
    var recs = mas2_readColl_(T.coll), byLead = {};
    recs.forEach(function(x){ byLead[x.meta_lead_id] = x; });
    ok(r1.imported === 3 && r1.checkFailed === 0, 'run 1: 3 leads imported through Code.gs _upsertMany, read-back check passed (' + JSON.stringify({ imported: r1.imported, logOnly: r1.ledgerOnly, checkFailed: r1.checkFailed }) + ')');
    ['l:e2e-1', 'l:e2e-2', 'l:e2e-4'].forEach(function(id){
      ok(byLead[id] && byLead[id].assigned_to === names1[id], id + ': CRM salesperson "' + (byLead[id] || {}).assigned_to + '" = source "' + names1[id] + '"');
    });
    ok(!byLead['l:e2e-3'], 'test lead without phone not imported');
    ok(recs.filter(function(x){ return x.meta_lead_id === 'l:e2e-2'; }).length === 1, 'duplicated Lead ID imported once');

    /* run 2: insert a late lead at the top -> the formula re-rotates every name below */
    var snapshot = {}; recs.forEach(function(x){ snapshot[x.id] = JSON.stringify(x); });
    src.insertRowBefore(2);
    src.getRange(2, 1, 1, 8).setValues([['Sheet4', 'l:e2e-late', '19-10-2026 08:00:00', 'fb', 'E2E Late', '9000000109', '', 'CREATED']]);
    src.getRange('I2:I').clearContent();
    src.getRange('I2').setFormula('=LET(data,C2:C,names,{"Amira Saikh";"Mayank Mittal";"Ujala Rajput"},n,SCAN(0,data,LAMBDA(a,v,a+(v<>""))),MAP(data,n,LAMBDA(d,c,IF(d="","",INDEX(names,MOD(c-1,3)+1)))))');
    src.getRange(src.getLastRow() + 1, 1, 1, 8).setValues([['Sheet4', 'l:e2e-5', '20-10-2026 11:00:00', 'ig', 'E2E Five', '9000000105', 'DL', 'CREATED']]);
    SpreadsheetApp.flush();
    var names2 = readSrcNames();
    var r2 = mas2_run_({ srcSheet: src, coll: T.coll, ledgerTab: T.ledger });
    var recs2 = mas2_readColl_(T.coll), byLead2 = {};
    recs2.forEach(function(x){ byLead2[x.meta_lead_id] = x; });
    ok(r2.imported === 2 && r2.checkFailed === 0, 'run 2: only the 2 new Lead IDs imported (late lead + new bottom lead), none skipped');
    ok(byLead2['l:e2e-late'] && byLead2['l:e2e-late'].assigned_to === names2['l:e2e-late'], 'late lead: CRM salesperson "' + (byLead2['l:e2e-late'] || {}).assigned_to + '" = its source row "' + names2['l:e2e-late'] + '"');
    ok(byLead2['l:e2e-5'] && byLead2['l:e2e-5'].assigned_to === names2['l:e2e-5'], 'new lead: CRM salesperson "' + (byLead2['l:e2e-5'] || {}).assigned_to + '" = its source row "' + names2['l:e2e-5'] + '"');
    var unchanged = Object.keys(snapshot).every(function(id){ var now = recs2.filter(function(x){ return x.id === id; })[0]; return now && JSON.stringify(now) === snapshot[id]; });
    ok(unchanged, 'records imported in run 1 are unchanged after the source re-rotated its names');
    var moved = ['l:e2e-1', 'l:e2e-2', 'l:e2e-4'].filter(function(id){ return names1[id] !== names2[id]; }).length;
    out.push('INFO source names that changed for already-imported leads after the insert: ' + moved + ' of 3 (this is the source formula, not the import)');

    var r3 = mas2_run_({ srcSheet: src, coll: T.coll, ledgerTab: T.ledger });
    ok(r3.newIds === 0 && r3.imported === 0, 'run 3: nothing new, nothing written');
    var led = ss.getSheetByName(T.ledger);
    ok(led.getLastRow() - 1 === 6, 'ledger has one row per Lead ID (6: 5 imported + 1 test lead)');
  } catch(e){
    ok(false, 'exception: ' + (e && e.stack ? e.stack : e));
  } finally {
    [T.src, T.coll, T.ledger].forEach(function(n){ try{ drop(n); }catch(e){ out.push('cleanup failed for ' + n + ': ' + e); } });
  }
  out.unshift((fails ? 'E2E TEST FAILED: ' + fails : 'E2E TEST OK') + ' (' + out.length + ' lines)');
  Logger.log(out.join('\n'));
  return out;
}
