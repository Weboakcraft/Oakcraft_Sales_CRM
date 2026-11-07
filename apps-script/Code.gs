function __diag(){
  var out=[];
  SS.getSheets().forEach(function(sh){
    var n=sh.getName(), lr=sh.getLastRow(), lc=sh.getLastColumn();
    var hdr=(lr>0&&lc>0)?sh.getRange(1,1,1,Math.min(lc,12)).getValues()[0].join(' ~ '):'';
    var maxLen=0,tot=0;
    if(lr>1&&lc>0){var vv=sh.getRange(2,1,lr-1,Math.min(lc,6)).getValues();for(var i=0;i<vv.length;i++)for(var j=0;j<vv[i].length;j++){var s=String(vv[i][j]);tot+=s.length;if(s.length>maxLen)maxLen=s.length;}}
    out.push(n+' | rows='+(lr-1)+' cols='+lc+' maxCell='+maxLen+' total='+tot+' | hdr: '+hdr);
  });
  var s=out.join('\n');
  Logger.log(s);
  return s;
}
var SS = SpreadsheetApp.getActiveSpreadsheet();
var COLLECTIONS = ['enquiries','orders','dispatch','quotations','customers','products','users','formfields','permissions','meta','metaLeads','activity','slacfg','apiconfig'];
var SHARED      = ['products','formfields','meta','permissions','slacfg','apiconfig'];   // sab users ke liye common
var ADMIN_ONLY  = [];                  // permissions read-only sabke liye                    // read+write sirf admin
var ADMIN_WRITE  = ['users','permissions','slacfg'];            // write sirf admin
var FULL_DATA_ROLES = { orders: ['sales manager'], activity: ['sales manager'] }; var FULL_DATA_USERS = { quotations: ['accounts@oakcraft.in'], dispatch: ['pc2oakcraft@gmail.com','accounts@oakcraft.in'], enquiries: ['pc2oakcraft@gmail.com'], metaLeads: ['pc2oakcraft@gmail.com'] }; /* naam se poora data: Arun Mourya -> Quotations */
var LEGACY_READS  = false;   // Phase 2 me false karna -> asli isolation ON
var LEGACY_WRITES = false;   // purana frontend save/delete kar sake (users/permissions blocked)
var LEGACY_QUOTE  = false;   // quotation-builder ka numbering bina sid chale
var SESSION_MS     = 30*24*60*60*1000;  
var RENEW_AFTER_MS = 24*60*60*1000;     
var _RENEW = '';                        
var KEY_ROW = 2, FIRST_DATA_ROW = 3;
var CONFIG_COLLS = ['formfields','permissions','meta'];
var FLAT_DEPTH = 3, CFG_DEPTH = 1, MAX_ARRAY_COLS = 30;
var HDR_BG = '#eef2f7';

var LABEL_MAP = {
  id:'ID', updatedAt:'Updated At', updatedBy:'Updated By', owner:'Owner (Email)',
  custId:'Customer ID', prodId:'Product ID', orderId:'Order ID', qty:'Quantity',
  amount:'Amount', value:'Value', price:'Unit Price', stock:'Stock', unit:'Unit',
  sku:'SKU', cat:'Category', gstin:'GSTIN', pwdSet:'Password Set', hash:'Password Hash',
  expDispatch:'Expected Delivery Date', dispatchedOn:'Dispatched On', eta:'ETA',
  orderType:'Order Type', productType:'Product Type', validTill:'Valid Till',
  image:'Product Image', items:'Items', custom:'Custom', note:'Note',
  tracking:'Tracking No', courier:'Courier', spec:'Specification', rate:'Rate',
  manual:'Manual Entry', since:'Customer Since', contact:'Contact Person'
};
function _titleize(k){
  var s = String(k).replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/[_-]+/g,' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
var _FORMLBL = null, _FORMBUSY = false;
function _formLabelMap(){
  if(_FORMLBL) return _FORMLBL;
  if(_FORMBUSY) return {};
  _FORMBUSY = true;
  var m = {};
  try{
    var rows = _readAll('formfields');
    for(var i=0;i<rows.length;i++){
      var d = _body(rows[i]);
      for(var w in d){
        var arr = d[w];
        if(!(arr instanceof Array)) continue;
        for(var j=0;j<arr.length;j++){ var f=arr[j]; if(f && f.id && f.label) m[String(f.id)] = String(f.label); }
      }
    }
  }catch(e){}
  _FORMBUSY = false; _FORMLBL = m; return m;
}
function _label(coll, path){
  if(LABEL_MAP[path]) return LABEL_MAP[path];
  var parts = _psplit(path), out = [], i;
  for(i=0;i<parts.length;i++){
    var p = parts[i];
    if(/^[0-9]+$/.test(p)){
      if(out.length) out[out.length-1] = out[out.length-1].replace(/s$/,'') + ' ' + (Number(p)+1);
      continue;
    }
    if(i>0 && parts[i-1]==='custom'){ out.push(_formLabelMap()[p] || _titleize(p)); continue; }
    out.push(LABEL_MAP[p] || _titleize(p));
  }
  if(out.length>1 && out[0]==='Custom') out.shift();
  return out.join(' ') || String(path);
}

function _esc(k){ return String(k).replace(/\\/g,'\\\\').replace(/\./g,'\\.'); }
function _pjoin(prefix, key){ return prefix ? (prefix + '.' + _esc(key)) : _esc(key); }
function _psplit(path){
  var out=[], cur='', i, s=String(path), ch;
  for(i=0;i<s.length;i++){
    ch = s.charAt(i);
    if(ch==='\\' && i+1<s.length){ cur += s.charAt(i+1); i++; continue; }
    if(ch==='.'){ out.push(cur); cur=''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}
function _depthFor(coll){ return CONFIG_COLLS.indexOf(coll)>=0 ? CFG_DEPTH : FLAT_DEPTH; }
function _flat(prefix, val, out, depth, maxDepth){
  if(val === null || val === undefined){ if(prefix) out[prefix]=''; return; }
  var t = typeof val;
  if(t==='string' || t==='number' || t==='boolean'){ out[prefix]=val; return; }
  if(val instanceof Date){ out[prefix]=val.toISOString(); return; }
  var isArr = (val instanceof Array);
  var ks = isArr ? null : Object.keys(val);
  var leaf = (depth >= maxDepth) || (isArr && (val.length===0 || val.length>MAX_ARRAY_COLS)) || (!isArr && ks.length===0);
  if(leaf){ if(prefix) out[prefix] = 'JSON:' + JSON.stringify(val); return; }
  var i;
  if(isArr){ for(i=0;i<val.length;i++) _flat(_pjoin(prefix,i), val[i], out, depth+1, maxDepth); return; }
  for(i=0;i<ks.length;i++) _flat(_pjoin(prefix,ks[i]), val[ks[i]], out, depth+1, maxDepth);
}
function _flatten(coll, obj){ var out={}; _flat('', obj, out, 0, _depthFor(coll)); return out; }
function _compact(v){
  var i, k;
  if(v instanceof Array){ var o=[]; for(i=0;i<v.length;i++){ if(v[i]!==undefined && v[i]!==null) o.push(_compact(v[i])); } return o; }
  if(v && typeof v==='object'){ for(k in v){ if(Object.prototype.hasOwnProperty.call(v,k)) v[k]=_compact(v[k]); } return v; }
  return v;
}
function _unflatten(map){
  var root={}, path, parts, cur, i, v;
  for(path in map){
    if(!Object.prototype.hasOwnProperty.call(map,path)) continue;
    v = map[path];
    if(typeof v==='string' && v.indexOf('JSON:')===0){ try{ v = JSON.parse(v.substring(5)); }catch(e){} }
    parts = _psplit(path);
    cur = root;
    for(i=0;i<parts.length-1;i++){
      var wantArr = /^[0-9]+$/.test(parts[i+1]);
      if(cur[parts[i]]===undefined || cur[parts[i]]===null || typeof cur[parts[i]]!=='object') cur[parts[i]] = wantArr ? [] : {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length-1]] = v;
  }
  return _compact(root);
}
function _blank(v){
  if(v==='' || v===null || v===undefined) return true;
  if(v instanceof Array) return v.length===0;
  if(typeof v==='object') return Object.keys(v).length===0;
  return false;
}
function _norm(o){
  var i, j, ks, r, a, nv;
  if(o===null || o===undefined) return null;
  if(o instanceof Array){ a=[]; for(i=0;i<o.length;i++){ nv=_norm(o[i]); if(_blank(nv)) continue; a.push(nv); } return a; }
  if(typeof o==='object'){ ks=Object.keys(o).sort(); r={}; for(j=0;j<ks.length;j++){ nv=_norm(o[ks[j]]); if(_blank(nv)) continue; r[ks[j]]=nv; } return r; }
  if(typeof o==='number' || typeof o==='boolean') return o;
  return String(o);
}

function _isLegacy(sh){
  if(sh.getLastColumn() < 2) return false;
  var h = sh.getRange(1,1,1,2).getValues()[0];
  return String(h[0]).toLowerCase()==='id' && String(h[1]).toLowerCase()==='data';
}
function _schemaOf(sh){
  var lc = sh.getLastColumn(), paths=[], idx={}, i;
  if(lc<1) return {paths:paths, idx:idx};
  var keys = sh.getRange(KEY_ROW,1,1,lc).getValues()[0];
  for(i=0;i<keys.length;i++){ var k=String(keys[i]==null?'':keys[i]).trim(); paths.push(k); if(k && !idx[k]) idx[k]=i+1; }
  return {paths:paths, idx:idx};
}
function _writeHeader(sh, coll, paths, startCol){
  var labels=[], i, used={}, prev, pv;
  if(startCol>1){
    prev = sh.getRange(1,1,1,startCol-1).getValues()[0];
    for(i=0;i<prev.length;i++){ pv=String(prev[i]==null?'':prev[i]); if(pv) used[pv]=1; }
  }
  for(i=0;i<paths.length;i++){
    var L=_label(coll, paths[i]), base=L, n=2;
    while(used[L]){ L = base + ' (' + n + ')'; n++; }
    used[L]=1; labels.push(L);
  }
  sh.getRange(1,startCol,1,paths.length).setValues([labels]).setFontWeight('bold').setBackground(HDR_BG);
  sh.getRange(KEY_ROW,startCol,1,paths.length).setValues([paths]).setFontColor('#9aa4b2').setFontSize(8).setFontWeight('normal');
}
function _initSheet(sh, coll, paths){
  paths = (paths && paths.length) ? paths : ['id','updatedAt'];
  sh.clear();
  if(sh.getMaxColumns() < paths.length) sh.insertColumnsAfter(sh.getMaxColumns(), paths.length - sh.getMaxColumns());
  _writeHeader(sh, coll, paths, 1);
  sh.setFrozenRows(KEY_ROW);
  try{ sh.hideRows(KEY_ROW); }catch(e){}
  try{ sh.setFrozenColumns(1); }catch(e){}
  try{ sh.setColumnWidths(1, Math.max(paths.length,1), 150); }catch(e){}
  return _schemaOf(sh);
}
function _ensurePaths(sh, coll, needed){
  var sc=_schemaOf(sh), add=[], i;
  for(i=0;i<needed.length;i++){ var p=needed[i]; if(p && !sc.idx[p] && add.indexOf(p)<0) add.push(p); }
  if(!add.length) return sc;
  var start = sc.paths.length + 1;
  var maxc = sh.getMaxColumns();
  if(start + add.length - 1 > maxc) sh.insertColumnsAfter(maxc, (start + add.length - 1) - maxc);
  _writeHeader(sh, coll, add, start);
  return _schemaOf(sh);
}
function _sheet(name){
  var sh = SS.getSheetByName(name);
  if(!sh){ sh = SS.insertSheet(name); _initSheet(sh, name, ['id','updatedAt']); }
  return sh;
}
function _ensureAll(){
  COLLECTIONS.forEach(function(c){ _sheet(c); });
  var s1 = SS.getSheetByName('Sheet1');
  if(s1 && SS.getSheets().length > 1){
    var last = s1.getLastRow();
    if(last <= 1){ try{ SS.deleteSheet(s1); }catch(e){} }
  }
}
function setup(){ _ensureAll(); return 'Tabs ready: ' + COLLECTIONS.join(', '); }

function _readLegacy(sh){
  var last = sh.getLastRow();
  if(last < 2) return [];
  var rows = sh.getRange(2,1,last-1,2).getValues(), out=[], i;
  for(i=0;i<rows.length;i++){
    if(rows[i][0]==='' && rows[i][1]==='') continue;
    try{ out.push(JSON.parse(rows[i][1])); }catch(e){}
  }
  return out;
}
function _readAll(name){
  var sh = _sheet(name);
  if(_isLegacy(sh)) return _readLegacy(sh);
  var last = sh.getLastRow(), lc = sh.getLastColumn();
  if(last < FIRST_DATA_ROW || lc < 1) return [];
  var sc = _schemaOf(sh);
  var vals = sh.getRange(FIRST_DATA_ROW,1,last-FIRST_DATA_ROW+1,lc).getValues();
  var out=[], r, c;
  for(r=0;r<vals.length;r++){
    var map={}, any=false;
    for(c=0;c<sc.paths.length;c++){
      var p = sc.paths[c]; if(!p) continue;
      var v = vals[r][c];
      if(v==='' || v===null || v===undefined) continue;
      if(v instanceof Date) v = Utilities.formatDate(v, 'UTC', 'yyyy-MM-dd');
      map[p] = v; any = true;
    }
    if(!any) continue;
    var body = _unflatten(map);
    out.push({ id: String(body.id==null?'':body.id), data: body, updatedAt: body.updatedAt || '' });
  }
  return out;
}
function _findRow(sh, id){
  var legacy = _isLegacy(sh);
  var start = legacy ? 2 : FIRST_DATA_ROW;
  var last = sh.getLastRow();
  if(last < start) return -1;
  var col = 1;
  if(!legacy){ var sc = _schemaOf(sh); col = sc.idx['id'] || 1; }
  var ids = sh.getRange(start,col,last-start+1,1).getValues(), i;
  for(i=0;i<ids.length;i++){ if(String(ids[i][0]) === String(id)) return i+start; }
  return -1;
}
/* ===== Drive file storage: product images, payment/freight proofs, PI, tax invoice ===== */
var DRIVE_FOLDERS = {
  product : '1BfAB9Cfkd3bv1ttiC1uoqG30TUeaSlSW',
  payment : '1UzkHziQ1y-8nsdMVkgRNwg_mDOcx4hTd',
  proforma: '1MMRbgmsROy8cwSSHYjgoTZIN31NvgMrZ',
  tax     : '1oc6ygw4gxTPGsbsO6YjKD6rOEwChY61_'
};
var _DRV_FOLD = {}, _DRV_BUDGET = 1000000;
function _folderKeyFor(label, path){
  var s = String(label==null?'':label) + ' ' + String(path==null?'':path);
  if(/tax[^A-Za-z0-9]{0,3}inv/i.test(s)) return 'tax';
  if(/pro[^A-Za-z0-9]{0,3}forma|performa/i.test(s)) return 'proforma';
  if(/proof|payment|freight|transport/i.test(s)) return 'payment';
  return 'product';
}
function _drvFolder(key){
  if(_DRV_FOLD[key]) return _DRV_FOLD[key];
  var id = DRIVE_FOLDERS[key] || DRIVE_FOLDERS.product;
  var f = DriveApp.getFolderById(id);
  _DRV_FOLD[key] = f; return f;
}
function _isDataUrl(v){ return typeof v === 'string' && v.length > 48 && v.slice(0,5) === 'data:' && v.indexOf('base64,') > 0; }
function _drvExt(mime, name){
  var m = String(name==null?'':name).match(/\.[A-Za-z0-9]{1,5}$/);
  if(m) return m[0];
  var t = { 'image/jpeg':'.jpg','image/jpg':'.jpg','image/png':'.png','image/webp':'.webp','image/gif':'.gif','application/pdf':'.pdf' };
  return t[String(mime).toLowerCase()] || '';
}
function _slug(s){ var x = String(s==null?'':s).replace(/[^A-Za-z0-9]+/g,'-').replace(/^-+/,'').replace(/-+$/,''); return x ? x.slice(0,40) : 'file'; }
function _saveDataUrl(dataUrl, coll, recId, label, path){
  var m = /^data:([^;,]*)((?:;[^;,]*)*);base64,([\s\S]*)$/.exec(dataUrl);
  if(!m) return dataUrl;
  var mime = m[1] || 'application/octet-stream', params = m[2] || '', b64 = m[3];
  var nm = /;name=([^;]*)/i.exec(params), orig = '';
  if(nm){ try{ orig = decodeURIComponent(nm[1]); }catch(e){ orig = nm[1]; } }
  var bytes = Utilities.base64Decode(b64);
  var stamp = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd-HHmmss');
  var fname = _slug(coll) + '_' + _slug(recId) + '_' + _slug(label || path) + '_' + stamp + _drvExt(mime, orig);
  var file = _drvFolder(_folderKeyFor(label, path)).createFile(Utilities.newBlob(bytes, mime, fname));
  var fid = file.getId();
  if(/^image\//i.test(mime)) return 'https://drive.google.com/thumbnail?id=' + fid + '&sz=w1200';
  return 'https://drive.google.com/file/d/' + fid + '/view';
}
function _drvLabel(coll, path){
  try{
    var parts = String(path).split('.'), last = parts[parts.length-1];
    var fm = _formLabelMap();
    if(fm[last]) return fm[last];
    return _label(coll, path);
  }catch(e){ return path; }
}
function _driveify(coll, body){
  if(!body || typeof body !== 'object') return 0;
  var recId = String(body.id == null ? '' : body.id);
  var hit = 0;
  function walk(o, base, depth){
    if(depth > 6 || _DRV_BUDGET <= 0) return;
    var k, v, p;
    for(k in o){
      if(!Object.prototype.hasOwnProperty.call(o,k)) continue;
      v = o[k]; p = base ? (base + '.' + k) : k;
      if(_isDataUrl(v)){
        try{ o[k] = _saveDataUrl(v, coll, recId, _drvLabel(coll,p), p); hit++; _DRV_BUDGET--; }catch(e){}
        if(_DRV_BUDGET <= 0) return;
      } else if(v && typeof v === 'object'){ walk(v, p, depth+1); }
    }
  }
  walk(body, '', 0);
  return hit;
}
function _driveMigrate(name, maxFiles){
  var recs = _readAll(name), i, changed = 0, files = 0;
  _DRV_BUDGET = maxFiles > 0 ? maxFiles : 20;
  for(i = 0; i < recs.length; i++){
    if(_DRV_BUDGET <= 0) break;
    var b = _body(recs[i]);
    if(b.id == null) b.id = recs[i].id;
    var n = _driveify(name, b);
    if(n){ changed++; files += n; _upsert(name, b); }
  }
  var left = _DRV_BUDGET <= 0;
  _DRV_BUDGET = 1000000;
  return { collection:name, records:changed, files:files, more:left };
}
function authorizeDriveAccess(){
  var out = [], k;
  for(k in DRIVE_FOLDERS){
    try{ out.push(k + ' -> ' + DriveApp.getFolderById(DRIVE_FOLDERS[k]).getName()); }
    catch(e){ out.push(k + ' -> ERROR ' + e); }
  }
  Logger.log(out.join('\n'));
  return out.join(' | ');
}

function _upsert(name, rec){
  var sh = _sheet(name);
  if(!rec.id) rec.id = Utilities.getUuid();
  rec.updatedAt = new Date().toISOString();
  if(_isLegacy(sh)){
    var lrow = _findRow(sh, rec.id);
    var lvals = [[rec.id, JSON.stringify(rec), rec.updatedAt]];
    if(lrow === -1){ sh.appendRow(lvals[0]); } else { sh.getRange(lrow,1,1,3).setValues(lvals); }
    return rec;
  }
  var body = _body(rec);
  try{ delete body._cPhone; delete body._cContact; }catch(e){}
  _driveify(name, body);
  body.id = rec.id; body.updatedAt = rec.updatedAt;
  var map = _flatten(name, body);
  var need = ['id'], p;
  for(p in map){ if(Object.prototype.hasOwnProperty.call(map,p)) need.push(p); }
  need.push('updatedAt');
  var sc = _ensurePaths(sh, name, need);
  var row = _findRow(sh, rec.id);
  if(row === -1) row = Math.max(sh.getLastRow()+1, FIRST_DATA_ROW);
  if(row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), row - sh.getMaxRows());
  var lc = sh.getLastColumn(), rv=[], rf=[], c;
  for(c=0;c<lc;c++){ rv.push(''); rf.push('@'); }
  for(p in map){
    if(!Object.prototype.hasOwnProperty.call(map,p)) continue;
    var ci = sc.idx[p]; if(!ci) continue;
    var v = map[p];
    rv[ci-1] = v;
    rf[ci-1] = (typeof v === 'number' || typeof v === 'boolean') ? 'General' : '@';
  }
  var rng = sh.getRange(row,1,1,lc);
  rng.setNumberFormats([rf]);
  rng.setValues([rv]);
  return rec;
}
function _remove(name, id){
  var sh = _sheet(name);
  var row = _findRow(sh, id);
  if(row !== -1){ sh.deleteRow(row); return true; }
  return false;
}

/* ---- one-time migration: JSON column -> proper columns ---- */
function _migrateSheet(name){
  var sh = _sheet(name);
  if(!_isLegacy(sh)) return { collection:name, alreadyDone:true };
  var recs = _readLegacy(sh);
  var bname = 'bak_' + name;
  var old = SS.getSheetByName(bname);
  if(old){ SS.deleteSheet(old); }
  var cp = sh.copyTo(SS); cp.setName(bname);
  try{ cp.hideSheet(); }catch(e){}
  var order = [], seen = {}, maps = [], i, p;
  function addp(x){ if(x && !seen[x]){ seen[x]=1; order.push(x); } }
  addp('id');
  for(i=0;i<recs.length;i++){
    var b = _body(recs[i]);
    if(b.id == null || b.id === '') b.id = recs[i].id;
    if(!b.updatedAt && recs[i].updatedAt) b.updatedAt = recs[i].updatedAt;
    var m = _flatten(name, b);
    maps.push(m);
    for(p in m){ if(Object.prototype.hasOwnProperty.call(m,p)) addp(p); }
  }
  addp('updatedAt');
  _initSheet(sh, name, order);
  if(maps.length){
    var needRows = FIRST_DATA_ROW + maps.length - 1;
    if(sh.getMaxRows() < needRows) sh.insertRowsAfter(sh.getMaxRows(), needRows - sh.getMaxRows());
    var vals=[], fmts=[], r, c;
    for(r=0;r<maps.length;r++){
      var rv=[], rf=[];
      for(c=0;c<order.length;c++){
        var v = maps[r][order[c]];
        if(v === undefined) v = '';
        rv.push(v);
        rf.push((typeof v === 'number' || typeof v === 'boolean') ? 'General' : '@');
      }
      vals.push(rv); fmts.push(rf);
    }
    var rng = sh.getRange(FIRST_DATA_ROW,1,maps.length,order.length);
    rng.setNumberFormats(fmts);
    rng.setValues(vals);
  }
  SpreadsheetApp.flush();
  var back = _readAll(name), bad = [], k;
  for(k=0;k<recs.length;k++){
    var wantRec = _body(recs[k]);
    var got = back[k] ? _body(back[k]) : null;
    if(!got || JSON.stringify(_norm(wantRec)) !== JSON.stringify(_norm(got))) bad.push(String(wantRec.id || recs[k].id || ('row'+k)));
  }
  return { collection:name, rows:recs.length, cols:order.length, backup:bname, mismatch:bad.length, badIds:bad.slice(0,5) };
}
/* ---- rebuild: sheet ko preferred column order me dobara likhta hai aur
   Form Builder ke saare questions ke liye columns bana deta hai (chahe abhi
   un fields me data ho ya na ho). Data waise ka waisa rehta hai. ---- */
var PREFERRED = {
  orders:     ['id','date','customer','custId','product','prodId','orderType','qty','amount','status','payment','salesperson','productType','expDispatch','note','image'],
  enquiries:  ['id','date','customer','custId','product','prodId','qty','value','source','salesperson','priority','stage','note'],
  customers:  ['id','name','contact','phone','email','city','type','gstin','since'],
  products:   ['id','name','sku','cat','price','stock','unit'],
  dispatch:   ['id','orderId','customer','product','qty','courier','tracking','status','dispatchedOn','eta'],
  quotations: ['id','date','customer','product','qty','amount','discount','validTill','salesperson','status','source'],
  users:      ['id','name','email','role','status','mobile','pwdSet']
};
var FORM_OF = { orders:'order', enquiries:'enquiry', customers:'customer', products:'product' };
function _formPaths(coll){
  var w = FORM_OF[coll]; if(!w) return [];
  var out=[], rows, i, j;
  try{ rows = _readAll('formfields'); }catch(e){ return []; }
  for(i=0;i<rows.length;i++){
    var d = _body(rows[i]), arr = d[w];
    if(!(arr instanceof Array)) continue;
    for(j=0;j<arr.length;j++){ var f=arr[j]; if(f && f.id && String(f.id).indexOf('c_')===0) out.push('custom.'+_esc(f.id)); }
  }
  return out;
}
function _writeRecords(sh, name, maps, order){
  _initSheet(sh, name, order);
  if(!maps.length) return;
  var needRows = FIRST_DATA_ROW + maps.length - 1;
  if(sh.getMaxRows() < needRows) sh.insertRowsAfter(sh.getMaxRows(), needRows - sh.getMaxRows());
  var vals=[], fmts=[], r, c;
  for(r=0;r<maps.length;r++){
    var rv=[], rf=[];
    for(c=0;c<order.length;c++){
      var val = maps[r][order[c]];
      if(val === undefined) val = '';
      rv.push(val);
      rf.push((typeof val === 'number' || typeof val === 'boolean') ? 'General' : '@');
    }
    vals.push(rv); fmts.push(rf);
  }
  var rng = sh.getRange(FIRST_DATA_ROW,1,maps.length,order.length);
  rng.setNumberFormats(fmts);
  rng.setValues(vals);
}
/* ---- batch write: poora data block ek hi setValues me ----
   Pehle har record par alag setValues chalta tha, isliye 182 products wali
   saveMany request 180+ round-trips le kar time out ho jaati thi. */
function _writeBlock(sh, name, maps, order, schemaChanged){
  if(schemaChanged){ _initSheet(sh, name, order); }
  var lastRow = sh.getLastRow();
  var needRows = FIRST_DATA_ROW + Math.max(maps.length,1) - 1;
  if(sh.getMaxRows() < needRows) sh.insertRowsAfter(sh.getMaxRows(), needRows - sh.getMaxRows());
  if(maps.length){
    var vals=[], fmts=[], r, c;
    for(r=0;r<maps.length;r++){
      var rv=[], rf=[];
      for(c=0;c<order.length;c++){
        var val = maps[r][order[c]];
        if(val === undefined) val = '';
        rv.push(val);
        rf.push((typeof val === 'number' || typeof val === 'boolean') ? 'General' : '@');
      }
      vals.push(rv); fmts.push(rf);
    }
    var rng = sh.getRange(FIRST_DATA_ROW,1,maps.length,order.length);
    rng.setNumberFormats(fmts);
    rng.setValues(vals);
  }
  var firstEmpty = FIRST_DATA_ROW + maps.length;
  if(lastRow >= firstEmpty){
    sh.getRange(firstEmpty,1,lastRow-firstEmpty+1,Math.max(sh.getLastColumn(),1)).clearContent();
  }
}
function _writeMerged(name, sh, keep){
  var sc = _schemaOf(sh), order = [], seen = {}, i, p;
  function addp(x){ if(x && !seen[x]){ seen[x]=1; order.push(x); } }
  for(i=0;i<sc.paths.length;i++) addp(sc.paths[i]);
  var before = order.length;
  if(!before){ addp('id'); }
  var maps = [];
  for(i=0;i<keep.length;i++){
    var mm = _flatten(name, keep[i]);
    maps.push(mm);
    for(p in mm){ if(Object.prototype.hasOwnProperty.call(mm,p)) addp(p); }
  }
  if(!before){ addp('updatedAt'); }
  _writeBlock(sh, name, maps, order, order.length !== before);
  return maps.length;
}
function _upsertMany(name, recs){
  var sh = _sheet(name), i;
  if(_isLegacy(sh)){ for(i=0;i<recs.length;i++) _upsert(name, recs[i]); return recs.length; }
  var now = new Date().toISOString();
  var ex = _readAll(name), byId = {}, ids = [], b, id;
  for(i=0;i<ex.length;i++){ b = _body(ex[i]); id = String(b.id==null?ex[i].id:b.id); byId[id] = b; ids.push(id); }
  for(i=0;i<recs.length;i++){
    var r = recs[i]; if(!r) continue;
    if(!r.id) r.id = Utilities.getUuid();
    r.updatedAt = now;
    var nb = _body(r);
    try{ delete nb._cPhone; delete nb._cContact; }catch(e){}
    _driveify(name, nb);
    nb.id = r.id; nb.updatedAt = now;
    id = String(r.id);
    if(!byId[id]) ids.push(id);
    byId[id] = nb;
  }
  var keep = [];
  for(i=0;i<ids.length;i++) keep.push(byId[ids[i]]);
  _writeMerged(name, sh, keep);
  return recs.length;
}
function _removeMany(name, list){
  var sh = _sheet(name), i;
  if(_isLegacy(sh)){ for(i=0;i<list.length;i++) _remove(name, list[i]); return list.length; }
  var kill = {};
  for(i=0;i<list.length;i++) kill[String(list[i])] = 1;
  var ex = _readAll(name), keep = [], gone = 0, b;
  for(i=0;i<ex.length;i++){
    b = _body(ex[i]);
    if(kill[String(b.id==null?ex[i].id:b.id)]){ gone++; continue; }
    keep.push(b);
  }
  _writeMerged(name, sh, keep);
  return gone;
}
function _rebuild(name){
  var sh = _sheet(name);
  if(_isLegacy(sh)) return _migrateSheet(name);
  var recs = _readAll(name);
  var order=[], seen={}, maps=[], i, p;
  function addp(x){ if(x && !seen[x]){ seen[x]=1; order.push(x); } }
  addp('id');
  var pref = PREFERRED[name] || [];
  for(i=0;i<pref.length;i++) addp(pref[i]);
  var fp = _formPaths(name);
  for(i=0;i<fp.length;i++) addp(fp[i]);
  for(i=0;i<recs.length;i++){
    var b = _body(recs[i]);
    try{ delete b._cPhone; delete b._cContact; }catch(e){}
    var mm = _flatten(name, b);
    maps.push(mm);
    for(p in mm){ if(Object.prototype.hasOwnProperty.call(mm,p)) addp(p); }
  }
  addp('owner'); addp('updatedBy'); addp('updatedAt');
  _writeRecords(sh, name, maps, order);
  SpreadsheetApp.flush();
  var back = _readAll(name), bad=[], k;
  for(k=0;k<recs.length;k++){
    var want = _body(recs[k]);
    var got = back[k] ? _body(back[k]) : null;
    if(!got || JSON.stringify(_norm(want)) !== JSON.stringify(_norm(got))) bad.push(String(want.id || k));
  }
  return { collection:name, rows:recs.length, cols:order.length, mismatch:bad.length, badIds:bad.slice(0,5) };
}
function migrateAllToColumns(){
  var res = [], i;
  var lk = LockService.getScriptLock(); lk.waitLock(60000);
  try{ for(i=0;i<COLLECTIONS.length;i++) res.push(_migrateSheet(COLLECTIONS[i])); }
  finally{ lk.releaseLock(); }
  return res;
}

/* dry-run: sirf memory me flatten/unflatten karke check karta hai ki
   column-wise banane par ek bhi field kharab to nahi ho raha. Sheet ko
   chhoota bilkul nahi. */
function _dryCheck(name){
  var sh = _sheet(name);
  var recs = _isLegacy(sh) ? _readLegacy(sh) : _readAll(name);
  var bad = [], i, p, colset = {};
  for(i=0;i<recs.length;i++){
    var b = _body(recs[i]);
    if(b.id == null || b.id === '') b.id = recs[i].id;
    if(!b.updatedAt && recs[i].updatedAt) b.updatedAt = recs[i].updatedAt;
    var m = _flatten(name, b), m2 = {};
    for(p in m){ if(Object.prototype.hasOwnProperty.call(m,p) && m[p] !== '' && m[p] !== null && m[p] !== undefined){ m2[p] = m[p]; colset[p] = 1; } }
    var back = _unflatten(m2);
    if(JSON.stringify(_norm(b)) !== JSON.stringify(_norm(back))) bad.push(String(b.id || i));
  }
  return { collection:name, legacy:_isLegacy(sh), rows:recs.length, cols:Object.keys(colset).length, mismatch:bad.length, badIds:bad.slice(0,5) };
}

// ---- shared quotation numbering (per financial year) ----
function _nextQuoteNo(fy){
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try{
    var props = PropertiesService.getScriptProperties();
    var key = 'qno-' + fy;
    var last = parseInt(props.getProperty(key) || '1000', 10);
    var next = last + 1;
    props.setProperty(key, String(next));
    return next;
  } finally { lock.releaseLock(); }
}

function _peekQuoteNo(fy){
  var props = PropertiesService.getScriptProperties();
  var last = parseInt(props.getProperty('qno-'+fy) || '1000', 10);
  return last + 1;
}

// ---- web endpoints ----

/* ================= AUTH / SESSION ================= */
function _prop(k){
  var p = PropertiesService.getScriptProperties(), v = p.getProperty(k);
  if (!v && k === 'HMAC_SECRET'){ v = Utilities.getUuid() + Utilities.getUuid(); p.setProperty(k, v); }
  return v;
}
function _sign(s){
  return Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(s, _prop('HMAC_SECRET')));
}
function _issue(email, role){
  var body = email + '|' + role + '|' + (Date.now() + SESSION_MS);
  return Utilities.base64EncodeWebSafe(body) + '.' + _sign(body);
}
function _verify(sid){
  if (!sid || String(sid).indexOf('.') < 0) return null;
  var parts = String(sid).split('.'), body;
  try { body = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString(); }
  catch(e){ return null; }
  if (_sign(body) !== parts[1]) return null;
  var f = body.split('|');
  if (Date.now() > Number(f[2])) return null;
  return { email: String(f[0]).toLowerCase(), role: f[1], isAdmin: /admin/i.test(String(f[1]||'')), exp: Number(f[2]) };
}

function _login(email, hash){
  var e = String(email||'').trim().toLowerCase();
  var h = String(hash||'').trim();
  if(!e || !h) return { ok:false, error:'Email and password are required' };
  var rows = _readAll('users');
  var cands = [];
  for(var i=0;i<rows.length;i++){
    var d = _body(rows[i]);
    if(String(d.email||'').trim().toLowerCase() === e) cands.push(rows[i]);
  }
  // NOTE: users sheet me duplicate email rows hain, isliye saare candidates check karte hain
  var rec = null;
  for(var c=0;c<cands.length;c++){
    var dc = _body(cands[c]);
    if(dc.hash && String(dc.hash) === h){ rec = cands[c]; break; }
  }
  if(!rec){ Utilities.sleep(800); return { ok:false, error:'invalid credentials' }; }
  var dd = _body(rec);
  if(dd.status && String(dd.status).toLowerCase() !== 'active') return { ok:false, error:'account inactive' };
  var sid = _issue(e, String(dd.role||''));
  _audit(e, 'login', 'users', rec.id);
  return { ok:true, sid:sid, user:_safeUser(rec) };
}

/* ================= SCOPING ================= */
function _setPassword(email, hash, sid){
  var e = String(email||'').trim().toLowerCase();
  var h = String(hash||'').trim();
  if(!e || h.length < 32) return { ok:false, error:'bad request' };
  var rows = _readAll('users');
  var target = null, already = false;
  for(var i=0;i<rows.length;i++){
    var d = _body(rows[i]);
    if(String(d.email||'').trim().toLowerCase() !== e) continue;
    if(!target) target = rows[i];
    if(d.hash){ already = true; target = rows[i]; }
  }
  if(!target) return { ok:false, error:'no account' };
  if(already){
    var u = _verify(sid);
    if(!u) return { ok:false, error:'login required' };
    if(!u.isAdmin && u.email !== e) return { ok:false, error:'forbidden' };
  }
  var tb = _body(target);
  tb.hash = h;
  tb.pwdSet = true;
  _upsert('users', target);
  _audit(e, already ? 'resetPassword' : 'enrolPassword', 'users', target.id);
  return { ok:true };
}

/* Sheet me record ka shape do tarah ka hai:
   (a) wrapped -> { id, data:{...fields}, updatedAt }  (purani rows: enquiries / orders / users)
   (b) flat    -> { ...fields, id, updatedAt }         (saveMany writes: quotations / customers / products)
   _body() dono me se asli fields wala object laut'ta hai (reference, taaki likha bhi ja sake). */
function _body(row){
  if(row && row.data && typeof row.data === 'object' && !(row.data instanceof Array)) return row.data;
  return row || {};
}

function _ownerOf(row){
  var d = _body(row);
  return String(d.owner || d.ownerEmail || d.createdBy || '').trim().toLowerCase();
}

function _safeUser(row){
  var d = _body(row);
  return {
    id: row && row.id,
    updatedAt: row && row.updatedAt,
    data: { id:d.id, email:d.email, name:d.name, role:d.role, status:d.status,
            mobile:d.mobile, owner:d.owner, pwdSet: !!d.hash }
  };
}

/* Kya is user ko is collection ka poora data (sabhi users ka) dikhna chahiye? */
function _seesAll(coll, u){
  if(!u) return false;
  if(u.isAdmin || u.legacy) return true;
  var r = String(u.role || "").trim().toLowerCase();
  var uf = FULL_DATA_USERS[coll]; if(uf && uf.indexOf(String(u.email||'').trim().toLowerCase()) >= 0) return true; var allow = FULL_DATA_ROLES[coll];
  return !!(allow && allow.indexOf(r) >= 0);
}

/* Manager ko customers section nahi dikhta, lekin Orders ke WhatsApp button
   ko customer ka number chahiye. Isliye sirf order rows par contact hint
   (_cPhone/_cContact) attach kar dete hain. Ye fields sheet me save nahi
   hote -- write path par strip ho jaate hain. */
function _withContact(rows){
  var cust = _readAll('customers'), map = {}, i, k, d;
  for(i = 0; i < cust.length; i++){ d = _body(cust[i]); if(d && d.id) map[String(d.id)] = d; }
  var out = [];
  for(i = 0; i < rows.length; i++){
    var r = rows[i] || {}, b = _body(r), c = map[String(b.custId || '')] || {}, copy = {};
    for(k in b){ if(Object.prototype.hasOwnProperty.call(b, k)) copy[k] = b[k]; }
    copy._cPhone   = c.phone   || c.mobile || '';
    copy._cContact = c.contact || c.name   || '';
    out.push({ id: r.id, updatedAt: r.updatedAt, data: copy });
  }
  return out;
}

function _scope(coll, rows, u){
  rows = rows || [];
  if(u && u.legacy) return rows;                      // migration window: raw
  if(!u) return [];
  if(coll === 'users') return rows.map(function(r){ return _safeUser(r); });  // roster: naam/role haan, hash na
  if(SHARED.indexOf(coll) >= 0) return rows;
  if(ADMIN_ONLY.indexOf(coll) >= 0) return u.isAdmin ? rows : [];
  /* role elevation: Sales Manager -> saare orders (WhatsApp ke liye contact hint bhi) */
  if(_seesAll(coll, u)) return (coll === 'orders') ? _withContact(rows) : rows;
  var out = [];
  for(var i=0;i<rows.length;i++){ if(_ownerOf(rows[i]) === u.email) out.push(rows[i]); }
  return out;
}

function _audit(email, action, coll, id){
  try{
    var sh = SS.getSheetByName('audit');
    if (!sh){ sh = SS.insertSheet('audit'); sh.appendRow(['ts','email','action','collection','id']); }
    sh.appendRow([new Date().toISOString(), email || '(legacy)', action, coll, id]);
  } catch(e){}
}

/* ================= ROUTES ================= */
function doGet(e){ return _json(_stamp(_route(e.parameter || {}, 'GET'))); }
function doPost(e){
  var p = {};
  try { p = JSON.parse(e.postData.contents); } catch(err){ p = e.parameter || {}; }
  return _json(_stamp(_route(p, 'POST')));
}
function _stamp(res){
  try{
    if (_RENEW && res && typeof res === 'object' && !(res instanceof Array) && res.ok !== false){
      res.newSid = _RENEW;
    }
  }catch(e){}
  _RENEW = '';
  return res;
}

function _json(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function _route(p, verb){
  var action = p.action || 'ping', i, k;
  if (action === 'ping')  return { ok:true, ts:Date.now() };
  if (action === 'setup') return setup();
  if (action === 'login') return _login(p.email, p.hash);
  if (action === 'setPassword') return _setPassword(p.email, p.hash, p.sid);

  var isRead  = (action === 'getAll' || action === 'list');
  var isWrite = (action === 'save' || action === 'saveMany' || action === 'delete');
  var isQuote = (action === 'nextQuoteNo' || action === 'peekQuoteNo');

  var u  = _verify(p.sid);

  /* ---------- SLIDING SESSION (one-time login) ----------
     Token 1 din se purana hai to chupchaap naya bana dete hain aur response
     me newSid bhej dete hain. Active user ko dobara login nahi karna padega;
     30 din tak koi request na aaye to hi token mar jaayega (security expiry). */
  _RENEW = '';
  if (u && u.exp && (u.exp - Date.now()) < (SESSION_MS - RENEW_AFTER_MS)) {
    _RENEW = _issue(u.email, u.role);
  }

  /* ---------- WHOAMI ----------
     Frontend boot par pooch leta hai ki token abhi bhi valid hai ya nahi,
     aur user active hai ya nahi. Isse bina password dobara login ho jaata hai. */
  if (action === 'whoami'){
    if (!u) return { ok:false, error:'unauthorized' };
    var wrows = _readAll('users'), wrec = null, wi, wd;
    for (wi = 0; wi < wrows.length; wi++){
      wd = _body(wrows[wi]);
      if (String(wd.email||'').trim().toLowerCase() === u.email){
        wrec = wrows[wi];
        if (wd.hash) break;   // duplicate email rows: password wali row prefer karo
      }
    }
    if (!wrec) return { ok:false, error:'unauthorized' };
    var wdd = _body(wrec);
    if (wdd.status && String(wdd.status).toLowerCase() !== 'active') return { ok:false, error:'account inactive' };
    return { ok:true, email:u.email, role:u.role, isAdmin:u.isAdmin, exp:u.exp, user:_safeUser(wrec) };
  }

  /* ---------- migration window: purana frontend na toote ---------- */
  if (!u){
    var ok = (LEGACY_READS && verb === 'GET' && isRead)
          || (LEGACY_QUOTE && isQuote)
          || (LEGACY_WRITES && verb === 'POST' && isWrite);
    if (!ok) return { error:'unauthorized' };
    // bina login users/permissions likhna kabhi allow nahi
    if (isWrite && ADMIN_WRITE.indexOf(p.collection) >= 0)
      return { error:'forbidden', hint:'login required for ' + p.collection };
    u = { email:'', role:'legacy', isAdmin:true, legacy:true };
  }

    if (action === 'filesToDrive'){
    if(!u.isAdmin) return { error:'forbidden' };
    var dvOnly = p.collection ? [p.collection] : COLLECTIONS;
    var dvRes = [], dvI, dvMax = Number(p.max || 20), dvOne;
    for(dvI = 0; dvI < dvOnly.length; dvI++){
      dvOne = _driveMigrate(dvOnly[dvI], dvMax);
      dvRes.push(dvOne);
      dvMax = dvMax - dvOne.files;
      if(dvMax <= 0) break;
    }
    return { ok:true, result:dvRes };
  }

if (action === 'dryCheck'){
    if(!u.isAdmin) return { error:'forbidden' };
    var dOnly = p.collection ? [p.collection] : COLLECTIONS;
    var dRes = [], di;
    for(di=0; di<dOnly.length; di++) dRes.push(_dryCheck(dOnly[di]));
    return { ok:true, result:dRes };
  }
  if (action === 'rebuildColumns'){
    if(!u.isAdmin) return { error:'forbidden' };
    var rOnly = p.collection ? [p.collection] : COLLECTIONS;
    var rRes = [], ri;
    var rLock = LockService.getScriptLock(); rLock.waitLock(60000);
    try{ for(ri=0; ri<rOnly.length; ri++) rRes.push(_rebuild(rOnly[ri])); }
    finally{ rLock.releaseLock(); }
    return { ok:true, result:rRes };
  }
  if (action === 'migrateColumns'){
    if(!u.isAdmin) return { error:'forbidden' };
    var mOnly = p.collection ? [p.collection] : COLLECTIONS;
    var mRes = [], mi;
    var mLock = LockService.getScriptLock(); mLock.waitLock(60000);
    try{ for(mi=0; mi<mOnly.length; mi++) mRes.push(_migrateSheet(mOnly[mi])); }
    finally{ mLock.releaseLock(); }
    return { ok:true, result:mRes };
  }
  if (action === 'schema'){
    if(!u.isAdmin) return { error:'forbidden' };
    var sSh = _sheet(p.collection || 'orders');
    return { ok:true, legacy:_isLegacy(sSh), paths:_schemaOf(sSh).paths, rows:sSh.getLastRow() };
  }
  if(action === 'getAll'){
    var out = {};
    for(var gi=0; gi<COLLECTIONS.length; gi++){
      var gk = COLLECTIONS[gi];
      out[gk] = _scope(gk, _readAll(gk), u);
    }
    return { ok:true, data: out };
  }

  if (action === 'list'){
    if (COLLECTIONS.indexOf(p.collection) < 0) return { error:'bad_collection' };
    return { ok:true, data: _scope(p.collection, _readAll(p.collection), u) };
  }
  if (action === 'peekQuoteNo') return { ok:true, no: _peekQuoteNo(p.fy) };
  if (action === 'nextQuoteNo'){
    var lk = LockService.getScriptLock(); lk.waitLock(20000);
    try { return { ok:true, no: _nextQuoteNo(p.fy) }; } finally { lk.releaseLock(); }
  }

  if (isWrite){
    var coll = p.collection;
    if (COLLECTIONS.indexOf(coll) < 0) return { error:'bad_collection' };
    if (ADMIN_WRITE.indexOf(coll) >= 0 && !u.isAdmin) return { error:'forbidden' };

    var recs  = (action === 'saveMany') ? (p.records || [])
             : [ p.record || (p.records && p.records[0]) ];
    /* delete ke liye client sirf top-level id bhej sakta hai (purana
       'Clear all data' aisa hi bhejta hai). Pehle ye chupchaap fail ho
       jaata tha -- done:0 aur row sheet me zinda. Ab id ko bhi maan lete hain. */
    if (action === 'delete' && !recs[0] && p.id) recs = [ { id: p.id } ];
    // scoped = per-user ownership enforce karna hai ya nahi.
    // admin ko exempt rakha hai warna admin dusre ka record edit hi nahi kar paayega.
    var scoped = (SHARED.indexOf(coll) < 0 && ADMIN_WRITE.indexOf(coll) < 0 && !u.legacy && !_seesAll(coll, u));
    /* DELETE par ownership check hamesha lagta hai: manager dusre ka order
       update kar sakta hai (Advance Stage) par delete nahi. */
    if (action === 'delete' && !u.isAdmin && !u.legacy
        && SHARED.indexOf(coll) < 0 && ADMIN_WRITE.indexOf(coll) < 0) scoped = true;
    var lock = LockService.getScriptLock();
    /* v8 fix: lock na mile to HTML error page ki jagah JSON bhejo, client retry kar sake */
    try { lock.waitLock(45000); } catch(lkErr){ return { error:'busy', retry:true }; }
    try{
      var ex = _readAll(coll), byId = {};
      for (i = 0; i < ex.length; i++) byId[String(ex[i].id)] = ex[i];
      var done = 0, skipped = 0, toSave = [], toDel = [], lastId = ''; var rejected = [];
      for (i = 0; i < recs.length; i++){
        var r = recs[i]; if (!r) continue;
        var cur = byId[String(r.id)];
        // users: incoming record me hash na ho to purana hash mat mitao
        if (coll === 'users' && cur && _body(cur).hash){
          var rb = _body(r);
          if(!rb.hash){ rb.hash = _body(cur).hash; rb.pwdSet = true; }
        }
        /* Legacy rows me owner column hai hi nahi. Aisi rows par ownership
           check lagne se unka delete chupchaap skip ho jaata tha (done:0) aur
           sheet ki row hamesha ke liye zinda reh jaati thi -- next pull par
           record wapas aa jaata tha. Ab owner khali ho to check nahi lagta. */
        var _own = _ownerOf(cur);
        if (cur && scoped && _own && _own !== u.email){ skipped++; continue; }
        if (action === 'delete'){ toDel.push(r.id); }
        else {
          /* v16: adhoora record sheet par nahi jayega */
          var _bad = _reqMissing(coll, r, cur);
          if (_bad && _bad.length){ rejected.push({ id:r.id, missing:_bad }); continue; }
          if (u.email){
            var ob = _body(r);
            /* v39: IndiaMART / Meta lead ka owner sirf wahi jisko lead di gayi ya jisne
               khud apna naam lagaya. Admin ki id kabhi owner nahi banti; khaali = Unassigned.
               Non-admin khaali lead par sirf apna naam laga sakta hai; status badalne se
               (owner khaali bheja) lead uski nahi hoti. */
            var _leadColl = (coll === 'indiamartLeads' || coll === 'metaLeads');
            if (_leadColl){
              var _curOwn = cur ? String(_body(cur).owner || '').trim().toLowerCase() : '';
              var _want = String(ob.owner == null ? '' : ob.owner).trim().toLowerCase();
              if (scoped){
                if (cur) ob.owner = _curOwn || (_want === u.email ? u.email : '');
                else ob.owner = _want || u.email;
                if (!ob.owner) ob.assigned_to = '';
              } else if (ob.owner == null){
                ob.owner = _curOwn;
              }
            }
            else if (scoped) ob.owner = cur ? (_ownerOf(cur) || u.email) : (ob.owner || u.email);   // owner hijack rok do
            else if (!ob.owner) ob.owner = cur ? (_ownerOf(cur) || u.email) : u.email;        // admin: purana owner rakho, warna apna
          }
          if (u.email){ _body(r).updatedBy = u.email; }
          toSave.push(r);
        }
        done++; lastId = r.id;
      }
      if (toDel.length) _removeMany(coll, toDel);
      if (toSave.length) _upsertMany(coll, toSave);
      /* FMS_SHEET: sirf inhi orders ki product-wise rows refresh karo */
      if (coll === 'orders' && (toSave.length || toDel.length)){
        try{ _fmsApply(toSave, toDel); }catch(fmsE){ Logger.log('FMS sync fail: ' + fmsE); }
      }
      if (done) _audit(u.email, action, coll, (done === 1) ? lastId : (done + ' records'));
      return { ok:true, done:done, skipped:skipped, rejected:rejected };
    } finally {
      /* v8 fix: pending sheet writes pehle COMMIT karo, tab hi lock chhodo.
         Warna agla request stale data padhta hai aur _writeBlock ka
         clearContent() abhi-abhi likhi gayi nayi rows mita deta hai. */
      try{ SpreadsheetApp.flush(); }catch(flErr){}
      lock.releaseLock();
    }
  }
  return { error:'unknown action: ' + action };
}

/* ==================================================================
   BACKUP - original routing layer (pre-hardening, 4 Aug 2026).
   storageGet / storageSet / saveQuotation intentionally dropped:
   verified unused by both index.html and quotation-builder.html.
   ------------------------------------------------------------------
function doGet(e){ return _handle(e); }
function doPost(e){ return _handle(e); }

function _json(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function _handle(e){
  _ensureAll();
  var p = (e && e.parameter) ? e.parameter : {};
  var body = {};
  if(e && e.postData && e.postData.contents){
    try{ body = JSON.parse(e.postData.contents); }catch(err){ body = {}; }
  }
  var action = body.action || p.action || 'ping';
  var collection = body.collection || p.collection || '';
  try{
    switch(action){
      case 'ping': return _json({ok:true, msg:'OakCraft CRM backend live', collections:COLLECTIONS});
      case 'setup': return _json({ok:true, msg:setup()});
      case 'getAll':
        // returns all collections in one shot (used on app load)
        var dump = {};
        COLLECTIONS.forEach(function(c){ if(c!=='meta') dump[c] = _readAll(c); });
        return _json({ok:true, data:dump});
      case 'list':
        return _json({ok:true, data:_readAll(collection)});
      case 'save':
        return _json({ok:true, record:_upsert(collection, body.record||{})});
      case 'saveMany':
        var saved = (body.records||[]).map(function(r){ return _upsert(collection, r); });
        return _json({ok:true, records:saved});
      case 'delete':
        return _json({ok:_remove(collection, body.id)});
      case 'nextQuoteNo':
        return _json({ok:true, no:_nextQuoteNo(body.fy||p.fy||'unknown')});
      case 'peekQuoteNo':
        return _json({ok:true, no:_peekQuoteNo(body.fy||p.fy||'unknown')});
      case 'storageGet': {
        var gk = body.key || p.key || '';
        var gsh = _sheet('meta');
        var grow = _findRow(gsh, 'kv_'+gk);
        if(grow === -1) return _json({ok:true, found:false});
        var raw = gsh.getRange(grow, 2, 1, 1).getValue();
        var obj = {};
        try{ obj = JSON.parse(raw); }catch(e){ obj = {}; }
        return _json({ok:true, found:true, value: obj.data, key: gk});
      }
      case 'storageSet': {
        var sk = body.key || p.key || '';
        _upsert('meta', {id:'kv_'+sk, data: body.value});
        return _json({ok:true, key: sk, value: body.value});
      }
      case 'saveQuotation':
        return _json({ok:true, saved:(body.quotation&&body.quotation.qnoFormatted)||'quote', items:((body.quotation&&body.quotation.items)||[]).length, record:_upsert('quotations', {id:(body.quotation&&body.quotation.qnoFormatted)||('Q'+Date.now()), data: body.quotation})});
      default:
        return _json({ok:false, error:'unknown action: '+action});
    }
  }catch(err){
    return _json({ok:false, error:String(err)});
  }
}

   ================================================================== */



/* FMS_SHEET ka saara code ab FMS_Sheet.gs file me hai. */

/* ====================================================================== *
 * v16 - SERVER-SIDE REQUIRED-FIELD VALIDATION
 *   Form Builder me jo question 'required' hai, wo bhare bina naya record
 *   sheet par save nahi hoga - chahe request app se aaye ya kahin aur se.
 *   Purane adhoore records ka sync kabhi nahi rukta: reject sirf tab hota
 *   hai jab (a) record naya hai aur adhoora hai, ya (b) purane record ka
 *   koi pehle se bhara hua zaroori field ab khali kiya ja raha hai.
 *   Kisi bhi internal error par validation chupchaap pass kar deta hai,
 *   taaki sync kisi soorat me na ruke.
 * ====================================================================== */
var REQ_FORM_OF = { orders:'order', enquiries:'enquiry', customers:'customer', products:'product' };
var REQ_TOP = {
  enquiry:  { f_cust:'customer', f_prod:'product', f_qty:'qty', f_src:'source', f_sales:'salesperson', f_prio:'priority', f_note:'note' },
  order:    { o_cust:'customer', o_prod:'product', o_qty:'qty', o_sales:'salesperson', o_pay:'payment', o_stat:'status',
              o_img:'image', o_note:'note', o_date:'date', o_ptype:'productType' },
  customer: { c_name:'name', c_contact:'contact', c_city:'city', c_email:'email', c_phone:'phone', c_type:'type' },
  product:  { p_name:'name', p_sku:'sku', p_cat:'cat', p_price:'price', p_stock:'stock', p_unit:'unit' }
};
var _REQ_CACHE = null;
function _reqFields(which){
  try{
    if(!_REQ_CACHE){
      _REQ_CACHE = {};
      var rows = _readAll('formfields') || [];
      for(var i = 0; i < rows.length; i++){
        var b = _body(rows[i]) || {};
        for(var k in b){ if(b[k] && b[k].length && b[k][0] && b[k][0].id) _REQ_CACHE[k] = b[k]; }
      }
    }
    return _REQ_CACHE[which] || null;
  }catch(e){ return null; }
}
function _reqNonEmpty(v){
  if(v === undefined || v === null) return false;
  if(typeof v === 'number') return true;            /* 0 bhi bhara hua maana jaata hai */
  if(typeof v === 'boolean') return true;
  return String(v).trim() !== '';
}
function _reqFilled(which, body, f){
  var c = body.custom || {}, top = (REQ_TOP[which] || {})[f.id], keys = [f.id];
  if(top) keys.push(top);
  for(var i = 0; i < keys.length; i++){
    if(_reqNonEmpty(c[keys[i]])) return true;
    if(_reqNonEmpty(body[keys[i]])) return true;
  }
  return false;
}
function _reqScan(coll, which, fields, rec, isNew){
  var body = _body(rec) || {}, out = [], i;
  for(i = 0; i < (fields || []).length; i++){
    var f = fields[i];
    if(!f || !f.required || !f.id) continue;
    if(f.type === 'checkbox') continue;
    if(f.type === 'file' && isNew) continue;        /* proof/invoice baad me aate hain */
    if(!_reqFilled(which, body, f)) out.push(String(f.label || f.id));
  }
  /* core rules - form builder me kuch bhi ho, ye hamesha chahiye */
  if(coll === 'orders'){
    if(!_reqNonEmpty(body.customer)) out.push('Customer');
    var it = body.items || [];
    if(!it.length) out.push('At least one product');
    for(i = 0; i < it.length; i++){
      var x = it[i] || {}, n = i + 1;
      if(!_reqNonEmpty(x.product)) out.push('Product ' + n + ': name');
      if(!(Number(x.qty) > 0))     out.push('Product ' + n + ': qty');
      if(!(Number(x.rate) > 0))    out.push('Product ' + n + ': rate');
    }
  } else if(coll === 'customers' || coll === 'products'){
    if(!_reqNonEmpty(body.name)) out.push('Name');
  } else if(coll === 'enquiries'){
    if(!_reqNonEmpty(body.customer)) out.push('Customer');
  }
  return out;
}
function _reqMissing(coll, rec, cur){
  try{
    var which = REQ_FORM_OF[coll];
    if(!which) return [];
    var fields = _reqFields(which);
    var isNew = !cur;
    var now = _reqScan(coll, which, fields, rec, isNew);
    if(!now.length) return [];
    if(isNew) return now;
    /* purana record: sirf wahi field rok do jo pehle bhara tha aur ab khali hai */
    var was = _reqScan(coll, which, fields, cur, false), had = {}, out = [], i;
    for(i = 0; i < was.length; i++) had[was[i]] = 1;
    for(i = 0; i < now.length; i++){ if(!had[now[i]]) out.push(now[i]); }
    return out;
  }catch(e){ return []; }
}

/* ====================================================================== *
 *  OC VIEW-ONLY FULL ACCESS  (additive — upar ka kuch nahi badla)        *
 *  Jin users ko kisi section ka POORA data dekhna hai (par badalne ka    *
 *  haq nahi), unhe yahan jod dijiye. Read-only ka faisla frontend karta  *
 *  hai; server ka kaam sirf itna hai ki wo rows bheje.                   *
 *  Frontend me bhi wahi list honi chahiye (index.html -> v21 block).     *
 * ====================================================================== */
try {
  var OC_VIEW_ONLY = {
    enquiries: ['pc2oakcraft@gmail.com'],
    metaLeads: ['pc2oakcraft@gmail.com']
  };
  Object.keys(OC_VIEW_ONLY).forEach(function (coll) {
    FULL_DATA_USERS[coll] = FULL_DATA_USERS[coll] || [];
    OC_VIEW_ONLY[coll].forEach(function (em) {
      if (FULL_DATA_USERS[coll].indexOf(em) < 0) FULL_DATA_USERS[coll].push(em);
    });
  });
} catch (e) { /* kabhi fail ho to purana behaviour hi chalta rahe */ }

(function(){
  try{ ocAllowIndiaMartCollection_(); }catch(e){}
})();

/**
 * Backend ki allowed-collections list dhoondh kar usme naam jod do.
 * @return {Array<string>} jin variables me naam joda gaya
 */

function ocAllowIndiaMartCollection_(){
  var WANT = 'indiamartLeads';
  var MARKERS = ['enquiries', 'orders'];        /* asli list me ye dono honge */
  /* Sirf NAAMO KI LIST (array) chhui jaati hai -- wahi list `bad_collection`
     ka faisla karti hai. Config objects ko haath nahi lagate. */
  var patched = [];
  var g = this, names = [];
  try{ names = Object.keys(g); }catch(e){ return patched; }

  names.forEach(function(n){
    var v;
    try{ v = g[n]; }catch(e){ return; }
    if(!v || typeof v === 'function') return;

    /* shakal 1: ['enquiries','orders',...] */
    if(Object.prototype.toString.call(v) === '[object Array]'){
      var hasAll = true;
      MARKERS.forEach(function(m){ if(v.indexOf(m) < 0) hasAll = false; });
      if(!hasAll) return;
      if(v.indexOf(WANT) < 0){ v.push(WANT); patched.push(n + ' (array)'); }
      return;
    }

    /* Object shakal ko JAAN-BOOJH KAR chhod dete hain.
       Jaise PREFERRED / FORM_OF / REQ_FORM_OF -- ye allowed-list nahi, har
       collection ka apna config hota hai (column order, form ka naam ...).
       Unme kuch bhi daal dena aage jaakar tod sakta hai, aur `bad_collection`
       ka check unse hota bhi nahi. Naam na hone par backend default behaviour
       le leta hai, jo bilkul theek hai. */
  });
  return patched;
}

/**
 * Jaanch ke liye — chala kar log dekh lijiye. Kuch badalta nahi (patch to
 * upar apne aap lag chuka hota hai), sirf batata hai kya mila.
 */
function checkIndiaMartCollection(){
  var out = [], WANT = 'indiamartLeads';
  var found = [], others = [];
  try{
    var g = this, names = Object.keys(g);
    names.forEach(function(n){
      var v; try{ v = g[n]; }catch(e){ return; }
      if(!v || typeof v === 'function') return;
      if(Object.prototype.toString.call(v) === '[object Array]'){
        if(v.indexOf('enquiries') >= 0 && v.indexOf('orders') >= 0){
          found.push(n + ' (array) -> ' + (v.indexOf(WANT) >= 0 ? 'HAAN, naam juda hai' : 'NAHI') + ' : [' + v.join(',') + ']');
        }
      } else if(typeof v === 'object' && !(v instanceof Date)){
        var keys = []; try{ keys = Object.keys(v); }catch(e){ return; }
        if(keys.indexOf('enquiries') >= 0 && keys.indexOf('orders') >= 0){
          others.push(n + ' (config object, JAAN-BOOJH KAR nahi chhua) : [' + keys.join(',') + ']');
        }
      }
    });
  }catch(e){ out.push('scan error: ' + e); }

  if(!found.length){
    out.push('Koi allowed-collections list nahi mili (na array, na object).');
    out.push('Iska matlab list kisi function ke andar chhupi hai. Code.gs me "bad_collection"');
    out.push('search kijiye -- uske aas-paas collection ke naamo ki list hogi; usme');
    out.push('\'indiamartLeads\' haath se jod dijiye.');
  } else {
    out.push('Allowed-collections list(ein):');
    found.forEach(function(f){ out.push('  ' + f); });
    out.push('"HAAN" likha hai to patch lag chuka hai -- ab Deploy > Manage deployments >');
    out.push('edit > New version > Deploy zaroor kijiye.');
  }
  if(others.length){
    out.push('Ye per-collection config hain, inhe chhua nahi gaya (aur chhedna bhi nahi chahiye):');
    others.forEach(function(f){ out.push('  ' + f); });
  }
  /* seedha API se bhi pooch lo */
  try{
    if(typeof doPost === 'function'){
      var res = doPost({ postData: { contents: JSON.stringify({ action:'list', collection:WANT }), type:'text/plain' }, parameter: {} });
      out.push('API list(' + WANT + ') ka jawab: ' + String(res.getContent()).slice(0, 200));
    }
  }catch(e){ out.push('API test error: ' + e); }
  Logger.log(out.join('\n'));
}

/**
 * Backend kis tarah rows chhaanta hai — SIRF JAANCH. Kuch likhta nahi.
 * ----------------------------------------------------------------------------
 * KYUN
 *   CRM me "bina naam wali (unassigned) lead sabko dikhe" wala rule app me lag
 *   chuka hai, par salesperson ke login me pool khaali dikhta hai. Wajah: rows
 *   uske device tak pahunchti hi nahi -- backend har user ko sirf USKE naam
 *   wali rows bhejta hai, aur bina naam wali kisi ko nahi.
 *
 *   Theek karne ke liye Code.gs ka wahi chhota sa hissa badalna hai jo ye
 *   faisla karta hai. Ye file wahi hissa dhoondh kar dikha deti hai.
 *
 * KAISE
 *   Har global function ka source padh kar wo function dhoondhti hai jisme
 *   'owner' jaisa shabd aata hai, aur uska code chhaap deti hai.
 *
 * SAFETY -- ye zaroori hai
 *   - Kuch likhti nahi: koi setValue / upsert / delete / property change nahi.
 *   - PASSWORD, TOKEN, SECRET, KEY, HASH jaise naam wale function JAAN-BOOJH
 *     KAR nahi chhaape jaate -- sirf unka naam aata hai.
 *   - Jo lamba random sa text (signing key jaisa) code me mile, wo
 *     "[HATAYA GAYA]" likh kar chhupa diya jaata hai.
 *   - Kisi lead, customer ya user ka data nahi chhapta.
 *   Phir bhi log bhejne se pehle ek nazar daal lijiye -- jo na bhejna ho
 *   wo hata dijiye.
 *
 * CHALANE KA TAREEKA
 *   1. Ye file Apps Script me paste kijiye (usi project me jahan Code.gs hai).
 *   2. `probeOwnerFilter` run kijiye.
 *   3. Execution log copy karke bhej dijiye.
 */

/** Yahi chalaiye. */
function probeOwnerFilter(){
  var out = [];
  out.push('===== OWNER FILTER PROBE =====');

  var g = this, names = [];
  try{ names = Object.keys(g); }catch(e){ out.push('globals padhe nahi gaye: ' + e); }

  var hits = [], skipped = [], other = [];
  names.forEach(function(n){
    var v;
    try{ v = g[n]; }catch(e){ return; }
    if(typeof v !== 'function') return;
    if(n === 'probeOwnerFilter' || n.indexOf('ofp_') === 0) return;   /* khud ko nahi chhaapna */

    var src = '';
    try{ src = String(v); }catch(e){ return; }
    if(!/owner|ownerEmail|createdBy|FULL_DATA|isAdmin|scope/i.test(src)) return;

    if(ofp_secret_(n) || ofp_secret_(src.slice(0, 400))){ skipped.push(n); return; }
    if(src.length > 4000){ other.push(n + '  (bahut lamba — ' + src.length + ' akshar)'); return; }
    hits.push({ name: n, src: ofp_clean_(src) });
  });

  if(!hits.length){
    out.push('Koi aisa function nahi mila jisme "owner" ka zikr ho.');
    out.push('Iska matlab chhantai kisi doosre naam se ho rahi hai. Code.gs me');
    out.push('"owner" search karke wo hissa bhej dijiye.');
  } else {
    out.push(hits.length + ' function me "owner" ka zikr hai:');
    out.push('');
    hits.forEach(function(h){
      out.push('---------- ' + h.name + ' ----------');
      out.push(h.src);
      out.push('');
    });
  }
  if(other.length){
    out.push('Ye bhi milte-julte hain par bahut lambe hain (naam bhej diya hai):');
    other.forEach(function(n){ out.push('  ' + n); });
  }
  if(skipped.length){
    out.push('Ye JAAN-BOOJH KAR nahi chhaape (password / token / key jaisa kuch tha):');
    skipped.forEach(function(n){ out.push('  ' + n); });
  }
  out.push('===== END =====');
  Logger.log(out.join('\n'));
}

/** naam ya code me koi raaz jaisa shabd? */
function ofp_secret_(s){
  return /secret|password|passwd|token|signing|private|apikey|api_key|credential/i.test(String(s || ''));
}

/** lambe random se text (key jaisa) hata do */
function ofp_clean_(src){
  return String(src)
    .replace(/(['"])[A-Za-z0-9+\/=_\-]{24,}\1/g, '$1[HATAYA GAYA]$1')
    .replace(/[ \t]+$/gm, '');
}

/**
 * Bina naam wali (unassigned) lead poori sales team tak pahunchaane ka patch.
 * ----------------------------------------------------------------------------
 * DIKKAT
 *   CRM me rule lag chuka hai ki jis lead par kisi ka naam na ho wo sabko
 *   dikhe, aur naam padte hi sirf usi ko. Par salesperson ke login me pool
 *   khaali dikhta tha -- kyunki wo rows uske device tak pahunchti hi nahi.
 *
 *   Wajah Code.gs ke `_scope()` me hai. Uska aakhri hissa:
 *
 *       for(var i=0;i<rows.length;i++){
 *         if(_ownerOf(rows[i]) === u.email) out.push(rows[i]);
 *       }
 *
 *   `_ownerOf()` bina naam wali row par khaali string ('') lautaata hai, aur
 *   '' kisi ke email ke barabar nahi hota. Isliye aisi HAR row chhant jaati
 *   hai -- wo kisi ki nahi hai, phir bhi kisi ko nahi milti.
 *
 * KYA KARTA HAI
 *   `_scope()` ko lapet deta hai. Sirf LEAD wali collections par, aur sirf
 *   jab user ko poora data nahi milta, wo un rows ko WAAPAS jod deta hai
 *   jinpar KISI KA BHI naam nahi hai. Jis row par kisi aur ka naam hai wo
 *   pehle ki tarah nahi dikhti.
 *
 *   Yaani sirf itna badla: "jo kisi ki nahi hai wo sabki hai".
 *   Kisi ka niji data nahi khulta.
 *
 * KAISE LAGAYEIN
 *   1. Ye poora code ek nayi file me paste kijiye (Code.gs ke saath waale
 *      project me) -- ya Code.gs ke sabse neeche. Phir Save.
 *   2. `checkPoolScope` run karke dekh lijiye ki patch lag gaya.
 *   3. ZAROORI -- Deploy > Manage deployments > pencil (edit) >
 *      Version: "New version" > Deploy.
 *      URL wahi rehta hai. Naye version ke bina web app purana code hi
 *      chalata rahega aur kuch nahi badlega.
 *
 * WAPAS HATANA HO
 *   POOL_COLLS ko khaali kar dijiye:  var POOL_COLLS = [];
 *   Sab pehle jaisa ho jayega.
 *
 * SAFETY
 *   - Kisi sheet ko na padhta hai na likhta hai.
 *   - Sirf PADHNE ka dayra badalta hai, aur wo bhi sirf un rows ka jinpar
 *     kisi ka naam nahi. Admin / Sales Manager par koi asar nahi (unhe
 *     pehle se sab milta hai).
 *   - Do baar chal jaye to bhi ek hi baar lagta hai.
 */

/* Sirf in collections me "bina naam wali lead sabki" wala rule chalega.
   Yahan se naam hata denge to wo collection pehle jaisa ho jayega. */
var POOL_COLLS = ['indiamartLeads', 'metaLeads'];

/** Load hote hi apne aap lag jaata hai. */
(function(){
  try{ ocPoolPatchScope_(); }catch(e){}
})();

/**
 * `_scope()` ko lapet do -- bina naam wali rows wapas jod do.
 * @return {boolean} laga ya nahi
 */
function ocPoolPatchScope_(){
  if(typeof _scope !== 'function') return false;
  if(_scope.__ocPool) return true;                 /* pehle se laga hai */

  var orig = _scope;
  var wrapped = function(coll, rows, u){
    var out = orig.apply(this, arguments);
    try{
      if(POOL_COLLS.indexOf(coll) < 0) return out;
      if(!u || u.legacy || u.isAdmin) return out;  /* inhe pehle se sab milta hai */
      if(!rows || !out || !rows.length) return out;
      if(out.length === rows.length) return out;   /* sab mil hi raha hai */

      var seen = {}, i, r;
      for(i = 0; i < out.length; i++){
        r = out[i];
        if(r && r.id != null) seen[String(r.id)] = 1;
      }
      var add = [];
      for(i = 0; i < rows.length; i++){
        r = rows[i];
        if(!r) continue;
        if(r.id != null && seen[String(r.id)]) continue;
        if(_ownerOf(r) === '') add.push(r);        /* kisi ki nahi -> sabki */
      }
      return add.length ? out.concat(add) : out;
    }catch(e){ return out; }                       /* kuch gadbad ho to purana hi */
  };
  wrapped.__ocPool = true;
  _scope = wrapped;
  return true;
}

/**
 * Jaanch ke liye — chala kar log dekh lijiye. Kuch badalta nahi.
 * Ek naqli salesperson bana kar dikhata hai ki use ab kya milega.
 */
function checkPoolScope(){
  var out = [];
  out.push('===== POOL SCOPE PATCH =====');

  if(typeof _scope !== 'function'){
    out.push('_scope() nahi mila. Ye file Code.gs waale project me nahi hai,');
    out.push('ya Code.gs se PEHLE load ho rahi hai.');
    Logger.log(out.join('\n')); return;
  }
  out.push('patch laga hai : ' + (_scope.__ocPool ? 'HAAN' : 'NAHI'));
  out.push('collections    : ' + POOL_COLLS.join(', '));

  /* naqli data par chala kar dekho */
  var rows = [
    { id:'A', data:{ owner:'' } },                      /* kisi ki nahi */
    { id:'B', data:{ owner:'' } },                      /* kisi ki nahi */
    { id:'C', data:{ owner:'ujala@oakcraft.in' } },     /* Ujala ki */
    { id:'D', data:{ owner:'niti@oakcraft.in' } }       /* kisi aur ki */
  ];
  var ujala = { email:'ujala@oakcraft.in', role:'Sales Executive', isAdmin:false };
  var admin = { email:'mis@oakcraft.in',   role:'Administrator',   isAdmin:true  };

  POOL_COLLS.forEach(function(c){
    try{
      var got = _scope(c, rows, ujala) || [];
      out.push('  ' + c + ' — Ujala ko milegi: ' + got.map(function(r){ return r.id; }).join(', ')
               + '   (A, B, C aana chahiye — D nahi)');
    }catch(e){ out.push('  ' + c + ' — error: ' + e); }
  });
  try{
    var ga = _scope(POOL_COLLS[0], rows, admin) || [];
    out.push('  admin ko milegi: ' + ga.map(function(r){ return r.id; }).join(', ') + '   (saari)');
  }catch(e){}

  try{
    var enq = _scope('enquiries', rows, ujala) || [];
    out.push('  enquiries (pool se bahar) — Ujala ko: ' + (enq.map(function(r){ return r.id; }).join(', ') || '(sirf apni)')
             + '   (sirf C aana chahiye)');
  }catch(e){}

  out.push('');
  out.push('"HAAN" aur upar wali line sahi ho to ab ZAROORI:');
  out.push('  Deploy > Manage deployments > pencil > Version: New version > Deploy');
  out.push('  Uske bina web app purana code hi chalata rahega.');
  out.push('=====');
  Logger.log(out.join('\n'));
}

/**
 * Qualified ke naye fields sheet tak pahunche ya nahi — SIRF JAANCH.
 * ----------------------------------------------------------------------------
 * Kuch likhta nahi, kuch badalta nahi. Chala kar log bhej dijiye.
 *
 * KYUN
 *   CRM me "Qualified" ek ALAG DATABASE NAHI hai -- wo ek VIEW hai. Uska apna
 *   koi tab nahi banta aur banna bhi nahi chahiye. Wo teen jagah se padhta hai:
 *
 *       enquiries  +  indiamartLeads  +  metaLeads
 *
 *   ...aur jis record ka status Qualified / System Master / Quotation Sent /
 *   Won / Lost hota hai, wahi Qualified section me dikh jaata hai. Agar uska
 *   apna tab hota to ek hi lead ki DO copy ho jaatin -- ek lead wale tab me,
 *   ek Qualified tab me -- aur status badalte hi dono alag-alag ho jaatin.
 *
 *   Qualified par jo do sawaal poochhe jaate hain, unke jawab USI lead ke
 *   record par likhe jaate hain:
 *
 *       qualCustType        Architect / Hotel / Resort / ...
 *       qualCustTypeOther   "Other" chuna to salesperson ka likha hua
 *       qualQty             purchase quantity
 *       qualAskedAt         kab bhara gaya
 *
 *   Yaani inka ghar wahi teen tab hain. Ye file batati hai ki wo wahan
 *   pahunche ya nahi -- aur agar nahi, to kahan atke.
 *
 * KAISE CHALAYEIN
 *   1. Ye file Apps Script me paste kijiye (Code.gs ke saath waale project me).
 *   2. `checkQualifiedFields` run kijiye.
 *   3. Execution log poora copy karke bhej dijiye.
 *
 * SAFETY
 *   - Sirf padhti hai. Koi setValue / upsert / delete nahi.
 *   - Kisi ka password, token ya poora data log nahi karti -- sirf ginti,
 *     column ke naam aur ek nammune ka type/qty.
 *   - Chalane ke baad file hata bhi sakte hain, kuch peeche nahi chhodti.
 */

var QFC_COLLS = ['enquiries', 'indiamartLeads', 'metaLeads'];
var QFC_FIELDS = ['qualCustType', 'qualCustTypeOther', 'qualQty', 'qualAskedAt'];

/** Yahi chalaiye. */
function checkQualifiedFields(){
  var out = [];
  out.push('===== QUALIFIED FIELDS CHECK =====');
  out.push('Qualified ka apna koi tab nahi hota -- wo view hai.');
  out.push('Jawab in teen collection ke record par hi likhe jaate hain.');
  out.push('');

  /* ---- 1. record me fields hain ya nahi (_readAll se) ---- */
  out.push('--- 1. CRM ke record me (backend ne jo padha) ---');
  QFC_COLLS.forEach(function(c){
    var rows = [];
    try{ rows = _readAll(c) || []; }
    catch(e){ out.push('  ' + c + ' : padha nahi gaya -- ' + e); return; }

    var total = rows.length, qual = 0, filled = 0, sample = '';
    rows.forEach(function(r){
      var d = (r && r.data !== undefined) ? r.data : r;
      if(!d || typeof d !== 'object') return;
      var st = qfc_lc_(d.lead_status || d.status || d.stage);
      var isQ = (st === 'qualified' || st === 'system_master' || st === 'system master'
              || st === 'quotation_sent' || st === 'quoted' || st === 'won' || st === 'lost');
      if(isQ) qual++;
      if(qfc_tr_(d.qualCustType) && qfc_tr_(d.qualQty)){
        filled++;
        if(!sample) sample = qfc_tr_(d.qualCustType)
          + (qfc_tr_(d.qualCustTypeOther) ? ' (' + qfc_tr_(d.qualCustTypeOther) + ')' : '')
          + ' , qty ' + qfc_tr_(d.qualQty);
      }
    });
    out.push('  ' + c + ' : ' + total + ' record | qualified-type status par ' + qual
             + ' | jawab bhare hue ' + filled + (sample ? '  (jaise: ' + sample + ')' : ''));
  });

  /* ---- 2. sheet ke tab me column bane ya nahi ---- */
  out.push('');
  out.push('--- 2. Sheet ke tab me column ---');
  var ss = null;
  try{ ss = SpreadsheetApp.getActiveSpreadsheet(); }catch(e){}
  if(!ss){
    out.push('  Spreadsheet nahi mila (ye file us project me chalaiye jo backend sheet se juda hai).');
  } else {
    out.push('  spreadsheet: ' + ss.getName());
    QFC_COLLS.forEach(function(c){
      var sh = null;
      try{ sh = ss.getSheetByName(c); }catch(e){}
      if(!sh){ out.push('  ' + c + ' : tab hi nahi mila'); return; }
      var head = [];
      try{
        var lc = sh.getLastColumn();
        if(lc > 0) head = sh.getRange(1, 1, 1, lc).getValues()[0] || [];
      }catch(e){}
      var lower = head.map(function(h){ return qfc_lc_(h); });
      var missing = [];
      QFC_FIELDS.forEach(function(f){ if(lower.indexOf(qfc_lc_(f)) < 0) missing.push(f); });

      out.push('  ' + c + ' : ' + Math.max(0, sh.getLastRow() - 1) + ' row, ' + head.length + ' column');
      out.push('      header: ' + head.join(' | ').slice(0, 400));
      out.push('      qual* column : ' + (missing.length ? 'NAHI mile -> ' + missing.join(', ') : 'sab maujood'));
      /* data ek hi JSON column me to nahi rakha? */
      if(lower.indexOf('data') >= 0){
        out.push('      NOTE: "data" naam ka column hai -- backend poora record JSON me rakhta hai,');
        out.push('            isliye alag column banne ki zarurat hi nahi. Jawab uske andar honge.');
      }
    });
  }

  /* ---- 3. faisla ---- */
  out.push('');
  out.push('--- 3. Matlab ---');
  out.push('  (a) "jawab bhare hue" 0 hai -> abhi kisi lead par form bhara hi nahi gaya.');
  out.push('      CRM me ek lead Qualified karke dekhiye, phir dobara chalaiye.');
  out.push('  (b) record me jawab dikh rahe hain aur column bhi ban gaye -> sab theek hai.');
  out.push('  (c) record me jawab dikh rahe hain par column nahi bane -> Code.gs naye');
  out.push('      column khud nahi banata. Ye log bhej dijiye, uska patch bana dunga.');
  out.push('  (d) record me jawab NAHI dikh rahe par CRM me dikh rahe hain -> push atka hai;');
  out.push('      CRM ke console me ocLeadPending() chala kar dekhiye.');
  out.push('===== END =====');
  Logger.log(out.join('\n'));
}

function qfc_tr_(v){ return v == null ? '' : String(v).trim(); }
function qfc_lc_(v){ return qfc_tr_(v).toLowerCase(); }
