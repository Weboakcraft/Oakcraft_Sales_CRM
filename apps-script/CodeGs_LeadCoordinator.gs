/**
 * LEAD COORDINATOR — backend patch (CRM v69 + v70 status + v71 mobile + v72 add enquiry + v73 see all)
 * ----------------------------------------------------------------------------
 * v73 (LC_SEE_ALL = true)
 *   Coordinator ko enquiries / metaLeads (Meta + Gem) / indiamartLeads ki
 *   SAARI leads milti hain -- har salesperson ki, har status ki, assign ke
 *   baad bhi. Badalna (status / assign) ab bhi sirf un leads par jo
 *   New / Created hain aur coordinator ne abhi assign nahi ki (coordAt
 *   khaali). Assign ho chuki lead sirf dekhne ke liye -- server par bhi.
 *   Purana (sirf New) wapas chahiye to LC_SEE_ALL = false + New version.
 * v73.2: jo lead pehle se kisi salesperson ke paas hai (enquiry ka
 *   salesperson / lead ka assigned_to likha hai, ya owner koi sales user
 *   hai) wo bhi sirf dekhne ke liye -- coordinator use dobara assign ya
 *   status nahi badal sakti. App (index.html hasAssignee) me bhi yahi rule.
 *
 * KAUN
 *   oakcraftcoordinator@gmail.com (LC_EMAILS) -- ya koi bhi user jiska role
 *   "Lead Coordinator" ho. Admin par is file ka koi asar nahi.
 *
 * KYA KARTA HAI (sirf lapet-ta hai -- Code.gs ka ek bhi akshar nahi badalta)
 *   1. PADHNA -- `_scope()`:
 *        enquiries / metaLeads (Meta + Gem) / indiamartLeads me coordinator
 *        ko SABHI salespersons ki wo leads milti hain jinka status
 *        New / Created hai -- ya jise coordinator ne khud Qualified /
 *        Not Qualified kiya (`coordStatusAt`) -- aur jo abhi tak
 *        coordinator ne assign nahi ki (`coordAt` khaali). Baaki collections pehle jaise -- sirf apna
 *        (yaani kuch nahi).
 *   2. LIKHNA -- `_seesAll()` + `_route()`:
 *        Coordinator in teen collections me sirf do kaam kar sakti hai --
 *        lead ka owner (salesperson) badalna aur status Qualified /
 *        Not Qualified karna. `_route` me
 *        pehra:
 *          - delete band
 *          - naya record band -- sirf nayi Enquiry (New / Qualified / Not Qualified) ban sakti hai (v72)
 *          - customers (v72): poori list padh sakti hai (Add Enquiry ka
 *            dropdown); naya customer bana sakti hai, aur sirf apna banaya
 *            customer badal sakti hai (owner -> salesperson)
 *          - sirf wahi lead jo sheet par abhi bhi New / Created hai
 *          - status sirf New / Created / Qualified / Not Qualified (v70);
 *            status badle to coordStatusAt likh diya jaata hai -- lead
 *            assign hone tak coordinator ki list me rehti hai
 *        Kuch na bache to { ok:false, error:'coord_not_fresh' } -- app ye
 *        dekh kar list refresh kar deta hai.
 *        `_seesAll` -> true, taaki Code.gs ka owner-hijack rok (scoped)
 *        coordinator ke assign ko "skipped" na kare.
 *
 * KAISE LAGAYEIN
 *   1. Apps Script project (Web_Sales_CRM) me nayi script file banaiye --
 *      naam: CodeGs_LeadCoordinator -- ye poora code paste -> Save.
 *      File list me ye SABSE NEECHE honi chahiye (Code.gs ke baad).
 *   2. `checkLeadCoordinator` Run -> Execution log me sab "HAAN" aur
 *      ginti dikhni chahiye.
 *   3. ZAROORI: Deploy > Manage deployments > pencil (edit) >
 *      Version: "New version" > Deploy. URL wahi rehta hai.
 *
 * WAPAS HATANA HO
 *   `var LC_ON = false;` karke dobara New version deploy.
 *
 * NAYA COORDINATOR
 *   LC_EMAILS me email jodiye (aur index.html ke OC_COORDINATORS me bhi),
 *   ya us user ka role "Lead Coordinator" rakhiye.
 */

var LC_ON     = true;
var LC_SEE_ALL = true;   /* v73: saari leads dikhao (sirf padhne ke liye) */
var LC_EMAILS = ['oakcraftcoordinator@gmail.com'];
var LC_ROLE   = 'lead coordinator';
var LC_COLLS  = ['enquiries', 'metaLeads', 'indiamartLeads'];

function lc_s_(v){ return v == null ? '' : String(v); }
function lc_lc_(v){ return lc_s_(v).trim().toLowerCase(); }
function lc_body_(r){
  if(typeof _body === 'function') return _body(r) || {};
  return (r && r.data && typeof r.data === 'object') ? r.data : (r || {});
}
/** kya ye user coordinator hai? */
function lc_isCoord_(u){
  if(!LC_ON || !u || u.isAdmin || u.legacy) return false;
  if(LC_EMAILS.indexOf(lc_lc_(u.email)) >= 0) return true;
  return lc_lc_(u.role).replace(/[\s_\-]+/g, ' ') === LC_ROLE;
}
/** New / Created? -- app (index.html v69) me bhi bilkul yahi rule */
function lc_fresh_(d, coll){
  if(!d) return false;
  if(coll === 'enquiries'){ var s = lc_lc_(d.stage); return s === '' || s === 'new'; }
  var c = lc_s_(d.lead_status).trim().toUpperCase().replace(/[\s\-]+/g, '_');
  return c === '' || c === 'CREATED' || c === 'NEW';
}
/** v70: Qualified / Not Qualified? */
function lc_qnq_(d, coll){
  if(!d) return false;
  if(coll === 'enquiries'){ var s = lc_lc_(d.stage); return s === 'qualified' || s === 'not qualified'; }
  var c = lc_s_(d.lead_status).trim().toUpperCase().replace(/[\s\-]+/g, '_');
  return c === 'QUALIFIED' || c === 'NOT_QUALIFIED';
}
function lc_has_(v){ return (v instanceof Date) || !!lc_s_(v).trim(); }
/** v73.2: sales role? -- index.html ocIsSalesRole jaisa */
function lc_isSalesRole_(role){
  var r = lc_lc_(role).replace(/[\s_\-]+/g, ' ');
  return r === 'user' || r === 'sales executive' || r === 'sales exec' || r === 'salesexecutive' || r === 'sales';
}
var LC_SALES_ = null;
function lc_salesSet_(){
  if(LC_SALES_) return LC_SALES_;
  var m = {};
  try{
    (_readAll('users') || []).forEach(function(r){
      var u = lc_body_(r); if(!u || !u.email) return;
      var em = lc_lc_(u.email);
      if(LC_EMAILS.indexOf(em) >= 0 || lc_lc_(u.role).replace(/[\s_\-]+/g, ' ') === LC_ROLE) return;
      if(lc_isSalesRole_(u.role)) m[em] = 1;
    });
  }catch(e){ Logger.log('LeadCoordinator users: ' + e); }
  LC_SALES_ = m; return m;
}
/** v73.2: lead pehle se kisi salesperson ke paas hai? */
function lc_assigned_(d, coll){
  if(!d) return false;
  if(lc_s_(coll === 'enquiries' ? d.salesperson : d.assigned_to).trim()) return true;
  var o = lc_lc_(d.owner);
  return !!o && !!lc_salesSet_()[o];
}
function lc_statusKey_(d, coll){
  return coll === 'enquiries' ? lc_lc_(d && d.stage) : lc_s_(d && d.lead_status).trim().toUpperCase().replace(/[\s\-]+/g, '_');
}
/** coordinator ko dikhe: New/Created, ya jise usne khud Qualified / Not Qualified kiya
    (coordStatusAt) -- aur abhi tak usne assign nahi ki (coordAt khaali). */
function lc_visible_(d, coll){
  if(!d || lc_has_(d.coordAt)) return false;
  if(lc_assigned_(d, coll)) return false;                         /* v73.2 */
  return lc_fresh_(d, coll) || (lc_has_(d.coordStatusAt) && lc_qnq_(d, coll));
}

/** v71: coordinator ko customers nahi milte, isliye enquiry ke saath customer
    ka mobile hint (_cPhone / _cContact) -- custId se, warna naam se (sirf jab
    us naam ka ek hi customer ho). Sheet me save nahi hota (_route me strip). */
function lc_withPhone_(rows){
  if(!rows || !rows.length) return rows;
  var byId = {}, byName = {};
  try{
    (_readAll('customers') || []).forEach(function(r){
      var c = lc_body_(r); if(!c) return;
      if(c.id != null) byId[lc_s_(c.id)] = c;
      var n = lc_lc_(c.name); if(n) (byName[n] = byName[n] || []).push(c);
    });
  }catch(e){ return rows; }
  return rows.map(function(r){
    var b = lc_body_(r), copy = {}, k;
    for(k in b) if(Object.prototype.hasOwnProperty.call(b, k)) copy[k] = b[k];
    var c = byId[lc_s_(b.custId)];
    if(!c){ var l = byName[lc_lc_(b.customer)]; if(l && l.length === 1) c = l[0]; }
    if(c){ copy._cPhone = lc_s_(c.phone || c.mobile); copy._cContact = lc_s_(c.contact || c.name); }
    return { id: r && r.id, updatedAt: r && r.updatedAt, data: copy };
  });
}

/** Load hote hi apne aap lag jaata hai. */
(function(){ try{ ocLeadCoordInstall_(); }catch(e){ Logger.log('LeadCoordinator install fail: ' + e); } })();

function ocLeadCoordInstall_(){
  var done = [];

  /* ---------------- 1. _scope ---------------- */
  if(typeof _scope === 'function' && !_scope.__ocCoord){
    var oScope = _scope;
    var wScope = function(coll, rows, u){
      try{
        /* v72: Add Enquiry ke form me customer chunne ke liye poori customer list */
        if(lc_isCoord_(u) && coll === 'customers') return rows || [];
        if(lc_isCoord_(u) && LC_COLLS.indexOf(coll) >= 0){
          var out = [];
          (rows || []).forEach(function(r){ if(r && (LC_SEE_ALL || lc_visible_(lc_body_(r), coll))) out.push(r); });
          if(coll === 'enquiries'){ try{ out = lc_withPhone_(out); }catch(e2){} }
          return out;
        }
      }catch(e){ Logger.log('LeadCoordinator _scope: ' + e); }
      return oScope.apply(this, arguments);
    };
    wScope.__ocCoord = true; wScope.__orig = oScope;
    _scope = wScope; done.push('_scope');
  }

  /* ---------------- 2a. _seesAll ---------------- */
  if(typeof _seesAll === 'function' && !_seesAll.__ocCoord){
    var oSees = _seesAll;
    var wSees = function(coll, u){
      try{ if(lc_isCoord_(u) && (LC_COLLS.indexOf(coll) >= 0 || coll === 'customers')) return true; }catch(e){}
      return oSees.apply(this, arguments);
    };
    wSees.__ocCoord = true; wSees.__orig = oSees;
    _seesAll = wSees; done.push('_seesAll');
  }

  /* ---------------- 2b. _route (likhne par pehra) ---------------- */
  if(typeof _route === 'function' && !_route.__ocCoord){
    var oRoute = _route;
    var wRoute = function(p, verb){
      try{
        var act = p && p.action;
        if(LC_ON && (act === 'save' || act === 'saveMany' || act === 'delete') && (LC_COLLS.indexOf(p.collection) >= 0 || p.collection === 'customers')){
          var u = null;
          try{ u = _verify(p.sid); }catch(e){ u = null; }
          if(lc_isCoord_(u)){
            if(act === 'delete') return { ok:false, error:'forbidden', message:'Lead Coordinator delete nahi kar sakti' };
            var coll = p.collection;
            var recs = (act === 'saveMany') ? (p.records || []) : [p.record || (p.records && p.records[0])];
            var ex = _readAll(coll) || [], byId = {}, i;
            for(i = 0; i < ex.length; i++) if(ex[i] && ex[i].id != null) byId[lc_s_(ex[i].id)] = ex[i];
            var keep = [], bad = 0;
            recs.forEach(function(r){
              if(!r || r.id == null){ bad++; return; }
              var cur = byId[lc_s_(r.id)];
              /* v72 customers: naya customer (Add Enquiry ke andar), ya wahi jo
                 coordinator ne banaya -- uska owner salesperson ko de sakti hai */
              if(coll === 'customers'){
                if(!cur){ keep.push(r); return; }
                var co = lc_lc_(lc_body_(cur).owner);
                if(co === '' || co === lc_lc_(u.email)){ keep.push(r); return; }
                bad++; return;
              }
              /* v72: nayi enquiry (status New) bana sakti hai; nayi lead nahi */
              if(!cur){
                if(coll === 'enquiries' && (lc_fresh_(lc_body_(r), coll) || lc_qnq_(lc_body_(r), coll))){
                  var nb0 = lc_body_(r); delete nb0._cPhone; delete nb0._cContact;
                  if(lc_qnq_(nb0, coll) && !lc_has_(nb0.coordStatusAt)){ nb0.coordStatusAt = new Date().toISOString(); nb0.coordStatusBy = lc_lc_(u.email); }
                  keep.push(r); return;
                }
                bad++; return;
              }
              var cb = lc_body_(cur), nb = lc_body_(r);
              delete nb._cPhone; delete nb._cContact;                    /* sirf dikhane ke liye -- sheet me nahi */
              /* v73: coordinator ne assign kar di (coordAt) -> ab sirf dekhne ke liye */
              if(lc_has_(cb.coordAt)){ bad++; return; }
              /* v73.2: pehle se kisi salesperson ke paas -> sirf dekhne ke liye */
              if(lc_assigned_(cb, coll)){ bad++; return; }
              /* sheet par lead abhi New / Created ho, ya coordinator ne hi Q / NQ ki ho */
              if(!(lc_fresh_(cb, coll) || (lc_has_(cb.coordStatusAt) && lc_qnq_(cb, coll)))){ bad++; return; }
              /* status sirf New / Created / Qualified / Not Qualified (v70) */
              if(!(lc_fresh_(nb, coll) || lc_qnq_(nb, coll))){ bad++; return; }
              if(lc_statusKey_(cb, coll) !== lc_statusKey_(nb, coll) && !lc_has_(nb.coordStatusAt)){
                nb.coordStatusAt = new Date().toISOString(); nb.coordStatusBy = lc_lc_(u.email);
              }
              keep.push(r);
            });
            if(!keep.length){
              return { ok:false, error:'coord_not_fresh', done:0, skipped:bad,
                       message:'Lead ab New / Created nahi hai' };
            }
            if(bad) Logger.log('LeadCoordinator: ' + bad + ' record roke (' + u.email + ', ' + coll + ')');
            p.action = 'saveMany'; p.records = keep; delete p.record;
          }
        }
      }catch(e){ Logger.log('LeadCoordinator _route: ' + e); }
      return oRoute.apply(this, arguments);
    };
    wRoute.__ocCoord = true; wRoute.__orig = oRoute;
    _route = wRoute; done.push('_route');
  }
  return done;
}

/**
 * Jaanch ke liye -- Run karke Execution log dekhiye. Kuch likhta nahi.
 */
function checkLeadCoordinator(){
  var out = [];
  out.push('===== LEAD COORDINATOR PATCH =====');
  out.push('on           : ' + (LC_ON ? 'HAAN' : 'NAHI (LC_ON = false)'));
  out.push('see all (v73): ' + (LC_SEE_ALL ? 'HAAN -- saari leads, sirf padhne ke liye' : 'NAHI -- sirf New / Created'));
  out.push('_scope laga  : ' + ((typeof _scope === 'function' && _scope.__ocCoord) ? 'HAAN' : 'NAHI'));
  out.push('_seesAll laga: ' + ((typeof _seesAll === 'function' && _seesAll.__ocCoord) ? 'HAAN' : 'NAHI'));
  out.push('_route laga  : ' + ((typeof _route === 'function' && _route.__ocCoord) ? 'HAAN' : 'NAHI'));
  out.push('coordinators : ' + LC_EMAILS.join(', ') + '  + role "Lead Coordinator"');

  var u = { email: LC_EMAILS[0], role: 'Lead Coordinator', isAdmin: false };
  LC_COLLS.forEach(function(c){
    try{
      var all = _readAll(c) || [];
      var got = _scope(c, all, u) || [];
      var gem = 0;
      if(c === 'metaLeads') got.forEach(function(r){ var d = lc_body_(r); if(lc_lc_(d.platform) === 'gem' || /^GEM-/i.test(lc_s_(d.id))) gem++; });
      out.push('  ' + c + ': sheet me ' + all.length + ' -> coordinator ko ' + got.length
               + (c === 'metaLeads' ? '  (Meta ' + (got.length - gem) + ' + Gem ' + gem + ')' : '')
               + '  | assign ke liye baaki: ' + got.filter(function(r){ return lc_visible_(lc_body_(r), c); }).length);
    }catch(e){ out.push('  ' + c + ' -- error: ' + e); }
  });
  try{
    var ord = _scope('orders', _readAll('orders') || [], u) || [];
    out.push('  orders (bahar rehna chahiye): ' + ord.length + '   (0 aana chahiye)');
  }catch(e){}

  out.push('');
  out.push('Sab "HAAN" ho to ab ZAROORI:');
  out.push('  Deploy > Manage deployments > pencil > Version: New version > Deploy');
  out.push('=====');
  Logger.log(out.join('\n'));
}
