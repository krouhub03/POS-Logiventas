import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { api } from "../services/api";
import { formatCents, toCents } from "../lib/money";
import { useModals } from "../contexts/ModalContext";
import type {
  Product,
  ProductTag,
  NewProduct,
  SaveProductComponentItem,
  UpdateProductInput,
  InventoryMovement,
  StockAdjustmentInput,
} from "../types";

interface ProductsPageProps {
  initialTab?: "catalog" | "inventory" | "kardex";
  onBackToSales?: () => void;
}

const PRESET_TAG_COLORS = [
  { name: "Rojo (Alerta / Oferta)", hex: "#ef4444" },
  { name: "Naranja (Promo 2x1)", hex: "#f97316" },
  { name: "Ámbar (Destacado)", hex: "#f59e0b" },
  { name: "Verde (Fresco / Orgánico)", hex: "#10b981" },
  { name: "Azul (Frío / Bebidas)", hex: "#3b82f6" },
  { name: "Violeta (Premium)", hex: "#8b5cf6" },
  { name: "Rosa (Dulces / Snacks)", hex: "#ec4899" },
  { name: "Pizarra (General)", hex: "#64748b" },
];

import { parseTags } from "../lib/tags";

export function ProductsPage({ initialTab = "catalog", onBackToSales }: ProductsPageProps) {
  const [activeTab, setActiveTab] = useState<"catalog" | "inventory" | "kardex">(initialTab);
  const [search, setSearch] = useState("");
  const [catalogTypeFilter, setCatalogTypeFilter] = useState<"all" | "products" | "services" | "bundles">("all");
  const [selectedTagsFilter, setSelectedTagsFilter] = useState<string[]>([]);
  const [isTagFilterOpen, setIsTagFilterOpen] = useState(false);
  const tagFilterRef = useRef<HTMLDivElement>(null);
  const [inventoryStatusFilter, setInventoryStatusFilter] = useState<"all" | "optimal" | "low" | "out">("all");
  const [selectedKardexProduct, setSelectedKardexProduct] = useState<{ id: number; name: string } | null>(null);

  // Estado de Etiquetas Maestras (Tags con Nombre y Color)
  const [dbTags, setDbTags] = useState<ProductTag[]>([]);
  const [isTagsModalOpen, setIsTagsModalOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<ProductTag | null>(null);
  const [tagNameInput, setTagNameInput] = useState("");
  const [tagColorInput, setTagColorInput] = useState("#ef4444");
  const [tagSubmitting, setTagSubmitting] = useState(false);

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
  const [formIsBundle, setFormIsBundle] = useState(false);
  const [formComponents, setFormComponents] = useState<
    Array<{
      childProductId: number;
      childName: string;
      childSku: string;
      childStock: number;
      childUnit: string;
      quantity: number;
    }>
  >([]);
  const [selectedChildProductId, setSelectedChildProductId] = useState<number | "">("");
  const [selectedChildQty, setSelectedChildQty] = useState<number>(1);

  const [formSku, setFormSku] = useState("");
  const [formBarcode, setFormBarcode] = useState("");
  const [formName, setFormName] = useState("");
  const [formPriceStr, setFormPriceStr] = useState("");
  const [formCostStr, setFormCostStr] = useState("");
  const [formTaxRateBp, setFormTaxRateBp] = useState<number>(0);
  const [formUnit, setFormUnit] = useState("pza");
  const [formStock, setFormStock] = useState<number>(0);
  const [formMinStock, setFormMinStock] = useState<number>(5);
  const [formTags, setFormTags] = useState("");
  const [formSubmitting, setFormSubmitting] = useState(false);

  // Cálculo en vivo del stock armable del combo
  const calculatedBundleStock = useMemo(() => {
    if (!formIsBundle || formComponents.length === 0) return 0;
    let minStock = Infinity;
    for (const comp of formComponents) {
      if (comp.quantity > 0) {
        const possible = Math.floor(comp.childStock / comp.quantity);
        if (possible < minStock) minStock = possible;
      }
    }
    return minStock === Infinity ? 0 : Math.max(0, minStock);
  }, [formIsBundle, formComponents]);

  // Estado del formulario de ajuste de stock
  const [adjustNewStock, setAdjustNewStock] = useState<number>(0);
  const [adjustReason, setAdjustReason] = useState("Ajuste manual de inventario");
  const [adjustSubmitting, setAdjustSubmitting] = useState(false);

  const showNotification = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 3500);
  };

  // Cargar lista de etiquetas maestras desde SQLite
  const loadTags = useCallback(async () => {
    try {
      const data = await api.tags.list();
      setDbTags(data);
    } catch (e: unknown) {
      console.warn("Aviso: No se pudieron cargar etiquetas de BD:", e);
    }
  }, []);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  // Mapa de colores por nombre de etiqueta para renderizado instantáneo
  const tagColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of dbTags) {
      map.set(t.name.toLowerCase().trim(), t.colorHex);
    }
    return map;
  }, [dbTags]);

  // Guardar (crear o editar) etiqueta maestra
  const handleSaveTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tagNameInput.trim()) {
      modalAlert({
        title: "Nombre Requerido",
        message: "Debe ingresar un nombre para la etiqueta.",
        variant: "warning",
      });
      return;
    }

    try {
      setTagSubmitting(true);
      if (editingTag) {
        await api.tags.update(editingTag.id, tagNameInput.trim(), tagColorInput);
        showNotification(`✓ Etiqueta "${tagNameInput}" actualizada correctamente.`);
      } else {
        await api.tags.create(tagNameInput.trim(), tagColorInput);
        showNotification(`✓ Etiqueta "${tagNameInput}" creada con éxito.`);
      }
      setTagNameInput("");
      setTagColorInput("#ef4444");
      setEditingTag(null);
      await loadTags();
    } catch (err: unknown) {
      modalAlert({
        title: "Error al Guardar Etiqueta",
        message: String(err),
        variant: "error",
      });
    } finally {
      setTagSubmitting(false);
    }
  };

  // Activar edición de etiqueta
  const handleStartEditTag = (t: ProductTag) => {
    setEditingTag(t);
    setTagNameInput(t.name);
    setTagColorInput(t.colorHex);
  };

  // Cancelar edición de etiqueta
  const handleCancelEditTag = () => {
    setEditingTag(null);
    setTagNameInput("");
    setTagColorInput("#ef4444");
  };

  // Eliminar etiqueta
  const handleDeleteTag = async (t: ProductTag) => {
    const ok = await confirm({
      title: "Eliminar Etiqueta",
      message: `¿Desea eliminar la etiqueta "${t.name}"? Los productos vinculados conservarán sus datos y no serán afectados.`,
      confirmText: "Sí, Eliminar",
      cancelText: "Cancelar",
      variant: "danger",
    });
    if (!ok) return;

    try {
      await api.tags.delete(t.id);
      showNotification(`✓ Etiqueta "${t.name}" eliminada.`);
      if (editingTag?.id === t.id) {
        handleCancelEditTag();
      }
      await loadTags();
    } catch (err: unknown) {
      modalAlert({
        title: "Error al Eliminar",
        message: String(err),
        variant: "error",
      });
    }
  };

  // Cerrar menú desplegable de filtros de etiquetas al hacer clic fuera
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (tagFilterRef.current && !tagFilterRef.current.contains(event.target as Node)) {
        setIsTagFilterOpen(false);
      }
    }
    if (isTagFilterOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isTagFilterOpen]);

  // Alternar tag activo en el formulario de producto
  const toggleFormTag = (tagName: string) => {
    const current = parseTags(formTags, dbTags);
    const exists = current.some((x) => x.toLowerCase() === tagName.toLowerCase());
    let next: string[];
    if (exists) {
      next = current.filter((x) => x.toLowerCase() !== tagName.toLowerCase());
    } else {
      next = [...current, tagName];
    }
    setFormTags(next.join(", "));
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
  const loadMovements = useCallback(async (productId?: number) => {
    try {
      const data = await api.products.listMovements(productId, 100);
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
      loadMovements(selectedKardexProduct ? selectedKardexProduct.id : undefined);
    }
  }, [activeTab, selectedKardexProduct, loadMovements]);

  // ==============================================================
  // CATÁLOGO COMERCIAL: Lista de todos los productos y servicios
  // ==============================================================
  const catalogProducts = useMemo(() => {
    return products.filter((p) => {
      if (catalogTypeFilter === "products" && (p.isService || p.isBundle)) return false;
      if (catalogTypeFilter === "services" && !p.isService) return false;
      if (catalogTypeFilter === "bundles" && !p.isBundle) return false;
      if (selectedTagsFilter.length > 0) {
        const itemTags = parseTags(p.tags, dbTags).map((t) => t.toLowerCase());
        const hasMatch = selectedTagsFilter.some((filterTag) =>
          itemTags.includes(filterTag.toLowerCase())
        );
        if (!hasMatch) return false;
      }
      return true;
    });
  }, [products, catalogTypeFilter, selectedTagsFilter, dbTags]);

  // ==============================================================
  // CONTROL DE EXISTENCIAS: Exclusivo productos físicos en bodega
  // ==============================================================
  const physicalProducts = useMemo(() => {
    return products.filter((p) => !p.isService);
  }, [products]);

  const inventoryFilteredProducts = useMemo(() => {
    return physicalProducts.filter((p) => {
      if (inventoryStatusFilter === "optimal") return p.stock > p.minStock;
      if (inventoryStatusFilter === "low") return p.stock <= p.minStock && p.stock > 0;
      if (inventoryStatusFilter === "out") return p.stock <= 0;
      return true;
    });
  }, [physicalProducts, inventoryStatusFilter]);

  // Métricas financieras y de almacén para Existencias (F4)
  const inventoryKpis = useMemo(() => {
    let totalCostValuation = 0;
    let totalRetailValuation = 0;
    let outCount = 0;
    let lowCount = 0;
    let optimalCount = 0;

    for (const p of physicalProducts) {
      if (p.stock > 0) {
        totalCostValuation += Math.round(p.stock * p.costCents);
        totalRetailValuation += Math.round(p.stock * p.priceCents);
      }
      if (p.stock <= 0) {
        outCount++;
      } else if (p.stock <= p.minStock) {
        lowCount++;
      } else {
        optimalCount++;
      }
    }

    return {
      totalSkus: physicalProducts.length,
      totalCostValuation,
      totalRetailValuation,
      outCount,
      lowCount,
      optimalCount,
    };
  }, [physicalProducts]);

  // Micro-etiquetas presentes en catálogo y base de datos para filtros rápidos
  const availableTags = useMemo(() => {
    const list: string[] = [];
    for (const t of dbTags) {
      if (!list.includes(t.name)) list.push(t.name);
    }
    for (const p of products) {
      if (p.tags) {
        parseTags(p.tags, dbTags).forEach((t) => {
          if (!list.includes(t)) list.push(t);
        });
      }
    }
    return list;
  }, [products, dbTags]);

  // Abrir formulario para nuevo producto
  const handleOpenCreateModal = (asService = false, asBundle = false) => {
    setEditingProduct(null);
    setFormIsService(asService);
    setFormIsBundle(asBundle);
    setFormComponents([]);
    setSelectedChildProductId("");
    setSelectedChildQty(1);
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
    setFormTags("");
    setIsFormOpen(true);
  };

  // Abrir formulario para editar
  const handleOpenEditModal = (p: Product) => {
    setEditingProduct(p);
    setFormIsService(p.isService);
    setFormIsBundle(p.isBundle);
    setSelectedChildProductId("");
    setSelectedChildQty(1);
    setFormSku(p.sku);
    setFormBarcode(p.barcode || "");
    setFormName(p.name);
    setFormPriceStr((p.priceCents / 100).toFixed(2));
    setFormCostStr((p.costCents / 100).toFixed(2));
    setFormTaxRateBp(p.taxRateBp);
    setFormUnit(p.unit);
    setFormStock(p.stock);
    setFormMinStock(p.minStock);
    setFormTags(parseTags(p.tags, dbTags).join(", "));
    setIsFormOpen(true);

    if (p.isBundle) {
      api.products
        .getComponents(p.id)
        .then((comps) => {
          setFormComponents(
            comps.map((c) => ({
              childProductId: c.childProductId,
              childName: c.childName,
              childSku: c.childSku,
              childStock: c.childStock,
              childUnit: c.childUnit,
              quantity: c.quantity,
            }))
          );
        })
        .catch(console.warn);
    } else {
      setFormComponents([]);
    }
  };

  // Navegar al Kardex filtrando por producto
  const handleViewProductKardex = (p: Product) => {
    setSelectedKardexProduct({ id: p.id, name: p.name });
    setActiveTab("kardex");
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
      const tagsClean = formTags.trim() || null;
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
          isBundle: formIsBundle,
          tags: tagsClean,
          active: true,
        };
        const updated = await api.products.update(updateInput);
        if (formIsBundle) {
          const compItems: SaveProductComponentItem[] = formComponents.map((c, idx) => ({
            childProductId: c.childProductId,
            quantity: c.quantity,
            orderIndex: idx,
          }));
          await api.products.saveComponents(updated.id, compItems);
        }
        showNotification(
          `✓ ${formIsBundle ? "Combo" : formIsService ? "Servicio" : "Producto"} "${formName}" actualizado correctamente.`
        );
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
          isBundle: formIsBundle,
          tags: tagsClean,
        };
        const created = await api.products.create(newInput);
        if (formIsBundle && formComponents.length > 0) {
          const compItems: SaveProductComponentItem[] = formComponents.map((c, idx) => ({
            childProductId: c.childProductId,
            quantity: c.quantity,
            orderIndex: idx,
          }));
          await api.products.saveComponents(created.id, compItems);
        }
        showNotification(
          `✓ ${formIsBundle ? "Combo" : formIsService ? "Servicio" : "Producto"} "${formName}" creado con éxito.`
        );
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
            onClick={() => setIsTagsModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs shadow-xs transition-colors cursor-pointer"
            title="Administrar catálogo de etiquetas maestras (Nombre y Color)"
          >
            <span>🏷️ Etiquetas</span>
            <span className="bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 px-1 rounded text-[10px] font-mono">
              {dbTags.length}
            </span>
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

      {/* 3. FILTROS Y BÚSQUEDA SEGÚN PESTAÑA */}
      {activeTab === "catalog" && (
        <div className="bg-white dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-800 p-3 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 flex-1 max-w-xl">
            <div className="relative flex-1">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                🔍
              </span>
              <input
                type="text"
                autoFocus
                placeholder="Buscar en catálogo por nombre, SKU, código de barras o #tag… (Esc para limpiar)"
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

          {/* Filtros de Tipo y Tags de Catálogo */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700 text-xs">
              <button
                type="button"
                onClick={() => setCatalogTypeFilter("all")}
                className={`px-2.5 py-1 rounded-lg font-bold transition-colors ${
                  catalogTypeFilter === "all"
                    ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                Todos ({products.length})
              </button>
              <button
                type="button"
                onClick={() => setCatalogTypeFilter("products")}
                className={`px-2.5 py-1 rounded-lg font-bold transition-colors ${
                  catalogTypeFilter === "products"
                    ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                📦 Físicos ({products.filter((p) => !p.isService && !p.isBundle).length})
              </button>
              <button
                type="button"
                onClick={() => setCatalogTypeFilter("services")}
                className={`px-2.5 py-1 rounded-lg font-bold transition-colors ${
                  catalogTypeFilter === "services"
                    ? "bg-white dark:bg-slate-900 text-cyan-600 dark:text-cyan-400 shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                🛠️ Servicios ({products.filter((p) => p.isService).length})
              </button>
              <button
                type="button"
                onClick={() => setCatalogTypeFilter("bundles")}
                className={`px-2.5 py-1 rounded-lg font-bold transition-colors ${
                  catalogTypeFilter === "bundles"
                    ? "bg-white dark:bg-slate-900 text-purple-600 dark:text-purple-400 shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                🍱 Combos ({products.filter((p) => p.isBundle).length})
              </button>
            </div>

            {/* SELECTOR DESPLEGABLE MULTI-SELECCIÓN DE ETIQUETAS */}
            <div className="relative flex items-center gap-1.5" ref={tagFilterRef}>
              <button
                type="button"
                onClick={() => setIsTagFilterOpen((prev) => !prev)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all shadow-xs cursor-pointer ${
                  selectedTagsFilter.length > 0
                    ? "bg-indigo-50 dark:bg-indigo-950/70 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300"
                    : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                }`}
              >
                <span>🏷️</span>
                <span>
                  {selectedTagsFilter.length === 0
                    ? "Filtrar por etiquetas"
                    : selectedTagsFilter.length === 1
                    ? `#${selectedTagsFilter[0]}`
                    : `${selectedTagsFilter.length} etiquetas`}
                </span>
                {selectedTagsFilter.length > 0 && (
                  <span className="w-4 h-4 rounded-full bg-indigo-600 text-white text-[10px] flex items-center justify-center font-black">
                    {selectedTagsFilter.length}
                  </span>
                )}
                <span className="text-[9px] text-slate-400">▼</span>
              </button>

              {/* Botón rápido para limpiar filtro de etiquetas */}
              {selectedTagsFilter.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedTagsFilter([])}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 text-xs font-bold hover:bg-rose-100 dark:hover:bg-rose-900/60 transition-colors shadow-xs cursor-pointer"
                  title="Limpiar todas las etiquetas seleccionadas"
                >
                  <span>✕</span>
                  <span>Limpiar</span>
                </button>
              )}

              {/* Menú Desplegable Multi-Selección */}
              {isTagFilterOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl z-30 p-2.5 animate-in fade-in zoom-in-95">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100 dark:border-slate-800 px-1">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
                      Etiquetas ({availableTags.length})
                    </span>
                    {selectedTagsFilter.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedTagsFilter([])}
                        className="text-[11px] font-bold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                      >
                        Limpiar ({selectedTagsFilter.length})
                      </button>
                    )}
                  </div>

                  {availableTags.length === 0 ? (
                    <div className="p-4 text-center text-slate-400 text-xs italic">
                      No hay etiquetas disponibles
                    </div>
                  ) : (
                    <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
                      {availableTags.map((tag) => {
                        const isSelected = selectedTagsFilter.includes(tag);
                        const color = tagColorMap.get(tag.toLowerCase().trim()) || "#6366f1";
                        return (
                          <label
                            key={tag}
                            className={`flex items-center justify-between px-2.5 py-1.5 rounded-xl cursor-pointer text-xs font-semibold transition-colors ${
                              isSelected
                                ? "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-900 dark:text-indigo-200 font-bold"
                                : "hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => {
                                  if (isSelected) {
                                    setSelectedTagsFilter(selectedTagsFilter.filter((t) => t !== tag));
                                  } else {
                                    setSelectedTagsFilter([...selectedTagsFilter, tag]);
                                  }
                                }}
                                className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 cursor-pointer"
                              />
                              <span
                                className="w-2.5 h-2.5 rounded-full shrink-0 shadow-xs"
                                style={{ backgroundColor: color }}
                              />
                              <span>#{tag}</span>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}

                  <div className="pt-2 mt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between px-1">
                    <span className="text-[10px] text-slate-400">
                      {selectedTagsFilter.length === 0
                        ? "Ninguna seleccionada"
                        : `${selectedTagsFilter.length} seleccionada(s)`}
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsTagFilterOpen(false)}
                      className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-[11px] font-bold cursor-pointer"
                    >
                      Listo
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === "inventory" && (
        <div className="bg-white dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-800 p-3 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 flex-1 max-w-xl">
            {/* Indicador de Bodega Activa */}
            <div className="flex items-center gap-2 bg-indigo-50 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800/60 px-3 py-1.5 rounded-xl shrink-0">
              <span className="text-base">🏢</span>
              <div>
                <div className="text-xs font-bold text-indigo-950 dark:text-indigo-200 leading-none">
                  Bodega Mostrador Principal
                </div>
                <div className="text-[10px] text-indigo-600 dark:text-indigo-400 font-mono mt-0.5">
                  BOD-01 • Terminal Asignada
                </div>
              </div>
            </div>

            <div className="relative flex-1">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                🔍
              </span>
              <input
                type="text"
                autoFocus
                placeholder="Buscar existencias por SKU o nombre de producto…"
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
          </div>

          {/* Filtros de Estado de Stock */}
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700 text-xs">
            <button
              type="button"
              onClick={() => setInventoryStatusFilter("all")}
              className={`px-2.5 py-1 rounded-lg font-bold transition-colors ${
                inventoryStatusFilter === "all"
                  ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              Todos ({physicalProducts.length})
            </button>
            <button
              type="button"
              onClick={() => setInventoryStatusFilter("optimal")}
              className={`px-2.5 py-1 rounded-lg font-bold transition-colors ${
                inventoryStatusFilter === "optimal"
                  ? "bg-emerald-600 text-white shadow-xs"
                  : "text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
              }`}
            >
              🟢 Óptimos ({inventoryKpis.optimalCount})
            </button>
            <button
              type="button"
              onClick={() => setInventoryStatusFilter("low")}
              className={`px-2.5 py-1 rounded-lg font-bold transition-colors ${
                inventoryStatusFilter === "low"
                  ? "bg-amber-500 text-white shadow-xs"
                  : "text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40"
              }`}
            >
              🟡 Críticos ({inventoryKpis.lowCount})
            </button>
            <button
              type="button"
              onClick={() => setInventoryStatusFilter("out")}
              className={`px-2.5 py-1 rounded-lg font-bold transition-colors ${
                inventoryStatusFilter === "out"
                  ? "bg-rose-600 text-white shadow-xs"
                  : "text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
              }`}
            >
              🔴 Agotados ({inventoryKpis.outCount})
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

        {/* ==============================================================
            TAB 1: CATÁLOGO COMERCIAL (PRODUCTOS & SERVICIOS)
            ============================================================== */}
        {activeTab === "catalog" && (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider">
                  <th className="py-3 px-4 w-28">Tipo</th>
                  <th className="py-3 px-4 w-40">Código / SKU</th>
                  <th className="py-3 px-4">Nombre Comercial</th>
                  <th className="py-3 px-4 w-44">Etiquetas (Tags)</th>
                  <th className="py-3 px-4 text-right w-28">Costo</th>
                  <th className="py-3 px-4 text-right w-28">Precio Venta</th>
                  <th className="py-3 px-4 text-right w-28">Margen Bruto</th>
                  <th className="py-3 px-4 text-center w-28">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {catalogProducts.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-400 dark:text-slate-500">
                      <div className="text-3xl mb-2">🔍</div>
                      <p className="font-semibold">No se encontraron productos ni servicios en el catálogo.</p>
                      <button
                        type="button"
                        onClick={() => handleOpenCreateModal(false)}
                        className="mt-3 px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs"
                      >
                        Crear Primer Ítem
                      </button>
                    </td>
                  </tr>
                ) : (
                  catalogProducts.map((p) => {
                    const marginPct =
                      p.priceCents > 0
                        ? ((p.priceCents - p.costCents) / p.priceCents) * 100
                        : 0;

                    const itemTags = parseTags(p.tags, dbTags);

                    return (
                      <tr
                        key={p.id}
                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors group"
                      >
                        {/* TIPO */}
                        <td className="py-3 px-4">
                          {p.isBundle ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/40">
                              🍱 Combo
                            </span>
                          ) : p.isService ? (
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

                        {/* ETIQUETAS (TAGS) */}
                        <td className="py-3 px-4">
                          {itemTags.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {itemTags.map((tag) => {
                                const tagColor = tagColorMap.get(tag.toLowerCase().trim()) || "#6366f1";
                                const isSelected = selectedTagsFilter.includes(tag);
                                return (
                                  <button
                                    key={tag}
                                    type="button"
                                    onClick={() => {
                                      if (isSelected) {
                                        setSelectedTagsFilter(selectedTagsFilter.filter((t) => t !== tag));
                                      } else {
                                        setSelectedTagsFilter([...selectedTagsFilter, tag]);
                                      }
                                    }}
                                    style={{
                                      backgroundColor: isSelected ? tagColor : `${tagColor}18`,
                                      borderColor: isSelected ? tagColor : `${tagColor}40`,
                                      color: isSelected ? "#ffffff" : tagColor,
                                    }}
                                    className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border hover:opacity-85 transition-all shadow-xs cursor-pointer ${
                                      isSelected ? "ring-2 ring-indigo-400 font-black" : ""
                                    }`}
                                    title={
                                      isSelected
                                        ? `Quitar filtro #${tag}`
                                        : `Filtrar por #${tag}`
                                    }
                                  >
                                    #{tag}
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            <span className="text-slate-400 text-[10px] italic">Sin tags</span>
                          )}
                        </td>

                        {/* COSTO */}
                        <td className="py-3 px-4 text-right text-slate-500 dark:text-slate-400 font-mono">
                          {formatCents(p.costCents)}
                        </td>

                        {/* PRECIO VENTA */}
                        <td className="py-3 px-4 text-right font-black text-sm text-emerald-600 dark:text-emerald-400">
                          {formatCents(p.priceCents)}
                        </td>

                        {/* MARGEN BRUTO */}
                        <td className="py-3 px-4 text-right">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-md font-mono font-bold text-[11px] ${
                              marginPct >= 25
                                ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/50"
                                : marginPct >= 10
                                ? "bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/50"
                                : "bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/50"
                            }`}
                          >
                            {marginPct >= 0 ? `+${marginPct.toFixed(1)}%` : `${marginPct.toFixed(1)}%`}
                          </span>
                        </td>

                        {/* ACCIONES */}
                        <td className="py-3 px-4 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleOpenEditModal(p)}
                              className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-[11px] transition-colors"
                              title="Modificar ficha de producto o servicio"
                            >
                              ✏️ Editar
                            </button>
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

        {/* ==============================================================
            TAB 2: CONTROL DE EXISTENCIAS & BODEGAS (F4)
            ============================================================== */}
        {activeTab === "inventory" && (
          <div className="space-y-4">
            {/* 4 TARJETAS KPI DE ALMACÉN */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {/* 1. SKUs Físicos */}
              <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800/60 flex items-center justify-center text-lg">
                  📦
                </div>
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Artículos en Bodega
                  </div>
                  <div className="text-base font-black text-slate-900 dark:text-white">
                    {inventoryKpis.totalSkus} <span className="text-xs font-normal text-slate-400">SKUs Físicos</span>
                  </div>
                </div>
              </div>

              {/* 2. Inversión en Costo */}
              <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-lg">
                  💰
                </div>
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Inversión Almacén (Costo)
                  </div>
                  <div className="text-base font-black text-slate-900 dark:text-white">
                    {formatCents(inventoryKpis.totalCostValuation)}
                  </div>
                </div>
              </div>

              {/* 3. Venta Proyectada */}
              <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-800/60 flex items-center justify-center text-lg">
                  📈
                </div>
                <div>
                  <div className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                    Potencial de Venta
                  </div>
                  <div className="text-base font-black text-emerald-700 dark:text-emerald-300">
                    {formatCents(inventoryKpis.totalRetailValuation)}
                  </div>
                </div>
              </div>

              {/* 4. Quiebres de Stock */}
              <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-950/70 border border-rose-200 dark:border-rose-800/60 flex items-center justify-center text-lg">
                  ⚠️
                </div>
                <div>
                  <div className="text-[10px] font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider">
                    Alertas de Reposición
                  </div>
                  <div className="text-base font-black text-rose-700 dark:text-rose-300">
                    {inventoryKpis.outCount} <span className="text-xs font-normal">agotados</span> • {inventoryKpis.lowCount} <span className="text-xs font-normal">críticos</span>
                  </div>
                </div>
              </div>
            </div>

            {/* TABLA DE OPERACIÓN DE EXISTENCIAS */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider">
                    <th className="py-3 px-4 w-28">Estado</th>
                    <th className="py-3 px-4 w-40">Código / SKU</th>
                    <th className="py-3 px-4">Producto en Almacén</th>
                    <th className="py-3 px-4 text-right w-36">Existencia Actual</th>
                    <th className="py-3 px-4 text-right w-28">Stock Mínimo</th>
                    <th className="py-3 px-4 text-right w-28">Costo Unit.</th>
                    <th className="py-3 px-4 text-right w-36">Valor en Bodega</th>
                    <th className="py-3 px-4 text-center w-40">Acciones de Almacén</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {inventoryFilteredProducts.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-400 dark:text-slate-500">
                        <div className="text-3xl mb-2">📦</div>
                        <p className="font-semibold">No hay artículos físicos en esta vista de inventario.</p>
                      </td>
                    </tr>
                  ) : (
                    inventoryFilteredProducts.map((p) => {
                      const isOutStock = p.stock <= 0;
                      const isLowStock = !isOutStock && p.stock <= p.minStock;
                      const lineValuationCents = p.stock > 0 ? Math.round(p.stock * p.costCents) : 0;

                      return (
                        <tr
                          key={p.id}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors group"
                        >
                          {/* ESTADO / SEMÁFORO */}
                          <td className="py-3 px-4">
                            {isOutStock ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-50 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60">
                                🔴 Agotado
                              </span>
                            ) : isLowStock ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-50 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60">
                                🟡 Crítico
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
                                🟢 Óptimo
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

                          {/* PRODUCTO */}
                          <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                            <div className="text-sm">{p.name}</div>
                            <div className="text-[10px] text-slate-400 dark:text-slate-500 font-normal">
                              Unidad: {p.unit}
                              {p.tags && ` • #${p.tags.split(/[\s,]+/).join(" #")}`}
                            </div>
                          </td>

                          {/* EXISTENCIA ACTUAL */}
                          <td className="py-3 px-4 text-right">
                            <div
                              className={`font-black text-sm ${
                                isOutStock
                                  ? "text-rose-600 dark:text-rose-400"
                                  : isLowStock
                                  ? "text-amber-600 dark:text-amber-400"
                                  : "text-slate-900 dark:text-white"
                              }`}
                            >
                              {p.stock} <span className="text-xs font-normal text-slate-400">{p.unit}</span>
                            </div>
                          </td>

                          {/* STOCK MÍNIMO */}
                          <td className="py-3 px-4 text-right text-slate-500 dark:text-slate-400 font-mono">
                            {p.minStock} {p.unit}
                          </td>

                          {/* COSTO UNITARIO */}
                          <td className="py-3 px-4 text-right text-slate-500 dark:text-slate-400 font-mono">
                            {formatCents(p.costCents)}
                          </td>

                          {/* VALOR EN BODEGA */}
                          <td className="py-3 px-4 text-right font-black text-slate-900 dark:text-white font-mono">
                            {formatCents(lineValuationCents)}
                          </td>

                          {/* ACCIONES DE ALMACÉN */}
                          <td className="py-3 px-4 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleOpenAdjustModal(p)}
                                className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/60 dark:hover:bg-amber-900 border border-amber-200 dark:border-amber-800/40 text-amber-700 dark:text-amber-300 font-bold text-[11px] transition-colors"
                                title="Ajuste rápido de conteo físico"
                              >
                                📝 Conteo
                              </button>
                              <button
                                type="button"
                                onClick={() => handleViewProductKardex(p)}
                                className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900 border border-indigo-200 dark:border-indigo-800/40 text-indigo-700 dark:text-indigo-300 font-bold text-[11px] transition-colors"
                                title="Ver historial de movimientos de este producto"
                              >
                                📜 Kardex
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
                <div className="text-[11px] text-slate-400">
                  {selectedKardexProduct ? (
                    <span className="flex items-center gap-2 mt-0.5">
                      <span>
                        Movimientos filtrados de:{" "}
                        <strong className="text-indigo-600 dark:text-indigo-400">
                          {selectedKardexProduct.name}
                        </strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedKardexProduct(null);
                          loadMovements();
                        }}
                        className="text-xs font-bold text-slate-600 dark:text-slate-300 hover:underline cursor-pointer bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md"
                      >
                        ✕ Ver todos los movimientos
                      </button>
                    </span>
                  ) : (
                    "Auditoría completa de salidas por venta, ajustes manuales, entradas y mermas."
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => loadMovements(selectedKardexProduct ? selectedKardexProduct.id : undefined)}
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
              {/* SELECTOR DE TIPO (PRODUCTO FÍSICO VS SERVICIO VS COMBO) */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  Tipo de Registro
                </label>
                <div className="grid grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setFormIsService(false);
                      setFormIsBundle(false);
                      if (["serv", "hr", "día", "mes", "sesión", "cons", "dom", "ev"].includes(formUnit)) {
                        setFormUnit("pza");
                      }
                    }}
                    className={`py-2 px-2.5 rounded-xl border text-xs font-bold flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer ${
                      !formIsService && !formIsBundle
                        ? "bg-indigo-50 dark:bg-indigo-950/60 border-indigo-500 text-indigo-700 dark:text-indigo-300 ring-2 ring-indigo-500/20 shadow-xs"
                        : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                    }`}
                  >
                    <span>📦 Físico</span>
                    <span className="text-[9px] text-slate-400 font-normal">Stock Directo</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setFormIsService(true);
                      setFormIsBundle(false);
                      if (["pza", "kg", "g", "lt", "ml", "caja", "paq", "m"].includes(formUnit)) {
                        setFormUnit("serv");
                      }
                      setFormStock(0);
                      setFormMinStock(0);
                    }}
                    className={`py-2 px-2.5 rounded-xl border text-xs font-bold flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer ${
                      formIsService
                        ? "bg-cyan-50 dark:bg-cyan-950/60 border-cyan-500 text-cyan-700 dark:text-cyan-300 ring-2 ring-cyan-500/20 shadow-xs"
                        : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                    }`}
                  >
                    <span>🛠️ Servicio</span>
                    <span className="text-[9px] text-slate-400 font-normal">Sin Stock</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setFormIsService(false);
                      setFormIsBundle(true);
                      setFormUnit("pza");
                    }}
                    className={`py-2 px-2.5 rounded-xl border text-xs font-bold flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer ${
                      formIsBundle
                        ? "bg-purple-50 dark:bg-purple-950/60 border-purple-500 text-purple-700 dark:text-purple-300 ring-2 ring-purple-500/20 shadow-xs"
                        : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                    }`}
                  >
                    <span>🍱 Combo / Kit</span>
                    <span className="text-[9px] text-purple-500 font-normal">Receta Hijos</span>
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

              {/* CAMPOS ESPECÍFICOS DE PRODUCTO FÍSICO SIMPLE */}
              {!formIsService && !formIsBundle && (
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

              {/* SECCIÓN ESPECÍFICA DE PRODUCTO COMPUESTO / COMBO */}
              {formIsBundle && (
                <div className="p-4 bg-purple-50/70 dark:bg-purple-950/40 rounded-xl border border-purple-200 dark:border-purple-800/60 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-base">🍱</span>
                      <div>
                        <span className="text-xs font-bold text-purple-900 dark:text-purple-200 block">
                          Receta / Insumos del Combo
                        </span>
                        <span className="text-[10px] text-purple-700/70 dark:text-purple-300/70">
                          Al vender este combo se descontará el stock de cada uno de sus componentes
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wider block">
                        Stock Armable
                      </span>
                      <span className="text-sm font-mono font-black text-purple-800 dark:text-purple-300">
                        {calculatedBundleStock} combos
                      </span>
                    </div>
                  </div>

                  {/* SELECTOR PARA AÑADIR NUEVO COMPONENTE */}
                  <div className="flex gap-2 items-end pt-1">
                    <div className="flex-1">
                      <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 block mb-1">
                        Seleccionar Producto Insumo
                      </label>
                      <select
                        value={selectedChildProductId}
                        onChange={(e) => setSelectedChildProductId(e.target.value ? Number(e.target.value) : "")}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-purple-300 dark:border-purple-700 text-xs text-slate-900 dark:text-white font-medium focus:outline-none"
                      >
                        <option value="">-- Seleccionar producto del catálogo --</option>
                        {products
                          .filter((p) => !p.isService && !p.isBundle && (!editingProduct || p.id !== editingProduct.id))
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} ({p.sku}) • Stock: {p.stock} {p.unit}
                            </option>
                          ))}
                      </select>
                    </div>

                    <div className="w-24">
                      <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 block mb-1">
                        Cantidad
                      </label>
                      <input
                        type="number"
                        step="any"
                        min="0.01"
                        value={selectedChildQty}
                        onChange={(e) => setSelectedChildQty(Number(e.target.value))}
                        className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-purple-300 dark:border-purple-700 text-xs font-mono font-bold text-slate-900 dark:text-white focus:outline-none text-center"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        if (!selectedChildProductId || selectedChildQty <= 0) return;
                        const child = products.find((p) => p.id === selectedChildProductId);
                        if (!child) return;

                        const existsIdx = formComponents.findIndex((c) => c.childProductId === child.id);
                        if (existsIdx >= 0) {
                          const updated = [...formComponents];
                          updated[existsIdx].quantity += selectedChildQty;
                          setFormComponents(updated);
                        } else {
                          setFormComponents([
                            ...formComponents,
                            {
                              childProductId: child.id,
                              childName: child.name,
                              childSku: child.sku,
                              childStock: child.stock,
                              childUnit: child.unit,
                              quantity: selectedChildQty,
                            },
                          ]);
                        }
                        setSelectedChildProductId("");
                        setSelectedChildQty(1);
                      }}
                      disabled={!selectedChildProductId || selectedChildQty <= 0}
                      className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs transition-colors disabled:opacity-50 cursor-pointer shrink-0"
                    >
                      + Añadir
                    </button>
                  </div>

                  {/* LISTA DE COMPONENTES AGREGADOS */}
                  <div className="space-y-1.5 max-h-36 overflow-y-auto pt-1">
                    {formComponents.length === 0 ? (
                      <p className="text-[11px] text-purple-700/60 dark:text-purple-400/60 italic text-center py-2">
                        Aún no has agregado insumos a este combo.
                      </p>
                    ) : (
                      formComponents.map((comp, idx) => (
                        <div
                          key={comp.childProductId}
                          className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-900 border border-purple-200 dark:border-purple-900/60 text-xs"
                        >
                          <div>
                            <span className="font-bold text-slate-900 dark:text-white">{comp.childName}</span>
                            <span className="text-[10px] text-slate-400 font-mono ml-2">SKU: {comp.childSku}</span>
                            <div className="text-[10px] text-slate-500">
                              Stock en almacén: {comp.childStock} {comp.childUnit}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-mono font-bold text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-950 px-2 py-0.5 rounded">
                              {comp.quantity} {comp.childUnit} / combo
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setFormComponents(formComponents.filter((_, i) => i !== idx));
                              }}
                              className="text-rose-500 hover:text-rose-700 text-xs font-bold p-1 cursor-pointer"
                              title="Quitar componente"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ))
                    )}
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

              {/* ETIQUETAS MAESTRAS (TAGS CON NOMBRE Y COLOR) */}
              <div className="p-3.5 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <span>🏷️ Etiquetas del Producto</span>
                    <span className="text-[10px] text-slate-400 font-normal">Pulsa para activar o desactivar</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsTagsModalOpen(true)}
                    className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer flex items-center gap-1"
                  >
                    <span>⚙️ Gestionar Etiquetas</span>
                  </button>
                </div>

                {/* Chips seleccionables de dbTags */}
                {dbTags.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pt-1">
                    {dbTags.map((t) => {
                      const activeTags = parseTags(formTags, dbTags).map((x) => x.toLowerCase());
                      const isSelected = activeTags.includes(t.name.toLowerCase());

                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => toggleFormTag(t.name)}
                          style={{
                            backgroundColor: isSelected ? t.colorHex : undefined,
                            borderColor: t.colorHex,
                            color: isSelected ? "#ffffff" : undefined,
                          }}
                          className={`px-2.5 py-1 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border ${
                            isSelected
                              ? "shadow-xs scale-102 font-black"
                              : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:scale-102"
                          }`}
                        >
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${isSelected ? "bg-white" : ""}`}
                            style={{ backgroundColor: isSelected ? undefined : t.colorHex }}
                          />
                          <span>{t.name}</span>
                          {isSelected && <span className="text-[10px]">✓</span>}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-xs text-slate-400 italic py-1">
                    No hay etiquetas maestras registradas aún.
                  </div>
                )}

                {/* Input de texto complementario */}
                <div className="pt-1">
                  <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                    <span>Etiquetas asignadas actualmente:</span>
                    <span className="font-mono">Búsqueda rápida en POS con #</span>
                  </div>
                  <input
                    type="text"
                    placeholder="Ninguna etiqueta seleccionada"
                    value={formTags}
                    onChange={(e) => setFormTags(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

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

      {/* MODAL MAESTRO: GESTIÓN DE ETIQUETAS (TAGS) */}
      {isTagsModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-xl w-full p-6 shadow-2xl flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 flex items-center justify-center text-xl shadow-inner border border-indigo-200 dark:border-indigo-800/40">
                  🏷️
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">
                    Gestor Maestro de Etiquetas
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Clasificación universal para POS, ERP Megalider y Tienda Online
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsTagsModalOpen(false);
                  handleCancelEditTag();
                }}
                className="w-8 h-8 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {/* Formulario Crear / Editar */}
            <form onSubmit={handleSaveTag} className="pt-4 pb-5 border-b border-slate-200 dark:border-slate-800">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3 flex items-center justify-between">
                <span>{editingTag ? "✏️ Editar Etiqueta" : "➕ Nueva Etiqueta"}</span>
                {editingTag && (
                  <button
                    type="button"
                    onClick={handleCancelEditTag}
                    className="text-indigo-600 dark:text-indigo-400 hover:underline normal-case font-semibold text-xs"
                  >
                    Cancelar edición
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                {/* Nombre de la etiqueta */}
                <div className="md:col-span-7">
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                    Nombre de la etiqueta *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={40}
                    placeholder="Ej. Oferta, Vegano, Frío, Combo…"
                    value={tagNameInput}
                    onChange={(e) => setTagNameInput(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                {/* Color Hex & Picker */}
                <div className="md:col-span-5">
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                    Color representativo
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={tagColorInput}
                      onChange={(e) => setTagColorInput(e.target.value)}
                      className="w-9 h-9 rounded-xl border border-slate-300 dark:border-slate-700 cursor-pointer bg-transparent p-0.5"
                      title="Seleccionar color personalizado"
                    />
                    <input
                      type="text"
                      maxLength={7}
                      value={tagColorInput}
                      onChange={(e) => setTagColorInput(e.target.value)}
                      className="w-24 px-2 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-xs font-mono font-bold text-slate-900 dark:text-white uppercase"
                    />
                    <button
                      type="submit"
                      disabled={tagSubmitting}
                      className="flex-1 py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black shadow-md transition-all disabled:opacity-50 whitespace-nowrap"
                    >
                      {tagSubmitting ? "..." : editingTag ? "Guardar" : "Crear"}
                    </button>
                  </div>
                </div>
              </div>

              {/* Paleta de colores rápidos */}
              <div className="mt-3 flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] text-slate-400 font-semibold mr-1">Paleta recomendada:</span>
                {PRESET_TAG_COLORS.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    onClick={() => setTagColorInput(c.hex)}
                    style={{ backgroundColor: c.hex }}
                    className={`w-6 h-6 rounded-full border-2 transition-transform cursor-pointer ${
                      tagColorInput.toLowerCase() === c.hex.toLowerCase()
                        ? "scale-125 border-slate-900 dark:border-white shadow"
                        : "border-transparent hover:scale-110 opacity-80 hover:opacity-100"
                    }`}
                    title={c.name}
                  />
                ))}
              </div>
            </form>

            {/* Listado de Etiquetas Existentes */}
            <div className="flex-1 overflow-y-auto pt-4 pr-1">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-600 dark:text-slate-400">
                  Etiquetas Registradas ({dbTags.length})
                </span>
                <span className="text-[10px] text-slate-400">
                  Haz clic en ✏️ para editar o 🗑️ para eliminar
                </span>
              </div>

              {dbTags.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-xs italic">
                  No hay etiquetas registradas aún. ¡Crea la primera arriba!
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {dbTags.map((tag) => (
                    <div
                      key={tag.id}
                      className="py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 px-2 rounded-xl transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="w-4 h-4 rounded-full border border-black/10 shrink-0 shadow-sm"
                          style={{ backgroundColor: tag.colorHex }}
                        />
                        <span
                          style={{
                            backgroundColor: `${tag.colorHex}20`,
                            borderColor: `${tag.colorHex}50`,
                            color: tag.colorHex,
                          }}
                          className="px-2.5 py-1 rounded-lg text-xs font-black border font-mono tracking-wide"
                        >
                          #{tag.name}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                          {tag.colorHex}
                        </span>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleStartEditTag(tag)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 text-xs"
                          title="Editar nombre o color"
                        >
                          ✏️
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteTag(tag)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/60 text-xs"
                          title="Eliminar etiqueta"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="pt-4 mt-2 border-t border-slate-200 dark:border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setIsTagsModalOpen(false);
                  handleCancelEditTag();
                }}
                className="px-5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
