# 📘 Manual Operativo de Usuario — Logiventa POS

Guía visual y paso a paso para cajeros, supervisores y administradores de punto de venta.

---

## 📑 Contenido del Manual

1. [Primeros Pasos y Desbloqueo de Caja](#1-primeros-pasos-y-desbloqueo-de-caja)
2. [Flujo de Venta Rápida (Estación de Cobro)](#2-flujo-de-venta-rápida-estación-de-cobro)
3. [Manejo de Múltiples Clientes (Pestañas de Tickets)](#3-manejo-de-múltiples-clientes-pestañas-de-tickets)
4. [Venta de Artículos Varios / Sin Código](#4-venta-de-artículos-varios--sin-código)
5. [Cobro y Formas de Pago](#5-cobro-y-formas-de-pago)
6. [Catálogo de Productos y Servicios](#6-catálogo-de-productos-y-servicios)
7. [Ajustes de Inventario y Existencias](#7-ajustes-de-inventario-y-existencias)
8. [Configuración de Periféricos (Impresora y Cajón)](#8-configuración-de-periféricos-impresora-y-cajón)

---

## 1. Primeros Pasos y Desbloqueo de Caja

Al encender el equipo o cuando la caja se encuentra inactiva, verás la **Pantalla de Bloqueo**:

1. **Identifica tu usuario**: Selecciona tu nombre en la lista de cajeros disponibles.
2. **Ingresa tu PIN**: Digita tu clave de 4 dígitos usando el teclado físico o pulsando los números en pantalla.
3. **Desbloqueo automático**: Al ingresar el cuarto dígito correcto, el sistema abrirá de inmediato la **Estación de Ventas (`F1`)** con el campo del escáner enfocado y listo.

> 💡 **Tip:** En cualquier momento de tu turno puedes presionar la tecla **`Escape`** o el botón rojo **"🔒 Bloquear"** en la esquina superior para proteger tu sesión si necesitas ausentarte de la caja.

---

## 2. Flujo de Venta Rápida (Estación de Cobro)

La estación de ventas está diseñada para una velocidad de cobro ultrarrápida:

### A. Escanear Productos con Pistola
- Pasa el código de barras por el lector. El sistema emitirá un **pitido corto de confirmación** y agregará el producto inmediatamente.
- **No necesitas dar clic en la barra de búsqueda**: El sistema cuenta con captura en cuña inteligente; aunque el cursor esté en otro lugar, el escaneo se procesará de forma automática.

### B. Vender por Cantidades (`CANTIDAD*CODIGO`)
- Si un cliente lleva 6 piezas del mismo producto, escribe en el teclado `6*` y luego escanea el código (o escribe el código y presiona `Enter`). El sistema agregará las 6 piezas en una sola línea.

### C. Modificar Cantidades en el Ticket
- Usa las teclas **`Flecha Arriba`** y **`Flecha Abajo`** para moverte entre los productos de la lista.
- Presiona **`Ctrl` + `+`** para sumar una pieza.
- Presiona **`Ctrl` + `-`** para restar una pieza.
- Presiona **`Supr` (Delete)** para quitar el producto seleccionado de la lista.

### D. Cancelar o Limpiar Ticket
- Si te equivocaste escribiendo un código, presiona **`Escape`** para borrar el texto escrito.
- Si el campo ya está vacío y presionas **`Escape`**, el sistema abrirá un modal seguro preguntándote si deseas vaciar el ticket. Presiona **`Enter`** para confirmar o **`Esc`** para cancelar.

---

## 3. Manejo de Múltiples Clientes (Pestañas de Tickets)

Si un cliente olvidó un producto y va a buscarlo mientras otros clientes esperan en fila:

1. Presiona el botón **`+`** junto a las pestañas de tickets arriba a la izquierda.
2. Se abrirá **`Ticket 2`** en blanco para que puedas cobrarle de inmediato al siguiente cliente.
3. Cuando el primer cliente regrese, haz clic en **`Ticket 1`** o usa los atajos para retomar su cuenta con todos sus productos intactos.
4. **Protección permanente:** Aunque cambies de ticket, vayas a consultar productos o cierres el programa por error, los tickets abiertos **jamás se borran**.

---

## 4. Venta de Artículos Varios / Sin Código

Para cobrar un producto que no tiene código de barras o es un servicio esporádico:

1. Presiona la tecla **`Insert`** (o haz clic en el botón amarillo **"INS Varios"**).
2. Escribe el nombre o concepto (ej. *Copia a color*, *Bolsa de hielo*).
3. Escribe el precio de venta y la cantidad.
4. Presiona **`Enter`** para agregarlo directamente al ticket actual.

---

## 5. Cobro y Formas de Pago

Una vez ingresados todos los artículos del cliente:

1. Presiona la tecla **`F12`** o haz clic en el botón gigante verde **"F12 COBRAR"**.
2. Se abrirá el modal de cobro mostrando el total grande en pantalla.
3. Elige el método de pago:
   - **Efectivo**: Escribe el monto con el que paga el cliente. El sistema calculará el cambio al instante.
   - **Tarjeta**: Selecciona tarjeta y escribe la referencia del voucher.
   - **Transferencia**: Selecciona transferencia y registra el número de comprobante.
4. Presiona **`Enter`** para autorizar el cobro:
   - Si tienes configurada una impresora térmica, se imprimirá el ticket de venta.
   - Si tienes cajón monedero, este se abrirá automáticamente para guardar el dinero.
   - El ticket quedará registrado con su folio y la pantalla se preparará para el siguiente cliente.

---

## 6. Catálogo de Productos y Servicios (`F3`)

Presiona **`F3`** para abrir el gestor de catálogo:

- **Buscar**: Escribe cualquier parte del nombre, SKU o código de barras.
- **Filtrar**: Usa los botones superiores para ver solo *📦 Físicos*, *🛠️ Servicios* o *⚠️ Stock Bajo*.
- **Crear Nuevo (`F8` o `Alt+N`)**:
  - Selecciona **[📦 Producto Físico]** si es un artículo que almacenas en estantería (requiere existencia y stock mínimo).
  - Selecciona **[🛠️ Servicio]** si es una mano de obra, flete o servicio que no maneja existencias físicas.
  - Asigna precios, costo y tasa de IVA.
- **Editar**: Haz clic en el botón **"✏️ Editar"** de cualquier producto para cambiar precios o datos.
- **Eliminar**: Haz clic en **"🗑️"**. El sistema te pedirá confirmación y lo desactivará de forma segura sin borrar ventas pasadas.

---

## 7. Ajustes de Inventario y Existencias (`F4`)

Presiona **`F4`** para ir directamente al control de almacén:

- En la columna de existencias verás en color rojo los artículos agotados y en ámbar los que están por debajo de su stock mínimo.
- **Ajustar Existencia**: Haz clic en **"📊 Ajustar"** en la fila del producto:
  1. Ingresa la nueva cantidad física que contaste en la tienda.
  2. Selecciona el motivo (*Conteo físico*, *Merma/Daño*, *Entrada directa*, *Devolución*).
  3. Haz clic en **"Aplicar Ajuste"**.
- **Kardex**: En la pestaña **"📜 Kardex / Movimientos"** puedes auditar todos los movimientos históricos con fecha, hora y motivo.

---

## 8. Configuración de Periféricos (Impresora y Cajón) (`F7`)

Presiona **`F7`** para configurar tu hardware comercial:

- **Impresora Térmica**: Selecciona el ancho de papel (58 mm para tickets pequeños o 80 mm para estándar), el puerto de conexión (USB / COM / Red) y presiona **"Imprimir Ticket de Prueba"**.
- **Cajón Portamonedas**: Activa la apertura automática al cobrar en efectivo y usa el botón **"Abrir Cajón de Prueba"** para verificar el pulso RJ11.
- **Pantalla Completa (`F11`)**: Actívala para ocultar la barra de tareas de Windows y trabajar en modo estación dedicada.
