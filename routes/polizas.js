const express = require('express');
const router = express.Router();
const { getDB } = require('../database/schema');
const { getSiguienteNumero, crearPoliza } = require('../services/contabilidad');

router.get('/', (req, res) => {
  const db = getDB();
  const mes = req.query.mes || req.session.mes || new Date().getMonth() + 1;
  const ejercicio = req.query.ejercicio || req.session.ejercicio || new Date().getFullYear();
  const tipo = req.query.tipo || '';
  const limit = parseInt(req.query.limit || 100);

  let sql = `SELECT p.*, (SELECT COALESCE(SUM(debe), 0) FROM polizas_detalle WHERE poliza_id = p.id) as total_debe FROM polizas p WHERE p.ejercicio = ? AND p.mes = ?`;
  const params = [ejercicio, mes];
  if (tipo) { sql += ' AND p.tipo = ?'; params.push(tipo); }
  sql += ' ORDER BY p.tipo, p.numero DESC LIMIT ?';
  params.push(limit);

  const polizas = db.prepare(sql).all(...params);
  const tipos = ['I','E','D','O'];
  res.render('polizas/list', { polizas, tipos, mes: parseInt(mes), ejercicio: parseInt(ejercicio), title: 'Pólizas' });
});

router.get('/nueva', (req, res) => {
  const db = getDB();
  const tipo = req.query.tipo || 'D';
  const ejercicio = req.session.ejercicio || new Date().getFullYear();
  const numero = getSiguienteNumero(tipo, ejercicio);
  const cuentas = db.prepare('SELECT * FROM cuentas WHERE activo = 1 AND acepta_movimientos = 1 ORDER BY codigo').all();
  const auxiliares = db.prepare('SELECT * FROM auxiliares WHERE activo = 1 ORDER BY codigo').all();
  const centros = db.prepare('SELECT * FROM centros_costos WHERE activo = 1 ORDER BY codigo').all();
  const deptos = db.prepare('SELECT * FROM departamentos WHERE activo = 1 ORDER BY codigo').all();
  res.render('polizas/form', { poliza: { tipo, numero, fecha: new Date().toISOString().substring(0, 10), concepto: '', detalles: [{ debe: 0, haber: 0 }] }, cuentas, auxiliares, centros, deptos, title: 'Nueva Póliza' });
});

router.post('/nueva', (req, res) => {
  try {
    const { tipo, fecha, concepto } = req.body;
    const detalles = [];
    const cuentas = Array.isArray(req.body['detalles[cuenta_id]']) ? req.body['detalles[cuenta_id]'] : [req.body['detalles[cuenta_id]']];
    const debers = Array.isArray(req.body['detalles[debe]']) ? req.body['detalles[debe]'] : [req.body['detalles[debe]']];
    const habers = Array.isArray(req.body['detalles[haber]']) ? req.body['detalles[haber]'] : [req.body['detalles[haber]']];

    for (let i = 0; i < cuentas.length; i++) {
      if (cuentas[i]) {
        detalles.push({
          cuenta_id: parseInt(cuentas[i]),
          debe: parseFloat(debers[i] || 0),
          haber: parseFloat(habers[i] || 0),
          auxiliar_id: req.body[`detalles[auxiliar_id][${i}]`] ? parseInt(req.body[`detalles[auxiliar_id][${i}]`]) : null,
          centro_costo_id: req.body[`detalles[centro_costo_id][${i}]`] ? parseInt(req.body[`detalles[centro_costo_id][${i}]`]) : 1,
          departamento_id: req.body[`detalles[departamento_id][${i}]`] ? parseInt(req.body[`detalles[departamento_id][${i}]`]) : 1,
          concepto: req.body[`detalles[concepto][${i}]`] || concepto,
          referencia: req.body[`detalles[referencia][${i}]`] || null,
        });
      }
    }

    crearPoliza(tipo, fecha, concepto, detalles);
    res.redirect(`/polizas?mes=${fecha.substring(5,7)}&ejercicio=${fecha.substring(0,4)}`);
  } catch (e) {
    res.redirect(`/polizas/nueva?tipo=${req.body.tipo || 'D'}&error=${encodeURIComponent(e.message)}`);
  }
});

router.get('/:id', (req, res) => {
  const db = getDB();
  const poliza = db.prepare('SELECT * FROM polizas WHERE id = ?').get(req.params.id);
  if (!poliza) return res.redirect('/polizas');
  const detalles = db.prepare(`SELECT pd.*, c.codigo as cuenta_codigo, c.nombre as cuenta_nombre, a.nombre as auxiliar_nombre
    FROM polizas_detalle pd JOIN cuentas c ON c.id = pd.cuenta_id
    LEFT JOIN auxiliares a ON a.id = pd.auxiliar_id
    WHERE pd.poliza_id = ? ORDER BY pd.id`).all(req.params.id);
  res.render('polizas/view', { poliza, detalles, title: `Póliza ${poliza.tipo}-${poliza.numero}` });
});

router.get('/:id/editar', (req, res) => {
  const db = getDB();
  const poliza = db.prepare('SELECT * FROM polizas WHERE id = ?').get(req.params.id);
  if (!poliza) return res.redirect('/polizas');
  const detalles = db.prepare('SELECT * FROM polizas_detalle WHERE poliza_id = ? ORDER BY id').all(req.params.id);
  const cuentas = db.prepare('SELECT * FROM cuentas WHERE activo = 1 AND acepta_movimientos = 1 ORDER BY codigo').all();
  const auxiliares = db.prepare('SELECT * FROM auxiliares WHERE activo = 1 ORDER BY codigo').all();
  const centros = db.prepare('SELECT * FROM centros_costos WHERE activo = 1 ORDER BY codigo').all();
  const deptos = db.prepare('SELECT * FROM departamentos WHERE activo = 1 ORDER BY codigo').all();
  res.render('polizas/form', { poliza, detalles, cuentas, auxiliares, centros, deptos, title: `Editar Póliza ${poliza.tipo}-${poliza.numero}` });
});

router.post('/:id/editar', (req, res) => {
  const db = getDB();
  const { fecha, concepto } = req.body;
  db.prepare('UPDATE polizas SET fecha=?, concepto=? WHERE id=?').run(fecha, concepto, req.params.id);
  db.prepare('DELETE FROM polizas_detalle WHERE poliza_id = ?').run(req.params.id);
  const cuentas = Array.isArray(req.body['detalles[cuenta_id]']) ? req.body['detalles[cuenta_id]'] : [req.body['detalles[cuenta_id]']];
  const debers = Array.isArray(req.body['detalles[debe]']) ? req.body['detalles[debe]'] : [req.body['detalles[debe]']];
  const habers = Array.isArray(req.body['detalles[haber]']) ? req.body['detalles[haber]'] : [req.body['detalles[haber]']];

  const insert = db.prepare('INSERT INTO polizas_detalle (poliza_id, cuenta_id, auxiliar_id, centro_costo_id, departamento_id, concepto, debe, haber, referencia) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (let i = 0; i < cuentas.length; i++) {
    if (cuentas[i]) {
      insert.run(req.params.id, parseInt(cuentas[i]), 
        req.body[`detalles[auxiliar_id][${i}]`] ? parseInt(req.body[`detalles[auxiliar_id][${i}]`]) : null,
        req.body[`detalles[centro_costo_id][${i}]`] ? parseInt(req.body[`detalles[centro_costo_id][${i}]`]) : 1,
        req.body[`detalles[departamento_id][${i}]`] ? parseInt(req.body[`detalles[departamento_id][${i}]`]) : 1,
        req.body[`detalles[concepto][${i}]`] || concepto,
        parseFloat(debers[i] || 0), parseFloat(habers[i] || 0),
        req.body[`detalles[referencia][${i}]`] || null);
    }
  }
  const p = db.prepare('SELECT * FROM polizas WHERE id = ?').get(req.params.id);
  res.redirect(`/polizas?mes=${p.mes}&ejercicio=${p.ejercicio}`);
});

router.get('/:id/eliminar', (req, res) => {
  const db = getDB();
  const p = db.prepare('SELECT * FROM polizas WHERE id = ?').get(req.params.id);
  if (!p) return res.redirect('/polizas');
  db.prepare('DELETE FROM polizas WHERE id = ?').run(req.params.id);
  res.redirect(`/polizas?mes=${p.mes}&ejercicio=${p.ejercicio}`);
});

module.exports = router;
