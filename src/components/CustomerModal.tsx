import { useState, useEffect, useRef } from "react";
import { api } from "../services/api";
import type { Customer, CreateCustomerInput } from "../types";

interface CustomerModalProps {
  isOpen: boolean;
  currentCustomer?: Customer | null;
  onClose: () => void;
  onSelect: (customer: Customer | null) => void;
}

export function CustomerModal({
  isOpen,
  currentCustomer,
  onClose,
  onSelect,
}: CustomerModalProps) {
  const [mode, setMode] = useState<"search" | "create">("search");
  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Formulario nuevo cliente
  const [newName, setNewName] = useState("");
  const [newTaxId, setNewTaxId] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [creating, setCreating] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const newNameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setMode("search");
      setSearch("");
      setError(null);
      setSelectedIndex(0);
      setNewName("");
      setNewTaxId("");
      setNewPhone("");
      setNewEmail("");
      setNewAddress("");

      setTimeout(() => searchInputRef.current?.focus(), 50);

      setLoading(true);
      api.customers
        .list()
        .then((res) => {
          setCustomers(res);
          setSelectedIndex(0);
        })
        .catch((err) => {
          console.error("Error al cargar clientes:", err);
          setError("No se pudieron cargar los clientes locales.");
        })
        .finally(() => setLoading(false));
    }
  }, [isOpen]);

  // Búsqueda con debounce
  useEffect(() => {
    if (!isOpen || mode !== "search") return;
    const t = setTimeout(() => {
      setLoading(true);
      const query = search.trim();
      const fetchPromise = query ? api.customers.search(query) : api.customers.list();

      fetchPromise
        .then((res) => {
          setCustomers(res);
          setSelectedIndex(0);
        })
        .catch((err) => {
          console.error("Error buscando clientes:", err);
        })
        .finally(() => setLoading(false));
    }, 150);

    return () => clearTimeout(t);
  }, [search, isOpen, mode]);

  // Manejador de teclado en modo búsqueda
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }

    if (mode === "search") {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, customers.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (customers[selectedIndex]) {
          onSelect(customers[selectedIndex]);
          onClose();
        }
      } else if (e.key === "F2" || (e.ctrlKey && e.key.toLowerCase() === "n")) {
        e.preventDefault();
        setMode("create");
        setTimeout(() => newNameInputRef.current?.focus(), 50);
      }
    }
  };

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const name = newName.trim();
    if (!name) {
      setError("El nombre o razón social es obligatorio.");
      newNameInputRef.current?.focus();
      return;
    }

    setCreating(true);
    try {
      const input: CreateCustomerInput = {
        name,
        taxId: newTaxId.trim() || undefined,
        phone: newPhone.trim() || undefined,
        email: newEmail.trim() || undefined,
        address: newAddress.trim() || undefined,
      };

      const created = await api.customers.create(input);
      onSelect(created);
      onClose();
    } catch (err: unknown) {
      setError(String(err));
    } finally {
      setCreating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 dark:bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 transition-colors"
      onKeyDown={handleKeyDown}
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-2xl max-h-[88vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 transition-colors">
        {/* HEADER */}
        <div className="bg-gradient-to-r from-emerald-600 to-teal-700 px-6 py-4 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="bg-emerald-900/60 text-emerald-100 text-xs px-2.5 py-1 rounded font-mono font-bold">
              F2
            </span>
            <div>
              <h2 className="text-base font-bold flex items-center gap-2">
                <span>Gestión de Clientes</span>
                {currentCustomer && (
                  <span className="text-[11px] bg-emerald-500/30 text-emerald-100 px-2 py-0.5 rounded-full font-mono">
                    Actual: {currentCustomer.name}
                  </span>
                )}
              </h2>
              <p className="text-[11px] text-emerald-100/80">
                Selecciona el titular para ventas a crédito, historial comercial y cuentas por cobrar (CxC)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const nextMode = mode === "search" ? "create" : "search";
                setMode(nextMode);
                setError(null);
                setTimeout(() => {
                  if (nextMode === "create") newNameInputRef.current?.focus();
                  else searchInputRef.current?.focus();
                }, 50);
              }}
              className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border bg-white/10 hover:bg-white/20 border-white/20 text-white"
            >
              <span>{mode === "search" ? "+ Nuevo Cliente (Ctrl+N)" : "🔍 Volver a Buscar"}</span>
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

        {/* CONTENIDO SEGÚN MODO */}
        {mode === "search" ? (
          <div className="flex flex-col flex-1 overflow-hidden p-6 gap-4">
            {/* BARRA DE BÚSQUEDA */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  ref={searchInputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar cliente por Nombre, Cédula/NIT o Teléfono..."
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 focus:border-emerald-500 rounded-xl py-2.5 pl-10 pr-4 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <span className="absolute left-3.5 top-3 text-slate-400 text-sm">🔍</span>
              </div>

              {currentCustomer && (
                <button
                  type="button"
                  onClick={() => {
                    onSelect(null);
                    onClose();
                  }}
                  className="px-3 py-2 bg-slate-100 hover:bg-rose-100 dark:bg-slate-800 dark:hover:bg-rose-950 text-slate-600 hover:text-rose-600 dark:text-slate-300 dark:hover:text-rose-300 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                  title="Desvincular cliente del ticket y volver a Consumidor Final"
                >
                  ✕ Quitar Cliente
                </button>
              )}
            </div>

            {/* LISTADO DE RESULTADOS */}
            <div className="flex-1 overflow-y-auto space-y-1.5 border border-slate-200 dark:border-slate-800 rounded-xl p-2 bg-slate-50/50 dark:bg-slate-950/40 min-h-[220px] max-h-[360px]">
              {loading && customers.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400 font-mono">
                  Buscando clientes…
                </div>
              ) : customers.length === 0 ? (
                <div className="py-10 text-center space-y-3">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    No se encontraron clientes con el término "{search}".
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("create");
                      setNewName(search);
                      setTimeout(() => newNameInputRef.current?.focus(), 50);
                    }}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
                  >
                    + Registrar "{search || "Nuevo Cliente"}"
                  </button>
                </div>
              ) : (
                customers.map((c, idx) => {
                  const isSelected = selectedIndex === idx;
                  const isCurrent = currentCustomer?.id === c.id;

                  return (
                    <div
                      key={c.id}
                      onClick={() => {
                        onSelect(c);
                        onClose();
                      }}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                        isSelected
                          ? "bg-emerald-50 dark:bg-emerald-950/50 border-emerald-400 dark:border-emerald-600 shadow-xs"
                          : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs uppercase ${
                            isSelected
                              ? "bg-emerald-600 text-white"
                              : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                          }`}
                        >
                          {c.name.substring(0, 2)}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-slate-900 dark:text-white">
                              {c.name}
                            </span>
                            {isCurrent && (
                              <span className="text-[10px] font-mono bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 px-2 py-0.2 rounded font-semibold">
                                Asignado
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {c.taxId && <span>Doc: <span className="font-mono text-slate-700 dark:text-slate-300">{c.taxId}</span></span>}
                            {c.phone && <span>Tel: <span className="font-mono text-slate-700 dark:text-slate-300">{c.phone}</span></span>}
                            {c.address && <span className="truncate max-w-[160px]">{c.address}</span>}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {isSelected && (
                          <span className="hidden sm:inline-block text-[10px] font-mono font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-100/70 dark:bg-emerald-900/40 px-2 py-1 rounded">
                            Enter para Seleccionar
                          </span>
                        )}
                        <span className="text-slate-400 text-sm">➔</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* AYUDA / ATAJOS */}
            <div className="flex items-center justify-between text-[11px] text-slate-400 dark:text-slate-500 pt-1 border-t border-slate-100 dark:border-slate-800">
              <div className="flex gap-4">
                <span><kbd className="font-mono bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded text-[10px]">↑↓</kbd> Navegar</span>
                <span><kbd className="font-mono bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded text-[10px]">Enter</kbd> Seleccionar</span>
                <span><kbd className="font-mono bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded text-[10px]">Esc</kbd> Cerrar</span>
              </div>
              <span className="font-mono">{customers.length} cliente(s)</span>
            </div>
          </div>
        ) : (
          /* MODO FORMULARIO: REGISTRAR NUEVO CLIENTE */
          <form onSubmit={handleCreateCustomer} className="p-6 space-y-4">
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  Nombre Completo o Razón Social <span className="text-rose-500">*</span>
                </label>
                <input
                  ref={newNameInputRef}
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ej: Carlos Alberto Restrepo / Tienda La 45"
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 focus:border-emerald-500 rounded-xl py-2 px-3 text-sm text-slate-900 dark:text-white focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Cédula / NIT / Identificación
                  </label>
                  <input
                    type="text"
                    value={newTaxId}
                    onChange={(e) => setNewTaxId(e.target.value)}
                    placeholder="Ej: 1020304050"
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 focus:border-emerald-500 rounded-xl py-2 px-3 text-sm text-slate-900 dark:text-white font-mono focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Teléfono / WhatsApp
                  </label>
                  <input
                    type="tel"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder="Ej: 3001234567"
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 focus:border-emerald-500 rounded-xl py-2 px-3 text-sm text-slate-900 dark:text-white font-mono focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Correo Electrónico (Opcional)
                  </label>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="cliente@ejemplo.com"
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 focus:border-emerald-500 rounded-xl py-2 px-3 text-sm text-slate-900 dark:text-white focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Dirección (Opcional)
                  </label>
                  <input
                    type="text"
                    value={newAddress}
                    onChange={(e) => setNewAddress(e.target.value)}
                    placeholder="Carrera 10 # 20 - 30"
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 focus:border-emerald-500 rounded-xl py-2 px-3 text-sm text-slate-900 dark:text-white focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-xl text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
              <span>💡</span>
              <span>
                El cliente se guardará de forma local inmediatamente y se sincronizará con Megalider ERP en segundo plano.
              </span>
            </div>

            <div className="flex gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setMode("search")}
                className="flex-1 py-2.5 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold text-xs transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={creating || !newName.trim()}
                className="flex-2 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wide transition-colors cursor-pointer disabled:opacity-50"
              >
                {creating ? "Guardando…" : "Guardar y Asignar Cliente (Enter)"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
