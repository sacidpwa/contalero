const express = require('express');
const router = express.Router();
const { getDB } = require('../database/schema');
const { crearPoliza } = require('../services/contabilidad');

// Pólizas recurrentes
router.get('/recurrentes', (req, res) => {
  const db = getDB();
  const recurrentes = db.prepare('SELECT * FROM recurrentes ORDER BY nombre').all();
  res.render('automatizacion/recurrentes', { recurrentes, title: 'Pólizas Recurrentes' });
});

router.get('/recurrentes/nueva', (req, res) => {
  const db = getDB();
  const cuentas = db.prepare('SELECT * FROM cuentas WHERE activo = 1 AND acepta_movimientos = 1 ORDER BY codigo').all();
  const auxiliares = db.prepare('SELECT * FROM auxiliares WHERE activo = 1 ORDER BY codigo').all();
  const centros = db.prepare('SELECT * FROM centros_costos WHERE activo = 1 ORDER BY codigo').all();
  const deptos = db.prepare('SELECT * FROM departamentos WHERE activo = 1 ORDER BY codigo').all();
  res.render('automatizacion/recurrente_form', { recurrente: {}, cuentas, auxiliares, centros, deptos, title: 'Nueva Póliza Recurrente' });
});

router.post('/recurrentes/nueva', (req, res) => {
  const db = getDB();
  const { nombre, tipo_poliza, periodicidad, dia, concepto } = req.body;
  const result = db.prepare('INSERT INTO recurrentes (nombre, tipo_poliza, periodicidad, dia, concepto) VALUES (?, ?, ?, ?, ?)').run(nombre, tipo_poliza, periodicidad, parseInt(dia), concepto);
  const recId = result.lastInsertRowid;

  const cuentas = Array.isArray(req.body['detalles[cuenta_id]']) ? req.body['detalles[cuenta_id]'] : [req.body['detalles[cuenta_id]']];
  const debers = Array.isArray(req.body['detalles[debe]']) ? req.body['detalles[debe]'] : [req.body['detalles[debe]']];
  const habers = Array.isArray(req.body['detalles[haber]']) ? req.body['detalles[haber]'] : [req.body['detalles[haber]']];

  const insert = db.prepare('INSERT INTO recurrentes_detalle (recurrente_id, cuenta_id, auxiliar_id, centro_costo_id, departamento_id, debe, haber, referencia) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (let i = 0; i < cuentas.length; i++) {
    if (cuentas[i]) {
      insert.run(recId, parseInt(cuentas[i]),
        req.body[`detalles[auxiliar_id][${i}]`] ? parseInt(req.body[`detalles[auxiliar_id][${i}]`]) : null,
        req.body[`detalles[centro_costo_id][${i}]`] ? parseInt(req.body[`detalles[centro_costo_id][${i}]`]) : 1,
        req.body[`detalles[departamento_id][${i}]`] ? parseInt(req.body[`detalles[departamento_id][${i}]`]) : 1,
        parseFloat(debers[i] || 0), parseFloat(habers[i] || 0),
        req.body[`detalles[referencia][${i}]`] || null);
    }
  }
  res.redirect('/automatizacion/recurrentes');
});

router.get('/recurrentes/:id/ejecutar', (req, res) => {
  const db = getDB();
  const rec = db.prepare('SELECT * FROM recurrentes WHERE id = ?').get(req.params.id);
  if (!rec) return res.redirect('/automatizacion/recurrentes');

  const detalles = db.prepare('SELECT * FROM recurrentes_detalle WHERE recurrente_id = ?').all(req.params.id);
  const hoy = new Date();
  const fecha = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}-${String(rec.dia).padStart(2,'0')}`;
  const polizaDetalles = detalles.map(d => ({
    cuenta_id: d.cuenta_id,
    auxiliar_id: d.auxiliar_id,
    centro_costo_id: d.centro_costo_id,
    departamento_id: d.departamento_id,
    concepto: d.referencia || rec.concepto,
    debe: d.debe,
    haber: d.haber,
    referencia: d.referencia,
  }));

  try {
    crearPoliza(rec.tipo_poliza, fecha, `[AUTO] ${rec.concepto}`, polizaDetalles);
    db.prepare('UPDATE recurrentes SET ultima_generacion = datetime(?, ?) WHERE id = ?').run(fecha, '', req.params.id);
    res.redirect('/automatizacion/recurrentes?ok=Generada');
  } catch (e) {
    res.redirect(`/automatizacion/recurrentes?error=${encodeURIComponent(e.message)}`);
  }
});

// Depreciación automática
router.get('/depreciacion', (req, res) => {
  const db = getDB();
  const activos = db.prepare('SELECT * FROM depreciaciones ORDER BY nombre').all();
  const cuentas = db.prepare('SELECT * FROM cuentas WHERE activo = 1 ORDER BY codigo').all();
  res.render('automatizacion/depreciacion', { activos, cuentas, title: 'Depreciación de Activos' });
});

router.post('/depreciacion/nuevo', (req, res) => {
  const db = getDB();
  const { cuenta_activo_id, cuenta_gasto_id, cuenta_depreciacion_id, nombre, fecha_adquisicion, valor_original, valor_residual, vida_util, metodo } = req.body;
  db.prepare('INSERT INTO depreciaciones (cuenta_activo_id, cuenta_gasto_id, cuenta_depreciacion_id, nombre, fecha_adquisicion, valor_original, valor_residual, vida_util, metodo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(cuenta_activo_id, cuenta_gasto_id, cuenta_depreciacion_id, nombre, fecha_adquisicion, valor_original, valor_residual || 0, vida_util, metodo || 'L');
  res.redirect('/automatizacion/depreciacion');
});

router.get('/depreciacion/:id/calcular', (req, res) => {
  const db = getDB();
  const activo = db.prepare('SELECT * FROM depreciaciones WHERE id = ?').get(req.params.id);
  if (!activo) return res.redirect('/automatizacion/depreciacion');

  const hoy = new Date();
  const fecha = `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}-01`;
  const mesesOperacion = Math.floor((hoy - new Date(activo.fecha_adquisicion)) / (30 * 24 * 60 * 60 * 1000));

  let depreciacionMensual;
  if (activo.metodo === 'L') {
    depreciacionMensual = (activo.valor_original - activo.valor_residual) / activo.vida_util / 12;
  } else {
    const tasa = 2 / activo.vida_util;
    depreciacionMensual = (activo.valor_original - activo.valor_residual) * tasa / 12;
  }

  const polizaDetalles = [
    { cuenta_id: activo.cuenta_gasto_id, debe: depreciacionMensual, haber: 0, concepto: `Depreciación ${activo.nombre}` },
    { cuenta_id: activo.cuenta_depreciacion_id, debe: 0, haber: depreciacionMensual, concepto: `Depreciación ${activo.nombre}` },
  ];

  try {
    crearPoliza('D', fecha, `[AUTO] Depreciación ${activo.nombre}`, polizaDetalles);
    db.prepare('UPDATE depreciaciones SET fecha_ultima_depreciacion = ? WHERE id = ?').run(fecha, req.params.id);
    res.redirect('/automatizacion/depreciacion?ok=Depreciación generada');
  } catch (e) {
    res.redirect(`/automatizacion/depreciacion?error=${encodeURIComponent(e.message)}`);
  }
});

// Loop automático - ejecuta todas las tareas programadas
router.get('/loop-automatico', (req, res) => {
  const db = getDB();
  const hoy = new Date();
  const dia = hoy.getDate();
  const mes = hoy.getMonth() + 1;
  const ejercicio = hoy.getFullYear();
  let generadas = 0, errores = 0;

  // Ejecutar pólizas recurrentes cuyo día corresponde
  const recurrentes = db.prepare('SELECT * FROM recurrentes WHERE activo = 1 AND dia <= ?').all(dia);

  for (const rec of recurrentes) {
    const yaGenerada = db.prepare(`SELECT COUNT(*) as c FROM polizas WHERE concepto LIKE ? AND mes = ? AND ejercicio = ?`).get(`%${rec.concepto}%`, mes, ejercicio);
    if (yaGenerada.c > 0) continue;

    const detalles = db.prepare('SELECT * FROM recurrentes_detalle WHERE recurrente_id = ?').all(rec.id);
    const fecha = `${ejercicio}-${String(mes).padStart(2,'0')}-${String(rec.dia).padStart(2,'0')}`;
    const polizaDetalles = detalles.map(d => ({
      cuenta_id: d.cuenta_id, auxiliar_id: d.auxiliar_id, centro_costo_id: d.centro_costo_id,
      departamento_id: d.departamento_id, concepto: d.referencia || rec.concepto, debe: d.debe, haber: d.haber, referencia: d.referencia,
    }));

    try {
      crearPoliza(rec.tipo_poliza, fecha, `[AUTO] ${rec.concepto}`, polizaDetalles);
      db.prepare('UPDATE recurrentes SET ultima_generacion = ? WHERE id = ?').run(fecha, rec.id);
      generadas++;
    } catch (e) {
      errores++;
    }
  }

  res.render('automatizacion/loop_result', { generadas, errores, mes, ejercicio, title: 'Loop Automático' });
});

module.exports = router;
