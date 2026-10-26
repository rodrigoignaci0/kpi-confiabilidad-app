var CFG = (function() {
  var DEFAULTS = {
    contrato: 'Contrato CMC',
    empresa_contratista: '',
    empresa_mandante: 'Codelco',
    metas: {1:90, 2:95, 3:95, 4:15, 5:80, 6:85}
  };

  return {
    get: function() {
      var saved = DB.get('app_config', null);
      if (!saved) return JSON.parse(JSON.stringify(DEFAULTS));
      saved.metas = Object.assign({}, DEFAULTS.metas, saved.metas || {});
      return saved;
    },
    set: function(cfg) { DB.set('app_config', cfg); },
    meta: function(kpiId) {
      return this.get().metas[kpiId] !== undefined ? this.get().metas[kpiId] : DEFAULTS.metas[kpiId];
    }
  };
})();

// Patch KPI metas con valores configurados
(function() {
  var cfg = CFG.get();
  KPI.forEach(function(k) {
    if (cfg.metas[k.id] !== undefined) k.meta = cfg.metas[k.id];
  });
})();

// ── RENDER PANTALLA CONFIGURACIÓN ─────────────────────────────────────────
function renderConfig() {
  var cfg = CFG.get();
  var el = document.getElementById('configContent');
  if (!el) return;

  el.innerHTML =
    '<div class="dash-2col" style="align-items:start">' +

    // Columna 1: datos del contrato
    '<div>' +
    '<div class="dash-card" style="margin-bottom:16px;padding:18px">' +
    '<div class="dash-card-title" style="margin-bottom:14px">Datos del Contrato</div>' +
    '<div class="form-group"><label>Nombre del contrato</label>' +
    '<input type="text" id="cfgContrato" value="' + esc(cfg.contrato) + '" placeholder="Contrato CMC"/></div>' +
    '<div class="form-group"><label>Empresa contratista</label>' +
    '<input type="text" id="cfgContratista" value="' + esc(cfg.empresa_contratista) + '" placeholder="Razón social"/></div>' +
    '<div class="form-group"><label>Empresa mandante</label>' +
    '<input type="text" id="cfgMandante" value="' + esc(cfg.empresa_mandante) + '" placeholder="Codelco"/></div>' +
    '</div>' +

    // Usuarios
    '<div class="dash-card" style="padding:18px">' +
    '<div class="dash-card-title" style="margin-bottom:12px">Usuarios del sistema</div>' +
    '<div style="display:flex;flex-direction:column;gap:8px">' +
    renderUsuariosConfig() +
    '</div>' +
    '<div style="margin-top:10px;padding:10px;background:var(--surface2);border-radius:8px;font-size:11px;color:var(--text2)">' +
    'Los PINes se pueden cambiar directamente en <code>js/auth.js</code></div>' +
    '</div>' +
    '</div>' +

    // Columna 2: metas por KPI
    '<div class="dash-card" style="padding:18px">' +
    '<div class="dash-card-title" style="margin-bottom:14px">Metas por KPI</div>' +
    '<div style="display:flex;flex-direction:column;gap:14px">' +
    KPI.map(function(k) {
      var val = cfg.metas[k.id] !== undefined ? cfg.metas[k.id] : k.meta;
      return '<div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">' +
        '<div style="font-size:12px;font-weight:600">' + k.id + '. ' + k.nombre + '</div>' +
        '<div style="display:flex;align-items:center;gap:6px">' +
        '<input type="number" id="cfgMeta' + k.id + '" value="' + val + '" min="0" max="200" step="0.5"' +
        ' style="width:70px;padding:5px 8px;border:1.5px solid var(--border);border-radius:6px;font-size:13px;font-weight:700;text-align:center"' +
        ' oninput="previewMeta(' + k.id + ')"/>' +
        '<span style="font-size:12px;color:var(--text2)">%</span>' +
        '</div></div>' +
        '<div style="font-size:10px;color:var(--text2)">' +
        '<span class="badge badge-' + (k.freq==='Semanal'?'blue':'gray') + '" style="margin-right:4px">' + k.freq + '</span>' +
        'Pond. ' + k.pond + '%' + (k.invertido ? ' · ↓ Invertido (menor = mejor)' : '') +
        '</div>' +
        '<div style="margin-top:6px;height:4px;background:var(--border);border-radius:2px;overflow:hidden">' +
        '<div id="cfgBar' + k.id + '" style="height:100%;border-radius:2px;background:var(--accent);width:' + Math.min(val,100) + '%;transition:width .3s"></div>' +
        '</div></div>';
    }).join('') +
    '</div>' +
    '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px">' +
    '<button class="btn btn-ghost" onclick="resetConfig()">Restaurar valores por defecto</button>' +
    '<button class="btn btn-primary" onclick="guardarConfig()">Guardar configuración</button>' +
    '</div>' +
    '</div>' +

    '</div>';
}

function renderUsuariosConfig() {
  var ROL_COLORS = {admin:'red', jefe:'blue', mandante:'gray'};
  var ROL_LABEL  = {admin:'Jefe Confiabilidad', jefe:'Admin Contratista', mandante:'Mandante (solo lectura)'};
  var users = AUTH.getUsers();
  var lista = users.map(function(u) {
    var isAdmin = u.id === 'u_admin';
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;background:var(--surface2);border-radius:8px;gap:8px">' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(u.nombre) + '</div>' +
        '<div style="font-size:10px;color:var(--text2)">@' + esc(u.username) + ' · ' + (ROL_LABEL[u.rol]||u.rol) + '</div>' +
      '</div>' +
      '<div style="display:flex;gap:6px;align-items:center">' +
        '<span class="badge badge-' + (ROL_COLORS[u.rol]||'gray') + '">' + (ROL_LABEL[u.rol]||u.rol) + '</span>' +
        (!isAdmin ? '<button class="btn btn-sm btn-ghost" onclick="editarUsuario(\'' + u.id + '\')" title="Editar">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="13" height="13"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>' +
          '<button class="btn btn-sm btn-danger" onclick="eliminarUsuario(\'' + u.id + '\')" title="Eliminar">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="13" height="13"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>' : '') +
      '</div>' +
    '</div>';
  }).join('');

  return lista +
    '<button class="btn btn-ghost" style="margin-top:8px;width:100%;border-style:dashed;gap:6px" onclick="nuevoUsuario()">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="13" height="13"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
    'Crear usuario</button>';
}

function esc(s) { return String(s||'').replace(/"/g,'&quot;'); }

function previewMeta(id) {
  var inp = document.getElementById('cfgMeta'+id);
  var bar = document.getElementById('cfgBar'+id);
  if (inp && bar) bar.style.width = Math.min(+inp.value||0, 100) + '%';
}

function guardarConfig() {
  var cfg = CFG.get();
  cfg.contrato = document.getElementById('cfgContrato').value.trim() || cfg.contrato;
  cfg.empresa_contratista = document.getElementById('cfgContratista').value.trim();
  cfg.empresa_mandante = document.getElementById('cfgMandante').value.trim() || 'Codelco';
  KPI.forEach(function(k) {
    var inp = document.getElementById('cfgMeta'+k.id);
    if (inp) {
      var v = parseFloat(inp.value);
      if (!isNaN(v) && v >= 0) {
        cfg.metas[k.id] = v;
        k.meta = v;
      }
    }
  });
  CFG.set(cfg);
  // Actualiza footer contrato
  var sfp = document.getElementById('sfPeriodo');
  if (sfp) sfp.textContent = cfg.contrato;
  showToast('Configuración guardada');
}

// ── GESTIÓN DE USUARIOS ────────────────────────────────────────────────────
function _abrirModalUsuario(u) {
  // Reutiliza el overlay genérico creando uno temporal
  var existing = document.getElementById('modalUsuario');
  if (existing) existing.remove();

  var ROL_OPTS = ['admin','jefe','mandante'];
  var ROL_LABEL = {admin:'Jefe Confiabilidad (Admin)', jefe:'Admin Contratista', mandante:'Mandante Codelco (solo lectura)'};

  var div = document.createElement('div');
  div.className = 'overlay';
  div.id = 'modalUsuario';
  div.style.display = 'flex';
  div.innerHTML =
    '<div class="modal" style="max-width:360px;width:100%">' +
      '<div class="modal-header"><h2>' + (u ? 'Editar usuario' : 'Nuevo usuario') + '</h2>' +
        '<button class="modal-close" onclick="document.getElementById(\'modalUsuario\').remove()">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</button></div>' +
      '<div class="modal-body">' +
        '<input type="hidden" id="muId" value="' + (u ? u.id : '') + '"/>' +
        '<div class="form-group"><label>Nombre completo</label>' +
          '<input type="text" id="muNombre" value="' + esc(u ? u.nombre : '') + '" placeholder="Nombre y apellido"/></div>' +
        '<div class="form-group"><label>Usuario (login)</label>' +
          '<input type="text" id="muUsername" value="' + esc(u ? u.username : '') + '" placeholder="sin espacios, minúsculas"/></div>' +
        '<div class="form-group"><label>' + (u ? 'Contraseña (dejar vacío = no cambiar)' : 'Contraseña') + '</label>' +
          '<input type="password" id="muPassword" placeholder="mínimo 4 caracteres"/></div>' +
        '<div class="form-group"><label>Rol</label>' +
          '<select id="muRol">' +
            ROL_OPTS.map(function(r){ return '<option value="' + r + '"' + (u && u.rol===r?' selected':'') + '>' + ROL_LABEL[r] + '</option>'; }).join('') +
          '</select></div>' +
        '<div id="muError" style="color:#dc2626;font-size:12px;display:none;margin-top:6px"></div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-ghost" onclick="document.getElementById(\'modalUsuario\').remove()">Cancelar</button>' +
        '<button class="btn btn-primary" onclick="guardarUsuario()">Guardar</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(div);
}

function nuevoUsuario() { _abrirModalUsuario(null); }

function editarUsuario(id) {
  var u = AUTH.getUsers().find(function(x){ return x.id === id; });
  if (u) _abrirModalUsuario(u);
}

function eliminarUsuario(id) {
  if (!confirm('¿Eliminar este usuario?')) return;
  AUTH.deleteUser(id);
  renderConfig();
  showToast('Usuario eliminado');
}

function guardarUsuario() {
  var id      = document.getElementById('muId').value;
  var nombre  = document.getElementById('muNombre').value.trim();
  var username= document.getElementById('muUsername').value.trim().toLowerCase();
  var password= document.getElementById('muPassword').value;
  var rol     = document.getElementById('muRol').value;
  var errEl   = document.getElementById('muError');

  if (!nombre || !username) { errEl.textContent='Nombre y usuario son obligatorios.'; errEl.style.display='block'; return; }
  if (!id && password.length < 4) { errEl.textContent='La contraseña debe tener al menos 4 caracteres.'; errEl.style.display='block'; return; }

  // Verificar username único (excepto el propio)
  var dup = AUTH.getUsers().find(function(u){ return u.username===username && u.id!==id; });
  if (dup) { errEl.textContent='Ese nombre de usuario ya existe.'; errEl.style.display='block'; return; }

  var data = {id: id||null, nombre: nombre, username: username, rol: rol};
  if (password) data.password = password;
  AUTH.saveUser(data);

  document.getElementById('modalUsuario').remove();
  renderConfig();
  showToast(id ? 'Usuario actualizado' : 'Usuario creado');
}

function resetConfig() {
  if (!confirm('¿Restaurar todas las metas a sus valores por defecto?')) return;
  DB.set('app_config', null);
  location.reload();
}

function showToast(msg) {
  var t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1d4ed8;color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;z-index:9999;opacity:0;transition:opacity .3s';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  setTimeout(function(){ t.style.opacity = '0'; }, 2500);
}
