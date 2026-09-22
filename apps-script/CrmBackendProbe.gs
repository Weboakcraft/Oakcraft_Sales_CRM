/**
 * CRM backend probe — sirf JAANCH ke liye. Kuch likhta nahi, kuch badalta nahi.
 * ----------------------------------------------------------------------------
 * Kyun: IndiaMART ki leads backend sheet ke `indiamartLeads` tab me pahunch
 * chuki hain, par CRM (web app) me section khaali dikhta hai. Iska matlab
 * Code.gs apne jawab me is collection ko bhejta hi nahi -- ya to `getAll` ki
 * apni list me ye naam nahi hai, ya `list` action ise nahi jaanta.
 *
 * Code.gs ko chhue bina theek karne ke liye pehle ye jaanna zaroori hai ki
 * Code.gs collections ki list KAHAN rakhta hai. Ye file wahi pata karti hai.
 *
 * Kaise chalayein (Apps Script editor me, Code.gs ke saath):
 *   1. Ye file paste kijiye.
 *   2. `probeCrmBackend` run kijiye.
 *   3. Execution log poora copy karke bhej dijiye.
 *
 * Ye file:
 *   - sirf padhti hai (koi setValue / upsert / delete nahi),
 *   - kisi bhi tarah ka password, token ya user data log nahi karti,
 *   - chalane ke baad hata bhi sakte hain, kuch peeche nahi chhodti.
 */

/** Sab kuch ek saath — yahi chalaiye aur log bhej dijiye. */
function probeCrmBackend(){
  var out = [];
  out.push('===== CRM BACKEND PROBE =====');

  /* ---- 1. writer / reader functions maujood hain? ---- */
  ['_readAll','_upsertMany','_upsert','_delete','_remove','_sheetFor','_collSheet','doGet','doPost']
    .forEach(function(n){
      var t = 'nahi mila';
      try{ t = (typeof this[n]); }catch(e){}
      try{ t = (typeof eval(n)); }catch(e){}
      out.push('fn ' + n + ' : ' + t);
    });

  /* ---- 2. har collection me kitni rows dikhti hain ---- */
  ['enquiries','orders','metaLeads','indiamartLeads','users','activity'].forEach(function(c){
    var n = 'ERR';
    try{ n = (_readAll(c) || []).length; }catch(e){ n = 'ERR ' + e; }
    out.push('_readAll("' + c + '") -> ' + n);
  });

  /* ---- 3. global scope me collections ki list kahan hai? ---- */
  try{
    var g = this, names = [];
    try{ names = Object.keys(g); }catch(e){}
    out.push('globals: ' + names.length);
    names.forEach(function(n){
      var v;
      try{ v = g[n]; }catch(e){ return; }
      if(v && Object.prototype.toString.call(v) === '[object Array]'){
        var flat = '';
        try{ flat = v.join(','); }catch(e){ return; }
        if(/enquiries|metaLeads|orders|quotations|dispatch/.test(flat) && flat.length < 600){
          out.push('ARRAY  ' + n + ' = [' + flat + ']');
        }
      } else if(v && typeof v === 'object' && !(v instanceof Date) && typeof v !== 'function'){
        var keys = [];
        try{ keys = Object.keys(v); }catch(e){ return; }
        var kj = keys.join(',');
        if(/enquiries|metaLeads|orders/.test(kj) && kj.length < 600){
          out.push('OBJECT ' + n + ' keys = [' + kj + ']');
        }
      }
    });
    /* collection jaise dikhne wale function bhi bata do */
    names.forEach(function(n){
      var v; try{ v = g[n]; }catch(e){ return; }
      if(typeof v === 'function' && /coll|sheet|schema|table|registry/i.test(n)) out.push('fn?    ' + n);
    });
  }catch(err){ out.push('globals scan error: ' + err); }

  /* ---- 4. sheet me kaun kaun se tab hain ---- */
  try{
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    out.push('spreadsheet: ' + ss.getName());
    out.push('tabs: ' + ss.getSheets().map(function(sh){
      return sh.getName() + '(' + Math.max(0, sh.getLastRow() - 1) + ')';
    }).join(', '));
  }catch(e){ out.push('tabs error: ' + e); }

  /* ---- 5. asli API se poochho: list aur getAll kya lautate hain ---- */
  out.push(probe_call_('list', { action:'list', collection:'indiamartLeads' }));
  out.push(probe_call_('list', { action:'list', collection:'metaLeads' }));
  out.push(probe_call_('getAll', { action:'getAll' }));

  out.push('===== END =====');
  Logger.log(out.join('\n'));
}

/** doPost ko seedha bula kar dekho wo kya jawab deta hai (kuch likhta nahi). */
function probe_call_(label, payload){
  try{
    if(typeof doPost !== 'function') return 'API ' + label + ' : doPost nahi mila';
    var res = doPost({ postData: { contents: JSON.stringify(payload), type:'text/plain' }, parameter: {} });
    var txt = '';
    try{ txt = String(res.getContent()); }catch(e){ txt = String(res); }
    /* jawab bada ho sakta hai -- sirf shuruaat aur collection ke naam chahiye */
    var head = txt.slice(0, 300);
    var keys = '';
    try{
      var j = JSON.parse(txt);
      var d = (j && j.data) || {};
      if(d && typeof d === 'object' && !(d instanceof Array)) keys = ' | data keys: ' + Object.keys(d).join(',');
      else if(d instanceof Array) keys = ' | data rows: ' + d.length;
    }catch(e){}
    return 'API ' + label + ' (' + (payload.collection || '-') + ') : ' + head + keys;
  }catch(err){
    return 'API ' + label + ' (' + (payload.collection || '-') + ') : ERROR ' + err;
  }
}
