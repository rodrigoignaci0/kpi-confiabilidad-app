/**
 * migrate.js — Migra datos de SQLite local a Supabase (PostgreSQL)
 *
 * Uso:
 *   1. Agrega DATABASE_URL en .env
 *   2. node migrate.js
 */
require('dotenv').config();
const Database = require('better-sqlite3');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'tabla_maestra.db');

if (!process.env.DATABASE_URL) {
  console.error('ERROR: falta DATABASE_URL en .env');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const sqlite = new Database(DB_PATH, { readonly: true });

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Creando tablas en Supabase...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS detenciones (
        id SERIAL PRIMARY KEY,
        equipo TEXT,
        fecha_inicio TEXT,
        semana INTEGER,
        mes TEXT,
        turno TEXT,
        mantenimiento TEXT,
        detencion_total_horas REAL,
        tiempo_np REAL,
        tiempo_pl REAL,
        sistemas TEXT,
        subsistemas TEXT,
        componente TEXT,
        tipo_de_perdida TEXT,
        evento TEXT,
        responsable TEXT,
        parque TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        nombre TEXT NOT NULL,
        rol TEXT NOT NULL DEFAULT 'viewer',
        activo INTEGER NOT NULL DEFAULT 1,
        creado_en TIMESTAMP DEFAULT NOW()
      )
    `);

    // Usuario admin por defecto
    const adminExists = (await client.query("SELECT COUNT(*) as n FROM usuarios")).rows[0].n;
    if (parseInt(adminExists) === 0) {
      const hash = bcrypt.hashSync('admin1234', 10);
      await client.query("INSERT INTO usuarios (username, password, nombre, rol) VALUES ($1,$2,$3,$4)",
        ['admin', hash, 'Administrador', 'admin']);
      console.log('Usuario admin creado (admin / admin1234)');
    }

    // Migrar detenciones
    const total = sqlite.prepare('SELECT COUNT(*) as n FROM detenciones').get().n;
    console.log(`Migrando ${total.toLocaleString()} registros...`);

    // Limpiar tabla destino
    await client.query('DELETE FROM detenciones');

    const BATCH = 500;
    let offset = 0;
    let migrated = 0;

    while (offset < total) {
      const rows = sqlite.prepare(`
        SELECT equipo, fecha_inicio, semana, mes, turno, mantenimiento,
          detencion_total_horas, tiempo_np, tiempo_pl, sistemas, subsistemas,
          componente, tipo_de_perdida, evento, responsable, parque
        FROM detenciones LIMIT ${BATCH} OFFSET ${offset}
      `).all();

      if (!rows.length) break;

      // Bulk insert con VALUES múltiples
      function toReal(v) {
        if (v === null || v === undefined) return null;
        if (typeof v === 'number') return v;
        var s = String(v).replace(',', '.');
        var n = parseFloat(s);
        return isNaN(n) ? null : n;
      }

      const vals = [];
      const placeholders = rows.map((r, i) => {
        const b = i * 16;
        vals.push(r.equipo, r.fecha_inicio, r.semana, r.mes, r.turno, r.mantenimiento,
          toReal(r.detencion_total_horas), toReal(r.tiempo_np), toReal(r.tiempo_pl),
          r.sistemas, r.subsistemas, r.componente, r.tipo_de_perdida, r.evento, r.responsable, r.parque);
        return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},$${b+13},$${b+14},$${b+15},$${b+16})`;
      });

      await client.query(
        `INSERT INTO detenciones (equipo,fecha_inicio,semana,mes,turno,mantenimiento,detencion_total_horas,tiempo_np,tiempo_pl,sistemas,subsistemas,componente,tipo_de_perdida,evento,responsable,parque) VALUES ${placeholders.join(',')}`,
        vals
      );

      offset += BATCH;
      migrated += rows.length;
      process.stdout.write(`\r  ${migrated.toLocaleString()} / ${total.toLocaleString()} (${Math.round(migrated/total*100)}%)`);
    }

    console.log('\nMigracion completada.');
    await client.query('CREATE INDEX IF NOT EXISTS idx_det_equipo ON detenciones(equipo)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_det_fecha ON detenciones(fecha_inicio)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_det_semana ON detenciones(semana)');
    console.log('Indices creados.');

  } finally {
    client.release();
    await pool.end();
    sqlite.close();
  }
}

migrate().catch(e => { console.error(e); process.exit(1); });
