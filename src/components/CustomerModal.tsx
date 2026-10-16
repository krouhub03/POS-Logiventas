import { useState, useEffect, useRef } from "react";
import { api } from "../services/api";
import { formatCents, toCents } from "../lib/money";
import type { Customer, CreateCustomerInput, RecordCustomerPaymentInput } from "../types";

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
  const [mode, setMode] = useState<"search" | "create" | "payment">("search");
  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Formulario nuevo cliente
  const [newName, setNewName] = useState("");
  const [newTaxId, setNewTaxId] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newCreditLimitStr, setNewCreditLimitStr] = useState("");
  const [newCreditDays, setNewCreditDays] = useState(30);
  const [creating, setCreating] = useState(false);

  // Formulario de Abono a Cartera
  const [paymentCustomer, setPaymentCustomer] = useState<Customer | null>(null);
  const [paymentAmountStr, setPaymentAmountStr] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentRef, setPaymentRef] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const newNameInputRef = useRef<HTMLInputElement>(null);
  const paymentAmountInputRef = useRef<HTMLInputElement>(null);

  const reloadCustomers = () => {
    setLoading(true);
    const query = search.trim();
    const fetchPromise = query ? api.customers.search(query) : api.customers.list();
    fetchPromise
      .then((res) => {
        setCustomers(res);
      })
      .catch((err) => {
        console.error("Error cargando clientes:", err);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (isOpen) {
      setMode("search");
      setSearch("");
      setError(null);
      setSuccessMsg(null);
      setSelectedIndex(0);
      setNewName("");
      setNewTaxId("");
      setNewPhone("");
      setNewEmail("");
      setNewAddress("");
      setNewCreditLimitStr("");
      setNewCreditDays(30);

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
      reloadCustomers();
    }, 150);

    return () => clearTimeout(t);
  }, [search, isOpen, mode]);

  // Manejador de teclado en modo búsqueda
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (mode !== "search") {
        setMode("search");
        setTimeout(() => searchInputRef.current?.focus(), 50);
      } else {
        onClose();
      }
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
      const creditLimitCents = newCreditLimitStr.trim() ? toCents(newCreditLimitStr) : 0;
      const input: CreateCustomerInput = {
        name,
        taxId: newTaxId.trim() || undefined,
        phone: newPhone.trim() || undefined,
        email: newEmail.trim() || undefined,
        address: newAddress.trim() || undefined,
        creditLimitCents,
        creditDays: newCreditDays,
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

  const handleOpenPayment = (customer: Customer, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setPaymentCustomer(customer);
    setPaymentAmountStr("");
    setPaymentMethod("cash");
    setPaymentRef("");
    setPaymentNotes("");
    setError(null);
    setSuccessMsg(null);
    setMode("payment");
    setTimeout(() => paymentAmountInputRef.current?.focus(), 50);
  };

  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentCustomer) return;

    const amountCents = toCents(paymentAmountStr);
    if (amountCents <= 0) {
      setError("El importe del abono debe ser mayor a cero.");
      paymentAmountInputRef.current?.focus();
      return;
    }

    setPaymentSubmitting(true);
    setError(null);

    try {
      const input: RecordCustomerPaymentInput = {
        customerId: paymentCustomer.id,
        userId: 1, // Usuario actual autenticado
        paymentMethodId: paymentMethod,
        method: paymentMethod === "cash" ? "Efectivo" : paymentMethod === "transfer" ? "Transferencia" : "Tarjeta",
        amountCents,
        reference: paymentRef.trim() || undefined,
        notes: paymentNotes.trim() || undefined,
      };

      const receipt = await api.customers.recordPayment(input);
      setSuccessMsg(
        `✓ Abono por ${formatCents(receipt.amountCents)} registrado exitosamente (Recibo #${receipt.folio}). Nuevo saldo: ${formatCents(receipt.newBalanceCents)}.`
      );

      // Recargar lista y volver a búsqueda tras breve retardo
      reloadCustomers();
      setTimeout(() => {
        setMode("search");
        setPaymentCustomer(null);
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }, 1800);
    } catch (err: unknown) {
      setError(String(err));
    } finally {
      setPaymentSubmitting(false);
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
                <span>Gestión de Clientes y Cartera (CxC)</span>
                {currentCustomer && (
                  <span className="text-[11px] bg-emerald-500/30 text-emerald-100 px-2 py-0.5 rounded-full font-mono">
                    Actual: {currentCustomer.name}
                  </span>
                )}
              </h2>
              <p className="text-[11px] text-emerald-100/80">
                Selecciona titular para venta a crédito, consulta saldos y recibe abonos en mostrador
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {mode === "search" ? (
              <button
                type="button"
                onClick={() => {
                  setMode("create");
                  setError(null);
                  setTimeout(() => newNameInputRef.current?.focus(), 50);
                }}
                className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border bg-white/10 hover:bg-white/20 border-white/20 text-white"
              >
                <span>+ Nuevo Cliente (Ctrl+N)</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setMode("search");
                  setError(null);
                  setTimeout(() => searchInputRef.current?.focus(), 50);
                }}
                className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border bg-white/10 hover:bg-white/20 border-white/20 text-white"
              >
                <span>🔍 Volver a Buscar</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="text-white/80 hover:text-white text-lg font-bold px-2 py-1 cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>

        {/* FEEDBACK & ERRORES */}
        {error && (
          <div className="bg-rose-50 dark:bg-rose-950/60 border-b border-rose-200 dark:border-rose-900/50 px-6 py-2.5 text-xs text-rose-700 dark:text-rose-300 font-semibold flex items-center justify-between">
            <span>⚠️ {error}</span>
            <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-600">✕</button>
          </div>
        )}

        {successMsg && (
          <div className="bg-emerald-50 dark:bg-emerald-950/60 border-b border-emerald-200 dark:border-emerald-900/50 px-6 py-2.5 text-xs text-emerald-700 dark:text-emerald-300 font-semibold">
            {successMsg}
          </div>
        )}

        {/* CONTENIDO SEGÚN MODO */}
        {mode === "search" ? (
          <div className="flex-1 overflow-hidden flex flex-col p-4 sm:p-6 space-y-4">
            {/* INPUT DE BÚSQUEDA */}
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">🔍</span>
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por Nombre, Cédula/NIT o Teléfono..."
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 focus:border-emerald-500 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none transition-colors"
              />
              {loading && (
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 animate-spin">
                  ⏳
                </span>
              )}
            </div>

            {/* LISTA DE CLIENTES */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-[260px] max-h-[380px]">
              {customers.length === 0 && !loading ? (
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
                  const hasDebt = (c.currentBalanceCents || 0) > 0;
                  const hasCreditLimit = (c.creditLimitCents || 0) > 0;

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
                            {hasDebt && (
                              <span className="text-[10px] font-mono bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 px-2 py-0.2 rounded font-bold">
                                Saldo: {formatCents(c.currentBalanceCents)}
                              </span>
                            )}
                            {hasCreditLimit && !hasDebt && (
                              <span className="text-[10px] font-mono bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-900 px-1.5 py-0.2 rounded">
                                Cupo: {formatCents(c.creditLimitCents)}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {c.taxId && <span>Doc: <span className="font-mono text-slate-700 dark:text-slate-300">{c.taxId}</span></span>}
                            {c.phone && <span>Tel: <span className="font-mono text-slate-700 dark:text-slate-300">{c.phone}</span></span>}
                            {c.address && <span className="truncate max-w-[140px]">{c.address}</span>}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* BOTÓN RÁPIDO PARA ABONAR A CUENTA */}
                        <button
                          type="button"
                          onClick={(e) => handleOpenPayment(c, e)}
                          title="Registrar abono de dinero a su cuenta de crédito"
                          className="px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-300/60 dark:border-amber-700/60 transition-colors cursor-pointer flex items-center gap-1"
                        >
                          <span>💵</span>
                          <span>Abonar</span>
                        </button>

                        {isSelected && (
                          <span className="hidden sm:inline-block text-[10px] font-mono font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-100/70 dark:bg-emerald-900/40 px-2 py-1 rounded">
                            Enter
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
        ) : mode === "payment" && paymentCustomer ? (
          /* MODO ABONO A CUENTA / CARTERA */
          <form onSubmit={handleSubmitPayment} className="p-6 space-y-4">
            <div className="p-4 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold block">Cliente Titular</span>
                <span className="text-sm font-bold text-slate-900 dark:text-white">{paymentCustomer.name}</span>
                {paymentCustomer.taxId && <span className="text-xs text-slate-500 font-mono ml-2">({paymentCustomer.taxId})</span>}
              </div>
              <div className="text-right">
                <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold block">Saldo Deudor Actual</span>
                <span className="text-base font-mono font-black text-rose-600 dark:text-rose-400">
                  {formatCents(paymentCustomer.currentBalanceCents || 0)}
                </span>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  Monto a Abonar ($ COP) <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                  <input
                    ref={paymentAmountInputRef}
                    type="number"
                    step="100"
                    min="100"
                    required
                    value={paymentAmountStr}
                    onChange={(e) => setPaymentAmountStr(e.target.value)}
                    placeholder="0"
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:border-emerald-500 rounded-xl pl-8 pr-4 py-2.5 text-base font-mono font-bold text-slate-900 dark:text-white focus:outline-none"
                  />
                </div>
              </div>

              {/* BOTONES RÁPIDOS DE PAGO */}
              <div className="flex flex-wrap gap-2">
                {paymentCustomer.currentBalanceCents > 0 && (
                  <button
                    type="button"
                    onClick={() => setPaymentAmountStr((paymentCustomer.currentBalanceCents / 100).toString())}
                    className="px-3 py-1 rounded-lg text-xs font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 hover:bg-emerald-200 cursor-pointer"
                  >
                    Pagar Total ({formatCents(paymentCustomer.currentBalanceCents)})
                  </button>
                )}
                {paymentCustomer.currentBalanceCents > 0 && (
                  <button
                    type="button"
                    onClick={() => setPaymentAmountStr((Math.round(paymentCustomer.currentBalanceCents / 2) / 100).toString())}
                    className="px-3 py-1 rounded-lg text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 cursor-pointer"
                  >
                    50% ({formatCents(Math.round(paymentCustomer.currentBalanceCents / 2))})
                  </button>
                )}
                {[20000, 50000, 100000].map((quickVal) => (
                  <button
                    key={quickVal}
                    type="button"
                    onClick={() => setPaymentAmountStr(quickVal.toString())}
                    className="px-2.5 py-1 rounded-lg text-xs font-mono bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 cursor-pointer"
                  >
                    ${quickVal.toLocaleString("es-CO")}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <div>
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Medio de Recaudo
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:border-emerald-500 rounded-xl py-2 px-3 text-sm text-slate-900 dark:text-white focus:outline-none"
                  >
                    <option value="cash">💵 Efectivo (Cajón de Dinero)</option>
                    <option value="transfer">📱 Nequi / Daviplata / Transferencia</option>
                    <option value="card">💳 Tarjeta Débito / Crédito</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    N° Comprobante / Referencia (Opcional)
                  </label>
                  <input
                    type="text"
                    value={paymentRef}
                    onChange={(e) => setPaymentRef(e.target.value)}
                    placeholder="Ej: M12345 / Aprobación"
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:border-emerald-500 rounded-xl py-2 px-3 text-sm text-slate-900 dark:text-white font-mono focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  Notas u Observaciones del Abono
                </label>
                <input
                  type="text"
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  placeholder="Ej: Abono quincenal de factura anterior"
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 focus:border-emerald-500 rounded-xl py-2 px-3 text-sm text-slate-900 dark:text-white focus:outline-none"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setMode("search")}
                className="flex-1 py-2.5 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold text-xs transition-colors cursor-pointer"
              >
                Volver a la lista
              </button>
              <button
                type="submit"
                disabled={paymentSubmitting || !paymentAmountStr}
                className="flex-2 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wide transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <span>{paymentSubmitting ? "Registrando Abono…" : "Confirmar Abono e Imprimir Recibo"}</span>
              </button>
            </div>
          </form>
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
                    Cupo de Crédito Autorizado ($ COP)
                  </label>
                  <input
                    type="number"
                    step="1000"
                    min="0"
                    value={newCreditLimitStr}
                    onChange={(e) => setNewCreditLimitStr(e.target.value)}
                    placeholder="0 (Sin cupo)"
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 focus:border-emerald-500 rounded-xl py-2 px-3 text-sm text-slate-900 dark:text-white font-mono focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Plazo de Pago (Días)
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={newCreditDays}
                    onChange={(e) => setNewCreditDays(Number(e.target.value) || 30)}
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
