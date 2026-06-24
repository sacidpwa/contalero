# CONTALERO - Sistema Contable Integral

Sistema contable web completo basado en Node.js, diseñado para reemplazar funcionalidades de Aspel COI y NOI.

## Características

### Módulo de Contabilidad (COI)
- **Catálogo de Cuentas** - Estructura jerárquica tipo SAT con niveles
- **Pólizas** - Ingreso, Egreso, Diario y Orden con validación de balance
- **Balanza de Comprobación** - Acumulados por período
- **Estado de Resultados** - Automático basado en cuentas de resultado
- **Balance General** - Activo, Pasivo y Capital
- **Mayor de Cuentas** - Con saldo corriente
- **Auxiliares** - Cuentas por cobrar/pagar por tercero
- **IVA** - Cálculo de IVA acreditable y trasladado
- **Centros de Costos** - Segmentación por centro
- **Departamentos** - Segmentación por departamento
- **Presupuestos** - Control presupuestal vs real

### Automatización
- **Pólizas Recurrentes** - Programación automática diaria/semanal/mensual
- **Depreciación de Activos** - Cálculo lineal o de suma de dígitos
- **Loop Automático** - Genera todas las pólizas programadas de un período

## Requisitos

- Node.js 18+
- Navegador web moderno

## Instalación

```bash
# Clonar repositorio
git clone https://github.com/sacidpwa/contalero.git
cd contalero

# Instalar dependencias
npm install

# Iniciar el sistema
npm start
```

Abrir en el navegador: `http://localhost:3000`

## Uso Básico

1. **Configurar empresa**: Ir a Configuración > Datos de la Empresa
2. **Catálogo de Cuentas**: Revisar y ajustar el catálogo precargado
3. **Registrar pólizas**: Capturar movimientos contables diarios
4. **Generar reportes**: Balanza, Estado de Resultados, Balance General
5. **Automatizar**: Configurar pólizas recurrentes y depreciaciones

## Estructura del Proyecto

```
contalero/
├── server.js              # Servidor principal
├── database/
│   └── schema.js          # Esquema SQLite + datos iniciales
├── routes/                # Rutas Express
│   ├── catalog.js         # Catálogo de cuentas
│   ├── polizas.js         # Pólizas contables
│   ├── reportes.js        # Reportes financieros
│   ├── auxiliares.js      # Auxiliares/terceros
│   ├── iva.js             # Reporte de IVA
│   ├── presupuestos.js    # Presupuestos
│   ├── automatizacion.js  # Loop automático
│   ├── config.js          # Configuración
│   └── api.js             # API REST (para gráficas)
├── services/
│   └── contabilidad.js    # Lógica contable
├── views/                 # Vistas EJS
└── public/                # Archivos estáticos
```

## Licencia

MIT
