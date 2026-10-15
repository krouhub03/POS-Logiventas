import { useEffect, useState, useMemo, useCallback } from "react";
import { api } from "../services/api";
import { formatCents, toCents } from "../lib/money";
import { useModals } from "../contexts/ModalContext";
import type {
  Product,
  NewProduct,
  UpdateProductInput,
  InventoryMovement,
  StockAdjustmentInput,
} from "../types";

interface ProductsPageProps {
  initialTab?: "catalog" | "inventory" | "kardex";
  onBackToSales?: () => void;
}

export function ProductsPage({ initialTab = "catalog", onBackToSales }: ProductsPageProps) {
  const [activeTab, setActiveTab] = useState<"catalog" | "inventory" | "kardex">(initialTab);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "products" | "services" | "low_stock">("all");
  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const { confirm, alert: modalAlert } = useModals();

  // Modales
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [adjustingProduct, setAdjustingProduct] = useState<Product | null>(null);

  // Estado del formulario de creación/edición
  const [formIsService, setFormIsService] = useState(false);
  const [formSku, setFormSku] = useState("");
  const [formBarcode, setFormBarcode] = useState("");
  const [formName, setFormName] = useState("");
  const [formPriceStr, setFormPriceStr] = useState("");
  const [formCostStr, setFormCostStr] = useState("");
  const [formTaxRateBp, setFormTaxRateBp] = useState<number>(0);
  const [formUnit, setFormUnit] = useState("pza");
  const [formStock, setFormStock] = useState<number>(0);
  const [formMinStock, setFormMinStock] = useState<number>(5);
  const [formSubmitting, setFormSubmitting] = useState(false);

  // Estado del formulario de ajuste de stock
  const [adjustNewStock, setAdjustNewStock] = useState<number>(0);
  const [adjustReason, setAdjustReason] = useState("Ajuste manual de inventario");
  const [adjustSubmitting, setAdjustSubmitting] = useState(false);

  const showNotification = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 3500);
  };

  // Cargar lista de productos
  const loadProducts = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.products.list(search);
      setProducts(data);
      setError(null);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [search]);

  // Cargar historial de movimientos (Kardex)
  const loadMovements = useCallback(async () => {
    try {
      const data = await api.products.listMovements(undefined, 100);
      setMovements(data);
    } catch (e: unknown) {
      console.error("Error al cargar movimientos:", e);
    }
  }, []);

  const [syncingCatalog, setSyncingCatalog] = useState(false);

  // Sincronización bidireccional de catálogo con el ERP
  const handleSyncCatalog = useCallback(async () => {
    try {
      setSyncingCatalog(true);
      const count = await api.sync.syncCatalog();
      showNotification(`✓ Catálogo sincronizado con el ERP (${count} productos procesados).`);
      await loadProducts();
    } catch (e: unknown) {
      console.warn("Aviso: No se pudo conectar al ERP para actualizar catálogo:", e);
    } finally {
      setSyncingCatalog(false);
    }
  }, [loadProducts]);

  // Sincronizar catálogo al abrir la vista
  useEffect(() => {
    handleSyncCatalog();
  }, [handleSyncCatalog]);

  useEffect(() => {
    const t = setTimeout(() => {
      loadProducts();
    }, 250);
    return () => clearTimeout(t);
  }, [loadProducts]);

  useEffect(() => {
    if (activeTab === "kardex") {
      loadMovements();
    }
  }, [activeTab, loadMovements]);

  // Filtrado de productos en memoria
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (typeFilter === "services") return p.isService;
      if (typeFilter === "products") return !p.isService;
      if (typeFilter === "low_stock") return !p.isService && p.stock <= p.minStock;
      return true;
    });
  }, [products, typeFilter]);

  // Abrir formulario para nuevo producto
  const handleOpenCreateModal = (asService = false) => {
    setEditingProduct(null);
    setFormIsService(asService);
    const randomSku = `SKU-${Date.now().toString().slice(-6)}`;
    setFormSku(randomSku);
    setFormBarcode("");
    setFormName("");
    setFormPriceStr("");
    setFormCostStr("");
    setFormTaxRateBp(0);
    setFormUnit(asService ? "serv" : "pza");
    setFormStock(0);
    setFormMinStock(asService ? 0 : 5);
    setIsFormOpen(true);
  };

  // Abrir formulario para editar
  const handleOpenEditModal = (p: Product) => {
    setEditingProduct(p);
    setFormIsService(p.isService);
    setFormSku(p.sku);
    setFormBarcode(p.barcode || "");
    setFormName(p.name);
    setFormPriceStr((p.priceCents / 100).toFixed(2));
    setFormCostStr((p.costCents / 100).toFixed(2));
    setFormTaxRateBp(p.taxRateBp);
    setFormUnit(p.unit);
    setFormStock(p.stock);
    setFormMinStock(p.minStock);
    setIsFormOpen(true);
  };

  // Guardar creación o edición
  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formSku.trim() || !formName.trim()) {
      modalAlert({
        title: "Campos Requeridos",
        message: "El código/SKU y el nombre son obligatorios para guardar.",
        variant: "warning",
      });
      return;
    }

    const priceCents = toCents(formPriceStr);
    const costCents = toCents(formCostStr);

    if (priceCents < 0) {
      modalAlert({
        title: "Precio Inválido",
        message: "El precio de venta no puede ser negativo.",
        variant: "warning",
      });
      return;
    }

    try {
      setFormSubmitting(true);
      if (editingProduct) {
        // Actualizar
        const updateInput: UpdateProductInput = {
          id: editingProduct.id,
          sku: formSku.trim(),
          barcode: formBarcode.trim() || null,
          name: formName.trim(),
          priceCents,
          costCents,
          taxRateBp: formTaxRateBp,
          unit: formUnit.trim() || (formIsService ? "serv" : "pza"),
          stock: formIsService ? 0 : formStock,
          minStock: formIsService ? 0 : formMinStock,
          isService: formIsService,
          active: true,
        };
        await api.products.update(updateInput);
        showNotification(`✓ ${formIsService ? "Servicio" : "Producto"} "${formName}" actualizado correctamente.`);
      } else {
        // Crear
        const newInput: NewProduct = {
          sku: formSku.trim(),
          barcode: formBarcode.trim() || null,
          name: formName.trim(),
          priceCents,
          costCents,
          taxRateBp: formTaxRateBp,
          unit: formUnit.trim() || (formIsService ? "serv" : "pza"),
          stock: formIsService ? 0 : formStock,
          minStock: formIsService ? 0 : formMinStock,
          isService: formIsService,
        };
        await api.products.create(newInput);
        showNotification(`✓ ${formIsService ? "Servicio" : "Producto"} "${formName}" creado con éxito.`);
      }

      setIsFormOpen(false);
      loadProducts();
      // Subir producto nuevo al ERP y refrescar
      api.sync.syncCatalog().then(loadProducts).catch(console.warn);
    } catch (err: unknown) {
      modalAlert({
        title: "Error al Guardar",
        message: String(err),
        variant: "error",
      });
    } finally {
      setFormSubmitting(false);
    }
  };

  // Abrir modal de ajuste de stock
  const handleOpenAdjustModal = (p: Product) => {
    setAdjustingProduct(p);
    setAdjustNewStock(p.stock);
    setAdjustReason("Ajuste manual de inventario");
  };

  // Guardar ajuste de stock
  const handleSaveAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustingProduct) return;
    if (adjustNewStock < 0) {
      modalAlert({
        title: "Existencia Inválida",
        message: "La existencia contada no puede ser menor a 0.",
        variant: "warning",
      });
      return;
    }

    try {
      setAdjustSubmitting(true);
      const input: StockAdjustmentInput = {
        productId: adjustingProduct.id,
        newStock: adjustNewStock,
        reason: adjustReason.trim() || "Ajuste manual",
      };
      await api.products.adjustStock(input);
      showNotification(`✓ Stock de "${adjustingProduct.name}" actualizado a ${adjustNewStock} ${adjustingProduct.unit}.`);
      setAdjustingProduct(null);
      loadProducts();
      if (activeTab === "kardex") loadMovements();
      // Sincronizar de inmediato con el ERP de forma bidireccional
      api.sync.syncCatalog().then(loadProducts).catch(console.warn);
    } catch (err: unknown) {
      modalAlert({
        title: "Error al Ajustar Stock",
        message: String(err),
        variant: "error",
      });
    } finally {
      setAdjustSubmitting(false);
    }
  };

  // Eliminar producto (soft delete con ConfirmModal estándar)
  const handleDeleteProduct = async (p: Product) => {
    const ok = await confirm({
      title: `¿Eliminar ${p.isService ? "Servicio" : "Producto"}?`,
      message: `¿Estás seguro de desactivar "${p.name}"? Esta acción lo ocultará del catálogo sin afectar ventas históricas.`,
      variant: "danger",
      confirmText: "Sí, Eliminar",
      cancelText: "Cancelar",
    });
    if (!ok) return;

    try {
      await api.products.delete(p.id);
      showNotification(`✓ "${p.name}" eliminado del catálogo.`);
      loadProducts();
    } catch (err: unknown) {
      modalAlert({
        title: "Error al Eliminar",
        message: String(err),
        variant: "error",
      });
    }
  };

  // Atajos de teclado
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isFormOpen) {
          setIsFormOpen(false);
        } else if (adjustingProduct) {
          setAdjustingProduct(null);
        } else if (onBackToSales) {
          onBackToSales();
        }
      } else if (e.key === "F1" && onBackToSales) {
        e.preventDefault();
        onBackToSales();
      } else if (e.key === "F8" || (e.altKey && e.key.toLowerCase() === "n")) {
        e.preventDefault();
        handleOpenCreateModal(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFormOpen, adjustingProduct, onBackToSales]);

  return (
    <div className="flex flex-col h-screen w-full bg-slate-100 dark:bg-slate-950 text-slate-800 dark:text-slate-100 font-sans transition-colors duration-150 overflow-hidden select-none">
      {/* 1. BARRA SUPERIOR DE NAVEGACIÓN */}
      <header className="h-14 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 flex items-center justify-between shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          {onBackToSales && (
            <button
              type="button"
              onClick={onBackToSales}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm transition-colors"
              title="Volver a la Estación de Cobro (F1 / Esc)"
            >
              <span>← Volver a Ventas</span>
              <span className="bg-emerald-700/60 px-1 rounded text-[10px] font-mono">F1</span>
            </button>
          )}
          <div className="h-5 w-px bg-slate-300 dark:bg-slate-700 hidden sm:block"></div>
          <h1 className="text-base font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <span>📦 Catálogo & Inventario</span>
          </h1>
        </div>

        {/* Pestañas principales */}
        <div className="flex items-center bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl border border-slate-200 dark:border-slate-700/60 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab("catalog")}
            className={`px-3 py-1 rounded-lg transition-all ${
              activeTab === "catalog"
                ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 font-bold shadow-xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            📦 Productos & Servicios
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("inventory")}
            className={`px-3 py-1 rounded-lg transition-all ${
              activeTab === "inventory"
                ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 font-bold shadow-xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            📊 Existencias F4
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("kardex")}
            className={`px-3 py-1 rounded-lg transition-all ${
              activeTab === "kardex"
                ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 font-bold shadow-xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            📜 Kardex / Movimientos
          </button>
        </div>

        {/* Acciones principales */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={syncingCatalog}
            onClick={handleSyncCatalog}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm transition-colors disabled:opacity-50"
            title="Sincronizar catálogo con Megalider ERP (Subir locales y descargar remotos)"
          >
            <span className={syncingCatalog ? "animate-spin inline-block text-xs" : "text-xs"}>🔄</span>
            <span>{syncingCatalog ? "Sincronizando..." : "Sincronizar ERP"}</span>
          </button>
          <button
            type="button"
            onClick={() => handleOpenCreateModal(false)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-sm transition-colors"
            title="Registrar nuevo producto o servicio (F8)"
          >
            <span>+ Nuevo Producto / Servicio</span>
            <span className="bg-indigo-700/60 px-1 rounded text-[10px] font-mono">F8</span>
          </button>
        </div>
      </header>

      {/* 2. NOTIFICACIÓN TOAST FEEDBACK */}
      {feedback && (
        <div className="bg-emerald-600 text-white text-xs font-bold py-2 px-4 shadow-md text-center transition-all animate-in fade-in">
          {feedback}
        </div>
      )}

      {/* 3. FILTROS Y BÚSQUEDA */}
      {activeTab !== "kardex" && (
        <div className="bg-white dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-800 p-3 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 flex-1 max-w-xl">
            <div className="relative flex-1">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                🔍
              </span>
              <input
                type="text"
                autoFocus
                placeholder="Buscar por nombre, código de barras o SKU… (Esc para limpiar)"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-8 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  ✕
                </button>
              )}
            </div>

            {loading && <span className="text-xs text-slate-400 animate-pulse">Cargando…</span>}
          </div>

          {/* Filtros de Tipo */}
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700 text-xs">
            <button
              type="button"
              onClick={() => setTypeFilter("all")}
              className={`px-2.5 py-1 rounded-lg font-bold transition-colors ${
                typeFilter === "all"
                  ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              Todos ({products.length})
            </button>
            <button
              type="button"
              onClick={() => setTypeFilter("products")}
              className={`px-2.5 py-1 rounded-lg font-bold transition-colors ${
                typeFilter === "products"
                  ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              📦 Físicos ({products.filter((p) => !p.isService).length})
            </button>
            <button
              type="button"
              onClick={() => setTypeFilter("services")}
              className={`px-2.5 py-1 rounded-lg font-bold transition-colors ${
                typeFilter === "services"
                  ? "bg-white dark:bg-slate-900 text-cyan-600 dark:text-cyan-400 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              🛠️ Servicios ({products.filter((p) => p.isService).length})
            </button>
            <button
              type="button"
              onClick={() => setTypeFilter("low_stock")}
              className={`px-2.5 py-1 rounded-lg font-bold transition-colors ${
                typeFilter === "low_stock"
                  ? "bg-rose-500 text-white shadow-xs"
                  : "text-rose-600 dark:text-rose-400 hover:text-rose-800 dark:hover:text-rose-300"
              }`}
            >
              ⚠️ Stock Bajo ({products.filter((p) => !p.isService && p.stock <= p.minStock).length})
            </button>
          </div>
        </div>
      )}

      {/* 4. CUERPO DE CONTENIDO CON TABLAS */}
      <div className="flex-1 overflow-auto p-4">
        {error && (
          <div className="mb-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-200 text-xs">
            {error}
          </div>
        )}

        {/* TAB 1 & 2: CATÁLOGO Y CONTROL DE INVENTARIO */}
        {activeTab !== "kardex" && (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider">
                  <th className="py-3 px-4 w-28">Tipo</th>
                  <th className="py-3 px-4 w-40">Código / SKU</th>
                  <th className="py-3 px-4">Descripción / Nombre</th>
                  <th className="py-3 px-4 text-right w-28">Precio Venta</th>
                  <th className="py-3 px-4 text-right w-28">Costo</th>
                  <th className="py-3 px-4 text-right w-36">
                    {activeTab === "inventory" ? "Existencia Actual" : "Existencia / Mínimo"}
                  </th>
                  <th className="py-3 px-4 text-center w-36">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {filteredProducts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400 dark:text-slate-500">
                      <div className="text-3xl mb-2">🔍</div>
                      <p className="font-semibold">No se encontraron productos ni servicios.</p>
                      <button
                        type="button"
                        onClick={() => handleOpenCreateModal(false)}
                        className="mt-3 px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs"
                      >
                        Crear Primer Producto
                      </button>
                    </td>
                  </tr>
                ) : (
                  filteredProducts.map((p) => {
                    const isLowStock = !p.isService && p.stock <= p.minStock;
                    const isOutStock = !p.isService && p.stock <= 0;

                    return (
                      <tr
                        key={p.id}
                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors group"
                      >
                        {/* TIPO */}
                        <td className="py-3 px-4">
                          {p.isService ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-cyan-50 dark:bg-cyan-950/60 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-800/40">
                              🛠️ Servicio
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                              📦 Físico
                            </span>
                          )}
                        </td>

                        {/* CÓDIGO / SKU */}
                        <td className="py-3 px-4 font-mono font-bold text-slate-700 dark:text-slate-300">
                          <div>{p.barcode || p.sku}</div>
                          {p.barcode && p.sku !== p.barcode && (
                            <div className="text-[10px] text-slate-400 dark:text-slate-500 font-normal">
                              SKU: {p.sku}
                            </div>
                          )}
                        </td>

                        {/* NOMBRE */}
                        <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                          <div className="text-sm">{p.name}</div>
                          <div className="text-[10px] text-slate-400 dark:text-slate-500 font-normal">
                            IVA: {p.taxRateBp / 100}% • Unidad: {p.unit}
                          </div>
                        </td>

                        {/* PRECIO VENTA */}
                        <td className="py-3 px-4 text-right font-black text-sm text-emerald-600 dark:text-emerald-400">
                          {formatCents(p.priceCents)}
                        </td>

                        {/* COSTO */}
                        <td className="py-3 px-4 text-right text-slate-500 dark:text-slate-400 font-mono">
                          {formatCents(p.costCents)}
                        </td>

                        {/* EXISTENCIA */}
                        <td className="py-3 px-4 text-right">
                          {p.isService ? (
                            <span className="text-slate-400 dark:text-slate-500 italic text-[11px]">
                              Exento (Sin stock)
                            </span>
                          ) : (
                            <div>
                              <div
                                className={`font-black text-sm ${
                                  isOutStock
                                    ? "text-rose-600 dark:text-rose-400"
                                    : isLowStock
                                    ? "text-amber-600 dark:text-amber-400"
                                    : "text-slate-800 dark:text-slate-200"
                                }`}
                              >
                                {p.stock} {p.unit}
                              </div>
                              <div className="text-[10px] text-slate-400 dark:text-slate-500">
                                Mín: {p.minStock} {p.unit}
                              </div>
                            </div>
                          )}
                        </td>

                        {/* ACCIONES */}
                        <td className="py-3 px-4 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            {/* Editar */}
                            <button
                              type="button"
                              onClick={() => handleOpenEditModal(p)}
                              className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-[11px] transition-colors"
                              title="Modificar producto o servicio"
                            >
                              ✏️ Editar
                            </button>

                            {/* Ajustar stock (solo si no es servicio) */}
                            {!p.isService && (
                              <button
                                type="button"
                                onClick={() => handleOpenAdjustModal(p)}
                                className="px-2 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/60 dark:hover:bg-amber-900 border border-amber-200 dark:border-amber-800/40 text-amber-700 dark:text-amber-300 font-bold text-[11px] transition-colors"
                                title="Ajuste rápido de inventario físico"
                              >
                                📊 Ajustar
                              </button>
                            )}

                            {/* Eliminar */}
                            <button
                              type="button"
                              onClick={() => handleDeleteProduct(p)}
                              className="px-2 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/50 dark:hover:bg-rose-900/60 border border-rose-200 dark:border-rose-800/40 text-rose-600 dark:text-rose-300 font-bold text-[11px] transition-colors cursor-pointer"
                              title="Desactivar/Eliminar del catálogo"
                            >
                              🗑️
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 3: HISTORIAL DE MOVIMIENTOS (KARDEX) */}
        {activeTab === "kardex" && (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  Historial de Movimientos de Inventario (Kardex)
                </h2>
                <p className="text-[11px] text-slate-400">
                  Auditoría completa de salidas por venta, ajustes manuales, entradas y mermas.
                </p>
              </div>
              <button
                type="button"
                onClick={loadMovements}
                className="px-3 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-bold"
              >
                🔄 Actualizar
              </button>
            </div>

            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider">
                  <th className="py-3 px-4 w-40">Fecha / Hora</th>
                  <th className="py-3 px-4">Producto</th>
                  <th className="py-3 px-4 w-32">Tipo</th>
                  <th className="py-3 px-4 text-right w-28">Cantidad</th>
                  <th className="py-3 px-4">Referencia / Motivo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {movements.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-400">
                      No hay movimientos de inventario registrados.
                    </td>
                  </tr>
                ) : (
                  movements.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50">
                      <td className="py-3 px-4 font-mono text-slate-500 dark:text-slate-400">
                        {m.createdAt}
                      </td>
                      <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                        {m.productName || `Producto #${m.productId}`}
                      </td>
                      <td className="py-3 px-4">
                        {m.kind === "sale" && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 dark:bg-rose-950 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800">
                            Salida (Venta)
                          </span>
                        )}
                        {m.kind === "adjustment" && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                            Ajuste
                          </span>
                        )}
                        {m.kind === "purchase" && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                            Entrada
                          </span>
                        )}
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-mono font-bold ${
                          m.quantity < 0
                            ? "text-rose-600 dark:text-rose-400"
                            : "text-emerald-600 dark:text-emerald-400"
                        }`}
                      >
                        {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                        {m.reference || "Sin referencia"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ==============================================================
          MODAL: CREAR O EDITAR PRODUCTO / SERVICIO
          ============================================================== */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden animate-in zoom-in-95">
            <header className="px-6 py-4 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <span>{editingProduct ? "✏️ Modificar" : "✨ Nuevo"}</span>
                <span>{formIsService ? "Servicio" : "Producto"}</span>
              </h2>
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg font-bold"
              >
                ✕
              </button>
            </header>

            <form onSubmit={handleSaveProduct} className="p-6 space-y-4">
              {/* SELECTOR DE TIPO (PRODUCTO FÍSICO VS SERVICIO) */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  Tipo de Registro
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setFormIsService(false);
                      if (["serv", "hr", "día", "mes", "sesión", "cons", "dom", "ev"].includes(formUnit)) {
                        setFormUnit("pza");
                      }
                    }}
                    className={`py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                      !formIsService
                        ? "bg-indigo-50 dark:bg-indigo-950/60 border-indigo-500 text-indigo-700 dark:text-indigo-300 ring-2 ring-indigo-500/20 shadow-xs"
                        : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                    }`}
                  >
                    <span>📦 Producto Físico</span>
                    <span className="text-[10px] text-slate-400 font-normal">(Control de Stock)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setFormIsService(true);
                      if (["pza", "kg", "g", "lt", "ml", "caja", "paq", "m"].includes(formUnit)) {
                        setFormUnit("serv");
                      }
                      setFormStock(0);
                      setFormMinStock(0);
                    }}
                    className={`py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                      formIsService
                        ? "bg-cyan-50 dark:bg-cyan-950/60 border-cyan-500 text-cyan-700 dark:text-cyan-300 ring-2 ring-cyan-500/20 shadow-xs"
                        : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                    }`}
                  >
                    <span>🛠️ Servicio</span>
                    <span className="text-[10px] text-slate-400 font-normal">(Exento de Inventario)</span>
                  </button>
                </div>
              </div>

              {/* CÓDIGO DE BARRAS & SKU */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      Código de Barras
                    </label>
                    <button
                      type="button"
                      onClick={() => setFormBarcode(Date.now().toString().slice(-8))}
                      className="text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold hover:underline"
                    >
                      Generar aleatorio
                    </button>
                  </div>
                  <input
                    type="text"
                    placeholder="Escanear o ingresar…"
                    value={formBarcode}
                    onChange={(e) => setFormBarcode(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-xs font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    SKU / Clave Interna *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ej. PROD-001"
                    value={formSku}
                    onChange={(e) => setFormSku(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-xs font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* NOMBRE / DESCRIPCIÓN */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Nombre del {formIsService ? "Servicio" : "Producto"} *
                </label>
                <input
                  type="text"
                  required
                  placeholder={
                    formIsService
                      ? "Ej. Mantenimiento Preventivo, Asesoría, Domicilio"
                      : "Ej. Coca Cola 600ml, Azúcar 1kg, Cuaderno 100 Hojas"
                  }
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* PRECIO DE VENTA Y COSTO */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold text-emerald-700 dark:text-emerald-400 mb-1">
                    Precio Venta ($) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    placeholder="0.00"
                    value={formPriceStr}
                    onChange={(e) => setFormPriceStr(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-emerald-300 dark:border-emerald-800 text-xs font-mono font-black text-emerald-700 dark:text-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Costo ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={formCostStr}
                    onChange={(e) => setFormCostStr(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-xs font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    IVA (Impuesto)
                  </label>
                  <select
                    value={formTaxRateBp}
                    onChange={(e) => setFormTaxRateBp(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value={0}>0% (Exento)</option>
                    <option value={500}>5% (Reducido)</option>
                    <option value={1600}>16% (IVA)</option>
                    <option value={1900}>19% (General)</option>
                  </select>
                </div>
              </div>

              {/* CAMPOS ESPECÍFICOS DE PRODUCTO FÍSICO */}
              {!formIsService && (
                <div className="p-3.5 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
                  <div className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wide flex items-center justify-between">
                    <span>📦 Control de Existencias e Inventario</span>
                    <span className="text-[10px] font-normal text-slate-400">Control de stock en bodega</span>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Unidad de Medida
                      </label>
                      <select
                        value={formUnit}
                        onChange={(e) => setFormUnit(e.target.value)}
                        className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="pza">Pieza (pza)</option>
                        <option value="und">Unidad (und)</option>
                        <option value="kg">Kilogramo (kg)</option>
                        <option value="g">Gramo (g)</option>
                        <option value="lt">Litro (lt)</option>
                        <option value="ml">Mililitro (ml)</option>
                        <option value="caja">Caja (caja)</option>
                        <option value="paq">Paquete (paq)</option>
                        <option value="m">Metro (m)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                        {editingProduct ? "Existencia Actual" : "Existencia Inicial"}
                      </label>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={formStock}
                        onChange={(e) => setFormStock(Number(e.target.value))}
                        className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Stock Mínimo
                      </label>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={formMinStock}
                        onChange={(e) => setFormMinStock(Number(e.target.value))}
                        className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* CAMPOS ESPECÍFICOS DE SERVICIO */}
              {formIsService && (
                <div className="p-3.5 bg-cyan-50/50 dark:bg-cyan-950/30 rounded-xl border border-cyan-200 dark:border-cyan-800/60 space-y-3">
                  <div className="text-[11px] font-bold text-cyan-800 dark:text-cyan-300 uppercase tracking-wide flex items-center justify-between">
                    <span>🛠️ Unidad y Modalidad de Servicio</span>
                    <span className="text-[10px] font-normal text-cyan-600 dark:text-cyan-400">Exento de Inventario Físico</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Unidad de Cobro
                      </label>
                      <select
                        value={formUnit}
                        onChange={(e) => setFormUnit(e.target.value)}
                        className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      >
                        <option value="serv">Servicio (serv)</option>
                        <option value="hr">Hora (hr)</option>
                        <option value="día">Día (día)</option>
                        <option value="mes">Mes (mes)</option>
                        <option value="sesión">Sesión (sesión)</option>
                        <option value="cons">Consulta / Asesoría (cons)</option>
                        <option value="dom">Domicilio (dom)</option>
                        <option value="ev">Evento (ev)</option>
                        <option value="und">Unidad / Tarifa (und)</option>
                      </select>
                    </div>

                    <div className="text-[11px] text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800">
                      💡 Los servicios no descuentan existencias físicas de bodega. En caja podrás cobrar por horas, visitas o tarifas fijas.
                    </div>
                  </div>
                </div>
              )}

              {/* BOTONES DE ACCIÓN */}
              <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  Cancelar (Esc)
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className={`px-5 py-2 rounded-xl text-white text-xs font-black shadow-md transition-all disabled:opacity-50 cursor-pointer ${
                    formIsService
                      ? "bg-cyan-600 hover:bg-cyan-700"
                      : "bg-indigo-600 hover:bg-indigo-700"
                  }`}
                >
                  {formSubmitting
                    ? "Guardando…"
                    : editingProduct
                    ? "Guardar Cambios"
                    : formIsService
                    ? "Crear Servicio"
                    : "Crear Producto"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==============================================================
          MODAL: AJUSTE RÁPIDO DE INVENTARIO FÍSICO
          ============================================================== */}
      {adjustingProduct && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95">
            <header className="px-6 py-4 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <span>📊 Ajuste de Inventario</span>
                </h2>
                <p className="text-[11px] text-slate-400 font-bold truncate max-w-xs">
                  {adjustingProduct.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAdjustingProduct(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg font-bold"
              >
                ✕
              </button>
            </header>

            <form onSubmit={handleSaveAdjust} className="p-6 space-y-4">
              <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Existencia Actual</div>
                  <div className="text-lg font-black text-slate-800 dark:text-slate-200 font-mono">
                    {adjustingProduct.stock} {adjustingProduct.unit}
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Diferencia</div>
                  <div
                    className={`text-lg font-black font-mono ${
                      adjustNewStock - adjustingProduct.stock > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : adjustNewStock - adjustingProduct.stock < 0
                        ? "text-rose-600 dark:text-rose-400"
                        : "text-slate-500"
                    }`}
                  >
                    {adjustNewStock - adjustingProduct.stock > 0 ? "+" : ""}
                    {(adjustNewStock - adjustingProduct.stock).toFixed(2)} {adjustingProduct.unit}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Nueva Existencia Contada *
                </label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  required
                  autoFocus
                  value={adjustNewStock}
                  onChange={(e) => setAdjustNewStock(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-sm font-mono font-black text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Motivo o Justificación del Ajuste *
                </label>
                <select
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-2"
                >
                  <option value="Ajuste manual de inventario">Ajuste manual de inventario</option>
                  <option value="Conteo físico / Cuadre de stock">Conteo físico / Cuadre de stock</option>
                  <option value="Merma por caducidad o daño">Merma por caducidad o daño</option>
                  <option value="Entrada de mercancía / Compra directa">Entrada de mercancía / Compra directa</option>
                  <option value="Devolución de cliente">Devolución de cliente</option>
                </select>

                <input
                  type="text"
                  placeholder="Detalle adicional (opcional)…"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-900 dark:text-white"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setAdjustingProduct(null)}
                  className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Cancelar (Esc)
                </button>
                <button
                  type="submit"
                  disabled={adjustSubmitting}
                  className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-black shadow-md transition-all disabled:opacity-50"
                >
                  {adjustSubmitting ? "Guardando…" : "Aplicar Ajuste"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
