/* ===========================================================================
   gp-order.js  —  Orders module ka GP glue (index.html ke liye)
     · Order form (Products section ke neeche) live GP panel
     · Order detail me GP line
   Cost GP Calculator ke sheet se aata hai — gp-bridge.js dekho.
   =========================================================================== */
(function () {
  'use strict';

  function num(v) { var x = parseFloat(v); return isFinite(x) ? x : 0; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* order form me freight ek custom (Form Builder) field hai — jo value client
     se li ja rahi hai wo revenue hai, isliye GP me sale value ke saath judti hai */
  function freightBilled() {
    var best = 0;
    try {
      document.querySelectorAll('#modal input, #modal textarea').forEach(function (inp) {
        var lab = inp.closest('div');
        var txt = lab ? String(lab.textContent || '') : '';
        if (/freight/i.test(txt) && /amount|amt|charge/i.test(txt) && !/proof/i.test(txt)) {
          var v = num(inp.value); if (v > best) best = v;
        }
      });
    } catch (e) {}
    return best;
  }

  function gpInput() {
    var items = window.__orderItems || [];
    var custEl = document.getElementById('o-cust');
    var dateEl = document.getElementById('o-date');
    return {
      customer: (custEl && custEl.value) || '',
      date: (dateEl && dateEl.value) || '',
      freightBilled: freightBilled(),
      lines: items.map(function (it) {
        return {
          name: it.product || '', qty: num(it.qty), price: num(it.rate), disc: 0,
          gstPct: 18, model: it.gpModel || '', manual: !!it.gpManual, cost: it.gpCost || {}
        };
      })
    };
  }

  var _busy = false;
  window.ocOrderGPRender = function () {
    if (_busy) return;
    var box = document.getElementById('o-gp');
    if (!box || !window.OCGP) return;
    _busy = true;
    try {
      window.OCGP.renderPanel(box, gpInput(), {
        editable: true,
        onChange: function (i, patch) {
          var it = (window.__orderItems || [])[i]; if (!it) return;
          if (patch.manual !== undefined) it.gpManual = !!patch.manual;
          if (patch.model !== undefined) it.gpModel = patch.model;
          if (patch.costPatch) {
            it.gpCost = it.gpCost || {};
            Object.keys(patch.costPatch).forEach(function (k) { it.gpCost[k] = patch.costPatch[k]; });
          }
          _busy = false; window.ocOrderGPRender();
        }
      });
    } finally { _busy = false; }
  };

  window.ocOrderGPSnapshot = function () {
    try {
      if (!window.OCGP || !window.OCGP.masters()) return null;
      var input = gpInput();
      var any = (input.lines || []).some(function (l) { return l.qty > 0 && l.name; });
      if (!any) return null;
      return window.OCGP.snapshot(window.OCGP.compute(input));
    } catch (e) { return null; }
  };

  /* ---------- order detail ki GP line ----------------------------------- */
  window.ocOrderGPDetailHTML = function (o) {
    if (!o) return '';
    var g = o.gp;
    var vis = (window.OCGP && window.OCGP.visibility) ? window.OCGP.visibility() : 'verdict';
    if (!g) return '';
    var word = num(g.gp) > 0 ? 'Fayda' : (num(g.gp) < 0 ? 'Ghata' : 'Barabar');
    var col = num(g.gp) > 0 ? 'var(--ok, #12704A)' : (num(g.gp) < 0 ? 'var(--crit, #A32020)' : 'var(--muted)');
    var line = function (a, b) {
      return '<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border)">'
        + '<span style="color:var(--text-2);font-size:13px">' + a + '</span>'
        + '<span style="font-size:13px;font-weight:600">' + b + '</span></div>';
    };
    var h = '<div class="section-title">GP (internal)</div>';
    if (vis !== 'full') {
      return h + line('Order profitability', '<span style="color:' + col + '">' + word + '</span>');
    }
    var f = window.OCGP.fmt;
    h += line('Verdict', '<span style="color:' + col + '">' + word + ' ' + f.inr(Math.abs(num(g.gp))) + '</span>');
    h += line('Gross profit %', f.pct(g.gpPct));
    h += line('Sale value (ex-GST)', f.inr(g.nsv));
    h += line('BOM cost', f.inr(g.cogs));
    h += line('GP per piece', f.inr(g.gpPerUnit));
    if (g.verdict && g.verdict.level) h += line('Approval', esc(g.verdict.level) + (g.verdict.who ? ' · ' + esc(g.verdict.who) : ''));
    if (g.uncostedLines) h += line('Cost missing', g.uncostedLines + ' product — GP adhoora');
    h += '<div style="font-size:11.5px;color:var(--muted);padding:6px 0">' + (g.at ? new Date(g.at).toLocaleString('en-IN') : '') + ' ke cost master par</div>';
    return h;
  };

  /* masters pehle se garam rakho, taaki order form khulte hi GP dikhe */
  try { if (window.OCGP && window.OCGP.cfg().url) window.OCGP.ensure().catch(function () {}); } catch (e) {}
})();
