/**
 * Qualified ke naye fields sheet tak pahunche ya nahi — SIRF JAANCH.
 * ----------------------------------------------------------------------------
 * Kuch likhta nahi, kuch badalta nahi. Chala kar log bhej dijiye.
 *
 * KYUN
 *   CRM me "Qualified" ek ALAG DATABASE NAHI hai -- wo ek VIEW hai. Uska apna
 *   koi tab nahi banta aur banna bhi nahi chahiye. Wo teen jagah se padhta hai:
 *
 *       enquiries  +  indiamartLeads  +  metaLeads
 *
 *   ...aur jis record ka status Qualified / System Master / Quotation Sent /
 *   Won / Lost hota hai, wahi Qualified section me dikh jaata hai. Agar uska
 *   apna tab hota to ek hi lead ki DO copy ho jaatin -- ek lead wale tab me,
 *   ek Qualified tab me -- aur status badalte hi dono alag-alag ho jaatin.
 *
 *   Qualified par jo do sawaal poochhe jaate hain, unke jawab USI lead ke
 *   record par likhe jaate hain:
 *
 *       qualCustType        Architect / Hotel / Resort / ...
 *       qualCustTypeOther   "Other" chuna to salesperson ka likha hua
 *       qualQty             purchase quantity
 *       qualAskedAt         kab bhara gaya
 *
 *   Yaani inka ghar wahi teen tab hain. Ye file batati hai ki wo wahan
 *   pahunche ya nahi -- aur agar nahi, to kahan atke.
 *
 * KAISE CHALAYEIN
 *   1. Ye file Apps Script me paste kijiye (Code.gs ke saath waale project me).
 *   2. `checkQualifiedFields` run kijiye.
 *   3. Execution log poora copy karke bhej dijiye.
 *
 * SAFETY
 *   - Sirf padhti hai. Koi setValue / upsert / delete nahi.
 *   - Kisi ka password, token ya poora data log nahi karti -- sirf ginti,
 *     column ke naam aur ek nammune ka type/qty.
 *   - Chalane ke baad file hata bhi sakte hain, kuch peeche nahi chhodti.
 */

var QFC_COLLS = ['enquiries', 'indiamartLeads', 'metaLeads'];
var QFC_FIELDS = ['qualCustType', 'qualCustTypeOther', 'qualQty', 'qualAskedAt'];

/** Yahi chalaiye. */
function checkQualifiedFields(){
  var out = [];
  out.push('===== QUALIFIED FIELDS CHECK =====');
  out.push('Qualified ka apna koi tab nahi hota -- wo view hai.');
  out.push('Jawab in teen collection ke record par hi likhe jaate hain.');
  out.push('');

  /* ---- 1. record me fields hain ya nahi (_readAll se) ---- */
  out.push('--- 1. CRM ke record me (backend ne jo padha) ---');
  QFC_COLLS.forEach(function(c){
    var rows = [];
    try{ rows = _readAll(c) || []; }
    catch(e){ out.push('  ' + c + ' : padha nahi gaya -- ' + e); return; }

    var total = rows.length, qual = 0, filled = 0, sample = '';
    rows.forEach(function(r){
      var d = (r && r.data !== undefined) ? r.data : r;
      if(!d || typeof d !== 'object') return;
      var st = qfc_lc_(d.lead_status || d.status || d.stage);
      var isQ = (st === 'qualified' || st === 'system_master' || st === 'system master'
              || st === 'quotation_sent' || st === 'quoted' || st === 'won' || st === 'lost');
      if(isQ) qual++;
      if(qfc_tr_(d.qualCustType) && qfc_tr_(d.qualQty)){
        filled++;
        if(!sample) sample = qfc_tr_(d.qualCustType)
          + (qfc_tr_(d.qualCustTypeOther) ? ' (' + qfc_tr_(d.qualCustTypeOther) + ')' : '')
          + ' , qty ' + qfc_tr_(d.qualQty);
      }
    });
    out.push('  ' + c + ' : ' + total + ' record | qualified-type status par ' + qual
             + ' | jawab bhare hue ' + filled + (sample ? '  (jaise: ' + sample + ')' : ''));
  });

  /* ---- 2. sheet ke tab me column bane ya nahi ---- */
  out.push('');
  out.push('--- 2. Sheet ke tab me column ---');
  var ss = null;
  try{ ss = SpreadsheetApp.getActiveSpreadsheet(); }catch(e){}
  if(!ss){
    out.push('  Spreadsheet nahi mila (ye file us project me chalaiye jo backend sheet se juda hai).');
  } else {
    out.push('  spreadsheet: ' + ss.getName());
    QFC_COLLS.forEach(function(c){
      var sh = null;
      try{ sh = ss.getSheetByName(c); }catch(e){}
      if(!sh){ out.push('  ' + c + ' : tab hi nahi mila'); return; }
      var head = [];
      try{
        var lc = sh.getLastColumn();
        if(lc > 0) head = sh.getRange(1, 1, 1, lc).getValues()[0] || [];
      }catch(e){}
      var lower = head.map(function(h){ return qfc_lc_(h); });
      var missing = [];
      QFC_FIELDS.forEach(function(f){ if(lower.indexOf(qfc_lc_(f)) < 0) missing.push(f); });

      out.push('  ' + c + ' : ' + Math.max(0, sh.getLastRow() - 1) + ' row, ' + head.length + ' column');
      out.push('      header: ' + head.join(' | ').slice(0, 400));
      out.push('      qual* column : ' + (missing.length ? 'NAHI mile -> ' + missing.join(', ') : 'sab maujood'));
      /* data ek hi JSON column me to nahi rakha? */
      if(lower.indexOf('data') >= 0){
        out.push('      NOTE: "data" naam ka column hai -- backend poora record JSON me rakhta hai,');
        out.push('            isliye alag column banne ki zarurat hi nahi. Jawab uske andar honge.');
      }
    });
  }

  /* ---- 3. faisla ---- */
  out.push('');
  out.push('--- 3. Matlab ---');
  out.push('  (a) "jawab bhare hue" 0 hai -> abhi kisi lead par form bhara hi nahi gaya.');
  out.push('      CRM me ek lead Qualified karke dekhiye, phir dobara chalaiye.');
  out.push('  (b) record me jawab dikh rahe hain aur column bhi ban gaye -> sab theek hai.');
  out.push('  (c) record me jawab dikh rahe hain par column nahi bane -> Code.gs naye');
  out.push('      column khud nahi banata. Ye log bhej dijiye, uska patch bana dunga.');
  out.push('  (d) record me jawab NAHI dikh rahe par CRM me dikh rahe hain -> push atka hai;');
  out.push('      CRM ke console me ocLeadPending() chala kar dekhiye.');
  out.push('===== END =====');
  Logger.log(out.join('\n'));
}

function qfc_tr_(v){ return v == null ? '' : String(v).trim(); }
function qfc_lc_(v){ return qfc_tr_(v).toLowerCase(); }
