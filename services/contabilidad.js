const { getDB } = require('../database/schema');

function db() { return getDB(); }

function getSaldos(ejercicio, mes, soloDetalle) {
  const prefix = 'saldo_' + ejercicio + '_';
  const useConfig = db().prepare("SELECT COUNT(*) as c FROM configuracion WHERE clave LIKE ?").get(prefix + '%').c > 0;

  if (useConfig) {
    // Modo COI importado: usar saldos de configuracion (fuente única y consistente)
    const sqlDetalle = soloDetalle ? ' WHERE c.acepta_movimientos = 1' : '';
    const rows = db().prepare(`SELECT c.id, c.codigo, c.nombre, c.nivel, c.naturaleza, c.acepta_movimientos,
      c.centro_costos, c.tipo_sat FROM cuentas c${sqlDetalle} ORDER BY c.codigo`).all();
    const confSaldos = db().prepare("SELECT clave, CAST(valor AS REAL) as v FROM configuracion WHERE clave LIKE ?").all(prefix + '%');
    const saldoMap = {};
    for (const c of confSaldos) {
      const parts = c.clave.split('_');
      if (parts.length >= 4) {
        const m = parts[2];
        const code = parts.slice(3).join('_');
        if (!saldoMap[code]) saldoMap[code] = {};
        saldoMap[code][m] = c.v;
      }
    }
    const sm = String(mes).padStart(2, '0');
    return rows.map(r => {
      let val = 0;
      if (saldoMap[r.codigo]) {
        for (let m = mes; m >= 1; m--) {
          const sm2 = String(m).padStart(2, '0');
          if (saldoMap[r.codigo][sm2] !== undefined) {
            val = saldoMap[r.codigo][sm2];
            break;
          }
        }
      }
      return { ...r, debe: 0, haber: 0, saldo: val };
    });
  }

  // Modo manual (sin importar COI): calcular desde polizas_detalle
  let sql = `SELECT c.id, c.codigo, c.nombre, c.nivel, c.naturaleza, c.acepta_movimientos,
    c.centro_costos, c.tipo_sat,
    COALESCE(SUM(CASE WHEN pd.id IS NOT NULL THEN pd.debe ELSE 0 END), 0) as debe,
    COALESCE(SUM(CASE WHEN pd.id IS NOT NULL THEN pd.haber ELSE 0 END), 0) as haber
  FROM cuentas c
  LEFT JOIN polizas_detalle pd ON pd.cuenta_id = c.id
  LEFT JOIN polizas p ON p.id = pd.poliza_id AND p.ejercicio = ? AND p.mes <= ?`;
  if (soloDetalle) sql += ' AND c.acepta_movimientos = 1';
  sql += ' GROUP BY c.id ORDER BY c.codigo';

  const rows = db().prepare(sql).all(ejercicio, mes);
  return rows.map(r => {
    const saldo = r.naturaleza === 'D' ? r.debe - r.haber : r.haber - r.debe;
    return { ...r, saldo };
  });
}

function getSaldosAcumulados(ejercicio, mes) {
  const cuentas = db().prepare(`SELECT * FROM cuentas ORDER BY codigo`).all();
  const movs = db().prepare(`SELECT pd.cuenta_id, SUM(pd.debe) as debe, SUM(pd.haber) as haber
    FROM polizas_detalle pd JOIN polizas p ON p.id = pd.poliza_id
    WHERE p.ejercicio = ? AND p.mes <= ?
    GROUP BY pd.cuenta_id`).all(ejercicio, mes);

  const saldos = {};
  for (const m of movs) {
    saldos[m.cuenta_id] = { debe: m.debe, haber: m.haber };
  }

  function calcSaldosNivel(padre) {
    const hijos = cuentas.filter(c => c.cuenta_padre === padre);
    let totalDebe = 0, totalHaber = 0;
    for (const h of hijos) {
      if (h.acepta_movimientos) {
        const s = saldos[h.id] || { debe: 0, haber: 0 };
        h.debe = s.debe;
        h.haber = s.haber;
        h.saldo = h.naturaleza === 'D' ? s.debe - s.haber : s.haber - s.debe;
        totalDebe += s.debe;
        totalHaber += s.haber;
      } else {
        const subs = calcSaldosNivel(h.codigo);
        h.debe = subs.debe;
        h.haber = subs.haber;
        h.saldo = h.naturaleza === 'D' ? subs.debe - subs.haber : subs.haber - subs.debe;
        totalDebe += h.debe;
        totalHaber += h.haber;
      }
    }
    return { debe: totalDebe, haber: totalHaber };
  }
  calcSaldosNivel(null);
  return cuentas;
}

function getEstadoResultados(ejercicio, mes) {
  const saldos = getSaldos(ejercicio, mes, true);
  let ingresos = 0, costos = 0, gastos = 0, otrosIngresos = 0, otrosGastos = 0;
  for (const s of saldos) {
    const d = s.codigo.replace(/^0+/, '')[0];
    if (d === '4') ingresos += s.naturaleza === 'A' ? s.saldo : -s.saldo;
    else if (d === '5') costos += s.naturaleza === 'D' ? s.saldo : -s.saldo;
    else if (d === '6') gastos += s.naturaleza === 'D' ? s.saldo : -s.saldo;
    else if (d === '7') {
      if (s.naturaleza === 'A') otrosIngresos += s.saldo;
      else otrosGastos += s.saldo;
    }
  }
  const utilidad = ingresos + otrosIngresos - costos - gastos - otrosGastos;
  return { ingresos, costos, gastos, otrosIngresos, otrosGastos, utilidad, saldos };
}

function getBalanceGeneral(ejercicio, mes) {
  const saldos = getSaldos(ejercicio, mes, true);
  let activo = 0, pasivo = 0, capital = 0;
  for (const s of saldos) {
    if (s.codigo.startsWith('1')) activo += s.naturaleza === 'D' ? s.saldo : -s.saldo;
    if (s.codigo.startsWith('2')) pasivo += s.naturaleza === 'A' ? s.saldo : -s.saldo;
    if (s.codigo.startsWith('3')) capital += s.naturaleza === 'A' ? s.saldo : -s.saldo;
  }
  const er = getEstadoResultados(ejercicio, mes);
  capital += er.utilidad;
  return { activo, pasivo, capital, saldos };
}

function getIVA(ejercicio, mes) {
  // Buscar cuentas de IVA por nombre (no por código fijo, para compatibilidad COI)
  function buscarCuentaIva(tipo) {
    const rows = db().prepare(`SELECT codigo FROM cuentas
      WHERE (codigo LIKE ? OR codigo LIKE ? OR nombre LIKE ? OR nombre LIKE ?) AND acepta_movimientos = 1
      LIMIT 1`).all(...tipo);
    return rows.length > 0 ? rows[0].codigo + '%' : null;
  }

  const ivaAcrPatron = buscarCuentaIva(['1108%', '1200001%', 'IVA ACREDITABLE%', 'IVA A FAVOR%']);
  const ivaTrasPatron = buscarCuentaIva(['2104%', '218%', 'IVA TRASLADADO%', 'IMPUESTOS TRASLADADOS%']);

  const ivaAcr = db().prepare(`SELECT COALESCE(SUM(pd.debe), 0) as total
    FROM polizas_detalle pd JOIN polizas p ON p.id = pd.poliza_id
    JOIN cuentas c ON c.id = pd.cuenta_id
    WHERE p.ejercicio = ? AND p.mes <= ? AND c.codigo LIKE ?`).get(ejercicio, mes, ivaAcrPatron || '___');

  const ivaTras = db().prepare(`SELECT COALESCE(SUM(pd.haber), 0) as total
    FROM polizas_detalle pd JOIN polizas p ON p.id = pd.poliza_id
    JOIN cuentas c ON c.id = pd.cuenta_id
    WHERE p.ejercicio = ? AND p.mes <= ? AND c.codigo LIKE ?`).get(ejercicio, mes, ivaTrasPatron || '___');

  return {
    iva_acreditable: ivaAcr.total,
    iva_trasladado: ivaTras.total,
    iva_por_pagar: ivaTras.total - ivaAcr.total,
    iva_a_favor: ivaAcr.total > ivaTras.total ? ivaAcr.total - ivaTras.total : 0
  };
}

function getSiguienteNumero(tipo, ejercicio) {
  const r = db().prepare(`SELECT COALESCE(MAX(numero), 0) + 1 as n FROM polizas WHERE tipo = ? AND ejercicio = ?`).get(tipo, ejercicio);
  return r.n;
}

function crearPoliza(tipo, fecha, concepto, detalles) {
  const ejercicio = parseInt(fecha.substring(0, 4));
  const mes = parseInt(fecha.substring(5, 7));
  const numero = getSiguienteNumero(tipo, ejercicio);

  const insertPoliza = db().prepare(`INSERT INTO polizas (tipo, numero, fecha, concepto, mes, ejercicio) VALUES (?, ?, ?, ?, ?, ?)`);
  const insertDetalle = db().prepare(`INSERT INTO polizas_detalle (poliza_id, cuenta_id, auxiliar_id, centro_costo_id, departamento_id, concepto, debe, haber, referencia) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const trx = db().transaction(() => {
    const result = insertPoliza.run(tipo, numero, fecha, concepto, mes, ejercicio);
    const polizaId = result.lastInsertRowid;
    for (const d of detalles) {
      insertDetalle.run(polizaId, d.cuenta_id, d.auxiliar_id || null, d.centro_costo_id || 1, d.departamento_id || 1, d.concepto || concepto, d.debe || 0, d.haber || 0, d.referencia || null);
    }
    return polizaId;
  });

  return trx();
}

module.exports = { getSaldos, getSaldosAcumulados, getEstadoResultados, getBalanceGeneral, getIVA, getSiguienteNumero, crearPoliza };
