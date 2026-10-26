// Global data holder
window.DB_DATA = {
  db: null,
  loaded: false,
  detenciones: [],
  equipos: [],
  columnas: []
};

async function procesarBD(arrayBuffer) {
  try {
    console.log('Iniciando sql.js...');
    const SQL = await initSqlJs({
      locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
    });
    console.log('sql.js cargado:', SQL);

    const db = new SQL.Database(new Uint8Array(arrayBuffer));
    console.log('BD inicializada');

    // Leer tabla detenciones
    const result = db.exec("SELECT * FROM detenciones LIMIT 100000");
    console.log('Resultado query:', result.length, 'filas');
    if (result.length === 0) throw new Error('Tabla detenciones vacía');

    const columns = result[0].columns;
    const values = result[0].values.map(row => {
      const obj = {};
      columns.forEach((col, i) => { obj[col] = row[i]; });
      return obj;
    });

    // Guardar en global
    window.DB_DATA.db = db;
    window.DB_DATA.loaded = true;
    window.DB_DATA.detenciones = values;
    window.DB_DATA.columnas = columns;

    // Extraer equipos únicos
    const equipos = [...new Set(values.map(d => d.equipo))].filter(Boolean).sort();
    window.DB_DATA.equipos = equipos;

    // Mostrar info
    mostrarStatusBD(
      `✓ Cargado: <strong>${values.length}</strong> registros | <strong>${equipos.length}</strong> equipos`,
      'success'
    );

    // Mostrar detalles
    document.getElementById('dbLoadedInfo').style.display = 'block';
    document.getElementById('dbLoadedDetail').innerHTML = `
      Registros: ${values.length.toLocaleString()}<br/>
      Equipos: ${equipos.join(', ').substring(0, 80)}...
    `;

    // Re-renderizar detenciones dinámico si está visible
    if (document.getElementById('tab-detenciones').style.display !== 'none') {
      renderDetencionesDinamico();
    }

    return true;
  } catch (error) {
    mostrarStatusBD(`Error: ${error.message}`, 'danger');
    console.error(error);
    return false;
  }
}

async function cargarBDAutomatico() {
  try {
    mostrarStatusBD('Cargando BD automáticamente...', 'info');
    const ruta = '../Mantenimiento/TABLA_MAESTRA_MANTENIBILIDAD_EQUIPOS_MOVILES_66.db';
    const response = await fetch(ruta);

    if (!response.ok) throw new Error(`No se encontró: ${ruta}`);

    const arrayBuffer = await response.arrayBuffer();
    await procesarBD(arrayBuffer);
  } catch (error) {
    console.log('Auto-carga falló, mostrando formulario manual');
    document.getElementById('dbManualLoadSection').style.display = 'block';
    document.getElementById('dbFileInput').style.display = 'block';
    document.getElementById('cargarBDBtn').style.display = 'block';
    mostrarStatusBD('⚠️ Auto-carga falló. Selecciona el archivo manualmente.', 'info');
  }
}

async function cargarBD() {
  try {
    const file = document.getElementById('dbFileInput').files[0];
    if (!file) {
      mostrarStatusBD('Selecciona un archivo .db primero', 'danger');
      return;
    }

    mostrarStatusBD('Cargando BD... esto puede tomar unos segundos', 'info');
    const arrayBuffer = await file.arrayBuffer();
    await procesarBD(arrayBuffer);
  } catch (error) {
    mostrarStatusBD(`Error: ${error.message}`, 'danger');
    console.error(error);
  }
}

function mostrarStatusBD(mensaje, tipo) {
  const statusDiv = document.getElementById('dbLoadStatus');
  const statusText = document.getElementById('dbLoadStatusText');
  statusText.innerHTML = mensaje;
  statusDiv.style.display = 'block';
  statusDiv.style.background = tipo === 'success' ? '#dcfce7' : tipo === 'info' ? '#dbeafe' : '#fee2e2';
  statusDiv.style.color = tipo === 'success' ? '#166534' : tipo === 'info' ? '#1e40af' : '#991b1b';
  statusDiv.style.border = `1px solid ${tipo === 'success' ? '#bbf7d0' : tipo === 'info' ? '#bfdbfe' : '#fecaca'}`;
}

// Auto-cargar al inicializar
window.addEventListener('DOMContentLoaded', cargarBDAutomatico);
