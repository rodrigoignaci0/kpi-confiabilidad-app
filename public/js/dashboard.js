function renderDashboard() {
  registros = DB.get('kpi_registros');
  var mapa = lastByKpi(), sc2 = scoreTotal(mapa);
  var periodos = registros.map(function(r){return r.periodo;}).filter(function(v,i,a){return a.indexOf(v)===i;}).sort().reverse();
  document.getElementById('sfPeriodo').textContent = periodos[0] || 'Sin registros';
  var banner = document.getElementById('scoreBanner');

  if (!sc2) {
    banner.innerHTML = '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:24px;margin-bottom:20px;text-align:center;color:var(--text2)">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="36" height="36" style="margin:0 auto 12px;display:block;color:#d1d5db"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>' +
      '<div style="font-size:15px;font-weight:600;color:var(--text);margin-bottom:6px">Sin registros aún</div>' +
      '<div style="font-size:13px;margin-bottom:14px">Comienza registrando el primer valor de KPI</div>' +
      '<button class="btn btn-primary" onclick="openModal(\'modalKPI\')">+ Registrar primer valor</button></div>';
  } else {
    var v = parseFloat(sc2.val);
    var bc = v >= 4 ? '#22c55e' : v >= 2.5 ? '#f59e0b' : '#ef4444';
    var cl = v >= 4.5 ? 'EXCELENTE' : v >= 3.5 ? 'BUENO' : v >= 2.5 ? 'REGULAR' : 'CRÍTICO';
    banner.innerHTML = '<div class="score-banner">' +
      '<div><div class="score-num">' + sc2.val + '<span style="font-size:26px;font-weight:400;opacity:.6"> / 5</span></div>' +
      '<div class="score-label">Nota Ponderada Total · ' + cl + '</div>' +
      '<div class="score-bar-wrap"><div class="score-bar-bg"><div class="score-bar-fill" style="width:' + Math.min(v/5*100,100) + '%;background:' + bc + '"></div></div>' +
      '<div style="font-size:10px;opacity:.6;margin-top:4px">' + sc2.cnt + ' de ' + KPI.length + ' KPIs · Ponderación: ' + sc2.sumP + '%</div></div></div>' +
      '<div class="score-kpis">' + KPI.map(function(k) {
        var r = mapa[k.id]; var n = r ? r.nota : null;
        return '<div class="score-kpi-item"><div class="n" style="color:' + (n ? nc(n) : 'rgba(255,255,255,.25)') + '">' + (n || '—') + '</div><div class="l">KPI ' + k.id + '</div></div>';
      }).join('') + '</div></div>';
  }

  renderAlertas(mapa);
  renderRadar(mapa);
  renderProyeccion(mapa);
  renderTendencia();
  renderCalendario();

  document.getElementById('kpiGrid').innerHTML = KPI.map(function(k) {
    var r = mapa[k.id], nota = r ? r.nota : null, pct = r ? r.pct : null;
    var gw = pct != null ? Math.min(pct / (k.invertido ? k.meta*2 : k.meta) * 100, 100) : 0;
    var fill = nc(nota);
    var hist = registros.filter(function(x){return x.kpiId===k.id;}).sort(function(a,b){return a.creadoEn.localeCompare(b.creadoEn);}).slice(-5);
    var trend = hist.length > 1 ? '<div class="trend-wrap">' + hist.map(function(h) {
      var hw = Math.min(h.pct / (k.invertido ? k.meta*2 : k.meta) * 100, 100);
      return '<div class="trend-bar" style="height:' + Math.max(hw*.32,4) + 'px;background:' + nc(h.nota) + ';opacity:.8" title="' + h.periodo + ': ' + h.pct.toFixed(1) + '%"></div>';
    }).join('') + '</div>' : '';
    return '<div class="kpi-card">' +
      '<div class="kpi-card-header"><div class="semaforo ' + sc(nota) + '"></div><div class="kpi-name">' + k.id + '. ' + k.nombre + '</div><span class="freq-tag">' + k.freq + '</span></div>' +
      '<div class="kpi-body"><div><div class="nota-big ' + nClass(nota) + '">' + (nota || '—') + '</div>' +
      '<div style="font-size:11px;color:var(--text2);margin-top:4px">' + (pct != null ? '<strong style="color:' + fill + '">' + pct.toFixed(1) + '%</strong>' : 'Sin dato') + (r ? ' · ' + r.periodo : '') + '</div></div>' +
      '<div class="kpi-meta">' + trend + '<span class="meta-chip">' + (k.invertido ? '≤' : '≥') + k.meta + '% · ' + k.pond + '%</span></div></div>' +
      '<div><div class="gauge-bar"><div class="gauge-fill" style="width:' + gw + '%;background:' + fill + '"></div></div>' +
      '<div class="gauge-labels"><span>0%</span><span>Meta ' + k.meta + '%</span><span>100%</span></div></div>' +
      '<div style="font-size:10px;color:var(--text2)">' + k.fuente + '</div>' +
      '<div class="kpi-footer"><div class="kpi-rangos">' + k.rangos + '</div>' +
      '<button class="btn btn-sm btn-primary" onclick="abrirKpi(' + k.id + ')">+ Registrar</button></div></div>';
  }).join('');
}

function renderAlertas(mapa) {
  var el = document.getElementById('alertasRiesgo');
  var criticos = [], atencion = [];
  KPI.forEach(function(k) {
    var hist = registros.filter(function(r){return r.kpiId===k.id;}).sort(function(a,b){return b.periodo.localeCompare(a.periodo);});
    if (hist.length >= 2 && hist[0].nota < 5 && hist[1].nota < 5) {
      if (hist[0].nota === 1) criticos.push({k:k,nota:hist[0].nota,periodos:hist[0].periodo});
      else atencion.push({k:k,nota:hist[0].nota,periodos:hist[0].periodo});
    }
  });
  if (!criticos.length && !atencion.length) {
    el.innerHTML = '<div class="alert-banner ok"><div class="alert-icon" style="background:#dcfce7"><svg viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg></div>' +
      '<div><div class="alert-title" style="color:var(--green)">Sin alertas activas</div><div style="font-size:12px;color:var(--text2)">Todos los KPIs con datos están bajo control</div></div></div>';
    return;
  }
  var html = '';
  if (criticos.length) html += '<div class="alert-banner riesgo"><div class="alert-icon" style="background:#fee2e2"><svg viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>' +
    '<div style="flex:1"><div class="alert-title" style="color:var(--red)">⚠ KPIs en RIESGO — 2+ periodos consecutivos en Nota 1</div>' +
    '<div class="alert-items">' + criticos.map(function(a){return '<span class="alert-chip" style="background:#fee2e2;color:var(--red);border-color:#fecaca">' + a.k.id + '. ' + a.k.nombre + '</span>';}).join('') + '</div></div></div>';
  if (atencion.length) html += '<div class="alert-banner atencion"><div class="alert-icon" style="background:#fef9c3"><svg viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2.5" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>' +
    '<div style="flex:1"><div class="alert-title" style="color:var(--yellow)">Atención — 2+ periodos consecutivos en Nota 3</div>' +
    '<div class="alert-items">' + atencion.map(function(a){return '<span class="alert-chip" style="background:#fef9c3;color:var(--yellow);border-color:#fde68a">' + a.k.id + '. ' + a.k.nombre + '</span>';}).join('') + '</div></div></div>';
  el.innerHTML = html;
}

function renderRadar(mapa) {
  var el = document.getElementById('radarWrap');
  var notas = KPI.map(function(k){return mapa[k.id] ? mapa[k.id].nota/5 : 0;});
  var N = KPI.length, cx = 160, cy = 160, R = 120, r0 = 20;
  var ang = function(i){return (i/N)*2*Math.PI - Math.PI/2;};
  var pt = function(i, ratio){var a = ang(i), r = r0 + (R-r0)*ratio; return [cx+r*Math.cos(a), cy+r*Math.sin(a)];};

  var grids = '', axes = '', labels = '';
  [.2,.4,.6,.8,1].forEach(function(level){
    var pts = KPI.map(function(_,i){return pt(i,level).join(',');}).join(' ');
    grids += '<polygon points="' + pts + '" fill="none" stroke="#e5e7eb" stroke-width="1"/>';
  });
  KPI.forEach(function(_,i){
    var p1 = pt(i,1);
    axes += '<line x1="' + cx + '" y1="' + cy + '" x2="' + p1[0] + '" y2="' + p1[1] + '" stroke="#e5e7eb" stroke-width="1"/>';
    var lp = pt(i,1.22), k = KPI[i];
    var short = k.nombre.split(' ').slice(0,2).join(' ');
    labels += '<text x="' + lp[0] + '" y="' + lp[1] + '" text-anchor="middle" dominant-baseline="middle" font-size="9" fill="#64748b" font-weight="600">' + short + '</text>';
  });

  var filled = notas.map(function(v,i){return pt(i,Math.max(v,.04)).join(',');}).join(' ');
  var poly = '<polygon points="' + filled + '" fill="rgba(29,78,216,.18)" stroke="#1d4ed8" stroke-width="2" stroke-linejoin="round"/>';

  var dots = notas.map(function(v,i){
    var p = pt(i, Math.max(v,.04));
    var col = v >= .8 ? '#16a34a' : v >= .5 ? '#d97706' : '#dc2626';
    var nota = mapa[KPI[i].id] ? mapa[KPI[i].id].nota : '';
    return '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="5" fill="' + col + '" stroke="#fff" stroke-width="2"/>' +
      '<text x="' + p[0] + '" y="' + (p[1]-10) + '" text-anchor="middle" font-size="9" fill="' + col + '" font-weight="800">' + nota + '</text>';
  }).join('');

  var lvlLabels = [1,2,3,4,5].map(function(n,i){
    var ratio = (i+1)/5, p = pt(0,ratio);
    return '<text x="' + (p[0]+4) + '" y="' + p[1] + '" font-size="8" fill="#475569">' + n + '</text>';
  }).join('');

  el.innerHTML = '<svg viewBox="0 0 320 320" width="280" height="280">' + grids + axes + lvlLabels + poly + dots + labels + '</svg>';
}

function renderProyeccion(mapa) {
  var el = document.getElementById('proyeccionList');
  if (!registros.length) { el.innerHTML = '<div style="color:var(--text2);font-size:12px;text-align:center;padding:20px">Sin datos suficientes</div>'; return; }
  el.innerHTML = KPI.map(function(k) {
    var hist = registros.filter(function(r){return r.kpiId===k.id;}).sort(function(a,b){return a.periodo.localeCompare(b.periodo);});
    var actual = mapa[k.id];
    if (!hist.length) return '<div class="proy-row"><div class="proy-nota" style="color:#d1d5db">—</div><div class="proy-name">' + k.id + '. ' + k.nombre + '</div><div style="font-size:11px;color:var(--text2)">Sin datos</div></div>';
    var n = hist.length, proyNota;
    if (n === 1) { proyNota = hist[0].nota; }
    else {
      var xs = hist.map(function(_,i){return i;}), ys = hist.map(function(h){return h.nota;});
      var mx = xs.reduce(function(a,b){return a+b;}) / n, my = ys.reduce(function(a,b){return a+b;}) / n;
      var num2 = xs.reduce(function(s,x,i){return s+(x-mx)*(ys[i]-my);}, 0);
      var den2 = xs.reduce(function(s,x){return s+(x-mx)*(x-mx);}, 0);
      var slope = den2 ? num2/den2 : 0;
      proyNota = Math.min(5, Math.max(1, my + slope*n));
    }
    var proy = Math.round(proyNota);
    var actual_n = actual ? actual.nota : null;
    var arrow = '→', arrowColor = 'var(--text2)';
    if (actual_n && proy > actual_n) { arrow = '↑'; arrowColor = 'var(--green)'; }
    else if (actual_n && proy < actual_n) { arrow = '↓'; arrowColor = 'var(--red)'; }
    return '<div class="proy-row"><div class="proy-nota" style="color:' + nc(proy) + '">' + proy + '</div>' +
      '<div class="proy-name">' + k.id + '. ' + k.nombre + '</div>' +
      '<div class="proy-bar-wrap"><div class="proy-bar-bg"><div class="proy-bar-fill" style="width:' + (proy/5*100) + '%;background:' + nc(proy) + '"></div></div></div>' +
      '<div class="proy-arrow" style="color:' + arrowColor + ';font-size:16px;font-weight:800">' + arrow + '</div></div>';
  }).join('');
}

function renderTendencia() {
  var el = document.getElementById('tendenciaChart');
  var leg = document.getElementById('tendenciaLegend');
  var periodos = registros.map(function(r){return r.periodo;}).filter(function(v,i,a){return a.indexOf(v)===i;}).sort().slice(-10);
  if (!periodos.length) { el.innerHTML = '<div style="color:var(--text2);font-size:12px;text-align:center;padding:24px">Sin datos</div>'; return; }

  var bW = 28, gap = 6, groupGap = 14, pH = 120, padL = 24, padB = 24, padT = 10;
  var gW = bW * KPI.length + gap * (KPI.length-1);
  var totalW = padL + periodos.length * (gW + groupGap) - groupGap + 20;
  var H = pH + padB + padT;
  var colors = ['#1d4ed8','#16a34a','#d97706','#dc2626','#7c3aed','#0891b2'];

  var bars = '', xLabels = '', yLines = '';
  [1,3,5].forEach(function(n) {
    var y = padT + pH - (n/5)*pH;
    yLines += '<line x1="' + padL + '" y1="' + y + '" x2="' + totalW + '" y2="' + y + '" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="4,3"/>' +
      '<text x="' + (padL-4) + '" y="' + y + '" text-anchor="end" dominant-baseline="middle" font-size="9" fill="#475569">' + n + '</text>';
  });

  periodos.forEach(function(p, pi) {
    var gx = padL + pi * (gW + groupGap);
    KPI.forEach(function(k, ki) {
      var reg = registros.find(function(r){return r.kpiId===k.id&&r.periodo===p;});
      var nota = reg ? reg.nota : 0;
      var bH = nota ? (nota/5)*pH : 2;
      var x = gx + ki*(bW+gap), y = padT + pH - bH;
      var col = nota ? nc(nota) : '#e5e7eb';
      bars += '<rect x="' + x + '" y="' + y + '" width="' + bW + '" height="' + bH + '" rx="3" fill="' + col + '" opacity="' + (nota ? .9 : .4) + '"><title>KPI ' + k.id + ' · ' + p + ': ' + (nota || 'sin dato') + '</title></rect>';
      if (nota) bars += '<text x="' + (x+bW/2) + '" y="' + (y-3) + '" text-anchor="middle" font-size="8" fill="' + col + '" font-weight="700">' + nota + '</text>';
    });
    var lx = gx + gW/2;
    xLabels += '<text x="' + lx + '" y="' + (pH+padT+14) + '" text-anchor="middle" font-size="9" fill="#64748b">' + cicloCorto(p) + '</text>';
  });

  el.innerHTML = '<svg viewBox="0 0 ' + totalW + ' ' + H + '" width="' + Math.min(totalW,800) + '" height="' + H + '" style="min-width:' + totalW + 'px">' + yLines + bars + xLabels + '</svg>';

  leg.innerHTML = KPI.map(function(k,i) {
    return '<div class="legend-item"><div class="legend-dot" style="background:' + colors[i] + '"></div>' + k.id + '. ' + k.nombre.split(' ').slice(0,3).join(' ') + '</div>';
  }).join('');
}

function renderCalendario() {
  var el = document.getElementById('calendarioHeat');
  var periodos = registros.map(function(r){return r.periodo;}).filter(function(v,i,a){return a.indexOf(v)===i;}).sort().slice(-16);
  if (!periodos.length) { el.innerHTML = '<div style="color:var(--text2);font-size:12px;text-align:center;padding:20px">Sin datos</div>'; return; }

  var header = '<div class="cal-header">' + periodos.map(function(p) {
    return '<div class="cal-period" title="' + cicloLabel(p) + '">' + cicloCorto(p) + '</div>';
  }).join('') + '</div>';

  var rows = KPI.map(function(k) {
    var cells = periodos.map(function(p) {
      var reg = registros.find(function(r){return r.kpiId===k.id&&r.periodo===p;});
      var nota = reg ? reg.nota : 0;
      var cls = nota ? 'n' + nota : 'n0';
      return '<div class="cal-cell ' + cls + '" title="' + k.nombre + ' · ' + p + (reg ? ': ' + reg.pct.toFixed(1) + '% (Nota ' + nota + ')' : ': sin dato') + '">' + (nota || '·') + '</div>';
    }).join('');
    var short = k.nombre.split(' ').slice(0,2).join(' ');
    return '<div class="cal-row"><div class="cal-label" title="' + k.nombre + '">' + k.id + '. ' + short + '</div><div class="cal-cells">' + cells + '</div></div>';
  }).join('');

  el.innerHTML = header + '<div class="cal-grid">' + rows + '</div>' +
    '<div style="display:flex;gap:12px;margin-top:10px;flex-wrap:wrap">' +
    '<div style="font-size:10px;color:var(--text2);font-weight:600">LEYENDA:</div>' +
    [[5,'var(--green)','#bbf7d0'],[3,'var(--yellow)','#fde68a'],[1,'var(--red)','#fecaca']].map(function(item) {
      return '<div style="display:flex;align-items:center;gap:4px;font-size:10px;color:' + item[1] + ';font-weight:600">' +
        '<div style="width:16px;height:16px;border-radius:3px;background:' + item[2] + ';border:1px solid ' + item[2] + ';display:flex;align-items:center;justify-content:center;font-size:9px;color:' + item[1] + '">' + item[0] + '</div>' +
        'Nota ' + item[0] + '</div>';
    }).join('') + '</div>';
}

function abrirKpi(id) {
  poblarKpi();
  document.getElementById('regKpi').value = id;
  onKpiChange();
  openModal('modalKPI');
}
