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
var TABS = [['overview','Overview'],['leads','Leads'],['sources','Sources'],['team','Salespeople'],['quotes','Quotations'],['orders','Orders & Dispatch'],
            ['alerts','Alerts'],['changes','Change Log'],['forecast','Forecast'],['ask','Ask AI'],['settings','Settings']];
var PERIODS = [['all','All time'],['month','This month'],['d7','Last 7 days'],['d30','Last 30 days'],['d90','Last 90 days']];
var st = { tab:'overview', period:'all', dash:null, err:null, loading:false, list:{ type:'lead', category:'', source:'', owner:'', intent:'', q:'', page:0, sort:'priority', dir:'desc' },
           rows:null, total:0, events:null, chat:[], busy:'', alertType:'' };

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
function api(action, extra){
  var body = { action: action }; if(extra) for(var k in extra) body[k] = extra[k];
  return fetch(CLOUD.url, { method:'POST', redirect:'follow', headers:{ 'Content-Type':'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
    .then(function(r){ return r.json(); })
    .catch(function(e){ return { ok:false, error:'network', hint:String(e && e.message || e) }; });
}
function errText(r){
  var e = (r && r.error) || 'error', h = (r && r.hint) || '';
  var map = { unauthorized:'Session khatam ho gaya — dobara login karein', forbidden:'Ye screen sirf Administrator ke liye hai', not_ready:'Backend setup baaki hai (ai_setup)',
    no_key:'Gemini API key abhi daali nahi gayi (Settings tab)', ai_off:'AI Settings me band hai', daily_cap:'Aaj ki AI call limit poori ho gayi', busy:'Refresh pehle se chal raha hai',
    network:'Network error', gemini_http:'Gemini ne error diya', gemini_bad_json:'Gemini ka jawab samajh nahi aaya', bad_key:'Key galat lag rahi hai', empty:'Sawaal likhiye' };
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
  if(!rows.length) return '<div style="padding:26px;text-align:center;color:var(--muted)">' + esc(empty || 'Koi data nahi') + '</div>';
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
    paint(); if(force && st.dash && !st.err) say('Data taaza ho gaya');
  });
}
function act(action, label, extra, after){
  if(st.busy) return; st.busy = label; paint();
  api(action, extra).then(function(r){
    st.busy = '';
    if(r && r.ok){ if(after) after(r); else { say(label + ' — ho gaya'); st.dash = null; load(); } }
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
    + kpi('Open leads', k.openLeads, k.newToday + ' aaj nayi · ' + k.new7 + ' is hafte')
    + kpi('Follow-up overdue', k.followOverdue, k.followToday + ' aaj due', k.followOverdue ? '--crit' : '')
    + kpi('Untouched leads', k.untouched, d.settings.untouchedHours + ' ghante se bina response', k.untouched ? '--crit' : '')
    + kpi('Open quotations', k.openQuotes, inrShort(k.openQuoteValue) + ' · ' + k.quoteFollow + ' follow-up baaki')
    + kpi('Delayed orders', k.delayedOrders, k.atRiskOrders + ' at risk · ' + k.openOrders + ' open', k.delayedOrders ? '--crit' : '')
    + kpi('Billing (this month)', inrShort(k.monthBilling), k.monthOrders + ' orders · GST sahit')
    + '</div><div class="kpi-grid kpi-6">'
    + kpi('Total leads', k.leads, 'Lead → order ' + k.leadConvPct + '%')
    + kpi('Hot leads', k.hot, k.warm + ' warm')
    + kpi('Inactive leads', k.inactive, d.settings.inactiveDays + '+ din se koi kaam nahi')
    + kpi('Quote → order', k.quoteConvPct + '%', k.quotes + ' quotations · ' + k.quoteExpired + ' expired')
    + kpi('Payment pending', inrShort(k.payPendingValue), k.payPending + ' delivered orders')
    + kpi('Alerts', k.alerts, k.alertsHigh + ' high', k.alertsHigh ? '--crit' : '')
    + '</div>';
  var insHtml = ins.length
    ? ins.map(function(x){ var s = SEV[x.severity] || SEV.medium; return '<div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)"><span style="width:8px;height:8px;border-radius:50%;background:' + s[0] + ';margin-top:6px;flex:none"></span><div><div style="font-weight:700">' + esc(x.title) + '</div><div style="font-size:13px;color:var(--text-2)">' + esc(x.detail) + '</div></div></div>'; }).join('')
      + '<div style="font-size:11.5px;color:var(--muted);margin-top:8px">Gemini ne likha · ' + esc(when(d.insightsAt)) + ' · numbers upar ke data se</div>'
    : '<div style="padding:18px 0;color:var(--muted);font-size:13px">' + (d.keySet ? 'Abhi koi insight nahi bani. "AI insights banao" dabayein.' : 'AI insights ke liye Settings tab me Gemini API key daalein. Baaki sab numbers bina AI ke chal rahe hain.') + '</div>';
  var top = (d.alerts || []).slice(0, 8);
  h += '<div class="grid-2">' + panel('Aaj kis par dhyan dein (AI insights)', insHtml + '<div style="margin-top:10px"><button class="btn sm" data-ai-act="insights"' + (d.keySet ? '' : ' disabled') + '>AI insights banao</button></div>')
    + panel('Sabse zaroori alerts', table(['Type','Record','Kya hua'], top.map(function(a){ return [chip(a.type.replace(/^Order |^Quotation /,'')) , '<b>' + esc(a.name || a.id) + '</b><div style="font-size:11.5px;color:var(--muted)">' + esc(a.id) + ' · ' + esc(a.owner || '—') + '</div>', esc(a.title)]; }), 'Koi alert nahi 🎉')) + '</div>';
  h += '<div class="grid-2">' + panel('Leads — hafte dar hafte (source wise)', chartBox('aiWeeks'), 'Pichhle 12 hafte') + panel('Lead funnel', chartBox('aiFunnel'), 'Abhi kis stage par kitni leads') + '</div>';
  h += '<div class="grid-2">' + panel('Billing — mahine dar mahine', chartBox('aiMonths'), 'GST sahit, cancelled orders chhod kar') + panel('Billing kis source se aayi', chartBox('aiRev'), 'Order ↔ lead link: ' + d.linkStats.explicit + ' pakka, ' + d.linkStats.phone + ' phone se, ' + d.linkStats.customer + ' customer se, ' + d.linkStats.none + ' bina link') + '</div>';
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
function periodBar(){ return '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">' + PERIODS.map(function(p){ return '<button class="btn sm' + (st.period === p[0] ? ' primary' : ' ghost') + '" data-ai-period="' + p[0] + '">' + p[1] + '</button>'; }).join('') + '<span style="align-self:center;font-size:12px;color:var(--muted);margin-left:6px">Period = lead kab aayi</span></div>'; }
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
    + '<div class="card"><div class="card-head"><h3>' + (which === 'team' ? 'Salesperson performance' : 'Source performance') + '</h3></div>' + table(head, body, 'Is period me koi lead nahi') + '</div>'
    + (which === 'team' ? '<div style="font-size:12px;color:var(--muted);margin-top:8px">Quotes / Orders / Billing hamesha all-time hain (order ki apni date se nahi, salesperson se jude).</div>' : '');
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
  if(st.rows == null) body = '<div style="padding:30px;text-align:center;color:var(--muted)">Load ho raha hai…</div>';
  else {
    var heads = type === 'lead' ? ['Lead','Source','Salesperson','Status','Category','Kyon','>Idle days','Follow-up','AI']
      : type === 'quote' ? ['Quotation','Salesperson','Status','Category','Kyon','>Amount','Valid till','Linked order']
      : ['Order','Source','Salesperson','Status','Category','Kyon','>Amount','Expected','Linked lead'];
    body = table(heads, st.rows.map(function(r){
      var who = '<b>' + esc(r.name || '—') + '</b><div style="font-size:11.5px;color:var(--muted)">' + esc(r.id) + (r.phone ? ' · ' + esc(r.phone) : '') + (r.city ? ' · ' + esc(r.city) : '') + '</div>';
      var link = r.linkId ? esc(r.linkId) + ' <span style="font-size:11px;color:var(--muted)">(' + (num(r.linkConf) >= 1 ? 'pakka' : num(r.linkConf) >= 0.8 ? 'phone match' : 'customer match') + ')</span>' : '<span style="color:var(--muted)">—</span>';
      var ai = r.aiIntent ? chip(r.aiIntent) + (r.aiScore !== '' ? ' <span class="tabular" style="font-size:11.5px;color:var(--muted)">' + esc(r.aiScore) + '</span>' : '') + (r.aiNext ? '<div style="font-size:12px;margin-top:3px">' + esc(r.aiNext) + '</div>' : '') : '<span style="color:var(--muted)">—</span>';
      if(type === 'lead') return [who, esc(r.source), esc(r.ownerName || 'Unassigned'), esc(r.status), chip(r.category), esc(r.reason), r.daysIdle, esc(r.followUp || '—'), ai];
      if(type === 'quote') return [who, esc(r.ownerName || '—'), esc(r.status), chip(r.category), esc(r.reason), inr(r.amount), esc(r.followUp || '—'), link];
      return [who, esc(r.source || '—'), esc(r.ownerName || '—'), esc(r.status), chip(r.category), esc(r.reason), inr(r.amount), esc(r.followUp || '—'), link];
    }), 'Is filter me kuch nahi mila');
    var pages = Math.ceil(st.total / 50);
    body += '<div style="display:flex;gap:10px;align-items:center;padding:12px 20px;border-top:1px solid var(--border);font-size:13px"><span>' + st.total + ' records</span><span style="margin-left:auto"></span>'
      + '<button class="btn sm ghost" data-ai-page="-1"' + (L.page <= 0 ? ' disabled' : '') + '>‹ Prev</button><span>Page ' + (L.page + 1) + ' / ' + Math.max(1, pages) + '</span><button class="btn sm ghost" data-ai-page="1"' + (L.page + 1 >= pages ? ' disabled' : '') + '>Next ›</button></div>';
  }
  return catBar(cats, type) + '<div class="card"><div class="card-head"><h3>' + (type === 'lead' ? 'Leads' : type === 'quote' ? 'Quotations' : 'Orders') + '</h3><div class="tools">' + tools + '</div></div>' + body + '</div>'
    + (type === 'order' ? '<div style="font-size:12px;color:var(--muted);margin-top:8px">"Tracking Pending" = dispatch row auto bani hai, asli courier / tracking number abhi nahi bhara (Alerts tab dekhein).</div>' : '');
}
function vAlerts(d){
  var all = d.alerts || [], types = d.alertCounts || {}, list = st.alertType ? all.filter(function(a){ return a.type === st.alertType; }) : all;
  var bar = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px"><button class="btn sm' + (st.alertType === '' ? ' primary' : ' ghost') + '" data-ai-alert="">All <b>' + d.kpis.alerts + '</b></button>'
    + Object.keys(types).map(function(t){ return '<button class="btn sm' + (st.alertType === t ? ' primary' : ' ghost') + '" data-ai-alert="' + esc(t) + '">' + esc(t) + ' <b>' + types[t] + '</b></button>'; }).join('') + '</div>';
  return bar + '<div class="card">' + table(['Severity','Type','Record','Salesperson','Source','Kya hua','>Amount'], list.map(function(a){
    var s = SEV[a.sev] || SEV.low;
    return ['<span style="color:' + s[0] + ';font-weight:700">● ' + s[1] + '</span>', esc(a.type), '<b>' + esc(a.name || '—') + '</b><div style="font-size:11.5px;color:var(--muted)">' + esc(a.id) + '</div>', esc(a.owner || '—'), esc(a.source || '—'), esc(a.title), a.amount ? inr(a.amount) : '—'];
  }), 'Koi alert nahi 🎉') + '</div>' + (all.length >= 300 ? '<div style="font-size:12px;color:var(--muted);margin-top:8px">Sirf top 300 alerts dikh rahe hain (ginti poori hai).</div>' : '');
}
function vChanges(){
  if(st.events == null) return '<div class="panel" style="text-align:center;color:var(--muted)">Load ho raha hai…</div>';
  return '<div class="card"><div class="card-head"><h3>Change log</h3><div class="tools"><span style="font-size:12px;color:var(--muted)">Har 15 minute me CRM ka snapshot milaya jaata hai · latest 200</span></div></div>'
    + table(['Kab','Record','Naam','Kya badla','Pehle','Ab','Salesperson'], st.events.map(function(e){ return [esc(when(e.ts)), esc(e.id), esc(e.name || '—'), esc(e.field), esc(e.from === '' ? '—' : e.from), '<b>' + esc(e.to === '' ? '—' : e.to) + '</b>', esc(e.owner || '—')]; }), 'Abhi tak koi change record nahi hua') + '</div>';
}
function vForecast(d){
  var p = d.pred || {}, rr = p.runRate || {};
  var h = '<div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">'
    + kpi('Is mahine billing (run-rate)', inrShort(rr.billing), 'Din ' + rr.dayOfMonth + ' / ' + rr.daysInMonth + ' · abhi tak ' + inrShort(d.kpis.monthBilling))
    + kpi('Is mahine orders (run-rate)', rr.orders, 'Abhi tak ' + d.kpis.monthOrders)
    + kpi('Is mahine leads (run-rate)', rr.leads, 'Isi raftaar se') + '</div>';
  h += p.enough
    ? '<div class="kpi-grid" style="grid-template-columns:repeat(2,1fr)">' + kpi('Open leads se expected orders', p.expectedConversions, 'Pichhle 90 din ka conversion ' + p.convRate90 + '% × open leads') + kpi('History', p.historyDays + ' din', 'Forecast ke liye kaafi') + '</div>'
    : '<div class="panel" style="border-left:4px solid var(--warn)"><b>Insufficient data</b><div style="font-size:13px;color:var(--text-2);margin-top:4px">CRM me abhi sirf ' + (p.historyDays || 0) + ' din ki history hai. Conversion forecast ke liye kam se kam 90 din chahiye — tab tak sirf upar ka run-rate dikhaya ja raha hai, koi andaaza nahi.</div></div>';
  return h + '<div style="font-size:12px;color:var(--muted);margin-top:10px">Run-rate = (is mahine ab tak) ÷ (beete din) × (mahine ke din). Ye seedha hisaab hai, AI ka andaaza nahi.</div>';
}
function vAsk(d){
  var ex = ['Is hafte sabse zyada leads kis source se aayi?','Kaun se salesperson ke paas sabse zyada overdue follow-up hain?','Delayed orders kaun se hain?','Is mahine billing kitni hui?'];
  var msgs = st.chat.map(function(m){ return '<div style="display:flex;justify-content:' + (m.me ? 'flex-end' : 'flex-start') + ';margin:8px 0"><div style="max-width:78%;padding:10px 14px;border-radius:14px;white-space:pre-wrap;font-size:14px;'
    + (m.me ? 'background:var(--brand);color:#fff' : 'background:var(--surface-2);border:1px solid var(--border)') + '">' + esc(m.text) + '</div></div>'; }).join('');
  return '<div class="panel">' + (d.keySet ? '' : '<div style="padding:10px 12px;border-radius:10px;background:color-mix(in srgb,var(--warn) 14%,transparent);font-size:13px;margin-bottom:12px">Ask AI ke liye Settings tab me Gemini API key daalein.</div>')
    + '<div id="aiChat" style="min-height:160px;max-height:440px;overflow-y:auto">' + (msgs || '<div style="color:var(--muted);font-size:13px;padding:8px 0">CRM ke numbers ke baare me kuch bhi poochiye. Jawab sirf is screen ke data se banta hai; record ka ID likhenge (jaise ORD-…) to us record ki detail bhi dekhi jaayegi.</div>') + (st.busy === 'ask' ? '<div style="color:var(--muted);font-size:13px">Soch raha hai…</div>' : '') + '</div>'
    + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:10px 0">' + ex.map(function(q){ return '<button class="btn sm ghost" data-ai-ex="' + esc(q) + '">' + esc(q) + '</button>'; }).join('') + '</div>'
    + '<div style="display:flex;gap:8px"><input id="aiAskQ" maxlength="600" placeholder="Sawaal likhiye…" style="flex:1"><button class="btn primary" data-ai-act="ask">Poochho</button></div>'
    + '<div style="font-size:11.5px;color:var(--muted);margin-top:8px">AI sirf padh sakta hai — CRM me kuch badal nahi sakta. Phone number AI ko nahi bheje jaate.</div></div>';
}
function vSettings(d){
  var S = d.settings || {};
  var n = function(key, lbl, hint){ return '<div><label>' + lbl + '</label><input type="number" min="0" data-ai-set="' + key + '" value="' + esc(S[key]) + '"><div style="font-size:11.5px;color:var(--muted);margin-top:3px">' + hint + '</div></div>'; };
  return '<div class="grid-2"><div class="panel"><h3 style="font-size:15px;font-weight:700;margin:0 0 12px">Rules (bina AI ke chalte hain)</h3>'
    + '<div class="form-row two">' + n('untouchedHours','Untouched — ghante','Nayi lead par itne ghante me response nahi') + n('inactiveDays','Inactive — din','Itne din se lead par koi kaam nahi') + '</div>'
    + '<div class="form-row two">' + n('hotDays','Hot — din','Qualified / quoted lead itne din ke andar active') + n('quoteFollowDays','Quotation follow-up — din','Quotation bhejne ke itne din baad') + '</div>'
    + '<div class="form-row two">' + n('atRiskDays','Order at risk — din','Expected date se itne din pehle, abhi ready nahi') + n('payPendingDays','Payment pending — din','Delivery ke itne din baad bhi payment baaki') + '</div>'
    + '<div class="form-row two">' + n('gstPct','GST %','Billing = amount + GST') + '<div><label>Daily summary email</label><input type="email" data-ai-set="summaryEmail" value="' + esc(S.summaryEmail || '') + '" placeholder="khaali = email nahi"><div style="font-size:11.5px;color:var(--muted);margin-top:3px">Roz subah 9 baje</div></div></div>'
    + '<button class="btn primary" data-ai-act="saveSettings">Save settings</button></div>'
    + '<div class="panel"><h3 style="font-size:15px;font-weight:700;margin:0 0 12px">Gemini AI</h3>'
    + '<div style="font-size:13px;margin-bottom:10px">API key: ' + (d.keySet ? '<b style="color:var(--good-ink)">Saved ✓</b>' : '<b style="color:var(--crit)">Abhi nahi daali</b>') + '</div>'
    + '<div class="form-row"><label>' + (d.keySet ? 'Nayi key (badalni ho to)' : 'Gemini API key') + '</label><input type="password" id="aiKeyIn" autocomplete="off" placeholder="AI Studio se bani key yahan paste karein">'
    + '<div style="font-size:11.5px;color:var(--muted);margin-top:3px">Key seedha Google Apps Script ke Script Properties me jaati hai. Browser, Sheet ya GitHub me kahin save nahi hoti aur dobara dikhai nahi jaati.</div></div>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px"><button class="btn primary sm" data-ai-act="saveKey">Save key</button><button class="btn sm" data-ai-act="testKey"' + (d.keySet ? '' : ' disabled') + '>Test key</button>' + (d.keySet ? '<button class="btn sm ghost" style="color:var(--crit)" data-ai-act="delKey">Key hatao</button>' : '') + '</div>'
    + '<div class="form-row two"><div><label>AI chalu</label><select data-ai-set="aiEnabled"><option value="true"' + (S.aiEnabled ? ' selected' : '') + '>On</option><option value="false"' + (S.aiEnabled ? '' : ' selected') + '>Off</option></select></div>' + n('dailyAiCalls','Roz ki max AI calls','Kharch par lagaam') + '</div>'
    + '<div class="form-row two"><div><label>Model</label><input data-ai-set="model" value="' + esc(S.model || '') + '" placeholder="khaali = auto (flash)"></div>' + n('batch','Ek call me leads','5 – 30') + '</div>'
    + '<div style="font-size:12.5px;color:var(--text-2);margin-bottom:10px">AI analysis ke liye baaki leads: <b>' + (d.aiPending || 0) + '</b> (sirf wo open leads jinme remark likha hai)</div>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" data-ai-act="analyse"' + (d.keySet ? '' : ' disabled') + '>Abhi leads analyse karo</button><button class="btn sm" data-ai-act="insights"' + (d.keySet ? '' : ' disabled') + '>AI insights banao</button></div></div></div>'
    + '<div class="panel"><h3 style="font-size:15px;font-weight:700;margin:0 0 8px">System</h3><div style="font-size:13px;color:var(--text-2);line-height:1.7">Backend version ' + esc(d.ver) + ' · last refresh ' + esc(when(d.generatedAt)) + ' (' + esc(d.why || '') + ', ' + (d.ms || 0) + ' ms)<br>'
    + 'Records: ' + Object.keys(d.counts || {}).map(function(k){ return esc(k) + ' ' + d.counts[k]; }).join(' · ') + '<br>'
    + (d.sheetUrl ? '<a href="' + esc(d.sheetUrl) + '" target="_blank" rel="noopener">AI Analytics Google Sheet kholein ↗</a> (AI_Entity_Master, AI_Event_Log, AI_API_Logs…)' : '') + '</div></div>';
}
function vInstall(){
  return '<div class="panel" style="max-width:760px"><h3 style="font-size:16px;font-weight:700;margin:0 0 8px">Backend abhi install nahi hua</h3><div style="font-size:14px;line-height:1.8;color:var(--text-2)">Ye screen tab chalegi jab Apps Script project (Web_Sales_CRM) me ye ho jaaye:<ol style="margin:8px 0 0 18px">'
    + '<li>GitHub ke <b>apps-script/CodeGs_AiCore.gs</b> aur <b>CodeGs_AiGemini.gs</b> — dono ko naye script files ke roop me paste karein, file list me <b>sabse neeche</b>.</li>'
    + '<li>Editor me function <b>ai_setup</b> chalayein (ek baar permission maangega), phir <b>ai_selfTest</b>.</li><li><b>ai_installTriggers</b> chalayein.</li><li>Deploy → Manage deployments → Edit → <b>New version</b> → Deploy.</li></ol></div>'
    + '<div style="margin-top:12px"><button class="btn primary sm" data-ai-act="reload">Dobara check karo</button></div></div>';
}

/* ------------------------------------------------------------------ paint */
function paint(){
  if(typeof state === 'undefined' || state.view !== VIEW) return;
  var d = st.dash, head;
  if(!isAdmin()){ content.innerHTML = '<div class="panel">Ye screen sirf Administrator ke liye hai.</div>'; return; }
  if(st.err === 'install'){ content.innerHTML = vInstall(); return; }
  if(!d){ content.innerHTML = '<div class="panel" style="text-align:center;color:var(--muted);padding:40px">' + (st.err ? esc(st.err) + '<div style="margin-top:12px"><button class="btn sm" data-ai-act="reload">Dobara try karo</button></div>' : 'Analytics load ho rahi hai…') + '</div>'; return; }
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
  }catch(e){ h = '<div class="panel">Screen banane me error: ' + esc(e && e.message) + '</div>'; }
  box.innerHTML = h;
  try{ if(t === 'overview') cOverview(d); else if(t === 'sources') cGroups(d, 'src'); else if(t === 'team') cGroups(d, 'team'); }catch(e){}
  if(t === 'ask'){ var c = $('aiChat'); if(c) c.scrollTop = c.scrollHeight; }
}
function goTab(t){
  st.tab = t;
  var type = t === 'leads' ? 'lead' : t === 'quotes' ? 'quote' : t === 'orders' ? 'order' : '';
  if(type){ st.list = { type:type, category:'', source:'', owner:'', intent:'', q:'', page:0, sort:'priority', dir:'desc' }; paint(); loadList(); return; }
  if(t === 'changes'){ paint(); loadEvents(); return; }
  paint();
}
function ask(q){
  q = String(q || '').trim(); if(q.length < 3 || st.busy) return;
  st.chat.push({ me:true, text:q }); st.busy = 'ask'; paintBody();
  api('ai_ask', { q:q }).then(function(r){ st.busy = ''; st.chat.push({ me:false, text:(r && r.ok) ? String(r.answer || '') : '⚠ ' + errText(r) }); if(state.view === VIEW && st.tab === 'ask') paintBody(); });
}
function exportCsv(){
  var L = st.list; say('Export ban raha hai…');
  api('ai_entities', { type:L.type, category:L.category, source:L.source, owner:L.owner, intent:L.intent, q:L.q, page:0, size:200, sort:L.sort, dir:L.dir }).then(function(r){
    if(!r || !r.ok || !(r.rows || []).length){ say('Export ke liye kuch nahi'); return; }
    var cols = ['id','name','phone','source','ownerName','status','category','reason','created','lastActivity','daysIdle','followUp','amount','linkId','aiIntent','aiScore','aiNext'];
    var csv = [cols.join(',')].concat(r.rows.map(function(x){ return cols.map(function(c){ var v = String(x[c] == null ? '' : x[c]); if(/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g,'""') + '"'; }).join(','); })).join('\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type:'text/csv' })); a.download = 'ai-' + L.type + 's-' + new Date().toISOString().slice(0,10) + '.csv'; a.click();
    if(r.total > 200) say('Pehle 200 records export hue (kul ' + r.total + '). Poori list AI Analytics Sheet me hai.');
  });
}

/* ------------------------------------------------------------------ events */
document.addEventListener('click', function(ev){
  if(typeof state === 'undefined' || state.view !== VIEW) return;
  var b = ev.target.closest && ev.target.closest('[data-ai-tab],[data-ai-act],[data-ai-period],[data-ai-cat],[data-ai-page],[data-ai-alert],[data-ai-ex]');
  if(!b || b.disabled) return;
  var a;
  if((a = b.getAttribute('data-ai-tab'))) return goTab(a);
  if(b.hasAttribute('data-ai-period')){ st.period = b.getAttribute('data-ai-period'); return paintBody(); }
  if(b.hasAttribute('data-ai-cat')){ st.list.category = b.getAttribute('data-ai-cat'); st.list.page = 0; return loadList(); }
  if(b.hasAttribute('data-ai-page')){ st.list.page = Math.max(0, st.list.page + num(b.getAttribute('data-ai-page'))); return loadList(); }
  if(b.hasAttribute('data-ai-alert')){ st.alertType = b.getAttribute('data-ai-alert'); return paintBody(); }
  if((a = b.getAttribute('data-ai-ex'))) return ask(a);
  a = b.getAttribute('data-ai-act');
  if(a === 'reload'){ st.dash = null; st.err = null; return load(); }
  if(a === 'refresh') return act('ai_run', 'Refresh');
  if(a === 'insights') return act('ai_insights_now', 'AI insights');
  if(a === 'analyse') return act('ai_analyse_now', 'AI analysis', null, function(r){ say((r.analysed || 0) + ' leads analyse hui'); st.dash = null; load(); });
  if(a === 'testKey') return act('ai_key_test', 'Key test', null, function(r){ say('Key sahi hai ✓ (model: ' + (r.model || '') + ')'); paint(); });
  if(a === 'delKey'){ return act('ai_key_set', 'Key hatai', { key:'' }); }
  if(a === 'saveKey'){ var k = ($('aiKeyIn') || {}).value || ''; k = k.trim(); if(k.length < 20){ say('Poori key paste karein'); return; } $('aiKeyIn').value = ''; return act('ai_key_set', 'Key save', { key:k }); }
  if(a === 'saveSettings'){
    var s = {}; document.querySelectorAll('[data-ai-set]').forEach(function(el){ s[el.getAttribute('data-ai-set')] = el.value; });
    return act('ai_settings_set', 'Settings save', { settings:s }, function(){ say('Settings save ho gayi — data dobara ban raha hai'); act('ai_run', 'Refresh'); });
  }
  if(a === 'ask'){ var q = $('aiAskQ'); if(q){ var v = q.value; q.value = ''; ask(v); } return; }
  if(a === 'csv') return exportCsv();
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
try{ if(typeof PAGE_META !== 'undefined') PAGE_META[VIEW] = ['Informatics Analytics', 'Leads, quotations, orders — rules + AI se nikli tasveer (sirf Administrator)']; }catch(e){}
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
    if(!isAdmin()){ say('Ye screen sirf Administrator ke liye hai'); return _setView.call(this, 'dashboard'); }
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
    var h = '<option value="">— koi nahi —</option>';
    if(cur && !mine.some(function(o){ return o.id === cur; })) h += '<option value="' + esc(cur) + '" selected>' + esc(cur) + '</option>';
    if(hit.length) h += '<optgroup label="Is customer se match">' + hit.map(one).join('') + '</optgroup>';
    if(rest.length) h += '<optgroup label="' + (kind === 'quote' ? 'Baaki quotations (naye pehle)' : 'Baaki enquiries (naye pehle)') + '">' + rest.map(one).join('') + '</optgroup>';
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
      + '<div><label>Linked Lead <span style="font-weight:500;font-size:10.5px;color:var(--muted)">(optional — ye order kis lead se aaya)</span></label><select id="o-linkl" data-cur="' + esc(o.leadRef || '') + '"></select></div>';
    row.parentNode.insertBefore(div, row);
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
    var q = $('o-linkq'), l = $('o-linkl'), lo = l.options[l.selectedIndex], known = {};
    (DB.orders() || []).forEach(function(x){ known[x.id] = 1; });
    pend = { id: row.getAttribute('data-oid') || '', quoteId: q.value || '', leadRef: l.value || '', leadSrc: (lo && lo.getAttribute('data-src')) || '', known: known, at: Date.now() };
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
            if((t.leadRef || '') !== pend.leadRef){ t.leadRef = pend.leadRef; t.leadSrc = pend.leadRef ? pend.leadSrc : ''; }
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
