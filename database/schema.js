const Database = require('better-sqlite3');
const path = require('path');

let db;

function getDB() {
  if (!db) {
    db = new Database(path.join(__dirname, 'contabilidad.db'));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
    seedData();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS configuracion (
      clave TEXT PRIMARY KEY,
      valor TEXT
    );

    CREATE TABLE IF NOT EXISTS cuentas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT NOT NULL,
      nombre TEXT NOT NULL,
      nivel INTEGER NOT NULL DEFAULT 1,
      naturaleza TEXT CHECK(naturaleza IN ('D','A')),
      tipo_sat TEXT DEFAULT 'N',
      acepta_movimientos INTEGER DEFAULT 1,
      activo INTEGER DEFAULT 1,
      centro_costos INTEGER DEFAULT 0,
      cuenta_padre TEXT,
      UNIQUE(codigo)
    );

    CREATE TABLE IF NOT EXISTS centros_costos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT UNIQUE NOT NULL,
      nombre TEXT NOT NULL,
      activo INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS departamentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT UNIQUE NOT NULL,
      nombre TEXT NOT NULL,
      activo INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS auxiliares (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT CHECK(tipo IN ('C','P','A')) NOT NULL DEFAULT 'A',
      codigo TEXT UNIQUE NOT NULL,
      nombre TEXT NOT NULL,
      rfc TEXT,
      curp TEXT,
      direccion TEXT,
      telefono TEXT,
      email TEXT,
      activo INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS polizas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT CHECK(tipo IN ('I','E','D','O')) NOT NULL,
      numero INTEGER NOT NULL,
      fecha DATE NOT NULL,
      concepto TEXT NOT NULL,
      mes INTEGER NOT NULL,
      ejercicio INTEGER NOT NULL,
      uuid TEXT,
      UNIQUE(tipo, numero, ejercicio)
    );

    CREATE TABLE IF NOT EXISTS polizas_detalle (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      poliza_id INTEGER NOT NULL REFERENCES polizas(id) ON DELETE CASCADE,
      cuenta_id INTEGER NOT NULL REFERENCES cuentas(id),
      auxiliar_id INTEGER REFERENCES auxiliares(id),
      centro_costo_id INTEGER REFERENCES centros_costos(id),
      departamento_id INTEGER REFERENCES departamentos(id),
      concepto TEXT,
      debe REAL NOT NULL DEFAULT 0,
      haber REAL NOT NULL DEFAULT 0,
      referencia TEXT
    );

    CREATE TABLE IF NOT EXISTS presupuestos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cuenta_id INTEGER NOT NULL REFERENCES cuentas(id),
      centro_costo_id INTEGER REFERENCES centros_costos(id),
      mes INTEGER NOT NULL,
      ejercicio INTEGER NOT NULL,
      presupuesto REAL NOT NULL DEFAULT 0,
      UNIQUE(cuenta_id, mes, ejercicio, centro_costo_id)
    );

    CREATE TABLE IF NOT EXISTS recurrentes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      tipo_poliza TEXT CHECK(tipo_poliza IN ('I','E','D')) NOT NULL,
      periodicidad TEXT CHECK(periodicidad IN ('M','B','T','S','A')) NOT NULL,
      dia INTEGER NOT NULL DEFAULT 1,
      concepto TEXT NOT NULL,
      activo INTEGER DEFAULT 1,
      ultima_generacion TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS recurrentes_detalle (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recurrente_id INTEGER NOT NULL REFERENCES recurrentes(id) ON DELETE CASCADE,
      cuenta_id INTEGER NOT NULL REFERENCES cuentas(id),
      auxiliar_id INTEGER REFERENCES auxiliares(id),
      centro_costo_id INTEGER REFERENCES centros_costos(id),
      departamento_id INTEGER REFERENCES departamentos(id),
      debe REAL NOT NULL DEFAULT 0,
      haber REAL NOT NULL DEFAULT 0,
      referencia TEXT
    );

    CREATE TABLE IF NOT EXISTS depreciaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cuenta_activo_id INTEGER NOT NULL REFERENCES cuentas(id),
      cuenta_gasto_id INTEGER NOT NULL REFERENCES cuentas(id),
      cuenta_depreciacion_id INTEGER NOT NULL REFERENCES cuentas(id),
      nombre TEXT NOT NULL,
      fecha_adquisicion DATE NOT NULL,
      valor_original REAL NOT NULL,
      valor_residual REAL DEFAULT 0,
      vida_util INTEGER NOT NULL,
      metodo TEXT CHECK(metodo IN ('L','SDA')) DEFAULT 'L',
      fecha_ultima_depreciacion TEXT,
      activo INTEGER DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_polizas_fecha ON polizas(fecha);
    CREATE INDEX IF NOT EXISTS idx_polizas_mes ON polizas(ejercicio, mes);
    CREATE INDEX IF NOT EXISTS idx_detalle_poliza ON polizas_detalle(poliza_id);
    CREATE INDEX IF NOT EXISTS idx_detalle_cuenta ON polizas_detalle(cuenta_id);
    CREATE INDEX IF NOT EXISTS idx_presupuestos ON presupuestos(ejercicio, mes);
  `);
}

function seedData() {
  const count = db.prepare('SELECT COUNT(*) as c FROM configuracion').get().c;
  if (count > 0) return;

  db.exec(`
    INSERT INTO configuracion VALUES ('empresa_nombre', 'Mi Empresa');
    INSERT INTO configuracion VALUES ('empresa_rfc', 'XXXX000101XXX');
    INSERT INTO configuracion VALUES ('empresa_direccion', '');
    INSERT INTO configuracion VALUES ('ejercicio_actual', '2026');
    INSERT INTO configuracion VALUES ('mes_actual', '6');
    INSERT INTO configuracion VALUES ('moneda', 'MXN');
    INSERT INTO configuracion VALUES ('iva_tasa', '0.16');
    INSERT INTO configuracion VALUES ('ultima_poliza_I', '0');
    INSERT INTO configuracion VALUES ('ultima_poliza_E', '0');
    INSERT INTO configuracion VALUES ('ultima_poliza_D', '0');
    INSERT INTO configuracion VALUES ('ultima_poliza_O', '0');

    INSERT INTO centros_costos VALUES (1, '000', 'SIN CENTRO DE COSTOS', 1);
    INSERT INTO departamentos VALUES (1, '000', 'SIN DEPARTAMENTO', 1);
  `);

  // Catálogo de cuentas SAT estándar
  const cuentas = [
    ['1000', 'ACTIVO', 1, 'D', 'N', 0],
    ['1100', 'ACTIVO CIRCULANTE', 2, 'D', 'N', 0],
    ['1101', 'CAJA', 3, 'D', 'S', 1],
    ['1102', 'FONDO FIJO DE CAJA', 3, 'D', 'S', 1],
    ['1103', 'BANCOS', 3, 'D', 'S', 1],
    ['1104', 'INVERSIONES', 3, 'D', 'S', 1],
    ['1105', 'CLIENTES', 3, 'D', 'S', 1],
    ['1106', 'DOCUMENTOS POR COBRAR', 3, 'D', 'S', 1],
    ['1107', 'DEUDORES DIVERSOS', 3, 'D', 'S', 1],
    ['1108', 'IVA ACREDITABLE', 3, 'D', 'S', 1],
    ['1109', 'IVA POR ACREDITAR', 3, 'D', 'S', 1],
    ['1110', 'DEUDORES IVA', 3, 'D', 'S', 1],
    ['1111', 'IMPUESTOS A FAVOR', 3, 'D', 'S', 1],
    ['1112', 'ANTICIPO A PROVEEDORES', 3, 'D', 'S', 1],
    ['1113', 'INVENTARIOS', 3, 'D', 'S', 1],
    ['1114', 'PAGOS ANTICIPADOS', 3, 'D', 'S', 1],
    ['1115', 'OTROS ACTIVOS CIRCULANTES', 3, 'D', 'S', 1],
    ['1200', 'ACTIVO NO CIRCULANTE', 2, 'D', 'N', 0],
    ['1201', 'TERRENOS', 3, 'D', 'S', 1],
    ['1202', 'EDIFICIOS', 3, 'D', 'S', 1],
    ['1203', 'MOBILIARIO Y EQUIPO', 3, 'D', 'S', 1],
    ['1204', 'EQUIPO DE COMPUTO', 3, 'D', 'S', 1],
    ['1205', 'VEHICULOS', 3, 'D', 'S', 1],
    ['1206', 'MAQUINARIA Y EQUIPO', 3, 'D', 'S', 1],
    ['1207', 'DEPRECIACION ACUMULADA', 3, 'A', 'S', 1],
    ['1208', 'ACTIVOS INTANGIBLES', 3, 'D', 'S', 1],
    ['1209', 'AMORTIZACION ACUMULADA', 3, 'A', 'S', 1],
    ['1210', 'OTROS ACTIVOS NO CIRCULANTES', 3, 'D', 'S', 1],

    ['2000', 'PASIVO', 1, 'A', 'N', 0],
    ['2100', 'PASIVO CIRCULANTE', 2, 'A', 'N', 0],
    ['2101', 'PROVEEDORES', 3, 'A', 'S', 1],
    ['2102', 'DOCUMENTOS POR PAGAR', 3, 'A', 'S', 1],
    ['2103', 'ACREEDORES DIVERSOS', 3, 'A', 'S', 1],
    ['2104', 'IVA TRASLADADO', 3, 'A', 'S', 1],
    ['2105', 'IVA POR TRASLADAR', 3, 'A', 'S', 1],
    ['2106', 'ISR POR PAGAR', 3, 'A', 'S', 1],
    ['2107', 'PTU POR PAGAR', 3, 'A', 'S', 1],
    ['2108', 'IMPUESTOS POR PAGAR', 3, 'A', 'S', 1],
    ['2109', 'CREDITOS BANCARIOS CP', 3, 'A', 'S', 1],
    ['2110', 'PASIVOS ACUMULADOS', 3, 'A', 'S', 1],
    ['2111', 'ANTICIPO DE CLIENTES', 3, 'A', 'S', 1],
    ['2200', 'PASIVO NO CIRCULANTE', 2, 'A', 'N', 0],
    ['2201', 'CREDITOS BANCARIOS LP', 3, 'A', 'S', 1],
    ['2202', 'PASIVOS LABORALES LP', 3, 'A', 'S', 1],
    ['2203', 'OTROS PASIVOS LP', 3, 'A', 'S', 1],

    ['3000', 'CAPITAL CONTABLE', 1, 'A', 'N', 0],
    ['3100', 'CAPITAL CONTRIBUIDO', 2, 'A', 'N', 0],
    ['3101', 'CAPITAL SOCIAL', 3, 'A', 'S', 1],
    ['3102', 'APORTACIONES PARA FUTUROS AUMENTOS', 3, 'A', 'S', 1],
    ['3103', 'PRIMA EN VENTA DE ACCIONES', 3, 'A', 'S', 1],
    ['3200', 'CAPITAL GANADO', 2, 'A', 'N', 0],
    ['3201', 'UTILIDADES ACUMULADAS', 3, 'A', 'S', 1],
    ['3202', 'PERDIDAS ACUMULADAS', 3, 'D', 'S', 1],
    ['3203', 'UTILIDAD DEL EJERCICIO', 3, 'A', 'S', 1],
    ['3204', 'PERDIDA DEL EJERCICIO', 3, 'D', 'S', 1],
    ['3205', 'RESERVA LEGAL', 3, 'A', 'S', 1],
    ['3206', 'OTRAS RESERVAS', 3, 'A', 'S', 1],

    ['4000', 'INGRESOS', 1, 'A', 'N', 0],
    ['4100', 'INGRESOS OPERATIVOS', 2, 'A', 'S', 1],
    ['4101', 'VENTAS', 3, 'A', 'S', 1],
    ['4102', 'DEVOLUCIONES SOBRE VENTAS', 3, 'D', 'S', 1],
    ['4103', 'DESCUENTOS SOBRE VENTAS', 3, 'D', 'S', 1],
    ['4200', 'OTROS INGRESOS', 2, 'A', 'S', 1],
    ['4201', 'PRODUCTOS FINANCIEROS', 3, 'A', 'S', 1],
    ['4202', 'OTROS PRODUCTOS', 3, 'A', 'S', 1],

    ['5000', 'COSTOS', 1, 'D', 'N', 0],
    ['5100', 'COSTO DE VENTAS', 2, 'D', 'S', 1],
    ['5101', 'COSTO DE MERCANCIAS VENDIDAS', 3, 'D', 'S', 1],
    ['5102', 'COMPRAS', 3, 'D', 'S', 1],
    ['5103', 'DEVOLUCIONES SOBRE COMPRAS', 3, 'A', 'S', 1],
    ['5104', 'FLETES Y ACARREOS', 3, 'D', 'S', 1],

    ['6000', 'GASTOS', 1, 'D', 'N', 0],
    ['6100', 'GASTOS ADMINISTRATIVOS', 2, 'D', 'S', 1],
    ['6101', 'SUELDOS Y SALARIOS', 3, 'D', 'S', 1],
    ['6102', 'PRESTACIONES LABORALES', 3, 'D', 'S', 1],
    ['6103', 'IMPUESTOS SOBRE NOMINAS', 3, 'D', 'S', 1],
    ['6104', 'RENTAS', 3, 'D', 'S', 1],
    ['6105', 'LUZ Y AGUA', 3, 'D', 'S', 1],
    ['6106', 'TELEFONO E INTERNET', 3, 'D', 'S', 1],
    ['6107', 'PAPELERIA Y UTILES', 3, 'D', 'S', 1],
    ['6108', 'DEPRECIACIONES', 3, 'D', 'S', 1],
    ['6109', 'AMORTIZACIONES', 3, 'D', 'S', 1],
    ['6110', 'MANTENIMIENTO Y REPARACIONES', 3, 'D', 'S', 1],
    ['6111', 'HONORARIOS PROFESIONALES', 3, 'D', 'S', 1],
    ['6112', 'SEGUROS', 3, 'D', 'S', 1],
    ['6113', 'VIATICOS Y VIAJES', 3, 'D', 'S', 1],
    ['6114', 'CAPACITACION', 3, 'D', 'S', 1],
    ['6115', 'GASTOS DE VENTA', 3, 'D', 'S', 1],
    ['6116', 'GASTOS DE PUBLICIDAD', 3, 'D', 'S', 1],
    ['6117', 'OTROS GASTOS ADMINISTRATIVOS', 3, 'D', 'S', 1],
    ['6200', 'GASTOS FINANCIEROS', 2, 'D', 'S', 1],
    ['6201', 'INTERESES BANCARIOS', 3, 'D', 'S', 1],
    ['6202', 'GASTOS BANCARIOS', 3, 'D', 'S', 1],
    ['6203', 'OTROS GASTOS FINANCIEROS', 3, 'D', 'S', 1],

    ['7000', 'OTROS GASTOS', 1, 'D', 'N', 0],
    ['7100', 'GASTOS NO DEDUCIBLES', 2, 'D', 'S', 1],
    ['7101', 'GASTOS NO DEDUCIBLES', 3, 'D', 'S', 1],
    ['8000', 'CUENTAS DE CIERRE', 1, 'A', 'N', 0],
    ['8001', 'CIERRE DE INGRESOS', 3, 'A', 'S', 1],
    ['8002', 'CIERRE DE COSTOS', 3, 'D', 'S', 1],
    ['8003', 'CIERRE DE GASTOS', 3, 'D', 'S', 1],
    ['8004', 'CIERRE DE OTROS GASTOS', 3, 'D', 'S', 1],
    ['8005', 'CIERRE CONTABLE', 3, 'A', 'S', 1],
  ];

  const insertCuenta = db.prepare(`INSERT INTO cuentas (codigo, nombre, nivel, naturaleza, tipo_sat, acepta_movimientos) VALUES (?, ?, ?, ?, ?, ?)`);
  for (const c of cuentas) {
    insertCuenta.run(...c);
  }
  console.log('Catálogo de cuentas precargado');
}

module.exports = { getDB };
