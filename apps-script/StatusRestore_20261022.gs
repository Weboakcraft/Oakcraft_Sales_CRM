/**
 * One-time repair (22-10-2026): restore Meta lead statuses overwritten at 10:32 IST
 * ----------------------------------------------------------------------------
 * What happened: at 2026-10-22 05:02 UTC (10:32 IST) one mis@oakcraft.in CRM
 * session saved all 1,481 metaLeads at once from an old local copy (audit tab:
 * "saveMany metaLeads 1481 records"). Every status change salespeople had made
 * after that copy (20-21 Oct) was overwritten -- 152 Meta leads, 139 of them
 * back to New.
 *
 * What this does (only for those leads):
 *   A lead is repaired only if ALL of these are true at run time:
 *     - its current lead_status differs from the "to" of its LAST status entry
 *       in the CRM activity log (the salesperson's own change),
 *     - the record was last written by that push (updatedAt in 2026-10-22T05:02,
 *       updatedBy mis@oakcraft.in) -- nobody has touched it since,
 *   Then it sets, from the activity log:
 *     lead_status, stage  -> the salesperson's last status (stage label as the CRM uses it)
 *     respAt, respResult, respBy, respMins -> from the matching response-timer
 *        entry, only if the record has no respResult now
 *     updatedAt -> now
 *   Nothing else changes (salesperson, owner, phone, name, history ...). No new
 *   fields / columns. Runs under the script lock, like CRM saves.
 *
 * Use: statusRestore_preview()  -> writes nothing, logs what would change
 *      statusRestore_apply()    -> writes, then reads back and checks each lead
 */
var SR_PUSH_MINUTE = '2026-10-22T05:02';
var SR_PUSH_BY = 'mis@oakcraft.in';
var SR_STAGE = {
  CREATED: 'New', CONTACTED: 'Contacted', WON: 'Won', LOST: 'Lost', QUALIFIED: 'Qualified',
  PROPOSAL: 'Proposal', FOLLOW_UP: 'Follow-up', SYSTEM_MASTER: 'System Master',
  NOT_QUALIFIED: 'Not Qualified', QUOTATION_SENT: 'Quotation Sent', CALL_NOT_PICK: 'Call Not Pick'
};

function sr_code_(v){ return String(v == null ? '' : v).trim().toUpperCase().replace(/\s+/g, '_'); }
function sr_unwrap_(rows){ return (rows || []).map(function(d){ return (d && d.data !== undefined) ? d.data : d; }).filter(function(d){ return d && typeof d === 'object'; }); }
/** 'dd-MM-yyyy HH:mm:ss' IST -> Date */
function sr_istDate_(s){
  var m = String(s || '').match(/(\d{1,2})-(\d{1,2})-(\d{4})\D+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if(!m) return null;
  return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0)) - 5.5 * 3600000);
}

/** Pure planning step (also used by the local test). */
function sr_plan_(leads, activity, nowIso){
  var lastStatus = {}, responses = {};
  activity.forEach(function(a){
    if(!a || a.coll !== 'metaLeads') return;
    if(a.field === 'status'){ var p = lastStatus[a.recId]; if(!p || String(a.ts) > String(p.ts)) lastStatus[a.recId] = a; }
    if(a.field === 'response'){ (responses[a.recId] = responses[a.recId] || []).push(a); }
  });
  var plan = [], skipped = { touchedSinceOrNotByPush: 0, noStageLabel: 0 };
  leads.forEach(function(l){
    var a = lastStatus[l.id];
    if(!a) return;
    var want = sr_code_(a.to), now = sr_code_(l.lead_status);
    if(!want || want === now) return;
    if(String(l.updatedAt || '').slice(0, 16) !== SR_PUSH_MINUTE || String(l.updatedBy || '').toLowerCase() !== SR_PUSH_BY){ skipped.touchedSinceOrNotByPush++; return; }
    if(!SR_STAGE[want]){ skipped.noStageLabel++; return; }
    var rec = JSON.parse(JSON.stringify(l));
    rec.lead_status = want;
    rec.stage = SR_STAGE[want];
    var resp = null;
    if(!rec.respResult){
      /* the response-timer entry written with that status change (same action, a few ms later) */
      (responses[l.id] || []).forEach(function(r){
        var dt = new Date(r.ts) - new Date(a.ts);
        if(dt >= 0 && dt < 60000 && (!resp || String(r.ts) < String(resp.ts))) resp = r;
      });
      if(resp){
        rec.respAt = String(resp.ts);
        rec.respResult = /ok|positive/i.test(String(resp.to)) ? 'OK' : 'VERY_LOW';
        rec.respBy = String(resp.by || a.by || '');
        var start = rec.assignedAt ? new Date(rec.assignedAt) : sr_istDate_(rec.created_time_ist);
        if(start && !isNaN(start)) rec.respMins = Math.round((new Date(resp.ts) - start) / 6000) / 10;
      }
    }
    rec.updatedAt = nowIso;
    plan.push({ rec: rec, from: now, to: want, by: a.byName || '', at: String(a.ts), resp: !!resp });
  });
  return { plan: plan, skipped: skipped };
}

function sr_run_(apply){
  var lock = LockService.getScriptLock();
  if(!lock.tryLock(60000)) throw new Error('Script lock busy -- try again in a minute.');
  try{
    var leads = sr_unwrap_(_readAll('metaLeads'));
    var activity = sr_unwrap_(_readAll('activity'));
    var res = sr_plan_(leads, activity, new Date().toISOString());
    var cnt = {}, byWho = {};
    res.plan.forEach(function(p){ var k = p.from + ' -> ' + p.to; cnt[k] = (cnt[k] || 0) + 1; byWho[p.by] = (byWho[p.by] || 0) + 1; });
    var head = (apply ? 'APPLY' : 'PREVIEW') + ': ' + res.plan.length + ' leads to restore | skipped ' + JSON.stringify(res.skipped)
      + '\n  by change: ' + JSON.stringify(cnt) + '\n  by salesperson: ' + JSON.stringify(byWho)
      + '\n  timer fields restored for: ' + res.plan.filter(function(p){ return p.resp; }).length;
    if(!apply){ Logger.log(head + '\n  ' + res.plan.slice(0, 15).map(function(p){ return p.rec.id + ' ' + p.from + ' -> ' + p.to + ' (' + p.by + ', ' + p.at + ')'; }).join('\n  ')); return res.plan.length; }
    if(res.plan.length){
      _upsertMany('metaLeads', res.plan.map(function(p){ return { id: p.rec.id, data: p.rec }; }));
      SpreadsheetApp.flush();
    }
    /* read back and check */
    var back = {}; sr_unwrap_(_readAll('metaLeads')).forEach(function(l){ back[l.id] = l; });
    var bad = res.plan.filter(function(p){
      var b = back[p.rec.id] || {};
      return sr_code_(b.lead_status) !== p.to || b.stage !== p.rec.stage || b.assigned_to !== p.rec.assigned_to || b.owner !== p.rec.owner || String(b.phone_number) !== String(p.rec.phone_number);
    });
    Logger.log(head + '\n  read-back check: ' + (res.plan.length - bad.length) + ' OK, ' + bad.length + ' not OK' + (bad.length ? ' -> ' + bad.map(function(p){ return p.rec.id; }).join(', ') : ''));
    return { restored: res.plan.length, notOk: bad.length };
  } finally {
    try{ lock.releaseLock(); }catch(e){}
  }
}

function statusRestore_preview(){ return sr_run_(false); }
function statusRestore_apply(){ return sr_run_(true); }
