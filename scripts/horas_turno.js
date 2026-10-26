// Horas fuera de servicio sin doble conteo: por equipo y turno (máx. 12 h),
// cada registro conserva solo los minutos que no cubre otro de mayor prioridad.
const TURNO = { A: [480, 1200], B: [1200, 1920] };

function aMinutos(hhmm, turno) {
  const [h, m] = hhmm.split(':').map(Number);
  const t = h * 60 + m;
  return turno === 'B' && t < TURNO.B[0] - 720 ? t + 1440 : t;
}

function intervalo(r) {
  if (!r.hora_inicio || !r.hora_termino || !TURNO[r.turno]) return null;
  const [min, max] = TURNO[r.turno];
  const ini = aMinutos(r.hora_inicio, r.turno);
  let fin = aMinutos(r.hora_termino, r.turno);
  if (fin <= ini) fin += 1440;
  return [Math.max(ini, min), Math.min(fin, max)];
}

function prioridad(r) {
  const t = String(r.tipo_de_perdida || '').toUpperCase();
  if (t.startsWith('PLANIFICADO')) return 2;
  return t.startsWith('INTERFERENCIA') ? 1 : 0;
}

function minutosLibres([ini, fin], cubiertos) {
  let libres = [[ini, fin]];
  for (const [ci, cf] of cubiertos) {
    libres = libres.flatMap(([a, b]) => {
      if (cf <= a || ci >= b) return [[a, b]];
      return [[a, Math.max(a, ci)], [Math.min(b, cf), b]].filter(([x, y]) => y > x);
    });
  }
  return libres;
}

function limitarSinHorario(grupo) {
  let libre = 12 - grupo.filter(intervalo).reduce((s, r) => s + r.detencion_total_horas, 0);
  for (const r of grupo.filter(r => !intervalo(r))) {
    const horas = Math.max(0, Math.min(r.detencion_total_horas, libre));
    libre -= horas;
    r.detencion_total_horas = Math.round(horas * 100) / 100;
  }
}

function ajustarGrupo(grupo) {
  const cubiertos = [];
  const orden = [...grupo].sort((a, b) => prioridad(a) - prioridad(b) || (intervalo(a)?.[0] ?? 0) - (intervalo(b)?.[0] ?? 0));
  for (const r of orden) {
    const iv = intervalo(r);
    if (!iv) continue;
    const libres = minutosLibres(iv, cubiertos);
    const horas = libres.reduce((s, [a, b]) => s + (b - a), 0) / 60;
    cubiertos.push(iv);
    const factor = r.detencion_total_horas > 0 ? horas / r.detencion_total_horas : 0;
    r.tiempo_np = r.tiempo_np == null ? null : r.tiempo_np * factor;
    r.tiempo_pl = r.tiempo_pl == null ? null : r.tiempo_pl * factor;
    r.detencion_total_horas = Math.round(horas * 100) / 100;
  }
  limitarSinHorario(grupo);
}

function sinSolapes(rows) {
  const grupos = new Map();
  for (const r of rows) {
    const k = `${r.equipo}|${r.fecha_inicio}|${r.turno}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(r);
  }
  const antes = rows.reduce((s, r) => s + r.detencion_total_horas, 0);
  grupos.forEach(ajustarGrupo);
  const despues = rows.reduce((s, r) => s + r.detencion_total_horas, 0);
  const sinHoras = rows.filter(r => r.detencion_total_horas === 0).length;
  return { rows, antes, despues, sinHoras };
}

module.exports = { sinSolapes };
