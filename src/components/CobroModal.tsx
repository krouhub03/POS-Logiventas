import { useState, useEffect, useRef } from "react";
import { formatCents, toCents } from "../lib/money";
import { api } from "../services/api";
import type { PaymentInput, PaymentMethod, Customer } from "../types";
import { CustomerModal } from "./CustomerModal";

interface CobroModalProps {
  totalCents: number;
  isOpen: boolean;
  initialCustomer?: Customer | null;
  onClose: () => void;
  onConfirm: (payments: PaymentInput[], customerId?: number) => Promise<void>;
}


export function CobroModal({ totalCents, isOpen, initialCustomer, onClose, onConfirm }: CobroModalProps) {
  const [availableMethods, setAvailableMethods] = useState<PaymentMethod[]>([]);
  const [selectedMethodCode, setSelectedMethodCode] = useState<string>("cash");
  const [pagoInput, setPagoInput] = useState<string>("");
  const [refInput, setRefInput] = useState<string>("");
  const [isSplitMode, setIsSplitMode] = useState(false);
  // Estado para la matriz del Cobro Mixto Directo (código del método -> { amountInput, reference })
  const [splitMap, setSplitMap] = useState<Record<string, { amountInput: string; reference: string }>>({});
  const [customer, setCustomer] = useState<Customer | null>(initialCustomer || null);
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const refInputRef = useRef<HTMLInputElement>(null);
  const splitInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Sincronizar cliente inicial y reiniciar campos al abrir
  useEffect(() => {
    if (isOpen) {
      setCustomer(initialCustomer || null);
      setIsCustomerModalOpen(false);
      setPagoInput((totalCents / 100).toString());
      setRefInput("");
      setIsSplitMode(false);
      setSplitMap({});
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

  const isCreditMethod =
    selectedMethodObj?.type === "CREDITO" ||
    selectedMethodCode.toLowerCase().includes("credito") ||
    selectedMethodCode.toLowerCase().includes("credit") ||
    selectedMethodCode.toLowerCase().includes("fiar");

  // Verificar si algún método a crédito en modo mixto tiene asignado monto
  const hasCreditInSplit = Object.entries(splitMap).some(([code, data]) => {
    const mCents = toCents(data.amountInput || 0);
    if (mCents <= 0) return false;
    const mObj = availableMethods.find((m) => m.code === code);
    return (
      mObj?.type === "CREDITO" ||
      code.toLowerCase().includes("credit") ||
      code.toLowerCase().includes("credito") ||
      code.toLowerCase().includes("fiar")
    );
  });

  const requiresCustomer = isCreditMethod || (isSplitMode && hasCreditInSplit);

  // Cálculos en modo mixto (Split Ledger)
  // Suma total asignada
  const totalAsignadoMixtoCents = Object.values(splitMap).reduce(
    (acc, cur) => acc + toCents(cur.amountInput || 0),
    0
  );

  // Saldo pendiente por asignar (no puede ser negativo para el cálculo de restante)
  const saldoPendienteCents = Math.max(0, totalCents - totalAsignadoMixtoCents);

  // En efectivo se permite sobrepago para vuelto
  const efectivoEntry = Object.entries(splitMap).find(([code]) => {
    const m = availableMethods.find((x) => x.code === code);
    return m?.type === "EFECTIVO" || code.toLowerCase().includes("cash") || code.toLowerCase().includes("efectivo");
  });
  const efectivoAmountCents = efectivoEntry ? toCents(efectivoEntry[1]?.amountInput || 0) : 0;
  const noEfectivoAmountCents = Object.entries(splitMap)
    .filter(([code]) => code !== efectivoEntry?.[0])
    .reduce((acc, [, cur]) => acc + toCents(cur.amountInput || 0), 0);

  const cambioMixtoCents = Math.max(0, (noEfectivoAmountCents + efectivoAmountCents) - totalCents);

  // Cálculos en modo simple
  const pagoCents = toCents(pagoInput || 0);
  const cambioSimpleCents = isCashMethod ? Math.max(0, pagoCents - totalCents) : 0;
  const faltaSimpleCents = Math.max(0, totalCents - pagoCents);

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

  // Alternar a modo mixto
  const toggleSplitMode = () => {
    setError(null);
    if (!isSplitMode) {
      setIsSplitMode(true);
      // Inicializar el método actual o efectivo con el total
      const initialSplit: Record<string, { amountInput: string; reference: string }> = {};
      const cashMethod = availableMethods.find(
        (m) => m.type === "EFECTIVO" || m.code.toLowerCase().includes("cash") || m.code.toLowerCase().includes("efectivo")
      ) || availableMethods[0];

      if (cashMethod) {
        initialSplit[cashMethod.code] = {
          amountInput: (totalCents / 100).toString(),
          reference: "",
        };
      }
      setSplitMap(initialSplit);
    } else {
      setIsSplitMode(false);
      setSplitMap({});
      setPagoInput((totalCents / 100).toString());
      setTimeout(() => inputRef.current?.select(), 50);
    }
  };

  // Manejar cambio de monto directo en un método del cobro mixto
  const handleSplitAmountChange = (methodCode: string, value: string) => {
    setError(null);
    setSplitMap((prev) => ({
      ...prev,
      [methodCode]: {
        amountInput: value,
        reference: prev[methodCode]?.reference || "",
      },
    }));
  };

  // Manejar cambio de referencia en un método del cobro mixto
  const handleSplitRefChange = (methodCode: string, refVal: string) => {
    setSplitMap((prev) => ({
      ...prev,
      [methodCode]: {
        amountInput: prev[methodCode]?.amountInput || "",
        reference: refVal,
      },
    }));
  };

  // Botón mágico: Asignar todo el saldo restante a este método
  const handleAssignRemainingToMethod = (targetCode: string) => {
    setError(null);
    // Calcular suma de los otros métodos
    const sumOthersCents = Object.entries(splitMap)
      .filter(([code]) => code !== targetCode)
      .reduce((acc, [, val]) => acc + toCents(val.amountInput || 0), 0);

    const restanteCents = Math.max(0, totalCents - sumOthersCents);
    setSplitMap((prev) => ({
      ...prev,
      [targetCode]: {
        amountInput: (restanteCents / 100).toString(),
        reference: prev[targetCode]?.reference || "",
      },
    }));

    // Enfocar el input
    setTimeout(() => {
      splitInputRefs.current[targetCode]?.focus();
      splitInputRefs.current[targetCode]?.select();
    }, 40);
  };

  // Limpiar un método del cobro mixto
  const handleClearMethod = (methodCode: string) => {
    setSplitMap((prev) => ({
      ...prev,
      [methodCode]: {
        amountInput: "",
        reference: "",
      },
    }));
  };

  // Enviar confirmación de cobro
  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);

    // Validación crítica de Venta a Crédito: Requiere Cliente Titular de la Cartera
    if (requiresCustomer && !customer) {
      setError("⚠️ Esta venta incluye Crédito Comercial. Debes seleccionar o registrar el cliente titular de la cuenta por cobrar (CxC).");
      setIsCustomerModalOpen(true);
      return;
    }

    // Caso 1: Modo Mixto
    if (isSplitMode) {
      if (totalAsignadoMixtoCents < totalCents) {
        setError(`Monto insuficiente. Faltan ${formatCents(saldoPendienteCents)} por cubrir.`);
        return;
      }

      // Validar que medios no efectivos no hayan recibido más del valor de la venta
      for (const [code, val] of Object.entries(splitMap)) {
        const cVal = toCents(val.amountInput || 0);
        if (cVal <= 0) continue;
        const m = availableMethods.find((x) => x.code === code);
        const isCash = m?.type === "EFECTIVO" || code.toLowerCase().includes("cash") || code.toLowerCase().includes("efectivo");
        if (!isCash && cVal > totalCents) {
          setError(`El método ${m?.name || code} no admite sobrepago ni vuelto. Máximo: ${formatCents(totalCents)}`);
          return;
        }
      }

      const paymentsToSend: PaymentInput[] = Object.entries(splitMap)
        .map(([code, val]) => ({
          method: code,
          amountCents: toCents(val.amountInput || 0),
          reference: val.reference.trim() || undefined,
        }))
        .filter((p) => p.amountCents > 0);

      if (paymentsToSend.length === 0) {
        setError("Ingresa al menos un medio con valor mayor a cero.");
        return;
      }

      setLoading(true);
      try {
        await onConfirm(paymentsToSend, customer?.id);
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
      ], customer?.id);
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

      // Atajo Enter para confirmar cobro e imprimir
      if (e.key === "Enter") {
        if (isCustomerModalOpen) return;
        e.preventDefault();
        handleSubmit();
        return;
      }

      // Atajo F2 para seleccionar o cambiar cliente
      if (e.key === "F2") {
        e.preventDefault();
        setIsCustomerModalOpen(true);
        return;
      }

      // Atajo F10 para alternar Modo Dividido / Mixto
      if (e.key === "F10") {
        e.preventDefault();
        toggleSplitMode();
        return;
      }

      // En modo simple, atajos F1 - F8 para seleccionar medio de pago
      if (!isSplitMode) {
        const fKeyMatch = e.key.match(/^F([1-9])$/);
        if (fKeyMatch) {
          const index = parseInt(fKeyMatch[1], 10) - 1;
          if (index < availableMethods.length) {
            e.preventDefault();
            setSelectedMethodCode(availableMethods[index].code);
          }
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, availableMethods, isSplitMode, splitMap, pagoCents, customer, requiresCustomer]);

  if (!isOpen) return null;

  const getMethodIcon = (type: string, code: string) => {
    const t = (type || "").toUpperCase();
    const c = (code || "").toLowerCase();
    if (t === "EFECTIVO" || c.includes("cash") || c.includes("efectivo")) return "💵";
    if (t === "TARJETA" || c.includes("card") || c.includes("tarjeta")) return "💳";
    if (t === "CREDITO" || c.includes("credit") || c.includes("fiar")) return "📝";
    if (c.includes("nequi") || c.includes("daviplata") || t === "DIGITAL") return "📱";
    if (t === "BANCO" || c.includes("transfer")) return "🏦";
    return "🏷️";
  };

  const isFormValid = (
    isSplitMode
      ? totalAsignadoMixtoCents >= totalCents
      : pagoCents >= totalCents && (isCashMethod || pagoCents === totalCents)
  ) && (!requiresCustomer || !!customer);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 dark:bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 transition-colors"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-h-[92vh] flex flex-col rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 transition-all ${isSplitMode ? "max-w-4xl" : "max-w-2xl"}`}>
        {/* HEADER */}
        <div className="shrink-0 bg-gradient-to-r from-emerald-600 via-teal-700 to-slate-800 px-6 py-3.5 text-white flex items-center justify-between shadow">
          <div className="flex items-center gap-3">
            <span className="bg-black/25 text-xs px-2.5 py-1 rounded font-mono font-bold tracking-wide">
              F12
            </span>
            <div>
              <h2 className="text-base font-bold flex items-center gap-2">
                <span>{isSplitMode ? "Cobro Mixto / Múltiples Medios" : "Cobrar Venta"}</span>
                {isSplitMode && (
                  <span className="text-[10px] bg-emerald-500/30 border border-emerald-400/40 text-emerald-200 px-2 py-0.5 rounded-full font-mono uppercase font-bold">
                    Matriz Directa
                  </span>
                )}
              </h2>
              <p className="text-[11px] text-emerald-100/80">
                {isSplitMode
                  ? "Asigna directamente el monto a cada medio de pago sin pasos adicionales"
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

        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
          {/* BARRA DE CLIENTE (OBLIGATORIO PARA VENTA A CRÉDITO) */}
          <div
            className={`p-3 rounded-xl border transition-all flex items-center justify-between ${
              requiresCustomer && !customer
                ? "bg-amber-50 dark:bg-amber-950/70 border-amber-300 dark:border-amber-700/80 text-amber-900 dark:text-amber-200"
                : customer
                ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200"
                : "bg-slate-50 dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span className="text-base">{customer ? "👤" : requiresCustomer ? "⚠️" : "👤"}</span>
              <div>
                <div className="text-xs font-bold flex items-center gap-2">
                  <span>
                    {customer
                      ? customer.name
                      : requiresCustomer
                      ? "Cliente Requerido para Venta a Crédito (CxC)"
                      : "Cliente: Consumidor Final"}
                  </span>
                  {requiresCustomer && !customer && (
                    <span className="text-[10px] bg-amber-200 dark:bg-amber-900/80 text-amber-900 dark:text-amber-100 font-bold px-1.5 py-0.5 rounded uppercase">
                      Obligatorio
                    </span>
                  )}
                </div>
                <div className="text-[11px] opacity-80 mt-0.5 flex items-center gap-3">
                  {customer ? (
                    <>
                      {customer.taxId && (
                        <span>
                          Doc: <b className="font-mono">{customer.taxId}</b>
                        </span>
                      )}
                      {customer.phone && (
                        <span>
                          Tel: <b className="font-mono">{customer.phone}</b>
                        </span>
                      )}
                    </>
                  ) : (
                    <span>
                      {requiresCustomer
                        ? "Debes asociar el titular al que se le cargará esta cuenta por cobrar."
                        : "Asigna un cliente para registrar historial (Opcional)"}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsCustomerModalOpen(true)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                  requiresCustomer && !customer
                    ? "bg-amber-600 hover:bg-amber-500 text-white border-amber-500 shadow-sm"
                    : "bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700"
                }`}
              >
                <span>{customer ? "Cambiar (F2)" : "Seleccionar Cliente (F2)"}</span>
              </button>
              {customer && !requiresCustomer && (
                <button
                  type="button"
                  onClick={() => setCustomer(null)}
                  className="text-slate-400 hover:text-rose-500 text-sm px-1.5 py-1 rounded cursor-pointer transition-colors"
                  title="Quitar cliente y volver a Consumidor Final"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* ======================================================== */}
          {/* MODO 1: MATRIZ DIRECTA DE COBRO MIXTO (SIN PASO EXTRA)   */}
          {/* ======================================================== */}
          {isSplitMode ? (
            <div className="grid grid-cols-12 gap-5 items-start">
              {/* COLUMNA IZQUIERDA: MATRIZ DE MÉTODOS Y MONTOS (7 cols) */}
              <div className="col-span-12 lg:col-span-7 space-y-2.5">
                <div className="flex items-center justify-between pb-1">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                    <span>💳</span> Medios de Pago Habilitados
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Escribe el monto en cada medio directamente
                  </span>
                </div>

                <div className="max-h-[360px] overflow-y-auto space-y-2 pr-1">
                  {availableMethods.map((pm) => {
                    const currentVal = splitMap[pm.code]?.amountInput || "";
                    const currentRef = splitMap[pm.code]?.reference || "";
                    const currentCents = toCents(currentVal || 0);
                    const isMethodActive = currentCents > 0;
                    const isCash = pm.type === "EFECTIVO" || pm.code.toLowerCase().includes("cash") || pm.code.toLowerCase().includes("efectivo");

                    return (
                      <div
                        key={pm.id}
                        className={`p-3 rounded-2xl border transition-all duration-150 ${
                          isMethodActive
                            ? "bg-emerald-50/70 dark:bg-emerald-950/40 border-emerald-500/80 shadow-xs ring-1 ring-emerald-500/30"
                            : "bg-slate-50/70 hover:bg-slate-100/70 dark:bg-slate-800/50 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-700/80"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-lg">{getMethodIcon(pm.type, pm.code)}</span>
                            <span className="font-bold text-xs text-slate-800 dark:text-slate-100 truncate">
                              {pm.name}
                            </span>
                            {isCash && (
                              <span className="text-[10px] bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold px-1.5 py-0.5 rounded">
                                Da cambio
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5">
                            {/* Botón para asignar saldo restante con 1 solo toque */}
                            {saldoPendienteCents > 0 && currentCents === 0 && (
                              <button
                                type="button"
                                onClick={() => handleAssignRemainingToMethod(pm.code)}
                                className="px-2 py-0.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] shadow-xs cursor-pointer transition-colors flex items-center gap-1"
                                title="Asignar el saldo restante a este medio"
                              >
                                <span>+ Asignar Resto</span>
                                <span className="font-mono text-[10px] opacity-90">
                                  ({formatCents(saldoPendienteCents)})
                                </span>
                              </button>
                            )}

                            {isMethodActive && (
                              <button
                                type="button"
                                onClick={() => handleClearMethod(pm.code)}
                                className="text-slate-400 hover:text-rose-500 text-xs px-1.5 py-0.5 rounded cursor-pointer transition-colors"
                                title="Limpiar este método"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Renglón de Input de Monto y Referencia */}
                        <div className="grid grid-cols-12 gap-2 items-center">
                          <div className="col-span-7 relative">
                            <span className="absolute left-3 top-2 text-slate-400 font-mono text-sm font-bold pointer-events-none">
                              $
                            </span>
                            <input
                              ref={(el) => {
                                splitInputRefs.current[pm.code] = el;
                              }}
                              type="number"
                              step="any"
                              value={currentVal}
                              onChange={(e) => handleSplitAmountChange(pm.code, e.target.value)}
                              placeholder="0.00"
                              className={`w-full pl-7 pr-3 py-1.5 rounded-xl border text-sm font-mono font-bold transition-all focus:outline-none ${
                                isMethodActive
                                  ? "bg-white dark:bg-slate-900 border-emerald-500 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/50"
                                  : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 focus:border-emerald-500"
                              }`}
                            />
                          </div>

                          <div className="col-span-5">
                            <input
                              type="text"
                              value={currentRef}
                              onChange={(e) => handleSplitRefChange(pm.code, e.target.value)}
                              placeholder="Voucher / Ref (Opcional)"
                              className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono text-slate-700 dark:text-slate-300 focus:outline-none focus:border-emerald-500"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* COLUMNA DERECHA: RESUMEN FINANCIERO Y CUADRE (5 cols) */}
              <div className="col-span-12 lg:col-span-5 space-y-3.5 bg-slate-50 dark:bg-slate-950/80 p-5 rounded-2xl border border-slate-200 dark:border-slate-800">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 block pb-1 border-b border-slate-200 dark:border-slate-800">
                  📊 Balance de Pago Mixto
                </span>

                {/* 1. Total de la Venta */}
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-500 dark:text-slate-400">Total a Pagar:</span>
                  <span className="text-base font-black font-mono text-slate-900 dark:text-white">
                    {formatCents(totalCents)}
                  </span>
                </div>

                {/* 2. Total Asignado */}
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-500 dark:text-slate-400">Total Asignado:</span>
                  <span className="text-base font-black font-mono text-emerald-600 dark:text-emerald-400">
                    {formatCents(totalAsignadoMixtoCents)}
                  </span>
                </div>

                <div className="h-px bg-slate-200 dark:bg-slate-800 my-1" />

                {/* 3. Saldo Pendiente o Completo */}
                <div
                  className={`p-3 rounded-xl border flex items-center justify-between ${
                    saldoPendienteCents === 0
                      ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200"
                      : "bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-200"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span>{saldoPendienteCents === 0 ? "✅" : "⏳"}</span>
                    <span className="text-xs font-bold">
                      {saldoPendienteCents === 0 ? "¡Venta Cuadrada!" : "Resta por Asignar:"}
                    </span>
                  </div>
                  <span className="font-mono font-black text-sm">
                    {saldoPendienteCents === 0 ? "$0.00" : formatCents(saldoPendienteCents)}
                  </span>
                </div>

                {/* 4. Cambio / Vuelto en Efectivo */}
                <div className="flex items-center justify-between text-xs pt-1">
                  <span className="font-semibold text-slate-500 dark:text-slate-400">Cambio (Vuelto):</span>
                  <span className="text-base font-black font-mono text-emerald-700 dark:text-emerald-400">
                    {formatCents(cambioMixtoCents)}
                  </span>
                </div>

                {/* Desglose Rápido de Abonos */}
                <div className="pt-2 border-t border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 space-y-1">
                  <span className="font-bold text-slate-600 dark:text-slate-300 block mb-1">
                    Medios con abono:
                  </span>
                  {Object.entries(splitMap).filter(([, val]) => toCents(val.amountInput || 0) > 0).length === 0 ? (
                    <p className="italic text-slate-400">Ningún medio asignado todavía.</p>
                  ) : (
                    Object.entries(splitMap)
                      .filter(([, val]) => toCents(val.amountInput || 0) > 0)
                      .map(([code, val]) => {
                        const m = availableMethods.find((x) => x.code === code);
                        return (
                          <div key={code} className="flex items-center justify-between font-mono">
                            <span className="truncate max-w-[140px] text-slate-700 dark:text-slate-300">
                              • {m?.name || code}
                            </span>
                            <span className="font-bold text-slate-900 dark:text-slate-100">
                              {formatCents(toCents(val.amountInput || 0))}
                            </span>
                          </div>
                        );
                      })
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* ======================================================== */
            /* MODO 2: COBRO RÁPIDO CON UN SOLO MEDIO DE PAGO           */
            /* ======================================================== */
            <>
              {/* BOTONERA DINÁMICA DE MEDIOS DE PAGO */}
              <div>
                <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 flex items-center justify-between">
                  <span>Selecciona Método de Cobro</span>
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
                          onClick={() => setSelectedMethodCode(pm.code)}
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

              {/* TARJETAS FINANCIERAS RESUMEN EN MODO SIMPLE */}
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
                    Pago Recibido
                  </div>
                  <div
                    className={`text-lg font-black font-mono mt-1 ${
                      faltaSimpleCents > 0
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-emerald-600 dark:text-emerald-400"
                    }`}
                  >
                    {formatCents(pagoCents)}
                  </div>
                </div>

                {/* 3. Cambio (Vuelto) */}
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">
                    Cambio (Vuelto)
                  </div>
                  <div className="text-lg font-black font-mono mt-1 text-emerald-700 dark:text-emerald-400">
                    {formatCents(cambioSimpleCents)}
                  </div>
                </div>
              </div>

              {/* INPUTS DE PAGO Y REFERENCIA EN MODO SIMPLE */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                <div>
                  <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block mb-1">
                    Importe Entregado ($)
                  </label>
                  <input
                    ref={inputRef}
                    type="number"
                    step="any"
                    value={pagoInput}
                    onChange={(e) => setPagoInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSubmit();
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
                  <input
                    ref={refInputRef}
                    type="text"
                    value={refInput}
                    onChange={(e) => setRefInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSubmit();
                    }}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:border-emerald-500 rounded-xl py-2 px-3 text-xs text-slate-900 dark:text-white font-mono focus:outline-none"
                    placeholder="Ej: Aprobación #4829"
                  />
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
            </>
          )}
        </div>

        {/* FOOTER DE ACCIONES */}
        <div className="shrink-0 px-6 py-3.5 bg-slate-50 dark:bg-slate-950/80 flex gap-3 border-t border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold text-xs transition-colors cursor-pointer"
          >
            [Esc] Cancelar
          </button>

          <button
            type="button"
            onClick={() => handleSubmit()}
            disabled={loading || !isFormValid}
            className="flex-2 py-2.5 px-6 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-sm uppercase tracking-wider shadow-lg shadow-emerald-700/20 dark:shadow-emerald-950/40 transition-colors disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
          >
            {loading
              ? "Procesando…"
              : requiresCustomer && !customer
              ? "Asignar Cliente para Crédito"
              : isSplitMode
              ? "Confirmar Venta Mixta (Enter)"
              : "Cobrar e Imprimir (Enter)"}
          </button>
        </div>
      </div>

      {/* MODAL DE CLIENTES INLINE (F2) */}
      <CustomerModal
        isOpen={isCustomerModalOpen}
        currentCustomer={customer}
        onClose={() => {
          setIsCustomerModalOpen(false);
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
        onSelect={(selected) => {
          setCustomer(selected);
          setError(null);
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
      />
    </div>
  );
}
