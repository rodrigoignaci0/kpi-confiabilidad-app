#!/usr/bin/env python3
"""Parse Power BI DSR capture JSONs into clean output files."""
import json
import glob
import os
from datetime import datetime, timezone

DATA_DIR = os.path.join(os.path.dirname(__file__), 'powerbi_data')


def find_latest_capture():
    files = sorted(glob.glob(os.path.join(DATA_DIR, 'capture_*.json')))
    if not files:
        raise FileNotFoundError('No capture_*.json found in powerbi_data/')
    return files[-1]


def get_query_rows(page_data, query_idx):
    """Return (rows, value_dicts, descriptor_select) for a query endpoint."""
    q = page_data[query_idx]
    result = q['data']['results'][0]['result']['data']
    dsr = result['dsr']
    ds = dsr['DS'][0]
    ph0 = ds['PH'][0]
    dm_key = list(ph0.keys())[0]
    rows = ph0[dm_key]
    value_dicts = ds.get('ValueDicts', {})
    select = result['descriptor']['Select']
    return rows, value_dicts, select


def decode_dsr_rows(rows, value_dicts, select):
    """Decode flat DSR rows (C/S/R format) into list of dicts."""
    # Build schema map: col_name -> {dn: dict_name, is_datetime: bool}
    schema_map = {}
    for s in select:
        schema_map[s['Value']] = s

    col_names = [s['Value'] for s in select]
    n_cols = len(col_names)
    prev = [None] * n_cols
    # schema carries over too
    col_schema = [None] * n_cols  # DN per column

    decoded = []
    for row in rows:
        # Update schema if present
        if 'S' in row:
            for i, s_entry in enumerate(row['S']):
                col_schema[i] = s_entry.get('DN')

        # Apply repeat bitmask
        r_mask = row.get('R', 0)
        c_values = row.get('C', [])
        c_iter = iter(c_values)

        current = list(prev)
        for i in range(n_cols):
            if r_mask & (1 << i):
                pass  # keep prev[i]
            else:
                try:
                    current[i] = next(c_iter)
                except StopIteration:
                    current[i] = None

        prev = list(current)

        record = {}
        for i, col in enumerate(col_names):
            val = current[i]
            dn = col_schema[i]
            s_info = schema_map.get(col, {})
            t_type = None
            # Find T from the S array in this row or use 0
            if 'S' in row and i < len(row['S']):
                t_type = row['S'][i].get('T')

            if dn and isinstance(val, int) and dn in value_dicts:
                val = value_dicts[dn][val]
            elif t_type == 7 and isinstance(val, (int, float)):
                # milliseconds since epoch
                dt = datetime.fromtimestamp(val / 1000, tz=timezone.utc)
                val = dt.strftime('%Y-%m-%d %H:%M')
            elif isinstance(val, int) and s_info.get('Format') == 'G' and abs(val) > 1e10:
                # likely a datetime ms value based on magnitude
                dt = datetime.fromtimestamp(val / 1000, tz=timezone.utc)
                val = dt.strftime('%Y-%m-%d %H:%M')

            record[col] = val
        decoded.append(record)

    return decoded


def find_query_by_rows(page_data, target_rows):
    """Find query index with approximately target_rows rows."""
    for i, q in enumerate(page_data):
        try:
            r = q['data']['results'][0]['result']['data']
            ds = r['dsr']['DS'][0]
            ph0 = ds['PH'][0]
            dk = list(ph0.keys())[0]
            rows = ph0[dk]
            if len(rows) >= target_rows:
                return i
        except (KeyError, IndexError, TypeError):
            pass
    return None


def parse_inicio(page_data):
    """Parse Inicio page — finds the ~500-row equipment status query."""
    idx = find_query_by_rows(page_data, 400)
    if idx is None:
        raise ValueError('No se encontró query de 500 rows en Inicio')
    rows, vd, select = get_query_rows(page_data, idx)

    # Use S from first row for physical column order
    if not rows or 'S' not in rows[0]:
        return {'equipos_total': 0, 'operativos': 0, 'fuera_servicio': 0, 'registros': []}

    s_schema = rows[0]['S']
    n_cols = len(s_schema)
    col_dn = [s.get('DN') for s in s_schema]
    col_t = [s.get('T') for s in s_schema]
    col_n = [s.get('N') for s in s_schema]

    # Map S column index to field name using Select names
    field_map = {}
    sel_by_val = {s['Value']: s.get('Name', '') for s in select}
    for i, n in enumerate(col_n):
        name = sel_by_val.get(n, '')
        if '.ID' in name and 'Registro' not in name and 'lookupValue' not in name:
            field_map[i] = 'id'
        elif '.Estado' in name:
            field_map[i] = 'estado'
        elif '.Fecha' in name:
            field_map[i] = 'fecha'
        elif '.Actividad' in name:
            field_map[i] = 'actividad'
        elif '.Ubicacion' in name:
            field_map[i] = 'ubicacion'
        elif 'Observ' in name:
            field_map[i] = 'observacion'
        elif 'lookupValue' in name:
            field_map[i] = 'equipo'
        elif 'O.T' in name:
            field_map[i] = 'ot'
        elif 'Horometro' in name:
            field_map[i] = 'horometro'
        elif 'Comentario' in name:
            field_map[i] = 'comentario'

    prev = [None] * n_cols
    registros = []

    for row in rows:
        r_mask = row.get('R', 0)
        c_values = row.get('C', [])
        c_iter = iter(c_values)

        current = list(prev)
        for i in range(n_cols):
            if r_mask & (1 << i):
                pass
            else:
                try:
                    current[i] = next(c_iter)
                except StopIteration:
                    current[i] = None

        prev = list(current)

        def resolve(idx):
            val = current[idx]
            dn = col_dn[idx]
            t = col_t[idx]
            if dn and isinstance(val, int) and dn in vd:
                return vd[dn][val]
            if t == 7 and isinstance(val, (int, float)):
                dt = datetime.fromtimestamp(val / 1000, tz=timezone.utc)
                return dt.strftime('%Y-%m-%d %H:%M')
            return val

        vals = {}
        for i in range(n_cols):
            key = field_map.get(i)
            if key:
                vals[key] = resolve(i)

        registros.append({
            'id': vals.get('id'),
            'estado': vals.get('estado'),
            'fecha': vals.get('fecha'),
            'actividad': vals.get('actividad'),
            'ubicacion': vals.get('ubicacion'),
            'observacion': vals.get('observacion'),
            'equipo': vals.get('equipo'),
            'ot': vals.get('ot') or '',
            'horometro': str(vals.get('horometro')) if vals.get('horometro') is not None else '',
            'comentario': vals.get('comentario') or '',
        })

    total = len(registros)
    fs = sum(1 for r in registros if r['estado'] == 'Fuera de servicio')
    op = sum(1 for r in registros if r['estado'] == 'Operativo')

    return {
        'equipos_total': total,
        'operativos': op,
        'fuera_servicio': fs,
        'registros': registros,
    }


def parse_disponibilidad(page_data):
    """Parse Disponibilidad page queries q0,q1,q3,q4,q5,q8 (indices 10-18)."""

    def scalar(idx, col):
        rows, _, _ = get_query_rows(page_data, idx)
        if not rows:
            return None
        row = rows[0]
        return row.get(col)

    def list_rows(idx):
        rows, vd, select = get_query_rows(page_data, idx)
        return decode_dsr_rows(rows, vd, select)

    # q0 index 10: Equipos F/S (scalar M0)
    q0_rows, _, _ = get_query_rows(page_data, 10)
    equipos_fs = q0_rows[0].get('M0') if q0_rows else None

    # q1 index 11: Disponibilidad diaria (7 rows)
    q1_rows, _, q1_sel = get_query_rows(page_data, 11)
    disp_diaria = []
    for row in q1_rows:
        c = row.get('C', [])
        fecha_ms = c[0] if len(c) > 0 else row.get('G0')
        disp_val = c[1] if len(c) > 1 else row.get('M0')
        if isinstance(fecha_ms, (int, float)):
            dt = datetime.fromtimestamp(fecha_ms / 1000, tz=timezone.utc)
            fecha_str = dt.strftime('%Y-%m-%d')
        else:
            fecha_str = str(fecha_ms)
        disp_diaria.append({'fecha': fecha_str, 'disponibilidad': disp_val})

    # q3 index 13: Total equipos
    q3_rows, _, _ = get_query_rows(page_data, 13)
    total_equipos = q3_rows[0].get('M0') if q3_rows else None

    # q4 index 14: Semanas (40 rows)
    q4_rows, _, _ = get_query_rows(page_data, 14)
    prev_g0 = None
    semanas = []
    for row in q4_rows:
        g0 = row.get('G0', prev_g0)
        if g0 is None and 'C' in row:
            g0 = row['C'][0] if row['C'] else None
        semanas.append(g0)
        prev_g0 = g0

    # q5 index 15: Equipos operativos
    q5_rows, _, _ = get_query_rows(page_data, 15)
    equipos_op = q5_rows[0].get('M0') if q5_rows else None

    # q8 index 18: Disponibilidad semanal
    q8_rows, _, _ = get_query_rows(page_data, 18)
    disp_semanal = q8_rows[0].get('M0') if q8_rows else None

    return {
        'equipos_fs': equipos_fs,
        'equipos_operativos': equipos_op,
        'total_equipos': total_equipos,
        'disponibilidad_semanal': disp_semanal,
        'disponibilidad_diaria': disp_diaria,
        'semanas': semanas,
    }


def parse_hhah(page_data):
    """Parse HHaH page — find query with X cells (hora a hora grid)."""
    # Find the query that has X (matrix) cells
    idx = None
    for i, q in enumerate(page_data):
        try:
            r = q['data']['results'][0]['result']['data']
            ds = r['dsr']['DS'][0]
            ph0 = ds['PH'][0]
            dk = list(ph0.keys())[0]
            rows = ph0[dk]
            if rows and 'X' in rows[0]:
                idx = i
                break
        except (KeyError, IndexError, TypeError):
            pass

    if idx is None:
        return {'horas': [], 'equipos': []}

    q = page_data[idx]
    result = q['data']['results'][0]['result']['data']
    dsr = result['dsr']
    ds = dsr['DS'][0]
    ph0 = ds['PH'][0]
    dm_key = list(ph0.keys())[0]
    rows = ph0[dm_key]
    vd = ds.get('ValueDicts', {})

    horas_dict = vd.get('D0', [])
    estados_dict = vd.get('D1', [])

    grid = []
    prev_g0 = None
    prev_m0_idx = 0  # default Op

    for row in rows:
        g0 = row.get('G0', prev_g0)
        prev_g0 = g0

        x_cells = row.get('X', [])
        prev_cell_val = prev_m0_idx
        horas_row = []

        for cell in x_cells:
            r_mask = cell.get('R', 0)
            if r_mask & 1:
                m0_idx = prev_cell_val
            else:
                m0_idx = cell.get('M0', prev_cell_val)
            prev_cell_val = m0_idx

            if isinstance(m0_idx, int) and m0_idx < len(estados_dict):
                estado = estados_dict[m0_idx]
            else:
                estado = 'Op'
            horas_row.append(estado)

        grid.append({'equipo': g0, 'estados': horas_row})

    return {
        'horas': horas_dict,
        'equipos': grid,
    }


def parse_actividades(page_data):
    """Parse Actividades page query index 14 (1000-row activity table).

    S order: G0=Empresa(D0), G1=ID(int), G2=ID_Registro(D1),
    M0=Empresa(D2), M1=Actividad(D3=NP/PL), M2=Equipo(D4),
    M3=HoraEjec(float), M4=Fin(ts), M5=Inicio(ts), M6=Sistema(D5)
    """
    idx = find_query_by_rows(page_data, 800)
    if idx is None:
        return {'registros': [], 'total': 0}
    rows, vd, _ = get_query_rows(page_data, idx)

    # Use S from first row for physical column order
    if not rows or 'S' not in rows[0]:
        return {'registros': [], 'total': 0}

    s_schema = rows[0]['S']
    n_cols = len(s_schema)
    col_dn = [s.get('DN') for s in s_schema]
    col_t = [s.get('T') for s in s_schema]
    col_n = [s.get('N') for s in s_schema]

    prev = [None] * n_cols
    registros = []

    for row in rows:
        r_mask = row.get('R', 0)
        c_values = row.get('C', [])
        c_iter = iter(c_values)

        current = list(prev)
        for i in range(n_cols):
            if r_mask & (1 << i):
                pass
            else:
                try:
                    current[i] = next(c_iter)
                except StopIteration:
                    current[i] = None
        prev = list(current)

        def resolve(idx):
            val = current[idx]
            dn = col_dn[idx]
            t = col_t[idx]
            if dn and isinstance(val, int) and dn in vd:
                return vd[dn][val]
            if t == 7 and isinstance(val, (int, float)):
                dt = datetime.fromtimestamp(val / 1000, tz=timezone.utc)
                return dt.strftime('%Y-%m-%d %H:%M')
            return val

        # Map by S column name
        vals = {col_n[i]: resolve(i) for i in range(n_cols)}

        inicio = vals.get('M5', '')
        semana = None
        if isinstance(inicio, str) and len(inicio) >= 10:
            try:
                dt = datetime.strptime(inicio[:10], '%Y-%m-%d')
                semana = dt.isocalendar()[1]
            except ValueError:
                pass

        registros.append({
            'equipo': vals.get('M2', ''),
            'empresa': vals.get('G0', '') or vals.get('M0', ''),
            'actividad': vals.get('M1', ''),
            'sistema': vals.get('M6', ''),
            'horas_ejecucion': vals.get('M3'),
            'inicio': inicio,
            'fin': vals.get('M4', ''),
            'id_registro': vals.get('G2', ''),
            'semana': semana,
            'observacion': vals.get('M6', '') or '',
        })

    return {'registros': registros, 'total': len(registros)}


def main():
    capture_file = find_latest_capture()
    print(f'Parsing: {capture_file}')

    with open(capture_file) as f:
        data = json.load(f)

    ts_raw = data.get('timestamp', '')
    # ts_raw format: 20260929_125336
    try:
        ts = datetime.strptime(ts_raw, '%Y%m%d_%H%M%S').isoformat()
    except ValueError:
        ts = ts_raw

    pages = data['data']

    # ── estado_equipos.json ──
    inicio = parse_inicio(pages['Inicio'])
    estado_out = {
        'timestamp': ts,
        'equipos_total': inicio['equipos_total'],
        'operativos': inicio['operativos'],
        'fuera_servicio': inicio['fuera_servicio'],
        'registros': inicio['registros'],
    }
    out_path = os.path.join(DATA_DIR, 'estado_equipos.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(estado_out, f, ensure_ascii=False, indent=2)
    print(f'Wrote {out_path} ({len(inicio["registros"])} rows)')

    # ── disponibilidad.json ──
    disp = parse_disponibilidad(pages['Disponibilidad'])
    disp['timestamp'] = ts
    out_path2 = os.path.join(DATA_DIR, 'disponibilidad.json')
    with open(out_path2, 'w', encoding='utf-8') as f:
        json.dump(disp, f, ensure_ascii=False, indent=2)
    print(f'Wrote {out_path2}')

    # ── hora_hora.json ──
    hhah = parse_hhah(pages['HHaH'])
    hhah['timestamp'] = ts
    out_path3 = os.path.join(DATA_DIR, 'hora_hora.json')
    with open(out_path3, 'w', encoding='utf-8') as f:
        json.dump(hhah, f, ensure_ascii=False, indent=2)
    print(f'Wrote {out_path3} ({len(hhah["equipos"])} equipos)')

    # ── actividades.json ──
    if 'Actividades' in pages:
        act = parse_actividades(pages['Actividades'])
        act['timestamp'] = ts
        out_path4 = os.path.join(DATA_DIR, 'actividades.json')
        with open(out_path4, 'w', encoding='utf-8') as f:
            json.dump(act, f, ensure_ascii=False, indent=2)
        print(f'Wrote {out_path4} ({act["total"]} actividades)')
    else:
        print('Página Actividades no encontrada en captura')


if __name__ == '__main__':
    main()
