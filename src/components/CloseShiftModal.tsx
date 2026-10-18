import { useState, useEffect, useRef } from "react";
import { api } from "../services/api";
import { formatCents } from "../lib/money";
import type { CashShift, ShiftSummary } from "../types";

interface CloseShiftModalProps {
  onShiftClosed: (shift: CashShift) => void;
  onCancel: () => void;
}

export function CloseShiftModal({ onShiftClosed, onCancel }: CloseShiftModalProps) {
  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [declaredPesos, setDeclaredPesos] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Detección de tickets abiertos con productos
  const [pendingTicketsCount, setPendingTicketsCount] = useState<number>(0);
  const [pendingItemsCount, setPendingItemsCount] = useState<number>(0);
  const [ticketsPurged, setTicketsPurged] = useState<boolean>(false);

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

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    checkPendingTickets();

    api.shifts
      .getShiftSummary()
      .then((data) => {
        setSummary(data);
        setLoadingSummary(false);
        // Focus en el campo de conteo físico
        setTimeout(() => inputRef.current?.focus(), 100);
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

  const digitalSalesCents = summary
    ? summary.cardSalesCents + summary.transferSalesCents + summary.otherSalesCents + summary.customerPaymentsOtherCents
    : 0;

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-slate-900/95 border border-slate-700/60 rounded-2xl shadow-2xl p-6 text-slate-100 font-sans backdrop-blur-xl my-auto animate-in fade-in zoom-in-95 duration-150">
        
        {/* ─────────────────────────────────────────────────────────────
            HEADER (Amigable y sin códigos crípticos)
        ───────────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-emerald-400 text-xl shadow-inner">
              💼
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                Entrega y Cierre de Caja
              </h1>
              {summary && (
                <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-400 flex-wrap">
                  <span>Cajero: <strong className="text-slate-200">{summary.userName}</strong></span>
                  <span className="text-slate-600">•</span>
                  <span>Turno en curso</span>
                  <span className="inline-flex items-center gap-1 bg-emerald-950/50 border border-emerald-500/30 text-emerald-400 px-2 py-0.5 rounded-full text-[10px] font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Caja Activa
                  </span>
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="text-slate-400 hover:text-white hover:bg-slate-800 p-2 rounded-xl transition-colors flex items-center gap-1 text-xs border border-transparent hover:border-slate-700 cursor-pointer"
            title="Volver a la caja sin cerrar (Esc)"
          >
            <span className="hidden sm:inline opacity-60">Esc</span>
            <span className="text-base font-bold">✕</span>
          </button>
        </div>

        {/* Banner de error */}
        {error && (
          <div className="mt-4 p-3 rounded-xl bg-rose-950/50 border border-rose-800/60 text-rose-300 text-xs flex items-center space-x-2">
            <span className="text-base shrink-0">⚠️</span>
            <span className="flex-1">{error}</span>
          </div>
        )}

        {loadingSummary ? (
          <div className="py-12 text-center text-slate-400 text-sm">
            <span className="inline-block animate-spin text-emerald-400 text-xl mb-2">🔄</span>
            <div>Calculando las ventas y el dinero del turno...</div>
          </div>
        ) : summary ? (
          <form onSubmit={handleSubmit} className="pt-4 space-y-4">
            
            {/* ─────────────────────────────────────────────────────────────
                ALERTA DE VENTAS PENDIENTES (LENGUAJE 100% AMIGABLE)
            ───────────────────────────────────────────────────────────── */}
            {pendingTicketsCount > 0 && !ticketsPurged && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-950/20 p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-start sm:items-center gap-2.5">
                  <span className="text-amber-400 text-lg shrink-0">⚠️</span>
                  <p className="text-amber-200 text-xs font-medium leading-snug">
                    Tienes <strong>{pendingTicketsCount} venta(s)</strong> sin terminar con {pendingItemsCount} producto(s). Si cierras el turno ahora, se borrarán para dejar la caja limpia al siguiente turno.
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

            {/* ─────────────────────────────────────────────────────────────
                TARJETA PRINCIPAL: ¿CUÁNTO DINERO DEBE HABER EN EL CAJÓN?
            ───────────────────────────────────────────────────────────── */}
            <div className="bg-slate-800/80 border border-sky-500/40 rounded-2xl p-4 sm:p-5 relative overflow-hidden shadow-lg">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs uppercase tracking-wider text-sky-400 font-bold flex items-center gap-1.5">
                  <span>💵</span>
                  <span>¿Cuánto dinero debe haber en el cajón?</span>
                </span>
                <span className="text-[11px] font-mono text-slate-400 bg-slate-900/80 px-2 py-0.5 rounded-full border border-slate-700/60">
                  Calculado por el sistema
                </span>
              </div>

              {/* Monto Hero */}
              <div className="my-1 flex items-baseline gap-2">
                <span className="text-3xl sm:text-4xl font-extrabold text-sky-300 tracking-tight">
                  {formatCents(summary.expectedCashCents)}
                </span>
              </div>

              {/* Desglose en 2 columnas muy sencillas */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-3 border-t border-slate-700/60 mt-2">
                <div className="flex items-center justify-between bg-slate-900/70 px-3 py-2 rounded-xl border border-slate-800">
                  <span className="text-xs text-slate-300 flex items-center gap-1.5">
                    <span className="text-slate-400">🪙</span>
                    <span>Dinero inicial (Base):</span>
                  </span>
                  <span className="text-xs font-mono font-bold text-white">
                    {formatCents(summary.openingCents)}
                  </span>
                </div>

                <div className="flex items-center justify-between bg-slate-900/70 px-3 py-2 rounded-xl border border-slate-800">
                  <span className="text-xs text-slate-300 flex items-center gap-1.5">
                    <span className="text-emerald-400">➕</span>
                    <span>Ventas cobradas en efectivo:</span>
                  </span>
                  <span className="text-xs font-mono font-bold text-emerald-400">
                    +{formatCents(summary.cashSalesCents)}
                  </span>
                </div>

                {summary.customerPaymentsCashCents > 0 && (
                  <div className="col-span-1 sm:col-span-2 flex items-center justify-between bg-slate-900/70 px-3 py-2 rounded-xl border border-slate-800">
                    <span className="text-xs text-slate-300 flex items-center gap-1.5">
                      <span className="text-emerald-400">🤝</span>
                      <span>Pagos recibidos de clientes (Efectivo):</span>
                    </span>
                    <span className="text-xs font-mono font-bold text-emerald-400">
                      +{formatCents(summary.customerPaymentsCashCents)}
                    </span>
                  </div>
                )}
              </div>

              {/* Chip para ventas digitales (que no van en el cajón) */}
              {digitalSalesCents > 0 && (
                <div className="mt-2.5 bg-slate-950/70 px-3 py-2 rounded-xl border border-slate-800 flex items-center gap-2 text-xs text-slate-300">
                  <span className="text-sky-400 text-base">💳</span>
                  <p className="leading-tight">
                    <strong className="text-white">Pagos con Tarjeta o Transferencia: {formatCents(digitalSalesCents)}</strong>
                    <span className="block sm:inline sm:ml-1 text-slate-400 text-[11px]">
                      (Registrado digitalmente, no está en el cajón de billetes)
                    </span>
                  </p>
                </div>
              )}
            </div>

            {/* ─────────────────────────────────────────────────────────────
                CAMPO PRINCIPAL: ¿CUÁNTO DINERO EN EFECTIVO CONTASTE TÚ?
            ───────────────────────────────────────────────────────────── */}
            <div className="space-y-1.5">
              <label htmlFor="declared-cash-input" className="block text-sm font-semibold text-white">
                ¿Cuánto dinero en efectivo contaste en tu cajón?
              </label>
              
              <div className="relative flex items-center bg-slate-950 border-2 border-emerald-500/70 rounded-2xl px-4 py-2.5 shadow-[0_0_20px_rgba(16,185,129,0.15)] focus-within:border-emerald-400 focus-within:ring-2 focus-within:ring-emerald-400/30 transition-all">
                <span className="text-2xl font-mono text-slate-500 mr-3 select-none">$</span>
                <input
                  id="declared-cash-input"
                  ref={inputRef}
                  type="number"
                  step="any"
                  min="0"
                  required
                  placeholder="0.00"
                  value={declaredPesos}
                  onChange={(e) => setDeclaredPesos(e.target.value)}
                  className="w-full bg-transparent border-none p-0 text-2xl sm:text-3xl font-mono font-bold text-emerald-400 focus:outline-none focus:ring-0 placeholder:text-slate-700"
                />
                <div className="flex items-center gap-1 bg-emerald-950/60 border border-emerald-500/30 px-2.5 py-1 rounded-lg text-emerald-400 text-[11px] font-mono shrink-0 select-none">
                  <span>✓</span>
                  <span>Dinero en Mano</span>
                </div>
              </div>
              <p className="text-xs text-slate-400 flex items-center gap-1.5 pt-0.5">
                <span>💡</span>
                <span>Cuenta todos los billetes y monedas que entregas en mano al administrador o encargado.</span>
              </p>
            </div>

            {/* ─────────────────────────────────────────────────────────────
                RESULTADO VISUAL DEL ARQUEO (SÚPER VISUAL Y CLARO)
            ───────────────────────────────────────────────────────────── */}
            {declaredPesos !== "" && (
              <div
                className={`p-4 rounded-2xl border-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-all ${
                  differenceCents === 0
                    ? "bg-emerald-950/30 border-emerald-500/60 text-emerald-300"
                    : differenceCents < 0
                    ? "bg-rose-950/30 border-rose-500/60 text-rose-300"
                    : "bg-amber-950/30 border-amber-500/60 text-amber-300"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center text-lg shrink-0 ${
                      differenceCents === 0
                        ? "bg-emerald-500/20 text-emerald-400"
                        : differenceCents < 0
                        ? "bg-rose-500/20 text-rose-400"
                        : "bg-amber-500/20 text-amber-400"
                    }`}
                  >
                    {differenceCents === 0 ? "✓" : differenceCents < 0 ? "⚠️" : "ℹ️"}
                  </div>
                  <div>
                    <p className="font-bold text-sm leading-tight text-white">
                      {differenceCents === 0
                        ? "¡Cuadre Perfecto!"
                        : differenceCents < 0
                        ? "Falta dinero en caja"
                        : "Sobra dinero en caja"}
                    </p>
                    <p className="text-xs opacity-90 mt-0.5">
                      {differenceCents === 0
                        ? "El dinero contado coincide exactamente con lo registrado por el sistema."
                        : differenceCents < 0
                        ? "Hay menos dinero en el cajón del que debería haber según las ventas."
                        : "Hay más dinero en el cajón del que registró el sistema."}
                    </p>
                  </div>
                </div>

                <div className="shrink-0 self-end sm:self-center">
                  <span
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-extrabold ${
                      differenceCents === 0
                        ? "bg-emerald-500 text-slate-950"
                        : differenceCents < 0
                        ? "bg-rose-500 text-white"
                        : "bg-amber-500 text-slate-950"
                    }`}
                  >
                    <span>Diferencia:</span>
                    <span>{differenceCents === 0 ? "$0" : formatCents(Math.abs(differenceCents))}</span>
                  </span>
                </div>
              </div>
            )}

            {/* ─────────────────────────────────────────────────────────────
                COMENTARIOS O NOTAS (OPCIONAL)
            ───────────────────────────────────────────────────────────── */}
            <div className="space-y-1">
              <label htmlFor="shift-notes" className="block text-xs font-medium text-slate-400">
                ¿Algún comentario sobre tu turno? (Opcional)
              </label>
              <input
                id="shift-notes"
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ej: Todo entregado sin novedad, billetes de 50k organizados..."
                className="w-full bg-slate-950/80 border border-slate-700/70 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-slate-500 transition-all"
              />
            </div>

            {/* ─────────────────────────────────────────────────────────────
                BOTONES DE ACCIÓN CLAROS
            ───────────────────────────────────────────────────────────── */}
            <div className="pt-2 border-t border-slate-800 flex flex-col-reverse sm:flex-row items-center justify-between gap-3">
              <button
                type="button"
                onClick={onCancel}
                disabled={loading}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold border border-slate-700 transition-all cursor-pointer disabled:opacity-50"
              >
                Volver a la Caja
              </button>

              <button
                type="submit"
                disabled={loading || declaredPesos === ""}
                className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(16,185,129,0.25)] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span>🔒</span>
                <span>{loading ? "Cerrando turno..." : "Terminar Turno y Cerrar Caja"}</span>
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
