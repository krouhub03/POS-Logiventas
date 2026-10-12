# Logiventa POS — Reglas y Estándares del Agente de Desarrollo

Sistema de Punto de Venta (POS) de escritorio de alto rendimiento construido con **Tauri 2 + React 19 + TypeScript + Vite + SQLite embebido (`rusqlite`)**, diseñado para operar con arquitectura **Offline-First** y sincronización bidireccional con el ERP **Megalider** (`megalider-web-2`).

---

## 🏛️ 1. Arquitectura General del Sistema

El sistema está dividido estrictamente en dos capas comunicadas por IPC (Inter-Process Communication):

```
┌────────────────────────────────────────────────────────┐
│                   React 19 (Frontend)                  │
│       UI / Atajos de Teclado / Estado Reactivo         │
└───────────────────────────▲────────────────────────────┘
                            │ (IPC invoke tipado)
                            ▼
┌────────────────────────────────────────────────────────┐
│              src/services/api.ts (Gateway)             │
└───────────────────────────▲────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│                  Rust (Tauri 2 Backend)                │
│  Lógica de Negocio / SQLite / Sync Queue / Periféricos  │
└───────────────────────────▲────────────────────────────┘
                            │
          ┌─────────────────┴─────────────────┐
          ▼                                   ▼
┌──────────────────┐               ┌─────────────────────┐
│  SQLite Local    │               │  Megalider ERP API  │
│  (Offline-First) │               │   (Cloud Sync)      │
└──────────────────┘               └─────────────────────┘
```

1. **Backend Rust (`src-tauri/`)**:
   - Posee el **100% de la lógica de negocio**: cálculo de impuestos, totales, descuentos, control de stock, apertura/cierre de turnos de caja, hashing de credenciales y persistencia transaccional ACID.
   - Gestiona la base de datos local SQLite mediante `rusqlite` embebido en `%APPDATA%\com.briankrou.pos-logiventa\logiventa.db`.
   - Administra la cola de sincronización en segundo plano (Sync Outbox) y la comunicación con periféricos (impresoras térmicas ESC/POS, lectores de código de barras, cajón de dinero).

2. **Frontend React 19 (`src/`)**:
   - Capa de **presentación y ergonomía de caja**. Cero lógica de negocio pesada en React.
   - Optimizado para latencia ultrabaja (<50ms en escaneo y agregación de ítems).
   - Diseñado para ser operado 100% mediante teclado (atajos F1-F12, Enter, Esc) y pistolas lectoras de códigos de barra.

3. **Capa API (`src/services/api.ts`)**:
   - **Regla Obligatoria**: Jamás invocar `invoke(...)` de Tauri directamente en componentes React o páginas.
   - Todas las llamadas al backend deben registrarse en `src/services/api.ts` con tipos TypeScript espejo estrictos en `src/types/index.ts`.

---

## 💰 2. Convenciones Financieras y de Dominio (Críticas)

El POS procesa dinero y transacciones comerciales; cualquier error de redondeo o tipo de dato es considerado un fallo crítico:

1. **Dinero SIEMPRE en Centavos Enteros**:
   - Base de Datos (SQLite): tipo `INTEGER`.
   - Backend (Rust): tipo `i64`.
   - Frontend (TypeScript): tipo `number` entero.
   - **PROHIBIDO** el uso de floats/doubles (`f32`, `f64`, `number` decimal) para precios, costos, subtotales o impuestos.
   - Para conversión y formateo en UI, usar siempre `formatCents` y `toCents` de `src/lib/money.ts`.

2. **Impuestos en Puntos Base (Basis Points - BP)**:
   - Las tasas impositivas se representan como enteros donde `1% = 100 bp`.
   - Ejemplos: `1600` = 16.00%, `1900` = 19.00%, `800` = 8.00%, `0` = 0.00%.
   - Cálculo en Rust: `impuesto_centavos = (subtotal_centavos * tax_rate_bp + 5000) / 10000` (redondeo bancario al centavo más cercano).

3. **Cantidades y Granel**:
   - `quantity` y `stock` se almacenan como `REAL` (`f64`) para permitir ventas a granel (kilogramos, gramos, litros).
   - Las validaciones de stock mínimo y redondeo de cantidad se realizan en Rust antes de consolidar la venta.

4. **Integridad de Venta (Zero-Difference Cuadre)**:
   - Para toda venta: `total_cents == subtotal_cents + tax_cents - discount_cents`.
   - La suma de los pagos asociados en `payments` debe igualar exactamente al `total_cents` antes de cerrar la venta.

---

## 🔄 3. Arquitectura de Sincronización con el ERP Megalider

El POS está diseñado para sucursales con conectividad inestable o intermitente:

### 3.1. Principio Offline-First
- El punto de venta **NUNCA debe bloquear una venta, cobro o apertura de caja** si la conexión a internet o el ERP central se caen.
- Toda operación se confirma localmente en SQLite primero dentro de una transacción atómica (`conn.transaction()`).

### 3.2. Mecanismo Outbox (Cola de Sincronización)
- Cada evento transaccional local genera un registro en la cola de sincronización con:
  - `id`: Autoincremental local.
  - `entity_type`: `'sale' | 'cash_session' | 'inventory_movement' | 'customer'`.
  - `entity_id`: ID local de la entidad.
  - `payload`: JSON serializado con los datos necesarios para el ERP.
  - `status`: `'pending' | 'in_flight' | 'synced' | 'failed'`.
  - `attempts`: Número de reintentos.
  - `last_error`: Mensaje del último fallo HTTP/red.
  - `created_at` / `synced_at`: Timestamps ISO-8601 UTC.
- Un worker asíncrono en Rust despacha los registros en lotes (*batch*) hacia el ERP cuando hay red disponible, con retroceso exponencial (*exponential backoff*).

### 3.3. Sincronización Entrante (ERP ➔ POS)
- **Catálogo de Productos y Precios**: Sincronización periódica o disparada manualmente. Los productos actualizados en el ERP actualizan la tabla `products` local sin interrumpir el proceso de venta activo.
- **Identificadores Únicos**:
  - Utilizar folios estructurados y UUIDs para evitar colisiones entre múltiples cajas de la misma sucursal (ejemplo: `FOLIO: SUC01-CAJA02-000123`).
  - Mapear claves externas `erp_id` en las entidades locales para trazabilidad biunívoca.

### 3.4. Integración Contable en ERP
- Al llegar al ERP (`megalider-web-2`), cada venta sincronizada dispara el Motor Contable v6.2 (`generarAsientoContable`), acreditando ingresos e IVA y debitando caja/bancos según el método de pago (`cash`, `card`, `transfer`).

---

## 🛠️ 4. Base de Datos Local y Migraciones SQLite

1. **Ubicación de la BD**:
   - `%APPDATA%\com.briankrou.pos-logiventa\logiventa.db` (en Windows).
   - En desarrollo, las pruebas usan bases de datos en memoria (`:memory:`) o temporales.

2. **Inmutabilidad de Migraciones**:
   - Los scripts SQL residen en `src-tauri/migrations/000N_nombre.sql`.
   - **PROHIBIDO MODIFICAR** un archivo de migración existente que ya haya sido commiteado o ejecutado.
   - Cualquier cambio de esquema requiere crear un nuevo archivo `000(N+1)_descripcion.sql` y registrarlo en el runner `src-tauri/src/db/migrations.rs`.

3. **Pragmas y Seguridad Transaccional**:
   - `PRAGMA foreign_keys = ON;` obligatorio en cada apertura de conexión.
   - Modo WAL activado (`PRAGMA journal_mode = WAL;`) para permitir lecturas concurrentes sin bloquear escrituras de caja.
   - Toda operación multi-tabla (ej. registrar venta + insertar ítems + descontar stock + encolar sync) debe envolverse en un bloque `conn.transaction()?`.

---

## 🖥️ 5. Estándares de Frontend y Experiencia de Usuario (UI/UX POS)

1. **Navegación y Foco Continuo**:
   - El campo de búsqueda / lector de código de barras debe recuperar el foco (`autoFocus` / `inputRef.current?.focus()`) de forma automática tras completar acciones, minimizando el uso del ratón.
   - El cajero debe poder:
     - Buscar por SKU, código de barras o texto predictivo.
     - Cambiar cantidades con atajos (ej. `+`, `-`, `*`).
     - Cobrar con tecla rápida (ej. `F12` o `Espacio`).
     - Cancelar o suspender ticket con `Esc`.

2. **Tipado Estricto TypeScript**:
   - No usar `any` bajo ninguna circunstancia.
   - Cada DTO retornado por comandos Rust debe tener su equivalente tipado en `src/types/index.ts`.
   - La opción `strict: true` de TypeScript debe mantenerse satisfecha en todo momento (`npm run typecheck`).

3. **Diseño y Estilo Visual**:
   - Seguir la identidad gráfica del ecosistema Megalider: paleta limpia, contraste alto para visibilidad en monitores de punto de venta, indicadores visuales de stock bajo (`.low`), estado de conexión (Online / Offline / Sincronizando) y resumen claro de importes.

---

## 🧪 6. Protocolo de Verificación Obligatorio

Antes de dar por completada cualquier modificación o nueva funcionalidad en el POS:

1. **Verificación de Tipos Frontend**:
   ```bash
   npm run typecheck
   ```
2. **Compilación y Tests Backend Rust**:
   ```bash
   npm run test:rust
   # o: cargo test --manifest-path src-tauri/Cargo.toml
   ```
3. **Validación de Integridad**:
   - Verificar que no se hayan introducido cálculos en coma flotante para monedas.
   - Verificar que los nuevos comandos estén registrados en el macro `generate_handler![]` de `src-tauri/src/lib.rs` y expuestos a través de `src/services/api.ts`.
   - Verificar que las transacciones en BD contemplen rollback automático ante errores.
