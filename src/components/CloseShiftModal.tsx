import { useState, useEffect, useRef, useMemo } from "react";
import { api } from "../services/api";
import { formatCents } from "../lib/money";
import type { CashShift, ShiftPaymentBreakdown, ShiftSummary } from "../types";

interface CloseShiftModalProps {
  onShiftClosed: (shift: CashShift) => void;
  onCancel: () => void;
}

interface PaymentTheme {
  icon: string;
  border: string;
  glow: string;
  titleColor: string;
  amountColor: string;
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
      icon: "🤝",
      border: "border-amber-500/30 hover:border-amber-500/60",
      glow: "bg-amber-500/5",
      titleColor: "text-amber-200",
      amountColor: "text-amber-300",
      badgeStyle: "bg-amber-950/70 border-amber-600/40 text-amber-300",
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
      icon: "💳",
      border: "border-sky-500/30 hover:border-sky-500/60",
      glow: "bg-sky-500/5",
      titleColor: "text-sky-200",
      amountColor: "text-sky-300",
      badgeStyle: "bg-sky-950/70 border-sky-600/40 text-sky-300",
      note: "Débito / Crédito • Verificar comprobantes impresos",
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
      icon: "📱",
      border: "border-purple-500/30 hover:border-purple-500/60",
      glow: "bg-purple-500/5",
      titleColor: "text-purple-200",
      amountColor: "text-purple-300",
      badgeStyle: "bg-purple-950/70 border-purple-600/40 text-purple-300",
      note: "Transferencias móviles confirmadas en app",
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
      icon: "🏦",
      border: "border-teal-500/30 hover:border-teal-500/60",
      glow: "bg-teal-500/5",
      titleColor: "text-teal-200",
      amountColor: "text-teal-300",
      badgeStyle: "bg-teal-950/70 border-teal-600/40 text-teal-300",
      note: "Comprobante electrónico verificado en cuenta",
    };
  }

  return {
    icon: "⚡",
    border: "border-indigo-500/30 hover:border-indigo-500/60",
    glow: "bg-indigo-500/5",
    titleColor: "text-indigo-200",
    amountColor: "text-indigo-300",
    badgeStyle: "bg-indigo-950/70 border-indigo-600/40 text-indigo-300",
    note: "Registrado digitalmente en el sistema",
  };
}

export function CloseShiftModal({ onShiftClosed, onCancel }: CloseShiftModalProps) {
  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [declaredPesos, setDeclaredPesos] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
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

      // Imprimir comprobante de cierre si hay impresora configurada
      api.settings.testPrintTicket().catch(() => {});

      onShiftClosed(closedShift);
    } catch (err: unknown) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[#070a10]/85 backdrop-blur-md z-50 flex items-center justify-center p-3 md:p-6 overflow-y-auto">
      {/* Contenedor Modal de Alto Impacto con Estilo Cybernetic Stitch */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-headline"
        className="relative w-full max-w-[940px] bg-[#111726]/95 border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col my-auto shadow-[0_0_35px_-5px_rgba(16,185,129,0.22)] animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Barra superior de acento cibernético esmeralda/cielo */}
        <div className="h-1 w-full bg-gradient-to-r from-emerald-500/80 via-emerald-400 to-sky-500" />

        {/* 1. Encabezado del Modal */}
        <div className="px-6 py-4 bg-[#0a0e18]/90 border-b border-white/10 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            {/* Ícono de Terminal / Punto de Venta */}
            <div className="w-11 h-11 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 text-2xl shadow-sm shrink-0">
              💼
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1
                  id="modal-headline"
                  className="text-xl sm:text-2xl font-bold text-white tracking-tight"
                >
                  Entrega y Cierre de Caja
                </h1>
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-800 text-emerald-400 border border-emerald-500/30 uppercase tracking-widest font-semibold hidden sm:inline-block">
                  [ ARQUEO DE TURNO ]
                </span>
              </div>
              {summary && (
                <div className="flex flex-wrap items-center gap-2 mt-0.5 text-xs text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <span>👤</span>
                    <span>
                      Cajero: <strong className="text-slate-200 font-medium">{summary.userName}</strong>
                    </span>
                    {summary.folio && (
                      <span className="text-slate-500 font-mono">• {summary.folio}</span>
                    )}
                  </span>
                  <span className="text-slate-600">•</span>
                  <span className="inline-flex items-center gap-1 font-mono text-[11px] bg-emerald-950/60 text-emerald-400 px-2.5 py-0.5 rounded-full border border-emerald-500/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
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
            className="group flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-white/10 text-slate-300 hover:text-white transition-all active:scale-95 text-xs font-mono cursor-pointer disabled:opacity-50"
            title="Volver a la caja sin cerrar (Esc)"
          >
            <span>Esc</span>
            <span className="group-hover:rotate-90 transition-transform text-sm">✕</span>
          </button>
        </div>

        {/* Banner de error */}
        {error && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-rose-950/60 border border-rose-800/80 text-rose-300 text-xs flex items-center space-x-2">
            <span className="text-base shrink-0">⚠️</span>
            <span className="flex-1 font-medium">{error}</span>
          </div>
        )}

        {/* Cuerpo del Modal */}
        {loadingSummary ? (
          <div className="py-16 text-center text-slate-400 text-sm space-y-2">
            <span className="inline-block animate-spin text-emerald-400 text-2xl">🔄</span>
            <div className="font-medium text-slate-200">Calculando las ventas y el dinero del turno...</div>
            <p className="text-xs text-slate-500">Consultando registros y base de datos local</p>
          </div>
        ) : summary ? (
          <form onSubmit={handleSubmit} className="p-6 overflow-y-auto max-h-[calc(90vh-140px)] space-y-5">
            {/* Aviso amigable si hay ventas sin finalizar */}
            {pendingTicketsCount > 0 && !ticketsPurged && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-950/20 p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-start sm:items-center gap-2.5">
                  <span className="text-amber-400 text-lg shrink-0">⚠️</span>
                  <p className="text-amber-200 text-xs font-medium leading-snug">
                    Tienes <strong>{pendingTicketsCount} venta(s)</strong> sin terminar con {pendingItemsCount} producto(s). Si cierras el turno ahora, se borrarán automáticamente para dejar la caja limpia al siguiente turno.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handlePurgeTickets}
                  className="shrink-0 inline-flex items-center gap-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs px-3 py-1.5 rounded-lg font-semibold transition-all active:scale-95 cursor-pointer"
                >
                  <span>🗑️</span>
                  <span>Borrar ventas pendientes ahora</span>
                </button>
              </div>
            )}

            {ticketsPurged && (
              <div className="p-2.5 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
                <span>✅</span>
                <span>Todas las ventas pendientes han sido borradas. La caja está limpia para entregar.</span>
              </div>
            )}

            {/* 2. Hero Card: ¿Cuánto dinero en efectivo debe haber en el cajón? */}
            <div className="bg-gradient-to-br from-[#0c1322] via-[#10192d] to-[#0d1624] border border-emerald-500/30 rounded-xl p-5 relative overflow-hidden shadow-lg">
              {/* Halo sutil de fondo */}
              <div className="absolute -right-16 -top-16 w-56 h-56 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
              
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xl">💵</span>
                    <h2 className="text-base sm:text-lg text-white font-bold tracking-tight">
                      ¿Cuánto dinero en efectivo debe haber en el cajón?
                    </h2>
                  </div>
                  <p className="text-xs text-slate-400 mt-1 max-w-xl">
                    Suma automática calculada por ventas registradas en efectivo más el fondo inicial de apertura.
                  </p>
                </div>
                <div className="flex flex-col md:items-end">
                  <span className="font-mono text-[11px] text-emerald-400 uppercase tracking-wider font-semibold">
                    Esperado en Caja
                  </span>
                  <div className="text-2xl sm:text-3xl font-mono font-bold text-emerald-400 tracking-tight flex items-baseline gap-1">
                    <span className="text-xl text-emerald-500/70">$</span>
                    <span>{formatCents(summary.expectedCashCents).replace("$", "").trim()}</span>
                    <span className="text-xs font-mono text-slate-400 font-normal tracking-widest ml-1">
                      COP
                    </span>
                  </div>
                </div>
              </div>

              {/* Chips de desglose transparente */}
              <div className="mt-4 pt-3.5 border-t border-white/10 flex flex-wrap items-center gap-2.5">
                <div className="flex items-center gap-2 bg-[#070b14] border border-white/10 px-3 py-1.5 rounded-lg text-xs font-mono text-slate-300">
                  <span className="w-2 h-2 rounded-full bg-sky-400" />
                  <span>
                    Base inicial en caja:{" "}
                    <strong className="text-white font-semibold">
                      {formatCents(summary.openingCents)}
                    </strong>
                  </span>
                </div>
                <span className="text-slate-500 font-bold">+</span>
                <div className="flex items-center gap-2 bg-[#070b14] border border-emerald-900/60 px-3 py-1.5 rounded-lg text-xs font-mono text-emerald-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span>
                    Ventas cobradas en efectivo:{" "}
                    <strong className="font-semibold">
                      +{formatCents(summary.cashSalesCents)}
                    </strong>
                  </span>
                </div>

                {summary.customerPaymentsCashCents > 0 && (
                  <>
                    <span className="text-slate-500 font-bold">+</span>
                    <div className="flex items-center gap-2 bg-[#070b14] border border-teal-900/60 px-3 py-1.5 rounded-lg text-xs font-mono text-teal-300">
                      <span className="w-2 h-2 rounded-full bg-teal-400" />
                      <span>
                        Abonos cartera en efectivo:{" "}
                        <strong className="font-semibold">
                          +{formatCents(summary.customerPaymentsCashCents)}
                        </strong>
                      </span>
                    </div>
                  </>
                )}

                <div className="ml-auto text-xs text-slate-400 hidden lg:flex items-center gap-1.5">
                  <span className="text-emerald-400">✓</span>
                  <span>{summary.salesCount} venta(s) realizadas</span>
                </div>
              </div>
            </div>

            {/* 3. Matriz Dinámica de Medios de Pago Configurados (No van en billetes físicos) */}
            <section className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-lg">💳</span>
                  <h3 className="text-sm sm:text-base font-bold text-white tracking-tight">
                    Otros Medios de Pago Registrados (No van en billetes físicos)
                  </h3>
                </div>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#161c2c] border border-white/10 text-[11px] text-slate-400 font-mono">
                  <span>⚙️</span>
                  <span>Medios configurables según tu negocio</span>
                </div>
              </div>

              {/* Grid Responsivo de Tarjetas de Medios de Pago Dinámicos */}
              {nonCashMethods.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {nonCashMethods.map((method) => {
                    const theme = getPaymentTheme(method);
                    return (
                      <div
                        key={method.code}
                        className={`bg-[#121622]/90 border ${theme.border} rounded-xl p-3.5 transition-all duration-200 group flex flex-col justify-between relative overflow-hidden`}
                      >
                        <div
                          className={`absolute top-0 right-0 w-16 h-16 ${theme.glow} rounded-bl-full pointer-events-none`}
                        />
                        <div>
                          <div className="flex items-start justify-between gap-1.5 mb-2">
                            <div className="flex items-center gap-1.5 min-w-0 pr-1">
                              <span className="text-base shrink-0">{theme.icon}</span>
                              <span
                                className={`text-xs font-bold ${theme.titleColor} line-clamp-1`}
                                title={method.name}
                              >
                                {method.name}
                              </span>
                            </div>
                            <span
                              className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${theme.badgeStyle} font-semibold shrink-0 whitespace-nowrap`}
                            >
                              {method.txCount}{" "}
                              {method.txCount === 1 ? "operación" : "operaciones"}
                            </span>
                          </div>
                          <div
                            className={`font-mono text-base sm:text-lg font-bold ${theme.amountColor} tracking-tight`}
                          >
                            {formatCents(method.amountCents)}{" "}
                            <span className="text-[10px] font-normal opacity-70">COP</span>
                          </div>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-2.5 pt-2 border-t border-white/10 leading-tight">
                          {theme.note}
                        </p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-4 bg-[#0a0e18] border border-white/10 rounded-xl text-center text-xs text-slate-400">
                  <span>No se registraron ventas en otros medios (tarjetas, transferencias o créditos) durante este turno.</span>
                </div>
              )}

              {/* Tira de Resumen debajo de la matriz */}
              <div className="p-3 bg-[#0a0e18] border border-white/10 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 text-slate-300">
                  <span className="w-2 h-2 rounded-full bg-sky-400" />
                  <span className="text-xs">
                    Total ventas en otros medios:{" "}
                    <strong className="text-sky-300 font-mono text-sm">
                      {formatCents(nonCashTotalCents)} COP
                    </strong>
                    <span className="text-slate-400 font-normal">
                      {" "}
                      (Registrado digitalmente, no en efectivo)
                    </span>
                  </span>
                </div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-slate-800 border border-white/10 font-mono font-semibold text-slate-200 self-start sm:self-auto">
                  <span className="text-slate-400 font-normal">Total Turno Facturado:</span>
                  <span className="text-emerald-400 text-sm">
                    {formatCents(summary.totalSalesCents)} COP
                  </span>
                </div>
              </div>
            </section>

            {/* 4. Conteo Físico: ¿Cuánto dinero en efectivo contaste en tu cajón? */}
            <section className="bg-[#141a29]/90 border border-white/10 rounded-xl p-5 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
                <label
                  htmlFor="cash-input"
                  className="text-sm sm:text-base font-bold text-white flex items-center gap-2"
                >
                  <span className="text-emerald-400 text-xl">💵</span>
                  <span>¿Cuánto dinero en efectivo contaste en tu cajón?</span>
                </label>
                <span className="font-mono text-xs text-emerald-400 font-medium">Paso requerido</span>
              </div>
              <p className="text-xs text-slate-400">
                Cuenta todos los billetes y monedas que entregas físicamente al supervisor o guardas en la caja fuerte.
              </p>

              {/* Input grande con Glow Esmeralda */}
              <div className="relative flex items-center bg-[#070a10] border-2 border-emerald-500/60 rounded-xl px-4 py-3 shadow-[0_0_20px_rgba(16,185,129,0.2)] focus-within:border-emerald-400 focus-within:ring-2 focus-within:ring-emerald-400/30 transition-all">
                <span className="font-mono text-2xl md:text-3xl font-bold text-emerald-400 mr-2 select-none">
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
                  className="w-full bg-transparent border-0 p-0 font-mono text-2xl md:text-3xl font-bold text-emerald-400 focus:ring-0 focus:outline-none tracking-wider placeholder:text-slate-700"
                />
                <div className="flex items-center gap-2 ml-3 shrink-0">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#062c1d] border border-emerald-500/50 text-emerald-300 font-mono text-xs font-semibold select-none">
                    <span className="text-emerald-400">✓</span>
                    <span>Contado Físico</span>
                  </span>
                  <span className="hidden sm:inline-flex items-center px-2 py-1 rounded bg-slate-800 border border-white/10 font-mono text-[11px] text-slate-400">
                    ↵ Enter
                  </span>
                </div>
              </div>
            </section>

            {/* 5. Resultado del Arqueo en Tiempo Real (Cuadre de Caja) */}
            {declaredPesos !== "" && (
              <div
                className={`border rounded-xl p-4.5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-lg transition-all ${
                  differenceCents === 0
                    ? "bg-gradient-to-r from-[#072418] via-[#093221] to-[#072418] border-emerald-500/50 shadow-emerald-950/20"
                    : differenceCents < 0
                    ? "bg-gradient-to-r from-[#260c0e] via-[#351216] to-[#260c0e] border-rose-500/50 shadow-rose-950/20"
                    : "bg-gradient-to-r from-[#0c1e2b] via-[#122838] to-[#0c1e2b] border-sky-500/50 shadow-sky-950/20"
                }`}
              >
                <div className="flex items-start sm:items-center gap-3.5">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-xl shrink-0 mt-0.5 sm:mt-0 ${
                      differenceCents === 0
                        ? "bg-emerald-500/20 border border-emerald-400/40 text-emerald-400"
                        : differenceCents < 0
                        ? "bg-rose-500/20 border border-rose-400/40 text-rose-400"
                        : "bg-sky-500/20 border border-sky-400/40 text-sky-400"
                    }`}
                  >
                    {differenceCents === 0 ? "✓" : differenceCents < 0 ? "⚠️" : "ℹ️"}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3
                        className={`text-base font-bold ${
                          differenceCents === 0
                            ? "text-emerald-400"
                            : differenceCents < 0
                            ? "text-rose-400"
                            : "text-sky-400"
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
                            ? "bg-emerald-500 text-[#002113]"
                            : differenceCents < 0
                            ? "bg-rose-500 text-white"
                            : "bg-sky-500 text-white"
                        }`}
                      >
                        {differenceCents === 0
                          ? "0 DESCUADRE"
                          : differenceCents < 0
                          ? "FALTANTE"
                          : "SOBRANTE"}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300/90 mt-0.5">
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
                      ? "bg-[#051c13]/80 border-emerald-500/30"
                      : differenceCents < 0
                      ? "bg-[#20090c]/80 border-rose-500/30"
                      : "bg-[#081723]/80 border-sky-500/30"
                  }`}
                >
                  <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                    BALANCE DE ARQUEO
                  </span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs text-slate-400 font-medium">Diferencia:</span>
                    <span
                      className={`font-mono text-lg font-bold tracking-tight ${
                        differenceCents === 0
                          ? "text-emerald-400"
                          : differenceCents < 0
                          ? "text-rose-400"
                          : "text-sky-400"
                      }`}
                    >
                      {differenceCents === 0 ? "$0 COP" : `${formatCents(Math.abs(differenceCents))} COP`}
                    </span>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 font-mono text-[11px] mt-0.5 ${
                      differenceCents === 0
                        ? "text-emerald-300"
                        : differenceCents < 0
                        ? "text-rose-300"
                        : "text-sky-300"
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
                className="text-xs font-medium text-slate-300 flex items-center justify-between"
              >
                <span className="flex items-center gap-1.5">
                  <span>📝</span>
                  <span>¿Algún comentario o novedad sobre tu turno?</span>
                  <span className="text-slate-500 text-[11px] font-normal">(Opcional)</span>
                </span>
                <span className="font-mono text-[10px] text-slate-400">
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
                className="w-full bg-[#0a0e18] border border-white/10 rounded-lg px-3.5 py-2.5 text-xs text-slate-200 placeholder:text-slate-600 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none transition-colors"
              />
            </div>

            {/* 7. Barra de Acciones del Pie del Modal */}
            <div className="pt-3 border-t border-white/10 flex flex-col-reverse sm:flex-row items-center justify-between gap-3">
              <button
                type="button"
                onClick={onCancel}
                disabled={loading}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-slate-800/60 hover:bg-slate-700/80 border border-white/10 text-slate-200 text-xs font-semibold tracking-wide transition-all active:scale-95 cursor-pointer disabled:opacity-50"
              >
                <span>←</span>
                <span>Volver a la Caja</span>
              </button>

              <div className="w-full sm:w-auto flex items-center gap-3">
                <span className="hidden md:inline-flex items-center gap-1.5 font-mono text-[11px] text-slate-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  Listo para sellar turno
                </span>
                <button
                  type="submit"
                  disabled={loading || declaredPesos === ""}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-6 py-2.5 rounded-lg bg-gradient-to-r from-emerald-500 via-emerald-400 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-[#002819] text-sm font-bold shadow-lg shadow-emerald-950/40 border-t border-white/30 transition-all duration-150 active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
