import { useState, useEffect, useRef } from "react";
import { formatCents, toCents } from "../lib/money";
import type { PaymentInput } from "../types";

interface CobroModalProps {
  totalCents: number;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (payments: PaymentInput[]) => Promise<void>;
}

export function CobroModal({ totalCents, isOpen, onClose, onConfirm }: CobroModalProps) {
  const [method, setMethod] = useState<"cash" | "card" | "transfer">("cash");
  const [pagoInput, setPagoInput] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Inicializar pagoInput con el total al abrir
  useEffect(() => {
    if (isOpen) {
      setPagoInput((totalCents / 100).toString());
      setMethod("cash");
      setError(null);
      setTimeout(() => inputRef.current?.select(), 50);
    }
  }, [isOpen, totalCents]);

  const pagoCents = toCents(pagoInput || 0);
  const cambioCents = Math.max(0, pagoCents - totalCents);
  const faltaCents = Math.max(0, totalCents - pagoCents);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (pagoCents < totalCents) {
      setError(`Monto insuficiente. Faltan ${formatCents(faltaCents)}`);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await onConfirm([
        {
          method,
          amountCents: pagoCents,
        },
      ]);
      onClose();
    } catch (err: unknown) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "F1") {
        e.preventDefault();
        setMethod("cash");
      } else if (e.key === "F2") {
        e.preventDefault();
        setMethod("card");
      } else if (e.key === "F3") {
        e.preventDefault();
        setMethod("transfer");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Billetes rápidos sugeridos
  const sugerencias = [
    totalCents / 100,
    Math.ceil(totalCents / 5000) * 50,
    Math.ceil(totalCents / 10000) * 100,
    Math.ceil(totalCents / 20000) * 200,
    Math.ceil(totalCents / 50000) * 500,
  ].filter((v, idx, arr) => v >= totalCents / 100 && arr.indexOf(v) === idx && v > 0).slice(0, 4);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 dark:bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 transition-colors"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 transition-colors">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-600 to-teal-700 px-6 py-4 text-white flex items-center justify-between shadow">
          <div className="flex items-center gap-2">
            <span className="bg-black/20 text-xs px-2 py-0.5 rounded font-mono font-bold">
              F12
            </span>
            <h2 className="text-lg font-bold">Cobrar Venta</h2>
          </div>
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white text-lg font-bold px-2 py-1"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="bg-rose-50 dark:bg-rose-950/80 border-b border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 px-6 py-2.5 text-xs font-semibold">
            {error}
          </div>
        )}

        <div className="p-6 space-y-6">
          {/* Métodos de Pago */}
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setMethod("cash")}
              className={`py-3 px-2 rounded-xl text-xs font-bold transition-all flex flex-col items-center gap-1 border ${
                method === "cash"
                  ? "bg-emerald-600 text-white border-emerald-500 shadow-md shadow-emerald-700/20"
                  : "bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700"
              }`}
            >
              <span className="text-base">💵</span>
              <span>[F1] Efectivo</span>
            </button>
            <button
              type="button"
              onClick={() => setMethod("card")}
              className={`py-3 px-2 rounded-xl text-xs font-bold transition-all flex flex-col items-center gap-1 border ${
                method === "card"
                  ? "bg-emerald-600 text-white border-emerald-500 shadow-md shadow-emerald-700/20"
                  : "bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700"
              }`}
            >
              <span className="text-base">💳</span>
              <span>[F2] Tarjeta</span>
            </button>
            <button
              type="button"
              onClick={() => setMethod("transfer")}
              className={`py-3 px-2 rounded-xl text-xs font-bold transition-all flex flex-col items-center gap-1 border ${
                method === "transfer"
                  ? "bg-emerald-600 text-white border-emerald-500 shadow-md shadow-emerald-700/20"
                  : "bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700"
              }`}
            >
              <span className="text-base">📱</span>
              <span>[F3] Transfer / QR</span>
            </button>
          </div>

          {/* Tarjetas Financieras */}
          <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 grid grid-cols-3 gap-3 text-center">
            {/* Total */}
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">
                Total a Cobrar
              </div>
              <div className="text-xl font-black text-slate-900 dark:text-white font-mono mt-1">
                {formatCents(totalCents)}
              </div>
            </div>

            {/* Pago del cliente */}
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">
                Pago Recibido ($)
              </div>
              <input
                ref={inputRef}
                type="number"
                step="any"
                value={pagoInput}
                onChange={(e) => setPagoInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmit();
                }}
                className="w-full bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-700 focus:border-emerald-500 rounded-lg py-1 px-2 text-center text-slate-900 dark:text-white font-mono font-black text-xl focus:outline-none focus:ring-1 focus:ring-emerald-500 mt-0.5"
              />
            </div>

            {/* Cambio */}
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">
                Cambio (Vuelto)
              </div>
              <div
                className={`text-xl font-black font-mono mt-1 ${
                  faltaCents > 0
                    ? "text-rose-600 dark:text-rose-400 text-sm leading-6"
                    : "text-emerald-700 dark:text-emerald-400"
                }`}
              >
                {faltaCents > 0 ? `Faltan ${formatCents(faltaCents)}` : formatCents(cambioCents)}
              </div>
            </div>
          </div>

          {/* Billetes rápidos */}
          {method === "cash" && sugerencias.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Billetes rápidos:
              </span>
              {sugerencias.map((s, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setPagoInput(s.toString());
                    inputRef.current?.focus();
                  }}
                  className="px-3 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-mono text-xs font-bold transition-colors"
                >
                  ${s.toLocaleString()}
                </button>
              ))}
            </div>
          )}

          {/* Footer de Acciones */}
          <div className="pt-2 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold text-xs transition-colors"
            >
              [Esc] Cancelar
            </button>
            <button
              type="button"
              onClick={() => handleSubmit()}
              disabled={loading || pagoCents < totalCents}
              className="flex-2 py-3 px-6 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-sm uppercase tracking-wider shadow-lg shadow-emerald-700/20 dark:shadow-emerald-950/40 transition-colors disabled:opacity-40 disabled:pointer-events-none"
            >
              {loading ? "Procesando…" : "Cobrar e Imprimir (Enter)"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
