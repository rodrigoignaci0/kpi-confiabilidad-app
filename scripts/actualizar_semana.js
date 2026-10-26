/**
 * actualizar_semana.js — Reemplaza una semana 2026 en Supabase con lo que diga la Tabla Maestra
 *
 * Uso: node actualizar_semana.js <excel> <semana> [--dry]
 */
require('dotenv').config();
const XLSX = require('xlsx');
const { Pool } = require('pg');

const [excelPath, semArg] = process.argv.slice(2);
const SEMANA = parseInt(semArg);
const DRY = process.argv.includes('--dry');
const COLS = 'equipo,fecha_inicio,semana,mes,turno,mantenimiento,detencion_total_horas,tiempo_np,tiempo_pl,sistemas,subsistemas,componente,tipo_de_perdida,evento,responsable,parque,hora_inicio,hora_termino,detencion_continua_dia,detencion_continua_mes,tipo_ot,dm'.split(',');

const toReal = v => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.')); return isNaN(n) ? null : n; };
const toISO = n => typeof n === 'number' ? new Date((n - 25569) * 864e5).toISOString().slice(0, 10) : (n || null);
const toHora = v => {
  if (typeof v === 'string') {
    const m = v.match(/^(\d{1,2}):(\d{2})/);
    return m ? m[1].padStart(2, '0') + ':' + m[2] : null;
  }
  if (typeof v !== 'number') return null;
  const m = Math.round(v * 1440);
  return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
};
const esParque = eq => /^(JR|PICARROCA|RB ?3)/.test(String(eq || ''));

function toRow(r) {
  return [
    r['Equipo'] || null, toISO(r['Fecha Inicio']), parseInt(r['Semana']) || null, r['Mes'] || null,
    r['Turno'] || null, r['Mantenimiento'] || null, toReal(r['Detención Total (horas)']),
    toReal(r['Tiempo NP']), toReal(r['Tiempo PL']), r['SISTEMAS'] || null, r['SUBSISTEMAS'] || null,
    r['COMPONENTE'] || null, r['TIPO DE PERDIDA'] || null,
    String(r['Evento '] || r['Evento'] || '').substring(0, 500) || null,
    r['RESPONSABLE'] || null, r['PARQUE'] || null, toHora(r['Inicio']), toHora(r['Fin']),
    r['Detencion Continua (SI/NO) \r\nDIA'] || null, r['Detencion Continua (SI/NO) \r\nMES'] || null,
    r['Tipo OT'] || null, r['DM'] || null
  ];
}

function leerSemana() {
  const wb = XLSX.readFile(excelPath);
  const hoja = wb.SheetNames.find(s => s.toLowerCase().includes('deten'));
  return XLSX.utils.sheet_to_json(wb.Sheets[hoja])
    .filter(r => parseInt(r['Semana']) === SEMANA && esParque(r['Equipo']) && String(toISO(r['Fecha Inicio'])).startsWith('2026'));
}

async function main() {
  const filas = leerSemana().map(toRow);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    const { rows } = await client.query("SELECT COUNT(*) n FROM detenciones WHERE semana=$1 AND fecha_inicio LIKE '2026%'", [SEMANA]);
    console.log(`S${SEMANA}: Excel=${filas.length} filas, Supabase=${rows[0].n} filas`);
    if (DRY) return;
    await client.query('BEGIN');
    await client.query("DELETE FROM detenciones WHERE semana=$1 AND fecha_inicio LIKE '2026%'", [SEMANA]);
    for (const f of filas) {
      await client.query(`INSERT INTO detenciones (${COLS.join(',')}) VALUES (${COLS.map((_, i) => '$' + (i + 1)).join(',')})`, f);
    }
    await client.query('COMMIT');
    console.log('Reemplazadas:', filas.length);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
