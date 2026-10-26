// ID del ciclo: "2026-07" = ciclo que empieza el 16-Jul y termina el 15-Ago
function cicloId(year, month) {
  return year + '-' + String(month).padStart(2, '0');
}

function cicloLabel(id) {
  var parts = id.split('-').map(Number);
  var y = parts[0], m = parts[1];
  var m2 = m === 12 ? 1 : m + 1;
  var y2 = m === 12 ? y + 1 : y;
  return '16 ' + MESES[m-1] + ' – 15 ' + MESES[m2-1] + ' ' + y;
}

function cicloCorto(id) {
  var parts = id.split('-').map(Number);
  var m = parts[1];
  var m2 = m === 12 ? 1 : m + 1;
  return MESES[m-1] + '16–' + MESES[m2-1] + '15';
}

// Genera últimos N ciclos hasta hoy + 2 futuros
function generarCiclos(n) {
  if (n === undefined) n = 18;
  var now = new Date();
  var y = now.getFullYear(), m = now.getMonth() + 1;
  if (now.getDate() < 16) { m--; if (m === 0) { m = 12; y--; } }
  var ciclos = [];
  for (var i = n; i >= -2; i--) {
    var mm = m - i, yy = y;
    while (mm < 1) { mm += 12; yy--; }
    while (mm > 12) { mm -= 12; yy++; }
    ciclos.push(cicloId(yy, mm));
  }
  return ciclos;
}

function cicloActual() {
  var now = new Date();
  var y = now.getFullYear(), m = now.getMonth() + 1;
  if (now.getDate() < 16) { m--; if (m === 0) { m = 12; y--; } }
  return cicloId(y, m);
}

function nc(n) { return n === 5 ? 'var(--green)' : n === 3 ? 'var(--yellow)' : n === 1 ? 'var(--red)' : '#d1d5db'; }
function nClass(n) { return n === 5 ? 'n5' : n === 3 ? 'n3' : n === 1 ? 'n1' : 'n0'; }
function sc(n) { return n === 5 ? 'verde' : n === 3 ? 'amarillo' : n === 1 ? 'rojo' : 'gris'; }

function lastByKpi() {
  var m = {};
  var sorted = registros.slice().sort(function(a, b) { return a.creadoEn.localeCompare(b.creadoEn); });
  sorted.forEach(function(r) { m[r.kpiId] = r; });
  return m;
}

function scoreTotal(mapa) {
  var sP = 0, sS = 0, cnt = 0;
  KPI.forEach(function(k) {
    var r = mapa[k.id];
    if (r) { sS += r.nota * k.pond; sP += k.pond; cnt++; }
  });
  return cnt === 0 ? null : {val: (sP > 0 ? sS / sP : 0).toFixed(2), cnt: cnt, sumP: sP};
}
