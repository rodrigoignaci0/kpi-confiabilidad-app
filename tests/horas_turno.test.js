const test = require('node:test');
const assert = require('node:assert');
const { sinSolapes } = require('../scripts/horas_turno');

const reg = (extra) => ({
  equipo: 'JR002', fecha_inicio: '2026-10-23', turno: 'A',
  tipo_de_perdida: 'NO PLANIFICADO', detencion_total_horas: 12,
  tiempo_np: null, tiempo_pl: null, hora_inicio: '08:00', hora_termino: '20:00', ...extra,
});

test('un trabajo dentro de otro no suma horas', () => {
  const falla = reg({});
  const pauta = reg({ tipo_de_perdida: 'PLANIFICADO', detencion_total_horas: 8, hora_inicio: '12:00' });
  const r = sinSolapes([pauta, falla]);
  assert.strictEqual(r.despues, 12);
  assert.strictEqual(pauta.detencion_total_horas, 0);
});

test('el turno B cruza medianoche y no pasa de 12 h', () => {
  const a = reg({ turno: 'B', hora_inicio: '20:00', hora_termino: '08:00' });
  const b = reg({ turno: 'B', hora_inicio: '02:00', hora_termino: '07:00', detencion_total_horas: 5 });
  assert.strictEqual(sinSolapes([a, b]).despues, 12);
});

test('sin horario se recorta a lo que queda del turno', () => {
  const a = reg({ detencion_total_horas: 8, hora_termino: '16:00' });
  const b = reg({ detencion_total_horas: 10, hora_inicio: null, hora_termino: null });
  assert.strictEqual(sinSolapes([a, b]).despues, 12);
});
