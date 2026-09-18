/* ===========================================================================
   gp-quotation.js  —  Quotation / PI builder ka GP glue
   Do kaam karta hai:
     1. Client ka naam CRM ke customer master se auto-fill (contact, address,
        GSTIN, phone, place of supply).
     2. GP panel: har product line ka cost GP calculator ke sheet se auto-fetch
        karke live GP% aur "fayda ya ghata" dikhata hai.
   Ye file quotation-builder.html ke globals (S, R, syncInputs, renderItemsEditor)
   par chalti hai, isliye usi page me hi load karna — kahin aur nahi.
   =========================================================================== */
(function () {
  'use strict';

  function el(id) { return document.getElementById(id); }
  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ''); }
  function num(v) { var x = parseFloat(v); return isFinite(x) ? x : 0; }

  /* ================= 1. CUSTOMER AUTO-FILL ================= */
  /* CRM ka customer master usi origin ke localStorage me hai (index.html se
     aata hai), isliye yahan bina network ke mil jaata hai. */
  function crmCustomers() {
    try { var a = JSON.parse(localStorage.getItem('customers') || '[]'); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  var GST_STATE = {
    '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
    '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
    '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
    '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
    '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
    '24': 'Gujarat', '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra',
    '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu',
    '34': 'Puducherry', '35': 'Andaman & Nicobar', '36': 'Telangana', '37': 'Andhra Pradesh',
    '38': 'Ladakh'
  };
  var CITY_STATE = {
    delhi: 'Delhi', newdelhi: 'Delhi', noida: 'Uttar Pradesh', greaternoida: 'Uttar Pradesh',
    ghaziabad: 'Uttar Pradesh', lucknow: 'Uttar Pradesh', kanpur: 'Uttar Pradesh',
    gurgaon: 'Haryana', gurugram: 'Haryana', faridabad: 'Haryana', sonipat: 'Haryana',
    mumbai: 'Maharashtra', pune: 'Maharashtra', nagpur: 'Maharashtra',
    bangalore: 'Karnataka', bengaluru: 'Karnataka', hyderabad: 'Telangana',
    chennai: 'Tamil Nadu', kolkata: 'West Bengal', ahmedabad: 'Gujarat', surat: 'Gujarat',
    jaipur: 'Rajasthan', chandigarh: 'Chandigarh', indore: 'Madhya Pradesh', bhopal: 'Madhya Pradesh',
    patna: 'Bihar', dehradun: 'Uttarakhand', shimla: 'Himachal Pradesh', ludhiana: 'Punjab'
  };
  function stateOf(c) {
    var g = String(c.gstin || '').trim();
    if (/^\d{2}/.test(g) && GST_STATE[g.slice(0, 2)]) return GST_STATE[g.slice(0, 2)];
    var k = norm(c.city);
    return CITY_STATE[k] || '';
  }

  /* jo values humne bhari thin unhe yaad rakho — customer badalne par sirf
     wahi overwrite hoti hain, user ka type kiya hua kuch nahi chhinta */
  var auto = {};
  function setF(key, val) {
    if (val == null || val === '') return;
    var cur = S[key];
    if (cur === '' || cur == null || cur === auto[key]) { S[key] = val; auto[key] = val; }
  }
  var lastFilled = '';
  function tryFill(name) {
    var k = norm(name); if (!k || k === lastFilled) return;
    var list = crmCustomers(), c = null, i;
    for (i = 0; i < list.length; i++) { if (norm(list[i] && list[i].name) === k) { c = list[i]; break; } }
    if (!c) return;
    lastFilled = k;
    var cust = c.custom || {};
    setF('attn', c.contact || '');
    setF('addr', c.c_msg1tc8d || cust.c_msg1tc8d || '');
    setF('shipTo', c.c_msg1ttd9 || cust.c_msg1ttd9 || '');
    setF('cgstin', String(c.gstin || '').toUpperCase());
    setF('cph', c.phone || '');
    var st = stateOf(c);
    if (st && (S.state === 'Delhi' || S.state === auto.state)) { S.state = st; auto.state = st; }
    if (typeof syncInputs === 'function') syncInputs();
    if (typeof R === 'function') R();
    var h = el('gpCustHint');
    if (h) h.textContent = 'CRM se auto-fill: ' + c.name + (st ? ' · ' + st : '');
  }
  function mountCustomer() {
    var inp = el('inCo'); if (!inp) return;
    var dl = el('ocCustList');
    if (!dl) { dl = document.createElement('datalist'); dl.id = 'ocCustList'; document.body.appendChild(dl); }
    dl.innerHTML = crmCustomers().map(function (c) {
      return '<option value="' + String(c.name || '').replace(/"/g, '&quot;') + '"></option>';
    }).join('');
    inp.setAttribute('list', 'ocCustList');
    inp.setAttribute('autocomplete', 'off');
    inp.addEventListener('input', function () { tryFill(inp.value); });
    inp.addEventListener('change', function () { tryFill(inp.value); });
    if (!el('gpCustHint')) {
      var h = document.createElement('div');
      h.id = 'gpCustHint'; h.className = 'hint';
      h.textContent = 'CRM ke customers me se naam chuno — address, GSTIN, phone aur state apne aap bhar jayenge.';
      inp.parentNode.appendChild(h);
    }
  }

  /* ================= 2. GP PANEL ================= */
  function gpInput() {
    var items = (typeof S !== 'undefined' && S.items) ? S.items : [];
    return {
      customer: (S.co || S.attn || ''),
      date: S.date,
      freightBilled: (S.freightMode === 'amount') ? num(S.freight) : 0,
      lines: items.map(function (it) {
        return {
          name: it.name || '', qty: num(it.qty), price: num(it.price), disc: num(it.disc),
          gstPct: num(S.gst), model: it.gpModel || '', manual: !!it.gpManual, cost: it.gpCost || {}
        };
      })
    };
  }

  /* toolbar chip — GP panel tak scroll kiye bina hi fayda/ghata dikhe */
  function chip(out) {
    var c = el('tbGp'); if (!c) return;
    if (!out || !out.res) { c.style.display = 'none'; return; }
    var t = out.res.totals, gp = t.grossProfit;
    var full = (window.OCGP.visibility() === 'full');
    var word = gp > 0 ? 'FAYDA' : (gp < 0 ? 'GHATA' : 'BARABAR');
    if (out.uncosted && !out.costed) { word = 'COST ?'; }
    c.textContent = full
      ? (word + ' \u00b7 ' + window.OCGP.fmt.pct(t.grossProfitPct) + (out.uncosted ? ' (adhoora)' : ''))
      : word;
    c.style.background = gp > 0 ? '#12704A' : (gp < 0 ? '#A32020' : '#5A5A5A');
    c.style.color = '#fff';
    c.style.borderColor = 'transparent';
    c.style.display = '';
    c.onclick = function () { var g = el('gpSec'); if (g) g.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  }

  var _busy = false;
  function render() {
    if (_busy) return; /* onChange -> render ke andar dobara render se bacho */
    var box = el('gpBody');
    if (!box || !window.OCGP) return;
    _busy = true;
    try {
      window.__ocGPLast = window.OCGP.renderPanel(box, gpInput(), {
        editable: true,
        onChange: function (i, patch) {
          var it = S.items[i]; if (!it) return;
          if (patch.manual !== undefined) it.gpManual = !!patch.manual;
          if (patch.model !== undefined) it.gpModel = patch.model;
          if (patch.costPatch) {
            it.gpCost = it.gpCost || {};
            Object.keys(patch.costPatch).forEach(function (k) { it.gpCost[k] = patch.costPatch[k]; });
          }
          _busy = false; render();
        }
      });
      chip(window.__ocGPLast);
    } finally { _busy = false; }
  }
  window.ocGPRender = render;

  /* record ke saath save hone wala GP snapshot */
  window.ocGPSnapshot = function () {
    try {
      if (!window.OCGP || !window.OCGP.masters()) return null;
      var input = gpInput();
      var any = (input.lines || []).some(function (l) { return l.qty > 0 && l.name; });
      if (!any) return null;
      return window.OCGP.snapshot(window.OCGP.compute(input));
    } catch (e) { return null; }
  };

  /* ================= hooks ================= */
  function hook() {
    /* har render ke baad GP dobara bane */
    if (typeof R === 'function' && !R.__gp) {
      var _R = R;
      window.R = function () { var v = _R.apply(this, arguments); try { render(); } catch (e) {} return v; };
      window.R.__gp = 1;
    }
    /* product add / remove ke baad bhi */
    if (typeof renderItemsEditor === 'function' && !renderItemsEditor.__gp) {
      var _rie = renderItemsEditor;
      window.renderItemsEditor = function () { var v = _rie.apply(this, arguments); try { render(); } catch (e) {} return v; };
      window.renderItemsEditor.__gp = 1;
    }
  }

  function boot() {
    hook();
    mountCustomer();
    if (window.OCGP && window.OCGP.cfg().url) { window.OCGP.ensure().catch(function () {}); }
    render();
    /* CRM se cloud sync hone par customer list badal sakti hai */
    setTimeout(mountCustomer, 4000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
