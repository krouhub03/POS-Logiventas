import { useState, useEffect, useRef } from "react";
import { formatCents, toCents } from "../lib/money";
import { api } from "../services/api";
import type { PaymentInput, PaymentMethod } from "../types";

interface CobroModalProps {
  totalCents: number;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (payments: PaymentInput[]) => Promise<void>;
}

interface AbonoItem {
  id: string;
  method: string;
  methodName: string;
  methodType: string;
  amountCents: number;
  reference?: string;
}

export function CobroModal({ totalCents, isOpen, onClose, onConfirm }: CobroModalProps) {
  const [availableMethods, setAvailableMethods] = useState<PaymentMethod[]>([]);
  const [selectedMethodCode, setSelectedMethodCode] = useState<string>("cash");
  const [pagoInput, setPagoInput] = useState<string>("");
  const [refInput, setRefInput] = useState<string>("");
  const [isSplitMode, setIsSplitMode] = useState(false);
  const [abonos, setAbonos] = useState<AbonoItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const refInputRef = useRef<HTMLInputElement>(null);

  // Cargar medios de pago habilitados al abrir
  useEffect(() => {
    if (isOpen) {
      setPagoInput((totalCents / 100).toString());
      setRefInput("");
      setIsSplitMode(false);
      setAbonos([]);
      setError(null);
      setTimeout(() => inputRef.current?.select(), 50);

      api.sync
        .getPaymentMethods()
        .then((allMethods) => {
          const enabled = allMethods.filter((m) => m.active === 1 && m.terminalEnabled === 1);
          setAvailableMethods(enabled);

          const defaultMethod =
            enabled.find(
              (m) => m.type === "EFECTIVO" || m.code.toLowerCase().includes("cash")
            ) || enabled[0];

          if (defaultMethod) {
            setSelectedMethodCode(defaultMethod.code);
          } else {
            setSelectedMethodCode("cash");
          }
        })
        .catch((err) => {
          console.error("Error cargando medios de pago:", err);
          setSelectedMethodCode("cash");
        });
    }
  }, [isOpen, totalCents]);

  const selectedMethodObj = availableMethods.find((m) => m.code === selectedMethodCode);
  const isCashMethod =
    selectedMethodCode === "cash" ||
    selectedMethodObj?.type === "EFECTIVO" ||
    selectedMethodCode.toLowerCase().includes("efectivo");

  // Cálculos en modo mixto
  const totalAbonadoCents = abonos.reduce((sum, a) => sum + a.amountCents, 0);
  const saldoPendienteCents = Math.max(0, totalCents - totalAbonadoCents);

  // Cálculos en modo simple
  const pagoCents = toCents(pagoInput || 0);
  const cambioSimpleCents = isCashMethod ? Math.max(0, pagoCents - totalCents) : 0;
  const faltaSimpleCents = Math.max(0, totalCents - pagoCents);

  // Cambio en modo mixto
  const totalPagadoMixtoCents = totalAbonadoCents;
  const cambioMixtoCents = Math.max(0, totalPagadoMixtoCents - totalCents);

  // Sugerencia de billetes para efectivo
  const montoReferencia = isSplitMode ? saldoPendienteCents : totalCents;
  const sugerencias = [
    montoReferencia / 100,
    Math.ceil(montoReferencia / 5000) * 50,
    Math.ceil(montoReferencia / 10000) * 100,
    Math.ceil(montoReferencia / 20000) * 200,
    Math.ceil(montoReferencia / 50000) * 500,
  ]
    .filter((v, idx, arr) => v >= montoReferencia / 100 && arr.indexOf(v) === idx && v > 0)
    .slice(0, 4);

  // Actualizar pagoInput cuando cambia el saldo pendiente en modo mixto
  const prellenarSaldoPendiente = (nuevoSaldo: number) => {
    setPagoInput((nuevoSaldo / 100).toString());
    setRefInput("");
    setTimeout(() => inputRef.current?.select(), 50);
  };

  // Alternar a modo mixto
  const toggleSplitMode = () => {
    setError(null);
    if (!isSplitMode) {
      setIsSplitMode(true);
      prellenarSaldoPendiente(totalCents);
    } else {
      setIsSplitMode(false);
      setAbonos([]);
      setPagoInput((totalCents / 100).toString());
    }
  };

  // Añadir un abono a la lista en modo mixto
  const handleAddAbono = () => {
    setError(null);
    const montoAbonoCents = toCents(pagoInput || 0);

    if (montoAbonoCents <= 0) {
      setError("Ingrese un monto válido para el abono.");
      inputRef.current?.focus();
      return;
    }

    // Regla NIIF Anti-Fraude: medios electrónicos no pueden superar el saldo pendiente
    if (!isCashMethod && montoAbonoCents > saldoPendienteCents) {
      setError(
        `Los pagos con ${selectedMethodObj?.name || "tarjeta/transferencia"} no admiten sobrepago ni vuelto. Máximo permitido: ${formatCents(saldoPendienteCents)}`
      );
      inputRef.current?.focus();
      return;
    }

    const nuevoAbono: AbonoItem = {
      id: `${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      method: selectedMethodCode,
      methodName: selectedMethodObj?.name || selectedMethodCode,
      methodType: selectedMethodObj?.type || "OTRO",
      amountCents: montoAbonoCents,
      reference: refInput.trim() || undefined,
    };

    const nuevaLista = [...abonos, nuevoAbono];
    setAbonos(nuevaLista);

    const nuevoTotalAbonado = nuevaLista.reduce((sum, a) => sum + a.amountCents, 0);
    const nuevoSaldo = Math.max(0, totalCents - nuevoTotalAbonado);
    prellenarSaldoPendiente(nuevoSaldo);
  };

  // Eliminar un abono de la lista
  const handleRemoveAbono = (id: string) => {
    const filtrados = abonos.filter((a) => a.id !== id);
    setAbonos(filtrados);
    const nuevoTotalAbonado = filtrados.reduce((sum, a) => sum + a.amountCents, 0);
    const nuevoSaldo = Math.max(0, totalCents - nuevoTotalAbonado);
    prellenarSaldoPendiente(nuevoSaldo);
  };

  // Enviar confirmación de cobro
  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);

    // Caso 1: Modo Mixto
    if (isSplitMode) {
      // Si aún queda saldo pendiente y el usuario tiene un valor en el input
      if (saldoPendienteCents > 0 && pagoCents > 0) {
        handleAddAbono();
        return;
      }

      if (totalAbonadoCents < totalCents) {
        setError(`Monto insuficiente. Faltan ${formatCents(saldoPendienteCents)} por cubrir.`);
        return;
      }

      setLoading(true);
      try {
        const paymentsToSend: PaymentInput[] = abonos.map((a) => ({
          method: a.method,
          amountCents: a.amountCents,
          reference: a.reference,
        }));
        await onConfirm(paymentsToSend);
        onClose();
      } catch (err: unknown) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
      return;
    }

    // Caso 2: Modo Simple (Cobro Rápido)
    if (pagoCents < totalCents) {
      setError(`Monto insuficiente. Faltan ${formatCents(faltaSimpleCents)}.`);
      return;
    }

    // Validar que medios no efectivos no paguen de más
    if (!isCashMethod && pagoCents > totalCents) {
      setError(`Los pagos electrónicos no generan cambio. Ingrese el monto exacto.`);
      return;
    }

    setLoading(true);
    try {
      await onConfirm([
        {
          method: selectedMethodCode,
          amountCents: pagoCents,
          reference: refInput.trim() || undefined,
        },
      ]);
      onClose();
    } catch (err: unknown) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  // Atajos de teclado
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }

      // Atajo F10 para alternar Modo Dividido / Mixto
      if (e.key === "F10") {
        e.preventDefault();
        toggleSplitMode();
        return;
      }

      // Atajos F1 - F8 para seleccionar medio de pago
      const fKeyMatch = e.key.match(/^F([1-9])$/);
      if (fKeyMatch) {
        const index = parseInt(fKeyMatch[1], 10) - 1;
        if (index < availableMethods.length) {
          e.preventDefault();
          setSelectedMethodCode(availableMethods[index].code);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, availableMethods, isSplitMode]);

  if (!isOpen) return null;

  const getMethodIcon = (type: string, code: string) => {
    const t = (type || "").toUpperCase();
    const c = (code || "").toLowerCase();
    if (t === "EFECTIVO" || c.includes("cash") || c.includes("efectivo")) return "💵";
    if (t === "TARJETA" || c.includes("card") || c.includes("tarjeta")) return "💳";
    if (c.includes("nequi") || c.includes("daviplata") || t === "DIGITAL") return "📱";
    if (t === "BANCO" || c.includes("transfer")) return "🏦";
    return "🏷️";
  };

  const isFormValid = isSplitMode
    ? totalAbonadoCents >= totalCents
    : pagoCents >= totalCents && (isCashMethod || pagoCents === totalCents);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 dark:bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 transition-colors"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 transition-colors">
        {/* HEADER */}
        <div className="bg-gradient-to-r from-emerald-600 via-teal-700 to-slate-800 px-6 py-4 text-white flex items-center justify-between shadow">
          <div className="flex items-center gap-3">
            <span className="bg-black/25 text-xs px-2.5 py-1 rounded font-mono font-bold tracking-wide">
              F12
            </span>
            <div>
              <h2 className="text-base font-bold flex items-center gap-2">
                <span>{isSplitMode ? "Cobro Mixto / Múltiples Medios" : "Cobrar Venta"}</span>
                {isSplitMode && (
                  <span className="text-[10px] bg-emerald-500/30 border border-emerald-400/40 text-emerald-200 px-2 py-0.5 rounded-full font-mono uppercase font-bold">
                    Modo Dividido
                  </span>
                )}
              </h2>
              <p className="text-[11px] text-emerald-100/80">
                {isSplitMode
                  ? "Combina efectivo, tarjetas o transferencias en un solo ticket"
                  : "Cobro rápido con un solo medio de pago"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleSplitMode}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border ${
                isSplitMode
                  ? "bg-amber-500/20 text-amber-200 border-amber-400/40 hover:bg-amber-500/30"
                  : "bg-white/10 text-white hover:bg-white/20 border-white/20"
              }`}
              title="Alternar entre Cobro Rápido y Pago Mixto (F10)"
            >
              <span>{isSplitMode ? "⚡ Cambiar a Cobro Simple" : "➗ Dividir Pago (F10)"}</span>
            </button>
            <button
              onClick={onClose}
              className="text-white/80 hover:text-white text-lg font-bold px-2 py-1 cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>

        {/* ALERTA DE ERROR */}
        {error && (
          <div className="bg-rose-50 dark:bg-rose-950/80 border-b border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 px-6 py-2.5 text-xs font-semibold flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-rose-500 hover:text-rose-700">
              ✕
            </button>
          </div>
        )}

        <div className="p-6 space-y-5">
          {/* BOTONERA DINÁMICA DE MEDIOS DE PAGO */}
          <div>
            <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 flex items-center justify-between">
              <span>Selecciona Método {isSplitMode ? "para el Abono" : "de Cobro"}</span>
              <span className="text-[10px] font-mono text-slate-400">Atajos: F1 a F8</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {availableMethods.length === 0 ? (
                <button
                  type="button"
                  onClick={() => setSelectedMethodCode("cash")}
                  className="py-2.5 px-2 rounded-xl text-xs font-bold transition-all flex flex-col items-center gap-1 border bg-emerald-600 text-white border-emerald-500 shadow-md"
                >
                  <span className="text-base">💵</span>
                  <span>[F1] Efectivo M/N</span>
                </button>
              ) : (
                availableMethods.map((pm, idx) => {
                  const isSelected = selectedMethodCode === pm.code;
                  return (
                    <button
                      key={pm.id}
                      type="button"
                      onClick={() => {
                        setSelectedMethodCode(pm.code);
                        if (isSplitMode) {
                          prellenarSaldoPendiente(saldoPendienteCents);
                        }
                      }}
                      className={`py-2.5 px-2 rounded-xl text-xs font-bold transition-all flex flex-col items-center gap-1 border cursor-pointer ${
                        isSelected
                          ? "bg-emerald-600 text-white border-emerald-500 shadow-md shadow-emerald-700/20 scale-[1.02]"
                          : "bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700"
                      }`}
                    >
                      <span className="text-base">{getMethodIcon(pm.type, pm.code)}</span>
                      <span className="truncate max-w-[120px] text-center">
                        {idx < 8 ? `[F${idx + 1}] ` : ""}
                        {pm.name}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* TABLA DE ABONOS EN MODO MIXTO */}
          {isSplitMode && (
            <div className="space-y-2">
              <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center justify-between">
                <span>Abonos Registrados ({abonos.length})</span>
                <span className="font-mono text-emerald-600 dark:text-emerald-400 font-bold">
                  Abonado: {formatCents(totalAbonadoCents)} / {formatCents(totalCents)}
                </span>
              </div>

              {abonos.length === 0 ? (
                <div className="p-3 bg-slate-50 dark:bg-slate-950/60 border border-dashed border-slate-300 dark:border-slate-800 rounded-xl text-center text-xs text-slate-500">
                  Aún no has agregado ningún abono. Ingresa el monto abajo y haz clic en{" "}
                  <strong>"+ Añadir Abono"</strong>.
                </div>
              ) : (
                <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                  {abonos.map((abono, idx) => (
                    <div
                      key={abono.id}
                      className="p-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl flex items-center justify-between text-xs font-semibold"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{getMethodIcon(abono.methodType, abono.method)}</span>
                        <div>
                          <span className="text-slate-900 dark:text-white font-bold">
                            #{idx + 1} {abono.methodName}
                          </span>
                          {abono.reference && (
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 ml-2 font-mono">
                              Ref: {abono.reference}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="font-mono font-bold text-slate-900 dark:text-emerald-400">
                          {formatCents(abono.amountCents)}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveAbono(abono.id)}
                          className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 px-1 py-0.5 rounded cursor-pointer transition-colors"
                          title="Eliminar este abono"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TARJETAS FINANCIERAS RESUMEN */}
          <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 grid grid-cols-3 gap-3 text-center">
            {/* 1. Total */}
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">
                Total Venta
              </div>
              <div className="text-lg font-black text-slate-900 dark:text-white font-mono mt-1">
                {formatCents(totalCents)}
              </div>
            </div>

            {/* 2. Saldo Pendiente o Recibido */}
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">
                {isSplitMode ? "Resta por Pagar" : "Pago Recibido"}
              </div>
              <div
                className={`text-lg font-black font-mono mt-1 ${
                  isSplitMode
                    ? saldoPendienteCents > 0
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-emerald-600 dark:text-emerald-400"
                    : faltaSimpleCents > 0
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-emerald-600 dark:text-emerald-400"
                }`}
              >
                {isSplitMode
                  ? saldoPendienteCents === 0
                    ? "¡Completado!"
                    : formatCents(saldoPendienteCents)
                  : formatCents(pagoCents)}
              </div>
            </div>

            {/* 3. Cambio (Vuelto) */}
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">
                Cambio (Vuelto)
              </div>
              <div className="text-lg font-black font-mono mt-1 text-emerald-700 dark:text-emerald-400">
                {formatCents(isSplitMode ? cambioMixtoCents : cambioSimpleCents)}
              </div>
            </div>
          </div>

          {/* INPUTS DE PAGO Y REFERENCIA */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
            <div>
              <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block mb-1">
                {isSplitMode ? "Monto a Abonar ($)" : "Importe Entregado ($)"}
              </label>
              <input
                ref={inputRef}
                type="number"
                step="any"
                value={pagoInput}
                onChange={(e) => setPagoInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (isSplitMode && saldoPendienteCents > 0) {
                      handleAddAbono();
                    } else {
                      handleSubmit();
                    }
                  }
                }}
                className="w-full bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-700 focus:border-emerald-500 rounded-xl py-2 px-3 text-left text-slate-900 dark:text-white font-mono font-black text-xl focus:outline-none focus:ring-1 focus:ring-emerald-500"
                placeholder="0.00"
              />
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block mb-1 flex items-center justify-between">
                <span>N° Referencia / Voucher (Opcional)</span>
                {!isCashMethod && <span className="text-[10px] text-amber-500 font-normal">Recomendado</span>}
              </label>
              <div className="flex gap-2">
                <input
                  ref={refInputRef}
                  type="text"
                  value={refInput}
                  onChange={(e) => setRefInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      if (isSplitMode) handleAddAbono();
                      else handleSubmit();
                    }
                  }}
                  className="flex-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:border-emerald-500 rounded-xl py-2 px-3 text-xs text-slate-900 dark:text-white font-mono focus:outline-none"
                  placeholder="Ej: Aprobación #4829"
                />

                {isSplitMode && (
                  <button
                    type="button"
                    onClick={handleAddAbono}
                    disabled={pagoCents <= 0 || (saldoPendienteCents <= 0 && !isCashMethod)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer disabled:opacity-40"
                  >
                    + Añadir
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* BILLETES RÁPIDOS SUGERIDOS (SOLO PARA EFECTIVO) */}
          {isCashMethod && sugerencias.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Sugerencias rápidas:
              </span>
              {sugerencias.map((s, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setPagoInput(s.toString());
                    inputRef.current?.focus();
                  }}
                  className="px-3 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-mono text-xs font-bold transition-colors cursor-pointer"
                >
                  ${s.toLocaleString()}
                </button>
              ))}
            </div>
          )}

          {/* FOOTER DE ACCIONES */}
          <div className="pt-2 flex gap-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold text-xs transition-colors cursor-pointer"
            >
              [Esc] Cancelar
            </button>

            <button
              type="button"
              onClick={() => handleSubmit()}
              disabled={loading || !isFormValid}
              className="flex-2 py-3 px-6 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-sm uppercase tracking-wider shadow-lg shadow-emerald-700/20 dark:shadow-emerald-950/40 transition-colors disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
            >
              {loading
                ? "Procesando…"
                : isSplitMode
                ? "Confirmar Venta Mixta (Enter)"
                : "Cobrar e Imprimir (Enter)"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
