# Logiventa POS — Reglas y Estándares del Agente de Desarrollo

Sistema de Punto de Venta (POS) de escritorio de alto rendimiento construido con **Tauri 2 + React 19 + TypeScript + Vite + SQLite embebido (`rusqlite`)**, diseñado para operar con arquitectura **Offline-First** y sincronización bidireccional mediante API REST con el servidor de gestión central.

---

## 🏛️ 1. Arquitectura General del Sistema

El sistema está dividido estrictamente en dos capas locales comunicadas por IPC (Inter-Process Communication):

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
│  SQLite Local    │               │   API REST Remota   │
│  (Offline-First) │               │ (`/api/pos/v1/*`)   │
└──────────────────┘               └─────────────────────┘
```

1. **Backend Rust (`src-tauri/`)**:
   - Posee el **100% de la lógica de negocio local**: cálculo de impuestos (porcentuales en puntos base y nominales fijos), totales, descuentos, control de stock, apertura/cierre de turnos de caja (`cash_sessions`), hashing/verificación de credenciales PIN, control de acceso RBAC y persistencia transaccional ACID.
   - Gestiona la base de datos local SQLite mediante `rusqlite` embebido en `%APPDATA%\com.briankrou.pos-logiventa\logiventa.db`.
   - Administra el demonio de sincronización en segundo plano (Sync Outbox, deltas de inventario y reservas temporales) y la comunicación con periféricos (impresoras térmicas ESC/POS, lectores de código de barras, cajón de dinero).

2. **Frontend React 19 (`src/`)**:
   - Capa de **presentación y ergonomía de caja**. Cero lógica de negocio pesada en React.
   - Optimizado para latencia ultrabaja (<50ms en escaneo y agregación de ítems).
   - Diseñado para ser operado 100% mediante teclado (atajos `F1`-`F12`, `+`, `-`, `Insert`, `Delete`, `Enter`, `Esc`) y pistolas lectoras de códigos de barra (interceptor global de teclado).

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

2. **Impuestos en Puntos Base (Basis Points - BP) e Impuestos Nominales**:
   - Las tasas impositivas porcentuales se representan como enteros donde `1% = 100 bp` (ej. `1600` = 16.00%, `1900` = 19.00%, `500` = 5.00%, `0` = 0.00%).
   - Los productos también soportan `tax_fixed_cents` (impuesto nominal fijo por unidad en centavos, ej. bolsas plásticas o ICUI).
   - Cálculo en Rust: `impuesto_centavos = ((subtotal_centavos * tax_rate_bp + 5000) / 10000) + round(tax_fixed_cents * quantity)`.

3. **Cantidades y Granel**:
   - `quantity` y `stock` se almacenan como `REAL` (`f64`) para permitir ventas a granel (kilogramos, gramos, litros).
   - Las validaciones de stock (`controls_stock`, `allow_negative_stock`) y redondeo de cantidad se realizan en Rust antes de consolidar la venta.

4. **Integridad de Venta (Zero-Difference Cuadre)**:
   - Para toda venta: `total_cents == subtotal_cents + tax_cents - discount_cents`.
   - La suma de los pagos asociados en `payments` debe ser mayor o igual al `total_cents` antes de cerrar la venta, registrando cualquier excedente en efectivo como cambio (`change_cents`).

5. **Preservación del Costo Histórico en Ítems de Venta**:
   - Toda venta almacena en `sale_items.unit_cost_cents` el costo del producto (`products.cost_cents`) vigente en el momento exacto de la emisión, incluyéndolo en el payload del Outbox (`unitCostCents`).

---

## 🔄 3. Arquitectura Local Offline-First y Cola de Sincronización

El POS está diseñado para operar en sucursales con conectividad inestable o sin internet:

### 3.1. Principio Offline-First
- El punto de venta **NUNCA debe bloquear una venta, cobro, apertura o cierre de turno** si la conexión a internet o el servidor remoto caen.
- Toda operación se confirma localmente en SQLite primero dentro de una transacción atómica (`conn.transaction()`).

### 3.2. Mecanismo Outbox Local (`sync_queue`)
- Cada evento transaccional local genera un registro en la tabla `sync_queue` con:
  - `id`: Autoincremental local.
  - `entity_type`: `'sale' | 'cash_session' | 'inventory_movement' | 'customer'`.
  - `entity_id`: ID local de la entidad.
  - `payload`: JSON serializado con los datos de la operación.
  - `status`: `'pending' | 'in_flight' | 'synced' | 'failed'`.
  - `attempts`: Contador de reintentos y `last_error`.
- Un demonio asíncrono en Rust (`start_sync_daemon` en `src-tauri/src/commands/sync.rs`) se ejecuta cada 15 segundos para despachar la cola pendiente, subir productos creados en caja (`needs_erp_upload = 1`) y descargar actualizaciones de catálogo, deltas de stock y medios de pago.

### 3.3. Control de Turnos Locales (`cash_sessions`) y Medios de Pago (`payment_methods`)
- Ningún cajero puede facturar sin haber abierto un turno de caja activo (`status = 'open'`) con su base inicial (`opening_cents`).
- Al finalizar la jornada, el cajero ejecuta el arqueo declarando el efectivo físico (`declared_cents`), calculándose localmente la diferencia (`difference_cents`) respecto al efectivo esperado (`opening_cents + ventas_efectivo`).
- Los medios de pago descargados en `payment_methods` pueden habilitarse o deshabilitarse localmente por terminal mediante la columna `terminal_enabled`.

### 3.4. Seguridad Local, RBAC y Latido de Sesión
- Los cajeros se autentican localmente mediante PIN de 4 dígitos verificado contra su hash sincronizado en la tabla `users`.
- La navegación a módulos sensibles (`F3` Catálogo, `F4` Inventario, `F7` Configuración) valida localmente los permisos granulares (`users.permissions`, ej. `inventario:ver`, `inventario:ajustar`, `pos:configuracion`).
- Mientras hay red, el frontend ejecuta cada 15 segundos `api.auth.validateSession()` para comprobar que la terminal y el operador sigan vigentes; si fueron revocados remotamente, bloquea la sesión de inmediato. En caso de corte de red, preserva la sesión activa bajo política Offline-First.

---

## 🛠️ 4. Base de Datos Local y Migraciones SQLite

1. **Ubicación de la BD**:
   - `%APPDATA%\com.briankrou.pos-logiventa\logiventa.db` (en Windows).
   - En pruebas unitarias (`cargo test`), se utilizan bases de datos en memoria (`:memory:`).

2. **Inmutabilidad de Migraciones**:
   - Los scripts SQL residen en `src-tauri/migrations/000N_nombre.sql` (actualmente de `0001_initial.sql` a `0016_product_tags.sql`).
   - **PROHIBIDO MODIFICAR** un archivo de migración existente que ya haya sido commiteado o ejecutado.
   - Cualquier cambio de esquema requiere crear un nuevo archivo `00(N+1)_descripcion.sql` y registrarlo al final del arreglo `MIGRATIONS` en `src-tauri/src/db/migrations.rs`.

3. **Pragmas y Seguridad Transaccional**:
   - `PRAGMA foreign_keys = ON;` obligatorio en cada apertura de conexión.
   - Modo WAL activado (`PRAGMA journal_mode = WAL;`) para permitir lecturas concurrentes sin bloquear escrituras de caja.
   - Toda operación multi-tabla debe envolverse en un bloque `conn.transaction()?`.

---

## 🖥️ 5. Estándares de Frontend y Experiencia de Usuario (UI/UX POS)

1. **Navegación y Foco Continuo**:
   - El campo de lectura de códigos de barras recupera el foco de forma automática tras cualquier acción o clic en áreas libres, además de contar con captura global de caracteres (*Keyboard Wedge Interceptor*).
   - Los tickets en curso se persisten en `localStorage` (`pos_active_tickets`) y el componente `SalesStationPage` permanece montado en el DOM al cambiar entre vistas (`F3`, `F4`, `F7`) para jamás perder productos escaneados.

2. **Sistema Estándar de Modales**:
   - Prohibido usar `window.alert()` o `window.confirm()` nativos. Usar siempre el hook `useModals()` de `src/contexts/ModalContext.tsx` y los componentes de `src/components/ui/modal/`.

3. **Tipado Estricto TypeScript**:
   - Prohibido usar `any`.
   - Cada DTO retornado por comandos Rust debe tener su equivalente tipado en `src/types/index.ts`.
   - `npm run typecheck` debe pasar con 0 errores.

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
   - Verificar que los nuevos comandos estén registrados en `tauri::generate_handler![]` dentro de `src-tauri/src/lib.rs` y expuestos a través de `src/services/api.ts`.
   - Verificar que las transacciones en BD contemplen rollback automático ante errores.

---

## 📦 7. Versionado Semántico, Changelog y Actualizaciones Continuas

1. **Sincronización Triple Obligatoria**:
   - Toda nueva versión debe reflejarse simultáneamente con el mismo identificador SemVer en:
     - `package.json` (`"version"`)
     - `src-tauri/tauri.conf.json` (`"version"`)
     - `src-tauri/Cargo.toml` (`version = "..."`)
   - Usar el comando automatizado `npm run release:patch` o `npm run release:minor`.

2. **Documentación en `CHANGELOG.md`**:
   - Cada entrega debe documentarse obligatoriamente bajo el estándar **Keep a Changelog** (`Agregado`, `Cambiado`, `Corregido`, `Seguridad`).
   - El workflow de CI/CD (`.github/workflows/release.yml`) extrae automáticamente el texto de `CHANGELOG.md` para el cuerpo de la release en GitHub, el cual se muestra directamente al cajero en la tarjeta de actualización (`UpdateNotificationBanner.tsx`).

3. **Instalación Silenciosa**:
   - `tauri.conf.json` debe mantener `"installMode": "quiet"` (variante oficial de Tauri 2 para instalación desatendida) para garantizar que las actualizaciones se instalen en segundo plano sin interrumpir con cuadros de diálogo nativos de Windows Installer.

