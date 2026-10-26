/**
 * actualizar.js — Lee Excel y actualiza Supabase con datos nuevos
 *
 * Uso: node actualizar.js [ruta_excel]
 * Si no se pasa ruta, busca el más reciente en ~/Downloads/
 *
 * Estrategia: compara la max semana en Supabase, sube solo semanas nuevas.
 * Con flag --full reemplaza toda la tabla.
 */
require('dotenv').config();
const XLSX = require('xlsx');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

if (!process.env.DATABASE_URL) {
  console.error('ERROR: falta DATABASE_URL en .env');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000
});

// Mapeo columnas Excel → columnas DB
const COL_MAP = {
  'Semana': 'semana',
  'Mes': 'mes',
  'Equipo': 'equipo',
  'Fecha Inicio': 'fecha_inicio',
  'Turno': 'turno',
  'Mantenimiento': 'mantenimiento',
  'Detención Total (horas)': 'detencion_total_horas',
  'Tiempo NP': 'tiempo_np',
  'Tiempo PL': 'tiempo_pl',
  'SISTEMAS': 'sistemas',
  'SUBSISTEMAS': 'subsistemas',
  'COMPONENTE': 'componente',
  'TIPO DE PERDIDA': 'tipo_de_perdida',
  'Evento ': 'evento',
  'RESPONSABLE': 'responsable',
  'PARQUE': 'parque'
};

function toReal(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  var s = String(v).replace(',', '.');
  var n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function excelDateToISO(serial) {
  if (!serial || typeof serial !== 'number') return serial || null;
  // Excel serial date → JS Date
  var d = new Date((serial - 25569) * 86400 * 1000);
  return d.toISOString().slice(0, 10);
}

function findExcel(argPath) {
  if (argPath && fs.existsSync(argPath)) return argPath;
  // Buscar el más reciente en Downloads
  var dir = path.join(require('os').homedir(), 'Downloads');
  var files = fs.readdirSync(dir)
    .filter(f => f.startsWith('TABLA MAESTRA') && f.endsWith('.xlsx'))
    .map(f => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtime }))
    .sort((a, b) => b.mtime - a.mtime);
  if (files.length) return path.join(dir, files[0].name);
  console.error('No se encontró archivo Excel. Pásalo como argumento: node actualizar.js [ruta]');
  process.exit(1);
}

async function actualizar() {
  var fullMode = process.argv.includes('--full');
  var excelPath = findExcel(process.argv[2]);
  console.log('Leyendo:', excelPath);

  var t0 = Date.now();
  var wb, rawData;

  if (fullMode) {
    wb = XLSX.readFile(excelPath);
    var sheetName = wb.SheetNames.find(s => s.toLowerCase().includes('deten'));
    if (!sheetName) { console.error('No se encontró hoja "Detenciones"'); process.exit(1); }
    rawData = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
  } else {
    // Modo rápido: leer solo las últimas ~3000 filas
    wb = XLSX.readFile(excelPath);
    var sheetName = wb.SheetNames.find(s => s.toLowerCase().includes('deten'));
    if (!sheetName) { console.error('No se encontró hoja "Detenciones"'); process.exit(1); }
    var allData = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
    var TAIL = 3000;
    rawData = allData.length > TAIL ? allData.slice(-TAIL) : allData;
    console.log('Modo rápido: leyendo últimas', rawData.length, 'de', allData.length, 'filas');
  }
  console.log('Excel leído en', ((Date.now()-t0)/1000).toFixed(1)+'s —', rawData.length, 'filas');

  // Filtrar JR, JRS, PICARROCA, RB3
  var data = rawData.filter(r => {
    var eq = String(r['Equipo'] || '');
    return eq.startsWith('JR') || eq.startsWith('JRS') || eq.startsWith('PICARROCA') || eq.startsWith('RB3') || eq.startsWith('RB 3');
  });
  console.log('Filas filtradas:', data.length);

  var client = await pool.connect();
  console.log('Conectado a Supabase');

  try {
    if (fullMode) {
      console.log('MODO FULL: reemplazando toda la tabla...');
      await client.query('DELETE FROM detenciones');
    } else {
      // Obtener max semana y año actual en DB para insertar solo lo nuevo
      var maxRes = await client.query("SELECT MAX(semana::int) as maxsem FROM detenciones WHERE fecha_inicio LIKE '2026%'");
      var maxSem = parseInt(maxRes.rows[0].maxsem) || 0;
      console.log('Semana máxima en DB (2026):', maxSem);

      // Filtrar solo filas con semana > maxSem (nuevas)
      var antes = data.length;
      data = data.filter(r => {
        var sem = parseInt(r['Semana']) || 0;
        var fecha = r['Fecha Inicio'];
        var year = typeof fecha === 'number' ? new Date((fecha - 25569) * 86400000).getFullYear() : 2026;
        return year === 2026 && sem > maxSem;
      });
      console.log('Filas nuevas (semana >' + maxSem + '):', data.length, '(de', antes, 'JR/JRS)');

      if (!data.length) {
        console.log('No hay datos nuevos para subir. Base de datos al día.');
        return;
      }
    }

    // Insertar en batches
    var BATCH = 500;
    var inserted = 0;

    for (var offset = 0; offset < data.length; offset += BATCH) {
      var batch = data.slice(offset, offset + BATCH);
      var vals = [];
      var placeholders = batch.map((r, i) => {
        var COLS = 22;
        var b = i * COLS;
        var fecha = typeof r['Fecha Inicio'] === 'number' ? excelDateToISO(r['Fecha Inicio']) : (r['Fecha Inicio'] || null);
        function excelTime(v) { if (!v || typeof v !== 'number') return null; var h = Math.floor(v * 24); var m = Math.round((v * 24 - h) * 60); return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0'); }
        vals.push(
          r['Equipo'] || null,
          fecha,
          parseInt(r['Semana']) || null,
          r['Mes'] || null,
          r['Turno'] || null,
          r['Mantenimiento'] || null,
          toReal(r['Detención Total (horas)']),
          toReal(r['Tiempo NP']),
          toReal(r['Tiempo PL']),
          r['SISTEMAS'] || null,
          r['SUBSISTEMAS'] || null,
          r['COMPONENTE'] || null,
          r['TIPO DE PERDIDA'] || null,
          (r['Evento '] || r['Evento'] || '').substring(0, 500) || null,
          r['RESPONSABLE'] || null,
          r['PARQUE'] || null,
          excelTime(r['Inicio']) || null,
          excelTime(r['Fin']) || null,
          r['Detencion Continua (SI/NO) \r\nDIA'] || r['Detencion Continua (SI/NO) DIA'] || null,
          r['Detencion Continua (SI/NO) \r\nMES'] || r['Detencion Continua (SI/NO) MES'] || null,
          r['Tipo OT'] || null,
          r['DM'] || null
        );
        return '(' + Array.from({length: COLS}, (_, j) => '$' + (b + j + 1)).join(',') + ')';
      });

      await client.query(
        'INSERT INTO detenciones (equipo,fecha_inicio,semana,mes,turno,mantenimiento,detencion_total_horas,tiempo_np,tiempo_pl,sistemas,subsistemas,componente,tipo_de_perdida,evento,responsable,parque,hora_inicio,hora_termino,detencion_continua_dia,detencion_continua_mes,tipo_ot,dm) VALUES ' + placeholders.join(','),
        vals
      );
      inserted += batch.length;
      process.stdout.write('\r  ' + inserted + ' / ' + data.length + ' (' + Math.round(inserted / data.length * 100) + '%)');
    }

    console.log('\nInsertados:', inserted, 'registros');

    // Verificar total
    var total = await client.query('SELECT COUNT(*) as n FROM detenciones');
    console.log('Total en Supabase:', total.rows[0].n);

  } finally {
    client.release();
    await pool.end();
  }
}

actualizar().catch(e => { console.error(e); process.exit(1); });
