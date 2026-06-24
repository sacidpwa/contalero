const express = require('express');
const router = express.Router();
const { getDB } = require('../database/schema');

router.get('/', (req, res) => {
  const db = getDB();
  const ejercicio = parseInt(req.query.ejercicio || req.session.ejercicio || 2026);
  const presupuestos = db.prepare(`SELECT p.*, c.codigo, c.nombre, c.nivel
    FROM presupuestos p JOIN cuentas c ON c.id = p.cuenta_id
    WHERE p.ejercicio = ? ORDER BY c.codigo, p.mes`).all(ejercicio);
  const cuentas = db.prepare('SELECT * FROM cuentas WHERE activo = 1 AND acepta_movimientos = 1 ORDER BY codigo').all();
  res.render('presupuestos/list', { presupuestos, cuentas, ejercicio, title: 'Presupuestos' });
});

router.post('/guardar', (req, res) => {
  const db = getDB();
  const { cuenta_id, mes, ejercicio, presupuesto } = req.body;
  const exists = db.prepare('SELECT id FROM presupuestos WHERE cuenta_id = ? AND mes = ? AND ejercicio = ?').get(cuenta_id, mes, ejercicio);
  if (exists) {
    db.prepare('UPDATE presupuestos SET presupuesto = ? WHERE id = ?').run(presupuesto, exists.id);
  } else {
    db.prepare('INSERT INTO presupuestos (cuenta_id, mes, ejercicio, presupuesto) VALUES (?, ?, ?, ?)').run(cuenta_id, mes, ejercicio, presupuesto);
  }
  res.redirect('/presupuestos');
});

router.get('/vs-real', (req, res) => {
  const db = getDB();
  const ejercicio = parseInt(req.query.ejercicio || req.session.ejercicio || 2026);
  const mes = parseInt(req.query.mes || req.session.mes || 6);
  const rows = db.prepare(`SELECT c.codigo, c.nombre, p.presupuesto,
    COALESCE(SUM(CASE WHEN pd.id IS NOT NULL THEN pd.debe ELSE 0 END), 0) as real_debe,
    COALESCE(SUM(CASE WHEN pd.id IS NOT NULL THEN pd.haber ELSE 0 END), 0) as real_haber
    FROM cuentas c
    LEFT JOIN presupuestos p ON p.cuenta_id = c.id AND p.ejercicio = ? AND p.mes = ?
    LEFT JOIN polizas_detalle pd ON pd.cuenta_id = c.id
    LEFT JOIN polizas po ON po.id = pd.poliza_id AND po.ejercicio = ? AND po.mes <= ?
    WHERE c.acepta_movimientos = 1
    GROUP BY c.id ORDER BY c.codigo`).all(ejercicio, mes, ejercicio, mes);
  res.render('presupuestos/vs_real', { rows, ejercicio, mes, title: 'Presupuesto vs Real' });
});

module.exports = router;
