function openModal(id) {
  document.getElementById(id).classList.add('show');
  if (id === 'modalKPI') poblarKpi();
}

function closeModal(id) {
  document.getElementById(id).classList.remove('show');
}

document.querySelectorAll('.overlay').forEach(function(el) {
  el.addEventListener('click', function(e) { if (e.target === el) closeModal(el.id); });
});

function poblarKpi() {
  document.getElementById('regKpi').innerHTML = '<option value="">Seleccionar...</option>' +
    KPI.map(function(k){return '<option value="' + k.id + '">' + k.id + '. ' + k.nombre + ' (' + k.freq + ')</option>';}).join('');
  poblarCiclos();
}

function poblarCiclos(selectedId) {
  var ciclos = generarCiclos(18);
  var cur = selectedId || cicloActual();
  document.getElementById('regPeriodo').innerHTML =
    ciclos.map(function(c){return '<option value="' + c + '"' + (c===cur?' selected':'') + '>' + cicloLabel(c) + '</option>';}).join('');
}

function onKpiChange() {
  var k = KPI.find(function(x){return x.id===parseInt(document.getElementById('regKpi').value);});
  if (!k) return;
  document.getElementById('lblNum').textContent = k.numL + ' *';
  document.getElementById('lblDen').textContent = k.denL + ' *';
  document.getElementById('periodoHint').textContent = 'Ciclo contractual: 16 del mes → 15 del mes siguiente · ' + k.freq;
  calcNota();
}

function calcNota() {
  var k = KPI.find(function(x){return x.id===parseInt(document.getElementById('regKpi').value);});
  var num = parseFloat(document.getElementById('regNum').value);
  var den = parseFloat(document.getElementById('regDen').value);
  var box = document.getElementById('calcBox');
  if (!k || isNaN(num) || isNaN(den) || den === 0) { box.style.display = 'none'; return; }
  var pct = num/den*100, nota = k.nota(pct);
  box.style.display = 'block';
  var pe = document.getElementById('calcPct'); pe.textContent = pct.toFixed(1)+'%'; pe.style.color = nc(nota);
  var ne = document.getElementById('calcNota'); ne.textContent = nota; ne.style.color = nc(nota);
  var bw = Math.min(pct/(k.invertido?k.meta*2:k.meta)*100, 100);
  document.getElementById('calcBar').style.cssText = 'width:'+bw+'%;background:'+nc(nota)+';height:8px;border-radius:4px;transition:width .3s';
  document.getElementById('calcMeta').textContent = 'Meta: '+(k.invertido?'≤':'≥')+k.meta+'%  ·  '+k.rangos;
}

function guardar() {
  var kpiId = parseInt(document.getElementById('regKpi').value);
  var periodo = document.getElementById('regPeriodo').value.trim();
  var num = parseFloat(document.getElementById('regNum').value);
  var den = parseFloat(document.getElementById('regDen').value);
  if (!kpiId || !periodo) { alert('Selecciona KPI e ingresa el periodo.'); return; }
  if (isNaN(num) || isNaN(den) || den === 0) { alert('Ingresa numerador y denominador válidos.'); return; }
  var k = KPI.find(function(x){return x.id===kpiId;});
  var pct = num/den*100, nota = k.nota(pct);
  var id = document.getElementById('regId').value || uid();
  var reg = {id:id,kpiId:kpiId,periodo:periodo,num:num,den:den,pct:pct,nota:nota,obs:document.getElementById('regObs').value.trim(),creadoEn:new Date().toISOString()};
  var idx = registros.findIndex(function(r){return r.id===id;});
  if (idx >= 0) registros[idx] = reg; else registros.push(reg);
  save(); closeModal('modalKPI'); limpiarForm(); renderDashboard();
}

function limpiarForm() {
  ['regId','regPeriodo','regNum','regDen','regObs'].forEach(function(id){document.getElementById(id).value='';});
  document.getElementById('regKpi').value = '';
  document.getElementById('calcBox').style.display = 'none';
}

function editarReg(id) {
  var r = registros.find(function(x){return x.id===id;});
  if (!r) return;
  poblarKpi();
  document.getElementById('regId').value = r.id;
  document.getElementById('regKpi').value = r.kpiId; onKpiChange();
  poblarCiclos(r.periodo);
  document.getElementById('regNum').value = r.num;
  document.getElementById('regDen').value = r.den;
  document.getElementById('regObs').value = r.obs || '';
  calcNota(); openModal('modalKPI');
}

function eliminarReg(id) {
  if (!confirm('¿Eliminar este registro?')) return;
  registros = registros.filter(function(r){return r.id!==id;});
  save(); renderDashboard(); renderHistorial();
}
