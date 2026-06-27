const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const os = require('os');
const { importarFDB } = require('../services/importar');

router.get('/', (req, res) => {
  res.render('importar/index', { title: 'Importar', resultado: null, error: null });
});

router.post('/upload', (req, res) => {
  if (!req.files || !req.files.archivo) {
    return res.render('importar/index', { title: 'Importar', resultado: null, error: 'Selecciona un archivo .fdb' });
  }
  const archivo = req.files.archivo;
  if (!archivo.name.toLowerCase().endsWith('.fdb')) {
    return res.render('importar/index', { title: 'Importar', resultado: null, error: 'El archivo debe ser .fdb' });
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-'));
  const fdbPath = path.join(tmpDir, archivo.name);
  archivo.mv(fdbPath, (err) => {
    if (err) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return res.render('importar/index', { title: 'Importar', resultado: null, error: 'Error al guardar: ' + err.message });
    }
    const resultado = importarFDB(fdbPath, req.body);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (resultado.error) {
      return res.render('importar/index', { title: 'Importar', resultado: null, error: resultado.error });
    }
    res.render('importar/index', { title: 'Importar', resultado, error: null });
  });
});

module.exports = router;
