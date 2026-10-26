/**
 * sync_turnos.js — Lee archivos de Entrega de Turno (pestaña BD_Diario_CMC)
 * y sube las detenciones nuevas a Supabase.
 *
 * Uso: node sync_turnos.js [--dry] [--from=19 --to=25] [--src=carpeta]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { sinSolapes } = require('./horas_turno');
const XLSX = require('xlsx');
const { Pool } = require('pg');

// Carpeta con los informes de turno (ej. OneDrive/.../2026/10.Octubre); o usar --src
const BASE = process.env.TURNOS_DIR || '';
const DRY = process.argv.includes('--dry');
// Carpeta única de origen (ej. control/Corregidos/S43), en vez de OneDrive/TURNO*
const SRC_ARG = process.argv.find(a => a.startsWith('--src='));
const SRC = SRC_ARG ? path.resolve(SRC_ARG.split('=')[1]) : null;
const SHEET = 'BD_Diario_CMC';

// Rango de días: node sync_turnos.js --from=19 --to=25
const FROM_DAY = parseInt((process.argv.find(a => a.startsWith('--from=')) || '--from=19').split('=')[1]);
const TO_DAY   = parseInt((process.argv.find(a => a.startsWith('--to='))   || '--to=25').split('=')[1]);

function excelDate(serial) {
  if (!serial || typeof serial !== 'number') return serial || null;
  return new Date((serial - 25569) * 86400000).toISOString().slice(0, 10);
}
function excelTime(v) {
  if (!v || typeof v !== 'number') return null;
  const total = Math.round(v * 24 * 60) % (24 * 60);
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}
function toReal(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
}

// Recorrer todos los turnos y extraer filas válidas
function readAllTurnos() {
  if (!SRC && !BASE) throw new Error('Indica --src=<carpeta> o la variable TURNOS_DIR');
  const dirs = SRC ? [SRC] : fs.readdirSync(BASE).filter(d => d.startsWith('TURNO')).map(t => path.join(BASE, t));
  const allRows = [];
  const seen = new Set();

  for (const dir of dirs) {
    const files = fs.readdirSync(dir).filter(f => /\.(xlsm|xlsx)$/.test(f) && !f.startsWith('~'));
    for (const file of files) {
      const m = file.match(/(\d{1,2})-10-202[6]/);
      if (!m) continue;
      const day = parseInt(m[1]);
      if (day < FROM_DAY || day > TO_DAY) continue;

      const fp = path.join(dir, file);
      try {
        const wb = XLSX.readFile(fp);
        const sheet = wb.Sheets[SHEET];
        if (!sheet) { console.log(`  SKIP (sin ${SHEET}): ${file}`); continue; }

        const rows = XLSX.utils.sheet_to_json(sheet);
        let count = 0;
        for (const r of rows) {
          const eq = String(r['Equipo'] || '').trim();
          if (!eq) continue;
          const h = toReal(r['Detención Total (horas)']);
          if (!h || h <= 0) continue;

          const fecha = excelDate(r['Fecha Inicio']);
          if (!fecha || !fecha.startsWith('2026-10-')) continue;
          const fDay = parseInt(fecha.split('-')[2]);
          if (fDay < FROM_DAY || fDay > TO_DAY) continue;

          // Dedup: mismo equipo+fecha+turno+hora+tipo
          const key = `${eq}|${fecha}|${r['Turno']}|${h}|${r['TIPO DE PERDIDA']}|${r['SISTEMAS']}|${r['COMPONENTE']}`;
          if (seen.has(key)) continue;
          seen.add(key);

          allRows.push({
            equipo: eq === 'JRS 002' ? 'JRS002' : eq,
            fecha_inicio: fecha,
            semana: parseInt(r['Semana']) || null,
            mes: r['Mes'] || null,
            turno: r['Turno'] || null,
            mantenimiento: r['Mantenimiento'] || null,
            detencion_total_horas: h,
            tiempo_np: toReal(r['Tiempo NP']),
            tiempo_pl: toReal(r['Tiempo PL']),
            sistemas: r['SISTEMAS'] || null,
            subsistemas: r['SUBSISTEMAS'] || null,
            componente: r['COMPONENTE'] ? String(r['COMPONENTE']) : null,
            tipo_de_perdida: r['TIPO DE PERDIDA'] || null,
            evento: (r['Evento '] || r['Evento'] || '').toString().substring(0, 500) || null,
            responsable: r['RESPONSABLE'] || null,
            parque: r['PARQUE'] || null,
            hora_inicio: excelTime(r['Inicio']) || null,
            hora_termino: excelTime(r['Fin']) || null,
            detencion_continua_dia: r['Detencion Continua (SI/NO) \r\nDIA'] || null,
            detencion_continua_mes: r['Detencion Continua (SI/NO) \r\nMES'] || null,
            tipo_ot: r['Tipo OT'] || null,
            dm: r['DM'] || null
          });
          count++;
        }
        if (count) console.log(`  ${file}: ${count} filas`);
      } catch (e) {
        console.log(`  ERROR ${file}: ${e.message}`);
      }
    }
  }
  return allRows;
}

async function upload(rows) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    const fromDate = `2026-10-${String(FROM_DAY).padStart(2,'0')}`;
    const toDate   = `2026-10-${String(TO_DAY).padStart(2,'0')}`;
    const del = await client.query(
      `DELETE FROM detenciones WHERE fecha_inicio >= '${fromDate}' AND fecha_inicio <= '${toDate}'`
    );
    console.log(`Borrados ${del.rowCount} registros previos del ${FROM_DAY}-${TO_DAY} oct`);

    const BATCH = 200;
    let inserted = 0;
    for (let off = 0; off < rows.length; off += BATCH) {
      const batch = rows.slice(off, off + BATCH);
      const vals = [];
      const COLS = 22;
      const phs = batch.map((r, i) => {
        const b = i * COLS;
        vals.push(
          r.equipo, r.fecha_inicio, r.semana, r.mes, r.turno, r.mantenimiento,
          r.detencion_total_horas, r.tiempo_np, r.tiempo_pl,
          r.sistemas, r.subsistemas, r.componente,
          r.tipo_de_perdida, r.evento, r.responsable, r.parque,
          r.hora_inicio, r.hora_termino,
          r.detencion_continua_dia, r.detencion_continua_mes,
          r.tipo_ot, r.dm
        );
        return '(' + Array.from({ length: COLS }, (_, j) => '$' + (b + j + 1)).join(',') + ')';
      });
      await client.query(
        'INSERT INTO detenciones (equipo,fecha_inicio,semana,mes,turno,mantenimiento,detencion_total_horas,tiempo_np,tiempo_pl,sistemas,subsistemas,componente,tipo_de_perdida,evento,responsable,parque,hora_inicio,hora_termino,detencion_continua_dia,detencion_continua_mes,tipo_ot,dm) VALUES ' + phs.join(','),
        vals
      );
      inserted += batch.length;
    }
    console.log(`Insertados: ${inserted} registros`);

    const total = await client.query(`SELECT COUNT(*) as n FROM detenciones WHERE fecha_inicio >= '${fromDate}' AND fecha_inicio <= '${toDate}'`);
    console.log(`Total oct ${FROM_DAY}-${TO_DAY} en Supabase: ${total.rows[0].n}`);
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  console.log('Leyendo turnos de', SRC || BASE);
  const leidas = readAllTurnos();
  const { rows, antes, despues, sinHoras } = sinSolapes(leidas);
  console.log(`\nFilas leídas: ${leidas.length}. Sin solapes: ${rows.length} (${sinHoras} con 0 h por estar dentro de otro registro)`);
  console.log(`Horas: ${antes.toFixed(1)} → ${despues.toFixed(1)}`);

  const byEq = {};
  rows.forEach(r => { byEq[r.equipo] = (byEq[r.equipo] || 0) + 1; });
  console.log('Por equipo:', byEq);

  const byFecha = {};
  rows.forEach(r => { byFecha[r.fecha_inicio] = (byFecha[r.fecha_inicio] || 0) + 1; });
  console.log('Por fecha:', byFecha);

  if (DRY) { console.log('\n--dry: no se subió nada'); return; }
  await upload(rows);
}

module.exports={readAllTurnos};
if(require.main===module) main().catch(e => { console.error(e); process.exit(1); });
