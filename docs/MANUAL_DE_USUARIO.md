# 📘 Manual Operativo de Usuario — Logiventa POS

Guía visual y paso a paso para cajeros, supervisores y administradores del punto de venta de escritorio **Logiventa POS**.

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

### B. Vender por Multiplicador (`CANTIDAD*CODIGO`)
- Si un cliente lleva varias unidades iguales (ej. 6 bebidas), escribe `6*` en el teclado y escanea el código de barras (o digita el código y presiona `Enter`). Se agregarán las 6 unidades en una sola línea.

### C. Modificar Cantidades o Eliminar Líneas en el Ticket
- Usa las teclas **`Flecha Arriba`** y **`Flecha Abajo`** para desplazarte por las líneas del ticket.
- Presiona **`+`** para sumar 1 unidad al producto seleccionado.
- Presiona **`-`** para restar 1 unidad.
- **Edición exacta**: También puedes hacer **doble clic** sobre la cantidad de cualquier fila para escribir un número exacto (incluyendo decimales para productos a granel como `1.25` kg).
- Presiona **`Supr` (`Delete`)** para quitar el producto seleccionado del ticket.

### D. Limpiar Código o Vaciar Ticket (`Escape`)
- Si escribiste mal un código en la barra, presiona **`Escape`** una vez para borrar el texto escrito.
- Si la barra ya está vacía y presionas **`Escape`**, el sistema te preguntará si deseas vaciar o cerrar el ticket actual (`Enter` para confirmar, `Esc` para cancelar).

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

### B. Venta de Artículo Común / Varios (`Insert`)
- Para cobrar un concepto eventual no registrado en el catálogo, presiona la tecla **`Insert`**.
- Escribe la descripción, el precio unitario y la cantidad, y presiona **`Enter`**.

---

## 7. Cobro y Medios de Pago Dinámicos (`F12`)

Una vez listos los productos del ticket:

1. Presiona **`F12`** (o `Ctrl + Espacio` / botón verde **"COBRAR"**).
   - *Nota:* Si el ticket incluye un producto con últimas existencias, el POS verificará automáticamente que otra caja no lo haya vendido en ese instante.
2. **Selecciona el Medio de Pago**:
   - **Efectivo**: Ingresa el monto recibido o usa los botones de billetes rápidos. El sistema mostrará en grande el **Cambio / Vuelto** a entregar.
   - **Medios Electrónicos / Digitales (Tarjeta, Nequi, Daviplata, Transferencia)**: Selecciona el medio habilitado en tu terminal e ingresa la referencia del comprobante si aplica.
   - **Venta a Crédito / Cuenta por Cobrar (CxC)**: Si el cliente cuenta con cupo disponible, selecciona esta opción para registrar la deuda en su estado de cuenta comercial.
   - **Pago Mixto / Dividido**: Puedes combinar varios medios de pago en una misma compra (ej. una parte en Efectivo y el resto por Transferencia o Crédito) hasta cubrir el total.
3. Presiona **`Enter`** para finalizar la venta:
   - Se imprimirá el recibo en la impresora térmica indicando el cajero responsable y se abrirá el cajón portamonedas.

---

## 8. Cierre de Turno y Arqueo de Caja (Corte Z)

Al terminar tu turno o al cierre del local:

1. Haz clic en el botón de **Turno / Corte de Caja** en la barra superior de la estación de ventas.
2. El sistema mostrará el **Resumen del Turno**:
   - Base inicial de apertura.
   - Total de ventas en efectivo, tarjetas y medios digitales.
   - **Efectivo esperado en cajón** (`Base Inicial + Ventas en Efectivo`).
3. **Declaración de Efectivo Físico**: Cuenta los billetes y monedas reales del cajón e ingresa el monto total en **"Efectivo Contado / Declarado"**.
4. El sistema mostrará en tiempo real si el arqueo está **Cuadrado (`$0`)**, o si existe algún **Sobrante** o **Faltante**, permitiéndote añadir observaciones antes de confirmar el cierre definitivo del turno.
5. **Copia de Seguridad Preventiva Automática**: Al confirmar el cierre Z, el sistema genera automáticamente un respaldo inmutable de la base de datos SQLite (`backup_turno_{FOLIO}.db`) en la terminal local para máxima protección contra pérdidas de datos.

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
  - Usa el botón generador para asignar un SKU o código de barras automático si el artículo no trae código de fábrica.
  - Define precio de venta, costo, tasa de IVA (0%, 5%, 16%, 19%), unidad de medida (`pza`, `kg`, `g`, `lt`, `caja`, `paq`, `serv`) y asígnale etiquetas visuales.
- **Gestor de Etiquetas Maestras**: Desde el botón **"🏷️ Etiquetas"**, puedes crear nuevas etiquetas personalizadas eligiendo su nombre y color representativo.

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
