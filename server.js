const express = require('express');
const session = require('express-session');
const path = require('path');
const morgan = require('morgan');

const { getDB } = require('./database/schema');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(morgan('dev'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'contabilidad2026',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

app.use((req, res, next) => {
  res.locals.path = req.path;
  res.locals.db = getDB();
  res.locals.mes = req.session.mes || 6;
  res.locals.ejercicio = req.session.ejercicio || 2026;
  res.locals.empresa = 'Mi Empresa';
  next();
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Rutas
app.use('/', require('./routes/catalog'));
app.use('/polizas', require('./routes/polizas'));
app.use('/reportes', require('./routes/reportes'));
app.use('/auxiliares', require('./routes/auxiliares'));
app.use('/iva', require('./routes/iva'));
app.use('/presupuestos', require('./routes/presupuestos'));
app.use('/automatizacion', require('./routes/automatizacion'));
app.use('/config', require('./routes/config'));
app.use('/api', require('./routes/api'));

app.get('/', (req, res) => res.redirect('/dashboard'));

app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  SISTEMA CONTABLE INTEGRAL`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`========================================\n`);
});
