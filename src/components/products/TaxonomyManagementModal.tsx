import React, { useState, useEffect, useCallback, useMemo } from "react";
import { ModalRoot, ModalHeader, ModalBody, ModalFooter } from "../ui/modal";
import { useModals } from "../../contexts/ModalContext";
import { api } from "../../services/api";
import { hasPermission } from "../../lib/permissions";
import type { CashierUser, CategoryDetailed, ProductTag } from "../../types";

interface TaxonomyManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  cashier: CashierUser | null;
  onChanged?: () => void;
}

const PRESET_TAG_COLORS = [
  { name: "Rojo (Alerta / Oferta)", hex: "#ef4444" },
  { name: "Naranja (Promo 2x1)", hex: "#f97316" },
  { name: "Ámbar (Destacado)", hex: "#f59e0b" },
  { name: "Verde (Fresco / Orgánico)", hex: "#10b981" },
  { name: "Azul (Bebidas / Frío)", hex: "#3b82f6" },
  { name: "Violeta (Premium)", hex: "#8b5cf6" },
  { name: "Rosa (Dulces / Snacks)", hex: "#ec4899" },
  { name: "Pizarra (General)", hex: "#64748b" },
];

export function TaxonomyManagementModal({
  isOpen,
  onClose,
  cashier,
  onChanged,
}: TaxonomyManagementModalProps) {
  const [activeTab, setActiveTab] = useState<"categories" | "tags">("categories");
  const { alert: modalAlert, confirm: modalConfirm } = useModals();

  // Permisos dinámicos con soporte para elevación temporal por PIN de supervisor
  const [supervisorUnlocked, setSupervisorUnlocked] = useState(false);
  const [showSupervisorPrompt, setShowSupervisorPrompt] = useState(false);
  const [supervisorPin, setSupervisorPin] = useState("");
  const [supervisorError, setSupervisorError] = useState<string | null>(null);

  const canManageCategories = useMemo(() => {
    if (supervisorUnlocked) return true;
    return hasPermission(cashier, "catalogo:categorias:gestionar");
  }, [cashier, supervisorUnlocked]);

  const canManageTags = useMemo(() => {
    if (supervisorUnlocked) return true;
    return hasPermission(cashier, "catalogo:etiquetas:gestionar");
  }, [cashier, supervisorUnlocked]);

  // Estados de Categorías
  const [categories, setCategories] = useState<CategoryDetailed[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [categorySearch, setCategorySearch] = useState("");
  const [isEditingCategory, setIsEditingCategory] = useState(false);
  const [categoryFormId, setCategoryFormId] = useState<number | null>(null);
  const [categoryFormName, setCategoryFormName] = useState("");
  const [categoryFormActive, setCategoryFormActive] = useState(true);
  const [categorySubmitting, setCategorySubmitting] = useState(false);

  // Estado para modal de reasignación de productos al eliminar
  const [reassignModalOpen, setReassignModalOpen] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState<CategoryDetailed | null>(null);
  const [reassignTargetId, setReassignTargetId] = useState<number | "">("");

  // Estados de Etiquetas
  const [tags, setTags] = useState<ProductTag[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  const [isEditingTag, setIsEditingTag] = useState(false);
  const [tagFormId, setTagFormId] = useState<number | null>(null);
  const [tagFormName, setTagFormName] = useState("");
  const [tagFormColor, setTagFormColor] = useState("#ef4444");
  const [tagSubmitting, setTagSubmitting] = useState(false);

  // Cargar Categorías Detalladas
  const loadCategories = useCallback(async () => {
    try {
      setLoadingCategories(true);
      const list = await api.categories.listDetailed();
      setCategories(list);
    } catch (e: unknown) {
      console.error("Error al cargar categorías:", e);
    } finally {
      setLoadingCategories(false);
    }
  }, []);

  // Cargar Etiquetas
  const loadTags = useCallback(async () => {
    try {
      setLoadingTags(true);
      const list = await api.tags.list();
      setTags(list);
    } catch (e: unknown) {
      console.error("Error al cargar etiquetas:", e);
    } finally {
      setLoadingTags(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadCategories();
      loadTags();
    }
  }, [isOpen, loadCategories, loadTags]);

  // Manejo de autorización de supervisor por PIN
  const handleAuthorizeSupervisor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supervisorPin.trim()) return;
    try {
      setSupervisorError(null);
      const user = await api.auth.loginPin(supervisorPin.trim());
      if (hasPermission(user, "catalogo:categorias:gestionar")) {
        setSupervisorUnlocked(true);
        setShowSupervisorPrompt(false);
        setSupervisorPin("");
      } else {
        setSupervisorError("El usuario autorizado no cuenta con permisos de administrador de catálogo.");
      }
    } catch {
      setSupervisorError("PIN incorrecto o usuario inactivo.");
    }
  };

  // ==============================================================
  // ACCIONES DE CATEGORÍAS
  // ==============================================================
  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageCategories) {
      setShowSupervisorPrompt(true);
      return;
    }
    const cleanName = categoryFormName.trim();
    if (!cleanName) {
      modalAlert({
        title: "Nombre requerido",
        message: "Debe ingresar el nombre de la categoría.",
        variant: "warning",
      });
      return;
    }

    try {
      setCategorySubmitting(true);
      if (categoryFormId) {
        await api.categories.update(categoryFormId, cleanName, categoryFormActive);
      } else {
        await api.categories.create(cleanName);
      }
      setCategoryFormId(null);
      setCategoryFormName("");
      setCategoryFormActive(true);
      setIsEditingCategory(false);
      await loadCategories();
      onChanged?.();
    } catch (err: unknown) {
      modalAlert({
        title: "Error al guardar categoría",
        message: String(err),
        variant: "error",
      });
    } finally {
      setCategorySubmitting(false);
    }
  };

  const handleStartEditCategory = (c: CategoryDetailed) => {
    if (!canManageCategories) {
      setShowSupervisorPrompt(true);
      return;
    }
    setCategoryFormId(c.id);
    setCategoryFormName(c.name);
    setCategoryFormActive(c.active);
    setIsEditingCategory(true);
  };

  const handleCancelCategoryForm = () => {
    setCategoryFormId(null);
    setCategoryFormName("");
    setCategoryFormActive(true);
    setIsEditingCategory(false);
  };

  const handleDeleteCategoryClick = async (c: CategoryDetailed) => {
    if (!canManageCategories) {
      setShowSupervisorPrompt(true);
      return;
    }
    if (c.productCount > 0) {
      // Tiene productos asociados: Abrir modal para elegir categoría destino
      setCategoryToDelete(c);
      const otherCategories = categories.filter((item) => item.id !== c.id);
      setReassignTargetId(otherCategories[0]?.id || "");
      setReassignModalOpen(true);
    } else {
      const ok = await modalConfirm({
        title: "Eliminar Categoría",
        message: `¿Desea eliminar la categoría "${c.name}"? Esta acción no se puede deshacer.`,
        confirmText: "Eliminar",
        cancelText: "Cancelar",
        variant: "danger",
      });
      if (ok) {
        try {
          await api.categories.delete(c.id);
          await loadCategories();
          onChanged?.();
        } catch (err: unknown) {
          modalAlert({
            title: "Error al eliminar",
            message: String(err),
            variant: "error",
          });
        }
      }
    }
  };

  const handleConfirmReassignAndDelete = async () => {
    if (!categoryToDelete) return;
    if (!reassignTargetId) {
      modalAlert({
        title: "Seleccione categoría destino",
        message: "Debe seleccionar una categoría a la cual transferir los productos.",
        variant: "warning",
      });
      return;
    }

    try {
      await api.categories.delete(categoryToDelete.id, Number(reassignTargetId));
      setReassignModalOpen(false);
      setCategoryToDelete(null);
      await loadCategories();
      onChanged?.();
      modalAlert({
        title: "Categoría Eliminada",
        message: `La categoría fue eliminada y sus productos asociados fueron transferidos con éxito.`,
        variant: "success",
      });
    } catch (err: unknown) {
      modalAlert({
        title: "Error en reasignación",
        message: String(err),
        variant: "error",
      });
    }
  };

  // ==============================================================
  // ACCIONES DE ETIQUETAS (TAGS)
  // ==============================================================
  const handleSaveTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageTags) {
      setShowSupervisorPrompt(true);
      return;
    }
    const cleanName = tagFormName.trim().replace(/^#/, "");
    if (!cleanName) {
      modalAlert({
        title: "Nombre requerido",
        message: "Debe ingresar el nombre de la etiqueta.",
        variant: "warning",
      });
      return;
    }

    try {
      setTagSubmitting(true);
      if (tagFormId) {
        await api.tags.update(tagFormId, cleanName, tagFormColor);
      } else {
        await api.tags.create(cleanName, tagFormColor);
      }
      setTagFormId(null);
      setTagFormName("");
      setTagFormColor("#ef4444");
      setIsEditingTag(false);
      await loadTags();
      onChanged?.();
    } catch (err: unknown) {
      modalAlert({
        title: "Error al guardar etiqueta",
        message: String(err),
        variant: "error",
      });
    } finally {
      setTagSubmitting(false);
    }
  };

  const handleStartEditTag = (t: ProductTag) => {
    if (!canManageTags) {
      setShowSupervisorPrompt(true);
      return;
    }
    setTagFormId(t.id);
    setTagFormName(t.name);
    setTagFormColor(t.colorHex);
    setIsEditingTag(true);
  };

  const handleCancelTagForm = () => {
    setTagFormId(null);
    setTagFormName("");
    setTagFormColor("#ef4444");
    setIsEditingTag(false);
  };

  const handleDeleteTag = async (t: ProductTag) => {
    if (!canManageTags) {
      setShowSupervisorPrompt(true);
      return;
    }
    const ok = await modalConfirm({
      title: "Eliminar Etiqueta",
      message: `¿Desea eliminar la etiqueta "#${t.name}"? Los productos conservarán su histórico.`,
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      variant: "danger",
    });
    if (ok) {
      try {
        await api.tags.delete(t.id);
        await loadTags();
        onChanged?.();
      } catch (err: unknown) {
        modalAlert({
          title: "Error al eliminar etiqueta",
          message: String(err),
          variant: "error",
        });
      }
    }
  };

  const filteredCategories = useMemo(() => {
    const q = categorySearch.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(q));
  }, [categories, categorySearch]);

  const filteredTags = useMemo(() => {
    const q = tagSearch.trim().toLowerCase().replace(/^#/, "");
    if (!q) return tags;
    return tags.filter((t) => t.name.toLowerCase().includes(q));
  }, [tags, tagSearch]);

  if (!isOpen) return null;

  return (
    <>
      <ModalRoot isOpen={isOpen} onClose={onClose} maxWidth="3xl">
        <ModalHeader
          title="Gestor de Categorías y Etiquetas"
          subtitle="Taxonomía y organización de catálogo del punto de venta con control de acceso RBAC"
          onClose={onClose}
        />

        <ModalBody className="p-0">
          {/* Barra de Pestañas Superior */}
          <div className="flex items-center justify-between px-6 pt-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTab("categories")}
                className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-all cursor-pointer ${
                  activeTab === "categories"
                    ? "border-amber-500 text-amber-600 dark:text-amber-400 bg-white dark:bg-slate-800 rounded-t-xl shadow-2xs"
                    : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                }`}
              >
                <span>📁</span>
                <span>Categorías ({categories.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("tags")}
                className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-all cursor-pointer ${
                  activeTab === "tags"
                    ? "border-cyan-500 text-cyan-600 dark:text-cyan-400 bg-white dark:bg-slate-800 rounded-t-xl shadow-2xs"
                    : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                }`}
              >
                <span>🏷️</span>
                <span>Etiquetas ({tags.length})</span>
              </button>
            </div>

            {/* Indicador RBAC / Candado */}
            <div className="flex items-center gap-2 pb-2">
              {supervisorUnlocked ? (
                <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 flex items-center gap-1">
                  <span>🔓</span>
                  <span>Supervisor Autorizado</span>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowSupervisorPrompt(true)}
                  className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center gap-1 cursor-pointer"
                  title="Autorizar elevación de privilegios con PIN de supervisor"
                >
                  <span>🔒</span>
                  <span>Elevación PIN</span>
                </button>
              )}
            </div>
          </div>

          {/* CONTENIDO PESTAÑA: CATEGORÍAS */}
          {activeTab === "categories" && (
            <div className="p-6 space-y-5">
              {/* Formulario de Crear / Editar Categoría */}
              <div className="bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-800/40 rounded-2xl p-4">
                <form onSubmit={handleSaveCategory} className="flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-[200px]">
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                      {isEditingCategory ? "Editar Nombre de Categoría:" : "Nueva Categoría:"}
                    </label>
                    <input
                      type="text"
                      value={categoryFormName}
                      onChange={(e) => setCategoryFormName(e.target.value)}
                      placeholder="Ej: Licores, Bebidas, Abarrotes, Snacks..."
                      className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>

                  {isEditingCategory && (
                    <div className="flex items-center gap-2 pt-5">
                      <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={categoryFormActive}
                          onChange={(e) => setCategoryFormActive(e.target.checked)}
                          className="rounded text-amber-500 focus:ring-amber-400"
                        />
                        <span>Activa</span>
                      </label>
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-5">
                    <button
                      type="submit"
                      disabled={categorySubmitting}
                      className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {categorySubmitting
                        ? "Guardando..."
                        : isEditingCategory
                        ? "Actualizar"
                        : "+ Guardar Categoría"}
                    </button>
                    {isEditingCategory && (
                      <button
                        type="button"
                        onClick={handleCancelCategoryForm}
                        className="px-3 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs hover:bg-slate-300 transition-colors cursor-pointer"
                      >
                        Cancelar
                      </button>
                    )}
                  </div>
                </form>
              </div>

              {/* Barra de Filtro y Buscador */}
              <div className="flex items-center justify-between gap-3">
                <input
                  type="text"
                  value={categorySearch}
                  onChange={(e) => setCategorySearch(e.target.value)}
                  placeholder="🔍 Buscar categoría..."
                  className="px-3.5 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-amber-500 w-64 shadow-2xs"
                />
                <span className="text-[11px] text-slate-400">
                  Total: {filteredCategories.length} categoría(s)
                </span>
              </div>

              {/* Tabla de Categorías */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden max-h-80 overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-100/70 dark:bg-slate-900 text-slate-500 font-bold uppercase tracking-wider text-[10px] sticky top-0 z-10 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-2.5 px-4">Nombre</th>
                      <th className="py-2.5 px-4 text-center w-28">Productos</th>
                      <th className="py-2.5 px-4 text-center w-28">Estado</th>
                      <th className="py-2.5 px-4 text-right w-36">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                    {loadingCategories ? (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-slate-400">
                          Cargando categorías...
                        </td>
                      </tr>
                    ) : filteredCategories.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-slate-400 italic">
                          No se encontraron categorías registradas.
                        </td>
                      </tr>
                    ) : (
                      filteredCategories.map((c) => (
                        <tr
                          key={c.id}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          <td className="py-2.5 px-4 font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                            <span>📁</span>
                            <span>{c.name}</span>
                          </td>
                          <td className="py-2.5 px-4 text-center font-mono font-bold text-slate-600 dark:text-slate-400">
                            <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[11px]">
                              {c.productCount} ítems
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-center">
                            {c.active ? (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                                Activa
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-400 border border-slate-200 dark:border-slate-700">
                                Inactiva
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-right space-x-1.5">
                            <button
                              type="button"
                              onClick={() => handleStartEditCategory(c)}
                              className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 font-bold text-[11px] border border-amber-200 dark:border-amber-800 transition-colors cursor-pointer"
                              title="Editar o renombrar categoría"
                            >
                              ✏️ Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteCategoryClick(c)}
                              className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 font-bold text-[11px] border border-rose-200 dark:border-rose-800 transition-colors cursor-pointer"
                              title="Eliminar o reasignar categoría"
                            >
                              🗑️
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* CONTENIDO PESTAÑA: ETIQUETAS */}
          {activeTab === "tags" && (
            <div className="p-6 space-y-5">
              {/* Formulario de Crear / Editar Etiqueta */}
              <div className="bg-cyan-50/50 dark:bg-cyan-950/20 border border-cyan-200/80 dark:border-cyan-800/40 rounded-2xl p-4">
                <form onSubmit={handleSaveTag} className="flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-[200px]">
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                      {isEditingTag ? "Editar Etiqueta:" : "Nueva Etiqueta:"}
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-cyan-600 font-mono font-bold">#</span>
                      <input
                        type="text"
                        value={tagFormName}
                        onChange={(e) => setTagFormName(e.target.value)}
                        placeholder="mas-vendido, oferta, frío, promo..."
                        className="w-full pl-7 pr-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500 font-mono"
                      />
                    </div>
                  </div>

                  {/* Selector de Color */}
                  <div className="pt-5 flex items-center gap-2">
                    <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400">Color:</span>
                    <div className="flex items-center gap-1.5">
                      {PRESET_TAG_COLORS.map((col) => (
                        <button
                          key={col.hex}
                          type="button"
                          onClick={() => setTagFormColor(col.hex)}
                          style={{ backgroundColor: col.hex }}
                          title={col.name}
                          className={`w-6 h-6 rounded-full cursor-pointer transition-transform ${
                            tagFormColor.toLowerCase() === col.hex.toLowerCase()
                              ? "ring-2 ring-offset-2 ring-slate-800 dark:ring-white scale-110"
                              : "hover:scale-105 opacity-80 hover:opacity-100"
                          }`}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-5">
                    <button
                      type="submit"
                      disabled={tagSubmitting}
                      className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white font-bold text-xs shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {tagSubmitting
                        ? "Guardando..."
                        : isEditingTag
                        ? "Actualizar"
                        : "+ Guardar Etiqueta"}
                    </button>
                    {isEditingTag && (
                      <button
                        type="button"
                        onClick={handleCancelTagForm}
                        className="px-3 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs hover:bg-slate-300 transition-colors cursor-pointer"
                      >
                        Cancelar
                      </button>
                    )}
                  </div>
                </form>
              </div>

              {/* Buscador de Tags */}
              <div className="flex items-center justify-between gap-3">
                <input
                  type="text"
                  value={tagSearch}
                  onChange={(e) => setTagSearch(e.target.value)}
                  placeholder="🔍 Buscar etiqueta (#tag)..."
                  className="px-3.5 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-cyan-500 w-64 shadow-2xs font-mono"
                />
                <span className="text-[11px] text-slate-400">
                  Total: {filteredTags.length} etiqueta(s)
                </span>
              </div>

              {/* Grid / Lista de Etiquetas */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-2xl p-4 max-h-80 overflow-y-auto">
                {loadingTags ? (
                  <div className="py-8 text-center text-slate-400 text-xs">Cargando etiquetas...</div>
                ) : filteredTags.length === 0 ? (
                  <div className="py-8 text-center text-slate-400 text-xs italic">
                    Sin etiquetas registradas. Crea una arriba para destacar productos.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {filteredTags.map((t) => (
                      <div
                        key={t.id}
                        className="flex items-center justify-between p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs hover:border-slate-300 transition-colors"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <span
                            className="w-3.5 h-3.5 rounded-full shrink-0 shadow-xs"
                            style={{ backgroundColor: t.colorHex }}
                          />
                          <span
                            className="text-xs font-mono font-bold truncate"
                            style={{ color: t.colorHex }}
                          >
                            #{t.name}
                          </span>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleStartEditTag(t)}
                            className="p-1 text-slate-400 hover:text-amber-500 text-xs rounded transition-colors cursor-pointer"
                            title="Editar etiqueta"
                          >
                            ✏️
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteTag(t)}
                            className="p-1 text-slate-400 hover:text-rose-500 text-xs rounded transition-colors cursor-pointer"
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
            </div>
          )}
        </ModalBody>

        <ModalFooter>
          <div className="w-full flex items-center justify-between">
            <span className="text-[11px] text-slate-400">
              {canManageCategories ? "✓ Permiso de Administrador activo" : "🔒 Modo lectura para cajeros"}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs transition-colors cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        </ModalFooter>
      </ModalRoot>

      {/* MODAL DE REASIGNACIÓN DE PRODUCTOS AL ELIMINAR CATEGORÍA */}
      {reassignModalOpen && categoryToDelete && (
        <ModalRoot isOpen={reassignModalOpen} onClose={() => setReassignModalOpen(false)} maxWidth="md">
          <ModalHeader
            title="Reasignar Productos de Categoría"
            subtitle={`La categoría "${categoryToDelete.name}" tiene ${categoryToDelete.productCount} producto(s) asignado(s)`}
            onClose={() => setReassignModalOpen(false)}
          />
          <ModalBody className="p-6 space-y-4">
            <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 font-medium">
              ⚠️ Para no dejar productos huérfanos sin categoría en el catálogo, debe transferirlos a otra categoría activa existente antes de eliminarla.
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                Transferir productos a la siguiente categoría:
              </label>
              <select
                value={reassignTargetId}
                onChange={(e) => setReassignTargetId(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
              >
                {categories
                  .filter((cat) => cat.id !== categoryToDelete.id && cat.active)
                  .map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      📁 {cat.name} ({cat.productCount} productos actuales)
                    </option>
                  ))}
              </select>
            </div>
          </ModalBody>
          <ModalFooter>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setReassignModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmReassignAndDelete}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-xs cursor-pointer"
              >
                Reasignar y Eliminar
              </button>
            </div>
          </ModalFooter>
        </ModalRoot>
      )}

      {/* MODAL DE ELEVACIÓN POR PIN DE SUPERVISOR */}
      {showSupervisorPrompt && (
        <ModalRoot isOpen={showSupervisorPrompt} onClose={() => setShowSupervisorPrompt(false)} maxWidth="sm">
          <ModalHeader
            title="Autorización de Administrador"
            subtitle="Se requiere PIN de supervisor para modificar categorías o etiquetas"
            onClose={() => setShowSupervisorPrompt(false)}
          />
          <ModalBody className="p-6">
            <form onSubmit={handleAuthorizeSupervisor} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  Ingrese PIN de 4 dígitos:
                </label>
                <input
                  type="password"
                  maxLength={6}
                  value={supervisorPin}
                  onChange={(e) => setSupervisorPin(e.target.value)}
                  autoFocus
                  placeholder="••••"
                  className="w-full text-center tracking-widest text-lg font-mono py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              {supervisorError && (
                <div className="text-[11px] text-rose-600 dark:text-rose-400 font-bold text-center">
                  {supervisorError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSupervisorPrompt(false)}
                  className="px-3 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-xs cursor-pointer"
                >
                  Autorizar
                </button>
              </div>
            </form>
          </ModalBody>
        </ModalRoot>
      )}
    </>
  );
}
