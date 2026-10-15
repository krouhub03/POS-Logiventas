import { useState, useEffect, useRef, useCallback } from "react";
import { Product, CashierUser, TerminalStatus, CartItemInput, PaymentInput, SyncStatus, CashShift, Customer } from "../types";
import { api } from "../services/api";
import { formatCents, calculateTaxCents } from "../lib/money";
import { useTheme } from "../contexts/ThemeContext";
import { useModals } from "../contexts/ModalContext";
import { playScanSuccess, playStockWarning, playScanError } from "../lib/sound";
import { hasPermission } from "../lib/permissions";
import { SearchProductModal } from "../components/SearchProductModal";
import { CobroModal } from "../components/CobroModal";
import { VariosModal } from "../components/VariosModal";
import { CustomerModal } from "../components/CustomerModal";

interface CartLine {
  id: string;
  productId?: number;
  barcode: string;
  description: string;
  unitPriceCents: number;
  quantity: number;
  taxRateBp: number;
  taxFixedCents?: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  currentStock?: number;
  controlsStock?: boolean;
}

interface TicketTab {
  id: number;
  name: string;
  lines: CartLine[];
  customer?: Customer | null;
}

const BagIcon = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>
  </svg>
);

const PackageIcon = () => (
  <svg className="w-3.5 h-3.5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>
  </svg>
);

const UsersIcon = () => (
  <svg className="w-3.5 h-3.5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
);

const StoreIcon = () => (
  <svg className="w-3.5 h-3.5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/><path d="M2 7h20"/>
  </svg>
);

const SettingsIcon = () => (
  <svg className="w-3.5 h-3.5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>
  </svg>
);

const BarcodeScannerIcon = () => (
  <svg className="w-4 h-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>
    <path d="M7 8v8"/><path d="M12 8v8"/><path d="M17 8v8"/>
  </svg>
);

const EmptyCartIcon = () => (
  <svg className="w-8 h-8 text-sky-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>
  </svg>
);

interface SalesStationPageProps {
  cashier: CashierUser;
  terminalStatus: TerminalStatus;
  activeShift?: CashShift | null;
  isActive?: boolean;
  onLockTerminal: () => void;
  onOpenCloseShiftModal?: () => void;
  onNavigateToProducts?: () => void;
  onNavigateToInventory?: () => void;
  onNavigateToSettings?: () => void;
}

const STORAGE_KEY_TICKETS = "pos_active_tickets";
const STORAGE_KEY_ACTIVE_TICKET = "pos_active_ticket_id";

function getInitialTickets(): TicketTab[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TICKETS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.error("Error leyendo tickets guardados:", e);
  }
  return [{ id: 1, name: "Ticket 1", lines: [] }];
}

function getInitialActiveTicketId(initialTickets: TicketTab[]): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ACTIVE_TICKET);
    if (raw) {
      const parsed = Number(raw);
      if (initialTickets.some((t) => t.id === parsed)) {
        return parsed;
      }
    }
  } catch (e) {
    console.error("Error leyendo ticket activo guardado:", e);
  }
  return initialTickets[0]?.id || 1;
}

export function SalesStationPage({
  cashier,
  terminalStatus,
  activeShift,
  isActive = true,
  onLockTerminal,
  onOpenCloseShiftModal,
  onNavigateToProducts,
  onNavigateToInventory,
  onNavigateToSettings,
}: SalesStationPageProps) {
  const { theme, toggleTheme } = useTheme();
  const { confirm, alert: modalAlert } = useModals();

  // Tabs de Tickets: Persistidos permanentemente en localStorage (mínimo 1 ticket siempre)
  const [tickets, setTickets] = useState<TicketTab[]>(getInitialTickets);
  const [activeTicketId, setActiveTicketId] = useState<number>(() =>
    getInitialActiveTicketId(tickets)
  );

  // Guardar tickets en localStorage ante cualquier adición, edición, cancelación o venta
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_TICKETS, JSON.stringify(tickets));
  }, [tickets]);

  // Guardar ticket activo seleccionado
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_ACTIVE_TICKET, String(activeTicketId));
  }, [activeTicketId]);

  // Input de código de barras
  const [barcodeInput, setBarcodeInput] = useState("");
  const [selectedLineIndex, setSelectedLineIndex] = useState<number>(-1);
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  // Edición de nombre de ticket por doble clic
  const [editingTicketId, setEditingTicketId] = useState<number | null>(null);
  const [editingTicketName, setEditingTicketName] = useState("");
  const editTicketInputRef = useRef<HTMLInputElement>(null);

  // Modales
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isCobroOpen, setIsCobroOpen] = useState(false);
  const [isVariosOpen, setIsVariosOpen] = useState(false);
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);

  // Estado de feedback / notificación rápida
  const [feedback, setFeedback] = useState<{
    type: "success" | "warning" | "error" | "info";
    msg: string;
  } | null>(null);

  // Estado de sincronización en tiempo real y outbox
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  // Escuchar eventos en tiempo real del Daemon de Sincronización continua de Rust
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    // Cargar estado inicial
    api.sync.getStatus().then(setSyncStatus).catch(console.warn);

    // Suscribirse a eventos automáticos emitidos por el Daemon de Rust
    api.sync
      .onStatusChange((status) => {
        setSyncStatus(status);
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(console.warn);

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

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
    if (isActive && !isSearchOpen && !isCobroOpen && !isVariosOpen && !isCustomerModalOpen && editingTicketId === null) {
      barcodeInputRef.current?.focus();
    }
  }, [isActive, isSearchOpen, isCobroOpen, isVariosOpen, isCustomerModalOpen, editingTicketId]);

  useEffect(() => {
    if (isActive && editingTicketId === null) {
      focusInput();
    }
  }, [isActive, focusInput, activeTicketId, editingTicketId]);

  // Enfocar y seleccionar texto al editar nombre de ticket
  useEffect(() => {
    if (editingTicketId !== null) {
      editTicketInputRef.current?.focus();
      editTicketInputRef.current?.select();
    }
  }, [editingTicketId]);

  // Iniciar edición de nombre de ticket por doble clic
  const handleStartRenameTicket = (ticket: TicketTab) => {
    setActiveTicketId(ticket.id);
    setEditingTicketId(ticket.id);
    setEditingTicketName(ticket.name);
  };

  // Guardar nuevo nombre de ticket
  const handleSaveTicketName = (ticketId: number) => {
    const trimmed = editingTicketName.trim();
    if (trimmed) {
      setTickets((prev) =>
        prev.map((t) => (t.id === ticketId ? { ...t, name: trimmed } : t))
      );
    }
    setEditingTicketId(null);
    focusInput();
  };

  // Cancelar edición de nombre de ticket
  const handleCancelRenameTicket = () => {
    setEditingTicketId(null);
    focusInput();
  };

  // Actualizar líneas del ticket activo
  const updateCurrentTicketLines = (newLines: CartLine[]) => {
    setTickets((prev) =>
      prev.map((t) => (t.id === activeTicketId ? { ...t, lines: newLines } : t))
    );
  };

  // Actualizar cliente asignado al ticket activo
  const updateCurrentTicketCustomer = (customer: Customer | null) => {
    updateTicketCustomerById(activeTicketId, customer);
  };

  // Actualizar cliente de cualquier ticket por ID (permite desvincular con 1 clic sin cambiar de tab)
  const updateTicketCustomerById = (ticketId: number, customer: Customer | null) => {
    setTickets((prev) =>
      prev.map((t) => (t.id === ticketId ? { ...t, customer } : t))
    );
  };

  // Adicionar un nuevo ticket
  const handleAddTicket = () => {
    setEditingTicketId(null);
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

  // Poner ticket actual en espera / pendiente (F6)
  const handleHoldTicket = () => {
    setEditingTicketId(null);
    if (cartLines.length === 0) {
      showFeedback("El ticket actual ya está vacío", "info");
      focusInput();
      return;
    }

    // Si ya existe otro ticket completamente vacío, cambiamos a él para atender al nuevo cliente
    const existingEmpty = tickets.find((t) => t.id !== activeTicketId && t.lines.length === 0);
    if (existingEmpty) {
      setActiveTicketId(existingEmpty.id);
      setSelectedLineIndex(-1);
      showFeedback(`⏳ ${currentTicket.name} en espera. ${existingEmpty.name} listo para venta.`, "info");
      focusInput();
      return;
    }

    // Si todos los tickets abiertos tienen productos, creamos uno nuevo limpio
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
    showFeedback(`⏳ ${currentTicket.name} en espera. ${newTicket.name} listo para venta.`, "info");
    focusInput();
  };

  // Cancelar o eliminar ticket (mínimo 1 siempre)
  const handleCancelOrDeleteTicket = async (targetId = activeTicketId) => {
    if (editingTicketId === targetId) {
      setEditingTicketId(null);
    }
    const target = tickets.find((t) => t.id === targetId);
    if (!target) return;

    // Si solo hay 1 ticket (el mínimo obligatorio): se vacían sus productos y se desvincula el cliente
    if (tickets.length <= 1) {
      if (target.lines.length === 0 && !target.customer) {
        showFeedback("El ticket ya está vacío. Siempre debe haber al menos 1 ticket activo.");
        return;
      }
      const ok = await confirm({
        title: "Vaciar Ticket Actual",
        message: target.customer
          ? `¿Desea vaciar los productos y desvincular al cliente ${target.customer.name} de ${target.name}?`
          : `¿Desea vaciar los productos de ${target.name}? Esta acción no se puede deshacer.`,
        variant: "warning",
        confirmText: "Sí, Vaciar Ticket",
        cancelText: "Mantener Ticket",
      });
      if (ok) {
        setTickets((prev) =>
          prev.map((t) => (t.id === target.id ? { ...t, lines: [], customer: null } : t))
        );
        setSelectedLineIndex(-1);
        showFeedback(`${target.name} vaciado y cliente desvinculado`);
        focusInput();
      }
      return;
    }

    // Si hay más de 1 ticket: se descarta y elimina
    const hasItems = target.lines.length > 0;
    const ok = await confirm({
      title: hasItems ? "Cancelar y Eliminar Ticket" : "Cerrar Pestaña de Ticket",
      message: hasItems
        ? `¿Desea cancelar y eliminar ${target.name} con sus ${target.lines.length} producto(s)?`
        : `¿Desea cerrar la pestaña de ${target.name}?`,
      variant: hasItems ? "danger" : "primary",
      confirmText: hasItems ? "Sí, Cancelar y Eliminar" : "Cerrar Ticket",
      cancelText: "Volver",
    });

    if (ok) {
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
      const fixedTax = Math.round((existing.taxFixedCents || 0) * newQty);
      const newTax = calculateTaxCents(newSubtotal, existing.taxRateBp) + fixedTax;
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
      const prodTaxFixed = product.taxFixedCents || 0;
      const unitSubtotal = Math.round(product.priceCents * quantity);
      const unitTax = calculateTaxCents(unitSubtotal, product.taxRateBp) + Math.round(prodTaxFixed * quantity);
      const newLine: CartLine = {
        id: `line-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        productId: product.id,
        barcode: product.barcode || product.sku,
        description: product.name,
        unitPriceCents: product.priceCents,
        quantity,
        taxRateBp: product.taxRateBp,
        taxFixedCents: prodTaxFixed,
        subtotalCents: unitSubtotal,
        taxCents: unitTax,
        totalCents: unitSubtotal + unitTax,
        currentStock: product.stock,
        controlsStock: product.controlsStock,
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
      if (product.isService) {
        playScanSuccess();
        showFeedback(`✅ + ${quantity} × ${product.name} (Servicio)`, "success");
      } else {
        const lineEnTicket = cartLines.find((l) => l.productId === product.id);
        const yaEnTicket = lineEnTicket ? lineEnTicket.quantity : 0;

        // Cantidad de este producto apartada en otros tickets en espera
        const enOtrosTickets = tickets
          .filter((t) => t.id !== activeTicketId)
          .flatMap((t) => t.lines)
          .filter((l) => l.productId === product.id)
          .reduce((sum, l) => sum + l.quantity, 0);

        const nuevoTotalTicket = yaEnTicket + quantity;
        const stockRestante = product.stock - nuevoTotalTicket;

        if (product.stock <= 0) {
          playStockWarning();
          showFeedback(
            `⚠️ SIN STOCK REGISTRADO: "${product.name}" (Stock: 0 ${product.unit}). Agregado por prioridad de mostrador.`,
            "warning"
          );
        } else if (enOtrosTickets > 0 && stockRestante < enOtrosTickets) {
          playScanSuccess();
          showFeedback(
            `⚡ Prioridad Mostrador: + ${quantity} × ${product.name} (Stock físico: ${product.stock} | ⏳ ${enOtrosTickets} en espera en otros tickets). El primero en pagar se lo lleva.`,
            "info"
          );
        } else if (stockRestante < 0) {
          playStockWarning();
          showFeedback(
            `⚠️ STOCK INSUFICIENTE: "${product.name}" solo tiene ${product.stock} ${product.unit}. Agregado por prioridad de mostrador.`,
            "warning"
          );
        } else {
          playScanSuccess();
          showFeedback(
            `✅ + ${quantity} × ${product.name} (Disponibles: ${stockRestante} ${product.unit}${
              enOtrosTickets > 0 ? ` • ⏳ ${enOtrosTickets} en espera` : ""
            })`,
            "success"
          );
        }
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
    const targetTaxFixed = target.taxFixedCents || 0;
    const newTax = calculateTaxCents(newSubtotal, target.taxRateBp) + Math.round(targetTaxFixed * newQty);

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
  const handleProcessSale = async (payments: PaymentInput[], customerId?: number) => {
    if (cartLines.length === 0) return;

    const finalCustomerId = customerId ?? currentTicket?.customer?.id ?? undefined;

    const items: CartItemInput[] = cartLines.map((l) => ({
      productId: l.productId,
      barcode: l.barcode,
      description: l.description,
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      taxRateBp: l.taxRateBp,
      taxFixedCents: l.taxFixedCents,
      discountCents: 0,
    }));

    try {
      const receipt = await api.sales.create({
        userId: cashier.id,
        customerId: finalCustomerId,
        items,
        payments,
      });

      // Si hay más de un ticket, cerramos el ticket que se acaba de cobrar
      if (tickets.length > 1) {
        const remaining = tickets.filter((t) => t.id !== activeTicketId);
        setTickets(remaining);
        setActiveTicketId(remaining[0].id);
      } else {
        setTickets((prev) =>
          prev.map((t) => (t.id === activeTicketId ? { ...t, lines: [], customer: null } : t))
        );
      }
      setSelectedLineIndex(-1);
      showFeedback(`✅ Venta #${receipt.folio} cobrada con éxito. Cambio: ${formatCents(receipt.changeCents)}`);
      setIsCobroOpen(false);
      focusInput();
      // Notificar al outbox dispatcher de inmediato para subida rápida
      api.sync.dispatchOutbox().catch(console.warn);
    } catch (err: unknown) {
      console.error("Error registrando venta:", err);
      modalAlert({
        title: "Error al Procesar Venta",
        message: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    }
  };

  // Pre-verificación de stock crítico y apertura de cobro
  const handleOpenCobro = async () => {
    if (cartLines.length === 0) {
      showFeedback("⚠️ No hay productos en el ticket para cobrar", "warning");
      return;
    }

    const physicalItems = cartLines
      .filter((l) => l.productId != null)
      .map((l) => ({ productId: l.productId!, quantity: l.quantity }));

    if (physicalItems.length > 0) {
      try {
        const check = await api.sync.verifyStock(physicalItems);
        if (!check.ok) {
          playScanError();
          const prodName = check.productName ? `"${check.productName}"` : "este producto";
          const disp = check.stockDisponible ?? 0;

          if (check.motivo === "PRODUCTO_AGOTADO" || disp <= 0) {
            const ok = await confirm({
              title: "⚠️ Producto Agotado en Mostrador",
              message: `No quedan existencias físicas de ${prodName} (fueron cobradas por otro cliente o están agotadas).\n\n¿Desea remover este artículo del ticket automáticamente para continuar con el cobro?`,
              variant: "warning",
              confirmText: "Sí, Remover y Cobrar",
              cancelText: "Cerrar y Revisar Ticket",
            });
            if (ok && check.productId) {
              const updated = cartLines.filter((l) => l.productId !== check.productId);
              updateCurrentTicketLines(updated);
              showFeedback(`Removido automáticamente: ${prodName}`, "info");
              if (updated.length > 0) {
                setIsCobroOpen(true);
              }
            }
            return;
          }

          if (check.motivo === "RESERVADO_OTRA_CAJA") {
            const ok = await confirm({
              title: "⚠️ Vendido en Otra Caja",
              message: `La última unidad física de ${prodName} acaba de ser cobrada en otra caja.\n\n¿Desea remover este artículo del ticket automáticamente para continuar con el cobro?`,
              variant: "warning",
              confirmText: "Sí, Remover y Cobrar",
              cancelText: "Cerrar y Revisar Ticket",
            });
            if (ok && check.productId) {
              const updated = cartLines.filter((l) => l.productId !== check.productId);
              updateCurrentTicketLines(updated);
              showFeedback(`Removido automáticamente: ${prodName}`, "info");
              if (updated.length > 0) {
                setIsCobroOpen(true);
              }
            }
            return;
          }

          if (check.motivo === "STOCK_INSUFICIENTE") {
            const line = cartLines.find((l) => l.productId === check.productId);
            const cantPedida = line ? line.quantity : 1;
            const ok = await confirm({
              title: "⚠️ Existencias Insuficientes",
              message: `Solo quedan ${disp} unidad(es) de ${prodName} (se solicitaron ${cantPedida}).\n\n¿Desea ajustar la cantidad automáticamente a ${disp} unidad(es) y proceder al cobro?`,
              variant: "warning",
              confirmText: `Ajustar a ${disp} y Cobrar`,
              cancelText: "Revisar Ticket",
            });
            if (ok && check.productId && line) {
              const updated = cartLines.map((l) => {
                if (l.productId === check.productId) {
                  const newQty = disp;
                  const newSubtotal = Math.round(l.unitPriceCents * newQty);
                  const newTax = calculateTaxCents(newSubtotal, l.taxRateBp);
                  return {
                    ...l,
                    quantity: newQty,
                    subtotalCents: newSubtotal,
                    taxCents: newTax,
                    totalCents: newSubtotal + newTax,
                  };
                }
                return l;
              });
              updateCurrentTicketLines(updated);
              showFeedback(`Cantidad ajustada a ${disp} de ${prodName}`, "info");
              setIsCobroOpen(true);
            }
            return;
          }

          modalAlert({
            title: "Producto No Disponible",
            message: `No es posible procesar ${prodName} en este momento porque no hay existencias suficientes.`,
            variant: "warning",
          });
          return;
        }
      } catch (err) {
        console.warn("Error en verifyStock:", err);
      }
    }

    setIsCobroOpen(true);
  };

  // Cierre de modal de cobro y liberación de reservas
  const handleCloseCobro = async () => {
    setIsCobroOpen(false);
    try {
      await api.sync.releaseStock();
    } catch (err) {
      console.warn("Error liberando reserva:", err);
    }
    focusInput();
  };

  // Sincronización manual bajo demanda (catálogo y outbox)
  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      showFeedback("Sincronizando catálogo y ventas con el ERP...", "info");
      await api.sync.dispatchOutbox();
      const count = await api.sync.syncCatalog();
      const status = await api.sync.getStatus();
      setSyncStatus(status);
      showFeedback(`✅ Sincronizado: ${count} productos actualizados`, "success");
    } catch (err: unknown) {
      console.error("Error en sincronización manual:", err);
      const errMsg = err instanceof Error ? err.message : String(err);
      showFeedback(`Error al sincronizar con el ERP: ${errMsg}`, "error");
    } finally {
      setIsSyncing(false);
      focusInput();
    }
  };


  // Manejador global de atajos de teclado estilo Eleventa
  useEffect(() => {
    if (!isActive) return;
    if (isSearchOpen || isCobroOpen || isVariosOpen || isCustomerModalOpen) return;
    if (editingTicketId !== null) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignorar atajos si el foco está en un input o textarea ajeno al escáner
      const isOtherInputFocused =
        document.activeElement &&
        document.activeElement !== barcodeInputRef.current &&
        (document.activeElement.tagName === "INPUT" ||
          document.activeElement.tagName === "TEXTAREA" ||
          document.activeElement.tagName === "SELECT");
      if (isOtherInputFocused) return;

      if (e.key === "F2") {
        e.preventDefault();
        if (e.shiftKey) {
          if (currentTicket?.customer) {
            updateCurrentTicketCustomer(null);
            showFeedback("👤 Cliente desvinculado del ticket", "info");
          }
        } else {
          setIsCustomerModalOpen(true);
        }
      } else if (e.key === "F6") {
        e.preventDefault();
        handleHoldTicket();
      } else if (e.key === "F7") {
        e.preventDefault();
        onNavigateToSettings?.();
      } else if (e.key === "F11") {
        e.preventDefault();
        api.system.toggleFullscreen().catch(console.error);
      } else if (e.key === "F10") {
        e.preventDefault();
        setIsSearchOpen(true);
      } else if (e.key === "F12" || (e.code === "Space" && e.ctrlKey)) {
        e.preventDefault();
        handleOpenCobro();
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
  }, [isActive, isSearchOpen, isCobroOpen, isVariosOpen, isCustomerModalOpen, editingTicketId, cartLines, selectedLineIndex, onLockTerminal, onNavigateToSettings, barcodeInput, tickets, activeTicketId]);

  // Re-enfocar automáticamente el input si se hace clic en cualquier zona libre de la estación
  useEffect(() => {
    if (!isActive) return;
    if (isSearchOpen || isCobroOpen || isVariosOpen || editingTicketId !== null) return;

    const handleGlobalClick = (e: MouseEvent) => {
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
  }, [isActive, isSearchOpen, isCobroOpen, isVariosOpen, editingTicketId]);

  const cashierInitials = (cashier.fullName || "Cajero")
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex flex-col h-screen bg-[#f8fafc] dark:bg-slate-950 text-slate-800 dark:text-slate-100 select-none overflow-hidden font-sans transition-colors duration-150">
      {/* 1. FILA SUPERIOR: TERMINAL, ESTADO, CAJERO Y CONTROLES DE VENTANA */}
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200/80 dark:border-slate-800 px-4 py-2 flex items-center justify-between text-xs transition-colors duration-150 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-medium text-xs">Terminal:</span>
            <span className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-mono font-semibold text-xs px-2.5 py-1 rounded-md">
              {terminalStatus.cajaCodigo || "CAJA-01"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-medium text-xs">Bodega:</span>
            <span className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-mono font-semibold text-xs px-2.5 py-1 rounded-md">
              {terminalStatus.bodegaNombre || "Principal"}
            </span>
          </div>

          {/* Badge de Estado / Sincronización */}
          <div
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-semibold ${
              syncStatus && !syncStatus.isOnline
                ? "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/60 text-amber-700 dark:text-amber-400"
                : syncStatus && syncStatus.pendingCount > 0
                ? "bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-800/60 text-sky-700 dark:text-sky-400"
                : "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-400"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                syncStatus && !syncStatus.isOnline
                  ? "bg-amber-500"
                  : syncStatus && syncStatus.pendingCount > 0
                  ? "bg-sky-500"
                  : "bg-emerald-500"
              }`}
            />
            <span>
              {syncStatus && !syncStatus.isOnline
                ? "Offline"
                : syncStatus && syncStatus.pendingCount > 0
                ? `Pendiente (${syncStatus.pendingCount})`
                : "Al día"}
            </span>
            <button
              type="button"
              disabled={isSyncing}
              onClick={handleManualSync}
              className="ml-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors disabled:opacity-50 cursor-pointer"
              title="Forzar sincronización de catálogo y ventas ahora"
            >
              <span className={isSyncing ? "animate-spin inline-block text-xs" : "text-xs"}>⟳</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Avatar del Cajero con Iniciales + Nombre */}
          <div className="flex items-center gap-2 mr-1">
            <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center font-bold text-xs">
              {cashierInitials}
            </div>
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 hidden sm:inline">
              {cashier.fullName}
            </span>
          </div>

          {/* Botón Cerrar Turno */}
          {activeShift && onOpenCloseShiftModal && (
            <button
              type="button"
              onClick={onOpenCloseShiftModal}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-sm transition-colors cursor-pointer"
              title={`Turno actual: ${activeShift.folio}. Clic para realizar arqueo de caja y cierre Z-Report`}
            >
              <span>📋</span>
              <span>Cerrar Turno</span>
            </button>
          )}

          {/* Botón Bloquear Terminal */}
          <button
            onClick={onLockTerminal}
            className="w-8 h-8 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 dark:hover:bg-rose-900 border border-rose-200 dark:border-rose-800 text-rose-500 flex items-center justify-center transition-colors cursor-pointer"
            title="Bloquear Terminal de Caja"
          >
            <span>🔒</span>
          </button>

          {/* Botón Modo Claro / Oscuro */}
          <button
            type="button"
            onClick={toggleTheme}
            className="w-8 h-8 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-amber-500 flex items-center justify-center transition-colors cursor-pointer"
            title={theme === "dark" ? "Cambiar a Modo Claro" : "Cambiar a Modo Oscuro"}
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>

          {/* Botón Minimizar */}
          <button
            type="button"
            onClick={() => api.system.minimizeWindow().catch(console.error)}
            className="w-8 h-8 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-500 font-bold flex items-center justify-center transition-colors cursor-pointer"
            title="Minimizar ventana"
          >
            —
          </button>

          {/* Botón Pantalla Completa */}
          <button
            type="button"
            onClick={() => api.system.toggleFullscreen().catch(console.error)}
            className="w-8 h-8 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-500 flex items-center justify-center transition-colors cursor-pointer"
            title="Alternar Pantalla Completa (F11)"
          >
            ⛶
          </button>
        </div>
      </header>

      {/* 2. FILA DE NAVEGACIÓN DE MÓDULOS (F1 - F7) */}
      <nav className="bg-white dark:bg-slate-900 border-b border-slate-200/80 dark:border-slate-800 px-4 py-2 flex items-center justify-between shadow-xs transition-colors duration-150">
        <div className="flex items-center gap-2">
          {/* F1 Ventas (Activo) */}
          <button className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs shadow-sm transition-colors cursor-pointer">
            <span className="bg-emerald-900/60 px-1.5 py-0.5 rounded text-[10px] font-mono text-white">F1</span>
            <BagIcon />
            <span>Ventas</span>
          </button>

          {/* F3 Productos */}
          <button
            onClick={onNavigateToProducts}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-xs border border-slate-200/60 dark:border-transparent transition-colors cursor-pointer"
          >
            <span className="text-slate-400 font-mono text-[10px]">F3</span>
            <PackageIcon />
            <span>Productos</span>
          </button>

          {/* F2 Clientes */}
          <div className="hidden sm:flex items-center rounded-xl overflow-hidden border border-slate-200/60 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setIsCustomerModalOpen(true)}
              className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                currentTicket?.customer
                  ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200"
                  : "bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300"
              }`}
              title="Asignar o cambiar cliente para este ticket (F2)"
            >
              <span className="text-slate-400 font-mono text-[10px]">F2</span>
              <UsersIcon />
              <span className="truncate max-w-[120px]">
                {currentTicket?.customer ? currentTicket.customer.name : "Clientes"}
              </span>
            </button>
            {currentTicket?.customer && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  updateCurrentTicketCustomer(null);
                  showFeedback("👤 Cliente desvinculado del ticket", "info");
                }}
                className="px-2 py-2 bg-emerald-100 hover:bg-rose-500 hover:text-white text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300 dark:hover:bg-rose-600 dark:hover:text-white text-xs font-bold transition-colors cursor-pointer border-l border-emerald-200 dark:border-emerald-800"
                title="Desvincular cliente con 1 clic (Shift+F2)"
              >
                ✕
              </button>
            )}
          </div>

          {/* F4 Inventario */}
          {(hasPermission(cashier, "inventario:ajustar") || hasPermission(cashier, "inventario:ver")) && (
            <button
              onClick={onNavigateToInventory || onNavigateToProducts}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-xs border border-slate-200/60 dark:border-transparent transition-colors hidden sm:flex cursor-pointer"
              title="Control de existencias y ajustes de inventario (F4)"
            >
              <span className="text-slate-400 font-mono text-[10px]">F4</span>
              <StoreIcon />
              <span>Inventario</span>
            </button>
          )}

          {/* F7 Configuración */}
          {hasPermission(cashier, "pos:configuracion") && (
            <button
              onClick={onNavigateToSettings}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-xs border border-slate-200/60 dark:border-transparent transition-colors cursor-pointer"
              title="Configuración de periféricos y hardware (F7)"
            >
              <span className="text-slate-400 font-mono text-[10px]">F7</span>
              <SettingsIcon />
              <span>Configuración</span>
            </button>
          )}
        </div>

        {/* Indicador de Ayuda a la Derecha */}
        <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 text-slate-400 dark:text-slate-400 text-xs font-medium">
          <span>👆</span>
          <span>Teclas F1-F7 o toque directo</span>
        </div>
      </nav>

      {/* 3. BARRA DE ENTRADA Y ACCIONES RÁPIDAS (TICKETS + SCANNER + ACCIONES) */}
      <div className="bg-white dark:bg-slate-900 border-b border-slate-200/80 dark:border-slate-800 px-4 py-2.5 flex flex-wrap items-center gap-3 transition-colors duration-150">
        {/* Pestañas de Tickets (Mínimo 1 ticket siempre) */}
        <div className="flex items-center gap-1.5 mr-2">
          {tickets.map((t) => {
            const isEditing = editingTicketId === t.id;
            const isActiveTab = activeTicketId === t.id;

            return (
              <div
                key={t.id}
                className={`flex items-center rounded-lg text-xs font-bold transition-all ${
                  isActiveTab
                    ? "bg-white dark:bg-slate-800 text-slate-800 dark:text-white border border-slate-200 dark:border-slate-700 shadow-xs"
                    : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                }`}
              >
                {isEditing ? (
                  <div className="px-1.5 py-1 flex items-center">
                    <input
                      ref={editTicketInputRef}
                      type="text"
                      value={editingTicketName}
                      onChange={(e) => setEditingTicketName(e.target.value)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleSaveTicketName(t.id);
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          handleCancelRenameTicket();
                        }
                      }}
                      onBlur={() => handleSaveTicketName(t.id)}
                      autoFocus
                      onFocus={(e) => e.target.select()}
                      className="px-2 py-0.5 text-xs font-bold rounded bg-slate-50 dark:bg-slate-900 border border-emerald-500 text-slate-900 dark:text-white outline-none w-24 sm:w-28 shadow-sm"
                      maxLength={30}
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTicketId(t.id);
                      focusInput();
                    }}
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleStartRenameTicket(t);
                    }}
                    className="px-2.5 py-1.5 flex items-center gap-1.5 cursor-pointer select-none"
                    title="Doble clic para cambiar nombre"
                  >
                    {isActiveTab && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    )}
                    <span
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleStartRenameTicket(t);
                      }}
                    >
                      {t.name}
                    </span>
                    {t.customer && (
                      <span
                        className="inline-flex items-center gap-1 text-[10px] bg-emerald-100/90 hover:bg-emerald-200/90 text-emerald-900 dark:bg-emerald-950/90 dark:text-emerald-200 dark:hover:bg-emerald-900 px-1.5 py-0.5 rounded font-mono font-medium transition-colors"
                        title={`Cliente: ${t.customer.name} (Clic en ✕ para quitar)`}
                      >
                        <span className="truncate max-w-[75px]">👤 {t.customer.name.split(" ")[0]}</span>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            updateTicketCustomerById(t.id, null);
                            showFeedback(`👤 Cliente desvinculado de ${t.name}`, "info");
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              updateTicketCustomerById(t.id, null);
                              showFeedback(`👤 Cliente desvinculado de ${t.name}`, "info");
                            }
                          }}
                          className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-emerald-700 dark:text-emerald-300 hover:bg-rose-500 hover:text-white transition-colors cursor-pointer text-[9px] font-bold"
                          title="Quitar cliente de este ticket con 1 clic"
                        >
                          ✕
                        </span>
                      </span>
                    )}
                    {t.lines.length > 0 && (
                      <span className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300 px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold">
                        {t.lines.length}
                      </span>
                    )}
                  </button>
                )}

                {/* Botón de cerrar pestaña si hay más de 1 ticket */}
                {tickets.length > 1 && !isEditing && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCancelOrDeleteTicket(t.id);
                    }}
                    className="pr-2 pl-0.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 text-xs font-bold cursor-pointer"
                    title={`Cerrar y eliminar ${t.name}`}
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}
          <button
            type="button"
            onClick={handleAddTicket}
            className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-sm font-bold transition-colors cursor-pointer"
            title="Adicionar nuevo ticket"
          >
            +
          </button>
        </div>

        {/* Input Principal de Código de Barras */}
        <form onSubmit={handleBarcodeSubmit} className="flex-1 min-w-[280px] flex items-center gap-2">
          <div className="relative flex-1">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
              <BarcodeScannerIcon />
            </span>
            <input
              ref={barcodeInputRef}
              type="text"
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              placeholder="Código del producto o cantidad*código (ej. 3*75012345)..."
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 focus:border-emerald-600 dark:focus:border-emerald-500 rounded-xl pl-10 pr-36 py-2.5 text-slate-900 dark:text-white font-mono text-sm font-semibold placeholder:font-sans placeholder:text-slate-400 dark:placeholder:text-slate-500 placeholder:text-xs placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-emerald-500/20 shadow-2xs transition-colors"
              autoFocus
            />
            {barcodeInput ? (
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
            ) : (
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-200/60 dark:bg-slate-800 text-slate-400 dark:text-slate-500 text-[10px] font-mono font-bold tracking-wider uppercase border border-slate-200/80 dark:border-slate-700 pointer-events-none">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>SCANNER ACTIVO</span>
              </div>
            )}
          </div>
          <button
            type="submit"
            className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
          >
            <span>ENTER</span>
            <span className="hidden sm:inline">AGREGAR</span>
          </button>
        </form>

        {/* Botones de Acción de Entrada Rápida */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsVariosOpen(true)}
            className="px-3.5 py-2 rounded-xl bg-[#fef3c7] hover:bg-[#fde68a] dark:bg-amber-950/40 dark:hover:bg-amber-900/50 text-[#92400e] dark:text-amber-200 border border-[#fcd34d] dark:border-amber-700/60 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
            title="Vender artículo sin código (Insert)"
          >
            <span className="bg-[#fde68a] dark:bg-amber-900/60 text-[#78350f] dark:text-amber-300 border border-[#f59e0b]/30 px-1 py-0.2 rounded text-[10px] font-mono font-bold">
              INS
            </span>
            <span>Varios</span>
          </button>

          <button
            onClick={() => setIsSearchOpen(true)}
            className="px-3.5 py-2 rounded-xl bg-[#e0f2fe] hover:bg-[#bae6fd] dark:bg-sky-950/40 dark:hover:bg-sky-900/50 text-[#0369a1] dark:text-sky-200 border border-[#7dd3fc] dark:border-sky-700/60 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
            title="Buscar Producto por Nombre o SKU (F10)"
          >
            <span className="bg-[#bae6fd] dark:bg-sky-900/60 text-[#075985] dark:text-sky-300 border border-[#0ea5e9]/30 px-1 py-0.2 rounded text-[10px] font-mono font-bold">
              F10
            </span>
            <span>Buscar</span>
          </button>

          <button
            onClick={removeSelectedLine}
            disabled={selectedLineIndex < 0 || cartLines.length === 0}
            className="px-3.5 py-2 rounded-xl bg-[#ffe4e6] hover:bg-[#fecdd3] dark:bg-rose-950/40 dark:hover:bg-rose-900/50 text-[#9f1239] dark:text-rose-200 border border-[#fda4af] dark:border-rose-700/60 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs disabled:opacity-40 disabled:pointer-events-none"
            title="Eliminar producto seleccionado (Del)"
          >
            <span className="bg-[#fecdd3] dark:bg-rose-900/60 text-[#881337] dark:text-rose-300 border border-[#f43f5e]/30 px-1 py-0.2 rounded text-[10px] font-mono font-bold">
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
                  <td colSpan={7} className="py-24 text-center font-sans">
                    <div className="w-16 h-16 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 flex items-center justify-center mx-auto mb-3 text-slate-300 dark:text-slate-600 shadow-2xs">
                      <EmptyCartIcon />
                    </div>
                    <div className="text-base font-bold text-slate-800 dark:text-slate-200">
                      El ticket de venta está vacío
                    </div>
                    <div className="text-xs text-slate-400 dark:text-slate-500 mt-1.5 flex items-center justify-center gap-1.5 flex-wrap">
                      <span>Escanee un código de barras, presione</span>
                      <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-mono text-[11px] font-semibold">
                        F10
                      </kbd>
                      <span>para buscar, o</span>
                      <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-mono text-[11px] font-semibold">
                        INS
                      </kbd>
                      <span>para venta libre.</span>
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
                          (() => {
                            const enEsperaOtros = tickets
                              .filter((t) => t.id !== activeTicketId)
                              .flatMap((t) => t.lines)
                              .filter((l) => l.productId === line.productId)
                              .reduce((acc, l) => acc + l.quantity, 0);

                            return (
                              <div className="flex flex-col items-center">
                                {line.currentStock <= 0 ? (
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
                                )}
                                {enEsperaOtros > 0 && (
                                  <span
                                    className="text-[10px] font-sans font-semibold text-amber-600 dark:text-amber-400 leading-tight mt-0.5"
                                    title={`${enEsperaOtros} unidad(es) de este producto en otros tickets en espera`}
                                  >
                                    ⏳ {enEsperaOtros} en espera
                                  </span>
                                )}
                              </div>
                            );
                          })()
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

      {/* 4. FOOTER RESUMEN CON VISOR GIGANTE */}
      <footer className="bg-white dark:bg-slate-900 border-t border-slate-200/90 dark:border-slate-800 px-5 py-3.5 flex flex-col md:flex-row items-center justify-between gap-4 shadow-xs transition-colors duration-150">
        {/* Atajos Inferiores & Resumen de Piezas */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="bg-white dark:bg-slate-800/90 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center gap-4 shadow-2xs">
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider">Artículos</div>
              <div className="text-base font-black text-slate-800 dark:text-white font-mono">{totalItemsCount}</div>
            </div>
            <div className="w-px h-6 bg-slate-200 dark:bg-slate-700" />
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider">Piezas</div>
              <div className="text-base font-black text-emerald-600 dark:text-emerald-400 font-mono">{totalPieces}</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleHoldTicket}
              className="px-3.5 py-2.5 rounded-xl bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-xs border border-slate-200 dark:border-slate-700 flex items-center gap-2 transition-colors cursor-pointer shadow-2xs"
              title="Poner ticket en espera y abrir uno nuevo (F6)"
            >
              <span>⏸</span>
              <span>Pendiente</span>
            </button>
            <button
              onClick={() => handleCancelOrDeleteTicket()}
              className="px-3.5 py-2.5 rounded-xl bg-white hover:bg-rose-50 dark:bg-slate-800 dark:hover:bg-rose-950/40 text-slate-600 hover:text-rose-600 dark:text-slate-300 dark:hover:text-rose-300 font-semibold text-xs border border-slate-200 dark:border-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
              title={tickets.length > 1 ? `Eliminar ${currentTicket.name}` : `Vaciar ${currentTicket.name}`}
            >
              <span>✕</span>
              <span>Cancelar Ticket</span>
            </button>
          </div>
        </div>

        {/* VISOR GIGANTE DEL TOTAL Y BOTÓN COBRAR (F12) */}
        <div className="flex items-center gap-6 w-full md:w-auto justify-end">
          <div className="text-right">
            <div className="text-xs text-slate-400 dark:text-slate-500 font-mono">
              Subtotal: {formatCents(subtotalCents)} {taxCents > 0 && `• IVA: ${formatCents(taxCents)}`}
            </div>
            <div className="text-[10px] uppercase tracking-widest font-bold text-slate-400 dark:text-slate-500">
              TOTAL A PAGAR
            </div>
            <div className="text-4xl md:text-5xl font-black text-emerald-600 dark:text-emerald-400 font-mono tracking-tight">
              {formatCents(totalCents)}
            </div>
          </div>

          <button
            onClick={handleOpenCobro}
            disabled={cartLines.length === 0}
            className="px-8 py-3.5 rounded-2xl bg-[#6ee7b7] hover:bg-[#34d399] dark:bg-emerald-500 dark:hover:bg-emerald-600 text-white font-black text-lg uppercase tracking-wider flex items-center gap-2.5 shadow-md shadow-emerald-500/20 active:scale-98 transition-all disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
          >
            <span className="bg-white/25 dark:bg-emerald-700/60 px-2 py-0.5 rounded-lg text-xs font-mono font-bold tracking-wide">
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
        initialCustomer={currentTicket?.customer || null}
        onClose={handleCloseCobro}
        onConfirm={(payments, customerId) => handleProcessSale(payments, customerId)}
      />

      <CustomerModal
        isOpen={isCustomerModalOpen}
        currentCustomer={currentTicket?.customer || null}
        onClose={() => {
          setIsCustomerModalOpen(false);
          focusInput();
        }}
        onSelect={(selected) => {
          updateCurrentTicketCustomer(selected);
          if (selected) {
            showFeedback(`👤 Cliente asignado: ${selected.name}`, "success");
          } else {
            showFeedback("👤 Ticket asignado a Consumidor Final", "info");
          }
          focusInput();
        }}
      />
    </div>
  );
}
