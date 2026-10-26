/**
 * seed-listas.js
 * Lee listas de validación del Excel de turno e inserta en tabla listas_validacion (Supabase/PG).
 *
 * Uso: node seed-listas.js
 */
require('dotenv').config();
const { Pool } = require('pg');
const XLSX = require('xlsx');

const EXCEL_PATH = process.env.EXCEL_TURNO_PATH;

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ── Equipos hardcoded (fuente: Parametros) ──────────────────────────────
function buildEquipos() {
  const jrs = [];
  for (let i = 1; i <= 10; i++) jrs.push(`JR${String(i).padStart(3, '0')}`);
  const jrss = ['JRS001', 'JRS002'];
  const rbs = ['RB3-11', 'RB3-12', 'RB3-13'];
  const pics = ['PICARROCA N1', 'PICARROCA N2'];
  const les = buildLeList();
  const lhs = ['LH001', 'LH002', 'LH003'];
  const otros = ['MT001', 'MT002', 'MN001', 'CL001'];
  return [...jrs, ...jrss, ...rbs, ...pics, ...les, ...lhs, ...otros];
}

function buildLeList() {
  const les = [];
  for (let i = 1; i <= 40; i++) les.push(`LE${String(i).padStart(3, '0')}`);
  return les;
}

// ── Listas estáticas ────────────────────────────────────────────────────
const UBICACIONES = ['Terreno', 'Taller BIN', 'Taller Superficie', 'Modulo E', 'Zona Lavado Ejes'];

const TIPOS_OT = [
  'Falla Mecanica', 'Falla Operacional', 'Falla Electrica', 'Mantención Preventiva',
  'Backlog', 'Falta de Repuesto', 'Reparacion Mayor', 'Interferencia Codelco',
  'Trabajos Kaltire', 'Trabajos Sercoing', 'Inspeccion', 'HE Parts',
];

const TIPO_PERDIDA_NP = [
  'NP MECANICA', 'NP ELECTRICA', 'FALTA DE REPUESTO',
  'INTERFERENCIA OPERACIONAL', 'INTERFERENCIA MANTENIMIENTO', 'EQAC', 'EN ESPERA LOGISTICA',
];

const TIPO_PERDIDA_PL = ['PLANIFICADO'];

const SISTEMAS = [
  'MOTOR DIESEL', 'TREN DE POTENCIA', 'HIDRAULICO', 'DIRECCION', 'FRENOS',
  'SUSPENSION', 'CHASIS ESTRUCTURA', 'LUBRICACION', 'AIRE ACONDICIONADO',
  'SUPRESION DE INCENDIO', 'NEUMATICOS', 'MANTENCION PROGRAMADA',
  'SISTEMA ELECTRICO', 'PERFORACION',
];

// ── Lectura dinámica de subsistemas desde SISTEMAS sheet ────────────────
function readSubsistemas(wb) {
  const ws = wb.Sheets['SISTEMAS'];
  if (!ws) return [];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  return parseSubsistemasFromSheet(data);
}

function parseSubsistemasFromSheet(data) {
  const subs = [];
  const sistemaKeys = data.map(r => String(r[0] || '')).filter(v => v && v !== 'SISTEMAS');
  // Col 2 has subsystems grouped by sistema header rows
  let currentSistema = null;
  for (const row of data) {
    const colC = String(row[2] || '').trim();
    if (!colC) continue;
    if (sistemaKeys.includes(colC)) { currentSistema = colC; continue; }
    if (currentSistema && colC !== 'SISTEMAS') {
      subs.push({ valor: colC, padre: normalizeSistema(currentSistema) });
    }
  }
  return subs;
}

function normalizeSistema(key) {
  return key.replace(/_/g, ' ');
}

// ── Lectura dinámica de componentes desde Lista de componentes ──────────
function readComponentes(wb) {
  const ws = wb.Sheets['Lista de componentes'];
  if (!ws) return [];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  return parseComponentes(data);
}

function parseComponentes(data) {
  if (!data.length) return [];
  const headers = data[0].map(h => String(h).trim());
  const comps = [];
  for (let col = 0; col < headers.length; col++) {
    const padre = headers[col];
    if (!padre) continue;
    for (let row = 1; row < data.length; row++) {
      const val = String(data[row][col] || '').trim();
      if (val) comps.push({ valor: val, padre });
    }
  }
  return comps;
}

// ── Helpers de inserción ────────────────────────────────────────────────
function toRows(tipo, valores, padre = null) {
  return valores.map((v, i) => ({ tipo, valor: v, padre, orden: i + 1 }));
}

async function insertBatch(client, rows) {
  if (!rows.length) return 0;
  const values = [];
  const params = [];
  for (let i = 0; i < rows.length; i++) {
    const off = i * 4;
    values.push(`($${off + 1}, $${off + 2}, $${off + 3}, $${off + 4})`);
    params.push(rows[i].tipo, rows[i].valor, rows[i].padre, rows[i].orden);
  }
  const sql = `INSERT INTO listas_validacion (tipo, valor, padre, orden) VALUES ${values.join(',')}`;
  await client.query(sql, params);
  return rows.length;
}

async function insertInChunks(client, rows, chunkSize = 200) {
  let total = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    total += await insertBatch(client, rows.slice(i, i + chunkSize));
  }
  return total;
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  const wb = XLSX.readFile(EXCEL_PATH);
  console.log(`Excel cargado: ${wb.SheetNames.length} hojas`);

  const subsistemas = readSubsistemas(wb);
  const componentes = readComponentes(wb);

  const allRows = buildAllRows(subsistemas, componentes);
  const summary = summarize(allRows);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM listas_validacion');
    const inserted = await insertInChunks(client, allRows);
    await client.query('COMMIT');
    printSummary(summary, inserted);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

function buildAllRows(subsistemas, componentes) {
  return [
    ...toRows('equipo', buildEquipos()),
    ...toRows('ubicacion', UBICACIONES),
    ...toRows('tipo_ot', TIPOS_OT),
    ...toRows('tipo_perdida_np', TIPO_PERDIDA_NP),
    ...toRows('tipo_perdida_pl', TIPO_PERDIDA_PL),
    ...toRows('sistema', SISTEMAS),
    ...subsistemas.map((s, i) => ({ tipo: 'subsistema', valor: s.valor, padre: s.padre, orden: i + 1 })),
    ...componentes.map((c, i) => ({ tipo: 'componente', valor: c.valor, padre: c.padre, orden: i + 1 })),
  ];
}

function summarize(rows) {
  const map = {};
  for (const r of rows) map[r.tipo] = (map[r.tipo] || 0) + 1;
  return map;
}

function printSummary(summary, total) {
  console.log(`\n✓ Insertados ${total} registros en listas_validacion:`);
  for (const [tipo, count] of Object.entries(summary)) {
    console.log(`  ${tipo}: ${count}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
