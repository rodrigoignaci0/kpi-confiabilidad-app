"""
Servidor FastAPI local para Control Semanal de Turnos.
Uso: python app.py  (abre localhost:5000)
"""
import os, sqlite3, json, datetime as dt
from pathlib import Path
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

DB_PATH = os.path.join(os.path.dirname(__file__), "control.db")
STATIC_DIR = os.path.dirname(__file__)

app = FastAPI(title="Control Turno a Turno")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


@app.get("/", response_class=HTMLResponse)
async def index():
    return FileResponse(os.path.join(STATIC_DIR, "dashboard_control.html"))


@app.get("/api/semanas")
async def listar_semanas():
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM semanas ORDER BY year DESC, semana DESC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/semana/{semana}")
async def detalle_semana(semana: int, year: int = 2026):
    conn = get_db()
    sem = conn.execute(
        "SELECT * FROM semanas WHERE semana=? AND year=?", (semana, year)
    ).fetchone()
    if not sem:
        raise HTTPException(404, "Semana no encontrada")
    sem_id = sem["id"]

    hallazgos = conn.execute(
        "SELECT * FROM hallazgos WHERE semana_id=? ORDER BY prioridad, tipo, equipo",
        (sem_id,)
    ).fetchall()

    registros_count = conn.execute(
        "SELECT equipo, COUNT(*) as n FROM registros WHERE semana_id=? GROUP BY equipo ORDER BY equipo",
        (sem_id,)
    ).fetchall()

    por_tipo = conn.execute(
        "SELECT tipo, COUNT(*) as n FROM hallazgos WHERE semana_id=? GROUP BY tipo ORDER BY n DESC",
        (sem_id,)
    ).fetchall()

    por_equipo = conn.execute(
        "SELECT equipo, COUNT(*) as n, SUM(CASE WHEN prioridad='alta' THEN 1 ELSE 0 END) as alta FROM hallazgos WHERE semana_id=? GROUP BY equipo ORDER BY n DESC",
        (sem_id,)
    ).fetchall()

    por_supervisor = conn.execute(
        """SELECT r.supervisor, COUNT(DISTINCT r.id) as bloques,
           COUNT(DISTINCT h.id) as alertas
           FROM registros r
           LEFT JOIN hallazgos h ON h.semana_id=r.semana_id AND h.archivo=r.archivo AND h.equipo=r.equipo
           WHERE r.semana_id=?
           GROUP BY r.supervisor""",
        (sem_id,)
    ).fetchall()

    conn.close()
    return {
        "semana": dict(sem),
        "hallazgos": [dict(h) for h in hallazgos],
        "registros_por_equipo": [dict(r) for r in registros_count],
        "por_tipo": [dict(r) for r in por_tipo],
        "por_equipo": [dict(r) for r in por_equipo],
        "por_supervisor": [dict(r) for r in por_supervisor],
    }


@app.get("/api/hallazgos")
async def listar_hallazgos(
    semana: int = None, year: int = 2026,
    tipo: str = None, equipo: str = None,
    prioridad: str = None, estado: str = None
):
    conn = get_db()
    query = "SELECT h.*, s.semana, s.year FROM hallazgos h JOIN semanas s ON h.semana_id=s.id WHERE 1=1"
    params = []
    if semana:
        query += " AND s.semana=? AND s.year=?"
        params += [semana, year]
    if tipo:
        query += " AND h.tipo=?"
        params.append(tipo)
    if equipo:
        query += " AND h.equipo=?"
        params.append(equipo)
    if prioridad:
        query += " AND h.prioridad=?"
        params.append(prioridad)
    if estado:
        query += " AND h.estado=?"
        params.append(estado)
    query += " ORDER BY h.prioridad, h.tipo, h.equipo"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/hallazgo/{hallazgo_id}/corregir")
async def corregir_hallazgo(hallazgo_id: int):
    """Marca hallazgo como corregido (pendiente de aplicar en copia)."""
    conn = get_db()
    h = conn.execute("SELECT * FROM hallazgos WHERE id=?", (hallazgo_id,)).fetchone()
    if not h:
        raise HTTPException(404, "Hallazgo no encontrado")
    conn.execute(
        "UPDATE hallazgos SET estado='corregido', fecha_correccion=? WHERE id=?",
        (dt.datetime.now().isoformat(), hallazgo_id)
    )
    conn.commit()
    conn.close()
    return {"ok": True, "id": hallazgo_id, "estado": "corregido"}


@app.post("/api/hallazgo/{hallazgo_id}/ignorar")
async def ignorar_hallazgo(hallazgo_id: int):
    conn = get_db()
    conn.execute("UPDATE hallazgos SET estado='ignorado' WHERE id=?", (hallazgo_id,))
    conn.commit()
    conn.close()
    return {"ok": True, "id": hallazgo_id, "estado": "ignorado"}


@app.post("/api/hallazgo/{hallazgo_id}/revertir")
async def revertir_hallazgo(hallazgo_id: int):
    conn = get_db()
    conn.execute("UPDATE hallazgos SET estado='pendiente', fecha_correccion=NULL WHERE id=?", (hallazgo_id,))
    conn.commit()
    conn.close()
    return {"ok": True, "id": hallazgo_id, "estado": "pendiente"}


@app.get("/api/tendencia")
async def tendencia(year: int = 2026):
    """Tendencia de hallazgos por semana para gráfico."""
    conn = get_db()
    rows = conn.execute(
        """SELECT semana, total_registros, total_hallazgos, alta, media, baja
           FROM semanas WHERE year=? ORDER BY semana""",
        (year,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/equipos")
async def equipos_estado(semana: int = None, year: int = 2026):
    conn = get_db()
    if semana:
        sem = conn.execute("SELECT id FROM semanas WHERE semana=? AND year=?", (semana, year)).fetchone()
        if not sem:
            raise HTTPException(404)
        sem_id = sem["id"]
    else:
        sem = conn.execute("SELECT id FROM semanas ORDER BY year DESC, semana DESC LIMIT 1").fetchone()
        if not sem:
            return []
        sem_id = sem["id"]

    rows = conn.execute(
        """SELECT equipo, COUNT(*) as bloques,
           SUM(CASE WHEN falla_turno='SI' THEN 1 ELSE 0 END) as fallas,
           GROUP_CONCAT(DISTINCT sistema) as sistemas
           FROM registros WHERE semana_id=? GROUP BY equipo ORDER BY equipo""",
        (sem_id,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


if __name__ == "__main__":
    print("Control Turno a Turno → http://localhost:5050")
    uvicorn.run(app, host="0.0.0.0", port=5050)
