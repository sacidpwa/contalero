const express = require('express');
const router = express.Router();
const { getDB } = require('../database/schema');

router.get('/dashboard', (req, res) => {
  const db = getDB();
  const mes = req.session.mes || new Date().getMonth() + 1;
  const ejercicio = req.session.ejercicio || new Date().getFullYear();

  const totalCuentas = db.prepare('SELECT COUNT(*) as c FROM cuentas').get().c;
  const totalPolizas = db.prepare('SELECT COUNT(*) as c FROM polizas WHERE ejercicio = ? AND mes = ?').get(ejercicio, mes).c;
  const totalAuxiliares = db.prepare('SELECT COUNT(*) as c FROM auxiliares').get().c;

  const er = require('../services/contabilidad').getEstadoResultados(ejercicio, mes);
  const bg = require('../services/contabilidad').getBalanceGeneral(ejercicio, mes);

  res.render('dashboard', { mes, ejercicio, totalCuentas, totalPolizas, totalAuxiliares, er, bg, title: 'Dashboard' });
});

router.get('/catalogo', (req, res) => {
  const db = getDB();
  const cuentas = db.prepare('SELECT * FROM cuentas ORDER BY codigo').all();
  res.render('catalogo/list', { cuentas, title: 'Catálogo de Cuentas' });
});

router.get('/catalogo/nueva', (req, res) => {
  const db = getDB();
  const cuentas = db.prepare('SELECT * FROM cuentas WHERE activo = 1 ORDER BY codigo').all();
  res.render('catalogo/form', { cuenta: {}, cuentas, title: 'Nueva Cuenta' });
});

router.post('/catalogo/nueva', (req, res) => {
  const db = getDB();
  const { codigo, nombre, nivel, naturaleza, acepta_movimientos, centro_costos, tipo_sat } = req.body;
  db.prepare(`INSERT INTO cuentas (codigo, nombre, nivel, naturaleza, acepta_movimientos, centro_costos, tipo_sat) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(codigo, nombre, parseInt(nivel), naturaleza, parseInt(acepta_movimientos || 0), parseInt(centro_costos || 0), tipo_sat || 'N');
  res.redirect('/catalogo');
});

router.get('/catalogo/:id/editar', (req, res) => {
  const db = getDB();
  const cuenta = db.prepare('SELECT * FROM cuentas WHERE id = ?').get(req.params.id);
  const cuentas = db.prepare('SELECT * FROM cuentas WHERE activo = 1 AND id != ? ORDER BY codigo').all(req.params.id);
  res.render('catalogo/form', { cuenta, cuentas, title: 'Editar Cuenta' });
});

router.post('/catalogo/:id/editar', (req, res) => {
  const db = getDB();
  const { codigo, nombre, nivel, naturaleza, acepta_movimientos, centro_costos, tipo_sat, activo } = req.body;
  db.prepare(`UPDATE cuentas SET codigo=?, nombre=?, nivel=?, naturaleza=?, acepta_movimientos=?, centro_costos=?, tipo_sat=?, activo=? WHERE id=?`)
    .run(codigo, nombre, parseInt(nivel), naturaleza, parseInt(acepta_movimientos || 0), parseInt(centro_costos || 0), tipo_sat || 'N', parseInt(activo || 0), req.params.id);
  res.redirect('/catalogo');
});

router.get('/catalogo/:id/eliminar', (req, res) => {
  const db = getDB();
  const usado = db.prepare('SELECT COUNT(*) as c FROM polizas_detalle WHERE cuenta_id = ?').get(req.params.id).c;
  if (usado > 0) return res.redirect('/catalogo?error=Cuenta con movimientos');
  db.prepare('DELETE FROM cuentas WHERE id = ?').run(req.params.id);
  res.redirect('/catalogo');
});

module.exports = router;
