/**
 * Bina naam wali (unassigned) lead poori sales team tak pahunchaane ka patch.
 * ----------------------------------------------------------------------------
 * DIKKAT
 *   CRM me rule lag chuka hai ki jis lead par kisi ka naam na ho wo sabko
 *   dikhe, aur naam padte hi sirf usi ko. Par salesperson ke login me pool
 *   khaali dikhta tha -- kyunki wo rows uske device tak pahunchti hi nahi.
 *
 *   Wajah Code.gs ke `_scope()` me hai. Uska aakhri hissa:
 *
 *       for(var i=0;i<rows.length;i++){
 *         if(_ownerOf(rows[i]) === u.email) out.push(rows[i]);
 *       }
 *
 *   `_ownerOf()` bina naam wali row par khaali string ('') lautaata hai, aur
 *   '' kisi ke email ke barabar nahi hota. Isliye aisi HAR row chhant jaati
 *   hai -- wo kisi ki nahi hai, phir bhi kisi ko nahi milti.
 *
 * KYA KARTA HAI
 *   `_scope()` ko lapet deta hai. Sirf LEAD wali collections par, aur sirf
 *   jab user ko poora data nahi milta, wo un rows ko WAAPAS jod deta hai
 *   jinpar KISI KA BHI naam nahi hai. Jis row par kisi aur ka naam hai wo
 *   pehle ki tarah nahi dikhti.
 *
 *   Yaani sirf itna badla: "jo kisi ki nahi hai wo sabki hai".
 *   Kisi ka niji data nahi khulta.
 *
 * KAISE LAGAYEIN
 *   1. Ye poora code ek nayi file me paste kijiye (Code.gs ke saath waale
 *      project me) -- ya Code.gs ke sabse neeche. Phir Save.
 *   2. `checkPoolScope` run karke dekh lijiye ki patch lag gaya.
 *   3. ZAROORI -- Deploy > Manage deployments > pencil (edit) >
 *      Version: "New version" > Deploy.
 *      URL wahi rehta hai. Naye version ke bina web app purana code hi
 *      chalata rahega aur kuch nahi badlega.
 *
 * WAPAS HATANA HO
 *   POOL_COLLS ko khaali kar dijiye:  var POOL_COLLS = [];
 *   Sab pehle jaisa ho jayega.
 *
 * SAFETY
 *   - Kisi sheet ko na padhta hai na likhta hai.
 *   - Sirf PADHNE ka dayra badalta hai, aur wo bhi sirf un rows ka jinpar
 *     kisi ka naam nahi. Admin / Sales Manager par koi asar nahi (unhe
 *     pehle se sab milta hai).
 *   - Do baar chal jaye to bhi ek hi baar lagta hai.
 */

/* Sirf in collections me "bina naam wali lead sabki" wala rule chalega.
   Yahan se naam hata denge to wo collection pehle jaisa ho jayega. */
var POOL_COLLS = ['indiamartLeads', 'metaLeads'];

/** Load hote hi apne aap lag jaata hai. */
(function(){
  try{ ocPoolPatchScope_(); }catch(e){}
})();

/**
 * `_scope()` ko lapet do -- bina naam wali rows wapas jod do.
 * @return {boolean} laga ya nahi
 */
function ocPoolPatchScope_(){
  if(typeof _scope !== 'function') return false;
  if(_scope.__ocPool) return true;                 /* pehle se laga hai */

  var orig = _scope;
  var wrapped = function(coll, rows, u){
    var out = orig.apply(this, arguments);
    try{
      if(POOL_COLLS.indexOf(coll) < 0) return out;
      if(!u || u.legacy || u.isAdmin) return out;  /* inhe pehle se sab milta hai */
      if(!rows || !out || !rows.length) return out;
      if(out.length === rows.length) return out;   /* sab mil hi raha hai */

      var seen = {}, i, r;
      for(i = 0; i < out.length; i++){
        r = out[i];
        if(r && r.id != null) seen[String(r.id)] = 1;
      }
      var add = [];
      for(i = 0; i < rows.length; i++){
        r = rows[i];
        if(!r) continue;
        if(r.id != null && seen[String(r.id)]) continue;
        if(_ownerOf(r) === '') add.push(r);        /* kisi ki nahi -> sabki */
      }
      return add.length ? out.concat(add) : out;
    }catch(e){ return out; }                       /* kuch gadbad ho to purana hi */
  };
  wrapped.__ocPool = true;
  _scope = wrapped;
  return true;
}

/**
 * Jaanch ke liye — chala kar log dekh lijiye. Kuch badalta nahi.
 * Ek naqli salesperson bana kar dikhata hai ki use ab kya milega.
 */
function checkPoolScope(){
  var out = [];
  out.push('===== POOL SCOPE PATCH =====');

  if(typeof _scope !== 'function'){
    out.push('_scope() nahi mila. Ye file Code.gs waale project me nahi hai,');
    out.push('ya Code.gs se PEHLE load ho rahi hai.');
    Logger.log(out.join('\n')); return;
  }
  out.push('patch laga hai : ' + (_scope.__ocPool ? 'HAAN' : 'NAHI'));
  out.push('collections    : ' + POOL_COLLS.join(', '));

  /* naqli data par chala kar dekho */
  var rows = [
    { id:'A', data:{ owner:'' } },                      /* kisi ki nahi */
    { id:'B', data:{ owner:'' } },                      /* kisi ki nahi */
    { id:'C', data:{ owner:'ujala@oakcraft.in' } },     /* Ujala ki */
    { id:'D', data:{ owner:'niti@oakcraft.in' } }       /* kisi aur ki */
  ];
  var ujala = { email:'ujala@oakcraft.in', role:'Sales Executive', isAdmin:false };
  var admin = { email:'mis@oakcraft.in',   role:'Administrator',   isAdmin:true  };

  POOL_COLLS.forEach(function(c){
    try{
      var got = _scope(c, rows, ujala) || [];
      out.push('  ' + c + ' — Ujala ko milegi: ' + got.map(function(r){ return r.id; }).join(', ')
               + '   (A, B, C aana chahiye — D nahi)');
    }catch(e){ out.push('  ' + c + ' — error: ' + e); }
  });
  try{
    var ga = _scope(POOL_COLLS[0], rows, admin) || [];
    out.push('  admin ko milegi: ' + ga.map(function(r){ return r.id; }).join(', ') + '   (saari)');
  }catch(e){}

  try{
    var enq = _scope('enquiries', rows, ujala) || [];
    out.push('  enquiries (pool se bahar) — Ujala ko: ' + (enq.map(function(r){ return r.id; }).join(', ') || '(sirf apni)')
             + '   (sirf C aana chahiye)');
  }catch(e){}

  out.push('');
  out.push('"HAAN" aur upar wali line sahi ho to ab ZAROORI:');
  out.push('  Deploy > Manage deployments > pencil > Version: New version > Deploy');
  out.push('  Uske bina web app purana code hi chalata rahega.');
  out.push('=====');
  Logger.log(out.join('\n'));
}
