const express = require('express');
const router = express.Router();
const { getDB } = require('../database/schema');

router.get('/', (req, res) => {
  const db = getDB();
  const tipo = req.query.tipo || '';
  let sql = 'SELECT * FROM auxiliares';
  const params = [];
  if (tipo) { sql += ' WHERE tipo = ?'; params.push(tipo); }
  sql += ' ORDER BY codigo';
  const auxiliares = db.prepare(sql).all(...params);
  res.render('auxiliares/list', { auxiliares, tipo, tipos: ['A', 'C', 'P'], title: 'Auxiliares' });
});

router.get('/nuevo', (req, res) => {
  res.render('auxiliares/form', { auxiliar: {}, title: 'Nuevo Auxiliar' });
});

router.post('/nuevo', (req, res) => {
  const db = getDB();
  const { tipo, codigo, nombre, rfc, curp, direccion, telefono, email } = req.body;
  db.prepare('INSERT INTO auxiliares (tipo, codigo, nombre, rfc, curp, direccion, telefono, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(tipo, codigo, nombre, rfc, curp, direccion, telefono, email);
  res.redirect('/auxiliares');
});

router.get('/:id/editar', (req, res) => {
  const db = getDB();
  const auxiliar = db.prepare('SELECT * FROM auxiliares WHERE id = ?').get(req.params.id);
  res.render('auxiliares/form', { auxiliar, title: 'Editar Auxiliar' });
});

router.post('/:id/editar', (req, res) => {
  const db = getDB();
  const { tipo, codigo, nombre, rfc, curp, direccion, telefono, email, activo } = req.body;
  db.prepare('UPDATE auxiliares SET tipo=?, codigo=?, nombre=?, rfc=?, curp=?, direccion=?, telefono=?, email=?, activo=? WHERE id=?')
    .run(tipo, codigo, nombre, rfc, curp, direccion, telefono, email, parseInt(activo || 0), req.params.id);
  res.redirect('/auxiliares');
});

router.get('/:id/saldos', (req, res) => {
  const db = getDB();
  const auxiliar = db.prepare('SELECT * FROM auxiliares WHERE id = ?').get(req.params.id);
  const movimientos = db.prepare(`SELECT pd.*, p.fecha, p.numero, p.tipo, p.concepto as poliza_concepto, c.codigo as cuenta_codigo, c.nombre as cuenta_nombre
    FROM polizas_detalle pd JOIN polizas p ON p.id = pd.poliza_id
    JOIN cuentas c ON c.id = pd.cuenta_id
    WHERE pd.auxiliar_id = ?
    ORDER BY p.fecha DESC LIMIT 500`).all(req.params.id);
  res.render('auxiliares/saldos', { auxiliar, movimientos, title: `Saldos de ${auxiliar.nombre}` });
});

router.get('/:id/eliminar', (req, res) => {
  const db = getDB();
  const usado = db.prepare('SELECT COUNT(*) as c FROM polizas_detalle WHERE auxiliar_id = ?').get(req.params.id).c;
  if (usado > 0) return res.redirect('/auxiliares?error=Tiene movimientos');
  db.prepare('DELETE FROM auxiliares WHERE id = ?').run(req.params.id);
  res.redirect('/auxiliares');
});

module.exports = router;
