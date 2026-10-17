import { useState, useRef } from "react";
import { formatCents } from "../lib/money";
import { api } from "../services/api";
import type { SaleReceipt } from "../types";

interface ReceiptModalProps {
  receipt: SaleReceipt | null;
  isOpen: boolean;
  onClose: () => void;
  onRequestReturn?: (receipt: SaleReceipt) => void;
  businessName?: string;
  businessNit?: string;
  terminalCode?: string;
}

export function ReceiptModal({
  receipt: initialReceipt,
  isOpen,
  onClose,
  onRequestReturn,
  businessName = "LOGIVENTA POS",
  businessNit,
  terminalCode = "CAJA-01",
}: ReceiptModalProps) {
  const [currentReceipt, setCurrentReceipt] = useState<SaleReceipt | null>(initialReceipt);
  const [isReprinting, setIsReprinting] = useState(false);
  const printAreaRef = useRef<HTMLDivElement>(null);

  // Mantener actualizado el recibo si cambia la prop
  if (initialReceipt && initialReceipt.id !== currentReceipt?.id) {
    setCurrentReceipt(initialReceipt);
  }

  if (!isOpen || !currentReceipt) return null;

  const handlePrint = async () => {
    setIsReprinting(true);
    try {
      // Registrar la reimpresión en la base de datos (incrementa reprint_count)
      const updated = await api.sales.reprintSale(currentReceipt.id);
      setCurrentReceipt(updated);

      // Disparar spooler de impresión
      window.print();
    } catch (err) {
      console.error("Error al registrar reimpresión:", err);
      window.print();
    } finally {
      setIsReprinting(false);
    }
  };

  const isReprint = (currentReceipt.reprintCount || 0) > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-lg w-full flex flex-col max-h-[92vh] overflow-hidden">
        {/* Cabecera del Modal */}
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/60">
          <div className="flex items-center gap-2">
            <span className="text-lg">🧾</span>
            <div>
              <h2 className="text-sm font-bold text-slate-800 dark:text-white">
                Ticket de Venta {currentReceipt.folio}
              </h2>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {isReprint ? (
                  <span className="text-amber-600 dark:text-amber-400 font-bold">
                    Reimpresión #{currentReceipt.reprintCount}
                  </span>
                ) : (
                  <span>Emisión Original</span>
                )}
                {" • "}
                <span>{new Date(currentReceipt.createdAt).toLocaleString()}</span>
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

        {/* Visor de Tirilla Térmica (58mm/80mm) */}
        <div className="flex-1 overflow-y-auto p-4 bg-slate-100 dark:bg-slate-950 flex justify-center">
          <div
            ref={printAreaRef}
            className="w-full max-w-[340px] bg-white text-slate-900 p-5 rounded-lg shadow-sm border border-slate-200 font-mono text-[11px] leading-tight print:shadow-none print:border-none print:m-0 print:p-0 print:w-full print:max-w-none"
            style={{ fontFamily: "'Courier New', Courier, monospace" }}
          >
            {/* ENCABEZADO FISCAL */}
            <div className="text-center pb-3 border-b border-dashed border-slate-400">
              <div className="text-sm font-black uppercase tracking-wider">{businessName}</div>
              {businessNit && <div className="text-[10px]">NIT: {businessNit}</div>}
              <div className="text-[10px] text-slate-600">Terminal: {terminalCode}</div>
              <div className="text-[10px] text-slate-600">
                Fecha: {new Date(currentReceipt.createdAt).toLocaleString()}
              </div>
              <div className="text-xs font-black mt-1">TICKET: {currentReceipt.folio}</div>
              {currentReceipt.cashierName && (
                <div className="text-[10px] text-slate-600">Cajero: {currentReceipt.cashierName}</div>
              )}
            </div>

            {/* MARCA DE AGUA / SELLO DE REIMPRESIÓN */}
            {isReprint && (
              <div className="my-2 py-1 border-y-2 border-dashed border-amber-600 text-center font-black text-amber-800 text-[11px] bg-amber-50">
                *** COPIA DE TICKET #{currentReceipt.reprintCount} ***
                <div className="text-[9px] font-normal">REIMPRESIÓN SIN VALOR FISCAL ADICIONAL</div>
              </div>
            )}

            {/* DATOS DEL CLIENTE */}
            <div className="py-2 border-b border-dashed border-slate-400 text-[10px]">
              <div>
                <span className="font-bold">Cliente:</span>{" "}
                {currentReceipt.customerName || "Consumidor Final"}
              </div>
              {currentReceipt.customerTaxId && (
                <div>
                  <span className="font-bold">NIT/CC:</span> {currentReceipt.customerTaxId}
                </div>
              )}
            </div>

            {/* LISTA DE ARTÍCULOS */}
            <div className="py-2 border-b border-dashed border-slate-400">
              <div className="flex justify-between font-bold text-[10px] pb-1 border-b border-slate-300">
                <span>CANT. DESCRIPCIÓN</span>
                <span>TOTAL</span>
              </div>
              <div className="divide-y divide-slate-100">
                {currentReceipt.items.map((it) => (
                  <div key={it.id} className="py-1">
                    <div className="flex justify-between items-start">
                      <span className="font-medium pr-1">
                        {it.quantity} x {it.description}
                      </span>
                      <span className="font-bold shrink-0">{formatCents(it.totalCents)}</span>
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-500 pl-2">
                      <span>Precio: {formatCents(it.unitPriceCents)}</span>
                      {it.discountCents > 0 && (
                        <span className="text-rose-600">Desc: -{formatCents(it.discountCents)}</span>
                      )}
                    </div>
                    {it.returnedQuantity > 0 && (
                      <div className="text-[9px] text-amber-700 font-bold pl-2">
                        ↩ Devueltas: {it.returnedQuantity} unid.
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* TOTALES */}
            <div className="py-2 border-b border-dashed border-slate-400 space-y-1 text-[11px]">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span>{formatCents(currentReceipt.subtotalCents)}</span>
              </div>
              {currentReceipt.discountCents > 0 && (
                <div className="flex justify-between text-rose-600">
                  <span>Descuento:</span>
                  <span>-{formatCents(currentReceipt.discountCents)}</span>
                </div>
              )}
              {currentReceipt.taxCents > 0 && (
                <div className="flex justify-between">
                  <span>Impuestos (IVA):</span>
                  <span>{formatCents(currentReceipt.taxCents)}</span>
                </div>
              )}
              <div className="flex justify-between font-black text-xs pt-1 border-t border-slate-300">
                <span>TOTAL:</span>
                <span>{formatCents(currentReceipt.totalCents)}</span>
              </div>
              {currentReceipt.returnedCents > 0 && (
                <div className="flex justify-between text-amber-800 font-bold pt-0.5">
                  <span>Total Devuelto:</span>
                  <span>-{formatCents(currentReceipt.returnedCents)}</span>
                </div>
              )}
            </div>

            {/* FORMAS DE PAGO */}
            <div className="py-2 border-b border-dashed border-slate-400 text-[10px] space-y-0.5">
              <div className="font-bold text-slate-700 pb-0.5">FORMAS DE PAGO:</div>
              {currentReceipt.payments.map((p) => (
                <div key={p.id} className="flex justify-between">
                  <span>
                    {p.methodName}
                    {p.reference ? ` (${p.reference})` : ""}
                  </span>
                  <span className="font-semibold">{formatCents(p.amountCents)}</span>
                </div>
              ))}
              <div className="flex justify-between pt-1 border-t border-slate-200">
                <span>Total Pagado:</span>
                <span>{formatCents(currentReceipt.paidCents)}</span>
              </div>
              {currentReceipt.changeCents > 0 && (
                <div className="flex justify-between font-bold">
                  <span>Cambio / Vuelto:</span>
                  <span>{formatCents(currentReceipt.changeCents)}</span>
                </div>
              )}
            </div>

            {/* PIE DEL TICKET */}
            <div className="pt-3 text-center text-[10px] text-slate-600 space-y-1">
              <div>¡Gracias por su compra!</div>
              <div>Conserve este ticket para devoluciones o garantías.</div>
            </div>
          </div>
        </div>

        {/* Botones de Acción */}
        <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 bg-slate-50 dark:bg-slate-800/60">
          <div>
            {onRequestReturn && currentReceipt.returnStatus !== "full" && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onRequestReturn(currentReceipt);
                }}
                className="px-3.5 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-900/50 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800 text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <span>↩️</span>
                <span>Devolver Ítems</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs font-semibold transition-colors cursor-pointer"
            >
              Cerrar (Esc)
            </button>
            <button
              type="button"
              disabled={isReprinting}
              onClick={handlePrint}
              className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-2 shadow-sm transition-colors cursor-pointer disabled:opacity-50"
            >
              <span>🖨️</span>
              <span>{isReprint ? "Reimprimir Ticket" : "Imprimir Ticket"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
