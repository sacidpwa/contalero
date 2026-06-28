const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ISQL_DIR = path.join(__dirname, '..', '..', 'convertidor fdb', 'firebird_embedded');
const ISQL = path.join(ISQL_DIR, 'isql.exe');

function queryFDB(fdbPath, sql) {
  const tmpSql = path.join(os.tmpdir(), '_import_' + Date.now() + '.sql');
  fs.writeFileSync(tmpSql, sql, 'latin1');
  try {
    return execFileSync(ISQL, [
      '-user', 'SYSDBA', '-password', 'masterkey',
      '-i', tmpSql, '-ch', 'ISO8859_1',
      '-b', '-q', '-n', fdbPath
    ], { cwd: ISQL_DIR, encoding: 'latin1', maxBuffer: 800 * 1024 * 1024, timeout: 120000 });
  } finally {
    try { fs.unlinkSync(tmpSql); } catch (e) {}
  }
}

function parseTable(out, columns) {
  const rows = [];
  let started = false;
  for (const line of out.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (/^=+$/.test(t)) { started = true; continue; }
    if (!started || t.startsWith('RDB$') || /^CONCAT\d*$/.test(t)) continue;
    const parts = t.split('||||');
    if (parts.length === columns.length) {
      const row = {};
      columns.forEach((c, i) => { row[c] = parts[i] || ''; });
      rows.push(row);
    }
  }
  return rows;
}

function getFDBTables(fdbPath) {
  const sql = `SELECT RDB$RELATION_NAME FROM RDB$RELATIONS WHERE RDB$SYSTEM_FLAG = 0 AND RDB$RELATION_NAME NOT LIKE '%$%' AND RDB$RELATION_NAME NOT LIKE 'RDB$%' ORDER BY 1; QUIT;`;
  const out = queryFDB(fdbPath, sql);
  const tables = [];
  for (const line of out.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t === 'RDB$RELATION_NAME' || /^=+$/.test(t) || t.startsWith('RDB$')) continue;
    tables.push(t);
  }
  return tables;
}

function getFDBColumns(fdbPath, tableName) {
  const sql = `SHOW TABLE "${tableName}"; QUIT;`;
  const out = queryFDB(fdbPath, sql);
  const cols = [];
  for (const line of out.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('CONSTRAINT') || t.startsWith('Primary') || t.startsWith('Foreign') || t.startsWith('Unique')) continue;
    const m = t.match(/^(\S+)\s+/);
    if (m && m[1]) {
      const c = m[1].trim();
      if (c && c.length > 0 && !c.startsWith('RDB$')) cols.push(c);
    }
  }
  return cols;
}

function getFDBData(fdbPath, tableName, columns) {
  const sel = columns.map(c => `COALESCE("${c}",'')`).join("||'||||'||");
  const sql = `SELECT ${sel} FROM "${tableName}"; QUIT;`;
  const out = queryFDB(fdbPath, sql);
  return parseTable(out, columns);
}

function safe(fn, def) {
  try { return fn(); } catch (e) { return def; }
}

function importarFDB(fdbPath, opts) {
  try {
    if (!fs.existsSync(ISQL)) return { error: 'No se encuentra isql.exe en ' + ISQL_DIR };
    if (!fs.existsSync(fdbPath)) return { error: 'No se encuentra el archivo .fdb' };

    const tables = getFDBTables(fdbPath);
    const log = [];
    const res = { cuentas: 0, auxiliares: 0, deptos: 0, polizas: 0, detalles: 0, saldos: 0, empresas: 0, conpeptos: 0, years: [] };

    const { getDB } = require('../database/schema');
    const db = getDB();

    const runSql = (sql) => { try { db.exec(sql); } catch(e) { /* ignore */ } };

    // Always clean existing data on import (fresh import)
    runSql('PRAGMA foreign_keys = OFF');
    runSql('DELETE FROM polizas_detalle');
    runSql('DELETE FROM polizas');
    runSql('DELETE FROM presupuestos');
    runSql('DELETE FROM auxiliares');
    runSql('DELETE FROM departamentos');
    runSql('DELETE FROM centros_costos');
    runSql('DELETE FROM cuentas');
    runSql('DELETE FROM recurrentes');
    runSql('DELETE FROM recurrentes_detalle');
    runSql('DELETE FROM depreciaciones');
    runSql('DELETE FROM configuracion');
    runSql('PRAGMA foreign_keys = ON');

    const ic = db.prepare('INSERT OR IGNORE INTO cuentas (codigo, nombre, nivel, naturaleza, tipo_sat, acepta_movimientos, activo, cuenta_padre) VALUES (?, ?, ?, ?, ?, ?, 1, ?)');
    const ia = db.prepare('INSERT OR IGNORE INTO auxiliares (codigo, nombre, rfc, tipo) VALUES (?, ?, ?, ?)');
    const idp = db.prepare('INSERT OR IGNORE INTO departamentos (codigo, nombre) VALUES (?, ?)');
    const icc = db.prepare('INSERT OR IGNORE INTO centros_costos (codigo, nombre) VALUES (?, ?)');
    const ip = db.prepare('INSERT OR IGNORE INTO polizas (tipo, numero, fecha, concepto, mes, ejercicio) VALUES (?, ?, ?, ?, ?, ?)');
    const ipd = db.prepare('INSERT INTO polizas_detalle (poliza_id, cuenta_id, debe, haber, concepto, referencia) VALUES (?, ?, ?, ?, ?, ?)');
    const gpi = db.prepare('SELECT id FROM polizas WHERE tipo = ? AND numero = ? AND ejercicio = ?');
    const gci = db.prepare('SELECT id, nombre FROM cuentas WHERE codigo = ?');
    const ucfg = db.prepare('INSERT OR REPLACE INTO configuracion (clave, valor) VALUES (?, ?)');
    const ipp = db.prepare('INSERT OR IGNORE INTO presupuestos (cuenta_id, mes, ejercicio, presupuesto) VALUES (?, ?, ?, ?)');

    const typeMap = { I: 'I', E: 'E', D: 'D', O: 'O', Dr: 'D', Ig: 'I', Eg: 'E', Tr: 'O' };

    const importYear = (year) => {
      if (!year) return;
      res.years.push(year);
      const ys = String(year).slice(-2);

      const ctaTable = tables.find(t => t === 'CUENTAS' + ys);
      if (!ctaTable) { log.push('Año ' + year + ': no se encontró CUENTAS' + ys); return; }

      const ctaCols = getFDBColumns(fdbPath, ctaTable);
      const ctaData = getFDBData(fdbPath, ctaTable, ctaCols);
      log.push('CUENTAS' + year + ': ' + ctaData.length + ' cuentas');
      const tipoSatMap = { A: 'S', G: 'S', D: 'N', C: 'N', I: 'S', O: 'N' };
      const padres = {};
      for (const row of ctaData) {
        const codigo = safe(() => (row.NUM_CTA || '').trim().replace(/^0+/, ''), '');
        const nombre = safe(() => (row.NOMBRE || '').trim(), '');
        if (!codigo || !nombre) continue;
        const nivel = safe(() => parseInt(row.NIVEL) || 1, 1);
        const natVal = safe(() => parseInt(row.NATURALEZA), 0);
        const naturaleza = natVal === 1 ? 'A' : 'D';
        const tipoSat = tipoSatMap[(row.TIPO || '').trim()] || 'N';
        const acepta = row.BANDMULTI === '0' || row.BANDMULTI === 0 ? 0 : 1;
        const ctaPapa = (row.CTA_PAPA || '').trim();
        const padre = (ctaPapa && ctaPapa !== '-1') ? ctaPapa.replace(/^0+/, '') : null;
        padres[codigo] = padre;
        safe(() => ic.run(codigo, nombre, nivel, naturaleza, tipoSat, acepta, padre), null);
      }
      res.cuentas += ctaData.length;

      // Note: COI also has AUXILIAR{YY} tables with ALL poliza detail (DEBE_HABER, MONTOMOV, NUM_CTA)
      // Skipped here because they contain 40k+ rows which would cause timeout; OPETER/OPEIET suffice

      const salTable = tables.find(t => t === 'SALDOS' + ys);
      if (salTable) {
        const salCols = getFDBColumns(fdbPath, salTable);
        const salData = getFDBData(fdbPath, salTable, salCols);
        log.push('SALDOS' + year + ': ' + salData.length);
        for (const row of salData) {
          for (let m = 1; m <= 12; m++) {
            const sm = String(m).padStart(2, '0');
            const sk = 'SALDO' + sm;
            const v = safe(() => row[sk], undefined);
            if (v !== undefined && v !== '') {
              safe(() => ucfg.run('saldo_' + year + '_' + sm + '_' + (row.NUM_CTA || '').trim().replace(/^0+/, ''), v), null);
            }
          }
        }
        res.saldos += salData.length;
      }

      const polTable = tables.find(t => t === 'POLIZAS' + ys);
      if (polTable) {
        const polCols = getFDBColumns(fdbPath, polTable);
        const polData = getFDBData(fdbPath, polTable, polCols);
        log.push('POLIZAS' + year + ': ' + polData.length + ' pólizas');
        for (const row of polData) {
          const tipoOrig = safe(() => (row.TIPO_POLI || row.TIPO_POLIZA || row.TIPOPOL || '').trim(), '');
          const tipo = typeMap[tipoOrig] || 'D';
          const numero = safe(() => parseInt(row.NUM_POLIZ || row.NUM_POLIZA || row.NUMPOL || '0') || 0, 0);
          const fechaStr = safe(() => (row.FECHA_POL || row.FECHAPOL || '').trim(), '');
          const fecha = fechaStr.substring(0, 10);
          const concepto = safe(() => (row.CONCEP_PO || row.CONCEPTO || '').trim(), '');
          const mes = safe(() => parseInt(row.PERIODO || row.MES || '1') || 1, 1);
          const ejercicio = safe(() => parseInt(row.EJERCICIO || String(year)) || year, year);
          if (tipo && numero && fecha) safe(() => ip.run(tipo, numero, fecha, concepto, mes, ejercicio), null);
        }
        res.polizas += polData.length;
      }

      const presTable = tables.find(t => t === 'PRESUP' + ys);
      if (presTable) {
        const presCols = getFDBColumns(fdbPath, presTable);
        const presData = getFDBData(fdbPath, presTable, presCols);
        log.push('PRESUP' + year + ': ' + presData.length);
        for (const row of presData) {
          const codigo = safe(() => (row.NUM_CTA || '').trim().replace(/^0+/, ''), '');
          const ctaRow = safe(() => gci.get(codigo), null);
          if (ctaRow) {
            for (let m = 1; m <= 12; m++) {
              const sm = String(m).padStart(2, '0');
              const k = 'PRESUP' + sm;
              const v = safe(() => row[k], undefined);
              if (v !== undefined && v !== '') safe(() => ipp.run(ctaRow.id, m, year, parseFloat(v) || 0), null);
            }
          }
        }
      }

      for (const opTbl of ['OPETER', 'OPEIET']) {
        if (!tables.includes(opTbl)) continue;
        const opCols = getFDBColumns(fdbPath, opTbl);
        const opData = getFDBData(fdbPath, opTbl, opCols);
        if (opData.length === 0) continue;
        let count = 0;
        for (const row of opData) {
          const fePol = safe(() => (row.FECHAPOL || '').trim(), '');
          const feYear = fePol.substring(0, 4);
          if (feYear && parseInt(feYear) !== year) continue;
          const tipoOrig = safe(() => (row.TIPOPOL || '').trim(), '');
          const tipo = typeMap[tipoOrig] || 'D';
          const numpol = safe(() => parseInt(row.NUMPOL || '0') || 0, 0);
          const polRow = safe(() => gpi.get(tipo, numpol, year), null);
          if (!polRow) continue;
          const numCta = safe(() => (row.NUMCTA || '').trim().replace(/^0+/, ''), '');
          const ctaRow = safe(() => gci.get(numCta), null);
          if (!ctaRow) continue;
          const monto = Math.abs(safe(() => parseFloat(row.MONCONIVA || row.MONDEDISR || '0') || 0, 0));
          if (monto === 0) continue;
          safe(() => ipd.run(polRow.id, ctaRow.id, tipo === 'E' || tipoOrig === 'Tr' ? 0 : monto, tipo === 'E' || tipoOrig === 'Tr' ? monto : 0, '', (row.RFCPROVE || '').trim()), null);
          count++;
        }
        if (count > 0) log.push(opTbl + ' (año ' + year + '): ' + count + ' partidas');
        res.detalles += count;
      }
    };

    if (opts.year) {
      importYear(parseInt(opts.year));
    } else {
      const years = [];
      for (const t of tables) {
        const m = t.match(/CUENTAS(\d{2})$/);
        if (m) years.push(2000 + parseInt(m[1]));
      }
      years.sort();
      for (const y of years) importYear(y);
    }

    const ccTable = tables.find(t => t === 'CCOSTOS');
    if (ccTable) {
      const cols = getFDBColumns(fdbPath, ccTable);
      const data = getFDBData(fdbPath, ccTable, cols);
      log.push('CCOSTOS: ' + data.length);
      for (const row of data) {
        const codigo = safe(() => String(row.ID || row.CODIGO || '').trim(), '');
        const nombre = safe(() => (row.DESCRIPCION || '').trim(), '');
        if (codigo && nombre) safe(() => icc.run(codigo, nombre), null);
      }
    }

    const ctaTerTable = tables.find(t => t === 'CTATER');
    if (ctaTerTable && opts.importarTerceros) {
      const cols = getFDBColumns(fdbPath, ctaTerTable);
      const data = getFDBData(fdbPath, ctaTerTable, cols);
      log.push('CTATER: ' + data.length + ' terceros');
      for (const row of data) {
        const codigo = safe(() => (row.CUENTA || '').trim(), '');
        const rfc = safe(() => (row.RFCIDFISC || '').trim(), '');
        const codeClean = codigo.replace(/^0+/, '');
        const ctaRow = safe(() => gci.get(codeClean), null);
        const nombre = ctaRow ? (ctaRow.nombre || rfc || codigo) : (rfc || codigo);
        if (codigo) safe(() => ia.run(codigo, nombre, rfc, 'C'), null);
      }
      res.auxiliares += data.length;
    }

    const deptosTable = tables.find(t => t === 'DEPTOS');
    if (deptosTable) {
      const cols = getFDBColumns(fdbPath, deptosTable);
      const data = getFDBData(fdbPath, deptosTable, cols);
      log.push('DEPTOS: ' + data.length);
      for (const row of data) {
        const codigo = safe(() => (row.CODIGO || row.DEPTO || '').trim(), '');
        const nombre = safe(() => (row.NOMBRE || '').trim(), '');
        if (codigo && nombre) safe(() => idp.run(codigo, nombre), null);
      }
    }

    const paramTable = tables.find(t => t === 'PARAMEMP');
    if (paramTable) {
      const cols = getFDBColumns(fdbPath, paramTable);
      const data = getFDBData(fdbPath, paramTable, cols);
      log.push('PARAMEMP: ' + data.length + ' registros');
      if (data.length > 0) {
        const p = data[0];
        if (p.NOMBRE) safe(() => ucfg.run('empresa_nombre', (p.NOMBRE || '').trim()), null);
        if (p.RFCCIA) safe(() => ucfg.run('empresa_rfc', (p.RFCCIA || '').trim()), null);
        if (p.DOMICILIO) safe(() => ucfg.run('empresa_direccion', (p.DOMICILIO || '').trim()), null);
        res.empresas++;
      }
    }

    const concTable = tables.find(t => t === 'CONCEPTO');
    if (concTable) {
      const cols = getFDBColumns(fdbPath, concTable);
      const data = getFDBData(fdbPath, concTable, cols);
      log.push('CONCEPTO: ' + data.length + ' conceptos');
      res.conpeptos += data.length;
    }

    // Ensure default config entries exist
    const defs = [
      ['empresa_nombre', 'Mi Empresa'], ['empresa_rfc', 'XXXX000101XXX'],
      ['ejercicio_actual', String(Math.max(...res.years))], ['mes_actual', '12'],
      ['iva_tasa', '0.16'], ['moneda', 'MXN'],
      ['ultima_poliza_I', '0'], ['ultima_poliza_E', '0'],
      ['ultima_poliza_D', '0'], ['ultima_poliza_O', '0'],
      ['empresa_direccion', '']
    ];
    for (const [k, v] of defs) safe(() => ucfg.run(k, v), null);

    return { ok: true, log, res };
  } catch (e) {
    return { error: e.message || String(e) };
  }
}

module.exports = { importarFDB };
