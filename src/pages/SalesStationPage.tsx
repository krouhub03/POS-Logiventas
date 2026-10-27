import { useState, useEffect, useRef, useCallback } from "react";
import { Product, CashierUser, TerminalStatus, CartItemInput, PaymentInput, SyncStatus, CashShift, Customer, SaleReceipt } from "../types";
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
import { ImageLightboxModal } from "../components/ImageLightboxModal";
import { ReceiptModal } from "../components/ReceiptModal";
import { RecentSalesModal } from "../components/RecentSalesModal";
import { UserProfileSettingsModal } from "../components/UserProfileSettingsModal";
import { toAssetUrl, resolveProductImageSrc, getDefaultProductImage } from "../lib/images";

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
  unit?: string;
  currentStock?: number;
  controlsStock?: boolean;
  imageUrl?: string | null;
  imageLocalPath?: string | null;
  isService?: boolean;
  isBundle?: boolean;
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

const PhotoToggleIcon = ({ active }: { active: boolean }) => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    {!active && <line x1="2" y1="2" x2="22" y2="22" strokeWidth="2.2" />}
  </svg>
);

interface SalesStationPageProps {
  cashier: CashierUser;
  terminalStatus: TerminalStatus;
  activeShift?: CashShift | null;
  isActive?: boolean;
  onLockTerminal: () => void;
  onOpenCloseShiftModal?: () => void;
  onCloseApp?: () => void;
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
        return parsed.map((t: TicketTab) => ({
          ...t,
          lines: Array.isArray(t.lines)
            ? t.lines
                .filter((l: CartLine) => l.isService || l.currentStock === undefined || l.currentStock > 0)
                .map((l: CartLine) => {
                  if (!l.isService && l.currentStock !== undefined && l.quantity > l.currentStock) {
                    const qty = l.currentStock;
                    const subtotal = Math.round(l.unitPriceCents * qty);
                    const fixedTax = Math.round((l.taxFixedCents || 0) * qty);
                    const tax = calculateTaxCents(subtotal, l.taxRateBp) + fixedTax;
                    return {
                      ...l,
                      quantity: qty,
                      subtotalCents: subtotal,
                      taxCents: tax,
                      totalCents: subtotal + tax,
                      controlsStock: true,
                    };
                  }
                  return l;
                })
            : [],
        }));
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
  onCloseApp,
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

  // Escuchar evento de limpieza obligatoria de tickets al cerrar turno de caja
  useEffect(() => {
    const handleResetTickets = () => {
      const cleanTickets: TicketTab[] = [{ id: 1, name: "Ticket 1", lines: [] }];
      setTickets(cleanTickets);
      setActiveTicketId(1);
      localStorage.setItem(STORAGE_KEY_TICKETS, JSON.stringify(cleanTickets));
      localStorage.setItem(STORAGE_KEY_ACTIVE_TICKET, "1");
    };
    window.addEventListener("pos:reset-tickets", handleResetTickets);
    return () => window.removeEventListener("pos:reset-tickets", handleResetTickets);
  }, []);

  // Input de código de barras
  const [barcodeInput, setBarcodeInput] = useState("");
  const [selectedLineIndex, setSelectedLineIndex] = useState<number>(-1);
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const tableRowRefs = useRef<Record<number, HTMLTableRowElement | null>>({});

  // Desplazar automáticamente la fila seleccionada a la vista visible
  useEffect(() => {
    if (selectedLineIndex >= 0 && tableRowRefs.current[selectedLineIndex]) {
      tableRowRefs.current[selectedLineIndex]?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [selectedLineIndex]);

  // Edición de nombre de ticket por doble clic
  const [editingTicketId, setEditingTicketId] = useState<number | null>(null);
  const [editingTicketName, setEditingTicketName] = useState("");
  const editTicketInputRef = useRef<HTMLInputElement>(null);

  // Edición inline de cantidad por doble clic
  const [editingQtyLineId, setEditingQtyLineId] = useState<string | null>(null);
  const [editingQtyValue, setEditingQtyValue] = useState<string>("");
  const qtyInputRef = useRef<HTMLInputElement>(null);

  // Configuración de visualización de fotos de productos en el ticket (persistido)
  const [showProductImages, setShowProductImages] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem("pos_show_cart_images");
      return saved !== null ? saved === "true" : true;
    } catch {
      return true;
    }
  });

  const handleToggleShowImages = () => {
    setShowProductImages((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("pos_show_cart_images", String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  // Estado para visor maximizado de imagen (Lightbox)
  const [lightboxData, setLightboxData] = useState<{
    isOpen: boolean;
    imageSrc: string | null;
    title: string;
    subtitle?: string;
    productId?: number;
  }>({
    isOpen: false,
    imageSrc: null,
    title: "",
  });

  const handleOpenLightbox = (imageSrc: string | null, title: string, subtitle?: string, productId?: number) => {
    if (!imageSrc && !productId) return;
    setLightboxData({
      isOpen: true,
      imageSrc,
      title,
      subtitle,
      productId,
    });
  };

  // Mapa reactivo de imágenes y tipos de productos locales para asegurar visualización en cualquier ticket
  const [productImagesMap, setProductImagesMap] = useState<
    Record<
      number,
      {
        imageLocalPath?: string | null;
        imageUrl?: string | null;
        isService?: boolean;
        isBundle?: boolean;
      }
    >
  >({});

  // Mapa completo del catálogo local (incluyendo componentes de combos y existencias actualizadas)
  const [catalogProductsMap, setCatalogProductsMap] = useState<Record<number, Product>>({});

  const refreshCatalogMap = useCallback(() => {
    api.products
      .list()
      .then((allProds) => {
        const imgMap: Record<
          number,
          {
            imageLocalPath?: string | null;
            imageUrl?: string | null;
            isService?: boolean;
            isBundle?: boolean;
          }
        > = {};
        const prodMap: Record<number, Product> = {};
        for (const p of allProds) {
          prodMap[p.id] = p;
          imgMap[p.id] = {
            imageLocalPath: p.imageLocalPath,
            imageUrl: p.imageUrl,
            isService: p.isService,
            isBundle: p.isBundle,
          };
        }
        setCatalogProductsMap(prodMap);
        setProductImagesMap(imgMap);

        // Actualizar también los tickets en memoria y localStorage si les falta imageLocalPath, stock o si la cantidad supera la existencia real
        setTickets((prevTickets) => {
          let changed = false;
          const nextTickets = prevTickets.map((ticket) => {
            let ticketChanged = false;
            const nextLines: CartLine[] = [];

            for (const line of ticket.lines) {
              if (line.productId) {
                const info = imgMap[line.productId];
                const fullProd = prodMap[line.productId];
                if (fullProd && !fullProd.isService && fullProd.stock <= 0) {
                  ticketChanged = true;
                  changed = true;
                  continue;
                }

                const maxStock = fullProd && !fullProd.isService ? fullProd.stock : line.currentStock;
                const clampedQty =
                  maxStock !== undefined && !line.isService && line.quantity > maxStock
                    ? maxStock
                    : line.quantity;

                if (
                  info &&
                  (line.imageLocalPath !== info.imageLocalPath ||
                    line.imageUrl !== info.imageUrl ||
                    line.isService !== info.isService ||
                    line.isBundle !== info.isBundle ||
                    line.controlsStock !== !info.isService ||
                    (fullProd && line.currentStock !== fullProd.stock) ||
                    clampedQty !== line.quantity)
                ) {
                  ticketChanged = true;
                  changed = true;
                  const newSubtotal = Math.round(line.unitPriceCents * clampedQty);
                  const fixedTax = Math.round((line.taxFixedCents || 0) * clampedQty);
                  const newTax = calculateTaxCents(newSubtotal, line.taxRateBp) + fixedTax;
                  nextLines.push({
                    ...line,
                    quantity: clampedQty,
                    subtotalCents: newSubtotal,
                    taxCents: newTax,
                    totalCents: newSubtotal + newTax,
                    currentStock: fullProd ? fullProd.stock : line.currentStock,
                    controlsStock: !info.isService,
                    imageLocalPath: info.imageLocalPath,
                    imageUrl: info.imageUrl,
                    isService: info.isService,
                    isBundle: info.isBundle,
                  });
                  continue;
                }
              }
              nextLines.push(line);
            }
            return ticketChanged ? { ...ticket, lines: nextLines } : ticket;
          });
          return changed ? nextTickets : prevTickets;
        });
      })
      .catch(console.warn);
  }, []);

  // Hidratar o refrescar automáticamente imágenes, componentes de combos y existencias al activar vista
  useEffect(() => {
    if (!isActive) return;
    refreshCatalogMap();
  }, [isActive, refreshCatalogMap]);

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isCobroOpen, setIsCobroOpen] = useState(false);
  const [isVariosOpen, setIsVariosOpen] = useState(false);
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [isRecentSalesOpen, setIsRecentSalesOpen] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<SaleReceipt | null>(null);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [isUserProfileModalOpen, setIsUserProfileModalOpen] = useState(false);

  const handleReprintLastSale = async () => {
    try {
      const last = await api.sales.getLast();
      if (!last) {
        showFeedback("No hay ventas registradas para reimprimir", "info");
        return;
      }
      setLastReceipt(last);
      setIsReceiptModalOpen(true);
    } catch (err) {
      console.error("Error al obtener última venta:", err);
      showFeedback("Error al consultar última venta", "error");
    }
  };

  const handleManualOpenDrawer = async () => {
    try {
      await api.settings.testOpenDrawer();
      showFeedback("💵 Pulso enviado al cajón monedero", "success");
    } catch (err) {
      console.error("Error abriendo cajón monedero:", err);
      showFeedback("Error abriendo cajón monedero: " + String(err), "error");
    }
  };

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
    if (
      isActive &&
      !isSearchOpen &&
      !isCobroOpen &&
      !isVariosOpen &&
      !isCustomerModalOpen &&
      !isRecentSalesOpen &&
      !isReceiptModalOpen &&
      !isUserProfileModalOpen &&
      editingTicketId === null &&
      editingQtyLineId === null
    ) {
      barcodeInputRef.current?.focus();
    }
  }, [isActive, isSearchOpen, isCobroOpen, isVariosOpen, isCustomerModalOpen, isRecentSalesOpen, isReceiptModalOpen, isUserProfileModalOpen, editingTicketId, editingQtyLineId]);

  useEffect(() => {
    if (isActive && editingTicketId === null && editingQtyLineId === null) {
      focusInput();
    }
  }, [isActive, focusInput, activeTicketId, editingTicketId, editingQtyLineId]);

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

  // Calcula la demanda física total comprometida en las líneas del ticket (desglosando combos/kits)
  const validateSharedStockInCart = (
    product: Product,
    deltaQty: number,
    linesToEvaluate: CartLine[] = cartLines
  ): { ok: boolean; errorMsg?: string; severity?: "error" | "warning" } => {
    if (product.isService || deltaQty <= 0) {
      return { ok: true };
    }

    // Mapa de unidades físicas ya comprometidas en el ticket: childProductId -> { directQty, bundleQty }
    const committed: Record<number, { directQty: number; bundleQty: number }> = {};

    for (const line of linesToEvaluate) {
      if (!line.productId) continue;
      const lineProd = catalogProductsMap[line.productId];
      const isLineBundle = line.isBundle ?? lineProd?.isBundle ?? false;

      if (isLineBundle) {
        const comps = lineProd?.components || [];
        for (const comp of comps) {
          const prev = committed[comp.childProductId] || { directQty: 0, bundleQty: 0 };
          prev.bundleQty += comp.quantity * line.quantity;
          committed[comp.childProductId] = prev;
        }
      } else {
        const prev = committed[line.productId] || { directQty: 0, bundleQty: 0 };
        prev.directQty += line.quantity;
        committed[line.productId] = prev;
      }
    }

    // Caso A: Producto a agregar/incrementar es un Combo / Kit
    if (product.isBundle) {
      const comps = product.components || catalogProductsMap[product.id]?.components || [];
      if (comps.length === 0) {
        return {
          ok: false,
          severity: "error",
          errorMsg: `❌ COMBO INVÁLIDO: "${product.name}" no tiene insumos configurados.`,
        };
      }

      if (product.stock <= 0) {
        return {
          ok: false,
          severity: "error",
          errorMsg: `❌ SIN EXISTENCIAS DE INSUMOS: "${product.name}" no tiene combos armables disponibles (Stock: 0).`,
        };
      }

      for (const comp of comps) {
        const childProd = catalogProductsMap[comp.childProductId];
        const childStock = childProd ? childProd.stock : comp.childStock;
        const prev = committed[comp.childProductId] || { directQty: 0, bundleQty: 0 };
        const alreadyCommitted = prev.directQty + prev.bundleQty;
        const needed = comp.quantity * deltaQty;

        if (alreadyCommitted + needed > childStock + 1e-9) {
          if (prev.directQty > 0) {
            return {
              ok: false,
              severity: "warning",
              errorMsg: `⚠️ INSUMO YA AGREGADO POR UNIDAD: El combo "${product.name}" requiere ${needed} ${comp.childUnit} de "${comp.childName}", pero solo hay ${childStock} en almacén y ya tienes ${prev.directQty} agregados individualmente en el ticket.`,
            };
          }
          return {
            ok: false,
            severity: "warning",
            errorMsg: `⚠️ STOCK DE INSUMO INSUFICIENTE: El insumo "${comp.childName}" solo tiene ${childStock} ${comp.childUnit} disponibles (comprometidos en ticket: ${alreadyCommitted} ${comp.childUnit}).`,
          };
        }
      }

      return { ok: true };
    }

    // Caso B: Producto físico individual (NUNCA permitir superar el stock disponible)
    if (product.stock <= 0) {
      return {
        ok: false,
        severity: "error",
        errorMsg: `❌ SIN EXISTENCIAS: "${product.name}" no tiene unidades disponibles en inventario (Stock: 0 ${product.unit || "UND"}).`,
      };
    }

    const prev = committed[product.id] || { directQty: 0, bundleQty: 0 };
    const alreadyCommitted = prev.directQty + prev.bundleQty;

    if (alreadyCommitted + deltaQty > product.stock + 1e-9) {
      if (prev.bundleQty > 0) {
        return {
          ok: false,
          severity: "warning",
          errorMsg: `⚠️ UNIDADES YA INCLUIDAS EN COMBO/KIT: "${product.name}" tiene ${product.stock} ${product.unit || "UND"} en inventario, pero ${prev.bundleQty} ya están comprometidas dentro de un Combo en este ticket.`,
        };
      }
      return {
        ok: false,
        severity: "warning",
        errorMsg: `⚠️ STOCK INSUFICIENTE: "${product.name}" solo tiene ${product.stock} ${product.unit || "UND"} disponibles en inventario (ya tienes ${prev.directQty} en el ticket).`,
      };
    }

    return { ok: true };
  };

  // Agregar producto al ticket
  const addProductToTicket = (product: Product, quantity = 1): boolean => {
    // Asegurar que catalogProductsMap tenga la ficha más reciente del producto (y sus componentes si es combo)
    if (product.id) {
      setCatalogProductsMap((prev) => ({ ...prev, [product.id]: product }));
    }

    // Validar existencias compartidas (directas + combos) si no es servicio
    if (!product.isService) {
      const check = validateSharedStockInCart(product, quantity, cartLines);
      if (!check.ok) {
        playStockWarning();
        showFeedback(check.errorMsg || "Stock insuficiente", check.severity || "warning");
        return false;
      }
    }

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
        currentStock: product.stock,
        controlsStock: !product.isService,
        subtotalCents: newSubtotal,
        taxCents: newTax,
        totalCents: newTotal,
        imageUrl: existing.imageUrl || product.imageUrl,
        imageLocalPath: existing.imageLocalPath || product.imageLocalPath,
        isService: existing.isService ?? product.isService,
        isBundle: existing.isBundle ?? product.isBundle,
      };
      updateCurrentTicketLines(updatedLines);
      setSelectedLineIndex(existingIndex);
      return true;
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
        unit: product.unit || "UND",
        currentStock: product.stock,
        controlsStock: !product.isService,
        imageUrl: product.imageUrl,
        imageLocalPath: product.imageLocalPath,
        isService: product.isService,
        isBundle: product.isBundle,
      };
      const updated = [...cartLines, newLine];
      updateCurrentTicketLines(updated);
      setSelectedLineIndex(updated.length - 1);
      return true;
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
        if (addProductToTicket(product, quantity)) {
          playScanSuccess();
          showFeedback(`✅ + ${quantity} × ${product.name} (Servicio)`, "success");
        }
        return;
      }

      if (!addProductToTicket(product, quantity)) {
        return;
      }

      const lineEnTicket = cartLines.find((l) => l.productId === product.id);
      const yaEnTicket = lineEnTicket ? lineEnTicket.quantity : 0;
      const nuevoTotalTicket = yaEnTicket + quantity;

      const enOtrosTickets = tickets
        .filter((t) => t.id !== activeTicketId)
        .flatMap((t) => t.lines)
        .filter((l) => l.productId === product.id)
        .reduce((sum, l) => sum + l.quantity, 0);

      const stockRestante = Math.max(0, product.stock - nuevoTotalTicket);

      playScanSuccess();
      showFeedback(
        `✅ + ${quantity} × ${product.name} (Disponibles: ${stockRestante} ${product.unit}${
          enOtrosTickets > 0 ? ` • ⏳ ${enOtrosTickets} en espera` : ""
        })`,
        "success"
      );
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

  // Manejo de cantidades con teclas + y - (soporta línea activa o única línea agregada)
  const modifyQuantity = async (delta: number, lineIndex?: number) => {
    if (cartLines.length === 0) return;

    let idx = lineIndex !== undefined ? lineIndex : selectedLineIndex;
    if (idx < 0) {
      if (cartLines.length === 1) {
        idx = 0;
      } else {
        showFeedback("Seleccione un producto con ↑ / ↓ o clic para modificar su cantidad", "info");
        return;
      }
    }
    if (idx < 0 || idx >= cartLines.length) return;

    const target = cartLines[idx];
    const newQty = Math.round((target.quantity + delta) * 1000) / 1000;

    // Validación al incrementar (+): validar stock físico compartido (directo + combos) y límite duro de existencias
    if (delta > 0 && !target.isService) {
      const catalogProd = target.productId ? catalogProductsMap[target.productId] : undefined;
      if (catalogProd) {
        const check = validateSharedStockInCart(catalogProd, delta, cartLines);
        if (!check.ok) {
          playStockWarning();
          showFeedback(check.errorMsg || "Existencia máxima alcanzada", check.severity || "warning");
          return;
        }
      }
      if (target.currentStock !== undefined && newQty > target.currentStock) {
        playStockWarning();
        showFeedback(
          `⚠️ EXISTENCIA MÁXIMA ALCANZADA: "${target.description}" solo tiene ${target.currentStock} ${target.unit || "UND"} en inventario.`,
          "warning"
        );
        return;
      }
    }

    // Al decrementar (-): si llega a 0 o menor, se va a eliminar
    if (newQty <= 0) {
      const isProductOne = idx === 0 || cartLines.length === 1;

      // Alerta obligatoria para el Producto 1 cuando vaya a ser eliminado con '-'
      if (isProductOne) {
        const ok = await confirm({
          title: "Eliminar Producto #1",
          message: `¿Desea eliminar el Producto 1 ("${target.description}") del ticket de venta?`,
          variant: "warning",
          confirmText: "Sí, Eliminar Producto",
          cancelText: "Mantener en Ticket",
        });
        if (!ok) {
          focusInput();
          return;
        }
      }

      // Eliminar el producto seleccionado
      const updated = cartLines.filter((_, i) => i !== idx);
      updateCurrentTicketLines(updated);
      // Deseleccionar para no encadenar eliminaciones automáticas en otros productos
      setSelectedLineIndex(-1);
      showFeedback(`✕ ${target.description} eliminado del ticket`, "info");
      focusInput();
      return;
    }

    const updated = [...cartLines];
    const newSubtotal = Math.round(target.unitPriceCents * newQty);
    const targetTaxFixed = target.taxFixedCents || 0;
    const newTax = calculateTaxCents(newSubtotal, target.taxRateBp) + Math.round(targetTaxFixed * newQty);

    updated[idx] = {
      ...target,
      quantity: newQty,
      subtotalCents: newSubtotal,
      taxCents: newTax,
      totalCents: newSubtotal + newTax,
    };
    updateCurrentTicketLines(updated);
    setSelectedLineIndex(idx);
    showFeedback(`${target.description}: ${newQty} ${target.unit || "UND"}`);
  };

  // Iniciar edición inline de cantidad por doble clic
  const handleStartEditQty = (line: CartLine) => {
    setEditingQtyLineId(line.id);
    setEditingQtyValue(line.quantity.toString());
    setTimeout(() => {
      qtyInputRef.current?.focus();
      qtyInputRef.current?.select();
    }, 50);
  };

  // Guardar edición inline de cantidad
  const handleSaveEditQty = async (lineId: string) => {
    const parsed = parseFloat(editingQtyValue);
    if (!isNaN(parsed) && parsed > 0) {
      const idx = cartLines.findIndex((l) => l.id === lineId);
      if (idx >= 0) {
        const target = cartLines[idx];
        const delta = parsed - target.quantity;
        if (delta > 0 && !target.isService) {
          const catalogProd = target.productId ? catalogProductsMap[target.productId] : undefined;
          if (catalogProd) {
            const check = validateSharedStockInCart(catalogProd, delta, cartLines);
            if (!check.ok) {
              playStockWarning();
              showFeedback(check.errorMsg || "Stock insuficiente", check.severity || "warning");
              setEditingQtyLineId(null);
              focusInput();
              return;
            }
          }
          if (target.currentStock !== undefined && parsed > target.currentStock) {
            playStockWarning();
            showFeedback(
              `⚠️ STOCK INSUFICIENTE: "${target.description}" solo tiene ${target.currentStock} ${target.unit || "UND"} en inventario.`,
              "warning"
            );
            setEditingQtyLineId(null);
            focusInput();
            return;
          }
        }

        const updated = [...cartLines];
        const newSubtotal = Math.round(target.unitPriceCents * parsed);
        const targetTaxFixed = target.taxFixedCents || 0;
        const newTax = calculateTaxCents(newSubtotal, target.taxRateBp) + Math.round(targetTaxFixed * parsed);

        updated[idx] = {
          ...target,
          quantity: parsed,
          subtotalCents: newSubtotal,
          taxCents: newTax,
          totalCents: newSubtotal + newTax,
        };
        updateCurrentTicketLines(updated);
        setSelectedLineIndex(idx);
        showFeedback(`${target.description}: ${parsed} ${target.unit || "UND"}`);
      }
    } else if (parsed === 0) {
      const idx = cartLines.findIndex((l) => l.id === lineId);
      if (idx >= 0) {
        await modifyQuantity(-cartLines[idx].quantity, idx);
      }
    }
    setEditingQtyLineId(null);
    focusInput();
  };

  // Cancelar edición inline de cantidad
  const handleCancelEditQty = () => {
    setEditingQtyLineId(null);
    focusInput();
  };

  // Eliminar artículo seleccionado (DEL)
  const removeSelectedLine = async () => {
    if (selectedLineIndex < 0 || selectedLineIndex >= cartLines.length) return;
    const item = cartLines[selectedLineIndex];
    const isProductOne = selectedLineIndex === 0 || cartLines.length === 1;

    if (isProductOne) {
      const ok = await confirm({
        title: "Eliminar Producto #1",
        message: `¿Desea eliminar el Producto 1 ("${item.description}") del ticket de venta?`,
        variant: "warning",
        confirmText: "Sí, Eliminar Producto",
        cancelText: "Mantener en Ticket",
      });
      if (!ok) {
        focusInput();
        return;
      }
    }

    const updated = cartLines.filter((_, idx) => idx !== selectedLineIndex);
    updateCurrentTicketLines(updated);
    setSelectedLineIndex(-1);
    showFeedback(`Eliminado: ${item.description}`, "info");
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
      unit: "UND",
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
      setLastReceipt(receipt);
      showFeedback(`✅ Venta #${receipt.folio} cobrada con éxito. Cambio: ${formatCents(receipt.changeCents)}`);
      setIsCobroOpen(false);
      refreshCatalogMap();
      focusInput();

      // Impresión automática silenciosa en impresora térmica si está habilitada
      api.settings.getAll().then((sets) => {
        if (sets.printer_enabled !== "false" && sets.printer_auto_print === "true") {
          api.printers.printSaleTicket(receipt.id).catch((err) => {
            console.warn("[Auto-Print] No se pudo imprimir ticket automáticamente:", err);
          });
        }
      }).catch(() => {});

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
    if (isSearchOpen || isCobroOpen || isVariosOpen || isCustomerModalOpen || isRecentSalesOpen || isReceiptModalOpen || isUserProfileModalOpen || editingQtyLineId !== null) return;
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

      if ((e.key === "u" || e.key === "U") && e.altKey) {
        e.preventDefault();
        setIsUserProfileModalOpen(true);
      } else if ((e.key === "r" || e.key === "R") && e.altKey) {
        e.preventDefault();
        handleReprintLastSale();
      } else if (e.key === "F5") {
        e.preventDefault();
        setIsRecentSalesOpen(true);
      } else if (e.key === "F2") {
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
      } else if (e.key === "F8") {
        e.preventDefault();
        handleManualOpenDrawer();
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
      } else if (e.key === "+" || e.key === "Add" || e.code === "NumpadAdd") {
        if (document.activeElement === barcodeInputRef.current && barcodeInput.length > 0) {
          return;
        }
        e.preventDefault();
        modifyQuantity(1);
      } else if (e.key === "-" || e.key === "Subtract" || e.code === "NumpadSubtract") {
        if (document.activeElement === barcodeInputRef.current && barcodeInput.length > 0) {
          return;
        }
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
        if (cartLines.length > 0) {
          e.preventDefault();
          setSelectedLineIndex((prev) => {
            if (prev < 0) return 0;
            return Math.min(cartLines.length - 1, prev + 1);
          });
        }
      } else if (e.key === "ArrowUp") {
        if (cartLines.length > 0) {
          e.preventDefault();
          setSelectedLineIndex((prev) => {
            if (prev < 0) return cartLines.length - 1;
            return Math.max(0, prev - 1);
          });
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
  }, [isActive, isSearchOpen, isCobroOpen, isVariosOpen, isCustomerModalOpen, isRecentSalesOpen, isReceiptModalOpen, isUserProfileModalOpen, editingTicketId, editingQtyLineId, cartLines, selectedLineIndex, onLockTerminal, onNavigateToSettings, barcodeInput, tickets, activeTicketId]);

  // Re-enfocar automáticamente el input si se hace clic en cualquier zona libre de la estación
  useEffect(() => {
    if (!isActive) return;
    if (isSearchOpen || isCobroOpen || isVariosOpen || isCustomerModalOpen || isRecentSalesOpen || isReceiptModalOpen || isUserProfileModalOpen || editingTicketId !== null || editingQtyLineId !== null) return;

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
  }, [isActive, isSearchOpen, isCobroOpen, isVariosOpen, isCustomerModalOpen, isRecentSalesOpen, isReceiptModalOpen, isUserProfileModalOpen, editingTicketId, editingQtyLineId]);

  // Temporizador de auto-bloqueo de terminal por inactividad
  useEffect(() => {
    if (!isActive || !onLockTerminal) return;
    const minsStr = localStorage.getItem("pos_auto_lock_minutes");
    const mins = minsStr ? Number(minsStr) : 0;
    if (mins <= 0) return;

    let timer: ReturnType<typeof setTimeout>;

    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        onLockTerminal();
      }, mins * 60 * 1000);
    };

    resetTimer();
    window.addEventListener("mousemove", resetTimer);
    window.addEventListener("keydown", resetTimer);
    window.addEventListener("click", resetTimer);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousemove", resetTimer);
      window.removeEventListener("keydown", resetTimer);
      window.removeEventListener("click", resetTimer);
    };
  }, [isActive, onLockTerminal]);

  const cashierInitials = (cashier.fullName || "Cajero")
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#f8fafc] dark:bg-slate-950 text-slate-800 dark:text-slate-100 select-none overflow-hidden font-sans transition-colors duration-150">
      {/* 1. FILA SUPERIOR: TERMINAL, ESTADO, CAJERO Y CONTROLES DE VENTANA */}
      <header className="shrink-0 bg-white dark:bg-slate-900 border-b border-slate-200/80 dark:border-slate-800 px-3 sm:px-4 py-1.5 sm:py-2 flex items-center justify-between gap-2 text-xs transition-colors duration-150 shadow-xs overflow-x-auto custom-scrollbar">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 pr-3 border-r border-slate-200 dark:border-slate-800">
            <img src="/metahabi-icon.png" alt="Metahabi" className="w-5 h-5 object-contain" />
            <span className="font-extrabold tracking-tight text-xs text-slate-800 dark:text-white">
              METAHABI <span className="text-emerald-600 dark:text-emerald-400 font-semibold">POS</span>
            </span>
          </div>

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
          {/* Avatar del Cajero con Iniciales + Nombre (Clic abre configuración de operador Alt+U) */}
          <button
            type="button"
            onClick={() => setIsUserProfileModalOpen(true)}
            className="flex items-center gap-2 mr-1 px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700/80 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer shadow-2xs group"
            title="Mi Perfil y Preferencias de Estación (Cambiar PIN, tema, sonido) • Atajo: Alt+U"
          >
            <div className="w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400 flex items-center justify-center font-bold text-[11px] border border-emerald-300 dark:border-emerald-800">
              {cashierInitials}
            </div>
            <span className="text-xs font-bold text-slate-800 dark:text-slate-200 hidden sm:inline group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
              {cashier.fullName}
            </span>
            <span className="text-[10px] text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300">
              ⚙️
            </span>
          </button>

          {/* Botón Cerrar Turno */}
          {activeShift && onOpenCloseShiftModal && (
            <div className="flex items-center gap-1.5">
              {activeShift.userId !== cashier.id && (
                <span
                  className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30"
                  title={`Este turno fue iniciado por ${activeShift.userName || "otro operador"}. Realiza el cierre para arquear su turno.`}
                >
                  <span>⚠️</span> Turno de {activeShift.userName?.split(" ")[0] || "Operador"}
                </span>
              )}
              <button
                type="button"
                onClick={onOpenCloseShiftModal}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-sm transition-colors cursor-pointer"
                title={`Turno actual: ${activeShift.folio}. Clic para realizar arqueo de caja y cierre Z-Report`}
              >
                <span>📋</span>
                <span>Cerrar Turno</span>
              </button>
            </div>
          )}

          {/* Botón Bloquear Terminal */}
          <button
            onClick={onLockTerminal}
            className="w-8 h-8 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 dark:hover:bg-rose-900 border border-rose-200 dark:border-rose-800 text-rose-500 flex items-center justify-center transition-colors cursor-pointer"
            title="Bloquear Terminal de Caja"
          >
            <span>🔒</span>
          </button>

          {/* Botón Apagar / Salir del POS */}
          {onCloseApp && (
            <button
              type="button"
              onClick={onCloseApp}
              className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-rose-100 dark:bg-slate-800 dark:hover:bg-rose-950/60 border border-slate-200 dark:border-slate-700 hover:border-rose-300 dark:hover:border-rose-800 text-slate-500 hover:text-rose-500 flex items-center justify-center transition-colors cursor-pointer"
              title="Apagar o Salir del POS"
            >
              <span>⏻</span>
            </button>
          )}

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
      <nav className="shrink-0 bg-white dark:bg-slate-900 border-b border-slate-200/80 dark:border-slate-800 px-3 sm:px-4 py-1.5 sm:py-2 flex items-center justify-between gap-2 shadow-xs transition-colors duration-150 overflow-x-auto custom-scrollbar">
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* F1 Ventas (Activo) */}
          <button className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs shadow-sm transition-colors cursor-pointer">
            <span className="bg-emerald-900/60 px-1.5 py-0.5 rounded text-[10px] font-mono text-white">F1</span>
            <BagIcon />
            <span className="hidden sm:inline">Ventas</span>
          </button>

          {/* F3 Productos */}
          <button
            onClick={onNavigateToProducts}
            className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-xs border border-slate-200/60 dark:border-transparent transition-colors cursor-pointer"
          >
            <span className="text-slate-400 font-mono text-[10px]">F3</span>
            <PackageIcon />
            <span className="hidden md:inline">Productos</span>
          </button>

          {/* F2 Clientes */}
          <div className="hidden sm:flex items-center rounded-xl overflow-hidden border border-slate-200/60 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setIsCustomerModalOpen(true)}
              className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs font-semibold transition-colors cursor-pointer ${
                currentTicket?.customer
                  ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200"
                  : "bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300"
              }`}
              title="Asignar o cambiar cliente para este ticket (F2)"
            >
              <span className="text-slate-400 font-mono text-[10px]">F2</span>
              <UsersIcon />
              <span className="truncate max-w-[90px] lg:max-w-[120px] hidden md:inline">
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
                className="px-2 py-1.5 sm:py-2 bg-emerald-100 hover:bg-rose-500 hover:text-white text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300 dark:hover:bg-rose-600 dark:hover:text-white text-xs font-bold transition-colors cursor-pointer border-l border-emerald-200 dark:border-emerald-800"
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
              className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-xs border border-slate-200/60 dark:border-transparent transition-colors hidden sm:flex cursor-pointer"
              title="Control de existencias y ajustes de inventario (F4)"
            >
              <span className="text-slate-400 font-mono text-[10px]">F4</span>
              <StoreIcon />
              <span className="hidden lg:inline">Inventario</span>
            </button>
          )}

          {/* F5 Historial & Devoluciones */}
          <button
            type="button"
            onClick={() => setIsRecentSalesOpen(true)}
            className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-xs border border-slate-200/60 dark:border-transparent transition-colors cursor-pointer"
            title="Consultar historial de ventas y procesar devoluciones (F5)"
          >
            <span className="text-slate-400 font-mono text-[10px]">F5</span>
            <span>🕒</span>
            <span className="hidden md:inline">Historial</span>
          </button>

          {/* F7 Configuración */}
          {hasPermission(cashier, "pos:configuracion") && (
            <button
              onClick={onNavigateToSettings}
              className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-xs border border-slate-200/60 dark:border-transparent transition-colors cursor-pointer"
              title="Configuración de periféricos y hardware (F7)"
            >
              <span className="text-slate-400 font-mono text-[10px]">F7</span>
              <SettingsIcon />
              <span className="hidden lg:inline">Configuración</span>
            </button>
          )}
        </div>

        {/* Acciones de Impresión y Ayuda a la Derecha */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={handleManualOpenDrawer}
            className="flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 hover:bg-amber-100 dark:hover:bg-amber-900 text-amber-800 dark:text-amber-300 text-xs font-bold transition-colors cursor-pointer shadow-2xs"
            title="Abrir cajón monedero manualmente vía pulso de la impresora (F8)"
          >
            <span>💵</span>
            <span className="hidden xl:inline">Abrir Cajón</span>
            <span className="text-[10px] bg-amber-200/70 dark:bg-amber-900 px-1 py-0.2 rounded font-mono">F8</span>
          </button>

          <button
            type="button"
            onClick={handleReprintLastSale}
            className="flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 dark:hover:bg-emerald-900 text-emerald-800 dark:text-emerald-300 text-xs font-bold transition-colors cursor-pointer shadow-2xs"
            title="Reimprimir el último ticket cobrado (Alt+R)"
          >
            <span>🖨️</span>
            <span className="hidden xl:inline">Último Ticket</span>
            <span className="text-[10px] bg-emerald-200/70 dark:bg-emerald-900 px-1 py-0.2 rounded font-mono">Alt+R</span>
          </button>
        </div>
      </nav>

      {/* 3. BARRA DE ENTRADA Y ACCIONES RÁPIDAS (TICKETS + SCANNER + ACCIONES) */}
      <div className="shrink-0 bg-white dark:bg-slate-900 border-b border-slate-200/80 dark:border-slate-800 px-3 sm:px-4 py-2 flex flex-wrap items-center gap-2 sm:gap-3 transition-colors duration-150">
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
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              onKeyDown={(e) => {
                // Atajo directo + y - cuando el input está vacío
                if (!barcodeInput && cartLines.length > 0) {
                  if (e.key === "+" || e.key === "Add" || e.code === "NumpadAdd") {
                    e.preventDefault();
                    modifyQuantity(1);
                    return;
                  }
                  if (e.key === "-" || e.key === "Subtract" || e.code === "NumpadSubtract") {
                    e.preventDefault();
                    modifyQuantity(-1);
                    return;
                  }
                }
              }}
              placeholder="Código del producto o cantidad*código (ej. 3*75012345)..."
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 focus:border-emerald-600 dark:focus:border-emerald-500 rounded-xl pl-10 pr-10 py-2.5 text-slate-900 dark:text-white font-mono text-sm font-semibold placeholder:font-sans placeholder:text-slate-400 dark:placeholder:text-slate-500 placeholder:text-xs placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-emerald-500/20 shadow-2xs transition-colors"
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
            className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
          >
            <span>ENTER</span>
            <span className="hidden sm:inline">AGREGAR</span>
          </button>
        </form>

        {/* Botones de Acción de Entrada Rápida */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            onClick={() => setIsVariosOpen(true)}
            className="px-2.5 sm:px-3.5 py-2 rounded-xl bg-[#fef3c7] hover:bg-[#fde68a] dark:bg-amber-950/40 dark:hover:bg-amber-900/50 text-[#92400e] dark:text-amber-200 border border-[#fcd34d] dark:border-amber-700/60 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
            title="Vender artículo sin código (Insert)"
          >
            <span className="bg-[#fde68a] dark:bg-amber-900/60 text-[#78350f] dark:text-amber-300 border border-[#f59e0b]/30 px-1 py-0.2 rounded text-[10px] font-mono font-bold">
              INS
            </span>
            <span className="hidden sm:inline">Varios</span>
          </button>

          <button
            onClick={() => setIsSearchOpen(true)}
            className="px-2.5 sm:px-3.5 py-2 rounded-xl bg-[#e0f2fe] hover:bg-[#bae6fd] dark:bg-sky-950/40 dark:hover:bg-sky-900/50 text-[#0369a1] dark:text-sky-200 border border-[#7dd3fc] dark:border-sky-700/60 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
            title="Buscar Producto por Nombre o SKU (F10)"
          >
            <span className="bg-[#bae6fd] dark:bg-sky-900/60 text-[#075985] dark:text-sky-300 border border-[#0ea5e9]/30 px-1 py-0.2 rounded text-[10px] font-mono font-bold">
              F10
            </span>
            <span className="hidden sm:inline">Buscar</span>
          </button>

          <button
            onClick={removeSelectedLine}
            disabled={selectedLineIndex < 0 || cartLines.length === 0}
            className="px-2.5 sm:px-3.5 py-2 rounded-xl bg-[#ffe4e6] hover:bg-[#fecdd3] dark:bg-rose-950/40 dark:hover:bg-rose-900/50 text-[#9f1239] dark:text-rose-200 border border-[#fda4af] dark:border-rose-700/60 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs disabled:opacity-40 disabled:pointer-events-none"
            title="Eliminar producto seleccionado (Del)"
          >
            <span className="bg-[#fecdd3] dark:bg-rose-900/60 text-[#881337] dark:text-rose-300 border border-[#f43f5e]/30 px-1 py-0.2 rounded text-[10px] font-mono font-bold">
              DEL
            </span>
            <span className="hidden sm:inline">Borrar</span>
          </button>

          <button
            type="button"
            onClick={handleToggleShowImages}
            className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors cursor-pointer shadow-2xs border ${
              showProductImages
                ? "bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800/60"
                : "bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/70 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700"
            }`}
            title={showProductImages ? "Ocultar fotos de productos en el ticket" : "Mostrar fotos de productos en el ticket"}
          >
            <PhotoToggleIcon active={showProductImages} />
          </button>
        </div>
      </div>

      {/* FEEDBACK TOAST MULTI-COLOR CON SONIDO */}
      {feedback && (
        <div
          className={`shrink-0 px-4 py-1.5 text-xs font-semibold flex items-center justify-between border-b animate-in fade-in slide-in-from-top-1 transition-colors ${
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
      <main className="flex-1 min-h-0 p-2 sm:p-3 flex flex-col overflow-hidden">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm flex-1 min-h-0 overflow-auto transition-colors duration-150">
          <table className="w-full text-left border-collapse">
            <thead className="border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase tracking-wider text-slate-600 dark:text-slate-400 font-bold sticky top-0 bg-slate-100 dark:bg-slate-900 z-10">
              <tr>
                <th className="py-2 px-2.5 w-10 text-center">#</th>
                {showProductImages && (
                  <th className="py-2 px-1 w-14 sm:w-16 xl:w-20 text-center">Foto</th>
                )}
                <th className="py-2 px-2.5 w-28 sm:w-36 hidden md:table-cell">Código</th>
                <th className="py-2 px-2.5">Descripción del Producto</th>
                <th className="py-2 px-2.5 w-24 sm:w-28 text-right">Precio</th>
                <th className="py-2 px-2.5 w-20 text-center hidden xl:table-cell">IVA</th>
                <th className="py-2 px-2.5 w-24 sm:w-28 text-center">Cantidad</th>
                <th className="py-2 px-2.5 w-28 sm:w-32 text-right">Importe</th>
                <th className="py-2 px-2.5 w-20 text-center hidden lg:table-cell">Existencia</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono text-xs">
              {cartLines.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-10 sm:py-16 xl:py-24 text-center font-sans">
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
                      ref={(el) => {
                        tableRowRefs.current[index] = el;
                      }}
                      onClick={() => setSelectedLineIndex(index)}
                      className={`cursor-pointer transition-colors align-middle ${
                        isSelected
                          ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-950 dark:text-emerald-200 border-l-4 border-l-emerald-600 dark:border-l-emerald-500"
                          : "hover:bg-slate-50 dark:hover:bg-slate-800/40 text-slate-800 dark:text-slate-200"
                      }`}
                    >
                      <td className="py-2 px-2.5 text-center text-slate-400 dark:text-slate-500 font-sans text-xs align-middle">
                        {index + 1}
                      </td>
                      {showProductImages && (() => {
                        const isBundle =
                          line.isBundle ||
                          (line.productId ? productImagesMap[line.productId]?.isBundle : false);
                        const isService =
                          line.isService ||
                          (line.productId ? productImagesMap[line.productId]?.isService : false);
                        const kind = isBundle ? "bundle" : isService ? "service" : "product";

                        const localPath =
                          line.imageLocalPath ||
                          (line.productId ? productImagesMap[line.productId]?.imageLocalPath : null);
                        const remoteUrl =
                          line.imageUrl ||
                          (line.productId ? productImagesMap[line.productId]?.imageUrl : null);

                        const customSrc = toAssetUrl(localPath) || remoteUrl || null;
                        const imgSrc = resolveProductImageSrc(localPath, remoteUrl, kind);

                        return (
                          <td className="py-1.5 px-1.5 text-center align-middle" onClick={(e) => e.stopPropagation()}>
                            <img
                              src={imgSrc}
                              alt={line.description}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                handleOpenLightbox(
                                  imgSrc,
                                  line.description,
                                  `Código: ${line.barcode} • Precio: ${formatCents(line.unitPriceCents)}`,
                                  line.productId
                                );
                              }}
                              title="Doble clic para maximizar imagen"
                              className="w-10 h-10 sm:w-12 sm:h-12 xl:w-16 xl:h-16 object-cover rounded-xl border border-slate-200 dark:border-slate-700 mx-auto shadow-xs bg-white dark:bg-slate-900 cursor-zoom-in hover:scale-105 transition-transform"
                              onError={async (e) => {
                                // Fallback automático por Base64 desde el backend si el WebView no resuelve la URL personalizada
                                if (line.productId && customSrc) {
                                  try {
                                    const b64 = await api.products.getImageBase64(line.productId);
                                    if (b64) {
                                      (e.currentTarget as HTMLImageElement).src = b64;
                                      return;
                                    }
                                  } catch (err) {
                                    console.warn("[SalesStationPage] Error fallback Base64:", err);
                                  }
                                }
                                (e.currentTarget as HTMLImageElement).src = getDefaultProductImage(kind);
                              }}
                            />
                          </td>
                        );
                      })()}
                      <td className="py-2 px-2.5 font-semibold text-slate-700 dark:text-slate-300 align-middle hidden md:table-cell">
                        {line.barcode}
                      </td>
                      <td className="py-2 px-2.5 font-sans font-medium text-slate-900 dark:text-white align-middle">
                        <div className="font-semibold text-xs sm:text-sm leading-snug">{line.description}</div>
                        <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                          {/* Micro código de barras en pantallas pequeñas */}
                          <span className="text-[10px] text-slate-400 font-mono md:hidden">
                            {line.barcode}
                          </span>
                          {/* Micro IVA en pantallas menores a XL */}
                          {line.taxRateBp > 0 && (
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono xl:hidden bg-slate-100 dark:bg-slate-800 px-1 py-0.2 rounded">
                              IVA {Number((line.taxRateBp / 100).toFixed(0))}%
                            </span>
                          )}
                          {/* Micro Stock en pantallas menores a LG */}
                          {line.currentStock !== undefined && (
                            <span
                              className={`text-[10px] font-mono lg:hidden px-1 py-0.2 rounded font-semibold ${
                                line.currentStock <= 0
                                  ? "bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300"
                                  : line.currentStock <= 5
                                  ? "bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300"
                                  : "text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50"
                              }`}
                            >
                              Stock: {line.currentStock}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-2.5 text-right font-semibold text-slate-700 dark:text-slate-300 align-middle">
                        {formatCents(line.unitPriceCents)}
                      </td>
                      <td className="py-2 px-2.5 text-center align-middle hidden xl:table-cell">
                        {line.taxRateBp > 0 || (line.taxFixedCents && line.taxFixedCents > 0) ? (
                          <div className="flex flex-col items-center leading-tight">
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 font-mono">
                              {line.taxRateBp > 0
                                ? `${Number((line.taxRateBp / 100).toFixed(2))}%`
                                : "Fijo"}
                            </span>
                            {line.taxCents > 0 && (
                              <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                                {formatCents(line.taxCents)}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400 dark:text-slate-500 font-mono">
                            0%
                          </span>
                        )}
                      </td>
                      <td
                        className="py-2 px-2.5 text-center align-middle"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          handleStartEditQty(line);
                        }}
                      >
                        {editingQtyLineId === line.id ? (
                          <div className="flex items-center justify-center gap-1">
                            <input
                              ref={qtyInputRef}
                              type="number"
                              step="any"
                              min="0.001"
                              value={editingQtyValue}
                              onChange={(e) => setEditingQtyValue(e.target.value)}
                              onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  handleSaveEditQty(line.id);
                                } else if (e.key === "Escape") {
                                  e.preventDefault();
                                  handleCancelEditQty();
                                }
                              }}
                              onBlur={() => handleSaveEditQty(line.id)}
                              className="w-16 px-1.5 py-0.5 text-center font-bold font-mono text-xs rounded bg-white dark:bg-slate-900 border-2 border-emerald-500 text-slate-900 dark:text-white outline-none shadow-sm"
                            />
                            <span className="text-[10px] text-slate-400 font-bold uppercase">
                              {line.unit || "UND"}
                            </span>
                          </div>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-950 dark:hover:bg-slate-900 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-800 font-bold text-emerald-700 dark:text-emerald-400 transition-colors select-none cursor-pointer shadow-2xs"
                            title="Doble clic para cambiar cantidad"
                          >
                            <span>{line.quantity}</span>
                            <span className="text-[9px] text-slate-500 dark:text-slate-400 font-sans font-semibold uppercase px-1 py-0.2 rounded bg-white/70 dark:bg-slate-800/80 border border-slate-200/60 dark:border-slate-700">
                              {line.unit || "UND"}
                            </span>
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-2.5 text-right font-bold text-emerald-700 dark:text-emerald-400 text-sm align-middle">
                        {formatCents(line.totalCents)}
                      </td>
                      <td className="py-2 px-2.5 text-center align-middle hidden lg:table-cell">
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
      <footer className="shrink-0 bg-white dark:bg-slate-900 border-t border-slate-200/90 dark:border-slate-800 px-3 sm:px-5 py-2 sm:py-2.5 flex flex-wrap items-center justify-between gap-2 sm:gap-4 shadow-xs transition-colors duration-150">
        {/* Atajos Inferiores & Resumen de Piezas */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="bg-white dark:bg-slate-800/90 px-3 sm:px-3.5 py-1 sm:py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center gap-3 sm:gap-4 shadow-2xs">
            <div>
              <div className="text-[9px] sm:text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider leading-tight">Artículos</div>
              <div className="text-sm sm:text-base font-black text-slate-800 dark:text-white font-mono leading-tight">{totalItemsCount}</div>
            </div>
            <div className="w-px h-5 sm:h-6 bg-slate-200 dark:bg-slate-700" />
            <div>
              <div className="text-[9px] sm:text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider leading-tight">Piezas</div>
              <div className="text-sm sm:text-base font-black text-emerald-600 dark:text-emerald-400 font-mono leading-tight">{totalPieces}</div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              onClick={handleHoldTicket}
              className="px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-xl bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-xs border border-slate-200 dark:border-slate-700 flex items-center gap-1.5 sm:gap-2 transition-colors cursor-pointer shadow-2xs"
              title="Poner ticket en espera y abrir uno nuevo (F6)"
            >
              <span>⏸</span>
              <span className="hidden sm:inline">Pendiente</span>
            </button>
            <button
              onClick={() => handleCancelOrDeleteTicket()}
              className="px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-xl bg-white hover:bg-rose-50 dark:bg-slate-800 dark:hover:bg-rose-950/40 text-slate-600 hover:text-rose-600 dark:text-slate-300 dark:hover:text-rose-300 font-semibold text-xs border border-slate-200 dark:border-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
              title={tickets.length > 1 ? `Eliminar ${currentTicket.name}` : `Vaciar ${currentTicket.name}`}
            >
              <span>✕</span>
              <span className="hidden sm:inline">Cancelar Ticket</span>
            </button>
          </div>
        </div>

        {/* VISOR GIGANTE DEL TOTAL Y BOTÓN COBRAR (F12) */}
        <div className="flex items-center gap-3 sm:gap-5 ml-auto shrink-0">
          <div className="text-right">
            <div className="text-[10px] sm:text-xs text-slate-400 dark:text-slate-500 font-mono leading-tight">
              Subtotal: {formatCents(subtotalCents)} {taxCents > 0 && `• IVA: ${formatCents(taxCents)}`}
            </div>
            <div className="text-[9px] sm:text-[10px] uppercase tracking-widest font-bold text-slate-400 dark:text-slate-500 leading-tight">
              TOTAL A PAGAR
            </div>
            <div className="text-2xl sm:text-3xl xl:text-4xl font-black text-emerald-600 dark:text-emerald-400 font-mono tracking-tight leading-none mt-0.5">
              {formatCents(totalCents)}
            </div>
          </div>

          <button
            onClick={handleOpenCobro}
            disabled={cartLines.length === 0}
            className="px-4 sm:px-7 py-2 sm:py-3 rounded-2xl bg-[#6ee7b7] hover:bg-[#34d399] dark:bg-emerald-500 dark:hover:bg-emerald-600 text-white font-black text-sm sm:text-base uppercase tracking-wider flex items-center gap-2 shadow-md shadow-emerald-500/20 active:scale-98 transition-all disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
          >
            <span className="bg-white/25 dark:bg-emerald-700/60 px-1.5 sm:px-2 py-0.5 rounded-lg text-xs font-mono font-bold tracking-wide">
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
          if (!p.isService && p.stock <= 0) {
            playStockWarning();
            showFeedback(
              `❌ SIN EXISTENCIAS: "${p.name}" no tiene unidades disponibles en inventario (Stock: 0 ${p.unit || "UND"}).`,
              "error"
            );
            return;
          }
          const added = addProductToTicket(p, 1);
          if (added) {
            setIsSearchOpen(false);
            focusInput();
          }
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
        currentUserId={cashier.id}
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

      {/* Visor de Imagen Ampliada (Lightbox) */}
      <ImageLightboxModal
        isOpen={lightboxData.isOpen}
        onClose={() => setLightboxData((prev) => ({ ...prev, isOpen: false }))}
        imageSrc={lightboxData.imageSrc}
        title={lightboxData.title}
        subtitle={lightboxData.subtitle}
        productId={lightboxData.productId}
      />

      {/* Visor de Tirilla Térmica y Reimpresión Oficial */}
      <ReceiptModal
        receipt={lastReceipt}
        isOpen={isReceiptModalOpen}
        onClose={() => {
          setIsReceiptModalOpen(false);
          focusInput();
        }}
        onRequestReturn={() => {
          setIsReceiptModalOpen(false);
          setIsRecentSalesOpen(true);
        }}
        businessName={terminalStatus.empresaNombre || "LOGIVENTA POS"}
        businessNit={terminalStatus.empresaNit || undefined}
        businessAddress={terminalStatus.empresaDireccion || undefined}
        businessPhone={terminalStatus.empresaTelefono || undefined}
        businessCity={terminalStatus.empresaCiudad || undefined}
        businessRegimen={terminalStatus.empresaRegimen || undefined}
        businessLogo={terminalStatus.empresaLogoBase64 || undefined}
        terminalCode={terminalStatus.cajaCodigo || "CAJA-01"}
      />

      {/* Historial de Ventas, Buscador y Emisión de Devoluciones */}
      <RecentSalesModal
        isOpen={isRecentSalesOpen}
        currentUserId={cashier.id}
        terminalCode={terminalStatus.cajaCodigo || "CAJA-01"}
        businessName={terminalStatus.empresaNombre || "LOGIVENTA POS"}
        businessNit={terminalStatus.empresaNit || undefined}
        businessAddress={terminalStatus.empresaDireccion || undefined}
        businessPhone={terminalStatus.empresaTelefono || undefined}
        businessCity={terminalStatus.empresaCiudad || undefined}
        businessRegimen={terminalStatus.empresaRegimen || undefined}
        businessLogo={terminalStatus.empresaLogoBase64 || undefined}
        onClose={() => {
          setIsRecentSalesOpen(false);
          focusInput();
        }}
        onSaleReturned={(ret) => {
          refreshCatalogMap();
          showFeedback(
            `✅ Devolución #${ret.folio} emitida exitosamente. Reembolso: ${formatCents(ret.totalCents)}`,
            "success"
          );
        }}
      />

      {/* Modal de Configuración de Operador / Perfil / Preferencias de Estación (Alt+U) */}
      <UserProfileSettingsModal
        isOpen={isUserProfileModalOpen}
        onClose={() => {
          setIsUserProfileModalOpen(false);
          focusInput();
        }}
        activeCashier={cashier}
        onLockTerminal={onLockTerminal}
        onNavigateToSettings={onNavigateToSettings}
        showProductImages={showProductImages}
        onToggleProductImages={handleToggleShowImages}
        onPinChanged={() => {
          showFeedback("PIN de seguridad actualizado correctamente", "success");
        }}
      />
    </div>
  );
}
