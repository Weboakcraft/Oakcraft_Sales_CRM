/**
 * LEAD COORDINATOR — backend patch (CRM v69)
 * ----------------------------------------------------------------------------
 * KAUN
 *   oakcraftcoordinator@gmail.com (LC_EMAILS) -- ya koi bhi user jiska role
 *   "Lead Coordinator" ho. Admin par is file ka koi asar nahi.
 *
 * KYA KARTA HAI (sirf lapet-ta hai -- Code.gs ka ek bhi akshar nahi badalta)
 *   1. PADHNA -- `_scope()`:
 *        enquiries / metaLeads (Meta + Gem) / indiamartLeads me coordinator
 *        ko SABHI salespersons ki wo leads milti hain jinka status
 *        New / Created hai aur jo abhi tak coordinator ne assign nahi ki
 *        (`coordAt` khaali). Baaki collections pehle jaise -- sirf apna
 *        (yaani kuch nahi).
 *   2. LIKHNA -- `_seesAll()` + `_route()`:
 *        Coordinator in teen collections me sirf ek kaam kar sakti hai --
 *        New / Created lead ka owner (salesperson) badalna. `_route` me
 *        pehra:
 *          - delete band
 *          - naya record band
 *          - sirf wahi lead jo sheet par abhi bhi New / Created hai
 *          - status badalna band (aane wala record bhi New / Created ho)
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
function lc_visible_(d, coll){
  if(!lc_fresh_(d, coll)) return false;
  var at = d.coordAt;
  if(at instanceof Date) return false;
  return !lc_s_(at).trim();
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
        if(lc_isCoord_(u) && LC_COLLS.indexOf(coll) >= 0){
          var out = [];
          (rows || []).forEach(function(r){ if(r && lc_visible_(lc_body_(r), coll)) out.push(r); });
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
      try{ if(lc_isCoord_(u) && LC_COLLS.indexOf(coll) >= 0) return true; }catch(e){}
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
        if(LC_ON && (act === 'save' || act === 'saveMany' || act === 'delete') && LC_COLLS.indexOf(p.collection) >= 0){
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
              if(!cur){ bad++; return; }                                  /* naya record nahi */
              if(!lc_fresh_(lc_body_(cur), coll)){ bad++; return; }      /* sheet par ab New nahi */
              if(!lc_fresh_(lc_body_(r), coll)){ bad++; return; }        /* status badalna nahi */
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
               + (c === 'metaLeads' ? '  (Meta ' + (got.length - gem) + ' + Gem ' + gem + ')' : ''));
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
