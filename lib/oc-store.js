/* ==========================================================================
   OC-STORE (v57, build 2026.11.04.1; v56 2026.10.03.1) -- browser storage ko full hone se bachao
   --------------------------------------------------------------------------
   Problem (03-10-2026): "Browser storage is full -- indiamartLeads: new data
   cannot be saved." Chrome ek origin (weboakcraft.github.io) ko ~5 million
   characters ka localStorage deta hai. CRM ka data + uske do snapshot
   (oc_srvSnap, oc_leadSnap = poore data ki doosri copy) + isi origin par
   chalne wale doosre apps ke cache milkar 100% bhar gaye the. Iske baad
   sheet se aaya naya data save hi nahi hota tha: Orders 30/09 par atak gaye,
   IndiaMART refresh band.

   Ilaaj: CRM ki badi keys localStorage me COMPRESSED (LZ-String, UTF-16)
   likhi jaati hain -- ~8x chhoti. Ye layer Storage.prototype.getItem /
   setItem ke andar baithti hai, isliye app ka baaki code (62 jagah
   getItem/setItem) bina badle chalta hai: getItem hamesha asli JSON
   lautaata hai.

   - Sirf CRM ki apni badi keys (OCZ_KEYS) compress hoti hain. customers /
     products jaan-boojh kar nahi (isi origin ke doosre tools unhe seedha
     padh sakte hain).
   - Purani (uncompressed) value bhi padhi jaati hai; app khulte hi ek baar
     apne aap compressed ban jaati hai.
   - Wahi value dobara likhi jaaye to kuch nahi hota (CPU bachta hai).
   - Phir bhi jagah na bache to doosre apps ke API-response cache
     (occ:get*, oc.c.get*, kms-cache-v1) hata kar dobara koshish -- wo apne
     app me khud dobara load ho jaate hain. CRM ka data kabhi nahi hatta.
   - Console: ocStorageReport()

   --------------------------------------------------------------------------
   v57 (build 2026.11.04.1) -- jagah bharne par bhi save KABHI gum nahi hota
   Bug: jagah bhari ho to setItem fail hota tha, store.set nayi copy `mem` me
   rakhta tha par store.get / DB.* hamesha localStorage ki PURANI copy padhte
   the. User Save dabata, koi error nahi aata, aur screen par purana data
   wapas aa jaata (reload par edit / nayi entry gayab). Snapshot, edit
   journal, pending queue -- sab ke writes bhi chupchaap fail hote the.
   Ilaaj (isi layer me, app ka code bina badle):
   1. Jagah na ho to pehle doosre apps ke cache, phir CRM ki wo badi keys
      jo sheet se dobara ban jaati hain (SPILL: oc_srvSnap, oc_leadSnap,
      activity, oc_gpMasters) disk se hata kar sirf memory me rakhi jaati
      hain -- asli data (orders, leads, pending queue, journal) ko jagah.
   2. Phir bhi na likha jaaye to value MEMORY OVERLAY me -- getItem wahi
      lautaata hai, isliye user ko apna save turant dikhta hai aur sync /
      push usi taaza copy se chalte hain. Error throw nahi hota.
   3. Asli data sirf memory me ho to laal patti + tab band karne par browser
      ka "Leave site?" sawaal; har 20 sec disk par dobara likhne ki koshish,
      ho jaaye to patti hari ho kar hat jaati hai.
   Console: ocStorageReport() (ab overlay bhi dikhata hai)

   LZ-String 1.5.0 (c) Pieroxy, MIT license -- https://github.com/pieroxy/lz-string
   ========================================================================== */
(function(){
'use strict';
if(window.__ocStore) return;
var LS = null;
try{ LS = window.localStorage; }catch(e){ return; }
if(!LS || typeof Storage === 'undefined' || !Storage.prototype) return;

var LZString=function(){var r=String.fromCharCode,o="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",n="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$",e={};function t(r,o){if(!e[r]){e[r]={};for(var n=0;n<r.length;n++)e[r][r.charAt(n)]=n}return e[r][o]}var i={compressToBase64:function(r){if(null==r)return"";var n=i._compress(r,6,function(r){return o.charAt(r)});switch(n.length%4){default:case 0:return n;case 1:return n+"===";case 2:return n+"==";case 3:return n+"="}},decompressFromBase64:function(r){return null==r?"":""==r?null:i._decompress(r.length,32,function(n){return t(o,r.charAt(n))})},compressToUTF16:function(o){return null==o?"":i._compress(o,15,function(o){return r(o+32)})+" "},decompressFromUTF16:function(r){return null==r?"":""==r?null:i._decompress(r.length,16384,function(o){return r.charCodeAt(o)-32})},compressToUint8Array:function(r){for(var o=i.compress(r),n=new Uint8Array(2*o.length),e=0,t=o.length;e<t;e++){var s=o.charCodeAt(e);n[2*e]=s>>>8,n[2*e+1]=s%256}return n},decompressFromUint8Array:function(o){if(null==o)return i.decompress(o);for(var n=new Array(o.length/2),e=0,t=n.length;e<t;e++)n[e]=256*o[2*e]+o[2*e+1];var s=[];return n.forEach(function(o){s.push(r(o))}),i.decompress(s.join(""))},compressToEncodedURIComponent:function(r){return null==r?"":i._compress(r,6,function(r){return n.charAt(r)})},decompressFromEncodedURIComponent:function(r){return null==r?"":""==r?null:(r=r.replace(/ /g,"+"),i._decompress(r.length,32,function(o){return t(n,r.charAt(o))}))},compress:function(o){return i._compress(o,16,function(o){return r(o)})},_compress:function(r,o,n){if(null==r)return"";var e,t,i,s={},u={},a="",p="",c="",l=2,f=3,h=2,d=[],m=0,v=0;for(i=0;i<r.length;i+=1)if(a=r.charAt(i),Object.prototype.hasOwnProperty.call(s,a)||(s[a]=f++,u[a]=!0),p=c+a,Object.prototype.hasOwnProperty.call(s,p))c=p;else{if(Object.prototype.hasOwnProperty.call(u,c)){if(c.charCodeAt(0)<256){for(e=0;e<h;e++)m<<=1,v==o-1?(v=0,d.push(n(m)),m=0):v++;for(t=c.charCodeAt(0),e=0;e<8;e++)m=m<<1|1&t,v==o-1?(v=0,d.push(n(m)),m=0):v++,t>>=1}else{for(t=1,e=0;e<h;e++)m=m<<1|t,v==o-1?(v=0,d.push(n(m)),m=0):v++,t=0;for(t=c.charCodeAt(0),e=0;e<16;e++)m=m<<1|1&t,v==o-1?(v=0,d.push(n(m)),m=0):v++,t>>=1}0==--l&&(l=Math.pow(2,h),h++),delete u[c]}else for(t=s[c],e=0;e<h;e++)m=m<<1|1&t,v==o-1?(v=0,d.push(n(m)),m=0):v++,t>>=1;0==--l&&(l=Math.pow(2,h),h++),s[p]=f++,c=String(a)}if(""!==c){if(Object.prototype.hasOwnProperty.call(u,c)){if(c.charCodeAt(0)<256){for(e=0;e<h;e++)m<<=1,v==o-1?(v=0,d.push(n(m)),m=0):v++;for(t=c.charCodeAt(0),e=0;e<8;e++)m=m<<1|1&t,v==o-1?(v=0,d.push(n(m)),m=0):v++,t>>=1}else{for(t=1,e=0;e<h;e++)m=m<<1|t,v==o-1?(v=0,d.push(n(m)),m=0):v++,t=0;for(t=c.charCodeAt(0),e=0;e<16;e++)m=m<<1|1&t,v==o-1?(v=0,d.push(n(m)),m=0):v++,t>>=1}0==--l&&(l=Math.pow(2,h),h++),delete u[c]}else for(t=s[c],e=0;e<h;e++)m=m<<1|1&t,v==o-1?(v=0,d.push(n(m)),m=0):v++,t>>=1;0==--l&&(l=Math.pow(2,h),h++)}for(t=2,e=0;e<h;e++)m=m<<1|1&t,v==o-1?(v=0,d.push(n(m)),m=0):v++,t>>=1;for(;;){if(m<<=1,v==o-1){d.push(n(m));break}v++}return d.join("")},decompress:function(r){return null==r?"":""==r?null:i._decompress(r.length,32768,function(o){return r.charCodeAt(o)})},_decompress:function(o,n,e){var t,i,s,u,a,p,c,l=[],f=4,h=4,d=3,m="",v=[],g={val:e(0),position:n,index:1};for(t=0;t<3;t+=1)l[t]=t;for(s=0,a=Math.pow(2,2),p=1;p!=a;)u=g.val&g.position,g.position>>=1,0==g.position&&(g.position=n,g.val=e(g.index++)),s|=(u>0?1:0)*p,p<<=1;switch(s){case 0:for(s=0,a=Math.pow(2,8),p=1;p!=a;)u=g.val&g.position,g.position>>=1,0==g.position&&(g.position=n,g.val=e(g.index++)),s|=(u>0?1:0)*p,p<<=1;c=r(s);break;case 1:for(s=0,a=Math.pow(2,16),p=1;p!=a;)u=g.val&g.position,g.position>>=1,0==g.position&&(g.position=n,g.val=e(g.index++)),s|=(u>0?1:0)*p,p<<=1;c=r(s);break;case 2:return""}for(l[3]=c,i=c,v.push(c);;){if(g.index>o)return"";for(s=0,a=Math.pow(2,d),p=1;p!=a;)u=g.val&g.position,g.position>>=1,0==g.position&&(g.position=n,g.val=e(g.index++)),s|=(u>0?1:0)*p,p<<=1;switch(c=s){case 0:for(s=0,a=Math.pow(2,8),p=1;p!=a;)u=g.val&g.position,g.position>>=1,0==g.position&&(g.position=n,g.val=e(g.index++)),s|=(u>0?1:0)*p,p<<=1;l[h++]=r(s),c=h-1,f--;break;case 1:for(s=0,a=Math.pow(2,16),p=1;p!=a;)u=g.val&g.position,g.position>>=1,0==g.position&&(g.position=n,g.val=e(g.index++)),s|=(u>0?1:0)*p,p<<=1;l[h++]=r(s),c=h-1,f--;break;case 2:return v.join("")}if(0==f&&(f=Math.pow(2,d),d++),l[c])m=l[c];else{if(c!==h)return null;m=i+i.charAt(0)}v.push(m),l[h++]=i+m.charAt(0),i=m,0==--f&&(f=Math.pow(2,d),d++)}}};return i}();


var MARK = '\u0001OCZ1:';             /* compressed value ka nishaan (JSON kabhi \u0001 se shuru nahi hota) */
var MIN  = 4096;                      /* isse chhoti value waise hi likho */
var OCZ_KEYS = {
  orders:1, enquiries:1, quotations:1, dispatch:1, activity:1,
  indiamartLeads:1, metaLeads:1,
  oc_srvSnap:1, oc_leadSnap:1, oc_leadSeen:1, oc_seenIds:1,
  oc_editJournal:1, oc_orderStamps:1,
  __ocPend_orders:1, __ocPend_enq:1
};
/* doosre apps ke sirf API-response cache -- jagah na bache tab hi hatte hain */
var EVICT_RE = /^(occ:get|oc\.c\.get)/;
var EVICT_KEYS = { 'kms-cache-v1':1 };
/* v57: CRM ki keys jo sheet se dobara ban jaati hain -- jagah na ho to disk se
   hata kar sirf memory me (is tab ke liye). Agle load par apne aap wapas:
   oc_srvSnap = har pull ke baad rebuild(), oc_leadSnap = boot par local rows se,
   activity = getAll se (nayi rows alag se push + oc_actQueue), oc_gpMasters = cost cache. */
var SPILL = ['oc_leadSnap', 'oc_srvSnap', 'activity', 'oc_gpMasters'];
var SPILL_SET = {}; SPILL.forEach(function(k){ SPILL_SET[k] = 1; });
var overlay = {};                     /* key -> asli (logical) value jo disk par nahi likhi ja saki */
var spilled = {};                     /* jo SPILL key humne disk se hatayi */

var P = Storage.prototype;
var rawGet = P.getItem, rawSet = P.setItem, rawDel = P.removeItem, rawClear = P.clear;
var cache = {};                       /* key -> { raw, val } */
var stats = { comp:0, compMs:0, decomp:0, decompMs:0, skipped:0, evicted:[], fails:0, spilled:[], overlaid:0, recovered:0 };

function want(k){ return OCZ_KEYS.hasOwnProperty(k) || k.indexOf('__ocPend_') === 0; }
function isZ(raw){ return typeof raw === 'string' && raw.charCodeAt(0) === 1 && raw.lastIndexOf(MARK, 0) === 0; }
function isQuota(e){
  return !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED'
                 || e.code === 22 || e.code === 1014);
}
function now(){ try{ return performance.now(); }catch(e){ return Date.now(); } }

function decode(k, raw){
  var c = cache[k];
  if(c && c.raw === raw) return c.val;
  var t = now(), val = null;
  try{ val = LZString.decompressFromUTF16(raw.slice(MARK.length)); }catch(e){ val = null; }
  stats.decomp++; stats.decompMs += now() - t;
  if(val == null || val === ''){
    /* kharab value: null lautao, app default le kar sheet se dobara le aayega */
    console.warn('[oc-store] ' + k + ': compressed value unreadable -- ignoring it (will reload from the Sheet)');
    return null;
  }
  cache[k] = { raw: raw, val: val };
  return val;
}

function evict(keep){
  var gone = [], i, k;
  try{
    for(i = LS.length - 1; i >= 0; i--){
      k = LS.key(i);
      if(!k || k === keep) continue;
      if(EVICT_RE.test(k) || EVICT_KEYS.hasOwnProperty(k)){ rawDel.call(LS, k); gone.push(k); }
    }
  }catch(e){}
  if(gone.length){
    stats.evicted = stats.evicted.concat(gone);
    console.warn('[oc-store] storage full -- removed ' + gone.length + ' re-loadable cache key(s) of other apps:', gone);
  }
  return gone.length > 0;
}

function has(o, k){ return Object.prototype.hasOwnProperty.call(o, k); }
function encode(k, v){
  if(want(k) && v.length >= MIN){
    var t = now(), z = MARK + LZString.compressToUTF16(v);
    stats.comp++; stats.compMs += now() - t;
    return z;
  }
  return v;
}
function tryRaw(k, stored){
  try{ rawSet.call(LS, k, stored); return true; }
  catch(e){ if(!isQuota(e)) throw e; return false; }
}
/* SPILL key ko disk se hata kar memory me le jao (sabse badi pehle) */
function spillOne(keep){
  var best = null, bestSz = 0;
  SPILL.forEach(function(k){
    if(k === keep) return;
    var raw = rawGet.call(LS, k);
    if(raw && raw.length > bestSz){ best = k; bestSz = raw.length; }
  });
  if(!best) return false;
  var raw = rawGet.call(LS, best), val = isZ(raw) ? decode(best, raw) : raw;
  if(val != null && !has(overlay, best)) overlay[best] = val;
  rawDel.call(LS, best); delete cache[best];
  spilled[best] = 1; stats.spilled.push(best);
  console.warn('[oc-store] storage full -- moved "' + best + '" (' + Math.round(bestSz / 1024)
               + 'K, rebuilt from the Sheet) to memory to make room for data');
  return true;
}
/* likho; jagah na ho to seedhi (ladder) se jagah banao. false = phir bhi nahi likha gaya */
function write(k, stored){
  if(tryRaw(k, stored)) return true;
  if(evict(k) && tryRaw(k, stored)) return true;
  if(SPILL_SET[k]) return false;                 /* cache ke liye asli data nahi hatate */
  while(spillOne(k)){ if(tryRaw(k, stored)) return true; }
  return false;
}
function unsafeKeys(){ return Object.keys(overlay).filter(function(k){ return !SPILL_SET[k]; }); }

P.getItem = function(k){
  if(this === LS){ k = String(k); if(has(overlay, k)) return overlay[k]; }
  var raw = rawGet.call(this, k);
  if(this !== LS || !isZ(raw)) return raw;
  return decode(k, raw);
};

P.setItem = function(k, v){
  if(this !== LS) return rawSet.call(this, k, v);
  k = String(k); v = String(v);
  if(!has(overlay, k)){
    var c = cache[k];
    if(c && c.val === v && rawGet.call(LS, k) === c.raw){ stats.skipped++; return; }
  }
  var stored = encode(k, v);
  if(write(k, stored)){
    var was = has(overlay, k);
    delete overlay[k]; delete spilled[k];
    if(stored !== v) cache[k] = { raw: stored, val: v }; else delete cache[k];
    if(was) ui();
    return;
  }
  /* disk par jagah nahi -- memory me rakho, error mat do: app usi taaza copy se chalega */
  overlay[k] = v; delete cache[k];
  stats.fails++; stats.overlaid++;
  if(!SPILL_SET[k]) console.warn('[oc-store] storage full -- "' + k + '" kept in memory only (this tab). Will retry.');
  ui(); arm();
};

P.removeItem = function(k){
  if(this === LS){ k = String(k); delete cache[k]; if(has(overlay, k)){ delete overlay[k]; ui(); } }
  return rawDel.call(this, k);
};
P.clear = function(){
  if(this === LS){ cache = {}; overlay = {}; ui(); }
  return rawClear.call(this);
};

/* ------------------------------------- memory me padi value disk par dobara ---- */
var timer = null;
function arm(){ if(!timer) timer = setInterval(flush, 20000); }
function flush(){
  var ks = unsafeKeys(), ok = 0;
  ks.forEach(function(k){
    try{ if(write(k, encode(k, overlay[k]))){ delete overlay[k]; ok++; stats.recovered++; } }catch(e){}
  });
  if(ok) console.log('[oc-store] ' + ok + ' key(s) written to browser storage again');
  if(!unsafeKeys().length && timer){ clearInterval(timer); timer = null; }
  ui();
  return unsafeKeys().length;
}

/* ------------------------------------------------ laal / hari patti ---- */
var bar = null, shownBad = false, hideT = null;
function ui(){
  try{
    var n = unsafeKeys().length;
    if(!document.body){ if(n) document.addEventListener('DOMContentLoaded', ui, { once:true }); return; }
    if(!bar){
      if(!n) return;
      bar = document.createElement('div');
      bar.id = 'oc-store-bar';
      bar.setAttribute('role', 'alert');
      bar.style.cssText = 'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:2147483000;'
        + 'max-width:min(680px,calc(100vw - 32px));padding:10px 14px;border-radius:10px;font:13px/1.4 system-ui,sans-serif;'
        + 'color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.35);cursor:pointer';
      bar.title = 'Click to try saving again';
      bar.addEventListener('click', function(){ flush(); });
      document.body.appendChild(bar);
    }
    clearTimeout(hideT);
    if(n){
      shownBad = true;
      bar.style.display = ''; bar.style.background = '#b42318';
      bar.textContent = '⚠ Browser storage is full. Your changes are saved and are being sent to the Sheet, but '
        + n + ' item(s) are held only in this tab\'s memory. Please do not close or reload this tab until this bar turns green.';
    } else if(shownBad){
      shownBad = false;
      bar.style.display = ''; bar.style.background = '#067647';
      bar.textContent = '✓ Storage is OK. All changes have been saved in the browser.';
      hideT = setTimeout(function(){ if(bar && !unsafeKeys().length) bar.style.display = 'none'; }, 5000);
    } else {
      bar.style.display = 'none';
    }
  }catch(e){}
}
/* tab band / reload par: pehle ek aakhri koshish, phir bhi data sirf memory me ho to browser poochhe */
try{
  window.addEventListener('beforeunload', function(ev){
    if(!unsafeKeys().length) return;
    try{ flush(); }catch(e){}
    if(!unsafeKeys().length) return;
    ev.preventDefault(); ev.returnValue = ''; return '';
  });
}catch(e){}

/* doosre tab ne likha -> hamara cache purana */
try{ window.addEventListener('storage', function(ev){
  if(ev && ev.key){ delete cache[ev.key]; if(SPILL_SET[ev.key] && ev.newValue != null) delete overlay[ev.key]; }
  else cache = {};
}); }catch(e){}

/* ------------------------------------------------ ek baar ka migration ---- */
function migrate(){
  var list = [], i, k, raw;
  try{
    for(i = 0; i < LS.length; i++){
      k = LS.key(i);
      if(!k || !want(k)) continue;
      raw = rawGet.call(LS, k);
      if(raw && !isZ(raw) && raw.length >= MIN) list.push([k, raw.length]);
    }
  }catch(e){ return 0; }
  list.sort(function(a, b){ return b[1] - a[1]; });   /* sabse badi pehle -> sabse zyada jagah turant khaali */
  var n = 0;
  list.forEach(function(it){
    try{ LS.setItem(it[0], rawGet.call(LS, it[0])); n++; }
    catch(e){ console.warn('[oc-store] could not compress ' + it[0], e); }
  });
  if(n) console.log('[oc-store] compressed ' + n + ' storage key(s) -- browser storage freed');
  return n;
}

function usage(){
  var tot = 0, mine = 0, rows = [], i, k, raw, logical;
  for(i = 0; i < LS.length; i++){
    k = LS.key(i); raw = rawGet.call(LS, k) || '';
    var sz = k.length + raw.length; tot += sz;
    logical = isZ(raw) ? ((cache[k] && cache[k].raw === raw) ? cache[k].val.length : null) : raw.length;
    if(want(k) || k === 'customers' || k === 'products') mine += sz;
    rows.push({ key: k, storedKB: Math.round(sz / 512) / 2, compressed: isZ(raw),
                dataKB: logical == null ? '' : Math.round(logical / 512) / 2 });
  }
  rows.sort(function(a, b){ return b.storedKB - a.storedKB; });
  Object.keys(overlay).forEach(function(k){
    rows.push({ key: k + ' (memory only)', storedKB: 0, compressed: false, dataKB: Math.round(overlay[k].length / 512) / 2 });
  });
  return { totalChars: tot, crmChars: mine, rows: rows, memoryOnly: Object.keys(overlay), unsaved: unsafeKeys() };
}

window.__ocStore = { version: 'v57', stats: stats, migrate: migrate, usage: usage, flush: flush,
                     overlayKeys: function(){ return Object.keys(overlay); }, unsaved: unsafeKeys,
                     isCompressed: function(k){ return isZ(rawGet.call(LS, k)); } };

/* Console: ocStorageReport()  -- kitni jagah bhari hai, kaun si key kitni badi */
window.ocStorageReport = function(){
  var u = usage(), LIMIT = 5 * 1024 * 1024;   /* Chrome: ~5M chars per origin */
  try{ console.table(u.rows.slice(0, 30)); }catch(e){}
  var s = 'used ' + Math.round(u.totalChars / 1024) + 'K of ~' + Math.round(LIMIT / 1024) + 'K chars ('
        + Math.round(u.totalChars * 100 / LIMIT) + '%) -- CRM ' + Math.round(u.crmChars / 1024) + 'K'
        + (u.memoryOnly.length ? ' -- memory only: ' + u.memoryOnly.join(', ')
           + (u.unsaved.length ? ' (NOT on disk: ' + u.unsaved.join(', ') + ')' : '') : '');
  console.log('[oc-store] ' + s, stats);
  return s;
};

try{ migrate(); }catch(e){ console.warn('[oc-store] migrate', e); }
})();
