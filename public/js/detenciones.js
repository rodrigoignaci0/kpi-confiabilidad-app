// Filtros globales para análisis
var FILTROS_ANALISIS = {
  tiposEquipo: ['JR', 'JRS', 'LE', 'LH', 'OTRO'],
  tiposMantenimiento: ['PM', 'PL', 'NP']
};

function extraerTipoEquipo(equipo) {
  if (!equipo) return 'OTRO';
  var prefijo = equipo.replace(/[0-9]/g, '').toUpperCase();
  return prefijo || 'OTRO';
}

function procesarDatosDeDB() {
  // Si hay datos en DB_DATA, generar DET_SEMANAS y DET_EQUIPOS desde allí
  if (window.DB_DATA && window.DB_DATA.loaded && window.DB_DATA.detenciones.length > 0) {
    var semanasMap = {};
    var equiposMap = {};

    window.DB_DATA.detenciones.forEach(function(d) {
      var sem = d.semana || 0;
      var eq = d.equipo || 'UNKNOWN';
      var horas = parseFloat(d.detencion_total_horas) || 0;
      var tipo = d.mantenimiento || 'OTRO';
      var tipoEq = extraerTipoEquipo(eq);

      // Aplicar filtros
      if (FILTROS_ANALISIS.tiposEquipo.indexOf(tipoEq) === -1) return;
      if (FILTROS_ANALISIS.tiposMantenimiento.indexOf(tipo) === -1) return;

      // Agrupar por semana
      if (!semanasMap[sem]) {
        semanasMap[sem] = { semana: sem, rep: 0, np: 0, pl: 0, eqac: 0, parque: new Set() };
      }
      semanasMap[sem].parque.add(eq);
      if (tipo === 'NP') semanasMap[sem].np += horas;
      else if (tipo === 'PL') semanasMap[sem].pl += horas;
      else if (tipo === 'PM') semanasMap[sem].rep += horas;

      // Agrupar por equipo
      if (!equiposMap[sem]) equiposMap[sem] = {};
      if (!equiposMap[sem][eq]) {
        equiposMap[sem][eq] = { eq: eq, disp: 100, horas: 0 };
      }
      equiposMap[sem][eq].horas += horas;
    });

    // Convertir a formato esperado
    DET_SEMANAS = Object.keys(semanasMap).map(function(k) {
      var s = semanasMap[k];
      return {
        id: 'S' + s.semana,
        semana: s.semana,
        label: 'Sem ' + s.semana,
        rep: s.rep,
        np: s.np,
        pl: s.pl,
        eqac: s.eqac,
        parque: s.parque.size,
        total: s.rep + s.np + s.pl + s.eqac
      };
    }).sort(function(a, b) { return a.semana - b.semana; });

    DET_EQUIPOS = equiposMap;

    // Generar DET_NP (análisis por subsistema)
    var sistemasMap = {};
    window.DB_DATA.detenciones.forEach(function(d) {
      if (d.mantenimiento !== 'NP') return; // Solo NP para este análisis

      var tipoEq = extraerTipoEquipo(d.equipo);
      if (FILTROS_ANALISIS.tiposEquipo.indexOf(tipoEq) === -1) return;

      var sistema = (d.subsistemas || d.sistemas || 'Sin clasificar').trim();
      if (!sistema) sistema = 'Sin clasificar';

      var horas = parseFloat(d.detencion_total_horas) || 0;

      if (!sistemasMap[sistema]) {
        sistemasMap[sistema] = {
          s: sistema,
          indisp: 0,
          f: 0,
          hrs: 0,
          comps: new Set(),
          badge: 'be'
        };
      }

      sistemasMap[sistema].f += 1;
      sistemasMap[sistema].hrs += horas;
      if (d.componente && d.componente.trim()) {
        sistemasMap[sistema].comps.add(d.componente.trim());
      }
    });

    DET_NP = Object.keys(sistemasMap).map(function(k) {
      var s = sistemasMap[k];
      s.comps = Array.from(s.comps).slice(0, 5); // Máximo 5 componentes
      s.indisp = (s.hrs / 168 * 100).toFixed(1); // Calcular % sobre 168 horas de la semana
      return s;
    }).sort(function(a, b) { return b.hrs - a.hrs; });
  }
}

function aplicarFiltrosAnalisis() {
  // Obtener tipos de equipo seleccionados
  var tiposEq = [];
  if (document.getElementById('filterEquipo_JR').checked) tiposEq.push('JR');
  if (document.getElementById('filterEquipo_JRS').checked) tiposEq.push('JRS');
  if (document.getElementById('filterEquipo_LE').checked) tiposEq.push('LE');
  if (document.getElementById('filterEquipo_LH').checked) tiposEq.push('LH');
  if (document.getElementById('filterEquipo_OTRO').checked) tiposEq.push('OTRO');

  // Obtener tipos de mantenimiento seleccionados
  var tiposMant = [];
  if (document.getElementById('filterMant_PM').checked) tiposMant.push('PM');
  if (document.getElementById('filterMant_PL').checked) tiposMant.push('PL');
  if (document.getElementById('filterMant_NP').checked) tiposMant.push('NP');

  FILTROS_ANALISIS.tiposEquipo = tiposEq.length > 0 ? tiposEq : ['JR', 'JRS', 'LE', 'LH', 'OTRO'];
  FILTROS_ANALISIS.tiposMantenimiento = tiposMant.length > 0 ? tiposMant : ['PM', 'PL', 'NP'];

  renderDetenciones();
}

function limpiarFiltrosAnalisis() {
  // Resetear filtros a valores por defecto
  document.getElementById('filterEquipo_JR').checked = true;
  document.getElementById('filterEquipo_JRS').checked = true;
  document.getElementById('filterEquipo_LE').checked = true;
  document.getElementById('filterEquipo_LH').checked = true;
  document.getElementById('filterEquipo_OTRO').checked = true;

  document.getElementById('filterMant_PM').checked = true;
  document.getElementById('filterMant_PL').checked = true;
  document.getElementById('filterMant_NP').checked = true;

  FILTROS_ANALISIS.tiposEquipo = ['JR', 'JRS', 'LE', 'LH', 'OTRO'];
  FILTROS_ANALISIS.tiposMantenimiento = ['PM', 'PL', 'NP'];

  renderDetenciones();
}

function renderDetKPI(sid) {
  var s = DET_SEMANAS.find(function(x){return x.id===sid;});
  if (!s) return;

  var eq = DET_EQUIPOS[sid] || {};

  // Calcular indisponibilidad solo con PL + NP (según filtros)
  var indisp = +(s.pl + s.np).toFixed(1);
  var disp = +(100 - indisp).toFixed(1);

  // Horas totales de detención (PL + NP)
  var horasDetenciones = +(s.pl + s.np).toFixed(1);

  var low = Object.keys(eq).filter(function(k) {
    return eq[k].disp < 60;
  }).length;

  var nc2 = function(v){return v>=80?'var(--green)':v>=60?'var(--yellow)':'var(--red)';};

  document.getElementById('detKpiRow').innerHTML =
    '<div class="kpi-card"><div class="kpi-label">Disponibilidad</div><div class="kpi-val" style="color:' + nc2(disp) + '">' + disp.toFixed(1) + '%</div><div class="kpi-sub">Semana ' + s.semana + '</div></div>' +
    '<div class="kpi-card"><div class="kpi-label">Indisponibilidad</div><div class="kpi-val" style="color:var(--red)">' + indisp.toFixed(1) + '%</div><div class="kpi-sub">PL + NP</div></div>' +
    '<div class="kpi-card"><div class="kpi-label">Horas Detención</div><div class="kpi-val" style="color:#0ea5e9">' + horasDetenciones.toFixed(1) + '</div><div class="kpi-sub">Horas totales (PL+NP)</div></div>' +
    '<div class="kpi-card"><div class="kpi-label">Parque Activo</div><div class="kpi-val" style="color:#8b5cf6">' + s.parque + '</div><div class="kpi-sub">Equipos activos</div></div>';
}

function renderDetC1() {
  var W=620,H=240,pL=48,pR=58,pT=18,pB=50;
  var iW=W-pL-pR,iH=H-pT-pB,n=DET_SEMANAS.length;
  var bW=iW/n*0.5,gap=iW/n;
  var maxL=90,maxR=10;
  var yL=function(v){return pT+iH*(1-v/maxL);};
  var yR=function(v){return pT+iH*(1-v/maxR);};
  var xMid=function(i){return pL+gap*i+gap*0.5;};
  var bars='',gridL='',axL='',axR='',lines='',pts='';
  [0,20,40,60,80].forEach(function(v){var y=yL(v);gridL+='<line x1="'+pL+'" y1="'+y+'" x2="'+(W-pR)+'" y2="'+y+'" stroke="#e5e7eb" stroke-width="1"/>';axL+='<text x="'+(pL-6)+'" y="'+(y+4)+'" text-anchor="end" font-size="9" fill="#475569">'+v+'</text>';});
  [0,2,4,6,8,10].forEach(function(v){axR+='<text x="'+(W-pR+6)+'" y="'+(yR(v)+4)+'" text-anchor="start" font-size="9" fill="#475569">'+v+'</text>';});
  var indisps=[],parques=[];
  DET_SEMANAS.forEach(function(s,i){
    var x=pL+gap*i+gap*0.25,total=s.rep+s.np+s.pl+s.eqac;
    indisps.push({x:xMid(i),y:yL(total),v:total});
    parques.push({x:xMid(i),y:yR(s.parque),v:s.parque});
    var cur=0;
    [{v:s.rep,c:'#06b6d4'},{v:s.np,c:'#0f766e'},{v:s.pl,c:'#f59e0b'},{v:s.eqac,c:'#dc2626'}].forEach(function(seg){
      if(!seg.v)return;var y1=yL(cur+seg.v),y2=yL(cur);
      bars+='<rect x="'+x+'" y="'+y1+'" width="'+bW+'" height="'+(y2-y1)+'" fill="'+seg.c+'"/>';cur+=seg.v;
    });
    bars+='<text x="'+xMid(i)+'" y="'+(H-pB+14)+'" text-anchor="middle" font-size="10" fill="#64748b">'+s.label+'</text>';
  });
  lines+='<polyline points="'+indisps.map(function(p){return p.x+','+p.y;}).join(' ')+'" fill="none" stroke="#0f766e" stroke-width="2"/>';
  lines+='<polyline points="'+parques.map(function(p){return p.x+','+p.y;}).join(' ')+'" fill="none" stroke="#dc2626" stroke-width="2" stroke-dasharray="5,3"/>';
  indisps.forEach(function(p){pts+='<circle cx="'+p.x+'" cy="'+p.y+'" r="3.5" fill="#0f766e"/><text x="'+p.x+'" y="'+(p.y-6)+'" text-anchor="middle" font-size="9" fill="#0f766e" font-weight="700">'+p.v.toFixed(1)+'</text>';});
  parques.forEach(function(p){pts+='<circle cx="'+p.x+'" cy="'+p.y+'" r="3.5" fill="#dc2626"/><text x="'+p.x+'" y="'+(p.y-6)+'" text-anchor="middle" font-size="9" fill="#dc2626" font-weight="700">'+p.v+'</text>';});
  document.getElementById('detC1').innerHTML='<svg viewBox="0 0 '+W+' '+H+'" width="100%" style="display:block">'+gridL+bars+lines+pts+axL+axR+'<line x1="'+pL+'" y1="'+pT+'" x2="'+pL+'" y2="'+(pT+iH)+'" stroke="#e5e7eb"/><line x1="'+pL+'" y1="'+(pT+iH)+'" x2="'+(W-pR)+'" y2="'+(pT+iH)+'" stroke="#e5e7eb"/><line x1="'+(W-pR)+'" y1="'+pT+'" x2="'+(W-pR)+'" y2="'+(pT+iH)+'" stroke="#e5e7eb"/><text transform="translate(10,'+(pT+iH/2)+') rotate(-90)" text-anchor="middle" font-size="9" fill="#64748b">% InDisp</text><text transform="translate('+(W-8)+','+(pT+iH/2)+') rotate(90)" text-anchor="middle" font-size="9" fill="#64748b">N° Jumbos</text></svg>';
}

function renderDetC2(sid) {
  var losses=DET_WATERFALL[sid];
  var bW=42,gap=14,pT=22,pB=44,pH=200,innerH=pH-pT-pB;
  var items=[{cat:'Base',val:100,t:'base'}].concat(losses);
  var totalLoss=losses.reduce(function(a,b){return a+b.val;},0);
  var finalDisp=+(100-totalLoss).toFixed(1);
  items.push({cat:'Disponib.',val:finalDisp,t:'disp'});
  var W=items.length*(bW+gap)+gap+20;
  var y0=function(v){return pT+innerH*(1-v/100);};
  var scY=function(v){return innerH*v/100;};
  var bars='',labels='',connectors='',cats='';var cur=100;
  items.forEach(function(it,i){
    var x=gap+i*(bW+gap);var barY,barH,col;
    if(it.t==='base'){barY=y0(100);barH=scY(100);col='#f97316';labels+='<text x="'+(x+bW/2)+'" y="'+(barY-4)+'" text-anchor="middle" font-size="9" fill="#f97316" font-weight="700">100%</text>';}
    else if(it.t==='disp'){barY=y0(finalDisp);barH=scY(finalDisp);col=finalDisp>=60?'#16a34a':'#dc2626';labels+='<text x="'+(x+bW/2)+'" y="'+(barY+barH/2+4)+'" text-anchor="middle" font-size="9" fill="#fff" font-weight="700">'+finalDisp+'%</text>';}
    else{barY=y0(cur);barH=scY(it.val);col=DET_TCOL[it.t]||'#94a3b8';labels+='<text x="'+(x+bW/2)+'" y="'+(barY-4)+'" text-anchor="middle" font-size="9" fill="'+col+'" font-weight="700">-'+it.val.toFixed(1)+'</text>';if(i<items.length-1)connectors+='<line x1="'+(x+bW)+'" y1="'+(barY+barH)+'" x2="'+(x+bW+gap)+'" y2="'+(barY+barH)+'" stroke="#94a3b8" stroke-width="1" stroke-dasharray="4,3"/>';cur-=it.val;}
    bars+='<rect x="'+x+'" y="'+barY+'" width="'+bW+'" height="'+barH+'" fill="'+col+'" rx="3"/>';
    cats+='<text x="'+(x+bW/2)+'" y="'+(pH-pB+14)+'" text-anchor="middle" font-size="9" fill="#64748b">'+it.cat+'</text>';
  });
  document.getElementById('detC2').innerHTML='<svg viewBox="0 0 '+W+' '+pH+'" width="'+Math.max(W,300)+'" height="'+pH+'" style="display:block"><line x1="0" y1="'+y0(0)+'" x2="'+W+'" y2="'+y0(0)+'" stroke="#e5e7eb"/>'+connectors+bars+labels+cats+'</svg>';
}

function renderDetC3(sid) {
  var eq=DET_EQUIPOS[sid];
  var W=380,H=280,pL=50,pR=20,pT=16,pB=40,iW=W-pL-pR,iH=H-pT-pB;
  var maxF=Math.max.apply(null,eq.map(function(e){return e.f;}))+1,maxM=Math.max.apply(null,eq.map(function(e){return e.mttr;}))+10;
  var medF=detMedian(eq.map(function(e){return e.f;})),medM=detMedian(eq.map(function(e){return e.mttr;}));
  var xS=function(f){return pL+iW*f/maxF;},yS=function(m){return pT+iH*m/maxM;};
  var grid='',dots='',lbls='';
  for(var vf=0;vf<=maxF;vf+=2){var xv=xS(vf);grid+='<line x1="'+xv+'" y1="'+pT+'" x2="'+xv+'" y2="'+(pT+iH)+'" stroke="#f1f5f9"/><text x="'+xv+'" y="'+(pT+iH+14)+'" text-anchor="middle" font-size="9" fill="#475569">'+vf+'</text>';}
  for(var vm=0;vm<=maxM;vm+=20){var yv=yS(vm);grid+='<line x1="'+pL+'" y1="'+yv+'" x2="'+(pL+iW)+'" y2="'+yv+'" stroke="#f1f5f9"/><text x="'+(pL-5)+'" y="'+(yv+4)+'" text-anchor="end" font-size="9" fill="#475569">'+vm+'</text>';}
  var mfX=xS(medF),mmY=yS(medM);
  grid+='<line x1="'+mfX+'" y1="'+pT+'" x2="'+mfX+'" y2="'+(pT+iH)+'" stroke="#94a3b8" stroke-width="1" stroke-dasharray="6,4"/>';
  grid+='<line x1="'+pL+'" y1="'+mmY+'" x2="'+(pL+iW)+'" y2="'+mmY+'" stroke="#94a3b8" stroke-width="1" stroke-dasharray="6,4"/>';
  grid+='<text x="'+(pL+4)+'" y="'+(pT+12)+'" font-size="8" fill="#d1d5db" font-weight="600">AGUDO</text>';
  grid+='<text x="'+(mfX+4)+'" y="'+(pT+12)+'" font-size="8" fill="#d1d5db" font-weight="600">AGUDO/CRÓNICO</text>';
  grid+='<text x="'+(pL+4)+'" y="'+(pT+iH-4)+'" font-size="8" fill="#d1d5db" font-weight="600">NORMAL/LEVE</text>';
  grid+='<text x="'+(mfX+4)+'" y="'+(pT+iH-4)+'" font-size="8" fill="#d1d5db" font-weight="600">CRÓNICO</text>';
  eq.forEach(function(e){var cx=xS(e.f),cy=yS(e.mttr),col=e.disp<60?'#dc2626':'#0ea5e9';dots+='<circle cx="'+cx+'" cy="'+cy+'" r="7" fill="'+col+'" fill-opacity=".85"/>';lbls+='<text x="'+cx+'" y="'+(cy-10)+'" text-anchor="middle" font-size="8" fill="#475569" font-weight="600">'+e.id+'</text>';});
  document.getElementById('detSubC3').textContent='Mediana fallas: '+medF+' | Mediana MTTR: '+medM+' hrs';
  document.getElementById('detC3').innerHTML='<svg viewBox="0 0 '+W+' '+H+'" width="100%" style="display:block">'+grid+dots+lbls+'<line x1="'+pL+'" y1="'+pT+'" x2="'+pL+'" y2="'+(pT+iH)+'" stroke="#e5e7eb"/><line x1="'+pL+'" y1="'+(pT+iH)+'" x2="'+(pL+iW)+'" y2="'+(pT+iH)+'" stroke="#e5e7eb"/><text transform="translate(12,'+(pT+iH/2)+') rotate(-90)" text-anchor="middle" font-size="9" fill="#64748b">MTTR (hrs)</text><text x="'+(pL+iW/2)+'" y="'+(H-2)+'" text-anchor="middle" font-size="9" fill="#64748b">N° Fallas</text></svg>';
}

function renderDetC4(sid) {
  var eq=DET_EQUIPOS[sid].slice().sort(function(a,b){return b.disp-a.disp;});
  var W=560,H=210,pL=36,pR=60,pT=20,pB=36,iW=W-pL-pR,iH=H-pT-pB,n=eq.length;
  var bW=iW/n*0.6,gap=iW/n;
  var yV=function(v){return pT+iH*(1-v/100);},scH=function(v){return iH*v/100;},xMid=function(i){return pL+gap*i+gap*0.5;};
  var bars='',grid='',pLine='',pts='',labs='',cats='';
  [0,20,40,60,80,100].forEach(function(v){var y=yV(v);grid+='<line x1="'+pL+'" y1="'+y+'" x2="'+(W-pR)+'" y2="'+y+'" stroke="#e5e7eb"/><text x="'+(pL-4)+'" y="'+(y+4)+'" text-anchor="end" font-size="9" fill="#475569">'+v+'</text>';});
  var meta60=yV(60);
  grid+='<line x1="'+pL+'" y1="'+meta60+'" x2="'+(W-pR)+'" y2="'+meta60+'" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="6,4"/>';
  grid+='<text x="'+(W-pR+4)+'" y="'+(meta60+4)+'" font-size="9" fill="#f59e0b" font-weight="700">Meta 60%</text>';
  var ppts=[];
  eq.forEach(function(e,i){
    var x=xMid(i)-bW/2,col=e.disp>=80?'#16a34a':e.disp>=60?'#f59e0b':'#dc2626';
    bars+='<rect x="'+x+'" y="'+yV(e.disp)+'" width="'+bW+'" height="'+scH(e.disp)+'" fill="'+col+'" rx="2"/>';
    labs+='<text x="'+xMid(i)+'" y="'+(yV(e.disp)-4)+'" text-anchor="middle" font-size="9" fill="'+col+'" font-weight="700">'+e.disp+'%</text>';
    cats+='<text x="'+xMid(i)+'" y="'+(H-pB+13)+'" text-anchor="middle" font-size="9" fill="#64748b">'+e.id+'</text>';
    ppts.push(xMid(i)+','+yV(e.disp));
    pts+='<circle cx="'+xMid(i)+'" cy="'+yV(e.disp)+'" r="3" fill="#f97316"/>';
  });
  pLine='<polyline points="'+ppts.join(' ')+'" fill="none" stroke="#f97316" stroke-width="2"/>';
  document.getElementById('detSubC4').textContent='Ordenado DESC por disponibilidad — '+sid;
  document.getElementById('detC4').innerHTML='<svg viewBox="0 0 '+W+' '+H+'" width="100%" style="display:block">'+grid+bars+labs+pLine+pts+cats+'<line x1="'+pL+'" y1="'+pT+'" x2="'+pL+'" y2="'+(pT+iH)+'" stroke="#e5e7eb"/><line x1="'+pL+'" y1="'+(pT+iH)+'" x2="'+(W-pR)+'" y2="'+(pT+iH)+'" stroke="#e5e7eb"/></svg>';
}

function renderDetC5() {
  var totI=DET_NP.reduce(function(a,b){return a+b.indisp;},0).toFixed(1);
  var totF=DET_NP.reduce(function(a,b){return a+b.f;},0);
  var totH=DET_NP.reduce(function(a,b){return a+b.hrs;},0);
  var badgeStyle={be:'background:#dbeafe;color:#1e40af',bp:'background:#dcfce7;color:#166534',bh:'background:#fef9c3;color:#713f12',ba:'background:#fce7f3;color:#9d174d'};
  document.getElementById('detC5').innerHTML='<table style="width:100%;border-collapse:collapse;font-size:12px">' +
    '<thead><tr style="background:#f8fafc">' + ['Sistema','% InDisp NP','Fallas','Hrs Det.','Componentes'].map(function(h){return '<th style="padding:8px 10px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text2);border-bottom:2px solid var(--border)">'+h+'</th>';}).join('') + '</tr></thead>' +
    '<tbody>' + DET_NP.map(function(r){return '<tr><td style="padding:9px 10px;border-bottom:1px solid var(--border)"><span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;'+badgeStyle[r.badge]+'">'+r.s+'</span></td><td style="padding:9px 10px;border-bottom:1px solid var(--border);font-weight:700;color:var(--red)">'+r.indisp+'%</td><td style="padding:9px 10px;border-bottom:1px solid var(--border)">'+r.f+'</td><td style="padding:9px 10px;border-bottom:1px solid var(--border)">'+r.hrs+' hrs</td><td style="padding:9px 10px;border-bottom:1px solid var(--border)"><div style="display:flex;flex-wrap:wrap;gap:4px">'+r.comps.map(function(c){return '<span style="background:#f1f5f9;border:1px solid #e2e8f0;color:#475569;font-size:10px;padding:2px 7px;border-radius:8px">'+c+'</span>';}).join('')+'</div></td></tr>';}).join('') + '</tbody>' +
    '<tfoot><tr style="background:#f8fafc;font-weight:700"><td style="padding:9px 10px">TOTAL NP</td><td style="padding:9px 10px;color:var(--red)">'+totI+'%</td><td style="padding:9px 10px">'+totF+'</td><td style="padding:9px 10px">'+totH+' hrs</td><td></td></tr></tfoot></table>';
}

function renderDetenciones() {
  procesarDatosDeDB(); // Procesar datos del .db si existen
  var sid = document.getElementById('detSemana').value || 'S40'; // Valor por defecto si no existe
  renderDetKPI(sid); renderDetC1(); renderDetC2(sid); renderDetC3(sid); renderDetC4(sid); renderDetC5();
}
