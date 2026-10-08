/**
 * OakCraft CRM — LOCK LIGHT (v63.1 — Meta + IndiaMART)
 * ----------------------------------------------------------------------------
 * DIKKAT (Executions log se mili, 08-10-2026)
 *   `metaAutoSyncTick` har MINUTE chalta hai aur shuru hote hi SCRIPT LOCK le
 *   leta hai -- phir source sheet padhta hai, CRM ki metaLeads padhta hai ...
 *   ~20 sec (kabhi 85 sec, ek baar 470 sec) tak lock pakde rehta hai, CHAHE
 *   KOI NAYI LEAD NA HO ("koi khaali Sync Status row nahi").
 *   CRM ka har save (order / quotation / enquiry / lead status) usi lock ka
 *   45 sec tak intezaar karta hai, phir "busy" error -- save us waqt hota hi
 *   nahi. Employee ko lagta hai update nahi hua aur wo dobara karta hai.
 *
 * KYA KARTA HAI
 *   `mas_run_` ko lapet-ta hai: pehle BINA LOCK ke dekhta hai ki koi pending
 *   row (column H khaali) hai ya nahi. Nahi hai -> wahin khatam, lock liya hi
 *   nahi. Hai -> MetaAutoSync ka apna asli run (lock ke saath) bilkul pehle
 *   jaisa. Koi data na padha jaata hai na likha jaata hai jo pehle nahi hota.
 *
 *   Safety: har 15 minute me ek baar asli run hamesha chalta hai (bina
 *   pre-check ke), taaki pre-check me kabhi chook ho to bhi lead na ruke.
 *
 * KAISE LAGAYEIN
 *   1. Apps Script me nayi Script file `LockLight` (sabse neeche) -> ye code -> Save.
 *   2. `lockLightCheck` Run -> log me "OK" aana chahiye.
 *   3. Deploy > Manage deployments > pencil > New version > Deploy.
 *      (Trigger "Head" code chalata hai, isliye Meta sync par asar Save karte hi
 *       shuru ho jaata hai; deploy web app ke liye zaroori hai.)
 *
 * v63.1 — IndiaMART bhi: `indiaMartAutoSyncTick` har 5 minute script lock lekar
 *   21 sec se 160 sec tak pakde rehta tha (08-10-2026 ko 129s, 161s). Ab pehle
 *   BINA LOCK source sheet padhi jaati hai; agar pichhle run se sheet bilkul
 *   nahi badli to run wahin khatam (lock nahi). Badli ho to asli run pehle
 *   jaisa. Har 30 minute me ek baar asli run hamesha.
 *
 * SABOOT (Executions, 08-10-2026 10:48-10:50): metaAutoSyncTick 282 sec chala,
 *   usi dauran 7 CRM saves ne theek 45.9 sec liye -- yaani lock ka intezaar
 *   khatam, "busy", save nahi hua. LockLight ke baad Meta tick 21s -> 4-5s.
 *
 * BAND KARNA HO:  var LOCK_LIGHT = false;  karke Save.
 */

var LOCK_LIGHT = true;
var LOCK_LIGHT_FULL_EVERY_MIN = 15;
var LOCK_LIGHT_IMS_FULL_EVERY_MIN = 30;

(function(){ try{ ocLockLightInstall_(); }catch(e){ Logger.log('LockLight install fail: ' + e); } })();
(function(){ try{ ocLockLightImsInstall_(); }catch(e){ Logger.log('LockLight IMS install fail: ' + e); } })();

/* IndiaMART: source sheet ki "chhaap" (hash). Sheet na badle to run ki zaroorat nahi. */
function llImsSig_(src){
  var rows = (src && src.rows) || [];
  var d = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(rows), Utilities.Charset.UTF_8);
  return rows.length + ':' + Utilities.base64Encode(d);
}
function ocLockLightImsInstall_(){
  if(typeof ims_run_ !== 'function' || ims_run_.__ocLight) return typeof ims_run_ === 'function';
  if(typeof ims_srcRows_ !== 'function') return false;
  var orig = ims_run_;
  var w = function(dryRun){
    var sig = null, props = null;
    try{
      if(LOCK_LIGHT && !dryRun){
        props = PropertiesService.getScriptProperties();
        sig = llImsSig_(ims_srcRows_());
        var last = props.getProperty('LL_IMS_SIG') || '';
        var lastAt = parseInt(props.getProperty('LL_IMS_AT') || '0', 10) || 0;
        var due = (Date.now() - lastAt) > LOCK_LIGHT_IMS_FULL_EVERY_MIN * 60000;
        if(sig === last && !due) return;                         /* sheet nahi badli -- LOCK NAHI */
      }
    }catch(e){ sig = null; Logger.log('LockLight IMS pre-check fail, normal run: ' + e); }
    var out = orig.apply(this, arguments);
    try{
      if(sig && props){ props.setProperty('LL_IMS_SIG', sig); props.setProperty('LL_IMS_AT', String(Date.now())); }
    }catch(e){}
    return out;
  };
  w.__ocLight = 1; w.__orig = orig;
  ims_run_ = w;
  return true;
}

function ocLockLightInstall_(){
  if(typeof mas_run_ !== 'function' || mas_run_.__ocLight) return typeof mas_run_ === 'function';
  if(typeof mas_srcRows_ !== 'function' || typeof mas_pendingRows_ !== 'function') return false;
  var orig = mas_run_;
  var w = function(dryRun){
    try{
      var fullRun = (new Date().getMinutes() % LOCK_LIGHT_FULL_EVERY_MIN) === 0;
      if(LOCK_LIGHT && !dryRun && !fullRun){
        var rows = mas_srcRows_();
        if(!rows || !rows.length) return;                         /* khaali source -- kuch nahi */
        var pending = mas_pendingRows_(rows);
        if(!pending || !pending.length) return;                   /* koi nayi lead nahi -- LOCK NAHI */
      }
    }catch(e){
      Logger.log('LockLight pre-check fail, normal run: ' + e);    /* shak ho to asli run */
    }
    return orig.apply(this, arguments);
  };
  w.__ocLight = 1; w.__orig = orig;
  mas_run_ = w;
  return true;
}

/** Jaanch: patch laga ya nahi, aur abhi kitni pending rows hain (kuch likhta nahi). */
function lockLightCheck(){
  var ok = ocLockLightInstall_() && !!mas_run_.__ocLight;
  var t0 = Date.now(), rows = mas_srcRows_(), pend = mas_pendingRows_(rows);
  var s = (ok ? 'OK  ' : 'FAIL') + ' Meta LockLight: ' + ok + ' | source rows: ' + rows.length
        + ' | pending (nayi) leads: ' + pend.length + ' | pre-check: ' + (Date.now() - t0) + 'ms (bina lock)';
  Logger.log(s);
  var ok2 = ocLockLightImsInstall_() && !!ims_run_.__ocLight;
  var t1 = Date.now(), src = ims_srcRows_(), sig = llImsSig_(src);
  var last = PropertiesService.getScriptProperties().getProperty('LL_IMS_SIG') || '(abhi tak koi run nahi)';
  var s2 = (ok2 ? 'OK  ' : 'FAIL') + ' IndiaMART LockLight: ' + ok2 + ' | source rows: ' + src.rows.length
         + ' | sheet badli: ' + (sig !== last) + ' | pre-check: ' + (Date.now() - t1) + 'ms (bina lock)';
  Logger.log(s2);
  return s + '\n' + s2;
}
