import { useState, useEffect, useRef, useMemo } from "react";
import { api } from "../services/api";
import { formatCents } from "../lib/money";
import { parseTags } from "../lib/tags";
import type { Product, ProductTag, PinnedFilter } from "../types";

interface SearchProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (product: Product) => void;
}

const STORAGE_PINNED_KEY = "pos_pinned_search_filters";

const DEFAULT_PINNED_FILTERS: PinnedFilter[] = [
  { id: "cat-bebidas", type: "category", value: "Bebidas", icon: "📁", color: "#f59e0b" },
  { id: "tag-mas-vendido", type: "tag", value: "Más Vendido", icon: "🏷️", color: "#06b6d4" },
  { id: "tag-oferta", type: "tag", value: "Oferta", icon: "⚡", color: "#f97316" },
  { id: "tag-frio", type: "tag", value: "Frío", icon: "❄️", color: "#3b82f6" },
];

export function SearchProductModal({
  isOpen,
  onClose,
  onSelect,
}: SearchProductModalProps) {
  const [search, setSearch] = useState("");
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [dbTags, setDbTags] = useState<ProductTag[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);

  // Filtros activos
  const [typeFilter, setTypeFilter] = useState<"all" | "products" | "services">("all");
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

  // Desplegables
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false);
  const [isTagDropdownOpen, setIsTagDropdownOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const categoryMenuRef = useRef<HTMLDivElement>(null);
  const tagMenuRef = useRef<HTMLDivElement>(null);

  // Guardar filtros anclados en localStorage
  const savePinnedFilters = (newPinned: PinnedFilter[]) => {
    setPinnedFilters(newPinned);
    try {
      localStorage.setItem(STORAGE_PINNED_KEY, JSON.stringify(newPinned));
    } catch {
      // ignore
    }
  };

  // Cargar productos, tags y categorías al abrir
  useEffect(() => {
    if (isOpen) {
      setSearch("");
      setSelectedIndex(0);
      setTypeFilter("all");
      setSelectedCategory(null);
      setSelectedTag(null);
      setIsCategoryDropdownOpen(false);
      setIsTagDropdownOpen(false);
      setLoading(true);

      Promise.all([
        api.products.list(""),
        api.tags.list().catch(() => []),
        api.categories.list().catch(() => []),
      ])
        .then(([prods, tags, cats]) => {
          setAllProducts(prods);
          setDbTags(tags);
          setCategories(cats);
        })
        .catch(console.error)
        .finally(() => {
          setLoading(false);
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

  // Lista de categorías únicas presentes en productos + BD
  const availableCategories = useMemo(() => {
    const set = new Set<string>(categories);
    for (const p of allProducts) {
      if (p.categoryName && p.categoryName.trim()) {
        set.add(p.categoryName.trim());
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [categories, allProducts]);

  // Lista de tags únicos presentes
  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of dbTags) set.add(t.name);
    for (const p of allProducts) {
      parseTags(p.tags, dbTags).forEach((t) => set.add(t));
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [dbTags, allProducts]);

  // Conteo de productos por tipo
  const counts = useMemo(() => {
    const productsCount = allProducts.filter((p) => !p.isService).length;
    const servicesCount = allProducts.filter((p) => p.isService).length;
    return {
      all: allProducts.length,
      products: productsCount,
      services: servicesCount,
    };
  }, [allProducts]);

  // Filtrado reactivo en memoria
  const filteredProducts = useMemo(() => {
    let list = allProducts;

    // 1. Filtro de tipo
    if (typeFilter === "products") {
      list = list.filter((p) => !p.isService);
    } else if (typeFilter === "services") {
      list = list.filter((p) => p.isService);
    }

    // 2. Filtro de categoría
    if (selectedCategory) {
      list = list.filter(
        (p) => (p.categoryName || "General").toLowerCase() === selectedCategory.toLowerCase()
      );
    }

    // 3. Filtro de etiqueta
    if (selectedTag) {
      list = list.filter((p) => {
        const pTags = parseTags(p.tags, dbTags).map((t) => t.toLowerCase());
        return pTags.includes(selectedTag.toLowerCase());
      });
    }

    // 4. Búsqueda por texto (nombre, SKU, código de barras, categoría, tags)
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((p) => {
        const nameMatch = p.name.toLowerCase().includes(q);
        const skuMatch = p.sku.toLowerCase().includes(q);
        const barcodeMatch = p.barcode ? p.barcode.toLowerCase().includes(q) : false;
        const catMatch = p.categoryName ? p.categoryName.toLowerCase().includes(q) : false;
        const tagMatch = p.tags ? p.tags.toLowerCase().includes(q) : false;
        return nameMatch || skuMatch || barcodeMatch || catMatch || tagMatch;
      });
    }

    return list;
  }, [allProducts, typeFilter, selectedCategory, selectedTag, search, dbTags]);

  // Resetear selección al cambiar resultados
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredProducts.length, typeFilter, selectedCategory, selectedTag]);

  // Mantener scroll visible en la fila activa
  useEffect(() => {
    const el = document.getElementById(`search-row-${selectedIndex}`);
    if (el) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  // Alternar fijación de un filtro anclado
  const togglePinFilter = (type: "category" | "tag", value: string) => {
    const exists = pinnedFilters.some((f) => f.type === type && f.value.toLowerCase() === value.toLowerCase());
    if (exists) {
      savePinnedFilters(pinnedFilters.filter((f) => !(f.type === type && f.value.toLowerCase() === value.toLowerCase())));
    } else {
      const icon = type === "category" ? "📁" : value.toLowerCase().includes("oferta") ? "⚡" : value.toLowerCase().includes("frío") ? "❄️" : "🏷️";
      const color = type === "tag" ? (tagColorMap.get(value.toLowerCase()) || "#3b82f6") : "#f59e0b";
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
        if (filteredProducts[selectedIndex]) {
          e.preventDefault();
          handleSelectProduct(filteredProducts[selectedIndex]);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, hasActiveFilters, filteredProducts, selectedIndex, onClose]);

  // Manejo de atajos de teclado
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, filteredProducts.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredProducts[selectedIndex]) {
        handleSelectProduct(filteredProducts[selectedIndex]);
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
        prev === "all" ? "products" : prev === "products" ? "services" : "all"
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

          <div className="flex items-center gap-3">
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
            {pinnedFilters.map((f, idx) => {
              const isActive =
                (f.type === "category" && selectedCategory?.toLowerCase() === f.value.toLowerCase()) ||
                (f.type === "tag" && selectedTag?.toLowerCase() === f.value.toLowerCase());
              const shortcut = idx < 3 ? `Alt+${idx + 1}` : null;

              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => handleTogglePinned(f)}
                  style={{
                    backgroundColor: isActive ? `${f.color}25` : undefined,
                    borderColor: isActive ? f.color : undefined,
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold transition-all cursor-pointer shadow-2xs ${
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
                </button>
              );
            })}
          </div>
        </div>

        {/* ====================================================================
            5. TABLA DE RESULTADOS DE PRODUCTOS
            ==================================================================== */}
        <div
          ref={tableContainerRef}
          className="flex-1 overflow-auto bg-white dark:bg-slate-900/60"
        >
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
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-slate-400 dark:text-slate-500 font-sans">
                    <div className="text-3xl mb-2">🔍</div>
                    <p className="font-semibold text-sm">
                      {loading ? "Cargando productos…" : "No se encontraron productos coincidentes"}
                    </p>
                    {hasActiveFilters && (
                      <button
                        type="button"
                        onClick={handleClearFilters}
                        className="mt-3 px-3 py-1 rounded-lg bg-sky-50 dark:bg-sky-950 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-800 text-xs font-bold hover:bg-sky-100 transition-colors cursor-pointer"
                      >
                        Limpiar filtros aplicados
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                filteredProducts.map((p, idx) => {
                  const isSelected = idx === selectedIndex;
                  const itemTags = parseTags(p.tags, dbTags);
                  const isLowStock = p.controlsStock && p.stock <= p.minStock;

                  return (
                    <tr
                      key={p.id}
                      id={`search-row-${idx}`}
                      onClick={() => handleSelectProduct(p)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-sky-50/90 dark:bg-sky-950/40 text-slate-900 dark:text-white border-l-4 border-l-sky-500 font-semibold"
                          : "hover:bg-slate-50/80 dark:hover:bg-slate-800/40 text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      {/* TIPO */}
                      <td className="py-3 px-4 text-center">
                        {p.isService ? (
                          <div className="w-8 h-8 rounded-xl bg-purple-50 dark:bg-purple-950/70 border border-purple-200 dark:border-purple-800/50 flex items-center justify-center text-xs mx-auto shadow-2xs">
                            🛠️
                          </div>
                        ) : (
                          <div className="w-8 h-8 rounded-xl bg-amber-50 dark:bg-amber-950/70 border border-amber-200 dark:border-amber-800/50 flex items-center justify-center text-xs mx-auto shadow-2xs">
                            📦
                          </div>
                        )}
                      </td>

                      {/* SKU / CÓDIGO */}
                      <td className="py-3 px-4 font-mono font-bold">
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
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900 dark:text-white text-xs">
                          {p.name}
                        </div>
                        <div className="text-[10px] text-slate-400 dark:text-slate-500 font-normal">
                          {p.unit ? `Unidad: ${p.unit}` : ""} {p.isBundle ? "• Combo" : ""}
                        </div>
                      </td>

                      {/* ETIQUETAS */}
                      <td className="py-3 px-4">
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
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-400 font-medium text-xs">
                        {p.categoryName || "General"}
                      </td>

                      {/* PRECIO VENTA */}
                      <td className="py-3 px-4 text-right font-black text-sm text-emerald-600 dark:text-emerald-400 font-mono">
                        {formatCents(p.priceCents)}
                      </td>

                      {/* EXISTENCIA */}
                      <td className="py-3 px-4 text-right font-mono font-bold text-xs">
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
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ====================================================================
            6. FOOTER DE ATAJOS Y CIERRE
            ==================================================================== */}
        <footer className="bg-slate-50 dark:bg-slate-950 px-6 py-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-[11px] font-mono font-bold text-slate-700 dark:text-slate-300 shadow-2xs">
                ↑ ↓
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
