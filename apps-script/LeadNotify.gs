/**
 * Meta Leads  ->  "New Meta Leads Assigned" email (bulk, per user).
 * ----------------------------------------------------------------------------
 * Ye file ADDITIVE hai — Code.gs ko bilkul nahi chhua gaya.
 *
 * Kya karta hai
 *   Har 15 minute me CRM ke 'metaLeads' collection ko padhta hai aur jo leads
 *   kisi user ko NAYE assign hue hain aur jinka lead_status = CREATED hai,
 *   un sabko ek hi saaf-suthre email me us user ke registered email par bhej
 *   deta hai. Subject hamesha: "New Meta Leads Assigned".
 *
 *   - Ek user ko ek hi bulk email jaata hai (har lead ka alag mail nahi).
 *   - Ek lead ek user ko sirf ek baar hi bheji jaati hai (log tab me nishaan
 *     rehta hai). Lead kisi doosre user ko re-assign hui to naye user ko
 *     dobara notification chala jaata hai.
 *   - Email address CRM ke 'users' roster se aata hai (lead ka owner/assigned_to).
 *
 * Ek baar ka setup (Apps Script editor me)
 *   1. Ye file paste karein (Code.gs ke saath, alag file).
 *   2. Run dropdown se `installMetaNotifyTrigger` ek baar chalayein.
 *      -> abhi tak ki saari purani leads "already notified" mark ho jaati hain
 *         (purane 100+ leads ka email nahi jaayega) aur 15-minute ka trigger
 *         lag jaata hai. Uske baad jo bhi naya assign hoga, uska mail jaayega.
 *   3. Test karna ho to `previewMetaNotify` chalayein — ye kuch bhejta nahi,
 *      sirf Logs me dikhata hai ki abhi kya jaata.
 *
 * Band karna ho: `removeMetaNotifyTrigger` chala dijiye.
 */

var NOTIFY_LOG_TAB   = 'Meta_Notify_Log';
var NOTIFY_STATUS    = 'CREATED';          // sirf isi status wali leads ka mail
var NOTIFY_SUBJECT   = 'New Meta Leads Assigned';
var NOTIFY_FROM_NAME = 'OakCraft Sales CRM';
var NOTIFY_CRM_URL   = 'https://weboakcraft.github.io/Oakcraft_Sales_CRM/';
var NOTIFY_MAX_ROWS  = 60;                 // email me itni rows, baaki "+N more"

/* ------------------------------------------------------------------ *
 * helpers                                                             *
 * ------------------------------------------------------------------ */
function nfy_str_(v){ return v == null ? '' : String(v); }
function nfy_lc_(v){ return nfy_str_(v).trim().toLowerCase(); }
function nfy_esc_(v){
  return nfy_str_(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function nfy_status_(v){ return nfy_str_(v).trim().toUpperCase().replace(/\s+/g, '_'); }

/** CRM ke kisi bhi collection ko padho ({id,data} ko unwrap karke). */
function nfy_read_(collection) {
  var rows = [];
  try {
    if (typeof _readAll === 'function') rows = _readAll(collection) || [];
  } catch (e) {
    Logger.log('nfy_read_ ' + collection + ' error: ' + e);
  }
  return rows.map(function (d) { return (d && d.data !== undefined) ? d.data : d; })
             .filter(function (d) { return d && typeof d === 'object'; });
}

/** log tab (lead_key | email | leads | sent_at) — kya pehle hi bheja ja chuka hai. */
function nfy_logSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(NOTIFY_LOG_TAB);
  if (!sh) {
    sh = ss.insertSheet(NOTIFY_LOG_TAB);
    sh.getRange(1, 1, 1, 4).setValues([['lead_key', 'email', 'lead_name', 'sent_at']]).setFontWeight('bold');
    sh.setFrozenRows(1);
    try { sh.hideSheet(); } catch (e) {}
  }
  return sh;
}
function nfy_sentKeys_() {
  var sh = nfy_logSheet_(), last = sh.getLastRow(), seen = {};
  if (last < 2) return seen;
  sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) {
    var k = nfy_str_(r[0]); if (k) seen[k] = 1;
  });
  return seen;
}
function nfy_appendLog_(rows) {
  if (!rows.length) return;
  var sh = nfy_logSheet_();
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
}

/** roster: email -> {email, name}; naam se bhi dhoondh lo. */
function nfy_roster_() {
  var users = nfy_read_('users');
  var byEmail = {}, byName = {};
  users.forEach(function (u) {
    var e = nfy_lc_(u.email); if (!e) return;
    var st = nfy_lc_(u.status);
    if (st && st !== 'active') return;                 // inactive user ko mail nahi
    var rec = { email: e, name: nfy_str_(u.name) || e };
    byEmail[e] = rec;
    if (rec.name) byName[nfy_lc_(rec.name)] = rec;
  });
  return { byEmail: byEmail, byName: byName };
}
/** lead ka assigned user nikaalo (owner email, warna assigned_to naam). */
function nfy_userOf_(lead, roster) {
  var owner = nfy_lc_(lead.owner || lead.ownerEmail);
  if (owner && roster.byEmail[owner]) return roster.byEmail[owner];
  var nm = nfy_lc_(lead.assigned_to);
  if (nm && roster.byName[nm]) return roster.byName[nm];
  if (nm) {                                            // "Ujala" -> "Ujala Rajput"
    var keys = Object.keys(roster.byName);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] === nm || keys[i].split(' ')[0] === nm || keys[i].indexOf(nm) === 0) return roster.byName[keys[i]];
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * email                                                               *
 * ------------------------------------------------------------------ */
function nfy_rowsHtml_(leads) {
  var shown = leads.slice(0, NOTIFY_MAX_ROWS);
  var tds = 'padding:9px 10px;border-bottom:1px solid #E3D9C6;font-size:13px;color:#241A10';
  var body = shown.map(function (l, i) {
    return '<tr>'
      + '<td style="' + tds + ';text-align:center;color:#8A7B65">' + (i + 1) + '</td>'
      + '<td style="' + tds + ';font-weight:700">' + nfy_esc_(l.full_name || '—') + '</td>'
      + '<td style="' + tds + '">' + nfy_esc_(l.phone_number || '—') + '</td>'
      + '<td style="' + tds + '">' + nfy_esc_(l.city_state || '—') + '</td>'
      + '<td style="' + tds + '">' + nfy_esc_(l.platform || '—') + '</td>'
      + '<td style="' + tds + ';color:#8A7B65;white-space:nowrap">' + nfy_esc_(l.created_time_ist || '—') + '</td>'
      + '</tr>';
  }).join('');
  var more = leads.length > shown.length
    ? '<tr><td colspan="6" style="' + tds + ';text-align:center;color:#8A7B65;font-style:italic">+ ' + (leads.length - shown.length) + ' aur leads — CRM me dekhein</td></tr>'
    : '';
  return body + more;
}
function nfy_html_(user, leads) {
  var th = 'padding:8px 10px;text-align:left;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#F0E6D2;background:#241A10;font-weight:600';
  return ''
  + '<div style="font-family:Helvetica,Arial,sans-serif;background:#F7F2E9;padding:22px">'
  +   '<div style="max-width:720px;margin:0 auto;background:#FFF;border:1px solid #E3D9C6">'
  +     '<div style="padding:18px 22px;border-bottom:3px solid #B4802F">'
  +       '<div style="font-size:19px;color:#241A10;letter-spacing:.04em"><b>Oak</b>Craft <span style="color:#8A7B65;font-size:13px">· Sales CRM</span></div>'
  +       '<div style="font-size:15px;color:#B4802F;font-weight:700;margin-top:5px">' + NOTIFY_SUBJECT + '</div>'
  +     '</div>'
  +     '<div style="padding:18px 22px">'
  +       '<p style="margin:0 0 12px;font-size:14px;color:#241A10">Hello ' + nfy_esc_(user.name) + ',</p>'
  +       '<p style="margin:0 0 16px;font-size:14px;color:#4A3B28;line-height:1.6">'
  +         '<b>' + leads.length + ' new lead' + (leads.length === 1 ? '' : 's') + '</b> aapko assign hui hain (status: <b>' + NOTIFY_STATUS + '</b>). '
  +         'Details neeche hain — CRM me khol kar follow-up shuru kar dijiye.'
  +       '</p>'
  +       '<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid #E3D9C6">'
  +         '<thead><tr>'
  +           '<th style="' + th + ';text-align:center;width:34px">#</th>'
  +           '<th style="' + th + '">Name</th><th style="' + th + '">Phone</th>'
  +           '<th style="' + th + '">City / State</th><th style="' + th + '">Platform</th><th style="' + th + '">Created</th>'
  +         '</tr></thead>'
  +         '<tbody>' + nfy_rowsHtml_(leads) + '</tbody>'
  +       '</table>'
  +       '<p style="margin:18px 0 0"><a href="' + NOTIFY_CRM_URL + '" style="background:#B4802F;color:#FFF;text-decoration:none;padding:11px 20px;font-size:13px;letter-spacing:.06em;display:inline-block">OPEN META LEADS IN CRM</a></p>'
  +     '</div>'
  +     '<div style="padding:12px 22px;background:#F7F2E9;border-top:1px solid #E3D9C6;font-size:11px;color:#8A7B65">'
  +       'Ye automatic notification OakCraft Sales CRM se bheja gaya hai. Reply karne ki zaroorat nahi.'
  +     '</div>'
  +   '</div>'
  + '</div>';
}
function nfy_text_(user, leads) {
  var lines = ['Hello ' + user.name + ',', '', leads.length + ' new lead(s) assigned to you (status ' + NOTIFY_STATUS + '):', ''];
  leads.slice(0, NOTIFY_MAX_ROWS).forEach(function (l, i) {
    lines.push((i + 1) + '. ' + nfy_str_(l.full_name || '—') + ' | ' + nfy_str_(l.phone_number || '—')
      + ' | ' + nfy_str_(l.city_state || '—') + ' | ' + nfy_str_(l.platform || '—'));
  });
  if (leads.length > NOTIFY_MAX_ROWS) lines.push('+ ' + (leads.length - NOTIFY_MAX_ROWS) + ' more in the CRM');
  lines.push('', 'Open CRM: ' + NOTIFY_CRM_URL);
  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * main                                                                *
 * ------------------------------------------------------------------ */
function nfy_collect_(sentKeys) {
  var leads = nfy_read_('metaLeads');
  var roster = nfy_roster_();
  var byUser = {}, keys = {};
  leads.forEach(function (l) {
    if (nfy_status_(l.lead_status) !== NOTIFY_STATUS) return;      // sirf CREATED
    var u = nfy_userOf_(l, roster); if (!u) return;                // assign hi nahi hui
    var id = nfy_str_(l.id || (l.phone_number + '|' + l.full_name));
    if (!id) return;
    var key = id + '|' + u.email;                                  // re-assign = naya mail
    if (sentKeys[key]) return;
    if (keys[key]) return;
    keys[key] = { email: u.email, name: nfy_str_(l.full_name) };
    (byUser[u.email] = byUser[u.email] || { user: u, leads: [], keys: [] });
    byUser[u.email].leads.push(l);
    byUser[u.email].keys.push(key);
  });
  return { byUser: byUser, keys: keys };
}

/** Har 15 min par yahi chalta hai. */
function notifyAssignedMetaLeads_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) { Logger.log('notify: busy, skip'); return 0; }
  try {
    var sent = nfy_sentKeys_();
    var found = nfy_collect_(sent);
    var emails = Object.keys(found.byUser), log = [], now = new Date(), total = 0;
    emails.forEach(function (email) {
      var pack = found.byUser[email];
      try {
        MailApp.sendEmail({
          to: email,
          subject: NOTIFY_SUBJECT,
          name: NOTIFY_FROM_NAME,
          body: nfy_text_(pack.user, pack.leads),
          htmlBody: nfy_html_(pack.user, pack.leads)
        });
        total += pack.leads.length;
        pack.keys.forEach(function (k, i) {
          log.push([k, email, nfy_str_((pack.leads[i] || {}).full_name), now]);
        });
        Logger.log('notify: ' + pack.leads.length + ' leads -> ' + email);
      } catch (err) {
        Logger.log('notify: mail FAILED for ' + email + ' -> ' + err);   // log nahi likha, agli baar dobara try hoga
      }
    });
    nfy_appendLog_(log);
    Logger.log('notify: done — ' + total + ' leads, ' + emails.length + ' user(s)');
    return total;
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** Kuch bheje bina dikhaao ki abhi kya jaata (testing ke liye). */
function previewMetaNotify() {
  var found = nfy_collect_(nfy_sentKeys_());
  var out = Object.keys(found.byUser).map(function (e) {
    return e + ' -> ' + found.byUser[e].leads.length + ' lead(s)';
  });
  Logger.log(out.length ? out.join('\n') : 'Abhi koi nayi assigned CREATED lead nahi hai.');
  return out;
}

/** Abhi turant bhejo (trigger ka intezaar kiye bina). */
function runMetaNotifyNow() {
  var n = notifyAssignedMetaLeads_();
  Logger.log('runMetaNotifyNow -> ' + n + ' lead(s) notified');
  return n;
}

/**
 * EK BAAR chalaayein: purani saari leads ko "notified" mark karta hai (taaki
 * purane leads ka bulk mail na jaye) aur 15-minute ka auto trigger laga deta hai.
 */
function installMetaNotifyTrigger() {
  var found = nfy_collect_(nfy_sentKeys_()), now = new Date(), rows = [];
  Object.keys(found.keys).forEach(function (k) {
    rows.push([k, found.keys[k].email, found.keys[k].name, now]);
  });
  nfy_appendLog_(rows);

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'notifyAssignedMetaLeads_') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('notifyAssignedMetaLeads_').timeBased().everyMinutes(15).create();
  return 'Ready — ' + rows.length + ' purani leads skip ki gayi; ab har 15 min me nayi assigned leads ka mail jaayega.';
}

/** Auto emails band karne ke liye. */
function removeMetaNotifyTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'notifyAssignedMetaLeads_') { ScriptApp.deleteTrigger(t); n++; }
  });
  return 'Removed ' + n + ' trigger(s).';
}

/** Log saaf karna ho (sab kuch dobara notify ho jaayega — dhyan se). */
function resetMetaNotifyLog() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName(NOTIFY_LOG_TAB);
  if (sh) ss.deleteSheet(sh);
  return 'Notify log clear ho gaya.';
}
