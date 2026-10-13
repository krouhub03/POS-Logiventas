# 🚀 Logiventa POS — Sistema de Punto de Venta de Escritorio

Sistema de Punto de Venta (POS) de alto rendimiento, arquitectura **Offline-First** y diseño ergonómico inspirado en Eleventa, construido para el ecosistema **Megalider** con **Tauri 2 + React 19 + TypeScript + Vite** y base de datos local **SQLite embebida (`rusqlite`)**.

Diseñado para operar en entornos comerciales exigentes (cigarrerías, minimarkets, retail y servicios) donde la velocidad de cobro, la estabilidad ante caídas de internet y la compatibilidad con periféricos comerciales son críticas.

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

---

## ✨ Características Principales

- **Arquitectura 100% Offline-First**: Nunca bloquea una venta, cobro o apertura de caja si se cae la conexión a internet. Todas las operaciones se confirman localmente en SQLite bajo transacciones atómicas ACID.
- **Sincronización Bidireccional con ERP Megalider**: Vinculación mediante código seguro o credenciales, sincronización periódica de catálogo de productos, cajeros autorizados y envío en cola asíncrona (*Sync Outbox*) de ventas cerradas para registro contable automático (Motor Contable v6.2).
- **Estación de Ventas Eleventa-Style**:
  - Visor gigante de total a cobrar con soporte de múltiples tickets simultáneos (siempre al menos 1 ticket activo).
  - Captura inteligente del escáner de código de barras (wedge interceptor global), incluso si el cursor no está enfocado en la barra de búsqueda.
  - Persistencia total: los productos ingresados en los tickets nunca se borran al cambiar de pantalla o cerrar la app, a menos que se cancele el ticket o se complete el cobro.
  - Feedback acústico mediante Web Audio API sintetizado (tonos de éxito, advertencia de existencias agotadas y error).
- **Gestión Dual de Productos y Servicios**:
  - **Productos Físicos**: Control estricto de existencias, stock mínimo, alertas de desabasto, cálculo de costo y registro de movimientos de almacén.
  - **Servicios**: Exentos de inventario físico (horas, mantenimientos, fletes, comisiones), se facturan en caja sin exigir stock físico.
- **Auditoría de Inventario y Kardex**: Registro transaccional de ventas, compras, ajustes manuales, mermas y conteos físicos.
- **Modales UI Estándar sin Bloqueo del Navegador**: Erradicación total de `window.alert()` y `window.confirm()` nativos en favor de modales accesibles con teclado (`Enter` / `Esc`), animaciones fluidas y diseño corporativo Megalider.
- **Modo Kiosk / Pantalla Completa Permanente (`F11`)**: Oculta la barra de tareas de Windows para evitar que el cajero minimice o salga accidentalmente de la estación de cobro.
- **Tema Visual Dual (Modo Claro / Modo Oscuro)**: Paleta de alto contraste optimizada para monitores de punto de venta e iluminación variable.

---

## 🏛️ Arquitectura del Sistema

El sistema utiliza una separación estricta de responsabilidades entre el frontend de presentación y el backend de escritorio:

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
│  SQLite Local    │               │  Megalider ERP API  │
│  (Offline-First) │               │   (Cloud Sync)      │
└──────────────────┘               └─────────────────────┘
```

1. **Backend Rust (`src-tauri/`)**:
   - Posee el **100% de la lógica de negocio**: cálculo de importes, impuestos, descuentos, control de stock, cuadre de caja, seguridad de PIN y operaciones SQLite transaccionales.
   - Administra la base de datos embebida SQLite con modo WAL (`PRAGMA journal_mode = WAL`) y llaves foráneas forzadas (`PRAGMA foreign_keys = ON`).
   - Ubicación de la BD en producción: `%APPDATA%\com.briankrou.pos-logiventa\logiventa.db`.
2. **Frontend React 19 (`src/`)**:
   - Capa de **ergonomía y presentación de caja**. Latencia ultra baja (<50ms en escaneo e inserción).
   - Componentes modulares, tipado estricto en TypeScript y cero llamadas directas a `invoke` fuera de `src/services/api.ts`.

---

## 📦 Módulos del Sistema

### 1. Estación de Ventas (`F1`)
- Panel de lectura de códigos de barras (soporta códigos del fabricante o formato `CANTIDAD*CODIGO`, ej. `5*75010001`).
- Pestañas de tickets dinámicos: Permite pausar una venta para atender a otro cliente agregando pestañas (`Ticket 1`, `Ticket 2`, etc.).
- Modal de Cobro (`F12`): Métodos de pago (Efectivo, Tarjeta, Transferencia, Mixto), cálculo automático de cambio, desglose de subtotal e IVA.
- Modal de Artículo Común / Varios (`Insert`): Para registrar ventas de productos no catalogados rápidamente con descripción y precio libre.
- Modal de Búsqueda Rápida de Productos (`F10`): Explorador visual por nombre con selección inmediata mediante teclado.

### 2. Catálogo de Productos y Servicios (`F3`)
- Búsqueda reactiva instantánea por texto, SKU o código de barras.
- Filtros por tipo: *Todos*, *📦 Físicos*, *🛠️ Servicios* y *⚠️ Stock Bajo / Agotado*.
- Formulario de alta y edición:
  - Selector [📦 Producto Físico] / [🛠️ Servicio].
  - Generador automático de SKU / Código de barras para productos sin código de fábrica.
  - Precios de venta, costo y tasas de IVA (0%, 5%, 16%, 19%).
  - Configuración de existencias iniciales, stock mínimo y unidades (`pza`, `kg`, `g`, `lt`, `caja`, `paq`, `serv`).
- Eliminación segura (*Soft Delete*): Desactiva productos sin alterar la integridad de ventas históricas.

### 3. Control de Existencias y Kardex (`F4`)
- Panel de existencias en tiempo real con semáforo visual de stock crítico.
- Modal de Ajuste de Inventario: Conteo físico, mermas, caducidades o entradas directas con justificación obligatoria.
- Kardex de Movimientos: Historial detallado con fecha, hora, tipo de movimiento (*Venta*, *Ajuste*, *Entrada*), cantidad (+/-) y referencia del folio.

### 4. Configuración de Hardware y Terminal (`F7`)
- **Impresora de Tickets**: Conexión a impresoras térmicas ESC/POS (58mm / 80mm), puerto USB/Serial/Red, corte automático de papel e impresión de prueba.
- **Cajón de Dinero**: Disparo de pulso eléctrico RJ11 al cobrar en efectivo y botón de prueba de apertura.
- **Lector de Códigos**: Configuración de sufijo (Enter) y modo emulación teclado.
- **Enlace ERP**: Visualización de estado de vinculación, caja asignada, sucursal, sincronización manual de operadores y desvinculación segura.

### 5. Control de Acceso y Bloqueo de Caja (`Esc`)
- Bloqueo instantáneo con teclado o botón.
- Desbloqueo mediante teclado numérico en pantalla o teclado físico con PIN de 4 dígitos.
- Identificación clara del cajero activo y sucursal.

---

## ⌨️ Atajos de Teclado (Cheat Sheet)

La interfaz está diseñada para operarse el 100% del tiempo sin necesidad de utilizar el ratón:

| Tecla / Atajo | Módulo | Acción |
|---|---|---|
| **`F1`** | Global | Ir a la Estación de Ventas / Volver a Cobro |
| **`F3`** | Global | Ir al Catálogo de Productos y Servicios |
| **`F4`** | Global | Ir al Control de Inventario y Existencias |
| **`F7`** | Global | Ir a la Configuración de Periféricos y Hardware |
| **`F8`** o `Alt+N` | Productos | Abrir modal para crear nuevo producto o servicio |
| **`F10`** | Ventas | Abrir buscador de productos por nombre |
| **`F11`** | Global | Alternar Pantalla Completa (Oculta barra de tareas de Windows) |
| **`F12`** o `Ctrl+Espacio` | Ventas | Abrir modal de cobro y pago del ticket actual |
| **`Insert`** | Ventas | Agregar artículo común o varios sin código |
| **`Delete`** / `Supr` | Ventas | Eliminar la línea de producto seleccionada del ticket |
| **`Ctrl` + `+`** | Ventas | Incrementar en 1 la cantidad del producto seleccionado |
| **`Ctrl` + `-`** | Ventas | Decrementar en 1 la cantidad del producto seleccionado |
| **`Flecha Arriba / Abajo`** | Ventas | Navegar entre los productos agregados al ticket |
| **`Enter`** | Ventas | Agregar producto escaneado / Confirmar modales |
| **`Escape`** | Global | Limpiar código escaneado ➔ Cancelar ticket ➔ Volver |

---

## 💰 Convenciones Financieras y de Dominio

Por regla estricta de diseño para evitar errores de redondeo en operaciones comerciales:

1. **Moneda en Centavos Enteros**:
   - En SQLite: columna de tipo `INTEGER`.
   - En Rust: tipo `i64`.
   - En TypeScript: tipo `number` entero.
   - **Queda prohibido el uso de coma flotante (`f32`, `f64`, `number` decimal) para importes monetarios**.
   - Para conversión y presentación en UI, se emplean exclusivamente las utilidades de `src/lib/money.ts`:
     - `formatCents(cents: number)`: `$1,250.00`
     - `toCents(amount: number | string)`: Convierte texto o decimal a entero sin error de precisión.
2. **Impuestos en Puntos Base (Basis Points - BP)**:
   - `1% = 100 bp` (ejemplos: `1600` = 16.00%, `1900` = 19.00%, `500` = 5.00%, `0` = 0.00%).
   - Cálculo en Rust con redondeo bancario: `impuesto = (subtotal * tax_bp + 5000) / 10000`.
3. **Cantidades y Granel**:
   - `quantity` y `stock` se manejan en `REAL` (`f64`) para permitir ventas pesadas (ej. 1.250 kg).
4. **Integridad de Venta (Zero-Difference Cuadre)**:
   - `total_cents == subtotal_cents + tax_cents - discount_cents`.
   - La suma de los pagos asociados debe ser mayor o igual al total antes de autorizar la transacción.

---

## 📂 Estructura del Proyecto

```
POS-Logiventa/
├── src/                          # Capa de Presentación (React 19 + TypeScript)
│   ├── assets/                   # Recursos visuales
│   ├── components/               # Componentes de UI
│   │   ├── ui/modal/             # Sistema estándar de modales (ModalRoot, ConfirmModal, etc.)
│   │   ├── CashierLockScreen.tsx # Pantalla de bloqueo con PIN de 4 dígitos
│   │   ├── CobroModal.tsx        # Modal de cobro multimétodo
│   │   ├── PairingScreen.tsx     # Pantalla de vinculación inicial con el ERP
│   │   ├── SearchProductModal.tsx# Buscador de productos
│   │   └── VariosModal.tsx       # Venta rápida de artículos varios
│   ├── contexts/                 # Contextos de estado global
│   │   ├── ModalContext.tsx      # Proveedor y hook useModals()
│   │   └── ThemeContext.tsx      # Modo Claro / Modo Oscuro
│   ├── lib/                      # Utilidades de frontend
│   │   ├── money.ts              # Conversión y formateo en centavos
│   │   └── sound.ts              # Síntesis de audio Web Audio API
│   ├── pages/                    # Pantallas principales del sistema
│   │   ├── ProductsPage.tsx      # Catálogo, inventario y kardex (F3/F4)
│   │   ├── SalesStationPage.tsx  # Estación de ventas Eleventa-Style (F1)
│   │   └── SettingsPage.tsx      # Configuración de hardware y enlace (F7)
│   ├── services/                 # Servicios y comunicación IPC
│   │   └── api.ts                # Único punto de acceso tipado a Rust (invoke)
│   ├── types/                    # Tipos TypeScript espejo de Rust
│   │   └── index.ts              # Definiciones completas de DTOs
│   ├── App.tsx                   # Controlador de navegación y vistas vivas
│   ├── main.tsx                  # Entrada de la aplicación React
│   └── index.css                 # Estilos Tailwind CSS
├── src-tauri/                    # Capa de Negocio y Sistema (Rust + Tauri 2)
│   ├── migrations/               # Migraciones SQLite versionadas
│   │   ├── 0001_initial.sql      # Tablas base: users, products, sales, etc.
│   │   ├── 0002_terminal_settings.sql # Configuración de terminal y caja
│   │   ├── 0003_hardware_settings.sql # Periféricos, ticket e impresora
│   │   └── 0004_product_services.sql  # Soporte para servicios y existencias
│   ├── src/
│   │   ├── commands/             # Comandos Tauri #[tauri::command]
│   │   │   ├── auth.rs           # Autenticación de cajeros y enlace M2M
│   │   │   ├── products.rs       # CRUD de productos, servicios y kardex
│   │   │   ├── sales.rs          # Creación transaccional de ventas y pagos
│   │   │   ├── settings.rs       # Gestión de ajustes de hardware
│   │   │   └── system.rs         # Info del sistema y modo pantalla completa
│   │   ├── db/                   # Conexión SQLite y runner de migraciones
│   │   │   ├── migrations.rs     # Ejecutor atómico de scripts SQL
│   │   │   └── mod.rs            # Pool y conexión rusqlite
│   │   ├── models/               # DTOs y estructuras serializables
│   │   ├── error.rs              # Manejo centralizado de errores
│   │   ├── lib.rs                # Registro de comandos y plugins
│   │   └── main.rs               # Punto de entrada de la aplicación Rust
│   ├── Cargo.toml                # Dependencias de Rust
│   └── tauri.conf.json           # Configuración de ventana y permisos Tauri
├── AGENTS.md                     # Directivas de desarrollo para agentes IA
└── package.json                  # Dependencias de Node.js
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
| `npm run tauri dev` | Inicia la aplicación en modo desarrollo con recarga en vivo (HMR) |
| `npm run typecheck` | Ejecuta la verificación estricta de tipos de TypeScript (`tsc --noEmit`) |
| `npm run test:rust` | Corre los tests unitarios del backend Rust (`cargo test`) |
| `npm run tauri build` | Compila los binarios optimizados y genera el instalador MSI / EXE |

---

## 🗄️ Base de Datos y Migraciones

- **Motor**: SQLite embebido compilado estáticamente mediante `rusqlite`.
- **Ruta local**:
  - En Windows: `%APPDATA%\com.briankrou.pos-logiventa\logiventa.db`
  - En pruebas unitarias: En memoria temporal (`:memory:`).
- **Regla de Inmutabilidad de Migraciones**:
  - Nunca modificar un archivo `.sql` ya publicado.
  - Para agregar cambios de esquema, crear un archivo `src-tauri/migrations/000(N+1)_nombre.sql` y registrarlo en el runner `src-tauri/src/db/migrations.rs`.

---

## 🖨️ Hardware y Periféricos Compatibles

| Periférico | Protocolo / Interfaz | Formatos Soportados |
|---|---|---|
| **Impresoras Térmicas** | ESC/POS estándar (USB, Serial COM, Red TCP) | 58mm y 80mm con o sin cortador automático |
| **Cajón Portamonedas** | Disparo por solenoide RJ11 / RJ12 | Conectado directamente a la impresora térmica |
| **Lectores de Código** | Emulación teclado (Keyboard Wedge) USB / 2.4G | 1D (EAN-13, Code 128, UPC) y 2D (QR) |
| **Pantallas Táctiles** | Driver Windows estándar | Compatible con monitores POS de 15" y 17" |

---

## 📄 Licencia

Desarrollado para el ecosistema **Megalider POS**. Todos los derechos reservados.