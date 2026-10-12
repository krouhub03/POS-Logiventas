import { useState, useEffect, useRef } from "react";
import { toCents } from "../lib/money";

interface VariosModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (description: string, priceCents: number, quantity: number) => void;
}

export function VariosModal({ isOpen, onClose, onAdd }: VariosModalProps) {
  const [desc, setDesc] = useState("Artículo común / Varios");
  const [priceInput, setPriceInput] = useState("");
  const [qtyInput, setQtyInput] = useState("1");
  const priceRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setDesc("Artículo común / Varios");
      setPriceInput("");
      setQtyInput("1");
      setTimeout(() => {
        priceRef.current?.focus();
        priceRef.current?.select();
      }, 50);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const priceNum = parseFloat(priceInput.replace(/[^0-9.]/g, ""));
    const qtyNum = parseFloat(qtyInput) || 1;

    if (isNaN(priceNum) || priceNum <= 0) {
      alert("Por favor ingrese un precio válido");
      return;
    }

    const priceCents = toCents(priceNum);
    onAdd(desc.trim() || "Artículo común", priceCents, qtyNum);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="bg-gradient-to-r from-emerald-600 to-teal-700 p-4 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="bg-black/20 text-xs px-2 py-0.5 rounded font-mono font-bold">INS</span>
            <h2 className="text-lg font-bold">Vender Artículo Común / Varios</h2>
          </div>
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white text-lg font-bold px-2 py-1"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-wider font-semibold text-slate-400 mb-1">
              Descripción del producto o servicio
            </label>
            <input
              type="text"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-medium focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              placeholder="Ej. Recarga, Servicio técnico, Dulce suelto..."
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs uppercase tracking-wider font-semibold text-slate-400 mb-1">
                Precio Unitario ($)
              </label>
              <input
                ref={priceRef}
                type="text"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                placeholder="0.00"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-bold text-lg focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider font-semibold text-slate-400 mb-1">
                Cantidad
              </label>
              <input
                type="number"
                step="any"
                min="0.01"
                value={qtyInput}
                onChange={(e) => setQtyInput(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-bold text-lg focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              />
            </div>
          </div>

          <div className="pt-2 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 px-4 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 font-medium transition-colors"
            >
              Cancelar (Esc)
            </button>
            <button
              type="submit"
              className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-lg shadow-emerald-950/40 transition-colors"
            >
              Agregar (Enter)
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
