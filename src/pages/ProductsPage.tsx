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
  Warehouse,
  PosTerminalOption,
  KardexFilter,
  CashierUser,
} from "../types";

interface ProductsPageProps {
  cashier?: CashierUser | null;
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
import { toAssetUrl, resolveProductImageSrc, getDefaultProductImage } from "../lib/images";
import { ImageLightboxModal } from "../components/ImageLightboxModal";
import { ProductImportExportModal } from "../components/products/ProductImportExportModal";
import { TaxonomyManagementModal } from "../components/products/TaxonomyManagementModal";
import { playScanSuccess } from "../lib/sound";

export { toAssetUrl };

export function ProductsPage({ cashier, initialTab = "catalog", onBackToSales }: ProductsPageProps) {
  const [activeTab, setActiveTab] = useState<"catalog" | "inventory" | "kardex">(initialTab);
  const [search, setSearch] = useState("");
  const inventorySearchInputRef = useRef<HTMLInputElement>(null);
  const [catalogTypeFilter, setCatalogTypeFilter] = useState<"all" | "products" | "services" | "bundles">("all");
  const [selectedTagsFilter, setSelectedTagsFilter] = useState<string[]>([]);
  const [isTagFilterOpen, setIsTagFilterOpen] = useState(false);
  const tagFilterRef = useRef<HTMLDivElement>(null);
  const [inventoryStatusFilter, setInventoryStatusFilter] = useState<"all" | "optimal" | "low" | "out">("all");
  const [selectedKardexProduct, setSelectedKardexProduct] = useState<{ id: number; name: string } | null>(null);

  // Estados de Filtros Multi-Bodega, Multi-Caja y Temporalidad de Kardex
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>("all");
  const [posTerminals, setPosTerminals] = useState<PosTerminalOption[]>([]);
  const [selectedCajaId, setSelectedCajaId] = useState<string>("all");
  const [kardexTimePreset, setKardexTimePreset] = useState<"today" | "week" | "month" | "custom">("month");
  const [kardexFromDate, setKardexFromDate] = useState<string>("");
  const [kardexToDate, setKardexToDate] = useState<string>("");
  const [kardexLoading, setKardexLoading] = useState<boolean>(false);

  // Ordenamiento interactivo de columnas en Kardex
  type KardexSortField =
    | "date"
    | "time"
    | "warehouse"
    | "caja"
    | "product"
    | "kind"
    | "quantity"
    | "balance"
    | "reference";
  type SortOrder = "asc" | "desc";

  const [kardexSortField, setKardexSortField] = useState<KardexSortField>("date");
  const [kardexSortOrder, setKardexSortOrder] = useState<SortOrder>("desc");

  const handleKardexSort = (field: KardexSortField) => {
    if (kardexSortField === field) {
      setKardexSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setKardexSortField(field);
      setKardexSortOrder(
        field === "date" || field === "time" || field === "quantity" || field === "balance"
          ? "desc"
          : "asc"
      );
    }
  };

  // Ordenamiento interactivo de columnas en Catálogo
  type CatalogSortField = "type" | "sku" | "name" | "tags" | "cost" | "price" | "margin";
  const [catalogSortField, setCatalogSortField] = useState<CatalogSortField | null>(null);
  const [catalogSortOrder, setCatalogSortOrder] = useState<SortOrder>("asc");

  const handleCatalogSort = (field: CatalogSortField) => {
    if (catalogSortField === field) {
      setCatalogSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setCatalogSortField(field);
      setCatalogSortOrder(
        field === "cost" || field === "price" || field === "margin" ? "desc" : "asc"
      );
    }
  };

  // Ordenamiento interactivo de columnas en Existencias
  type InventorySortField = "status" | "sku" | "name" | "stock" | "minStock" | "cost" | "valuation";
  const [inventorySortField, setInventorySortField] = useState<InventorySortField | null>(null);
  const [inventorySortOrder, setInventorySortOrder] = useState<SortOrder>("asc");

  const handleInventorySort = (field: InventorySortField) => {
    if (inventorySortField === field) {
      setInventorySortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setInventorySortField(field);
      setInventorySortOrder(
        field === "stock" || field === "cost" || field === "valuation" ? "desc" : "asc"
      );
    }
  };

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
  const [isTaxonomyModalOpen, setIsTaxonomyModalOpen] = useState(false);
  const [isExcelModalOpen, setIsExcelModalOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const [excelModalTab, setExcelModalTab] = useState<"import" | "export">("import");
  const [categoriesList, setCategoriesList] = useState<string[]>([]);
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
      childPriceCents: number;
      childCostCents: number;
      quantity: number;
    }>
  >([]);
  const [selectedChildProductId, setSelectedChildProductId] = useState<number | "">("");
  const [selectedChildQty, setSelectedChildQty] = useState<number>(1);

  const [formSku, setFormSku] = useState("");
  const [formBarcode, setFormBarcode] = useState("");
  const [formName, setFormName] = useState("");
  const [formPriceStr, setFormPriceStr] = useState("");
  const [formWholesalePriceStr, setFormWholesalePriceStr] = useState("");
  const [formCostStr, setFormCostStr] = useState("");
  const [formTaxRateBp, setFormTaxRateBp] = useState<number>(0);
  const [formUnit, setFormUnit] = useState("pza");
  const [formStock, setFormStock] = useState<number>(0);
  const [formMinStock, setFormMinStock] = useState<number>(5);
  const [formMaxStock, setFormMaxStock] = useState<number>(0);
  const [formTags, setFormTags] = useState("");
  const [formSubmitting, setFormSubmitting] = useState(false);

  // Estados de Imagen del Producto
  const [formImagePreview, setFormImagePreview] = useState<string | null>(null);
  const [formImageBase64, setFormImageBase64] = useState<string | null>(null);
  const [formImageDeleted, setFormImageDeleted] = useState(false);
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Estado para visor maximizado de imagen (Lightbox)
  const [lightboxData, setLightboxData] = useState<{
    isOpen: boolean;
    imageSrc: string | null;
    title: string;
    subtitle?: string;
    productId?: number;
  }>({
    isOpen: false,
    imageSrc: null,
    title: "",
  });

  const handleOpenLightbox = (imageSrc: string | null, title: string, subtitle?: string, productId?: number) => {
    if (!imageSrc && !productId) return;
    setLightboxData({
      isOpen: true,
      imageSrc,
      title,
      subtitle,
      productId,
    });
  };

  const processImageFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      modalAlert({
        title: "Archivo No Válido",
        message: "Por favor seleccione o pegue un archivo de imagen (PNG, JPG, WebP).",
        variant: "warning",
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setFormImagePreview(dataUrl);
      setFormImageBase64(dataUrl);
      setFormImageDeleted(false);
    };
    reader.readAsDataURL(file);
  };

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processImageFile(file);
    }
  };

  // Soporte para pegar imágenes desde el portapapeles con Ctrl+V
  useEffect(() => {
    if (!isFormOpen) return;
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            processImageFile(file);
            break;
          }
        }
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [isFormOpen]);

  const handleRemoveImage = () => {
    setFormImagePreview(null);
    setFormImageBase64(null);
    setFormImageDeleted(true);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

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

  // Cálculo en vivo del costo total de los productos del combo y suma de precios individuales
  const bundleTotalCostCents = useMemo(() => {
    if (!formIsBundle || formComponents.length === 0) return 0;
    return formComponents.reduce(
      (sum, comp) => sum + Math.round(comp.childCostCents * comp.quantity),
      0
    );
  }, [formIsBundle, formComponents]);

  const bundleRetailSumCents = useMemo(() => {
    if (!formIsBundle || formComponents.length === 0) return 0;
    return formComponents.reduce(
      (sum, comp) => sum + Math.round(comp.childPriceCents * comp.quantity),
      0
    );
  }, [formIsBundle, formComponents]);

  // Estado del formulario de ajuste de stock (Multimodo: Entrada +, Conteo =, Salida -)
  const [adjustMode, setAdjustMode] = useState<"add" | "set" | "sub">("add");
  const [adjustQuantity, setAdjustQuantity] = useState<number>(1);
  const [adjustReason, setAdjustReason] = useState("Entrada de mercancía / Compra directa");
  const [adjustNotes, setAdjustNotes] = useState("");
  const [adjustSubmitting, setAdjustSubmitting] = useState(false);

  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showNotification = (msg: string) => {
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
    }
    setFeedback(msg);
    feedbackTimeoutRef.current = setTimeout(() => {
      setFeedback(null);
      feedbackTimeoutRef.current = null;
    }, 3800);
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

  // Cerrar menú desplegable de filtros y menú más al hacer clic fuera
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (tagFilterRef.current && !tagFilterRef.current.contains(event.target as Node)) {
        setIsTagFilterOpen(false);
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
        setIsMoreMenuOpen(false);
      }
    }
    if (isTagFilterOpen || isMoreMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isTagFilterOpen, isMoreMenuOpen]);

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

  // Cargar lista de productos (soporta overrideSearch inmediato para evitar desincronización por asincronía de React)
  const loadProducts = useCallback(async (overrideSearch?: string) => {
    try {
      setLoading(true);
      const query = typeof overrideSearch === "string" ? overrideSearch : search;
      const [data, cats] = await Promise.all([
        api.products.list(query),
        api.categories.list().catch(() => [] as string[]),
      ]);
      setProducts(data);
      setCategoriesList(cats);
      setError(null);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [search]);

  // Cargar catálogo de bodegas y terminales POS (Cajas)
  const loadWarehouses = useCallback(async () => {
    try {
      // Sincronizar catálogo de bodegas desde el ERP para reflejar nombres y asignaciones actualizadas
      await api.sync.syncWarehouses().catch(() => 0);
      const [list, terminals] = await Promise.all([
        api.products.listWarehouses(),
        api.products.listPosTerminals().catch(() => [] as PosTerminalOption[]),
      ]);
      setWarehouses(list);
      setPosTerminals(terminals);
    } catch (e: unknown) {
      console.warn("Error al cargar bodegas/cajas:", e);
    }
  }, []);

  // Cargar historial de movimientos (Kardex) con estrategia híbrida Online (ERP) + Offline (SQLite)
  const loadMovements = useCallback(async (productId?: number) => {
    try {
      setKardexLoading(true);
      const targetProdId = productId !== undefined ? productId : (selectedKardexProduct ? selectedKardexProduct.id : undefined);
      const filter: KardexFilter = {
        productId: targetProdId,
        warehouseId: selectedWarehouseId !== "all" ? selectedWarehouseId : undefined,
        cajaId: selectedCajaId !== "all" ? selectedCajaId : undefined,
        timePreset: kardexTimePreset,
        fromDate: kardexTimePreset === "custom" && kardexFromDate ? kardexFromDate : undefined,
        toDate: kardexTimePreset === "custom" && kardexToDate ? kardexToDate : undefined,
        limit: 200,
        offset: 0,
      };

      // 1. Intentar consulta centralizada en tiempo real al ERP
      try {
        const remoteData = await api.sync.queryRemoteKardex(filter);
        if (remoteData && Array.isArray(remoteData.cajas) && remoteData.cajas.length > 0) {
          setPosTerminals(remoteData.cajas as PosTerminalOption[]);
        }
        if (remoteData && Array.isArray(remoteData.movements)) {
          setMovements(remoteData.movements);
          return;
        }
      } catch {
        // Red no disponible o endpoint falló -> Fallback transparente a SQLite
      }

      // 2. Fallback a base de datos SQLite local (Offline-First)
      const localData = await api.products.listMovements(filter);
      setMovements(localData);
    } catch (e: unknown) {
      console.error("Error al cargar movimientos:", e);
    } finally {
      setKardexLoading(false);
    }
  }, [selectedKardexProduct, selectedWarehouseId, selectedCajaId, kardexTimePreset, kardexFromDate, kardexToDate]);

  // Lista ordenada en memoria según la columna y dirección seleccionada
  const sortedMovements = useMemo(() => {
    const list = [...movements];
    list.sort((a, b) => {
      let valA: string | number = "";
      let valB: string | number = "";

      const dtA = a.createdAt ? a.createdAt.replace("T", " ") : "";
      const dtB = b.createdAt ? b.createdAt.replace("T", " ") : "";
      const partsA = dtA.split(" ");
      const partsB = dtB.split(" ");
      const dateA = partsA[0] || "";
      const dateB = partsB[0] || "";
      const timeA = partsA[1] || "";
      const timeB = partsB[1] || "";

      switch (kardexSortField) {
        case "date":
          valA = dateA;
          valB = dateB;
          break;
        case "time":
          valA = timeA;
          valB = timeB;
          break;
        case "warehouse":
          valA = (a.warehouseCode || a.warehouseName || "BOD-01").toLowerCase();
          valB = (b.warehouseCode || b.warehouseName || "BOD-01").toLowerCase();
          break;
        case "caja":
          valA = (a.cajaCode || a.cajaName || "").toLowerCase();
          valB = (b.cajaCode || b.cajaName || "").toLowerCase();
          break;
        case "product":
          valA = (a.productName || "").toLowerCase();
          valB = (b.productName || "").toLowerCase();
          break;
        case "kind":
          valA = (a.kind || "").toLowerCase();
          valB = (b.kind || "").toLowerCase();
          break;
        case "quantity":
          valA = a.quantity || 0;
          valB = b.quantity || 0;
          break;
        case "balance":
          valA = a.balanceAfter ?? 0;
          valB = b.balanceAfter ?? 0;
          break;
        case "reference":
          valA = (a.reference || "").toLowerCase();
          valB = (b.reference || "").toLowerCase();
          break;
      }

      if (typeof valA === "number" && typeof valB === "number") {
        return kardexSortOrder === "asc" ? valA - valB : valB - valA;
      }
      return kardexSortOrder === "asc"
        ? String(valA).localeCompare(String(valB))
        : String(valB).localeCompare(String(valA));
    });
    return list;
  }, [movements, kardexSortField, kardexSortOrder]);

  useEffect(() => {
    loadWarehouses();
  }, [loadWarehouses]);

  const [syncingCatalog, setSyncingCatalog] = useState(false);

  // Sincronización bajo demanda de catálogo con el ERP (disparada por botón manual o tras edición)
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

  useEffect(() => {
    const t = setTimeout(() => {
      loadProducts();
    }, 250);
    return () => clearTimeout(t);
  }, [loadProducts]);

  useEffect(() => {
    if (activeTab === "kardex") {
      // Sincronizar bodegas y cajas en segundo plano de forma silenciosa y automática
      api.sync.syncWarehouses().then(() => loadWarehouses()).catch(() => {});
      loadMovements(selectedKardexProduct ? selectedKardexProduct.id : undefined);
    }
  }, [activeTab, selectedKardexProduct, selectedWarehouseId, selectedCajaId, kardexTimePreset, kardexFromDate, kardexToDate, loadMovements, loadWarehouses]);

  // ==============================================================
  // PAGINACIÓN DE ALTO RENDIMIENTO (VIRTUALIZACIÓN LIGERA)
  // ==============================================================
  const [catalogPage, setCatalogPage] = useState(1);
  const [inventoryPage, setInventoryPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState<number>(50);

  // Reiniciar a la página 1 cuando cambia el texto de búsqueda o filtros
  useEffect(() => {
    setCatalogPage(1);
    setInventoryPage(1);
  }, [search, catalogTypeFilter, selectedTagsFilter, inventoryStatusFilter, activeTab]);

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

  const sortedCatalogProducts = useMemo(() => {
    if (!catalogSortField) return catalogProducts;
    const list = [...catalogProducts];
    list.sort((a, b) => {
      let valA: string | number = "";
      let valB: string | number = "";
      switch (catalogSortField) {
        case "type":
          valA = a.isBundle ? "3" : a.isService ? "2" : "1";
          valB = b.isBundle ? "3" : b.isService ? "2" : "1";
          break;
        case "sku":
          valA = (a.barcode || a.sku || "").toLowerCase();
          valB = (b.barcode || b.sku || "").toLowerCase();
          break;
        case "name":
          valA = (a.name || "").toLowerCase();
          valB = (b.name || "").toLowerCase();
          break;
        case "tags": {
          const tagsA = parseTags(a.tags, dbTags).join(", ").toLowerCase();
          const tagsB = parseTags(b.tags, dbTags).join(", ").toLowerCase();
          valA = tagsA;
          valB = tagsB;
          break;
        }
        case "cost":
          valA = a.costCents || 0;
          valB = b.costCents || 0;
          break;
        case "price":
          valA = a.priceCents || 0;
          valB = b.priceCents || 0;
          break;
        case "margin": {
          const marginA = a.priceCents > 0 ? ((a.priceCents - a.costCents) / a.priceCents) * 100 : 0;
          const marginB = b.priceCents > 0 ? ((b.priceCents - b.costCents) / b.priceCents) * 100 : 0;
          valA = marginA;
          valB = marginB;
          break;
        }
      }
      if (typeof valA === "number" && typeof valB === "number") {
        return catalogSortOrder === "asc" ? valA - valB : valB - valA;
      }
      return catalogSortOrder === "asc"
        ? String(valA).localeCompare(String(valB))
        : String(valB).localeCompare(String(valA));
    });
    return list;
  }, [catalogProducts, catalogSortField, catalogSortOrder, dbTags]);

  const paginatedCatalogProducts = useMemo(() => {
    const start = (catalogPage - 1) * itemsPerPage;
    return sortedCatalogProducts.slice(start, start + itemsPerPage);
  }, [sortedCatalogProducts, catalogPage, itemsPerPage]);

  const totalCatalogPages = Math.max(1, Math.ceil(catalogProducts.length / itemsPerPage));

  // ==============================================================
  // CONTROL DE EXISTENCIAS: Exclusivo productos físicos simples en bodega (excluye servicios y combos)
  // ==============================================================
  const physicalProducts = useMemo(() => {
    return products.filter((p) => !p.isService && !p.isBundle);
  }, [products]);

  const inventoryFilteredProducts = useMemo(() => {
    return physicalProducts.filter((p) => {
      if (inventoryStatusFilter === "optimal") return p.stock > p.minStock;
      if (inventoryStatusFilter === "low") return p.stock <= p.minStock && p.stock > 0;
      if (inventoryStatusFilter === "out") return p.stock <= 0;
      return true;
    });
  }, [physicalProducts, inventoryStatusFilter]);

  const sortedInventoryProducts = useMemo(() => {
    if (!inventorySortField) return inventoryFilteredProducts;
    const list = [...inventoryFilteredProducts];
    list.sort((a, b) => {
      let valA: string | number = "";
      let valB: string | number = "";
      switch (inventorySortField) {
        case "status": {
          // Estado: Agotado (0), Crítico (1), Óptimo (2)
          const getStatusWeight = (p: Product) => (p.stock <= 0 ? 0 : p.stock <= p.minStock ? 1 : 2);
          valA = getStatusWeight(a);
          valB = getStatusWeight(b);
          break;
        }
        case "sku":
          valA = (a.barcode || a.sku || "").toLowerCase();
          valB = (b.barcode || b.sku || "").toLowerCase();
          break;
        case "name":
          valA = (a.name || "").toLowerCase();
          valB = (b.name || "").toLowerCase();
          break;
        case "stock":
          valA = a.stock || 0;
          valB = b.stock || 0;
          break;
        case "minStock":
          valA = a.minStock || 0;
          valB = b.minStock || 0;
          break;
        case "cost":
          valA = a.costCents || 0;
          valB = b.costCents || 0;
          break;
        case "valuation": {
          const valLineA = a.stock > 0 ? Math.round(a.stock * a.costCents) : 0;
          const valLineB = b.stock > 0 ? Math.round(b.stock * b.costCents) : 0;
          valA = valLineA;
          valB = valLineB;
          break;
        }
      }
      if (typeof valA === "number" && typeof valB === "number") {
        return inventorySortOrder === "asc" ? valA - valB : valB - valA;
      }
      return inventorySortOrder === "asc"
        ? String(valA).localeCompare(String(valB))
        : String(valB).localeCompare(String(valA));
    });
    return list;
  }, [inventoryFilteredProducts, inventorySortField, inventorySortOrder]);

  const paginatedInventoryProducts = useMemo(() => {
    const start = (inventoryPage - 1) * itemsPerPage;
    return sortedInventoryProducts.slice(start, start + itemsPerPage);
  }, [sortedInventoryProducts, inventoryPage, itemsPerPage]);

  const totalInventoryPages = Math.max(1, Math.ceil(inventoryFilteredProducts.length / itemsPerPage));

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
    setFormWholesalePriceStr("");
    setFormCostStr("");
    setFormTaxRateBp(0);
    setFormUnit(asService ? "serv" : "pza");
    setFormStock(asService || asBundle ? 0 : 1);
    setFormMinStock(asService ? 0 : 5);
    setFormMaxStock(0);
    setFormTags("");
    setFormImagePreview(null);
    setFormImageBase64(null);
    setFormImageDeleted(false);
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
    setFormWholesalePriceStr(((p.wholesalePriceCents ?? 0) / 100).toFixed(2));
    setFormCostStr((p.costCents / 100).toFixed(2));
    setFormTaxRateBp(p.taxRateBp);
    setFormUnit(p.unit);
    setFormStock(p.stock);
    setFormMinStock(p.minStock);
    setFormMaxStock(p.maxStock ?? 0);
    setFormTags(parseTags(p.tags, dbTags).join(", "));
    const initialPreview = toAssetUrl(p.imageLocalPath) || p.imageUrl || null;
    setFormImagePreview(initialPreview);
    setFormImageBase64(null);
    setFormImageDeleted(false);
    setIsFormOpen(true);

    // Cargar Base64 desde disco/SQLite como respaldo inmediato 100% garantizado
    if (p.imageLocalPath || p.id) {
      api.products
        .getImageBase64(p.id)
        .then((b64) => {
          if (b64) {
            setFormImagePreview((prev) => {
              // No sobrescribir si el usuario ya seleccionó una foto nueva en el formulario
              return formImageBase64 ? prev : b64;
            });
          }
        })
        .catch(console.warn);
    }

    if (p.isBundle) {
      api.products
        .getComponents(p.id)
        .then((comps) => {
          setFormComponents(
            comps.map((c) => {
              const catalogChild = products.find((prod) => prod.id === c.childProductId);
              return {
                childProductId: c.childProductId,
                childName: c.childName,
                childSku: c.childSku,
                childStock: c.childStock,
                childUnit: c.childUnit,
                childPriceCents: c.childPriceCents ?? catalogChild?.priceCents ?? 0,
                childCostCents: c.childCostCents ?? catalogChild?.costCents ?? 0,
                quantity: c.quantity,
              };
            })
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
    const wholesalePriceCents = toCents(formWholesalePriceStr || "0");
    const costCents = formIsBundle ? bundleTotalCostCents : toCents(formCostStr);

    if (priceCents < 0) {
      modalAlert({
        title: "Precio Inválido",
        message: "El precio de venta no puede ser negativo.",
        variant: "warning",
      });
      return;
    }

    if (!formIsService && !formIsBundle && (!formStock || formStock <= 0)) {
      modalAlert({
        title: "Inventario Requerido",
        message: "No se permite registrar productos físicos sin inventario. Ingrese una existencia mayor a 0.",
        variant: "error",
      });
      return;
    }

    if (formIsBundle) {
      if (formComponents.length === 0) {
        modalAlert({
          title: "Combo sin Productos",
          message: "Un Combo o Kit debe incluir al menos un producto componente en su receta.",
          variant: "warning",
        });
        return;
      }

      const compSinStock = formComponents.find((c) => c.childStock <= 0 || c.childStock < c.quantity);
      if (compSinStock) {
        modalAlert({
          title: "Insumo Sin Inventario",
          message: `No se permite registrar en el combo el producto "${compSinStock.childName}" porque no cuenta con inventario suficiente (Disponible: ${compSinStock.childStock} ${compSinStock.childUnit}, Requerido: ${compSinStock.quantity} ${compSinStock.childUnit}).`,
          variant: "error",
        });
        return;
      }

      if (priceCents < bundleTotalCostCents) {
        modalAlert({
          title: "Precio de Combo Inválido",
          message: `El precio de venta del combo (${formatCents(priceCents)}) nunca puede ser menor al costo total de todos sus productos (${formatCents(bundleTotalCostCents)}).`,
          variant: "error",
        });
        return;
      }
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
          wholesalePriceCents,
          costCents,
          taxRateBp: formTaxRateBp,
          unit: formUnit.trim() || (formIsService ? "serv" : "pza"),
          stock: formIsService || formIsBundle ? 0 : formStock,
          minStock: formIsService || formIsBundle ? 0 : formMinStock,
          maxStock: formIsService || formIsBundle ? 0 : formMaxStock,
          isService: formIsService,
          controlsStock: !formIsService,
          allowNegativeStock: false,
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

        // Procesar imagen si fue cambiada o eliminada
        if (formImageDeleted) {
          await api.products.deleteImage(updated.id);
        } else if (formImageBase64) {
          await api.products.saveImage(updated.id, formImageBase64);
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
          wholesalePriceCents,
          costCents,
          taxRateBp: formTaxRateBp,
          unit: formUnit.trim() || (formIsService ? "serv" : "pza"),
          stock: formIsService || formIsBundle ? 0 : formStock,
          minStock: formIsService || formIsBundle ? 0 : formMinStock,
          maxStock: formIsService || formIsBundle ? 0 : formMaxStock,
          isService: formIsService,
          controlsStock: !formIsService,
          allowNegativeStock: false,
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

        // Si se cargó imagen en nuevo producto, guardarla
        if (formImageBase64) {
          await api.products.saveImage(created.id, formImageBase64);
        }

        showNotification(
          `✓ ${formIsBundle ? "Combo" : formIsService ? "Servicio" : "Producto"} "${formName}" creado con éxito.`
        );
      }

      setIsFormOpen(false);
      loadProducts();
      // Subir producto nuevo al ERP y refrescar
      api.sync.syncCatalog().then(() => loadProducts()).catch(console.warn);
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

  // Abrir modal de ajuste de stock con soporte para modos: 'add' (Entrada +), 'set' (Conteo =), 'sub' (Salida -)
  const handleOpenAdjustModal = (p: Product, defaultMode: "add" | "set" | "sub" = "add") => {
    setAdjustingProduct(p);
    setAdjustMode(defaultMode);
    if (defaultMode === "add") {
      setAdjustQuantity(1);
      setAdjustReason("Entrada de mercancía / Compra directa");
    } else if (defaultMode === "set") {
      setAdjustQuantity(p.stock);
      setAdjustReason("Conteo físico / Cuadre de stock");
    } else {
      setAdjustQuantity(1);
      setAdjustReason("Merma por caducidad o daño");
    }
    setAdjustNotes("");
  };

  // Guardar ajuste de stock con cálculo automático según el modo
  const handleSaveAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustingProduct) return;

    let finalStock = adjustingProduct.stock;
    const addedQty = adjustQuantity;
    if (adjustMode === "add") {
      finalStock = adjustingProduct.stock + adjustQuantity;
    } else if (adjustMode === "set") {
      finalStock = adjustQuantity;
    } else if (adjustMode === "sub") {
      finalStock = adjustingProduct.stock - adjustQuantity;
    }

    if (finalStock < 0) {
      modalAlert({
        title: "Existencia Inválida",
        message: `El movimiento resultaría en un stock negativo (${finalStock} ${adjustingProduct.unit}). No se permite existencia menor a 0.`,
        variant: "warning",
      });
      return;
    }

    const currentAdjusting = adjustingProduct;
    const mode = adjustMode;

    try {
      setAdjustSubmitting(true);
      const fullReason = adjustNotes.trim()
        ? `${adjustReason}: ${adjustNotes.trim()}`
        : adjustReason;

      const input: StockAdjustmentInput = {
        productId: currentAdjusting.id,
        newStock: finalStock,
        reason: fullReason,
        warehouseId: selectedWarehouseId !== "all" ? selectedWarehouseId : undefined,
      };
      await api.products.adjustStock(input);

      // 1. Limpiar el filtro de búsqueda del escáner y restablecer a la página 1
      setSearch("");
      setInventoryPage(1);

      // 2. Cerrar el modal de ajuste de inmediato
      setAdjustingProduct(null);

      // 3. Recargar la lista completa sin filtro
      await loadProducts("");
      if (activeTab === "kardex") loadMovements();

      // 4. Feedback auditivo POS
      playScanSuccess();

      // 5. Confirmación rápida e informativa en pantalla (sin ventanas ni botones, ultra ágil)
      const actionText =
        mode === "add"
          ? `+${addedQty} ${currentAdjusting.unit} agregadas`
          : mode === "set"
          ? `Stock fijado en ${finalStock} ${currentAdjusting.unit}`
          : `-${addedQty} ${currentAdjusting.unit} retiradas`;

      showNotification(
        `✓ ${actionText} a "${currentAdjusting.name}" [${currentAdjusting.barcode || currentAdjusting.sku}] • Existencia actual: ${finalStock} ${currentAdjusting.unit}`
      );

      // 6. Retorno garantizado y redundante del foco al buscador de existencias para el siguiente escaneo
      setTimeout(focusInventorySearch, 50);
      setTimeout(focusInventorySearch, 150);
      setTimeout(focusInventorySearch, 300);

      // Sincronizar de inmediato con el ERP de forma bidireccional
      api.sync.syncCatalog().then(() => loadProducts("")).catch(console.warn);
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

  // Enfoque continuo al input de existencias/inventario
  const focusInventorySearch = useCallback(() => {
    if (activeTab === "inventory" && !isFormOpen && !adjustingProduct && !isTagsModalOpen && !isExcelModalOpen) {
      const input = inventorySearchInputRef.current;
      if (input) {
        input.focus();
        if (input.value.length > 0) {
          input.select();
        }
      }
    }
  }, [activeTab, isFormOpen, adjustingProduct, isTagsModalOpen, isExcelModalOpen]);

  // Enfocar automáticamente al ingresar o cambiar a la pestaña de Inventario
  useEffect(() => {
    if (activeTab === "inventory") {
      focusInventorySearch();
      const t = setTimeout(focusInventorySearch, 80);
      return () => clearTimeout(t);
    }
  }, [activeTab, focusInventorySearch]);

  // Re-enfocar automáticamente el buscador de existencias si se hace clic en cualquier zona libre
  useEffect(() => {
    if (activeTab !== "inventory") return;
    if (isFormOpen || adjustingProduct || isTagsModalOpen || isExcelModalOpen) return;

    const handleGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        !target.closest("button") &&
        !target.closest("input") &&
        !target.closest("select") &&
        !target.closest("textarea")
      ) {
        focusInventorySearch();
      }
    };
    window.addEventListener("click", handleGlobalClick);
    return () => window.removeEventListener("click", handleGlobalClick);
  }, [activeTab, isFormOpen, adjustingProduct, isTagsModalOpen, isExcelModalOpen, focusInventorySearch]);

  // Atajos de teclado e Interceptor Global de Escáner en Inventario
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isFormOpen) {
          setIsFormOpen(false);
        } else if (adjustingProduct) {
          setAdjustingProduct(null);
        } else if (isTagsModalOpen) {
          setIsTagsModalOpen(false);
          handleCancelEditTag();
        } else if (search.trim().length > 0 && activeTab === "inventory") {
          setSearch("");
          focusInventorySearch();
        } else if (onBackToSales) {
          onBackToSales();
        }
      } else if (e.key === "F1" && onBackToSales) {
        e.preventDefault();
        onBackToSales();
      } else if (e.key === "F8" || (e.altKey && e.key.toLowerCase() === "n")) {
        e.preventDefault();
        handleOpenCreateModal(false);
      } else if (
        activeTab === "inventory" &&
        !isFormOpen &&
        !adjustingProduct &&
        !isTagsModalOpen &&
        !isExcelModalOpen
      ) {
        // CAPTURA GLOBAL DE ESCÁNER EN INVENTARIO:
        // Si el usuario disparó el lector y el foco no estaba en el input, capturarlo y enfocarlo de inmediato
        const isOtherInputFocused =
          document.activeElement &&
          document.activeElement !== inventorySearchInputRef.current &&
          (document.activeElement.tagName === "INPUT" ||
            document.activeElement.tagName === "TEXTAREA" ||
            document.activeElement.tagName === "SELECT");

        if (isOtherInputFocused) return;

        if (
          document.activeElement !== inventorySearchInputRef.current &&
          e.key.length === 1 &&
          !e.ctrlKey &&
          !e.altKey &&
          !e.metaKey
        ) {
          e.preventDefault();
          inventorySearchInputRef.current?.focus();
          setSearch((prev) => prev + e.key);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFormOpen, adjustingProduct, isTagsModalOpen, isExcelModalOpen, activeTab, search, onBackToSales, focusInventorySearch]);

  return (
    <div className="flex flex-col h-full min-h-0 w-full bg-slate-100 dark:bg-slate-950 text-slate-800 dark:text-slate-100 font-sans transition-colors duration-150 overflow-hidden select-none">
      {/* 1. BARRA SUPERIOR DE NAVEGACIÓN LIMPIA Y MINIMALISTA */}
      <header className="h-14 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 flex items-center justify-between gap-3 shrink-0 shadow-xs z-30 select-none">
        {/* LADO IZQUIERDO: RETORNO A VENTAS */}
        <div className="flex items-center gap-3 shrink-0">
          {onBackToSales && (
            <button
              type="button"
              onClick={onBackToSales}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700/80 text-slate-700 dark:text-slate-200 font-bold text-xs border border-slate-200 dark:border-slate-700 transition-all cursor-pointer whitespace-nowrap shadow-2xs group"
              title="Volver a la Estación de Cobro (F1 / Esc)"
            >
              <span className="text-sm group-hover:-translate-x-0.5 transition-transform">←</span>
              <span>Volver a Ventas</span>
              <kbd className="px-1.5 py-0.5 rounded bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 font-mono text-[10px] font-bold border border-slate-200 dark:border-slate-700">
                F1
              </kbd>
            </button>
          )}
        </div>

        {/* CENTRO: PESTAÑAS PRINCIPALES TIPO SEGMENTED PILL */}
        <div className="flex items-center bg-slate-100 dark:bg-slate-800/90 p-1 rounded-xl border border-slate-200/80 dark:border-slate-700/70 text-xs font-bold shadow-2xs shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab("catalog")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all whitespace-nowrap cursor-pointer ${
              activeTab === "catalog"
                ? "bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-xs border border-slate-200/60 dark:border-slate-700/60 font-black"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            <span>📦</span>
            <span>Catálogo</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("inventory")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all whitespace-nowrap cursor-pointer ${
              activeTab === "inventory"
                ? "bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-xs border border-slate-200/60 dark:border-slate-700/60 font-black"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            <span>📊</span>
            <span>Existencias</span>
            <kbd className="px-1 py-0.2 rounded bg-slate-200/60 dark:bg-slate-800 text-[9px] font-mono text-slate-500">F4</kbd>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("kardex")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all whitespace-nowrap cursor-pointer ${
              activeTab === "kardex"
                ? "bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-xs border border-slate-200/60 dark:border-slate-700/60 font-black"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            <span>📜</span>
            <span>Kardex</span>
          </button>
        </div>

        {/* LADO DERECHO: ACCIONES Y HERRAMIENTAS */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setIsTaxonomyModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs border border-slate-200/80 dark:border-slate-700/80 shadow-2xs transition-all cursor-pointer whitespace-nowrap"
            title="Administrar categorías y etiquetas del catálogo con control RBAC"
          >
            <span>📁🏷️ Categorías</span>
            <span className="bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 px-1.5 py-0.2 rounded-full text-[10px] font-mono">
              {categoriesList.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleOpenCreateModal(false)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-sm transition-all cursor-pointer whitespace-nowrap active:scale-95"
            title="Registrar nuevo producto o servicio (F8)"
          >
            <span>+ Nuevo</span>
            <kbd className="bg-emerald-700/70 text-emerald-100 px-1.5 py-0.2 rounded text-[10px] font-mono">F8</kbd>
          </button>

          {/* Menú de Opciones (Excel, Sincronización) */}
          <div className="relative" ref={moreMenuRef}>
            <button
              type="button"
              onClick={() => setIsMoreMenuOpen((prev) => !prev)}
              className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-center transition-all cursor-pointer shadow-2xs"
              title="Más herramientas (Excel, Sincronización ERP)"
            >
              <span className="text-sm font-bold">⋮</span>
            </button>

            {isMoreMenuOpen && (
              <div className="absolute right-0 mt-1.5 w-56 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl py-1 z-50 text-xs font-semibold animate-in fade-in zoom-in-95 duration-100">
                <button
                  type="button"
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    setExcelModalTab("import");
                    setIsExcelModalOpen(true);
                  }}
                  className="w-full px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  <span>📗</span>
                  <span>Excel (Importar / Exportar)</span>
                </button>

                <button
                  type="button"
                  disabled={syncingCatalog}
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    handleSyncCatalog();
                  }}
                  className="w-full px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 text-slate-700 dark:text-slate-200 cursor-pointer disabled:opacity-50"
                >
                  <span className={syncingCatalog ? "animate-spin inline-block" : ""}>🔄</span>
                  <span>{syncingCatalog ? "Sincronizando..." : "Sincronizar Catálogo con ERP"}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* 2. NOTIFICACIÓN TOAST INFORMATIVA RÁPIDA (SIN VENTANA NI BOTONES, ULTRA ÁGIL) */}
      {feedback && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-3 duration-200 pointer-events-none max-w-2xl px-4">
          <div className="flex items-center justify-center gap-2.5 px-5 py-2.5 rounded-2xl bg-emerald-600/95 dark:bg-emerald-500/95 text-white font-bold text-xs shadow-2xl border border-emerald-400/50 backdrop-blur-md text-center">
            <span className="text-sm">⚡</span>
            <span>{feedback}</span>
          </div>
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
                ref={inventorySearchInputRef}
                type="text"
                autoFocus
                placeholder="Buscar existencias por SKU o nombre de producto…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const clean = search.trim();
                    if (!clean) return;

                    // 1. Buscar coincidencia rápida en memoria
                    const cleanLower = clean.toLowerCase();
                    const exact = physicalProducts.find(
                      (p) =>
                        (p.barcode && p.barcode.toLowerCase() === cleanLower) ||
                        p.sku.toLowerCase() === cleanLower
                    );

                    if (exact) {
                      handleOpenAdjustModal(exact, "add");
                      return;
                    }

                    // 2. Si aún no está en memoria, consultar directamente a SQLite por código de barras o SKU
                    try {
                      const direct = await api.products.findByBarcode(clean);
                      if (direct && !direct.isService && !direct.isBundle) {
                        handleOpenAdjustModal(direct, "add");
                        return;
                      }

                      // 3. Si no es exacto, buscar en listado general
                      const results = await api.products.list(clean);
                      const physicalResults = results.filter((p) => !p.isService && !p.isBundle);
                      if (physicalResults.length === 1) {
                        handleOpenAdjustModal(physicalResults[0], "add");
                      } else if (physicalResults.length === 0) {
                        showNotification(`⚠️ Producto "${clean}" no encontrado en inventario.`);
                      }
                    } catch (err) {
                      console.error("Error al buscar producto por código:", err);
                    }
                  }
                }}
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
                <tr className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-3 w-14 text-center select-none">Foto</th>
                  <th
                    onClick={() => handleCatalogSort("type")}
                    className="py-3 px-4 w-28 cursor-pointer select-none hover:bg-slate-200/60 dark:hover:bg-slate-900 transition-colors"
                    title="Clic para ordenar por Tipo"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Tipo</span>
                      <span className={`text-[10px] ${catalogSortField === "type" ? "text-indigo-600 dark:text-indigo-400 font-black" : "text-slate-400 opacity-50"}`}>
                        {catalogSortField === "type" ? (catalogSortOrder === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </div>
                  </th>
                  <th
                    onClick={() => handleCatalogSort("sku")}
                    className="py-3 px-4 w-40 cursor-pointer select-none hover:bg-slate-200/60 dark:hover:bg-slate-900 transition-colors"
                    title="Clic para ordenar por Código / SKU"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Código / SKU</span>
                      <span className={`text-[10px] ${catalogSortField === "sku" ? "text-indigo-600 dark:text-indigo-400 font-black" : "text-slate-400 opacity-50"}`}>
                        {catalogSortField === "sku" ? (catalogSortOrder === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </div>
                  </th>
                  <th
                    onClick={() => handleCatalogSort("name")}
                    className="py-3 px-4 cursor-pointer select-none hover:bg-slate-200/60 dark:hover:bg-slate-900 transition-colors"
                    title="Clic para ordenar por Nombre Comercial"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Nombre Comercial</span>
                      <span className={`text-[10px] ${catalogSortField === "name" ? "text-indigo-600 dark:text-indigo-400 font-black" : "text-slate-400 opacity-50"}`}>
                        {catalogSortField === "name" ? (catalogSortOrder === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </div>
                  </th>
                  <th
                    onClick={() => handleCatalogSort("tags")}
                    className="py-3 px-4 w-44 cursor-pointer select-none hover:bg-slate-200/60 dark:hover:bg-slate-900 transition-colors"
                    title="Clic para ordenar por Etiquetas"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Etiquetas (Tags)</span>
                      <span className={`text-[10px] ${catalogSortField === "tags" ? "text-indigo-600 dark:text-indigo-400 font-black" : "text-slate-400 opacity-50"}`}>
                        {catalogSortField === "tags" ? (catalogSortOrder === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </div>
                  </th>
                  <th
                    onClick={() => handleCatalogSort("cost")}
                    className="py-3 px-4 text-right w-28 cursor-pointer select-none hover:bg-slate-200/60 dark:hover:bg-slate-900 transition-colors"
                    title="Clic para ordenar por Costo"
                  >
                    <div className="flex items-center justify-end gap-1.5">
                      <span>Costo</span>
                      <span className={`text-[10px] ${catalogSortField === "cost" ? "text-indigo-600 dark:text-indigo-400 font-black" : "text-slate-400 opacity-50"}`}>
                        {catalogSortField === "cost" ? (catalogSortOrder === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </div>
                  </th>
                  <th
                    onClick={() => handleCatalogSort("price")}
                    className="py-3 px-4 text-right w-28 cursor-pointer select-none hover:bg-slate-200/60 dark:hover:bg-slate-900 transition-colors"
                    title="Clic para ordenar por Precio de Venta"
                  >
                    <div className="flex items-center justify-end gap-1.5">
                      <span>Precio Venta</span>
                      <span className={`text-[10px] ${catalogSortField === "price" ? "text-indigo-600 dark:text-indigo-400 font-black" : "text-slate-400 opacity-50"}`}>
                        {catalogSortField === "price" ? (catalogSortOrder === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </div>
                  </th>
                  <th
                    onClick={() => handleCatalogSort("margin")}
                    className="py-3 px-4 text-right w-28 cursor-pointer select-none hover:bg-slate-200/60 dark:hover:bg-slate-900 transition-colors"
                    title="Clic para ordenar por Margen Bruto"
                  >
                    <div className="flex items-center justify-end gap-1.5">
                      <span>Margen Bruto</span>
                      <span className={`text-[10px] ${catalogSortField === "margin" ? "text-indigo-600 dark:text-indigo-400 font-black" : "text-slate-400 opacity-50"}`}>
                        {catalogSortField === "margin" ? (catalogSortOrder === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </div>
                  </th>
                  <th className="py-3 px-4 text-center w-28 select-none">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {catalogProducts.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-400 dark:text-slate-500">
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
                  paginatedCatalogProducts.map((p) => {
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
                        {/* FOTO LOCAL O PREDETERMINADA */}
                        <td className="py-2.5 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                          {(() => {
                            const kind = p.isBundle ? "bundle" : p.isService ? "service" : "product";
                            const imgSrc = resolveProductImageSrc(p.imageLocalPath, p.imageUrl, kind);

                            return (
                              <img
                                src={imgSrc}
                                alt={p.name}
                                onDoubleClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenLightbox(
                                    imgSrc,
                                    p.name,
                                    `Código / SKU: ${p.sku} • Precio: ${formatCents(p.priceCents)}`,
                                    p.id
                                  );
                                }}
                                title="Doble clic para maximizar imagen"
                                className="w-10 h-10 object-cover rounded-lg border border-slate-200 dark:border-slate-700 mx-auto shadow-xs bg-white dark:bg-slate-900 cursor-zoom-in hover:scale-105 transition-transform"
                                onError={(e) => {
                                  (e.currentTarget as HTMLImageElement).src = getDefaultProductImage(kind);
                                }}
                              />
                            );
                          })()}
                        </td>

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

            {/* BARRA DE PAGINACIÓN DE ALTO RENDIMIENTO */}
            {catalogProducts.length > 0 && (
              <div className="p-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 bg-slate-50/50 dark:bg-slate-900/50">
                <div className="flex items-center gap-2">
                  <span>
                    Mostrando <strong className="text-slate-800 dark:text-slate-200">{(catalogPage - 1) * itemsPerPage + 1}</strong> a{" "}
                    <strong className="text-slate-800 dark:text-slate-200">{Math.min(catalogPage * itemsPerPage, catalogProducts.length)}</strong> de{" "}
                    <strong className="text-slate-800 dark:text-slate-200">{catalogProducts.length}</strong> ítems
                  </span>
                  <select
                    value={itemsPerPage}
                    onChange={(e) => {
                      setItemsPerPage(Number(e.target.value));
                      setCatalogPage(1);
                    }}
                    className="ml-2 px-2 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value={25}>25 por página</option>
                    <option value={50}>50 por página</option>
                    <option value={100}>100 por página</option>
                    <option value={200}>200 por página</option>
                  </select>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={catalogPage === 1}
                    onClick={() => setCatalogPage(1)}
                    className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-40 font-bold transition-colors"
                    title="Primera página"
                  >
                    ««
                  </button>
                  <button
                    type="button"
                    disabled={catalogPage === 1}
                    onClick={() => setCatalogPage((p) => Math.max(1, p - 1))}
                    className="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-40 font-bold transition-colors"
                  >
                    ‹ Anterior
                  </button>
                  <span className="px-3 py-1 font-bold text-slate-800 dark:text-slate-200">
                    Página {catalogPage} de {totalCatalogPages}
                  </span>
                  <button
                    type="button"
                    disabled={catalogPage >= totalCatalogPages}
                    onClick={() => setCatalogPage((p) => Math.min(totalCatalogPages, p + 1))}
                    className="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-40 font-bold transition-colors"
                  >
                    Siguiente ›
                  </button>
                  <button
                    type="button"
                    disabled={catalogPage >= totalCatalogPages}
                    onClick={() => setCatalogPage(totalCatalogPages)}
                    className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-40 font-bold transition-colors"
                    title="Última página"
                  >
                    »»
                  </button>
                </div>
              </div>
            )}
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
                  <tr className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider text-[11px]">
                    <th
                      onClick={() => handleInventorySort("status")}
                      className="py-3 px-4 w-28 cursor-pointer select-none hover:bg-slate-200/60 dark:hover:bg-slate-900 transition-colors"
                      title="Clic para ordenar por Estado de Existencia"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Estado</span>
                        <span className={`text-[10px] ${inventorySortField === "status" ? "text-indigo-600 dark:text-indigo-400 font-black" : "text-slate-400 opacity-50"}`}>
                          {inventorySortField === "status" ? (inventorySortOrder === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      </div>
                    </th>
                    <th
                      onClick={() => handleInventorySort("sku")}
                      className="py-3 px-4 w-40 cursor-pointer select-none hover:bg-slate-200/60 dark:hover:bg-slate-900 transition-colors"
                      title="Clic para ordenar por Código / SKU"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Código / SKU</span>
                        <span className={`text-[10px] ${inventorySortField === "sku" ? "text-indigo-600 dark:text-indigo-400 font-black" : "text-slate-400 opacity-50"}`}>
                          {inventorySortField === "sku" ? (inventorySortOrder === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      </div>
                    </th>
                    <th
                      onClick={() => handleInventorySort("name")}
                      className="py-3 px-4 cursor-pointer select-none hover:bg-slate-200/60 dark:hover:bg-slate-900 transition-colors"
                      title="Clic para ordenar por Producto en Almacén"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Producto en Almacén</span>
                        <span className={`text-[10px] ${inventorySortField === "name" ? "text-indigo-600 dark:text-indigo-400 font-black" : "text-slate-400 opacity-50"}`}>
                          {inventorySortField === "name" ? (inventorySortOrder === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      </div>
                    </th>
                    <th
                      onClick={() => handleInventorySort("stock")}
                      className="py-3 px-4 text-right w-36 cursor-pointer select-none hover:bg-slate-200/60 dark:hover:bg-slate-900 transition-colors"
                      title="Clic para ordenar por Existencia Actual"
                    >
                      <div className="flex items-center justify-end gap-1.5">
                        <span>Existencia Actual</span>
                        <span className={`text-[10px] ${inventorySortField === "stock" ? "text-indigo-600 dark:text-indigo-400 font-black" : "text-slate-400 opacity-50"}`}>
                          {inventorySortField === "stock" ? (inventorySortOrder === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      </div>
                    </th>
                    <th
                      onClick={() => handleInventorySort("minStock")}
                      className="py-3 px-4 text-right w-28 cursor-pointer select-none hover:bg-slate-200/60 dark:hover:bg-slate-900 transition-colors"
                      title="Clic para ordenar por Stock Mínimo"
                    >
                      <div className="flex items-center justify-end gap-1.5">
                        <span>Stock Mínimo</span>
                        <span className={`text-[10px] ${inventorySortField === "minStock" ? "text-indigo-600 dark:text-indigo-400 font-black" : "text-slate-400 opacity-50"}`}>
                          {inventorySortField === "minStock" ? (inventorySortOrder === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      </div>
                    </th>
                    <th
                      onClick={() => handleInventorySort("cost")}
                      className="py-3 px-4 text-right w-28 cursor-pointer select-none hover:bg-slate-200/60 dark:hover:bg-slate-900 transition-colors"
                      title="Clic para ordenar por Costo Unitario"
                    >
                      <div className="flex items-center justify-end gap-1.5">
                        <span>Costo Unit.</span>
                        <span className={`text-[10px] ${inventorySortField === "cost" ? "text-indigo-600 dark:text-indigo-400 font-black" : "text-slate-400 opacity-50"}`}>
                          {inventorySortField === "cost" ? (inventorySortOrder === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      </div>
                    </th>
                    <th
                      onClick={() => handleInventorySort("valuation")}
                      className="py-3 px-4 text-right w-36 cursor-pointer select-none hover:bg-slate-200/60 dark:hover:bg-slate-900 transition-colors"
                      title="Clic para ordenar por Valor Total en Bodega"
                    >
                      <div className="flex items-center justify-end gap-1.5">
                        <span>Valor en Bodega</span>
                        <span className={`text-[10px] ${inventorySortField === "valuation" ? "text-indigo-600 dark:text-indigo-400 font-black" : "text-slate-400 opacity-50"}`}>
                          {inventorySortField === "valuation" ? (inventorySortOrder === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      </div>
                    </th>
                    <th className="py-3 px-4 text-center w-48 select-none">Acciones de Almacén</th>
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
                    paginatedInventoryProducts.map((p) => {
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
                            <div className="flex items-center justify-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleOpenAdjustModal(p, "add")}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 active:scale-95 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/60 border border-emerald-300 dark:border-emerald-700/70 text-emerald-700 dark:text-emerald-300 font-semibold text-xs transition-all shadow-xs hover:shadow-sm cursor-pointer"
                                title="Entrada rápida de mercancía (+)"
                              >
                                <svg className="w-3.5 h-3.5 stroke-[2.5]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                                </svg>
                                <span>Entrada</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleViewProductKardex(p)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 active:scale-95 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/60 border border-indigo-200 dark:border-indigo-700/70 text-indigo-700 dark:text-indigo-300 font-semibold text-xs transition-all shadow-xs hover:shadow-sm cursor-pointer"
                                title="Ver historial de movimientos Kardex"
                              >
                                <svg className="w-3.5 h-3.5 stroke-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                                </svg>
                                <span>Kardex</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>

              {/* BARRA DE PAGINACIÓN DE ALTO RENDIMIENTO (EXISTENCIAS F4) */}
              {inventoryFilteredProducts.length > 0 && (
                <div className="p-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 bg-slate-50/50 dark:bg-slate-900/50">
                  <div className="flex items-center gap-2">
                    <span>
                      Mostrando <strong className="text-slate-800 dark:text-slate-200">{(inventoryPage - 1) * itemsPerPage + 1}</strong> a{" "}
                      <strong className="text-slate-800 dark:text-slate-200">{Math.min(inventoryPage * itemsPerPage, inventoryFilteredProducts.length)}</strong> de{" "}
                      <strong className="text-slate-800 dark:text-slate-200">{inventoryFilteredProducts.length}</strong> artículos
                    </span>
                    <select
                      value={itemsPerPage}
                      onChange={(e) => {
                        setItemsPerPage(Number(e.target.value));
                        setInventoryPage(1);
                      }}
                      className="ml-2 px-2 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value={25}>25 por página</option>
                      <option value={50}>50 por página</option>
                      <option value={100}>100 por página</option>
                      <option value={200}>200 por página</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={inventoryPage === 1}
                      onClick={() => setInventoryPage(1)}
                      className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-40 font-bold transition-colors"
                      title="Primera página"
                    >
                      ««
                    </button>
                    <button
                      type="button"
                      disabled={inventoryPage === 1}
                      onClick={() => setInventoryPage((p) => Math.max(1, p - 1))}
                      className="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-40 font-bold transition-colors"
                    >
                      ‹ Anterior
                    </button>
                    <span className="px-3 py-1 font-bold text-slate-800 dark:text-slate-200">
                      Página {inventoryPage} de {totalInventoryPages}
                    </span>
                    <button
                      type="button"
                      disabled={inventoryPage >= totalInventoryPages}
                      onClick={() => setInventoryPage((p) => Math.min(totalInventoryPages, p + 1))}
                      className="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-40 font-bold transition-colors"
                    >
                      Siguiente ›
                    </button>
                    <button
                      type="button"
                      disabled={inventoryPage >= totalInventoryPages}
                      onClick={() => setInventoryPage(totalInventoryPages)}
                      className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-40 font-bold transition-colors"
                      title="Última página"
                    >
                      »»
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: HISTORIAL DE MOVIMIENTOS (KARDEX) */}
        {activeTab === "kardex" && (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col">
            {/* CABECERA Y FILTROS DEL KARDEX */}
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-3 bg-slate-50/50 dark:bg-slate-900/50">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                      Historial de Movimientos de Inventario (Kardex)
                    </h2>
                    {kardexLoading && (
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-indigo-600 dark:text-indigo-400">
                        <span className="w-3.5 h-3.5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                        <span>Actualizando...</span>
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {selectedKardexProduct ? (
                      <span className="flex items-center gap-2">
                        <span>
                          Filtrado por producto:{" "}
                          <strong className="text-indigo-600 dark:text-indigo-400">
                            {selectedKardexProduct.name}
                          </strong>
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedKardexProduct(null);
                          }}
                          className="text-xs font-bold text-slate-600 dark:text-slate-300 hover:underline cursor-pointer bg-slate-200/80 dark:bg-slate-800 px-2 py-0.5 rounded-md"
                        >
                          ✕ Quitar filtro de producto
                        </button>
                      </span>
                    ) : (
                      "Auditoría transaccional de ventas, compras, traslados y ajustes por bodega."
                    )}
                  </div>
                </div>
              </div>

              {/* FILTROS MULTI-BODEGA, MULTI-CAJA Y TEMPORALIDAD */}
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex flex-wrap items-center gap-3">
                  {/* 1. Selector de Bodega */}
                  <div className="flex items-center gap-2">
                    <label className="font-bold text-slate-700 dark:text-slate-300 whitespace-nowrap flex items-center gap-1">
                      <span>🏬 Bodega:</span>
                    </label>
                    <select
                      value={selectedWarehouseId}
                      onChange={(e) => setSelectedWarehouseId(e.target.value)}
                      className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer shadow-2xs"
                    >
                      <option value="all">Todas las Bodegas</option>
                      {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          [{w.code}] {w.name} {w.isDefault ? "★ Principal" : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* 1.5. Selector de Caja (Terminal POS) */}
                  <div className="flex items-center gap-2">
                    <label className="font-bold text-slate-700 dark:text-slate-300 whitespace-nowrap flex items-center gap-1">
                      <span>🖥️ Caja:</span>
                    </label>
                    <select
                      value={selectedCajaId}
                      onChange={(e) => setSelectedCajaId(e.target.value)}
                      className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer shadow-2xs"
                    >
                      <option value="all">Todas las Cajas</option>
                      {posTerminals.map((c) => (
                        <option key={c.id} value={c.id}>
                          [{c.code}] {c.name} {c.isCurrent ? "★ Esta Caja" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* 2. Selector de Período Temporal */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                    <span>📅 Período:</span>
                  </span>
                  <div className="inline-flex rounded-xl bg-slate-200/70 dark:bg-slate-800 p-0.5 border border-slate-300 dark:border-slate-700 font-semibold text-xs">
                    <button
                      type="button"
                      onClick={() => setKardexTimePreset("today")}
                      className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                        kardexTimePreset === "today"
                          ? "bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 font-bold shadow-2xs"
                          : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                      }`}
                    >
                      Hoy (Día)
                    </button>
                    <button
                      type="button"
                      onClick={() => setKardexTimePreset("week")}
                      className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                        kardexTimePreset === "week"
                          ? "bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 font-bold shadow-2xs"
                          : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                      }`}
                    >
                      Esta Semana
                    </button>
                    <button
                      type="button"
                      onClick={() => setKardexTimePreset("month")}
                      className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                        kardexTimePreset === "month"
                          ? "bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 font-bold shadow-2xs"
                          : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                      }`}
                    >
                      Este Mes
                    </button>
                    <button
                      type="button"
                      onClick={() => setKardexTimePreset("custom")}
                      className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                        kardexTimePreset === "custom"
                          ? "bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 font-bold shadow-2xs"
                          : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                      }`}
                    >
                      Personalizado
                    </button>
                  </div>

                  {/* Campos de Rango de Fecha Personalizado */}
                  {kardexTimePreset === "custom" && (
                    <div className="flex items-center gap-1.5 animate-fadeIn">
                      <span className="text-[11px] text-slate-500 font-medium">Desde:</span>
                      <input
                        type="date"
                        value={kardexFromDate}
                        onChange={(e) => setKardexFromDate(e.target.value)}
                        className="px-2 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                      <span className="text-[11px] text-slate-500 font-medium">Hasta:</span>
                      <input
                        type="date"
                        value={kardexToDate}
                        onChange={(e) => setKardexToDate(e.target.value)}
                        className="px-2 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-mono font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* TABLA DE AUDITORÍA KARDEX */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100/70 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-bold uppercase tracking-wider text-[11px]">
                    <th
                      onClick={() => handleKardexSort("date")}
                      className="py-3 px-3.5 w-28 cursor-pointer select-none hover:bg-slate-200/60 dark:hover:bg-slate-900 transition-colors"
                      title="Clic para ordenar por Fecha"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Fecha</span>
                        <span className={`text-[10px] ${kardexSortField === "date" ? "text-indigo-600 dark:text-indigo-400 font-black" : "text-slate-400 opacity-50"}`}>
                          {kardexSortField === "date" ? (kardexSortOrder === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      </div>
                    </th>
                    <th
                      onClick={() => handleKardexSort("time")}
                      className="py-3 px-3 w-24 cursor-pointer select-none hover:bg-slate-200/60 dark:hover:bg-slate-900 transition-colors"
                      title="Clic para ordenar por Hora"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Hora</span>
                        <span className={`text-[10px] ${kardexSortField === "time" ? "text-indigo-600 dark:text-indigo-400 font-black" : "text-slate-400 opacity-50"}`}>
                          {kardexSortField === "time" ? (kardexSortOrder === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      </div>
                    </th>
                    <th
                      onClick={() => handleKardexSort("warehouse")}
                      className="py-3 px-3 w-28 cursor-pointer select-none hover:bg-slate-200/60 dark:hover:bg-slate-900 transition-colors"
                      title="Clic para ordenar por Bodega"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Bodega</span>
                        <span className={`text-[10px] ${kardexSortField === "warehouse" ? "text-indigo-600 dark:text-indigo-400 font-black" : "text-slate-400 opacity-50"}`}>
                          {kardexSortField === "warehouse" ? (kardexSortOrder === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      </div>
                    </th>
                    <th
                      onClick={() => handleKardexSort("caja")}
                      className="py-3 px-3 w-32 cursor-pointer select-none hover:bg-slate-200/60 dark:hover:bg-slate-900 transition-colors"
                      title="Clic para ordenar por Caja"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Caja</span>
                        <span className={`text-[10px] ${kardexSortField === "caja" ? "text-indigo-600 dark:text-indigo-400 font-black" : "text-slate-400 opacity-50"}`}>
                          {kardexSortField === "caja" ? (kardexSortOrder === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      </div>
                    </th>
                    <th
                      onClick={() => handleKardexSort("product")}
                      className="py-3 px-3.5 cursor-pointer select-none hover:bg-slate-200/60 dark:hover:bg-slate-900 transition-colors"
                      title="Clic para ordenar por Producto"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Producto</span>
                        <span className={`text-[10px] ${kardexSortField === "product" ? "text-indigo-600 dark:text-indigo-400 font-black" : "text-slate-400 opacity-50"}`}>
                          {kardexSortField === "product" ? (kardexSortOrder === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      </div>
                    </th>
                    <th
                      onClick={() => handleKardexSort("kind")}
                      className="py-3 px-3 w-28 cursor-pointer select-none hover:bg-slate-200/60 dark:hover:bg-slate-900 transition-colors"
                      title="Clic para ordenar por Tipo de Operación"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Operación</span>
                        <span className={`text-[10px] ${kardexSortField === "kind" ? "text-indigo-600 dark:text-indigo-400 font-black" : "text-slate-400 opacity-50"}`}>
                          {kardexSortField === "kind" ? (kardexSortOrder === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      </div>
                    </th>
                    <th
                      onClick={() => handleKardexSort("quantity")}
                      className="py-3 px-3 text-right w-24 cursor-pointer select-none hover:bg-slate-200/60 dark:hover:bg-slate-900 transition-colors"
                      title="Clic para ordenar por Cantidad"
                    >
                      <div className="flex items-center justify-end gap-1.5">
                        <span>Cantidad</span>
                        <span className={`text-[10px] ${kardexSortField === "quantity" ? "text-indigo-600 dark:text-indigo-400 font-black" : "text-slate-400 opacity-50"}`}>
                          {kardexSortField === "quantity" ? (kardexSortOrder === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      </div>
                    </th>
                    <th
                      onClick={() => handleKardexSort("balance")}
                      className="py-3 px-3 text-center w-36 cursor-pointer select-none hover:bg-slate-200/60 dark:hover:bg-slate-900 transition-colors"
                      title="Clic para ordenar por Saldo Final"
                    >
                      <div className="flex items-center justify-center gap-1.5">
                        <span>Saldo (Antes → Después)</span>
                        <span className={`text-[10px] ${kardexSortField === "balance" ? "text-indigo-600 dark:text-indigo-400 font-black" : "text-slate-400 opacity-50"}`}>
                          {kardexSortField === "balance" ? (kardexSortOrder === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      </div>
                    </th>
                    <th
                      onClick={() => handleKardexSort("reference")}
                      className="py-3 px-3.5 cursor-pointer select-none hover:bg-slate-200/60 dark:hover:bg-slate-900 transition-colors"
                      title="Clic para ordenar por Referencia"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Referencia / Motivo</span>
                        <span className={`text-[10px] ${kardexSortField === "reference" ? "text-indigo-600 dark:text-indigo-400 font-black" : "text-slate-400 opacity-50"}`}>
                          {kardexSortField === "reference" ? (kardexSortOrder === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-sans">
                  {sortedMovements.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-14 text-center text-slate-400">
                        {kardexLoading ? (
                          <div className="flex flex-col items-center gap-2">
                            <span className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                            <span>Cargando movimientos de inventario...</span>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center gap-1">
                            <span className="text-2xl">📦</span>
                            <span className="font-semibold text-slate-600 dark:text-slate-400">
                              No hay movimientos de inventario en el período, bodega o caja seleccionada.
                            </span>
                            <span className="text-[11px] text-slate-400">
                              Prueba cambiando el filtro de bodega, caja o el rango de fechas.
                            </span>
                          </div>
                        )}
                      </td>
                    </tr>
                  ) : (
                    sortedMovements.map((m) => {
                      const isPositive = m.quantity > 0;
                      const rawDt = m.createdAt ? m.createdAt.replace("T", " ") : "";
                      const [dateStr = "", timeStrFull = ""] = rawDt.split(" ");
                      const timeStr = timeStrFull.substring(0, 8);

                      return (
                        <tr key={m.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                          <td className="py-3 px-3.5 font-mono text-slate-700 dark:text-slate-300 font-semibold whitespace-nowrap text-xs">
                            {dateStr || "—"}
                          </td>
                          <td className="py-3 px-3 font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap text-[11px]">
                            {timeStr || "—"}
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 font-mono">
                              {m.warehouseCode || m.warehouseName || "BOD-01"}
                            </span>
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            {m.cajaCode || m.cajaName ? (
                              <span
                                title={m.cajaName ? `${m.cajaName} (${m.cajaCode || ""})` : undefined}
                                className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 font-mono inline-flex items-center gap-1"
                              >
                                <span>🖥️</span>
                                <span>{m.cajaCode || m.cajaName}</span>
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-50 dark:bg-slate-900 text-slate-400 dark:text-slate-500 border border-slate-200/70 dark:border-slate-800 font-mono">
                                ERP / General
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3.5">
                            <div className="font-bold text-slate-900 dark:text-white">
                              {m.productName || `Producto #${m.productId}`}
                            </div>
                            {m.productSku && (
                              <div className="text-[10px] font-mono text-slate-400">
                                SKU: {m.productSku}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
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
                                Entrada (Compra)
                              </span>
                            )}
                            {m.kind === "return" && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
                                Devolución
                              </span>
                            )}
                          </td>
                          <td
                            className={`py-3 px-3 text-right font-mono font-bold whitespace-nowrap ${
                              isPositive
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-rose-600 dark:text-rose-400"
                            }`}
                          >
                            {isPositive ? `+${m.quantity}` : m.quantity}
                          </td>
                          <td className="py-3 px-3 text-center font-mono whitespace-nowrap text-slate-600 dark:text-slate-300">
                            {m.balanceBefore !== undefined && m.balanceBefore !== null && m.balanceAfter !== undefined && m.balanceAfter !== null ? (
                              <span className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800/80 px-2 py-0.5 rounded-md text-[11px]">
                                <span className="text-slate-400">{m.balanceBefore}</span>
                                <span className="text-slate-400">→</span>
                                <strong className="text-slate-900 dark:text-white font-bold">{m.balanceAfter}</strong>
                              </span>
                            ) : (
                              <span className="text-slate-400 text-[10px]">—</span>
                            )}
                          </td>
                          <td className="py-3 px-3.5 text-slate-600 dark:text-slate-300 text-xs">
                            <span className="font-semibold text-slate-800 dark:text-slate-200">
                              {m.reference || "Sin referencia"}
                            </span>
                            {m.unitCostCents !== undefined && m.unitCostCents !== null && m.unitCostCents > 0 && (
                              <span className="block text-[10px] text-slate-400 font-mono">
                                Costo Unit: {formatCents(m.unitCostCents)}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* BARRA DE RESUMEN DE KARDEX */}
            <div className="p-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 bg-slate-50/50 dark:bg-slate-900/50">
              <div>
                Total movimientos auditados: <strong className="text-slate-800 dark:text-slate-200">{sortedMovements.length}</strong>
              </div>
              <div className="text-[11px] text-slate-400">
                ✓ Sincronizado en tiempo real con todas las cajas y bodegas.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ==============================================================
          MODAL: CREAR O EDITAR PRODUCTO / SERVICIO / COMBO
          ============================================================== */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-4xl lg:max-w-5xl max-h-[92vh] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95">
            <header className="px-6 py-3.5 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <span className="text-xl">
                  {editingProduct ? "✏️" : formIsBundle ? "🍱" : formIsService ? "🛠️" : "✨"}
                </span>
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <span>{editingProduct ? "Modificar" : "Nuevo"}</span>
                    <span>{formIsBundle ? "Combo / Kit" : formIsService ? "Servicio" : "Producto"}</span>
                  </h2>
                  <p className="text-[11px] text-slate-400 font-medium">
                    {formIsBundle
                      ? "Configura la receta de componentes con descuento atómico de inventario"
                      : formIsService
                      ? "Artículo facturable sin control de existencias físicas en bodega"
                      : "Artículo con control de existencias y kardex de bodega"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-base font-bold cursor-pointer"
                title="Cerrar (Esc)"
              >
                ✕
              </button>
            </header>

            <form onSubmit={handleSaveProduct} className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
                {/* SELECTOR DE TIPO (PRODUCTO FÍSICO VS SERVICIO VS COMBO) */}
                <div className="bg-slate-50 dark:bg-slate-950/60 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
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
                          : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800"
                      }`}
                    >
                      <span className="flex items-center gap-1.5">📦 Físico</span>
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
                          : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800"
                      }`}
                    >
                      <span className="flex items-center gap-1.5">🛠️ Servicio</span>
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
                          : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800"
                      }`}
                    >
                      <span className="flex items-center gap-1.5">🍱 Combo / Kit</span>
                      <span className="text-[9px] text-purple-500 font-normal">Receta Hijos</span>
                    </button>
                  </div>
                </div>

                {/* GRID PRINCIPAL RESPONSIVO (2 COLUMNAS EN ESCRITORIO/TABLET, 1 EN PANTALLAS PEQUEÑAS) */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                  {/* COLUMNA IZQUIERDA: IDENTIFICACIÓN, NOMBRE Y PRECIOS (lg:col-span-6) */}
                  <div className="lg:col-span-6 space-y-4">
                    {/* CÓDIGO DE BARRAS & SKU */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                            Código de Barras
                          </label>
                          <button
                            type="button"
                            onClick={() => setFormBarcode(Date.now().toString().slice(-8))}
                            className="text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold hover:underline cursor-pointer"
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
                        Nombre del {formIsService ? "Servicio" : formIsBundle ? "Combo" : "Producto"} *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder={
                          formIsService
                            ? "Ej. Mantenimiento Preventivo, Asesoría, Domicilio"
                            : formIsBundle
                            ? "Ej. Combo Familiar 2x1, Paquete Escolar Básico"
                            : "Ej. Coca Cola 600ml, Azúcar 1kg, Cuaderno 100 Hojas"
                        }
                        value={formName}
                        onChange={(e) => setFormName(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    {/* FOTOGRAFÍA DEL PRODUCTO (OFFLINE LOCAL + SYNC) */}
                    <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800">
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                          <span>📷 Fotografía del Producto</span>
                          <span className="text-[10px] text-slate-400 font-normal">Almacenamiento Local Offline</span>
                        </label>
                        {formImagePreview && (
                          <button
                            type="button"
                            onClick={handleRemoveImage}
                            className="text-[11px] font-bold text-red-600 dark:text-red-400 hover:underline cursor-pointer flex items-center gap-1"
                          >
                            ✕ Quitar Foto
                          </button>
                        )}
                      </div>

                      <div
                        onDragOver={(e) => {
                          e.preventDefault();
                          setIsDraggingImage(true);
                        }}
                        onDragLeave={(e) => {
                          e.preventDefault();
                          setIsDraggingImage(false);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          setIsDraggingImage(false);
                          const file = e.dataTransfer.files?.[0];
                          if (file) {
                            processImageFile(file);
                          }
                        }}
                        className={`p-3 rounded-2xl border-2 transition-all flex items-center gap-3.5 ${
                          isDraggingImage
                            ? "border-indigo-500 bg-indigo-50/80 dark:bg-indigo-950/50 scale-[1.01]"
                            : "border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/40 hover:border-slate-400 dark:hover:border-slate-600"
                        }`}
                      >
                        <div
                          onClick={() => fileInputRef.current?.click()}
                          className="w-16 h-16 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex items-center justify-center overflow-hidden shrink-0 shadow-xs cursor-pointer hover:opacity-90"
                          title="Clic para seleccionar imagen"
                        >
                          {(() => {
                            const kind = formIsBundle ? "bundle" : formIsService ? "service" : "product";
                            const displayPreview = formImagePreview || getDefaultProductImage(kind);

                            return (
                              <img
                                src={displayPreview}
                                alt="Preview"
                                onDoubleClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenLightbox(
                                    displayPreview,
                                    formName || "Foto del Producto",
                                    formSku ? `SKU: ${formSku}` : undefined,
                                    editingProduct?.id
                                  );
                                }}
                                title="Doble clic para maximizar imagen"
                                className="w-full h-full object-cover cursor-zoom-in"
                                onError={async (e) => {
                                  if (editingProduct?.id && formImagePreview) {
                                    try {
                                      const b64 = await api.products.getImageBase64(editingProduct.id);
                                      if (b64) {
                                        setFormImagePreview(b64);
                                        return;
                                      }
                                    } catch (err) {
                                      console.warn("[ProductsPage] Error al cargar fallback Base64:", err);
                                    }
                                  }
                                  (e.currentTarget as HTMLImageElement).src = getDefaultProductImage(kind);
                                }}
                              />
                            );
                          })()}
                        </div>

                        <div className="flex-1 space-y-1">
                          <input
                            type="file"
                            ref={fileInputRef}
                            accept="image/png,image/jpeg,image/webp,image/jpg"
                            onChange={handleImageFileChange}
                            className="hidden"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => fileInputRef.current?.click()}
                              className="px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 font-bold text-xs hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition-colors cursor-pointer inline-flex items-center gap-1.5"
                            >
                              <span>📁 {formImagePreview ? "Cambiar Imagen" : "Examinar..."}</span>
                            </button>
                            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                              o arrastra una foto aquí
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-400 flex items-center gap-1">
                            <span>💡 También puedes pegar cualquier foto copiada con</span>
                            <kbd className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono font-bold text-[9px]">
                              Ctrl + V
                            </kbd>
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* PRECIO DE VENTA, MAYOREO Y COSTO */}
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                        <div>
                          <label className="block text-xs font-bold text-emerald-700 dark:text-emerald-400 mb-1">
                            Precio Venta ($) *
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min={formIsBundle ? (bundleTotalCostCents / 100).toFixed(2) : "0"}
                            required
                            placeholder="0.00"
                            value={formPriceStr}
                            onChange={(e) => setFormPriceStr(e.target.value)}
                            className={`w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border text-xs font-mono font-black focus:outline-none focus:ring-2 ${
                              formIsBundle &&
                              formComponents.length > 0 &&
                              toCents(formPriceStr || "0") < bundleTotalCostCents
                                ? "border-rose-500 text-rose-600 dark:text-rose-400 focus:ring-rose-500"
                                : "border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 focus:ring-emerald-500"
                            }`}
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                            P. Mayoreo ($)
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            value={formWholesalePriceStr}
                            onChange={(e) => setFormWholesalePriceStr(e.target.value)}
                            className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-xs font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                            {formIsBundle ? "Costo Combo (Auto)" : "Costo ($)"}
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            readOnly={formIsBundle}
                            value={formIsBundle ? (bundleTotalCostCents / 100).toFixed(2) : formCostStr}
                            onChange={(e) => {
                              if (!formIsBundle) setFormCostStr(e.target.value);
                            }}
                            title={
                              formIsBundle
                                ? "El costo de un combo se calcula automáticamente sumando el costo de sus insumos"
                                : undefined
                            }
                            className={`w-full px-3 py-2 rounded-xl border text-xs font-mono font-bold focus:outline-none ${
                              formIsBundle
                                ? "bg-purple-50 dark:bg-purple-950/50 border-purple-300 dark:border-purple-800 text-purple-800 dark:text-purple-200 cursor-not-allowed"
                                : "bg-slate-50 dark:bg-slate-950 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
                            }`}
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

                      {formIsBundle && formComponents.length > 0 && toCents(formPriceStr || "0") < bundleTotalCostCents && (
                        <div className="px-3 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-[11px] font-bold text-rose-700 dark:text-rose-300 flex items-center justify-between">
                          <span>
                            ⚠️ El Precio de Venta no puede ser menor al Costo Total de Insumos ({formatCents(bundleTotalCostCents)}).
                          </span>
                          <button
                            type="button"
                            onClick={() => setFormPriceStr((bundleRetailSumCents / 100).toFixed(2))}
                            className="underline text-purple-700 dark:text-purple-300 hover:opacity-80 ml-2 shrink-0 cursor-pointer"
                          >
                            Usar sugerido ({formatCents(bundleRetailSumCents)})
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* COLUMNA DERECHA: EXISTENCIAS / RECETA DE COMBO / ETIQUETAS (lg:col-span-6) */}
                  <div className="lg:col-span-6 space-y-4">
                    {/* CAMPOS ESPECÍFICOS DE PRODUCTO FÍSICO SIMPLE */}
                    {!formIsService && !formIsBundle && (
                      <div className="p-3.5 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
                        <div className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wide flex items-center justify-between">
                          <span>📦 Control de Existencias e Inventario</span>
                          <span className="text-[10px] font-normal text-slate-400">Control de stock en bodega</span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                          <div>
                            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                              Unidad
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
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                {editingProduct ? "Exist. Actual *" : "Exist. Inicial *"}
                              </label>
                              {editingProduct && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenAdjustModal(editingProduct, "add")}
                                  className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold hover:underline cursor-pointer"
                                  title="Abrir asistente de entrada rápida de mercancía"
                                >
                                  + Entrada
                                </button>
                              )}
                            </div>
                            <input
                              type="number"
                              step="any"
                              min="0.01"
                              required
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

                          <div>
                            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                              Stock Máximo
                            </label>
                            <input
                              type="number"
                              step="any"
                              min="0"
                              value={formMaxStock}
                              onChange={(e) => setFormMaxStock(Number(e.target.value))}
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
                                Costo Mínimo: <strong>{formatCents(bundleTotalCostCents)}</strong> • Suma P. Unidad: <strong>{formatCents(bundleRetailSumCents)}</strong>
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

                        {/* SELECTOR PARA AÑADIR NUEVO COMPONENTE (SOLO PRODUCTOS CON INVENTARIO Y AÚN NO INCLUIDOS) */}
                        <div className="flex gap-2 items-end pt-1">
                          <div className="flex-1">
                            <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 block mb-1">
                              Seleccionar Producto Insumo (solo con existencias disponibles)
                            </label>
                            <select
                              value={selectedChildProductId}
                              onChange={(e) => setSelectedChildProductId(e.target.value ? Number(e.target.value) : "")}
                              className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-purple-300 dark:border-purple-700 text-xs text-slate-900 dark:text-white font-medium focus:outline-none"
                            >
                              <option value="">-- Seleccionar producto con inventario --</option>
                              {products
                                .filter(
                                  (p) =>
                                    !p.isService &&
                                    !p.isBundle &&
                                    p.stock > 0 &&
                                    (!editingProduct || p.id !== editingProduct.id) &&
                                    !formComponents.some((c) => c.childProductId === p.id)
                                )
                                .map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name} ({p.sku}) • Costo: {formatCents(p.costCents)} • Stock: {p.stock} {p.unit}
                                  </option>
                                ))}
                            </select>
                          </div>

                          <div className="w-20">
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
                              if (formComponents.some((c) => c.childProductId === child.id)) return;

                              if (child.stock <= 0 || selectedChildQty > child.stock) {
                                modalAlert({
                                  title: "Stock de Insumo Insuficiente",
                                  message: `El producto "${child.name}" solo tiene ${child.stock} ${child.unit} en inventario. No puedes requerir ${selectedChildQty} ${child.unit} por combo.`,
                                  variant: "warning",
                                });
                                return;
                              }

                              const nextComponents = [
                                ...formComponents,
                                {
                                  childProductId: child.id,
                                  childName: child.name,
                                  childSku: child.sku,
                                  childStock: child.stock,
                                  childUnit: child.unit,
                                  childPriceCents: child.priceCents,
                                  childCostCents: child.costCents,
                                  quantity: selectedChildQty,
                                },
                              ];
                              setFormComponents(nextComponents);
                              const nextCostCents = nextComponents.reduce(
                                (acc, c) => acc + Math.round((c.childCostCents || 0) * c.quantity),
                                0
                              );
                              setFormCostStr((nextCostCents / 100).toFixed(2));
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
                        <div className="space-y-1.5 max-h-40 overflow-y-auto pt-1">
                          {formComponents.length === 0 ? (
                            <p className="text-[11px] text-purple-700/60 dark:text-purple-400/60 italic text-center py-2">
                              Aún no has agregado insumos a este combo. Agrega al menos 1 producto con inventario.
                            </p>
                          ) : (
                            formComponents.map((comp, idx) => {
                              const compCostCents = Math.round((comp.childCostCents || 0) * comp.quantity);
                              return (
                                <div
                                  key={comp.childProductId}
                                  className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-900 border border-purple-200 dark:border-purple-900/60 text-xs gap-2"
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate">
                                      <span className="font-bold text-slate-900 dark:text-white">{comp.childName}</span>
                                      <span className="text-[10px] text-slate-400 font-mono ml-2">SKU: {comp.childSku}</span>
                                    </div>
                                    <div className="text-[10px] text-slate-500 flex items-center gap-2 flex-wrap">
                                      <span>Stock: {comp.childStock} {comp.childUnit}</span>
                                      <span>•</span>
                                      <span>Costo Ins.: <strong className="text-slate-700 dark:text-slate-300">{formatCents(compCostCents)}</strong></span>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <input
                                      type="number"
                                      step="any"
                                      min="0.01"
                                      max={comp.childStock}
                                      value={comp.quantity}
                                      onChange={(e) => {
                                        const val = Number(e.target.value);
                                        if (Number.isNaN(val) || val <= 0) return;
                                        if (val > comp.childStock) {
                                          modalAlert({
                                            title: "Stock Máximo del Insumo",
                                            message: `"${comp.childName}" solo cuenta con ${comp.childStock} ${comp.childUnit} disponibles en inventario.`,
                                            variant: "warning",
                                          });
                                          return;
                                        }
                                        const updated = formComponents.map((item, i) =>
                                          i === idx ? { ...item, quantity: val } : item
                                        );
                                        setFormComponents(updated);
                                      }}
                                      className="w-16 px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-950 border border-purple-300 dark:border-purple-800 font-mono font-bold text-purple-800 dark:text-purple-200 text-center text-xs"
                                      title="Cantidad por combo"
                                    />
                                    <span className="text-[10px] font-mono text-purple-700 dark:text-purple-300">
                                      {comp.childUnit}
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
                              );
                            })
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
                          onClick={() => setIsTaxonomyModalOpen(true)}
                          className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer flex items-center gap-1"
                        >
                          <span>⚙️ Gestionar Categorías y Etiquetas</span>
                        </button>
                      </div>

                      {/* Chips seleccionables de dbTags */}
                      {dbTags.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pt-1">
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
                  </div>
                </div>
              </div>

              {/* FOOTER FIJO CON BOTONES DE ACCIÓN */}
              <footer className="px-6 py-3.5 bg-slate-50 dark:bg-slate-950/80 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
                <div className="text-[11px] text-slate-400 hidden sm:block">
                  <kbd className="px-1.5 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 font-mono text-[10px]">Esc</kbd> para cancelar
                </div>
                <div className="flex items-center gap-3 ml-auto">
                  <button
                    type="button"
                    onClick={() => setIsFormOpen(false)}
                    className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    Cancelar (Esc)
                  </button>
                  <button
                    type="submit"
                    disabled={formSubmitting}
                    className={`px-6 py-2 rounded-xl text-white text-xs font-black shadow-md transition-all disabled:opacity-50 cursor-pointer ${
                      formIsBundle
                        ? "bg-purple-600 hover:bg-purple-700"
                        : formIsService
                        ? "bg-cyan-600 hover:bg-cyan-700"
                        : "bg-indigo-600 hover:bg-indigo-700"
                    }`}
                  >
                    {formSubmitting
                      ? "Guardando…"
                      : editingProduct
                      ? "Guardar Cambios"
                      : formIsBundle
                      ? "Crear Combo"
                      : formIsService
                      ? "Crear Servicio"
                      : "Crear Producto"}
                  </button>
                </div>
              </footer>
            </form>
          </div>
        </div>
      )}

      {/* ==============================================================
          MODAL INTELIGENTE DE INVENTARIO: ENTRADA (+), CONTEO (=), SALIDA (-)
          ============================================================== */}
      {adjustingProduct && (() => {
        const currentStock = adjustingProduct.stock;
        let finalResultStock = currentStock;
        if (adjustMode === "add") {
          finalResultStock = currentStock + (Number(adjustQuantity) || 0);
        } else if (adjustMode === "set") {
          finalResultStock = Number(adjustQuantity) || 0;
        } else if (adjustMode === "sub") {
          finalResultStock = Math.max(0, currentStock - (Number(adjustQuantity) || 0));
        }
        const diff = finalResultStock - currentStock;

        return (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95">
              <header className="px-6 py-4 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-xl text-amber-500 shadow-inner">
                    📦
                  </div>
                  <div>
                    <h2 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                      <span>Ajuste / Entrada de Inventario</span>
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-mono font-medium truncate max-w-xs">
                      {adjustingProduct.name} • SKU: {adjustingProduct.sku}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setAdjustingProduct(null)}
                  className="w-8 h-8 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-sm font-bold transition-colors cursor-pointer"
                >
                  ✕
                </button>
              </header>

              <form onSubmit={handleSaveAdjust} className="p-6 space-y-4">
                {/* SELECTOR DE MODOS (3 PESTAÑAS RÁPIDAS) */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
                    Tipo de Movimiento:
                  </label>
                  <div className="grid grid-cols-3 gap-2 p-1 bg-slate-100 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => {
                        setAdjustMode("add");
                        setAdjustReason("Entrada de mercancía / Compra directa");
                        if (adjustQuantity <= 0) setAdjustQuantity(1);
                      }}
                      className={`flex flex-col items-center justify-center py-2 px-2 rounded-lg font-bold text-xs transition-all cursor-pointer ${
                        adjustMode === "add"
                          ? "bg-emerald-600 text-white shadow-sm"
                          : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                      }`}
                    >
                      <span className="text-sm">📥 Entrada (+)</span>
                      <span className="text-[10px] font-normal opacity-90">Llegó mercancía</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAdjustMode("set");
                        setAdjustReason("Conteo físico / Cuadre de stock");
                        setAdjustQuantity(currentStock);
                      }}
                      className={`flex flex-col items-center justify-center py-2 px-2 rounded-lg font-bold text-xs transition-all cursor-pointer ${
                        adjustMode === "set"
                          ? "bg-indigo-600 text-white shadow-sm"
                          : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                      }`}
                    >
                      <span className="text-sm">📦 Conteo (=)</span>
                      <span className="text-[10px] font-normal opacity-90">Existencia exacta</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAdjustMode("sub");
                        setAdjustReason("Merma por caducidad o daño");
                        if (adjustQuantity <= 0) setAdjustQuantity(1);
                      }}
                      className={`flex flex-col items-center justify-center py-2 px-2 rounded-lg font-bold text-xs transition-all cursor-pointer ${
                        adjustMode === "sub"
                          ? "bg-rose-600 text-white shadow-sm"
                          : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                      }`}
                    >
                      <span className="text-sm">📤 Salida (-)</span>
                      <span className="text-[10px] font-normal opacity-90">Merma o daño</span>
                    </button>
                  </div>
                </div>

                {/* TARJETA RESUMEN DE STOCK EN BODEGA */}
                <div className="bg-slate-50 dark:bg-slate-950 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <div>
                    <div className="text-xs text-slate-400 uppercase font-bold tracking-wide">Stock Actual en Bodega</div>
                    <div className="text-xl font-black text-slate-800 dark:text-slate-200 font-mono">
                      {currentStock} <span className="text-xs font-semibold text-slate-400">{adjustingProduct.unit}</span>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-xs text-slate-400 uppercase font-bold tracking-wide">Nuevo Stock Resultante</div>
                    <div
                      className={`text-xl font-black font-mono ${
                        adjustMode === "add"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : adjustMode === "sub"
                          ? "text-rose-600 dark:text-rose-400"
                          : diff >= 0
                          ? "text-indigo-600 dark:text-indigo-400"
                          : "text-amber-600 dark:text-amber-400"
                      }`}
                    >
                      {finalResultStock.toFixed(2)} <span className="text-xs font-semibold">{adjustingProduct.unit}</span>
                    </div>
                  </div>
                </div>

                {/* INPUT PRINCIPAL REACTIVO */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {adjustMode === "add"
                      ? "Cantidad a Agregar al Almacén (+) *"
                      : adjustMode === "set"
                      ? "Existencia Exacta Contada en Estante (=) *"
                      : "Cantidad a Retirar / Merma (-) *"}
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      required
                      autoFocus
                      value={adjustQuantity}
                      onChange={(e) => setAdjustQuantity(Number(e.target.value))}
                      placeholder="Ingresa la cantidad..."
                      className={`w-full pl-4 pr-16 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border-2 text-base font-mono font-black text-slate-900 dark:text-white focus:outline-none transition-all ${
                        adjustMode === "add"
                          ? "border-emerald-500/60 focus:ring-2 focus:ring-emerald-500"
                          : adjustMode === "set"
                          ? "border-indigo-500/60 focus:ring-2 focus:ring-indigo-500"
                          : "border-rose-500/60 focus:ring-2 focus:ring-rose-500"
                      }`}
                    />
                    <span className="absolute inset-y-0 right-0 pr-4 flex items-center text-xs font-bold text-slate-400 uppercase">
                      {adjustingProduct.unit}
                    </span>
                  </div>
                  <p
                    className={`text-xs mt-1 font-medium flex items-center gap-1 ${
                      adjustMode === "add"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : adjustMode === "set"
                        ? diff >= 0
                          ? "text-indigo-600 dark:text-indigo-400"
                          : "text-amber-600 dark:text-amber-400"
                        : "text-rose-600 dark:text-rose-400"
                    }`}
                  >
                    {adjustMode === "add" && (
                      <span>⚡ {currentStock} {adjustingProduct.unit} actuales + {adjustQuantity} agregadas = {finalResultStock.toFixed(2)} {adjustingProduct.unit} finales en sistema</span>
                    )}
                    {adjustMode === "set" && (
                      <span>📋 Stock fijado en {finalResultStock.toFixed(2)} {adjustingProduct.unit} (Diferencia: {diff >= 0 ? "+" : ""}{diff.toFixed(2)} {adjustingProduct.unit})</span>
                    )}
                    {adjustMode === "sub" && (
                      adjustQuantity > currentStock ? (
                        <span>⚠️ La merma ({adjustQuantity}) supera el stock actual ({currentStock}). No se permite existencia negativa.</span>
                      ) : (
                        <span>📉 {currentStock} {adjustingProduct.unit} actuales - {adjustQuantity} retiradas = {finalResultStock.toFixed(2)} {adjustingProduct.unit} finales en sistema</span>
                      )
                    )}
                  </p>
                </div>

                {/* MOTIVO & NOTAS INTERNAS */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Motivo o Justificación del Movimiento *
                  </label>
                  <select
                    value={adjustReason}
                    onChange={(e) => setAdjustReason(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                  >
                    <option value="Entrada de mercancía / Compra directa">📥 Entrada de mercancía / Compra directa</option>
                    <option value="Conteo físico / Cuadre de stock">📦 Conteo físico / Cuadre de stock</option>
                    <option value="Merma por caducidad o daño">📤 Merma por caducidad o rotura</option>
                    <option value="Devolución de cliente">↩️ Devolución de cliente</option>
                    <option value="Ajuste manual de inventario">✏️ Ajuste manual de inventario</option>
                  </select>

                  <input
                    type="text"
                    placeholder="Factura proveedor, remisión o nota interna (opcional)..."
                    value={adjustNotes}
                    onChange={(e) => setAdjustNotes(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                {/* FOOTER CON BOTONES DE ACCIÓN */}
                <div className="pt-3 flex items-center justify-between border-t border-slate-200 dark:border-slate-800">
                  <span className="text-[11px] text-slate-400">
                    Atajo: <kbd className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-[10px] font-mono font-bold">Enter</kbd> guardar
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setAdjustingProduct(null)}
                      className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      Cancelar (Esc)
                    </button>
                    <button
                      type="submit"
                      disabled={adjustSubmitting || (adjustMode === "sub" && adjustQuantity > currentStock)}
                      className={`px-5 py-2 rounded-xl text-white text-xs font-black shadow-md transition-all disabled:opacity-50 cursor-pointer ${
                        adjustMode === "add"
                          ? "bg-emerald-600 hover:bg-emerald-700"
                          : adjustMode === "set"
                          ? "bg-indigo-600 hover:bg-indigo-700"
                          : "bg-rose-600 hover:bg-rose-700"
                      }`}
                    >
                      {adjustSubmitting
                        ? "Guardando…"
                        : adjustMode === "add"
                        ? "Confirmar Entrada (+)"
                        : adjustMode === "set"
                        ? "Fijar Conteo Real (=)"
                        : "Registrar Salida (-)"}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

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

      {/* Visor de Imagen Ampliada (Lightbox) */}
      <ImageLightboxModal
        isOpen={lightboxData.isOpen}
        onClose={() => setLightboxData((prev) => ({ ...prev, isOpen: false }))}
        imageSrc={lightboxData.imageSrc}
        title={lightboxData.title}
        subtitle={lightboxData.subtitle}
        productId={lightboxData.productId}
      />

      {/* Modal de Importación y Exportación Excel (Eleventa / Metahabi) */}
      <ProductImportExportModal
        isOpen={isExcelModalOpen}
        initialTab={excelModalTab}
        categories={categoriesList}
        onClose={() => setIsExcelModalOpen(false)}
        onImportSuccess={() => {
          loadProducts();
          showNotification("✓ Catálogo importado desde Excel y sincronización con ERP iniciada.");
        }}
      />

      {/* Modal de Gestión Centralizada de Categorías y Etiquetas con Control de Acceso RBAC */}
      <TaxonomyManagementModal
        isOpen={isTaxonomyModalOpen}
        onClose={() => setIsTaxonomyModalOpen(false)}
        cashier={cashier || null}
        onChanged={() => {
          loadProducts();
          loadTags();
        }}
      />

    </div>
  );
}
