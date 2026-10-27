import { useState, useEffect, useRef, useMemo } from "react";
import { api } from "../services/api";
import { formatCents } from "../lib/money";
import type { CashShift, ShiftPaymentBreakdown, ShiftSummary } from "../types";

interface CloseShiftModalProps {
  onShiftClosed: (shift: CashShift) => void;
  onCancel: () => void;
}

// Íconos vectoriales de alta precisión para medios de pago en la auditoría de caja
function CreditFiadoIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="3" />
      <path d="M2 10h20" />
      <path d="m14 14 2 2 4-4" />
    </svg>
  );
}

function ContactlessCardIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="12" r="2.5" fill="currentColor" />
      <path d="M12.5 8.5a5 5 0 0 1 0 7" />
      <path d="M16 6a8.5 8.5 0 0 1 0 12" />
    </svg>
  );
}

function QrScanIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <rect x="7" y="7" width="3" height="3" />
      <rect x="14" y="7" width="3" height="3" />
      <rect x="7" y="14" width="3" height="3" />
      <path d="M14 14h3v3h-3z" />
    </svg>
  );
}

function BankIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 9 9-7 9 7v1H3z" />
      <path d="M5 10v7" />
      <path d="M10 10v7" />
      <path d="M14 10v7" />
      <path d="M19 10v7" />
      <path d="M2 21h20v-2H2z" />
    </svg>
  );
}

function GenericDigitalIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}

interface PaymentTheme {
  icon: React.ReactNode;
  iconBoxClass: string;
  displayTitle: string;
  subtitle: string;
  voucherText: (count: number) => string;
  badgeStyle: string;
  note: string;
}

function getPaymentTheme(method: ShiftPaymentBreakdown): PaymentTheme {
  const code = method.code.toLowerCase();
  const type = method.paymentType.toUpperCase();

  if (
    type === "CREDITO" ||
    code.includes("credit") ||
    code.includes("credito") ||
    code.includes("fiado") ||
    code.includes("cartera")
  ) {
    return {
      icon: <CreditFiadoIcon className="w-5 h-5 text-amber-600 dark:text-amber-400" />,
      iconBoxClass: "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-500/30 text-amber-600 dark:text-amber-400",
      displayTitle: method.name || "Crédito / Fiado",
      subtitle: "Cartera clientes",
      voucherText: (count) => (count === 1 ? "1 venta / pagaré" : `${count} ventas / pagarés`),
      badgeStyle: "bg-amber-50/90 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-600/40 text-amber-800 dark:text-amber-300",
      note: "Cartera • Pendiente por cobrar a clientes",
    };
  }

  if (
    type === "TARJETA" ||
    code.includes("card") ||
    code.includes("tarjeta") ||
    code.includes("bold") ||
    code.includes("datafono")
  ) {
    return {
      icon: <ContactlessCardIcon className="w-5 h-5 text-sky-600 dark:text-sky-400" />,
      iconBoxClass: "bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-500/30 text-sky-600 dark:text-sky-400",
      displayTitle: method.name.toLowerCase().includes("datafono") ? method.name : "Tarjetas / Datáfono",
      subtitle: "Débito y Crédito",
      voucherText: (count) => (count === 1 ? "1 voucher" : `${count} vouchers`),
      badgeStyle: "bg-sky-50/90 dark:bg-sky-950/60 border border-sky-300 dark:border-sky-600/40 text-sky-800 dark:text-sky-300",
      note: "Verificar comprobantes impresos de datáfono en caja",
    };
  }

  if (
    code.includes("nequi") ||
    code.includes("daviplata") ||
    code.includes("qr") ||
    code.includes("movil") ||
    code.includes("dale")
  ) {
    return {
      icon: <QrScanIcon className="w-5 h-5 text-purple-600 dark:text-purple-400" />,
      iconBoxClass: "bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-500/30 text-purple-600 dark:text-purple-400",
      displayTitle: method.name.toLowerCase().includes("nequi") || method.name.toLowerCase().includes("qr") ? method.name : "Nequi / Daviplata / QR",
      subtitle: "Bancolombia & Apps",
      voucherText: (count) => (count === 1 ? "1 pago" : `${count} pagos`),
      badgeStyle: "bg-purple-50/90 dark:bg-purple-950/60 border border-purple-300 dark:border-purple-600/40 text-purple-800 dark:text-purple-300",
      note: "Transferencias confirmadas en app o comprobante digital",
    };
  }

  if (
    type === "TRANSFERENCIA" ||
    type === "BANCO" ||
    code.includes("transfer") ||
    code.includes("banco") ||
    code.includes("bancolombia")
  ) {
    return {
      icon: <BankIcon className="w-5 h-5 text-teal-600 dark:text-teal-400" />,
      iconBoxClass: "bg-teal-50 dark:bg-teal-950/40 border-teal-200 dark:border-teal-500/30 text-teal-600 dark:text-teal-400",
      displayTitle: method.name || "Transferencia Bancaria",
      subtitle: "Cuentas bancarias",
      voucherText: (count) => (count === 1 ? "1 transferencia" : `${count} transferencias`),
      badgeStyle: "bg-teal-50/90 dark:bg-teal-950/60 border border-teal-300 dark:border-teal-600/40 text-teal-800 dark:text-teal-300",
      note: "Comprobante electrónico verificado en cuenta",
    };
  }

  return {
    icon: <GenericDigitalIcon className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />,
    iconBoxClass: "bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-500/30 text-indigo-600 dark:text-indigo-400",
    displayTitle: method.name || "Otro Medio Digital",
    subtitle: "Medio digital",
    voucherText: (count) => (count === 1 ? "1 operación" : `${count} operaciones`),
    badgeStyle: "bg-indigo-50/90 dark:bg-indigo-950/60 border border-indigo-300 dark:border-indigo-600/40 text-indigo-800 dark:text-indigo-300",
    note: "Registrado digitalmente en el sistema",
  };
}

export function CloseShiftModal({ onShiftClosed, onCancel }: CloseShiftModalProps) {
  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [declaredPesos, setDeclaredPesos] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [printReceipt, setPrintReceipt] = useState<boolean>(true);
  const [loading, setLoading] = useState(false);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Detección y purga de tickets abiertos con productos
  const [pendingTicketsCount, setPendingTicketsCount] = useState<number>(0);
  const [pendingItemsCount, setPendingItemsCount] = useState<number>(0);
  const [ticketsPurged, setTicketsPurged] = useState<boolean>(false);

  const inputRef = useRef<HTMLInputElement>(null);

  const checkPendingTickets = () => {
    try {
      const raw = localStorage.getItem("pos_active_tickets");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const withItems = parsed.filter(
            (t) => (t.lines && t.lines.length > 0) || t.discountCents || t.customer
          );
          setPendingTicketsCount(withItems.length);
          const totalItems = withItems.reduce(
            (acc, t) => acc + (t.lines?.length || 0),
            0
          );
          setPendingItemsCount(totalItems);
          return withItems.length;
        }
      }
    } catch {}
    setPendingTicketsCount(0);
    setPendingItemsCount(0);
    return 0;
  };

  const handlePurgeTickets = () => {
    try {
      const emptyTickets = [{ id: 1, name: "Ticket 1", lines: [] }];
      localStorage.setItem("pos_active_tickets", JSON.stringify(emptyTickets));
      localStorage.setItem("pos_active_ticket_id", "1");
      window.dispatchEvent(new CustomEvent("pos:reset-tickets"));
      setPendingTicketsCount(0);
      setPendingItemsCount(0);
      setTicketsPurged(true);
    } catch (e) {
      console.error("Error al purgar tickets:", e);
    }
  };

  useEffect(() => {
    checkPendingTickets();

    api.shifts
      .getShiftSummary()
      .then((data) => {
        setSummary(data);
        setLoadingSummary(false);
        // Focus en el campo de conteo físico
        setTimeout(() => inputRef.current?.focus(), 150);
      })
      .catch((err) => {
        setError("Error al cargar resumen del turno: " + String(err));
        setLoadingSummary(false);
      });

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  const declaredCents = Math.round((parseFloat(declaredPesos) || 0) * 100);
  const expectedCents = summary?.expectedCashCents ?? 0;
  const differenceCents = declaredPesos === "" ? 0 : declaredCents - expectedCents;

  // Filtrar medios que no son efectivo físico para la matriz de medios digitales/crédito
  const nonCashMethods: ShiftPaymentBreakdown[] = useMemo(() => {
    if (!summary?.paymentBreakdown) {
      // Fallback si no viene breakdown
      const list: ShiftPaymentBreakdown[] = [];
      if (summary) {
        if (summary.cardSalesCents > 0) {
          list.push({
            code: "card",
            name: "Tarjeta Débito / Crédito",
            paymentType: "TARJETA",
            amountCents: summary.cardSalesCents,
            txCount: 1,
          });
        }
        if (summary.transferSalesCents > 0) {
          list.push({
            code: "transfer",
            name: "Transferencia / QR",
            paymentType: "TRANSFERENCIA",
            amountCents: summary.transferSalesCents,
            txCount: 1,
          });
        }
        if (summary.otherSalesCents > 0) {
          list.push({
            code: "other",
            name: "Otros Medios",
            paymentType: "OTRO",
            amountCents: summary.otherSalesCents,
            txCount: 1,
          });
        }
      }
      return list;
    }

    return summary.paymentBreakdown.filter(
      (m) =>
        m.paymentType.toUpperCase() !== "EFECTIVO" &&
        m.code.toLowerCase() !== "cash" &&
        m.code.toLowerCase() !== "efectivo"
    );
  }, [summary]);

  const nonCashTotalCents = useMemo(() => {
    return nonCashMethods.reduce((acc, m) => acc + m.amountCents, 0);
  }, [nonCashMethods]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!summary) return;

    if (declaredPesos.trim() === "") {
      setError("Por favor ingresa la cantidad de dinero en efectivo que contaste en tu caja.");
      return;
    }

    if (parseFloat(declaredPesos) < 0) {
      setError("El dinero contado no puede ser un número negativo.");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const closedShift = await api.shifts.closeShift({
        declaredCents,
        notes: notes.trim() ? notes.trim() : undefined,
      });

      // Garantizar que no quede ningún ticket abierto en memoria ni en localStorage
      handlePurgeTickets();

      // Imprimir comprobante Z real del turno cerrado si el cajero eligió la opción
      if (printReceipt) {
        api.printers.printShiftTicket(closedShift.id).catch((printErr) => {
          console.warn("No se pudo imprimir el comprobante Z de cierre:", printErr);
        });
      }

      onShiftClosed(closedShift);
    } catch (err: unknown) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/60 dark:bg-[#070a10]/85 backdrop-blur-md z-50 flex items-center justify-center p-2 sm:p-4 overflow-hidden">
      {/* Contenedor Modal de Alto Impacto adaptado al tema activo (Claro / Oscuro) */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-headline"
        className="relative w-full max-w-[940px] max-h-[92vh] bg-white dark:bg-[#111726]/95 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col my-auto shadow-slate-900/10 dark:shadow-[0_0_35px_-5px_rgba(16,185,129,0.22)] animate-in fade-in zoom-in-95 duration-150 transition-colors"
      >
        {/* Barra superior de acento cibernético esmeralda/cielo */}
        <div className="h-1 w-full shrink-0 bg-gradient-to-r from-emerald-500/80 via-emerald-400 to-sky-500" />

        {/* 1. Encabezado del Modal */}
        <div className="px-6 py-3.5 shrink-0 bg-slate-50/90 dark:bg-[#0a0e18]/90 border-b border-slate-200 dark:border-white/10 flex items-center justify-between gap-4 transition-colors">
          <div className="flex items-center gap-3.5">
            {/* Ícono de Terminal / Punto de Venta */}
            <div className="w-11 h-11 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 text-2xl shadow-sm shrink-0">
              💼
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1
                  id="modal-headline"
                  className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight"
                >
                  Entrega y Cierre de Caja
                </h1>
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 uppercase tracking-widest font-semibold hidden sm:inline-block">
                  [ ARQUEO DE TURNO ]
                </span>
              </div>
              {summary && (
                <div className="flex flex-wrap items-center gap-2 mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <span>👤</span>
                    <span>
                      Cajero: <strong className="text-slate-800 dark:text-slate-200 font-medium">{summary.userName}</strong>
                    </span>
                    {summary.folio && (
                      <span className="text-slate-400 dark:text-slate-500 font-mono">• {summary.folio}</span>
                    )}
                  </span>
                  <span className="text-slate-400 dark:text-slate-600">•</span>
                  <span className="inline-flex items-center gap-1 font-mono text-[11px] bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-400 px-2.5 py-0.5 rounded-full border border-emerald-300 dark:border-emerald-500/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Caja Activa
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Botón cerrar / Esc */}
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="group flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/80 dark:hover:bg-slate-700/80 border border-slate-200 dark:border-white/10 text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white transition-all active:scale-95 text-xs font-mono cursor-pointer disabled:opacity-50"
            title="Volver a la caja sin cerrar (Esc)"
          >
            <span>Esc</span>
            <span className="group-hover:rotate-90 transition-transform text-sm">✕</span>
          </button>
        </div>

        {/* Banner de error */}
        {error && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800/80 text-rose-800 dark:text-rose-300 text-xs flex items-center space-x-2">
            <span className="text-base shrink-0">⚠️</span>
            <span className="flex-1 font-medium">{error}</span>
          </div>
        )}

        {/* Cuerpo del Modal con scrollbar estilizada adaptada al tema */}
        {loadingSummary ? (
          <div className="py-16 text-center text-slate-500 dark:text-slate-400 text-sm space-y-2">
            <span className="inline-block animate-spin text-emerald-600 dark:text-emerald-400 text-2xl">🔄</span>
            <div className="font-medium text-slate-800 dark:text-slate-200">Calculando las ventas y el dinero del turno...</div>
            <p className="text-xs text-slate-500">Consultando registros y base de datos local</p>
          </div>
        ) : summary ? (
          <form
            onSubmit={handleSubmit}
            className="flex-1 min-h-0 flex flex-col overflow-hidden"
          >
            <div className="flex-1 min-h-0 p-5 sm:p-6 overflow-y-auto space-y-5 custom-scrollbar">
            {/* Aviso amigable si hay ventas sin finalizar */}
            {pendingTicketsCount > 0 && !ticketsPurged && (
              <div className="rounded-xl border border-amber-300 dark:border-amber-500/40 bg-amber-50/70 dark:bg-amber-950/20 p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-start sm:items-center gap-2.5">
                  <span className="text-amber-500 dark:text-amber-400 text-lg shrink-0">⚠️</span>
                  <p className="text-amber-800 dark:text-amber-200 text-xs font-medium leading-snug">
                    Tienes <strong>{pendingTicketsCount} venta(s)</strong> sin terminar con {pendingItemsCount} producto(s). Si cierras el turno ahora, se borrarán automáticamente para dejar la caja limpia al siguiente turno.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handlePurgeTickets}
                  className="shrink-0 inline-flex items-center gap-1.5 bg-amber-200 hover:bg-amber-300 dark:bg-amber-500/20 dark:hover:bg-amber-500/30 text-amber-900 dark:text-amber-300 border border-amber-400/50 dark:border-amber-500/40 text-xs px-3 py-1.5 rounded-lg font-semibold transition-all active:scale-95 cursor-pointer"
                >
                  <span>🗑️</span>
                  <span>Borrar ventas pendientes ahora</span>
                </button>
              </div>
            )}

            {ticketsPurged && (
              <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2">
                <span>✅</span>
                <span>Todas las ventas pendientes han sido borradas. La caja está limpia para entregar.</span>
              </div>
            )}

            {/* 2. Hero Card: ¿Cuánto dinero en efectivo debe haber en el cajón? */}
            <div className="bg-gradient-to-br from-emerald-50/70 via-slate-50 to-sky-50/50 dark:from-[#0c1322] dark:via-[#10192d] dark:to-[#0d1624] border border-emerald-400/40 dark:border-emerald-500/30 rounded-xl p-5 relative overflow-hidden shadow-sm dark:shadow-lg transition-colors">
              {/* Halo sutil de fondo */}
              <div className="absolute -right-16 -top-16 w-56 h-56 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
              
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xl">💵</span>
                    <h2 className="text-base sm:text-lg text-slate-900 dark:text-white font-bold tracking-tight">
                      ¿Cuánto dinero en efectivo debe haber en el cajón?
                    </h2>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 max-w-xl">
                    Suma automática calculada por ventas registradas en efectivo más el fondo inicial de apertura.
                  </p>
                </div>
                <div className="flex flex-col md:items-end">
                  <span className="font-mono text-[11px] text-emerald-700 dark:text-emerald-400 uppercase tracking-wider font-semibold">
                    Esperado en Caja
                  </span>
                  <div className="text-2xl sm:text-3xl font-mono font-bold text-emerald-600 dark:text-emerald-400 tracking-tight flex items-baseline gap-1">
                    <span className="text-xl text-emerald-500/80">$</span>
                    <span>{formatCents(summary.expectedCashCents).replace("$", "").trim()}</span>
                    <span className="text-xs font-mono text-slate-500 dark:text-slate-400 font-normal tracking-widest ml-1">
                      COP
                    </span>
                  </div>
                </div>
              </div>

              {/* Chips de desglose transparente */}
              <div className="mt-4 pt-3.5 border-t border-slate-200 dark:border-white/10 flex flex-wrap items-center gap-2.5">
                <div className="flex items-center gap-2 bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 px-3 py-1.5 rounded-lg text-xs font-mono text-slate-700 dark:text-slate-300 shadow-xs">
                  <span className="w-2 h-2 rounded-full bg-sky-500" />
                  <span>
                    Base inicial en caja:{" "}
                    <strong className="text-slate-900 dark:text-white font-semibold">
                      {formatCents(summary.openingCents)}
                    </strong>
                  </span>
                </div>
                <span className="text-slate-400 dark:text-slate-500 font-bold">+</span>
                <div className="flex items-center gap-2 bg-white dark:bg-[#070b14] border border-emerald-200 dark:border-emerald-900/60 px-3 py-1.5 rounded-lg text-xs font-mono text-emerald-700 dark:text-emerald-400 shadow-xs">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span>
                    Ventas cobradas en efectivo:{" "}
                    <strong className="font-semibold">
                      +{formatCents(summary.cashSalesCents)}
                    </strong>
                  </span>
                </div>

                {summary.customerPaymentsCashCents > 0 && (
                  <>
                    <span className="text-slate-400 dark:text-slate-500 font-bold">+</span>
                    <div className="flex items-center gap-2 bg-white dark:bg-[#070b14] border border-teal-200 dark:border-teal-900/60 px-3 py-1.5 rounded-lg text-xs font-mono text-teal-700 dark:text-teal-300 shadow-xs">
                      <span className="w-2 h-2 rounded-full bg-teal-500" />
                      <span>
                        Abonos cartera en efectivo:{" "}
                        <strong className="font-semibold">
                          +{formatCents(summary.customerPaymentsCashCents)}
                        </strong>
                      </span>
                    </div>
                  </>
                )}

                {(summary.cashReturnsCents ?? 0) > 0 && (
                  <>
                    <span className="text-slate-400 dark:text-slate-500 font-bold">−</span>
                    <div className="flex items-center gap-2 bg-white dark:bg-[#070b14] border border-rose-200 dark:border-rose-900/60 px-3 py-1.5 rounded-lg text-xs font-mono text-rose-700 dark:text-rose-400 shadow-xs">
                      <span className="w-2 h-2 rounded-full bg-rose-500" />
                      <span>
                        Devoluciones en efectivo:{" "}
                        <strong className="font-semibold">
                          -{formatCents(summary.cashReturnsCents ?? 0)}
                        </strong>
                      </span>
                    </div>
                  </>
                )}

                <div className="ml-auto text-xs text-slate-500 dark:text-slate-400 hidden lg:flex items-center gap-1.5">
                  <span className="text-emerald-600 dark:text-emerald-400">✓</span>
                  <span>{summary.salesCount} venta(s) realizadas</span>
                </div>
              </div>
            </div>

            {/* 3. Matriz Dinámica de Medios de Pago Configurados (No van en billetes físicos) */}
            <section className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-lg">💳</span>
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white tracking-tight">
                    Otros Medios de Pago Registrados (No van en billetes físicos)
                  </h3>
                </div>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-100 dark:bg-[#161c2c] border border-slate-200 dark:border-white/10 text-[11px] text-slate-600 dark:text-slate-400 font-mono">
                  <span>⚙️</span>
                  <span>Medios configurables según tu negocio</span>
                </div>
              </div>

              {/* Tabla de Medios de Pago con estilo ejecutivo y compacto */}
              {nonCashMethods.length > 0 ? (
                <div className="border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden bg-white dark:bg-[#0f1422] shadow-xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[620px]">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-[#0a0e18]/80 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider font-mono">
                          <th scope="col" className="py-2.5 px-4 w-[32%]">
                            Medio de Pago
                          </th>
                          <th scope="col" className="py-2.5 px-4 text-center w-[22%]">
                            Comprobantes / Transacciones
                          </th>
                          <th scope="col" className="py-2.5 px-4 w-[28%]">
                            Nota / Detalle
                          </th>
                          <th scope="col" className="py-2.5 px-4 text-right w-[18%]">
                            Total Registrado
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                        {nonCashMethods.map((method) => {
                          const theme = getPaymentTheme(method);
                          return (
                            <tr
                              key={method.code}
                              className="hover:bg-slate-50/80 dark:hover:bg-white/[0.02] transition-colors"
                            >
                              {/* MEDIO DE PAGO */}
                              <td className="py-3 px-4">
                                <div className="flex items-center gap-3">
                                  <div
                                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${theme.iconBoxClass}`}
                                  >
                                    {theme.icon}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="text-sm font-bold text-slate-900 dark:text-white leading-tight">
                                      {theme.displayTitle}
                                    </div>
                                    <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 font-medium">
                                      {theme.subtitle}
                                    </div>
                                  </div>
                                </div>
                              </td>

                              {/* COMPROBANTES / TRANSACCIONES */}
                              <td className="py-3 px-4 text-center">
                                <span
                                  className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${theme.badgeStyle}`}
                                >
                                  {theme.voucherText(method.txCount)}
                                </span>
                              </td>

                              {/* NOTA / DETALLE */}
                              <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-400">
                                {theme.note}
                              </td>

                              {/* TOTAL REGISTRADO */}
                              <td className="py-3 px-4 text-right">
                                <div className="font-mono text-sm sm:text-base font-bold text-slate-900 dark:text-white tracking-tight flex items-baseline justify-end gap-1">
                                  <span>$</span>
                                  <span>
                                    {formatCents(method.amountCents).replace("$", "").trim()}
                                  </span>
                                  <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500 font-normal ml-0.5">
                                    COP
                                  </span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-slate-50 dark:bg-[#0a0e18] border border-slate-200 dark:border-white/10 rounded-xl text-center text-xs text-slate-500 dark:text-slate-400">
                  <span>No se registraron ventas en otros medios (tarjetas, transferencias o créditos) durante este turno.</span>
                </div>
              )}

              {/* Tira de Resumen debajo de la matriz */}
              <div className="p-3 bg-slate-100 dark:bg-[#0a0e18] border border-slate-200 dark:border-white/10 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs transition-colors">
                <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                  <span className="w-2 h-2 rounded-full bg-sky-500" />
                  <span className="text-xs">
                    Total ventas en otros medios:{" "}
                    <strong className="text-sky-700 dark:text-sky-300 font-mono text-sm">
                      {formatCents(nonCashTotalCents)} COP
                    </strong>
                    <span className="text-slate-500 dark:text-slate-400 font-normal">
                      {" "}
                      (Registrado digitalmente, no en efectivo)
                    </span>
                  </span>
                </div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 font-mono font-semibold text-slate-800 dark:text-slate-200 self-start sm:self-auto shadow-xs">
                  <span className="text-slate-500 dark:text-slate-400 font-normal">Total Turno Facturado:</span>
                  <span className="text-emerald-600 dark:text-emerald-400 text-sm">
                    {formatCents(summary.totalSalesCents)} COP
                  </span>
                </div>
              </div>
            </section>

            {/* 4. Conteo Físico: ¿Cuánto dinero en efectivo contaste en tu cajón? */}
            <section className="bg-slate-50 dark:bg-[#141a29]/90 border border-slate-200 dark:border-white/10 rounded-xl p-5 space-y-3 transition-colors">
              <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
                <label
                  htmlFor="cash-input"
                  className="text-sm sm:text-base font-bold text-slate-900 dark:text-white flex items-center gap-2"
                >
                  <span className="text-emerald-600 dark:text-emerald-400 text-xl">💵</span>
                  <span>¿Cuánto dinero en efectivo contaste en tu cajón?</span>
                </label>
                <span className="font-mono text-xs text-emerald-600 dark:text-emerald-400 font-medium">Paso requerido</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Cuenta todos los billetes y monedas que entregas físicamente al supervisor o guardas en la caja fuerte.
              </p>

              {/* Input grande con Glow Esmeralda */}
              <div className="relative flex items-center bg-white dark:bg-[#070a10] border-2 border-emerald-500 rounded-xl px-4 py-3 shadow-[0_0_20px_rgba(16,185,129,0.15)] dark:shadow-[0_0_20px_rgba(16,185,129,0.2)] focus-within:border-emerald-600 dark:focus-within:border-emerald-400 focus-within:ring-2 focus-within:ring-emerald-400/30 transition-all">
                <span className="font-mono text-2xl md:text-3xl font-bold text-emerald-600 dark:text-emerald-400 mr-2 select-none">
                  $
                </span>
                <input
                  id="cash-input"
                  ref={inputRef}
                  type="number"
                  step="any"
                  min="0"
                  required
                  placeholder="0"
                  value={declaredPesos}
                  onChange={(e) => setDeclaredPesos(e.target.value)}
                  className="w-full bg-transparent border-0 p-0 font-mono text-2xl md:text-3xl font-bold text-emerald-700 dark:text-emerald-400 focus:ring-0 focus:outline-none tracking-wider placeholder:text-slate-400 dark:placeholder:text-slate-700"
                />
                <div className="flex items-center gap-2 ml-3 shrink-0">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-[#062c1d] border border-emerald-200 dark:border-emerald-500/50 text-emerald-800 dark:text-emerald-300 font-mono text-xs font-semibold select-none">
                    <span className="text-emerald-600 dark:text-emerald-400">✓</span>
                    <span>Contado Físico</span>
                  </span>
                  <span className="hidden sm:inline-flex items-center px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-white/10 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                    ↵ Enter
                  </span>
                </div>
              </div>
            </section>

            {/* 5. Resultado del Arqueo en Tiempo Real (Cuadre de Caja) */}
            {declaredPesos !== "" && (
              <div
                className={`border rounded-xl p-4.5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-md transition-all ${
                  differenceCents === 0
                    ? "bg-gradient-to-r from-emerald-50 via-emerald-100/60 to-emerald-50 border-emerald-400 text-emerald-900 dark:bg-gradient-to-r dark:from-[#072418] dark:via-[#093221] dark:to-[#072418] dark:border-emerald-500/50 dark:shadow-emerald-950/20"
                    : differenceCents < 0
                    ? "bg-gradient-to-r from-rose-50 via-rose-100/60 to-rose-50 border-rose-400 text-rose-900 dark:bg-gradient-to-r dark:from-[#260c0e] dark:via-[#351216] dark:to-[#260c0e] dark:border-rose-500/50 dark:shadow-rose-950/20"
                    : "bg-gradient-to-r from-sky-50 via-sky-100/60 to-sky-50 border-sky-400 text-sky-900 dark:bg-gradient-to-r dark:from-[#0c1e2b] dark:via-[#122838] dark:to-[#0c1e2b] dark:border-sky-500/50 dark:shadow-sky-950/20"
                }`}
              >
                <div className="flex items-start sm:items-center gap-3.5">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-xl shrink-0 mt-0.5 sm:mt-0 ${
                      differenceCents === 0
                        ? "bg-emerald-500/20 border border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
                        : differenceCents < 0
                        ? "bg-rose-500/20 border border-rose-500/40 text-rose-700 dark:text-rose-400"
                        : "bg-sky-500/20 border border-sky-500/40 text-sky-700 dark:text-sky-400"
                    }`}
                  >
                    {differenceCents === 0 ? "✓" : differenceCents < 0 ? "⚠️" : "ℹ️"}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3
                        className={`text-base font-bold ${
                          differenceCents === 0
                            ? "text-emerald-800 dark:text-emerald-400"
                            : differenceCents < 0
                            ? "text-rose-800 dark:text-rose-400"
                            : "text-sky-800 dark:text-sky-400"
                        }`}
                      >
                        {differenceCents === 0
                          ? "¡Cuadre Perfecto!"
                          : differenceCents < 0
                          ? "Faltante de Efectivo"
                          : "Sobrante de Efectivo"}
                      </h3>
                      <span
                        className={`px-2 py-0.5 rounded-full font-mono text-[11px] font-bold ${
                          differenceCents === 0
                            ? "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-[#002113]"
                            : differenceCents < 0
                            ? "bg-rose-600 text-white dark:bg-rose-500"
                            : "bg-sky-600 text-white dark:bg-sky-500"
                        }`}
                      >
                        {differenceCents === 0
                          ? "0 DESCUADRE"
                          : differenceCents < 0
                          ? "FALTANTE"
                          : "SOBRANTE"}
                      </span>
                    </div>
                    <p className="text-xs text-slate-700 dark:text-slate-300/90 mt-0.5">
                      {differenceCents === 0
                        ? "El dinero contado coincide exactamente con el valor calculado por el sistema."
                        : differenceCents < 0
                        ? "Falta dinero físico en el cajón respecto a las ventas registradas."
                        : "Hay más dinero físico en el cajón del que el sistema tiene registrado."}
                    </p>
                  </div>
                </div>

                {/* Pastilla de Balance Métrico */}
                <div
                  className={`flex flex-col sm:items-end border px-4 py-2.5 rounded-lg shrink-0 ${
                    differenceCents === 0
                      ? "bg-white/80 dark:bg-[#051c13]/80 border-emerald-300 dark:border-emerald-500/30"
                      : differenceCents < 0
                      ? "bg-white/80 dark:bg-[#20090c]/80 border-rose-300 dark:border-rose-500/30"
                      : "bg-white/80 dark:bg-[#081723]/80 border-sky-300 dark:border-sky-500/30"
                  }`}
                >
                  <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
                    BALANCE DE ARQUEO
                  </span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs text-slate-600 dark:text-slate-400 font-medium">Diferencia:</span>
                    <span
                      className={`font-mono text-lg font-bold tracking-tight ${
                        differenceCents === 0
                          ? "text-emerald-700 dark:text-emerald-400"
                          : differenceCents < 0
                          ? "text-rose-700 dark:text-rose-400"
                          : "text-sky-700 dark:text-sky-400"
                      }`}
                    >
                      {differenceCents === 0 ? "$0 COP" : `${formatCents(Math.abs(differenceCents))} COP`}
                    </span>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 font-mono text-[11px] mt-0.5 ${
                      differenceCents === 0
                        ? "text-emerald-700 dark:text-emerald-300"
                        : differenceCents < 0
                        ? "text-rose-700 dark:text-rose-300"
                        : "text-sky-700 dark:text-sky-300"
                    }`}
                  >
                    {differenceCents === 0
                      ? "✓ Exacto: $0"
                      : differenceCents < 0
                      ? "⚠️ Descuadre negativo"
                      : "ℹ️ Descuadre positivo"}
                  </span>
                </div>
              </div>
            )}

            {/* 6. Observaciones y Notas del Turno (Opcional) */}
            <div className="space-y-2">
              <label
                htmlFor="shift-notes"
                className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center justify-between"
              >
                <span className="flex items-center gap-1.5">
                  <span>📝</span>
                  <span>¿Algún comentario o novedad sobre tu turno?</span>
                  <span className="text-slate-500 text-[11px] font-normal">(Opcional)</span>
                </span>
                <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                  Caracteres: {notes.length}/250
                </span>
              </label>
              <input
                id="shift-notes"
                type="text"
                maxLength={250}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ej: Todo entregado al administrador sin novedad, billetes de 50k fajados..."
                className="w-full bg-slate-50 dark:bg-[#0a0e18] border border-slate-200 dark:border-white/10 rounded-lg px-3.5 py-2.5 text-xs text-slate-900 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none transition-colors"
              />
            </div>
            </div>

            {/* 7. Barra de Acciones del Pie del Modal (Fija en la parte inferior) */}
            <div className="px-6 py-3.5 shrink-0 bg-slate-50/90 dark:bg-[#0a0e18]/90 border-t border-slate-200 dark:border-white/10 flex flex-col-reverse sm:flex-row items-center justify-between gap-3">
              <button
                type="button"
                onClick={onCancel}
                disabled={loading}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-white hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-700/80 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-200 text-xs font-semibold tracking-wide transition-all active:scale-95 cursor-pointer disabled:opacity-50"
              >
                <span>←</span>
                <span>Volver a la Caja</span>
              </button>

              <div className="w-full sm:w-auto flex flex-wrap items-center justify-end gap-3">
                {/* Checkbox para elegir si se imprime el cierre o no (por defecto activo) */}
                <label className="inline-flex items-center gap-2 cursor-pointer select-none text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-white/10 px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                  <input
                    type="checkbox"
                    checked={printReceipt}
                    onChange={(e) => setPrintReceipt(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-emerald-600 focus:ring-emerald-500 bg-white dark:bg-slate-900 cursor-pointer accent-emerald-600"
                  />
                  <span className="flex items-center gap-1.5 font-medium">
                    <span>🖨️</span>
                    <span>Imprimir comprobante Z</span>
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={loading || declaredPesos === ""}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-6 py-2.5 rounded-lg bg-gradient-to-r from-emerald-600 via-emerald-500 to-emerald-700 dark:from-emerald-500 dark:via-emerald-400 dark:to-emerald-600 hover:from-emerald-500 hover:to-emerald-600 text-white dark:text-[#002819] text-sm font-bold shadow-lg shadow-emerald-700/20 dark:shadow-emerald-950/40 border-t border-white/30 transition-all duration-150 active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span>🔒</span>
                  <span>{loading ? "Cerrando turno..." : "Terminar Turno y Cerrar Caja"}</span>
                </button>
              </div>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
