function renderResumen() {
  registros = DB.get('kpi_registros');
  var periodos = registros.map(function(r){return r.periodo;}).filter(function(v,i,a){return a.indexOf(v)===i;}).sort().reverse();
  var sel = document.getElementById('filtroPeriodoResumen');
  var cur = sel.value;
  sel.innerHTML = '<option value="">Último por KPI</option>' +
    periodos.map(function(p){return '<option value="' + p + '"' + (cur===p?' selected':'') + '>' + cicloLabel(p) + '</option>';}).join('');
  var filtro = sel.value;
  var mapa = {};
  if (!filtro) mapa = lastByKpi();
  else registros.filter(function(r){return r.periodo===filtro;}).forEach(function(r){mapa[r.kpiId]=r;});
  var sc2 = scoreTotal(mapa);
  var el = document.getElementById('resumenContent');
  if (!sc2) {
    el.innerHTML = '<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><h3>Sin datos</h3><p>Registra valores para ver el resumen.</p></div>';
    return;
  }
  var v = parseFloat(sc2.val);
  var bc = v >= 4 ? 'var(--green)' : v >= 2.5 ? 'var(--yellow)' : 'var(--red)';
  var cl = v >= 4.5 ? 'EXCELENTE' : v >= 3.5 ? 'BUENO' : v >= 2.5 ? 'REGULAR' : 'CRÍTICO';
  el.innerHTML = '<div class="resumen-grid">' +
    '<div class="resumen-card" style="display:flex;flex-direction:column;gap:12px">' +
    '<div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px">Nota Ponderada Total</div>' +
    '<div style="display:flex;align-items:flex-end;gap:12px">' +
    '<div style="font-size:60px;font-weight:900;line-height:1;color:' + bc + '">' + sc2.val + '</div>' +
    '<div style="padding-bottom:8px"><div style="font-size:11px;color:var(--text2)">de 5.00</div>' +
    '<span class="badge ' + (v>=4?'badge-green':v>=2.5?'badge-yellow':'badge-red') + '">' + cl + '</span></div></div>' +
    '<div style="background:var(--border);border-radius:5px;height:10px;overflow:hidden">' +
    '<div style="height:100%;border-radius:5px;background:' + bc + ';width:' + Math.min(v/5*100,100) + '%"></div></div>' +
    '<div style="font-size:12px;color:var(--text2)">' + sc2.cnt + ' de ' + KPI.length + ' KPIs · Ponderación: ' + sc2.sumP + '%</div></div>' +
    '<div class="resumen-card"><div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px">Distribución de Notas</div>' +
    [5,3,1].map(function(n) {
      var cnt = KPI.filter(function(k){return mapa[k.id]&&mapa[k.id].nota===n;}).length;
      var pond = KPI.filter(function(k){return mapa[k.id]&&mapa[k.id].nota===n;}).reduce(function(s,k){return s+k.pond;}, 0);
      return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">' +
        '<div style="width:24px;height:24px;border-radius:6px;background:' + nc(n) + ';display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#fff;flex-shrink:0">' + n + '</div>' +
        '<div style="flex:1"><div style="font-size:12px;font-weight:600">' + cnt + ' KPI' + (cnt!==1?'s':'') + ' · ' + pond + '%</div>' +
        '<div class="progress-bg" style="margin-top:4px"><div class="progress-fill" style="width:' + (KPI.length>0?cnt/KPI.length*100:0) + '%;background:' + nc(n) + '"></div></div></div></div>';
    }).join('') + '</div></div>' +
    '<div class="card"><div class="card-header"><div class="card-title">Detalle por Indicador</div></div>' +
    KPI.map(function(k) {
      var r = mapa[k.id], nota = r ? r.nota : null;
      var contrib = r ? (r.nota*k.pond/100).toFixed(2) : null;
      return '<div class="resumen-kpi-row">' +
        '<div class="semaforo ' + sc(nota) + '" style="width:11px;height:11px;flex-shrink:0"></div>' +
        '<div class="resumen-nota" style="color:' + nc(nota) + '">' + (nota || '—') + '</div>' +
        '<div class="resumen-info"><div class="resumen-name">' + k.id + '. ' + k.nombre + '</div>' +
        '<div class="resumen-detail">' + (r ? r.pct.toFixed(1) + '% · ' + cicloCorto(r.periodo) + ' · Meta ' + (k.invertido?'≤':'≥') + k.meta + '%' : 'Sin datos') + '</div></div>' +
        '<div class="progress-wrap"><div class="progress-bg"><div class="progress-fill" style="width:' + (r ? Math.min(r.pct/(k.invertido?k.meta*2:k.meta)*100,100) : 0) + '%;background:' + nc(nota) + '"></div></div></div>' +
        '<div class="resumen-pond"><div>' + k.pond + '%</div><div style="font-size:10px;color:' + nc(nota) + '">' + (contrib ? '+'+contrib : '—') + '</div></div></div>';
    }).join('') + '</div>';
}
