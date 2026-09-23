var IMS_SRC_ID      = '1TWlFg1dflWOTnKtaE9sqOSMS_YcCcCDpQ8J-Ka3-qpA';
var IMS_SRC_TAB     = 'Indiamart_crm';
var IMS_COLL        = 'indiamartLeads';
var IMS_MINUTES     = 5;                  
var IMS_MAX_PER_RUN = 400;                
var IMS_MARK_COL    = 12;                 
var IMS_MARK_TEXT   = 'send_to_crm';      
var IMS_SKIP_ASSIGNED = ['Anjali Sharma'];
var IMS_NO_LEADS = ['Arun Mourya', 'Pinki Kumari'];
/* Poora data (Enquiry Id, Company, Email, Subject, Discussion, Final Remark's)
   "Indiamart_crm" tab me nahi aata -- wo "Indiamart" tab se, mobile + time
   milaa kar, le liya jaata hai. Sirf padha jaata hai, kuch likha nahi jaata. */
var IMS_FULL_TAB = 'Indiamart';
/* CRM me salesperson ne lead ko inme se kisi status tak pahuncha diya ho to
   sheet ka status use peeche nahi kheenchta (baaki fields phir bhi update). */
var IMS_KEEP_CRM_STATUS = ['WON','QUOTATION_SENT','PROPOSAL','SYSTEM_MASTER'];
function ims_takesLeads_(role){
  var r = ims_lc_(role).replace(/[\s_\-]+/g, ' ');
  return r === 'sales executive' || r === 'sales exec' || r === 'salesexecutive'
      || r === 'sales' || r === 'user';
}
var IMS_MAP = {
  enquiry_no: ['enquiry_id','enquiry_no','enquiry_number','query_id','lead_id','indiamart_enquiry_id'],
  query_time: ['enquiry_time','query_time','enquiry_date_time','enquiry_date','lead_time','date_time','datetime','timestamp','date'],
  source:     ['source','lead_source','platform'],
  name:       ['buyer_name','sender_name','customer_name','contact_person','name','buyer'],
  company:    ['company_name','company','firm_name','firm','organisation','organization'],
  mobile:     ['mobile_number','mobile_no','mobile','sender_mobile','phone_number','phone_no','phone','contact_number','contact_no','whatsapp'],
  email:      ['email_if_available','email_address','email_id','email','sender_email','mail'],
  product:    ['product_requirement','product_name','product','requirement','item','product_interest'],
  qty:        ['quantity','qty','qty_need','required_quantity','req_qty'],
  city:       ['city_location','city_state','city','location','town','sender_city'],
  state:      ['state','region'],
  subject:    ['subject','title','enquiry_subject'],
  assigned:   ['assigned_salesperson','assigned_to','assigned','salesperson','sales_person','sales_executive','executive','assignee','owner'],
  quality:    ['leads_quality','lead_quality','quality'],
  qualif:     ['qualification_status','qualification','qualified'],
  remark:     ['final_remarks','final_remark_s','final_remark','remarks','remark','note','notes','comments'],
  discussion: ['discussion','discussion_notes'],
  profession: ['profession_verification','profession'],
  qty_need:   ['qty_need','required_qty'],
  delivery:   ['delivery_with_in_days','delivery_within_days','delivery_days']
};
var IMS_MARK_HEADERS = ['crm_status','sync_status','send_to_crm','crm','sent_to_crm','crm_sync'];
function ims_str_(v){ return v == null ? '' : String(v); }
function ims_tr_(v){ return ims_str_(v).trim(); }
function ims_lc_(v){ return ims_tr_(v).toLowerCase(); }
function ims_key_(v){
  return ims_str_(v).replace(/^﻿/, '').trim().toLowerCase()
    .replace(/[\s\-\/\\.()]+/g, '_').replace(/[^a-z0-9_]/g, '').replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}
function ims_pad_(n){ return (n < 10 ? '0' : '') + n; }

/** Timestamp ko DD-MM-YYYY HH:MM:SS me lao (CRM isi shakal me rakhta hai). */
function ims_time_(v){
  if(v instanceof Date && !isNaN(v.getTime())){
    return Utilities.formatDate(v, Session.getScriptTimeZone() || 'Asia/Kolkata', 'dd-MM-yyyy HH:mm:ss');
  }
  var s = ims_tr_(v);
  if(!s) return '';
  if(/^\d{2}-\d{2}-\d{4}(\s+\d{1,2}:\d{2}(:\d{2})?)?$/.test(s)) return s;
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);      /* 2026-04-09 17:19:22 */
  if(m) return m[3] + '-' + m[2] + '-' + m[1] + ' ' + ims_pad_(+m[4]) + ':' + m[5] + ':' + (m[6] || '00');
  var y = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(y) return y[3] + '-' + y[2] + '-' + y[1] + ' 00:00:00';
  var d = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if(d) return ims_pad_(+d[1]) + '-' + ims_pad_(+d[2]) + '-' + d[3] + ' '
            + ims_pad_(+(d[4] || 0)) + ':' + (d[5] || '00') + ':' + (d[6] || '00');
  var p = new Date(s);
  if(!isNaN(p.getTime())){
    return Utilities.formatDate(p, Session.getScriptTimeZone() || 'Asia/Kolkata', 'dd-MM-yyyy HH:mm:ss');
  }
  return s;
}
function ims_tsKey_(v){ return ims_time_(v).replace(/[^0-9]/g, ''); }
/** DD-MM-YYYY HH:MM:SS -> YYYY-MM-DD (CRM ka date field) */
function ims_date_(ts){
  var m = ims_str_(ts).match(/^(\d{2})-(\d{2})-(\d{4})/);
  if(m) return m[3] + '-' + m[2] + '-' + m[1];
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Kolkata', 'yyyy-MM-dd');
}

/**
 * Mobile: "+91-9176016345" -> "9176016345".
 * 10 ank ka number jaisa hai waisa; 11-13 ank (91 / 0 lagaa hua) -> aakhri 10;
 * kuch aur (landline, do number ek saath) -> jaisa hai waisa, kuch gum nahi hota.
 */
function ims_mobile_(v){
  var s = ims_tr_(v);
  if(!s) return '';
  var d = s.replace(/[^0-9]/g, '');
  if(d.length === 10) return d;
  if(d.length > 10 && d.length <= 13) return d.slice(-10);
  return s;
}
function ims_phoneKey_(v){
  var d = ims_str_(v).replace(/[^0-9]/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}
/** Kya is salesperson ki leads CRM me bhejni hi nahi hain? */
function ims_skipAssigned_(name){
  var n = ims_lc_(name);
  if(!n) return false;
  for(var i = 0; i < IMS_SKIP_ASSIGNED.length; i++){
    var s = ims_lc_(IMS_SKIP_ASSIGNED[i]);
    if(!s) continue;
    /* poora naam, ya poore SHABD ka match ("Anjali" <-> "Anjali Sharma").
       Aadha-adhoora prefix nahi, warna chhote naam bhi fas jaate hain. */
    if(n === s) return true;
    if(n.length >= 4 && s.indexOf(n + ' ') === 0) return true;
    if(s.length >= 4 && n.indexOf(s + ' ') === 0) return true;
  }
  return false;
}

/** city + state ko ek hi jagah bana do (khaali aur dohra naam chhod kar). */
function ims_place_(city, state){
  var out = [], seen = {};
  [city, state].forEach(function(v){
    v = ims_tr_(v);
    if(!v) return;
    var k = ims_lc_(v);
    if(seen[k]) return;
    seen[k] = 1;
    out.push(v);
  });
  return out.join(', ');
}
function ims_id_(){
  return 'IM-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
}

/** CRM ka koi collection padho ({id,data} unwrap karke). */
function ims_read_(collection){
  var rows = [];
  try{
    if(typeof _readAll === 'function') rows = _readAll(collection) || [];
  }catch(e){ Logger.log('ims_read_ ' + collection + ' error: ' + e); }
  return rows.map(function(d){ return (d && d.data !== undefined) ? d.data : d; })
             .filter(function(d){ return d && typeof d === 'object'; });
}

/* ------------------------------------------------------------------ *
 * source tab + header mapping                                         *
 * ------------------------------------------------------------------ */
function ims_srcSheet_(){
  var ss = null;
  try{ ss = SpreadsheetApp.openById(IMS_SRC_ID); }
  catch(e){ try{ ss = SpreadsheetApp.getActiveSpreadsheet(); }catch(e2){} }
  if(!ss) throw new Error('IndiaMART spreadsheet nahi khul paayi (ID: ' + IMS_SRC_ID + ')');
  var sh = ss.getSheetByName(IMS_SRC_TAB);
  if(!sh) throw new Error('Tab "' + IMS_SRC_TAB + '" nahi mila (' + ss.getName() + ')');
  return sh;
}

/** header row -> { field: columnIndex } (0-based) */
function ims_mapHeader_(head){
  var keys = head.map(ims_key_), idx = {}, f, alts, i, p;
  for(f in IMS_MAP){
    alts = IMS_MAP[f];
    for(i = 0; i < alts.length; i++){
      p = keys.indexOf(alts[i]);
      if(p >= 0){ idx[f] = p; break; }
    }
  }
  return idx;
}

/**
 * Mark column tay karo:
 *   1. header me CRM Status / Sync Status jaisa column ho -> wahi
 *   2. warna IMS_MARK_COL (default L), par sirf tab jab uspar kisi data
 *      column ka header na ho -- warna 0 (matlab: kuch mat likho).
 */
function ims_markCol_(head, idx){
  var keys = head.map(ims_key_), i;
  for(i = 0; i < keys.length; i++){
    if(IMS_MARK_HEADERS.indexOf(keys[i]) >= 0) return i + 1;
  }
  var want = IMS_MARK_COL, at = want - 1;
  var used = false;
  for(var f in idx){ if(idx[f] === at) used = true; }
  if(used){
    Logger.log('IndiaMartAutoSync: WARNING — column ' + ims_colName_(want) + ' par data column "'
      + ims_str_(head[at]) + '" hai, isliye wahan kuch nahi likha jayega (aapka data safe rahe). '
      + 'Koi khaali column dijiye: IMS_MARK_COL badal dijiye, ya header row me "CRM Status" naam ka '
      + 'column bana dijiye. Duplicate phir bhi nahi banenge — Enquiry Id aur mobile+time ka pehra chalta rahega.');
    return 0;
  }
  return want;
}
function ims_colName_(n){
  var s = '';
  while(n > 0){ var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/** saari rows padho -> {row, mark, enquiry_no, ...} */
function ims_srcRows_(){
  var sh = ims_srcSheet_();
  var lastRow = sh.getLastRow(), lastCol = Math.max(sh.getLastColumn(), IMS_MARK_COL);
  if(lastRow < 2) return { rows: [], markCol: 0, sheet: sh, head: [] };
  var vals = sh.getRange(1, 1, lastRow, lastCol).getValues();
  var head = vals[0] || [];
  var idx  = ims_mapHeader_(head);
  var markCol = ims_markCol_(head, idx);
  var get = function(r, f){ return (idx[f] == null) ? '' : ims_tr_(r[idx[f]]); };
  var rows = [], i;
  for(i = 1; i < vals.length; i++){
    var v = vals[i];
    var name = get(v, 'name'), mob = get(v, 'mobile'), eno = get(v, 'enquiry_no');
    if(!name && !mob && !eno) continue;                       /* khaali row */
    rows.push({
      row: i + 1,
      mark: markCol ? ims_tr_(v[markCol - 1]) : '',
      enquiry_no: eno,
      query_time: ims_time_((idx.query_time == null) ? '' : v[idx.query_time]),
      source: get(v, 'source'),
      name: name,
      company: get(v, 'company'),
      mobile: ims_mobile_(mob),
      email: get(v, 'email'),
      product: get(v, 'product'),
      qty: get(v, 'qty'),
      city: get(v, 'city'),
      state: get(v, 'state'),
      subject: get(v, 'subject'),
      assigned: get(v, 'assigned'),
      quality: get(v, 'quality'),
      qualif: get(v, 'qualif'),
      remark: get(v, 'remark'),
      discussion: get(v, 'discussion'),
      profession: get(v, 'profession'),
      qty_need: get(v, 'qty_need'),
      delivery: get(v, 'delivery')
    });
  }
  try{ ims_enrich_(rows, sh); }catch(e){ Logger.log('IndiaMartAutoSync: ' + IMS_FULL_TAB + ' tab se data nahi mila — ' + e); }
  return { rows: rows, markCol: markCol, sheet: sh, head: head, idx: idx };
}

/**
 * "Indiamart_crm" me sirf 11 column aate hain. Baaki (Enquiry Id, Company,
 * Email, Subject, Discussion, Final Remark's, Profession ...) "Indiamart" tab
 * se mobile + enquiry time milaa kar bhar dete hain. Jo field pehle se bhara
 * hai use nahi chhedte. Status wale column (Lead's Quality / Qualification
 * Status) khaali hon to wahan se bhi le lete hain.
 */
function ims_enrich_(rows, crmSheet){
  if(!IMS_FULL_TAB || !rows.length) return 0;
  var sh = crmSheet.getParent().getSheetByName(IMS_FULL_TAB);
  if(!sh || sh.getLastRow() < 2) return 0;
  var vals = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var head = vals[0], keys = head.map(ims_key_), idx = ims_mapHeader_(head);
  if(idx.mobile == null) return 0;
  var tsCols = [];
  if(idx.query_time != null) tsCols.push(idx.query_time);
  var tsc = keys.indexOf('timestamp'); if(tsc >= 0 && tsCols.indexOf(tsc) < 0) tsCols.push(tsc);
  var F = ['enquiry_no','company','email','product','qty','city','state','subject','assigned',
           'quality','qualif','remark','discussion','profession','qty_need','delivery'];
  var byPT = {}, byPhone = {}, phoneCnt = {}, i;
  for(i = 1; i < vals.length; i++){
    var v = vals[i], ph = ims_phoneKey_(v[idx.mobile]);
    if(!ph) continue;
    var rec = {};
    F.forEach(function(f){ rec[f] = (idx[f] == null) ? '' : ims_tr_(v[idx[f]]); });
    tsCols.forEach(function(c){ var t = ims_tsKey_(v[c]); if(t) byPT[ph + '|' + t] = rec; });
    phoneCnt[ph] = (phoneCnt[ph] || 0) + 1;
    byPhone[ph] = rec;
  }
  var n = 0;
  rows.forEach(function(r){
    var ph = ims_phoneKey_(r.mobile);
    if(!ph) return;
    var f = byPT[ph + '|' + ims_tsKey_(r.query_time)];
    if(!f && phoneCnt[ph] === 1) f = byPhone[ph];   /* time na mile to sirf tab jab number ek hi baar ho */
    if(!f) return;
    F.forEach(function(k){ if(!r[k] && f[k]) r[k] = f[k]; });
    n++;
  });
  return n;
}

/* ------------------------------------------------------------------ *
 * status                                                              *
 * ------------------------------------------------------------------ */
/**
 * Sheet ka "Qualification Status" saaf-saaf Qualified kahe to lead CRM me bhi
 * QUALIFIED jaati hai (aur Qualified section me dikh jaati hai). Baaki sab
 * CREATED se shuru hoti hain -- sheet ka apna quality / qualification text
 * note me chala jaata hai, kuch chhutta nahi.
 */
function ims_isQualified_(s){
  var q = ims_lc_(s);
  return !!q && q.indexOf('not') < 0 && q.indexOf('non') < 0 && q.indexOf('qualified') >= 0;
}
/**
 * CRM ka lead_status = source sheet ka "Qualification Status" -- hu-ba-hu.
 *   Qualified       -> QUALIFIED
 *   Not Qualified   -> NOT QUALIFIED
 *   khaali          -> CREATED   (abhi tak kisi ne qualify/not-qualify nahi kiya)
 *   kuch aur likha  -> wahi text (bade aksharo me)
 * Lead's Quality (Hot / Cold / Not Interested / Don't pick call) status ko
 * nahi badalti -- wo alag field "lead_quality" me jaati hai.
 */
function ims_status_(r){
  var raw = ims_tr_(r.qualif), qs = ims_lc_(raw);
  if(!qs) return 'CREATED';
  if(ims_isQualified_(raw)) return 'QUALIFIED';
  if(qs.replace(/[^a-z]/g, '') === 'notqualified' || qs.replace(/[^a-z]/g, '') === 'nonqualified') return 'NOT QUALIFIED';
  return raw.toUpperCase();
}
var IMS_STAGE = { CREATED:'New', CONTACTED:'Contacted', QUALIFIED:'Qualified', 'NOT QUALIFIED':'Not Qualified',
                  SYSTEM_MASTER:'System Master', QUOTATION_SENT:'Quotation Sent', PROPOSAL:'Proposal', WON:'Won', LOST:'Lost' };
function ims_stage_(code){ var c = ims_tr_(code).toUpperCase(); return IMS_STAGE[c] || (c ? ims_tr_(code) : 'New'); }

function ims_note_(r){
  var bits = [];
  if(r.subject) bits.push('Subject: ' + r.subject);
  if(r.qty) bits.push('Qty: ' + r.qty);
  if(r.quality) bits.push("Lead's Quality: " + r.quality);
  if(r.qualif) bits.push('Qualification: ' + r.qualif);
  if(r.discussion) bits.push('Discussion: ' + r.discussion);
  if(r.remark) bits.push('Final Remark: ' + r.remark);
  return bits.join(' | ');
}
/** Sheet ke status wale fields ka "fingerprint" -- badle to hi CRM update hota hai. */
function ims_sig_(r){
  return [r.quality, r.qualif, r.profession, r.discussion, r.remark].map(ims_lc_).join('|');
}
/**
 * CRM me pehle se maujood lead par sheet ka taaza status aur jaankari chadha do.
 * Status wale fields sheet jaisa hi kar diye jaate hain; company/email jaise
 * fields sirf khaali hon tab bhare jaate hain.
 * @return {Array<string>} kaun-kaun se field badle
 */
function ims_applySrc_(l, r, now){
  var ch = [];
  function set(k, val){ val = ims_tr_(val); if(ims_tr_(l[k]) !== val){ l[k] = val; ch.push(k); } }
  function fill(k, val){ val = ims_tr_(val); if(val && !ims_tr_(l[k])){ l[k] = val; ch.push(k); } }
  set('lead_quality', r.quality);
  set('qualification_status', r.qualif);
  set('profession', r.profession);
  set('discussion', r.discussion);
  set('final_remarks', r.remark);
  fill('enquiry_no', r.enquiry_no);
  fill('company', r.company);
  fill('sender_email', r.email);
  fill('subject', r.subject);
  fill('qty', r.qty);
  fill('note', ims_note_(r));
  var want = ims_status_(r);
  var cur = ims_tr_(l.lead_status || l.status).toUpperCase();
  if(cur !== want && IMS_KEEP_CRM_STATUS.indexOf(cur) < 0){
    l.lead_status = want; l.status = want; l.stage = ims_stage_(want);
    if(want === 'QUALIFIED' && !l.qualifiedAt) l.qualifiedAt = now;
    ch.push('lead_status');
  } else if(ims_tr_(l.stage) !== ims_stage_(cur || want)){
    l.stage = ims_stage_(cur || want); ch.push('stage');
  }
  return ch;
}

/* ------------------------------------------------------------------ *
 * roster: "Assigned Salesperson" -> user ka email                     *
 * ------------------------------------------------------------------ */
/**
 * Lead kis-kis ko di ja sakti hai.
 *
 * byName/byEmail me SIRF wahi log aate hain jo sach me leads uthate hain:
 * role sales ka ho, status Active ho, aur naam IMS_NO_LEADS me na ho.
 * Administrator (Ankush Goswami, Vishu Mittal) aur Sales Manager is list
 * me nahi aate -- pehle aate the, isliye sheet ka aadha-adhoora naam unpar
 * chipak jaata tha.
 *
 * `all` me sab users rehte hain -- sirf naam dikhane ke liye (kisi ka
 * purana owner email padhna ho to).
 */
function ims_roster_(){
  var byName = {}, byEmail = {}, all = {}, skipped = [];
  ims_read_('users').forEach(function(u){
    var em = ims_lc_(u.email); if(!em) return;
    var nm = ims_lc_(u.name);
    all[em] = ims_tr_(u.name) || em;

    var st = ims_lc_(u.status);
    if(st && st !== 'active'){ skipped.push(all[em] + ' (inactive)'); return; }
    if(!ims_takesLeads_(u.role)){ skipped.push(all[em] + ' (' + (ims_tr_(u.role) || 'role nahi') + ')'); return; }
    if(ims_noLeads_(u.name)){ skipped.push(all[em] + ' (IMS_NO_LEADS)'); return; }

    byEmail[em] = all[em];
    if(nm && !byName[nm]) byName[nm] = em;
  });
  return { byName: byName, byEmail: byEmail, all: all, skipped: skipped };
}

/** Kya is naam par lead assign karni hi nahi hai? (poore shabd par milaan) */
function ims_noLeads_(name){
  var nm = ims_lc_(name);
  if(!nm) return false;
  for(var i = 0; i < IMS_NO_LEADS.length; i++){
    if(ims_lc_(IMS_NO_LEADS[i]) === nm) return true;
  }
  return false;
}
/**
 * Sheet ke "Assigned Salesperson" ko CRM user ke email se milao.
 *
 * SAAVDHANI — yahan pehle character-prefix se milaya jaata tha
 * (`keys[i].indexOf(nm) === 0`). Usse sheet ka koi bhi aadha naam kisi bhi
 * user ke naam ka hissa ban jaata tha, aur loop PEHLA match lauta deta tha.
 * Users list me jo sabse upar hai (Ankush Goswami) uske naam par bahut si
 * leads chali jaati thin, jabki sheet me unka naam tha hi nahi.
 *
 * Ab milaan POORE SHABD par hota hai, aur agar do user par shaq ho to kisi
 * ko nahi chunte -- owner khaali chhod dete hain. Khaali owner theek hai:
 * lead CRM me aa jaati hai, bas unassigned dikhti hai aur koi bhi utha sakta
 * hai. Galat aadmi ko de dena usse kahin zyada nuksaan karta hai.
 *
 * @return {string} email, ya '' agar pakka pata na chale
 */
function ims_ownerFor_(assigned, roster){
  var nm = ims_lc_(assigned);
  if(!nm) return '';

  /* 1. hu-ba-hu naam */
  if(roster.byName[nm]) return roster.byName[nm];
  /* 2. seedha email -- aur agar email hai par roster me nahi, to aage andaaza
        lagane ka koi matlab nahi (kisi anjaan email ke tukde jodna khatarnak) */
  if(nm.indexOf('@') > 0) return roster.byEmail[nm] ? nm : '';

  /* 3. poore shabdo par milaan -- aur sirf tab jab ek hi user mile.
        "niti" -> "Niti Kumari" chalega; "a" ya "an" kisi se nahi milega. */
  var want = ims_words_(nm);
  if(!want.length) return '';
  var hits = [];
  Object.keys(roster.byName).forEach(function(k){
    var have = ims_words_(k);
    if(!have.length) return;
    var small = want.length <= have.length ? want : have;
    var big   = want.length <= have.length ? have : want;
    for(var i = 0; i < small.length; i++) if(big.indexOf(small[i]) < 0) return;
    hits.push(roster.byName[k]);
  });
  /* do alag user mil gaye to andaaza nahi lagate */
  var uniq = [];
  hits.forEach(function(e){ if(uniq.indexOf(e) < 0) uniq.push(e); });
  return uniq.length === 1 ? uniq[0] : '';
}

/** naam ko poore shabdo me toro: "Niti  Kumari." -> ['niti','kumari'] */
function ims_words_(s){
  return ims_lc_(s).split(/[^a-z0-9]+/).filter(function(w){ return w.length >= 2; });
}

/* ------------------------------------------------------------------ *
 * writer: Code.gs ka apna _upsertMany                                 *
 * ------------------------------------------------------------------ */
function ims_writerReady_(){
  return (typeof _upsertMany === 'function') || (typeof _upsert === 'function');
}
function ims_write_(recs){
  if(!recs.length) return 0;
  var payload = recs.map(function(r){ return { id: r.id, data: r }; });
  if(typeof _upsertMany === 'function'){ _upsertMany(IMS_COLL, payload); return payload.length; }
  if(typeof _upsert === 'function'){
    payload.forEach(function(p){ _upsert(IMS_COLL, p); });
    return payload.length;
  }
  throw new Error('Code.gs ka _upsertMany / _upsert nahi mila — kuch nahi likha gaya.');
}

/**
 * Jo enquiry CRM me chali gayi, uski row par mark column me `send_to_crm`
 * likh do. Cell me pehle se kuch aur likha ho to use CHHEDTE NAHI (aapka
 * data kabhi overwrite nahi hota), sirf log karte hain.
 */
function ims_mark_(sheet, markCol, rowNumbers){
  if(!markCol || !rowNumbers.length) return 0;
  /* Ek-ek cell likhna bahut dheema tha (150 rows = 150 API call). Ab paas-paas
     waali rows ko ek saath, ek hi setValues call me likhte hain. Sirf unhi rows
     ko chhua jaata hai jo is batch me hain -- beech ki doosri rows jaisi hain
     waisi rehti hain. */
  var sorted = rowNumbers.slice().sort(function(a, b){ return a - b; });
  var groups = [], cur = null, i;
  for(i = 0; i < sorted.length; i++){
    var n = sorted[i];
    if(cur && n === cur.end + 1){ cur.end = n; continue; }
    cur = { start: n, end: n };
    groups.push(cur);
  }
  var done = 0, busy = [];
  try{
    groups.forEach(function(g){
      try{
        var len = g.end - g.start + 1;
        var rng = sheet.getRange(g.start, markCol, len, 1);
        var vals = rng.getValues(), touched = false, k;
        for(k = 0; k < len; k++){
          var was = ims_tr_(vals[k][0]);
          if(was === IMS_MARK_TEXT) continue;                 /* pehle se laga hai */
          if(was){ busy.push(g.start + k); continue; }        /* kuch aur likha hai -- chhodo */
          vals[k][0] = IMS_MARK_TEXT; touched = true; done++;
        }
        if(touched) rng.setValues(vals);
      }catch(e){ Logger.log('IndiaMartAutoSync: row ' + g.start + '-' + g.end + ' par mark nahi laga — ' + e); }
    });
    SpreadsheetApp.flush();
  }catch(err){ Logger.log('IndiaMartAutoSync: mark likhne me dikkat — ' + err); }
  if(busy.length) Logger.log('IndiaMartAutoSync: ' + busy.length + ' row ke mark column me pehle se kuch aur '
    + 'likha tha — chhua nahi gaya (rows: ' + busy.slice(0, 10).join(', ') + (busy.length > 10 ? ' …' : '') + ')');
  return done;
}

/* ------------------------------------------------------------------ *
 * main                                                                *
 * ------------------------------------------------------------------ */
function ims_run_(dryRun){
  var lock = LockService.getScriptLock();
  try{ if(!lock.tryLock(20000)){ Logger.log('IndiaMartAutoSync: pehle wala run chal raha hai, skip.'); return; } }
  catch(e){}

  try{
    var src = ims_srcRows_();
    var rows = src.rows;
    if(!rows.length){ Logger.log('IndiaMartAutoSync: ' + IMS_SRC_TAB + ' khaali hai.'); return; }

    /* CRM me pehle se kya hai -- enquiry no aur mobile+time dono se pehchaan */
    var existing = ims_read_(IMS_COLL);
    var byEnq = {}, byPT = {};
    existing.forEach(function(l){
      var e = ims_tr_(l.enquiry_no); if(e && !byEnq[e]) byEnq[e] = l;
      var p = ims_phoneKey_(l.sender_mobile || l.mobile || l.phone);
      var t = ims_tsKey_(l.query_time);
      if(p && t && !byPT[p + '|' + t]) byPT[p + '|' + t] = l;
    });

    var roster = ims_roster_();
    var nowIso = new Date().toISOString();
    var fresh = [], upd = [], updSeen = {}, skipped = 0, marked = 0, noOwner = [], already = [],
        blocked = 0, markedMissing = [], capped = 0;

    for(var i = 0; i < rows.length; i++){
      var r = rows[i];
      if(!r.mobile && !r.enquiry_no){ skipped++; continue; }

      /* jin salesperson ka data CRM me nahi jaana -- unki row chhod do */
      if(ims_skipAssigned_(r.assigned)){ skipped++; blocked++; continue; }

      var pk = ims_phoneKey_(r.mobile), tk = ims_tsKey_(r.query_time);
      var hit = (r.enquiry_no && byEnq[r.enquiry_no]) || (pk && tk && byPT[pk + '|' + tk]) || null;
      var isMarked = ims_lc_(r.mark) === ims_lc_(IMS_MARK_TEXT);

      /* ---- 1. lead CRM me pehle se hai -> sheet ka status CRM me utaaro ---- */
      if(hit){
        if(isMarked) marked++; else already.push(r.row);
        var hid = String(hit.id == null ? '' : hit.id);
        if(!hid || updSeen[hid]) continue;
        var sig = ims_sig_(r);
        if(ims_str_(hit.src_sig) === sig) continue;       /* sheet me kuch nahi badla */
        var copy = JSON.parse(JSON.stringify(hit));
        var ch = ims_applySrc_(copy, r, nowIso);
        copy.src_sig = sig;
        copy.statusSyncedAt = nowIso;
        updSeen[hid] = 1;
        upd.push({ row: r.row, rec: copy, ch: ch,
                   from: ims_tr_(hit.lead_status || hit.status), to: ims_tr_(copy.lead_status) });
        continue;
      }

      /* ---- 2. sheet par nishaan hai par CRM me nahi mili ---- */
      if(isMarked){ skipped++; marked++; markedMissing.push(r.row); continue; }

      /* ---- 3. nayi lead ---- */
      if(fresh.length >= IMS_MAX_PER_RUN){ capped++; continue; }

      var owner = ims_ownerFor_(r.assigned, roster);
      if(!owner && r.assigned) noOwner.push(r.row + ': "' + r.assigned + '" roster me nahi mila');

      var status = ims_status_(r);
      var rec = {
        id: ims_id_(),
        enquiry_no: r.enquiry_no,
        query_time: r.query_time,
        date: ims_date_(r.query_time),
        sender_name: r.name,
        company: r.company,
        sender_mobile: r.mobile,
        sender_email: r.email,
        sender_city_state: ims_place_(r.city, r.state),
        product: r.product,
        qty: r.qty,
        subject: r.subject,
        query_type: r.source || 'IndiaMART',
        lead_status: status,
        status: status,
        stage: ims_stage_(status),
        lead_quality: r.quality,
        qualification_status: r.qualif,
        profession: r.profession,
        discussion: r.discussion,
        final_remarks: r.remark,
        note: ims_note_(r),
        assigned_to: r.assigned,
        owner: owner,
        source: 'IndiaMART',
        srcRow: r.row,
        src_sig: ims_sig_(r),
        statusSyncedAt: nowIso,
        createdAt: nowIso,
        updatedAt: nowIso
      };
      if(status === 'QUALIFIED') rec.qualifiedAt = nowIso;
      fresh.push({ row: r.row, rec: rec });

      /* isi run ki aapas ki duplicate rows bhi rok do */
      if(r.enquiry_no) byEnq[r.enquiry_no] = rec;
      if(pk && tk) byPT[pk + '|' + tk] = rec;
    }

    if(noOwner.length) Logger.log('IndiaMartAutoSync: owner resolve nahi hua —\n  ' + noOwner.join('\n  '));
    if(blocked) Logger.log('IndiaMartAutoSync: ' + blocked + ' row chhodi gayi kyunki unki '
      + 'Assigned Salesperson skip-list me hai (' + IMS_SKIP_ASSIGNED.join(', ') + ').');
    if(markedMissing.length) Logger.log('IndiaMartAutoSync: WARNING — ' + markedMissing.length + ' row par "'
      + IMS_MARK_TEXT + '" likha hai par wo lead CRM me nahi mili (rows: ' + markedMissing.slice(0, 10).join(', ')
      + (markedMissing.length > 10 ? ' …' : '') + '). Dobara import karni ho to clearIndiaMartMarks() chalaiye.');
    if(capped) Logger.log('IndiaMartAutoSync: ' + capped + ' nayi lead agle run me jaayengi (ek run me max ' + IMS_MAX_PER_RUN + ').');

    var tally = {};
    upd.forEach(function(u){ if(u.from !== u.to){ var k = (u.from || '-') + ' -> ' + u.to; tally[k] = (tally[k] || 0) + 1; } });
    var tallyTxt = Object.keys(tally).sort().map(function(k){ return '  ' + tally[k] + ' lead: ' + k; }).join('\n');

    if(dryRun){
      Logger.log('IndiaMartAutoSync (PREVIEW) — kuch likha nahi gaya.\n'
        + 'Nayi lead: ' + fresh.length + '\n  '
        + fresh.slice(0, 30).map(function(f){
            return 'row ' + f.row + ': ' + f.rec.sender_name + ' | ' + f.rec.sender_mobile
              + ' | ' + f.rec.query_time + ' | ' + f.rec.lead_status + ' (' + (f.rec.lead_quality || '-') + ' / '
              + (f.rec.qualification_status || '-') + ') -> ' + (f.rec.owner || '(owner nahi mila)');
          }).join('\n  ')
        + '\nStatus/details update: ' + upd.length + ' lead\n' + (tallyTxt || '  (status wahi, sirf details)') + '\n  '
        + upd.slice(0, 30).map(function(u){
            return 'row ' + u.row + ': ' + (u.rec.sender_name || '?') + ' | ' + (u.from || '-') + ' -> ' + u.to
              + ' [' + u.ch.join(', ') + ']';
          }).join('\n  ')
        + '\n(mark column: ' + (src.markCol ? ims_colName_(src.markCol) : 'NAHI MILA') + ', CRM me pehle se: '
        + (marked + already.length) + ', skip: ' + skipped + ')');
      return;
    }

    /* jo enquiry CRM me pehle se hai par sheet par unmarked reh gayi -- nishaan laga do */
    if(already.length){
      var mk = ims_mark_(src.sheet, src.markCol, already);
      if(mk) Logger.log('IndiaMartAutoSync: ' + mk + ' purani row par ' + IMS_MARK_TEXT
        + ' likha (ye enquiry CRM me pehle se hai).');
    }

    if(!fresh.length && !upd.length){
      Logger.log('IndiaMartAutoSync: koi nayi enquiry ya status badlaav nahi. (' + rows.length + ' rows dekhi, '
        + marked + ' par ' + IMS_MARK_TEXT + ' hai, ' + skipped + ' skip hui.)');
      return;
    }

    if(!ims_writerReady_()){
      Logger.log('IndiaMartAutoSync ERROR: _upsertMany/_upsert nahi mila. Ye file CRM ke Apps Script '
        + 'project (Code.gs ke saath) me honi chahiye. Kuch nahi likha gaya.');
      return;
    }

    /* nayi + update dono ek hi baar me likho */
    var all = fresh.map(function(f){ return f.rec; }).concat(upd.map(function(u){ return u.rec; }));
    var wrote = ims_write_(all);
    SpreadsheetApp.flush();

    if(upd.length) Logger.log('IndiaMartAutoSync: ' + upd.length + ' purani lead ka status/details sheet ke hisaab se '
      + 'update hua.' + (tallyTxt ? '\n' + tallyTxt : ''));

    if(!fresh.length) return;

    /* ---- TASDEEQ: nayi lead sach me CRM me pahunchi ya nahi? ----
       Sirf UNHI rows par nishaan lagate hain jinki id CRM me mil gayi. */
    var landedMap = {};
    ims_read_(IMS_COLL).forEach(function(l){ if(l && l.id) landedMap[String(l.id)] = 1; });
    var landed = fresh.filter(function(f){ return landedMap[String(f.rec.id)]; });
    var lost = fresh.length - landed.length;

    if(!landed.length){
      Logger.log('IndiaMartAutoSync ERROR: ' + fresh.length + ' enquiry bheji par CRM ke "'
        + IMS_COLL + '" collection me ek bhi nahi pahunchi. Source sheet par KOI nishaan nahi lagaya gaya, '
        + 'isliye ye leads baad me dobara koshish karengi.');
      return;
    }
    if(lost) Logger.log('IndiaMartAutoSync: WARNING — ' + lost + ' enquiry CRM me nahi pahunchi, '
      + 'unpar nishaan nahi lagaya (agli baar dobara koshish hogi).');

    var markedNow = ims_mark_(src.sheet, src.markCol, landed.map(function(f){ return f.row; }));

    Logger.log('IndiaMartAutoSync: ' + landed.length + ' nayi enquiry CRM me gayi (' + markedNow + ' row par '
      + IMS_MARK_TEXT + ' likha, kul likhe ' + wrote + ') —\n  '
      + landed.map(function(f){
          return f.rec.sender_name + ' | ' + f.rec.sender_mobile + ' | ' + f.rec.lead_status
            + ' -> ' + (f.rec.owner || '(owner nahi mila)');
        }).join('\n  '));
  }catch(err){
    Logger.log('IndiaMartAutoSync ERROR: ' + err + (err && err.stack ? '\n' + err.stack : ''));
  }finally{
    try{ lock.releaseLock(); }catch(e){}
  }
}

/** Trigger yahi chalata hai. */
function indiaMartAutoSyncTick(){ ims_run_(false); }

/**
 * Poora purana backlog ek hi baar me (jitna 4.5 minute me ho sake).
 * Apps Script ka 6 minute ka limit hai, isliye ye khud ruk jaata hai aur
 * bata deta hai ki kitna baaki hai -- dobara chala dijiye. Trigger bhi
 * apne aap chalta rehta hai, ye sirf jaldi karne ke liye hai.
 */
function backfillIndiaMartAll(){
  var started = Date.now(), rounds = 0, LIMIT_MS = 4.5 * 60 * 1000;
  while(Date.now() - started < LIMIT_MS){
    var before = ims_pendingCount_();
    if(!before){ Logger.log('backfillIndiaMartAll: sab kuch CRM me ja chuka hai.'); return; }
    ims_run_(false);
    rounds++;
    var after = ims_pendingCount_();
    Logger.log('backfillIndiaMartAll: round ' + rounds + ' — baaki ' + after + ' rows.');
    if(after >= before){ Logger.log('backfillIndiaMartAll: aage badhna ruk gaya, yahin rok rahe hain.'); break; }
    if(!after){ Logger.log('backfillIndiaMartAll: sab enquiry CRM me pahunch gayi.'); return; }
  }
  Logger.log('backfillIndiaMartAll: ' + rounds + ' round hue, abhi ' + ims_pendingCount_()
           + ' rows baaki hain. Dobara chala dijiye (ya trigger ko apne aap chalne dijiye).');
}
/** Kitni rows abhi CRM me jaani baaki hain (mark aur skip-list chhod kar). */
function ims_pendingCount_(){
  try{
    var src = ims_srcRows_(), n = 0;
    src.rows.forEach(function(r){
      if(ims_lc_(r.mark) === ims_lc_(IMS_MARK_TEXT)) return;
      if(ims_skipAssigned_(r.assigned)) return;
      if(!r.mobile && !r.enquiry_no) return;
      n++;
    });
    return n;
  }catch(e){ return 0; }
}

/** Kuch likhta nahi — sirf Logs me dikhata hai ki kya hota. */
function previewIndiaMartAutoSync(){ ims_run_(true); }

/** Abhi turant chala do. */
function runIndiaMartAutoSyncNow(){ ims_run_(false); }

/* ------------------------------------------------------------------ *
 * setup                                                               *
 * ------------------------------------------------------------------ */
/** EK BAAR chalayein: har IMS_MINUTES minute ka trigger lag jayega. */
function installIndiaMartAutoSync(){
  removeIndiaMartAutoSync();
  ScriptApp.newTrigger('indiaMartAutoSyncTick').timeBased().everyMinutes(IMS_MINUTES).create();
  Logger.log('IndiaMartAutoSync: trigger lag gaya (har ' + IMS_MINUTES + ' minute). '
           + 'Pehla run apne aap chal jayega; turant chahiye to runIndiaMartAutoSyncNow chala dijiye.');
}

/** Trigger hata do. */
function removeIndiaMartAutoSync(){
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function(t){
    if(t.getHandlerFunction() === 'indiaMartAutoSyncTick'){ ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log('IndiaMartAutoSync: ' + n + ' trigger hataye.');
}

/**
 * Backfill — jo enquiry CRM me pehle se hai par sheet par uske mark column me
 * kuch nahi likha, uspar `send_to_crm` likh do. Ek baar chala dijiye.
 */
function markIndiaMartSyncedInSource(){
  var src = ims_srcRows_();
  if(!src.markCol){ Logger.log('markIndiaMartSyncedInSource: mark column nahi mila — kuch nahi likha.'); return 0; }
  var existing = ims_read_(IMS_COLL);
  var haveEnq = {}, havePhoneTime = {};
  existing.forEach(function(l){
    var e = ims_tr_(l.enquiry_no); if(e) haveEnq[e] = 1;
    var p = ims_phoneKey_(l.sender_mobile || l.mobile || l.phone);
    var t = ims_tsKey_(l.query_time);
    if(p && t) havePhoneTime[p + '|' + t] = 1;
  });
  var todo = [];
  src.rows.forEach(function(r){
    if(ims_lc_(r.mark) === ims_lc_(IMS_MARK_TEXT)) return;
    if(ims_skipAssigned_(r.assigned)) return;
    var pk = ims_phoneKey_(r.mobile), tk = ims_tsKey_(r.query_time);
    if((r.enquiry_no && haveEnq[r.enquiry_no]) || (pk && tk && havePhoneTime[pk + '|' + tk])) todo.push(r.row);
  });
  if(!todo.length){ Logger.log('markIndiaMartSyncedInSource: kuch backfill karne ko nahi hai.'); return 0; }
  var n = ims_mark_(src.sheet, src.markCol, todo);
  Logger.log('markIndiaMartSyncedInSource: ' + n + ' row par ' + IMS_MARK_TEXT + ' likha.');
  return n;
}

/**
 * Recovery — jin rows par `send_to_crm` likha hai par wo enquiry CRM me hai hi
 * nahi (pehle ke kisi adhoore run me galat nishaan lag gaya tha), unka nishaan
 * hata deta hai taaki wo leads dobara import ho sakein. Jo enquiry sach me CRM
 * me hai, uska nishaan chhua nahi jaata.
 */
function clearIndiaMartMarks(){
  var src = ims_srcRows_();
  if(!src.markCol){ Logger.log('clearIndiaMartMarks: mark column nahi mila.'); return 0; }
  var haveEnq = {}, havePhoneTime = {};
  ims_read_(IMS_COLL).forEach(function(l){
    var e = ims_tr_(l.enquiry_no); if(e) haveEnq[e] = 1;
    var p = ims_phoneKey_(l.sender_mobile || l.mobile || l.phone);
    var t = ims_tsKey_(l.query_time);
    if(p && t) havePhoneTime[p + '|' + t] = 1;
  });
  var todo = [], kept = 0;
  src.rows.forEach(function(r){
    if(ims_lc_(r.mark) !== ims_lc_(IMS_MARK_TEXT)) return;
    var pk = ims_phoneKey_(r.mobile), tk = ims_tsKey_(r.query_time);
    var inCrm = (r.enquiry_no && haveEnq[r.enquiry_no]) || (pk && tk && havePhoneTime[pk + '|' + tk]);
    if(inCrm){ kept++; return; }
    todo.push(r.row);
  });
  if(!todo.length){
    Logger.log('clearIndiaMartMarks: sab theek hai — ' + kept + ' nishaan wali rows CRM me maujood hain.');
    return 0;
  }
  var done = 0;
  try{
    todo.forEach(function(n){
      try{ src.sheet.getRange(n, src.markCol).setValue(''); done++; }
      catch(e){ Logger.log('clearIndiaMartMarks: row ' + n + ' — ' + e); }
    });
    SpreadsheetApp.flush();
  }catch(err){ Logger.log('clearIndiaMartMarks: ' + err); }
  Logger.log('clearIndiaMartMarks: ' + done + ' rows ka jhootha nishaan hata diya (ye dobara import '
           + 'hongi). ' + kept + ' rows sach me CRM me hain, unhe chhua nahi.');
  return done;
}

/** Abhi ki haalat dekhne ke liye. */
function statusIndiaMartAutoSync(){
  var src = ims_srcRows_();
  var done = 0, left = 0;
  src.rows.forEach(function(r){
    if(ims_lc_(r.mark) === ims_lc_(IMS_MARK_TEXT)) done++; else left++;
  });
  var idx = src.idx || {};
  var missing = [];
  ['enquiry_no','query_time','name','mobile','assigned'].forEach(function(f){ if(idx[f] == null) missing.push(f); });
  var writer = (typeof _upsertMany === 'function') ? '_upsertMany OK'
             : (typeof _upsert === 'function') ? '_upsert OK'
             : 'NAHI MILA — ye file CRM ke Apps Script project me nahi hai';
  var trig = 0;
  ScriptApp.getProjectTriggers().forEach(function(t){ if(t.getHandlerFunction() === 'indiaMartAutoSyncTick') trig++; });
  var blocked = 0;
  src.rows.forEach(function(r){ if(ims_skipAssigned_(r.assigned)) blocked++; });
  Logger.log('IndiaMartAutoSync status:\n  source tab   : ' + IMS_SRC_TAB
           + '\n  source rows  : ' + src.rows.length
           + '\n  ' + IMS_MARK_TEXT + '   : ' + done
           + '\n  baaki        : ' + left
           + '\n  mark column  : ' + (src.markCol ? ims_colName_(src.markCol) : 'NAHI MILA (koi khaali column dijiye)')
           + '\n  header map   : ' + (missing.length ? 'ye field nahi mile -> ' + missing.join(', ') : 'sab mil gaye')
           + '\n  writer       : ' + writer
           + '\n  trigger      : ' + trig
           + '\n  skip-list    : ' + (IMS_SKIP_ASSIGNED.join(', ') || '(koi nahi)')
           + ' -> ' + blocked + ' row CRM me nahi jaayengi'
           + '\n  CRM leads    : ' + ims_read_(IMS_COLL).length);
}

/* ================================================================== *
 * PURANI GALAT ASSIGNMENT KA SUDHAAR                                  *
 *                                                                     *
 * Pehle owner nikalne wala code character-prefix se milaata tha, aur  *
 * milte hi PEHLA user chun leta tha. Users list me jo sabse upar hai  *
 * (Ankush Goswami) uske naam par wo saari leads chali gayin jinka     *
 * sheet me likha naam kisi se pakka nahi milta tha.                   *
 *                                                                     *
 * Upar wala matcher ab theek ho chuka hai, par JO LEADS PEHLE HI      *
 * import ho chuki hain unka owner sheet me likha hua nahi, CRM me     *
 * likha hua hai. Ye do function unhe sheet ke hisaab se sudhaar dete  *
 * hain.                                                               *
 *                                                                     *
 * PEHLE  previewIndiaMartOwners()  chalaiye -- kuch badalta nahi,     *
 * sirf batata hai kya-kya badlega. Theek lage to phir                 *
 * fixIndiaMartOwners() chalaiye.                                      *
 *                                                                     *
 * Jispar kaam shuru ho chuka hai (status CREATED se aage hai) uska    *
 * owner JAAN-BOOJH KAR nahi chheda jaata -- ho sakta hai kisi ne      *
 * CRM me khud se sahi banda assign kiya ho. Sirf CREATED leads.       *
 * ================================================================== */

/** Kuch badalta nahi -- sirf dikhata hai kis lead ka owner badlega. */
function previewIndiaMartOwners(){ return ims_fixOwners_(true); }

/** Asli sudhaar. Pehle previewIndiaMartOwners() zaroor dekh lijiye. */
function fixIndiaMartOwners(){ return ims_fixOwners_(false); }

function ims_fixOwners_(dryRun){
  var out = [];
  out.push(dryRun ? '=== PREVIEW (kuch nahi badla) ===' : '=== SUDHAAR CHAL RAHA HAI ===');

  var roster = ims_roster_();
  var src;
  try{ src = ims_srcRows_(); }
  catch(e){ Logger.log('Source sheet nahi khuli: ' + e); return; }

  /* sheet me kis enquiry ka kaunsa salesperson likha hai */
  var byEno = {}, byPhTime = {};
  src.rows.forEach(function(r){
    if(r.enquiry_no) byEno[ims_key_(r.enquiry_no)] = r.assigned;
    var k = ims_phoneKey_(r.mobile) + '|' + ims_tsKey_(r.query_time);
    if(k !== '|') byPhTime[k] = r.assigned;
  });

  var leads = ims_read_(IMS_COLL);
  out.push('CRM me IndiaMART leads: ' + leads.length + ' | sheet me rows: ' + src.rows.length);

  var change = [], noSrc = 0, busy = 0, same = 0;
  leads.forEach(function(l){
    var sheetName = byEno[ims_key_(l.enquiry_no)];
    if(sheetName === undefined){
      sheetName = byPhTime[ims_phoneKey_(l.sender_mobile) + '|' + ims_tsKey_(l.query_time)];
    }
    if(sheetName === undefined){ noSrc++; return; }      /* sheet me ye row mili hi nahi */

    var want = ims_ownerFor_(sheetName, roster);
    var have = ims_lc_(l.owner);
    if(want === have){ same++; return; }

    /* jis lead par kaam shuru ho chuka hai use haath nahi lagate */
    var st = ims_lc_(l.lead_status || l.status);
    if(st && st !== 'created'){ busy++; return; }

    change.push({ rec: l, from: have, to: want, sheetName: sheetName });
  });

  out.push('pehle se theek: ' + same + ' | sheet me nahi mili: ' + noSrc
           + ' | kaam shuru ho chuka (chhod diya): ' + busy + ' | badlegi: ' + change.length);

  if(!change.length){
    out.push('Koi badlaav zaroori nahi.');
    Logger.log(out.join('\n'));
    return;
  }

  /* kaun se naam par kitni leads badal rahi hain */
  var tally = {};
  change.forEach(function(c){
    var k = (c.from || '(khaali)') + '  ->  ' + (c.to || '(khaali / unassigned)')
          + '   [sheet me likha: "' + (c.sheetName || '') + '"]';
    tally[k] = (tally[k] || 0) + 1;
  });
  out.push('--- badlaav ---');
  Object.keys(tally).sort().forEach(function(k){ out.push('  ' + tally[k] + ' lead   ' + k); });

  out.push('--- pehli 15 leads ---');
  change.slice(0, 15).forEach(function(c){
    out.push('  ' + (c.rec.sender_name || '?') + ' | ' + (c.rec.sender_mobile || '?')
             + ' | ' + (c.from || '(khaali)') + ' -> ' + (c.to || '(khaali)'));
  });

  if(dryRun){
    out.push('Ye sirf preview tha. Theek lage to fixIndiaMartOwners() chalaiye.');
    Logger.log(out.join('\n'));
    return;
  }

  var recs = change.map(function(c){
    c.rec.owner = c.to;
    c.rec.assigned_to = c.to ? (roster.byEmail[c.to] || c.sheetName) : c.sheetName;
    c.rec.updatedAt = new Date().toISOString();
    return c.rec;
  });
  var n = ims_write_(recs);
  out.push(n + ' lead ka owner sudhaar diya gaya.');
  out.push('Ab CRM me Reload & Update dabaiye.');
  Logger.log(out.join('\n'));
}
