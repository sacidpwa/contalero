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
  for (const line of out.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || /^=+$/.test(t) || t.startsWith('RDB$')) continue;
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
  const lf = String.fromCharCode(10);
  const cr = String.fromCharCode(13);
  const sel = columns.map(c => `REPLACE(REPLACE(REPLACE(COALESCE("${c}",''),'"',' '),'${lf}',' '),'${cr}',' ')`).join("||'||||'||");
  const sql = `SET HEADING OFF;\nSELECT ${sel} FROM "${tableName}"; QUIT;`;
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

    const esc = (s) => "'" + String(s).replace(/'/g, "''") + "'";
    const qesc = (s) => '"' + String(s).replace(/"/g, '""') + '"';

    const typeMap = { I: 'I', E: 'E', D: 'D', O: 'O', Dr: 'D', Ig: 'I', Eg: 'E', Tr: 'O', Ch: 'O' };
    const gpi = db.prepare('SELECT id FROM polizas WHERE tipo = ? AND numero = ? AND ejercicio = ?');
    const gci = db.prepare('SELECT id, nombre, naturaleza FROM cuentas WHERE codigo = ?');

    const importYear = (year) => {
      if (!year) return;
      res.years.push(year);
      const ys = String(year).slice(-2);

      const execBatch = (arr, batchSize) => {
        if (arr.length === 0) return;
        let sql = '', cnt = 0;
        for (const s of arr) { sql += s; cnt++; if (cnt >= batchSize) { db.exec(sql); sql = ''; cnt = 0; } }
        if (sql) db.exec(sql);
      };

      const ctaTable = tables.find(t => t === 'CUENTAS' + ys);
      if (!ctaTable) { log.push('Año ' + year + ': no se encontró CUENTAS' + ys); return; }

      const ctaCols = getFDBColumns(fdbPath, ctaTable);
      const ctaData = getFDBData(fdbPath, ctaTable, ctaCols);
      log.push('CUENTAS' + year + ': ' + ctaData.length + ' cuentas');
      const tipoSatMap = { A: 'S', G: 'S', D: 'N', C: 'N', I: 'S', O: 'N' };
      const padres = {};
      const ctaInserts = [];
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
        ctaInserts.push("INSERT OR IGNORE INTO cuentas (codigo,nombre,nivel,naturaleza,tipo_sat,acepta_movimientos,activo,cuenta_padre) VALUES (" +
          esc(codigo) + "," + esc(nombre) + "," + nivel + "," + esc(naturaleza) + "," + esc(tipoSat) + "," + acepta + ",1," + (padre ? esc(padre) : 'NULL') + ");");
      }
      execBatch(ctaInserts, 50);
      // Marcar cuentas padre como no detalle
      const pCodes = Object.values(padres).filter(Boolean);
      const uniqueP = [...new Set(pCodes)];
      if (uniqueP.length > 0) {
        const pcod = uniqueP.map(c => esc(c)).join(',');
        safe(() => db.exec("UPDATE cuentas SET acepta_movimientos = 0 WHERE codigo IN (" + pcod + ")"), null);
      }
      res.cuentas += ctaData.length;

      // Cache cuenta naturaleza (0=Deudora/D, 1=Acreedora/A)
      const natMap = {};
      for (const c of ctaData) {
        const code = (c.NUM_CTA || '').trim().replace(/^0+/, '');
        const raw = (c.NATURALEZA || '').trim();
        const nat = raw === '1' ? 'A' : (raw === '0' ? 'D' : raw);
        if (code) natMap[code] = nat;
      }

      const salTable = tables.find(t => t === 'SALDOS' + ys);
      if (salTable) {
        const salCols = getFDBColumns(fdbPath, salTable);
        const salData = getFDBData(fdbPath, salTable, salCols);
        log.push('SALDOS' + year + ': ' + salData.length);
        const salInserts = [];
        for (const row of salData) {
          const numCta = (row.NUM_CTA || '').trim().replace(/^0+/, '');
          const nat = natMap[numCta] || 'D';
          let running = parseFloat(row.INICIAL) || 0;
          for (let m = 1; m <= 12; m++) {
            const sm = String(m).padStart(2, '0');
            const cargo = parseFloat(row['CARGO' + sm] || '0') || 0;
            const abono = parseFloat(row['ABONO' + sm] || '0') || 0;
            if (nat === 'A') running += (abono - cargo);
            else running += (cargo - abono);
            salInserts.push("INSERT OR REPLACE INTO configuracion (clave,valor) VALUES (" +
              esc('saldo_' + year + '_' + sm + '_' + numCta) + "," + esc(String(running)) + ");");
          }
        }
        execBatch(salInserts, 100);
        res.saldos += salData.length;
      }

      const polTable = tables.find(t => t === 'POLIZAS' + ys);
      if (polTable) {
        const polCols = getFDBColumns(fdbPath, polTable);
        const polData = getFDBData(fdbPath, polTable, polCols);
        log.push('POLIZAS' + year + ': ' + polData.length + ' pólizas');
        const polInserts = [];
        for (const row of polData) {
          const tipoOrig = safe(() => (row.TIPO_POLI || row.TIPO_POLIZA || row.TIPOPOL || '').trim(), '');
          const tipo = typeMap[tipoOrig] || 'D';
          const numero = safe(() => parseInt(row.NUM_POLIZ || row.NUM_POLIZA || row.NUMPOL || '0') || 0, 0);
          const fechaStr = safe(() => (row.FECHA_POL || row.FECHAPOL || '').trim(), '');
          const fecha = fechaStr.substring(0, 10);
          const concepto = safe(() => (row.CONCEP_PO || row.CONCEPTO || '').trim(), '');
          const mes = safe(() => parseInt(row.PERIODO || row.MES || '1') || 1, 1);
          const ejercicio = safe(() => parseInt(row.EJERCICIO || String(year)) || year, year);
          if (tipo && numero && fecha) {
            polInserts.push("INSERT OR IGNORE INTO polizas (tipo,numero,fecha,concepto,mes,ejercicio) VALUES (" +
              esc(tipo) + "," + numero + "," + esc(fecha) + "," + esc(concepto) + "," + mes + "," + ejercicio + ");");
          }
        }
        execBatch(polInserts, 50);
        res.polizas += polData.length;
      }

      const presTable = tables.find(t => t === 'PRESUP' + ys);
      if (presTable) {
        const presCols = getFDBColumns(fdbPath, presTable);
        const presData = getFDBData(fdbPath, presTable, presCols);
        log.push('PRESUP' + year + ': ' + presData.length);
        const presInserts = [];
        for (const row of presData) {
          const codigo = safe(() => (row.NUM_CTA || '').trim().replace(/^0+/, ''), '');
          const ctaRow = safe(() => gci.get(codigo), null);
          if (ctaRow) {
            for (let m = 1; m <= 12; m++) {
              const sm = String(m).padStart(2, '0');
              const k = 'PRESUP' + sm;
              const v = safe(() => row[k], undefined);
              if (v !== undefined && v !== '') {
                presInserts.push("INSERT OR IGNORE INTO presupuestos (cuenta_id,mes,ejercicio,presupuesto) VALUES (" +
                  ctaRow.id + "," + m + "," + year + "," + (parseFloat(v) || 0) + ");");
              }
            }
          }
        }
        execBatch(presInserts, 50);
      }

      // Importar detalle desde AUXILIAR{YY}
      const auxTable = tables.find(t => t === 'AUXILIAR' + ys);
      if (auxTable) {
        const auxCols = getFDBColumns(fdbPath, auxTable);
        const auxData = getFDBData(fdbPath, auxTable, auxCols);
        log.push('AUXILIAR' + year + ': ' + auxData.length + ' partidas');
        let count = 0;
        const doAux = db.transaction(() => {
          let batch = '', bc = 0;
          for (const row of auxData) {
            const tipoOrig = safe(() => (row.TIPO_POLI || '').trim(), '');
            const numpol = safe(() => parseInt(row.NUM_POLIZ || '0') || 0, 0);
            const ejer = safe(() => parseInt(row.EJERCICIO || year) || year, year);
            if (!tipoOrig || !numpol) continue;
            const tipo = typeMap[tipoOrig] || 'D';
            const polRow = safe(() => gpi.get(tipo, numpol, ejer), null);
            if (!polRow) continue;
            const numCta = safe(() => (row.NUM_CTA || '').trim().replace(/^0+/, ''), '');
            const ctaRow = safe(() => gci.get(numCta), null);
            if (!ctaRow) continue;
            const debeHaber = safe(() => (row.DEBE_HABER || '').trim(), '');
            const monto = safe(() => parseFloat(row.MONTOMOV || '0') || 0, 0);
            if (monto === 0 || (debeHaber !== 'D' && debeHaber !== 'H')) continue;
            const debe = debeHaber === 'D' ? monto : 0;
            const haber = debeHaber === 'H' ? monto : 0;
            const concepto = safe(() => (row.CONCEP_PO || '').trim().replace(/'/g, "''"), '');
            batch += "INSERT INTO polizas_detalle (poliza_id,cuenta_id,debe,haber,concepto) VALUES (" +
              polRow.id + "," + ctaRow.id + "," + debe + "," + haber + "," + esc(concepto) + ");";
            count++;
            bc++;
            if (bc >= 250) { safe(() => db.exec(batch), null); batch = ''; bc = 0; }
          }
          if (batch) safe(() => db.exec(batch), null);
        });
        doAux();
        if (count > 0) log.push('  → ' + count + ' registros insertados en polizas_detalle');
        res.detalles += count;
      }

      // Persist after each year
      db.persist();
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

    const auxInserts = [], deptoInserts = [], ccInserts = [], cfgInserts = [];

    const ccTable = tables.find(t => t === 'CCOSTOS');
    if (ccTable) {
      const cols = getFDBColumns(fdbPath, ccTable);
      const data = getFDBData(fdbPath, ccTable, cols);
      log.push('CCOSTOS: ' + data.length);
      for (const row of data) {
        const codigo = safe(() => String(row.ID || row.CODIGO || '').trim(), '');
        const nombre = safe(() => (row.DESCRIPCION || '').trim(), '');
        if (codigo && nombre) ccInserts.push("INSERT OR IGNORE INTO centros_costos (codigo,nombre) VALUES (" + esc(codigo) + "," + esc(nombre) + ");");
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
        if (codigo) auxInserts.push("INSERT OR IGNORE INTO auxiliares (codigo,nombre,rfc,tipo) VALUES (" + esc(codigo) + "," + esc(nombre) + "," + esc(rfc) + ",'C');");
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
        if (codigo && nombre) deptoInserts.push("INSERT OR IGNORE INTO departamentos (codigo,nombre) VALUES (" + esc(codigo) + "," + esc(nombre) + ");");
      }
    }

    const paramTable = tables.find(t => t === 'PARAMEMP');
    if (paramTable) {
      const cols = getFDBColumns(fdbPath, paramTable);
      const data = getFDBData(fdbPath, paramTable, cols);
      log.push('PARAMEMP: ' + data.length + ' registros');
      if (data.length > 0) {
        const p = data[0];
        if (p.NOMBRE) cfgInserts.push("INSERT OR REPLACE INTO configuracion (clave,valor) VALUES ('empresa_nombre'," + esc((p.NOMBRE || '').trim()) + ");");
        if (p.RFCCIA) cfgInserts.push("INSERT OR REPLACE INTO configuracion (clave,valor) VALUES ('empresa_rfc'," + esc((p.RFCCIA || '').trim()) + ");");
        if (p.DOMICILIO) cfgInserts.push("INSERT OR REPLACE INTO configuracion (clave,valor) VALUES ('empresa_direccion'," + esc((p.DOMICILIO || '').trim()) + ");");
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

    // Default config entries
    cfgInserts.push("INSERT OR REPLACE INTO configuracion (clave,valor) VALUES ('empresa_nombre','Mi Empresa');");
    cfgInserts.push("INSERT OR REPLACE INTO configuracion (clave,valor) VALUES ('empresa_rfc','XXXX000101XXX');");
    cfgInserts.push("INSERT OR REPLACE INTO configuracion (clave,valor) VALUES ('ejercicio_actual'," + esc(String(Math.max(...res.years))) + ");");
    cfgInserts.push("INSERT OR REPLACE INTO configuracion (clave,valor) VALUES ('mes_actual','12');");
    cfgInserts.push("INSERT OR REPLACE INTO configuracion (clave,valor) VALUES ('iva_tasa','0.16');");
    cfgInserts.push("INSERT OR REPLACE INTO configuracion (clave,valor) VALUES ('moneda','MXN');");
    cfgInserts.push("INSERT OR REPLACE INTO configuracion (clave,valor) VALUES ('ultima_poliza_I','0');");
    cfgInserts.push("INSERT OR REPLACE INTO configuracion (clave,valor) VALUES ('ultima_poliza_E','0');");
    cfgInserts.push("INSERT OR REPLACE INTO configuracion (clave,valor) VALUES ('ultima_poliza_D','0');");
    cfgInserts.push("INSERT OR REPLACE INTO configuracion (clave,valor) VALUES ('ultima_poliza_O','0');");
    cfgInserts.push("INSERT OR REPLACE INTO configuracion (clave,valor) VALUES ('empresa_direccion','');");

    // Execute all post-year inserts
    const execFinal = (arr, bs) => {
      if (arr.length === 0) return;
      let sql = '', cnt = 0;
      for (const s of arr) { sql += s; cnt++; if (cnt >= bs) { db.exec(sql); sql = ''; cnt = 0; } }
      if (sql) db.exec(sql);
    };
    execFinal(ccInserts, 50);
    execFinal(auxInserts, 50);
    execFinal(deptoInserts, 50);
    execFinal(cfgInserts, 50);
    db.persist();

    return { ok: true, log, res };
  } catch (e) {
    return { error: e.message || String(e) };
  }
}

module.exports = { importarFDB };
