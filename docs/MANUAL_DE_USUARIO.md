# 📘 Manual Operativo de Usuario — Metahabi POS

Guía visual y paso a paso para cajeros, supervisores y administradores del punto de venta de escritorio **Metahabi POS**.

---

## 📑 Contenido del Manual

1. [Desbloqueo de Caja con PIN](#1-desbloqueo-de-caja-con-pin)
2. [Apertura de Turno de Caja (Base Inicial)](#2-apertura-de-turno-de-caja-base-inicial)
3. [Flujo de Venta Rápida (Estación de Cobro `F1`)](#3-flujo-de-venta-rápida-estación-de-cobro-f1)
4. [Manejo de Múltiples Clientes en Fila (Tickets en Espera `F6`)](#4-manejo-de-múltiples-clientes-en-fila-tickets-en-espera-f6)
5. [Asignación de Clientes al Ticket (`F2`)](#5-asignación-de-clientes-al-ticket-f2)
6. [Buscador Rápido (`F10`) y Venta de Artículos Varios (`Insert`)](#6-buscador-rápido-f10-y-venta-de-artículos-varios-insert)
7. [Cobro y Medios de Pago Dinámicos (`F12`)](#7-cobro-y-medios-de-pago-dinámicos-f12)
8. [Cierre de Turno y Arqueo de Caja (Corte Z)](#8-cierre-de-turno-y-arqueo-de-caja-corte-z)
9. [Catálogo de Productos, Servicios y Etiquetas (`F3`)](#9-catálogo-de-productos-servicios-y-etiquetas-f3)
10. [Control de Existencias y Kardex (`F4`)](#10-control-de-existencias-y-kardex-f4)
11. [Configuración de Hardware, Medios de Pago y Actualizaciones (`F7`)](#11-configuración-de-hardware-medios-de-pago-y-actualizaciones-f7)

---

## 1. Desbloqueo de Caja con PIN

Al encender el equipo o cuando la terminal se encuentra bloqueada, verás la **Pantalla de Selección de Operador**:

1. **Selecciona tu usuario**: Los cajeros más frecuentes aparecen primero con su tarjeta de perfil y rol asignado.
2. **Ingresa tu PIN**: Digita tu clave secreta de **4 dígitos** usando el teclado físico o los botones numéricos en pantalla.
3. **Acceso inmediato**: Al completar el cuarto dígito correcto, el sistema validará tu sesión sin necesidad de presionar `Enter`.
4. **Protección de Seguridad**: Por seguridad, si se ingresa un PIN incorrecto **5 veces seguidas**, la cuenta quedará suspendida temporalmente durante **60 segundos** para evitar intentos no autorizados.

> 💡 **Tip de Seguridad:** Si necesitas retirarte momentáneamente del mostrador, haz clic en tu nombre/avatar o presiona el botón **"🔒 Bloquear"** en la barra superior para bloquear la pantalla sin cerrar tu turno ni perder los tickets abiertos. El relevo de cajero puede ingresar con su propio PIN sobre el mismo turno activo y cada venta registrará individualmente quién la emitió.

---

## 2. Apertura de Turno de Caja (Base Inicial)

Si es el inicio de la jornada y la caja no tiene un turno abierto, el sistema mostrará automáticamente la ventana de **Apertura de Turno**:

1. **Cuenta el dinero base**: Verifica los billetes y monedas con los que recibes el cajón para dar cambio.
2. **Ingresa la Base Inicial**: Escribe el monto en efectivo (o selecciona uno de los montos rápidos sugeridos) y agrega una nota opcional si lo deseas.
3. **Confirmar Apertura**: Haz clic en **"Abrir Turno de Caja"** (o presiona `Enter`). El sistema generará el folio de tu turno y habilitará la Estación de Ventas (`F1`).

---

## 3. Flujo de Venta Rápida (Estación de Cobro `F1`)

La estación de ventas está diseñada para cobrar en segundos sin usar el ratón:

### A. Escanear Productos con Pistola Lectora
- Pasa el código de barras por el lector. Escucharás un **pitido corto de confirmación** y el artículo aparecerá al instante en el ticket.
- **Captura inteligente sin clic**: Aunque hayas hecho clic fuera de la barra de búsqueda, el POS detecta automáticamente la lectura del escáner y procesa el código.
- **Bloqueo Estricto de Productos sin Existencias**: Si un producto físico no tiene existencias disponibles (`Stock = 0`), el sistema bloquea su ingreso y muestra una alerta preventiva impidiendo ventas de artículos agotados. Si intentas agregar más unidades de las disponibles en tienda, el sistema limitará la cantidad al inventario existente.

### B. Vender por Multiplicador (`CANTIDAD*CODIGO`)
- Si un cliente lleva varias unidades iguales (ej. 6 bebidas), escribe `6*` en el teclado y escanea el código de barras (o digita el código y presiona `Enter`). Se agregarán las 6 unidades en una sola línea.

### C. Modificar Cantidades o Eliminar Líneas en el Ticket
- Usa las teclas **`Flecha Arriba`** y **`Flecha Abajo`** para desplazarte por las líneas del ticket.
- Presiona **`+`** para sumar 1 unidad al producto seleccionado (siempre que haya stock disponible).
- Presiona **`-`** para restar 1 unidad. Si la cantidad llega a 0, la línea se elimina de forma limpia y segura, **sin borrar en cascada** los productos anteriores.
- **🛡️ Alerta de Seguridad para Producto #1**: Al intentar eliminar la primera fila (o el único producto del ticket) con **`-`** o **`Supr` (`Delete`)**, el sistema mostrará una ventana de confirmación obligatoria para evitar vaciados accidentales del ticket.
- **Edición exacta**: También puedes hacer **doble clic** sobre la cantidad de cualquier fila para escribir un número exacto (incluyendo decimales para productos a granel como `1.25` kg).
- Presiona **`Supr` (`Delete`)** para quitar el producto seleccionado del ticket.

### D. Aplicar Precio de Mayoreo en Mostrador (`F9` o Clic en Ticket)
Si un producto cuenta con tarifa de mayoreo configurada (`wholesale_price_cents > 0`), el cajero puede alternar entre el precio menudeo y el precio mayorista en cualquier momento:
- **Atajo de Teclado `F9` (o `Alt+M`):** Presiona **`F9`** sobre la línea seleccionada en el ticket (o inmediatamente tras escanear un producto). El precio unitario cambiará al instante a precio mayoreo y el total se recalculará automáticamente. Una segunda pulsación restablece el precio normal de menudeo.
- **Botón en Barra de Acciones:** El botón **`[F9] Mayoreo`** en la cabecera del escáner se activa en color ámbar (`Mayoreo ON`) cuando la línea activa tiene aplicado el precio mayorista.
- **Clic Directo en la Columna de Precio:** En la tabla del ticket, verás una etiqueta punteada `[Mayoreo: $X.XX]` debajo del precio normal. Haz clic sobre ella para activar el mayoreo (o clic sobre la insignia ámbar `[📦 Mayoreo]` para volver a menudeo).

### E. Imágenes de Productos y Visor Lightbox
- **Alternar Miniaturas**: Haz clic en el botón con ícono de imagen en la cabecera del ticket para **mostrar u ocultar** las fotografías de los artículos según el tamaño de tu pantalla.
- **Visor Ampliado (Lightbox)**: Haz **doble clic** sobre la foto pequeña de cualquier producto para abrirla en alta resolución a pantalla completa. Presiona **`Escape`** o **`Enter`** para cerrarla.
- **Íconos Automáticos**: Si un artículo no tiene foto, el sistema muestra automáticamente un diseño representativo según su tipología (📦 Físico, 🛠️ Servicio, 🍱 Combo).

### F. Limpiar Código o Vaciar Ticket (`Escape`)
- Si escribiste mal un código en la barra, presiona **`Escape`** una vez para borrar el texto escrito.
- Si la barra ya está vacía y presionas **`Escape`**, el sistema te preguntará si deseas vaciar o cerrar el ticket actual (`Enter` para confirmar, `Esc` para cancelar).

### G. Atajos Universales en Todas las Ventanas Modales (`Enter` / `Esc`)
Todas las ventanas y diálogos del sistema (Cobro `F12`, Clientes `F2`, Búsqueda `F10`, Varios `Insert`, Apertura/Cierre de Turno y Alertas) responden al teclado:
- **`Enter`**: Confirma la operación principal, envía el formulario o cobra el ticket.
- **`Escape`**: Cancela y cierra la ventana abierta de inmediato sin tocar el ratón.

---

## 4. Manejo de Múltiples Clientes en Fila (Tickets en Espera `F6`)

Si un cliente está buscando más productos o su medio de pago mientras hay fila en mostrador:

1. Presiona la tecla **`F6`** (o haz clic en el botón **`+`** junto a las pestañas superiores).
2. El ticket actual quedará guardado en espera y se abrirá un nuevo **`Ticket 2`** limpio para cobrarle de inmediato al siguiente cliente.
3. Puedes cambiar entre tickets abiertos haciendo clic en sus pestañas superiores e incluso **renombrar una pestaña** haciendo doble clic sobre su título (ej. *"Mesa 3"* o *"Señor Juan"*).
4. **Persistencia garantizada**: Aunque vayas al catálogo (`F3`), bloquees la pantalla o reinicies la aplicación, los productos de todos tus tickets en espera permanecen intactos.

---

## 5. Asignación de Clientes al Ticket (`F2`)

Para registrar la venta a nombre de un cliente específico:

1. Presiona la tecla **`F2`** (o haz clic en el botón de cliente en la estación de ventas).
2. **Buscar cliente**: Escribe el nombre, NIT/Cédula o teléfono del cliente y selecciónalo con `Enter`.
3. **Estado de Cuenta, Crédito y Saldo Deudor**:
   - Para cada cliente con crédito, el sistema muestra en tiempo real su **Cupo Autorizado**, su **Saldo Deudor Actual** y su saldo disponible.
   - Si el cliente tiene un saldo pendiente, verás el botón destacado **"💵 Abonar"**.
4. **Recepción de Abonos a Cartera en Caja**:
   - Al pulsar **"💵 Abonar"**, se despliega el formulario de cobro de cartera.
   - Selecciona el monto a recibir (puedes usar los atajos de **Total Adeudado**, **50%**, **25%** o digitar el valor exacto).
   - Elige el medio de pago (Efectivo, Tarjeta, Transferencia, etc.) y añade notas opcionales.
   - Al confirmar, el sistema genera un recibo oficial con folio `REC-XXXXX`, descuenta el saldo deudor del cliente de forma inmediata en SQLite y encola el abono en el outbox para sincronizar con la contabilidad del ERP.
5. **Crear nuevo cliente**: Si el cliente no existe, completa sus datos básicos en la pestaña de registro rápido y guárdalo; quedará asignado automáticamente al ticket actual.
6. **Desvincular cliente**: Si deseas regresar el ticket a *Consumidor Final*, presiona **`Shift` + `F2`**.

---

## 6. Buscador Rápido (`F10`) y Venta de Artículos Varios (`Insert`)

### A. Buscador Visual por Nombre o Etiqueta (`F10`)
- Si un producto no tiene código de barras legible, presiona **`F10`**.
- Escribe parte del nombre o filtra por **Etiquetas de Color (`#Oferta`, `#Frío`, `#Combo`)**.
- Muévete con las flechas del teclado y presiona **`Enter`** para agregarlo al ticket.
- **Detección de Agotados**: Los artículos sin existencias (`Stock = 0`) se distinguen con un distintivo rojo **`0 [UNIDAD] Agotado`**. El sistema bloquea su selección evitando agregar productos agotados a la venta.
- **Navegación con `Escape`**: Si estás escribiendo en el buscador, presionar `Escape` limpia el filtro actual; una segunda pulsación cierra el modal inmediatamente.

### B. Venta de Artículo Común / Varios (`Insert`)
- Para cobrar un concepto eventual no registrado en el catálogo, presiona la tecla **`Insert`**.
- Escribe la descripción, el precio unitario y la cantidad, y presiona **`Enter`** para agregarlo (o **`Escape`** para cancelar).

---

## 7. Cobro y Medios de Pago Dinámicos (`F12`)

Una vez listos los productos del ticket:

1. Presiona **`F12`** (o `Ctrl + Espacio` / botón verde **"COBRAR"**).
   - *Nota:* Si el ticket incluye un producto con existencias críticas, el POS verificará automáticamente que otra caja no lo haya comprometido en ese instante.
2. **Navegación Ergonómica por Teclado (`[←] [↑] [→] [↓]`):**
   - Puedes moverte fluidamente entre todos los medios de pago configurados en tu sucursal usando las flechas de dirección:
     - **`[→]` / `[←]`**: Desplazamiento horizontal entre métodos consecutivos.
     - **`[↓]` / `[↑]`**: Salto vertical directo entre filas de la cuadrícula manteniendo la columna activa.
   - El método seleccionado se resalta de inmediato con borde esmeralda e indicador visual sin alterar los números digitados.
3. **Cinta de Balance Financiero:**
   - La parte superior del formulario presenta una cinta informativa continua dividida en tres columnas:
     - **Total a Pagar**: Valor final de la venta calculado en centavos exactos.
     - **Dinero Recibido**: Importe ingresado por el cajero.
     - **Cambio (Vuelto)**: Saldo a favor del cliente a devolver en efectivo.
4. **Tipos de Medios de Pago Soportados:**
   - **💵 Efectivo**: Ingresa el monto recibido o usa los botones de billetes sugeridos. El sistema calcula el vuelto al instante.
   - **💳 Tarjetas y Medios Digitales (Tarjeta Débito/Crédito, Nequi, Daviplata, Bancos)**: Digita el número de comprobante o autorización en el campo opcional de referencia.
   - **📋 Crédito de Clientes (Cartera / Fiado)**: Requiere un cliente asignado al ticket. Si no hay cliente, el POS despliega una alerta amigable y abre el selector de clientes para validar su cupo autorizado y deuda actual antes de permitir el cobro.
   - **🔄 Pago Mixto (Dividido)**: Integrado como la última opción de la cuadrícula. Permite repartir el total entre múltiples medios simultáneamente (ej. parte en Efectivo y parte en Nequi/Tarjeta) con atajos de auto-asignación de saldo restante.
5. **🖨️ Impresión de Ticket Opcional (`Ctrl + P`):**
   - La ventana de cobro cuenta con un selector `🖨️ Ticket: Sí / No` que recuerda la última preferencia del operador (`localStorage`).
   - Si un cliente no desea comprobante físico o compras rápidas de mostrador, puedes desactivarlo con **`Ctrl + P`** para ahorrar papel térmico y agilizar la fila.
6. **Confirmación con `Enter` y Blindaje Anti-Duplicados:**
   - Presiona **`Enter`** desde cualquier campo para consolidar la venta. El sistema bloquea síncronamente dobles pulsaciones y valida la transacción en base de datos mediante clave de idempotencia única (`client_tx_id`).
7. **Gestión Automática de Fila al Cerrar la Venta:**
   - Al completarse el cobro, si tienes otros tickets en espera y todos ya contienen productos, el sistema crea y activa automáticamente un **nuevo ticket limpio** para recibir al siguiente cliente de inmediato sin tocar el ratón.
8. **Apertura Automática del Cajón Monedero:**
   - Al confirmar un cobro que incluya **Efectivo** o que genere **Cambio / Vueltos**, el sistema dispara automáticamente el pulso RJ11 a través de la impresora para abrir el cajón monedero, garantizando su apertura incluso si elegiste no imprimir el ticket de papel. También puedes abrirlo manualmente en cualquier momento con la tecla rápida **`F8`**.

---

## 8. Cierre de Turno y Arqueo de Caja (Corte Z)

Al terminar tu turno o al cierre del local:

1. Haz clic en el botón de **Turno / Corte de Caja** en la barra superior de la estación de ventas.
2. El sistema mostrará el **Resumen del Turno**:
   - Base inicial de apertura.
   - Total de ventas en efectivo, tarjetas y medios digitales.
   - **Efectivo esperado en cajón** (`Base Inicial + Ventas en Efectivo`).
3. **Declaración de Efectivo Físico**: Cuenta los billetes y monedas reales del cajón e ingresa el monto total en **"Efectivo Contado / Declarado"**.
4. El sistema mostrará en tiempo real si el arqueo está **Cuadrado (`$0`)**, o si existe algún **Sobrante** o **Faltante**, incluyendo el desglose de base inicial, ventas en efectivo, abonos de cartera y devoluciones en efectivo, permitiéndote añadir observaciones antes de confirmar el cierre definitivo del turno.
5. **Impresión Térmica del Comprobante Z (`print_shift_ticket`)**: Con la casilla **"🖨️ Imprimir comprobante Z"** activa (por defecto), al cerrar el turno la impresora térmica emite automáticamente la tirilla oficial **CIERRE DE CAJA (Z)** con:
   - Datos de la empresa, terminal, folio del turno, cajero responsable y fechas de apertura/cierre en hora local.
   - **Arqueo de Efectivo en Caja**: `(+) Base Inicial`, `(+) Ventas Efectivo`, `(+) Abonos Efectivo`, `(-) Devol. Efectivo`, `= Efectivo Esperado`, `CONTADO FISICO` y `Diferencia (EXACTO / FALTANTE / SOBRANTE)`.
   - **Resumen de Ventas del Turno**: Tickets emitidos, devoluciones, desglose por cada medio de pago (`Efectivo`, `Transferencia`, `Tarjeta`, `Crédito/Fiado`), impuestos, `TOTAL VENTAS`, observaciones y espacios de firma (`Entrega` y `Recibe / Supervisor`).
6. Presiona **`Enter`** para confirmar el cierre (o **`Escape`** para cancelar).
7. **Copia de Seguridad Preventiva Automática**: Al confirmar el cierre Z, el sistema genera automáticamente un respaldo inmutable de la base de datos SQLite (`backup_turno_{FOLIO}.db`) en la terminal local para máxima protección contra pérdidas de datos.

---

## 9. Catálogo de Productos, Servicios y Etiquetas (`F3`)

Presiona **`F3`** para administrar los productos (requiere permiso `inventario:ver`):

- **Búsqueda y Filtros**: Busca por nombre, SKU o código de barras, filtra por *📦 Físicos*, *🛠️ Servicios* o *🍱 Combos*, o despliega el selector de **Etiquetas (`#tags`)** para filtrar por múltiples etiquetas a la vez.
- **Crear o Editar Producto (`F8` o `Alt+N`)**:
  - Selecciona la tipología adecuada:
    - **📦 Producto Físico**: Artículo simple con control de existencias en almacén.
    - **🛠️ Servicio**: Facturable sin descontar inventario.
    - **🍱 Combo / Kit / Receta**: Paquete compuesto por varios productos insumo.
  - **Constructor de Receta (Combos)**:
    - Agrega los productos insumo y especifica la cantidad que conforma cada paquete (ej. 1 Hamburguesa + 1 Bebida + 1 Porción de Papas).
    - El POS calcula automáticamente en vivo el **Stock Armable** del combo basándose en la menor disponibilidad de sus componentes en inventario.
    - Al vender el combo en caja, el sistema descuenta de forma atómica la porción correspondiente de cada insumo en el almacén local.
  - **Gestión de Fotografías e Imágenes**:
    - Selecciona una fotografía desde el explorador de archivos de tu computador (`.jpg`, `.png`, `.webp`, `.svg`).
    - Las fotos se guardan en el almacenamiento local y se sincronizan con el ERP.
    - Si un artículo no tiene foto, el sistema asigna automáticamente un ícono representativo según su categoría.
    - Haz **doble clic** sobre cualquier miniatura del catálogo para verla en pantalla completa (Lightbox). Ciérrala con **`Escape`** o **`Enter`**.
  - Usa el botón generador para asignar un SKU o código de barras automático si el artículo no trae código de fábrica.
  - Define precio de venta, costo, tasa de IVA (0%, 5%, 16%, 19%), unidad de medida (`pza`, `kg`, `g`, `lt`, `caja`, `paq`, `serv`) y asígnale etiquetas visuales.
  - Presiona **`Escape`** para cerrar el formulario sin guardar cambios.
- **Gestor de Etiquetas Maestras**: Desde el botón **"🏷️ Etiquetas"**, puedes crear nuevas etiquetas personalizadas eligiendo su nombre y color representativo (cerrar con `Escape`).

---

## 10. Control de Existencias y Kardex (`F4`)

Presiona **`F4`** para auditar y ajustar el almacén local:

- **Semáforo de Existencias**: Filtra rápidamente entre todos los productos, *Óptimos*, *⚠️ Stock Bajo* o *🔴 Agotados*.
- **Ajustar Stock Manualmente**: Haz clic en **"📊 Ajustar"** sobre cualquier artículo físico, ingresa la nueva cantidad real contada e indica el motivo (*Conteo físico*, *Merma / Daño*, *Entrada directa*, *Devolución*).
- **Kardex de Movimientos**: Cambia a la pestaña **"📜 Kardex / Movimientos"** para consultar la bitácora completa de entradas, salidas por venta y ajustes manuales con fecha, hora y referencia.

---

## 11. Configuración de Hardware, Medios de Pago y Actualizaciones (`F7`)

Presiona **`F7`** para abrir el panel de configuración de la terminal (requiere permiso `pos:configuracion`):

- **🖨️ Impresora Térmica**: Configura el ancho de papel (58 mm u 80 mm), puerto o nombre de impresora, número de copias, datos del encabezado/pie de ticket y ejecuta **"Imprimir Ticket de Prueba"**.
- **🗄️ Cajón Portamonedas**: Activa o desactiva el disparo automático al cobrar en efectivo y prueba la apertura con **"Abrir Cajón de Prueba"**.
- **💳 Medios de Pago**: Sincroniza el catálogo de formas de pago desde el servidor central y usa los interruptores individuales para **habilitar o deshabilitar** qué medios aparecen disponibles en el modal de cobro (`F12`) de esta caja específica.
- **🔗 Terminal**: Consulta los datos de la caja y bodega vinculada, sincroniza manualmente la lista de cajeros/PINs o desvincula la terminal de forma segura.
- **⚙️ General y Actualizaciones**: Alterna entre **Modo Claro y Modo Oscuro**, consulta la versión instalada y verifica o instala nuevas actualizaciones del sistema con un clic.
