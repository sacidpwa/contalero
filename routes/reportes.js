const express = require('express');
const router = express.Router();
const { getDB } = require('../database/schema');
const { getSaldos, getBalanceGeneral, getEstadoResultados } = require('../services/contabilidad');

router.get('/balanza', (req, res) => {
  const db = getDB();
  const mes = parseInt(req.query.mes || req.session.mes || 6);
  const ejercicio = parseInt(req.query.ejercicio || req.session.ejercicio || 2026);
  const cuentas = db.prepare(`SELECT c.id, c.codigo, c.nombre, c.naturaleza,
    COALESCE(SUM(pd.debe), 0) as debe, COALESCE(SUM(pd.haber), 0) as haber
    FROM cuentas c
    LEFT JOIN polizas_detalle pd ON pd.cuenta_id = c.id
    LEFT JOIN polizas p ON p.id = pd.poliza_id AND p.ejercicio = ? AND p.mes <= ?
    WHERE c.acepta_movimientos = 1
    GROUP BY c.id ORDER BY c.codigo`).all(ejercicio, mes);
  res.render('reportes/balanza', { cuentas, mes, ejercicio, title: 'Balanza de Comprobación' });
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

function buildERdata(ejercicio, desde, hasta) {
  const saldos = getSaldos(ejercicio, hasta, true);
  const saldosAnt = desde > 1 ? getSaldos(ejercicio, desde - 1, true) : null;

  function signed(s) { return s.naturaleza === 'A' ? s.saldo : -s.saldo; }
  const antMap = {};
  if (saldosAnt) for (const s of saldosAnt) antMap[s.codigo] = signed(s);

  // Group definitions for gastos de operación (6xxx)
  const gastosOpDef = {
    venta: { label: 'Gastos de Operación', prefix: '61' },
    admin: { label: 'Gastos de Administración', prefix: '62' },
    depreciacion: { label: 'Depreciación de Planta y Equipo', prefix: '63' },
    amortizacion: { label: 'Amortización de Gastos Diferidos', prefix: '64' },
    otros: { label: 'Otros Gastos', prefix: '' },
  };
  function getGastoGroup(codigo) {
    const d2 = codigo.replace(/^0+/, '').substring(0, 2);
    for (const [k, v] of Object.entries(gastosOpDef)) {
      if (d2 === v.prefix) return k;
    }
    return 'otros';
  }

  // Group definitions for otros ingresos/gastos (7xxx)
  const otrosDef = {
    productosFinancieros: { label: 'Productos Financieros', prefix: '71', type: 'A' },
    gastosFinancieros: { label: 'Gastos Financieros', prefix: '72', type: 'D' },
    otrosProductos: { label: 'Otros Productos', prefix: '73', type: 'A' },
    otrosGastos: { label: 'Otros Gastos', prefix: '74', type: 'D' },
  };
  function getOtrosGroup(codigo) {
    const d2 = codigo.replace(/^0+/, '').substring(0, 2);
    for (const [k, v] of Object.entries(otrosDef)) {
      if (d2 === v.prefix) return k;
    }
    return null;
  }

  // Pre-populate gastosOp groups from ALL 6xxx leaf accounts
  const db = getDB();
  const allGastos = db.prepare("SELECT codigo, nombre FROM cuentas WHERE codigo LIKE '6%' AND acepta_movimientos = 1").all();
  const gastosOp = { venta: [], admin: [], depreciacion: [], amortizacion: [], otros: [] };
  for (const g of allGastos) {
    const grp = getGastoGroup(g.codigo);
    if (gastosOp[grp]) gastosOp[grp].push({ codigo: g.codigo, nombre: g.nombre, perVal: 0, ytdVal: 0, perPct: 0, ytdPct: 0 });
  }

  // Pre-populate otrosGrupos from ALL 7xxx leaf accounts
  const allOtros = db.prepare("SELECT codigo, nombre, naturaleza FROM cuentas WHERE codigo LIKE '7%' AND acepta_movimientos = 1").all();
  const otrosGrupos = { productosFinancieros: [], gastosFinancieros: [], otrosProductos: [], otrosGastos: [] };
  for (const g of allOtros) {
    const grp = getOtrosGroup(g.codigo);
    if (grp && otrosGrupos[grp]) otrosGrupos[grp].push({ codigo: g.codigo, nombre: g.nombre, perVal: 0, ytdVal: 0, perPct: 0, ytdPct: 0 });
  }

  // Now fill in actual balances from saldos
  const cats = { '4': [], '5': [] };
  let ventasPer = 0, ventasYTD = 0;

  for (const s of saldos) {
    const d = s.codigo.replace(/^0+/, '')[0];
    if (d !== '4' && d !== '5' && d !== '6' && d !== '7') continue;
    const ytd = signed(s);
    const per = ytd - (antMap[s.codigo] || 0);
    if (Math.abs(ytd) < 0.01 && Math.abs(per) < 0.01 && d !== '6') continue;

    if (d === '7') {
      const grp = getOtrosGroup(s.codigo);
      if (grp && otrosGrupos[grp]) {
        const ytdVal = s.naturaleza === 'D' ? Math.abs(ytd) : ytd;
        const perVal = s.naturaleza === 'D' ? Math.abs(per) : per;
        const existing = otrosGrupos[grp].find(x => x.codigo === s.codigo);
        if (existing) { existing.perVal = perVal; existing.ytdVal = ytdVal; }
      }
      continue;
    }

    let key = d;
    const ytdVal = (d === '5' || d === '6') ? Math.abs(ytd) : ytd;
    const perVal = (d === '5' || d === '6') ? Math.abs(per) : per;

    if (d === '6') {
      const grp = getGastoGroup(s.codigo);
      if (gastosOp[grp]) {
        const existing = gastosOp[grp].find(x => x.codigo === s.codigo);
        if (existing) { existing.perVal = perVal; existing.ytdVal = ytdVal; }
      }
    } else if (cats[key]) {
      cats[key].push({ codigo: s.codigo, nombre: s.nombre, perVal, ytdVal });
    }
    if (key === '4') { ventasPer += perVal; ventasYTD += ytdVal; }
  }

  function sum(arr, field) { return arr.reduce((a, c) => a + c[field], 0); }

  function pct(v, base) { return base !== 0 ? (v / base) * 100 : 0; }
  function addPct(arr) {
    arr.forEach(c => {
      c.perPct = pct(c.perVal, ventasPer);
      c.ytdPct = pct(c.ytdVal, ventasYTD);
    });
  }

  addPct(cats['4']); addPct(cats['5']);
  // Flatten gastosOp for percentage calculation and formula totals
  const gastosFlat = [];
  const gastosOpTotals = {};
  for (const [k, items] of Object.entries(gastosOp)) {
    addPct(items);
    gastosFlat.push(...items);
    gastosOpTotals[k] = { perVal: Math.abs(sum(items, 'perVal')), ytdVal: Math.abs(sum(items, 'ytdVal')) };
  }
  // Add percentages to otrosGrupos and calculate totals
  const otrosGrupoTotals = {};
  for (const [k, items] of Object.entries(otrosGrupos)) {
    addPct(items);
    otrosGrupoTotals[k] = { perVal: sum(items, 'perVal'), ytdVal: sum(items, 'ytdVal') };
  }

  const tIngPer = sum(cats['4'], 'perVal');
  const tIngYTD = sum(cats['4'], 'ytdVal');
  const tCosPer = Math.abs(sum(cats['5'], 'perVal'));
  const tCosYTD = Math.abs(sum(cats['5'], 'ytdVal'));
  const tGasPer = Math.abs(sum(gastosFlat, 'perVal'));
  const tGasYTD = Math.abs(sum(gastosFlat, 'ytdVal'));
  const tOIPer = sum(otrosGrupos.productosFinancieros, 'perVal') + sum(otrosGrupos.otrosProductos, 'perVal');
  const tOIYTD = sum(otrosGrupos.productosFinancieros, 'ytdVal') + sum(otrosGrupos.otrosProductos, 'ytdVal');
  const tOGPer = sum(otrosGrupos.gastosFinancieros, 'perVal') + sum(otrosGrupos.otrosGastos, 'perVal');
  const tOGYTD = sum(otrosGrupos.gastosFinancieros, 'ytdVal') + sum(otrosGrupos.otrosGastos, 'ytdVal');

  const uBrutaPer = tIngPer - tCosPer;
  const uBrutaYTD = tIngYTD - tCosYTD;
  const uOperPer = uBrutaPer - tGasPer;
  const uOperYTD = uBrutaYTD - tGasYTD;
  const uNetaPer = uOperPer + tOIPer - tOGPer;
  const uNetaYTD = uOperYTD + tOIYTD - tOGYTD;

  return {
    ingresos: cats['4'], costos: cats['5'],
    gastosOp, gastosOpTotals, gastosOpDef,
    otrosGrupos, otrosGrupoTotals, otrosDef,
    totalIngresosPer: tIngPer, totalIngresosYTD: tIngYTD,
    totalCostosPer: tCosPer, totalCostosYTD: tCosYTD,
    totalGastosPer: tGasPer, totalGastosYTD: tGasYTD,
    totalOtrosIngresosPer: tOIPer, totalOtrosIngresosYTD: tOIYTD,
    totalOtrosGastosPer: tOGPer, totalOtrosGastosYTD: tOGYTD,
    utilidadBrutaPer: uBrutaPer, utilidadBrutaYTD: uBrutaYTD,
    utilidadOperacionPer: uOperPer, utilidadOperacionYTD: uOperYTD,
    utilidadNetaPer: uNetaPer, utilidadNetaYTD: uNetaYTD,
    ventasPer, ventasYTD
  };
}

router.get('/resultados', (req, res) => {
  const ejercicio = parseInt(req.query.ejercicio || req.session.ejercicio || 2026);
  const desde = parseInt(req.query.desde || 1);
  const hasta = parseInt(req.query.hasta || req.session.mes || 6);
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const diasMes = new Date(ejercicio, hasta, 0).getDate();

  const er = buildERdata(ejercicio, desde, hasta);

  res.render('reportes/resultados', {
    er, desde, hasta, ejercicio, diasMes, meses, title: 'Estado de Resultados'
  });
});

router.get('/resultados/formal', (req, res) => {
  const ejercicio = parseInt(req.query.ejercicio || req.session.ejercicio || 2026);
  const desde = parseInt(req.query.desde || 1);
  const hasta = parseInt(req.query.hasta || req.session.mes || 6);
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const diasMes = new Date(ejercicio, hasta, 0).getDate();

  const db = getDB();
  const emp = db.prepare("SELECT valor FROM configuracion WHERE clave = 'empresa_nombre'").get();
  const empresa = emp ? emp.valor : '';

  const er = buildERdata(ejercicio, desde, hasta);

  res.render('reportes/resultados_formal', {
    er, desde, hasta, ejercicio, diasMes, meses, empresa, title: 'Estado de Resultados'
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
