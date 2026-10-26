var AUTH = (function() {
  var STORAGE_KEY = 'kpi_usuarios';
  var SESSION_KEY = 'kpi_sesion';

  // Seed admin por defecto si no hay usuarios
  function ensureUsers() {
    var users = _getUsers();
    if (!users.length) {
      DB.set(STORAGE_KEY, [{
        id: 'u_admin',
        nombre: 'Rodrigo Campos',
        username: 'admin',
        password: 'admin1234',
        rol: 'admin'
      }]);
    }
  }

  function _getUsers() { return DB.get(STORAGE_KEY, []); }

  function sesion() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch(e) { return null; }
  }

  var ROL_LABEL = {admin: 'Jefe Confiabilidad', jefe: 'Admin Contratista', mandante: 'Mandante Codelco'};

  return {
    init: function() {
      ensureUsers();
      if (!sesion()) {
        document.getElementById('loginOverlay').style.display = 'flex';
      } else {
        AUTH.applyRole();
        requestAnimationFrame(function() {
          renderDashboard();
          renderPanelIA('dashboard');
        });
      }
    },
    login: function() {
      var user = document.getElementById('loginUser').value.trim();
      var pass = document.getElementById('loginPass').value;
      var errEl = document.getElementById('loginError');
      var u = _getUsers().find(function(x){ return x.username === user && x.password === pass; });
      if (!u) {
        errEl.style.display = 'block';
        document.getElementById('loginPass').value = '';
        return;
      }
      errEl.style.display = 'none';
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(u));
      document.getElementById('loginOverlay').style.display = 'none';
      AUTH.applyRole();
      requestAnimationFrame(function() {
        renderDashboard();
        renderPanelIA('dashboard');
      });
    },
    logout: function() {
      sessionStorage.removeItem(SESSION_KEY);
      location.reload();
    },
    sesion: sesion,
    rol: function() { var s = sesion(); return s ? s.rol : ''; },
    nombre: function() { var s = sesion(); return s ? s.nombre : ''; },
    canEdit: function() { var r = this.rol(); return r === 'admin' || r === 'jefe'; },
    canConfig: function() { return this.rol() === 'admin'; },
    applyRole: function() {
      var s = sesion();
      if (!s) return;
      var sfn = document.getElementById('sfNombre');
      if (sfn) sfn.textContent = s.nombre;
      var sfr = document.getElementById('sfRol');
      if (sfr) sfr.textContent = ROL_LABEL[s.rol] || '';
      if (!AUTH.canEdit()) {
        document.querySelectorAll('.rol-edit').forEach(function(e){ e.style.display = 'none'; });
      }
      if (!AUTH.canConfig()) {
        document.querySelectorAll('.rol-config').forEach(function(e){ e.style.display = 'none'; });
      }
    },

    // ── GESTIÓN DE USUARIOS (solo admin) ──────────────────────────────────
    getUsers: _getUsers,
    saveUser: function(data) {
      var users = _getUsers();
      if (data.id) {
        var idx = users.findIndex(function(u){ return u.id === data.id; });
        if (idx >= 0) { users[idx] = Object.assign(users[idx], data); }
        else { users.push(data); }
      } else {
        data.id = 'u_' + uid();
        users.push(data);
      }
      DB.set(STORAGE_KEY, users);
    },
    deleteUser: function(id) {
      if (id === 'u_admin') { alert('No puedes eliminar el administrador principal.'); return; }
      var users = _getUsers().filter(function(u){ return u.id !== id; });
      DB.set(STORAGE_KEY, users);
    }
  };
})();

function loginSubmit() { AUTH.login(); }
