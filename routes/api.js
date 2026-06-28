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

  // Cargar saldos acumulados por mes + cuenta
  const saldos = db.prepare(`SELECT clave, CAST(valor AS REAL) as valor
    FROM configuracion WHERE clave LIKE ?`).all('saldo_' + ejercicio + '_%');

  // Agrupar por cuenta: { codigo: { '01': cum, '02': cum, ... } }
  const cuentas = {};
  for (const s of saldos) {
    const parts = s.clave.split('_');
    if (parts.length < 4) continue;
    const mes = parts[2];
    const codigo = parts.slice(3).join('_');
    if (!cuentas[codigo]) cuentas[codigo] = {};
    cuentas[codigo][mes] = s.valor;
  }

  // Calcular flujo mensual = cum(m) - cum(m-1)
  const mensual = [];
  let prevIngresos = 0, prevEgresos = 0;
  for (let m = 1; m <= 12; m++) {
    const ms = String(m).padStart(2, '0');
    let ingresos = 0, egresos = 0;
    for (const [codigo, meses] of Object.entries(cuentas)) {
      const cum = meses[ms] || 0;
      const prev = meses[String(m - 1).padStart(2, '0')] || 0;
      const flujo = cum - prev;
      const d = codigo.replace(/^0+/, '')[0];
      if (d === '4') ingresos += flujo;
      else if (d === '5' || d === '6') egresos += flujo;
    }
    mensual.push({ mes: m, ingresos: Math.round(ingresos * 100) / 100, egresos: Math.round(egresos * 100) / 100 });
  }

  res.json({ mensual });
});

module.exports = router;
