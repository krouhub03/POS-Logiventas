import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { api } from "../services/api";
import { formatCents } from "../lib/money";
import { parseTags } from "../lib/tags";
import { resolveProductImageSrc, getDefaultProductImage } from "../lib/images";
import type { Product, ProductTag, PinnedFilter } from "../types";

interface SearchProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (product: Product) => void;
}

const STORAGE_PINNED_KEY = "pos_pinned_search_filters";
const STORAGE_VIEW_MODE_KEY = "pos_search_view_mode";

const DEFAULT_PINNED_FILTERS: PinnedFilter[] = [];

const ViewCardsIcon = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="7" height="7" x="3" y="3" rx="1.5" />
    <rect width="7" height="7" x="14" y="3" rx="1.5" />
    <rect width="7" height="7" x="14" y="14" rx="1.5" />
    <rect width="7" height="7" x="3" y="14" rx="1.5" />
  </svg>
);

const ViewTableIcon = () => (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" strokeWidth="3" />
    <line x1="3" y1="12" x2="3.01" y2="12" strokeWidth="3" />
    <line x1="3" y1="18" x2="3.01" y2="18" strokeWidth="3" />
  </svg>
);

export function SearchProductModal({
  isOpen,
  onClose,
  onSelect,
}: SearchProductModalProps) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [productsCount, setProductsCount] = useState(0);
  const [servicesCount, setServicesCount] = useState(0);
  const [bundlesCount, setBundlesCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [dbTags, setDbTags] = useState<ProductTag[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Filtros activos
  const [typeFilter, setTypeFilter] = useState<"all" | "products" | "services" | "bundles">("all");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  // Filtros frecuentes anclados
  const [pinnedFilters, setPinnedFilters] = useState<PinnedFilter[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_PINNED_KEY);
      if (saved) return JSON.parse(saved);
    } catch {
      // fallback
    }
    return DEFAULT_PINNED_FILTERS;
  });

  // Mostrar siempre imágenes de productos
  const showProductImages = true;

  // Modo de visualización: Tarjetas POS (cards) vs Tabla de filas (table)
  const [viewMode, setViewMode] = useState<"cards" | "table">(() => {
    try {
      const saved = localStorage.getItem(STORAGE_VIEW_MODE_KEY);
      return saved === "table" ? "table" : "cards";
    } catch {
      return "cards";
    }
  });

  const handleSetViewMode = (mode: "cards" | "table") => {
    setViewMode(mode);
    try {
      localStorage.setItem(STORAGE_VIEW_MODE_KEY, mode);
    } catch {
      // ignore
    }
    inputRef.current?.focus();
  };

  // Desplegables
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false);
  const [isTagDropdownOpen, setIsTagDropdownOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const categoryMenuRef = useRef<HTMLDivElement>(null);
  const tagMenuRef = useRef<HTMLDivElement>(null);
  const latestRequestId = useRef(0);

  // Guardar filtros anclados en localStorage
  const savePinnedFilters = (newPinned: PinnedFilter[]) => {
    setPinnedFilters(newPinned);
    try {
      localStorage.setItem(STORAGE_PINNED_KEY, JSON.stringify(newPinned));
    } catch {
      // ignore
    }
  };

  // Debounce para el texto de búsqueda (150ms para respuesta inmediata)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 150);
    return () => clearTimeout(timer);
  }, [search]);

  // Cargar página de productos desde SQLite vía IPC
  const loadPage = useCallback(
    async (offset: number, isReset: boolean) => {
      if (!isOpen) return;

      const currentReq = ++latestRequestId.current;
      if (isReset) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }

      try {
        const res = await api.products.searchPaged({
          query: debouncedSearch.trim() || undefined,
          typeFilter,
          category: selectedCategory || undefined,
          tag: selectedTag || undefined,
          limit: 30,
          offset,
        });

        // Validar que la respuesta corresponda a la última petición realizada
        if (currentReq === latestRequestId.current) {
          if (isReset) {
            setProducts(res.items);
            setSelectedIndex(0);
            if (tableContainerRef.current) {
              tableContainerRef.current.scrollTop = 0;
            }
          } else {
            setProducts((prev) => [...prev, ...res.items]);
          }
          setTotalCount(res.totalCount);
          setProductsCount(res.productsCount);
          setServicesCount(res.servicesCount);
          setBundlesCount(res.bundlesCount || 0);
          setHasMore(res.hasMore);
        }
      } catch (err) {
        console.error("Error al buscar productos paginados:", err);
      } finally {
        if (currentReq === latestRequestId.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [isOpen, debouncedSearch, typeFilter, selectedCategory, selectedTag]
  );

  // Cargar siguiente lote de ítems
  const loadNextPage = useCallback(() => {
    if (hasMore && !loading && !loadingMore) {
      loadPage(products.length, false);
    }
  }, [hasMore, loading, loadingMore, products.length, loadPage]);

  // Observador de intersección para scroll infinito fluido y automático
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || loading || loadingMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadNextPage();
        }
      },
      {
        root: tableContainerRef.current,
        rootMargin: "250px",
      }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, loadNextPage]);

  // Disparar carga cuando cambian los filtros o la búsqueda
  useEffect(() => {
    if (isOpen) {
      loadPage(0, true);
    }
  }, [isOpen, debouncedSearch, typeFilter, selectedCategory, selectedTag, loadPage]);

  // Cargar tags y categorías al abrir el modal
  useEffect(() => {
    if (isOpen) {
      setSearch("");
      setDebouncedSearch("");
      setSelectedIndex(0);
      setTypeFilter("all");
      setSelectedCategory(null);
      setSelectedTag(null);
      setIsCategoryDropdownOpen(false);
      setIsTagDropdownOpen(false);

      Promise.all([
        api.tags.list().catch(() => []),
        api.categories.list().catch(() => []),
      ])
        .then(([tags, cats]) => {
          setDbTags(tags);
          setCategories(cats);

          // Filtrar estrictamente los filtros frecuentes para que SOLO permanezcan categorías existentes en la BD
          setPinnedFilters((prev) => {
            const valid = prev.filter((f) => {
              if (f.type === "category") {
                return cats.some((c) => c.toLowerCase() === f.value.toLowerCase());
              }
              if (f.type === "tag") {
                return tags.some((t) => t.name.toLowerCase() === f.value.toLowerCase());
              }
              return false;
            });

            try {
              localStorage.setItem(STORAGE_PINNED_KEY, JSON.stringify(valid));
            } catch {
              // ignore
            }
            return valid;
          });
        })
        .catch(console.error)
        .finally(() => {
          setTimeout(() => inputRef.current?.focus(), 50);
        });
    }
  }, [isOpen]);

  // Cerrar menús desplegables al hacer clic fuera
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (categoryMenuRef.current && !categoryMenuRef.current.contains(target)) {
        setIsCategoryDropdownOpen(false);
      }
      if (tagMenuRef.current && !tagMenuRef.current.contains(target)) {
        setIsTagDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Mapa de colores de tags
  const tagColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of dbTags) {
      map.set(t.name.toLowerCase().trim(), t.colorHex);
    }
    return map;
  }, [dbTags]);

  // Lista de categorías únicas disponibles
  const availableCategories = useMemo(() => {
    const set = new Set<string>(categories);
    for (const p of products) {
      if (p.categoryName && p.categoryName.trim()) {
        set.add(p.categoryName.trim());
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [categories, products]);

  // Lista de tags únicos disponibles
  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of dbTags) set.add(t.name);
    for (const p of products) {
      parseTags(p.tags, dbTags).forEach((t) => set.add(t));
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [dbTags, products]);

  // Conteo de productos por tipo
  const counts = useMemo(() => {
    return {
      all: typeFilter === "all" ? totalCount : productsCount + servicesCount + bundlesCount,
      products: productsCount,
      services: servicesCount,
      bundles: bundlesCount,
    };
  }, [typeFilter, totalCount, productsCount, servicesCount, bundlesCount]);

  // Mantener scroll visible en la fila activa
  useEffect(() => {
    const el = document.getElementById(`search-row-${selectedIndex}`);
    if (el) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  // Alternar fijación de un filtro anclado
  const togglePinFilter = (type: "category" | "tag", value: string) => {
    const exists = pinnedFilters.some(
      (f) => f.type === type && f.value.toLowerCase() === value.toLowerCase()
    );
    if (exists) {
      savePinnedFilters(
        pinnedFilters.filter(
          (f) => !(f.type === type && f.value.toLowerCase() === value.toLowerCase())
        )
      );
    } else {
      const icon =
        type === "category"
          ? "📁"
          : value.toLowerCase().includes("oferta")
          ? "⚡"
          : value.toLowerCase().includes("frío")
          ? "❄️"
          : "🏷️";
      const color =
        type === "tag" ? tagColorMap.get(value.toLowerCase()) || "#3b82f6" : "#f59e0b";
      const newPin: PinnedFilter = {
        id: `${type}-${value}-${Date.now()}`,
        type,
        value,
        icon,
        color,
      };
      savePinnedFilters([...pinnedFilters, newPin]);
    }
  };

  // Alternar filtro de frecuente
  const handleTogglePinned = (f: PinnedFilter) => {
    if (f.type === "category") {
      setSelectedCategory((prev) => (prev === f.value ? null : f.value));
    } else {
      setSelectedTag((prev) => (prev === f.value ? null : f.value));
    }
    inputRef.current?.focus();
  };

  // Limpiar todos los filtros
  const handleClearFilters = () => {
    setSearch("");
    setDebouncedSearch("");
    setTypeFilter("all");
    setSelectedCategory(null);
    setSelectedTag(null);
    inputRef.current?.focus();
  };

  const hasActiveFilters = Boolean(
    search || typeFilter !== "all" || selectedCategory || selectedTag
  );

  // Manejo de selección con validación de existencias
  const handleSelectProduct = (p: Product) => {
    onSelect(p);
    if (p.isService || p.stock > 0) {
      onClose();
    }
  };

  // Atajos de teclado globales (Escape y Enter siempre activos)
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (hasActiveFilters) {
          handleClearFilters();
        } else {
          onClose();
        }
      } else if (e.key === "Enter") {
        if (products[selectedIndex]) {
          e.preventDefault();
          handleSelectProduct(products[selectedIndex]);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, hasActiveFilters, products, selectedIndex, onClose]);

  // Manejo de atajos de teclado
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (viewMode === "cards") {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setSelectedIndex((prev) => {
          const next = Math.min(prev + 1, products.length - 1);
          if (next >= products.length - 8) {
            loadNextPage();
          }
          return next;
        });
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => {
          const next = Math.min(prev + 4, products.length - 1);
          if (next >= products.length - 8) {
            loadNextPage();
          }
          return next;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 4, 0));
      }
    } else {
      // Navegación en modo tabla (1 dimensión vertical)
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => {
          const next = Math.min(prev + 1, products.length - 1);
          if (next >= products.length - 6) {
            loadNextPage();
          }
          return next;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      }
    }

    if (e.key === "Enter") {
      e.preventDefault();
      if (products[selectedIndex]) {
        handleSelectProduct(products[selectedIndex]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (hasActiveFilters) {
        handleClearFilters();
      } else {
        onClose();
      }
    } else if (e.key === "Tab") {
      e.preventDefault();
      setTypeFilter((prev) =>
        prev === "all" ? "products" : prev === "products" ? "services" : prev === "services" ? "bundles" : "all"
      );
    } else if (e.altKey && e.key >= "1" && e.key <= "9") {
      const idx = parseInt(e.key, 10) - 1;
      if (pinnedFilters[idx]) {
        e.preventDefault();
        handleTogglePinned(pinnedFilters[idx]);
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  };

  // Manejador de scroll infinito
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < 250) {
      loadNextPage();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 dark:bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 transition-colors"
      onKeyDown={handleKeyDown}
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-5xl max-h-[90vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 transition-colors">
        {/* ====================================================================
            1. HEADER MODAL
            ==================================================================== */}
        <header className="px-6 py-3.5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="bg-sky-100 dark:bg-sky-950/80 text-sky-700 dark:text-sky-300 border border-sky-300 dark:border-sky-800 text-xs px-2.5 py-0.5 rounded-lg font-mono font-black shadow-xs">
              F10
            </span>
            <h2 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
              <span>Búsqueda de Productos</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-medium font-sans">
                {counts.all} ítems registrados
              </span>
            </h2>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Selector de modo de vista: Tarjetas POS vs Tabla de filas */}
            <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl border border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => handleSetViewMode("cards")}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  viewMode === "cards"
                    ? "bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-2xs font-bold"
                    : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                }`}
                title="Modo Tarjetas POS"
              >
                <ViewCardsIcon />
              </button>
              <button
                type="button"
                onClick={() => handleSetViewMode("table")}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  viewMode === "table"
                    ? "bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-2xs font-bold"
                    : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                }`}
                title="Modo Tabla / Filas"
              >
                <ViewTableIcon />
              </button>
            </div>

            <div className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500 font-semibold">
              <span>Atajo:</span>
              <kbd className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md font-mono text-[11px] font-bold text-slate-700 dark:text-slate-300 shadow-xs">
                Esc
              </kbd>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-sm font-bold cursor-pointer"
            >
              ✕
            </button>
          </div>
        </header>

        {/* ====================================================================
            2. INPUT DE BÚSQUEDA
            ==================================================================== */}
        <div className="p-4 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800/80">
          <div className="relative flex items-center">
            <span className="absolute left-4 text-sky-500 text-lg pointer-events-none">
              🔍
            </span>
            <input
              ref={inputRef}
              type="text"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className="w-full bg-white dark:bg-slate-950 border-2 border-sky-400 dark:border-sky-500/80 rounded-2xl pl-11 pr-24 py-2.5 text-slate-900 dark:text-white font-medium text-sm focus:outline-none focus:ring-4 focus:ring-sky-500/20 shadow-xs placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-all"
              placeholder="Escribe nombre, SKU, código de barras o #etiqueta... (Usa ↑ ↓ para navegar)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="absolute right-3.5 flex items-center gap-2">
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs font-bold p-1 cursor-pointer"
                  title="Limpiar texto"
                >
                  ✕
                </button>
              )}
              <kbd className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700 rounded-md text-[10px] font-mono font-bold tracking-wider">
                Ctrl+K
              </kbd>
            </div>
          </div>
        </div>

        {/* ====================================================================
            3. BARRA DE FILTROS SUPERIOR (TIPO + CATEGORÍAS + ETIQUETAS)
            ==================================================================== */}
        <div className="px-4 py-2.5 bg-slate-50/80 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Selector de Tipo (Segmentado) */}
          <div className="flex items-center gap-1 bg-slate-200/70 dark:bg-slate-800/70 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => {
                setTypeFilter("all");
                inputRef.current?.focus();
              }}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                typeFilter === "all"
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              Todos ({counts.all})
            </button>
            <button
              type="button"
              onClick={() => {
                setTypeFilter("products");
                inputRef.current?.focus();
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                typeFilter === "products"
                  ? "bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              <span>📦</span>
              <span>Productos ({counts.products})</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setTypeFilter("services");
                inputRef.current?.focus();
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                typeFilter === "services"
                  ? "bg-white dark:bg-slate-900 text-purple-600 dark:text-purple-400 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              <span>🛠️</span>
              <span>Servicios ({counts.services})</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setTypeFilter("bundles");
                inputRef.current?.focus();
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                typeFilter === "bundles"
                  ? "bg-white dark:bg-slate-900 text-amber-600 dark:text-amber-400 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              <span>🎁</span>
              <span>Combos ({counts.bundles})</span>
            </button>
          </div>

          {/* Botones de Categoría, Etiqueta y Limpiar */}
          <div className="flex items-center gap-2">
            {/* Desplegable de Categoría */}
            <div className="relative" ref={categoryMenuRef}>
              <button
                type="button"
                onClick={() => {
                  setIsCategoryDropdownOpen((prev) => !prev);
                  setIsTagDropdownOpen(false);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all shadow-xs cursor-pointer ${
                  selectedCategory
                    ? "bg-amber-50 dark:bg-amber-950/70 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300"
                    : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                }`}
              >
                <span>{selectedCategory ? `📁 ${selectedCategory}` : "+ Categoría"}</span>
                <span className="text-[9px] text-slate-400">▼</span>
              </button>

              {isCategoryDropdownOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-60 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl z-40 p-2 animate-in fade-in zoom-in-95">
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider px-2 py-1 border-b border-slate-100 dark:border-slate-800 mb-1">
                    Filtrar por Categoría
                  </div>
                  <div className="max-h-52 overflow-y-auto space-y-0.5">
                    {availableCategories.length === 0 ? (
                      <div className="text-slate-400 text-xs italic p-3 text-center">
                        Sin categorías registradas
                      </div>
                    ) : (
                      availableCategories.map((cat) => {
                        const isPinned = pinnedFilters.some(
                          (f) => f.type === "category" && f.value.toLowerCase() === cat.toLowerCase()
                        );
                        const isSelected = selectedCategory?.toLowerCase() === cat.toLowerCase();
                        return (
                          <div
                            key={cat}
                            className={`flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-colors ${
                              isSelected
                                ? "bg-amber-50 dark:bg-amber-950/70 text-amber-900 dark:text-amber-200 font-bold"
                                : "hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300"
                            }`}
                          >
                            <span
                              className="flex-1 truncate"
                              onClick={() => {
                                setSelectedCategory(isSelected ? null : cat);
                                setIsCategoryDropdownOpen(false);
                                inputRef.current?.focus();
                              }}
                            >
                              📁 {cat}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                togglePinFilter("category", cat);
                              }}
                              className={`p-1 rounded-md text-xs cursor-pointer ${
                                isPinned ? "text-amber-500" : "text-slate-300 hover:text-amber-500"
                              }`}
                              title={isPinned ? "Desanclar de frecuentes" : "Anclar a frecuentes"}
                            >
                              📌
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Desplegable de Etiqueta */}
            <div className="relative" ref={tagMenuRef}>
              <button
                type="button"
                onClick={() => {
                  setIsTagDropdownOpen((prev) => !prev);
                  setIsCategoryDropdownOpen(false);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all shadow-xs cursor-pointer ${
                  selectedTag
                    ? "bg-cyan-50 dark:bg-cyan-950/70 border-cyan-300 dark:border-cyan-700 text-cyan-800 dark:text-cyan-300"
                    : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                }`}
              >
                <span>{selectedTag ? `🏷️ #${selectedTag}` : "+ Etiqueta"}</span>
                <span className="text-[9px] text-slate-400">▼</span>
              </button>

              {isTagDropdownOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-60 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl z-40 p-2 animate-in fade-in zoom-in-95">
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider px-2 py-1 border-b border-slate-100 dark:border-slate-800 mb-1">
                    Filtrar por Etiqueta
                  </div>
                  <div className="max-h-52 overflow-y-auto space-y-0.5">
                    {availableTags.length === 0 ? (
                      <div className="text-slate-400 text-xs italic p-3 text-center">
                        Sin etiquetas registradas
                      </div>
                    ) : (
                      availableTags.map((tag) => {
                        const isPinned = pinnedFilters.some(
                          (f) => f.type === "tag" && f.value.toLowerCase() === tag.toLowerCase()
                        );
                        const isSelected = selectedTag?.toLowerCase() === tag.toLowerCase();
                        const tagColor = tagColorMap.get(tag.toLowerCase()) || "#3b82f6";
                        return (
                          <div
                            key={tag}
                            className={`flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-colors ${
                              isSelected
                                ? "bg-cyan-50 dark:bg-cyan-950/70 text-cyan-900 dark:text-cyan-200 font-bold"
                                : "hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300"
                            }`}
                          >
                            <div
                              className="flex items-center gap-2 flex-1 truncate"
                              onClick={() => {
                                setSelectedTag(isSelected ? null : tag);
                                setIsTagDropdownOpen(false);
                                inputRef.current?.focus();
                              }}
                            >
                              <span
                                className="w-2.5 h-2.5 rounded-full shrink-0 shadow-xs"
                                style={{ backgroundColor: tagColor }}
                              />
                              <span className="truncate font-mono">#{tag}</span>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                togglePinFilter("tag", tag);
                              }}
                              className={`p-1 rounded-md text-xs cursor-pointer ${
                                isPinned ? "text-cyan-500" : "text-slate-300 hover:text-cyan-500"
                              }`}
                              title={isPinned ? "Desanclar de frecuentes" : "Anclar a frecuentes"}
                            >
                              📌
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Limpiar filtros */}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleClearFilters}
                className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 font-semibold text-xs transition-colors px-1 cursor-pointer"
              >
                Limpiar filtros
              </button>
            )}
          </div>
        </div>

        {/* ====================================================================
            4. FILTROS FRECUENTES ANCLADOS (PINNED FILTERS)
            ==================================================================== */}
        <div className="px-6 py-2.5 bg-slate-50/50 dark:bg-slate-950/40 border-b border-slate-200/80 dark:border-slate-800/60 flex items-center gap-2.5 overflow-x-auto text-xs">
          <div className="flex items-center gap-1.5 font-bold text-slate-600 dark:text-slate-400 shrink-0">
            <span>📌</span>
            <span>Frecuentes:</span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {pinnedFilters.length === 0 ? (
              <span className="text-slate-400 dark:text-slate-500 text-xs italic">
                Sin categorías frecuentes fijadas. Puedes fijarlas desde el menú &quot;+ Categoría&quot; con el icono 📌.
              </span>
            ) : (
              pinnedFilters.map((f, idx) => {
                const isActive =
                  (f.type === "category" && selectedCategory?.toLowerCase() === f.value.toLowerCase()) ||
                  (f.type === "tag" && selectedTag?.toLowerCase() === f.value.toLowerCase());
                const shortcut = idx < 3 ? `Alt+${idx + 1}` : null;

                return (
                  <div key={f.id} className="relative inline-flex items-center">
                    <button
                      type="button"
                      onClick={() => handleTogglePinned(f)}
                      style={{
                        backgroundColor: isActive ? `${f.color}25` : undefined,
                        borderColor: isActive ? f.color : undefined,
                      }}
                      className={`flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-full border text-xs font-semibold transition-all cursor-pointer shadow-2xs ${
                        isActive
                          ? "ring-2 font-bold shadow-xs scale-102"
                          : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700/80 text-slate-700 dark:text-slate-300 hover:border-slate-300 hover:scale-102"
                      }`}
                    >
                      <span>{f.icon || (f.type === "category" ? "📁" : "🏷️")}</span>
                      <span style={{ color: isActive ? f.color : undefined }}>
                        {f.type === "tag" && !f.value.startsWith("#") ? `#${f.value}` : f.value}
                      </span>
                      {shortcut && (
                        <span
                          style={{ color: f.color }}
                          className="font-mono text-[10px] font-bold opacity-80"
                        >
                          {shortcut}
                        </span>
                      )}
                      {/* Botón directo para desanclar */}
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePinFilter(f.type, f.value);
                        }}
                        title={`Desanclar "${f.value}" de frecuentes`}
                        className="ml-1 w-4 h-4 rounded-full flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors text-[10px] cursor-pointer"
                      >
                        ✕
                      </span>
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ====================================================================
            5. RESULTADOS DE PRODUCTOS (MODO CARDS O MODO TABLA)
            ==================================================================== */}
        <div
          ref={tableContainerRef}
          onScroll={handleScroll}
          className={`flex-1 overflow-y-auto ${
            viewMode === "cards"
              ? "p-4 bg-slate-50/60 dark:bg-slate-900/60"
              : "bg-white dark:bg-slate-900/60"
          }`}
        >
          {products.length === 0 ? (
            <div className="py-20 text-center text-slate-400 dark:text-slate-500 font-sans">
              <div className="text-4xl mb-3">🔍</div>
              <p className="font-bold text-base text-slate-700 dark:text-slate-300">
                {loading ? "Buscando productos…" : "No se encontraron productos coincidentes"}
              </p>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                Prueba ajustando el término de búsqueda o cambiando los filtros seleccionados.
              </p>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={handleClearFilters}
                  className="mt-4 px-4 py-2 rounded-xl bg-sky-50 dark:bg-sky-950 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-800 text-xs font-bold hover:bg-sky-100 transition-colors cursor-pointer shadow-xs"
                >
                  Limpiar filtros aplicados
                </button>
              )}
            </div>
          ) : viewMode === "cards" ? (
            <>
              {/* =============================================================
                  VISTA EN MODO CARDS (POS TOUCH & VISUAL)
                  ============================================================= */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5">
                {products.map((p, idx) => {
                  const isSelected = idx === selectedIndex;
                  const itemTags = parseTags(p.tags, dbTags);
                  const isLowStock = p.controlsStock && p.stock <= p.minStock;
                  const kind = p.isBundle ? "bundle" : p.isService ? "service" : "product";
                  const imgSrc = resolveProductImageSrc(p.imageLocalPath, p.imageUrl, kind);

                  return (
                    <div
                      key={`${p.id}-${idx}`}
                      id={`search-row-${idx}`}
                      onClick={() => handleSelectProduct(p)}
                      className={`group relative p-3 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between select-none ${
                        isSelected
                          ? "bg-sky-50/70 dark:bg-sky-950/40 border-sky-500 dark:border-sky-400 ring-2 ring-sky-500/30 shadow-md scale-[1.01]"
                          : "bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-sm"
                      }`}
                    >
                      {/* FOTO / MINIATURA DEL PRODUCTO */}
                      {showProductImages ? (
                        <div className="relative w-full h-32 bg-slate-100 dark:bg-slate-800/80 rounded-xl overflow-hidden mb-2.5 flex items-center justify-center border border-slate-200/60 dark:border-slate-800 shrink-0">
                          <img
                            src={imgSrc}
                            alt={p.name}
                            className="w-full h-full object-contain p-2 group-hover:scale-105 transition-transform duration-200"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).src = getDefaultProductImage(kind);
                            }}
                          />

                          {/* Badge de tipo de producto */}
                          {p.isBundle ? (
                            <span className="absolute top-2 left-2 bg-amber-500/95 text-white text-[10px] font-black px-2 py-0.5 rounded-lg shadow-sm flex items-center gap-1 backdrop-blur-xs">
                              🎁 COMBO
                            </span>
                          ) : p.isService ? (
                            <span className="absolute top-2 left-2 bg-purple-600/95 text-white text-[10px] font-black px-2 py-0.5 rounded-lg shadow-sm flex items-center gap-1 backdrop-blur-xs">
                              🛠️ SERVICIO
                            </span>
                          ) : null}

                          {/* Indicador de selección activa */}
                          {isSelected && (
                            <span className="absolute top-2 right-2 bg-sky-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-lg shadow-md animate-in fade-in">
                              [Enter] Agregar
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center justify-between mb-2">
                          <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-sm shadow-2xs">
                            {p.isBundle ? "🎁" : p.isService ? "🛠️" : "📦"}
                          </div>
                          {isSelected && (
                            <span className="bg-sky-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-lg shadow-xs">
                              [Enter] Agregar
                            </span>
                          )}
                        </div>
                      )}

                      {/* DATOS DEL PRODUCTO */}
                      <div className="flex-1 flex flex-col justify-start">
                        {/* Nombre del producto */}
                        <h3
                          className="font-bold text-slate-900 dark:text-white text-xs leading-snug line-clamp-2 min-h-[2.2rem]"
                          title={p.name}
                        >
                          {p.name}
                        </h3>

                        {/* SKU / Código de barras & Categoría */}
                        <div className="flex items-center gap-1.5 mt-1 text-[11px] font-mono">
                          <span className="font-bold text-slate-500 dark:text-slate-400 truncate">
                            {p.barcode || p.sku}
                          </span>
                          {p.categoryName && (
                            <span className="text-[10px] font-sans font-medium px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 truncate max-w-[100px]">
                              {p.categoryName}
                            </span>
                          )}
                        </div>

                        {/* Etiquetas */}
                        {itemTags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {itemTags.slice(0, 2).map((tag) => {
                              const tagColor = tagColorMap.get(tag.toLowerCase().trim()) || "#3b82f6";
                              return (
                                <span
                                  key={tag}
                                  style={{
                                    backgroundColor: `${tagColor}18`,
                                    borderColor: `${tagColor}40`,
                                    color: tagColor,
                                  }}
                                  className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded border"
                                >
                                  #{tag}
                                </span>
                              );
                            })}
                            {itemTags.length > 2 && (
                              <span className="text-[9px] text-slate-400 font-mono">
                                +{itemTags.length - 2}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* PRECIO Y EXISTENCIA */}
                      <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-2">
                        <div className="font-black text-sm text-emerald-600 dark:text-emerald-400 font-mono truncate">
                          {formatCents(p.priceCents)}
                        </div>
                        <div className="shrink-0 text-right">
                          {p.isService || !p.controlsStock ? (
                            <span className="text-slate-400 dark:text-slate-500 text-[10px] font-medium italic">
                              Servicio
                            </span>
                          ) : p.stock <= 0 ? (
                            <span className="inline-block text-[10px] font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/80 px-2 py-0.5 rounded-md border border-rose-200 dark:border-rose-900/50 uppercase tracking-wider">
                              Agotado
                            </span>
                          ) : (
                            <span
                              className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded-md ${
                                isLowStock
                                  ? "bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800"
                                  : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                              }`}
                            >
                              {p.stock} {p.unit}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Sentinel invisible para scroll infinito */}
              {hasMore && <div ref={sentinelRef} className="h-4 w-full" />}

              {/* Indicador de carga de más productos */}
              {loadingMore && (
                <div className="py-4 text-center text-xs text-sky-600 dark:text-sky-400 font-semibold flex items-center justify-center gap-2">
                  <span className="inline-block animate-spin">🔄</span>
                  Cargando más productos al desplazar...
                </div>
              )}

              {/* Fin de catálogo */}
              {!hasMore && products.length >= 30 && (
                <div className="py-3 text-center text-[11px] text-slate-400 dark:text-slate-500 font-medium">
                  Has llegado al final de los {totalCount} resultados
                </div>
              )}
            </>
          ) : (
            <>
              {/* =============================================================
                  VISTA EN MODO TABLA / FILAS (COMPACTA CLÁSICA)
                  ============================================================= */}
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] uppercase tracking-wider text-slate-400 dark:text-slate-500 font-bold bg-white dark:bg-slate-900 sticky top-0 z-10">
                    <th className="py-2.5 px-4 w-16 text-center">Tipo</th>
                    <th className="py-2.5 px-4 w-36">SKU / Código</th>
                    <th className="py-2.5 px-4">Descripción</th>
                    <th className="py-2.5 px-4 w-44">Etiquetas</th>
                    <th className="py-2.5 px-4 w-36">Categoría</th>
                    <th className="py-2.5 px-4 text-right w-32">Precio Venta</th>
                    <th className="py-2.5 px-4 text-right w-28">Existencia</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {products.map((p, idx) => {
                    const isSelected = idx === selectedIndex;
                    const itemTags = parseTags(p.tags, dbTags);
                    const isLowStock = p.controlsStock && p.stock <= p.minStock;
                    const kind = p.isBundle ? "bundle" : p.isService ? "service" : "product";
                    const imgSrc = resolveProductImageSrc(p.imageLocalPath, p.imageUrl, kind);

                    return (
                      <tr
                        key={`${p.id}-${idx}`}
                        id={`search-row-${idx}`}
                        onClick={() => handleSelectProduct(p)}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? "bg-sky-50/90 dark:bg-sky-950/40 text-slate-900 dark:text-white border-l-4 border-l-sky-500 font-semibold"
                            : "hover:bg-slate-50/80 dark:hover:bg-slate-800/40 text-slate-700 dark:text-slate-300"
                        }`}
                      >
                        {/* TIPO / FOTO */}
                        <td className="py-2.5 px-4 text-center">
                          {showProductImages ? (
                            <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 overflow-hidden mx-auto flex items-center justify-center shadow-2xs">
                              <img
                                src={imgSrc}
                                alt={p.name}
                                className="w-full h-full object-contain p-1"
                                onError={(e) => {
                                  (e.currentTarget as HTMLImageElement).src = getDefaultProductImage(kind);
                                }}
                              />
                            </div>
                          ) : p.isBundle ? (
                            <div
                              className="w-8 h-8 rounded-xl bg-amber-50 dark:bg-amber-950/70 border border-amber-300 dark:border-amber-700/60 flex items-center justify-center text-xs mx-auto shadow-2xs"
                              title="Combo / Paquete"
                            >
                              🎁
                            </div>
                          ) : p.isService ? (
                            <div
                              className="w-8 h-8 rounded-xl bg-purple-50 dark:bg-purple-950/70 border border-purple-200 dark:border-purple-800/50 flex items-center justify-center text-xs mx-auto shadow-2xs"
                              title="Servicio"
                            >
                              🛠️
                            </div>
                          ) : (
                            <div
                              className="w-8 h-8 rounded-xl bg-sky-50 dark:bg-sky-950/70 border border-sky-200 dark:border-sky-800/50 flex items-center justify-center text-xs mx-auto shadow-2xs"
                              title="Producto físico"
                            >
                              📦
                            </div>
                          )}
                        </td>

                        {/* SKU / CÓDIGO */}
                        <td className="py-2.5 px-4 font-mono font-bold">
                          <span
                            className={
                              p.isService
                                ? "text-slate-600 dark:text-slate-400"
                                : "text-sky-600 dark:text-sky-400"
                            }
                          >
                            {p.barcode || p.sku}
                          </span>
                        </td>

                        {/* DESCRIPCIÓN */}
                        <td className="py-2.5 px-4">
                          <div className="font-bold text-slate-900 dark:text-white text-xs">
                            {p.name}
                          </div>
                          <div className="text-[10px] text-slate-400 dark:text-slate-500 font-normal">
                            {p.unit ? `Unidad: ${p.unit}` : ""} {p.isBundle ? "• Combo" : ""}
                          </div>
                        </td>

                        {/* ETIQUETAS */}
                        <td className="py-2.5 px-4">
                          {itemTags.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {itemTags.map((tag) => {
                                const tagColor = tagColorMap.get(tag.toLowerCase().trim()) || "#3b82f6";
                                return (
                                  <span
                                    key={tag}
                                    style={{
                                      backgroundColor: `${tagColor}18`,
                                      borderColor: `${tagColor}40`,
                                      color: tagColor,
                                    }}
                                    className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border"
                                  >
                                    #{tag}
                                  </span>
                                );
                              })}
                            </div>
                          ) : (
                            <span className="text-slate-300 dark:text-slate-600 font-mono">—</span>
                          )}
                        </td>

                        {/* CATEGORÍA */}
                        <td className="py-2.5 px-4 text-slate-600 dark:text-slate-400 font-medium text-xs">
                          {p.categoryName || "General"}
                        </td>

                        {/* PRECIO VENTA */}
                        <td className="py-2.5 px-4 text-right font-black text-sm text-emerald-600 dark:text-emerald-400 font-mono">
                          {formatCents(p.priceCents)}
                        </td>

                        {/* EXISTENCIA */}
                        <td className="py-2.5 px-4 text-right font-mono font-bold text-xs">
                          {p.isService || !p.controlsStock ? (
                            <span className="text-slate-400 dark:text-slate-500 font-sans italic text-[11px]">
                              Servicio
                            </span>
                          ) : p.stock <= 0 ? (
                            <span className="inline-flex items-center gap-1.5 text-[10px] font-sans font-bold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/80 px-2 py-0.5 rounded-md border border-rose-200 dark:border-rose-900/50 uppercase tracking-wide">
                              <span>0 {p.unit}</span>
                              <span className="font-extrabold text-[9px] bg-rose-200 dark:bg-rose-900/90 text-rose-900 dark:text-rose-100 px-1 rounded">
                                Agotado
                              </span>
                            </span>
                          ) : (
                            <span
                              className={
                                isLowStock
                                  ? "text-amber-600 dark:text-amber-400 font-black"
                                  : "text-emerald-700 dark:text-emerald-400"
                              }
                            >
                              {p.stock} {p.unit}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Sentinel invisible para scroll infinito */}
              {hasMore && <div ref={sentinelRef} className="h-4 w-full" />}

              {/* Indicador de carga de más productos al hacer scroll */}
              {loadingMore && (
                <div className="py-3.5 text-center text-xs text-sky-600 dark:text-sky-400 bg-sky-50/50 dark:bg-sky-950/30 font-semibold flex items-center justify-center gap-2">
                  <span className="inline-block animate-spin">🔄</span>
                  Cargando más productos al desplazar...
                </div>
              )}

              {/* Mensaje de fin de resultados */}
              {!hasMore && products.length >= 30 && (
                <div className="py-2.5 text-center text-[11px] text-slate-400 dark:text-slate-500 bg-slate-50/50 dark:bg-slate-900/40 font-medium">
                  Has llegado al final de los {totalCount} resultados
                </div>
              )}
            </>
          )}
        </div>

        {/* ====================================================================
            6. FOOTER DE ATAJOS Y CIERRE
            ==================================================================== */}
        <footer className="bg-slate-50 dark:bg-slate-950 px-6 py-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-[11px] font-mono font-bold text-slate-700 dark:text-slate-300 shadow-2xs">
                {viewMode === "cards" ? "↑ ↓ ← →" : "↑ ↓"}
              </kbd>
              <span>Navegar</span>
            </span>

            <span className="flex items-center gap-1.5">
              <kbd className="px-2 py-0.5 bg-emerald-50 dark:bg-emerald-950 border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 rounded text-[11px] font-mono font-bold shadow-2xs">
                Enter
              </kbd>
              <span className="text-emerald-700 dark:text-emerald-300 font-semibold">
                Agregar
              </span>
            </span>

            <span className="flex items-center gap-1.5">
              <kbd className="px-2 py-0.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-[11px] font-mono font-bold text-slate-700 dark:text-slate-300 shadow-2xs">
                Tab
              </kbd>
              <span>Cambiar Tipo</span>
            </span>

            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-[11px] font-mono font-bold text-slate-700 dark:text-slate-300 shadow-2xs">
                Alt+1..9
              </kbd>
              <span>Filtro Rápido</span>
            </span>

            <span className="flex items-center gap-1.5">
              <kbd className="px-2 py-0.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-[11px] font-mono font-bold text-slate-700 dark:text-slate-300 shadow-2xs">
                Esc
              </kbd>
              <span>Salir</span>
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold transition-colors cursor-pointer text-xs"
          >
            Cerrar
          </button>
        </footer>
      </div>
    </div>
  );
}
