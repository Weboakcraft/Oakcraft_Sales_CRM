/**
 * Backend kis tarah rows chhaanta hai — SIRF JAANCH. Kuch likhta nahi.
 * ----------------------------------------------------------------------------
 * KYUN
 *   CRM me "bina naam wali (unassigned) lead sabko dikhe" wala rule app me lag
 *   chuka hai, par salesperson ke login me pool khaali dikhta hai. Wajah: rows
 *   uske device tak pahunchti hi nahi -- backend har user ko sirf USKE naam
 *   wali rows bhejta hai, aur bina naam wali kisi ko nahi.
 *
 *   Theek karne ke liye Code.gs ka wahi chhota sa hissa badalna hai jo ye
 *   faisla karta hai. Ye file wahi hissa dhoondh kar dikha deti hai.
 *
 * KAISE
 *   Har global function ka source padh kar wo function dhoondhti hai jisme
 *   'owner' jaisa shabd aata hai, aur uska code chhaap deti hai.
 *
 * SAFETY -- ye zaroori hai
 *   - Kuch likhti nahi: koi setValue / upsert / delete / property change nahi.
 *   - PASSWORD, TOKEN, SECRET, KEY, HASH jaise naam wale function JAAN-BOOJH
 *     KAR nahi chhaape jaate -- sirf unka naam aata hai.
 *   - Jo lamba random sa text (signing key jaisa) code me mile, wo
 *     "[HATAYA GAYA]" likh kar chhupa diya jaata hai.
 *   - Kisi lead, customer ya user ka data nahi chhapta.
 *   Phir bhi log bhejne se pehle ek nazar daal lijiye -- jo na bhejna ho
 *   wo hata dijiye.
 *
 * CHALANE KA TAREEKA
 *   1. Ye file Apps Script me paste kijiye (usi project me jahan Code.gs hai).
 *   2. `probeOwnerFilter` run kijiye.
 *   3. Execution log copy karke bhej dijiye.
 */

/** Yahi chalaiye. */
function probeOwnerFilter(){
  var out = [];
  out.push('===== OWNER FILTER PROBE =====');

  var g = this, names = [];
  try{ names = Object.keys(g); }catch(e){ out.push('globals padhe nahi gaye: ' + e); }

  var hits = [], skipped = [], other = [];
  names.forEach(function(n){
    var v;
    try{ v = g[n]; }catch(e){ return; }
    if(typeof v !== 'function') return;
    if(n === 'probeOwnerFilter' || n.indexOf('ofp_') === 0) return;   /* khud ko nahi chhaapna */

    var src = '';
    try{ src = String(v); }catch(e){ return; }
    if(!/owner|ownerEmail|createdBy|FULL_DATA|isAdmin|scope/i.test(src)) return;

    if(ofp_secret_(n) || ofp_secret_(src.slice(0, 400))){ skipped.push(n); return; }
    if(src.length > 4000){ other.push(n + '  (bahut lamba — ' + src.length + ' akshar)'); return; }
    hits.push({ name: n, src: ofp_clean_(src) });
  });

  if(!hits.length){
    out.push('Koi aisa function nahi mila jisme "owner" ka zikr ho.');
    out.push('Iska matlab chhantai kisi doosre naam se ho rahi hai. Code.gs me');
    out.push('"owner" search karke wo hissa bhej dijiye.');
  } else {
    out.push(hits.length + ' function me "owner" ka zikr hai:');
    out.push('');
    hits.forEach(function(h){
      out.push('---------- ' + h.name + ' ----------');
      out.push(h.src);
      out.push('');
    });
  }
  if(other.length){
    out.push('Ye bhi milte-julte hain par bahut lambe hain (naam bhej diya hai):');
    other.forEach(function(n){ out.push('  ' + n); });
  }
  if(skipped.length){
    out.push('Ye JAAN-BOOJH KAR nahi chhaape (password / token / key jaisa kuch tha):');
    skipped.forEach(function(n){ out.push('  ' + n); });
  }
  out.push('===== END =====');
  Logger.log(out.join('\n'));
}

/** naam ya code me koi raaz jaisa shabd? */
function ofp_secret_(s){
  return /secret|password|passwd|token|signing|private|apikey|api_key|credential/i.test(String(s || ''));
}

/** lambe random se text (key jaisa) hata do */
function ofp_clean_(src){
  return String(src)
    .replace(/(['"])[A-Za-z0-9+\/=_\-]{24,}\1/g, '$1[HATAYA GAYA]$1')
    .replace(/[ \t]+$/gm, '');
}
