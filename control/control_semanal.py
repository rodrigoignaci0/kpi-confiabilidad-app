"""
Control Semanal de Informes Turno a Turno
Lee .xlsm desde OneDrive, analiza errores, guarda en SQLite, genera copias corregidas.
Uso: python control_semanal.py --semana 43 [--dry] [--year 2026]
"""
import argparse, datetime as dt, glob, os, re, sqlite3, json, shutil, zipfile
import subprocess, time, tempfile
from collections import defaultdict
from difflib import SequenceMatcher
from pathlib import Path
import openpyxl, warnings
warnings.filterwarnings("ignore")

BASE_ONEDRIVE = os.path.expanduser(
    os.environ.get("TURNOS_BASE", "~/Library/CloudStorage/OneDrive-VELTISLATAM/Entrega de Turno a Turno")
)
DB_PATH = os.path.join(os.path.dirname(__file__), "control.db")
CONTROLES_DIR = os.path.join(BASE_ONEDRIVE, "Controles")
CORREGIDOS_DIR = os.path.join(CONTROLES_DIR, "Corregidos")

TURNO_A = (9, 0, 19, 0)
TURNO_B = (21, 0, 7, 0)
TOLERANCIA_H = 14
MAX_HUECO_H = 48
ESTADO_WA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "estado_cierre_whatsapp.json")


def semana_rango(semana, year=2026):
    """Devuelve (lunes, domingo) para la semana ISO dada."""
    lunes = dt.date.fromisocalendar(year, semana, 1)
    domingo = lunes + dt.timedelta(days=6)
    return lunes, domingo


def buscar_archivos(year, mes_num):
    """Busca todos los .xlsm en las carpetas TURNO 1-4 del mes."""
    mes_str = f"{mes_num:02d}.{'Enero Febrero Marzo Abril Mayo Junio Julio Agosto Septiembre Octubre Noviembre Diciembre'.split()[mes_num-1]}"
    base = os.path.join(BASE_ONEDRIVE, str(year), mes_str)
    archivos = []
    for turno_dir in sorted(glob.glob(os.path.join(base, "TURNO *"))):
        for f in sorted(os.listdir(turno_dir)):
            if f.endswith(".xlsm") and "Informe" in f and "~$" not in f:
                archivos.append(os.path.join(turno_dir, f))
    return archivos


def parsear_fecha_archivo(nombre):
    """Extrae fecha y turno del nombre del archivo."""
    m = re.search(r'(\d{1,2})-(\d{1,2})-(\d{4})\s*T([AB])', nombre)
    if not m:
        return None, None
    d, mo, y, t = int(m.group(1)), int(m.group(2)), int(m.group(3)), m.group(4)
    return dt.date(y, mo, d), t


def idx_map(ws):
    """Mapea nombre de columna -> índice para fila 1."""
    h = [c.value for c in ws[1]]
    m = {}
    for i, x in enumerate(h):
        if x is not None and x not in m:
            m[x] = i
    return m


CATALOGO_TSV = os.path.join(os.path.dirname(__file__), "catalogo_jr.tsv")


def leer_catalogo_tsv():
    """Lee catálogo estático desde TSV (fuente principal)."""
    tree = {}
    if not os.path.exists(CATALOGO_TSV):
        return tree
    with open(CATALOGO_TSV, encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split("\t")
            if len(parts) < 2 or parts[0] == "Sistema":
                continue
            sis, sub = parts[0].strip().upper(), parts[1].strip().upper()
            comp = parts[2].strip().upper() if len(parts) > 2 and parts[2].strip() else ""
            tree.setdefault(sis, set()).add(sub)
            if comp:
                tree.setdefault(sub, set()).add(comp)
    return tree


def leer_catalogo(wb):
    """Lee árbol Sistema>Subsistema>Componente de hojas ocultas (fallback)."""
    tree = {}
    for sheet_name in ("SISTEMAS_JR", "SISTEMAS"):
        if sheet_name not in wb.sheetnames:
            continue
        ws = wb[sheet_name]
        for col in ws.iter_cols():
            parent = None
            for c in col:
                v = c.value
                if v in (None, ""):
                    parent = None
                    continue
                v = str(v).strip()
                if parent is None:
                    parent = v
                else:
                    tree.setdefault(parent.upper(), set()).add(v.upper())
    return tree


def es_archivo_local(filepath, timeout_check=2):
    """Verifica si un archivo está descargado localmente (no cloud-only)."""
    import signal
    def handler(signum, frame):
        raise TimeoutError()
    old = signal.signal(signal.SIGALRM, handler)
    signal.alarm(timeout_check)
    try:
        with open(filepath, 'rb') as fh:
            magic = fh.read(4)
            return magic[:2] == b'PK'
    except (OSError, TimeoutError):
        return False
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, old)


def hidratar_archivos(archivos, timeout=300):
    """Fuerza descarga de archivos cloud-only de OneDrive. Retorna lista de los que están listos."""
    listos = []
    pendientes = []
    for f in archivos:
        if es_archivo_local(f):
            listos.append(f)
        else:
            pendientes.append(f)

    if not pendientes:
        return listos

    # Agrupar por carpeta y abrir Finder para forzar descarga
    carpetas = set(os.path.dirname(f) for f in pendientes)
    print(f"  {len(pendientes)} archivos en la nube. Forzando descarga...")

    # Método 1: Abrir cada carpeta en Finder (fuerza hidratación de OneDrive)
    for carpeta in carpetas:
        subprocess.run(["open", carpeta], capture_output=True)

    # Método 2: Usar AppleScript para seleccionar archivos en Finder
    for f in pendientes:
        script = f'tell application "Finder" to open POSIX file "{f}"'
        subprocess.Popen(["osascript", "-e", script], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    print(f"  Se abrieron en Finder/Excel. Esperando descarga (máx {timeout}s)...")
    inicio = time.time()
    while pendientes and (time.time() - inicio) < timeout:
        time.sleep(5)
        aun_pendientes = []
        for f in pendientes:
            if es_archivo_local(f):
                listos.append(f)
                print(f"    ✓ {os.path.basename(f)}")
            else:
                aun_pendientes.append(f)
        pendientes = aun_pendientes
        if pendientes:
            elapsed = int(time.time() - inicio)
            print(f"    Esperando {len(pendientes)} archivos... ({elapsed}s)")

    # Cerrar Excel después de descargar
    subprocess.run(["osascript", "-e", 'tell application "Microsoft Excel" to quit saving no'], capture_output=True)

    if pendientes:
        print(f"\n  ⚠ {len(pendientes)} archivos no se pudieron descargar.")
        print(f"  → Abre Finder, ve a las carpetas TURNO y haz clic derecho → 'Mantener en este dispositivo'")
        print(f"  → Luego vuelve a ejecutar el comando.\n")

    return listos


def consolidar_archivo(filepath):
    """Lee BD_Indisponibilidad + BD_Ejecución, devuelve lista de registros."""
    nombre = os.path.basename(filepath)
    tmp = os.path.join(tempfile.gettempdir(), f"ctrl_{nombre}")
    shutil.copy2(filepath, tmp)
    wb = openpyxl.load_workbook(tmp, data_only=True)
    os.unlink(tmp)
    carpeta = os.path.basename(os.path.dirname(filepath))

    if "BD_Indisponibilidad" not in wb.sheetnames or "BD_Ejecución" not in wb.sheetnames:
        return [], None, None

    wi, we = wb["BD_Indisponibilidad"], wb["BD_Ejecución"]
    mi, me = idx_map(wi), idx_map(we)

    ej = {}
    for r in we.iter_rows(min_row=2, values_only=True):
        if r[me["Equipo"]] not in (None, "", 0):
            ej[r[me["Codigo"]]] = r

    registros = []
    for r in wi.iter_rows(min_row=2, values_only=True):
        if r[mi["Equipo"]] in (None, "", 0):
            continue
        cod = r[mi["Codigo"]]
        e = ej.get(cod)
        if e is None:
            continue
        g = lambda row, m, k: row[m[k]] if k in m else None
        registros.append({
            "archivo": nombre,
            "carpeta": carpeta,
            "fecha": g(r, mi, "Fecha"),
            "turno": g(r, mi, "Turno"),
            "supervisor": g(e, me, "Supervisor"),
            "tipo": g(r, mi, "Tipo"),
            "equipo": g(r, mi, "Equipo"),
            "codigo": cod,
            "tipo_ot": g(r, mi, "Tipo de OT"),
            "falla_turno": g(r, mi, "Falla en Turno"),
            "ubicacion": g(r, mi, "Ubicación"),
            "sistema": g(r, mi, "Sistema"),
            "subsistema": g(e, me, "Subsistema"),
            "componente": g(e, me, "Componente"),
            "descripcion": g(r, mi, "Descripcion del Aviso"),
            "aviso_inicio": g(r, mi, "Fecha/Hora Inicio"),
            "aviso_termino": g(r, mi, "Fecha/Hora Termino"),
            "trabajo_inicio": g(e, me, "Fecha/Hora Inicio"),
            "trabajo_termino": g(e, me, "Fecha/Hora Termino"),
            "personas": g(e, me, "Cantidad de Personas"),
            "ot": g(r, mi, "OT / AVISO"),
        })

    sup = wb["Reporte"]["B4"].value if "Reporte" in wb.sheetnames else None
    catalogo = leer_catalogo(wb)
    wb.close()
    return registros, sup, catalogo


def leer_estado_whatsapp():
    """{(fecha, turno): {equipos F/S al cierre}} según los preliminares de WhatsApp."""
    if not os.path.exists(ESTADO_WA_PATH):
        return {}
    with open(ESTADO_WA_PATH, encoding="utf-8") as f:
        raw = json.load(f)
    return {(dt.date.fromisoformat(k[:10]), k[-1]): set(v) for k, v in raw.items()}


def hallazgos_sin_registro(por_equipo_turno, turnos, archivo_turno, estado_wa):
    """Equipo que cerró F/S el turno anterior (WhatsApp) y no tiene ningún registro en el siguiente."""
    out = []
    for prev, cur in zip(turnos, turnos[1:]):
        for eq in sorted(estado_wa.get(prev, ())):
            if eq.startswith("JR") and cur not in por_equipo_turno.get(eq, {}):
                out.append({
                    "equipo": eq, "turno_tag": f"{cur[0].strftime('%d-%m')} T{cur[1]}",
                    "archivo": archivo_turno.get(cur), "tipo": "estado_sin_registro", "prioridad": "alta",
                    "detalle": f"{eq} cerró F/S {prev[0].strftime('%d-%m')}T{prev[1]} (WhatsApp) y {cur[0].strftime('%d-%m')}T{cur[1]} no tiene registros",
                    "campo": "continuidad", "valor_actual": "F/S sin registro", "valor_sugerido": None,
                    "ot": None, "codigo": None, "auto": False,
                })
    return out


INICIO_TURNO = {"A": dt.time(8, 0), "B": dt.time(20, 0)}
FIN_TURNO = {"A": dt.time(20, 0), "B": dt.time(8, 0)}
TOL_TRASPASO = dt.timedelta(minutes=5)


def _limites_turno(clave):
    """(inicio, fin) del turno (fecha, 'A'|'B'); el B termina al día siguiente."""
    fecha, t = clave
    dias = 1 if t == "B" else 0
    return (dt.datetime.combine(fecha, INICIO_TURNO[t]),
            dt.datetime.combine(fecha + dt.timedelta(days=dias), FIN_TURNO[t]))


def _fraccion_dia(hora):
    return str(round((hora.hour * 60 + hora.minute) / 1440, 10))


def _registro_traspaso(regs, mas_tarde):
    """Registro que se estira: prefiere correctivos sobre preventivos. -> (registro, es_correctivo)."""
    corr = [r for r in regs if not str(r["tipo_ot"] or "").startswith("MANTENCION PREVENTIVA")]
    base = corr or regs
    llave = (lambda r: r["aviso_termino"]) if mas_tarde else (lambda r: r["aviso_inicio"])
    return (max if mas_tarde else min)(base, key=llave), bool(corr)


def _hallazgo_traspaso(eq, clave, reg, campo, actual, sugerido, correctivo):
    return {
        "equipo": eq, "turno_tag": f"{clave[0].strftime('%d-%m')} T{clave[1]}", "archivo": reg["archivo"],
        "tipo": "fs_traspaso_turno", "prioridad": "alta" if correctivo else "media",
        "detalle": f"{eq} pasa F/S al otro turno: {campo} {actual:%H:%M} → {sugerido:%H:%M}"
                   + ("" if correctivo else " (solo hay preventivo: revisar)"),
        "campo": campo, "valor_actual": f"{actual:%H:%M}", "valor_sugerido": _fraccion_dia(sugerido),
        "ot": reg["ot"], "codigo": reg["codigo"], "auto": correctivo,
    }


def _validos(regs):
    return [r for r in regs if isinstance(r["aviso_inicio"], dt.datetime) and isinstance(r["aviso_termino"], dt.datetime)]


def hallazgos_traspaso_fs(por_equipo_turno, turnos, estado_wa):
    """Equipo F/S al cierre (WhatsApp): su Aviso debe ser el inicio del turno entrante
    y su Entrega el cierre del turno saliente, para que la espera cuente como indisponibilidad."""
    out = []
    for prev, cur in zip(turnos, turnos[1:]):
        for eq in sorted(e for e in estado_wa.get(prev, ()) if e.startswith("JR")):
            salientes = _validos(por_equipo_turno.get(eq, {}).get(prev, []))
            entrantes = _validos(por_equipo_turno.get(eq, {}).get(cur, []))
            if salientes:
                reg, corr = _registro_traspaso(salientes, True)
                fin = _limites_turno(prev)[1]
                if fin - reg["aviso_termino"] > TOL_TRASPASO:
                    out.append(_hallazgo_traspaso(eq, prev, reg, "hora_entrega", reg["aviso_termino"], fin, corr))
            if entrantes:
                reg, corr = _registro_traspaso(entrantes, False)
                ini = _limites_turno(cur)[0]
                if reg["aviso_inicio"] - ini > TOL_TRASPASO:
                    out.append(_hallazgo_traspaso(eq, cur, reg, "hora_aviso", reg["aviso_inicio"], ini, corr))
    return out


RE_ESPERA_OPERACIONAL = re.compile(
    r"\bESPERA\b.*\bOPERADOR\b|\bSIN OPERADOR\b"
    r"|\b(?:ESPERA|FALTA|SIN)\b.*\b(?:CONEXI[OÓ]N|CONECTAR|RED EL[EÉ]CTRICA|ENERG[IÍ]A|ENCHUFE|SUMINISTRO EL[EÉ]CTRICO)\b"
    r"|\b(?:NO|DES)\s?CONECTADO\b")
TIPO_OT_INTERF_OPERACIONAL = "PRUEBA OPERACIONAL (INTERFERENCIA OPERACIONAL)"


def _hallazgo_espera_operador(r, eq, tag, tipo_ot_str, desc_txt):
    """Espera de operador, de conexión a red eléctrica o equipo no conectado es interferencia operacional."""
    if not RE_ESPERA_OPERACIONAL.search(desc_txt) or "INTERFERENCIA OPERACIONAL" in tipo_ot_str:
        return None
    return {
        "equipo": eq, "turno_tag": tag, "archivo": r["archivo"],
        "tipo": "espera_operacional_tipo_ot", "prioridad": "alta",
        "detalle": f"Espera operacional clasificada como '{r['tipo_ot']}': corresponde interferencia operacional",
        "campo": "tipo_ot", "valor_actual": str(r["tipo_ot"]),
        "valor_sugerido": TIPO_OT_INTERF_OPERACIONAL,
        "ot": r["ot"], "codigo": r["codigo"], "auto": True,
    }


def analizar_registros(registros, catalogo, semana_inicio, semana_fin):
    """Aplica todas las reglas de validación. Devuelve lista de hallazgos."""
    hallazgos = []
    regs_semana = [r for r in registros if r["fecha"] and isinstance(r["fecha"], dt.datetime)
                   and semana_inicio <= r["fecha"].date() <= semana_fin]

    por_equipo_ot = defaultdict(list)
    for r in regs_semana:
        if r["ot"]:
            por_equipo_ot[(r["equipo"], str(r["ot"]))].append(r)

    for r in regs_semana:
        tag = f"{r['fecha'].strftime('%d-%m')} T{r['turno']}" if isinstance(r["fecha"], dt.datetime) else "?"
        eq = r["equipo"]

        # Registro basura: campos clave vacíos
        desc = str(r["descripcion"]).strip() if r["descripcion"] else ""
        ot_val = str(r["ot"]).strip() if r["ot"] else ""
        sis_val = str(r["sistema"]).strip() if r["sistema"] else ""
        sub_val = str(r["subsistema"]).strip() if r["subsistema"] else ""
        comp_val = str(r["componente"]).strip() if r["componente"] else ""
        vacio = lambda v: not v or v in ("0", "None", "nan", "N/A", "00:00:00")
        sin_desc = vacio(desc)
        sin_ot = vacio(ot_val)
        sin_inicio = r["aviso_inicio"] is None and r["trabajo_inicio"] is None
        tiene_clasificacion = not vacio(sis_val) or not vacio(sub_val) or not vacio(comp_val)

        # Basura total: sin descripción, sin OT, sin hora inicio
        if sin_desc and sin_ot and sin_inicio:
            hallazgos.append({
                "equipo": eq, "turno_tag": tag, "archivo": r["archivo"],
                "tipo": "registro_basura", "prioridad": "alta",
                "detalle": f"Sin descripción, sin OT, sin hora inicio{' (tiene clasificación: '+sis_val+'>'+sub_val+'>'+comp_val+')' if tiene_clasificacion else ''}",
                "campo": "registro completo",
                "valor_actual": f"desc='{desc}' ot='{ot_val}' inicio=None",
                "valor_sugerido": "Eliminar",
                "ot": r["ot"], "codigo": r["codigo"],
                "auto": False,
            })
            continue

        # Basura parcial: tiene clasificación pero sin descripción ni hora inicio
        if sin_desc and sin_inicio and tiene_clasificacion:
            hallazgos.append({
                "equipo": eq, "turno_tag": tag, "archivo": r["archivo"],
                "tipo": "registro_basura", "prioridad": "alta",
                "detalle": f"Tiene {sis_val}>{sub_val}>{comp_val} pero sin descripción ni hora inicio — relleno vacío",
                "campo": "registro completo",
                "valor_actual": f"desc='{desc}' inicio=None",
                "valor_sugerido": "Eliminar o completar",
                "ot": r["ot"], "codigo": r["codigo"],
                "auto": False,
            })
            continue

        # Incompleto: tiene sistema pero sin descripción
        if sin_desc and tiene_clasificacion and not sin_inicio:
            hallazgos.append({
                "equipo": eq, "turno_tag": tag, "archivo": r["archivo"],
                "tipo": "registro_incompleto", "prioridad": "media",
                "detalle": f"Tiene {sis_val}>{sub_val} pero sin descripción de aviso",
                "campo": "descripcion",
                "valor_actual": f"desc vacía",
                "valor_sugerido": None,
                "ot": r["ot"], "codigo": r["codigo"],
                "auto": False,
            })

        # Falla en turno
        tipo_ot_str = str(r.get("tipo_ot") or "").strip().upper()
        ft = str(r["falla_turno"]).strip() if r["falla_turno"] else ""
        if ft not in ("SI", "NO"):
            hallazgos.append({
                "equipo": eq, "turno_tag": tag, "archivo": r["archivo"],
                "tipo": "falla_formato", "prioridad": "alta",
                "detalle": f"Falla en turno = '{ft}' (debe ser SI o NO)",
                "campo": "falla_turno", "valor_actual": ft,
                "valor_sugerido": ft.upper() if ft.upper() in ("SI", "NO") else None,
                "ot": r["ot"], "codigo": r["codigo"],
                "auto": ft.upper() in ("SI", "NO"),
            })

        # Personas: solo alertar en trabajo real (NP, PL, BACKLOG), no en interferencias/traslados/esperas
        p = r["personas"]
        OT_TRABAJO_REAL = ("NP ", "MANTENCION", "BACKLOG", "EQAC")
        ot_trabajo = any(tipo_ot_str.startswith(k) for k in OT_TRABAJO_REAL)
        if p is not None and ot_trabajo:
            if not isinstance(p, (int, float)) or (isinstance(p, float) and p != int(p)) or p < 1:
                sugerido = "1" if p == 0 else ("2" if isinstance(p, float) and p < 1 and p > 0 else None)
                hallazgos.append({
                    "equipo": eq, "turno_tag": tag, "archivo": r["archivo"],
                    "tipo": "personas_invalido", "prioridad": "alta",
                    "detalle": f"Personas = {p} (debe ser entero >= 1)",
                    "campo": "personas", "valor_actual": str(p),
                    "valor_sugerido": sugerido, "ot": r["ot"], "codigo": r["codigo"],
                    "auto": bool(sugerido),
                })

        # Catálogo
        sis = str(r["sistema"]).strip().upper() if r["sistema"] else ""
        sub = str(r["subsistema"]).strip().upper() if r["subsistema"] else ""
        comp = str(r["componente"]).strip().upper() if r["componente"] else ""

        # Detectar hora colada en campo (00:00:00) → limpiar
        for campo_nombre, campo_val in [("subsistema", sub), ("componente", comp)]:
            if re.match(r'^\d{2}:\d{2}:\d{2}$', campo_val):
                hallazgos.append({
                    "equipo": eq, "turno_tag": tag, "archivo": r["archivo"],
                    "tipo": "campo_hora_basura", "prioridad": "alta",
                    "detalle": f"Campo {campo_nombre} contiene hora '{campo_val}' en vez de texto",
                    "campo": campo_nombre, "valor_actual": campo_val,
                    "valor_sugerido": "",
                    "ot": r["ot"], "codigo": r["codigo"],
                    "auto": True,
                })

        # Corregir PERCUCION → PERCUSION para validación
        TYPOS_SUB = {"PERCUCION": "PERCUSION"}
        if sub in TYPOS_SUB:
            hallazgos.append({
                "equipo": eq, "turno_tag": tag, "archivo": r["archivo"],
                "tipo": "typo_subsistema", "prioridad": "alta",
                "detalle": f"Subsistema '{sub}' → debería ser '{TYPOS_SUB[sub]}'",
                "campo": "subsistema", "valor_actual": sub,
                "valor_sugerido": TYPOS_SUB[sub], "ot": r["ot"], "codigo": r["codigo"],
                "auto": True,
            })
            sub = TYPOS_SUB[sub]

        es_interferencia = "INTERFERENCIA" in tipo_ot_str or "TRASLADO" in tipo_ot_str or "ESPERA" in tipo_ot_str or "LAVADO" in tipo_ot_str
        hora_basura = lambda v: bool(re.match(r'^\d{2}:\d{2}:\d{2}$', v))
        if not sis or not sub or not comp:
            if not (hora_basura(sub) or hora_basura(comp)):
                hallazgos.append({
                    "equipo": eq, "turno_tag": tag, "archivo": r["archivo"],
                    "tipo": "catalogo_incompleto", "prioridad": "alta",
                    "detalle": f"Tripleta incompleta: {sis}>{sub}>{comp}",
                    "campo": "sistema/subsistema/componente",
                    "valor_actual": f"{sis}|{sub}|{comp}",
                    "valor_sugerido": None, "ot": r["ot"], "codigo": r["codigo"],
                    "auto": False,
                })
        elif catalogo and not es_interferencia:
            sistemas = catalogo.get("SISTEMAS", set()) | catalogo.get("SISTEMAS_JR", set()) | set(k for k in catalogo.keys() if k != "SISTEMAS" and k != "SISTEMAS_JR")
            if sub and sis and not hora_basura(sub) and sub not in catalogo.get(sis, set()):
                hallazgos.append({
                    "equipo": eq, "turno_tag": tag, "archivo": r["archivo"],
                    "tipo": "catalogo_subsistema", "prioridad": "alta",
                    "detalle": f"Subsistema '{sub}' no pertenece a Sistema '{sis}'",
                    "campo": "subsistema", "valor_actual": sub,
                    "valor_sugerido": None, "ot": r["ot"], "codigo": r["codigo"],
                    "auto": False,
                })
            elif comp and sub and not hora_basura(comp) and comp not in catalogo.get(sub, set()):
                # Auto-fix: bajo PL_* el componente siempre es MECANICA
                es_pl_sub = sub.startswith("PL_") or sub.startswith("PAUTA_") or sub in ("BACKLOG", "MANTENCION_MAYOR")
                sugerido = "MECANICA" if es_pl_sub and comp != "MECANICA" else None
                hallazgos.append({
                    "equipo": eq, "turno_tag": tag, "archivo": r["archivo"],
                    "tipo": "catalogo_componente", "prioridad": "alta",
                    "detalle": f"Componente '{comp}' no pertenece a Subsistema '{sub}'",
                    "campo": "componente", "valor_actual": comp,
                    "valor_sugerido": sugerido, "ot": r["ot"], "codigo": r["codigo"],
                    "auto": bool(sugerido),
                })

        # Preventiva con falla SI
        if "PREVENTIVA" in tipo_ot_str and ft == "SI":
            hallazgos.append({
                "equipo": eq, "turno_tag": tag, "archivo": r["archivo"],
                "tipo": "preventiva_falla", "prioridad": "alta",
                "detalle": "Mantención preventiva marcada como falla SI",
                "campo": "falla_turno", "valor_actual": "SI",
                "valor_sugerido": "NO", "ot": r["ot"], "codigo": r["codigo"],
                "auto": False,
            })

        # Descripción dice PL pero tipo_ot dice NP (o viceversa)
        desc_txt = str(r.get("descripcion", "")).strip().upper() if r.get("descripcion") else ""
        desc_es_pl = any(k in desc_txt for k in ("PL DIARIA", "PAUTA DIARIA", "PL SEMANAL", "PAUTA SEMANAL", "PL 250", "PAUTA 250", "BACKLOG"))
        ot_es_np = tipo_ot_str.startswith("NP ")
        ot_es_pl = "PREVENTIVA" in tipo_ot_str or "BACKLOG" in tipo_ot_str
        if desc_es_pl and ot_es_np:
            hallazgos.append({
                "equipo": eq, "turno_tag": tag, "archivo": r["archivo"],
                "tipo": "ot_desc_inconsistente", "prioridad": "alta",
                "detalle": f"Descripción indica PL ('{desc_txt[:50]}') pero tipo OT es '{r['tipo_ot']}' (NP)",
                "campo": "tipo_ot",
                "valor_actual": str(r["tipo_ot"]),
                "valor_sugerido": "MANTENCION PREVENTIVA",
                "ot": r["ot"], "codigo": r["codigo"],
                "auto": True,
            })

        h_op = _hallazgo_espera_operador(r, eq, tag, tipo_ot_str, desc_txt)
        if h_op:
            hallazgos.append(h_op)

        # Equipo con espacio
        if eq and " " in str(eq).strip() and re.match(r'^[A-Z]+\s+\d', str(eq)):
            fix = re.sub(r'\s+', '', str(eq))
            hallazgos.append({
                "equipo": eq, "turno_tag": tag, "archivo": r["archivo"],
                "tipo": "equipo_espacio", "prioridad": "baja",
                "detalle": f"Equipo con espacio: '{eq}' → '{fix}'",
                "campo": "equipo", "valor_actual": eq,
                "valor_sugerido": fix, "ot": r["ot"], "codigo": r["codigo"],
                "auto": True,
            })

    # Utilidad: validar tripleta contra catálogo
    def validar_tripleta(sis, sub, comp, cat):
        """Retorna score: 3=perfecta, 2=par sis>sub ok, 1=incompleta, 0=inválida."""
        if not sis or not sub or not comp:
            return 1
        if sub not in cat.get(sis, set()):
            return 0
        if comp not in cat.get(sub, set()):
            return 2
        return 3

    def tripleta_de(r):
        return (
            str(r["sistema"]).strip().upper() if r["sistema"] else "",
            str(r["subsistema"]).strip().upper() if r["subsistema"] else "",
            str(r["componente"]).strip().upper() if r["componente"] else "",
        )

    def es_np(r):
        """True si el registro es trabajo no planificado (correctivo)."""
        ot = str(r.get("tipo_ot", "")).strip().upper()
        return ot.startswith("NP ") or ot in ("EQAC",)

    STOPWORDS = {"de", "del", "la", "el", "en", "a", "y", "o", "por", "con", "se", "no", "si", "las", "los", "un", "una"}

    DESC_GENERICAS = {"PL DIARIA", "PAUTA DIARIA", "PL SEMANAL", "PAUTA SEMANAL",
                       "PAUTA 250", "PAUTA 250 HRS", "PL 250", "BACKLOG"}

    def desc_similar(d1, d2, umbral=0.45):
        """True si las descripciones indican el mismo trabajo."""
        t1 = str(d1).strip().upper() if d1 else ""
        t2 = str(d2).strip().upper() if d2 else ""
        if not t1 or not t2:
            return False
        if t1 in DESC_GENERICAS or t2 in DESC_GENERICAS:
            return False
        w1 = {w for w in re.split(r'\W+', t1) if len(w) > 2 and w.lower() not in STOPWORDS}
        w2 = {w for w in re.split(r'\W+', t2) if len(w) > 2 and w.lower() not in STOPWORDS}
        if not w1 or not w2:
            return False
        overlap = len(w1 & w2) / min(len(w1), len(w2))
        if overlap >= umbral:
            return True
        return SequenceMatcher(None, t1, t2).ratio() >= umbral

    # Continuidad entre turnos + consistencia de clasificación
    turnos_ordenados = sorted(set(
        (r["fecha"].date(), r["turno"]) for r in regs_semana
        if isinstance(r["fecha"], dt.datetime)
    ), key=lambda x: (x[0], 0 if x[1] == "A" else 1))

    por_equipo_turno = defaultdict(lambda: defaultdict(list))
    for r in regs_semana:
        if isinstance(r["fecha"], dt.datetime):
            por_equipo_turno[r["equipo"]][(r["fecha"].date(), r["turno"])].append(r)

    estado_wa = leer_estado_whatsapp()
    archivo_turno = {(r["fecha"].date(), r["turno"]): r["archivo"] for r in regs_semana if isinstance(r["fecha"], dt.datetime)}
    hallazgos += hallazgos_sin_registro(por_equipo_turno, turnos_ordenados, archivo_turno, estado_wa)
    hallazgos += hallazgos_traspaso_fs(por_equipo_turno, turnos_ordenados, estado_wa)

    for eq, turnos in por_equipo_turno.items():
        keys = [k for k in turnos_ordenados if k in turnos]
        for i in range(len(keys) - 1):
            k1, k2 = keys[i], keys[i + 1]
            regs1, regs2 = turnos[k1], turnos[k2]
            ultimo = max(regs1, key=lambda r: r["aviso_termino"] if r["aviso_termino"] else dt.datetime.min)
            if not ultimo["aviso_termino"] or not isinstance(ultimo["aviso_termino"], dt.datetime):
                continue

            hora_fin = ultimo["aviso_termino"]
            limite = dt.datetime.combine(k1[0], dt.time(19, 0)) if k1[1] == "A" else dt.datetime.combine(k1[0] + dt.timedelta(days=1), dt.time(7, 0))
            equipo_cerro_en_falla = abs((hora_fin - limite).total_seconds()) < 3600
            if eq.startswith("JR") and k1 in estado_wa:
                equipo_cerro_en_falla = eq in estado_wa[k1]  # WhatsApp manda sobre el Excel

            if not equipo_cerro_en_falla:
                continue

            primero = min(regs2, key=lambda r: r["aviso_inicio"] if r["aviso_inicio"] else dt.datetime.max)
            tag2 = f"{k2[0].strftime('%d-%m')} T{k2[1]}"

            # Hueco de continuidad
            if primero["aviso_inicio"] and isinstance(primero["aviso_inicio"], dt.datetime):
                hueco_h = (primero["aviso_inicio"] - hora_fin).total_seconds() / 3600
                if hueco_h > TOLERANCIA_H and hueco_h <= MAX_HUECO_H:
                    hallazgos.append({
                        "equipo": eq, "turno_tag": tag2,
                        "archivo": primero["archivo"],
                        "tipo": "continuidad_hueco", "prioridad": "alta",
                        "detalle": f"Hueco de {hueco_h:.1f}h. {eq} cerró en falla {k1[0].strftime('%d-%m')}T{k1[1]} y no retoma hasta {primero['aviso_inicio'].strftime('%d-%m %H:%M')}",
                        "campo": "continuidad",
                        "valor_actual": f"hueco {hueco_h:.1f}h",
                        "valor_sugerido": None,
                        "ot": ultimo["ot"], "codigo": ultimo["codigo"],
                        "auto": False,
                    })

            # Consistencia de clasificación entre turnos consecutivos
            # El turno que cierra en falla define la clasificación correcta
            # El siguiente turno que retoma debe usar la misma
            trip_cierre = tripleta_de(ultimo)
            trip_apertura = tripleta_de(primero)

            if trip_cierre == trip_apertura:
                continue
            if not any(trip_cierre) or not any(trip_apertura):
                continue
            # Si sistema y subsistema coinciden, solo cambia componente → mismo trabajo, distinta pieza
            if trip_cierre[0] == trip_apertura[0] and trip_cierre[1] == trip_apertura[1]:
                continue

            # Solo alertar si ambos son NP (correctivos) Y descripciones indican mismo trabajo
            if not (es_np(ultimo) and es_np(primero)):
                continue
            if not desc_similar(ultimo.get("descripcion"), primero.get("descripcion")):
                continue

            # Determinar cuál es la correcta: validar ambas contra catálogo
            score_cierre = validar_tripleta(*trip_cierre, catalogo) if catalogo else 1
            score_apertura = validar_tripleta(*trip_apertura, catalogo) if catalogo else 1

            if score_cierre >= score_apertura:
                correcta, incorrecta = trip_cierre, trip_apertura
                motivo = "el turno anterior cerró con esta clasificación"
                archivo_err = primero["archivo"]
                if score_cierre > score_apertura and catalogo:
                    motivo += " y es válida en catálogo"
            else:
                correcta, incorrecta = trip_apertura, trip_cierre
                motivo = "válida en catálogo (el turno anterior tenía clasificación inválida)"
                archivo_err = ultimo["archivo"]

            hallazgos.append({
                "equipo": eq, "turno_tag": tag2,
                "archivo": archivo_err,
                "tipo": "continuidad_clasificacion", "prioridad": "alta",
                "detalle": f"Falla continúa entre {k1[0].strftime('%d-%m')}T{k1[1]}→{k2[0].strftime('%d-%m')}T{k2[1]} pero clasificación cambia: {incorrecta[0]}>{incorrecta[1]}>{incorrecta[2]} → debería ser {correcta[0]}>{correcta[1]}>{correcta[2]} ({motivo})",
                "campo": "sistema/subsistema/componente",
                "valor_actual": f"{incorrecta[0]}|{incorrecta[1]}|{incorrecta[2]}",
                "valor_sugerido": f"{correcta[0]}|{correcta[1]}|{correcta[2]}",
                "ot": ultimo["ot"], "codigo": ultimo["codigo"],
                "auto": False,
            })

    # Horas por equipo: no puede superar 168h/semana (7x24)
    MAX_HORAS_SEMANA = 168
    horas_por_equipo = defaultdict(float)
    for r in regs_semana:
        inicio = r["aviso_inicio"] or r["trabajo_inicio"]
        fin = r["aviso_termino"] or r["trabajo_termino"]
        if isinstance(inicio, dt.datetime) and isinstance(fin, dt.datetime) and fin > inicio:
            horas_por_equipo[r["equipo"]] += (fin - inicio).total_seconds() / 3600

    for eq, horas in horas_por_equipo.items():
        if horas > MAX_HORAS_SEMANA:
            hallazgos.append({
                "equipo": eq, "turno_tag": "semana",
                "archivo": "",
                "tipo": "horas_excedidas", "prioridad": "alta",
                "detalle": f"{eq} tiene {horas:.1f}h imputadas en la semana (máx {MAX_HORAS_SEMANA}h). Posible duplicación o solapamiento.",
                "campo": "horas", "valor_actual": f"{horas:.1f}h",
                "valor_sugerido": f"<= {MAX_HORAS_SEMANA}h",
                "ot": None, "codigo": None,
                "auto": False,
            })

    return hallazgos


CORREGIDOS_DIR = os.path.join(os.path.dirname(__file__), "Corregidos")

# Cada campo corregible se lee en una hoja BD derivada; su fórmula (=+Reporte!U720)
# indica la celda de entrada real en Reporte, que es donde se corrige.
CAMPO_A_BD = {
    "falla_turno": ("BD_Indisponibilidad", "G"),
    "tipo_ot": ("BD_Indisponibilidad", "I"),
    "sistema": ("BD_Indisponibilidad", "J"),
    "subsistema": ("BD_Ejecución", "P"),
    "componente": ("BD_Ejecución", "Q"),
    "personas": ("BD_Ejecución", "K"),
    "hora_aviso": ("BD_Indisponibilidad", "F"),
    "hora_entrega": ("BD_Indisponibilidad", "L"),
}
CAMPOS_NUMERICOS = {"personas", "hora_aviso", "hora_entrega"}
RE_REF_REPORTE = re.compile(r"Reporte!\$?([A-Z]+)\$?(\d+)")


def _fila_por_codigo(ws_valores):
    """codigo -> fila, usando la primera columna 'Codigo' de la hoja BD."""
    cab = [c.value for c in ws_valores[1]]
    col = cab.index("Codigo") + 1
    return {str(ws_valores.cell(r, col).value).strip(): r
            for r in range(2, ws_valores.max_row + 1) if ws_valores.cell(r, col).value}


def _celda_reporte(wb_valores, wb_formulas, hoja, col, codigo):
    """(ref en Reporte ej. 'U720', celda BD ej. 'BD_Ejecución!K469'), o (None, None)."""
    fila = _fila_por_codigo(wb_valores[hoja]).get(codigo)
    if fila is None:
        return None, None
    m = RE_REF_REPORTE.search(str(wb_formulas[hoja][f"{col}{fila}"].value))
    return (f"{m.group(1)}{m.group(2)}", f"{hoja}!{col}{fila}") if m else (None, None)


def _ruta_hoja(z, nombre):
    """Ruta interna (xl/worksheets/sheetN.xml) de la hoja con ese nombre."""
    wb_xml = z.read("xl/workbook.xml").decode("utf-8")
    rid = re.search(r'<sheet [^>]*name="%s"[^>]*r:id="([^"]+)"' % re.escape(nombre), wb_xml).group(1)
    rels = z.read("xl/_rels/workbook.xml.rels").decode("utf-8")
    destino = re.search(r'<Relationship [^>]*Id="%s"[^>]*Target="([^"]+)"' % rid, rels) \
        or re.search(r'<Relationship [^>]*Target="([^"]+)"[^>]*Id="%s"' % rid, rels)
    return "xl/" + destino.group(1).lstrip("/").replace("xl/", "")


def _reemplazar_celda(xml, ref, valor, numerico):
    """Reescribe <c r=ref> a nivel de texto (conserva espacios de nombres). None si no se puede."""
    m = re.search(r'<c r="%s"([^>]*?)(?:/>|>(.*?)</c>)' % ref, xml, re.S)
    if m is None or "<f" in (m.group(2) or ""):
        return None
    attrs = re.sub(r'\s+t="[^"]*"', "", m.group(1))
    if valor in ("", None):
        nuevo = f'<c r="{ref}"{attrs}/>'
    elif numerico:
        nuevo = f'<c r="{ref}"{attrs}><v>{valor}</v></c>'
    else:
        txt = str(valor).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        nuevo = f'<c r="{ref}"{attrs} t="inlineStr"><is><t>{txt}</t></is></c>'
    return xml[:m.start()] + nuevo + xml[m.end():]


def _forzar_recalculo(wb_xml):
    """Excel recalcula todo al abrir: así BD_* y BD_Diario_CMC reflejan Reporte."""
    if "fullCalcOnLoad" in wb_xml:
        return wb_xml
    if "<calcPr" in wb_xml:
        return wb_xml.replace("<calcPr", '<calcPr fullCalcOnLoad="1"', 1)
    return wb_xml.replace("</workbook>", '<calcPr fullCalcOnLoad="1"/></workbook>')


def _escribir_zip(dest, cambios):
    """Reemplaza en el zip los archivos de `cambios` {ruta: texto}."""
    tmp = dest + ".tmp"
    with zipfile.ZipFile(dest, "r") as zin, zipfile.ZipFile(tmp, "w") as zout:
        for item in zin.infolist():
            data = cambios[item.filename].encode("utf-8") if item.filename in cambios else zin.read(item.filename)
            zout.writestr(item, data)
    os.replace(tmp, dest)


def _aplicar_fixes(dest, fixes, nombre, excluir_bd=frozenset()):
    """Aplica los fixes sobre las celdas de entrada de Reporte. Devuelve (xml_reporte, ruta, log)."""
    wb_v = openpyxl.load_workbook(dest, data_only=True)
    wb_f = openpyxl.load_workbook(dest, keep_vba=True)
    with zipfile.ZipFile(dest) as z:
        ruta = _ruta_hoja(z, "Reporte")
        xml = z.read(ruta).decode("utf-8")
    log = []
    for fix in fixes:
        hoja, col = CAMPO_A_BD[fix["campo"]]
        ref, celda_bd = _celda_reporte(wb_v, wb_f, hoja, col, str(fix.get("codigo", "")).strip())
        if celda_bd in excluir_bd:
            continue  # la celda BD apuntaba a otra fila: el valor "inválido" era un error de referencia, no de dato
        actual = wb_f["Reporte"][ref].value if ref else None
        if ref is None or (actual in (None, "") and not fix["valor_sugerido"]):
            continue  # sin celda de entrada, o ya vacía (el 00:00:00 es solo una celda en blanco)
        nuevo = _reemplazar_celda(xml, ref, fix["valor_sugerido"], fix["campo"] in CAMPOS_NUMERICOS)
        if nuevo is None:
            continue
        xml = nuevo
        log.append({"archivo": nombre, "equipo": fix["equipo"], "campo": fix["campo"],
                    "codigo": fix["codigo"], "celda": f"Reporte!{ref}", "antes": fix["valor_actual"],
                    "despues": fix["valor_sugerido"], "tipo_hallazgo": fix["tipo"]})
    return xml, ruta, log


RE_REF_DIRECTA = re.compile(r"^=\+?Reporte!([A-Z]{1,2})(\d+)$")
COL_MAX_ENTRADA = 32  # AF: columnas de entrada de Reporte (CH y otras llevan otro desfase por diseño)


def _filas_referenciadas(ws_f, fila):
    """{celda: (col_reporte, fila_reporte)} de las fórmulas directas =+Reporte!X123 de la fila."""
    out = {}
    for cell in ws_f[fila]:
        m = RE_REF_DIRECTA.match(str(cell.value or ""))
        if m and openpyxl.utils.column_index_from_string(m.group(1)) <= COL_MAX_ENTRADA:
            out[cell.coordinate] = (m.group(1), int(m.group(2)))
    return out


def formulas_desfasadas(filepath):
    """Celdas de BD_* cuya fila de Reporte no coincide con la de sus columnas hermanas."""
    wb_f = openpyxl.load_workbook(filepath)
    wb_v = openpyxl.load_workbook(filepath, data_only=True)
    out = []
    for hoja in ("BD_Indisponibilidad", "BD_Ejecución"):
        ws_f = wb_f[hoja]
        col_eq = 5 if hoja == "BD_Indisponibilidad" else 4
        for fila in range(2, ws_f.max_row + 1):
            if wb_v[hoja].cell(fila, col_eq).value in (None, "", 0):
                continue  # filas sin registro: el desfase ahí no afecta datos
            refs = _filas_referenciadas(ws_f, fila)
            filas = [r for _, r in refs.values()]
            if len(set(filas)) < 2:
                continue
            moda = max(set(filas), key=filas.count)
            if filas.count(moda) <= len(filas) // 2:
                continue
            for celda, (col, r) in refs.items():
                if r != moda:
                    out.append((hoja, celda, f"{col}{r}", f"{col}{moda}", wb_v[hoja].cell(fila, col_eq).value))
    return out


def hallazgos_formulas(archivos):
    """Hallazgos auto-corregibles por fórmulas de BD_* que apuntan a otra fila de Reporte."""
    out = []
    for fp in archivos:
        nombre = os.path.basename(fp)
        fecha, turno = parsear_fecha_archivo(nombre)
        for hoja, celda, actual, correcta, eq in formulas_desfasadas(fp):
            out.append({
                "equipo": eq, "turno_tag": f"{fecha.strftime('%d-%m')} T{turno}" if fecha else "", "archivo": nombre,
                "tipo": "formula_fila_desfasada", "prioridad": "alta",
                "detalle": f"{hoja}!{celda} apunta a Reporte!{actual} y debería apuntar a Reporte!{correcta}",
                "campo": f"formula:{hoja}!{celda}", "valor_actual": actual, "valor_sugerido": correcta,
                "ot": None, "codigo": None, "auto": True,
            })
    return out


def _aplicar_formulas(dest, fixes, nombre):
    """Corrige el texto de las fórmulas desfasadas. Devuelve ({ruta: xml}, log)."""
    cambios, log = {}, []
    with zipfile.ZipFile(dest) as z:
        for fix in fixes:
            hoja, celda = fix["campo"][len("formula:"):].split("!")
            ruta = _ruta_hoja(z, hoja)
            xml = cambios.get(ruta) or z.read(ruta).decode("utf-8")
            viejo = re.compile(r'(<c r="%s"[^>]*><f>\+?Reporte!)%s(</f>)' % (celda, fix["valor_actual"]))
            nuevo, n = viejo.subn(lambda m: m.group(1) + fix["valor_sugerido"] + m.group(2), xml)
            if n:
                cambios[ruta] = nuevo
                log.append({"archivo": nombre, "equipo": fix["equipo"], "campo": fix["campo"], "codigo": None,
                            "celda": f"{hoja}!{celda}", "antes": fix["valor_actual"],
                            "despues": fix["valor_sugerido"], "tipo_hallazgo": fix["tipo"]})
    return cambios, log


def corregir_archivo(filepath, hallazgos_archivo, semana, registros):
    """Copia el .xlsm y corrige las celdas de entrada en Reporte (nunca toca el original).
    Las hojas BD_* y BD_Diario_CMC se regeneran solas al recalcular en Excel."""
    nombre = os.path.basename(filepath)
    dest_dir = os.path.join(CORREGIDOS_DIR, f"S{semana}")
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, nombre)
    shutil.copy2(filepath, dest)

    validos = [h for h in hallazgos_archivo if h.get("auto") and h.get("valor_sugerido") is not None]
    fixes = [h for h in validos if h.get("campo") in CAMPO_A_BD]
    fx_formulas = [h for h in validos if str(h.get("campo", "")).startswith("formula:")]
    cambios, log = {}, []
    celdas_defectuosas = {f"{f['campo'][8:]}" for f in fx_formulas}
    if fixes:
        xml, ruta, log = _aplicar_fixes(dest, fixes, nombre, celdas_defectuosas)
        if log:
            cambios[ruta] = xml
    if fx_formulas:
        cam_f, log_f = _aplicar_formulas(dest, fx_formulas, nombre)
        cambios.update(cam_f)
        log += log_f
    if cambios:
        with zipfile.ZipFile(dest) as z:
            cambios["xl/workbook.xml"] = _forzar_recalculo(z.read("xl/workbook.xml").decode("utf-8"))
        _escribir_zip(dest, cambios)
    return dest, log


def init_db():
    """Crea tablas SQLite si no existen."""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.executescript("""
        CREATE TABLE IF NOT EXISTS semanas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            semana INTEGER NOT NULL,
            year INTEGER NOT NULL,
            fecha_inicio TEXT, fecha_fin TEXT,
            fecha_proceso TEXT,
            total_registros INTEGER,
            total_hallazgos INTEGER,
            alta INTEGER, media INTEGER, baja INTEGER,
            UNIQUE(semana, year)
        );
        CREATE TABLE IF NOT EXISTS registros (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            semana_id INTEGER REFERENCES semanas(id),
            archivo TEXT, carpeta TEXT, fecha TEXT, turno TEXT,
            supervisor TEXT, equipo TEXT, codigo TEXT,
            tipo_ot TEXT, falla_turno TEXT, ubicacion TEXT,
            sistema TEXT, subsistema TEXT, componente TEXT,
            descripcion TEXT, ot TEXT, personas REAL
        );
        CREATE TABLE IF NOT EXISTS hallazgos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            semana_id INTEGER REFERENCES semanas(id),
            equipo TEXT, turno_tag TEXT, archivo TEXT,
            tipo TEXT, prioridad TEXT, detalle TEXT,
            campo TEXT, valor_actual TEXT, valor_sugerido TEXT,
            ot TEXT, codigo TEXT,
            auto INTEGER DEFAULT 0,
            estado TEXT DEFAULT 'pendiente',
            fecha_correccion TEXT
        );
        CREATE TABLE IF NOT EXISTS correcciones_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            hallazgo_id INTEGER REFERENCES hallazgos(id),
            archivo_original TEXT, archivo_corregido TEXT,
            campo TEXT, valor_antes TEXT, valor_despues TEXT,
            fecha TEXT, tipo TEXT
        );
    """)
    conn.commit()
    return conn


def guardar_resultados(conn, semana, year, inicio, fin, registros, hallazgos):
    """Guarda registros y hallazgos en SQLite."""
    c = conn.cursor()
    c.execute("DELETE FROM hallazgos WHERE semana_id IN (SELECT id FROM semanas WHERE semana=? AND year=?)", (semana, year))
    c.execute("DELETE FROM registros WHERE semana_id IN (SELECT id FROM semanas WHERE semana=? AND year=?)", (semana, year))
    c.execute("DELETE FROM semanas WHERE semana=? AND year=?", (semana, year))

    alta = sum(1 for h in hallazgos if h["prioridad"] == "alta")
    media = sum(1 for h in hallazgos if h["prioridad"] == "media")
    baja = sum(1 for h in hallazgos if h["prioridad"] == "baja")

    c.execute("""INSERT INTO semanas (semana, year, fecha_inicio, fecha_fin, fecha_proceso,
                 total_registros, total_hallazgos, alta, media, baja)
                 VALUES (?,?,?,?,?,?,?,?,?,?)""",
              (semana, year, str(inicio), str(fin), dt.datetime.now().isoformat(),
               len(registros), len(hallazgos), alta, media, baja))
    sem_id = c.lastrowid

    def safe(v):
        if isinstance(v, (dt.datetime, dt.date, dt.time)):
            return str(v)
        return v

    for r in registros:
        fecha_str = r["fecha"].isoformat() if isinstance(r["fecha"], dt.datetime) else str(r["fecha"])
        c.execute("""INSERT INTO registros (semana_id, archivo, carpeta, fecha, turno,
                     supervisor, equipo, codigo, tipo_ot, falla_turno, ubicacion,
                     sistema, subsistema, componente, descripcion, ot, personas)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                  (sem_id, r["archivo"], r.get("carpeta", ""), fecha_str, safe(r["turno"]),
                   safe(r["supervisor"]), safe(r["equipo"]), safe(r["codigo"]), safe(r["tipo_ot"]),
                   safe(r["falla_turno"]), safe(r["ubicacion"]), safe(r["sistema"]), safe(r["subsistema"]),
                   safe(r["componente"]), safe(r["descripcion"]), str(r["ot"]) if r["ot"] else "",
                   r["personas"]))

    for h in hallazgos:
        c.execute("""INSERT INTO hallazgos (semana_id, equipo, turno_tag, archivo,
                     tipo, prioridad, detalle, campo, valor_actual, valor_sugerido,
                     ot, codigo, auto)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                  (sem_id, h["equipo"], h["turno_tag"], h["archivo"],
                   h["tipo"], h["prioridad"], h["detalle"], h["campo"],
                   h["valor_actual"], h["valor_sugerido"],
                   str(h["ot"]) if h["ot"] else "", h["codigo"],
                   1 if h.get("auto") else 0))

    conn.commit()
    return sem_id


def main():
    parser = argparse.ArgumentParser(description="Control Semanal Turno a Turno")
    parser.add_argument("--semana", type=int, required=True)
    parser.add_argument("--year", type=int, default=2026)
    parser.add_argument("--dry", action="store_true")
    args = parser.parse_args()

    inicio, fin = semana_rango(args.semana, args.year)
    print(f"Semana {args.semana}: {inicio} al {fin}")

    archivos = buscar_archivos(args.year, inicio.month)
    if fin.month != inicio.month:
        archivos += buscar_archivos(args.year, fin.month)

    print(f"Archivos encontrados: {len(archivos)}")

    # Filtrar por rango de la semana
    archivos_semana = []
    for f in archivos:
        fecha, turno = parsear_fecha_archivo(os.path.basename(f))
        if fecha and inicio <= fecha <= fin:
            archivos_semana.append(f)

    print(f"Archivos de la semana: {len(archivos_semana)}")

    # Hidratar archivos cloud-only de OneDrive
    archivos_semana = hidratar_archivos(archivos_semana)
    print(f"Archivos disponibles: {len(archivos_semana)}")

    todos_registros = []
    catalogo_global = leer_catalogo_tsv()
    for filepath in archivos_semana:
        nombre = os.path.basename(filepath)
        try:
            regs, sup, cat = consolidar_archivo(filepath)
            print(f"  {nombre}: {len(regs)} registros")
            todos_registros.extend(regs)
            if cat and not catalogo_global:
                catalogo_global.update(cat)
        except Exception as e:
            print(f"  {nombre}: ERROR - {e}")

    print(f"\nTotal registros: {len(todos_registros)}")

    hallazgos = analizar_registros(todos_registros, catalogo_global, inicio, fin)
    hallazgos += hallazgos_formulas(archivos_semana)

    alta = sum(1 for h in hallazgos if h["prioridad"] == "alta")
    media = sum(1 for h in hallazgos if h["prioridad"] == "media")
    baja = sum(1 for h in hallazgos if h["prioridad"] == "baja")
    auto = sum(1 for h in hallazgos if h.get("auto"))

    print(f"\nHallazgos: {len(hallazgos)} (Alta: {alta}, Media: {media}, Baja: {baja})")
    print(f"Autocorregibles: {auto}")

    tipos = defaultdict(int)
    for h in hallazgos:
        tipos[h["tipo"]] += 1
    for t, n in sorted(tipos.items(), key=lambda x: -x[1]):
        print(f"  {t}: {n}")

    if args.dry:
        print("\n--dry: no se guardó nada")
        return

    conn = init_db()
    sem_id = guardar_resultados(conn, args.semana, args.year, inicio, fin, todos_registros, hallazgos)
    print(f"\nGuardado en SQLite (semana_id={sem_id})")

    # Corrección automática: copiar archivos y aplicar fixes por XML
    hallazgos_por_archivo = defaultdict(list)
    for h in hallazgos:
        if h["archivo"]:
            hallazgos_por_archivo[h["archivo"]].append(h)

    total_fixes = 0
    con_datos = {r["archivo"] for r in todos_registros}
    for filepath in archivos_semana:
        nombre = os.path.basename(filepath)
        if nombre not in con_datos:
            continue  # plantilla vacía (macros sin correr): se usa su versión Editable
        h_archivo = hallazgos_por_archivo.get(nombre, [])
        try:
            dest, log_entries = corregir_archivo(filepath, h_archivo, args.semana, todos_registros)
            conn.execute("DELETE FROM correcciones_log WHERE archivo_original=?", (nombre,))
            if not log_entries:
                print(f"\n= {nombre}: sin correcciones, copia limpia → {os.path.basename(dest)}")
            else:
                total_fixes += len(log_entries)
                print(f"\n✓ {nombre}: {len(log_entries)} correcciones aplicadas → {os.path.basename(dest)}")
                for entry in log_entries:
                    print(f"  {entry['equipo']} [{entry['campo']}]: '{entry['antes']}' → '{entry['despues']}'")
                    conn.execute(
                        "INSERT INTO correcciones_log (archivo_original, archivo_corregido, campo, valor_antes, valor_despues, fecha, tipo) VALUES (?,?,?,?,?,?,?)",
                        (nombre, dest, entry["campo"], entry["antes"], entry["despues"], dt.datetime.now().isoformat(), entry["tipo_hallazgo"])
                    )
                conn.commit()
        except Exception as e:
            print(f"\n✗ {nombre}: error al corregir - {e}")

    if total_fixes:
        print(f"\nTotal correcciones automáticas: {total_fixes}")
        print(f"Copias en: {os.path.join(CORREGIDOS_DIR, f'S{args.semana}')}")
    else:
        print("\nSin correcciones automáticas aplicables")

    conn.close()


if __name__ == "__main__":
    main()
