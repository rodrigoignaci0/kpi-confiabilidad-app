require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const XLSX = require('xlsx');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT_DIR = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT_DIR, 'data');
const JWT_SECRET = process.env.JWT_SECRET || 'kpi-secret-change-in-prod';
const USE_PG = !!process.env.DATABASE_URL;

// ── DB ABSTRACTION ──
let dbAll, dbGet, dbRun;

if (USE_PG) {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  console.log('Usando PostgreSQL (Supabase)');
  dbAll = async (sql, params) => (await pool.query(sql, params || [])).rows;
  dbGet = async (sql, params) => { const r = await pool.query(sql, params || []); return r.rows[0] || null; };
  dbRun = async (sql, params) => { const r = await pool.query(sql, params || []); return { lastID: (r.rows[0]||{}).id, changes: r.rowCount }; };
} else {
  let Database;
  try { Database = require('better-sqlite3'); } catch(e) { console.error('better-sqlite3 no disponible — usa DATABASE_URL para PostgreSQL'); process.exit(1); }
  const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'tabla_maestra.db');
  const AUTH_DB_PATH = process.env.AUTH_DB_PATH || path.join(DATA_DIR, 'auth.db');

  const mainDb = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  const authDb = new Database(AUTH_DB_PATH);
  authDb.exec(`CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL, nombre TEXT NOT NULL, cargo TEXT,
    rol TEXT NOT NULL DEFAULT 'viewer', activo INTEGER NOT NULL DEFAULT 1,
    creado_en TEXT DEFAULT (datetime('now'))
  )`);
  console.log('Usando SQLite local');

  // En SQLite, auth y datos están en DBs separadas; mapeamos por tabla
  const allDbs = { usuarios: authDb, detenciones: mainDb };
  dbAll = (sql, params) => {
    const db = sql.toLowerCase().includes('usuarios') ? authDb : mainDb;
    return db.prepare(sql).all(...(params||[]));
  };
  dbGet = (sql, params) => {
    const db = sql.toLowerCase().includes('usuarios') ? authDb : mainDb;
    return db.prepare(sql).get(...(params||[]));
  };
  dbRun = (sql, params) => {
    const db = sql.toLowerCase().includes('usuarios') ? authDb : mainDb;
    const info = db.prepare(sql).run(...(params||[]));
    return { lastID: info.lastInsertRowid, changes: info.changes };
  };
}

// Inicializar usuario admin si no existe (ambos modos)
async function initAdmin() {
  const ph = USE_PG ? '$1' : '?';
  const count = await dbGet(`SELECT COUNT(*) as n FROM usuarios`);
  if (parseInt(count?.n || count?.count || 0) === 0) {
    const hash = bcrypt.hashSync('admin1234', 10);
    const sql = USE_PG
      ? "INSERT INTO usuarios (username, password, nombre, rol) VALUES ($1,$2,$3,$4)"
      : "INSERT INTO usuarios (username, password, nombre, rol) VALUES (?,?,?,?)";
    await dbRun(sql, ['admin', hash, 'Administrador', 'admin']);
    console.log('Usuario admin creado (admin / admin1234) — cambia la contraseña');
  }
  // Migración: columna dashboard_config + tabla dashboard_defaults
  if (USE_PG) {
    await dbRun("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS dashboard_config JSONB DEFAULT NULL").catch(() => {});
    await dbRun(`CREATE TABLE IF NOT EXISTS dashboard_defaults (
      id INT PRIMARY KEY DEFAULT 1 CHECK(id=1), config JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMP DEFAULT NOW()
    )`);
    await dbRun("INSERT INTO dashboard_defaults (config) VALUES ('{}') ON CONFLICT DO NOTHING");
    await dbRun(`CREATE TABLE IF NOT EXISTS listas_validacion (
      id SERIAL PRIMARY KEY, tipo TEXT NOT NULL, valor TEXT NOT NULL,
      padre TEXT, activo BOOLEAN DEFAULT true, orden INT DEFAULT 0
    )`);
    await dbRun("ALTER TABLE detenciones ADD COLUMN IF NOT EXISTS origen TEXT DEFAULT 'excel'").catch(() => {});
  } else {
    try { await dbRun("ALTER TABLE usuarios ADD COLUMN dashboard_config TEXT DEFAULT NULL"); } catch(e) {}
    await dbRun("CREATE TABLE IF NOT EXISTS dashboard_defaults (id INTEGER PRIMARY KEY CHECK(id=1), config TEXT NOT NULL DEFAULT '{}', updated_at TEXT DEFAULT (datetime('now')))");
    try { await dbRun("INSERT OR IGNORE INTO dashboard_defaults (id, config) VALUES (1, '{}')"); } catch(e) {}
  }
}
initAdmin().catch(console.error);

// ── MIDDLEWARES ──
app.use(cors());
app.use(express.json());

// Modo mantención: activo en Render (RENDER=true lo define la plataforma) salvo MAINTENANCE=0;
// también se fuerza con MAINTENANCE=1. En desarrollo local la app corre normal.
const MAINTENANCE_ON = process.env.MAINTENANCE === '1' || (process.env.RENDER === 'true' && process.env.MAINTENANCE !== '0');
// Acceso durante la mantención: /?acceso=<ACCESS_KEY> deja una cookie y abre el sitio solo a quien tiene el enlace.
const ACCESS_KEY = process.env.ACCESS_KEY || '';
function claveValida(valor) {
  if (!ACCESS_KEY || !valor) return false;
  const a = Buffer.from(String(valor)), b = Buffer.from(ACCESS_KEY);
  return a.length === b.length && require('crypto').timingSafeEqual(a, b);
}
function cookieAcceso(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)acceso_mant=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
function maintenanceMiddleware(req, res, next) {
  if (!MAINTENANCE_ON || req.path === '/assets/logo-veltis.jpg') return next();
  if (claveValida(req.query.acceso)) {
    res.cookie('acceso_mant', ACCESS_KEY, { httpOnly: true, sameSite: 'lax', secure: process.env.RENDER === 'true', maxAge: 30 * 864e5 });
    return res.redirect(req.path);
  }
  if (claveValida(cookieAcceso(req))) return next();
  res.set('Retry-After', '3600');
  if (req.path.startsWith('/api/')) return res.status(503).json({ error: 'Sitio en mantención y migración de datos' });
  res.status(503).sendFile(path.join(PUBLIC_DIR, 'mantencion.html'));
}
app.use(maintenanceMiddleware);

app.use(express.static(PUBLIC_DIR, { index: false, etag: false, maxAge: 0 }));

function ph(n) { return USE_PG ? '$' + n : '?'; }

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Token inválido o expirado' }); }
}
function adminOnly(req, res, next) {
  if (req.user.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' });
  next();
}
function supervisorOrAdmin(req, res, next) {
  if (!['admin','supervisor'].includes(req.user.rol)) return res.status(403).json({ error: 'Solo supervisores o admin' });
  next();
}

// ── AUTH ──
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Faltan credenciales' });
    const sql = `SELECT * FROM usuarios WHERE username = ${ph(1)} AND activo = ${USE_PG ? '1' : '1'}`;
    const user = await dbGet(sql, [username]);
    if (!user || !bcrypt.compareSync(password, user.password))
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    const token = jwt.sign({ id: user.id, username: user.username, nombre: user.nombre, rol: user.rol, cargo: user.cargo }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, nombre: user.nombre, rol: user.rol, username: user.username, cargo: user.cargo });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/cambiar-password', authMiddleware, async (req, res) => {
  try {
    const { actual, nueva } = req.body;
    const user = await dbGet(`SELECT * FROM usuarios WHERE id = ${ph(1)}`, [req.user.id]);
    if (!bcrypt.compareSync(actual, user.password)) return res.status(400).json({ error: 'Contraseña actual incorrecta' });
    if (!nueva || nueva.length < 6) return res.status(400).json({ error: 'Mínimo 6 caracteres' });
    await dbRun(`UPDATE usuarios SET password = ${ph(1)} WHERE id = ${ph(2)}`, [bcrypt.hashSync(nueva, 10), req.user.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── USUARIOS CRUD ──
app.get('/api/usuarios', authMiddleware, adminOnly, async (req, res) => {
  const rows = await dbAll('SELECT id, username, nombre, cargo, rol, activo, creado_en FROM usuarios ORDER BY id');
  res.json(rows);
});

app.post('/api/usuarios', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { username, password, nombre, cargo, rol } = req.body;
    if (!username || !password || !nombre) return res.status(400).json({ error: 'Faltan campos' });
    if (!['admin','viewer'].includes(rol)) return res.status(400).json({ error: 'Rol inválido' });
    const hash = bcrypt.hashSync(password, 10);
    const sql = `INSERT INTO usuarios (username, password, nombre, cargo, rol) VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${ph(5)}) RETURNING id`;
    const r = await dbRun(sql.replace(' RETURNING id', USE_PG ? ' RETURNING id' : ''), [username, hash, nombre, cargo||null, rol]);
    res.json({ id: r.lastID, ok: true });
  } catch(e) {
    if (e.message?.includes('UNIQUE') || e.code === '23505') return res.status(400).json({ error: 'El usuario ya existe' });
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/usuarios/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { nombre, rol, activo, password } = req.body;
    const id = parseInt(req.params.id);
    if (nombre) await dbRun(`UPDATE usuarios SET nombre = ${ph(1)} WHERE id = ${ph(2)}`, [nombre, id]);
    if (rol && ['admin','viewer'].includes(rol)) await dbRun(`UPDATE usuarios SET rol = ${ph(1)} WHERE id = ${ph(2)}`, [rol, id]);
    if (typeof activo === 'number') await dbRun(`UPDATE usuarios SET activo = ${ph(1)} WHERE id = ${ph(2)}`, [activo, id]);
    if (password?.length >= 6) await dbRun(`UPDATE usuarios SET password = ${ph(1)} WHERE id = ${ph(2)}`, [bcrypt.hashSync(password, 10), id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/usuarios/:id', authMiddleware, adminOnly, async (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
  await dbRun(`DELETE FROM usuarios WHERE id = ${ph(1)}`, [id]);
  res.json({ ok: true });
});

// ── DASHBOARD CONFIG ──
app.get('/api/dashboard-config', authMiddleware, async (req, res) => {
  try {
    const user = await dbGet(`SELECT dashboard_config FROM usuarios WHERE id = ${ph(1)}`, [req.user.id]);
    const def = await dbGet('SELECT config FROM dashboard_defaults WHERE id = 1');
    var uc = user?.dashboard_config || null;
    var dc = def?.config || '{}';
    if (typeof uc === 'string') try { uc = JSON.parse(uc); } catch(e) { uc = null; }
    if (typeof dc === 'string') try { dc = JSON.parse(dc); } catch(e) { dc = {}; }
    res.json({ config: uc, defaults: dc });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/dashboard-config', authMiddleware, async (req, res) => {
  try {
    var cfg = req.body.config;
    if (!cfg || typeof cfg !== 'object') return res.status(400).json({ error: 'Config inválida' });
    var val = USE_PG ? JSON.stringify(cfg) : JSON.stringify(cfg);
    await dbRun(`UPDATE usuarios SET dashboard_config = ${USE_PG ? ph(1) + '::jsonb' : ph(1)} WHERE id = ${ph(2)}`, [val, req.user.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/dashboard-defaults', authMiddleware, adminOnly, async (req, res) => {
  try {
    const def = await dbGet('SELECT config FROM dashboard_defaults WHERE id = 1');
    var dc = def?.config || '{}';
    if (typeof dc === 'string') try { dc = JSON.parse(dc); } catch(e) { dc = {}; }
    res.json({ config: dc });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/dashboard-defaults', authMiddleware, adminOnly, async (req, res) => {
  try {
    var cfg = req.body.config;
    if (!cfg || typeof cfg !== 'object') return res.status(400).json({ error: 'Config inválida' });
    var val = JSON.stringify(cfg);
    if (USE_PG) {
      await dbRun(`UPDATE dashboard_defaults SET config = ${ph(1)}::jsonb, updated_at = NOW() WHERE id = 1`, [val]);
    } else {
      await dbRun(`UPDATE dashboard_defaults SET config = ${ph(1)}, updated_at = datetime('now') WHERE id = 1`, [val]);
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── DETENCIONES ──
app.get('/api/detenciones', authMiddleware, async (req, res) => {
  try {
    const { year, tipos, equipo } = req.query;
    const conditions = [];
    const params = [];
    let p = 1;

    if (year && year !== '0') {
      // LIKE '2025%' funciona igual en SQLite y PostgreSQL para fechas en texto
      conditions.push(`fecha_inicio LIKE ${ph(p++)}`);
      params.push(year + '%');
    }

    if (equipo && equipo.trim()) {
      conditions.push(`equipo = ${ph(p++)}`);
      params.push(equipo.trim());
    } else if (tipos) {
      const lista = tipos.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
      if (lista.length) {
        const tc = lista.map(t => {
          if (t === 'JR') return `(equipo LIKE 'JR%' AND equipo NOT LIKE 'JRS%')`;
          if (t === 'PICARROCA') return `equipo LIKE 'PICARROCA%'`;
          if (t === 'RB3') return `(equipo LIKE 'RB3%' OR equipo LIKE 'RB 3%')`;

          return `equipo LIKE '${t}%'`;
        });
        conditions.push('(' + tc.join(' OR ') + ')');
      }
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const sql = `SELECT id, equipo, fecha_inicio, semana, turno, mantenimiento,
      detencion_total_horas, sistemas, subsistemas, componente, tipo_de_perdida, evento, responsable,
      hora_inicio, hora_termino, detencion_continua_dia, detencion_continua_mes, tipo_ot, codigo, dm
      FROM detenciones ${where} ORDER BY fecha_inicio DESC`;

    const rows = await dbAll(sql, params);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/equipos', authMiddleware, async (req, res) => {
  const rows = await dbAll("SELECT DISTINCT equipo FROM detenciones WHERE equipo IS NOT NULL ORDER BY equipo");
  res.json(rows.map(r => r.equipo));
});

app.get('/api/status', authMiddleware, async (req, res) => {
  try {
    const count = await dbGet('SELECT COUNT(*) as n FROM detenciones');
    const years = await dbAll("SELECT DISTINCT substr(fecha_inicio,1,4) as y FROM detenciones WHERE fecha_inicio IS NOT NULL ORDER BY y DESC");
    const equipos = await dbGet("SELECT COUNT(DISTINCT equipo) as n FROM detenciones");
    res.json({ registros: parseInt(count?.n || count?.count), anios: years.map(r=>r.y).filter(Boolean), equipos: parseInt(equipos?.n || equipos?.count) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── UPLOAD EXCEL ──
app.post('/api/upload-excel', authMiddleware, adminOnly, upload.single('archivo'), async (req, res) => {
  if (!USE_PG) return res.status(400).json({ error: 'Upload solo disponible con PostgreSQL' });
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
  try {
    const mode = req.body.mode || 'incremental'; // 'incremental' o 'full'
    const wb = XLSX.read(req.file.buffer);
    const sheetName = wb.SheetNames.find(s => s.toLowerCase().includes('deten'));
    if (!sheetName) return res.status(400).json({ error: 'No se encontró hoja "Detenciones" en el Excel' });

    const rawData = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
    // Filtrar solo JR y JRS
    let data = rawData.filter(r => {
      const eq = String(r['Equipo'] || '');
      return eq.startsWith('JR');
    });

    function toReal(v) {
      if (v === null || v === undefined || v === '') return null;
      if (typeof v === 'number') return v;
      const n = parseFloat(String(v).replace(',', '.'));
      return isNaN(n) ? null : n;
    }
    function excelDate(serial) {
      if (!serial || typeof serial !== 'number') return serial || null;
      return new Date((serial - 25569) * 86400000).toISOString().slice(0, 10);
    }

    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    const client = await pool.connect();

    let deleted = 0;
    if (mode === 'full') {
      const dr = await client.query('DELETE FROM detenciones');
      deleted = dr.rowCount;
    } else {
      // Incremental: obtener max semana del año actual y borrar esas semanas para re-insertarlas limpias
      const maxRes = await client.query("SELECT MAX(semana::int) as maxsem FROM detenciones WHERE fecha_inicio LIKE '2026%'");
      const maxSem = parseInt(maxRes.rows[0]?.maxsem) || 0;
      if (maxSem > 0) {
        // Solo filas nuevas: semana > maxSem en 2026
        data = data.filter(r => {
          const sem = parseInt(r['Semana']) || 0;
          const fecha = r['Fecha Inicio'];
          const year = typeof fecha === 'number' ? new Date((fecha - 25569) * 86400000).getFullYear() : 2026;
          return year >= 2026 && sem > maxSem;
        });
      }
    }

    if (!data.length) {
      client.release();
      await pool.end();
      return res.json({ ok: true, mensaje: 'No hay datos nuevos para subir', insertados: 0, deleted });
    }

    // Insertar en batches de 500
    let inserted = 0;
    const BATCH = 500;
    for (let offset = 0; offset < data.length; offset += BATCH) {
      const batch = data.slice(offset, offset + BATCH);
      const vals = [];
      function excelTime(v) { if (!v || typeof v !== 'number') return null; const h = Math.floor(v * 24); const m = Math.round((v * 24 - h) * 60); return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0'); }
      const phs = batch.map((r, i) => {
        const COLS = 22;
        const b = i * COLS;
        const fecha = typeof r['Fecha Inicio'] === 'number' ? excelDate(r['Fecha Inicio']) : (r['Fecha Inicio'] || null);
        vals.push(
          r['Equipo'] || null, fecha, parseInt(r['Semana']) || null, r['Mes'] || null,
          r['Turno'] || null, r['Mantenimiento'] || null,
          toReal(r['Detención Total (horas)']), toReal(r['Tiempo NP']), toReal(r['Tiempo PL']),
          r['SISTEMAS'] || null, r['SUBSISTEMAS'] || null, r['COMPONENTE'] || null,
          r['TIPO DE PERDIDA'] || null, (r['Evento '] || r['Evento'] || '').substring(0, 500) || null,
          r['RESPONSABLE'] || null, r['PARQUE'] || null,
          excelTime(r['Inicio']) || null, excelTime(r['Fin']) || null,
          r['Detencion Continua (SI/NO) \r\nDIA'] || null, r['Detencion Continua (SI/NO) \r\nMES'] || null,
          r['Tipo OT'] || null, r['DM'] || null
        );
        return '(' + Array.from({length: COLS}, (_, j) => '$' + (b + j + 1)).join(',') + ')';
      });
      await client.query(
        'INSERT INTO detenciones (equipo,fecha_inicio,semana,mes,turno,mantenimiento,detencion_total_horas,tiempo_np,tiempo_pl,sistemas,subsistemas,componente,tipo_de_perdida,evento,responsable,parque,hora_inicio,hora_termino,detencion_continua_dia,detencion_continua_mes,tipo_ot,dm) VALUES ' + phs.join(','),
        vals
      );
      inserted += batch.length;
    }

    const total = await client.query('SELECT COUNT(*) as n FROM detenciones');
    client.release();
    await pool.end();

    res.json({ ok: true, insertados: inserted, deleted, total: parseInt(total.rows[0].n), mensaje: `${inserted} registros nuevos subidos` });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── DETENCIÓN MANUAL ──
app.post('/api/detencion-manual', authMiddleware, adminOnly, async (req, res) => {
  try {
    const b = req.body;
    if (!b.equipo || !b.fecha_inicio || !b.turno || !b.mantenimiento) return res.status(400).json({ error: 'Faltan campos requeridos' });
    const horas = parseFloat(b.detencion_total_horas) || 12;
    const tNP = b.mantenimiento === 'NP' ? horas : 0;
    const tPL = b.mantenimiento === 'PL' ? horas : 0;
    const fechaCorta = b.fecha_inicio.replace(/-/g,'');
    const serial = fechaCorta.slice(-5) + b.turno + Math.floor(Math.random()*900+100);
    const hiStr = b.hora_inicio || (b.turno === 'A' ? '07:00' : '19:00');
    const htStr = b.hora_termino || (b.turno === 'A' ? '19:00' : '07:00');
    const fechaHoraInicio = b.fecha_inicio + ' ' + hiStr;
    const fechaHoraTermino = b.fecha_inicio + ' ' + htStr;
    const meses = ['','ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
    const mes = meses[parseInt(b.fecha_inicio.slice(5,7))] || '';
    const cantNP = b.mantenimiento === 'NP' ? '1' : '0';
    const cantPL = b.mantenimiento === 'PL' ? '1' : '0';
    const eventoFmt = 'AVISO: ' + (b.evento || 'Registro manual') + '\n DIAGNOSTICO :\n' + (b.evento || 'Registro manual') + '\n EJECUCION: \n' + (b.ejecucion || b.evento || 'Sin intervención') + '\n';
    const perdida = (b.tipo_ot || '').includes('ELECTRICA') ? 'ELECTRICA' : 'MECANICA';
    const sql = `INSERT INTO detenciones (equipo, fecha_inicio, semana, mes, turno, mantenimiento,
      detencion_total_horas, tiempo_np, tiempo_pl, sistemas, subsistemas, componente,
      tipo_de_perdida, evento, responsable, hora_inicio, hora_termino,
      detencion_continua_dia, detencion_continua_mes, tipo_ot, codigo, dm, parque,
      inicio_actividad, fin_actividad, total_ejecucion_horas, cant_personas, horas_persona,
      cantidad_pl, cantidad_np, hp, perdida)
      VALUES (${Array.from({length:32},(_,i)=>ph(i+1)).join(',')})`;
    await dbRun(sql, [
      b.equipo, b.fecha_inicio, parseInt(b.semana)||null, mes, b.turno, b.mantenimiento,
      horas, tNP, tPL, b.sistemas||'INTERFERENCIA OPERACIONAL', b.subsistemas||'SIN INTERVENCIÓN', b.componente||null,
      b.tipo_de_perdida||'INTERFERENCIA', eventoFmt, 'MANUAL', hiStr, htStr,
      b.detencion_continua_dia||'SI', b.detencion_continua_mes||'NO', b.tipo_ot||'INTERFERENCIA', serial, b.dm||null, '1',
      fechaHoraInicio, fechaHoraTermino, 0, 0, 0,
      cantPL, cantNP, 0, perdida
    ]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── OBTENER DETENCIÓN POR ID ──
app.get('/api/detencion/:id', authMiddleware, async (req, res) => {
  try {
    const row = await dbGet(`SELECT * FROM detenciones WHERE id = ${ph(1)}`, [parseInt(req.params.id)]);
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    res.json(row);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── EDITAR DETENCIÓN ──
app.patch('/api/detencion/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const row = await dbGet(`SELECT * FROM detenciones WHERE id = ${ph(1)}`, [id]);
    if (!row) return res.status(404).json({ error: 'Registro no encontrado' });

    const allowed = ['detencion_total_horas','mantenimiento','sistemas','subsistemas','componente',
      'tipo_de_perdida','evento','hora_inicio','hora_termino','detencion_continua_dia',
      'detencion_continua_mes','tipo_ot','dm'];
    const sets = [];
    const vals = [];
    let p = 1;
    allowed.forEach(col => {
      if (req.body[col] !== undefined) {
        sets.push(`${col} = ${ph(p++)}`);
        vals.push(req.body[col]);
      }
    });
    if (!sets.length) return res.status(400).json({ error: 'Sin campos para actualizar' });

    // Recalcular tiempo_np/tiempo_pl
    const mant = req.body.mantenimiento || row.mantenimiento;
    const horas = parseFloat(req.body.detencion_total_horas ?? row.detencion_total_horas) || 0;
    sets.push(`tiempo_np = ${ph(p++)}`); vals.push(mant === 'NP' ? horas : 0);
    sets.push(`tiempo_pl = ${ph(p++)}`); vals.push(mant === 'PL' ? horas : 0);

    vals.push(id);
    await dbRun(`UPDATE detenciones SET ${sets.join(', ')} WHERE id = ${ph(p)}`, vals);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POWERBI STATIC DATA ──
app.get('/api/powerbi-estado', async (req, res) => {
  try {
    // Intentar archivo local primero, si no, Supabase
    const filePath = path.join(DATA_DIR, 'powerbi_data', 'estado_equipos.json');
    try {
      const data = await require('fs').promises.readFile(filePath, 'utf8');
      return res.type('json').send(data);
    } catch (_) {}
    // Fallback: Supabase
    const registros = await dbAll('SELECT equipo,estado,actividad,ubicacion,observacion,ot,horometro,comentario,captura_timestamp as fecha FROM powerbi_estado ORDER BY equipo');
    if (registros.length) {
      const op = registros.filter(r => r.estado === 'Operativo').length;
      const fss = registros.filter(r => r.estado === 'Fuera de servicio').length;
      return res.json({ timestamp: registros[0]?.fecha || '', equipos_total: registros.length, operativos: op, fuera_servicio: fss, registros });
    }
    res.status(404).json({ error: 'Sin datos Power BI' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/powerbi-disponibilidad', async (req, res) => {
  try {
    const filePath = path.join(DATA_DIR, 'powerbi_data', 'disponibilidad.json');
    try {
      const data = await require('fs').promises.readFile(filePath, 'utf8');
      return res.type('json').send(data);
    } catch (_) {}
    const row = await dbGet('SELECT equipos_fs,equipos_operativos,total_equipos,disponibilidad_semanal,disponibilidad_diaria,semanas,captura_timestamp as timestamp FROM powerbi_disponibilidad ORDER BY id DESC LIMIT 1');
    if (row) {
      row.disponibilidad_diaria = typeof row.disponibilidad_diaria === 'string' ? JSON.parse(row.disponibilidad_diaria) : row.disponibilidad_diaria;
      row.semanas = typeof row.semanas === 'string' ? JSON.parse(row.semanas) : row.semanas;
      return res.json(row);
    }
    res.status(404).json({ error: 'Sin datos disponibilidad' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/powerbi-horahora', async (req, res) => {
  try {
    // Si piden histórico semanal
    if (req.query.semana === '1') {
      const rows = await dbAll('SELECT horas,equipos,fecha,captura_timestamp as timestamp FROM powerbi_hora_hora ORDER BY fecha DESC LIMIT 7');
      if (rows.length) {
        const dias = rows.map(r => ({
          fecha: r.fecha,
          horas: typeof r.horas === 'string' ? JSON.parse(r.horas) : r.horas,
          equipos: typeof r.equipos === 'string' ? JSON.parse(r.equipos) : r.equipos,
        }));
        return res.json({ dias });
      }
      return res.status(404).json({ error: 'Sin datos históricos' });
    }
    // Día actual: archivo local primero
    const filePath = path.join(DATA_DIR, 'powerbi_data', 'hora_hora.json');
    try {
      const data = await require('fs').promises.readFile(filePath, 'utf8');
      return res.type('json').send(data);
    } catch (_) {}
    const row = await dbGet('SELECT horas,equipos,fecha,captura_timestamp as timestamp FROM powerbi_hora_hora ORDER BY fecha DESC LIMIT 1');
    if (row) {
      row.horas = typeof row.horas === 'string' ? JSON.parse(row.horas) : row.horas;
      row.equipos = typeof row.equipos === 'string' ? JSON.parse(row.equipos) : row.equipos;
      return res.json(row);
    }
    res.status(404).json({ error: 'Sin datos hora a hora' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/powerbi-actividades', async (req, res) => {
  try {
    const filePath = path.join(DATA_DIR, 'powerbi_data', 'actividades.json');
    try {
      const data = await require('fs').promises.readFile(filePath, 'utf8');
      return res.type('json').send(data);
    } catch (_) {}
    const registros = await dbAll('SELECT equipo,empresa,actividad,sistema,horas_ejecucion,inicio,fin,id_registro,semana,observacion FROM powerbi_actividades ORDER BY inicio DESC');
    if (registros.length) return res.json({ timestamp: '', registros, total: registros.length });
    res.status(404).json({ error: 'Sin datos actividades' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GROQ AI PROXY ──
app.post('/api/analisis-ia', authMiddleware, async (req, res) => {
  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) return res.status(500).json({ error: 'GROQ_API_KEY no configurada' });
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Falta prompt' });
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + GROQ_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen/qwen3.8-27b',
        messages: [
          { role: 'system', content: 'Eres un analista de confiabilidad de equipos mineros. Responde en español, conciso (máx 150 palabras). Solo resume lo que ocurrió: qué falló, en qué sistema/componente, y qué se hizo. No des recomendaciones ni sugerencias.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 200,
        temperature: 0.3
      })
    });
    const data = await resp.json();
    if (data.error) return res.status(400).json({ error: data.error.message });
    var texto = (data.choices[0].message.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    res.json({ texto: texto });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PÚBLICO: Dashboard Ejecutivo sin auth ──
app.get('/api/detenciones-public', async (req, res) => {
  try {
    const { year, semana } = req.query;
    const conditions = [];
    const params = [];
    let p = 1;
    if (year && year !== '0') { conditions.push(`fecha_inicio LIKE ${ph(p++)}`); params.push(year + '%'); }
    if (semana && semana !== '0') { conditions.push(`semana = ${ph(p++)}`); params.push(parseInt(semana)); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const sql = `SELECT equipo, fecha_inicio, semana, turno, mantenimiento, detencion_total_horas, sistemas, subsistemas, componente, tipo_de_perdida, evento FROM detenciones ${where} ORDER BY fecha_inicio DESC`;
    const rows = await dbAll(sql, params);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── CHAT IA ──
const GROQ_KEY = process.env.GROQ_API_KEY;
app.post('/api/chat', authMiddleware, async (req, res) => {
  if (!GROQ_KEY) return res.status(500).json({ error: 'GROQ_API_KEY no configurada' });
  var pregunta = (req.body.message || '').trim();
  if (!pregunta) return res.status(400).json({ error: 'Mensaje vacío' });
  try {
    var Groq = require('groq-sdk');
    var groq = new Groq({ apiKey: GROQ_KEY });
    var dbType = USE_PG ? 'PostgreSQL' : 'SQLite';
    var castHint = USE_PG ? 'Para horas usa detencion_total_horas::float' : 'Para horas usa CAST(detencion_total_horas AS REAL)';
    var sysPrompt = `Asistente confiabilidad equipos mineros. Español. Sin <think> tags.
Tabla "detenciones" (${dbType}): id,equipo(JR001-JR010,JRS001-002),fecha_inicio(YYYY-MM-DD),semana,turno(TA/TB),mantenimiento(NP/PL),detencion_total_horas,sistemas,subsistemas,componente,evento,responsable.
Tablas Excel: excel_indisponibilidad(equipo,fecha,sistema,descripcion_aviso,ot,tipo_ot,codigo), excel_planificado(semana,tipo_pl,equipo,orden,texto_breve,estado).
Reglas: 1)Genera SELECT en \`\`\`sql\`\`\` si necesita datos 2)Solo SELECT 3)LIMIT 20 4)${castHint} 5)Año default 2026 6)Conciso`;

    var messages = [
      { role: 'system', content: sysPrompt },
      { role: 'user', content: pregunta }
    ];
    var resp = await groq.chat.completions.create({
      model: 'qwen/qwen3.8-27b',
      messages: messages,
      temperature: 0.2,
      max_tokens: 900
    });
    var answer = (resp.choices[0].message.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();

    var sqlMatch = answer.match(/```sql\s*([\s\S]*?)```/);
    if (sqlMatch) {
      var sql = sqlMatch[1].trim();
      if (/^\s*(UPDATE|DELETE|INSERT|DROP|ALTER|TRUNCATE)/i.test(sql)) {
        return res.json({ answer: 'Solo consultas SELECT permitidas.', data: null });
      }
      sql = sql.replace(/;\s*$/, '');
      if (!/LIMIT/i.test(sql)) sql += ' LIMIT 20';
      var rows = await dbAll(sql, []);
      // Truncar datos para no exceder límite de tokens Groq
      var trimmed = rows.slice(0, 20).map(function(r) {
        var o = {};
        Object.keys(r).forEach(function(k) {
          var v = r[k];
          o[k] = (typeof v === 'string' && v.length > 80) ? v.substring(0, 80) + '...' : v;
        });
        return o;
      });
      var dataStr = JSON.stringify(trimmed);
      if (dataStr.length > 3000) dataStr = dataStr.substring(0, 3000) + '...]';
      var followUp = await groq.chat.completions.create({
        model: 'qwen/qwen3.8-27b',
        messages: [
          { role: 'system', content: 'Analista confiabilidad. Resume en español, conciso. Tablas markdown si hay filas. No repitas SQL. Sin <think>.' },
          { role: 'user', content: pregunta + '\n\nDatos (' + rows.length + ' filas):\n' + dataStr }
        ],
        temperature: 0.3,
        max_tokens: 900
      });
      var fAnswer = (followUp.choices[0].message.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      return res.json({ answer: fAnswer, data: rows, sql: sql });
    }
    res.json({ answer: answer, data: null });
  } catch(e) {
    console.error('Chat error:', e.message);
    res.status(500).json({ error: 'Error: ' + e.message });
  }
});

// ── DASHBOARD SISTEMAS (D3) ──
const MODELO_MAP = {
  JR001:'DL421',JR002:'DL421',JR003:'DL421',JR004:'DL421',JR005:'DL421',JR006:'DL421',JR007:'M7C',JR008:'M7C',JR009:'M4C',JR010:'M4C',
  JRS001:'JRS',JRS002:'JRS',
  'RB3-11':'RB3','RB3-12':'RB3','RB3-13':'RB3',
  'PICARROCA N1':'PICARROCA','PICARROCA N2':'PICARROCA'
};
function flotaOf(eq) {
  if (/^JR\d/.test(eq)) return 'JR';
  if (/^JRS/.test(eq)) return 'JRS';
  if (/^RB3/.test(eq)) return 'RB3';
  if (/^PICARROCA/.test(eq)) return 'PICARROCA';
  if (/^LE/.test(eq)) return 'LE';
  if (/^LH/.test(eq)) return 'LH';
  return 'OTROS';
}
const TIPO_TO_COL = {
  'PMATRIZ':'pmatriz','P. MATRIZ':'pmatriz','P.MATRIZ':'pmatriz',
  'BK':'bk','BACKLOG':'bk',
  'MANTENCION MAYOR':'mayor','MANT. MAYOR':'mayor','MANTENIMIENTO MAYOR':'mayor',
  'FALTA DE REPUESTO':'rep','REPUESTO':'rep',
  'NP MECANICA':'mec','MECANICA':'mec','NP MECÁNICA':'mec',
  'NP ELECTRICA':'ele','ELECTRICA':'ele','NP ELÉCTRICA':'ele','ELÉCTRICA':'ele',
  'EN ESPERA LOGISTICA':'logis','LOGISTICA':'logis','EN ESPERA LOGÍSTICA':'logis',
  'INTERFERENCIA MANTENIMIENTO':'imtto','INTERFERENCIA MTTO':'imtto',
  'OTROS':'otros','OTRO':'otros',
  'INTERFERENCIA OPERACIONAL':'iop','INTERFERENCIA':'iop',
  'EQAC':'eqac'
};
const H_CAL_WEEK = 168; // 24h × 7d

const R2 = v => Math.round((v || 0) * 100) / 100;
const DS_SQL = `SELECT equipo, fecha_inicio, semana, mantenimiento, detencion_total_horas, tipo_de_perdida, tipo_ot, sistemas, componente, evento FROM detenciones ORDER BY fecha_inicio, semana`;

function parseRow(r) {
  const eq = (r.equipo || '').trim();
  const fecha = (r.fecha_inicio || '').substring(0, 10);
  const sem = parseInt(r.semana) || 0;
  const h = parseFloat(r.detencion_total_horas) || 0;
  const mant = (r.mantenimiento || '').trim().toUpperCase();
  const tipo = (r.tipo_de_perdida || '').trim().toUpperCase();
  const ot = (r.tipo_ot || '').trim().toUpperCase();
  const sis = (r.sistemas || '').trim().toUpperCase();
  const comp = (r.componente || '').trim();
  return { eq, fecha, sem, h, mant, tipo, ot, sis, comp };
}

function classifyHours(mant, tipo, ot) {
  if (mant === 'PL') {
    if (ot.includes('BACKLOG')) return 'c_bk';
    if (['MANTENIMIENTO MAYOR','MANT MAYOR'].includes(tipo)) return 'c_mmayor';
    return 'c_pmatriz';
  }
  if (tipo === 'FALTA DE REPUESTO') return 'c_frep';
  if (['NP MECANICA','NP ELECTRICA','NP MECÁNICA','NP ELÉCTRICA'].includes(tipo)) return 'c_npact';
  if (['EN ESPERA LOGISTICA','LOGISTICA'].includes(tipo)) return 'c_log';
  if (['INTERFERENCIA MANTENIMIENTO','INTERFERENCIA MTTO'].includes(tipo)) return 'c_imtto';
  if (['INTERFERENCIA OPERACIONAL','INTERFERENCIA'].includes(tipo)) return 'c_iop';
  if (tipo === 'EQAC') return 'c_eqac';
  return 'c_otros';
}

const NP_FALLA_TIPOS = new Set(['NP MECANICA','NP ELECTRICA','NP MECÁNICA','NP ELÉCTRICA']);
const DIARIO_COLS = ['c_pmatriz','c_bk','c_mmayor','c_frep','c_npact','c_log','c_imtto','c_iop','c_eqac','c_otros'];

function buildDiario(rows) {
  const map = {};
  rows.forEach(r => {
    const p = parseRow(r);
    if (!p.eq || !p.fecha) return;
    const key = p.eq + '|' + p.fecha;
    if (!map[key]) {
      const d = new Date(p.fecha);
      map[key] = {
        anio: d.getFullYear(), mes: d.getMonth() + 1, semana: p.sem,
        fecha: p.fecha, equipo: p.eq, modelo: MODELO_MAP[p.eq] || p.eq, flota: flotaOf(p.eq),
        h_cal: 24, h_det: 0, h_np: 0, h_pl: 0, fallas_np: 0,
        c_pmatriz:0, c_bk:0, c_mmayor:0, c_frep:0, c_npact:0,
        c_log:0, c_imtto:0, c_iop:0, c_eqac:0, c_otros:0
      };
    }
    const rec = map[key];
    rec.h_det += p.h;
    if (p.mant === 'PL') rec.h_pl += p.h;
    else if (p.mant === 'NP') rec.h_np += p.h;
    rec[classifyHours(p.mant, p.tipo, p.ot)] += p.h;
    if (p.mant === 'NP' && NP_FALLA_TIPOS.has(p.tipo)) rec.fallas_np += 1;
  });
  return Object.values(map).map(r => {
    ['h_det','h_np','h_pl', ...DIARIO_COLS].forEach(k => { r[k] = R2(r[k]); });
    return r;
  });
}

function buildDetalle(rows) {
  return rows.map(r => {
    const p = parseRow(r);
    const d = new Date(p.fecha);
    return {
      anio: d.getFullYear(), mes: d.getMonth() + 1, semana: p.sem,
      equipo: p.eq, flota: flotaOf(p.eq), sistema: p.sis || 'OTROS', componente: p.comp || 'OTROS',
      tipo_perdida: p.tipo, mant: p.mant, h: R2(p.h), eventos: 1
    };
  });
}

function buildNotas(rows) {
  const map = {};
  rows.forEach(r => {
    const p = parseRow(r);
    if (p.mant !== 'NP' || !p.eq || !p.fecha) return;
    const key = p.fecha + '|' + p.eq;
    if (!map[key]) map[key] = { fecha: p.fecha, equipo: p.eq, flota: flotaOf(p.eq), h_np: 0, parts: [] };
    map[key].h_np += p.h;
    const label = (p.sis || 'OTROS') + '/' + (p.comp || 'OTROS');
    map[key].parts.push(label + ' (' + R2(p.h) + 'h)');
  });
  return Object.values(map).map(r => ({
    fecha: r.fecha, equipo: r.equipo, flota: r.flota, h_np: R2(r.h_np),
    detalle_np: r.parts.join('; ')
  }));
}

// ── LISTAS VALIDACIÓN ──
app.get('/api/listas/:tipo', authMiddleware, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT valor, padre FROM listas_validacion WHERE tipo = ${ph(1)} AND activo = true ORDER BY orden, valor`,
      [req.params.tipo]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── REPORTE TURNO ──
function isoWeek(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}

const mesesNombres = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

app.get('/api/reporte', authMiddleware, supervisorOrAdmin, async (req, res) => {
  try {
    const { fecha, turno } = req.query;
    if (!fecha) return res.status(400).json({ error: 'fecha requerida' });
    let sql = `SELECT * FROM detenciones WHERE fecha_inicio = ${ph(1)} AND origen = 'web'`;
    const params = [fecha];
    if (turno) { sql += ` AND turno = ${ph(2)}`; params.push(turno); }
    res.json(await dbAll(sql, params));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/reporte', authMiddleware, supervisorOrAdmin, async (req, res) => {
  try {
    const b = req.body;
    const semana = isoWeek(b.fecha);
    const mes = mesesNombres[parseInt(b.fecha.slice(5,7)) - 1] || '';
    const sql = `INSERT INTO detenciones (equipo, fecha_inicio, semana, mes, turno, mantenimiento,
      tipo_de_perdida, tipo_ot, sistemas, subsistemas, componente, hora_inicio, hora_termino,
      detencion_total_horas, evento, ubicacion, detencion_continua_dia, detencion_continua_mes,
      responsable, origen, parque, dm)
      VALUES (${Array.from({length:22},(_,i)=>ph(i+1)).join(',')}) RETURNING id`;
    const r = await dbRun(sql, [
      b.equipo, b.fecha, semana, mes, b.turno, b.mantenimiento,
      b.tipo_perdida, b.tipo_ot, b.sistemas, b.subsistemas, b.componente,
      b.hora_inicio, b.hora_termino, b.detencion_total_horas, b.evento,
      b.ubicacion, b.detencion_continua_dia, b.detencion_continua_mes,
      req.user.nombre, 'web', 1, null
    ]);
    res.json({ ok: true, id: r.lastID });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/reporte/:id', authMiddleware, supervisorOrAdmin, async (req, res) => {
  try {
    const b = req.body;
    const today = new Date().toISOString().slice(0,10);
    const yd = new Date(Date.now()-86400000).toISOString().slice(0,10);
    const existing = await dbGet(
      `SELECT id, origen, fecha_inicio FROM detenciones WHERE id = ${ph(1)}`, [req.params.id]
    );
    if (!existing || existing.origen !== 'web') return res.status(403).json({ error: 'Solo registros web editables' });
    const f = (existing.fecha_inicio||'').slice(0,10);
    if (f !== today && f !== yd) return res.status(403).json({ error: 'Solo hoy o ayer' });
    const semana = isoWeek(b.fecha);
    const mes = mesesNombres[parseInt(b.fecha.slice(5,7)) - 1] || '';
    const sql = `UPDATE detenciones SET equipo=${ph(1)}, fecha_inicio=${ph(2)}, semana=${ph(3)},
      mes=${ph(4)}, turno=${ph(5)}, mantenimiento=${ph(6)}, tipo_de_perdida=${ph(7)}, tipo_ot=${ph(8)},
      sistemas=${ph(9)}, subsistemas=${ph(10)}, componente=${ph(11)}, hora_inicio=${ph(12)},
      hora_termino=${ph(13)}, detencion_total_horas=${ph(14)}, evento=${ph(15)}, ubicacion=${ph(16)},
      detencion_continua_dia=${ph(17)}, detencion_continua_mes=${ph(18)}
      WHERE id = ${ph(19)} AND origen = 'web'`;
    await dbRun(sql, [
      b.equipo, b.fecha, semana, mes, b.turno, b.mantenimiento,
      b.tipo_perdida, b.tipo_ot, b.sistemas, b.subsistemas, b.componente,
      b.hora_inicio, b.hora_termino, b.detencion_total_horas, b.evento,
      b.ubicacion, b.detencion_continua_dia, b.detencion_continua_mes, req.params.id
    ]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/reporte/:id', authMiddleware, supervisorOrAdmin, async (req, res) => {
  try {
    await dbRun(`DELETE FROM detenciones WHERE id = ${ph(1)} AND origen = 'web'`, [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/ds-diario', authMiddleware, async (_req, res) => {
  try {
    const rows = await dbAll(DS_SQL, []);
    res.json(buildDiario(rows));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/ds-detalle', authMiddleware, async (_req, res) => {
  try {
    const rows = await dbAll(DS_SQL, []);
    res.json(buildDetalle(rows));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/ds-notas', authMiddleware, async (_req, res) => {
  try {
    const rows = await dbAll(DS_SQL, []);
    res.json(buildNotas(rows));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/reporte-turno', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'reporte-turno.html')));
app.get('/ds-ejecutivo', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'ejecutivo.html')));
app.get('/ds-sistemas', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'dashboard-sistemas.html')));
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'confiabilidad.html')));

app.listen(PORT, () => console.log(`Servidor en http://localhost:${PORT} [${USE_PG ? 'PostgreSQL' : 'SQLite'}]`));
