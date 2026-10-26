let charts = {};

function renderDetencionesDinamico() {
  renderDashboardDinamico('detencionesDinamicoContent');
}

function renderDashboardDinamico(containerId = 'dashDinamicoContent') {
  if (!window.DB_DATA || !window.DB_DATA.loaded) {
    const el = document.getElementById(containerId);
    if (el) {
      el.innerHTML = `
        <div class="card" style="text-align:center;padding:40px;color:var(--text2)">
          <p>⚠️ Primero debes cargar la base de datos en la pestaña <strong>Cargar BD</strong></p>
        </div>
      `;
    }
    return;
  }

  const html = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:16px">
      <input type="number" id="ddYear" min="2020" max="2030" value="2026" placeholder="Año" style="padding:8px;border:1px solid var(--border);border-radius:6px"/>
      <input type="number" id="ddWeek" min="0" max="53" value="0" placeholder="Semana" style="padding:8px;border:1px solid var(--border);border-radius:6px"/>
      <select id="ddEquipo" style="padding:8px;border:1px solid var(--border);border-radius:6px"><option value="">Equipo</option></select>
      <select id="ddTurno" style="padding:8px;border:1px solid var(--border);border-radius:6px">
        <option value="">Turno</option>
        <option value="A">A</option>
        <option value="B">B</option>
      </select>
      <select id="ddMantenimiento" style="padding:8px;border:1px solid var(--border);border-radius:6px">
        <option value="">Tipo</option>
        <option value="PM">PM</option>
        <option value="NP">NP</option>
        <option value="PL">PL</option>
      </select>
      <button class="btn btn-secondary" onclick="resetFiltroDinamico()" style="padding:8px">Limpiar</button>
      <button class="btn btn-primary" onclick="actualizarDashboardDinamico()" style="padding:8px">Aplicar</button>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px">
      <div class="card" style="padding:16px">
        <div style="font-size:11px;color:var(--text2);font-weight:600;margin-bottom:6px">DISPONIBILIDAD</div>
        <div style="font-size:24px;font-weight:700" id="ddKpi1">—</div>
        <div style="font-size:11px;color:var(--text2)">%</div>
      </div>
      <div class="card" style="padding:16px">
        <div style="font-size:11px;color:var(--text2);font-weight:600;margin-bottom:6px">HORAS NP</div>
        <div style="font-size:24px;font-weight:700" id="ddKpi2">—</div>
        <div style="font-size:11px;color:var(--text2)">horas</div>
      </div>
      <div class="card" style="padding:16px">
        <div style="font-size:11px;color:var(--text2);font-weight:600;margin-bottom:6px">EQUIPO CRÍTICO</div>
        <div style="font-size:24px;font-weight:700" id="ddKpi3">—</div>
        <div style="font-size:11px;color:var(--text2)" id="ddKpi3Sub"></div>
      </div>
      <div class="card" style="padding:16px">
        <div style="font-size:11px;color:var(--text2);font-weight:600;margin-bottom:6px">REGISTROS</div>
        <div style="font-size:24px;font-weight:700" id="ddKpi4">—</div>
        <div style="font-size:11px;color:var(--text2)">detenciones</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-bottom:16px">
      <div class="card" style="padding:16px">
        <div style="font-size:13px;font-weight:600;margin-bottom:12px">Horas por Equipo</div>
        <canvas id="chartDD1" style="max-height:250px"></canvas>
      </div>
      <div class="card" style="padding:16px">
        <div style="font-size:13px;font-weight:600;margin-bottom:12px">Por Tipo Detención</div>
        <canvas id="chartDD2" style="max-height:250px"></canvas>
      </div>
      <div class="card" style="padding:16px">
        <div style="font-size:13px;font-weight:600;margin-bottom:12px">Por Turno</div>
        <canvas id="chartDD3" style="max-height:250px"></canvas>
      </div>
    </div>

    <div class="card" style="padding:16px">
      <div style="font-size:13px;font-weight:600;margin-bottom:12px">Últimas Detenciones</div>
      <table style="width:100%;font-size:12px;border-collapse:collapse">
        <thead>
          <tr style="background:var(--bg)">
            <th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);font-weight:600">Equipo</th>
            <th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);font-weight:600">Fecha</th>
            <th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);font-weight:600">Turno</th>
            <th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);font-weight:600">Tipo</th>
            <th style="padding:8px;text-align:right;border-bottom:1px solid var(--border);font-weight:600">Horas</th>
          </tr>
        </thead>
        <tbody id="tableDD"></tbody>
      </table>
    </div>
  `;

  document.getElementById(containerId).innerHTML = html;

  const selectEquipo = document.getElementById('ddEquipo');
  if (window.DB_DATA.equipos) {
    window.DB_DATA.equipos.forEach(eq => {
      const opt = document.createElement('option');
      opt.value = eq;
      opt.textContent = eq;
      selectEquipo.appendChild(opt);
    });
  }

  actualizarDashboardDinamico();
}

function filtrarDatosDD() {
  const year = parseInt(document.getElementById('ddYear').value) || 0;
  const week = parseInt(document.getElementById('ddWeek').value) || 0;
  const equipo = document.getElementById('ddEquipo').value;
  const turno = document.getElementById('ddTurno').value;
  const mantenimiento = document.getElementById('ddMantenimiento').value;

  console.log('Filtros:', { year, week, equipo, turno, mantenimiento });

  return window.DB_DATA.detenciones.filter(row => {
    // Filtro por año usando fecha_inicio
    if (year) {
      const fecha = new Date(row.fecha_inicio);
      if (fecha.getFullYear() !== year) return false;
    }

    // Filtro por semana (si existe el campo semana)
    if (week && row.semana !== week) return false;

    // Filtro por equipo
    if (equipo && row.equipo !== equipo) return false;

    // Filtro por turno
    if (turno && row.turno !== turno) return false;

    // Filtro por mantenimiento
    if (mantenimiento && row.mantenimiento !== mantenimiento) return false;

    return true;
  });
}

function actualizarDashboardDinamico() {
  console.log('actualizarDashboardDinamico - DB_DATA.loaded:', window.DB_DATA?.loaded);
  console.log('DB_DATA:', window.DB_DATA);

  if (!window.DB_DATA || !window.DB_DATA.loaded) {
    alert('⚠️ Base de datos no cargada. Ve a "Cargar BD" primero.');
    return;
  }

  const datos = filtrarDatosDD();
  console.log('Datos filtrados:', datos.length);
  const totalHoras = 24 * 7;
  const numEquipos = new Set(datos.map(d => d.equipo)).size || 1;

  const horasDetenciones = datos.reduce((s, d) => s + (parseFloat(d.detencion_total_horas) || 0), 0);
  const disp = Math.max(0, ((totalHoras * 8 - horasDetenciones) / (totalHoras * 8)) * 100);

  const horasNP = datos.filter(d => d.mantenimiento === 'NP').reduce((s, d) => s + (parseFloat(d.detencion_total_horas) || 0), 0);

  const horasPorEquipo = {};
  datos.forEach(d => {
    horasPorEquipo[d.equipo] = (horasPorEquipo[d.equipo] || 0) + (parseFloat(d.detencion_total_horas) || 0);
  });
  const equipoCritico = Object.keys(horasPorEquipo).length > 0 ? Object.entries(horasPorEquipo).reduce((a, b) => a[1] > b[1] ? a : b)[0] : 'N/A';
  const horasEquipoCritico = horasPorEquipo[equipoCritico] || 0;

  document.getElementById('ddKpi1').textContent = disp.toFixed(1);
  document.getElementById('ddKpi2').textContent = horasNP.toFixed(1);
  document.getElementById('ddKpi3').textContent = equipoCritico;
  document.getElementById('ddKpi3Sub').textContent = horasEquipoCritico.toFixed(1) + 'h';
  document.getElementById('ddKpi4').textContent = datos.length;

  actualizarGraficosDD(datos, horasPorEquipo);
  actualizarTablaDD(datos);
}

function actualizarGraficosDD(datos, horasPorEquipo) {
  const top10 = Object.entries(horasPorEquipo).sort((a, b) => b[1] - a[1]).slice(0, 10);

  crearGraficoDD('chartDD1', 'bar', {
    labels: top10.map(e => e[0]),
    datasets: [{
      label: 'Horas',
      data: top10.map(e => e[1]),
      backgroundColor: '#ef4444',
      borderRadius: 4
    }]
  });

  const horasPorTipo = {};
  datos.forEach(d => {
    const t = d.mantenimiento || 'Otro';
    horasPorTipo[t] = (horasPorTipo[t] || 0) + (parseFloat(d.detencion_total_horas) || 0);
  });

  crearGraficoDD('chartDD2', 'doughnut', {
    labels: Object.keys(horasPorTipo),
    datasets: [{
      data: Object.values(horasPorTipo),
      backgroundColor: ['#3b82f6', '#ef4444', '#10b981']
    }]
  });

  const horasPorTurno = {};
  datos.forEach(d => {
    const t = d.turno === 'A' ? 'Turno A' : d.turno === 'B' ? 'Turno B' : 'Otro';
    horasPorTurno[t] = (horasPorTurno[t] || 0) + (parseFloat(d.detencion_total_horas) || 0);
  });

  crearGraficoDD('chartDD3', 'bar', {
    labels: Object.keys(horasPorTurno),
    datasets: [{
      label: 'Horas',
      data: Object.values(horasPorTurno),
      backgroundColor: ['#8b5cf6', '#06b6d4']
    }]
  });
}

function crearGraficoDD(id, tipo, config) {
  const ctx = document.getElementById(id);
  if (!ctx) return;
  if (charts[id]) charts[id].destroy();
  try {
    charts[id] = new Chart(ctx, {
      type: tipo,
      data: config,
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: { position: 'bottom' } },
        scales: tipo === 'bar' ? { y: { beginAtZero: true }, x: { ticks: { maxRotation: 45 } } } : undefined
      }
    });
  } catch (e) {
    console.error('Error creando gráfico', e);
  }
}

function actualizarTablaDD(datos) {
  const tbody = document.getElementById('tableDD');
  const ordenados = [...datos].sort((a, b) => new Date(b.fecha_inicio || 0) - new Date(a.fecha_inicio || 0)).slice(0, 30);

  if (ordenados.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text2)">Sin datos</td></tr>';
    return;
  }

  tbody.innerHTML = ordenados.map(d => {
    const fecha = d.fecha_inicio ? new Date(d.fecha_inicio).toLocaleDateString() : '—';
    return `
      <tr style="border-bottom:1px solid var(--border)">
        <td style="padding:8px"><strong>${d.equipo || '—'}</strong></td>
        <td style="padding:8px">${fecha}</td>
        <td style="padding:8px">${d.turno || '—'}</td>
        <td style="padding:8px">${d.mantenimiento || '—'}</td>
        <td style="padding:8px;text-align:right">${(parseFloat(d.detencion_total_horas) || 0).toFixed(1)}</td>
      </tr>
    `;
  }).join('');
}

function resetFiltroDinamico() {
  document.getElementById('ddYear').value = 2026;
  document.getElementById('ddWeek').value = 0;
  document.getElementById('ddEquipo').value = '';
  document.getElementById('ddTurno').value = '';
  document.getElementById('ddMantenimiento').value = '';
  actualizarDashboardDinamico();
}
