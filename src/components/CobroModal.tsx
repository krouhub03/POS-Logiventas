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
  onConfirm: (payments: PaymentInput[], customerId?: number, shouldPrint?: boolean) => Promise<void>;
}

export function CobroModal({ totalCents, isOpen, initialCustomer, onClose, onConfirm }: CobroModalProps) {
  const [availableMethods, setAvailableMethods] = useState<PaymentMethod[]>([]);
  const [selectedMethodCode, setSelectedMethodCode] = useState<string>("cash");
  const [pagoInput, setPagoInput] = useState<string>("");
  const [refInput, setRefInput] = useState<string>("");
  const [isSplitMode, setIsSplitMode] = useState(false);
  const [splitMap, setSplitMap] = useState<Record<string, { amountInput: string; reference: string }>>({});
  const [customer, setCustomer] = useState<Customer | null>(initialCustomer || null);
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Impresión opcional de ticket persistida
  const [autoPrint, setAutoPrint] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem("pos_print_sale_ticket");
      return saved !== null ? saved === "true" : true;
    } catch {
      return true;
    }
  });

  const handleToggleAutoPrint = () => {
    setAutoPrint((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("pos_print_sale_ticket", String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const inputRef = useRef<HTMLInputElement>(null);
  const refInputRef = useRef<HTMLInputElement>(null);
  const splitInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const isSubmittingRef = useRef(false);
  const gridContainerRef = useRef<HTMLDivElement>(null);

  const availableMethodsRef = useRef<PaymentMethod[]>([]);
  availableMethodsRef.current = availableMethods;

  const selectedMethodCodeRef = useRef(selectedMethodCode);
  selectedMethodCodeRef.current = selectedMethodCode;

  const isSplitModeRef = useRef(isSplitMode);
  isSplitModeRef.current = isSplitMode;

  // Sincronizar cliente inicial y reiniciar campos al abrir
  useEffect(() => {
    if (isOpen) {
      isSubmittingRef.current = false;
      setCustomer(initialCustomer || null);
      setIsCustomerModalOpen(false);
      setPagoInput((totalCents / 100).toString());
      setRefInput("");
      setIsSplitMode(false);
      isSplitModeRef.current = false;
      setSplitMap({});
      setError(null);
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);

      api.sync
        .getPaymentMethods()
        .then((allMethods) => {
          const enabled = allMethods.filter((m) => m.active === 1 && m.terminalEnabled === 1);
          setAvailableMethods(enabled);
          availableMethodsRef.current = enabled;

          const defaultMethod =
            enabled.find(
              (m) => m.type === "EFECTIVO" || m.code.toLowerCase().includes("cash")
            ) || enabled[0];

          if (defaultMethod) {
            setSelectedMethodCode(defaultMethod.code);
            selectedMethodCodeRef.current = defaultMethod.code;
          } else {
            setSelectedMethodCode("cash");
            selectedMethodCodeRef.current = "cash";
          }
        })
        .catch((err) => {
          console.error("Error cargando medios de pago:", err);
          setSelectedMethodCode("cash");
          selectedMethodCodeRef.current = "cash";
        });
    }
  }, [isOpen, totalCents, initialCustomer]);

  const selectedMethodObj = availableMethods.find((m) => m.code === selectedMethodCode);
  const isCashMethod =
    selectedMethodCode === "cash" ||
    selectedMethodObj?.type === "EFECTIVO" ||
    selectedMethodCode.toLowerCase().includes("efectivo");

  const isCreditMethod =
    selectedMethodObj?.type === "CREDITO" ||
    selectedMethodCode.toLowerCase().includes("credito") ||
    selectedMethodCode.toLowerCase().includes("credit") ||
    selectedMethodCode.toLowerCase().includes("fiar") ||
    selectedMethodCode.toLowerCase().includes("cartera");

  // Verificar si algún método a crédito en modo mixto tiene asignado monto
  const hasCreditInSplit = Object.entries(splitMap).some(([code, data]) => {
    const mCents = toCents(data.amountInput || 0);
    if (mCents <= 0) return false;
    const mObj = availableMethods.find((m) => m.code === code);
    return (
      mObj?.type === "CREDITO" ||
      code.toLowerCase().includes("credit") ||
      code.toLowerCase().includes("credito") ||
      code.toLowerCase().includes("fiar") ||
      code.toLowerCase().includes("cartera")
    );
  });

  const requiresCustomer = isCreditMethod || (isSplitMode && hasCreditInSplit);

  // Cálculos en modo mixto (Split Ledger)
  const totalAsignadoMixtoCents = Object.values(splitMap).reduce(
    (acc, cur) => acc + toCents(cur.amountInput || 0),
    0
  );

  const saldoPendienteCents = Math.max(0, totalCents - totalAsignadoMixtoCents);

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

  // Activar un método simple
  const activateSingleMethod = (methodCode: string) => {
    isSplitModeRef.current = false;
    selectedMethodCodeRef.current = methodCode;
    setIsSplitMode(false);
    setSelectedMethodCode(methodCode);
    setError(null);
    const m = availableMethods.find((x) => x.code === methodCode);
    const isCash = m?.type === "EFECTIVO" || methodCode.toLowerCase().includes("cash") || methodCode.toLowerCase().includes("efectivo");
    if (!isCash) {
      setPagoInput((totalCents / 100).toString());
    }
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 40);
  };

  // Activar modo mixto
  const activateSplitMode = () => {
    setError(null);
    isSplitModeRef.current = true;
    setIsSplitMode(true);
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
  };

  // Obtener número de columnas reales de la cuadrícula de medios de pago
  const getGridCols = () => {
    if (gridContainerRef.current) {
      const template = window.getComputedStyle(gridContainerRef.current).gridTemplateColumns;
      if (template) {
        const parts = template.split(" ").filter((s) => s.trim().length > 0);
        if (parts.length > 0) return parts.length;
      }
    }
    return 4;
  };

  // Navegación con flechas del teclado en cuadrícula 2D (arriba, abajo, izquierda, derecha)
  const handleArrowNavigation = (directionKey: string) => {
    const currentMethods = availableMethodsRef.current;
    const codes = [...currentMethods.map((m) => m.code), "__split__"];
    const N = codes.length;
    if (N === 0) return;

    const currentCode = isSplitModeRef.current ? "__split__" : selectedMethodCodeRef.current;
    let curIdx = codes.indexOf(currentCode);
    if (curIdx === -1) curIdx = 0;

    const cols = getGridCols();
    let nextIdx = curIdx;

    if (directionKey === "ArrowRight") {
      nextIdx = (curIdx + 1) % N;
    } else if (directionKey === "ArrowLeft") {
      nextIdx = (curIdx - 1 + N) % N;
    } else if (directionKey === "ArrowDown") {
      if (curIdx + cols < N) {
        nextIdx = curIdx + cols;
      } else {
        const col = curIdx % cols;
        const totalRows = Math.ceil(N / cols);
        const currentRow = Math.floor(curIdx / cols);
        if (currentRow < totalRows - 1) {
          nextIdx = N - 1;
        } else {
          nextIdx = col < N ? col : 0;
        }
      }
    } else if (directionKey === "ArrowUp") {
      if (curIdx - cols >= 0) {
        nextIdx = curIdx - cols;
      } else {
        const col = curIdx % cols;
        const lastRow = Math.floor((N - 1) / cols);
        const candidate = lastRow * cols + col;
        nextIdx = candidate < N ? candidate : N - 1;
      }
    }

    if (nextIdx === curIdx && N > 1) return;

    const nextCode = codes[nextIdx];
    if (nextCode === "__split__") {
      activateSplitMode();
    } else {
      activateSingleMethod(nextCode);
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

  // Asignar saldo restante con 1 solo toque en modo mixto
  const handleAssignRemainingToMethod = (targetCode: string) => {
    setError(null);
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

  // Enviar confirmación de cobro con blindaje anti-duplicados
  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (loading || isSubmittingRef.current) return;
    setError(null);

    // Validación de Venta a Crédito: Requiere Cliente Titular de la Cartera
    if (requiresCustomer && !customer) {
      setError("⚠️ Esta venta incluye Crédito Comercial. Debes asignar el cliente titular de la cuenta por cobrar (CxC).");
      setIsCustomerModalOpen(true);
      return;
    }

    // Caso 1: Modo Mixto
    if (isSplitMode) {
      if (totalAsignadoMixtoCents < totalCents) {
        setError(`Monto insuficiente. Faltan ${formatCents(saldoPendienteCents)} por cubrir.`);
        return;
      }

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

      isSubmittingRef.current = true;
      setLoading(true);
      try {
        await onConfirm(paymentsToSend, customer?.id, autoPrint);
        onClose();
      } catch (err: unknown) {
        setError(String(err));
      } finally {
        isSubmittingRef.current = false;
        setLoading(false);
      }
      return;
    }

    // Caso 2: Modo Simple
    if (pagoCents < totalCents) {
      setError(`Monto insuficiente. Faltan ${formatCents(faltaSimpleCents)}.`);
      return;
    }

    if (!isCashMethod && pagoCents > totalCents) {
      setError(`Los pagos electrónicos o a crédito no generan cambio. Ingrese el monto exacto.`);
      return;
    }

    isSubmittingRef.current = true;
    setLoading(true);
    try {
      await onConfirm([
        {
          method: selectedMethodCode,
          amountCents: pagoCents,
          reference: refInput.trim() || undefined,
        },
      ], customer?.id, autoPrint);
      onClose();
    } catch (err: unknown) {
      setError(String(err));
    } finally {
      isSubmittingRef.current = false;
      setLoading(false);
    }
  };

  const handleSubmitRef = useRef(handleSubmit);
  handleSubmitRef.current = handleSubmit;

  const handleToggleAutoPrintRef = useRef(handleToggleAutoPrint);
  handleToggleAutoPrintRef.current = handleToggleAutoPrint;

  // Atajos de teclado
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }

      // Atajo Enter para confirmar cobro
      if (e.key === "Enter") {
        if (isCustomerModalOpen || loading || isSubmittingRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        handleSubmitRef.current();
        return;
      }

      // Atajo Ctrl+P para alternar impresión
      if ((e.ctrlKey || e.metaKey) && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        handleToggleAutoPrintRef.current();
        return;
      }

      // Navegación con flechas en la matriz de medios de pago
      if (["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)) {
        const isEditingRef = document.activeElement === refInputRef.current;
        const isEditingPago = document.activeElement === inputRef.current;

        // Si está en el campo de referencia (texto), solo Up y Down navegan
        if (isEditingRef) {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            e.stopPropagation();
            handleArrowNavigation(e.key);
          }
          return;
        }

        // Si está en pagoInput (número), prevenimos el spin nativo y navegamos
        if (isEditingPago) {
          e.preventDefault();
          e.stopPropagation();
          handleArrowNavigation(e.key);
          return;
        }

        // Cualquier otro foco en el modal
        e.preventDefault();
        e.stopPropagation();
        handleArrowNavigation(e.key);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, loading, isCustomerModalOpen]);

  if (!isOpen) return null;

  const getMethodIcon = (type: string, code: string) => {
    const t = (type || "").toUpperCase();
    const c = (code || "").toLowerCase();
    if (t === "EFECTIVO" || c.includes("cash") || c.includes("efectivo")) return "💵";
    if (t === "TARJETA" || c.includes("card") || c.includes("tarjeta") || c.includes("datafono")) return "💳";
    if (t === "CREDITO" || c.includes("credit") || c.includes("fiar") || c.includes("cartera")) return "📋";
    if (c.includes("nequi")) return "📱";
    if (c.includes("daviplata")) return "🟣";
    if (t === "DIGITAL") return "📱";
    if (t === "BANCO" || c.includes("transfer") || c.includes("bancolombia")) return "🏦";
    if (code === "__split__") return "🔄";
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
        {/* CABECERA MINIMALISTA Y SOBRIA */}
        <div className="shrink-0 bg-gradient-to-r from-emerald-600 via-teal-700 to-slate-800 px-6 py-4 text-white flex items-center justify-between shadow">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center text-lg shadow-inner">
              {isSplitMode ? "🔄" : "💰"}
            </div>
            <div>
              <h2 className="text-base font-bold flex items-center gap-2">
                <span>{isSplitMode ? "Cobro Mixto / Múltiples Medios" : "Cobrar Venta"}</span>
                {isSplitMode && (
                  <span className="text-[10px] bg-emerald-500/30 border border-emerald-400/40 text-emerald-200 px-2 py-0.5 rounded-full font-mono uppercase font-bold">
                    Pago Dividido
                  </span>
                )}
              </h2>
              <p className="text-[11px] text-emerald-100/80">
                {isSplitMode
                  ? "Asigna el monto a cada medio de pago y confirma con Enter"
                  : "Selecciona el método con las flechas [← ↑ → ↓] y confirma con Enter"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center font-bold text-sm cursor-pointer transition-colors"
            title="Cerrar ventana [Esc]"
          >
            ✕
          </button>
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
          {/* CUADRÍCULA DINÁMICA DE MEDIOS DE PAGO */}
          <div>
            <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <span>💳</span>
                <span>Método de Pago</span>
              </span>
              <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 flex items-center gap-1">
                <span>[← ↑ → ↓]</span> Navegar medios
              </span>
            </div>

            <div
              ref={gridContainerRef}
              className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2"
            >
              {availableMethods.map((pm) => {
                const isSelected = !isSplitMode && selectedMethodCode === pm.code;
                return (
                  <button
                    key={pm.id}
                    type="button"
                    onClick={() => activateSingleMethod(pm.code)}
                    className={`py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex flex-col items-center justify-center gap-1 border cursor-pointer ${
                      isSelected
                        ? "bg-emerald-600 text-white border-emerald-500 shadow-md shadow-emerald-700/20 scale-[1.02] ring-2 ring-emerald-400/40"
                        : "bg-slate-100 hover:bg-slate-200/80 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700"
                    }`}
                  >
                    <span className="text-xl">{getMethodIcon(pm.type, pm.code)}</span>
                    <span className="truncate max-w-[130px] text-center">{pm.name}</span>
                  </button>
                );
              })}

              {/* OPCIÓN PAGO MIXTO INTEGRADA EN LA CUADRÍCULA */}
              <button
                type="button"
                onClick={() => (isSplitMode ? activateSingleMethod(availableMethods[0]?.code || "cash") : activateSplitMode())}
                className={`py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex flex-col items-center justify-center gap-1 border cursor-pointer ${
                  isSplitMode
                    ? "bg-amber-600 text-white border-amber-500 shadow-md shadow-amber-700/20 scale-[1.02] ring-2 ring-amber-400/40"
                    : "bg-slate-100 hover:bg-slate-200/80 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700"
                }`}
                title="Dividir el total entre múltiples medios de pago"
              >
                <span className="text-xl">🔄</span>
                <span className="truncate max-w-[130px] text-center">Pago Mixto</span>
              </button>
            </div>
          </div>

          {/* AVISO DINÁMICO EXCLUSIVO PARA CRÉDITO DE CLIENTES */}
          {isCreditMethod && !isSplitMode && (
            <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700/80 flex items-center justify-between gap-3 animate-in fade-in duration-150">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-2xl shrink-0">📋</span>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-amber-900 dark:text-amber-200 truncate">
                    {customer ? `Titular: ${customer.name}` : "Venta a Crédito: Requiere Cliente Titular (CxC)"}
                  </div>
                  <div className="text-[11px] text-amber-700 dark:text-amber-400 font-mono mt-0.5">
                    {customer ? (
                      <span>
                        Cupo: <b>{formatCents(customer.creditLimitCents || 0)}</b> | Deuda actual:{" "}
                        <b>{formatCents(customer.currentBalanceCents || 0)}</b>
                      </span>
                    ) : (
                      "Asigna el cliente al que se le cargará esta cuenta por cobrar"
                    )}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsCustomerModalOpen(true)}
                className="shrink-0 px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold shadow-sm cursor-pointer transition-colors"
              >
                {customer ? "Cambiar Cliente" : "Asignar Cliente"}
              </button>
            </div>
          )}

          {/* ======================================================== */}
          {/* MODO 1: MATRIZ DIRECTA DE COBRO MIXTO                    */}
          {/* ======================================================== */}
          {isSplitMode ? (
            <div className="grid grid-cols-12 gap-5 items-start">
              {/* COLUMNA IZQUIERDA: MATRIZ DE MÉTODOS Y MONTOS (7 cols) */}
              <div className="col-span-12 lg:col-span-7 space-y-2.5">
                <div className="flex items-center justify-between pb-1">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                    <span>💳</span> Desglose por Medio
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
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleSubmit();
                                }
                              }}
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
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleSubmit();
                                }
                              }}
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

                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-500 dark:text-slate-400">Total a Pagar:</span>
                  <span className="text-base font-black font-mono text-slate-900 dark:text-white">
                    {formatCents(totalCents)}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-500 dark:text-slate-400">Total Asignado:</span>
                  <span className="text-base font-black font-mono text-emerald-600 dark:text-emerald-400">
                    {formatCents(totalAsignadoMixtoCents)}
                  </span>
                </div>

                <div className="h-px bg-slate-200 dark:bg-slate-800 my-1" />

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

                <div className="flex items-center justify-between text-xs pt-1">
                  <span className="font-semibold text-slate-500 dark:text-slate-400">Cambio (Vuelto):</span>
                  <span className="text-base font-black font-mono text-emerald-700 dark:text-emerald-400">
                    {formatCents(cambioMixtoCents)}
                  </span>
                </div>

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
              {/* CINTA UNIFICADA DE BALANCE FINANCIERO (NO CLICKEABLE) */}
              <div className="bg-slate-100 dark:bg-slate-900/90 rounded-2xl p-4 border border-slate-200 dark:border-slate-800">
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2 flex items-center gap-1.5">
                  <span>📊</span>
                  <span>Balance de Cobro</span>
                </div>
                <div className="grid grid-cols-3 divide-x divide-slate-200 dark:divide-slate-800 text-center">
                  <div className="px-2">
                    <span className="text-[11px] uppercase font-bold text-slate-500 dark:text-slate-400 block">
                      Total a Pagar
                    </span>
                    <span className="text-xl lg:text-2xl font-black text-slate-900 dark:text-white font-mono block mt-0.5">
                      {formatCents(totalCents)}
                    </span>
                  </div>

                  <div className="px-2">
                    <span className="text-[11px] uppercase font-bold text-slate-500 dark:text-slate-400 block">
                      Dinero Recibido
                    </span>
                    <span
                      className={`text-xl lg:text-2xl font-black font-mono block mt-0.5 ${
                        faltaSimpleCents > 0
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-emerald-600 dark:text-emerald-400"
                      }`}
                    >
                      {formatCents(pagoCents)}
                    </span>
                  </div>

                  <div className="px-2">
                    <span className="text-[11px] uppercase font-bold text-slate-500 dark:text-slate-400 block">
                      Cambio (Vuelto)
                    </span>
                    <span
                      className={`text-xl lg:text-2xl font-black font-mono block mt-0.5 ${
                        cambioSimpleCents > 0
                          ? "text-emerald-600 dark:text-emerald-400 font-black"
                          : "text-slate-400 dark:text-slate-500"
                      }`}
                    >
                      {formatCents(cambioSimpleCents)}
                    </span>
                  </div>
                </div>
              </div>

              {/* INPUTS DE PAGO Y REFERENCIA */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                      if (e.key === "Enter") {
                        e.preventDefault();
                        e.stopPropagation();
                        handleSubmit();
                        return;
                      }
                      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
                        e.preventDefault();
                        e.stopPropagation();
                        handleArrowNavigation(e.key);
                        return;
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
                  <input
                    ref={refInputRef}
                    type="text"
                    value={refInput}
                    onChange={(e) => setRefInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        e.stopPropagation();
                        handleSubmit();
                        return;
                      }
                      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                        e.preventDefault();
                        e.stopPropagation();
                        handleArrowNavigation(e.key);
                        return;
                      }
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
                        inputRef.current?.select();
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
        <div className="shrink-0 px-6 py-3.5 bg-slate-50 dark:bg-slate-950/80 flex items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="py-2.5 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold text-xs transition-colors cursor-pointer"
          >
            [Esc] Cancelar
          </button>

          <div className="flex items-center gap-3">
            {/* TOGGLE OPCIONAL DE IMPRESIÓN DE TICKET */}
            <button
              type="button"
              onClick={handleToggleAutoPrint}
              className={`py-2 px-3.5 rounded-xl border text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                autoPrint
                  ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800 shadow-xs"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-300 dark:border-slate-700"
              }`}
              title="Activar o desactivar la impresión física del ticket [Ctrl+P]"
            >
              <span className="text-sm">🖨️</span>
              <span>Ticket: <strong className="font-mono uppercase">{autoPrint ? "Sí" : "No"}</strong></span>
            </button>

            <button
              type="button"
              onClick={() => handleSubmit()}
              disabled={loading || !isFormValid}
              className="py-2.5 px-6 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-sm uppercase tracking-wider shadow-lg shadow-emerald-700/20 dark:shadow-emerald-950/40 transition-all disabled:opacity-40 disabled:pointer-events-none cursor-pointer flex items-center gap-2"
            >
              <span>
                {loading
                  ? "Procesando…"
                  : requiresCustomer && !customer
                  ? "Asignar Cliente para Crédito"
                  : isSplitMode
                  ? autoPrint
                    ? "Confirmar e Imprimir (Enter)"
                    : "Confirmar Venta Mixta (Enter)"
                  : autoPrint
                  ? "Cobrar e Imprimir (Enter)"
                  : "Cobrar Venta (Enter)"}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* MODAL DE CLIENTES INLINE */}
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
