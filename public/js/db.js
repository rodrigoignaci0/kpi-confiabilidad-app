// Storage helpers
var DB = {
  get: function(k, d) {
    if (d === undefined) d = [];
    try { var v = localStorage.getItem(k); return v !== null ? JSON.parse(v) : d; } catch(e) { return d; }
  },
  set: function(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
};

var registros = DB.get('kpi_registros');

function save() { DB.set('kpi_registros', registros); }

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function today() { return new Date().toISOString().split('T')[0]; }
