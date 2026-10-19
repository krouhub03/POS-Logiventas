# Registro de Cambios (Changelog) — Metahabi POS

Todos los cambios notables en este proyecto se documentarán en este archivo.
El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y este proyecto se adhiere a [Semantic Versioning (SemVer)](https://semver.org/lang/es/).

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
- **Lanzamiento Inicial de Metahabi POS (Logiventa).**
- **Arquitectura Offline-First:** Persistencia atómica local en SQLite embebido (`rusqlite`) con sincronización asíncrona mediante cola Outbox (`sync_queue`).
- **Estación de Ventas de Alta Velocidad:** Operación 100% mediante atajos de teclado (`F1`-`F12`, `+`, `-`, `Enter`, `Esc`) e interceptor global de lector de código de barras.
- **Integridad Financiera:** Moneda procesada estrictamente en centavos enteros (`i64`) e impuestos calculados en puntos base (BP) e impuestos fijos por unidad.
- **Control de Turnos de Caja (`cash_sessions`):** Apertura obligatoria con base de efectivo y arqueo ciego al cierre.
- **Vinculación Segura M2M:** Emparejamiento de terminales mediante código de 6 caracteres y tokens criptográficos Bearer.
