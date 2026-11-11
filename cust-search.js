/* ===========================================================================
   cust-search.js  —  searchable customer picker (v82)
   Every customer dropdown in the CRM (select[data-custsel], e.g. New Order and
   New Enquiry) opens a panel with a SEARCH BOX on top and the customer list
   below it, instead of the long native list.
     · Search matches company name, contact person, city and phone.
     · Customers who already have orders are listed first (latest order first).
     · The real <select> stays in the form: its value and its onchange run as
       before, so saving, the customer preview and "+ New" are untouched.
   Kuch badlo to index.html me ?v= number aur OC_WEB_BUILD badhao.
   =========================================================================== */
(function(){
'use strict';
var panel = null, cur = null, rows = [], shown = [], active = 0;
function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function lc(s){ return String(s == null ? '' : s).toLowerCase(); }
function digits(s){ return String(s == null ? '' : s).replace(/\D/g,''); }

function build(sel){
  var byId = {}, orders = {}, last = {};
  try{ (DB.customers() || []).forEach(function(c){ if(c && c.id) byId[c.id] = c; }); }catch(e){}
  try{ (DB.orders() || []).forEach(function(o){ if(!o || !o.custId || o.status === 'Cancelled') return; orders[o.custId] = (orders[o.custId] || 0) + 1; var d = String(o.date || o.createdAt || ''); if(d > (last[o.custId] || '')) last[o.custId] = d; }); }catch(e){}
  var out = [];
  Array.prototype.forEach.call(sel.options, function(o, ix){
    if(!o.value) return;
    var cid = o.getAttribute('data-cid') || '', c = byId[cid] || {};
    out.push({ ix: ix, value: o.value, name: o.text, city: c.city || '', contact: c.contact || '', phone: digits(c.phone), n: orders[cid] || 0, last: last[cid] || '',
      hay: lc(o.text + ' ' + (c.contact || '') + ' ' + (c.city || '')) });
  });
  out.sort(function(a, b){ return (b.n ? 1 : 0) - (a.n ? 1 : 0) || (b.last > a.last ? 1 : b.last < a.last ? -1 : 0) || (lc(a.name) < lc(b.name) ? -1 : 1); });
  return out;
}
function filter(q){
  q = lc(q).trim(); var qd = digits(q), words = q.split(/\s+/).filter(Boolean);
  if(!q) return rows.slice();
  return rows.filter(function(r){
    if(qd.length >= 4 && r.phone.indexOf(qd) >= 0) return true;
    for(var i = 0; i < words.length; i++){ if(r.hay.indexOf(words[i]) < 0) return false; }
    return true;
  });
}
function paintList(){
  var box = panel.querySelector('.ocs-list'), cnt = panel.querySelector('.ocs-count');
  var max = 150, list = shown.slice(0, max), withOrders = 0, h = '', split = false;
  rows.forEach(function(r){ if(r.n) withOrders++; });
  if(!list.length) h = '<div style="padding:18px;text-align:center;color:var(--muted);font-size:13px">No customer found. Use "+ New" to add one.</div>';
  list.forEach(function(r, i){
    if(i === 0 && r.n && !panel.querySelector('.ocs-q').value) h += '<div class="ocs-h">Customers with orders (' + withOrders + ')</div>';
    if(!split && !r.n && i > 0 && list[i - 1].n && !panel.querySelector('.ocs-q').value){ h += '<div class="ocs-h">Other registered customers</div>'; split = true; }
    h += '<div class="ocs-it' + (i === active ? ' on' : '') + (cur && cur.value === r.value ? ' sel' : '') + '" data-i="' + i + '"><div style="min-width:0"><div class="ocs-n">' + esc(r.name) + '</div>'
      + ((r.contact || r.city) ? '<div class="ocs-s">' + esc([r.contact, r.city].filter(Boolean).join(' · ')) + '</div>' : '') + '</div>'
      + (r.n ? '<span class="ocs-b">' + r.n + (r.n === 1 ? ' order' : ' orders') + '</span>' : '') + '</div>';
  });
  if(shown.length > max) h += '<div style="padding:8px 12px;color:var(--muted);font-size:12px">+' + (shown.length - max) + ' more — type to narrow down</div>';
  box.innerHTML = h;
  cnt.textContent = shown.length + ' of ' + rows.length;
  var on = box.querySelector('.ocs-it.on'); if(on && on.scrollIntoView){ try{ on.scrollIntoView({ block:'nearest' }); }catch(e){} }
}
function place(){
  if(!panel || !cur) return;
  var r = cur.getBoundingClientRect(), vh = window.innerHeight, w = Math.max(280, r.width), below = vh - r.bottom, h = Math.min(420, Math.max(220, Math.max(below, r.top) - 16));
  panel.style.width = w + 'px'; panel.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px'; panel.style.maxHeight = h + 'px';
  if(below >= 260 || below >= r.top) { panel.style.top = (r.bottom + 4) + 'px'; panel.style.bottom = 'auto'; }
  else { panel.style.top = 'auto'; panel.style.bottom = (vh - r.top + 4) + 'px'; }
}
function close(focusBack){
  if(!panel) return;
  try{ panel.remove(); }catch(e){}
  panel = null; var s = cur; cur = null;
  if(focusBack && s){ try{ s.focus(); }catch(e){} }
}
function pick(r){
  if(!cur || !r) return;
  var s = cur; s.selectedIndex = r.ix;
  if(s.value !== r.value) s.value = r.value;
  close(true);
  try{ s.dispatchEvent(new Event('change', { bubbles:true })); }catch(e){ try{ if(typeof s.onchange === 'function') s.onchange(); }catch(e2){} }
}
function open(sel){
  if(panel) close(false);
  if(sel.disabled) return;
  cur = sel; rows = build(sel); shown = rows.slice(); active = 0;
  for(var i = 0; i < shown.length; i++){ if(shown[i].value === sel.value){ active = i; break; } }
  panel = document.createElement('div'); panel.className = 'ocs-panel';
  panel.innerHTML = '<div class="ocs-top"><input class="ocs-q" type="text" placeholder="Search customer — name, contact, city or phone" autocomplete="off" spellcheck="false"><span class="ocs-count"></span></div><div class="ocs-list"></div>'
    + (sel.value ? '<div class="ocs-foot"><button type="button" class="ocs-clear">Clear selection</button></div>' : '');
  document.body.appendChild(panel);
  place(); paintList();
  var q = panel.querySelector('.ocs-q');
  setTimeout(function(){ try{ q.focus(); }catch(e){} }, 0);
  q.addEventListener('input', function(){ shown = filter(q.value); active = 0; paintList(); });
  q.addEventListener('keydown', function(ev){
    if(ev.key === 'ArrowDown'){ ev.preventDefault(); active = Math.min(shown.length - 1, active + 1); paintList(); }
    else if(ev.key === 'ArrowUp'){ ev.preventDefault(); active = Math.max(0, active - 1); paintList(); }
    else if(ev.key === 'Enter'){ ev.preventDefault(); if(shown[active]) pick(shown[active]); }
    else if(ev.key === 'Escape'){ ev.preventDefault(); ev.stopPropagation(); close(true); }
    else if(ev.key === 'Tab'){ close(false); }
  });
  panel.addEventListener('mousedown', function(ev){
    var it = ev.target.closest && ev.target.closest('.ocs-it');
    if(it){ ev.preventDefault(); pick(shown[+it.getAttribute('data-i')]); return; }
    if(ev.target.closest && ev.target.closest('.ocs-clear')){ ev.preventDefault(); var s = cur; s.value = ''; close(true); try{ s.dispatchEvent(new Event('change', { bubbles:true })); }catch(e){} }
  });
}
function isCustSel(el){ return el && el.tagName === 'SELECT' && el.getAttribute('data-custsel') === '1'; }

/* open our panel instead of the native list */
document.addEventListener('mousedown', function(ev){
  var t = ev.target;
  if(isCustSel(t)){ ev.preventDefault(); if(panel && cur === t) close(true); else open(t); return; }
  if(panel && !(t.closest && t.closest('.ocs-panel'))) close(false);
}, true);
document.addEventListener('keydown', function(ev){
  var t = ev.target;
  if(isCustSel(t) && !panel && (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'ArrowDown' || ev.key === 'ArrowUp' || (ev.key.length === 1 && /[a-z0-9]/i.test(ev.key) && !ev.ctrlKey && !ev.metaKey && !ev.altKey))){
    ev.preventDefault(); open(t);
    if(ev.key.length === 1 && ev.key !== ' '){ var q = panel.querySelector('.ocs-q'); q.value = ev.key; shown = filter(q.value); active = 0; paintList(); }
  }
}, true);
window.addEventListener('resize', function(){ if(panel) place(); });
document.addEventListener('scroll', function(ev){ if(panel && !(ev.target.closest && ev.target.closest('.ocs-panel'))){ if(cur && document.body.contains(cur)) place(); else close(false); } }, true);

var css = document.createElement('style');
css.textContent = '.ocs-panel{position:fixed;z-index:100000;display:flex;flex-direction:column;background:var(--surface,#fff);color:var(--text,#111);border:1px solid var(--border,rgba(0,0,0,.15));border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.28);overflow:hidden;font-family:inherit}'
  + '.ocs-top{display:flex;align-items:center;gap:8px;padding:10px;border-bottom:1px solid var(--border,rgba(0,0,0,.12));flex:none}'
  + '.ocs-q{flex:1;min-width:0;padding:9px 11px;border-radius:9px;border:1px solid var(--brand,#2a78d6);background:var(--surface-2,#fff);color:inherit;font-size:14px;outline:none}'
  + '.ocs-count{font-size:11.5px;color:var(--muted,#888);white-space:nowrap}'
  + '.ocs-list{overflow-y:auto;flex:1;min-height:0}'
  + '.ocs-h{padding:7px 12px 4px;font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:var(--muted,#888);position:sticky;top:0;background:var(--surface,#fff)}'
  + '.ocs-it{display:flex;align-items:center;gap:10px;justify-content:space-between;padding:8px 12px;cursor:pointer;font-size:13.5px}'
  + '.ocs-it.on,.ocs-it:hover{background:color-mix(in srgb,var(--brand,#2a78d6) 12%,transparent)}'
  + '.ocs-it.sel .ocs-n{font-weight:700}'
  + '.ocs-n{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
  + '.ocs-s{font-size:11.5px;color:var(--muted,#888);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
  + '.ocs-b{flex:none;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;color:var(--brand,#2a78d6);background:color-mix(in srgb,var(--brand,#2a78d6) 12%,transparent)}'
  + '.ocs-foot{padding:8px 10px;border-top:1px solid var(--border,rgba(0,0,0,.12));flex:none}'
  + '.ocs-clear{background:none;border:0;color:var(--muted,#888);font-size:12.5px;cursor:pointer;padding:2px 4px}';
document.head.appendChild(css);
window.ocCustSearch = { open: open, close: close };
})();
