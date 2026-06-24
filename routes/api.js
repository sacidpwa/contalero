const express = require('express');
const router = express.Router();
const { getDB } = require('../database/schema');

router.get('/cuentas', (req, res) => {
  const db = getDB();
  const q = req.query.q || '';
  const cuentas = db.prepare("SELECT id, codigo, nombre FROM cuentas WHERE activo = 1 AND (codigo LIKE ? || '%' OR nombre LIKE '%' || ? || '%') ORDER BY codigo LIMIT 50").all(q, q);
  res.json(cuentas);
});

router.get('/polizas/recientes', (req, res) => {
  const db = getDB();
  const limit = parseInt(req.query.limit || 10);
  const polizas = db.prepare('SELECT p.*, (SELECT COALESCE(SUM(debe),0) FROM polizas_detalle WHERE poliza_id = p.id) as total FROM polizas p ORDER BY p.id DESC LIMIT ?').all(limit);
  res.json(polizas);
});

router.get('/dashboard/data', (req, res) => {
  const db = getDB();
  const ejercicio = parseInt(req.query.ejercicio || new Date().getFullYear());

  const mensual = db.prepare(`SELECT p.mes,
    COALESCE(SUM(CASE WHEN c.codigo LIKE '4%' THEN pd.haber ELSE 0 END), 0) as ingresos,
    COALESCE(SUM(CASE WHEN c.codigo LIKE '5%' OR c.codigo LIKE '6%' THEN pd.debe ELSE 0 END), 0) as egresos
    FROM polizas p
    JOIN polizas_detalle pd ON pd.poliza_id = p.id
    JOIN cuentas c ON c.id = pd.cuenta_id
    WHERE p.ejercicio = ?
    GROUP BY p.mes ORDER BY p.mes`).all(ejercicio);

  res.json({ mensual });
});

module.exports = router;
