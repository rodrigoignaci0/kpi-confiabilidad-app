var GEMINI_KEY = 'AQ.Ab8RN6JZqBMHFoTIBxlBVEIcsLKqqJmvM4Yt0VJws5_xBHBguQ';
var GEMINI_MODEL = 'gemini-3.5-flash-lite';
var GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + GEMINI_KEY;

// ── LLAMADA BASE A GEMINI ──────────────────────────────────────────────────
function geminiPost(prompt, onSuccess, onError) {
  return fetch(GEMINI_URL, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      contents: [{parts: [{text: prompt}]}],
      generationConfig: {temperature: 0.4, maxOutputTokens: 1024, responseMimeType: 'application/json'}
    })
  }).then(function(r){return r.json();}).then(function(data){
    if (data.error) throw new Error(data.error.message);
    var txt = data.candidates[0].content.parts[0].text;
    // limpia markdown y busca el bloque JSON aunque venga con texto alrededor
    txt = txt.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
    var match = txt.match(/\{[\s\S]*\}/);
    if (match) txt = match[0];
    onSuccess(txt);
  }).catch(function(e){ if(onError) onError(e.message); });
}

// ── CONSTRUYE CONTEXTO COMPLETO ────────────────────────────────────────────
function buildContexto() {
  var kpiRecs = DB.get('kpi_registros');

  // KPIs: últimos 4 periodos por indicador
  var kpiData = KPI.map(function(k) {
    var recs = kpiRecs.filter(function(r){return r.kpiId===k.id;})
      .sort(function(a,b){return b.periodo.localeCompare(a.periodo);}).slice(0,4);
    var tendencia = '';
    if (recs.length >= 2) {
      tendencia = recs[0].nota > recs[1].nota ? '↑mejorando' : recs[0].nota < recs[1].nota ? '↓empeorando' : '→estable';
    }
    return {
      id: k.id, nombre: k.nombre, meta: k.meta + '%', pond: k.pond + '%', freq: k.freq,
      invertido: k.invertido || false,
      registros: recs.map(function(r){return {periodo: r.periodo, pct: r.pct.toFixed(1), nota: r.nota};}),
      tendencia: tendencia
    };
  });

  // Detenciones: resumen por semana y por equipo
  var detData = DET_SEMANAS.map(function(s) {
    var eq = DET_EQUIPOS[s.id];
    var indisp = +(s.eqac + s.pl + s.np + s.rep).toFixed(1);
    var criticos = eq.filter(function(e){return e.disp < 60;}).map(function(e){return {id: e.id, disp: e.disp, mttr: e.mttr, fallas: e.f};});
    var mediaDisp = +(eq.reduce(function(a,e){return a+e.disp;},0)/eq.length).toFixed(1);
    return {
      semana: s.label, indisp: indisp, parque: s.parque,
      desglose: {eqac: s.eqac, pl: s.pl, np: s.np, faltaRep: s.rep},
      mediaDisp: mediaDisp, criticos: criticos
    };
  });

  // Inconsistencias básicas detectables en JS antes de llamar a IA
  var inconsistencias = [];
  kpiRecs.forEach(function(r) {
    if (r.num > r.den && !KPI.find(function(k){return k.id===r.kpiId&&k.invertido;})) {
      inconsistencias.push('KPI '+r.kpiId+' periodo '+r.periodo+': numerador ('+r.num+') > denominador ('+r.den+')');
    }
    if (r.pct < 0 || r.pct > 200) {
      inconsistencias.push('KPI '+r.kpiId+' periodo '+r.periodo+': % fuera de rango ('+r.pct.toFixed(1)+'%)');
    }
  });

  return {kpi: kpiData, detenciones: detData, inconsistenciasJS: inconsistencias};
}

// ── ANÁLISIS AUTOMÁTICO — DEVUELVE JSON ESTRUCTURADO ──────────────────────
function analizarAuto(zona, callback) {
  var ctx = buildContexto();
  var zonaLabel = zona === 'dashboard' ? 'KPIs contractuales' : 'detenciones de equipos';

  var prompt =
    'Eres un analista experto en confiabilidad de equipos de minería subterránea para un contrato Codelco.' +
    ' Analiza los datos y responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional, sin markdown.\n\n' +
    'DATOS KPIs:\n' + JSON.stringify(ctx.kpi) + '\n\n' +
    'DATOS DETENCIONES JUMBOS (JR001-JR010):\n' + JSON.stringify(ctx.detenciones) + '\n\n' +
    (ctx.inconsistenciasJS.length ? 'INCONSISTENCIAS DETECTADAS:\n' + ctx.inconsistenciasJS.join('\n') + '\n\n' : '') +
    'ZONA A ANALIZAR: ' + zonaLabel + '\n\n' +
    'Responde con este JSON exacto:\n' +
    '{\n' +
    '  "estado": "ok|atencion|critico",\n' +
    '  "resumen": "1 oración máximo del estado general",\n' +
    '  "alertas": [\n' +
    '    {"nivel": "critico|atencion|info", "titulo": "texto corto", "detalle": "explicación concisa", "zona": "dashboard|kpi_1|kpi_2|kpi_3|kpi_4|kpi_5|kpi_6|detenciones|equipo_JR001"}\n' +
    '  ],\n' +
    '  "inconsistencias": [\n' +
    '    {"dato": "qué dato", "problema": "qué está mal", "sugerencia": "cómo corregir"}\n' +
    '  ],\n' +
    '  "insight_dashboard": "observación clave para el dashboard en 1-2 oraciones",\n' +
    '  "insight_detenciones": "observación clave para detenciones en 1-2 oraciones",\n' +
    '  "recomendacion": "acción prioritaria concreta"\n' +
    '}';

  var el = document.getElementById('ia-status-' + zona);
  if (el) el.innerHTML = iaSpinner('Analizando datos...');

  geminiPost(prompt, function(txt) {
    try {
      var result = JSON.parse(txt);
      DB.set('ia_ultimo_' + zona, {fecha: new Date().toLocaleString('es-CL'), data: result});
      if (callback) callback(result);
      renderInsights(zona, result);
    } catch(e) {
      if (el) el.innerHTML = iaError('No se pudo interpretar la respuesta IA');
    }
  }, function(err) {
    if (el) el.innerHTML = iaError(err);
  });
}

// ── RENDERIZA INSIGHTS INLINE ──────────────────────────────────────────────
function renderInsights(zona, data) {
  // 1. Status bar superior de la zona
  var statusEl = document.getElementById('ia-status-' + zona);
  if (statusEl) statusEl.innerHTML = iaStatusBar(data);

  // 2. Alertas individuales
  var alertasEl = document.getElementById('ia-alertas-' + zona);
  if (alertasEl) alertasEl.innerHTML = iaAlertasList(data.alertas);

  // 3. Inconsistencias
  var inconEl = document.getElementById('ia-inconsistencias-' + zona);
  if (inconEl) {
    if (data.inconsistencias && data.inconsistencias.length) {
      inconEl.innerHTML = iaInconsistencias(data.inconsistencias);
      inconEl.style.display = 'block';
    } else {
      inconEl.style.display = 'none';
    }
  }

  // 4. Recomendación
  var recEl = document.getElementById('ia-recomendacion-' + zona);
  if (recEl) recEl.innerHTML = iaRecomendacion(data.recomendacion);

  // 5. Footer con timestamp
  var footEl = document.getElementById('ia-footer-' + zona);
  if (footEl) {
    var ultimo = DB.get('ia_ultimo_' + zona, null);
    if (ultimo) footEl.textContent = 'Último análisis: ' + ultimo.fecha;
  }
}

// ── RENDER HELPERS ─────────────────────────────────────────────────────────
function iaSpinner(msg) {
  return '<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--surface2);border-radius:8px;border:1px solid var(--border)">' +
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>' +
    '<span style="font-size:12px;color:#6b7280">' + msg + '</span></div>';
}

function iaError(msg) {
  return '<div style="padding:10px 14px;background:#fef2f2;border-radius:8px;border:1px solid #fecaca;font-size:12px;color:#dc2626">⚠ ' + msg + '</div>';
}

function iaStatusBar(data) {
  var colors = {ok:'#16a34a', atencion:'#d97706', critico:'#dc2626'};
  var bg = {ok:'#dcfce7', atencion:'#fef9c3', critico:'#fee2e2'};
  var icons = {ok:'✓', atencion:'⚠', critico:'✕'};
  var col = colors[data.estado] || '#64748b';
  var bgc = bg[data.estado] || '#f1f5f9';
  var icon = icons[data.estado] || '·';
  return '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:' + bgc + ';border-radius:8px;border:1px solid ' + col + '20">' +
    '<div style="display:flex;align-items:center;gap:8px">' +
    '<span style="width:20px;height:20px;border-radius:50%;background:' + col + ';color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">' + icon + '</span>' +
    '<span style="font-size:13px;font-weight:600;color:' + col + '">' + data.resumen + '</span></div>' +
    '<span id="ia-footer-dashboard" style="font-size:10px;color:#94a3b8"></span></div>';
}

function iaAlertasList(alertas) {
  if (!alertas || !alertas.length) return '';
  var cols = {critico:'#dc2626', atencion:'#d97706', info:'#0ea5e9'};
  var bgs = {critico:'#fef2f2', atencion:'#fffbeb', info:'#f0f9ff'};
  var bds = {critico:'#fecaca', atencion:'#fde68a', info:'#bae6fd'};
  return '<div style="display:flex;flex-direction:column;gap:6px;margin-top:10px">' +
    alertas.map(function(a) {
      var col = cols[a.nivel] || '#64748b';
      var bgc = bgs[a.nivel] || 'var(--surface2)';
      var bdc = bds[a.nivel] || '#e2e8f0';
      return '<div style="padding:9px 12px;background:' + bgc + ';border-left:3px solid ' + col + ';border-radius:0 6px 6px 0;border:1px solid ' + bdc + ';border-left:3px solid ' + col + '">' +
        '<div style="font-size:12px;font-weight:700;color:' + col + ';margin-bottom:2px">' + a.titulo + '</div>' +
        '<div style="font-size:11px;color:#6b7280;line-height:1.4">' + a.detalle + '</div>' +
        (a.zona ? '<div style="font-size:10px;color:#94a3b8;margin-top:3px">📍 ' + a.zona + '</div>' : '') +
        '</div>';
    }).join('') + '</div>';
}

function iaInconsistencias(lista) {
  return '<div style="padding:12px;background:#fff7ed;border:1px solid #fde68a;border-radius:8px;margin-top:10px">' +
    '<div style="font-size:11px;font-weight:700;color:#d97706;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">⚠ Inconsistencias detectadas en los datos</div>' +
    lista.map(function(i) {
      return '<div style="margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid #fed7aa">' +
        '<div style="font-size:12px;font-weight:600;color:#d97706">' + i.dato + ': ' + i.problema + '</div>' +
        '<div style="font-size:11px;color:#6b7280;margin-top:2px">→ ' + i.sugerencia + '</div></div>';
    }).join('') + '</div>';
}

function iaRecomendacion(texto) {
  if (!texto) return '';
  return '<div style="padding:10px 14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;margin-top:10px;display:flex;gap:8px;align-items:flex-start">' +
    '<span style="font-size:16px;flex-shrink:0">💡</span>' +
    '<div><div style="font-size:11px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Acción prioritaria</div>' +
    '<div style="font-size:12px;color:#6b7280;line-height:1.5">' + texto + '</div></div></div>';
}

// ── RENDER DEL PANEL IA COMPLETO (zona) ────────────────────────────────────
function renderPanelIA(zona) {
  zona = zona || 'dashboard';
  var panelEl = document.getElementById('panelIA-' + zona);
  if (!panelEl) return;

  var ultimo = DB.get('ia_ultimo_' + zona, null);

  panelEl.innerHTML =
    // Status bar (se llena al analizar)
    '<div id="ia-status-' + zona + '">' +
    (ultimo ? iaStatusBar(ultimo.data) : '<div style="padding:10px 14px;background:var(--surface2);border-radius:8px;border:1px solid var(--border);font-size:12px;color:#6b7280">IA lista · Presiona Analizar para revisar los datos</div>') +
    '</div>' +

    // Alertas
    '<div id="ia-alertas-' + zona + '">' + (ultimo ? iaAlertasList(ultimo.data.alertas) : '') + '</div>' +

    // Inconsistencias
    '<div id="ia-inconsistencias-' + zona + '" style="display:' + (ultimo && ultimo.data.inconsistencias && ultimo.data.inconsistencias.length ? 'block' : 'none') + '">' +
    (ultimo && ultimo.data.inconsistencias ? iaInconsistencias(ultimo.data.inconsistencias) : '') +
    '</div>' +

    // Recomendación
    '<div id="ia-recomendacion-' + zona + '">' + (ultimo ? iaRecomendacion(ultimo.data.recomendacion) : '') + '</div>' +

    // Botón analizar + footer
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px">' +
    '<button class="btn btn-primary btn-sm" onclick="analizarAuto(\'' + zona + '\')" style="font-size:12px">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="13" height="13"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>' +
    'Analizar ahora</button>' +
    '<span id="ia-footer-' + zona + '" style="font-size:10px;color:#94a3b8">' + (ultimo ? 'Último análisis: ' + ultimo.fecha : '') + '</span>' +
    '</div>';
}

// Spin animation CSS (inyectado una sola vez)
(function() {
  if (document.getElementById('ia-spin-style')) return;
  var s = document.createElement('style');
  s.id = 'ia-spin-style';
  s.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
  document.head.appendChild(s);
})();
