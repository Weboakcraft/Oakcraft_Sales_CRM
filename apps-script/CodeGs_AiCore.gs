/**
 * INFORMATICS ANALYTICS -- AI CORE (v1.0.0, 11-11-2026)
 * ----------------------------------------------------------------------------
 * KYA KARTA HAI
 *   CRM ke tabs (enquiries, metaLeads, indiamartLeads, quotations, orders,
 *   dispatch, customers, activity, users) ko SIRF PADHTA hai aur ek ALAG
 *   spreadsheet "CRM AI Analytics" me ye banata hai:
 *     AI_Entity_Master  har lead / quotation / order ki ek row + category
 *     AI_Event_Log      chhoote hue badlaav (snapshot diff, har 15 min)
 *     AI_Snapshot       pichhli baar ki halat (diff ke liye)
 *     AI_Analysis       Gemini ka analysis (har baar nayi row, purani nahi mit-ti)
 *     AI_API_Logs       har Gemini call ka hisaab
 *     AI_Daily_Summary  roz ki ek row
 *     AI_Cache          dashboard ka taiyaar JSON
 *
 * PAKKE NIYAM
 *   - CRM ke kisi tab me kuch NAHI likhta. Status / follow-up kabhi nahi badalta.
 *   - save / saveMany ke raaste ko chhuta nahi (koi _upsertMany wrapper nahi).
 *     Sirf _route me `ai_*` naam ke naye actions jodta hai -- baaki sab action
 *     bina badle purane raaste par jaate hain.
 *   - Har `ai_*` action sirf Administrator ke liye (server par token se jaancha).
 *   - Gemini key sirf Script Properties (GEMINI_API_KEY) me. Kabhi wapas nahi bheji jaati.
 *
 * KAISE LAGAYEIN
 *   1. Apps Script project (Web_Sales_CRM) me nayi file: CodeGs_AiCore -- ye poora
 *      code paste -> Save. File list me SABSE NEECHE (StaleGuard ke baad).
 *   2. Doosri nayi file: CodeGs_AiGemini -- uska code paste -> Save.
 *   3. `ai_setup` Run (spreadsheet banata hai + pehla refresh) -> `ai_selfTest` Run.
 *   4. `ai_installTriggers` Run (15 min refresh, 30 min AI queue, roz subah summary).
 *   5. Deploy > Manage deployments > pencil > Version: New version > Deploy.
 *
 * WAPAS HATANA HO
 *   `ai_removeTriggers` Run, phir `var AI_ON = false;` -> Save -> New version deploy.
 */
var AI_ON  = true;
var AI_VER = '1.0.0';
var AI_PROP_SS = 'AI_SS_ID', AI_PROP_SET = 'AI_SETTINGS', AI_PROP_KEY = 'GEMINI_API_KEY';
var AI_SS_NAME = 'CRM AI Analytics (Informatics)';
var AI_IST_MS = 19800000, AI_DAY_MS = 86400000;
var AI_DEFAULTS = {
  enabled: true,          /* refresh trigger chale ya nahi */
  aiEnabled: true,        /* Gemini calls chalein ya nahi (key ho tab bhi band kar sakte hain) */
  model: '',              /* khaali = apne aap (gemini-flash-latest, warna list se) */
  inactiveDays: 7,        /* itne din koi activity nahi -> Inactive */
  untouchedHours: 24,     /* New lead itne ghante bina response -> Untouched */
  hotDays: 3,             /* Qualified/Quoted lead par itne din ke andar activity -> Hot */
  quoteFollowDays: 3,     /* quotation bheje itne din, order nahi -> Follow-up Needed */
  atRiskDays: 2,          /* order ki expected date itne din me -> At Risk */
  payPendingDays: 7,      /* delivered ke itne din baad payment pending -> alert */
  dailyAiCalls: 150,      /* ek din me zyada se zyada Gemini calls */
  batch: 15,              /* ek call me kitni leads */
  gstPct: 18,             /* billing = amount x (1 + gst) -- CRM dashboard jaisa */
  summaryEmail: ''        /* roz ki summary email (khaali = email nahi) */
};
var AI_ENT_HEAD = ['id','type','coll','source','name','phone','owner','ownerName','status','category','reason','priority',
  'created','lastActivity','daysIdle','followUp','amount','qty','product','city','linkId','linkConf',
  'aiIntent','aiScore','aiNext','aiSummary','aiConf','campaign','remarks'];
var AI_TABS = {
  AI_Entity_Master: AI_ENT_HEAD,
  AI_Event_Log: ['ts','coll','id','name','field','from','to','owner','detectedBy'],
  AI_Snapshot: ['id','coll','sig'],
  AI_Analysis: ['ts','id','coll','sig','intent','score','next_action','summary','confidence','model'],
  AI_API_Logs: ['ts','task','model','ok','ms','promptTokens','outputTokens','items','error'],
  AI_Daily_Summary: ['date','leads','newLeads','openLeads','hot','followOverdue','inactive','untouched','openQuotes','openQuoteValue','openOrders','delayedOrders','monthBilling','insights'],
  AI_Cache: ['chunk']
};
var AI_STATUS_ALIAS = {
  NEW:'CREATED', OPEN:'CREATED', FRESH:'CREATED', CREATED:'CREATED',
  CALLED:'CONTACTED', CONTACTED:'CONTACTED',
  CALL_NOT_PICK:'CALL_NOT_PICK', CALL_NOT_PICKED:'CALL_NOT_PICK', CALLNOTPICK:'CALL_NOT_PICK', NOT_PICKED:'CALL_NOT_PICK', CNP:'CALL_NOT_PICK',
  FOLLOW_UP:'FOLLOW_UP', FOLLOWUP:'FOLLOW_UP',
  INTERESTED:'QUALIFIED', QUALIFIED:'QUALIFIED',
  NOT_QUALIFIED:'NOT_QUALIFIED', NOTQUALIFIED:'NOT_QUALIFIED', NON_QUALIFIED:'NOT_QUALIFIED', NONQUALIFIED:'NOT_QUALIFIED',
  UNQUALIFIED:'NOT_QUALIFIED', DISQUALIFIED:'NOT_QUALIFIED',
  SYSTEM_MASTER:'SYSTEM_MASTER', SYSTEMMASTER:'SYSTEM_MASTER', SYSTEM:'SYSTEM_MASTER',
  QUOTATION_SENT:'QUOTATION_SENT', QUOTATIONSENT:'QUOTATION_SENT', QUOTED:'QUOTATION_SENT',
  QUOTATION:'QUOTATION_SENT', PROPOSAL:'QUOTATION_SENT', QUOTE_SENT:'QUOTATION_SENT',
  WON:'WON', CONVERTED:'WON', CLOSED_WON:'WON',
  LOST:'LOST', CLOSED:'LOST', REJECTED:'LOST', NOT_INTERESTED:'LOST', CLOSED_LOST:'LOST'
};
var AI_STATUS_LABEL = { CREATED:'New', CONTACTED:'Contacted', CALL_NOT_PICK:'Call Not Pick', FOLLOW_UP:'Follow-up', QUALIFIED:'Qualified',
  NOT_QUALIFIED:'Not Qualified', SYSTEM_MASTER:'System Master', QUOTATION_SENT:'Quotation Sent', WON:'Won', LOST:'Lost' };
var AI_FUNNEL = ['CREATED','CONTACTED','CALL_NOT_PICK','FOLLOW_UP','QUALIFIED','SYSTEM_MASTER','QUOTATION_SENT','WON','NOT_QUALIFIED','LOST'];

/* ====================================================================== *
 * 1. CHHOTE HELPERS (pure -- node me bhi test hote hain)                  *
 * ====================================================================== */
function ai_s_(v){ return (v === null || v === undefined) ? '' : String(v).replace(/^\s+|\s+$/g, ''); }
function ai_lc_(v){ return ai_s_(v).toLowerCase(); }
function ai_num_(v){ var n = parseFloat(String(v === null || v === undefined ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; }
function ai_ph_(v){ var d = String(v === null || v === undefined ? '' : v).replace(/\D/g, ''); d = d.slice(-10); return d.length === 10 ? d : ''; }
function ai_nm_(v){ return ai_lc_(v).replace(/[^a-z0-9]/g, ''); }
function ai_p2_(n){ return (n < 10 ? '0' : '') + n; }
/* kisi bhi tareekh ko ms me (IST maan kar). Samajh na aaye to 0. */
function ai_ms_(v){
  if(v === null || v === undefined || v === '') return 0;
  if(Object.prototype.toString.call(v) === '[object Date]'){ var t0 = v.getTime(); return isNaN(t0) ? 0 : t0; }
  if(typeof v === 'number') return v > 1e11 ? v : 0;
  var s = ai_s_(v), m, t;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if(m){
    if(/[zZ]$|[+\-]\d{2}:?\d{2}$/.test(s) && s.indexOf('T') > 0){ t = Date.parse(s); return isNaN(t) ? 0 : t; }
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) - AI_IST_MS;
  }
  m = s.match(/^(\d{1,2})[\-\/.](\d{1,2})[\-\/.](\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([aApP][mM])?)?/);
  if(m){
    var hh = +(m[4] || 0);
    if(m[7]){ var ap = m[7].toLowerCase(); if(ap === 'pm' && hh < 12) hh += 12; if(ap === 'am' && hh === 12) hh = 0; }
    return Date.UTC(+m[3], +m[2] - 1, +m[1], hh, +(m[5] || 0), +(m[6] || 0)) - AI_IST_MS;
  }
  t = Date.parse(s); return isNaN(t) ? 0 : t;
}
/* ms -> 'yyyy-MM-dd' (IST) */
function ai_day_(ms){
  if(!ms) return '';
  var d = new Date(ms + AI_IST_MS);
  return d.getUTCFullYear() + '-' + ai_p2_(d.getUTCMonth() + 1) + '-' + ai_p2_(d.getUTCDate());
}
function ai_month_(ms){ return ai_day_(ms).slice(0, 7); }
function ai_daysBetween_(fromMs, toMs){ if(!fromMs || !toMs) return 0; return Math.floor((toMs - fromMs) / AI_DAY_MS); }
function ai_status_(v){
  var c = ai_s_(v).toUpperCase().replace(/[\s\-\/]+/g, '_').replace(/_+/g, '_');
  if(!c) return 'CREATED';
  return AI_STATUS_ALIAS[c] || c;
}
function ai_hash_(s){
  var h = 5381, i; s = String(s);
  for(i = 0; i < s.length; i++){ h = ((h << 5) + h + s.charCodeAt(i)) | 0; }
  return (h >>> 0).toString(36);
}
function ai_cut_(s, n){ s = ai_s_(s).replace(/\s+/g, ' '); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function ai_pct_(a, b){ return b ? Math.round(a / b * 1000) / 10 : 0; }
function ai_max_(){ var m = 0, i; for(i = 0; i < arguments.length; i++){ if(arguments[i] > m) m = arguments[i]; } return m; }

/* ====================================================================== *
 * 2. BUILD -- CRM data se entities, categories, alerts, dashboard (pure)  *
 *    D = { enquiries, metaLeads, indiamartLeads, quotations, orders,      *
 *          dispatch, customers, activity, users, analysis{id:{..}} }      *
 * ====================================================================== */
function ai_build_(D, S, nowMs){
  var today = ai_day_(nowMs), thisMonth = today.slice(0, 7);
  var gst = 1 + (ai_num_(S.gstPct) / 100);
  var bill = function(a){ return Math.round(ai_num_(a) * gst); };
  var i, k;

  /* ---- lookups ---- */
  var userName = {};
  (D.users || []).forEach(function(u){ var e = ai_lc_(u.email); if(e) userName[e] = ai_s_(u.name) || e; });
  var custById = {};
  (D.customers || []).forEach(function(c){ if(c && c.id) custById[String(c.id)] = c; });
  var lastAct = {}, firstActMs = 0;
  (D.activity || []).forEach(function(a){
    var t = ai_ms_(a.ts), id = ai_s_(a.recId);
    if(!t) return;
    if(!firstActMs || t < firstActMs) firstActMs = t;
    if(id && t > (lastAct[id] || 0)) lastAct[id] = t;
  });
  var analysis = D.analysis || {};
  function ownerName(owner, fallback){ return userName[owner] || ai_s_(fallback) || (owner ? owner : 'Unassigned'); }

  /* ---- orders ---- */
  var dispByOrder = {};
  (D.dispatch || []).forEach(function(d){ if(d && d.orderId) dispByOrder[String(d.orderId)] = d; });
  var orders = [];
  (D.orders || []).forEach(function(o){
    if(!o || !o.id) return;
    var c = custById[String(o.custId || '')] || {};
    var created = ai_ms_(o.date) || ai_ms_(o.createdAt);
    var owner = ai_lc_(o.owner);
    orders.push({
      id: String(o.id), type: 'order', coll: 'orders', source: '', name: ai_s_(o.customer), phone: ai_ph_(c.phone || c.mobile),
      custId: ai_s_(o.custId), owner: owner, ownerName: ownerName(owner, o.salesperson),
      status: ai_s_(o.status) || 'Confirmed', created: created, amount: ai_num_(o.amount), qty: ai_num_(o.qty),
      product: ai_s_(o.product), city: ai_s_(c.city), exp: ai_s_(o.expDispatch).slice(0, 10), payment: ai_s_(o.payment),
      quoteId: ai_s_(o.quoteId), leadRef: ai_s_(o.leadRef), last: ai_max_(created, lastAct[String(o.id)] || 0),
      disp: dispByOrder[String(o.id)] || null, linkId: '', linkConf: 0, nameKey: ai_nm_(o.customer)
    });
  });
  var live = function(o){ return o.status !== 'Cancelled'; };

  /* ---- leads ---- */
  var leads = [];
  function addLead(coll, r){
    if(!r || !r.id) return;
    var src, st, created, phone, name, c;
    if(coll === 'indiamartLeads'){
      src = 'IndiaMART'; st = ai_status_(r.lead_status || r.stage || r.status);
      created = ai_ms_(r.query_time) || ai_ms_(r.date) || ai_ms_(r.createdAt);
      phone = ai_ph_(r.sender_mobile); name = ai_s_(r.sender_name) || ai_s_(r.company);
    } else if(coll === 'metaLeads'){
      src = (ai_lc_(r.platform) === 'gem' || ai_lc_(r.source) === 'gem') ? 'GEM' : 'Meta';
      st = ai_status_(r.lead_status || r.stage);
      created = ai_ms_(r.created_time_ist) || ai_ms_(r.createdAt);
      phone = ai_ph_(r.phone_number || r.phone); name = ai_s_(r.full_name) || ai_s_(r.name);
    } else {
      src = ai_s_(r.source) || 'Direct'; st = ai_status_(r.stage);
      created = ai_ms_(r.date) || ai_ms_(r.createdAt);
      c = custById[String(r.custId || '')] || {};
      phone = ai_ph_(c.phone || c.mobile); name = ai_s_(r.customer);
    }
    var owner = ai_lc_(r.owner);
    var last = ai_max_(created, lastAct[String(r.id)] || 0, ai_ms_(r.statusUpdatedAt), ai_ms_(r.stageChangedAt),
                       ai_ms_(r.followUpAt), ai_ms_(r.respAt), ai_ms_(r.coordStatusAt), ai_ms_(r.qualifiedAt));
    var rem = [r.note, r.discussion, r.final_remarks, r.followUpNote, r.subject].map(ai_s_).filter(function(x){ return !!x; }).join(' | ');
    var an = analysis[String(r.id)] || null;
    leads.push({
      id: String(r.id), type: 'lead', coll: coll, source: src, name: name, phone: phone, custId: ai_s_(r.custId),
      owner: owner, ownerName: ownerName(owner, r.assigned_to || r.salesperson), status: st, created: created, last: last,
      followUp: ai_s_(r.followUpDate).slice(0, 10), amount: ai_num_(r.value), qty: ai_num_(r.qty || r.quantity || r.qualQty),
      product: ai_s_(r.product), city: ai_s_(r.city_state || r.sender_city_state || r.city || (c && c.city)),
      remarks: ai_cut_(rem, 600), respMins: (r.respMins === '' || r.respMins === null || r.respMins === undefined) ? null : ai_num_(r.respMins),
      responded: !!(r.respAt || (lastAct[String(r.id)] || 0) > created + 60000 || st !== 'CREATED'),
      campaign: ai_s_(r.campaign_name || r.campaign), linkId: '', linkConf: 0, orderIds: [], revenue: 0,
      aiIntent: an ? an.intent : '', aiScore: an ? an.score : '', aiNext: an ? an.next : '', aiSummary: an ? an.summary : '', aiConf: an ? an.conf : '',
      aiSig: an ? an.sig : ''
    });
  }
  (D.enquiries || []).forEach(function(r){ addLead('enquiries', r); });
  (D.indiamartLeads || []).forEach(function(r){ addLead('indiamartLeads', r); });
  (D.metaLeads || []).forEach(function(r){ addLead('metaLeads', r); });

  /* ---- order -> lead (har order zyada se zyada EK lead ko) ---- */
  var leadById = {}, leadsByPhone = {}, leadsByCust = {};
  leads.forEach(function(l){
    leadById[l.id] = l;
    if(l.phone){ (leadsByPhone[l.phone] = leadsByPhone[l.phone] || []).push(l); }
    if(l.coll === 'enquiries' && l.custId){ (leadsByCust[l.custId] = leadsByCust[l.custId] || []).push(l); }
  });
  function latestBefore(list, ms){
    var best = null;
    (list || []).forEach(function(l){ if(l.created && l.created <= ms + AI_DAY_MS && (!best || l.created > best.created)) best = l; });
    return best;
  }
  orders.forEach(function(o){
    var l = null, conf = 0;
    if(o.leadRef && leadById[o.leadRef]){ l = leadById[o.leadRef]; conf = 1; }
    if(!l && o.phone){ l = latestBefore(leadsByPhone[o.phone], o.created); if(l) conf = 0.8; }
    if(!l && o.custId){ l = latestBefore(leadsByCust[o.custId], o.created); if(l) conf = 0.6; }
    if(!l) return;
    o.linkId = l.id; o.linkConf = conf; o.source = l.source;
    l.orderIds.push(o.id);
    if(live(o)) l.revenue += bill(o.amount);
    if(!l.linkId || conf > l.linkConf){ l.linkId = o.id; l.linkConf = conf; }
  });

  /* ---- lead categories ---- */
  var OPEN = { CREATED:1, CONTACTED:1, CALL_NOT_PICK:1, FOLLOW_UP:1, QUALIFIED:1, SYSTEM_MASTER:1, QUOTATION_SENT:1 };
  leads.forEach(function(l){
    var idle = ai_daysBetween_(l.last, nowMs), age = l.created ? (nowMs - l.created) / 3600000 : 0;
    l.daysIdle = idle; l.open = !!OPEN[l.status];
    var cat, why, pr;
    if(l.status === 'WON' || l.orderIds.length){
      cat = 'Converted'; pr = 0;
      why = l.orderIds.length ? ('Order ' + l.orderIds[0] + ' se juda (' + (l.linkConf === 1 ? 'pakka link' : l.linkConf === 0.8 ? 'phone match' : 'customer match') + ')') : 'Status Won';
      l.open = false;
    } else if(l.status === 'LOST'){ cat = 'Lost'; why = 'Status Lost'; pr = 0; }
    else if(l.status === 'NOT_QUALIFIED'){ cat = 'Not Qualified'; why = 'Status Not Qualified'; pr = 0; }
    else if(l.followUp && l.followUp < today){
      var od = ai_daysBetween_(ai_ms_(l.followUp), nowMs);
      cat = 'Follow-up Overdue'; why = 'Follow-up ' + l.followUp + ' ko tha, ' + od + ' din late'; pr = Math.min(95, 70 + od * 3);
    } else if(l.followUp && l.followUp === today){ cat = 'Follow-up Due Today'; why = 'Aaj follow-up hai'; pr = 80; }
    else if(l.status === 'CREATED' && !l.responded && age >= ai_num_(S.untouchedHours)){
      cat = 'Untouched'; why = Math.round(age / 24 * 10) / 10 + ' din se New, koi response nahi'; pr = Math.min(90, 60 + Math.round(age / 24) * 2);
    } else if(idle >= ai_num_(S.inactiveDays)){
      cat = 'Inactive'; why = idle + ' din se koi activity nahi (status ' + (AI_STATUS_LABEL[l.status] || l.status) + ')';
      pr = (l.status === 'QUALIFIED' || l.status === 'QUOTATION_SENT' || l.status === 'SYSTEM_MASTER') ? 75 : 40;
    } else if((l.status === 'QUALIFIED' || l.status === 'QUOTATION_SENT' || l.status === 'SYSTEM_MASTER') && idle <= ai_num_(S.hotDays)){
      cat = 'Hot'; why = (AI_STATUS_LABEL[l.status] || l.status) + ', ' + idle + ' din pehle activity'; pr = 85;
    } else if(l.status === 'QUALIFIED' || l.status === 'QUOTATION_SENT' || l.status === 'SYSTEM_MASTER'){
      cat = 'Warm'; why = (AI_STATUS_LABEL[l.status] || l.status) + ', ' + idle + ' din se shaant'; pr = 65;
    } else if(l.status === 'CALL_NOT_PICK'){ cat = 'Unreachable'; why = 'Call nahi uthaya'; pr = 45; }
    else if(l.status === 'CONTACTED' || l.status === 'FOLLOW_UP'){
      cat = 'Warm'; why = (AI_STATUS_LABEL[l.status] || l.status) + (l.followUp ? ', follow-up ' + l.followUp : ', follow-up date nahi'); pr = 55;
    } else { cat = 'New'; why = 'Nayi lead'; pr = 50; }
    l.category = cat; l.reason = why; l.priority = pr;
  });

  /* ---- quotations ---- */
  var ordByPhone = {}, ordByName = {}, ordByQuote = {};
  orders.forEach(function(o){
    if(!live(o)) return;
    if(o.phone){ (ordByPhone[o.phone] = ordByPhone[o.phone] || []).push(o); }
    if(o.nameKey){ (ordByName[o.nameKey] = ordByName[o.nameKey] || []).push(o); }
    if(o.quoteId) ordByQuote[o.quoteId] = o;
  });
  function firstAfter(list, ms){
    var best = null;
    (list || []).forEach(function(o){ if(o.created >= ms - AI_DAY_MS && (!best || o.created < best.created)) best = o; });
    return best;
  }
  var quotes = [];
  (D.quotations || []).forEach(function(q){
    if(!q || !q.id) return;
    var qb = q.qb || {};
    var created = ai_ms_(q.date) || ai_ms_(qb.date) || ai_ms_(q.createdAt);
    var valid = ai_s_(q.validTill || qb.valid).slice(0, 10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(valid)){
      var vd = ai_ms_(q.validTill || qb.valid);
      valid = vd ? ai_day_(vd) : (created && ai_num_(q.validDays) ? ai_day_(created + ai_num_(q.validDays) * AI_DAY_MS) : '');
    }
    var owner = ai_lc_(q.owner), phone = ai_ph_(qb.cph), nk = ai_nm_(qb.co || q.customer);
    var st = ai_s_(q.status) || 'Draft';
    var o = ordByQuote[String(q.id)] || null, conf = o ? 1 : 0;
    if(!o && phone){ o = firstAfter(ordByPhone[phone], created); if(o) conf = 0.8; }
    if(!o && nk && nk.length >= 5){ o = firstAfter(ordByName[nk], created); if(o) conf = 0.6; }
    var age = ai_daysBetween_(created, nowMs), cat, why, pr;
    if(o || st === 'Accepted'){ cat = 'Converted'; why = o ? ('Order ' + o.id + (conf === 1 ? ' (pakka link)' : conf === 0.8 ? ' (phone match)' : ' (naam match)')) : 'Status Accepted'; pr = 0; }
    else if(st === 'Rejected'){ cat = 'Rejected'; why = 'Status Rejected'; pr = 0; }
    else if(st === 'Draft'){ cat = 'Draft'; why = 'Abhi bheji nahi'; pr = 30; }
    else if(valid && valid < today){ cat = 'Expired'; why = 'Valid till ' + valid + ' nikal gaya, order nahi'; pr = 35; }
    else if(age >= ai_num_(S.quoteFollowDays)){ cat = 'Follow-up Needed'; why = age + ' din pehle bheji, order nahi'; pr = Math.min(85, 55 + age); }
    else { cat = 'Fresh'; why = age + ' din pehle bheji'; pr = 50; }
    quotes.push({
      id: String(q.id), type: 'quotation', coll: 'quotations', source: '', name: ai_s_(qb.co || q.customer), phone: phone,
      owner: owner, ownerName: ownerName(owner, q.salesperson || qb.rep), status: st, created: created, last: ai_max_(created, lastAct[String(q.id)] || 0),
      amount: ai_num_(q.amount), qty: ai_num_(q.qty), product: ai_s_(q.product), city: ai_s_(qb.state), valid: valid, qno: ai_s_(qb.qno),
      linkId: o ? o.id : '', linkConf: conf, category: cat, reason: why, priority: pr, daysIdle: age, open: (cat === 'Fresh' || cat === 'Follow-up Needed' || cat === 'Draft')
    });
  });

  /* ---- order categories ---- */
  orders.forEach(function(o){
    var cat, why, pr, d = o.disp, late;
    if(o.status === 'Cancelled'){ cat = 'Cancelled'; why = 'Order cancel'; pr = 0; }
    else if(o.status === 'Delivered'){
      var dAge = ai_daysBetween_(o.last, nowMs);
      if(o.payment && o.payment !== 'Paid' && dAge >= ai_num_(S.payPendingDays)){ cat = 'Payment Pending'; why = 'Delivered, payment ' + o.payment + ' (' + dAge + ' din)'; pr = 60; }
      else { cat = 'Delivered'; why = 'Delivered'; pr = 0; }
    } else if(o.status === 'Dispatched'){
      if(d && ai_s_(d.status) !== 'Delivered' && ai_s_(d.eta) && ai_s_(d.eta).slice(0, 10) < today){ cat = 'Delivery Overdue'; why = 'ETA ' + ai_s_(d.eta).slice(0, 10) + ' nikal gaya'; pr = 65; }
      else { cat = 'Dispatched'; why = 'Raaste me'; pr = 20; }
    } else if(o.exp && o.exp < today){
      late = ai_daysBetween_(ai_ms_(o.exp), nowMs);
      cat = 'Delayed'; why = 'Expected ' + o.exp + ', ' + late + ' din late (status ' + o.status + ')'; pr = Math.min(98, 80 + late);
    } else if(o.exp && ai_daysBetween_(nowMs, ai_ms_(o.exp) + AI_DAY_MS) <= ai_num_(S.atRiskDays) && o.status !== 'Ready'){
      cat = 'At Risk'; why = 'Expected ' + o.exp + ', abhi ' + o.status; pr = 70;
    } else { cat = 'On Track'; why = 'Status ' + o.status + (o.exp ? ', expected ' + o.exp : ''); pr = 25; }
    o.category = cat; o.reason = why; o.priority = pr; o.daysIdle = ai_daysBetween_(o.last, nowMs);
    o.open = !(o.status === 'Delivered' || o.status === 'Cancelled');
    o.trackPending = !!(d && (/^TRK\d{7}$/.test(ai_s_(d.tracking)) || !ai_s_(d.tracking)) && ai_s_(d.status) !== 'Delivered');
  });

  /* ---- alerts ---- */
  var alerts = [];
  function alert(sev, type, e, title){
    alerts.push({ sev: sev, type: type, id: e.id, coll: e.coll, name: e.name, owner: e.ownerName, source: e.source || '', title: title, pr: e.priority || 0, amount: e.amount || 0 });
  }
  leads.forEach(function(l){
    if(l.category === 'Follow-up Overdue') alert(l.priority >= 80 ? 'high' : 'medium', 'Follow-up Overdue', l, l.reason);
    else if(l.category === 'Untouched') alert('high', 'Untouched Lead', l, l.reason);
    else if(l.category === 'Inactive' && l.priority >= 75) alert('medium', 'Qualified Lead Inactive', l, l.reason);
  });
  quotes.forEach(function(q){
    if(q.category === 'Follow-up Needed') alert(q.daysIdle >= 10 ? 'medium' : 'low', 'Quotation Follow-up', q, q.reason);
  });
  orders.forEach(function(o){
    if(o.category === 'Delayed') alert('high', 'Order Delayed', o, o.reason);
    else if(o.category === 'At Risk') alert('medium', 'Order At Risk', o, o.reason);
    else if(o.category === 'Payment Pending') alert('medium', 'Payment Pending', o, o.reason);
    else if(o.category === 'Delivery Overdue') alert('medium', 'Delivery Overdue', o, o.reason);
    if(o.trackPending && o.status === 'Dispatched') alert('low', 'Tracking Pending', o, 'Dispatch row me asli courier / tracking number nahi');
  });
  var SEV = { high: 3, medium: 2, low: 1 };
  alerts.sort(function(a, b){ return (SEV[b.sev] - SEV[a.sev]) || (b.pr - a.pr) || (b.amount - a.amount); });
  var alertCounts = {};
  alerts.forEach(function(a){ alertCounts[a.type] = (alertCounts[a.type] || 0) + 1; });

  /* ---- aggregates ---- */
  function inc(m, key, n){ m[key] = (m[key] || 0) + (n === undefined ? 1 : n); }
  var PERIODS = { all: 0, d7: nowMs - 7 * AI_DAY_MS, d30: nowMs - 30 * AI_DAY_MS, d90: nowMs - 90 * AI_DAY_MS, month: ai_ms_(thisMonth + '-01') };
  function reached(l, lvl){
    var s = l.status;
    if(lvl === 'contacted') return s !== 'CREATED';
    if(lvl === 'qualified') return s === 'QUALIFIED' || s === 'SYSTEM_MASTER' || s === 'QUOTATION_SENT' || s === 'WON' || l.category === 'Converted';
    if(lvl === 'quoted') return s === 'QUOTATION_SENT' || s === 'WON' || l.category === 'Converted';
    return false;
  }
  function groupLeads(keyFn, since){
    var m = {}, order = [];
    leads.forEach(function(l){
      if(since && (!l.created || l.created < since)) return;
      var key = keyFn(l), g = m[key];
      if(!g){ g = m[key] = { key: key, leads: 0, open: 0, contacted: 0, qualified: 0, quoted: 0, won: 0, lost: 0, notQualified: 0, hot: 0, overdue: 0, inactive: 0, untouched: 0, revenue: 0, respSum: 0, respN: 0 }; order.push(key); }
      g.leads++;
      if(l.open) g.open++;
      if(reached(l, 'contacted')) g.contacted++;
      if(reached(l, 'qualified')) g.qualified++;
      if(reached(l, 'quoted')) g.quoted++;
      if(l.category === 'Converted') g.won++;
      if(l.status === 'LOST') g.lost++;
      if(l.status === 'NOT_QUALIFIED') g.notQualified++;
      if(l.category === 'Hot') g.hot++;
      if(l.category === 'Follow-up Overdue') g.overdue++;
      if(l.category === 'Inactive') g.inactive++;
      if(l.category === 'Untouched') g.untouched++;
      g.revenue += l.revenue;
      if(l.respMins !== null && l.respMins >= 0){ g.respSum += l.respMins; g.respN++; }
    });
    return order.map(function(key){
      var g = m[key];
      g.convPct = ai_pct_(g.won, g.leads); g.qualPct = ai_pct_(g.qualified, g.leads);
      g.avgResp = g.respN ? Math.round(g.respSum / g.respN * 10) / 10 : null;
      delete g.respSum;
      return g;
    }).sort(function(a, b){ return b.leads - a.leads; });
  }
  var bySource = {}, bySales = {};
  for(k in PERIODS){ if(PERIODS.hasOwnProperty(k)){
    bySource[k] = groupLeads(function(l){ return l.source; }, PERIODS[k]);
    bySales[k]  = groupLeads(function(l){ return l.ownerName; }, PERIODS[k]);
  } }
  /* salesperson: quotations + orders bhi */
  var spExtra = {};
  for(k in PERIODS){ if(PERIODS.hasOwnProperty(k)){
    spExtra[k] = {};
    (function(since, bucket){
      function g(name){ return bucket[name] = bucket[name] || { quotes: 0, quoteValue: 0, quotesConverted: 0, orders: 0, billing: 0, delayed: 0 }; }
      quotes.forEach(function(q){ if(since && q.created < since) return; var x = g(q.ownerName); x.quotes++; x.quoteValue += q.amount; if(q.category === 'Converted') x.quotesConverted++; });
      orders.forEach(function(o){ if(!live(o) || (since && o.created < since)) return; var x = g(o.ownerName); x.orders++; x.billing += bill(o.amount); if(o.category === 'Delayed') x.delayed++; });
    })(PERIODS[k], spExtra[k]);
    bySales[k].forEach(function(row){ var x = spExtra[k][row.key] || {}; row.quotes = x.quotes || 0; row.quoteValue = x.quoteValue || 0; row.quotesConverted = x.quotesConverted || 0; row.orders = x.orders || 0; row.billing = x.billing || 0; row.delayed = x.delayed || 0; if(spExtra[k][row.key]) spExtra[k][row.key]._used = 1; });
    for(var nm in spExtra[k]){ if(spExtra[k].hasOwnProperty(nm) && !spExtra[k][nm]._used){
      var x2 = spExtra[k][nm];
      bySales[k].push({ key: nm, leads: 0, open: 0, contacted: 0, qualified: 0, quoted: 0, won: 0, lost: 0, notQualified: 0, hot: 0, overdue: 0, inactive: 0, untouched: 0, revenue: 0, respN: 0, convPct: 0, qualPct: 0, avgResp: null,
        quotes: x2.quotes, quoteValue: x2.quoteValue, quotesConverted: x2.quotesConverted, orders: x2.orders, billing: x2.billing, delayed: x2.delayed });
    } }
  } }

  var catLead = {}, funnel = {}, catQuote = {}, catOrder = {}, quoteStatus = {}, orderStatus = {}, aiIntent = {};
  leads.forEach(function(l){ inc(catLead, l.category); inc(funnel, l.status); if(l.open && l.aiIntent) inc(aiIntent, l.aiIntent); });
  quotes.forEach(function(q){ inc(catQuote, q.category); inc(quoteStatus, q.status); });
  orders.forEach(function(o){ inc(catOrder, o.category); inc(orderStatus, o.status); });

  /* order billing by source (linked lead ka source; baaki 'Link nahi') */
  var revBySource = {}, linkStats = { explicit: 0, phone: 0, customer: 0, none: 0 };
  orders.forEach(function(o){
    if(!live(o)) return;
    inc(revBySource, o.source || 'Link nahi', bill(o.amount));
    if(o.linkConf === 1) linkStats.explicit++; else if(o.linkConf === 0.8) linkStats.phone++; else if(o.linkConf === 0.6) linkStats.customer++; else linkStats.none++;
  });

  /* trends */
  var weeks = [], wIdx = {}, w;
  var dow = new Date(nowMs + AI_IST_MS).getUTCDay();           /* 0 = Sunday */
  var weekStart = ai_ms_(today) - ((dow + 6) % 7) * AI_DAY_MS;  /* is hafte ka Monday */
  for(w = 11; w >= 0; w--){ var ws = weekStart - w * 7 * AI_DAY_MS; wIdx[ai_day_(ws)] = weeks.length; weeks.push({ week: ai_day_(ws), total: 0, bySource: {} }); }
  leads.forEach(function(l){
    if(!l.created || l.created < weekStart - 11 * 7 * AI_DAY_MS) return;
    var d0 = new Date(l.created + AI_IST_MS).getUTCDay();
    var key = ai_day_(ai_ms_(ai_day_(l.created)) - ((d0 + 6) % 7) * AI_DAY_MS), ix = wIdx[key];
    if(ix === undefined) return;
    weeks[ix].total++; inc(weeks[ix].bySource, l.source);
  });
  var months = [], mIdx = {}, mm, base = new Date(nowMs + AI_IST_MS);
  for(mm = 5; mm >= 0; mm--){
    var dt = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - mm, 1));
    var mk = dt.getUTCFullYear() + '-' + ai_p2_(dt.getUTCMonth() + 1);
    mIdx[mk] = months.length; months.push({ month: mk, orders: 0, billing: 0, leads: 0, quotes: 0, quoteValue: 0 });
  }
  orders.forEach(function(o){ var ix = mIdx[ai_month_(o.created)]; if(ix !== undefined && live(o)){ months[ix].orders++; months[ix].billing += bill(o.amount); } });
  leads.forEach(function(l){ var ix = mIdx[ai_month_(l.created)]; if(ix !== undefined) months[ix].leads++; });
  quotes.forEach(function(q){ var ix = mIdx[ai_month_(q.created)]; if(ix !== undefined){ months[ix].quotes++; months[ix].quoteValue += q.amount; } });

  /* KPIs */
  var openLeads = 0, newToday = 0, new7 = 0;
  leads.forEach(function(l){ if(l.open) openLeads++; if(ai_day_(l.created) === today) newToday++; if(l.created >= PERIODS.d7) new7++; });
  var openQuotes = 0, openQuoteValue = 0, quotesConv = 0, quotesSent = 0;
  quotes.forEach(function(q){ if(q.open && q.category !== 'Draft'){ openQuotes++; openQuoteValue += q.amount; } if(q.status !== 'Draft') quotesSent++; if(q.category === 'Converted') quotesConv++; });
  var openOrders = 0, openOrderValue = 0, monthBilling = 0, monthOrders = 0, totalBilling = 0, payPendingValue = 0;
  orders.forEach(function(o){
    if(!live(o)) return;
    totalBilling += bill(o.amount);
    if(o.open){ openOrders++; openOrderValue += bill(o.amount); }
    if(ai_month_(o.created) === thisMonth){ monthBilling += bill(o.amount); monthOrders++; }
    if(o.category === 'Payment Pending') payPendingValue += bill(o.amount);
  });
  var kpis = {
    leads: leads.length, openLeads: openLeads, newToday: newToday, new7: new7,
    hot: catLead['Hot'] || 0, warm: catLead['Warm'] || 0, followOverdue: catLead['Follow-up Overdue'] || 0, followToday: catLead['Follow-up Due Today'] || 0,
    untouched: catLead['Untouched'] || 0, inactive: catLead['Inactive'] || 0, converted: catLead['Converted'] || 0,
    leadConvPct: ai_pct_(catLead['Converted'] || 0, leads.length),
    quotes: quotes.length, openQuotes: openQuotes, openQuoteValue: openQuoteValue, quoteConvPct: ai_pct_(quotesConv, quotesSent),
    quoteFollow: catQuote['Follow-up Needed'] || 0, quoteExpired: catQuote['Expired'] || 0,
    orders: orders.length, openOrders: openOrders, openOrderValue: openOrderValue, delayedOrders: catOrder['Delayed'] || 0, atRiskOrders: catOrder['At Risk'] || 0,
    monthBilling: monthBilling, monthOrders: monthOrders, totalBilling: totalBilling, payPending: catOrder['Payment Pending'] || 0, payPendingValue: payPendingValue,
    alertsHigh: alerts.filter(function(a){ return a.sev === 'high'; }).length, alerts: alerts.length
  };

  /* predictions -- sirf jitna data sach me support karta hai */
  var histDays = firstActMs ? ai_daysBetween_(firstActMs, nowMs) : 0;
  var dayOfMonth = +today.slice(8, 10), dim = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7), 0)).getUTCDate();
  var monthLeads = months.length ? months[months.length - 1].leads : 0;
  var pred = {
    historyDays: histDays, enough: histDays >= 90,
    runRate: { dayOfMonth: dayOfMonth, daysInMonth: dim,
      billing: dayOfMonth ? Math.round(monthBilling / dayOfMonth * dim) : 0,
      orders: dayOfMonth ? Math.round(monthOrders / dayOfMonth * dim) : 0,
      leads: dayOfMonth ? Math.round(monthLeads / dayOfMonth * dim) : 0 }
  };
  if(pred.enough){
    var base90 = bySource.d90, tot90 = 0, won90 = 0;
    base90.forEach(function(g){ tot90 += g.leads; won90 += g.won; });
    var rate = tot90 ? won90 / tot90 : 0;
    pred.expectedConversions = Math.round(((catLead['Hot'] || 0) + (catLead['Warm'] || 0)) * rate * 10) / 10;
    pred.convRate90 = Math.round(rate * 1000) / 10;
  }

  /* snapshot (diff ke liye) */
  var snap = {};
  leads.forEach(function(l){ snap[l.id] = { coll: l.coll, name: l.name, owner: l.ownerName, f: { status: AI_STATUS_LABEL[l.status] || l.status, owner: l.owner, followUpDate: l.followUp } }; });
  quotes.forEach(function(q){ snap[q.id] = { coll: q.coll, name: q.name, owner: q.ownerName, f: { status: q.status, amount: String(q.amount), validTill: q.valid } }; });
  orders.forEach(function(o){
    snap[o.id] = { coll: o.coll, name: o.name, owner: o.ownerName, f: { status: o.status, payment: o.payment, amount: String(o.amount), expDispatch: o.exp } };
    if(o.disp && o.disp.id) snap[String(o.disp.id)] = { coll: 'dispatch', name: o.name, owner: o.ownerName, f: { status: ai_s_(o.disp.status), courier: ai_s_(o.disp.courier), tracking: ai_s_(o.disp.tracking) } };
  });

  /* entity rows */
  var all = leads.concat(quotes, orders), rows = [];
  all.forEach(function(e){
    rows.push([e.id, e.type, e.coll, e.source || '', e.name, e.phone || '', e.owner, e.ownerName, e.type === 'lead' ? (AI_STATUS_LABEL[e.status] || e.status) : e.status,
      e.category, e.reason, e.priority, ai_day_(e.created), ai_day_(e.last), e.daysIdle || 0, e.followUp || e.valid || e.exp || '', e.amount || 0, e.qty || 0,
      ai_cut_(e.product, 120), ai_cut_(e.city, 60), e.linkId || '', e.linkConf || '', e.aiIntent || '', e.aiScore === undefined ? '' : e.aiScore, e.aiNext || '', e.aiSummary || '',
      e.aiConf === undefined ? '' : e.aiConf, e.campaign || '', e.remarks || '']);
  });

  /* Gemini ke liye: khuli leads jinke remarks hain aur analysis purana / nahi hai */
  var aiTodo = [];
  leads.forEach(function(l){
    if(!l.open || !l.remarks || l.remarks.length < 8) return;
    var sig = ai_hash_(l.status + '|' + l.remarks + '|' + l.followUp);
    if(l.aiSig === sig) return;
    aiTodo.push({ id: l.id, coll: l.coll, sig: sig, pr: l.priority, source: l.source, status: AI_STATUS_LABEL[l.status] || l.status, name: l.name, city: l.city,
      product: ai_cut_(l.product, 80), qty: l.qty, ageDays: ai_daysBetween_(l.created, nowMs), idleDays: l.daysIdle, followUp: l.followUp, remarks: l.remarks });
  });
  aiTodo.sort(function(a, b){ return b.pr - a.pr; });

  return {
    entities: rows, snapshot: snap, aiTodo: aiTodo, leads: leads, quotes: quotes, orders: orders,
    dashboard: {
      ver: AI_VER, generatedAt: new Date(nowMs).toISOString(), today: today,
      counts: { enquiries: (D.enquiries || []).length, metaLeads: (D.metaLeads || []).length, indiamartLeads: (D.indiamartLeads || []).length,
                quotations: quotes.length, orders: orders.length, dispatch: (D.dispatch || []).length, activity: (D.activity || []).length },
      kpis: kpis, bySource: bySource, bySales: bySales, funnel: AI_FUNNEL.map(function(c){ return { code: c, label: AI_STATUS_LABEL[c] || c, n: funnel[c] || 0 }; }),
      catLead: catLead, catQuote: catQuote, catOrder: catOrder, quoteStatus: quoteStatus, orderStatus: orderStatus, aiIntent: aiIntent,
      revBySource: revBySource, linkStats: linkStats, weeks: weeks, months: months, pred: pred,
      alerts: alerts.slice(0, 300), alertCounts: alertCounts, aiPending: aiTodo.length, settings: S
    }
  };
}

/* purane snapshot se tulna -> events */
function ai_diff_(oldSnap, newSnap, nowIso){
  var ev = [], id, f, o, n;
  for(id in newSnap){ if(!newSnap.hasOwnProperty(id)) continue;
    n = newSnap[id]; o = oldSnap[id];
    if(!o){ ev.push([nowIso, n.coll, id, n.name, 'created', '', n.f.status || '', n.owner, 'reconcile']); continue; }
    for(f in n.f){ if(!n.f.hasOwnProperty(f)) continue;
      var a = ai_s_(o[f]), b = ai_s_(n.f[f]);
      if(a !== b) ev.push([nowIso, n.coll, id, n.name, f, a, b, n.owner, 'reconcile']);
    }
  }
  for(id in oldSnap){ if(oldSnap.hasOwnProperty(id) && !newSnap[id]) ev.push([nowIso, oldSnap[id].__coll || '', id, '', 'deleted', '', '', '', 'reconcile']); }
  return ev;
}

/* ====================================================================== *
 * 3. APPS SCRIPT I/O                                                      *
 * ====================================================================== */
function ai_props_(){ return PropertiesService.getScriptProperties(); }
function ai_settings_(){
  var out = {}, k, saved = {};
  try{ saved = JSON.parse(ai_props_().getProperty(AI_PROP_SET) || '{}') || {}; }catch(e){ saved = {}; }
  for(k in AI_DEFAULTS){ if(AI_DEFAULTS.hasOwnProperty(k)) out[k] = (saved[k] === undefined || saved[k] === null) ? AI_DEFAULTS[k] : saved[k]; }
  return out;
}
function ai_saveSettings_(inp){
  var cur = ai_settings_(), k;
  for(k in AI_DEFAULTS){ if(!AI_DEFAULTS.hasOwnProperty(k) || !inp || inp[k] === undefined) continue;
    var d = AI_DEFAULTS[k];
    if(typeof d === 'boolean') cur[k] = (inp[k] === true || inp[k] === 'true' || inp[k] === 1 || inp[k] === '1');
    else if(typeof d === 'number'){ var n = ai_num_(inp[k]); if(n >= 0 && n <= 100000) cur[k] = n; }
    else cur[k] = ai_cut_(inp[k], 120);
  }
  if(cur.batch < 1) cur.batch = 1; if(cur.batch > 30) cur.batch = 30;
  ai_props_().setProperty(AI_PROP_SET, JSON.stringify(cur));
  return cur;
}
function ai_ss_(create){
  var id = ai_props_().getProperty(AI_PROP_SS), ss = null;
  if(id){ try{ ss = SpreadsheetApp.openById(id); }catch(e){ ss = null; } }
  if(!ss && create){
    ss = SpreadsheetApp.create(AI_SS_NAME);
    ai_props_().setProperty(AI_PROP_SS, ss.getId());
  }
  return ss;
}
function ai_tab_(ss, name){
  var sh = ss.getSheetByName(name);
  if(!sh){
    sh = ss.insertSheet(name);
    var head = AI_TABS[name] || ['value'];
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}
/* poora tab dobara likho (header ke neeche) */
function ai_writeTab_(ss, name, rows){
  var sh = ai_tab_(ss, name), head = AI_TABS[name], last = sh.getLastRow();
  if(last > 1) sh.getRange(2, 1, last - 1, Math.max(sh.getLastColumn(), head.length)).clearContent();
  if(!rows.length) return 0;
  if(sh.getMaxRows() < rows.length + 1) sh.insertRowsAfter(sh.getMaxRows(), rows.length + 1 - sh.getMaxRows());
  if(sh.getMaxColumns() < head.length) sh.insertColumnsAfter(sh.getMaxColumns(), head.length - sh.getMaxColumns());
  sh.getRange(2, 1, rows.length, head.length).setValues(rows);
  return rows.length;
}
function ai_appendTab_(ss, name, rows, keepMax){
  if(!rows || !rows.length) return 0;
  var sh = ai_tab_(ss, name), head = AI_TABS[name], start = Math.max(sh.getLastRow(), 1) + 1;
  if(sh.getMaxRows() < start + rows.length - 1) sh.insertRowsAfter(sh.getMaxRows(), start + rows.length - 1 - sh.getMaxRows());
  sh.getRange(start, 1, rows.length, head.length).setValues(rows);
  if(keepMax){ var n = sh.getLastRow() - 1; if(n > keepMax + 500) sh.deleteRows(2, n - keepMax); }
  return rows.length;
}
function ai_readTab_(ss, name){
  var sh = ss.getSheetByName(name); if(!sh) return [];
  var last = sh.getLastRow(), lc = (AI_TABS[name] || []).length || sh.getLastColumn();
  if(last < 2) return [];
  return sh.getRange(2, 1, last - 1, lc).getValues();
}
function ai_cachePut_(ss, obj){
  var s = JSON.stringify(obj), rows = [], off, CH = 45000;
  for(off = 0; off < s.length; off += CH) rows.push([s.slice(off, off + CH)]);
  var sh = ai_tab_(ss, 'AI_Cache');
  sh.getRange(1, 1, sh.getMaxRows(), 1).setNumberFormat('@');
  ai_writeTab_(ss, 'AI_Cache', rows);
  return s.length;
}
function ai_cacheGet_(ss){
  var rows = ai_readTab_(ss, 'AI_Cache'); if(!rows.length) return null;
  try{ return JSON.parse(rows.map(function(r){ return r[0]; }).join('')); }catch(e){ return null; }
}
function ai_bodies_(name){
  var rows = [], out = [], i;
  try{ rows = _readAll(name) || []; }catch(e){ Logger.log('AI read ' + name + ' fail: ' + e); rows = []; }
  for(i = 0; i < rows.length; i++){ var b = _body(rows[i]); if(b && typeof b === 'object') out.push(b); }
  return out;
}
function ai_load_(ss){
  var D = {};
  ['enquiries','metaLeads','indiamartLeads','quotations','orders','dispatch','customers','activity','users'].forEach(function(n){ D[n] = ai_bodies_(n); });
  /* har id ka sabse naya Gemini analysis */
  var an = {}, rows = ai_readTab_(ss, 'AI_Analysis'), i, r;
  for(i = 0; i < rows.length; i++){ r = rows[i]; if(!r[1]) continue;
    an[String(r[1])] = { sig: String(r[3]), intent: String(r[4]), score: r[5], next: String(r[6]), summary: String(r[7]), conf: r[8] };
  }
  D.analysis = an;
  return D;
}
function ai_readSnap_(ss){
  var rows = ai_readTab_(ss, 'AI_Snapshot'), m = {}, i, o;
  for(i = 0; i < rows.length; i++){ if(!rows[i][0]) continue;
    try{ o = JSON.parse(rows[i][2]); }catch(e){ o = {}; }
    o.__coll = String(rows[i][1]); m[String(rows[i][0])] = o;
  }
  return m;
}

/* ---- poora refresh: padho -> banao -> AI spreadsheet me likho ---- */
function ai_refresh_(why){
  var t0 = Date.now(), C = CacheService.getScriptCache();
  if(C.get('ai:running')) return { ok: false, busy: true };
  C.put('ai:running', '1', 300);
  try{
    var ss = ai_ss_(true), S = ai_settings_(), nowMs = Date.now();
    var D = ai_load_(ss);
    var B = ai_build_(D, S, nowMs);
    var oldSnap = ai_readSnap_(ss), first = true, k;
    for(k in oldSnap){ if(oldSnap.hasOwnProperty(k)){ first = false; break; } }
    var events = first ? [] : ai_diff_(oldSnap, B.snapshot, new Date(nowMs).toISOString());
    if(events.length > 1500) events = events.slice(0, 1500);   /* pehli baar / bada import: log ko baadh na aaye */
    var snapRows = [];
    for(k in B.snapshot){ if(B.snapshot.hasOwnProperty(k)) snapRows.push([k, B.snapshot[k].coll, JSON.stringify(B.snapshot[k].f)]); }
    ai_writeTab_(ss, 'AI_Entity_Master', B.entities);
    ai_writeTab_(ss, 'AI_Snapshot', snapRows);
    ai_appendTab_(ss, 'AI_Event_Log', events, 20000);
    var old = ai_cacheGet_(ss) || {};
    B.dashboard.insights = old.insights || [];
    B.dashboard.insightsAt = old.insightsAt || '';
    B.dashboard.keySet = !!ai_props_().getProperty(AI_PROP_KEY);
    B.dashboard.eventsNew = events.length;
    B.dashboard.ms = Date.now() - t0;
    B.dashboard.why = why || '';
    ai_cachePut_(ss, B.dashboard);
    return { ok: true, entities: B.entities.length, events: events.length, alerts: B.dashboard.kpis.alerts, aiPending: B.aiTodo.length, ms: Date.now() - t0, build: B };
  } finally {
    try{ C.remove('ai:running'); }catch(e){}
  }
}

/* ====================================================================== *
 * 4. WEB APP ACTIONS (sirf Administrator)                                 *
 * ====================================================================== */
function ai_route_(p){
  var u = null;
  try{ u = _verify(p.sid); }catch(e){ u = null; }
  if(!u) return { ok: false, error: 'unauthorized' };
  if(!u.isAdmin) return { ok: false, error: 'forbidden', hint: 'Informatics Analytics sirf Administrator ke liye' };
  var act = String(p.action), ss;
  try{
    if(act === 'ai_status'){
      ss = ai_ss_(false);
      var c0 = ss ? ai_cacheGet_(ss) : null;
      return { ok: true, ver: AI_VER, on: AI_ON, ready: !!c0, generatedAt: c0 ? c0.generatedAt : '', keySet: !!ai_props_().getProperty(AI_PROP_KEY), settings: ai_settings_(), sheetUrl: ss ? ss.getUrl() : '' };
    }
    if(act === 'ai_dashboard'){
      ss = ai_ss_(false);
      var c = ss ? ai_cacheGet_(ss) : null;
      if(!c){ var r0 = ai_refresh_('first'); if(r0 && r0.ok){ ss = ai_ss_(false); c = ai_cacheGet_(ss); } }
      if(!c) return { ok: false, error: 'not_ready', hint: 'ai_setup chalaiye' };
      c.keySet = !!ai_props_().getProperty(AI_PROP_KEY);
      c.settings = ai_settings_();
      c.sheetUrl = ss.getUrl();
      return { ok: true, data: c };
    }
    if(act === 'ai_run'){
      var r = ai_refresh_('manual');
      if(r && r.busy) return { ok: false, error: 'busy', hint: 'Refresh pehle se chal raha hai' };
      return { ok: true, entities: r.entities, events: r.events, alerts: r.alerts, aiPending: r.aiPending, ms: r.ms };
    }
    if(act === 'ai_entities') return ai_apiEntities_(p);
    if(act === 'ai_events') return ai_apiEvents_(p);
    if(act === 'ai_settings_set'){ return { ok: true, settings: ai_saveSettings_(p.settings || {}) }; }
    if(act === 'ai_key_set'){
      var key = ai_s_(p.key);
      if(key === ''){ ai_props_().deleteProperty(AI_PROP_KEY); return { ok: true, keySet: false }; }
      if(key.length < 20 || /\s/.test(key)) return { ok: false, error: 'bad_key', hint: 'Key galat lag rahi hai' };
      ai_props_().setProperty(AI_PROP_KEY, key);
      try{ ai_props_().deleteProperty('AI_MODEL_RESOLVED'); }catch(e){}
      return { ok: true, keySet: true };
    }
    if(act === 'ai_key_test'){ return (typeof ai_geminiPing_ === 'function') ? ai_geminiPing_() : { ok: false, error: 'gemini_file_missing' }; }
    if(act === 'ai_analyse_now'){ return (typeof ai_analyseBatch_ === 'function') ? ai_analyseBatch_(2) : { ok: false, error: 'gemini_file_missing' }; }
    if(act === 'ai_insights_now'){ return (typeof ai_makeInsights_ === 'function') ? ai_makeInsights_() : { ok: false, error: 'gemini_file_missing' }; }
    if(act === 'ai_ask'){ return (typeof ai_ask_ === 'function') ? ai_ask_(p.q, u.email) : { ok: false, error: 'gemini_file_missing' }; }
    return { ok: false, error: 'unknown ai action: ' + act };
  }catch(e){
    Logger.log('AI route ' + act + ' fail: ' + e + (e && e.stack ? '\n' + e.stack : ''));
    return { ok: false, error: 'ai_error', hint: String(e) };
  }
}
function ai_apiEntities_(p){
  var ss = ai_ss_(false); if(!ss) return { ok: false, error: 'not_ready' };
  var rows = ai_readTab_(ss, 'AI_Entity_Master'), H = AI_ENT_HEAD, ix = {}, i;
  for(i = 0; i < H.length; i++) ix[H[i]] = i;
  var type = ai_s_(p.type), cat = ai_s_(p.category), src = ai_s_(p.source), own = ai_s_(p.owner), intent = ai_s_(p.intent), q = ai_lc_(p.q);
  var out = [];
  for(i = 0; i < rows.length; i++){
    var r = rows[i];
    if(type && r[ix.type] !== type) continue;
    if(cat && r[ix.category] !== cat) continue;
    if(src && r[ix.source] !== src) continue;
    if(own && r[ix.ownerName] !== own) continue;
    if(intent && r[ix.aiIntent] !== intent) continue;
    if(q && (String(r[ix.id]) + ' ' + r[ix.name] + ' ' + r[ix.phone] + ' ' + r[ix.product] + ' ' + r[ix.city] + ' ' + r[ix.campaign]).toLowerCase().indexOf(q) < 0) continue;
    out.push(r);
  }
  var sort = ai_s_(p.sort) || 'priority', si = ix[sort] === undefined ? ix.priority : ix[sort], desc = p.dir !== 'asc';
  out.sort(function(a, b){ var x = a[si], y = b[si]; if(x === y) return 0; return (x > y ? 1 : -1) * (desc ? -1 : 1); });
  var size = Math.min(200, Math.max(10, ai_num_(p.size) || 50)), page = Math.max(0, ai_num_(p.page) || 0);
  var slice = out.slice(page * size, page * size + size).map(function(r){
    var o = {}; for(var j = 0; j < H.length; j++){ var v = r[j]; o[H[j]] = (Object.prototype.toString.call(v) === '[object Date]') ? ai_day_(v.getTime()) : v; } return o;
  });
  return { ok: true, total: out.length, page: page, size: size, rows: slice };
}
function ai_apiEvents_(p){
  var ss = ai_ss_(false); if(!ss) return { ok: false, error: 'not_ready' };
  var sh = ss.getSheetByName('AI_Event_Log'); if(!sh) return { ok: true, total: 0, rows: [] };
  var last = sh.getLastRow(), H = AI_TABS.AI_Event_Log, size = 200;
  if(last < 2) return { ok: true, total: 0, rows: [] };
  var from = Math.max(2, last - size + 1);
  var vals = sh.getRange(from, 1, last - from + 1, H.length).getValues().reverse();
  return { ok: true, total: last - 1, rows: vals.map(function(r){ var o = {}; for(var j = 0; j < H.length; j++) o[H[j]] = (Object.prototype.toString.call(r[j]) === '[object Date]') ? r[j].toISOString() : r[j]; return o; }) };
}

/* ---- _route me ai_* actions jodna (load hote hi) ---- */
(function(){ try{ ai_install_(); }catch(e){ Logger.log('AI install fail: ' + e); } })();
function ai_install_(){
  if(typeof _route !== 'function' || _route.__ocAi) return false;
  var origRoute = _route;
  var w = function(p, verb){
    try{
      if(AI_ON && p && typeof p.action === 'string' && p.action.indexOf('ai_') === 0) return ai_route_(p);
    }catch(e){ return { ok: false, error: 'ai_error', hint: String(e) }; }
    return origRoute.apply(this, arguments);
  };
  w.__ocAi = true; w.__orig = origRoute;
  _route = w;
  return true;
}

/* ====================================================================== *
 * 5. EDITOR SE CHALANE WALE + TRIGGERS                                    *
 * ====================================================================== */
function ai_setup(){
  var ss = ai_ss_(true), n;
  for(n in AI_TABS){ if(AI_TABS.hasOwnProperty(n)) ai_tab_(ss, n); }
  try{ var s1 = ss.getSheetByName('Sheet1'); if(s1 && ss.getSheets().length > 1) ss.deleteSheet(s1); }catch(e){}
  var r = ai_refresh_('setup');
  var msg = 'AI spreadsheet: ' + ss.getUrl() + '\nPehla refresh: ' + (r && r.ok ? (r.entities + ' entities, ' + r.alerts + ' alerts, ' + r.ms + ' ms') : JSON.stringify(r));
  Logger.log(msg); return msg;
}
function aiRefreshTick(){
  if(!AI_ON) return;
  var S = ai_settings_(); if(!S.enabled) return;
  try{ var r = ai_refresh_('trigger'); Logger.log('AI refresh: ' + JSON.stringify({ ok: r.ok, busy: r.busy, entities: r.entities, events: r.events, ms: r.ms })); }
  catch(e){ Logger.log('AI refresh fail: ' + e + (e && e.stack ? '\n' + e.stack : '')); }
}
function ai_removeTriggers(){
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function(t){
    var f = t.getHandlerFunction();
    if(f === 'aiRefreshTick' || f === 'aiAnalyseTick' || f === 'aiDailyTick'){ ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log('AI triggers hataye: ' + n); return n;
}
function ai_installTriggers(){
  ai_removeTriggers();
  ScriptApp.newTrigger('aiRefreshTick').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('aiAnalyseTick').timeBased().everyMinutes(30).create();
  ScriptApp.newTrigger('aiDailyTick').timeBased().atHour(9).everyDays(1).create();
  var msg = 'AI triggers lage: aiRefreshTick (15 min), aiAnalyseTick (30 min), aiDailyTick (roz 9 baje)';
  Logger.log(msg); return msg;
}
function ai_selfTest(){
  var L = [], ok = true;
  function t(name, pass, extra){ L.push((pass ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  -- ' + extra : '')); if(!pass) ok = false; }
  t('_route par ai_* laga', typeof _route === 'function' && !!_route.__ocAi);
  t('_readAll / _body / _verify maujood', typeof _readAll === 'function' && typeof _body === 'function' && typeof _verify === 'function');
  t('date parse', ai_day_(ai_ms_('07-11-2026 14:05')) === '2026-11-07' && ai_day_(ai_ms_('2026-11-07')) === '2026-11-07');
  t('status normalise', ai_status_('Quoted') === 'QUOTATION_SENT' && ai_status_('call not pick') === 'CALL_NOT_PICK');
  t('bina login ai_dashboard band', (function(){ var r = _route({ action: 'ai_dashboard' }, 'POST'); return r && r.ok === false && r.error === 'unauthorized'; })());
  t('purana action waisa hi (ping)', (function(){ var r = _route({ action: 'ping' }, 'POST'); return r && r.ok === true; })());
  var ss = null;
  try{ ss = ai_ss_(false); }catch(e){}
  t('AI spreadsheet', !!ss, ss ? ss.getUrl() : 'ai_setup chalaiye');
  if(ss){
    var c = ai_cacheGet_(ss);
    t('dashboard cache', !!(c && c.kpis), c ? ('leads ' + c.kpis.leads + ', orders ' + c.kpis.orders + ', alerts ' + c.kpis.alerts + ', ' + c.generatedAt) : '');
  }
  var n = 0; ScriptApp.getProjectTriggers().forEach(function(tr){ if(/^ai/.test(tr.getHandlerFunction())) n++; });
  t('AI triggers', n === 3, n + ' / 3 (ai_installTriggers chalaiye)');
  L.push((ai_props_().getProperty(AI_PROP_KEY) ? 'INFO  Gemini key set hai' : 'INFO  Gemini key abhi nahi (Admin > Informatics Analytics > Settings se daalein) -- rules-only chalega'));
  L.push(ok ? '==== SAB PASS ====' : '==== KUCH FAIL -- upar dekhiye ====');
  var s = L.join('\n'); Logger.log(s); return s;
}
