/* ===========================================================================
   OakCraft GP Bridge  v1.0
   Quotation / PI / Order banate waqt GP (fayda ya ghata) live dikhata hai.

   Cost kahan se aati hai
     Sales GP Calculator ka Google Sheet (M_Products + M_Components) hi single
     source of truth hai. Yahan se sirf padha jaata hai, kuch likha nahi jaata.
     Uska Apps Script /exec URL + token teen jagah se uthta hai (isi kram me):
       1. Admin Panel -> API Integrations -> "GP Calculator (cost master)"
          (localStorage 'apiconfig', poori team ke liye Sheet par sync hota hai)
       2. localStorage gp.endpoint / gp.token  -- GP calculator ka "Connect
          Sheets" dialog inhi keys me likhta hai. Dono site ek hi origin
          (weboakcraft.github.io) par hain, isliye wahan connect kar liya to
          yahan kuch karne ki zarurat nahi.
       3. window.OC_GP_CONFIG = {url, token}  -- testing ke liye.
     Masters 6 ghante localStorage me cache hote hain, isliye offline bhi
     GP dikhta rehta hai.

   Maths
     lib/gp-engine.js -- GP calculator ka wahi engine, bilkul waisa hi. Isliye
     builder ka GP aur calculator ka GP hamesha ek jaisa aata hai.
     GP = net sales value (discount ke baad + billed freight) - BOM cost
     BOM cost = armrest + seat mechanism + base + wheels. GST GP me nahi aata.

   Kaun dekh sakta hai
     GP_FULL_ROLES / GP_FULL_USERS -- inko poora breakdown (cost, GP Rs, GP%)
     dikhta hai. Baaki sabko sirf verdict chip (Fayda / Ghata / cost missing),
     bina rupaye aur bina percentage. Cost data sensitive hai, isliye default
     yahi rakha hai -- badalna ho to neeche ki do lines badal do.
   =========================================================================== */
(function (root) {
  'use strict';

  var TTL = 6 * 60 * 60 * 1000;                 /* masters cache: 6 ghante */
  var LS_MASTERS = 'oc_gpMasters';
  var LS_URL = 'gp.endpoint', LS_TOKEN = 'gp.token';
  var LS_MAP = 'oc_gpModelMap';                 /* typed name -> GP model, seekha hua */

  var GP_FULL_ROLES = ['Owner', 'Administrator', 'Sales Manager'];
  var GP_FULL_USERS = ['mis@oakcraft.in'];

  /* ---------- chhote helpers -------------------------------------------- */
  function num(v) { var x = parseFloat(v); return isFinite(x) ? x : 0; }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function jget(k, d) { try { var v = JSON.parse(lsGet(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ''); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function inr(n) { return '₹ ' + Math.round(num(n)).toLocaleString('en-IN'); }
  function pct(n) { return (Math.round(num(n) * 10) / 10).toFixed(1) + '%'; }

  /* ---------- config ----------------------------------------------------- */
  function cfg() {
    var url = '', token = '';
    var api = jget('apiconfig', {}) || {};
    var g = api.gpcalc || {};
    if (g.fields) { url = String(g.fields[0] || '').trim(); token = String(g.fields[1] || '').trim(); }
    if (!url) { url = String(lsGet(LS_URL) || '').trim(); token = String(lsGet(LS_TOKEN) || '').trim(); }
    if (!url && root.OC_GP_CONFIG) {
      url = String(root.OC_GP_CONFIG.url || '').trim();
      token = String(root.OC_GP_CONFIG.token || '').trim();
    }
    if (/^PASTE_|^CHANGE-ME/.test(url)) { url = ''; token = ''; }
    return { url: url, token: token };
  }
  function setCfg(url, token) {
    lsSet(LS_URL, String(url || '').trim());
    lsSet(LS_TOKEN, String(token || '').trim());
    _masters = null; try { localStorage.removeItem(LS_MASTERS); } catch (e) {}
  }

  /* ---------- kaun dekh sakta hai ---------------------------------------- */
  function sessionEmail() {
    if (typeof root.ocSessionEmail === 'function') { try { return root.ocSessionEmail(); } catch (e) {} }
    try {
      var t = lsGet('crm_sid') || '';
      var b = String(t).split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
      if (b) { var f = atob(b).split('|'); if (f[0]) return String(f[0]).trim().toLowerCase(); }
    } catch (e) {}
    try {
      var s = JSON.parse(lsGet('crm_session') || 'null');
      if (s && s.email) return String(s.email).trim().toLowerCase();
    } catch (e) {}
    return '';
  }
  function myRole() {
    var me = sessionEmail(); if (!me) return '';
    var users = jget('users', []) || [];
    for (var i = 0; i < users.length; i++) {
      var u = users[i];
      if (u && String(u.email || '').trim().toLowerCase() === me) return String(u.role || '');
    }
    return '';
  }
  /* 'full' = poora breakdown, 'verdict' = sirf fayda/ghata chip */
  function visibility() {
    var me = sessionEmail();
    if (me && GP_FULL_USERS.indexOf(me) >= 0) return 'full';
    var r = myRole();
    return GP_FULL_ROLES.indexOf(r) >= 0 ? 'full' : 'verdict';
  }

  /* ---------- masters --------------------------------------------------- */
  var _masters = jget(LS_MASTERS, null);
  var _loading = null, _lastErr = '';
  var IDX = { prod: {}, sku: {}, comp: {}, compByName: {} };

  function fresh() { return !!(_masters && _masters.at && (Date.now() - _masters.at) < TTL); }
  function masters() { return (_masters && _masters.data) ? _masters.data : null; }
  function lastError() { return _lastErr; }

  function buildIndex() {
    IDX = { prod: {}, sku: {}, comp: {}, compByName: {} };
    var m = masters(); if (!m) return;
    (m.products || []).forEach(function (p) {
      var k = norm(p.name); if (k) IDX.prod[k] = p;
      var s = norm(p.sku); if (s) IDX.sku[s] = p;
    });
    (m.components || []).forEach(function (c) {
      IDX.comp[norm(c.type) + '|' + norm(c.name)] = num(c.rate);
      var n = norm(c.name); if (n && IDX.compByName[n] === undefined) IDX.compByName[n] = num(c.rate);
    });
  }
  buildIndex();

  function load(force) {
    var c = cfg();
    if (!c.url) { _lastErr = 'GP calculator ka Apps Script URL set nahi hai.'; return Promise.reject(new Error(_lastErr)); }
    if (!force && fresh()) return Promise.resolve(masters());
    if (_loading) return _loading;
    _loading = fetch(c.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'bootstrap', token: c.token, payload: {} })
    })
      .then(function (r) { if (!r.ok) throw new Error('GP sheet ne ' + r.status + ' bheja'); return r.json(); })
      .then(function (j) {
        if (!j.ok) throw new Error(j.error || 'GP sheet ne request reject kar di');
        _masters = { at: Date.now(), data: j.data };
        try { lsSet(LS_MASTERS, JSON.stringify(_masters)); } catch (e) {}
        buildIndex(); _lastErr = ''; _loading = null;
        return j.data;
      })
      .catch(function (e) {
        _loading = null; _lastErr = (e && e.message) ? e.message : String(e);
        throw e;
      });
    return _loading;
  }
  /* cache purana ho to background me chupchap refresh kar lo */
  function ensure() {
    if (!cfg().url) return Promise.reject(new Error('GP sheet connected nahi hai.'));
    if (masters() && fresh()) return Promise.resolve(masters());
    return load(true);
  }

  /* ---------- model matching -------------------------------------------- */
  function modelList() {
    var m = masters(); if (!m) return [];
    return (m.products || []).slice().sort(function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }
  function bySku(sku) {
    var k = norm(sku); return k ? (IDX.sku[k] || IDX.prod[k] || null) : null;
  }
  function learned(nameKey) {
    var map = jget(LS_MAP, {}) || {};
    return map[nameKey] ? bySku(map[nameKey]) : null;
  }
  function remember(typedName, sku) {
    var k = norm(typedName); if (!k) return;
    var map = jget(LS_MAP, {}) || {};
    if (sku) map[k] = String(sku); else delete map[k];
    lsSet(LS_MAP, JSON.stringify(map));
  }
  /* exact -> seekha hua -> shuruaat milti hai -> andar aata hai (sabse lamba jeetta hai) */
  function findModel(name) {
    var k = norm(name); if (!k || !masters()) return null;
    if (IDX.prod[k]) return IDX.prod[k];
    if (IDX.sku[k]) return IDX.sku[k];
    var lrn = learned(k); if (lrn) return lrn;
    var best = null, bestLen = 0;
    (masters().products || []).forEach(function (p) {
      var pk = norm(p.name); if (!pk || pk.length < 3) return;
      var hit = (k.indexOf(pk) === 0) || (pk.indexOf(k) === 0) || (k.indexOf(pk) >= 0) || (pk.indexOf(k) >= 0);
      if (hit && pk.length > bestLen) { best = p; bestLen = pk.length; }
    });
    return best;
  }
  function compRate(type, name) {
    if (!name) return 0;
    var k = norm(type) + '|' + norm(name);
    if (IDX.comp[k] !== undefined) return IDX.comp[k];
    var n = norm(name);
    return IDX.compByName[n] !== undefined ? IDX.compByName[n] : 0;
  }
  function costOf(p) {
    if (!p) return null;
    return {
      arm: compRate('Armrest', p.armrestName),
      seat: compRate('Seat mechanism', p.seatMechName),
      base: compRate('Base', p.baseName),
      wheels: compRate('Wheels', p.wheelsName),
      names: {
        arm: p.armrestName || '', seat: p.seatMechName || '',
        base: p.baseName || '', wheels: p.wheelsName || ''
      }
    };
  }
  var ZERO = { arm: 0, seat: 0, base: 0, wheels: 0, names: { arm: '', seat: '', base: '', wheels: '' } };

  /* ---------- compute ---------------------------------------------------
     input = {
       lines: [{ name, qty, price, disc, gstPct, model (sku, optional),
                 manual (bool), cost:{arm,seat,base,wheels} }],
       freightBilled, customer, date, targetGpPct
     }                                                                      */
  function compute(input) {
    input = input || {};
    var m = masters();
    var lines = [], meta = [];
    (input.lines || []).forEach(function (l) {
      var mo = null, how = 'none';
      if (l.model) { mo = bySku(l.model); if (mo) how = 'chosen'; }
      if (!mo && !l.manual) { mo = findModel(l.name); if (mo) how = 'auto'; }
      var c;
      if (l.manual) {
        var mc = l.cost || {};
        c = { arm: num(mc.arm), seat: num(mc.seat), base: num(mc.base), wheels: num(mc.wheels), names: ZERO.names };
        how = 'manual';
      } else {
        c = costOf(mo) || ZERO;
      }
      lines.push({
        description: l.name || '', qty: num(l.qty), listPrice: num(l.price), discPct: num(l.disc),
        cArmrest: c.arm, cSeatMech: c.seat, cBase: c.base, cWheels: c.wheels,
        gstPct: (l.gstPct == null ? 18 : num(l.gstPct))
      });
      meta.push({
        name: l.name || '', model: mo, how: how, cost: c,
        costed: (num(c.arm) + num(c.seat) + num(c.base) + num(c.wheels)) > 0
      });
    });

    var order = {
      meta: { orderDate: input.date || new Date().toISOString().slice(0, 10) },
      customer: { name: input.customer || '—' },
      lines: lines,
      recovery: { freightBilled: num(input.freightBilled) },
      targetGpPct: num(input.targetGpPct || (m && m.settings && m.settings.targetGpPct) || 20)
    };
    if (m && m.approvalMatrix && m.approvalMatrix.length) order.approvalMatrix = m.approvalMatrix;

    var res = root.GPEngine.compute(order);
    var priced = meta.filter(function (x, i) { return lines[i].qty > 0; });
    return {
      res: res, meta: meta, order: order,
      costed: priced.filter(function (x) { return x.costed; }).length,
      uncosted: priced.filter(function (x) { return !x.costed; }).length,
      total: priced.length
    };
  }

  /* record me save karne layak chhota snapshot */
  function snapshot(out) {
    if (!out || !out.res) return null;
    var t = out.res.totals, v = out.res.verdict || {};
    return {
      v: 1, at: new Date().toISOString(), source: 'gp-sheet',
      nsv: Math.round(t.nsv), cogs: Math.round(t.cogs),
      gp: Math.round(t.grossProfit), gpPct: Math.round(t.grossProfitPct * 10) / 10,
      gpPerUnit: Math.round(t.gpPerUnit), gst: Math.round(t.gstTotal),
      invoiceValue: Math.round(t.invoiceValue),
      verdict: { level: v.level || '', who: v.who || '', tone: v.tone || '' },
      costedLines: out.costed, uncostedLines: out.uncosted,
      lines: out.meta.map(function (x, i) {
        var lr = out.res.lines[i] || {};
        return {
          name: x.name, model: x.model ? (x.model.sku || x.model.name) : '',
          how: x.how, costUnit: Math.round(num(lr.unitCogs)),
          gp: Math.round(num(lr.gp)), gpPct: Math.round(num(lr.gpPct) * 10) / 10
        };
      })
    };
  }

  /* ---------- CSS ------------------------------------------------------- */
  var CSS = ''
    + '.ocgp{font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}'
    + '.ocgp *{box-sizing:border-box}'
    + '.ocgp-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px}'
    + '.ocgp-big{border-radius:12px;padding:12px 14px;color:#fff;display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}'
    + '.ocgp-big b{font-size:26px;line-height:1;font-weight:800;letter-spacing:-.5px}'
    + '.ocgp-good{background:#12704A}.ocgp-watch{background:#B06A00}.ocgp-risk{background:#A32020}.ocgp-grey{background:#5A5A5A}'
    + '.ocgp-sub{font-size:12px;opacity:.92}'
    + '.ocgp-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}'
    + '.ocgp-tbl{width:100%;min-width:430px;border-collapse:collapse;margin-top:10px;font-size:12px}'
    + '.ocgp-tbl th,.ocgp-tbl td{border-bottom:1px solid rgba(128,128,128,.28);padding:5px 6px;text-align:right;white-space:nowrap}'
    + '.ocgp-tbl th{font-size:10.5px;letter-spacing:.4px;text-transform:uppercase;opacity:.7;font-weight:600}'
    + '.ocgp-tbl td.l,.ocgp-tbl th.l{text-align:left;white-space:normal}'
    + '.ocgp-tbl tr.bad td{background:rgba(163,32,32,.12)}'
    + '.ocgp-sum{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-top:10px}'
    + '.ocgp-cell{border:1px solid rgba(128,128,128,.3);border-radius:9px;padding:7px 9px}'
    + '.ocgp-cell span{display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:.4px;opacity:.65}'
    + '.ocgp-cell b{font-size:14px;font-variant-numeric:tabular-nums}'
    + '.ocgp-note{margin-top:9px;font-size:12px;padding:7px 9px;border-radius:8px;background:rgba(128,128,128,.12)}'
    + '.ocgp-warn{color:#A32020}.ocgp-ok{color:#12704A}'
    + '.ocgp-mini{font-size:11.5px;opacity:.75}'
    + '.ocgp-btn{font:600 12px system-ui;padding:5px 10px;border-radius:7px;border:1px solid rgba(128,128,128,.45);background:transparent;color:inherit;cursor:pointer}'
    + '.ocgp-btn:hover{background:rgba(128,128,128,.14)}'
    + '.ocgp sel,.ocgp select,.ocgp input{font:12px system-ui;padding:4px 6px;border-radius:6px;border:1px solid rgba(128,128,128,.45);background:transparent;color:inherit;max-width:100%}'
    + '.ocgp-cfg{display:grid;gap:6px;margin-top:8px}'
    + '@media print{.ocgp,.ocgp-print-hide{display:none !important}}';
  function injectCSS() {
    if (document.getElementById('ocgp-css')) return;
    var s = document.createElement('style');
    s.id = 'ocgp-css'; s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  /* ---------- panel ----------------------------------------------------- */
  function toneClass(tone, gp) {
    if (num(gp) < 0) return 'ocgp-risk';
    if (tone === 'good') return 'ocgp-good';
    if (tone === 'risk') return 'ocgp-risk';
    if (tone === 'watch') return 'ocgp-watch';
    return 'ocgp-grey';
  }
  function verdictWord(gp) {
    if (num(gp) > 0) return 'FAYDA';
    if (num(gp) < 0) return 'GHATA';
    return 'BARABAR';
  }

  function cfgFormHTML() {
    return '<div class="ocgp-note">GP cost master connected nahi hai. Sales GP Calculator ka Apps Script '
      + '<b>/exec</b> URL aur token ek baar daal do — wahi sheet cost ka source rahegi.'
      + '<div class="ocgp-cfg">'
      + '<input data-gp="url" placeholder="https://script.google.com/macros/s/.../exec">'
      + '<input data-gp="token" placeholder="Shared token">'
      + '<div><button class="ocgp-btn" data-gp="save">Connect &amp; cost laao</button></div>'
      + '</div></div>';
  }

  function panelHTML(out, opts) {
    var mode = opts.mode || 'full';
    var t = out.res.totals, v = out.res.verdict || {};
    var gp = t.grossProfit, gpp = t.grossProfitPct;
    var cls = toneClass(v.tone, gp);
    var word = verdictWord(gp);

    /* verdict-only view: koi rupaya, koi percentage nahi */
    if (mode !== 'full') {
      var msg = out.uncosted
        ? 'Kuch product ka cost master me nahi hai — GP adhoora hai. Admin se cost add karwa lo.'
        : (word === 'FAYDA' ? 'Is order me fayda hai.' : word === 'GHATA' ? 'Is rate par ghata ho raha hai — rate ya discount dekho.' : 'Na fayda na ghata.');
      return '<div class="ocgp-big ' + (out.uncosted ? 'ocgp-grey' : cls) + '"><b>' + (out.uncosted ? 'ADHOORA' : word) + '</b>'
        + '<span class="ocgp-sub">' + esc(msg) + '</span></div>'
        + (v.level ? '<div class="ocgp-note">Approval: <b>' + esc(v.level) + '</b>' + (v.who ? ' · ' + esc(v.who) : '') + '</div>' : '');
    }

    var h = '';
    h += '<div class="ocgp-big ' + cls + '">'
      + '<b>' + pct(gpp) + '</b>'
      + '<span><b style="font-size:15px">' + word + ' ' + inr(Math.abs(gp)) + '</b>'
      + '<span class="ocgp-sub"> · ' + inr(t.nsv) + ' ki sale value par</span></span>'
      + '</div>';

    if (v.level) {
      h += '<div class="ocgp-note">Approval: <b>' + esc(v.level) + '</b>'
        + (v.who ? ' — ' + esc(v.who) : '')
        + ' · target ' + pct(out.res.solver.targetPct)
        + (out.res.solver.priceGapPct > 0.05 ? ' · target tak pahunchne ke liye rate ' + pct(out.res.solver.priceGapPct) + ' badhana padega' : ' · target se upar')
        + '</div>';
    }

    /* per line */
    var models = modelList();
    function optsFor(sel) {
      var o = '<option value=""' + (sel ? '' : ' selected') + '>— model chuno —</option>';
      models.forEach(function (p) {
        var v = String(p.sku || p.name);
        o += '<option value="' + esc(v) + '"' + (v === sel ? ' selected' : '') + '>' + esc(p.name) + '</option>';
      });
      o += '<option value="__manual"' + (sel === '__manual' ? ' selected' : '') + '>— cost khud bharo —</option>';
      return o;
    }

    h += '<div class="ocgp-scroll"><table class="ocgp-tbl"><thead><tr>'
      + '<th class="l">Product</th><th class="l">GP model / cost source</th>'
      + '<th>Cost/pc</th><th>Net rate/pc</th><th>GP/pc</th><th>GP %</th>'
      + '</tr></thead><tbody>';
    out.meta.forEach(function (x, i) {
      var lr = out.res.lines[i] || {};
      var sel = x.how === 'manual' ? '__manual' : (x.model ? (x.model.sku || x.model.name) : '');
      var bad = lr.belowCost || (num(lr.qty) > 0 && !x.costed);
      var cellSel = opts.editable
        ? '<select data-gp="model" data-i="' + i + '">' + optsFor(sel) + '</select>'
        : esc(x.model ? x.model.name : (x.how === 'manual' ? 'manual cost' : 'cost nahi mila'));
      var tag = x.how === 'auto' ? '<div class="ocgp-mini">auto-matched</div>'
        : x.how === 'chosen' ? '<div class="ocgp-mini">aapne chuna</div>'
        : x.how === 'manual' ? '<div class="ocgp-mini">manual</div>'
        : '<div class="ocgp-mini ocgp-warn">cost master me nahi mila</div>';
      var manualBoxes = (opts.editable && x.how === 'manual')
        ? '<div class="ocgp-cfg" style="grid-template-columns:repeat(2,1fr)">'
          + ['arm', 'seat', 'base', 'wheels'].map(function (k) {
            var lbl = { arm: 'Armrest', seat: 'Seat mech', base: 'Base', wheels: 'Wheels' }[k];
            return '<input type="number" step="0.01" data-gp="cost" data-k="' + k + '" data-i="' + i + '" placeholder="' + lbl + '" value="' + (num(x.cost[k]) || '') + '">';
          }).join('') + '</div>'
        : '';
      h += '<tr' + (bad ? ' class="bad"' : '') + '>'
        + '<td class="l">' + esc(x.name || '—') + '<div class="ocgp-mini">' + num(lr.qty) + ' pc</div></td>'
        + '<td class="l">' + cellSel + tag + manualBoxes + '</td>'
        + '<td>' + inr(lr.unitCogs) + '</td>'
        + '<td>' + inr(lr.unitNetPrice) + '</td>'
        + '<td>' + inr(lr.gp && num(lr.qty) ? num(lr.gp) / num(lr.qty) : 0) + '</td>'
        + '<td>' + (lr.belowCost ? '<b class="ocgp-warn">' + pct(lr.gpPct) + '</b>' : pct(lr.gpPct)) + '</td>'
        + '</tr>';
    });
    h += '</tbody></table></div>';

    h += '<div class="ocgp-sum">'
      + '<div class="ocgp-cell"><span>Sale value (ex-GST)</span><b>' + inr(t.nsv) + '</b></div>'
      + '<div class="ocgp-cell"><span>BOM cost</span><b>' + inr(t.cogs) + '</b></div>'
      + '<div class="ocgp-cell"><span>Gross profit</span><b>' + inr(t.grossProfit) + '</b></div>'
      + '<div class="ocgp-cell"><span>GP per piece</span><b>' + inr(t.gpPerUnit) + '</b></div>'
      + '<div class="ocgp-cell"><span>GST (alag)</span><b>' + inr(t.gstTotal) + '</b></div>'
      + '<div class="ocgp-cell"><span>Invoice value</span><b>' + inr(t.invoiceValue) + '</b></div>'
      + '</div>';

    if (out.uncosted) {
      h += '<div class="ocgp-note ocgp-warn"><b>' + out.uncosted + ' product</b> ka cost nahi mila, is liye GP itna hi bharosemand hai. '
        + 'GP sheet ke M_Products me model add karo, ya upar se model chuno / cost khud bharo.</div>';
    }
    var msgs = (out.res.issues || []).filter(function (x) { return x.sev !== 'info'; });
    if (msgs.length) {
      h += '<div class="ocgp-note">' + msgs.slice(0, 6).map(function (x) {
        return '<div class="' + (x.sev === 'error' ? 'ocgp-warn' : '') + '">' + (x.sev === 'error' ? '⚠ ' : '· ') + esc(x.msg) + '</div>';
      }).join('') + '</div>';
    }
    var m = masters();
    h += '<div class="ocgp-head" style="margin-top:9px">'
      + '<span class="ocgp-mini">Cost master: ' + (m ? ((m.products || []).length + ' model · ' + (m.components || []).length + ' component · ' + new Date(_masters.at).toLocaleString('en-IN')) : 'load nahi hua') + '</span>'
      + '<span><button class="ocgp-btn" data-gp="refresh">Cost refresh</button></span></div>';
    return h;
  }

  /* renderPanel(el, input, opts)
       opts.editable    per-line model chunne ki suvidha
       opts.onChange(i, patch)   caller apne state me patch lagakar dobara render kare
       opts.mode        'full' | 'verdict'  (default: visibility() se)              */
  function renderPanel(el, input, opts) {
    if (!el) return null;
    opts = opts || {};
    injectCSS();
    el.classList.add('ocgp');
    var mode = opts.mode || visibility();

    function wire(out) {
      el.querySelectorAll('[data-gp="model"]').forEach(function (s) {
        s.addEventListener('change', function () {
          var i = +s.getAttribute('data-i');
          var val = s.value;
          if (val === '__manual') {
            opts.onChange && opts.onChange(i, { manual: true, model: '' });
          } else {
            var typed = (input.lines[i] || {}).name;
            remember(typed, val);
            opts.onChange && opts.onChange(i, { manual: false, model: val });
          }
        });
      });
      el.querySelectorAll('[data-gp="cost"]').forEach(function (inp) {
        inp.addEventListener('change', function () {
          var i = +inp.getAttribute('data-i'), k = inp.getAttribute('data-k');
          var cost = {}; cost[k] = num(inp.value);
          opts.onChange && opts.onChange(i, { manual: true, costPatch: cost });
        });
      });
      var rb = el.querySelector('[data-gp="refresh"]');
      if (rb) rb.addEventListener('click', function () {
        rb.disabled = true; rb.textContent = 'laa raha hoon…';
        load(true).then(function () { renderPanel(el, input, opts); })
          .catch(function (e) { rb.disabled = false; rb.textContent = 'Cost refresh'; el.insertAdjacentHTML('beforeend', '<div class="ocgp-note ocgp-warn">' + esc(e.message) + '</div>'); });
      });
      return out;
    }

    function wireCfg() {
      var b = el.querySelector('[data-gp="save"]');
      if (!b) return;
      b.addEventListener('click', function () {
        var u = (el.querySelector('[data-gp="url"]') || {}).value || '';
        var t = (el.querySelector('[data-gp="token"]') || {}).value || '';
        if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(u.trim())) {
          el.insertAdjacentHTML('beforeend', '<div class="ocgp-note ocgp-warn">URL /exec par khatam hona chahiye.</div>');
          return;
        }
        setCfg(u, t);
        b.disabled = true; b.textContent = 'connect kar raha hoon…';
        load(true).then(function () { renderPanel(el, input, opts); })
          .catch(function (e) {
            b.disabled = false; b.textContent = 'Connect & cost laao';
            el.insertAdjacentHTML('beforeend', '<div class="ocgp-note ocgp-warn">' + esc(e.message) + '</div>');
          });
      });
    }

    var c = cfg();
    if (!c.url) {
      el.innerHTML = (mode === 'full')
        ? cfgFormHTML()
        : '<div class="ocgp-note">GP cost master connected nahi hai — admin se kehna padega.</div>';
      wireCfg();
      return null;
    }
    if (!masters()) {
      el.innerHTML = '<div class="ocgp-note">GP cost master laa raha hoon…</div>';
      load(false).then(function () { renderPanel(el, input, opts); })
        .catch(function (e) {
          el.innerHTML = '<div class="ocgp-note ocgp-warn">Cost master nahi mila: ' + esc(e.message)
            + '<div><button class="ocgp-btn" data-gp="again">Dobara koshish</button></div></div>';
          var a = el.querySelector('[data-gp="again"]');
          if (a) a.addEventListener('click', function () { renderPanel(el, input, opts); });
        });
      return null;
    }
    if (!fresh()) { load(true).then(function () { renderPanel(el, input, opts); }).catch(function () {}); }

    var nlines = (input.lines || []).filter(function (l) { return num(l.qty) > 0 && (l.name || l.model); });
    if (!nlines.length) {
      el.innerHTML = '<div class="ocgp-note">Product line bharo — GP apne aap aa jayega.</div>';
      return null;
    }
    var out = compute(input);
    el.innerHTML = panelHTML(out, { mode: mode, editable: !!opts.editable && mode === 'full' });
    wire(out);
    return out;
  }

  root.OCGP = {
    cfg: cfg, setCfg: setCfg, load: load, ensure: ensure, masters: masters, lastError: lastError,
    modelList: modelList, bySku: bySku, findModel: findModel, costOf: costOf, compRate: compRate,
    compute: compute, snapshot: snapshot, renderPanel: renderPanel, panelHTML: panelHTML,
    visibility: visibility, sessionEmail: sessionEmail, myRole: myRole,
    remember: remember, norm: norm, fmt: { inr: inr, pct: pct }
  };
})(typeof window !== 'undefined' ? window : globalThis);
