# 🚀 Metahabi POS — Sistema de Punto de Venta de Escritorio

Sistema de Punto de Venta (POS) de alto rendimiento, arquitectura **Offline-First** y diseño ergonómico de mostrador, construido con **Tauri 2 + React 19 + TypeScript + Vite** y base de datos local **SQLite embebida (`rusqlite`)**.

Diseñado para operar en entornos comerciales exigentes (cigarrerías, minimarkets, retail y servicios) donde la velocidad de cobro, la autonomía ante caídas de internet y la compatibilidad con periféricos comerciales son críticas.

---

## 📑 Tabla de Contenidos

1. [Características Principales](#-características-principales)
2. [Arquitectura del Sistema](#-arquitectura-del-sistema)
3. [Módulos del Sistema](#-módulos-del-sistema)
4. [Atajos de Teclado (Cheat Sheet)](#-atajos-de-teclado-cheat-sheet)
5. [Convenciones Financieras y de Dominio](#-convenciones-financieras-y-de-dominio)
6. [Estructura del Proyecto](#-estructura-del-proyecto)
7. [Requisitos e Instalación](#-requisitos-e-instalación)
8. [Comandos de Desarrollo y Compilación](#-comandos-de-desarrollo-y-compilación)
9. [Base de Datos y Migraciones](#-base-de-datos-y-migraciones)
10. [Hardware y Periféricos Compatibles](#-hardware-y-periféricos-compatibles)
11. [Actualizaciones Automáticas (Tauri 2 Updater)](#-actualizaciones-automáticas-tauri-2-updater)

---

## ✨ Características Principales

- **Arquitectura 100% Offline-First**: Nunca bloquea una venta, cobro, apertura o cierre de turno si se cae la conexión a internet. Todas las operaciones se confirman localmente en SQLite bajo transacciones atómicas ACID.
- **Demonio de Sincronización Continua en Rust**: Tarea concurrente en segundo plano ejecutándose cada 15s que despacha la cola local (`sync_queue`), sube productos creados en caja, descarga catálogo y medios de pago, sincroniza deltas de inventario y gestiona reservas temporales de stock crítico.
- **Control de Turnos de Caja y Arqueo (Z-Report)**: Apertura obligatoria de turno con base inicial en efectivo, seguimiento en tiempo real de recaudos por medio de pago y cierre de turno con declaración de efectivo contado y cálculo de diferencias (sobrante/faltante).
- **Estación de Ventas de Alta Velocidad**:
  - Visor de total a cobrar con soporte de múltiples tickets en espera simultáneos (`F6` / pestañas dinámicas).
  - Captura inteligente del escáner de código de barras (*Keyboard Wedge Interceptor* global), incluso si el cursor no está enfocado en la barra de búsqueda.
  - Persistencia total: la vista de ventas permanece viva en memoria y los tickets se respaldan en `localStorage`, evitando pérdidas al cambiar de módulo o reiniciar la aplicación.
  - Feedback acústico mediante Web Audio API sintetizado (tonos de éxito, advertencia de existencias y error).
- **Gestión de Productos, Servicios, Combos y Etiquetas (`#tags`)**:
  - **Productos Físicos y Combos**: Control de existencias, stock mínimo, políticas de stock negativo, impuestos porcentuales (BP) e impuestos nominales fijos por unidad (`tax_fixed_cents`).
  - **Servicios**: Exentos de inventario físico (`is_service = 1`, `controls_stock = 0`).
  - **Etiquetas Maestras (`product_tags`)**: Clasificación visual con colores hexadecimales para filtrado instantáneo en catálogo y buscador rápido (`F10`).
- **Directorio de Clientes en Caja (`F2`)**: Búsqueda rápida por nombre, documento fiscal (NIT/CC) o teléfono, creación inmediata de clientes en mostrador y vinculación/desvinculación al ticket actual.
- **Seguridad RBAC Granular y Bloqueo por PIN**:
  - Desbloqueo rápido por cajero con PIN de 4 dígitos y ordenamiento inteligente por frecuencia de uso (`login_count`).
  - Permisos granulares por operador (`inventario:ver`, `inventario:ajustar`, `pos:configuracion`) y validación periódica de sesión activa.
- **Modales UI Estándar y Modo Kiosco (`F11`)**: Cero uso de `window.alert()` / `window.confirm()`, soporte de Modo Claro/Oscuro y controles de ventana integrados.

---

## 🏛️ Arquitectura del Sistema

El sistema utiliza una separación estricta de responsabilidades entre el frontend de presentación y el backend nativo en Rust:

```
┌────────────────────────────────────────────────────────┐
│                   React 19 (Frontend)                  │
│       UI / Atajos de Teclado / Estado Reactivo         │
└───────────────────────────▲────────────────────────────┘
                            │ (IPC tipado via @tauri-apps/api)
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
   - Posee el **100% de la lógica de negocio**: cálculo de importes, impuestos, descuentos, control de stock, turnos de caja, seguridad de PIN y operaciones SQLite transaccionales.
   - Administra la base de datos embebida SQLite con modo WAL (`PRAGMA journal_mode = WAL`) y llaves foráneas forzadas (`PRAGMA foreign_keys = ON`).
   - Ubicación de la BD en producción: `%APPDATA%\com.briankrou.pos-logiventa\logiventa.db`.
2. **Frontend React 19 (`src/`)**:
   - Capa de **ergonomía y presentación de caja**. Latencia ultra baja (<50ms en escaneo e inserción).
   - Componentes modulares, tipado estricto en TypeScript y cero llamadas directas a `invoke` fuera de `src/services/api.ts`.

---

## 📦 Módulos del Sistema

### 1. Estación de Ventas (`F1`)
- Lectura de códigos de barras (soporta códigos estándar o formato multiplicador `CANTIDAD*CODIGO`, ej. `5*75010001`).
- Gestión de múltiples tickets en espera (`F6` o botón `+`) para atender a varios clientes simultáneamente.
- Asignación de cliente al ticket (`F2` para buscar/crear, `Shift+F2` para desvincular).
- Modal de Búsqueda Rápida de Productos (`F10`) con filtrado por nombre, código o etiquetas de color (`#tags`).
- Modal de Artículo Común / Varios (`Insert`) para cobros rápidos de ítems no catalogados.
- Modal de Cobro (`F12` o `Ctrl+Espacio`): Verificación previa de stock crítico, selección de medios de pago dinámicos (Efectivo, Tarjeta, Transferencia, Billeteras Digitales, Mixto), cálculo de cambio y disparo de impresora/cajón.

### 2. Gestión de Turnos de Caja y Arqueo (`OpenShiftModal` / `CloseShiftModal`)
- **Apertura de Turno**: Al iniciar sesión con PIN, si no hay un turno abierto en la terminal, solicita la base inicial de efectivo (`opening_cents`) y genera el folio del turno.
- **Cierre de Turno y Arqueo (Z-Report)**: Muestra el resumen del turno en curso, recibe el efectivo físico contado por el cajero (`declared_cents`), calcula diferencias y cierra la sesión local y remotamente.

### 3. Catálogo de Productos, Servicios y Etiquetas (`F3`)
- Búsqueda reactiva por texto, SKU, código de barras y filtro multi-selección por **Etiquetas (`#tags`)**.
- Filtros rápidos por tipo (*Todos*, *📦 Físicos*, *🛠️ Servicios*).
- Creación y edición (`F8` o `Alt+N`) con generador automático de SKU/código de barras, precios, costos, IVA (0%, 5%, 16%, 19%), unidades (`pza`, `kg`, `g`, `lt`, `caja`, `paq`, `serv`) y asignación de etiquetas.
- Gestor integrado de **Etiquetas Maestras** con paleta de colores hexadecimales.

### 4. Control de Existencias y Kardex (`F4`)
- Semáforo visual de stock en tiempo real (*Óptimo*, *Stock Bajo*, *Agotado*).
- Modal de Ajuste de Inventario con motivo obligatorio (*Conteo físico*, *Merma/Daño*, *Entrada directa*, *Devolución*).
- Pestaña de **Kardex / Movimientos** con historial auditable por producto, fecha, cantidad (+/-), usuario y folio de referencia.

### 5. Configuración de Hardware, Medios de Pago y Terminal (`F7`)
- **Impresora Térmica**: Configuración ESC/POS (58mm / 80mm), puerto USB/Serial/Red, copias, corte automático e impresión de ticket de prueba.
- **Cajón Portamonedas**: Apertura automática al cobrar en efectivo y botón de pulso de prueba RJ11.
- **Escáner**: Configuración de prefijos/sufijos y captura global.
- **Medios de Pago**: Sincronización de canales de cobro desde el servidor y switches individuales (`terminal_enabled`) para habilitar o deshabilitar medios específicos en esta caja física.
- **Terminal y General**: Estado de vinculación M2M, sincronización de cajeros, tema visual (Claro/Oscuro) y buscador manual de actualizaciones de software.

---

## ⌨️ Atajos de Teclado (Cheat Sheet)

La interfaz está diseñada para operarse el 100% del tiempo sin necesidad de utilizar el ratón:

| Tecla / Atajo | Módulo | Acción |
|---|---|---|
| **`F1`** | Global | Ir a la Estación de Ventas / Volver a Cobro |
| **`F2`** | Ventas | Abrir modal para asignar o crear Cliente en el ticket actual |
| **`Shift` + `F2`** | Ventas | Desvincular el cliente asignado al ticket actual |
| **`F3`** | Global | Ir al Catálogo de Productos, Servicios y Etiquetas (requiere `inventario:ver`) |
| **`F4`** | Global | Ir al Control de Inventario y Kardex (requiere `inventario:ver` / `inventario:ajustar`) |
| **`F6`** | Ventas | Poner ticket actual en espera / Crear nueva pestaña de ticket |
| **`F7`** | Global | Ir a Configuración de Hardware y Medios de Pago (requiere `pos:configuracion`) |
| **`F8`** o `Alt+N` | Productos | Abrir modal para crear nuevo producto o servicio |
| **`F10`** | Ventas | Abrir buscador rápido de productos por nombre o etiqueta |
| **`F11`** | Global | Alternar Pantalla Completa (Modo Kiosco sin barra de tareas) |
| **`F12`** o `Ctrl+Espacio` | Ventas | Verificar stock y abrir modal de cobro del ticket actual |
| **`Alt` + `R`** | Ventas | Reimprimir inmediatamente el ticket de la última venta cobrada (`🖨️ Ticket Alt+R`) |
| **`Alt` + `U`** | Ventas | Abrir el perfil del operador activo (cambio de PIN, tema y sonido) |
| **`Insert`** | Ventas | Agregar artículo común o varios sin código |
| **`Delete`** / `Supr` | Ventas | Eliminar la línea de producto seleccionada del ticket |
| **`+`** / `NumpadAdd` | Ventas | Incrementar en 1 la cantidad del producto seleccionado |
| **`-`** / `NumpadSubtract` | Ventas | Decrementar en 1 la cantidad del producto seleccionado |
| **`Flecha Arriba / Abajo`** | Ventas | Navegar entre las líneas de productos agregadas al ticket |
| **`Enter`** | Ventas | Procesar código escaneado / Confirmar modales |
| **`Escape`** | Global | Limpiar input de código ➔ Cancelar/eliminar ticket actual ➔ Volver a Ventas |

---

## 💰 Convenciones Financieras y de Dominio

Por regla estricta de diseño para evitar errores de redondeo IEEE 754 en operaciones comerciales:

1. **Moneda en Centavos Enteros**:
   - En SQLite: columna de tipo `INTEGER`.
   - En Rust: tipo `i64`.
   - En TypeScript: tipo `number` entero.
   - **Queda prohibido el uso de coma flotante (`f32`, `f64`, `number` decimal) para importes monetarios**.
   - Para conversión y presentación en UI, se emplean exclusivamente las utilidades de `src/lib/money.ts` (`formatCents`, `toCents`, `calculateTaxCents`).
2. **Impuestos en Puntos Base (Basis Points - BP) y Nominales**:
   - `1% = 100 bp` (ejemplos: `1600` = 16.00%, `1900` = 19.00%, `500` = 5.00%, `0` = 0.00%).
   - Soporte adicional para impuesto fijo unitario (`tax_fixed_cents`).
   - Cálculo en Rust con redondeo bancario: `impuesto = ((subtotal * tax_bp + 5000) / 10000) + round(tax_fixed_cents * quantity)`.
3. **Cantidades y Granel**:
   - `quantity` y `stock` se manejan en `REAL` (`f64`) para permitir ventas pesadas o fraccionadas (ej. `1.250 kg`).
4. **Integridad de Venta y Costo Histórico**:
   - `total_cents == subtotal_cents + tax_cents - discount_cents`.
   - Cada línea de venta persiste `unit_cost_cents` con el costo vigente al momento del cobro.

---

## 📂 Estructura del Proyecto

```
POS-Logiventa/
├── docs/                         # Documentación del POS
│   ├── ARQUITECTURA_TECNICA.md   # Especificación de ingeniería, esquema SQLite e IPC
│   └── MANUAL_DE_USUARIO.md      # Guía paso a paso para cajeros y administradores
├── src/                          # Capa de Presentación (React 19 + TypeScript)
│   ├── components/               # Componentes de UI e interacción
│   │   ├── ui/modal/             # Sistema estándar de modales (ModalRoot, ConfirmModal, AlertModal)
│   │   ├── CashierLockScreen.tsx # Pantalla de bloqueo y selección de cajero con PIN de 4 dígitos
│   │   ├── CloseShiftModal.tsx   # Modal de arqueo de caja y cierre de turno (Z-Report)
│   │   ├── CobroModal.tsx        # Modal de cobro multimétodo dinámico
│   │   ├── CustomerModal.tsx     # Buscador y alta rápida de clientes (F2)
│   │   ├── OpenShiftModal.tsx    # Apertura obligatoria de turno con base inicial
│   │   ├── PairingScreen.tsx     # Pantalla de vinculación inicial M2M de la terminal
│   │   ├── SearchProductModal.tsx# Buscador rápido de catálogo y etiquetas (F10)
│   │   ├── UpdateNotificationBanner.tsx # Banner no intrusivo de actualización lista
│   │   └── VariosModal.tsx       # Venta rápida de artículos varios (Insert)
│   ├── contexts/                 # Contextos de estado global
│   │   ├── ModalContext.tsx      # Proveedor y hook imperativo useModals()
│   │   ├── ThemeContext.tsx      # Modo Claro / Modo Oscuro
│   │   └── UpdaterContext.tsx    # Gestión de auto-actualizaciones Tauri 2
│   ├── lib/                      # Utilidades de dominio en frontend
│   │   ├── money.ts              # Conversión, formateo y cálculo de impuestos en centavos
│   │   ├── permissions.ts        # Evaluador RBAC de permisos de cajero (hasPermission)
│   │   ├── sound.ts              # Síntesis acústica con Web Audio API
│   │   └── tags.ts               # Parser y normalizador de etiquetas de productos
│   ├── pages/                    # Pantallas principales del sistema
│   │   ├── ProductsPage.tsx      # Catálogo, etiquetas, inventario y kardex (F3/F4)
│   │   ├── SalesStationPage.tsx  # Estación de ventas principal (F1)
│   │   └── SettingsPage.tsx      # Configuración de periféricos, medios de pago y enlace (F7)
│   ├── services/                 # Gateway IPC
│   │   └── api.ts                # Único punto de acceso tipado a comandos y eventos de Rust
│   ├── types/                    # Contratos TypeScript espejo de Rust
│   │   └── index.ts              # Definiciones completas de DTOs
│   ├── App.tsx                   # Orquestador de sesión, turno activo, RBAC y vistas
│   └── main.tsx                  # Punto de entrada React
├── src-tauri/                    # Capa de Negocio y Sistema (Rust + Tauri 2)
│   ├── migrations/               # Migraciones SQLite versionadas e inmutables (0001 a 0016)
│   │   ├── 0001_initial.sql                       # Tablas base: users, products, sales, sale_items, payments, cash_sessions
│   │   ├── 0002_terminal_settings.sql             # Ajustes de vinculación de terminal y cajeros
│   │   ├── 0003_hardware_settings.sql             # Parámetros de impresora térmica, cajón y escáner
│   │   ├── 0004_product_services.sql              # Soporte para servicios (is_service) y stock mínimo
│   │   ├── 0005_sync_queue.sql                    # Cola transaccional Outbox (sync_queue)
│   │   ├── 0006_product_erp_id.sql                # Mapeo de clave externa erp_id en products
│   │   ├── 0007_product_sync_flag.sql             # Bandera needs_erp_upload para altas en caja
│   │   ├── 0008_payment_methods.sql               # Tabla payment_methods con mapeo contable PUC
│   │   ├── 0009_cash_shifts.sql                   # Campos de turno y arqueo en cash_sessions
│   │   ├── 0010_dynamic_payments.sql              # Pagos dinámicos y switch local terminal_enabled
│   │   ├── 0011_user_permissions.sql              # Permisos RBAC granulares en users
│   │   ├── 0012_pos_profiles_and_granular_rbac.sql# Tabla pos_profiles y métricas login_count
│   │   ├── 0013_clean_dummy_profiles.sql          # Depuración de perfiles iniciales
│   │   ├── 0014_product_policies_and_tags.sql     # Políticas de stock, combos, tags y tax_fixed_cents
│   │   ├── 0015_sale_items_historical_cost.sql    # Costo unitario histórico unit_cost_cents en sale_items
│   │   └── 0016_product_tags.sql                  # Catálogo maestro de etiquetas con color (product_tags)
│   ├── src/
│   │   ├── commands/             # Comandos #[tauri::command]
│   │   │   ├── auth.rs           # Vinculación M2M, sincronización de usuarios, login PIN y heartbeat
│   │   │   ├── customers.rs      # Listado, búsqueda y creación de clientes locales
│   │   │   ├── products.rs       # CRUD de productos, servicios, etiquetas (tags), ajustes y kardex
│   │   │   ├── sales.rs          # Creación transaccional de ventas, pagos y encolado Outbox
│   │   │   ├── settings.rs       # Configuración de periféricos y pruebas de impresora/cajón
│   │   │   ├── shifts.rs         # Apertura, resumen y cierre de turnos de caja (Z-Report)
│   │   │   ├── sync.rs           # Demonio de sincronización, reservas de stock, catálogo y medios de pago
│   │   │   └── system.rs         # Información de versión, pantalla completa y reinicio
│   │   ├── db/                   # Conexión SQLite y runner atómico de migraciones
│   │   ├── models/               # Estructuras y DTOs serializables (Serde)
│   │   ├── error.rs              # Manejo centralizado de errores (AppError / AppResult)
│   │   ├── lib.rs                # Inicialización de plugins, BD, Sync Daemon y generate_handler![]
│   │   └── main.rs               # Binario principal
│   ├── Cargo.toml                # Dependencias de Rust
│   └── tauri.conf.json           # Configuración de ventana, bundle y Tauri Updater
├── AGENTS.md                     # Directivas y reglas para agentes de desarrollo
└── package.json                  # Scripts y dependencias de frontend
```

---

## 💻 Requisitos e Instalación

### Prerrequisitos de Entorno

1. **Node.js**: Versión 20+ o 22+ LTS.
2. **Rust**: Versión estable (`rustup toolchain install stable`).
3. **Herramientas de compilación de Windows**:
   - Visual Studio C++ Build Tools (MSVC).
   - Microsoft WebView2 Runtime (incluido en Windows 10/11 por defecto).
   - Ver guía oficial: [Tauri Prerequisites for Windows](https://tauri.app/start/prerequisites/).

### Instalación de Dependencias

Clonar el repositorio y ejecutar:

```bash
cd POS-Logiventa
npm install
```

---

## 🛠️ Comandos de Desarrollo y Compilación

| Comando | Descripción |
|---|---|
| `npm run tauri dev` | Inicia la aplicación de escritorio en modo desarrollo con recarga en vivo (HMR) |
| `npm run typecheck` | Ejecuta la verificación estricta de tipos de TypeScript (`tsc --noEmit`) |
| `npm run test:rust` | Corre los tests unitarios y de migraciones del backend Rust (`cargo test`) |
| `npm run tauri build` | Compila los binarios optimizados y genera el instalador NSIS / MSI |

---

## 🗄️ Base de Datos y Migraciones

- **Motor**: SQLite embebido compilado estáticamente mediante `rusqlite` (`bundled`).
- **Ruta local**:
  - En Windows: `%APPDATA%\com.briankrou.pos-logiventa\logiventa.db`
  - En pruebas unitarias: En memoria temporal (`:memory:`).
- **Regla de Inmutabilidad de Migraciones**:
  - Nunca modificar un archivo `.sql` ya publicado.
  - Para agregar cambios de esquema, crear un archivo `src-tauri/migrations/00(N+1)_nombre.sql` y registrarlo en `src-tauri/src/db/migrations.rs`.

---

## 🖨️ Hardware y Periféricos Compatibles

| Periférico | Protocolo / Interfaz | Formatos Soportados |
|---|---|---|
| **Impresoras Térmicas** | ESC/POS estándar (USB, Serial COM, Red TCP) | 58mm y 80mm con o sin cortador automático |
| **Cajón Portamonedas** | Disparo por solenoide RJ11 / RJ12 | Conectado directamente a la impresora térmica |
| **Lectores de Código** | Emulación teclado (Keyboard Wedge) USB / 2.4G / Bluetooth | 1D (EAN-13, Code 128, UPC) y 2D (QR) |
| **Pantallas Táctiles** | Driver Windows estándar | Compatible con monitores POS de 15" y 17" |

---

## 🔄 Actualizaciones Automáticas (Tauri 2 Updater)

El punto de venta cuenta con auto-actualización silenciosa en segundo plano mediante **GitHub Releases**:

1. **Par de Claves Criptográficas**:
   - Clave privada guardada en: `%USERPROFILE%\.tauri\pos-logiventa.key` (¡nunca compartir ni subir a git!).
   - Clave pública configurada en `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`).
2. **Comportamiento en Caja**:
   - **Verificación silenciosa**: Al arrancar la terminal (tras 4 segundos) y periódicamente cada 60 minutos en segundo plano.
   - **Descarga sin bloqueos**: Descarga e instala silenciosamente sin interrumpir cobros ni ventas en curso.
   - **Aviso no intrusivo**: Muestra un banner flotante `[🔄 Reiniciar ahora]` cuando la nueva versión está lista para aplicarse.
   - **Control manual**: En `Configuración (F7) > General`, el usuario puede pulsar *Buscar Actualizaciones Ahora* para forzar una comprobación.
3. **Generar y Firmar una Nueva Versión de Release**:
   Para compilar y firmar los instaladores (`.nsis.zip`, `.sig` y `latest.json`):

   ```powershell
   # En Windows PowerShell:
   $env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content "$HOME\.tauri\pos-logiventa.key" -Raw).Trim()
   npm run tauri build
   ```

   Los artefactos firmados se generarán en `src-tauri/target/release/bundle/nsis/` junto con el archivo de manifiesto `latest.json`.

---

## 📄 Licencia

Desarrollado para el ecosistema **Metahabi POS**. Todos los derechos reservados.
