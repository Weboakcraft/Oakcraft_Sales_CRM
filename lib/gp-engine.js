/* ===========================================================================
   gp-engine.js
   Verbatim copy of sales_gp_calcularot/assets/engine.js (GP Calculator ka maths).
   Isme kuch bhi mat badlo. GP calculator me engine badle to ye file dobara copy
   karo, warna CRM aur calculator ke numbers alag ho jayenge.
   Source: https://github.com/Weboakcraft/sales_gp_calcularot
   =========================================================================== */
/* ===========================================================================
   Sales GP Engine  v1.0
   Pure, dependency-free calculation core. No DOM, no network.
   Five calculation levels:
     L1  Production      -> Gross Profit
     L2  Order-direct    -> Contribution
     L3  Commercial      -> Net Contribution
     L4  Overhead        -> ACTUAL GP
     L5  Tax & cash      -> Invoice value, realisation (excluded from GP)
   =========================================================================== */
(function (root) {
  'use strict';

  /* ---------- helpers ---------------------------------------------------- */
  var num = function (v) { var x = parseFloat(v); return isFinite(x) ? x : 0; };
  var rate = function (v) { return num(v) / 100; };            // 12.5 -> 0.125
  var div = function (a, b) { return b ? a / b : 0; };
  var r2 = function (v) { return Math.round((num(v) + Number.EPSILON) * 100) / 100; };

  /* ---------- L1 : one order line ---------------------------------------- */
  function computeLine(l) {
    var qty = num(l.qty);
    var list = num(l.listPrice);
    var gross = qty * list;
    var discPct = rate(l.discPct);
    var discAmt = gross * discPct;
    var netRev = gross - discAmt;
    var unitNet = div(netRev, qty);

    // exactly four costed parts — taken straight, nothing loaded on top
    var unitCogs = num(l.cArmrest) + num(l.cSeatMech) + num(l.cBase) + num(l.cWheels);
    var cogs = unitCogs * qty;

    var gp = netRev - cogs;

    return {
      qty: qty,
      grossValue: gross,
      discountAmt: discAmt,
      netRevenue: netRev,
      unitNetPrice: unitNet,
      unitArmrest: num(l.cArmrest),
      unitSeatMech: num(l.cSeatMech),
      unitBase: num(l.cBase),
      unitWheels: num(l.cWheels),
      unitCogs: unitCogs,
      cogs: cogs,
      gp: gp,
      gpPct: div(gp, netRev) * 100,
      markupPct: div(gp, cogs) * 100,
      cbm: num(l.cbmPerUnit) * qty,
      weight: num(l.weightPerUnit) * qty,
      gstPct: num(l.gstPct),
      gstAmt: netRev * rate(l.gstPct),
      belowCost: qty > 0 && unitNet < unitCogs
    };
  }

  /* ---------- L2 : order-direct cost heads -------------------------------- */
  function basisAmount(mode, rateVal, ctx) {
    switch (mode) {
      case 'cbm': return num(rateVal) * ctx.cbm;
      case 'kg': return num(rateVal) * ctx.weight;
      case 'unit': return num(rateVal) * ctx.qty;
      case 'pct': return rate(rateVal) * ctx.revenue;
      case 'lumpsum':
      default: return num(rateVal);
    }
  }

  /* ---------- main ------------------------------------------------------- */
  function compute(order) {
    var o = order || {};
    var L2 = o.l2 || {}, L3 = o.l3 || {}, L4 = o.l4 || {}, TX = o.tax || {}, RC = o.recovery || {};

    /* ---- L1 roll-up ---- */
    var lines = (o.lines || []).map(computeLine);
    var t = { gross: 0, disc: 0, net: 0, cogs: 0, qty: 0, cbm: 0, weight: 0, gst: 0, maxGst: 0 };
    lines.forEach(function (r) {
      t.gross += r.grossValue; t.disc += r.discountAmt; t.net += r.netRevenue;
      t.cogs += r.cogs; t.qty += r.qty; t.cbm += r.cbm; t.weight += r.weight;
      t.gst += r.gstAmt; t.maxGst = Math.max(t.maxGst, r.gstPct);
    });

    /* ---- revenue recoveries (billed to customer, so they ARE revenue) ---- */
    var recFreight = num(RC.freightBilled),
        recInstall = num(RC.installBilled),
        recPacking = num(RC.packingBilled),
        recOther = num(RC.otherBilled);
    var recovery = recFreight + recInstall + recPacking + recOther;

    // Net Sales Value, excl. GST — the single denominator for every margin %
    var NSV = t.net + recovery;
    var ctx = { cbm: t.cbm, weight: t.weight, qty: t.qty, revenue: NSV };

    /* ---- L1 result ---- */
    var grossProfit = NSV - t.cogs;

    /* ---- L2 heads ---- */
    var h2 = [];
    var push = function (arr, label, amt, ofRev) {
      if (Math.abs(amt) > 0.004) arr.push({ label: label, amount: amt, ofRevenue: !!ofRev });
    };
    var outFreight = basisAmount(L2.freightMode, L2.freightRate, ctx);
    var install = basisAmount(L2.installMode, L2.installRate, ctx);
    var insurance = rate(L2.insurancePct) * NSV;

    push(h2, 'Outward freight & transport', outFreight, L2.freightMode === 'pct');
    push(h2, 'Loading, unloading & handling', num(L2.handling));
    push(h2, 'Transit insurance', insurance, true);
    push(h2, 'Installation & assembly', install, L2.installMode === 'pct');
    push(h2, 'Site visits, travel & lodging', num(L2.travel));
    push(h2, 'Sample / prototype written off', num(L2.sampleCost));
    push(h2, 'Third-party inspection & BIS testing', num(L2.inspection));
    push(h2, 'Special / export packaging', num(L2.specialPacking));
    push(h2, 'Other direct order cost', num(L2.otherDirect));
    var totL2 = h2.reduce(function (s, x) { return s + x.amount; }, 0);
    var contribution = grossProfit - totL2;

    /* ---- L3 heads ---- */
    var invoiceValueForCredit = NSV * (1 + rate(t.maxGst));   // receivable actually blocked
    var creditDays = num(L3.creditDays);
    var iRate = rate(L3.interestPct);
    var creditCost = invoiceValueForCredit * iRate * div(creditDays, 365);
    var emdCost = num(L3.emdAmount) * iRate * div(num(L3.emdDays), 365);
    var pbgValue = rate(L3.pbgPct) * NSV;
    var pbgCost = pbgValue * rate(L3.pbgChargePct) * div(num(L3.pbgMonths), 12);

    var h3 = [];
    push(h3, 'Sales commission', rate(L3.commissionPct) * NSV, true);
    push(h3, 'Dealer / channel incentive', rate(L3.dealerIncentivePct) * NSV, true);
    push(h3, 'Cash / early-payment discount', rate(L3.cashDiscountPct) * NSV, true);
    push(h3, 'Working-capital cost (' + creditDays + ' days credit)', creditCost, true);
    push(h3, 'EMD blocked-fund cost', emdCost);
    push(h3, 'Performance bank guarantee', pbgCost, true);
    push(h3, 'Tender / portal / document fees', num(L3.tenderFees));
    push(h3, 'Marketplace transaction charge', rate(L3.gemChargePct) * NSV, true);
    push(h3, 'Liquidated damages provision', rate(L3.ldProvisionPct) * NSV, true);
    push(h3, 'Warranty & service provision', rate(L3.warrantyPct) * NSV, true);
    push(h3, 'Bad-debt provision', rate(L3.badDebtPct) * NSV, true);
    push(h3, 'Bank & payment charges', rate(L3.bankChargePct) * NSV, true);
    push(h3, 'Non-creditable GST (ITC leakage)', num(L3.itcLeakage));
    var totL3 = h3.reduce(function (s, x) { return s + x.amount; }, 0);
    var netContribution = contribution - totL3;

    /* ---- L4 heads ---- */
    var factoryOh = rate(L4.factoryOhPct) * t.cogs;
    var h4 = [];
    push(h4, 'Factory overhead absorbed', factoryOh);
    push(h4, 'Administration overhead', rate(L4.adminOhPct) * NSV, true);
    push(h4, 'Selling & marketing overhead', rate(L4.sellingOhPct) * NSV, true);
    push(h4, 'Depreciation allocated', num(L4.depreciation));
    var totL4 = h4.reduce(function (s, x) { return s + x.amount; }, 0);

    var actualGP = netContribution - totL4;
    var actualGPPct = div(actualGP, NSV) * 100;

    /* ---- L5 tax & cash realisation (never part of GP) ---- */
    var gstOnRecovery = recovery * rate(t.maxGst);
    var gstTotal = t.gst + gstOnRecovery;
    var invoiceValue = NSV + gstTotal;
    var gstTds = NSV * rate(TX.gstTdsPct);
    var incomeTds = NSV * rate(TX.tcsPct);
    var netCollection = invoiceValue - gstTds - incomeTds;

    /* ---- break-even & goal seek -------------------------------------------
       Actual GP = NSV*(1 - v) - F     where
       v = every head that scales with revenue,  F = every fixed head.
       Solve NSV for GP = 0  and for GP% = target.                            */
    var allHeads = h2.concat(h3, h4);
    var varAmt = allHeads.reduce(function (s, x) { return s + (x.ofRevenue ? x.amount : 0); }, 0);
    var fixAmt = allHeads.reduce(function (s, x) { return s + (x.ofRevenue ? 0 : x.amount); }, 0);
    var v = div(varAmt, NSV);                       // variable rate on revenue
    var F = t.cogs + fixAmt;                        // fixed pool incl. production cost
    var breakEvenNSV = (1 - v) > 0 ? div(F, 1 - v) : 0;

    function revenueForTarget(targetPct) {
      var tR = targetPct / 100, den = 1 - v - tR;
      return den > 0 ? div(F, den) : 0;
    }

    var targetPct = num(o.targetGpPct);
    var reqNSV = revenueForTarget(targetPct);
    var priceFactor = div(reqNSV, NSV);
    // discount % that still lands on target, holding list value constant
    var maxDiscForTarget = t.gross > 0 ? (1 - div(reqNSV - recovery, t.gross)) * 100 : 0;

    /* ---- validations ---- */
    var issues = [];
    var flag = function (sev, msg) { issues.push({ sev: sev, msg: msg }); };
    if (!(o.lines || []).length) flag('error', 'Add at least one product line before saving.');
    if (!(o.customer && o.customer.name)) flag('error', 'Customer name is required.');
    if (!(o.meta && o.meta.orderDate)) flag('error', 'Order date is required.');
    lines.forEach(function (r, i) {
      var src = o.lines[i] || {};
      if (r.qty <= 0) flag('error', 'Line ' + (i + 1) + ': quantity must be greater than zero.');
      if (r.unitNetPrice <= 0) flag('error', 'Line ' + (i + 1) + ': net selling price must be greater than zero.');
      if (num(src.discPct) < 0 || num(src.discPct) > 100) flag('error', 'Line ' + (i + 1) + ': discount must sit between 0 and 100.');
      if (r.belowCost) flag('error', 'Line ' + (i + 1) + ' (' + (src.description || 'item') + ') sells below its own production cost.');
      else if (r.gpPct < 8 && r.qty > 0) flag('warn', 'Line ' + (i + 1) + ' carries only ' + r.gpPct.toFixed(1) + '% margin before order costs.');
      if (r.unitCogs === 0 && r.qty > 0) flag('warn', 'Line ' + (i + 1) + ' has no costing entered — margin is overstated.');
    });
    if (L2.freightMode === 'cbm' && t.cbm === 0) flag('warn', 'Freight is rated per CBM but no volume is entered on any line.');
    if (L2.freightMode === 'kg' && t.weight === 0) flag('warn', 'Freight is rated per kg but no weight is entered on any line.');
    if (creditDays > 90) flag('warn', creditDays + ' days of credit is blocking ' + Math.round(creditCost) + ' of working capital.');
    if (outFreight > 0 && recFreight === 0 && NSV > 0) flag('info', 'Freight is being absorbed in full — nothing is billed back to the customer.');
    if (totL4 === 0 && NSV > 0) flag('info', 'No overhead is absorbed, so this reads as contribution rather than true GP.');
    if (actualGPPct < 0) flag('error', 'This order loses money after all costs.');

    /* ---- approval slab ---- */
    var slabs = o.approvalMatrix || root.GPEngine.defaultApprovalMatrix;
    var verdict = slabs[slabs.length - 1];
    for (var i = 0; i < slabs.length; i++) {
      if (actualGPPct >= slabs[i].minPct) { verdict = slabs[i]; break; }
    }

    return {
      lines: lines,
      totals: {
        grossValue: t.gross, totalDiscount: t.disc, discountPct: div(t.disc, t.gross) * 100,
        productRevenue: t.net, recovery: recovery,
        recFreight: recFreight, recInstall: recInstall, recPacking: recPacking, recOther: recOther,
        nsv: NSV, qty: t.qty, cbm: t.cbm, weight: t.weight,
        cogs: t.cogs, cogsPct: div(t.cogs, NSV) * 100,
        grossProfit: grossProfit, grossProfitPct: div(grossProfit, NSV) * 100,
        totL2: totL2, contribution: contribution, contributionPct: div(contribution, NSV) * 100,
        totL3: totL3, netContribution: netContribution, netContributionPct: div(netContribution, NSV) * 100,
        totL4: totL4, actualGP: actualGP, actualGPPct: actualGPPct,
        gpPerUnit: div(actualGP, t.qty),
        totalCost: t.cogs + totL2 + totL3 + totL4,
        gstTotal: gstTotal, invoiceValue: invoiceValue,
        gstTds: gstTds, incomeTds: incomeTds, netCollection: netCollection,
        pbgValue: pbgValue, creditCost: creditCost
      },
      heads: { l2: h2, l3: h3, l4: h4 },
      solver: {
        variableRate: v * 100, fixedPool: F,
        breakEvenNSV: breakEvenNSV,
        breakEvenPct: div(breakEvenNSV, NSV) * 100,
        targetPct: targetPct, requiredNSV: reqNSV,
        priceFactor: priceFactor,
        priceGapPct: (priceFactor - 1) * 100,
        maxDiscountForTarget: maxDiscForTarget
      },
      issues: issues,
      verdict: verdict,
      valid: !issues.some(function (x) { return x.sev === 'error'; })
    };
  }

  /* ---- sensitivity: re-run with a shocked copy of the order -------------- */
  function sensitivity(order, shocks) {
    var clone = JSON.parse(JSON.stringify(order));
    clone.lines = (clone.lines || []).map(function (l) {
      l.discPct = num(l.discPct) + num(shocks.discountPts);
      var f = 1 + rate(shocks.materialPct);
      ['cArmrest', 'cSeatMech', 'cBase', 'cWheels'].forEach(function (k) { l[k] = num(l[k]) * f; });
      return l;
    });
    clone.l2 = clone.l2 || {};
    clone.l2.freightRate = num(clone.l2.freightRate) * (1 + rate(shocks.freightPct));
    return compute(clone);
  }

  root.GPEngine = {
    compute: compute,
    computeLine: computeLine,
    sensitivity: sensitivity,
    round: r2,
    defaultApprovalMatrix: [
      { minPct: 25, level: 'Auto-approved', who: 'No sign-off needed', tone: 'good' },
      { minPct: 18, level: 'Level 1', who: 'Sales Manager', tone: 'good' },
      { minPct: 12, level: 'Level 2', who: 'General Manager', tone: 'watch' },
      { minPct: 6, level: 'Level 3', who: 'Director', tone: 'watch' },
      { minPct: -1e9, level: 'Blocked', who: 'Proprietor approval only', tone: 'risk' }
    ]
  };
})(typeof window !== 'undefined' ? window : globalThis);
