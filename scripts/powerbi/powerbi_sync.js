/**
 * powerbi_sync.js — Sube datos parseados de Power BI a Supabase
 *
 * Uso: node powerbi_sync.js
 * Lee powerbi_data/estado_equipos.json y lo sube a tabla powerbi_estado
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function sync() {
  var filePath = path.join(__dirname, '..', '..', 'data', 'powerbi_data', 'estado_equipos.json');
  if (!fs.existsSync(filePath)) {
    console.error('No existe estado_equipos.json — ejecuta powerbi_parse.py primero');
    process.exit(1);
  }

  var data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  var registros = data.registros;
  var timestamp = data.timestamp;

  // Último registro por equipo
  var byEq = {};
  registros.forEach(function(r) {
    if (r.equipo && !byEq[r.equipo]) byEq[r.equipo] = r;
  });
  var equipos = Object.values(byEq);
  console.log('Equipos únicos:', equipos.length, '| Timestamp:', timestamp);

  var client = await pool.connect();
  try {
    // Reemplazar toda la tabla (siempre es snapshot actual)
    await client.query('DELETE FROM powerbi_estado');

    var BATCH = 50;
    var inserted = 0;
    for (var off = 0; off < equipos.length; off += BATCH) {
      var batch = equipos.slice(off, off + BATCH);
      var vals = [];
      var phs = batch.map(function(r, i) {
        var b = i * 9;
        vals.push(
          r.equipo || null,
          r.estado || null,
          r.actividad || null,
          r.ubicacion || null,
          (r.observacion || '').substring(0, 500) || null,
          r.ot || null,
          r.horometro || null,
          (r.comentario || '').substring(0, 500) || null,
          timestamp
        );
        return '(' + Array.from({length: 9}, function(_, j) { return '$' + (b + j + 1); }).join(',') + ')';
      });
      await client.query(
        'INSERT INTO powerbi_estado (equipo,estado,actividad,ubicacion,observacion,ot,horometro,comentario,captura_timestamp) VALUES ' + phs.join(','),
        vals
      );
      inserted += batch.length;
    }
    console.log('Insertados:', inserted, 'equipos en Supabase');

    // ── Actividades ──
    var actPath = path.join(__dirname, '..', '..', 'data', 'powerbi_data', 'actividades.json');
    if (fs.existsSync(actPath)) {
      var actData = JSON.parse(fs.readFileSync(actPath, 'utf8'));
      var acts = actData.registros || [];
      await client.query('DELETE FROM powerbi_actividades');
      var aBatch = 50;
      var aInserted = 0;
      for (var aOff = 0; aOff < acts.length; aOff += aBatch) {
        var ab = acts.slice(aOff, aOff + aBatch);
        var aVals = [];
        var aPhs = ab.map(function(r, i) {
          var b = i * 11;
          aVals.push(
            r.equipo || null, r.empresa || null, r.actividad || null,
            r.sistema || null, r.horas_ejecucion || null, r.inicio || null,
            r.fin || null, r.id_registro || null, r.semana || null,
            (r.observacion || '').substring(0, 500) || null, timestamp
          );
          return '(' + Array.from({length: 11}, function(_, j) { return '$' + (b + j + 1); }).join(',') + ')';
        });
        await client.query(
          'INSERT INTO powerbi_actividades (equipo,empresa,actividad,sistema,horas_ejecucion,inicio,fin,id_registro,semana,observacion,captura_timestamp) VALUES ' + aPhs.join(','),
          aVals
        );
        aInserted += ab.length;
      }
      console.log('Insertados:', aInserted, 'actividades en Supabase');
    }

    // ── Disponibilidad ──
    var dispPath = path.join(__dirname, '..', '..', 'data', 'powerbi_data', 'disponibilidad.json');
    if (fs.existsSync(dispPath)) {
      var dispData = JSON.parse(fs.readFileSync(dispPath, 'utf8'));
      await client.query('DELETE FROM powerbi_disponibilidad');
      await client.query(
        'INSERT INTO powerbi_disponibilidad (equipos_fs,equipos_operativos,total_equipos,disponibilidad_semanal,disponibilidad_diaria,semanas,captura_timestamp) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [
          dispData.equipos_fs, dispData.equipos_operativos, dispData.total_equipos,
          String(dispData.disponibilidad_semanal || ''),
          JSON.stringify(dispData.disponibilidad_diaria || []),
          JSON.stringify(dispData.semanas || []),
          timestamp
        ]
      );
      console.log('Disponibilidad subida a Supabase');
    }

    // ── Hora a Hora (acumula por fecha) ──
    var hhPath = path.join(__dirname, '..', '..', 'data', 'powerbi_data', 'hora_hora.json');
    if (fs.existsSync(hhPath)) {
      var hhData = JSON.parse(fs.readFileSync(hhPath, 'utf8'));
      var hoy = new Date().toISOString().slice(0, 10);
      // Upsert: reemplaza solo el día actual
      await client.query('DELETE FROM powerbi_hora_hora WHERE fecha = $1', [hoy]);
      await client.query(
        'INSERT INTO powerbi_hora_hora (horas,equipos,captura_timestamp,fecha) VALUES ($1,$2,$3,$4)',
        [JSON.stringify(hhData.horas || []), JSON.stringify(hhData.equipos || []), timestamp, hoy]
      );
      var totalDias = await client.query('SELECT COUNT(DISTINCT fecha) as cnt FROM powerbi_hora_hora');
      console.log('Hora a hora: ' + (hhData.equipos || []).length + ' equipos, día ' + hoy + ' (' + totalDias.rows[0].cnt + ' días acumulados)');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

sync().catch(function(e) { console.error(e); process.exit(1); });
