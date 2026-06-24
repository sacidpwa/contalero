const express = require('express');
const router = express.Router();
const { getDB } = require('../database/schema');
const { getSaldos, getEstadoResultados, getBalanceGeneral } = require('../services/contabilidad');

router.get('/balanza', (req, res) => {
  const mes = parseInt(req.query.mes || req.session.mes || 6);
  const ejercicio = parseInt(req.query.ejercicio || req.session.ejercicio || 2026);
  const saldos = getSaldos(ejercicio, mes);
  res.render('reportes/balanza', { saldos, mes, ejercicio, title: 'Balanza de Comprobación' });
});

router.get('/mayor', (req, res) => {
  const db = getDB();
  const cuentaId = req.query.cuenta_id;
  const mes = parseInt(req.query.mes || req.session.mes || 6);
  const ejercicio = parseInt(req.query.ejercicio || req.session.ejercicio || 2026);
  const cuentas = db.prepare('SELECT * FROM cuentas WHERE activo = 1 ORDER BY codigo').all();

  let movimientos = [];
  let cuenta = null;
  if (cuentaId) {
    cuenta = db.prepare('SELECT * FROM cuentas WHERE id = ?').get(cuentaId);
    movimientos = db.prepare(`SELECT pd.*, p.fecha, p.numero, p.tipo, p.concepto as poliza_concepto,
      a.nombre as auxiliar_nombre
      FROM polizas_detalle pd
      JOIN polizas p ON p.id = pd.poliza_id
      LEFT JOIN auxiliares a ON a.id = pd.auxiliar_id
      WHERE pd.cuenta_id = ? AND p.ejercicio = ? AND p.mes <= ?
      ORDER BY p.fecha, p.tipo, p.numero`).all(cuentaId, ejercicio, mes);
  }

  res.render('reportes/mayor', { cuentas, cuenta, movimientos, mes, ejercicio, title: 'Mayor de Cuentas' });
});

router.get('/resultados', (req, res) => {
  const mes = parseInt(req.query.mes || req.session.mes || 6);
  const ejercicio = parseInt(req.query.ejercicio || req.session.ejercicio || 2026);
  const er = getEstadoResultados(ejercicio, mes);
  res.render('reportes/resultados', { er, mes, ejercicio, title: 'Estado de Resultados' });
});

router.get('/balance', (req, res) => {
  const mes = parseInt(req.query.mes || req.session.mes || 6);
  const ejercicio = parseInt(req.query.ejercicio || req.session.ejercicio || 2026);
  const bg = getBalanceGeneral(ejercicio, mes);
  res.render('reportes/balance', { bg, mes, ejercicio, title: 'Balance General' });
});

module.exports = router;
