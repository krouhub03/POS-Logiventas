import { useState } from "react";
import { formatCents } from "../lib/money";
import { api } from "../services/api";
import type { SaleReceipt, SaleReturnDto } from "../types";

interface SaleReturnModalProps {
  sale: SaleReceipt | null;
  isOpen: boolean;
  currentUserId?: number;
  onClose: () => void;
  onSuccess: (result: SaleReturnDto) => void;
}

interface ReturnLineState {
  saleItemId: number;
  description: string;
  originalQty: number;
  availableQty: number;
  unitPriceCents: number;
  taxRateBp: number;
  quantityToReturn: number;
  disposition: "restock" | "merma";
}

export function SaleReturnModal({
  sale,
  isOpen,
  currentUserId,
  onClose,
  onSuccess,
}: SaleReturnModalProps) {
  if (!isOpen || !sale) return null;

  // Inicializar estado de las líneas con cantidad disponible
  const [lines, setLines] = useState<ReturnLineState[]>(() =>
    sale.items
      .map((it) => {
        const available = Math.max(0, it.quantity - (it.returnedQuantity || 0));
        return {
          saleItemId: it.id,
          description: it.description,
          originalQty: it.quantity,
          availableQty: available,
          unitPriceCents: it.unitPriceCents,
          taxRateBp: it.totalCents > 0 ? Math.round(((it.taxCents / (it.totalCents - it.taxCents + it.discountCents)) * 10000)) : 0,
          quantityToReturn: 0,
          disposition: "restock" as const,
        };
      })
      .filter((l) => l.availableQty > 0)
  );

  const [reason, setReason] = useState("");
  const [refundMethod, setRefundMethod] = useState<"cash" | "credit_balance" | "transfer">("cash");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Calcular montos proporcionales a devolver
  const totalRefundCents = lines.reduce((acc, l) => {
    if (l.quantityToReturn <= 0) return acc;
    const lineSubtotal = Math.round(l.quantityToReturn * l.unitPriceCents);
    const lineTax = l.taxRateBp > 0 ? Math.round((lineSubtotal * l.taxRateBp + 5000) / 10000) : 0;
    return acc + lineSubtotal + lineTax;
  }, 0);

  const totalItemsReturning = lines.reduce((acc, l) => acc + (l.quantityToReturn > 0 ? 1 : 0), 0);

  const handleSetAllMax = () => {
    setLines((prev) =>
      prev.map((l) => ({
        ...l,
        quantityToReturn: l.availableQty,
      }))
    );
  };

  const handleClearAll = () => {
    setLines((prev) =>
      prev.map((l) => ({
        ...l,
        quantityToReturn: 0,
      }))
    );
  };

  const handleUpdateLineQty = (saleItemId: number, qty: number) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.saleItemId !== saleItemId) return l;
        const valid = Math.max(0, Math.min(l.availableQty, qty));
        return { ...l, quantityToReturn: valid };
      })
    );
  };

  const handleUpdateLineDisposition = (saleItemId: number, disposition: "restock" | "merma") => {
    setLines((prev) =>
      prev.map((l) => (l.saleItemId === saleItemId ? { ...l, disposition } : l))
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const activeLines = lines.filter((l) => l.quantityToReturn > 0);
    if (activeLines.length === 0) {
      setError("Debe especificar al menos una cantidad mayor a cero para devolver.");
      return;
    }

    if (!reason.trim()) {
      setError("El motivo de la devolución es obligatorio por normativa fiscal y contable.");
      return;
    }

    if (refundMethod === "credit_balance" && !sale.customerId) {
      setError("Esta venta no tiene un cliente asignado para aplicar cruce de cartera.");
      return;
    }

    setLoading(true);
    try {
      const result = await api.sales.createReturn({
        saleId: sale.id,
        userId: currentUserId || null,
        reason: reason.trim(),
        refundMethod,
        notes: notes.trim() || null,
        items: activeLines.map((l) => ({
          saleItemId: l.saleItemId,
          quantity: l.quantityToReturn,
          inventoryDisposition: l.disposition,
        })),
      });

      onSuccess(result);
      onClose();
    } catch (err: unknown) {
      console.error("Error al procesar devolución:", err);
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const reasonPresets = [
    "Defecto de fábrica / Garantía",
    "Error en cobro o digitación",
    "Producto vencido o dañado",
    "Cliente cambió de opinión",
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-2xl w-full flex flex-col max-h-[92vh] overflow-hidden">
        {/* Cabecera */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-amber-500/10">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950 flex items-center justify-center text-xl text-amber-700 dark:text-amber-400">
              ↩️
            </span>
            <div>
              <h2 className="text-base font-bold text-slate-800 dark:text-white">
                Devolución / Nota Crédito POS
              </h2>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Ticket Original: <span className="font-mono font-bold">{sale.folio}</span>
                {sale.customerName && ` • Cliente: ${sale.customerName}`}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 rounded-xl text-rose-800 dark:text-rose-200 text-xs font-semibold flex items-center gap-2">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {/* Tabla de Artículos a Devolver */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                Seleccione Artículos y Cantidades
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSetAllMax}
                  className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline font-semibold"
                >
                  Devolver Todo
                </button>
                <span className="text-slate-300">•</span>
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="text-xs text-slate-500 hover:underline"
                >
                  Limpiar
                </button>
              </div>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
              {lines.map((line) => (
                <div
                  key={line.saleItemId}
                  className={`p-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                    line.quantityToReturn > 0
                      ? "bg-amber-50/50 dark:bg-amber-950/20"
                      : "bg-white dark:bg-slate-900"
                  }`}
                >
                  <div className="flex-1 min-w-[200px]">
                    <div className="font-semibold text-slate-800 dark:text-slate-200">
                      {line.description}
                    </div>
                    <div className="text-[11px] text-slate-500 flex gap-2 mt-0.5">
                      <span>Precio: {formatCents(line.unitPriceCents)}</span>
                      <span>•</span>
                      <span>
                        Disponible: <span className="font-bold">{line.availableQty}</span> (de {line.originalQty})
                      </span>
                    </div>
                  </div>

                  {/* Selector de Destino de Inventario */}
                  <div className="flex items-center gap-2 shrink-0">
                    <select
                      value={line.disposition}
                      onChange={(e) =>
                        handleUpdateLineDisposition(
                          line.saleItemId,
                          e.target.value as "restock" | "merma"
                        )
                      }
                      className="px-2 py-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-300"
                      title="Destino de las existencias físicas"
                    >
                      <option value="restock">📦 Reingreso (Sano)</option>
                      <option value="merma">⚠️ Merma (Avería)</option>
                    </select>

                    {/* Stepper de Cantidad */}
                    <div className="flex items-center border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 overflow-hidden">
                      <button
                        type="button"
                        onClick={() =>
                          handleUpdateLineQty(line.saleItemId, line.quantityToReturn - 1)
                        }
                        disabled={line.quantityToReturn <= 0}
                        className="px-2.5 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        max={line.availableQty}
                        value={line.quantityToReturn}
                        onChange={(e) =>
                          handleUpdateLineQty(
                            line.saleItemId,
                            parseFloat(e.target.value) || 0
                          )
                        }
                        className="w-14 text-center font-bold font-mono text-xs bg-transparent outline-none text-slate-800 dark:text-white"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          handleUpdateLineQty(line.saleItemId, line.quantityToReturn + 1)
                        }
                        disabled={line.quantityToReturn >= line.availableQty}
                        className="px-2.5 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Método de Reembolso */}
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 block mb-1.5">
              Método de Reembolso al Cliente
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <label
                className={`p-3 rounded-xl border flex items-center gap-2 cursor-pointer transition-all ${
                  refundMethod === "cash"
                    ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 font-bold"
                    : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 text-slate-700 dark:text-slate-300"
                }`}
              >
                <input
                  type="radio"
                  name="refundMethod"
                  value="cash"
                  checked={refundMethod === "cash"}
                  onChange={() => setRefundMethod("cash")}
                  className="sr-only"
                />
                <span className="text-base">💵</span>
                <div className="text-xs">
                  <div>Efectivo de Caja</div>
                  <div className="text-[10px] text-slate-500 font-normal">Resta del arqueo</div>
                </div>
              </label>

              <label
                className={`p-3 rounded-xl border flex items-center gap-2 cursor-pointer transition-all ${
                  !sale.customerId ? "opacity-50 pointer-events-none" : ""
                } ${
                  refundMethod === "credit_balance"
                    ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 font-bold"
                    : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 text-slate-700 dark:text-slate-300"
                }`}
              >
                <input
                  type="radio"
                  name="refundMethod"
                  value="credit_balance"
                  checked={refundMethod === "credit_balance"}
                  onChange={() => setRefundMethod("credit_balance")}
                  disabled={!sale.customerId}
                  className="sr-only"
                />
                <span className="text-base">💳</span>
                <div className="text-xs">
                  <div>Cruce Cartera</div>
                  <div className="text-[10px] text-slate-500 font-normal">
                    {sale.customerId ? "Descuenta deuda CxC" : "Requiere cliente"}
                  </div>
                </div>
              </label>

              <label
                className={`p-3 rounded-xl border flex items-center gap-2 cursor-pointer transition-all ${
                  refundMethod === "transfer"
                    ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 font-bold"
                    : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 text-slate-700 dark:text-slate-300"
                }`}
              >
                <input
                  type="radio"
                  name="refundMethod"
                  value="transfer"
                  checked={refundMethod === "transfer"}
                  onChange={() => setRefundMethod("transfer")}
                  className="sr-only"
                />
                <span className="text-base">🏦</span>
                <div className="text-xs">
                  <div>Transferencia</div>
                  <div className="text-[10px] text-slate-500 font-normal">Tesorería / Banco</div>
                </div>
              </label>
            </div>
          </div>

          {/* Motivo de la Devolución */}
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 block mb-1">
              Motivo de la Devolución *
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {reasonPresets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setReason(preset)}
                  className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${
                    reason === preset
                      ? "bg-amber-100 dark:bg-amber-900/60 border-amber-300 text-amber-900 dark:text-amber-200 font-semibold"
                      : "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100"
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Escriba o seleccione el motivo justificado de la devolución..."
              required
              className="w-full p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white outline-none focus:border-amber-500"
            />
          </div>

          {/* Observaciones adicionales */}
          <div>
            <label className="text-xs font-bold text-slate-500 dark:text-slate-400 block mb-1">
              Observaciones Adicionales (Opcional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Detalles sobre el estado del producto o soporte..."
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white outline-none"
            />
          </div>
        </form>

        {/* Footer con Resumen y Confirmación */}
        <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-800/60">
          <div>
            <div className="text-[11px] text-slate-500">
              Artículos a devolver: <span className="font-bold">{totalItemsReturning}</span>
            </div>
            <div className="text-base font-black text-rose-600 dark:text-rose-400 font-mono">
              Total a Reembolsar: {formatCents(totalRefundCents)}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs font-semibold transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading || totalRefundCents <= 0 || !reason.trim()}
              className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-all shadow-md active:scale-98 cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
            >
              {loading ? "Procesando..." : "Confirmar Devolución"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
