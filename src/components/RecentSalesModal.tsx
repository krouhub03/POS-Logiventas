import { useState, useEffect, useCallback, useRef } from "react";
import { formatCents } from "../lib/money";
import { api } from "../services/api";
import type { SaleReceipt, SaleReturnDto, SaleSummaryItem } from "../types";
import { ReceiptModal } from "./ReceiptModal";
import { SaleReturnModal } from "./SaleReturnModal";

interface RecentSalesModalProps {
  isOpen: boolean;
  currentUserId?: number;
  terminalCode?: string;
  businessName?: string;
  businessNit?: string;
  onClose: () => void;
  onSaleReturned?: (ret: SaleReturnDto) => void;
}

export function RecentSalesModal({
  isOpen,
  currentUserId,
  terminalCode,
  businessName,
  businessNit,
  onClose,
  onSaleReturned,
}: RecentSalesModalProps) {
  const [sales, setSales] = useState<SaleSummaryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [loading, setLoading] = useState(false);
  const [selectedSaleId, setSelectedSaleId] = useState<number | null>(null);

  // Submodales
  const [viewingReceipt, setViewingReceipt] = useState<SaleReceipt | null>(null);
  const [returningSale, setReturningSale] = useState<SaleReceipt | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  const fetchSales = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.sales.listRecent({
        query: searchQuery.trim() || undefined,
        statusFilter: statusFilter !== "all" ? statusFilter : undefined,
        limit: 100,
      });
      setSales(data);
      if (data.length > 0 && selectedSaleId === null) {
        setSelectedSaleId(data[0].id);
      }
    } catch (err) {
      console.error("Error al cargar historial de ventas:", err);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, statusFilter, selectedSaleId]);

  useEffect(() => {
    if (isOpen) {
      fetchSales();
      setTimeout(() => searchInputRef.current?.focus(), 80);
    }
  }, [isOpen, fetchSales]);

  // Manejo de atajo Esc para cerrar el modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !viewingReceipt && !returningSale) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, viewingReceipt, returningSale, onClose]);

  const handleOpenReceipt = async (saleId: number) => {
    try {
      const detail = await api.sales.getDetail(saleId);
      setViewingReceipt(detail);
    } catch (err) {
      console.error("Error al obtener detalle de venta:", err);
    }
  };

  const handleOpenReturn = async (saleId: number) => {
    try {
      const detail = await api.sales.getDetail(saleId);
      setReturningSale(detail);
    } catch (err) {
      console.error("Error al preparar devolución:", err);
    }
  };

  const handleReturnSuccess = (ret: SaleReturnDto) => {
    fetchSales();
    onSaleReturned?.(ret);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-4xl w-full flex flex-col h-[85vh] overflow-hidden">
        {/* Cabecera */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/60">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center text-xl text-emerald-700 dark:text-emerald-400">
              🕒
            </span>
            <div>
              <h2 className="text-base font-bold text-slate-800 dark:text-white">
                Historial de Ventas y Devoluciones
              </h2>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Consulta de tickets, reimpresión oficial y emisión de Notas Crédito POS
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

        {/* Barra de Filtros y Búsqueda */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900">
          <div className="relative flex-1 min-w-[260px]">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por folio (ej. CAJA-01-000001), cliente, producto o código..."
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-900 dark:text-white outline-none focus:border-emerald-500"
            />
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
          </div>

          <div className="flex items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => setStatusFilter("all")}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                statusFilter === "all"
                  ? "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
              }`}
            >
              Todos ({sales.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("none")}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                statusFilter === "none"
                  ? "bg-emerald-700 text-white"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
              }`}
            >
              Sin Devolver
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("partial")}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                statusFilter === "partial"
                  ? "bg-amber-600 text-white"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
              }`}
            >
              Dev. Parcial
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("full")}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                statusFilter === "full"
                  ? "bg-rose-700 text-white"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
              }`}
            >
              Dev. Total
            </button>
          </div>
        </div>

        {/* Tabla de Ventas */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400">
              Cargando historial de ventas...
            </div>
          ) : sales.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <div className="text-3xl mb-2">🧾</div>
              <div className="text-sm font-bold text-slate-700 dark:text-slate-300">
                No se encontraron ventas
              </div>
              <div className="text-xs text-slate-400 mt-1">
                Intente con otro término de búsqueda o cambie el filtro
              </div>
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-100 dark:bg-slate-800/80 sticky top-0 border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase tracking-wider text-slate-600 dark:text-slate-400 font-bold z-10">
                <tr>
                  <th className="py-2.5 px-3">Folio</th>
                  <th className="py-2.5 px-3">Fecha y Hora</th>
                  <th className="py-2.5 px-3">Cliente</th>
                  <th className="py-2.5 px-3">Cajero</th>
                  <th className="py-2.5 px-3">Pago</th>
                  <th className="py-2.5 px-3 text-right">Total</th>
                  <th className="py-2.5 px-3 text-center">Estado</th>
                  <th className="py-2.5 px-3 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono">
                {sales.map((s) => {
                  const isSelected = selectedSaleId === s.id;
                  return (
                    <tr
                      key={s.id}
                      onClick={() => setSelectedSaleId(s.id)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-emerald-50/70 dark:bg-emerald-950/30"
                          : "hover:bg-slate-50 dark:hover:bg-slate-800/40"
                      }`}
                    >
                      <td className="py-2.5 px-3 font-bold text-slate-800 dark:text-slate-200">
                        {s.folio}
                      </td>
                      <td className="py-2.5 px-3 font-sans text-slate-500 text-[11px]">
                        {new Date(s.createdAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="py-2.5 px-3 font-sans text-slate-700 dark:text-slate-300">
                        <div className="font-medium truncate max-w-[130px]">
                          {s.customerName || "Consumidor Final"}
                        </div>
                        {s.customerTaxId && (
                          <div className="text-[10px] text-slate-400 font-mono">
                            {s.customerTaxId}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-sans text-slate-500 text-[11px] truncate max-w-[100px]">
                        {s.cashierName || "—"}
                      </td>
                      <td className="py-2.5 px-3 font-sans text-[11px] text-slate-600 dark:text-slate-400">
                        {s.paymentSummary}
                      </td>
                      <td className="py-2.5 px-3 text-right font-black text-slate-900 dark:text-white">
                        {formatCents(s.totalCents)}
                        {s.returnedCents > 0 && (
                          <div className="text-[10px] text-rose-600 font-bold">
                            -{formatCents(s.returnedCents)}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {s.returnStatus === "full" ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border border-rose-200">
                            Devuelto
                          </span>
                        ) : s.returnStatus === "partial" ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-200">
                            Parcial
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200">
                            Completada
                          </span>
                        )}
                        {s.reprintCount > 0 && (
                          <div className="text-[9px] text-slate-400 font-sans mt-0.5">
                            Copia x{s.reprintCount}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleOpenReceipt(s.id)}
                            className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold transition-colors"
                            title="Ver ticket térmico y reimprimir"
                          >
                            👁️
                          </button>
                          {s.returnStatus !== "full" && (
                            <button
                              type="button"
                              onClick={() => handleOpenReturn(s.id)}
                              className="px-2 py-1 rounded bg-amber-100 hover:bg-amber-200 dark:bg-amber-950/60 dark:hover:bg-amber-900 text-amber-800 dark:text-amber-200 text-xs font-bold transition-colors"
                              title="Hacer devolución total o parcial de este ticket"
                            >
                              ↩️
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs bg-slate-50 dark:bg-slate-800/60">
          <div className="text-slate-500">
            Mostrando <span className="font-bold">{sales.length}</span> venta(s)
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-semibold transition-colors"
          >
            Cerrar (Esc)
          </button>
        </div>
      </div>

      {/* Visor de Ticket Térmico / Reimpresión */}
      <ReceiptModal
        receipt={viewingReceipt}
        isOpen={viewingReceipt !== null}
        onClose={() => setViewingReceipt(null)}
        onRequestReturn={(r) => handleOpenReturn(r.id)}
        businessName={businessName}
        businessNit={businessNit}
        terminalCode={terminalCode}
      />

      {/* Asistente de Devolución */}
      <SaleReturnModal
        sale={returningSale}
        isOpen={returningSale !== null}
        currentUserId={currentUserId}
        onClose={() => setReturningSale(null)}
        onSuccess={handleReturnSuccess}
      />
    </div>
  );
}
