/**
 * INFORMATICS ANALYTICS -- ADVANCED (v1.2.0, 11-11-2026)
 * ----------------------------------------------------------------------------
 * Place this file AFTER CodeGs_AiCore.gs and CodeGs_AiGemini.gs (bottom of the list).
 *
 * WHAT IT ADDS (all read-only on CRM data)
 *   Phase 1  lead score, daily action list per salesperson, duplicate leads,
 *            assignment suggestions for unassigned leads
 *   Phase 2  quotation win estimate, margin flags, loss-reason breakdown,
 *            AI message drafts (follow-up / payment reminder / order update)
 *   Phase 3  dispatch lead-time by product type, delay prediction, delay
 *            root-cause, collection priority list + ageing
 *   Phase 4  Meta campaign / ad results, cost per lead / order (from the
 *            monthly ad spend typed in Settings), customer value, repeat-due,
 *            dormant customers, cross-sell pairs
 *   Phase 5  anomaly alerts, coaching notes, weekly AI business review
 *   Extra    automatic customer e-mail on order status change (OFF by default;
 *            Settings > Customer e-mail). Only customers with a saved e-mail.
 *
 * RULES
 *   - Never writes to any CRM tab. Never changes a status / follow-up.
 *   - Drafts are text only; a person copies / sends them.
 *   - Customer e-mail: one mail per order per status, logged in AI_Email_Log,
 *     existing orders are baselined (not mailed) when the switch is turned on.
 */
var AI_ADV_VER = '1.2.0';
try{ AI_TABS.AI_Email_Log = ['ts','orderId','status','to','result','detail']; }catch(e){}

/* ---------------------------------------------------------------- helpers */
function ai_median_(a){ if(!a.length) return 0; var s = a.slice().sort(function(x, y){ return x - y; }), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function ai_round1_(n){ return Math.round(n * 10) / 10; }
function ai_parseSpend_(str){
  /* "Meta=50000, IndiaMART=12000" -> { Meta: 50000, IndiaMART: 12000 } (monthly) */
  var out = {}; String(str || '').split(/[;\n]+|,(?=\s*[A-Za-z])/).forEach(function(p){ var m = p.split(/[=:]/); if(m.length >= 2){ var k = ai_s_(m[0]), v = ai_num_(String(m[1]).replace(/[^0-9.]/g, '')); if(k && v > 0) out[k.toLowerCase()] = v; } });
  return out;
}
var AI_LOSS_RULES = [
  ['Price / budget', /\b(price|pricing|rate|costly|expensive|budget|mehng|mahang|high cost|discount|cheaper|sasta)\b/i],
  ['Bought elsewhere / competitor', /\b(already (purchased|bought|taken|ordered)|purchased from|other vendor|another vendor|competitor|local (vendor|market|shop)|le liya|kharid liya|order de diya)\b/i],
  ['No response', /\b(not respond|no response|not responding|no reply|call not pick|not pick|did ?n.t pick|switch(ed)? off|not reachable|ringing|busy|cut the call|phone nahi|nahi utha)\b/i],
  ['Not required / not interested', /\b(not interested|no requirement|not required|no need|nahi chahiye|not looking|cancel(led)? (plan|requirement)|postpone|later|future)\b/i],
  ['Wrong / irrelevant lead', /\b(wrong number|by mistake|mistake|job|student|vacancy|dealer ?ship|supplier|service enquiry|repair|spam|fake|irrelevant|not concern|invalid)\b/i],
  ['Location / delivery', /\b(location|far|out of (area|station|city)|delivery (time|issue|charge)|transport|freight|not serviceable|different city)\b/i],
  ['Small quantity / retail', /\b(single (piece|pc|chair|table)|one piece|1 (pc|piece|chair|table)|retail|small quantity|low quantity|home use|personal use)\b/i],
  ['Product not available', /\b(not available|don.t (make|deal|have)|not deal|not manufactur|out of stock|customi[sz]|design not)\b/i]
];
function ai_lossReason_(text){
  var t = ai_s_(text); if(t.length < 3) return 'No remark written';
  for(var i = 0; i < AI_LOSS_RULES.length; i++){ if(AI_LOSS_RULES[i][1].test(t)) return AI_LOSS_RULES[i][0]; }
  return 'Other / unclear';
}

/* ====================================================================== *
 * BUILD (pure) -- called from ai_refresh_ ; result is dashboard.adv       *
 * ====================================================================== */
function ai_adv_build_(B, D, S, nowMs){
  var today = ai_day_(nowMs), month = today.slice(0, 7), DAY = AI_DAY_MS, i;
  var leads = B.leads || [], quotes = B.quotes || [], orders = B.orders || [];
  var rawOrder = {}, rawMeta = {}, rawQuote = {};
  (D.orders || []).forEach(function(o){ if(o && o.id) rawOrder[String(o.id)] = o; });
  (D.metaLeads || []).forEach(function(m){ if(m && m.id) rawMeta[String(m.id)] = m; });
  (D.quotations || []).forEach(function(q){ if(q && q.id) rawQuote[String(q.id)] = q; });
  var liveOrder = function(o){ return o.status !== 'Cancelled'; };
  var gst = 1 + ai_num_(S.gstPct) / 100, bill = function(a){ return Math.round(ai_num_(a) * gst); };

  /* ---------------- Phase 1: lead score ---------------- */
  var srcStat = {}, spSrc = {}, spOpen = {};
  leads.forEach(function(l){
    var s = srcStat[l.source] = srcStat[l.source] || { n: 0, won: 0 }; s.n++; if(l.category === 'Converted') s.won++;
    if(l.owner){ var k = l.ownerName + '|' + l.source, x = spSrc[k] = spSrc[k] || { n: 0, won: 0 }; x.n++; if(l.category === 'Converted') x.won++; if(l.open) spOpen[l.ownerName] = (spOpen[l.ownerName] || 0) + 1; }
  });
  var bestSrcRate = 0, src; for(src in srcStat){ if(srcStat[src].n >= 20) bestSrcRate = Math.max(bestSrcRate, srcStat[src].won / srcStat[src].n); }
  var ST = { QUOTATION_SENT: 38, SYSTEM_MASTER: 34, QUALIFIED: 30, FOLLOW_UP: 20, CONTACTED: 15, CREATED: 12, CALL_NOT_PICK: 6 };
  function score(l){
    var s = ST[l.status] || 0, why = [];
    var sr = srcStat[l.source]; if(sr && sr.n >= 20 && bestSrcRate > 0){ s += Math.round(12 * (sr.won / sr.n) / bestSrcRate); }
    if(l.qty >= 50){ s += 15; why.push('qty ' + l.qty); } else if(l.qty >= 10){ s += 10; why.push('qty ' + l.qty); } else if(l.qty > 0) s += 4;
    if(l.daysIdle <= 1) s += 12; else if(l.daysIdle <= 3) s += 8; else if(l.daysIdle <= 7) s += 4; else if(l.daysIdle > 21) s -= 8;
    if(l.category === 'Follow-up Overdue'){ s += 12; why.push('follow-up overdue'); } else if(l.category === 'Follow-up Due Today'){ s += 12; why.push('follow-up due today'); }
    if(l.status === 'CREATED' && l.created && nowMs - l.created < DAY){ s += 14; why.push('new today'); }
    if(l.category === 'Untouched'){ s += 8; why.push('never contacted'); }
    if(l.aiIntent === 'Hot'){ s += 18; why.push('AI: hot'); } else if(l.aiIntent === 'Warm') s += 7; else if(l.aiIntent === 'Cold') s -= 10;
    if(l.status === 'QUOTATION_SENT' || l.status === 'QUALIFIED' || l.status === 'SYSTEM_MASTER') why.unshift((AI_STATUS_LABEL[l.status] || l.status).toLowerCase());
    return { s: Math.max(0, Math.min(100, s)), why: why.slice(0, 3).join(', ') };
  }
  function nextStep(l){
    if(l.aiNext) return l.aiNext;
    if(l.category === 'Untouched' || (l.status === 'CREATED')) return 'Make the first call and note the requirement';
    if(l.category === 'Follow-up Overdue') return 'Follow-up was due ' + l.followUp + ' -- call now and set the next date';
    if(l.category === 'Follow-up Due Today') return 'Follow-up is due today -- call and update the status';
    if(l.status === 'QUOTATION_SENT') return 'Ask for feedback on the quotation and close';
    if(l.status === 'QUALIFIED' || l.status === 'SYSTEM_MASTER') return 'Send the quotation';
    if(l.status === 'CALL_NOT_PICK') return 'Try again at a different time or send a WhatsApp';
    if(!l.followUp) return 'Call and set a follow-up date';
    return 'Call and update the status';
  }
  var scored = [], bySales = {}, unassigned = [];
  leads.forEach(function(l){
    if(!l.open) return;
    var sc = score(l); l.score = sc.s;
    var row = { id: l.id, coll: l.coll, name: l.name, source: l.source, owner: l.ownerName, status: AI_STATUS_LABEL[l.status] || l.status, category: l.category, score: sc.s, why: sc.why || l.reason, next: nextStep(l), idle: l.daysIdle, qty: l.qty, city: l.city, followUp: l.followUp };
    scored.push(row);
    if(l.owner){ (bySales[l.ownerName] = bySales[l.ownerName] || []).push(row); } else unassigned.push(row);
  });
  var byScore = function(a, b){ return b.score - a.score; };
  scored.sort(byScore);
  var actions = { bySales: {}, counts: {}, top: scored.slice(0, 40), scoreBands: { high: 0, mid: 0, low: 0 } };
  scored.forEach(function(r){ if(r.score >= 60) actions.scoreBands.high++; else if(r.score >= 35) actions.scoreBands.mid++; else actions.scoreBands.low++; });
  for(var nm in bySales){ if(bySales.hasOwnProperty(nm)){ bySales[nm].sort(byScore); actions.counts[nm] = bySales[nm].length; actions.bySales[nm] = bySales[nm].slice(0, 12); } }

  /* duplicates (same phone, 2+ leads) */
  var byPhone = {}, dupList = [];
  leads.forEach(function(l){ if(l.phone) (byPhone[l.phone] = byPhone[l.phone] || []).push(l); });
  var dupGroups = 0, dupLeads = 0, dupCross = 0;
  for(var ph in byPhone){ if(byPhone.hasOwnProperty(ph) && byPhone[ph].length > 1){
    var g = byPhone[ph], openN = 0, owners = {}, srcs = {};
    g.forEach(function(l){ if(l.open) openN++; if(l.owner && l.open) owners[l.ownerName] = 1; srcs[l.source] = 1; });
    dupGroups++; dupLeads += g.length;
    var cross = Object.keys(owners).length > 1; if(cross) dupCross++;
    if(openN >= 1) dupList.push({ phoneEnd: ph.slice(-4), name: g[0].name, n: g.length, open: openN, ids: g.map(function(l){ return l.id; }).slice(0, 6), sources: Object.keys(srcs), owners: Object.keys(owners), cross: cross });
  } }
  dupList.sort(function(a, b){ return (b.cross ? 1 : 0) - (a.cross ? 1 : 0) || b.open - a.open || b.n - a.n; });
  var dupes = { groups: dupGroups, leads: dupLeads, crossOwner: dupCross, list: dupList.slice(0, 40) };

  /* assignment suggestion for unassigned open leads */
  var people = Object.keys(spOpen), avgLoad = people.length ? people.reduce(function(s, p){ return s + spOpen[p]; }, 0) / people.length : 0;
  function suggest(l){
    var best = null;
    people.forEach(function(p){
      var x = spSrc[p + '|' + l.source]; if(!x || x.n < 15) return;
      var rate = x.won / x.n, load = spOpen[p] || 0, val = rate * (avgLoad ? Math.min(1.3, Math.max(0.6, avgLoad / Math.max(1, load))) : 1);
      if(!best || val > best.val) best = { p: p, val: val, rate: rate, load: load, n: x.n };
    });
    if(!best){ var low = null; people.forEach(function(p){ if(!low || spOpen[p] < spOpen[low]) low = p; }); return low ? { to: low, why: 'Lowest open load (' + spOpen[low] + ' open leads)' } : null; }
    return { to: best.p, why: ai_round1_(best.rate * 100) + '% conversion on ' + l.source + ' (' + best.n + ' leads), ' + best.load + ' open now' };
  }
  unassigned.sort(byScore);
  var assign = { unassigned: unassigned.length, list: unassigned.slice(0, 30).map(function(r){ var l = { source: r.source }, sg = suggest(l); return { id: r.id, name: r.name, source: r.source, score: r.score, status: r.status, to: sg ? sg.to : '', why: sg ? sg.why : 'Not enough history to suggest' }; }) };

  /* ---------------- Phase 2: quotations ---------------- */
  var bands = [[0, 25000, 'Up to 25k'], [25000, 100000, '25k - 1L'], [100000, 500000, '1L - 5L'], [500000, 1e12, 'Above 5L']];
  function band(a){ for(var b = 0; b < bands.length; b++){ if(a >= bands[b][0] && a < bands[b][1]) return b; } return 0; }
  var bandStat = bands.map(function(){ return { n: 0, won: 0 }; }), allQ = { n: 0, won: 0 };
  quotes.forEach(function(q){ if(q.status === 'Draft') return; var age = q.daysIdle; if(q.category !== 'Converted' && age < 30 && q.category !== 'Expired' && q.category !== 'Rejected') return; /* only settled ones */
    var b = bandStat[band(q.amount)]; b.n++; allQ.n++; if(q.category === 'Converted'){ b.won++; allQ.won++; } });
  var baseAll = allQ.n >= 10 ? allQ.won / allQ.n : 0.3;
  var minGp = ai_num_(S.minGpPct), openQ = [], marginFlags = 0, quoteLoss = {};
  quotes.forEach(function(q){
    var raw = rawQuote[q.id] || {}, gp = (raw.gpPct === undefined || raw.gpPct === null || raw.gpPct === '') ? null : ai_num_(raw.gpPct), disc = ai_num_(raw.discount);
    var costed = !(raw.gp && raw.gp.costedLines === 0) && gp !== null && gp < 99.5;
    if(q.category === 'Expired' || q.category === 'Rejected'){ var rr = 'No remark written'; quoteLoss[rr] = (quoteLoss[rr] || 0) + 1; }
    if(!q.open || q.category === 'Draft') return;
    var b = bandStat[band(q.amount)], base = b.n >= 8 ? b.won / b.n : baseAll, age = q.daysIdle;
    var f = age <= 3 ? 1.2 : age <= 7 ? 1 : age <= 15 ? 0.7 : age <= 30 ? 0.4 : 0.15, why = [];
    why.push(age + ' day(s) old'); if(b.n >= 8) why.push(ai_round1_(base * 100) + '% of ' + bands[band(q.amount)][2] + ' quotes convert');
    if(q.valid && q.valid < today){ f *= 0.3; why.push('validity over'); }
    var win = Math.max(1, Math.min(95, Math.round(base * f * 100)));
    var flag = '';
    if(costed && gp < minGp){ flag = 'Low margin (' + ai_round1_(gp) + '%)'; marginFlags++; }
    else if(disc >= 15 && win < 25){ flag = 'High discount (' + disc + '%) but low win chance'; marginFlags++; }
    openQ.push({ id: q.id, qno: q.qno, name: q.name, owner: q.ownerName, amount: q.amount, age: age, win: win, why: why.join(', '), gpPct: costed ? ai_round1_(gp) : null, discount: disc, flag: flag, valid: q.valid, expected: Math.round(q.amount * win / 100) });
  });
  openQ.sort(function(a, b){ return b.expected - a.expected; });
  var lossLeads = {}, lossN = 0;
  leads.forEach(function(l){ if(l.status !== 'LOST' && l.status !== 'NOT_QUALIFIED') return; var r = ai_lossReason_(l.remarks); lossLeads[r] = (lossLeads[r] || 0) + 1; lossN++; });
  var lossBySource = {};
  leads.forEach(function(l){ if(l.status !== 'LOST' && l.status !== 'NOT_QUALIFIED') return; var r = ai_lossReason_(l.remarks), m = lossBySource[l.source] = lossBySource[l.source] || {}; m[r] = (m[r] || 0) + 1; });
  var quoteAdv = { open: openQ.slice(0, 50), openCount: openQ.length, pipeline: openQ.reduce(function(s, q){ return s + q.amount; }, 0), weighted: openQ.reduce(function(s, q){ return s + q.expected; }, 0),
    marginFlags: marginFlags, minGpPct: minGp, baseRate: ai_round1_(baseAll * 100), settled: allQ.n,
    bands: bands.map(function(b, ix){ return { band: b[2], n: bandStat[ix].n, won: bandStat[ix].won, pct: bandStat[ix].n ? ai_round1_(bandStat[ix].won / bandStat[ix].n * 100) : null }; }),
    lossReasons: lossLeads, lossTotal: lossN, lossBySource: lossBySource };

  /* ---------------- Phase 3: operations + collections ---------------- */
  var lt = {}, ltAll = [];
  orders.forEach(function(o){
    var r = rawOrder[o.id] || {}, d = o.disp, done = d ? ai_ms_(d.dispatchedOn) : 0; if(!done || !o.created || !liveOrder(o)) return;
    var days = Math.round((done - o.created) / DAY); if(days < 0 || days > 200) return;
    var t = ai_s_(r.productType) || 'Unknown', x = lt[t] = lt[t] || { act: [], prom: [], late: 0 };
    x.act.push(days); ltAll.push(days);
    var pm = ai_ms_(o.exp); if(pm){ x.prom.push(Math.round((pm - o.created) / DAY)); if(done > pm + DAY) x.late++; }
  });
  var leadTime = [], ltMap = {};
  for(var tp in lt){ if(lt.hasOwnProperty(tp)){ var a = lt[tp].act, sorted = a.slice().sort(function(x, y){ return x - y; }), p75 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.75))];
    ltMap[tp] = { med: ai_median_(a), p75: p75, n: a.length };
    leadTime.push({ type: tp, n: a.length, median: ai_round1_(ai_median_(a)), p75: p75, promised: lt[tp].prom.length ? ai_round1_(ai_median_(lt[tp].prom)) : null, latePct: lt[tp].prom.length ? ai_round1_(lt[tp].late / lt[tp].prom.length * 100) : null }); } }
  leadTime.sort(function(a, b){ return b.n - a.n; });
  var allMed = ai_median_(ltAll), risk = [], delayedBy = { type: {}, sales: {}, status: {} }, trackGaps = 0;
  orders.forEach(function(o){
    var r = rawOrder[o.id] || {}, t = ai_s_(r.productType) || 'Unknown';
    if(o.trackPending && o.status === 'Dispatched') trackGaps++;
    if(o.category === 'Delayed'){ delayedBy.type[t] = (delayedBy.type[t] || 0) + 1; delayedBy.sales[o.ownerName] = (delayedBy.sales[o.ownerName] || 0) + 1; delayedBy.status[o.status] = (delayedBy.status[o.status] || 0) + 1; }
    if(!o.open || o.status === 'Dispatched' || o.category === 'Delayed' || !o.exp || !o.created) return;
    var m = (ltMap[t] && ltMap[t].n >= 5) ? ltMap[t] : (ltAll.length >= 8 ? { med: allMed, p75: allMed, n: ltAll.length } : null); if(!m) return;
    var pred = o.created + m.p75 * DAY, exp = ai_ms_(o.exp), lateBy = Math.round((Math.max(pred, nowMs) - exp) / DAY);
    if(lateBy >= 1 && o.status !== 'Ready') risk.push({ id: o.id, name: o.name, owner: o.ownerName, status: o.status, type: t, exp: o.exp, predicted: ai_day_(Math.max(pred, nowMs)), lateBy: lateBy, amount: o.amount, basis: t + ' orders usually take ' + m.p75 + ' days (' + m.n + ' past orders)' });
  });
  risk.sort(function(a, b){ return b.lateBy - a.lateBy || b.amount - a.amount; });
  var ops = { leadTime: leadTime, overallMedian: ai_round1_(allMed), measured: ltAll.length, risk: risk.slice(0, 40), riskCount: risk.length, delayedBy: delayedBy, trackingGaps: trackGaps };

  var pend = [], age = { '0-7 days': 0, '8-15 days': 0, '16-30 days': 0, '30+ days': 0 }, ageVal = { '0-7 days': 0, '8-15 days': 0, '16-30 days': 0, '30+ days': 0 }, pendTotal = 0, byCustPend = {};
  orders.forEach(function(o){
    if(!liveOrder(o) || !o.payment || o.payment === 'Paid') return;
    if(o.status !== 'Delivered' && o.status !== 'Dispatched') return;
    var d = o.disp, since = d ? (ai_ms_(d.dispatchedOn) || o.last) : o.last, days = ai_daysBetween_(since, nowMs), amt = bill(o.amount);
    var bk = days <= 7 ? '0-7 days' : days <= 15 ? '8-15 days' : days <= 30 ? '16-30 days' : '30+ days'; age[bk]++; ageVal[bk] += amt; pendTotal += amt;
    byCustPend[o.name] = (byCustPend[o.name] || 0) + amt;
    pend.push({ id: o.id, name: o.name, owner: o.ownerName, status: o.status, payment: o.payment, amount: amt, days: days, pr: Math.round(Math.min(60, days * 2) + Math.min(40, amt / 5000)) });
  });
  pend.sort(function(a, b){ return b.pr - a.pr || b.amount - a.amount; });
  var topCustPend = Object.keys(byCustPend).map(function(k){ return { name: k, amount: byCustPend[k] }; }).sort(function(a, b){ return b.amount - a.amount; }).slice(0, 10);
  var collections = { list: pend.slice(0, 50), count: pend.length, total: pendTotal, ageing: age, ageingValue: ageVal, topCustomers: topCustPend };

  /* ---------------- Phase 4: campaigns, spend, customers ---------------- */
  var camp = {}, ads = {};
  leads.forEach(function(l){
    if(l.coll !== 'metaLeads' || l.source === 'GEM') return;
    var r = rawMeta[l.id] || {}, c = ai_s_(r.campaign_name) || '(no campaign)', a = ai_s_(r.ad_name) || '(no ad name)';
    [[camp, c], [ads, a]].forEach(function(pair){
      var x = pair[0][pair[1]] = pair[0][pair[1]] || { name: pair[1], leads: 0, d30: 0, contacted: 0, qualified: 0, won: 0, lost: 0, revenue: 0 };
      x.leads++; if(l.created >= nowMs - 30 * DAY) x.d30++;
      if(l.status !== 'CREATED') x.contacted++;
      if(l.status === 'QUALIFIED' || l.status === 'SYSTEM_MASTER' || l.status === 'QUOTATION_SENT' || l.category === 'Converted') x.qualified++;
      if(l.category === 'Converted') x.won++; if(l.status === 'LOST' || l.status === 'NOT_QUALIFIED') x.lost++;
      x.revenue += l.revenue || 0;
    });
  });
  function fin(m, n){ return Object.keys(m).map(function(k){ var x = m[k]; x.qualPct = ai_pct_(x.qualified, x.leads); x.convPct = ai_pct_(x.won, x.leads); x.lostPct = ai_pct_(x.lost, x.leads); return x; }).sort(function(a, b){ return b.leads - a.leads; }).slice(0, n); }
  var spend = ai_parseSpend_(S.adSpend), roi = [], monthStart = ai_ms_(month + '-01');
  (B.dashboard.bySource.month || []).forEach(function(g){
    var sp = spend[String(g.key).toLowerCase()]; if(!sp) return;
    var rev = 0; orders.forEach(function(o){ if(liveOrder(o) && o.source === g.key && o.created >= monthStart) rev += bill(o.amount); });
    roi.push({ source: g.key, spend: sp, leads: g.leads, qualified: g.qualified, orders: g.won, cpl: g.leads ? Math.round(sp / g.leads) : null, cpq: g.qualified ? Math.round(sp / g.qualified) : null, cpo: g.won ? Math.round(sp / g.won) : null, billing: rev, roas: sp ? ai_round1_(rev / sp) : null });
  });
  var marketing = { campaigns: fin(camp, 30), ads: fin(ads, 25), roi: roi, spendSet: Object.keys(spend).length > 0 };

  var cust = {}, pairCount = {};
  orders.forEach(function(o){
    if(!liveOrder(o)) return; var key = o.custId || ('name:' + o.nameKey); if(!key || key === 'name:') return;
    var r = rawOrder[o.id] || {}, c = cust[key] = cust[key] || { name: o.name, orders: 0, billing: 0, gp: 0, dates: [], cats: {}, owner: o.ownerName };
    c.orders++; c.billing += bill(o.amount); c.gp += ai_num_(r.gpAmount); if(o.created) c.dates.push(o.created);
    (r.items || []).forEach(function(it){ var ct = ai_s_(it && it.category); if(ct) c.cats[ct] = 1; });
  });
  var custList = [], repeatDue = [], dormant = [], repeatN = 0;
  for(var ck in cust){ if(cust.hasOwnProperty(ck)){
    var c = cust[ck]; c.dates.sort(function(a, b){ return a - b; });
    var last = c.dates.length ? c.dates[c.dates.length - 1] : 0, since = last ? ai_daysBetween_(last, nowMs) : 0, gap = 0;
    if(c.dates.length >= 2){ repeatN++; gap = Math.round((last - c.dates[0]) / DAY / (c.dates.length - 1)); }
    var cats = Object.keys(c.cats);
    for(var a1 = 0; a1 < cats.length; a1++) for(var b1 = a1 + 1; b1 < cats.length; b1++){ var pk = [cats[a1], cats[b1]].sort().join(' + '); pairCount[pk] = (pairCount[pk] || 0) + 1; }
    var row = { name: c.name, owner: c.owner, orders: c.orders, billing: c.billing, gp: Math.round(c.gp), last: last ? ai_day_(last) : '', since: since, gap: gap, cats: cats.slice(0, 4) };
    custList.push(row);
    if(c.orders >= 2 && gap >= 3 && since > gap * 1.2 && since <= 365) repeatDue.push(row);
    if(since >= 60 && c.billing >= 50000) dormant.push(row);
  } }
  custList.sort(function(a, b){ return b.billing - a.billing; });
  repeatDue.sort(function(a, b){ return b.billing - a.billing; }); dormant.sort(function(a, b){ return b.billing - a.billing; });
  var totalBill = custList.reduce(function(s, c){ return s + c.billing; }, 0), run = 0, top20 = 0;
  custList.forEach(function(c, ix){ if(ix < Math.ceil(custList.length * 0.2)) top20 += c.billing; });
  var pairs = Object.keys(pairCount).map(function(k){ return { pair: k, customers: pairCount[k] }; }).filter(function(p){ return p.customers >= 2; }).sort(function(a, b){ return b.customers - a.customers; }).slice(0, 12);
  var customers = { count: custList.length, repeat: repeatN, repeatPct: ai_pct_(repeatN, custList.length), top: custList.slice(0, 20), top20SharePct: ai_pct_(top20, totalBill), repeatDue: repeatDue.slice(0, 20), dormant: dormant.slice(0, 20), crossSell: pairs };

  /* ---------------- Phase 5: anomalies + coaching ---------------- */
  var anomalies = [], weeks = B.dashboard.weeks || [];
  if(weeks.length >= 6){
    var lastFull = weeks[weeks.length - 2], prev = weeks.slice(weeks.length - 6, weeks.length - 2), srcSet = {};
    prev.concat([lastFull]).forEach(function(w){ Object.keys(w.bySource).forEach(function(s){ srcSet[s] = 1; }); });
    Object.keys(srcSet).forEach(function(s){
      var avg = prev.reduce(function(t, w){ return t + (w.bySource[s] || 0); }, 0) / prev.length, cur = lastFull.bySource[s] || 0;
      if(avg >= 8 && cur < avg * 0.6) anomalies.push({ sev: 'high', type: 'Lead drop', title: s + ' leads fell to ' + cur + ' last week (4-week average ' + Math.round(avg) + ')' });
      else if(avg >= 8 && cur > avg * 1.6) anomalies.push({ sev: 'low', type: 'Lead spike', title: s + ' leads jumped to ' + cur + ' last week (4-week average ' + Math.round(avg) + ')' });
    });
  }
  var resp = {}, teamResp = [], sp;
  leads.forEach(function(l){ if(l.respMins === null || l.respMins < 0 || !l.owner) return; var x = resp[l.ownerName] = resp[l.ownerName] || { recent: [], older: [] };
    if(l.created >= nowMs - 7 * DAY) x.recent.push(l.respMins); else if(l.created >= nowMs - 37 * DAY) x.older.push(l.respMins); teamResp.push(l.respMins); });
  for(sp in resp){ if(resp.hasOwnProperty(sp)){ var rc = resp[sp].recent, od = resp[sp].older; if(rc.length >= 5 && od.length >= 5){ var mr = ai_median_(rc), mo = ai_median_(od); if(mr > mo * 1.5 && mr - mo >= 10) anomalies.push({ sev: 'medium', type: 'Slower response', title: sp + ': median first response ' + Math.round(mr) + ' min this week vs ' + Math.round(mo) + ' min before' }); } } }
  quotes.forEach(function(q){ var raw = rawQuote[q.id] || {}, dsc = ai_num_(raw.discount); if(q.open && dsc >= 20 && q.created >= nowMs - 14 * DAY) anomalies.push({ sev: 'medium', type: 'High discount', title: 'Quotation ' + (q.qno || q.id) + ' for ' + q.name + ' has ' + dsc + '% discount (' + q.ownerName + ')' }); });
  if(dupCross) anomalies.push({ sev: 'medium', type: 'Duplicate leads', title: dupCross + ' buyer(s) are being handled by two different salespeople at once' });
  if(trackGaps) anomalies.push({ sev: 'low', type: 'Tracking missing', title: trackGaps + ' dispatched order(s) have no real courier / tracking number' });
  var SEVN = { high: 3, medium: 2, low: 1 }; anomalies.sort(function(a, b){ return SEVN[b.sev] - SEVN[a.sev]; }); anomalies = anomalies.slice(0, 25);

  var team = (B.dashboard.bySales.all || []).filter(function(g){ return g.key !== 'Unassigned' && g.leads >= 15; }), coaching = [];
  var tLeads = 0, tWon = 0; team.forEach(function(g){ tLeads += g.leads; tWon += g.won; });
  var teamConv = tLeads ? tWon / tLeads * 100 : 0, teamMedResp = ai_median_(teamResp);
  var noFu = {}; leads.forEach(function(l){ if(l.open && l.owner && l.status !== 'CREATED'){ var x = noFu[l.ownerName] = noFu[l.ownerName] || { n: 0, miss: 0 }; x.n++; if(!l.followUp) x.miss++; } });
  var qFollow = {}; quotes.forEach(function(q){ if(q.category === 'Follow-up Needed') qFollow[q.ownerName] = (qFollow[q.ownerName] || 0) + 1; });
  team.forEach(function(g){
    var pts = [], good = [];
    if(g.untouched >= 5) pts.push(g.untouched + ' new leads never contacted -- first call within the day is the biggest win');
    if(g.overdue >= 5) pts.push(g.overdue + ' follow-ups are overdue');
    var nf = noFu[g.key]; if(nf && nf.n >= 10 && nf.miss / nf.n >= 0.5) pts.push(Math.round(nf.miss / nf.n * 100) + '% of open contacted leads have no follow-up date');
    if(g.inactive >= 20 && g.open && g.inactive / g.open >= 0.5) pts.push(Math.round(g.inactive / g.open * 100) + '% of open leads are inactive (' + g.inactive + ')');
    if(g.avgResp !== null && teamMedResp && g.avgResp > Math.max(30, teamMedResp * 2)) pts.push('Average first response ' + g.avgResp + ' min (team median ' + Math.round(teamMedResp) + ' min)');
    if(qFollow[g.key] >= 3) pts.push(qFollow[g.key] + ' quotations are waiting for a follow-up');
    if(g.delayed >= 5) pts.push(g.delayed + ' orders are past the expected date -- update status or inform the customer');
    if(teamConv && g.convPct < teamConv * 0.5 && g.leads >= 50) pts.push('Lead-to-order ' + g.convPct + '% vs team ' + ai_round1_(teamConv) + '%');
    if(teamConv && g.convPct > teamConv * 1.3 && g.leads >= 50) good.push('Lead-to-order ' + g.convPct + '% is above the team (' + ai_round1_(teamConv) + '%)');
    if(g.avgResp !== null && teamMedResp && g.avgResp <= teamMedResp) good.push('Fast first response (' + g.avgResp + ' min)');
    coaching.push({ name: g.key, leads: g.leads, open: g.open, convPct: g.convPct, points: pts.slice(0, 5), good: good.slice(0, 2) });
  });
  coaching.sort(function(a, b){ return b.points.length - a.points.length || b.open - a.open; });

  /* data-quality score card (what limits accuracy) */
  var ls = B.dashboard.linkStats || {}, liveN = (ls.explicit || 0) + (ls.phone || 0) + (ls.customer || 0) + (ls.none || 0);
  var emRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/, custEmail = 0; (D.customers || []).forEach(function(c){ if(emRe.test(ai_s_(c.email))) custEmail++; });
  var noRemarkLost = lossLeads['No remark written'] || 0;
  var quality = { ordersLinkedPct: ai_pct_(ls.explicit || 0, liveN), ordersAnyLinkPct: ai_pct_(liveN - (ls.none || 0), liveN), lostWithReasonPct: lossN ? ai_pct_(lossN - noRemarkLost, lossN) : null, trackingGaps: trackGaps,
    customers: (D.customers || []).length, customersWithEmail: custEmail, spendSet: marketing.spendSet };

  return { ver: AI_ADV_VER, actions: actions, dupes: dupes, assign: assign, quotes: quoteAdv, ops: ops, collections: collections, marketing: marketing, customers: customers, anomalies: anomalies, coaching: coaching, quality: quality,
    teamConvPct: ai_round1_(teamConv), teamMedianResp: Math.round(teamMedResp) };
}

/* compact version for Ask AI / weekly review (pure) */
function ai_adv_context_(a){
  if(!a) return null;
  var act = {}; for(var k in a.actions.bySales){ if(a.actions.bySales.hasOwnProperty(k)) act[k] = { open_leads: a.actions.counts[k], top: a.actions.bySales[k].slice(0, 4).map(function(r){ return { id: r.id, name: r.name, score: r.score, next: r.next }; }) }; }
  return {
    lead_score_bands_open: a.actions.scoreBands, top_scored_open_leads: a.actions.top.slice(0, 12).map(function(r){ return { id: r.id, name: r.name, owner: r.owner, source: r.source, score: r.score, why: r.why, next: r.next }; }),
    action_list_by_salesperson: act,
    duplicates: { phone_groups: a.dupes.groups, handled_by_two_salespeople: a.dupes.crossOwner }, unassigned_open_leads: a.assign.unassigned,
    quotations: { open: a.quotes.openCount, pipeline_value: a.quotes.pipeline, weighted_expected_value: a.quotes.weighted, base_win_rate_pct: a.quotes.baseRate, margin_flags: a.quotes.marginFlags, win_rate_by_amount: a.quotes.bands,
      top_open: a.quotes.open.slice(0, 10).map(function(q){ return { id: q.id, customer: q.name, owner: q.owner, amount: q.amount, age_days: q.age, win_pct_estimate: q.win, flag: q.flag }; }) },
    loss_reasons_leads: a.quotes.lossReasons,
    dispatch_lead_time_days: a.ops.leadTime, orders_likely_late: a.ops.riskCount, likely_late_top: a.ops.risk.slice(0, 8).map(function(r){ return { id: r.id, customer: r.name, owner: r.owner, expected: r.exp, predicted: r.predicted, late_by_days: r.lateBy }; }),
    delayed_orders_by: a.ops.delayedBy, tracking_gaps: a.ops.trackingGaps,
    payment_pending: { orders: a.collections.count, total: a.collections.total, ageing_orders: a.collections.ageing, ageing_value: a.collections.ageingValue, top_customers: a.collections.topCustomers,
      top: a.collections.list.slice(0, 10).map(function(p){ return { id: p.id, customer: p.name, owner: p.owner, amount: p.amount, days: p.days }; }) },
    meta_campaigns: a.marketing.campaigns.slice(0, 12).map(function(c){ return { campaign: c.name, leads: c.leads, last_30d: c.d30, qualified_pct: c.qualPct, orders: c.won, linked_billing: c.revenue }; }),
    ad_spend_roi_this_month: a.marketing.roi,
    customers: { with_orders: a.customers.count, repeat: a.customers.repeat, top20pct_share_of_billing_pct: a.customers.top20SharePct, top: a.customers.top.slice(0, 10).map(function(c){ return { name: c.name, orders: c.orders, billing: c.billing, last_order: c.last }; }),
      repeat_due: a.customers.repeatDue.slice(0, 8).map(function(c){ return { name: c.name, orders: c.orders, usual_gap_days: c.gap, days_since_last: c.since }; }), cross_sell_pairs: a.customers.crossSell },
    anomalies: a.anomalies, coaching: a.coaching.slice(0, 12).map(function(c){ return { salesperson: c.name, improve: c.points, strong: c.good }; }), data_quality: a.quality
  };
}

/* ====================================================================== *
 * AI: message drafts + weekly review                                      *
 * ====================================================================== */
function ai_adv_entity_(ss, id){
  var rows = ai_readTab_(ss, 'AI_Entity_Master'), H = AI_ENT_HEAD, want = String(id).toUpperCase(), i, j;
  for(i = 0; i < rows.length; i++){ if(String(rows[i][0]).toUpperCase() === want){ var o = {}; for(j = 0; j < H.length; j++) o[H[j]] = (Object.prototype.toString.call(rows[i][j]) === '[object Date]') ? ai_day_(rows[i][j].getTime()) : rows[i][j]; return o; } }
  return null;
}
function ai_draft_(p){
  var kind = ai_s_(p.kind), id = ai_s_(p.id), lang = ai_s_(p.lang) || 'English', channel = p.channel === 'email' ? 'email' : 'WhatsApp';
  var KIND = { lead_followup: 'a follow-up to a sales lead', quote_followup: 'a follow-up on a quotation that was sent', payment_reminder: 'a polite payment reminder for a delivered order', order_delay: 'an update that the order is delayed, with an apology', order_update: 'an order status update' };
  if(!KIND[kind]) return { ok: false, error: 'bad_kind' };
  if(lang !== 'English' && lang !== 'Hindi' && lang !== 'Hinglish') lang = 'English';
  var ss = ai_ss_(false); if(!ss) return { ok: false, error: 'not_ready' };
  var e = ai_adv_entity_(ss, id); if(!e) return { ok: false, error: 'not_found', hint: 'Record ' + id + ' was not found' };
  var phone = e.phone; delete e.phone; delete e.owner;
  var sys = AI_BIZ + '\nWrite ' + KIND[kind] + ' for the customer, to be sent on ' + channel + ' by the salesperson named in "ownerName".\n'
    + 'Rules: use only facts in RECORD (name, product, amount, dates, status). Never invent prices, dates, discounts or promises. Polite, short and specific. '
    + (channel === 'email' ? 'Give a subject line first as "Subject: ...", then the body. ' : 'Max 70 words, plain text, no markdown. ')
    + 'Sign off with the salesperson name and "OakCraft". Write in ' + (lang === 'Hinglish' ? 'Hinglish (Hindi in Roman letters)' : lang) + '.';
  var r = ai_gemini_('draft', sys, 'RECORD:\n' + JSON.stringify(e), { maxTokens: 600, fast: true });
  if(!r.ok) return r;
  return { ok: true, text: r.text.replace(/\*\*/g, ''), id: e.id, name: e.name, phone: phone || '', kind: kind, model: r.model };
}
function ai_weeklyReview_(){
  var ss = ai_ss_(false); if(!ss) return { ok: false, error: 'not_ready' };
  var c = ai_cacheGet_(ss); if(!c) return { ok: false, error: 'not_ready' };
  var ctx = { summary: ai_context_(c), advanced: ai_adv_context_(c.adv) };
  var sys = AI_BIZ + '\nYou are writing the weekly business review for the owner. Use ONLY the DATA. Every statement must carry a real number from DATA. '
    + 'If history is under 90 days do not claim long-term trends. Plain English.\n'
    + 'Return ONLY JSON: {"headline": max 120 chars, "what_changed": [3-5 strings], "risks": [2-4 strings], "opportunities": [2-4 strings], "decisions": [exactly 3 strings, each a concrete decision for the owner]}';
  var r = ai_gemini_('weekly', sys, 'DATA:\n' + JSON.stringify(ctx), { json: true, maxTokens: 2048 });
  if(!r.ok) return r;
  var j = r.json || {}, arr = function(x, n){ return (Object.prototype.toString.call(x) === '[object Array]' ? x : []).map(function(s){ return ai_cut_(s, 260); }).filter(function(s){ return !!s; }).slice(0, n); };
  var rev = { headline: ai_cut_(j.headline, 160), changed: arr(j.what_changed, 5), risks: arr(j.risks, 4), opportunities: arr(j.opportunities, 4), decisions: arr(j.decisions, 3), at: new Date().toISOString(), model: r.model };
  if(!rev.headline && !rev.changed.length) return { ok: false, error: 'gemini_bad_json', hint: 'The review came back empty' };
  c.review = rev; ai_cachePut_(ss, c);
  return { ok: true, review: rev };
}

/* ====================================================================== *
 * CUSTOMER E-MAIL on order status change (OFF by default)                 *
 * ====================================================================== */
var AI_MAIL_STATUSES = ['Confirmed', 'In Production', 'Ready', 'Dispatched', 'Delivered'];
function ai_mailStatuses_(S){
  var want = {}; String(S.custEmailStatuses || '').split(',').forEach(function(x){ x = ai_s_(x).toLowerCase(); if(x) want[x] = 1; });
  return AI_MAIL_STATUSES.filter(function(s){ return want[s.toLowerCase()]; });
}
function ai_mailEsc_(s){ return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
/* pure: builds subject + html + text for one order */
function ai_mailBuild_(o, cust, disp, S){
  var brand = ai_s_(S.custEmailFrom) || 'OakCraft', st = ai_s_(o.status), who = ai_s_(cust.contact) || ai_s_(o.customer) || 'Sir/Madam';
  var HEAD = { 'Confirmed': 'Your order is confirmed', 'In Production': 'Your order is in production', 'Ready': 'Your order is ready for dispatch', 'Dispatched': 'Your order has been dispatched', 'Delivered': 'Your order has been delivered' };
  var rows = [['Order ID', o.id], ['Order date', ai_s_(o.date).slice(0, 10)], ['Product', ai_cut_(o.product, 160) + (ai_num_(o.qty) ? ' x ' + ai_num_(o.qty) : '')], ['Current status', st]];
  if(st !== 'Delivered' && st !== 'Dispatched' && ai_s_(o.expDispatch)) rows.push(['Expected dispatch', ai_s_(o.expDispatch).slice(0, 10)]);
  if(disp && (st === 'Dispatched' || st === 'Delivered')){
    var trk = ai_s_(disp.tracking), real = trk && !/^TRK\d{7}$/.test(trk);
    if(ai_s_(disp.courier) && real){ rows.push(['Courier', disp.courier]); rows.push(['Tracking no.', trk]); }
    if(ai_s_(disp.dispatchedOn)) rows.push(['Dispatched on', ai_s_(disp.dispatchedOn).slice(0, 10)]);
    if(st === 'Dispatched' && ai_s_(disp.eta)) rows.push(['Expected delivery', ai_s_(disp.eta).slice(0, 10)]);
  }
  var subject = brand + ': ' + (HEAD[st] || 'Order update') + ' (' + o.id + ')';
  var text = 'Dear ' + who + ',\n\n' + (HEAD[st] || 'Order update') + '.\n\n' + rows.map(function(r){ return r[0] + ': ' + r[1]; }).join('\n') + '\n\nFor any help, please reply to this e-mail or contact your sales representative' + (ai_s_(o.salesperson) ? ' (' + o.salesperson + ')' : '') + '.\n\nTeam ' + brand;
  var html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2937;max-width:560px">'
    + '<p>Dear ' + ai_mailEsc_(who) + ',</p><p style="font-size:16px"><b>' + ai_mailEsc_(HEAD[st] || 'Order update') + '</b></p>'
    + '<table cellpadding="7" style="border-collapse:collapse">' + rows.map(function(r){ return '<tr><td style="border:1px solid #e5e7eb;color:#6b7280">' + ai_mailEsc_(r[0]) + '</td><td style="border:1px solid #e5e7eb"><b>' + ai_mailEsc_(r[1]) + '</b></td></tr>'; }).join('') + '</table>'
    + '<p>For any help, please reply to this e-mail or contact your sales representative' + (ai_s_(o.salesperson) ? ' (' + ai_mailEsc_(o.salesperson) + ')' : '') + '.</p><p>Team ' + ai_mailEsc_(brand) + '</p>'
    + '<p style="color:#9ca3af;font-size:11px">This is an automatic update about your order.</p></div>';
  return { subject: subject, text: text, html: html };
}
/* pure: which mails are due. sent = { 'ORD|Status': 1 } */
function ai_mailDue_(D, S, sent){
  var want = {}, emRe = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/, cust = {}, disp = {}, due = [], skipped = { noEmail: 0 };
  ai_mailStatuses_(S).forEach(function(s){ want[s] = 1; });
  (D.customers || []).forEach(function(c){ if(c && c.id) cust[String(c.id)] = c; });
  (D.dispatch || []).forEach(function(d){ if(d && d.orderId) disp[String(d.orderId)] = d; });
  (D.orders || []).forEach(function(o){
    if(!o || !o.id || !want[ai_s_(o.status)]) return;
    var key = o.id + '|' + o.status; if(sent[key]) return;
    var c = cust[String(o.custId || '')] || {}, to = ai_s_(c.email);
    if(!emRe.test(to)){ skipped.noEmail++; return; }
    due.push({ key: key, order: o, cust: c, disp: disp[String(o.id)] || null, to: to });
  });
  return { due: due, skipped: skipped };
}
function ai_mailSent_(ss){
  var rows = ai_readTab_(ss, 'AI_Email_Log'), m = {}, i;
  for(i = 0; i < rows.length; i++){ if(rows[i][1] && (rows[i][4] === 'sent' || rows[i][4] === 'baseline')) m[rows[i][1] + '|' + rows[i][2]] = 1; }
  return m;
}
function ai_custMailRun_(D, S){
  var P = ai_props_(), sig = 'v1|' + ai_mailStatuses_(S).join(',');
  if(!S.custEmail){ try{ if(P.getProperty('AI_CUSTMAIL_BASE')) P.deleteProperty('AI_CUSTMAIL_BASE'); }catch(e0){} return { ok: true, off: true }; }
  var ss = ai_ss_(false); if(!ss) return { ok: false, error: 'not_ready' };
  var now = new Date().toISOString();
  if(P.getProperty('AI_CUSTMAIL_BASE') !== sig){
    /* first run after the switch is turned on: remember the present state, send nothing */
    var all = ai_mailDue_(D, S, {}).due;
    ai_appendTab_(ss, 'AI_Email_Log', all.map(function(x){ return [now, x.order.id, x.order.status, x.to, 'baseline', 'state when switched on -- not mailed']; }), 20000);
    P.setProperty('AI_CUSTMAIL_BASE', sig);
    return { ok: true, baseline: all.length, sent: 0 };
  }
  var res = ai_mailDue_(D, S, ai_mailSent_(ss)), due = res.due.slice(0, 20), log = [], sent = 0, quota = 0;
  try{ quota = MailApp.getRemainingDailyQuota(); }catch(e){ quota = 0; }
  due.forEach(function(x){
    if(quota - sent < 5){ return; }
    try{
      var m = ai_mailBuild_(x.order, x.cust, x.disp, S), opt = { to: x.to, subject: m.subject, body: m.text, htmlBody: m.html, name: ai_s_(S.custEmailFrom) || 'OakCraft' };
      if(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ai_s_(S.custEmailReplyTo))) opt.replyTo = ai_s_(S.custEmailReplyTo);
      MailApp.sendEmail(opt); sent++;
      log.push([now, x.order.id, x.order.status, x.to, 'sent', m.subject]);
    }catch(e){ log.push([now, x.order.id, x.order.status, x.to, 'error', ai_cut_(String(e), 200)]); }
  });
  if(log.length) ai_appendTab_(ss, 'AI_Email_Log', log, 20000);
  return { ok: true, sent: sent, due: res.due.length, noEmail: res.skipped.noEmail };
}
function ai_custMailStatus_(){
  var ss = ai_ss_(false), S = ai_settings_(), rows = ss ? ai_readTab_(ss, 'AI_Email_Log') : [], sent = 0, err = 0, last = [];
  rows.forEach(function(r){ if(r[4] === 'sent') sent++; else if(r[4] === 'error') err++; });
  last = rows.filter(function(r){ return r[4] !== 'baseline'; }).slice(-25).reverse().map(function(r){ return { ts: (Object.prototype.toString.call(r[0]) === '[object Date]') ? r[0].toISOString() : String(r[0]), orderId: r[1], status: r[2], to: r[3], result: r[4], detail: r[5] }; });
  var quota = null; try{ quota = MailApp.getRemainingDailyQuota(); }catch(e){}
  return { ok: true, on: !!S.custEmail, statuses: ai_mailStatuses_(S), sent: sent, errors: err, last: last, quota: quota, baselined: !!ai_props_().getProperty('AI_CUSTMAIL_BASE') };
}
function ai_custMailTest_(toEmail){
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ai_s_(toEmail))) return { ok: false, error: 'no_email', hint: 'Your login has no e-mail address' };
  var S = ai_settings_(), orders = ai_bodies_('orders'), o = null, i;
  for(i = orders.length - 1; i >= 0; i--){ if(orders[i] && orders[i].status === 'Dispatched'){ o = orders[i]; break; } }
  if(!o) o = orders[orders.length - 1]; if(!o) return { ok: false, error: 'no_orders' };
  var disp = null; ai_bodies_('dispatch').forEach(function(d){ if(d && String(d.orderId) === String(o.id)) disp = d; });
  var m = ai_mailBuild_(o, { contact: 'Customer (TEST)' }, disp, S);
  MailApp.sendEmail({ to: toEmail, subject: '[TEST] ' + m.subject, body: m.text, htmlBody: m.html, name: ai_s_(S.custEmailFrom) || 'OakCraft' });
  return { ok: true, to: toEmail, sample: o.id };
}

/* ====================================================================== *
 * hooks used by CodeGs_AiCore.gs                                          *
 * ====================================================================== */
function ai_adv_after_(B, D, S){
  try{ var r = ai_custMailRun_(D, S); if(r && !r.off) Logger.log('AI customer mail: ' + JSON.stringify(r)); }catch(e){ Logger.log('AI customer mail fail: ' + e); }
}
function ai_adv_route_(act, p, u){
  if(act === 'ai_draft') return ai_draft_(p);
  if(act === 'ai_weekly_now') return ai_weeklyReview_();
  if(act === 'ai_custmail_status') return ai_custMailStatus_();
  if(act === 'ai_custmail_test') return ai_custMailTest_(u && u.email);
  return null;
}
