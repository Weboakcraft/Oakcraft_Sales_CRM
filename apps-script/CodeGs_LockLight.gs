/**
 * OakCraft CRM — LOCK LIGHT (v63)
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
 * BAND KARNA HO:  var LOCK_LIGHT = false;  karke Save.
 */

var LOCK_LIGHT = true;
var LOCK_LIGHT_FULL_EVERY_MIN = 15;

(function(){ try{ ocLockLightInstall_(); }catch(e){ Logger.log('LockLight install fail: ' + e); } })();

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
  var s = (ok ? 'OK  ' : 'FAIL') + ' LockLight laga: ' + ok + ' | source rows: ' + rows.length
        + ' | pending (nayi) leads: ' + pend.length + ' | pre-check time: ' + (Date.now() - t0) + 'ms (bina lock)';
  Logger.log(s); return s;
}
