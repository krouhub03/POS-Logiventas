import { useState, useEffect, useRef, useCallback } from "react";
import { Product, CashierUser, TerminalStatus, CartItemInput, PaymentInput } from "../types";
import { api } from "../services/api";
import { formatCents } from "../lib/money";
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
}

export function SalesStationPage({
  cashier,
  terminalStatus,
  onLockTerminal,
  onNavigateToProducts,
}: SalesStationPageProps) {
  // Tabs de Tickets (Soporte multi-ticket en memoria estilo Eleventa)
  const [tickets, setTickets] = useState<TicketTab[]>([
    { id: 1, name: "Ticket 1", lines: [] },
    { id: 2, name: "Ticket 2", lines: [] },
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
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  // Ticket activo actual
  const currentTicket = tickets.find((t) => t.id === activeTicketId) || tickets[0];
  const cartLines = currentTicket.lines;

  // Totales del ticket activo
  const subtotalCents = cartLines.reduce((acc, l) => acc + l.subtotalCents, 0);
  const taxCents = cartLines.reduce((acc, l) => acc + l.taxCents, 0);
  const totalCents = cartLines.reduce((acc, l) => acc + l.totalCents, 0);
  const totalPieces = cartLines.reduce((acc, l) => acc + l.quantity, 0);
  const totalItemsCount = cartLines.length;

  const showFeedback = (msg: string) => {
    setFeedbackMsg(msg);
    setTimeout(() => setFeedbackMsg(null), 3000);
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

  // Agregar producto al ticket
  const addProductToTicket = (product: Product, quantity = 1) => {
    const existingIndex = cartLines.findIndex((l) => l.productId === product.id);

    if (existingIndex >= 0) {
      // Incrementar cantidad existente
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
      // Nueva línea
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

  // Buscar por código de barras o formato "CANTIDAD*CODIGO" (ej. 3*75012345)
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

    try {
      // Primero intentar búsqueda exacta por código de barras
      const direct = await api.products.findByBarcode(queryCode);
      if (direct) {
        addProductToTicket(direct, qty);
        setBarcodeInput("");
        showFeedback(`+ ${qty} × ${direct.name}`);
        return;
      }

      // Si no, buscar por listado con filtro
      const products = await api.products.list(queryCode);
      const match = products.find(
        (p) => p.barcode?.toLowerCase() === queryCode.toLowerCase() || p.sku.toLowerCase() === queryCode.toLowerCase()
      ) || (products.length === 1 ? products[0] : null);

      if (match) {
        addProductToTicket(match, qty);
        setBarcodeInput("");
        showFeedback(`+ ${qty} × ${match.name}`);
      } else if (products.length > 1) {
        // Abrir modal de búsqueda si hay múltiples coincidencias
        setIsSearchOpen(true);
      } else {
        showFeedback(`⚠️ No se encontró el producto: ${queryCode}`);
      }
    } catch (err) {
      console.error("Error buscando producto:", err);
      showFeedback("Error al buscar producto");
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

      // Limpiar ticket actual
      updateCurrentTicketLines([]);
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
      // Ignorar atajos si hay modales abiertos
      if (isSearchOpen || isCobroOpen || isVariosOpen) return;

      if (e.key === "F10") {
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
        onLockTerminal();
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
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSearchOpen, isCobroOpen, isVariosOpen, cartLines, selectedLineIndex, onLockTerminal]);

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 select-none overflow-hidden font-sans">
      {/* 1. BARRA SUPERIOR DE MÓDULOS ESTILO ELEVENTA */}
      <header className="bg-slate-900 border-b border-slate-800 px-4 py-2 flex items-center justify-between shadow-md">
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
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs transition-colors"
          >
            <span className="bg-slate-900 px-1.5 py-0.5 rounded text-[10px] font-mono text-slate-400">F3</span>
            <span>Productos</span>
          </button>

          <button
            onClick={() => showFeedback("Módulo de Clientes sincronizado con ERP")}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs transition-colors hidden sm:flex"
          >
            <span className="bg-slate-900 px-1.5 py-0.5 rounded text-[10px] font-mono text-slate-400">F2</span>
            <span>Clientes</span>
          </button>

          <button
            onClick={() => showFeedback("Inventario sincronizado con ERP")}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs transition-colors hidden sm:flex"
          >
            <span className="bg-slate-900 px-1.5 py-0.5 rounded text-[10px] font-mono text-slate-400">F4</span>
            <span>Inventario</span>
          </button>
        </div>

        {/* Info Cajero & Terminal */}
        <div className="flex items-center gap-3">
          <div className="text-right hidden md:block">
            <div className="text-xs font-bold text-white flex items-center gap-1.5 justify-end">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              {cashier.fullName}
            </div>
            <div className="text-[10px] text-slate-400 uppercase font-mono">
              {terminalStatus.cajaCodigo || "CAJA-01"} • {terminalStatus.empresaNombre || "Megalider"}
            </div>
          </div>

          <button
            onClick={onLockTerminal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900 border border-rose-800/40 text-rose-200 text-xs font-semibold transition-colors"
            title="Bloquear Terminal (Esc)"
          >
            <span>🔒 Bloquear</span>
            <span className="text-[10px] font-mono bg-rose-900/80 px-1 rounded text-rose-300">Esc</span>
          </button>
        </div>
      </header>

      {/* 2. BARRA DE ENTRADA Y ACCIONES RÁPIDAS (ESTILO ELEVENTA) */}
      <div className="bg-slate-900/90 border-b border-slate-800 p-3 flex flex-wrap items-center gap-3">
        {/* Pestañas de Tickets (Ticket 1, Ticket 2, +) */}
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 mr-2">
          {tickets.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setActiveTicketId(t.id);
                focusInput();
              }}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${
                activeTicketId === t.id
                  ? "bg-slate-800 text-emerald-400 border border-emerald-500/30 shadow"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
              }`}
            >
              <span>{t.name}</span>
              {t.lines.length > 0 && (
                <span className="bg-emerald-900/60 text-emerald-300 px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold">
                  {t.lines.length}
                </span>
              )}
            </button>
          ))}
          <button
            onClick={() => {
              const nextId = tickets.length + 1;
              setTickets([...tickets, { id: nextId, name: `Ticket ${nextId}`, lines: [] }]);
              setActiveTicketId(nextId);
            }}
            className="px-2 py-1 text-slate-500 hover:text-slate-200 hover:bg-slate-800 rounded-lg text-xs font-bold transition-colors"
            title="Nuevo Ticket"
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
              className="w-full bg-slate-950 border-2 border-slate-700 focus:border-emerald-500 rounded-xl px-4 py-2.5 text-white font-mono text-base font-bold placeholder:font-sans placeholder:text-slate-500 placeholder:text-xs placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              autoFocus
            />
            {barcodeInput && (
              <button
                type="button"
                onClick={() => {
                  setBarcodeInput("");
                  focusInput();
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            )}
          </div>
          <button
            type="submit"
            className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-md shadow-emerald-950 transition-colors"
          >
            <span>Enter</span>
            <span className="hidden sm:inline">Agregar</span>
          </button>
        </form>

        {/* Botones de Acción de Entrada Rápida */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setIsVariosOpen(true)}
            className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-amber-300 font-bold text-xs flex items-center gap-1.5 transition-colors"
            title="Vender artículo sin código (Insert)"
          >
            <span className="bg-amber-950/80 px-1 rounded text-[10px] font-mono text-amber-400 border border-amber-800/40">
              INS
            </span>
            <span>Varios</span>
          </button>

          <button
            onClick={() => setIsSearchOpen(true)}
            className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sky-300 font-bold text-xs flex items-center gap-1.5 transition-colors"
            title="Buscar Producto por Nombre o SKU (F10)"
          >
            <span className="bg-sky-950/80 px-1 rounded text-[10px] font-mono text-sky-400 border border-sky-800/40">
              F10
            </span>
            <span>Buscar</span>
          </button>

          <button
            onClick={removeSelectedLine}
            disabled={selectedLineIndex < 0 || cartLines.length === 0}
            className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-rose-950/40 border border-slate-700 hover:border-rose-800/50 text-rose-300 font-bold text-xs flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:pointer-events-none"
            title="Eliminar producto seleccionado (Del)"
          >
            <span className="bg-rose-950/80 px-1 rounded text-[10px] font-mono text-rose-400 border border-rose-800/40">
              DEL
            </span>
            <span>Borrar</span>
          </button>
        </div>
      </div>

      {/* FEEDBACK TOAST */}
      {feedbackMsg && (
        <div className="bg-slate-800/95 border-b border-emerald-500/40 text-emerald-300 px-4 py-1.5 text-xs font-semibold flex items-center justify-between animate-in fade-in slide-in-from-top-1">
          <span>{feedbackMsg}</span>
          <button onClick={() => setFeedbackMsg(null)} className="text-slate-400 hover:text-white">
            ✕
          </button>
        </div>
      )}

      {/* 3. TABLA PRINCIPAL DE VENTAS ESTILO ELEVENTA */}
      <main className="flex-1 bg-slate-950 overflow-auto p-3">
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-inner flex flex-col h-full">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-850 border-b border-slate-800 text-[11px] uppercase tracking-wider text-slate-400 font-bold sticky top-0 bg-slate-900 z-10">
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
            <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
              {cartLines.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-24 text-center text-slate-600 font-sans">
                    <div className="text-4xl mb-2">🛒</div>
                    <div className="text-base font-bold text-slate-400">El ticket de venta está vacío</div>
                    <div className="text-xs text-slate-500 mt-1">
                      Escanee un código de barras, presione <span className="text-sky-400 font-mono font-bold">F10</span> para buscar, o <span className="text-amber-400 font-mono font-bold">INS</span> para venta libre.
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
                          ? "bg-emerald-950/40 text-emerald-200 border-l-4 border-l-emerald-500"
                          : "hover:bg-slate-800/40 text-slate-200"
                      }`}
                    >
                      <td className="py-2.5 px-3 text-center text-slate-500 font-sans text-xs">
                        {index + 1}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-slate-300">
                        {line.barcode}
                      </td>
                      <td className="py-2.5 px-3 font-sans font-medium text-white">
                        {line.description}
                        {line.taxRateBp > 0 && (
                          <span className="ml-2 text-[10px] text-slate-500 font-mono">
                            (IVA {(line.taxRateBp / 100).toFixed(0)}%)
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold text-slate-300">
                        {formatCents(line.unitPriceCents)}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span className="bg-slate-950 px-2 py-1 rounded border border-slate-800 font-bold text-emerald-400">
                          {line.quantity}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-emerald-400 text-sm">
                        {formatCents(line.totalCents)}
                      </td>
                      <td className="py-2.5 px-3 text-center text-slate-400">
                        {line.currentStock !== undefined ? (
                          <span
                            className={`px-1.5 py-0.5 rounded text-[11px] ${
                              line.currentStock <= 5
                                ? "bg-rose-950/80 text-rose-300 border border-rose-800/40"
                                : "text-slate-400"
                            }`}
                          >
                            {line.currentStock}
                          </span>
                        ) : (
                          "—"
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
      <footer className="bg-slate-900 border-t-2 border-slate-800 p-4 flex flex-col md:flex-row items-center justify-between gap-4 shadow-2xl">
        {/* Atajos Inferiores & Resumen de Piezas */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="bg-slate-950 px-4 py-2.5 rounded-xl border border-slate-800 flex items-center gap-4">
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-500">Artículos</div>
              <div className="text-lg font-black text-white font-mono">{totalItemsCount}</div>
            </div>
            <div className="w-px h-8 bg-slate-800" />
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-500">Piezas</div>
              <div className="text-lg font-black text-emerald-400 font-mono">{totalPieces}</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => showFeedback("Poner ticket en espera")}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs flex items-center gap-1.5 transition-colors"
            >
              <span className="bg-slate-900 px-1 rounded font-mono text-[10px] text-slate-400">F6</span>
              <span>Pendiente</span>
            </button>
            <button
              onClick={() => {
                if (confirm("¿Desea vaciar el ticket actual?")) {
                  updateCurrentTicketLines([]);
                  setSelectedLineIndex(-1);
                  showFeedback("Ticket vaciado");
                  focusInput();
                }
              }}
              disabled={cartLines.length === 0}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-rose-950/40 text-slate-400 hover:text-rose-300 font-semibold text-xs flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:pointer-events-none"
            >
              <span>✕ Cancelar Ticket</span>
            </button>
          </div>
        </div>

        {/* VISOR GIGANTE DEL TOTAL Y BOTÓN COBRAR (F12) */}
        <div className="flex items-center gap-5 w-full md:w-auto justify-end">
          <div className="text-right">
            <div className="text-[10px] text-slate-400 font-mono">
              Subtotal: {formatCents(subtotalCents)} {taxCents > 0 && `• IVA: ${formatCents(taxCents)}`}
            </div>
            <div className="text-[10px] uppercase tracking-widest font-black text-slate-400">
              Total a Pagar
            </div>
            <div className="text-4xl md:text-5xl font-black text-emerald-400 font-mono tracking-tight drop-shadow-[0_0_20px_rgba(16,185,129,0.3)]">
              {formatCents(totalCents)}
            </div>
          </div>

          <button
            onClick={() => {
              if (cartLines.length > 0) setIsCobroOpen(true);
            }}
            disabled={cartLines.length === 0}
            className="px-8 py-4 rounded-2xl bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 hover:from-emerald-500 hover:to-teal-400 active:scale-95 text-white font-black text-xl uppercase tracking-wider flex items-center gap-3 shadow-xl shadow-emerald-950/60 transition-all disabled:opacity-40 disabled:pointer-events-none border border-emerald-400/30"
          >
            <span className="bg-emerald-900/80 px-2 py-0.5 rounded-lg text-sm font-mono border border-emerald-400/40">
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
