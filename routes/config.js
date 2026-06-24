const express = require('express');
const router = express.Router();
const { getDB } = require('../database/schema');

router.get('/', (req, res) => {
  const db = getDB();
  const config = {};
  db.prepare('SELECT * FROM configuracion').all().forEach(r => { config[r.clave] = r.valor; });
  const centros = db.prepare('SELECT * FROM centros_costos ORDER BY codigo').all();
  const deptos = db.prepare('SELECT * FROM departamentos ORDER BY codigo').all();
  res.render('config/index', { config, centros, deptos, title: 'Configuración' });
});

router.post('/guardar', (req, res) => {
  const db = getDB();
  const { empresa_nombre, empresa_rfc, empresa_direccion, ejercicio_actual, mes_actual, iva_tasa } = req.body;
  const upsert = db.prepare('INSERT OR REPLACE INTO configuracion (clave, valor) VALUES (?, ?)');
  upsert.run('empresa_nombre', empresa_nombre);
  upsert.run('empresa_rfc', empresa_rfc);
  upsert.run('empresa_direccion', empresa_direccion);
  upsert.run('ejercicio_actual', ejercicio_actual);
  upsert.run('mes_actual', mes_actual);
  upsert.run('iva_tasa', iva_tasa);
  req.session.mes = parseInt(mes_actual);
  req.session.ejercicio = parseInt(ejercicio_actual);
  res.redirect('/config');
});

router.post('/centro-costo/nuevo', (req, res) => {
  const db = getDB();
  const { codigo, nombre } = req.body;
  db.prepare('INSERT INTO centros_costos (codigo, nombre) VALUES (?, ?)').run(codigo, nombre);
  res.redirect('/config');
});

router.post('/departamento/nuevo', (req, res) => {
  const db = getDB();
  const { codigo, nombre } = req.body;
  db.prepare('INSERT INTO departamentos (codigo, nombre) VALUES (?, ?)').run(codigo, nombre);
  res.redirect('/config');
});

module.exports = router;
