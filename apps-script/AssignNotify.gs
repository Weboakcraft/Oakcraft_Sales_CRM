/**
 * "Lead assigned to you" — instant email alert (Enquiries + Meta Leads).
 * ----------------------------------------------------------------------------
 * Ye file ADDITIVE hai — Code.gs ko bilkul nahi chhua gaya.
 *
 * Kya karta hai
 *   Har 1 MINUTE me CRM ke 'enquiries' aur 'metaLeads' collections padhta hai
 *   aur jo bhi record kisi user ke naam par NAYA aaya hai, us user ke
 *   registered email par turant alert bhej deta hai. Isi se phone par
 *   notification aa jaati hai — chahe CRM app band ho, browser band ho,
 *   ya phone locked ho.
 *
 *   - Ek user ko ek run me ek hi email jaata hai (saare naye records ek saath).
 *   - Ek record ek user ko sirf ek baar bheja jaata hai (hidden log tab me
 *     nishaan rehta hai). Re-assign hone par naye user ko dobara jaata hai.
 *   - Email address CRM ke 'users' roster se aata hai — record ka owner /
 *     ownerEmail, warna assigned_to / salesperson naam se match karke.
 *
 * Ek baar ka setup (Apps Script editor me)
 *   1. Ye file paste karein (Code.gs ke saath, alag file).
 *   2. Run dropdown se `installAssignNotify` EK BAAR chalayein.
 *      -> abhi tak ke saare records "already notified" mark ho jaate hain
 *         (purane leads ka backlog email nahi jaayega) aur 1-minute ka
 *         trigger lag jaata hai.
 *   3. Purana 15-minute wala Meta trigger band kar dijiye, warna Meta leads
 *      ka email do baar jaayega:  `removeMetaNotifyTrigger`  chalayein.
 *
 *   Test:     `previewAssignNotify`  — kuch bhejta nahi, Logs me dikhata hai.
 *   Turant:   `runAssignNotifyNow`   — abhi bhej deta hai.
 *   Band:     `removeAssignNotify`   — trigger hata deta hai.
 *
 * NOTE — Gmail ka daily send quota (consumer account ~100 mails/din,
 * Workspace ~1500) yahin se kharch hota hai. Ek run me ek user ko ek hi mail
 * jaata hai, isliye normal use me quota kaafi rehta hai.
 */

var ASG_LOG_TAB     = 'Assign_Notify_Log';
var ASG_SUBJECT_ENQ = 'Nayi Enquiry aapko assign hui — OakCraft CRM';
var ASG_SUBJECT_ML  = 'Naya Meta Lead aapko assign hua — OakCraft CRM';
var ASG_SUBJECT_MIX = 'Naye leads aapko assign hue — OakCraft CRM';
var ASG_FROM_NAME   = 'OakCraft Sales CRM';
var ASG_CRM_URL     = 'https://weboakcraft.github.io/Oakcraft_Sales_CRM/';
var ASG_MAX_ROWS    = 40;      // email me itne records, baaki "+N aur"
var ASG_MINUTES     = 1;       // trigger ka interval

/* ------------------------------------------------------------------ *
 * helpers                                                             *
 * ------------------------------------------------------------------ */
function asg_str_(v){ return v == null ? '' : String(v); }
function asg_lc_(v){ return asg_str_(v).trim().toLowerCase(); }
function asg_esc_(v){
  return asg_str_(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** CRM ka koi bhi collection padho ({id,data} unwrap karke). */
function asg_read_(collection){
  var rows = [];
  try{
    if(typeof _readAll === 'function') rows = _readAll(collection) || [];
  }catch(e){
    Logger.log('asg_read_ ' + collection + ' error: ' + e);
  }
  return rows.map(function(d){ return (d && d.data !== undefined) ? d.data : d; })
             .filter(function(d){ return d && typeof d === 'object'; });
}

/** roster: email -> {name, email, status}, aur naam -> email ka map. */
function asg_users_(){
  var out = { byEmail: {}, byName: {} };
  asg_read_('users').forEach(function(u){
    var em = asg_lc_(u.email); if(!em) return;
    if(asg_str_(u.status) && asg_lc_(u.status) !== 'active') return;   // inactive chhodo
    out.byEmail[em] = { name: asg_str_(u.name) || em, email: em };
    var nm = asg_lc_(u.name);
    if(nm && !out.byName[nm]) out.byName[nm] = em;
  });
  return out;
}

/** record ka assignee email nikaalo. */
function asg_assignee_(rec, users){
  var em = asg_lc_(rec.owner) || asg_lc_(rec.ownerEmail) || asg_lc_(rec.createdBy);
  if(em && users.byEmail[em]) return em;
  var nm = asg_lc_(rec.assigned_to) || asg_lc_(rec.salesperson);
  if(nm && users.byName[nm]) return users.byName[nm];
  if(em) return em;                      // roster me na ho to bhi bhej do
  return '';
}

/** hidden log tab (key | email | label | sent_at). */
function asg_logSheet_(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(ASG_LOG_TAB);
  if(!sh){
    sh = ss.insertSheet(ASG_LOG_TAB);
    sh.getRange(1, 1, 1, 4).setValues([['key', 'email', 'label', 'sent_at']]).setFontWeight('bold');
    sh.setFrozenRows(1);
    try{ sh.hideSheet(); }catch(e){}
  }
  return sh;
}
function asg_sentKeys_(){
  var sh = asg_logSheet_(), n = sh.getLastRow(), seen = {};
  if(n < 2) return seen;
  sh.getRange(2, 1, n - 1, 1).getValues().forEach(function(r){
    var k = asg_str_(r[0]); if(k) seen[k] = 1;
  });
  return seen;
}
function asg_logRows_(rows){
  if(!rows.length) return;
  var sh = asg_logSheet_();
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
}

/* ------------------------------------------------------------------ *
 * naye assignments dhoondo                                            *
 * ------------------------------------------------------------------ */
function asg_collect_(){
  var users = asg_users_(), seen = asg_sentKeys_(), perUser = {};

  function add(kind, rec){
    var id = asg_str_(rec.id); if(!id) return;
    var em = asg_assignee_(rec, users); if(!em) return;
    var key = kind + ':' + id + ':' + em;
    if(seen[key]) return;
    (perUser[em] = perUser[em] || []).push({ kind: kind, id: id, key: key, rec: rec });
  }

  asg_read_('enquiries').forEach(function(r){ add('enq', r); });
  asg_read_('metaLeads').forEach(function(r){ add('meta', r); });
  return { perUser: perUser, users: users };
}

/* ------------------------------------------------------------------ *
 * email                                                               *
 * ------------------------------------------------------------------ */
function asg_card_(it){
  var r = it.rec, title, lines;
  if(it.kind === 'meta'){
    title = asg_str_(r.full_name) || asg_str_(r.phone_number) || 'Naya lead';
    lines = [['Phone', r.phone_number], ['City', r.city_state], ['Platform', r.platform],
             ['Status', r.lead_status], ['Aaya', r.created_time_ist]];
  } else {
    title = asg_str_(r.customer) || asg_str_(r.product) || 'Nayi enquiry';
    lines = [['Product', r.product], ['Qty', r.qty], ['Source', r.source],
             ['Value', r.value], ['Stage', r.stage], ['Date', r.date]];
  }
  var body = lines.filter(function(l){ return asg_str_(l[1]) !== ''; }).map(function(l){
    return '<tr><td style="padding:3px 12px 3px 0;color:#667;font-size:12px">' + asg_esc_(l[0]) + '</td>'
         + '<td style="padding:3px 0;font-size:13px;font-weight:600">' + asg_esc_(l[1]) + '</td></tr>';
  }).join('');

  return '<div style="border:1px solid #dfe4e6;border-left:3px solid #0e6f6b;border-radius:8px;padding:12px 14px;margin:0 0 10px">'
       +   '<div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#0e6f6b;font-weight:700">'
       +     (it.kind === 'meta' ? 'Meta Lead' : 'Enquiry') + ' · ' + asg_esc_(it.id) + '</div>'
       +   '<div style="font-size:16px;font-weight:700;margin:3px 0 7px">' + asg_esc_(title) + '</div>'
       +   '<table cellpadding="0" cellspacing="0">' + body + '</table>'
       + '</div>';
}

function asg_html_(name, items){
  var shown = items.slice(0, ASG_MAX_ROWS);
  var more  = items.length > shown.length
    ? '<p style="font-size:13px;color:#667">+ ' + (items.length - shown.length) + ' aur record CRM me hain.</p>' : '';
  return '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:560px;color:#12181a">'
       +   '<p style="font-size:15px;margin:0 0 4px">Namaste ' + asg_esc_(name) + ',</p>'
       +   '<p style="font-size:14px;color:#4a5558;margin:0 0 16px">Aapke naam par <b>' + items.length + '</b> naya '
       +     (items.length === 1 ? 'record' : 'records') + ' assign hua hai:</p>'
       +   shown.map(asg_card_).join('')
       +   more
       +   '<p style="margin:18px 0 0"><a href="' + ASG_CRM_URL + '" '
       +     'style="display:inline-block;background:#0e6f6b;color:#fff;text-decoration:none;'
       +     'padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600">CRM me kholein</a></p>'
       +   '<p style="font-size:11.5px;color:#8b9699;margin-top:18px">OakCraft Sales CRM ka automatic alert.</p>'
       + '</div>';
}

function asg_subject_(items){
  var e = 0, m = 0;
  items.forEach(function(i){ if(i.kind === 'meta') m++; else e++; });
  if(e && m) return ASG_SUBJECT_MIX;
  return m ? ASG_SUBJECT_ML : ASG_SUBJECT_ENQ;
}

/* ------------------------------------------------------------------ *
 * main                                                                *
 * ------------------------------------------------------------------ */
function asg_run_(dryRun){
  var lock = LockService.getScriptLock();
  try{ if(!lock.tryLock(20000)){ Logger.log('AssignNotify: pehle wala run chal raha hai, skip.'); return; } }
  catch(e){}

  try{
    var got = asg_collect_(), perUser = got.perUser, users = got.users;
    var emails = Object.keys(perUser);
    if(!emails.length){ Logger.log('AssignNotify: kuch naya nahi.'); return; }

    var logRows = [], now = new Date();
    emails.forEach(function(em){
      var items = perUser[em];
      var name  = (users.byEmail[em] && users.byEmail[em].name) || em;
      var html  = asg_html_(name, items);
      var subj  = asg_subject_(items);

      if(dryRun){
        Logger.log('WOULD SEND -> ' + em + ' (' + items.length + '): '
                   + items.map(function(i){ return i.kind + ':' + i.id; }).join(', '));
        return;
      }
      try{
        MailApp.sendEmail({ to: em, subject: subj, htmlBody: html, name: ASG_FROM_NAME });
        items.forEach(function(i){
          var label = i.kind === 'meta'
            ? (asg_str_(i.rec.full_name) || asg_str_(i.rec.phone_number))
            : (asg_str_(i.rec.customer)  || asg_str_(i.rec.product));
          logRows.push([i.key, em, label, now]);
        });
      }catch(err){
        Logger.log('AssignNotify: ' + em + ' ko mail fail — ' + err);   // log mat karo, agli baar retry hoga
      }
    });
    if(!dryRun) asg_logRows_(logRows);
    Logger.log('AssignNotify: ' + emails.length + ' user, ' + logRows.length + ' record notify hue.');
  } finally {
    try{ lock.releaseLock(); }catch(e){}
  }
}

/** Trigger yahi chalata hai. */
function assignNotifyTick(){ asg_run_(false); }

/** Abhi turant bhej do. */
function runAssignNotifyNow(){ asg_run_(false); }

/** Kuch bhejta nahi — sirf Logs me dikhata hai ki kya jaata. */
function previewAssignNotify(){ asg_run_(true); }

/* ------------------------------------------------------------------ *
 * setup                                                               *
 * ------------------------------------------------------------------ */
/** Abhi tak ke saare records ko "already notified" mark kar do (backlog band). */
function asg_seed_(){
  var got = asg_collect_(), rows = [], now = new Date();
  Object.keys(got.perUser).forEach(function(em){
    got.perUser[em].forEach(function(i){ rows.push([i.key, em, '(seed — backlog)', now]); });
  });
  asg_logRows_(rows);
  Logger.log('AssignNotify: ' + rows.length + ' purane record seed kiye (inka mail nahi jaayega).');
}

/** EK BAAR chalayein: backlog seed + 1-minute ka trigger. */
function installAssignNotify(){
  removeAssignNotify();
  asg_seed_();
  ScriptApp.newTrigger('assignNotifyTick').timeBased().everyMinutes(ASG_MINUTES).create();
  Logger.log('AssignNotify: trigger lag gaya (har ' + ASG_MINUTES + ' minute).');
}

/** Trigger hata do. */
function removeAssignNotify(){
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function(t){
    if(t.getHandlerFunction() === 'assignNotifyTick'){ ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log('AssignNotify: ' + n + ' trigger hataye.');
}
