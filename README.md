# Control de Entregas

Aplicación moderna desarrollada en **React 19 + TypeScript + Vite** para el control y registro de entregas de despacho e ingresos a almacén con sincronización en tiempo real con Google Sheets y Supabase.

## Características

- **Registro de Despachos**:
  - Modalidad de **Tabla rápida (tipo Excel)** con atajos de teclado y pegado masivo desde hojas de cálculo.
  - Modalidad de **Formulario** con autocompletado inteligente de OP, selección de modelos simples o compuestos, cálculo automático de cajas/paquetes y total entregado.
  - Carga de lista de despacho en Excel (por código SAP o por OP) con desglose de cantidades y deducción de stock inicial en almacén.
  - Resumen visual por OP del despacho activo con indicadores de estado (`COMPLETO`, `INCOMPLETO`).
- **Control de Ingresos**:
  - Registro ágil de ingresos a almacén por turno y habilitador.
  - Entrada individual y tabla rápida con validaciones de límites y prevención de duplicados.
- **Registros y Reportes**:
  - Filtros avanzados por fecha de despacho, fecha de registro, turno, habilitador, estado y búsqueda general.
  - Vistas detalladas por entradas y agrupadas por OP / SAP.
  - Exportación en formato SpreadsheetML (`.xls`) con estilos, colores, bordes y hojas múltiples ("Entregas", "Resumen OP", "Resumen SAP").
  - Vista de impresión profesional optimizada para formato A4 apaisado.
- **Sincronización Automática**:
  - Conexión continua con Google Apps Script (Sheets) para persistencia centralizada.
  - Cola local de sincronización y procesamiento de borrados fuera de línea.
  - Indicador flotante en tiempo real del estado de conexión y registros pendientes.
- **Catálogo de OPs y Configuración**:
  - Actualización periódica y bajo demanda desde la base de datos Supabase (`catalogo_op`).
  - Importación local de catálogos desde archivos Excel.
  - Gestión de habilitadores por turno.
  - Copias de seguridad (descarga y restauración de respaldos en JSON con protección ante sobrescritura).
- **Compatibilidad PWA**:
  - Diagnóstico integrado de estado PWA, manifiesto e instalación en dispositivos móviles y de escritorio.

## Desarrollo y Compilación

```bash
# Iniciar servidor de desarrollo
npm run dev

# Compilar para producción
npm run build

# Validar tipos
npm run lint
```
