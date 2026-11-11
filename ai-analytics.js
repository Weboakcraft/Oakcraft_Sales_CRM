/* ===========================================================================
   ai-analytics.js  —  "Informatics Analytics" (sirf Administrator / Owner)
     · Backend: apps-script/CodeGs_AiCore.gs + CodeGs_AiGemini.gs (ai_* actions)
     · Ye file CRM ka koi data nahi badalti. Sirf ek cheez likhti hai:
       order form ka "Linked Lead / Quotation" field (order.quoteId / leadRef).
     · Gemini key browser me kabhi save nahi hoti -- seedha server (Script
       Properties) me jaati hai aur wapas kabhi nahi aati.
   Kuch badlo to index.html me ?v= number aur OC_WEB_BUILD badhao.
   =========================================================================== */
(function(){
'use strict';
var VIEW = 'aiAnalytics';
var TABS = [['overview','Overview'],['actions','Action List'],['leads','Leads'],['sources','Sources'],['team','Salespeople'],['quotes','Quotations'],['orders','Orders & Dispatch'],
            ['collect','Collections'],['marketing','Marketing'],['customers','Customers'],['alerts','Alerts'],['review','Weekly Review'],['changes','Change Log'],['forecast','Forecast'],['ask','Ask AI'],['settings','Settings']];
var PERIODS = [['all','All time'],['month','This month'],['d7','Last 7 days'],['d30','Last 30 days'],['d90','Last 90 days']];
var st = { tab:'overview', period:'all', dash:null, err:null, loading:false, list:{ type:'lead', category:'', source:'', owner:'', intent:'', q:'', page:0, sort:'priority', dir:'desc' },
           rows:null, total:0, events:null, chat:[], busy:'', alertType:'', person:'', mail:null };

/* ------------------------------------------------------------------ helpers */
function $(id){ return document.getElementById(id); }
function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function num(v){ var x = parseFloat(v); return isFinite(x) ? x : 0; }
function inr(n){ n = Math.round(num(n)); return '₹' + n.toLocaleString('en-IN'); }
function inrShort(n){ n = num(n); if(n >= 1e7) return '₹' + (n/1e7).toFixed(2) + ' Cr'; if(n >= 1e5) return '₹' + (n/1e5).toFixed(2) + ' L'; return inr(n); }
function isAdmin(){ try{ return !!(typeof AUTH !== 'undefined' && AUTH.isAdmin && AUTH.isAdmin()); }catch(e){ return false; } }
function say(m){ try{ toast(m); }catch(e){} }
function cssVar(n, d){ try{ var v = getComputedStyle(document.documentElement).getPropertyValue(n).trim(); return v || d; }catch(e){ return d; } }
function palette(){ return ['--s1','--s2','--s4','--s3','--s5','--s6','--s7','--s8'].map(function(k){ return cssVar(k, '#2a78d6'); }); }
function when(iso){ if(!iso) return '—'; try{ return new Date(iso).toLocaleString('en-IN', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }); }catch(e){ return iso; } }
function api(action, extra, timeoutMs){
  var body = { action: action }; if(extra) for(var k in extra) body[k] = extra[k];
  var init = { method:'POST', redirect:'follow', headers:{ 'Content-Type':'text/plain;charset=utf-8' }, body: JSON.stringify(body) }, timer = null, timedOut = false;
  if(timeoutMs && typeof AbortController !== 'undefined'){ var ac = new AbortController(); init.signal = ac.signal; timer = setTimeout(function(){ timedOut = true; try{ ac.abort(); }catch(e){} }, timeoutMs); }
  return fetch(CLOUD.url, init)
    .then(function(r){ return r.json(); })
    .then(function(j){ if(timer) clearTimeout(timer); return j; })
    .catch(function(e){ if(timer) clearTimeout(timer); return timedOut ? { ok:false, error:'timeout' } : { ok:false, error:'network', hint:String(e && e.message || e) }; });
}
function errText(r){
  var e = (r && r.error) || 'error', h = (r && r.hint) || '';
  var map = { unauthorized:'Session expired — please log in again', forbidden:'This screen is for Administrators only', not_ready:'Backend setup is pending (run ai_setup)',
    no_key:'Gemini API key is not added yet (Settings tab)', ai_off:'AI is turned off in Settings', daily_cap:'Daily AI call limit reached', busy:'A refresh is already running',
    network:'Network error', gemini_http:'Gemini returned an error', gemini_bad_json:'Could not read the Gemini response', gemini_empty:'Gemini returned an empty answer', timeout:'The AI took too long to answer — please try again', bad_key:'The key does not look valid', empty:'Please type a question' };
  return (map[e] || e) + (h ? ' — ' + h : '');
}
var SEV = { high:['var(--crit)','High'], medium:['var(--warn)','Medium'], low:['var(--muted)','Low'] };
var CAT_COL = { 'Converted':'--good','Delivered':'--good','On Track':'--good','Fresh':'--s1','New':'--s1','Hot':'--crit','Warm':'--s4','Follow-up Overdue':'--crit','Follow-up Due Today':'--s4',
  'Untouched':'--crit','Inactive':'--serious','Unreachable':'--muted','Lost':'--muted','Not Qualified':'--muted','Expired':'--serious','Follow-up Needed':'--s4','Rejected':'--muted','Draft':'--muted',
  'Delayed':'--crit','Delivery Overdue':'--crit','At Risk':'--s4','Payment Pending':'--serious','Dispatched':'--s1','Cancelled':'--muted','Cold':'--muted','Manual Review':'--s7' };
function chip(t){ if(!t) return ''; var c = 'var(' + (CAT_COL[t] || '--text-2') + ')'; return '<span class="chip" style="color:' + c + ';background:color-mix(in srgb,' + c + ' 12%,transparent)">' + esc(t) + '</span>'; }
function kpi(lbl, val, sub, tone){ return '<div class="kpi"><div class="lbl">' + esc(lbl) + '</div><div class="val tabular"' + (tone ? ' style="color:var(' + tone + ')"' : '') + '>' + val + '</div>' + (sub ? '<div class="sub" style="font-size:12px;color:var(--muted);margin-top:4px">' + sub + '</div>' : '') + '</div>'; }
function panel(title, inner, sub){ return '<div class="panel"><h3 style="font-size:15px;font-weight:700;margin:0">' + esc(title) + '</h3>' + (sub ? '<div style="font-size:12px;color:var(--muted);margin-top:2px">' + sub + '</div>' : '') + inner + '</div>'; }
function chartBox(id, h){ return '<div class="chart-wrap"' + (h ? ' style="height:' + h + 'px"' : '') + '><canvas id="' + id + '"></canvas></div>'; }
function table(heads, rows, empty){
  if(!rows.length) return '<div style="padding:26px;text-align:center;color:var(--muted)">' + esc(empty || 'No data') + '</div>';
  return '<div style="overflow-x:auto"><table><thead><tr>' + heads.map(function(h){ var r = /^>/.test(h); return '<th' + (r ? ' style="text-align:right"' : '') + '>' + esc(h.replace(/^>/,'')) + '</th>'; }).join('') + '</tr></thead><tbody>'
    + rows.map(function(r){ return '<tr>' + r.map(function(c, i){ var rt = /^>/.test(heads[i]); return '<td' + (rt ? ' class="tabular" style="text-align:right"' : '') + '>' + c + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
}
function mkChart(id, cfg){
  try{
    var el = $(id); if(!el || typeof Chart === 'undefined') return;
    if(state.charts[id]){ try{ state.charts[id].destroy(); }catch(e){} }
    var tx = cssVar('--text-2','#52514e'), gr = cssVar('--grid','#e1e0d9');
    cfg.options = cfg.options || {}; cfg.options.responsive = true; cfg.options.maintainAspectRatio = false;
    cfg.options.plugins = cfg.options.plugins || {};
    if(!cfg.options.plugins.legend) cfg.options.plugins.legend = { labels:{ color:tx, boxWidth:10, font:{ size:11 } } };
    if(cfg.type !== 'doughnut'){
      cfg.options.scales = cfg.options.scales || {};
      ['x','y'].forEach(function(a){ var s = cfg.options.scales[a] = cfg.options.scales[a] || {}; s.ticks = s.ticks || {}; s.ticks.color = tx; s.grid = s.grid || {}; s.grid.color = gr; });
    }
    state.charts[id] = new Chart(el, cfg);
  }catch(e){}
}
function killCharts(){ try{ Object.keys(state.charts || {}).forEach(function(k){ try{ state.charts[k].destroy(); }catch(e){} }); state.charts = {}; }catch(e){} }

/* ------------------------------------------------------------------ data */
function load(force){
  if(st.loading) return; st.loading = true; st.err = null; if(!st.dash) paint();
  api('ai_dashboard').then(function(r){
    st.loading = false;
    if(r && r.ok && r.data){ st.dash = r.data; st.err = null; }
    else if(r && /unknown action/i.test(String(r.error || ''))){ st.err = 'install'; }
    else st.err = errText(r);
    paint(); if(force && st.dash && !st.err) say('Data refreshed');
  });
}
function act(action, label, extra, after){
  if(st.busy) return; st.busy = label; paint();
  api(action, extra, action === 'ai_key_test' ? 25000 : 150000).then(function(r){
    st.busy = '';
    if(r && r.ok){ if(after) after(r); else { say('Done'); st.dash = null; load(); } }
    else { say(errText(r)); paint(); }
  });
}
function loadList(){
  st.rows = null; paintBody();
  var L = st.list;
  api('ai_entities', { type:L.type, category:L.category, source:L.source, owner:L.owner, intent:L.intent, q:L.q, page:L.page, size:50, sort:L.sort, dir:L.dir }).then(function(r){
    if(r && r.ok){ st.rows = r.rows || []; st.total = r.total || 0; } else { st.rows = []; st.total = 0; say(errText(r)); }
    if(state.view === VIEW && (st.tab === 'leads' || st.tab === 'quotes' || st.tab === 'orders')) paintBody();
  });
}
function loadEvents(){ st.events = null; paintBody(); api('ai_events').then(function(r){ st.events = (r && r.ok) ? (r.rows || []) : []; if(state.view === VIEW && st.tab === 'changes') paintBody(); }); }

/* ------------------------------------------------------------------ tabs */
function vOverview(d){
  var k = d.kpis, ins = d.insights || [];
  var h = '<div class="kpi-grid kpi-6">'
    + kpi('Open leads', k.openLeads, k.newToday + ' new today · ' + k.new7 + ' this week')
    + kpi('Follow-up overdue', k.followOverdue, k.followToday + ' due today', k.followOverdue ? '--crit' : '')
    + kpi('Untouched leads', k.untouched, 'No response for ' + d.settings.untouchedHours + '+ hours', k.untouched ? '--crit' : '')
    + kpi('Open quotations', k.openQuotes, inrShort(k.openQuoteValue) + ' · ' + k.quoteFollow + ' need follow-up')
    + kpi('Delayed orders', k.delayedOrders, k.atRiskOrders + ' at risk · ' + k.openOrders + ' open', k.delayedOrders ? '--crit' : '')
    + kpi('Billing (this month)', inrShort(k.monthBilling), k.monthOrders + ' orders · incl. GST')
    + '</div><div class="kpi-grid kpi-6">'
    + kpi('Total leads', k.leads, 'Lead → order ' + k.leadConvPct + '%')
    + kpi('Hot leads', k.hot, k.warm + ' warm')
    + kpi('Inactive leads', k.inactive, 'No activity for ' + d.settings.inactiveDays + '+ days')
    + kpi('Quote → order', k.quoteConvPct + '%', k.quotes + ' quotations · ' + k.quoteExpired + ' expired')
    + kpi('Payment pending', inrShort(k.payPendingValue), k.payPending + ' delivered orders')
    + kpi('Alerts', k.alerts, k.alertsHigh + ' high', k.alertsHigh ? '--crit' : '')
    + '</div>';
  var insHtml = ins.length
    ? ins.map(function(x){ var s = SEV[x.severity] || SEV.medium; return '<div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)"><span style="width:8px;height:8px;border-radius:50%;background:' + s[0] + ';margin-top:6px;flex:none"></span><div><div style="font-weight:700">' + esc(x.title) + '</div><div style="font-size:13px;color:var(--text-2)">' + esc(x.detail) + '</div></div></div>'; }).join('')
      + '<div style="font-size:11.5px;color:var(--muted);margin-top:8px">Written by Gemini · ' + esc(when(d.insightsAt)) + ' · numbers come from the data above</div>'
    : '<div style="padding:18px 0;color:var(--muted);font-size:13px">' + (d.keySet ? 'No insights yet. Click "Generate AI insights".' : 'Add a Gemini API key in the Settings tab to get AI insights. All other numbers work without AI.') + '</div>';
  var top = (d.alerts || []).slice(0, 8);
  h += '<div class="grid-2">' + panel('What needs attention today (AI insights)', insHtml + '<div style="margin-top:10px"><button class="btn sm" data-ai-act="insights"' + (d.keySet ? '' : ' disabled') + '>Generate AI insights</button></div>')
    + panel('Top alerts', table(['Type','Record','What happened'], top.map(function(a){ return [chip(a.type.replace(/^Order |^Quotation /,'')) , '<b>' + esc(a.name || a.id) + '</b><div style="font-size:11.5px;color:var(--muted)">' + esc(a.id) + ' · ' + esc(a.owner || '—') + '</div>', esc(a.title)]; }), 'No alerts 🎉')) + '</div>';
  var av = adv(d);
  if(av || d.review) h += '<div class="grid-2">' + panel('Unusual this week', anomalyList(av, 6)) + panel('Weekly review', d.review ? '<div style="font-weight:700;margin-top:8px">' + esc(d.review.headline) + '</div><div style="font-size:13px;color:var(--text-2);margin-top:6px">' + esc((d.review.decisions || [])[0] || '') + '</div><div style="margin-top:10px"><button class="btn sm ghost" data-ai-tab="review">Open the review</button></div>' : '<div style="padding:14px 0;color:var(--muted);font-size:13px">Not written yet.</div><button class="btn sm ghost" data-ai-tab="review">Go to Weekly Review</button>') + '</div>';
  h += '<div class="grid-2">' + panel('Leads — week by week (by source)', chartBox('aiWeeks'), 'Last 12 weeks') + panel('Lead funnel', chartBox('aiFunnel'), 'Leads at each stage right now') + '</div>';
  h += '<div class="grid-2">' + panel('Billing — month by month', chartBox('aiMonths'), 'Incl. GST, cancelled orders excluded') + panel('Billing by lead source', chartBox('aiRev'), 'Order ↔ lead link: ' + d.linkStats.explicit + ' confirmed, ' + d.linkStats.phone + ' by phone, ' + d.linkStats.customer + ' by customer, ' + d.linkStats.none + ' not linked') + '</div>';
  return h;
}
function cOverview(d){
  var pal = palette(), srcs = {};
  d.weeks.forEach(function(w){ Object.keys(w.bySource).forEach(function(s){ srcs[s] = 1; }); });
  mkChart('aiWeeks', { type:'bar', data:{ labels:d.weeks.map(function(w){ return w.week.slice(8) + '/' + w.week.slice(5,7); }),
    datasets:Object.keys(srcs).map(function(s, i){ return { label:s, data:d.weeks.map(function(w){ return w.bySource[s] || 0; }), backgroundColor:pal[i % pal.length], borderRadius:3 }; }) },
    options:{ scales:{ x:{ stacked:true }, y:{ stacked:true, beginAtZero:true } } } });
  mkChart('aiFunnel', { type:'bar', data:{ labels:d.funnel.map(function(f){ return f.label; }), datasets:[{ label:'Leads', data:d.funnel.map(function(f){ return f.n; }), backgroundColor:pal[0], borderRadius:4 }] },
    options:{ indexAxis:'y', plugins:{ legend:{ display:false } } } });
  mkChart('aiMonths', { type:'bar', data:{ labels:d.months.map(function(m){ return m.month; }), datasets:[{ label:'Billing (₹)', data:d.months.map(function(m){ return m.billing; }), backgroundColor:pal[1], borderRadius:4 }] },
    options:{ plugins:{ legend:{ display:false } }, scales:{ y:{ beginAtZero:true, ticks:{ callback:function(v){ return inrShort(v); } } } } } });
  var rk = Object.keys(d.revBySource || {});
  mkChart('aiRev', { type:'doughnut', data:{ labels:rk, datasets:[{ data:rk.map(function(x){ return d.revBySource[x]; }), backgroundColor:rk.map(function(_, i){ return pal[i % pal.length]; }), borderWidth:0 }] }, options:{ cutout:'62%' } });
}
function periodBar(){ return '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">' + PERIODS.map(function(p){ return '<button class="btn sm' + (st.period === p[0] ? ' primary' : ' ghost') + '" data-ai-period="' + p[0] + '">' + p[1] + '</button>'; }).join('') + '<span style="align-self:center;font-size:12px;color:var(--muted);margin-left:6px">Period = when the lead arrived</span></div>'; }
function vGroups(d, which){
  var rows = ((which === 'team' ? d.bySales : d.bySource)[st.period] || []).slice().sort(function(a, b){ return b.leads - a.leads; });
  var head = which === 'team'
    ? ['Salesperson','>Leads','>Open','>Qualified','>Won','>Conv %','>Overdue','>Untouched','>Inactive','>Avg response','>Quotes','>Orders','>Billing','>Delayed']
    : ['Source','>Leads','>Open','>Contacted','>Qualified','>Quoted','>Won','>Lost','>Conv %','>Hot','>Overdue','>Untouched','>Avg response','>Billing'];
  var body = rows.map(function(g){
    var resp = g.avgResp == null ? '—' : g.avgResp + ' min', red = function(n){ return n ? '<span style="color:var(--crit);font-weight:700">' + n + '</span>' : '0'; };
    return which === 'team'
      ? ['<b>' + esc(g.key) + '</b>', g.leads, g.open, g.qualified, g.won, g.convPct + '%', red(g.overdue), red(g.untouched), red(g.inactive), resp, g.quotes || 0, g.orders || 0, inr(g.billing || 0), red(g.delayed || 0)]
      : ['<b>' + esc(g.key) + '</b>', g.leads, g.open, g.contacted, g.qualified, g.quoted, g.won, g.lost, g.convPct + '%', g.hot, red(g.overdue), red(g.untouched), resp, inr(g.revenue)];
  });
  return periodBar() + '<div class="grid-2">' + panel(which === 'team' ? 'Salesperson wise leads' : 'Source wise leads', chartBox('aiGrp')) + panel('Conversion %', chartBox('aiGrpConv'), 'Lead → order') + '</div>'
    + '<div class="card"><div class="card-head"><h3>' + (which === 'team' ? 'Salesperson performance' : 'Source performance') + '</h3></div>' + table(head, body, 'No leads in this period') + '</div>'
    + (which === 'team' ? '<div style="font-size:12px;color:var(--muted);margin-top:8px">Quotes / Orders / Billing are counted by their own date within the selected period.</div>' + vCoaching(d) : '');
}
function cGroups(d, which){
  var rows = ((which === 'team' ? d.bySales : d.bySource)[st.period] || []).slice().sort(function(a, b){ return b.leads - a.leads; }).slice(0, 12), pal = palette();
  mkChart('aiGrp', { type:'bar', data:{ labels:rows.map(function(g){ return g.key; }), datasets:[{ label:'Open', data:rows.map(function(g){ return g.open; }), backgroundColor:pal[0], borderRadius:3 }, { label:'Won', data:rows.map(function(g){ return g.won; }), backgroundColor:pal[1], borderRadius:3 },
    { label:'Lost / NQ', data:rows.map(function(g){ return g.lost + g.notQualified; }), backgroundColor:cssVar('--muted','#898781'), borderRadius:3 }] }, options:{ scales:{ x:{ stacked:true }, y:{ stacked:true, beginAtZero:true } } } });
  mkChart('aiGrpConv', { type:'bar', data:{ labels:rows.map(function(g){ return g.key; }), datasets:[{ label:'Conv %', data:rows.map(function(g){ return g.convPct; }), backgroundColor:pal[4], borderRadius:4 }] }, options:{ indexAxis:'y', plugins:{ legend:{ display:false } } } });
}
function catBar(obj, type){
  var keys = Object.keys(obj || {}).sort(function(a, b){ return obj[b] - obj[a]; });
  return '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px"><button class="btn sm' + (st.list.category === '' ? ' primary' : ' ghost') + '" data-ai-cat="">All</button>'
    + keys.map(function(k){ return '<button class="btn sm' + (st.list.category === k ? ' primary' : ' ghost') + '" data-ai-cat="' + esc(k) + '">' + esc(k) + ' <b>' + obj[k] + '</b></button>'; }).join('') + '</div>';
}
function vList(d, type){
  var L = st.list, cats = type === 'lead' ? d.catLead : type === 'quote' ? d.catQuote : d.catOrder;
  var srcs = (d.bySource.all || []).map(function(g){ return g.key; }), owners = (d.bySales.all || []).map(function(g){ return g.key; });
  var sel = function(key, cur, opts, any){ return '<select data-ai-f="' + key + '" style="max-width:170px"><option value="">' + any + '</option>' + opts.map(function(o){ return '<option' + (cur === o ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>'; };
  var tools = sel('source', L.source, srcs, 'All sources') + sel('owner', L.owner, owners, 'All salespeople')
    + (type === 'lead' ? sel('intent', L.intent, ['Hot','Warm','Cold','Not Interested','Manual Review'], 'AI intent: all') : '')
    + '<input data-ai-f="q" value="' + esc(L.q) + '" placeholder="Search name / phone / ID" style="max-width:200px">'
    + '<button class="btn sm ghost" data-ai-act="csv">Export</button>';
  var body;
  if(st.rows == null) body = '<div style="padding:30px;text-align:center;color:var(--muted)">Loading…</div>';
  else {
    var heads = type === 'lead' ? ['Lead','Source','Salesperson','Status','Category','Why','>Idle days','Follow-up','AI']
      : type === 'quote' ? ['Quotation','Salesperson','Status','Category','Why','>Amount','Valid till','Linked order']
      : ['Order','Source','Salesperson','Status','Category','Why','>Amount','Expected','Linked lead'];
    body = table(heads, st.rows.map(function(r){
      var who = '<b>' + esc(r.name || '—') + '</b><div style="font-size:11.5px;color:var(--muted)">' + esc(r.id) + (r.phone ? ' · ' + esc(r.phone) : '') + (r.city ? ' · ' + esc(r.city) : '') + '</div>';
      var link = r.linkId ? esc(r.linkId) + ' <span style="font-size:11px;color:var(--muted)">(' + (num(r.linkConf) >= 1 ? 'confirmed' : num(r.linkConf) >= 0.8 ? 'phone match' : 'customer match') + ')</span>' : '<span style="color:var(--muted)">—</span>';
      var ai = r.aiIntent ? chip(r.aiIntent) + (r.aiScore !== '' ? ' <span class="tabular" style="font-size:11.5px;color:var(--muted)">' + esc(r.aiScore) + '</span>' : '') + (r.aiNext ? '<div style="font-size:12px;margin-top:3px">' + esc(r.aiNext) + '</div>' : '') : '<span style="color:var(--muted)">—</span>';
      if(type === 'lead') return [who, esc(r.source), esc(r.ownerName || 'Unassigned'), esc(r.status), chip(r.category), esc(r.reason), r.daysIdle, esc(r.followUp || '—'), ai];
      if(type === 'quote') return [who, esc(r.ownerName || '—'), esc(r.status), chip(r.category), esc(r.reason), inr(r.amount), esc(r.followUp || '—'), link];
      return [who, esc(r.source || '—'), esc(r.ownerName || '—'), esc(r.status), chip(r.category), esc(r.reason), inr(r.amount), esc(r.followUp || '—'), link];
    }), 'Nothing found for this filter');
    var pages = Math.ceil(st.total / 50);
    body += '<div style="display:flex;gap:10px;align-items:center;padding:12px 20px;border-top:1px solid var(--border);font-size:13px"><span>' + st.total + ' records</span><span style="margin-left:auto"></span>'
      + '<button class="btn sm ghost" data-ai-page="-1"' + (L.page <= 0 ? ' disabled' : '') + '>‹ Prev</button><span>Page ' + (L.page + 1) + ' / ' + Math.max(1, pages) + '</span><button class="btn sm ghost" data-ai-page="1"' + (L.page + 1 >= pages ? ' disabled' : '') + '>Next ›</button></div>';
  }
  return (type === 'quote' ? vQuoteAdv(d) + '<div style="height:16px"></div>' : type === 'order' ? vOpsAdv(d) + '<div style="height:16px"></div>' : '') + catBar(cats, type) + '<div class="card"><div class="card-head"><h3>' + (type === 'lead' ? 'Leads' : type === 'quote' ? 'All quotations' : 'All orders') + '</h3><div class="tools">' + tools + '</div></div>' + body + '</div>'
    + (type === 'order' ? '<div style="font-size:12px;color:var(--muted);margin-top:8px">"Tracking Pending" = the dispatch entry was auto-created and has no real courier / tracking number yet (see the Alerts tab).</div>' : '');
}
function vAlerts(d){
  var all = d.alerts || [], types = d.alertCounts || {}, list = st.alertType ? all.filter(function(a){ return a.type === st.alertType; }) : all;
  var bar = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px"><button class="btn sm' + (st.alertType === '' ? ' primary' : ' ghost') + '" data-ai-alert="">All <b>' + d.kpis.alerts + '</b></button>'
    + Object.keys(types).map(function(t){ return '<button class="btn sm' + (st.alertType === t ? ' primary' : ' ghost') + '" data-ai-alert="' + esc(t) + '">' + esc(t) + ' <b>' + types[t] + '</b></button>'; }).join('') + '</div>';
  return bar + '<div class="card">' + table(['Severity','Type','Record','Salesperson','Source','What happened','>Amount'], list.map(function(a){
    var s = SEV[a.sev] || SEV.low;
    return ['<span style="color:' + s[0] + ';font-weight:700">● ' + s[1] + '</span>', esc(a.type), '<b>' + esc(a.name || '—') + '</b><div style="font-size:11.5px;color:var(--muted)">' + esc(a.id) + '</div>', esc(a.owner || '—'), esc(a.source || '—'), esc(a.title), a.amount ? inr(a.amount) : '—'];
  }), 'No alerts 🎉') + '</div>' + (all.length >= 300 ? '<div style="font-size:12px;color:var(--muted);margin-top:8px">Only the top 300 alerts are listed (the counts are complete).</div>' : '');
}
function vChanges(){
  if(st.events == null) return '<div class="panel" style="text-align:center;color:var(--muted)">Loading…</div>';
  return '<div class="card"><div class="card-head"><h3>Change log</h3><div class="tools"><span style="font-size:12px;color:var(--muted)">The CRM is compared with its previous snapshot every 15 minutes · latest 200</span></div></div>'
    + table(['When','Record','Name','What changed','Before','Now','Salesperson'], st.events.map(function(e){ return [esc(when(e.ts)), esc(e.id), esc(e.name || '—'), esc(e.field), esc(e.from === '' ? '—' : e.from), '<b>' + esc(e.to === '' ? '—' : e.to) + '</b>', esc(e.owner || '—')]; }), 'No changes recorded yet') + '</div>';
}
function vForecast(d){
  var p = d.pred || {}, rr = p.runRate || {};
  var h = '<div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">'
    + kpi('Billing this month (run-rate)', inrShort(rr.billing), 'Day ' + rr.dayOfMonth + ' of ' + rr.daysInMonth + ' · so far ' + inrShort(d.kpis.monthBilling))
    + kpi('Orders this month (run-rate)', rr.orders, 'So far ' + d.kpis.monthOrders)
    + kpi('Leads this month (run-rate)', rr.leads, 'At the current pace') + '</div>';
  h += p.enough
    ? '<div class="kpi-grid" style="grid-template-columns:repeat(2,1fr)">' + kpi('Expected orders from open leads', p.expectedConversions, 'Last 90 days conversion ' + p.convRate90 + '% × hot + warm leads') + kpi('History', p.historyDays + ' days', 'Enough for a forecast') + '</div>'
    : '<div class="panel" style="border-left:4px solid var(--warn)"><b>Insufficient data</b><div style="font-size:13px;color:var(--text-2);margin-top:4px">The CRM has only ' + (p.historyDays || 0) + ' days of history. A conversion forecast needs at least 90 days — until then only the run-rate above is shown, with no guesswork.</div></div>';
  return h + '<div style="font-size:12px;color:var(--muted);margin-top:10px">Run-rate = (this month so far) ÷ (days passed) × (days in month). This is plain arithmetic, not an AI estimate.</div>';
}
function vAsk(d){
  var ex = ['Which source brought the most leads this week?','Which salesperson has the most overdue follow-ups?','Which orders are delayed?','What is the billing this month?'];
  var msgs = st.chat.map(function(m){ return '<div style="display:flex;justify-content:' + (m.me ? 'flex-end' : 'flex-start') + ';margin:8px 0"><div style="max-width:78%;padding:10px 14px;border-radius:14px;white-space:pre-wrap;font-size:14px;'
    + (m.me ? 'background:var(--brand);color:#fff' : 'background:var(--surface-2);border:1px solid var(--border)') + '">' + esc(m.text) + '</div></div>'; }).join('');
  return '<div class="panel">' + (d.keySet ? '' : '<div style="padding:10px 12px;border-radius:10px;background:color-mix(in srgb,var(--warn) 14%,transparent);font-size:13px;margin-bottom:12px">Add a Gemini API key in the Settings tab to use Ask AI.</div>')
    + '<div id="aiChat" style="min-height:160px;max-height:440px;overflow-y:auto">' + (msgs || '<div style="color:var(--muted);font-size:13px;padding:8px 0">Ask anything about your CRM numbers. The answer comes back in the language of your question. Answers use only the data on this screen; mention a record ID (e.g. ORD-…) to include that record.</div>') + (st.busy === 'ask' ? '<div style="color:var(--muted);font-size:13px">Thinking…</div>' : '') + '</div>'
    + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:10px 0">' + ex.map(function(q){ return '<button class="btn sm ghost" data-ai-ex="' + esc(q) + '">' + esc(q) + '</button>'; }).join('') + '</div>'
    + '<div style="display:flex;gap:8px"><input id="aiAskQ" maxlength="600" placeholder="Type your question…" style="flex:1"><button class="btn primary" data-ai-act="ask">Ask</button></div>'
    + '<div style="font-size:11.5px;color:var(--muted);margin-top:8px">The AI is read-only — it cannot change anything in the CRM. Phone numbers are not sent to the AI.</div></div>';
}
function vSettings(d){
  var S = d.settings || {};
  var n = function(key, lbl, hint){ return '<div><label>' + lbl + '</label><input type="number" min="0" data-ai-set="' + key + '" value="' + esc(S[key]) + '"><div style="font-size:11.5px;color:var(--muted);margin-top:3px">' + hint + '</div></div>'; };
  return '<div class="grid-2"><div class="panel"><h3 style="font-size:15px;font-weight:700;margin:0 0 12px">Rules (work without AI)</h3>'
    + '<div class="form-row two">' + n('untouchedHours','Untouched — hours','New lead with no response for this many hours') + n('inactiveDays','Inactive — days','No activity on the lead for this many days') + '</div>'
    + '<div class="form-row two">' + n('hotDays','Hot — days','Qualified / quoted lead active within this many days') + n('quoteFollowDays','Quotation follow-up — days','This many days after the quotation was sent') + '</div>'
    + '<div class="form-row two">' + n('atRiskDays','Order at risk — days','This close to the expected date and not ready yet') + n('payPendingDays','Payment pending — days','Payment still due this many days after delivery') + '</div>'
    + '<div class="form-row two">' + n('gstPct','GST %','Billing = amount + GST') + '<div><label>Daily summary email</label><input type="email" data-ai-set="summaryEmail" value="' + esc(S.summaryEmail || '') + '" placeholder="leave empty for no email" autocomplete="off" name="ai-summary-to"><div style="font-size:11.5px;color:var(--muted);margin-top:3px">Sent daily at 9 am</div></div></div>'
    + '<div class="form-row two">' + n('minGpPct','Minimum margin %','Quotations below this are flagged') + '<div><label>Monthly ad spend</label><input data-ai-set="adSpend" value="' + esc(S.adSpend || '') + '" placeholder="Meta=50000, IndiaMART=12000"><div style="font-size:11.5px;color:var(--muted);margin-top:3px">Source=amount, separated by commas</div></div></div>'
    + '<button class="btn primary" data-ai-act="saveSettings">Save settings</button></div>'
    + '<div class="panel"><h3 style="font-size:15px;font-weight:700;margin:0 0 12px">Gemini AI</h3>'
    + '<div style="font-size:13px;margin-bottom:10px">API key: ' + (d.keySet ? '<b style="color:var(--good-ink)">Saved ✓</b>' : '<b style="color:var(--crit)">Not added yet</b>') + '</div>'
    + '<div class="form-row"><label>' + (d.keySet ? 'New key (only to replace)' : 'Gemini API key') + '</label><input type="password" id="aiKeyIn" name="ai-gemini-key" autocomplete="new-password" data-lpignore="true" placeholder="Paste the key created in Google AI Studio">'
    + '<div style="font-size:11.5px;color:var(--muted);margin-top:3px">The key goes straight to Google Apps Script (Script Properties). It is not stored in the browser, the Sheet or GitHub, and is never shown again.</div></div>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px"><button class="btn primary sm" data-ai-act="saveKey">Save key</button><button class="btn sm" data-ai-act="testKey"' + (d.keySet ? '' : ' disabled') + '>Test key</button>' + (d.keySet ? '<button class="btn sm ghost" style="color:var(--crit)" data-ai-act="delKey">Remove key</button>' : '') + '</div>'
    + '<div class="form-row two"><div><label>AI enabled</label><select data-ai-set="aiEnabled"><option value="true"' + (S.aiEnabled ? ' selected' : '') + '>On</option><option value="false"' + (S.aiEnabled ? '' : ' selected') + '>Off</option></select></div>' + n('dailyAiCalls','Max AI calls per day','Keeps cost under control') + '</div>'
    + '<div class="form-row two"><div><label>Model</label><input data-ai-set="model" value="' + esc(S.model || '') + '" placeholder="empty = auto (fast model)"></div>' + n('batch','Leads per AI call','5 – 30') + '</div>'
    + '<div style="font-size:12.5px;color:var(--text-2);margin-bottom:10px">Leads waiting for AI analysis: <b>' + (d.aiPending || 0) + '</b> (only open leads that have remarks)</div>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" data-ai-act="analyse"' + (d.keySet ? '' : ' disabled') + '>Analyse leads now</button><button class="btn sm" data-ai-act="insights"' + (d.keySet ? '' : ' disabled') + '>Generate AI insights</button></div></div></div>'
    + mailPanel(d) + '<div style="height:16px"></div>'
    + '<div class="panel"><h3 style="font-size:15px;font-weight:700;margin:0 0 8px">System</h3><div style="font-size:13px;color:var(--text-2);line-height:1.7">Backend version ' + esc(d.ver) + (d.adv ? ' · advanced ' + esc(d.adv.ver) : ' · advanced file not installed') + (d.advError ? ' · <span style="color:var(--crit)">advanced error: ' + esc(d.advError) + '</span>' : '') + ' · last refresh ' + esc(when(d.generatedAt)) + ' (' + esc(d.why || '') + ', ' + (d.ms || 0) + ' ms)<br>'
    + 'Records: ' + Object.keys(d.counts || {}).map(function(k){ return esc(k) + ' ' + d.counts[k]; }).join(' · ') + '<br>'
    + (d.sheetUrl ? '<a href="' + esc(d.sheetUrl) + '" target="_blank" rel="noopener">Open the AI Analytics Google Sheet ↗</a> (AI_Entity_Master, AI_Event_Log, AI_API_Logs…)' : '') + '</div></div>';
}
function vInstall(){
  return '<div class="panel" style="max-width:760px"><h3 style="font-size:16px;font-weight:700;margin:0 0 8px">Backend is not installed yet</h3><div style="font-size:14px;line-height:1.8;color:var(--text-2)">This screen works once the following is done in the Apps Script project (Web_Sales_CRM):<ol style="margin:8px 0 0 18px">'
    + '<li>Paste <b>apps-script/CodeGs_AiCore.gs</b> and <b>CodeGs_AiGemini.gs</b> from GitHub as new script files, at the <b>bottom</b> of the file list.</li>'
    + '<li>Run <b>ai_setup</b> in the editor (it asks for permission once), then <b>ai_selfTest</b>.</li><li>Run <b>ai_installTriggers</b>.</li><li>Deploy → Manage deployments → Edit → <b>New version</b> → Deploy.</li></ol></div>'
    + '<div style="margin-top:12px"><button class="btn primary sm" data-ai-act="reload">Check again</button></div></div>';
}

/* ------------------------------------------------------------------ advanced (phases 1-5) */
function adv(d){ return (d && d.adv) || null; }
function needAdv(){ return '<div class="panel">The advanced analytics backend file (CodeGs_AiAdvanced.gs) is not installed yet, or the data has not refreshed since it was added. Click "Refresh now".</div>'; }
function draftBtn(id, kind, label){ return '<button class="btn sm ghost" data-ai-draft="' + esc(id) + '" data-kind="' + kind + '">' + (label || 'Draft message') + '</button>'; }
function scoreChip(n){ var c = n >= 60 ? '--crit' : n >= 35 ? '--s4' : '--muted'; return '<span class="chip tabular" style="color:var(' + c + ');background:color-mix(in srgb,var(' + c + ') 12%,transparent)">' + n + '</span>'; }
function bars(obj, max){
  var keys = Object.keys(obj || {}).sort(function(a, b){ return obj[b] - obj[a]; }).slice(0, max || 10), top = keys.length ? obj[keys[0]] : 0;
  if(!keys.length) return '<div style="padding:14px 0;color:var(--muted);font-size:13px">No data</div>';
  return '<div style="margin-top:10px">' + keys.map(function(k){ return '<div style="display:flex;align-items:center;gap:10px;margin:6px 0;font-size:13px"><div style="width:44%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(k) + '</div><div style="flex:1;background:var(--grid);border-radius:4px;height:10px"><div style="height:10px;border-radius:4px;background:var(--s1);width:' + (top ? Math.max(2, Math.round(obj[k] / top * 100)) : 0) + '%"></div></div><div class="tabular" style="width:48px;text-align:right">' + obj[k] + '</div></div>'; }).join('') + '</div>';
}
function vActions(d){
  var a = adv(d); if(!a) return needAdv();
  var A = a.actions, people = Object.keys(A.bySales).sort(function(x, y){ return (A.counts[y] || 0) - (A.counts[x] || 0); });
  if(st.person && !A.bySales[st.person]) st.person = '';
  var list = st.person ? A.bySales[st.person] : A.top;
  var h = '<div class="kpi-grid" style="grid-template-columns:repeat(5,1fr)">' + kpi('High-score leads', A.scoreBands.high, 'Score 60+ · work these first', '--crit') + kpi('Medium', A.scoreBands.mid, 'Score 35-59') + kpi('Low', A.scoreBands.low, 'Score under 35')
    + kpi('Duplicate buyers', a.dupes.groups, a.dupes.crossOwner + ' handled by two people', a.dupes.crossOwner ? '--crit' : '') + kpi('Unassigned open leads', a.assign.unassigned, 'Suggestions below', a.assign.unassigned ? '--s4' : '') + '</div>';
  h += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px"><button class="btn sm' + (st.person === '' ? ' primary' : ' ghost') + '" data-ai-person="">Top 40 overall</button>'
    + people.map(function(p){ return '<button class="btn sm' + (st.person === p ? ' primary' : ' ghost') + '" data-ai-person="' + esc(p) + '">' + esc(p) + ' <b>' + A.counts[p] + '</b></button>'; }).join('') + '</div>';
  h += '<div class="card"><div class="card-head"><h3>' + (st.person ? 'Today\'s call list — ' + esc(st.person) : 'Highest-priority open leads') + '</h3><div class="tools"><span style="font-size:12px;color:var(--muted)">Score = stage + source quality + quantity + recency + follow-up + AI intent</span></div></div>'
    + table(['>Score','Lead','Source','Status','Why now','Next step','>Idle days',''], (list || []).map(function(r){
      return [scoreChip(r.score), '<b>' + esc(r.name || '—') + '</b><div style="font-size:11.5px;color:var(--muted)">' + esc(r.id) + (r.city ? ' · ' + esc(r.city) : '') + (st.person ? '' : ' · ' + esc(r.owner)) + '</div>', esc(r.source), esc(r.status), esc(r.why), esc(r.next), r.idle, draftBtn(r.id, 'lead_followup')]; }), 'No open leads') + '</div>';
  h += '<div class="grid-2" style="margin-top:16px"><div class="card"><div class="card-head"><h3>Duplicate buyers (same phone)</h3></div>'
    + table(['Buyer','>Leads','Sources','Handled by','Records'], a.dupes.list.slice(0, 15).map(function(g){ return ['<b>' + esc(g.name || '—') + '</b><div style="font-size:11.5px;color:var(--muted)">phone ending ' + esc(g.phoneEnd) + '</div>', g.n, esc(g.sources.join(', ')), (g.cross ? '<span style="color:var(--crit);font-weight:700">' : '<span>') + esc(g.owners.join(', ') || '—') + '</span>', '<span style="font-size:12px">' + esc(g.ids.join(', ')) + '</span>']; }), 'No duplicates found') + '</div>'
    + '<div class="card"><div class="card-head"><h3>Who should take unassigned leads</h3></div>'
    + table(['>Score','Lead','Source','Suggested','Reason'], a.assign.list.slice(0, 15).map(function(r){ return [scoreChip(r.score), '<b>' + esc(r.name || '—') + '</b><div style="font-size:11.5px;color:var(--muted)">' + esc(r.id) + '</div>', esc(r.source), '<b>' + esc(r.to || '—') + '</b>', '<span style="font-size:12px">' + esc(r.why) + '</span>']; }), 'Every open lead has an owner') + '</div></div>'
    + '<div style="font-size:12px;color:var(--muted);margin-top:8px">Suggestions only — nothing is assigned or changed automatically.</div>';
  return h;
}
function vQuoteAdv(d){
  var a = adv(d); if(!a) return '';
  var q = a.quotes;
  return '<div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">' + kpi('Open pipeline', inrShort(q.pipeline), q.openCount + ' open quotations') + kpi('Expected value (estimate)', inrShort(q.weighted), 'Pipeline × win estimate')
    + kpi('Historical win rate', q.baseRate + '%', 'From ' + q.settled + ' settled quotations') + kpi('Margin / discount flags', q.marginFlags, 'Margin under ' + q.minGpPct + '% or heavy discount', q.marginFlags ? '--crit' : '') + '</div>'
    + '<div class="grid-2"><div class="card"><div class="card-head"><h3>Open quotations by expected value</h3><div class="tools"><span style="font-size:12px;color:var(--muted)">Win % is an estimate from past quotations of the same size and age</span></div></div>'
    + table(['Quotation','Salesperson','>Amount','>Age','>Win est.','>GP %','Flag',''], q.open.slice(0, 15).map(function(x){ return ['<b>' + esc(x.name || '—') + '</b><div style="font-size:11.5px;color:var(--muted)">' + esc(x.qno || x.id) + '</div>', esc(x.owner), inr(x.amount), x.age + 'd', '<b>' + x.win + '%</b>', x.gpPct == null ? '—' : x.gpPct + '%', x.flag ? '<span style="color:var(--crit);font-size:12px">' + esc(x.flag) + '</span>' : '', draftBtn(x.id, 'quote_followup')]; }), 'No open quotations') + '</div>'
    + panel('Win rate by quotation size', table(['Size','>Settled','>Won','>Win %'], q.bands.map(function(b){ return [esc(b.band), b.n, b.won, b.pct == null ? '—' : b.pct + '%']; })), 'Settled = converted, expired, rejected or older than 30 days') + '</div>';
}
function vOpsAdv(d){
  var a = adv(d); if(!a) return '';
  var o = a.ops;
  return '<div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">' + kpi('Likely to miss the date', o.riskCount, 'Not late yet — predicted from past lead times', o.riskCount ? '--s4' : '') + kpi('Typical order-to-dispatch', o.overallMedian + ' days', 'Median of ' + o.measured + ' dispatched orders')
    + kpi('Tracking not entered', o.trackingGaps, 'Dispatched orders without a real tracking no.', o.trackingGaps ? '--s4' : '') + kpi('Delayed now', d.kpis.delayedOrders, 'Past the expected date', d.kpis.delayedOrders ? '--crit' : '') + '</div>'
    + '<div class="grid-2"><div class="card"><div class="card-head"><h3>Orders likely to be late (prediction)</h3></div>'
    + table(['Order','Salesperson','Status','Promised','Likely','>Late by','Basis',''], o.risk.slice(0, 12).map(function(r){ return ['<b>' + esc(r.name || '—') + '</b><div style="font-size:11.5px;color:var(--muted)">' + esc(r.id) + '</div>', esc(r.owner), esc(r.status), esc(r.exp), esc(r.predicted), '<b style="color:var(--crit)">' + r.lateBy + 'd</b>', '<span style="font-size:12px">' + esc(r.basis) + '</span>', draftBtn(r.id, 'order_delay')]; }), 'No open order is predicted to be late') + '</div>'
    + '<div>' + panel('How long orders really take', table(['Product type','>Orders','>Median days','>75% within','>Promised','>Late %'], o.leadTime.map(function(x){ return [esc(x.type), x.n, x.median, x.p75, x.promised == null ? '—' : x.promised, x.latePct == null ? '—' : x.latePct + '%']; }), 'No dispatched orders to measure'), 'Order date to dispatch date')
    + '<div style="height:16px"></div>' + panel('Where the delayed orders are', '<div style="font-size:12px;color:var(--muted);margin-top:8px">By status</div>' + bars(o.delayedBy.status, 6) + '<div style="font-size:12px;color:var(--muted);margin-top:8px">By salesperson</div>' + bars(o.delayedBy.sales, 6)) + '</div></div>';
}
function vCollect(d){
  var a = adv(d); if(!a) return needAdv();
  var c = a.collections, keys = Object.keys(c.ageing);
  return '<div class="kpi-grid" style="grid-template-columns:repeat(5,1fr)">' + kpi('Payment pending', inrShort(c.total), c.count + ' dispatched / delivered orders', '--crit')
    + keys.map(function(k){ return kpi(k, inrShort(c.ageingValue[k]), c.ageing[k] + ' orders', k === '30+ days' && c.ageing[k] ? '--crit' : ''); }).join('') + '</div>'
    + '<div class="grid-2"><div class="card"><div class="card-head"><h3>Collect these first</h3><div class="tools"><span style="font-size:12px;color:var(--muted)">Ranked by amount and days since dispatch / delivery</span></div></div>'
    + table(['Order','Salesperson','Status','Payment','>Amount (incl. GST)','>Days',''], c.list.map(function(p){ return ['<b>' + esc(p.name || '—') + '</b><div style="font-size:11.5px;color:var(--muted)">' + esc(p.id) + '</div>', esc(p.owner), esc(p.status), esc(p.payment), inr(p.amount), p.days > 30 ? '<b style="color:var(--crit)">' + p.days + '</b>' : p.days, draftBtn(p.id, 'payment_reminder', 'Draft reminder')]; }), 'Nothing pending 🎉') + '</div>'
    + '<div>' + panel('Customers owing the most', table(['Customer','>Pending'], c.topCustomers.map(function(x){ return ['<b>' + esc(x.name) + '</b>', inr(x.amount)]; }), 'Nothing pending'))
    + '<div style="height:16px"></div>' + panel('Cash forecast (estimate)', (function(f){
        if(!f) return '<div style="padding:12px 0;color:var(--muted);font-size:13px">Refresh to load.</div>';
        if(!f.enough) return '<div style="padding:12px 0;font-size:13px;color:var(--text-2)">Not enough payment history yet: <b>' + f.recorded + '</b> payment(s) recorded' + (f.since ? ' since ' + esc(f.since) : '') + '. The forecast starts once 5 orders have been marked Paid — each change is now dated automatically.</div>';
        return table(['When','>Expected inflow'], [['Already past the usual payment time', '<b style="color:var(--crit)">' + inr(f.overdue) + '</b> (' + f.overdueOrders + ' orders)']].concat(f.weeks.map(function(w){ return [esc(w.label), inr(w.amount)]; })).concat([['Later', inr(f.later)]]))
          + '<div style="font-size:12px;color:var(--muted);margin-top:8px">Customers usually pay ' + f.medianDays + ' days after dispatch (from ' + f.recorded + ' recorded payments).</div>';
      })(c.forecast)) + '</div></div>'
    + '<div style="font-size:12px;color:var(--muted);margin-top:8px">Based on the Payment field of each order. Payment dates are learnt from the moment an order is changed to Paid.</div>';
}
function vMarketing(d){
  var a = adv(d); if(!a) return needAdv();
  var m = a.marketing, q = a.quotes;
  var roi = m.roi.length ? table(['Source','>Spend / month','>Leads','>Cost / lead','>Qualified','>Cost / qualified','>Orders','>Cost / order','>Billing','>Return'], m.roi.map(function(r){ return ['<b>' + esc(r.source) + '</b>', inr(r.spend), r.leads, r.cpl == null ? '—' : inr(r.cpl), r.qualified, r.cpq == null ? '—' : inr(r.cpq), r.orders, r.cpo == null ? '—' : inr(r.cpo), inr(r.billing), r.roas == null ? '—' : r.roas + '×']; }))
    : '<div style="padding:16px 0;color:var(--muted);font-size:13px">Enter your monthly ad spend in Settings (for example "Meta=50000, IndiaMART=12000") to see cost per lead and cost per order.</div>';
  var ct = function(rows){ return table(['Name','>Leads','>Last 30d','>Contacted','>Qualified %','>Orders','>Lost / NQ %','>Linked billing'], rows.map(function(c){ return ['<b>' + esc(c.name) + '</b>', c.leads, c.d30, c.contacted, c.qualPct + '%', c.won, c.lostPct + '%', inr(c.revenue)]; }), 'No Meta leads'); };
  return panel('Ad spend and return — this month', roi, 'Leads and orders are this month\'s; orders are matched to a source through the linked lead')
    + '<div style="height:16px"></div><div class="card"><div class="card-head"><h3>Meta campaigns</h3></div>' + ct(m.campaigns.slice(0, 15)) + '</div>'
    + '<div style="height:16px"></div><div class="card"><div class="card-head"><h3>Meta ads</h3></div>' + ct(m.ads.slice(0, 15)) + '</div>'
    + '<div style="height:16px"></div><div class="grid-2">' + panel('Why leads are lost', bars(q.lossReasons, 10), q.lossTotal + ' lost / not-qualified leads · ' + (q.lossPicked || 0) + ' with a reason picked by the salesperson, the rest classified from remarks')
    + panel('Loss reasons by source', table(['Source','Top reasons'], Object.keys(q.lossBySource).map(function(sn){ var o = q.lossBySource[sn]; return ['<b>' + esc(sn) + '</b>', esc(Object.keys(o).sort(function(x, y){ return o[y] - o[x]; }).slice(0, 3).map(function(k){ return k + ' (' + o[k] + ')'; }).join(' · '))]; }), 'No lost leads')) + '</div>';
}
function vCustomers(d){
  var a = adv(d); if(!a) return needAdv();
  var c = a.customers, row = function(x){ return ['<b>' + esc(x.name || '—') + '</b><div style="font-size:11.5px;color:var(--muted)">' + esc(x.owner || '') + '</div>', x.orders, inr(x.billing), esc(x.last || '—'), x.since + 'd', x.gap ? x.gap + 'd' : '—', esc((x.cats || []).join(', '))]; };
  var heads = ['Customer','>Orders','>Billing','Last order','>Since','>Usual gap','Categories'];
  return '<div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">' + kpi('Customers with orders', c.count, '') + kpi('Repeat customers', c.repeat, c.repeatPct + '% have 2+ orders') + kpi('Top 20% of customers', c.top20SharePct + '%', 'Share of total billing') + kpi('Due for a repeat order', c.repeatDue.length, 'Past their usual gap', c.repeatDue.length ? '--s4' : '') + '</div>'
    + '<div class="card"><div class="card-head"><h3>Top customers</h3></div>' + table(heads, c.top.map(row), 'No orders') + '</div>'
    + '<div style="height:16px"></div><div class="grid-2"><div class="card"><div class="card-head"><h3>Due for a repeat order</h3></div>' + table(heads, c.repeatDue.map(row), 'No one is past their usual gap') + '</div>'
    + '<div>' + panel('Bought together (cross-sell)', table(['Categories','>Customers'], c.crossSell.map(function(p){ return [esc(p.pair), p.customers]; }), 'Not enough category data yet'), 'Categories that the same customer has ordered')
    + '<div style="height:16px"></div><div class="card"><div class="card-head"><h3>Dormant (60+ days, ₹50k+ billed)</h3></div>' + table(['Customer','>Orders','>Billing','>Since'], c.dormant.slice(0, 10).map(function(x){ return ['<b>' + esc(x.name) + '</b>', x.orders, inr(x.billing), x.since + 'd']; }), 'None') + '</div></div></div>';
}
function vCoaching(d){
  var a = adv(d); if(!a || !a.coaching.length) return '';
  return '<div style="height:16px"></div><div class="card"><div class="card-head"><h3>Coaching notes</h3><div class="tools"><span style="font-size:12px;color:var(--muted)">Team: ' + a.teamConvPct + '% lead-to-order · median first response ' + a.teamMedianResp + ' min</span></div></div>'
    + table(['Salesperson','>Open','>Conv %','Improve','Doing well'], a.coaching.map(function(c){ return ['<b>' + esc(c.name) + '</b>', c.open, c.convPct + '%', c.points.length ? '<ul style="margin:0 0 0 16px;padding:0;font-size:12.5px">' + c.points.map(function(p){ return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' : '<span style="color:var(--muted)">Nothing flagged</span>', c.good.length ? '<span style="font-size:12.5px;color:var(--good-ink)">' + esc(c.good.join(' · ')) + '</span>' : '']; })) + '</div>';
}
function anomalyList(a, n){
  if(!a || !a.anomalies.length) return '<div style="padding:14px 0;color:var(--muted);font-size:13px">Nothing unusual detected.</div>';
  return a.anomalies.slice(0, n || 25).map(function(x){ var s = SEV[x.sev] || SEV.low; return '<div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)"><span style="width:8px;height:8px;border-radius:50%;background:' + s[0] + ';margin-top:6px;flex:none"></span><div><span style="font-size:11.5px;color:var(--muted)">' + esc(x.type) + '</span><div style="font-size:13.5px">' + esc(x.title) + '</div></div></div>'; }).join('');
}
function vReview(d){
  var a = adv(d), r = d.review, li = function(arr){ return (arr || []).length ? '<ul style="margin:6px 0 0 18px;padding:0;line-height:1.7">' + arr.map(function(x){ return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '<div style="color:var(--muted);font-size:13px">—</div>'; };
  var h = r ? '<div class="panel"><div style="font-size:12px;color:var(--muted)">Weekly business review · written by Gemini · ' + esc(when(r.at)) + '</div><h3 style="font-size:19px;font-weight:750;margin:6px 0 14px">' + esc(r.headline) + '</h3>'
      + '<div class="grid-2" style="margin-bottom:0"><div><b>What changed</b>' + li(r.changed) + '<div style="height:12px"></div><b>Opportunities</b>' + li(r.opportunities) + '</div><div><b>Risks</b>' + li(r.risks) + '<div style="height:12px"></div><b>Decisions for you</b>' + li(r.decisions) + '</div></div></div>'
    : '<div class="panel" style="color:var(--muted)">' + (d.keySet ? 'No weekly review yet. Click "Write this week\'s review". It is also written automatically every Monday at 9 am.' : 'Add a Gemini API key in Settings to get the weekly AI review.') + '</div>';
  h += '<div style="margin:12px 0 16px"><button class="btn primary sm" data-ai-act="weekly"' + (d.keySet ? '' : ' disabled') + '>Write this week\'s review</button></div>';
  if(!a) return h + needAdv();
  var q = a.quality;
  return h + '<div class="grid-2">' + panel('Unusual this week (rules, no AI)', anomalyList(a))
    + panel('Data quality — what limits accuracy', table(['Check','Now','What to do'], [
      ['Orders with a confirmed lead / quotation link', '<b>' + q.ordersLinkedPct + '%</b>', 'New orders now require a link or "Direct order"'],
      ['Orders matched to a lead any way', q.ordersAnyLinkPct + '%', 'Phone / customer matching fills the gap'],
      ['Lost leads with a known reason', q.lostWithReasonPct == null ? '—' : q.lostWithReasonPct + '%', 'A reason is now required when a lead is marked Lost / Not Qualified'],
      ['Dispatches without real tracking', q.trackingGaps, 'Enter courier and tracking number'],
      ['Customers with an e-mail address', q.customersWithEmail + ' of ' + q.customers, 'Needed for automatic customer e-mails'],
      ['Monthly ad spend entered', q.spendSet ? 'Yes' : 'No', 'Settings → Monthly ad spend']
    ])) + '</div>';
}
function mailPanel(d){
  var S = d.settings || {}, m = st.mail, q = adv(d) ? adv(d).quality : null;
  var info = m ? ('Sent so far: <b>' + m.sent + '</b> · errors: ' + m.errors + (m.quota == null ? '' : ' · Google daily quota left: ' + m.quota)) : 'Loading status…';
  var log = (m && m.last.length) ? table(['When','Order','Status','To','Result'], m.last.slice(0, 8).map(function(r){ return [esc(when(r.ts)), esc(r.orderId), esc(r.status), esc(r.to), r.result === 'sent' ? '<span style="color:var(--good-ink)">sent</span>' : '<span style="color:var(--crit)">' + esc(r.result) + '</span>']; })) : '';
  return '<div class="panel"><h3 style="font-size:15px;font-weight:700;margin:0 0 6px">Automatic customer e-mail</h3>'
    + '<div style="font-size:13px;color:var(--text-2);margin-bottom:10px">When an order moves to one of the chosen statuses, the customer gets one e-mail with the order details (checked every 15 minutes). Orders already in those statuses when you switch this on are not mailed.'
    + (q ? ' <b>' + q.customersWithEmail + ' of ' + q.customers + ' customers have an e-mail address saved</b> — the others are skipped until an e-mail is added to the customer.' : '') + '</div>'
    + '<div class="form-row two"><div><label>Send automatically</label><select data-ai-set="custEmail"><option value="false"' + (S.custEmail ? '' : ' selected') + '>Off</option><option value="true"' + (S.custEmail ? ' selected' : '') + '>On</option></select></div>'
    + '<div><label>Statuses that trigger an e-mail</label><input data-ai-set="custEmailStatuses" value="' + esc(S.custEmailStatuses || '') + '" placeholder="Dispatched,Delivered"><div style="font-size:11.5px;color:var(--muted);margin-top:3px">Any of: Confirmed, In Production, Ready, Dispatched, Delivered</div></div></div>'
    + '<div class="form-row two"><div><label>Sender name</label><input data-ai-set="custEmailFrom" value="' + esc(S.custEmailFrom || '') + '"></div><div><label>Reply-to address (optional)</label><input data-ai-set="custEmailReplyTo" value="' + esc(S.custEmailReplyTo || '') + '" autocomplete="off" name="ai-reply-to" placeholder="sales@yourcompany.com"></div></div>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button class="btn primary sm" data-ai-act="saveSettings">Save</button><button class="btn sm" data-ai-act="mailTest">Send a test e-mail to me</button><span style="font-size:12.5px;color:var(--text-2)">' + info + '</span></div>' + log + '</div>';
}
function loadMail(){ api('ai_custmail_status').then(function(r){ st.mail = (r && r.ok) ? r : { sent:0, errors:0, last:[], quota:null }; if(state.view === VIEW && st.tab === 'settings') paintBody(); }); }
function openDraft(id, kind, lang){
  lang = lang || 'English';
  try{ openModal('<div class="modal-head"><h3>Message draft</h3><button class="icon-btn" onclick="closeModal()">✕</button></div><div class="modal-body" id="aiDraftBody"><div style="padding:24px;text-align:center;color:var(--muted)">Writing the draft…</div></div>'); }catch(e){ return; }
  api('ai_draft', { id:id, kind:kind, lang:lang, channel:'whatsapp' }, 25000).then(function(r){
    var box = $('aiDraftBody'); if(!box) return;
    if(!r || !r.ok){ box.innerHTML = '<div style="padding:16px;color:var(--crit)">' + esc(errText(r)) + '</div>'; return; }
    var num = ''; try{ num = (typeof waNumber === 'function') ? waNumber(r.phone) : ''; }catch(e){}
    box.innerHTML = '<div style="font-size:12.5px;color:var(--muted);margin-bottom:8px">For <b>' + esc(r.name || r.id) + '</b> (' + esc(r.id) + '). Written by AI from the CRM record — read it before sending. Nothing is sent automatically.</div>'
      + '<textarea id="aiDraftText" rows="9" style="width:100%">' + esc(r.text) + '</textarea>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;align-items:center"><button class="btn primary sm" id="aiDraftCopy">Copy</button>' + (num ? '<button class="btn sm" id="aiDraftWa" style="color:#0f8f4c">Open in WhatsApp</button>' : '')
      + '<span style="margin-left:auto;font-size:12px;color:var(--muted)">Rewrite in</span>' + ['English','Hindi','Hinglish'].map(function(l){ return '<button class="btn sm' + (l === lang ? ' primary' : ' ghost') + '" data-lang="' + l + '">' + l + '</button>'; }).join('') + '</div>';
    $('aiDraftCopy').addEventListener('click', function(){ var t = $('aiDraftText'); try{ navigator.clipboard.writeText(t.value).then(function(){ say('Copied'); }, function(){ t.select(); document.execCommand('copy'); say('Copied'); }); }catch(e){ t.select(); try{ document.execCommand('copy'); say('Copied'); }catch(e2){} } });
    if(num) $('aiDraftWa').addEventListener('click', function(){ window.open('https://wa.me/' + num + '?text=' + encodeURIComponent($('aiDraftText').value), '_blank', 'noopener'); });
    box.querySelectorAll('[data-lang]').forEach(function(b){ b.addEventListener('click', function(){ openDraft(id, kind, b.getAttribute('data-lang')); }); });
  });
}

/* ------------------------------------------------------------------ paint */
function paint(){
  if(typeof state === 'undefined' || state.view !== VIEW) return;
  var d = st.dash, head;
  if(!isAdmin()){ content.innerHTML = '<div class="panel">This screen is for Administrators only.</div>'; return; }
  if(st.err === 'install'){ content.innerHTML = vInstall(); return; }
  if(!d){ content.innerHTML = '<div class="panel" style="text-align:center;color:var(--muted);padding:40px">' + (st.err ? esc(st.err) + '<div style="margin-top:12px"><button class="btn sm" data-ai-act="reload">Try again</button></div>' : 'Loading analytics…') + '</div>'; return; }
  head = '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px"><div style="display:flex;gap:4px;flex-wrap:wrap">'
    + TABS.map(function(t){ var badge = t[0] === 'alerts' && d.kpis.alertsHigh ? ' <span style="background:var(--crit);color:#fff;border-radius:9px;padding:0 6px;font-size:11px">' + d.kpis.alertsHigh + '</span>' : ''; return '<button class="btn sm' + (st.tab === t[0] ? ' primary' : ' ghost') + '" data-ai-tab="' + t[0] + '">' + t[1] + badge + '</button>'; }).join('')
    + '</div><span style="margin-left:auto;font-size:12px;color:var(--muted)">' + (st.busy && st.busy !== 'ask' ? esc(st.busy) + '…' : 'Data: ' + esc(when(d.generatedAt))) + '</span><button class="btn sm" data-ai-act="refresh"' + (st.busy ? ' disabled' : '') + '>↻ Refresh now</button></div>';
  content.innerHTML = head + '<div id="aiBody"></div>';
  paintBody();
}
function paintBody(){
  var box = $('aiBody'), d = st.dash; if(!box || !d) return;
  killCharts();
  var t = st.tab, h = '';
  try{
    if(t === 'overview') h = vOverview(d); else if(t === 'sources') h = vGroups(d, 'src'); else if(t === 'team') h = vGroups(d, 'team');
    else if(t === 'leads') h = vList(d, 'lead'); else if(t === 'quotes') h = vList(d, 'quote'); else if(t === 'orders') h = vList(d, 'order');
    else if(t === 'alerts') h = vAlerts(d); else if(t === 'changes') h = vChanges(); else if(t === 'forecast') h = vForecast(d);
    else if(t === 'ask') h = vAsk(d); else if(t === 'settings') h = vSettings(d);
    else if(t === 'actions') h = vActions(d); else if(t === 'collect') h = vCollect(d); else if(t === 'marketing') h = vMarketing(d); else if(t === 'customers') h = vCustomers(d); else if(t === 'review') h = vReview(d);
  }catch(e){ h = '<div class="panel">Could not render this screen: ' + esc(e && e.message) + '</div>'; }
  box.innerHTML = h;
  try{ if(t === 'overview') cOverview(d); else if(t === 'sources') cGroups(d, 'src'); else if(t === 'team') cGroups(d, 'team'); }catch(e){}
  if(t === 'ask'){ var c = $('aiChat'); if(c) c.scrollTop = c.scrollHeight; }
}
function goTab(t){
  st.tab = t;
  var type = t === 'leads' ? 'lead' : t === 'quotes' ? 'quote' : t === 'orders' ? 'order' : '';
  if(type){ st.list = { type:type, category:'', source:'', owner:'', intent:'', q:'', page:0, sort:'priority', dir:'desc' }; paint(); loadList(); return; }
  if(t === 'changes'){ paint(); loadEvents(); return; }
  if(t === 'settings'){ paint(); loadMail(); return; }
  paint();
}
function askHistory(){ var out = [], c = st.chat, i; for(i = 0; i + 1 < c.length; i++){ if(c[i].me && !c[i + 1].me && c[i + 1].text.charAt(0) !== '⚠') out.push({ q:c[i].text, a:c[i + 1].text }); } return out.slice(-3); }
function ask(q){
  q = String(q || '').trim(); if(q.length < 3 || st.busy) return;
  st.chat.push({ me:true, text:q }); st.busy = 'ask'; paintBody();
  api('ai_ask', { q:q, history:askHistory() }, 20000).then(function(r){ st.busy = ''; st.chat.push({ me:false, text:(r && r.ok) ? String(r.answer || '') : '⚠ ' + errText(r) }); if(state.view === VIEW && st.tab === 'ask') paintBody(); });
}
function exportCsv(){
  var L = st.list; say('Preparing export…');
  api('ai_entities', { type:L.type, category:L.category, source:L.source, owner:L.owner, intent:L.intent, q:L.q, page:0, size:200, sort:L.sort, dir:L.dir }).then(function(r){
    if(!r || !r.ok || !(r.rows || []).length){ say('Nothing to export'); return; }
    var cols = ['id','name','phone','source','ownerName','status','category','reason','created','lastActivity','daysIdle','followUp','amount','linkId','aiIntent','aiScore','aiNext'];
    var csv = [cols.join(',')].concat(r.rows.map(function(x){ return cols.map(function(c){ var v = String(x[c] == null ? '' : x[c]); if(/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g,'""') + '"'; }).join(','); })).join('\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type:'text/csv' })); a.download = 'ai-' + L.type + 's-' + new Date().toISOString().slice(0,10) + '.csv'; a.click();
    if(r.total > 200) say('Exported the first 200 of ' + r.total + ' records. The full list is in the AI Analytics Sheet.');
  });
}

/* ------------------------------------------------------------------ events */
document.addEventListener('click', function(ev){
  if(typeof state === 'undefined' || state.view !== VIEW) return;
  var b = ev.target.closest && ev.target.closest('[data-ai-tab],[data-ai-act],[data-ai-period],[data-ai-cat],[data-ai-page],[data-ai-alert],[data-ai-ex],[data-ai-person],[data-ai-draft]');
  if(!b || b.disabled) return;
  var a;
  if((a = b.getAttribute('data-ai-tab'))) return goTab(a);
  if(b.hasAttribute('data-ai-period')){ st.period = b.getAttribute('data-ai-period'); return paintBody(); }
  if(b.hasAttribute('data-ai-cat')){ st.list.category = b.getAttribute('data-ai-cat'); st.list.page = 0; return loadList(); }
  if(b.hasAttribute('data-ai-page')){ st.list.page = Math.max(0, st.list.page + num(b.getAttribute('data-ai-page'))); return loadList(); }
  if(b.hasAttribute('data-ai-alert')){ st.alertType = b.getAttribute('data-ai-alert'); return paintBody(); }
  if((a = b.getAttribute('data-ai-ex'))) return ask(a);
  if(b.hasAttribute('data-ai-person')){ st.person = b.getAttribute('data-ai-person'); return paintBody(); }
  if((a = b.getAttribute('data-ai-draft'))) return openDraft(a, b.getAttribute('data-kind'));
  a = b.getAttribute('data-ai-act');
  if(a === 'reload'){ st.dash = null; st.err = null; return load(); }
  if(a === 'refresh') return act('ai_run', 'Refreshing');
  if(a === 'insights') return act('ai_insights_now', 'Generating insights');
  if(a === 'analyse') return act('ai_analyse_now', 'Analysing leads', null, function(r){ say((r.analysed || 0) + ' leads analysed'); st.dash = null; load(); });
  if(a === 'testKey') return act('ai_key_test', 'Testing key', null, function(r){ say('Key works ✓ (model: ' + (r.model || '') + ')'); paint(); });
  if(a === 'delKey'){ return act('ai_key_set', 'Removing key', { key:'' }); }
  if(a === 'saveKey'){ var k = ($('aiKeyIn') || {}).value || ''; k = k.trim(); if(k.length < 20){ say('Paste the full key'); return; } $('aiKeyIn').value = ''; return act('ai_key_set', 'Saving key', { key:k }); }
  if(a === 'saveSettings'){
    var s = {}; document.querySelectorAll('[data-ai-set]').forEach(function(el){ s[el.getAttribute('data-ai-set')] = el.value; });
    return act('ai_settings_set', 'Saving settings', { settings:s }, function(){ say('Settings saved — rebuilding data'); st.mail = null; act('ai_run', 'Refreshing'); });
  }
  if(a === 'ask'){ var q = $('aiAskQ'); if(q){ var v = q.value; q.value = ''; ask(v); } return; }
  if(a === 'csv') return exportCsv();
  if(a === 'weekly') return act('ai_weekly_now', 'Writing the review');
  if(a === 'mailTest') return act('ai_custmail_test', 'Sending test e-mail', null, function(r){ say('Test e-mail sent to ' + (r.to || 'you')); paint(); loadMail(); });
});
document.addEventListener('change', function(ev){
  if(typeof state === 'undefined' || state.view !== VIEW) return;
  var k = ev.target.getAttribute && ev.target.getAttribute('data-ai-f'); if(!k) return;
  st.list[k] = ev.target.value.trim(); st.list.page = 0; loadList();
});
document.addEventListener('keydown', function(ev){
  if(ev.key !== 'Enter' || typeof state === 'undefined' || state.view !== VIEW) return;
  if(ev.target.id === 'aiAskQ'){ var v = ev.target.value; ev.target.value = ''; ask(v); }
  else if(ev.target.getAttribute && ev.target.getAttribute('data-ai-f') === 'q'){ ev.target.blur(); }
});

/* ------------------------------------------------------------------ nav + view */
try{ if(typeof PAGE_META !== 'undefined') PAGE_META[VIEW] = ['Informatics Analytics', 'Leads, quotations and orders — rules + AI insights (Administrators only)']; }catch(e){}
function addNav(){
  try{
    var nav = document.querySelector('.nav') || $('nav'); if(!nav) return;
    var have = nav.querySelector('a[data-view="' + VIEW + '"]');
    if(!isAdmin()){ if(have) have.style.display = 'none'; return; }
    if(have){ have.style.display = ''; return; }
    var after = nav.querySelector('a[data-view="dashboard"]'); if(!after) return;
    var a = document.createElement('a');
    a.setAttribute('data-view', VIEW);
    a.innerHTML = ((typeof I !== 'undefined' && I.dash) ? I.dash : '') + '<span>Informatics Analytics</span>';
    a.addEventListener('click', function(){ setView(VIEW); });
    after.parentNode.insertBefore(a, after.nextSibling);
  }catch(e){}
}
addNav(); [300, 1200, 3000, 8000].forEach(function(t){ setTimeout(addNav, t); });
(function(){
  var _setView = window.setView;
  if(typeof _setView !== 'function') return;
  window.setView = function(v){
    if(v !== VIEW){ try{ addNav(); }catch(e){} return _setView.apply(this, arguments); }
    if(!isAdmin()){ say('This screen is for Administrators only'); return _setView.call(this, 'dashboard'); }
    try{ state.view = VIEW; }catch(e){}
    try{
      document.querySelectorAll('.nav a').forEach(function(x){ x.classList.toggle('active', x.dataset.view === VIEW); });
      var t = $('pageTitle'), s = $('pageSub');
      if(t && t.childNodes[0]) t.childNodes[0].nodeValue = PAGE_META[VIEW][0];
      if(s) s.textContent = PAGE_META[VIEW][1];
      var sb = $('searchBox'); if(sb) sb.style.display = 'none';
      var qa = $('quickAdd'); if(qa) qa.style.display = 'none';
      killCharts();
    }catch(e){}
    try{ localStorage.setItem('oc_lastView', VIEW); }catch(e){}
    paint();
    if(!st.dash || (Date.now() - new Date(st.dash.generatedAt).getTime()) > 5 * 60000 || st.err) load();
    try{ content.scrollTop = 0; }catch(e){}
    try{ if(typeof navOpen === 'function') navOpen(false); }catch(e){}
    return true;
  };
})();

/* ===========================================================================
   LOSS REASON (required): when a lead / enquiry is changed to Lost or
   Not Qualified, ask why. Stored on the record as lossReason / lossNote.
   Works for Meta, GEM, IndiaMART and Enquiries because all of them save
   through store.set(). Records that arrive from the server are not asked.
   =========================================================================== */
var LOSS_REASONS = ['Price / budget','Bought elsewhere / competitor','No response','Not required / not interested','Wrong / irrelevant lead','Location / delivery','Small quantity / retail','Product not available','Other'];
var LOSS_KEYS = { metaLeads:1, indiamartLeads:1, enquiries:1 }, lossBusy = false, lossQueue = [];
function lostCode(r, k){ var v = k === 'enquiries' ? (r && r.stage) : (r && (r.lead_status != null ? r.lead_status : r.stage)); v = String(v == null ? '' : v).trim().toUpperCase().replace(/[\s\-]+/g, '_'); return (v === 'LOST' || v === 'NOT_QUALIFIED') ? v : ''; }
function lossAsk(){
  if(lossBusy || !lossQueue.length) return;
  var job = lossQueue.shift(); lossBusy = true;
  var ov = document.createElement('div'); ov.id = 'aiLossOv';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px';
  ov.innerHTML = '<div style="background:var(--surface);color:var(--text);border-radius:14px;max-width:440px;width:100%;padding:20px;box-shadow:0 10px 40px rgba(0,0,0,.3)">'
    + '<h3 style="font-size:16px;font-weight:700;margin:0 0 4px">Why ' + (job.ids.length > 1 ? 'were these ' + job.ids.length + ' leads' : 'was this lead') + ' marked ' + (job.code === 'LOST' ? 'Lost' : 'Not Qualified') + '?</h3>'
    + '<div style="font-size:12.5px;color:var(--muted);margin-bottom:12px">' + esc(job.names.slice(0, 3).join(', ')) + (job.names.length > 3 ? ' +' + (job.names.length - 3) + ' more' : '') + '</div>'
    + '<label>Reason <span style="color:var(--crit)">*</span></label><select id="aiLossSel" style="width:100%"><option value="">-- Select a reason --</option>' + LOSS_REASONS.map(function(r){ return '<option>' + esc(r) + '</option>'; }).join('') + '</select>'
    + '<label style="margin-top:10px;display:block">Note <span id="aiLossReq" style="font-weight:500;font-size:11px;color:var(--muted)">(optional)</span></label><input id="aiLossNote" maxlength="200" style="width:100%" placeholder="One line, if useful">'
    + '<div style="margin-top:14px;text-align:right"><button class="btn primary" id="aiLossOk">Save reason</button></div></div>';
  document.body.appendChild(ov);
  var sel = ov.querySelector('#aiLossSel'), note = ov.querySelector('#aiLossNote');
  sel.addEventListener('change', function(){ ov.querySelector('#aiLossReq').textContent = sel.value === 'Other' ? '(required for Other)' : '(optional)'; });
  ov.querySelector('#aiLossOk').addEventListener('click', function(){
    var r = sel.value, n = note.value.trim();
    if(!r){ say('Select a reason'); return; }
    if(r === 'Other' && n.length < 3){ say('Write a short note for "Other"'); return; }
    try{
      var arr = store.get(job.key, []) || [], want = {}, now = new Date().toISOString(), hit = 0, me = '';
      try{ me = (AUTH.current() || {}).email || ''; }catch(e){}
      job.ids.forEach(function(id){ want[String(id)] = 1; });
      arr.forEach(function(x){ if(x && want[String(x.id)] && lostCode(x, job.key)){ x.lossReason = r; x.lossNote = n; x.lossReasonAt = now; x.lossReasonBy = me; x.updatedAt = now; hit++; } });
      if(hit){ lossSkip = true; try{ store.set(job.key, arr); } finally { lossSkip = false; } }
    }catch(e){}
    try{ ov.remove(); }catch(e){}
    lossBusy = false; say('Reason saved'); lossAsk();
  });
  setTimeout(function(){ try{ sel.focus(); }catch(e){} }, 50);
}
var lossSkip = false, lastUserAct = 0;
['click','keydown','change'].forEach(function(evn){ document.addEventListener(evn, function(){ lastUserAct = Date.now(); }, true); });
(function(){
  try{
    if(typeof store === 'undefined' || typeof store.set !== 'function' || store.set.__ocLoss) return;
    var _set = store.set;
    var w = function(k, val){
      var job = null;
      try{
        if(!lossSkip && LOSS_KEYS[k] && Array.isArray(val) && val.length && Date.now() - lastUserAct < 5000){   /* only right after the user did something; background syncs never ask */
          var prevArr = store.get(k, []) || [], prev = {}, i, r, c;
          if(prevArr.length){                                   /* first load / empty cache: nothing to compare */
            for(i = 0; i < prevArr.length; i++){ r = prevArr[i]; if(r && r.id != null) prev[String(r.id)] = lostCode(r, k) || '-'; }
            for(i = 0; i < val.length; i++){
              r = val[i]; if(!r || r.id == null) continue; c = lostCode(r, k);
              if(c && !r.lossReason && prev[String(r.id)] && prev[String(r.id)] !== c){
                job = job || { key:k, code:c, ids:[], names:[] };
                if(c === job.code){ job.ids.push(r.id); job.names.push(String(r.full_name || r.name || r.sender_name || r.company || r.customer || r.id)); }
              } else if(!c && r.lossReason && prev[String(r.id)] && prev[String(r.id)] !== '-'){ r.lossReason = ''; r.lossNote = ''; }   /* re-opened lead */
            }
          }
        }
      }catch(e){ job = null; }
      var out = _set.apply(this, arguments);
      if(job && job.ids.length && job.ids.length <= 200){ lossQueue.push(job); setTimeout(lossAsk, 80); }
      return out;
    };
    w.__ocLoss = true; store.set = w;
  }catch(e){}
})();

/* ===========================================================================
   ORDER FORM: "Linked Lead / Quotation"
   Order kis lead / quotation se bana -- ye pakka link analytics ko sahi
   conversion deta hai. Field optional hai; order ki koi aur cheez nahi chhuta.
   =========================================================================== */
var pend = null;
function ph10(v){ var d = String(v == null ? '' : v).replace(/\D/g,''); return d.length >= 10 ? d.slice(-10) : ''; }
function ls(k){ try{ var a = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(a) ? a : []; }catch(e){ return []; } }
function linkOptions(custId){
  var out = [], cust = null, p = '', nm = '';
  var key = String(custId || '').trim().toLowerCase();
  try{ cust = (DB.customers() || []).filter(function(c){ return c && (String(c.id) === String(custId) || String(c.name || '').trim().toLowerCase() === key); })[0] || null; }catch(e){}
  if(cust) custId = cust.id; else nm = key;
  if(cust){ p = ph10(cust.phone || cust.mobile); nm = String(cust.name || '').trim().toLowerCase(); }
  var push = function(kind, src, id, label, hit){ out.push({ kind:kind, src:src, id:String(id), label:label, hit:hit }); };
  try{ (DB.quotations() || []).forEach(function(q){ var qb = q.qb || {}, qp = ph10(qb.cph), qn = String(q.customer || qb.co || '').trim().toLowerCase();
    push('quote','quotations', q.id, (qb.qno || q.id) + ' · ' + (q.customer || qb.co || '') + ' · ' + inr(q.amount), !!((p && qp === p) || (nm && qn === nm) || (custId && q.custId === custId))); }); }catch(e){}
  try{ (DB.enquiries() || []).forEach(function(x){ push('lead','enquiries', x.id, x.id + ' · ' + (x.customer || '') + ' · ' + (x.source || 'Enquiry'), !!(custId && x.custId === custId)); }); }catch(e){}
  if(p){
    ls('metaLeads').forEach(function(x){ if(ph10(x.phone_number || x.phone) === p) push('lead','metaLeads', x.id, x.id + ' · ' + (x.full_name || x.name || '') + ' · ' + (String(x.platform || '').toLowerCase() === 'gem' ? 'GEM' : 'Meta'), true); });
    ls('indiamartLeads').forEach(function(x){ if(ph10(x.sender_mobile) === p) push('lead','indiamartLeads', x.id, x.id + ' · ' + (x.sender_name || '') + ' · IndiaMART', true); });
  }
  out.sort(function(a, b){ return (b.hit ? 1 : 0) - (a.hit ? 1 : 0); });
  return out;
}
function fillLinks(order){
  var qs = $('o-linkq'), lsEl = $('o-linkl'); if(!qs || !lsEl) return;
  var custEl = $('o-cust'), opts = linkOptions((custEl && custEl.value) || (order && (order.custId || order.customer)) || '');
  var curQ = qs.getAttribute('data-cur') || '', curL = lsEl.getAttribute('data-cur') || '';
  var build = function(kind, cur){
    var mine = opts.filter(function(o){ return o.kind === kind; }), hit = mine.filter(function(o){ return o.hit; }), rest = mine.filter(function(o){ return !o.hit; }).slice(-150).reverse();
    var one = function(o){ return '<option value="' + esc(o.id) + '" data-src="' + o.src + '"' + (o.id === cur ? ' selected' : '') + '>' + esc(o.label) + '</option>'; };
    var h = '<option value="">— none —</option>';
    if(cur && !mine.some(function(o){ return o.id === cur; })) h += '<option value="' + esc(cur) + '" selected>' + esc(cur) + '</option>';
    if(hit.length) h += '<optgroup label="Matches this customer">' + hit.map(one).join('') + '</optgroup>';
    if(rest.length) h += '<optgroup label="' + (kind === 'quote' ? 'Other quotations (newest first)' : 'Other enquiries (newest first)') + '">' + rest.map(one).join('') + '</optgroup>';
    return h;
  };
  qs.innerHTML = build('quote', curQ); lsEl.innerHTML = build('lead', curL);
}
function injectLink(id){
  try{
    var note = $('o-note'); if(!note || $('o-linkq')) return;
    var row = note.closest('.form-row'); if(!row) return;
    var o = {}; try{ o = (DB.orders() || []).filter(function(x){ return x.id === id; })[0] || {}; }catch(e){}
    var div = document.createElement('div'); div.className = 'form-row two'; div.id = 'o-link-row';
    div.innerHTML = '<div><label>Linked Quotation <span style="font-weight:500;font-size:10.5px;color:var(--muted)">(optional)</span></label><select id="o-linkq" data-cur="' + esc(o.quoteId || '') + '"></select></div>'
      + '<div><label>Linked Lead <span style="font-weight:500;font-size:10.5px;color:var(--muted)">(the lead this order came from)</span></label><select id="o-linkl" data-cur="' + esc(o.leadRef || '') + '"></select></div>';
    row.parentNode.insertBefore(div, row);
    var dd = document.createElement('div'); dd.className = 'form-row'; dd.style.marginTop = '-6px';
    dd.innerHTML = '<label style="display:flex;gap:8px;align-items:center;font-weight:500"><input type="checkbox" id="o-linkdirect" style="width:auto"' + (o.leadSrc === 'direct' ? ' checked' : '') + '> Direct order (no lead or quotation)' + (id ? '' : ' <span style="font-size:10.5px;color:var(--muted)">— one of the three is required for a new order</span>') + '</label>';
    row.parentNode.insertBefore(dd, row);
    fillLinks(o);
    ['o-linkq','o-linkl'].forEach(function(k){ $(k).addEventListener('change', function(){ this.setAttribute('data-cur', this.value); }); });
    var cust = $('o-cust'); if(cust) cust.addEventListener('change', function(){ fillLinks(o); });
    div.setAttribute('data-oid', id || '');
  }catch(e){}
}
(function(){
  var _oom = window.openOrderModal;
  if(typeof _oom !== 'function') return;
  window.openOrderModal = function(id){
    var r = _oom.apply(this, arguments);
    setTimeout(function(){ injectLink(id || ''); }, 0); setTimeout(function(){ injectLink(id || ''); }, 150);
    return r;
  };
})();
/* Save dabate hi form ka link yaad rakho; asli likhai DB.save('orders') ke andar hoti hai */
document.addEventListener('click', function(ev){
  try{
    var row = $('o-link-row'); if(!row) return;
    var b = ev.target.closest && ev.target.closest('button'); if(!b || !/saveOrder\(/.test(b.getAttribute('onclick') || '')) return;
    var q = $('o-linkq'), l = $('o-linkl'), lo = l.options[l.selectedIndex], known = {}, dr = $('o-linkdirect');
    if(!(row.getAttribute('data-oid') || '') && !q.value && !l.value && !(dr && dr.checked)){
      ev.preventDefault(); ev.stopImmediatePropagation(); pend = null;
      say('Choose the Linked Lead or Quotation, or tick "Direct order (no lead)"');
      try{ row.scrollIntoView({ block:'center' }); row.style.outline = '2px solid var(--crit)'; setTimeout(function(){ row.style.outline = ''; }, 2500); }catch(e2){}
      return;
    }
    (DB.orders() || []).forEach(function(x){ known[x.id] = 1; });
    pend = { id: row.getAttribute('data-oid') || '', quoteId: q.value || '', leadRef: l.value || '', leadSrc: l.value ? ((lo && lo.getAttribute('data-src')) || '') : ((dr && dr.checked) ? 'direct' : ''), known: known, at: Date.now() };
  }catch(e){ pend = null; }
}, true);
(function(){
  try{
    if(typeof DB === 'undefined' || typeof DB.save !== 'function' || DB.save.__ocAiLink) return;
    var _save = DB.save;
    var w = function(k, v){
      try{
        if(k === 'orders' && pend && Array.isArray(v) && Date.now() - pend.at < 120000){
          var t = null, i;
          if(pend.id){ for(i = 0; i < v.length; i++) if(v[i] && v[i].id === pend.id){ t = v[i]; break; } }
          else { var fresh = v.filter(function(x){ return x && !pend.known[x.id]; }); if(fresh.length === 1) t = fresh[0]; }
          if(t){
            if((t.quoteId || '') !== pend.quoteId) t.quoteId = pend.quoteId;
            if((t.leadRef || '') !== pend.leadRef || (t.leadSrc || '') !== pend.leadSrc){ t.leadRef = pend.leadRef; t.leadSrc = pend.leadSrc; }
            pend = null;
          }
        }
      }catch(e){}
      return _save.apply(this, arguments);
    };
    w.__ocAiLink = true;
    DB.save = w;
  }catch(e){}
})();
})();
