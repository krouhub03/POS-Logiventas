# Registro de Cambios (Changelog) — Metahabi POS

Todos los cambios notables en este proyecto se documentarán en este archivo.
El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y este proyecto se adhiere a [Semantic Versioning (SemVer)](https://semver.org/lang/es/).

---

## [0.1.11] - 2026-10-31
### Agregado
- Depuracion de barra superior de login y bloqueo estricto de apagado con turno abierto
---
## [0.1.10] - 2026-10-29
### Agregado
- Sincronizacion de imagenes POS-ERP y proteccion de catalogos

### Cambios recientes
- fix(sync): corregir lectura de erp_url y despachar subida y descarga de imágenes en catálogo
---
## [0.1.9] - 2026-10-27

### Agregado
- **Rebranding Oficial a Metahabi POS:** Actualización integral de identidad visual, nombre de aplicación, banners de licencia, encabezados y documentación a Metahabi POS, preservando el almacenamiento local para total compatibilidad y continuidad operacional.
- **Botones Ergonómicos de Incremento y Reducción Unitaria en Mostrador (`SalesStationPage.tsx` y `VariosModal.tsx`):** Controles dedicados `−` y `+` por línea en la tabla del ticket de venta y en el diálogo de artículos varios para modificar la cantidad en saltos exactos de 1 unidad con prevención de apertura accidental por doble clic.

### Corregido
- **Blindaje contra Incremento Accidental de Múltiples Unidades (`VariosModal.tsx` y `SalesStationPage.tsx`):** Reemplazo de los inputs nativos con spinners de Chromium/WebView2 por campos de texto numérico controlado con sanitización estricta, eliminando el error donde la rueda del ratón o el evento repetitivo de flechas sumaba múltiples unidades por clic (ej. 29 unidades involuntarias).
- **Aislamiento de Atajos de Teclado `+` / `−` en Estación de Venta:** Adición de `stopPropagation` en la tecla `+` y `−` dentro del campo de código de barras para erradicar la doble ejecución con el listener global del teclado.
- **Generación de Claves Únicas de Línea en Artículos Varios:** Inclusión de sufijo pseudoaleatorio en el identificador de línea para prevenir colisiones de claves en React al agregar múltiples productos varios de forma continua.

---

## [0.1.8] - 2026-10-27

### Agregado
- **Impresión Térmica Nativa del Comprobante Z de Cierre de Caja (`print_shift_ticket` en `printers.rs` y `shifts.rs`):** Generación directa ESC/POS (`CP437`/`CP850`) de la tirilla de cierre y arqueo de turno con datos de empresa, terminal, folio, cajero, apertura/cierre en hora local, arqueo detallado de efectivo en gaveta (`Base Inicial`, `Ventas Efectivo`, `Abonos Efectivo`, `Devoluciones Efectivo`, `Efectivo Esperado`, `Contado Físico` y `Diferencia`), desglose de ventas por medio de pago, observaciones y líneas de firma de entrega/recepción.
- **Indicador Discreto y Automático de Sincronización (`SalesStationPage.tsx`):** Sustitución del cartel de estado por un punto luminoso minimalista (`🟢` Al día, `🔵` Sincronizando en segundo plano, `🟠` Offline) sin texto fijo, que despliega suavemente su descripción al pasar el cursor (`hover`) y sincroniza bajo demanda con un clic.
- **Despacho Automático de Cierres de Turno (`cash_session`) y Saneamiento Dead-Letter (`sync.rs`):** Sincronización automática en segundo plano de sesiones de caja cerradas hacia `/api/pos/v1/sync/cierre-turno` y transición automática a estado `failed` tras 10 intentos o errores permanentes de validación para evitar colas estancadas en `Pendiente`.

### Cambiado
- **Ergonomía de Barra Superior y Pie de Cobro (`SalesStationPage.tsx`):** Apilamiento vertical limpio de `Terminal:` y `Bodega:` (`whitespace-nowrap`) para evitar recortes de nombres largos, y reubicación del botón de reimpresión rápida junto al visor `TOTAL A PAGAR` con etiqueta compacta (`🖨️ Ticket Alt+R`).
- **Ajuste Responsivo de Ventanas Modales (`CustomerModal.tsx`, `CloseShiftModal.tsx`, `CobroModal.tsx` y `ModalRoot.tsx`):** Estructura flexible (`max-h-[92vh] flex flex-col overflow-hidden`) con cuerpo desplazable (`flex-1 min-h-0 overflow-y-auto`) y barra inferior de botones siempre fija (`shrink-0`) para garantizar visibilidad completa en cualquier resolución de pantalla.

### Corregido
- **Corrección de Impresión en Cierre de Turno (`CloseShiftModal.tsx`):** Reemplazo de la llamada a `testPrintTicket()` por `api.printers.printShiftTicket(closedShift.id)` al cerrar caja con la opción *"Imprimir comprobante Z"* activa, e inclusión del chip visual `(-) Devoluciones en efectivo` en el arqueo de turno.

---

## [0.1.7] - 2026-10-26

### Agregado
- **Codificador Nativo ESC/POS Español (`encode_escpos_text` en `printers.rs`):** Traducción directa de caracteres UTF-8 a página de códigos térmica de 1 byte (`CP437` / `CP850`) junto con desactivación de modo multibyte (`FS .`), eliminando símbolos corruptos en tildes, eñes y signos de apertura (`Cigarrería`, `Bogotá`, `¡Gracias!`).
- **Auto-Reparación Idempotente de Esquema SQLite (`ensure_critical_schema` en `migrations.rs`):** Verificación automática en cada arranque que garantiza la existencia de columnas críticas y triggers válidos sin importar la versión previa de la base de datos local.
- **Actualizador Visible en Pantalla de Bloqueo y Emparejamiento:** Montaje global de `UpdateNotificationBanner` en `App.tsx` y botón directo de búsqueda/aplicación de actualizaciones con versión dinámica real en el pie de página de `CashierLockScreen.tsx`.

### Corregido
- **Desbloqueo de Sincronización de Usuarios e Inicio de Sesión (`0029_fix_user_permission_audit_trigger.sql`):** Adición de la columna `last_modified_by` en `users` y recreación del trigger `trg_user_permissions_audit` (`WHEN OLD.permissions IS NOT NEW.permissions`), corrigiendo el error `no such column: NEW.last_modified_by` al sincronizar operadores o validar PIN contra el ERP.
- **Alineación, Tipografía y Hora Local en Impresión de Tickets (`printers.rs` y `sales.rs`):** Formato de encabezado y línea `TOTAL:` en negrita + doble altura (`ESC ! 0x18`) para evitar saltos de línea por doble ancho, conversión de fecha de venta a hora local (`datetime(s.created_at, 'localtime')`) y visualización del monto entregado (`paid_cents`) junto con el cambio.

---

## [0.1.6] - 2026-10-26

### Agregado
- **Importación y Exportación Nativa de Productos Excel (`.xlsx` Compatible con Eleventa):** Motor de procesamiento en Rust (`excel_io.rs`) y asistente interactivo de 3 pasos (`ProductImportExportModal.tsx`) con previsualización inteligente, detección de productos nuevos vs actualizaciones, creación automática de Departamentos/Categorías y exportación completa del inventario.
- **Soporte de Precio Mayoreo e Inventario Máximo (`0027_eleventa_fields.sql`):** Incorporación de los campos `wholesale_price_cents` y `max_stock` en base de datos local, modelos de dominio y formulario de catálogo.
- **Sincronización Masiva por Lotes con el ERP:** Subida automática de productos importados en bloques de 50 registros hacia el ERP, preservando los departamentos locales y evitando ciclos innecesarios en productos con existencia `0`.
- **Batería de 17 Pruebas Automatizadas de Integridad Financiera e Inventario (`cargo test`):** Cobertura integral para ventas con IVA/Impoconsumo, cambio en efectivo, pagos mixtos, combos/kits con stock compartido, límites de crédito, devoluciones (`restock` vs `merma`), arqueos de turno (Corte Z), Kardex y abonos a cartera.

### Cambiado
- **Ajuste Responsivo Integral de Estación de Ventas (`Zero-Cutoff`):** Reestructuración de contenedores principales (`flex-1 min-h-0` y `shrink-0`) en `App.tsx`, `SalesStationPage.tsx`, `ProductsPage.tsx` y `SettingsPage.tsx` para descontar dinámicamente la altura del banner superior de licencia y garantizar que el pie de página (`TOTAL A PAGAR` y botón `F12 COBRAR`) sea 100% visible en cualquier resolución de pantalla.

### Corregido
- **Cuadre Exacto de Efectivo Neto y Cambio en Gaveta (`0028_sales_paid_and_change_cents.sql`):** Cuando el cliente paga en efectivo con un billete mayor al total de la venta, `payments` almacena ahora el efectivo neto retenido en el cajón mientras `sales` conserva `paid_cents` y `change_cents` para la tirilla térmica, eliminando faltantes falsos en el arqueo de caja.
- **Totales Exactos en Ventas con Pago Mixto (`shifts.rs`):** Desacoplamiento de las consultas SQL de cabecera de ventas y desglose de medios de pago para evitar que ventas con 2 o más métodos dupliquen `total_sales_cents` en el cierre de turno.
- **Resolución de Medios de Pago y Tope de Abonos en Cartera (`customers.rs`):** Resolución automática de `payment_method_id` por código o ID interno (evitando errores `FOREIGN KEY constraint failed`), bloqueo de abonos que superen la deuda actual del cliente y preservación de devoluciones offline pendientes durante la sincronización de catálogo.

---

## [0.1.5] - 2026-10-20
### Agregado
- Actualización y optimizaciones del sistema.

### Cambios recientes
- fix(license): fix Send trait and import paths for license validation and UI
- Add license validation, UI banner, migrations, and tests
---
## [0.1.4] - 2026-10-19

### Agregado
- **Matriz Directa de Cobro Mixto (Split Ledger — Cero Pasos Extra):** Rediseño en 2 columnas que permite ingresar directamente montos por medio de pago (Efectivo, Tarjetas, Nequi, Daviplata, etc.) sin botón intermedio de "+ Añadir", con botón inteligente `+ Asignar Resto` y panel de balance en tiempo real con cálculo automático de vuelto.
- **Navegación y Selección de Productos con Flechas de Teclado (`↑` / `↓`):** Desplazamiento intuitivo por la tabla de ventas directamente desde el campo de lectura de código de barras o la estación, con auto-scroll suave para mantener visible el ítem enfocado.
- **Control Manual de Tamaño de Fuente en Píxeles (`px`):** Ajuste fino del tamaño de letra mediante botones de paso (`—` y `+` de 0.5px), input numérico directo (10px a 24px) y botones rápidos de píxeles (`12px`, `13px`, `14px`, `15.5px`, `17px`) con vista previa en vivo.
- **Pantalla de Bloqueo en Modo Claro (Eleventa Modern):** Rediseño estético con fondo claro suave (`#f8fafc`), tarjeta blanca con bordes nítidos y botón para alternar instantáneamente entre Modo Claro y Modo Oscuro.

### Cambiado
- **Supresión de Zoom/Escalado Global Forzado:** Eliminación del bloque de escalado de interfaz para garantizar renderizado nativo 100% nítido en cualquier monitor sin distorsión de tipografías ni desalineación de elementos.

---

## [0.1.3] - 2026-10-18

### Agregado
- **Matriz Directa de Cobro Mixto (Split Ledger — Cero Pasos Extra):** Rediseño integral del modal de pago mixto en 2 columnas; inputs directos de monto y referencia por método, botón inteligente `+ Asignar Resto` y panel lateral con balance en tiempo real (total, asignado, faltante y vuelto).
- **Navegación y Selección de Productos con Flechas de Teclado (`↑` / `↓`):** Desplazamiento fluido entre filas del ticket de venta directamente desde la barra del lector o cualquier área, con auto-scroll vertical para mantener enfocado el producto activo.
- **Control Manual de Tamaño de Fuente en Píxeles (`px`):** Ajuste milimétrico con botones de paso (`—` y `+` de 0.5px), input numérico libre (10px a 24px) y accesos rápidos en píxeles (`12px`, `13px`, `14px`, `15.5px`, `17px`) con vista previa en tiempo real.
- **Pantalla de Bloqueo en Modo Claro (Eleventa Modern):** Rediseño visual luminoso con tarjetas de operadores suaves, keypad nítido y selector dinámico de tema Claro/Oscuro en la barra superior.
- **Adaptabilidad Multi-Resolución Zero-Scroll:** Optimización responsiva para monitores desde 1024×768 (legacy/touch) hasta 1080p y 4K con ajuste de dimensiones mínimas de ventana (`minWidth: 960`, `minHeight: 600`), garantizando que la estación de cobro nunca genere desbordamiento vertical exterior.
- **Tabla de Ventas Líquida con Micro-Densidad:** Columnas secundarias (IVA y Existencias) adaptables que se integran como micro-etiquetas inteligentes en pantallas compactas sin sacrificar el área de descripción del producto ni el visor del total.
- **Apertura de Cajón Monedero vía Impresora (RJ11):** Integración completa del pulso eléctrico ESC/POS (Pin 2 y Pin 5) para abrir automáticamente la gaveta de dinero conectada a la parte posterior de la impresora térmica en ventas en efectivo, al imprimir tickets o con el nuevo atajo `F8` / botón en pantalla.
- **Configuración Completa de Impresora POS:** Nuevo modal `PrinterConfigModal` para detección automática de impresoras instaladas en Windows, selección de modelo térmico, pruebas de impresión y apertura de cajón monedero (pulso RJ11).
- **Impresión Térmica Directa ESC/POS:** Comando nativo en Rust (`print_sale_ticket`) que transmite los bytes directamente al spooler de la impresora sin abrir el cuadro de diálogo del navegador ni requerir confirmación manual.
- **Impresión Automática al Cobrar:** Opción de auto-impresión silenciosa inmediata tras confirmar cada venta en la estación de cobro.
- **Formateo Estricto para Tickets y PDF:** Corrección de estilos `@media print` fijando el ancho de página a 58mm u 80mm continuo, eliminando cabeceras de navegador y evitando hojas tamaño carta o A4 vacías.
- **Instalación de Actualizaciones 100% Silenciosa (`installMode: "silent"`):** Las nuevas versiones se descargan e instalan completamente en segundo plano sin desplegar ventanas nativas ni diálogos de Windows Installer (`msiexec`).
- **Reconexión Inteligente de Terminales:** Soporte en POS y ERP (`/api/pos/v1/terminal/reconectar`) para recuperar la vinculación de una caja tras desvinculaciones sin perder la configuración local.
- **Acceso Discreto de Soporte Técnico:** Enlace sutil en la pantalla de bloqueo para inicio de sesión de soporte y `SUPERADMINSAAS` mediante modal dedicado, evitando exponer usuarios administrativos a cajeros regulares.
- **Visualización de Productos Ampliada:** Ajuste de ergonomía en la lista de ítems de venta con soporte para imágenes de mayor tamaño y mejor nitidez.
- **Control de Cuota POS en ERP:** Verificación estricta de terminales permitidas según el plan (`POS_FREE` limitado a 1 terminal) con limpieza transaccional de reservas huérfanas al eliminar.

### Cambiado
- **Aislamiento Estricto de Usuarios en Bloqueo:** La pantalla de bloqueo ahora filtra y muestra únicamente los operadores y cajeros pertenecientes a la empresa activa.
- **Identidad Corporativa en Binarios:** Declaración oficial del publicador `Krouhub` y copyright en `tauri.conf.json` y `Cargo.toml`.

### Corregido
- Eliminación de la impresión a página completa (A4/Carta) y superposición de texto en descripciones y precios.
- Eliminación definitiva del diálogo gris de Windows Installer (*"Preparando la instalación..."*) durante el proceso de actualización del sistema.
- Prevención de desvinculaciones automáticas accidentales en `validate_terminal_session` causadas por interrupciones temporales de red o respuestas no autorizadas recuperables.

---

## [0.1.2] - 2026-10-17

### Agregado
- **Instalador Corporativo en Español (`es-ES`):** Banners y pantallas laterales personalizadas para instaladores WiX (`.msi`) y NSIS (`.exe`) con identidad de marca Metahabi.
- **Splash Screen Nativo en Modo Oscuro:** Configuración de fondo nativo (`backgroundColor: "#020617"`) en Tauri para eliminar el parpadeo blanco al iniciar la aplicación.
- **Recuperación de PIN en Pantalla de Bloqueo:** Flujo interactivo para restablecer credenciales locales cuando el cajero u operador olvida su clave.
- **Acceso Administrativo a Configuración (`F7`):** Acceso irrestricto garantizado a administradores de empresa para gestión de terminal.

### Cambiado
- Comprobación inmediata de actualizaciones al iniciar el sistema con notificación sutil de progreso y confirmación de *"Sistema al día"*.

---

## [0.1.1] - 2026-10-17

### Agregado
- **Rediseño Enterprise de Cierre de Caja y Arqueo:** Interfaz inspirada en Stitch con desglose dinámico de medios de pago y cálculo instantáneo de diferencias.
- **Purga de Tickets Abiertos:** Cancelación y limpieza obligatoria de tickets en curso al consolidar el arqueo de caja.
- **Protocolo de Cierre Forzoso:** Salvaguarda de turnos ante apagado del equipo, bloqueo prolongado o desconexión física.
- Soporte completo para modo oscuro y barras de desplazamiento estilizadas en formularios de turno.

### Corregido
- Eliminación de registros duplicados de saldos a crédito en el arqueo de caja.

---

## [0.1.0] - 2026-10-13

### Agregado
- **Lanzamiento Inicial de Metahabi POS.**
- **Arquitectura Offline-First:** Persistencia atómica local en SQLite embebido (`rusqlite`) con sincronización asíncrona mediante cola Outbox (`sync_queue`).
- **Estación de Ventas de Alta Velocidad:** Operación 100% mediante atajos de teclado (`F1`-`F12`, `+`, `-`, `Enter`, `Esc`) e interceptor global de lector de código de barras.
- **Integridad Financiera:** Moneda procesada estrictamente en centavos enteros (`i64`) e impuestos calculados en puntos base (BP) e impuestos fijos por unidad.
- **Control de Turnos de Caja (`cash_sessions`):** Apertura obligatoria con base de efectivo y arqueo ciego al cierre.
- **Vinculación Segura M2M:** Emparejamiento de terminales mediante código de 6 caracteres y tokens criptográficos Bearer.
