const express = require('express');
const router = express.Router();
const { getDB } = require('../database/schema');
const { getSaldos, getBalanceGeneral, getEstadoResultados } = require('../services/contabilidad');

router.get('/balanza', (req, res) => {
  const mes = parseInt(req.query.mes || req.session.mes || 6);
  const ejercicio = parseInt(req.query.ejercicio || req.session.ejercicio || 2026);
  const saldos = getSaldos(ejercicio, mes);
  res.render('reportes/balanza', { saldos, mes, ejercicio, title: 'Balanza de Comprobación' });
});

router.get('/mayor', (req, res) => {
  const db = getDB();
  const codigo = req.query.codigo || '';
  const mes = parseInt(req.query.mes || req.session.mes || 6);
  const ejercicio = parseInt(req.query.ejercicio || req.session.ejercicio || 2026);
  const cuentas = db.prepare('SELECT * FROM cuentas WHERE activo = 1 ORDER BY codigo').all();

  let movimientos = [];
  let cuenta = null;
  if (codigo) {
    cuenta = db.prepare('SELECT * FROM cuentas WHERE codigo = ?').get(codigo);
    if (cuenta) {
      movimientos = db.prepare(`SELECT pd.*, p.fecha, p.numero, p.tipo, p.concepto as poliza_concepto,
        a.nombre as auxiliar_nombre
        FROM polizas_detalle pd
        JOIN polizas p ON p.id = pd.poliza_id
        LEFT JOIN auxiliares a ON a.id = pd.auxiliar_id
        WHERE pd.cuenta_id = ? AND p.ejercicio = ? AND p.mes <= ?
        ORDER BY p.fecha, p.tipo, p.numero`).all(cuenta.id, ejercicio, mes);
    }
  }

  res.render('reportes/mayor', { cuentas, cuenta, movimientos, codigo, mes, ejercicio, title: 'Mayor de Cuentas' });
});

router.get('/resultados', (req, res) => {
  const mes = parseInt(req.query.mes || req.session.mes || 6);
  const ejercicio = parseInt(req.query.ejercicio || req.session.ejercicio || 2026);
  const saldos = getSaldos(ejercicio, mes);
  const diasMes = new Date(ejercicio, mes, 0).getDate();
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  let ingresos = [], costos = [], gastos = [], otrosIngresos = [], otrosGastos = [];
  for (const s of saldos) {
    const item = { codigo: s.codigo, nombre: s.nombre, saldo: s.naturaleza === 'A' ? s.saldo : -s.saldo };
    if (s.codigo.startsWith('4')) ingresos.push(item);
    else if (s.codigo.startsWith('5')) costos.push(item);
    else if (s.codigo.startsWith('6')) gastos.push(item);
    else if (s.codigo.startsWith('7')) {
      if (s.naturaleza === 'A') otrosIngresos.push(item);
      else otrosGastos.push(item);
    }
  }
  ingresos = ingresos.filter(c => Math.abs(c.saldo) > 0.01);
  costos = costos.filter(c => Math.abs(c.saldo) > 0.01);
  gastos = gastos.filter(c => Math.abs(c.saldo) > 0.01);
  otrosIngresos = otrosIngresos.filter(c => Math.abs(c.saldo) > 0.01);
  otrosGastos = otrosGastos.filter(c => Math.abs(c.saldo) > 0.01);

  const totalIngresos = ingresos.reduce((a, c) => a + c.saldo, 0);
  const totalCostos = costos.reduce((a, c) => a + c.saldo, 0);
  const totalGastos = gastos.reduce((a, c) => a + c.saldo, 0);
  const totalOtrosIngresos = otrosIngresos.reduce((a, c) => a + c.saldo, 0);
  const totalOtrosGastos = otrosGastos.reduce((a, c) => a + c.saldo, 0);
  const utilidadBruta = totalIngresos - totalCostos;
  const utilidadOperacion = utilidadBruta - totalGastos;
  const utilidadNeta = utilidadOperacion + totalOtrosIngresos - totalOtrosGastos;

  res.render('reportes/resultados', {
    ingresos, costos, gastos, otrosIngresos, otrosGastos,
    totalIngresos, totalCostos, totalGastos, totalOtrosIngresos: 0, totalOtrosGastos,
    utilidadBruta, utilidadOperacion, utilidadNeta,
    mes, ejercicio, diasMes, meses, title: 'Estado de Resultados'
  });
});

router.get('/balance', (req, res) => {
  const mes = parseInt(req.query.mes || req.session.mes || 6);
  const ejercicio = parseInt(req.query.ejercicio || req.session.ejercicio || 2026);
  const saldos = getSaldos(ejercicio, mes, true);
  const bg = getBalanceGeneral(ejercicio, mes);
  const er = getEstadoResultados(ejercicio, mes);
  const diasMes = new Date(ejercicio, mes, 0).getDate();
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  let activoCirculante = [], activoNoCirculante = [];
  let pasivoCirculante = [], pasivoNoCirculante = [];
  let capital = [];

  function codePrefix(codigo, len) {
    return codigo.replace(/^0+/, '').substring(0, len);
  }

  for (const s of saldos) {
    // Firmas correctas según grupo (misma lógica que getBalanceGeneral)
    const d = s.codigo.replace(/^0+/, '')[0];
    let signedSaldo;
    if (d === '1') signedSaldo = s.naturaleza === 'D' ? s.saldo : -s.saldo;
    else signedSaldo = s.naturaleza === 'A' ? s.saldo : -s.saldo;

    if (Math.abs(signedSaldo) < 0.01) continue;
    const item = { codigo: s.codigo, nombre: s.nombre, saldo: signedSaldo };
    const p3 = codePrefix(s.codigo, 3);
    const p2 = codePrefix(s.codigo, 2);

    // Clasificación por rango de códigos (soporta COI y códigos cortos)
    if (/^1(1[1-9]|2[0-9])/.test(p3) || p2 === '11') {
      activoCirculante.push(item);
    } else if (/^1(3[1-9]|4[0-9]|5[0-9]|6[0-9]|7[0-9]|8[0-9]|9[0-9])/.test(p3) || p2 === '12') {
      activoNoCirculante.push(item);
    } else if (/^2(1[1-9]|2[0-9])/.test(p3) || p2 === '21') {
      pasivoCirculante.push(item);
    } else if (/^2(3[0-9]|4[0-9]|5[0-9]|6[0-9]|7[0-9]|8[0-9]|9[0-9])/.test(p3) || p2 === '22') {
      pasivoNoCirculante.push(item);
    } else if (/^3/.test(p3) || p2 === '3') {
      // Todas las cuentas 3xxx se muestran como Capital
      capital.push(item);
    }
  }

  const totalActivo = bg.activo;
  const totalPasivo = bg.pasivo;
  const utilidadNeta = er.utilidad;
  const totalCapital = bg.capital - utilidadNeta;
  const totalActivoCirculante = activoCirculante.reduce((a, c) => a + c.saldo, 0);
  const totalActivoNoCirculante = activoNoCirculante.reduce((a, c) => a + c.saldo, 0);
  const totalPasivoCirculante = pasivoCirculante.reduce((a, c) => a + c.saldo, 0);
  const totalPasivoNoCirculante = pasivoNoCirculante.reduce((a, c) => a + c.saldo, 0);
  const totalPasivoCapital = totalPasivo + totalCapital + utilidadNeta;

  res.render('reportes/balance', {
    activoCirculante, activoNoCirculante, pasivoCirculante, pasivoNoCirculante, capital,
    totalActivoCirculante, totalActivoNoCirculante, totalActivo,
    totalPasivoCirculante, totalPasivoNoCirculante, totalPasivoCapital,
    utilidadNeta, mes, ejercicio, diasMes, meses, title: 'Balance General'
  });
});

module.exports = router;
