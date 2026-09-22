/**
 * `indiamartLeads` ko backend ki allowed-collections list me jodne ka patch.
 * ----------------------------------------------------------------------------
 * DIKKAT
 *   CRM ka web app har request par collection ka naam apni ek list se milata
 *   hai. Us list me `indiamartLeads` nahi hai, isliye app ko jawab milta hai:
 *       { error: "bad_collection" }
 *   Yahi wajah hai ki backend sheet ke `indiamartLeads` tab me data hone ke
 *   baad bhi CRM ka IndiaMART section khaali dikhta hai. (Leads sheet me isliye
 *   pahunch gayin kyunki Apps Script andar se seedha _upsertMany() bulata hai,
 *   jahan ye check lagta hi nahi.)
 *
 * KYA KARTA HAI
 *   Load hote hi backend ki wahi list dhoondh kar usme `indiamartLeads` jod
 *   deta hai -- list ka naam kuch bhi ho (COLLECTIONS / COLLS / ALLOWED /
 *   VALID_COLLECTIONS ...), kyunki naam se nahi, CONTENT se pehchanta hai:
 *   jis array/object me 'enquiries' aur 'orders' dono hain, wahi list hai.
 *   Kisi maujooda naam ko na hataata hai, na badalta hai.
 *
 * KAISE LAGAYEIN  (dono me se koi bhi ek)
 *   A) SABSE PAKKA — Code.gs ke SABSE NEECHE ye poora code paste kar dijiye
 *      (Code.gs ka baaki kuch mat chhediye), phir Save.
 *   B) Ya ise alag file ki tarah paste kijiye. Ye tabhi chalega jab ye file
 *      Code.gs ke BAAD load ho (aam taur par baad me banayi gayi file baad me
 *      hi load hoti hai). Kaam hua ya nahi -- `checkIndiaMartCollection`
 *      chala kar dekh lijiye.
 *
 * ISKE BAAD — ZAROORI
 *   Deploy > Manage deployments > pencil (edit) > Version: "New version" >
 *   Deploy. URL wahi rehta hai. Naye version ke bina web app purana code hi
 *   chalata rahega.
 *
 * SAFETY
 *   - Kisi sheet ko na padhta hai na likhta hai.
 *   - Sirf ek naam list me jodta hai; hataata kuch nahi.
 *   - Do baar chal jaye to bhi naam sirf ek hi baar judta hai.
 */

/** Load hote hi apne aap chal jaata hai. */
(function(){
  try{ ocAllowIndiaMartCollection_(); }catch(e){}
})();

/**
 * Backend ki allowed-collections list dhoondh kar usme naam jod do.
 * @return {Array<string>} jin variables me naam joda gaya
 */
function ocAllowIndiaMartCollection_(){
  var WANT = 'indiamartLeads';
  var MARKERS = ['enquiries', 'orders'];        /* asli list me ye dono honge */
  var patched = [];
  var g = this, names = [];
  try{ names = Object.keys(g); }catch(e){ return patched; }

  names.forEach(function(n){
    var v;
    try{ v = g[n]; }catch(e){ return; }
    if(!v || typeof v === 'function') return;

    /* shakal 1: ['enquiries','orders',...] */
    if(Object.prototype.toString.call(v) === '[object Array]'){
      var hasAll = true;
      MARKERS.forEach(function(m){ if(v.indexOf(m) < 0) hasAll = false; });
      if(!hasAll) return;
      if(v.indexOf(WANT) < 0){ v.push(WANT); patched.push(n + ' (array)'); }
      return;
    }

    /* shakal 2: { enquiries: {...}, orders: {...} } */
    if(typeof v === 'object' && !(v instanceof Date)){
      var keys = [];
      try{ keys = Object.keys(v); }catch(e){ return; }
      var ok = true;
      MARKERS.forEach(function(m){ if(keys.indexOf(m) < 0) ok = false; });
      if(!ok) return;
      if(keys.indexOf(WANT) < 0){
        try{ v[WANT] = v.metaLeads !== undefined ? v.metaLeads : true; patched.push(n + ' (object)'); }
        catch(e){}
      }
    }
  });
  return patched;
}

/**
 * Jaanch ke liye — chala kar log dekh lijiye. Kuch badalta nahi (patch to
 * upar apne aap lag chuka hota hai), sirf batata hai kya mila.
 */
function checkIndiaMartCollection(){
  var out = [], WANT = 'indiamartLeads';
  var found = [];
  try{
    var g = this, names = Object.keys(g);
    names.forEach(function(n){
      var v; try{ v = g[n]; }catch(e){ return; }
      if(!v || typeof v === 'function') return;
      if(Object.prototype.toString.call(v) === '[object Array]'){
        if(v.indexOf('enquiries') >= 0 && v.indexOf('orders') >= 0){
          found.push(n + ' (array) -> ' + (v.indexOf(WANT) >= 0 ? 'HAAN, naam juda hai' : 'NAHI') + ' : [' + v.join(',') + ']');
        }
      } else if(typeof v === 'object' && !(v instanceof Date)){
        var keys = []; try{ keys = Object.keys(v); }catch(e){ return; }
        if(keys.indexOf('enquiries') >= 0 && keys.indexOf('orders') >= 0){
          found.push(n + ' (object) -> ' + (keys.indexOf(WANT) >= 0 ? 'HAAN, naam juda hai' : 'NAHI') + ' : [' + keys.join(',') + ']');
        }
      }
    });
  }catch(e){ out.push('scan error: ' + e); }

  if(!found.length){
    out.push('Koi allowed-collections list nahi mili (na array, na object).');
    out.push('Iska matlab list kisi function ke andar chhupi hai. Code.gs me "bad_collection"');
    out.push('search kijiye -- uske aas-paas collection ke naamo ki list hogi; usme');
    out.push('\'indiamartLeads\' haath se jod dijiye.');
  } else {
    out.push('Mili hui list(ein):');
    found.forEach(function(f){ out.push('  ' + f); });
    out.push('"HAAN" likha hai to patch lag chuka hai -- ab Deploy > Manage deployments >');
    out.push('edit > New version > Deploy zaroor kijiye.');
  }
  /* seedha API se bhi pooch lo */
  try{
    if(typeof doPost === 'function'){
      var res = doPost({ postData: { contents: JSON.stringify({ action:'list', collection:WANT }), type:'text/plain' }, parameter: {} });
      out.push('API list(' + WANT + ') ka jawab: ' + String(res.getContent()).slice(0, 200));
    }
  }catch(e){ out.push('API test error: ' + e); }
  Logger.log(out.join('\n'));
}
