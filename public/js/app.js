function showTab(t) {
  document.querySelectorAll('.tab-content').forEach(function(e){e.classList.remove('active');});
  document.querySelectorAll('[data-tab],[data-bnav]').forEach(function(e){e.classList.remove('active');});
  document.getElementById('tab-'+t).classList.add('active');
  document.querySelectorAll('[data-tab="'+t+'"],[data-bnav="'+t+'"]').forEach(function(e){e.classList.add('active');});
  if (t === 'dashboard') { renderDashboard(); renderPanelIA('dashboard'); }
  if (t === 'resumen') renderResumen();
  if (t === 'historial') renderHistorial();
  if (t === 'detenciones') { renderDetencionesDinamico(); renderDetenciones(); renderPanelIA('detenciones'); }
  if (t === 'config') renderConfig();
}

function toggleSidebar() {
  var sb = document.getElementById('sidebar');
  var pg = document.querySelector('.page');
  var btn = document.getElementById('sbToggle');
  sb.classList.toggle('collapsed');
  pg.classList.toggle('collapsed');
  btn.classList.toggle('collapsed');
}

(function seedDemo() {
  if (DB.get('kpi_demo_seeded2', false)) return;
  var ciclosSem = ['2026-04','2026-05','2026-06','2026-07'];
  var ciclosMen = ['2026-02','2026-03','2026-04','2026-05','2026-06','2026-07'];
  var rng = function(min,max){return +(min+(Math.random()*(max-min))).toFixed(1);};
  var addDays = function(n){return new Date(Date.now()-n*864e5).toISOString();};
  ciclosMen.forEach(function(p,pi) {
    [2,4,5,6].forEach(function(kpiId) {
      var k = KPI.find(function(x){return x.id===kpiId;});
      var num, den;
      if (kpiId === 4) { den = rng(40,60); num = rng(den*.07,den*.20); }
      else { den = 100; num = rng(72,99); }
      var pct = num/den*100, nota = k.nota(pct);
      registros.push({id:uid(),kpiId:kpiId,periodo:p,num:num,den:den,pct:pct,nota:nota,obs:'',creadoEn:addDays((ciclosMen.length-pi)*32+Math.random()*5)});
    });
  });
  ciclosSem.forEach(function(p,pi) {
    [1,3].forEach(function(kpiId) {
      var k = KPI.find(function(x){return x.id===kpiId;});
      var den = 100, num = rng(75,100);
      var pct = num/den*100, nota = k.nota(pct);
      registros.push({id:uid(),kpiId:kpiId,periodo:p,num:num,den:den,pct:pct,nota:nota,obs:'',creadoEn:addDays((ciclosSem.length-pi)*30+Math.random()*5)});
    });
  });
  save();
  DB.set('kpi_demo_seeded2', true);
})();

// Inicializar footer contrato
(function() {
  var cfg = CFG.get();
  var sfp = document.getElementById('sfPeriodo');
  if (sfp) sfp.textContent = cfg.contrato || 'Nuevo Contrato';
})();

AUTH.init();
