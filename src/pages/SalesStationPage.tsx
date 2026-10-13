import { useState, useEffect, useRef, useCallback } from "react";
import { Product, CashierUser, TerminalStatus, CartItemInput, PaymentInput } from "../types";
import { api } from "../services/api";
import { formatCents } from "../lib/money";
import { useTheme } from "../contexts/ThemeContext";
import { playScanSuccess, playStockWarning, playScanError } from "../lib/sound";
import { SearchProductModal } from "../components/SearchProductModal";
import { CobroModal } from "../components/CobroModal";
import { VariosModal } from "../components/VariosModal";

interface CartLine {
  id: string;
  productId?: number;
  barcode: string;
  description: string;
  unitPriceCents: number;
  quantity: number;
  taxRateBp: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  currentStock?: number;
}

interface TicketTab {
  id: number;
  name: string;
  lines: CartLine[];
}

interface SalesStationPageProps {
  cashier: CashierUser;
  terminalStatus: TerminalStatus;
  onLockTerminal: () => void;
  onNavigateToProducts?: () => void;
  onNavigateToSettings?: () => void;
}

export function SalesStationPage({
  cashier,
  terminalStatus,
  onLockTerminal,
  onNavigateToProducts,
  onNavigateToSettings,
}: SalesStationPageProps) {
  const { theme, toggleTheme } = useTheme();

  // Tabs de Tickets: Siempre mínimo 1 ticket activo
  const [tickets, setTickets] = useState<TicketTab[]>([
    { id: 1, name: "Ticket 1", lines: [] },
  ]);
  const [activeTicketId, setActiveTicketId] = useState<number>(1);

  // Input de código de barras
  const [barcodeInput, setBarcodeInput] = useState("");
  const [selectedLineIndex, setSelectedLineIndex] = useState<number>(-1);
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  // Modales
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isCobroOpen, setIsCobroOpen] = useState(false);
  const [isVariosOpen, setIsVariosOpen] = useState(false);

  // Estado de feedback / notificación rápida
  const [feedback, setFeedback] = useState<{
    type: "success" | "warning" | "error" | "info";
    msg: string;
  } | null>(null);

  // Ticket activo actual
  const currentTicket = tickets.find((t) => t.id === activeTicketId) || tickets[0];
  const cartLines = currentTicket.lines;

  // Totales del ticket activo
  const subtotalCents = cartLines.reduce((acc, l) => acc + l.subtotalCents, 0);
  const taxCents = cartLines.reduce((acc, l) => acc + l.taxCents, 0);
  const totalCents = cartLines.reduce((acc, l) => acc + l.totalCents, 0);
  const totalPieces = cartLines.reduce((acc, l) => acc + l.quantity, 0);
  const totalItemsCount = cartLines.length;

  const showFeedback = (
    msg: string,
    type: "success" | "warning" | "error" | "info" = "info"
  ) => {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 4000);
  };

  // Enfoque continuo al input de código
  const focusInput = useCallback(() => {
    if (!isSearchOpen && !isCobroOpen && !isVariosOpen) {
      barcodeInputRef.current?.focus();
    }
  }, [isSearchOpen, isCobroOpen, isVariosOpen]);

  useEffect(() => {
    focusInput();
  }, [focusInput, activeTicketId]);

  // Actualizar líneas del ticket activo
  const updateCurrentTicketLines = (newLines: CartLine[]) => {
    setTickets((prev) =>
      prev.map((t) => (t.id === activeTicketId ? { ...t, lines: newLines } : t))
    );
  };

  // Adicionar un nuevo ticket
  const handleAddTicket = () => {
    const nextNumber = tickets.length + 1;
    const newId = Date.now();
    const newTicket: TicketTab = {
      id: newId,
      name: `Ticket ${nextNumber}`,
      lines: [],
    };
    setTickets((prev) => [...prev, newTicket]);
    setActiveTicketId(newId);
    setSelectedLineIndex(-1);
    showFeedback(`+ ${newTicket.name} agregado`);
    focusInput();
  };

  // Cancelar o eliminar ticket (mínimo 1 siempre)
  const handleCancelOrDeleteTicket = (targetId = activeTicketId) => {
    const target = tickets.find((t) => t.id === targetId);
    if (!target) return;

    // Si solo hay 1 ticket (el mínimo obligatorio): se vacían sus productos
    if (tickets.length <= 1) {
      if (target.lines.length === 0) {
        showFeedback("El ticket ya está vacío. Siempre debe haber al menos 1 ticket activo.");
        return;
      }
      if (confirm(`¿Desea vaciar los productos de ${target.name}?`)) {
        updateCurrentTicketLines([]);
        setSelectedLineIndex(-1);
        showFeedback(`${target.name} vaciado`);
        focusInput();
      }
      return;
    }

    // Si hay más de 1 ticket: se descarta y elimina
    const msg =
      target.lines.length > 0
        ? `¿Desea cancelar y eliminar ${target.name} con sus ${target.lines.length} producto(s)?`
        : `¿Desea cerrar ${target.name}?`;

    if (confirm(msg)) {
      const remaining = tickets.filter((t) => t.id !== targetId);
      setTickets(remaining);
      if (activeTicketId === targetId) {
        const newActive = remaining[remaining.length - 1];
        setActiveTicketId(newActive.id);
      }
      setSelectedLineIndex(-1);
      showFeedback(`✕ ${target.name} eliminado`);
      focusInput();
    }
  };

  // Agregar producto al ticket
  const addProductToTicket = (product: Product, quantity = 1) => {
    const existingIndex = cartLines.findIndex((l) => l.productId === product.id);

    if (existingIndex >= 0) {
      const updatedLines = [...cartLines];
      const existing = updatedLines[existingIndex];
      const newQty = existing.quantity + quantity;
      const newSubtotal = Math.round(existing.unitPriceCents * newQty);
      const newTax = Math.round((newSubtotal * existing.taxRateBp + 5000) / 10000);
      const newTotal = newSubtotal + newTax;

      updatedLines[existingIndex] = {
        ...existing,
        quantity: newQty,
        subtotalCents: newSubtotal,
        taxCents: newTax,
        totalCents: newTotal,
      };
      updateCurrentTicketLines(updatedLines);
      setSelectedLineIndex(existingIndex);
    } else {
      const unitSubtotal = Math.round(product.priceCents * quantity);
      const unitTax = Math.round((unitSubtotal * product.taxRateBp + 5000) / 10000);
      const newLine: CartLine = {
        id: `line-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        productId: product.id,
        barcode: product.barcode || product.sku,
        description: product.name,
        unitPriceCents: product.priceCents,
        quantity,
        taxRateBp: product.taxRateBp,
        subtotalCents: unitSubtotal,
        taxCents: unitTax,
        totalCents: unitSubtotal + unitTax,
        currentStock: product.stock,
      };
      const updated = [...cartLines, newLine];
      updateCurrentTicketLines(updated);
      setSelectedLineIndex(updated.length - 1);
    }
  };

  // Buscar por código de barras o formato "CANTIDAD*CODIGO"
  const handleBarcodeSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const raw = barcodeInput.trim();
    if (!raw) return;

    let qty = 1;
    let queryCode = raw;

    if (raw.includes("*")) {
      const parts = raw.split("*");
      const parsedQty = parseFloat(parts[0]);
      if (!isNaN(parsedQty) && parsedQty > 0) {
        qty = parsedQty;
        queryCode = parts.slice(1).join("*").trim();
      }
    }

    const handleProductScanned = (product: Product, quantity = 1) => {
      const lineEnTicket = cartLines.find((l) => l.productId === product.id);
      const yaEnTicket = lineEnTicket ? lineEnTicket.quantity : 0;
      const stockRestante = product.stock - yaEnTicket;

      if (product.stock <= 0) {
        playStockWarning();
        showFeedback(
          `⚠️ DISPONIBILIDAD AGOTADA: "${product.name}" no tiene existencias (Stock: 0 ${product.unit}).`,
          "warning"
        );
      } else if (stockRestante < quantity) {
        playStockWarning();
        showFeedback(
          `⚠️ STOCK INSUFICIENTE: "${product.name}" solo tiene ${product.stock} ${product.unit} (ya tienes ${yaEnTicket} en ticket).`,
          "warning"
        );
      } else {
        playScanSuccess();
        const nuevoRestante = product.stock - yaEnTicket - quantity;
        showFeedback(
          `✅ + ${quantity} × ${product.name} (Disponibles en tienda: ${nuevoRestante} ${product.unit})`,
          "success"
        );
      }

      addProductToTicket(product, quantity);
    };

    try {
      const direct = await api.products.findByBarcode(queryCode);
      if (direct) {
        handleProductScanned(direct, qty);
        setBarcodeInput("");
        return;
      }

      const products = await api.products.list(queryCode);
      const match =
        products.find(
          (p) =>
            p.barcode?.toLowerCase() === queryCode.toLowerCase() ||
            p.sku.toLowerCase() === queryCode.toLowerCase()
        ) || (products.length === 1 ? products[0] : null);

      if (match) {
        handleProductScanned(match, qty);
        setBarcodeInput("");
      } else if (products.length > 1) {
        setIsSearchOpen(true);
      } else {
        playScanError();
        showFeedback(
          `❌ Producto no encontrado: "${queryCode}". Presione F10 para buscar o F3 para crearlo.`,
          "error"
        );
      }
    } catch (err) {
      console.error("Error buscando producto:", err);
      playScanError();
      showFeedback("Error al buscar producto", "error");
    } finally {
      focusInput();
    }
  };

  // Manejo de cantidades con teclas + y -
  const modifyQuantity = (delta: number) => {
    if (selectedLineIndex < 0 || selectedLineIndex >= cartLines.length) return;
    const updated = [...cartLines];
    const target = updated[selectedLineIndex];
    const newQty = Math.max(0.01, target.quantity + delta);
    const newSubtotal = Math.round(target.unitPriceCents * newQty);
    const newTax = Math.round((newSubtotal * target.taxRateBp + 5000) / 10000);

    updated[selectedLineIndex] = {
      ...target,
      quantity: newQty,
      subtotalCents: newSubtotal,
      taxCents: newTax,
      totalCents: newSubtotal + newTax,
    };
    updateCurrentTicketLines(updated);
  };

  // Eliminar artículo seleccionado (DEL)
  const removeSelectedLine = () => {
    if (selectedLineIndex < 0 || selectedLineIndex >= cartLines.length) return;
    const item = cartLines[selectedLineIndex];
    const updated = cartLines.filter((_, idx) => idx !== selectedLineIndex);
    updateCurrentTicketLines(updated);
    setSelectedLineIndex(Math.max(0, selectedLineIndex - 1));
    showFeedback(`Eliminado: ${item.description}`);
    focusInput();
  };

  // Agregar artículo común / varios (INS)
  const handleAddVarios = (description: string, priceCents: number, quantity: number) => {
    const subtotal = Math.round(priceCents * quantity);
    const newLine: CartLine = {
      id: `line-${Date.now()}`,
      barcode: "VARIOS",
      description,
      unitPriceCents: priceCents,
      quantity,
      taxRateBp: 0,
      subtotalCents: subtotal,
      taxCents: 0,
      totalCents: subtotal,
    };
    const updated = [...cartLines, newLine];
    updateCurrentTicketLines(updated);
    setSelectedLineIndex(updated.length - 1);
    showFeedback(`+ ${quantity} × ${description}`);
    focusInput();
  };

  // Procesar cobro (F12)
  const handleProcessSale = async (payments: PaymentInput[]) => {
    if (cartLines.length === 0) return;

    const items: CartItemInput[] = cartLines.map((l) => ({
      productId: l.productId,
      barcode: l.barcode,
      description: l.description,
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      taxRateBp: l.taxRateBp,
      discountCents: 0,
    }));

    try {
      const receipt = await api.sales.create({
        userId: cashier.id,
        customerId: undefined,
        items,
        payments,
      });

      // Si hay más de un ticket, cerramos el ticket que se acaba de cobrar
      if (tickets.length > 1) {
        const remaining = tickets.filter((t) => t.id !== activeTicketId);
        setTickets(remaining);
        setActiveTicketId(remaining[0].id);
      } else {
        updateCurrentTicketLines([]);
      }
      setSelectedLineIndex(-1);
      showFeedback(`✅ Venta #${receipt.folio} cobrada con éxito. Cambio: ${formatCents(receipt.changeCents)}`);
      setIsCobroOpen(false);
      focusInput();
    } catch (err: unknown) {
      console.error("Error registrando venta:", err);
      alert(`Error al registrar la venta: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Manejador global de atajos de teclado estilo Eleventa
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isSearchOpen || isCobroOpen || isVariosOpen) return;

      if (e.key === "F7") {
        e.preventDefault();
        onNavigateToSettings?.();
      } else if (e.key === "F10") {
        e.preventDefault();
        setIsSearchOpen(true);
      } else if (e.key === "F12" || (e.code === "Space" && e.ctrlKey)) {
        e.preventDefault();
        if (cartLines.length > 0) {
          setIsCobroOpen(true);
        } else {
          showFeedback("⚠️ No hay productos en el ticket para cobrar");
        }
      } else if (e.key === "Insert") {
        e.preventDefault();
        setIsVariosOpen(true);
      } else if (e.key === "Delete") {
        e.preventDefault();
        removeSelectedLine();
      } else if (e.key === "+" && e.ctrlKey) {
        e.preventDefault();
        modifyQuantity(1);
      } else if (e.key === "-" && e.ctrlKey) {
        e.preventDefault();
        modifyQuantity(-1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (barcodeInput.trim().length > 0) {
          // 1. Si hay código escrito/escaneado: limpiarlo inmediatamente
          setBarcodeInput("");
          focusInput();
          showFeedback("Código limpiado", "info");
        } else {
          // 2. Si el input ya está vacío: cancelar o eliminar el ticket
          handleCancelOrDeleteTicket();
        }
      } else if (e.key === "ArrowDown") {
        if (document.activeElement !== barcodeInputRef.current) {
          e.preventDefault();
          setSelectedLineIndex((prev) => Math.min(cartLines.length - 1, prev + 1));
        }
      } else if (e.key === "ArrowUp") {
        if (document.activeElement !== barcodeInputRef.current) {
          e.preventDefault();
          setSelectedLineIndex((prev) => Math.max(0, prev - 1));
        }
      } else if (
        document.activeElement !== barcodeInputRef.current &&
        e.key.length === 1 &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.metaKey
      ) {
        // CAPTURA GLOBAL DE ESCÁNER: Si el foco no está en el input, capturar el dígito/carácter y enfocar
        e.preventDefault();
        barcodeInputRef.current?.focus();
        setBarcodeInput((prev) => prev + e.key);
      } else if (e.key === "Enter" && document.activeElement !== barcodeInputRef.current) {
        e.preventDefault();
        handleBarcodeSubmit();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSearchOpen, isCobroOpen, isVariosOpen, cartLines, selectedLineIndex, onLockTerminal, onNavigateToSettings, barcodeInput]);

  // Re-enfocar automáticamente el input si se hace clic en cualquier zona libre de la estación
  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      if (isSearchOpen || isCobroOpen || isVariosOpen) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        !target.closest("button") &&
        !target.closest("input") &&
        !target.closest("select") &&
        !target.closest("textarea")
      ) {
        barcodeInputRef.current?.focus();
      }
    };
    window.addEventListener("click", handleGlobalClick);
    return () => window.removeEventListener("click", handleGlobalClick);
  }, [isSearchOpen, isCobroOpen, isVariosOpen]);

  return (
    <div className="flex flex-col h-screen bg-slate-100 dark:bg-slate-950 text-slate-800 dark:text-slate-100 select-none overflow-hidden font-sans transition-colors duration-150">
      {/* 1. BARRA SUPERIOR DE MÓDULOS ESTILO ELEVENTA */}
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 py-2 flex items-center justify-between shadow-sm transition-colors duration-150">
        <div className="flex items-center gap-1 sm:gap-2">
          {/* Logo / Badge Megalider */}
          <div className="flex items-center gap-2 mr-3 px-2.5 py-1 bg-gradient-to-r from-red-600 to-rose-700 rounded-lg text-white font-black text-xs tracking-wider shadow">
            <span>ML</span>
            <span className="text-xs uppercase font-semibold text-rose-100 tracking-normal hidden md:inline">
              Megalider POS
            </span>
          </div>

          {/* Botones de Módulos (F1-F4) */}
          <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold text-xs shadow-sm hover:bg-emerald-500 transition-colors">
            <span className="bg-emerald-800/80 px-1.5 py-0.5 rounded text-[10px] font-mono">F1</span>
            <span>Ventas</span>
          </button>

          <button
            onClick={onNavigateToProducts}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-xs border border-slate-200 dark:border-transparent transition-colors"
          >
            <span className="bg-slate-200 dark:bg-slate-900 px-1.5 py-0.5 rounded text-[10px] font-mono text-slate-500 dark:text-slate-400">F3</span>
            <span>Productos</span>
          </button>

          <button
            onClick={() => showFeedback("Módulo de Clientes sincronizado con ERP")}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-xs border border-slate-200 dark:border-transparent transition-colors hidden sm:flex"
          >
            <span className="bg-slate-200 dark:bg-slate-900 px-1.5 py-0.5 rounded text-[10px] font-mono text-slate-500 dark:text-slate-400">F2</span>
            <span>Clientes</span>
          </button>

          <button
            onClick={() => showFeedback("Inventario sincronizado con ERP")}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-xs border border-slate-200 dark:border-transparent transition-colors hidden sm:flex"
          >
            <span className="bg-slate-200 dark:bg-slate-900 px-1.5 py-0.5 rounded text-[10px] font-mono text-slate-500 dark:text-slate-400">F4</span>
            <span>Inventario</span>
          </button>

          <button
            onClick={onNavigateToSettings}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-xs border border-slate-200 dark:border-transparent transition-colors"
            title="Configuración de periféricos y hardware (F7)"
          >
            <span className="bg-slate-200 dark:bg-slate-900 px-1.5 py-0.5 rounded text-[10px] font-mono text-slate-500 dark:text-slate-400">F7</span>
            <span>Configuración</span>
          </button>
        </div>

        {/* Info Cajero, Selector de Tema & Bloqueo */}
        <div className="flex items-center gap-3">
          {/* BOTÓN DE CAMBIO DE MODO CLARO / OSCURO */}
          <button
            type="button"
            onClick={toggleTheme}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-semibold transition-colors"
            title={theme === "dark" ? "Cambiar a Modo Claro" : "Cambiar a Modo Oscuro"}
          >
            {theme === "dark" ? (
              <>
                <span className="text-amber-400 text-sm">☀️</span>
                <span className="hidden sm:inline text-[11px]">Claro</span>
              </>
            ) : (
              <>
                <span className="text-indigo-600 text-sm">🌙</span>
                <span className="hidden sm:inline text-[11px]">Oscuro</span>
              </>
            )}
          </button>

          <div className="text-right hidden md:block">
            <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5 justify-end">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              {cashier.fullName}
            </div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400 uppercase font-mono">
              {terminalStatus.cajaCodigo || "CAJA-01"} • {terminalStatus.empresaNombre || "Megalider"}
            </div>
          </div>

          <button
            onClick={onLockTerminal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 dark:hover:bg-rose-900 border border-rose-200 dark:border-rose-800/40 text-rose-700 dark:text-rose-200 text-xs font-semibold transition-colors"
            title="Bloquear Terminal de Caja"
          >
            <span>🔒 Bloquear</span>
          </button>
        </div>
      </header>

      {/* 2. BARRA DE ENTRADA Y ACCIONES RÁPIDAS (ESTILO ELEVENTA) */}
      <div className="bg-slate-50 dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-800 p-3 flex flex-wrap items-center gap-3 transition-colors duration-150">
        {/* Pestañas de Tickets (Mínimo 1 ticket siempre) */}
        <div className="flex items-center gap-1 bg-slate-200/80 dark:bg-slate-950 p-1 rounded-xl border border-slate-300 dark:border-slate-800 mr-2">
          {tickets.map((t) => (
            <div
              key={t.id}
              className={`flex items-center rounded-lg text-xs font-bold transition-colors ${
                activeTicketId === t.id
                  ? "bg-white text-emerald-700 shadow-sm border border-slate-200 dark:bg-slate-800 dark:text-emerald-400 dark:border-emerald-500/30"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-900"
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  setActiveTicketId(t.id);
                  focusInput();
                }}
                className="px-3 py-1 flex items-center gap-1.5"
              >
                <span>{t.name}</span>
                {t.lines.length > 0 && (
                  <span className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300 px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold">
                    {t.lines.length}
                  </span>
                )}
              </button>

              {/* Botón de cerrar pestaña si hay más de 1 ticket */}
              {tickets.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCancelOrDeleteTicket(t.id);
                  }}
                  className="pr-2 pl-0.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 text-xs font-bold"
                  title={`Cerrar y eliminar ${t.name}`}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={handleAddTicket}
            className="px-2.5 py-1 text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-300/40 dark:hover:bg-slate-800 rounded-lg text-xs font-bold transition-colors"
            title="Adicionar nuevo ticket"
          >
            +
          </button>
        </div>

        {/* Input Principal de Código de Barras */}
        <form onSubmit={handleBarcodeSubmit} className="flex-1 min-w-[280px] flex items-center gap-2">
          <div className="relative flex-1">
            <input
              ref={barcodeInputRef}
              type="text"
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              placeholder="Código del producto o cantidad*código (ej. 3*75012345)..."
              className="w-full bg-white dark:bg-slate-950 border-2 border-slate-300 dark:border-slate-700 focus:border-emerald-600 dark:focus:border-emerald-500 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white font-mono text-base font-bold placeholder:font-sans placeholder:text-slate-400 dark:placeholder:text-slate-500 placeholder:text-xs placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-emerald-500/20 shadow-sm"
              autoFocus
            />
            {barcodeInput && (
              <button
                type="button"
                onClick={() => {
                  setBarcodeInput("");
                  focusInput();
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-white text-sm"
              >
                ✕
              </button>
            )}
          </div>
          <button
            type="submit"
            className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-md shadow-emerald-700/20 dark:shadow-emerald-950 transition-colors"
          >
            <span>Enter</span>
            <span className="hidden sm:inline">Agregar</span>
          </button>
        </form>

        {/* Botones de Acción de Entrada Rápida */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setIsVariosOpen(true)}
            className="px-3 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 dark:bg-slate-800 dark:hover:bg-slate-700 border border-amber-300 dark:border-slate-700 text-amber-800 dark:text-amber-300 font-bold text-xs flex items-center gap-1.5 transition-colors shadow-sm"
            title="Vender artículo sin código (Insert)"
          >
            <span className="bg-amber-200/80 dark:bg-amber-950/80 px-1 rounded text-[10px] font-mono text-amber-900 dark:text-amber-400 border border-amber-400/40 dark:border-amber-800/40">
              INS
            </span>
            <span>Varios</span>
          </button>

          <button
            onClick={() => setIsSearchOpen(true)}
            className="px-3 py-2 rounded-xl bg-sky-50 hover:bg-sky-100 dark:bg-slate-800 dark:hover:bg-slate-700 border border-sky-300 dark:border-slate-700 text-sky-800 dark:text-sky-300 font-bold text-xs flex items-center gap-1.5 transition-colors shadow-sm"
            title="Buscar Producto por Nombre o SKU (F10)"
          >
            <span className="bg-sky-200/80 dark:bg-sky-950/80 px-1 rounded text-[10px] font-mono text-sky-900 dark:text-sky-400 border border-sky-400/40 dark:border-sky-800/40">
              F10
            </span>
            <span>Buscar</span>
          </button>

          <button
            onClick={removeSelectedLine}
            disabled={selectedLineIndex < 0 || cartLines.length === 0}
            className="px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-slate-800 dark:hover:bg-rose-950/40 border border-rose-300 dark:border-slate-700 text-rose-800 dark:text-rose-300 font-bold text-xs flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:pointer-events-none shadow-sm"
            title="Eliminar producto seleccionado (Del)"
          >
            <span className="bg-rose-200/80 dark:bg-rose-950/80 px-1 rounded text-[10px] font-mono text-rose-900 dark:text-rose-400 border border-rose-400/40 dark:border-rose-800/40">
              DEL
            </span>
            <span>Borrar</span>
          </button>
        </div>
      </div>

      {/* FEEDBACK TOAST MULTI-COLOR CON SONIDO */}
      {feedback && (
        <div
          className={`px-4 py-2 text-xs font-semibold flex items-center justify-between border-b animate-in fade-in slide-in-from-top-1 transition-colors ${
            feedback.type === "success"
              ? "bg-emerald-50 dark:bg-emerald-950/80 border-emerald-300 dark:border-emerald-500/40 text-emerald-800 dark:text-emerald-200"
              : feedback.type === "warning"
              ? "bg-amber-50 dark:bg-amber-950/80 border-amber-300 dark:border-amber-500/40 text-amber-900 dark:text-amber-200"
              : feedback.type === "error"
              ? "bg-rose-50 dark:bg-rose-950/80 border-rose-300 dark:border-rose-500/40 text-rose-900 dark:text-rose-200"
              : "bg-sky-50 dark:bg-slate-800/95 border-sky-300 dark:border-slate-700 text-sky-900 dark:text-slate-200"
          }`}
        >
          <div className="flex items-center gap-2">
            <span>
              {feedback.type === "success"
                ? "🟢"
                : feedback.type === "warning"
                ? "🟡"
                : feedback.type === "error"
                ? "🔴"
                : "ℹ️"}
            </span>
            <span>{feedback.msg}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-slate-700 dark:hover:text-white ml-4"
          >
            ✕
          </button>
        </div>
      )}

      {/* 3. TABLA PRINCIPAL DE VENTAS ESTILO ELEVENTA */}
      <main className="flex-1 p-3 overflow-auto">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm flex flex-col h-full transition-colors duration-150">
          <table className="w-full text-left border-collapse">
            <thead className="border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase tracking-wider text-slate-600 dark:text-slate-400 font-bold sticky top-0 bg-slate-100 dark:bg-slate-900 z-10">
              <tr>
                <th className="py-2.5 px-3 w-12 text-center">#</th>
                <th className="py-2.5 px-3 w-36">Código de Barras</th>
                <th className="py-2.5 px-3">Descripción del Producto</th>
                <th className="py-2.5 px-3 w-28 text-right">Precio Venta</th>
                <th className="py-2.5 px-3 w-28 text-center">Cantidad</th>
                <th className="py-2.5 px-3 w-32 text-right">Importe</th>
                <th className="py-2.5 px-3 w-24 text-center">Existencia</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono text-xs">
              {cartLines.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-24 text-center text-slate-400 dark:text-slate-600 font-sans">
                    <div className="text-4xl mb-2">🛒</div>
                    <div className="text-base font-bold text-slate-700 dark:text-slate-400">El ticket de venta está vacío</div>
                    <div className="text-xs text-slate-500 dark:text-slate-500 mt-1">
                      Escanee un código de barras, presione <span className="text-sky-600 dark:text-sky-400 font-mono font-bold">F10</span> para buscar, o <span className="text-amber-600 dark:text-amber-400 font-mono font-bold">INS</span> para venta libre.
                    </div>
                  </td>
                </tr>
              ) : (
                cartLines.map((line, index) => {
                  const isSelected = index === selectedLineIndex;
                  return (
                    <tr
                      key={line.id}
                      onClick={() => setSelectedLineIndex(index)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-950 dark:text-emerald-200 border-l-4 border-l-emerald-600 dark:border-l-emerald-500"
                          : "hover:bg-slate-50 dark:hover:bg-slate-800/40 text-slate-800 dark:text-slate-200"
                      }`}
                    >
                      <td className="py-2.5 px-3 text-center text-slate-400 dark:text-slate-500 font-sans text-xs">
                        {index + 1}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-slate-700 dark:text-slate-300">
                        {line.barcode}
                      </td>
                      <td className="py-2.5 px-3 font-sans font-medium text-slate-900 dark:text-white">
                        {line.description}
                        {line.taxRateBp > 0 && (
                          <span className="ml-2 text-[10px] text-slate-500 font-mono">
                            (IVA {(line.taxRateBp / 100).toFixed(0)}%)
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold text-slate-700 dark:text-slate-300">
                        {formatCents(line.unitPriceCents)}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span className="bg-slate-100 dark:bg-slate-950 px-2 py-1 rounded border border-slate-200 dark:border-slate-800 font-bold text-emerald-700 dark:text-emerald-400">
                          {line.quantity}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-emerald-700 dark:text-emerald-400 text-sm">
                        {formatCents(line.totalCents)}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {line.currentStock !== undefined ? (
                          line.currentStock <= 0 ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-800/60 font-sans uppercase tracking-wide">
                              Agotado (0)
                            </span>
                          ) : line.currentStock <= 5 ? (
                            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800/60 font-mono">
                              Bajo ({line.currentStock})
                            </span>
                          ) : (
                            <span className="text-emerald-700 dark:text-emerald-400 font-bold font-mono">
                              {line.currentStock}
                            </span>
                          )
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </main>

      {/* 4. FOOTER RESUMEN ESTILO ELEVENTA CON VISOR GIGANTE */}
      <footer className="bg-white dark:bg-slate-900 border-t-2 border-slate-200 dark:border-slate-800 p-4 flex flex-col md:flex-row items-center justify-between gap-4 shadow-md transition-colors duration-150">
        {/* Atajos Inferiores & Resumen de Piezas */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="bg-slate-100 dark:bg-slate-950 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center gap-4">
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-500">Artículos</div>
              <div className="text-lg font-black text-slate-800 dark:text-white font-mono">{totalItemsCount}</div>
            </div>
            <div className="w-px h-8 bg-slate-300 dark:bg-slate-800" />
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-500">Piezas</div>
              <div className="text-lg font-black text-emerald-600 dark:text-emerald-400 font-mono">{totalPieces}</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => showFeedback("Poner ticket en espera")}
              className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-xs border border-slate-200 dark:border-transparent flex items-center gap-1.5 transition-colors"
            >
              <span className="bg-slate-200 dark:bg-slate-900 px-1 rounded font-mono text-[10px] text-slate-600 dark:text-slate-400">F6</span>
              <span>Pendiente</span>
            </button>
            <button
              onClick={() => handleCancelOrDeleteTicket()}
              className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-rose-50 dark:bg-slate-800 dark:hover:bg-rose-950/40 text-slate-600 hover:text-rose-700 dark:text-slate-400 dark:hover:text-rose-300 font-semibold text-xs border border-slate-200 dark:border-transparent flex items-center gap-1.5 transition-colors"
              title={tickets.length > 1 ? `Eliminar ${currentTicket.name}` : `Vaciar ${currentTicket.name}`}
            >
              <span>{tickets.length > 1 ? `✕ Eliminar ${currentTicket.name}` : "✕ Cancelar Ticket"}</span>
            </button>
          </div>
        </div>

        {/* VISOR GIGANTE DEL TOTAL Y BOTÓN COBRAR (F12) */}
        <div className="flex items-center gap-5 w-full md:w-auto justify-end">
          <div className="text-right">
            <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
              Subtotal: {formatCents(subtotalCents)} {taxCents > 0 && `• IVA: ${formatCents(taxCents)}`}
            </div>
            <div className="text-[10px] uppercase tracking-widest font-black text-slate-500 dark:text-slate-400">
              Total a Pagar
            </div>
            <div className="text-4xl md:text-5xl font-black text-emerald-600 dark:text-emerald-400 font-mono tracking-tight dark:drop-shadow-[0_0_20px_rgba(16,185,129,0.3)]">
              {formatCents(totalCents)}
            </div>
          </div>

          <button
            onClick={() => {
              if (cartLines.length > 0) setIsCobroOpen(true);
            }}
            disabled={cartLines.length === 0}
            className="px-8 py-4 rounded-2xl bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-95 text-white font-black text-xl uppercase tracking-wider flex items-center gap-3 shadow-xl shadow-emerald-700/30 dark:shadow-emerald-950/60 transition-all disabled:opacity-40 disabled:pointer-events-none border border-emerald-400/40"
          >
            <span className="bg-emerald-800/80 px-2 py-0.5 rounded-lg text-sm font-mono border border-emerald-400/40">
              F12
            </span>
            <span>Cobrar</span>
          </button>
        </div>
      </footer>

      {/* MODALES */}
      <SearchProductModal
        isOpen={isSearchOpen}
        onClose={() => {
          setIsSearchOpen(false);
          focusInput();
        }}
        onSelect={(p: Product) => {
          addProductToTicket(p, 1);
          setIsSearchOpen(false);
          focusInput();
        }}
      />

      <VariosModal
        isOpen={isVariosOpen}
        onClose={() => {
          setIsVariosOpen(false);
          focusInput();
        }}
        onAdd={(desc, priceCents, qty) => {
          handleAddVarios(desc, priceCents, qty);
        }}
      />

      <CobroModal
        isOpen={isCobroOpen}
        totalCents={totalCents}
        onClose={() => {
          setIsCobroOpen(false);
          focusInput();
        }}
        onConfirm={handleProcessSale}
      />
    </div>
  );
}
