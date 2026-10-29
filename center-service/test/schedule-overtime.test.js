import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canRemoveScheduleOvertime,
  findRemovedRestDays,
} from '../../shared/center-schedule-overtime.mjs';

const employee = { nro_documento: '00123456', nombre_completo: 'Juan' };
const schedule = ({ work = [1], rest = [2] } = {}) => [{
  cargo: 'Vendedores',
  dias: [
    { id: 1, dia: 'Miércoles', fecha: '2026-10-28' },
    { id: 2, dia: 'Jueves', fecha: '2026-10-29' },
  ],
  filasTrabajo: [{
    rango: '09:00 - 18:00',
    celdas: work.map(id_dia => ({ id_dia, trabajadores: [employee] })),
  }],
  filaLibres: rest.map(id_dia => ({ id_dia, trabajadores: [employee] })),
}];
const previous = [{ NUMERO_DOCUMENTO: '00123456', FECHA_NUMBER: '28-10-2026' }];
const overtime = overrides => ({
  ID_HR_EXTRA: 7,
  NRO_DOCUMENTO_EMPLEADO: '00123456',
  FECHA: '2026-10-28',
  ESTADO: 'aprobar',
  OBSERVACION: 'Trabajo en su dia de descanso.',
  HR_EXTRA_ACUMULADO: '08:00',
  HR_EXTRA_SOLICITADO: '00:00',
  HR_EXTRA_SOBRANTE: '08:00',
  ...overrides,
});
const noReferences = { hasBallot: false, hasAuthorization: false };

test('reproduces the rest-day swap: only Juan on the former rest date becomes obsolete', () => {
  assert.deepEqual(findRemovedRestDays(previous, schedule()), [
    { document: '00123456', date: '2026-10-28' },
  ]);
  assert.equal(canRemoveScheduleOvertime(overtime(), noReferences), true);
});

test('does not delete a rest-day balance merely because the employee disappeared from the schedule', () => {
  assert.deepEqual(findRemovedRestDays(previous, schedule({ work: [], rest: [2] })), []);
  assert.deepEqual(findRemovedRestDays(previous, []), []);
});

test('keeps a rest day that remains marked free even if malformed input also marks it as work', () => {
  assert.deepEqual(findRemovedRestDays(previous, schedule({ work: [1], rest: [1, 2] })), []);
});

test('normalizes real schedule date formats and deduplicates changes across positions', () => {
  const data = schedule();
  data[0].dias[0].fecha = '28-10-2026';
  data.push(structuredClone(data[0]));
  assert.deepEqual(findRemovedRestDays([
    ...previous,
    { NUMERO_DOCUMENTO: '00123456', FECHA_NUMBER: '2026-10-28' },
    { NUMERO_DOCUMENTO: '00123456', FECHA_NUMBER: null, FECHA: '28-10-2026' },
  ], data), [{ document: '00123456', date: '2026-10-28' }]);
});

test('preserves employee identity and excludes invalid dates or unrelated employees', () => {
  assert.deepEqual(findRemovedRestDays([
    { NUMERO_DOCUMENTO: '123456', FECHA_NUMBER: '2026-10-28' },
    { NUMERO_DOCUMENTO: '00123456', FECHA_NUMBER: '31-02-2026' },
    { NUMERO_DOCUMENTO: '', FECHA_NUMBER: '2026-10-28' },
  ], schedule()), []);
});

test('retains fully used and partially consumed balances regardless of status or formatted zeros', () => {
  for (const changes of [
    { ESTADO: 'utilizado' },
    { ESTADO: ' UTILIZADO ' },
    { HR_EXTRA_SOLICITADO: '00:01' },
    { HR_EXTRA_SOLICITADO: '01:00:00' },
    { HR_EXTRA_SOBRANTE: '07:30' },
    { HR_EXTRA_SOBRANTE: '00:00' },
  ]) assert.equal(canRemoveScheduleOvertime(overtime(changes), noReferences), false, JSON.stringify(changes));
});

test('accepts a SQL TIME zero but rejects missing, negative or malformed requested time', () => {
  assert.equal(canRemoveScheduleOvertime(overtime({
    HR_EXTRA_SOLICITADO: '00:00:00',
    HR_EXTRA_ACUMULADO: '08:00:00',
    HR_EXTRA_SOBRANTE: '08:00',
  }), noReferences), true);
  for (const value of [null, undefined, '', 0, '0', '00:00:01', '-00:00:00', '00:99', 'invalid']) {
    assert.equal(canRemoveScheduleOvertime(overtime({ HR_EXTRA_SOLICITADO: value }), noReferences), false, String(value));
  }
});

test('retains paper-slip and approval references even if legacy balances appear unused', () => {
  assert.equal(canRemoveScheduleOvertime(overtime(), { hasBallot: true, hasAuthorization: false }), false);
  assert.equal(canRemoveScheduleOvertime(overtime(), { hasBallot: false, hasAuthorization: true }), false);
});

test('does not touch ordinary overtime, weekly part-time balances or incomplete balances', () => {
  for (const changes of [
    { OBSERVACION: null },
    { OBSERVACION: 'Exceso Part-Time Semanal', FECHA: '2026-10-26 al 2026-11-01' },
    { OBSERVACION: 'Tiene una papeleta ese dia.' },
    { HR_EXTRA_ACUMULADO: null },
    { HR_EXTRA_SOBRANTE: null },
    { HR_EXTRA_ACUMULADO: '00:00', HR_EXTRA_SOBRANTE: '00:00' },
  ]) assert.equal(canRemoveScheduleOvertime(overtime(changes), noReferences), false, JSON.stringify(changes));
});
