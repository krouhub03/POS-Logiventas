import { useState, useEffect, useRef } from "react";
import { api } from "../services/api";
import { formatCents } from "../lib/money";
import type { Product } from "../types";

interface SearchProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (product: Product) => void;
}

export function SearchProductModal({
  isOpen,
  onClose,
  onSelect,
}: SearchProductModalProps) {
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setSearch("");
      setSelectedIndex(0);
      setProducts([]);
      setTimeout(() => inputRef.current?.focus(), 50);
      api.products.list("").then((res) => setProducts(res)).catch(console.error);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const t = setTimeout(() => {
      setLoading(true);
      api.products
        .list(search)
        .then((list) => {
          setProducts(list);
          setSelectedIndex(0);
        })
        .finally(() => setLoading(false));
    }, 150);
    return () => clearTimeout(t);
  }, [search, isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, products.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (products[selectedIndex]) {
        onSelect(products[selectedIndex]);
        onClose();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 dark:bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 transition-colors"
      onKeyDown={handleKeyDown}
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-3xl max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 transition-colors">
        {/* Header */}
        <div className="bg-slate-50 dark:bg-slate-950 px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="bg-sky-100 dark:bg-sky-950/80 text-sky-800 dark:text-sky-400 border border-sky-300 dark:border-sky-800/40 text-xs px-2 py-0.5 rounded font-mono font-bold">
              F10
            </span>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Búsqueda de Productos
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 dark:hover:text-white text-lg font-bold"
          >
            ✕
          </button>
        </div>

        {/* Input de Búsqueda */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <input
            ref={inputRef}
            type="text"
            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white font-medium focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 text-sm placeholder:text-slate-400 dark:placeholder:text-slate-500"
            placeholder="Escribe nombre, código de barras o SKU… (Usa ↑ ↓ para navegar)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Tabla de Resultados */}
        <div className="flex-1 overflow-auto p-4 bg-slate-50 dark:bg-slate-950/50">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-bold">
                <th className="py-2 px-3">SKU / Código</th>
                <th className="py-2 px-3">Descripción</th>
                <th className="py-2 px-3 text-right">Precio</th>
                <th className="py-2 px-3 text-right">Existencia</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono text-xs">
              {products.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-slate-400 dark:text-slate-500 font-sans">
                    {loading ? "Buscando productos…" : "No se encontraron productos coincidentes"}
                  </td>
                </tr>
              ) : (
                products.map((p, idx) => {
                  const isSelected = idx === selectedIndex;
                  return (
                    <tr
                      key={p.id}
                      onClick={() => {
                        onSelect(p);
                        onClose();
                      }}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-sky-100 dark:bg-sky-950/50 text-sky-950 dark:text-sky-200 font-semibold border-l-4 border-l-sky-500"
                          : "hover:bg-slate-100 dark:hover:bg-slate-800/40 text-slate-800 dark:text-slate-200"
                      }`}
                    >
                      <td className="py-2.5 px-3">{p.barcode || p.sku}</td>
                      <td className="py-2.5 px-3 font-sans font-medium">{p.name}</td>
                      <td className="py-2.5 px-3 text-right font-bold text-emerald-700 dark:text-emerald-400">
                        {formatCents(p.priceCents)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-600 dark:text-slate-400">
                        <span className={p.stock <= p.minStock ? "text-rose-600 dark:text-rose-400 font-bold" : ""}>
                          {p.stock} {p.unit}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="bg-slate-50 dark:bg-slate-950 px-6 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>[↑ ↓] Seleccionar · [Enter] Agregar · [Esc] Salir</span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
