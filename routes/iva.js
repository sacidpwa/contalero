const express = require('express');
const router = express.Router();
const { getIVA } = require('../services/contabilidad');

router.get('/', (req, res) => {
  const mes = parseInt(req.query.mes || req.session.mes || 6);
  const ejercicio = parseInt(req.query.ejercicio || req.session.ejercicio || 2026);
  const iva = getIVA(ejercicio, mes);
  res.render('iva/reporte', { iva, mes, ejercicio, title: 'IVA' });
});

module.exports = router;
