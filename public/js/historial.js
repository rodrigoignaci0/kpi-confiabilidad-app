function renderHistorial() {
  registros = DB.get('kpi_registros');
  var fk = document.getElementById('filtroHistKpi');
  var fp = document.getElementById('filtroHistPer');
  var ck = fk.value, cp = fp.value;
  fk.innerHTML = '<option value="">Todos los KPIs</option>' +
    KPI.map(function(k){return '<option value="' + k.id + '"' + (ck==k.id?' selected':'') + '>' + k.id + '. ' + k.nombre + '</option>';}).join('');
  var pers = registros.map(function(r){return r.periodo;}).filter(function(v,i,a){return a.indexOf(v)===i;}).sort().reverse();
  fp.innerHTML = '<option value="">Todos los periodos</option>' +
    pers.map(function(p){return '<option value="' + p + '"' + (cp===p?' selected':'') + '>' + cicloLabel(p) + '</option>';}).join('');
  var hist = registros.slice().sort(function(a,b){return b.creadoEn.localeCompare(a.creadoEn);});
  if (ck) hist = hist.filter(function(r){return r.kpiId==ck;});
  if (cp) hist = hist.filter(function(r){return r.periodo===cp;});
  var tbody = document.getElementById('histBody');
  if (!hist.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--text2);padding:32px">Sin registros</td></tr>';
    return;
  }
  tbody.innerHTML = hist.map(function(r,i) {
    var k = KPI.find(function(x){return x.id===r.kpiId;});
    return '<tr>' +
      '<td style="color:var(--text2)">' + (hist.length-i) + '</td>' +
      '<td style="font-weight:600;max-width:200px;overflow:hidden;text-overflow:ellipsis">' + (k?k.nombre:'—') + '</td>' +
      '<td><span class="badge badge-' + (k&&k.freq==='Semanal'?'blue':'gray') + '">' + (k?k.freq:'—') + '</span></td>' +
      '<td><span class="periodo-badge" title="' + r.periodo + '">' + cicloCorto(r.periodo) + '</span></td>' +
      '<td>' + r.num + '</td>' +
      '<td>' + r.den + '</td>' +
      '<td style="font-weight:700">' + r.pct.toFixed(1) + '%</td>' +
      '<td style="text-align:center"><strong style="font-size:15px;color:' + nc(r.nota) + '">' + r.nota + '</strong></td>' +
      '<td>' + (k?k.pond+'%':'—') + '</td>' +
      '<td><div style="display:flex;gap:4px">' +
      '<button class="btn btn-sm btn-ghost" onclick="editarReg(\'' + r.id + '\')" title="Editar">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="13" height="13"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>' +
      '<button class="btn btn-sm btn-danger" onclick="eliminarReg(\'' + r.id + '\')" title="Eliminar">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="13" height="13"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></button>' +
      '</div></td></tr>';
  }).join('');
}

function exportarExcel() {
  if (typeof XLSX === 'undefined') { alert('SheetJS no disponible'); return; }
  var wb = XLSX.utils.book_new();
  var cfg = CFG.get();

  // ── Hoja 1: Historial KPIs ──
  var rows = [['N°','Indicador','Frecuencia','Periodo','Realizado','Planificado','%','Nota','Ponderacion%','Contribucion','Observacion']];
  registros.slice().sort(function(a,b){return a.creadoEn.localeCompare(b.creadoEn);}).forEach(function(r,i) {
    var k = KPI.find(function(x){return x.id===r.kpiId;});
    rows.push([i+1, k?k.nombre:'', k?k.freq:'', r.periodo, r.num, r.den,
      parseFloat(r.pct.toFixed(2)), r.nota, k?k.pond:'',
      k?parseFloat((r.nota*k.pond/100).toFixed(3)):'', r.obs||'']);
  });
  var ws1 = XLSX.utils.aoa_to_sheet(rows);
  ws1['!cols'] = [{wch:4},{wch:30},{wch:10},{wch:12},{wch:11},{wch:12},{wch:8},{wch:6},{wch:12},{wch:12},{wch:30}];
  XLSX.utils.book_append_sheet(wb, ws1, 'Historial KPIs');

  // ── Hoja 2: Score por Periodo ──
  var periodos = registros.map(function(r){return r.periodo;}).filter(function(v,i,a){return a.indexOf(v)===i;}).sort();
  var rows2 = [['Periodo'].concat(KPI.map(function(k){return k.nombre;})).concat(['SCORE TOTAL','Estado'])];
  periodos.forEach(function(p) {
    var mapa = {};
    registros.filter(function(r){return r.periodo===p;}).forEach(function(r){ mapa[r.kpiId]=r.nota; });
    var sc = scoreTotal(mapa);
    var v = parseFloat(sc.val||sc||0);
    var estado = v>=4.5?'EXCELENTE':v>=3.5?'BUENO':v>=2.5?'REGULAR':'CRÍTICO';
    rows2.push([p].concat(KPI.map(function(k){return mapa[k.id]||'';})).concat([parseFloat(v.toFixed(2)), estado]));
  });
  var ws2 = XLSX.utils.aoa_to_sheet(rows2);
  XLSX.utils.book_append_sheet(wb, ws2, 'Score por Periodo');

  // ── Hoja 3: Resumen por KPI (último valor) ──
  var mapa3 = lastByKpi();
  var rows3 = [['ID','Indicador','Frecuencia','Meta','Meta Inv.','Ult. Periodo','Realizado','Planificado','%','Nota','Ponderacion%','Contribucion','Estado']];
  KPI.forEach(function(k) {
    var r = mapa3[k.id];
    var nota = r ? r.nota : '';
    var estado = nota===5?'CUMPLE':nota===3?'OBSERVADO':nota===1?'NO CUMPLE':'Sin datos';
    rows3.push([k.id, k.nombre, k.freq, k.meta, k.invertido?'Si':'No',
      r?r.periodo:'', r?r.num:'', r?r.den:'',
      r?parseFloat(r.pct.toFixed(2)):'', nota, k.pond,
      r?parseFloat((r.nota*k.pond/100).toFixed(3)):'', estado]);
  });
  var ws3 = XLSX.utils.aoa_to_sheet(rows3);
  ws3['!cols'] = [{wch:4},{wch:30},{wch:10},{wch:6},{wch:8},{wch:12},{wch:11},{wch:12},{wch:8},{wch:6},{wch:12},{wch:12},{wch:12}];
  XLSX.utils.book_append_sheet(wb, ws3, 'Resumen KPIs');

  // ── Hoja 4: Detenciones por Semana ──
  var rows4 = [['Semana','EQAC %','Mant. PL %','Mant. NP %','Falta Repuesto %','Total InDisp %','Disponibilidad %','Parque Operativo']];
  DET_SEMANAS.forEach(function(s) {
    var total = +(s.eqac+s.pl+s.np+s.rep).toFixed(1);
    rows4.push([s.label, s.eqac, s.pl, s.np, s.rep, total, +(100-total).toFixed(1), s.parque]);
  });
  var ws4 = XLSX.utils.aoa_to_sheet(rows4);
  ws4['!cols'] = [{wch:10},{wch:9},{wch:11},{wch:11},{wch:18},{wch:14},{wch:14},{wch:16}];
  XLSX.utils.book_append_sheet(wb, ws4, 'Detenciones Semana');

  // ── Hoja 5: Equipos por Semana (Jack Knife) ──
  var rows5 = [['Semana','Equipo','Disponibilidad %','N° Fallas','MTTR (hrs)','Estado']];
  DET_SEMANAS.forEach(function(s) {
    (DET_EQUIPOS[s.id]||[]).forEach(function(e) {
      var estado = e.disp>=80?'OK':e.disp>=60?'ATENCIÓN':'CRÍTICO';
      rows5.push([s.label, e.id, e.disp, e.f, e.mttr, estado]);
    });
  });
  var ws5 = XLSX.utils.aoa_to_sheet(rows5);
  ws5['!cols'] = [{wch:10},{wch:8},{wch:16},{wch:10},{wch:12},{wch:10}];
  XLSX.utils.book_append_sheet(wb, ws5, 'Equipos Jack Knife');

  // ── Hoja 6: NP por Sistema ──
  var rows6 = [['Sistema','% InDisp NP','N° Fallas','Hrs Detencion','Componentes Afectados']];
  DET_NP.forEach(function(n) {
    rows6.push([n.s, n.indisp, n.f, n.hrs, n.comps.join(' | ')]);
  });
  var tot6 = DET_NP.reduce(function(a,b){return {indisp:+(a.indisp+b.indisp).toFixed(1),f:a.f+b.f,hrs:a.hrs+b.hrs};},{indisp:0,f:0,hrs:0});
  rows6.push(['TOTAL NP', tot6.indisp, tot6.f, tot6.hrs, '']);
  var ws6 = XLSX.utils.aoa_to_sheet(rows6);
  ws6['!cols'] = [{wch:14},{wch:14},{wch:10},{wch:14},{wch:60}];
  XLSX.utils.book_append_sheet(wb, ws6, 'NP por Sistema');

  XLSX.writeFile(wb, 'KPIs_' + (cfg.contrato||'Confiabilidad') + '_' + today() + '.xlsx');
}

function exportarCSV() {
  var rows = [['N°','Indicador','Frecuencia','Periodo','Realizado','Planificado','%','Nota','Ponderacion%','Contribucion','Observacion']];
  registros.slice().sort(function(a,b){return a.creadoEn.localeCompare(b.creadoEn);}).forEach(function(r,i) {
    var k = KPI.find(function(x){return x.id===r.kpiId;});
    rows.push([i+1,k?k.nombre:'',k?k.freq:'',r.periodo,r.num,r.den,
      r.pct.toFixed(2),r.nota,k?k.pond:'',k?(r.nota*k.pond/100).toFixed(3):'',r.obs||'']);
  });
  var csv = rows.map(function(r){return r.map(function(c){return '"'+String(c).replace(/"/g,'""')+'"';}).join(',');}).join('\n');
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8'}));
  a.download = 'KPIs_Confiabilidad_' + today() + '.csv';
  a.click();
}
