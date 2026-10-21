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
    if (h) h.textContent = 'Auto-filled from CRM: ' + c.name + (st ? ' · ' + st : '');
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
      h.textContent = 'Choose a name from the CRM customers — address, GSTIN, phone and state will be filled in automatically.';
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
          gstPct: num(S.gst), model: it.gpModel || '', manual: !!it.gpManual,
          cost: it.gpCost || {}, parts: it.gpParts || null
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
    var word = gp > 0 ? 'PROFIT' : (gp < 0 ? 'LOSS' : 'BREAK-EVEN');
    if (out.uncosted && !out.costed) { word = 'COST ?'; }
    c.textContent = full
      ? (word + ' \u00b7 ' + window.OCGP.fmt.pct(t.grossProfitPct) + (out.uncosted ? ' (incomplete)' : ''))
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
    try { refreshCards(); } catch (e) {}
    try { syncBlockUI(lossInfo()); } catch (e) {}
    var box = el('gpBody');
    if (!box || !window.OCGP) return;
    _busy = true;
    try {
      window.__ocGPLast = window.OCGP.renderPanel(box, gpInput(), {
        /* model aur parts ab product card par chunte hain, isliye panel sirf dikhata hai */
        editable: false,
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


  /* ================= 3. PRODUCT CARD KA GP HISSA =================
     Model ka dropdown (GP sheet se), "Not in list" ka box, Order type, aur
     part ke dropdown (armrest / seat mechanism / base / wheels / chair fix) jinke
     neeche unka rate likha aata hai. Ye sab quotation-builder.html ke
     renderItemsEditor() se call hota hai. */

  var ORDER_TYPES = ['EXISTING PRODUCT', 'TO BE ORDERED', 'CUSTOMIZED PRODUCT'];
  var PART_LABEL = { arm: 'Armrest', seat: 'Seat mechanism', base: 'Base', wheels: 'Wheels', fix: 'Product Fix Cost' };
  var PART_KEYS = ['arm', 'seat', 'base', 'wheels', 'fix'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function inr(n) { return '₹ ' + Math.round(num(n)).toLocaleString('en-IN'); }

  var CARD_CSS = ''
    + '.gp-chk{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--muted);cursor:pointer;white-space:nowrap}'
    + '.gp-chk input{width:auto;margin:0}'
    + '.gp-modelrow{display:flex;gap:8px;align-items:center}'
    + '.gp-modelrow > *:first-child{flex:1;min-width:0}'
    + '.gp-parts{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:2px 0 8px}'
    + '.gp-part label{display:block;font-size:11px;color:var(--muted);margin-bottom:3px;letter-spacing:.04em}'
    + '.gp-part select{width:100%}'
    + '.gp-rate{display:block;font-size:11px;margin-top:2px;color:var(--ink-soft,#6b6b6b);font-variant-numeric:tabular-nums}'
    + '.gp-rate.zero{color:var(--err,#A32020)}'
    + '.gp-linesum{font-size:11.5px;padding:6px 8px;border-radius:7px;background:rgba(128,128,128,.10);margin-bottom:8px;font-variant-numeric:tabular-nums}'
    + '.gp-linesum.loss{background:rgba(163,32,32,.14);color:#A32020;font-weight:600}'
    + '.gp-totbox{border:1px solid var(--line-dark,#C9B68E);border-radius:3px;padding:1px 8px;font-weight:700;'
    + 'font-size:13px;line-height:18px;font-variant-numeric:tabular-nums;background:rgba(201,182,142,.14);box-sizing:border-box}'
    + '.gp-rate.ok{color:var(--ok,#2E7D32);font-weight:600}.gp-rate.bad{color:var(--err,#A32020);font-weight:600}'
    + '.gp-livetag{font-size:10.5px;margin:-2px 0 6px;color:var(--ok,#2E7D32);font-variant-numeric:tabular-nums}'
    + '.gp-livetag.err{color:var(--err,#A32020)}'
    + '#dlBtn.gp-blocked{background:#8f8f8f !important;border-color:#8f8f8f !important;color:#fff !important;cursor:not-allowed}'
    + '@media print{body.gp-blocked > *{display:none !important}'
    + 'body.gp-blocked::before{display:block;content:"PDF blocked: this quotation has a negative GP. Fix the rate, discount or parts first.";'
    + 'font:18px/1.5 sans-serif;padding:40px;color:#A32020}}'
    + '.gp-sectitle{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:4px 0 4px}';
  function injectCardCSS() {
    if (document.getElementById('gp-card-css')) return;
    var st = document.createElement('style'); st.id = 'gp-card-css'; st.textContent = CARD_CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  function ready() { return !!(window.OCGP && window.OCGP.masters()); }

  /* ---- model + "Not in list" ---- */
  window.ocGPModelHTML = function (i) {
    injectCardCSS();
    var it = S.items[i] || {};
    var manual = !!it.gpManual;
    var models = ready() ? window.OCGP.modelList() : [];
    /* cost master hi nahi mila to purana behaviour: sirf free text */
    if (!models.length) manual = true;
    var box = '<label class="gp-chk" title="Tick this if the item is not in the GP list">'
      + '<input type="checkbox" ' + (manual ? 'checked' : '') + ' ' + (models.length ? '' : 'disabled')
      + ' onchange="ocGPNotInList(' + i + ', this.checked)"> Not in list</label>';
    var ctrl;
    if (manual) {
      ctrl = '<input id="qb-name-' + i + '" placeholder="Model name — e.g. Hurricane HB Mesh" value="' + esc(it.name) + '"'
        + ' oninput="this.classList.remove(\'err\'); updItem(' + i + ',\'name\',this.value)">';
    } else {
      var sel = String(it.gpModel || '');
      ctrl = '<select id="qb-name-' + i + '" onchange="ocGPPickModel(' + i + ', this.value)">'
        + '<option value=""' + (sel ? '' : ' selected') + '>— choose model —</option>'
        + models.map(function (p) {
            var v = String(p.sku || p.name);
            return '<option value="' + esc(v) + '"' + (v === sel ? ' selected' : '') + '>' + esc(p.name) + '</option>';
          }).join('')
        + '</select>';
    }
    return '<div class="f"><label>Model name <b>*</b></label><div class="gp-modelrow">' + ctrl + box + '</div></div>'
      + '<div class="f"><label>Order type</label><select onchange="ocGPPickType(' + i + ', this.value)">'
      + ORDER_TYPES.map(function (t) {
          return '<option' + ((it.otype || ORDER_TYPES[0]) === t ? ' selected' : '') + '>' + t + '</option>';
        }).join('')
      + '</select></div>';
  };

  /* ---- part ke dropdown + rate (Product Fix Cost bhi, v3) ---- */
  window.ocGPPartsHTML = function (i) {
    injectCardCSS();
    var it = S.items[i] || {};
    if (!ready()) {
      return '<div class="gp-linesum">The GP cost master is not connected — parts and GP will appear once the GP Calculator URL + token are set in the Admin Panel.</div>';
    }
    var chosen = it.gpParts || {};
    var model = it.gpModel ? window.OCGP.bySku(it.gpModel) : null;
    var std = model ? window.OCGP.costOf(model) : null;
    var lv = liveText();
    var h = '<div class="gp-sectitle">Parts &amp; cost (for GP — not printed on the quotation)</div>'
      + '<div class="gp-livetag' + lv.cls + '">' + lv.txt + '</div><div class="gp-parts">';
    PART_KEYS.forEach(function (k) {
      var list = window.OCGP.partsFor(k);
      var cur = chosen[k] || (std ? std.names[k] : '') || '';
      var rate = cur ? window.OCGP.compRate(window.OCGP.PART_TYPE[k], cur) : 0;
      h += '<div class="gp-part"><label>' + PART_LABEL[k] + '</label>'
        + '<select onchange="ocGPPickPart(' + i + ', \'' + k + '\', this.value)">'
        + '<option value="">' + (list.length ? '— not selected —' : '— none in GP sheet —') + '</option>'
        + list.map(function (c) {
            return '<option value="' + esc(c.name) + '"' + (c.name === cur ? ' selected' : '') + '>'
              + esc(c.name) + ' — ' + inr(c.rate) + '</option>';
          }).join('')
        + '</select>'
        + '<span class="gp-rate' + (cur && !rate ? ' zero' : '') + '">'
        + (cur ? inr(rate) + (rate ? '' : ' — rate is 0 in the sheet') : 'no part selected')
        + '</span></div>';
    });
    /* v77: Total GP Cost -- Product Fix Cost ke right me */
    var tt = cardTotals(i);
    h += '<div class="gp-part"><label>Total GP Cost</label>'
      + '<div class="gp-totbox" id="gp-tot-' + i + '">' + tt.box + '</div>'
      + '<span class="gp-rate' + tt.cls + '" id="gp-totpct-' + i + '">' + tt.pct + '</span></div>';
    h += '</div>';
    h += '<div id="gp-ls-' + i + '">' + lineSummaryHTML(i) + '</div>';
    return h;
  };

  /* Total GP Cost = card par dikh rahe saare part amounts ka jod (per piece);
     GP % = (List price ex-GST - Total GP Cost) / List price x 100.
     Price kam ho (ghata) to minus % laal me, warna hara. */
  function cardTotals(i) {
    var it = S.items[i] || {};
    var chosen = it.gpParts || {};
    var model = it.gpModel ? window.OCGP.bySku(it.gpModel) : null;
    var std = model ? window.OCGP.costOf(model) : null;
    var total = 0;
    PART_KEYS.forEach(function (k) {
      var cur = chosen[k] || (std ? std.names[k] : '') || '';
      if (cur) total += num(window.OCGP.compRate(window.OCGP.PART_TYPE[k], cur));
    });
    var price = num(it.price);
    var r = { total: total, box: inr(total), pct: '', cls: '' };
    if (!total) { r.pct = 'select parts to see GP %'; return r; }
    if (!price) { r.pct = 'enter List price for GP %'; return r; }
    var gpp = (price - total) / price * 100;
    var txt = 'GP ' + window.OCGP.fmt.pct(gpp) + ' on list price';
    if (total > price) { r.pct = txt + ' — LOSS'; r.cls = ' bad'; }
    else { r.pct = txt; r.cls = ' ok'; }
    return r;
  }
  /* price / qty type karte hi card ke andar total + GP % + summary taaza --
     poora card dobara nahi banta, isliye input ka focus nahi hilta */
  function refreshCards() {
    if (!ready() || typeof S === 'undefined' || !S.items) return;
    S.items.forEach(function (it, i) {
      var b = document.getElementById('gp-tot-' + i);
      if (!b) return;
      var tt = cardTotals(i);
      b.innerHTML = tt.box;
      var p = document.getElementById('gp-totpct-' + i);
      if (p) { p.className = 'gp-rate' + tt.cls; p.innerHTML = tt.pct; }
      var ls = document.getElementById('gp-ls-' + i);
      if (ls) ls.innerHTML = lineSummaryHTML(i);
    });
  }

  /* ek line ka chhota GP summary -- card ke andar hi */
  function lineSummaryHTML(i) {
    if (!ready()) return '';
    var input = gpInput();
    var l = (input.lines || [])[i];
    if (!l || !(l.qty > 0)) return '';
    var out = window.OCGP.compute({ customer: 'x', date: input.date, lines: [l] });
    var lr = out.res.lines[0] || {};
    var costed = out.meta[0] && out.meta[0].costed;
    if (!costed) {
      return '<div class="gp-linesum">No cost found for this line — choose a model or select the parts to get an accurate GP.</div>';
    }
    var loss = num(lr.gp) < 0;
    return '<div class="gp-linesum' + (loss ? ' loss' : '') + '">'
      + 'Cost/pc ' + inr(lr.unitCogs) + ' · Net rate/pc ' + inr(lr.unitNetPrice)
      + ' · GP ' + inr(lr.gp) + ' (' + window.OCGP.fmt.pct(lr.gpPct) + ')'
      + (loss ? ' — LOSS' : '') + '</div>';
  }

  /* ---- handlers ---- */
  window.ocGPPickModel = function (i, sku) {
    var it = S.items[i]; if (!it) return;
    it.gpModel = sku || '';
    it.gpManual = false;
    var m = sku ? window.OCGP.bySku(sku) : null;
    if (m) {
      it.name = m.name;                       /* PDF par yahi naam chhapta hai */
      it.gpParts = {};                        /* model ke standard parts apne aap lagenge */
      /* v76: M_Products col D (listPrice) ab Product Fix Cost hai, sale rate nahi --
         isliye List price me nahi bharte */
      if (m.hsn) it.hsn = String(m.hsn);
    } else {
      it.name = '';
    }
    renderItemsEditor(); R();
  };
  window.ocGPNotInList = function (i, checked) {
    var it = S.items[i]; if (!it) return;
    it.gpManual = !!checked;
    if (checked) { it.gpModel = ''; }
    else { it.gpParts = {}; }
    renderItemsEditor(); R();
  };
  window.ocGPPickPart = function (i, key, name) {
    var it = S.items[i]; if (!it) return;
    it.gpParts = it.gpParts || {};
    it.gpParts[key] = name || '';
    renderItemsEditor(); R();
  };
  window.ocGPPickType = function (i, v) {
    var it = S.items[i]; if (!it) return;
    it.otype = v || '';
    R();
  };

  /* ================= 4. GHATE PAR ROK ================= */
  function say(msg, ok) {
    var el = el2('storeStatus');
    if (el) { el.textContent = msg; el.className = 'hint'; el.style.color = ok ? 'var(--ok)' : 'var(--err)'; }
  }
  function el2(id) { return document.getElementById(id); }
  function isBoss() {
    try {
      var r = window.OCGP.myRole();
      return r === 'Owner' || r === 'Administrator';
    } catch (e) { return false; }
  }
  var _override = 0;   /* admin ne dobara dabaya to is time tak chhoot */

  /* true = quotation ban sakti hai. GP minus me ho to rok deta hai;
     Owner/Administrator 25 second ke andar dobara dabaye to chhoot mil jaati hai.
     Cost hi na mile (model GP sheet me nahi) to sirf warning, rok nahi. */
  window.ocGPGate = function () {
    try {
      if (!ready()) return true;
      var input = gpInput();
      var priced = (input.lines || []).filter(function (l) { return l.qty > 0 && (l.name || l.model); });
      if (!priced.length) return true;
      var out = window.OCGP.compute(input);
      var t = out.res.totals;
      var lossLines = [];
      out.res.lines.forEach(function (lr, i) {
        if (num(lr.qty) > 0 && out.meta[i] && out.meta[i].costed && num(lr.gp) < 0) {
          lossLines.push((out.meta[i].name || ('Product ' + (i + 1))));
        }
      });
      if (num(t.grossProfit) >= 0 && !lossLines.length) return true;

      if (Date.now() < _override) { _override = 0; return true; }

      var what = lossLines.length
        ? 'Ghata: ' + lossLines.join(', ')
        : 'Loss on the whole order ' + inr(Math.abs(t.grossProfit));
      if (isBoss()) {
        _override = Date.now() + 25000;
        say('⚠ ' + what + ' — quotation blocked. To create it anyway, press again within 25 seconds.');
      } else {
        _override = 0;
        say('⚠ ' + what + ' — a quotation cannot be created at this rate. Increase the rate or reduce the discount.');
      }
      return false;
    } catch (e) { return true; }   /* GP ki apni galti se kaam kabhi na ruke */
  };

  /* ================= 5. LIVE (v78) =================
     GP sheet me kuch bhi badla (cost, naya model / part, standard parts, target
     GP, approval) to gp-bridge.js 'ocgp:updated' bhejta hai. GP panel + card ke
     total / GP % / summary turant; dropdown wale card tab dobara bante hain jab
     user kisi field me type na kar raha ho (warna focus chala jaata). */
  var _pendingCards = false;
  function itemsFocused() {
    var ed = el('itemsEd'), a = document.activeElement;
    return !!(ed && a && a !== document.body && ed.contains(a));
  }
  function rebuildCards() {
    if (typeof renderItemsEditor !== 'function') return;
    if (!itemsFocused()) { _pendingCards = false; try { renderItemsEditor(); } catch (e) {} return; }
    if (_pendingCards) return;
    _pendingCards = true;
    var ed = el('itemsEd');
    ed.addEventListener('focusout', function h() {
      setTimeout(function () {
        if (itemsFocused()) return;              /* focus card ke andar hi doosre field par gaya */
        ed.removeEventListener('focusout', h);
        _pendingCards = false;
        try { renderItemsEditor(); } catch (e) {}
      }, 0);
    });
  }
  function hhmmss(t) { return t ? new Date(t).toLocaleTimeString('en-IN', { hour12: false }) : '—'; }
  function liveText() {
    var st = (window.OCGP && window.OCGP.liveStatus) ? window.OCGP.liveStatus() : {};
    if (st.error) return { cls: ' err', txt: '● GP sheet not reachable — showing data from ' + hhmmss(st.lastSync) + ' · retrying' };
    return { cls: '', txt: '● Live from GP sheet · synced ' + hhmmss(st.lastSync) };
  }
  function paintLive() {
    var lv = liveText();
    [].forEach.call(document.querySelectorAll('.gp-livetag'), function (t) {
      t.className = 'gp-livetag' + lv.cls; t.textContent = lv.txt;
    });
  }
  window.addEventListener('ocgp:updated', function () { render(); rebuildCards(); });
  window.addEventListener('ocgp:synced', paintLive);
  window.addEventListener('ocgp:syncerror', paintLive);

  /* ================= 6. PDF ROK (v78) =================
     GP minus ho to PDF kisi ko nahi milti (Owner / Administrator ko bhi) --
     Download PDF, view mode ka PDF, Print button aur Ctrl+P sab band; browser
     menu se print kiya to page par sirf "PDF blocked" chhapta hai. Wahi hisaab
     jo GP section dikhata hai: koi bhi costed line ghate me (net rate < Total
     GP Cost) ya poori quotation ka GP minus. Rate / discount / parts theek
     karte hi button apne aap khul jaata hai. */
  function lossInfo() {
    if (!ready() || typeof S === 'undefined') return null;
    var input = gpInput();
    var priced = (input.lines || []).filter(function (l) { return l.qty > 0 && (l.name || l.model); });
    if (!priced.length) return null;
    var out = window.OCGP.compute(input), t = out.res.totals, bad = [];
    out.res.lines.forEach(function (lr, i) {
      if (num(lr.qty) > 0 && out.meta[i] && out.meta[i].costed && num(lr.gp) < 0) {
        bad.push((out.meta[i].name || ('Product ' + (i + 1))) + ' (GP ' + window.OCGP.fmt.pct(lr.gpPct) + ')');
      }
    });
    if (!bad.length && !(num(t.grossProfit) < 0)) return null;
    return { lines: bad, gp: t.grossProfit, pct: t.grossProfitPct };
  }
  function blockMsg(b) {
    return '⛔ PDF download blocked — negative GP'
      + (b.lines.length ? ': ' + b.lines.join(', ') : ' on the whole quotation (' + window.OCGP.fmt.pct(b.pct) + ')')
      + '. Increase the List price, reduce the discount or change the parts — the PDF unlocks as soon as GP is positive.';
  }
  function syncBlockUI(b) {
    document.body.classList.toggle('gp-blocked', !!b);
    var btn = el('dlBtn');
    if (btn) {
      btn.classList.toggle('gp-blocked', !!b);
      btn.title = b ? 'Blocked — this quotation has a negative GP' : '';
    }
    var t = el('gpToast');
    if (!b && t) t.style.display = 'none';        /* GP theek hote hi chetavni hatao */
  }
  function toast(msg) {
    var t = el('gpToast');
    if (!t) {
      t = document.createElement('div'); t.id = 'gpToast';
      t.style.cssText = 'position:fixed;top:66px;right:16px;max-width:430px;z-index:9999;background:#A32020;color:#fff;'
        + 'padding:11px 14px;border-radius:8px;font:13px/1.45 system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.25);cursor:pointer';
      t.onclick = function () { t.style.display = 'none'; var g = el('gpSec'); if (g) g.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
      document.body.appendChild(t);
    }
    t.textContent = msg; t.style.display = 'block';
    clearTimeout(t._h); t._h = setTimeout(function () { t.style.display = 'none'; }, 9000);
  }
  /* true = PDF band. show = user ko wajah dikhao */
  window.ocGPPdfBlocked = function (show) {
    var b = null;
    try { b = lossInfo(); } catch (e) { b = null; }    /* GP ki apni galti se PDF kabhi na ruke */
    syncBlockUI(b);
    if (b && show) { toast(blockMsg(b)); say(blockMsg(b), false); }
    return !!b;
  };
  /* download se pehle: cost master abhi aa raha ho to (max 8 sec) intezaar, phir jaanch */
  window.ocGPPdfCheck = function () {
    var wait = (window.OCGP && window.OCGP.cfg().url && !ready())
      ? Promise.race([window.OCGP.ensure(), new Promise(function (r) { setTimeout(r, 8000); })]).catch(function () {})
      : Promise.resolve();
    return wait.then(function () { return window.ocGPPdfBlocked(true); });
  };
  /* Print button / Ctrl+P bhi PDF ka raasta hain ("Save as PDF") */
  (function () {
    var _print = window.print ? window.print.bind(window) : null;
    window.print = function () { if (window.ocGPPdfBlocked(true)) return; if (_print) return _print(); };
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P') && window.ocGPPdfBlocked(true)) {
        e.preventDefault(); e.stopPropagation();
      }
    }, true);
  })();

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
    /* Product card ka model/parts wala hissa tabhi ban sakta hai jab ye file load
       ho chuki ho -- pehla render is se pehle ho jaata hai, isliye ek baar dobara
       khinch lete hain; aur cost master aane ke baad phir se, taaki dropdown bhar jaayein. */
    try { if (typeof renderItemsEditor === 'function') renderItemsEditor(); } catch (e) {}
    /* builder khulte hi cost master sheet se taaza; uske baad gp-bridge.js har
       30 sec khud poochhta hai. Data badla to 'ocgp:updated' -> neeche LIVE. */
    injectCardCSS();
    if (window.OCGP && window.OCGP.cfg().url) window.OCGP.load(true).catch(function () {});
    render();
    /* CRM se cloud sync hone par customer list badal sakti hai */
    setTimeout(mountCustomer, 4000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
