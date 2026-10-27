import { useState, useRef } from "react";
import { api } from "../../services/api";
import { formatCents } from "../../lib/money";
import { useModals } from "../../contexts/ModalContext";
import { ModalRoot, ModalHeader, ModalBody, ModalFooter } from "../ui/modal";
import type {
  ImportPreviewResult,
  ImportOptionsInput,
  ImportExecutionResult,
} from "../../types";

interface ProductImportExportModalProps {
  isOpen: boolean;
  initialTab?: "import" | "export";
  categories: string[];
  activeUserId?: number;
  onClose: () => void;
  onImportSuccess: () => void;
}

export function ProductImportExportModal({
  isOpen,
  initialTab = "import",
  categories,
  activeUserId,
  onClose,
  onImportSuccess,
}: ProductImportExportModalProps) {
  const { alert } = useModals();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [activeTab, setActiveTab] = useState<"import" | "export">(initialTab);

  // Estado de Importación
  const [selectedFileName, setSelectedFileName] = useState<string>("");
  const [fileBase64, setFileBase64] = useState<string>("");
  const [analyzing, setAnalyzing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [executionResult, setExecutionResult] = useState<ImportExecutionResult | null>(null);
  const [previewFilter, setPreviewFilter] = useState<
    "all" | "new" | "existing" | "new_zero_stock" | "warnings"
  >("all");

  // Opciones de Importación y Sincronización ERP
  const [updateExisting, setUpdateExisting] = useState(true);
  const [overwriteExistingStock, setOverwriteExistingStock] = useState(true);
  const [zeroStockPolicy, setZeroStockPolicy] = useState<
    "local_only" | "skip" | "set_one"
  >("local_only");

  // Estado de Exportación
  const [exportFormat, setExportFormat] = useState<"eleventa" | "metahabi">(
    "eleventa"
  );
  const [exportCategory, setExportCategory] = useState<string>("Todas");
  const [exporting, setExporting] = useState(false);

  const resetImportState = () => {
    setSelectedFileName("");
    setFileBase64("");
    setPreview(null);
    setExecutionResult(null);
    setPreviewFilter("all");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleFileChange = async (file: File | null) => {
    if (!file) return;
    setSelectedFileName(file.name);
    setExecutionResult(null);
    setAnalyzing(true);

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || "");
          const commaIndex = result.indexOf(",");
          resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
        };
        reader.onerror = () => reject(new Error("No se pudo leer el archivo seleccionado."));
        reader.readAsDataURL(file);
      });

      setFileBase64(base64);
      const res = await api.products.previewImportXlsx(base64);
      setPreview(res);
    } catch (err) {
      setPreview(null);
      await alert({
        title: "Error al analizar archivo Excel",
        message: String(err),
        variant: "error",
      });
    } finally {
      setAnalyzing(false);
    }
  };

  const handleExecuteImport = async () => {
    if (!fileBase64 || !preview) return;
    setImporting(true);
    try {
      const options: ImportOptionsInput = {
        updateExisting,
        overwriteExistingStock: updateExisting && overwriteExistingStock,
        zeroStockPolicy,
        userId: activeUserId,
      };

      const result = await api.products.executeImportXlsx(fileBase64, options);
      setExecutionResult(result);
      onImportSuccess();

      // Si hay productos listos para sincronizar con el ERP, disparar sincronización en segundo plano
      if (result.queuedForErpSync > 0) {
        api.sync.syncCatalog().catch(() => {
          // El demonio cada 5s continuará subiendo cualquier lote restante automáticamente
        });
      }
    } catch (err) {
      await alert({
        title: "Error durante la importación",
        message: String(err),
        variant: "error",
      });
    } finally {
      setImporting(false);
    }
  };

  const triggerBrowserDownload = (base64Data: string, fileName: string) => {
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExport = async (mode: "eleventa" | "metahabi" | "template") => {
    setExporting(true);
    try {
      const res = await api.products.exportXlsx(
        mode,
        mode === "template" ? undefined : exportCategory
      );
      triggerBrowserDownload(res.base64Data, res.fileName);

      await alert({
        title:
          mode === "template"
            ? "Plantilla Excel generada"
            : "Catálogo exportado exitosamente",
        message: res.savedPath
          ? `Se exportaron ${res.totalExported} registros.\n\nArchivo guardado automáticamente en:\n${res.savedPath}`
          : `Se descargó el archivo "${res.fileName}" con ${res.totalExported} registros.`,
        variant: "success",
      });
    } catch (err) {
      await alert({
        title: "Error al exportar archivo Excel",
        message: String(err),
        variant: "error",
      });
    } finally {
      setExporting(false);
    }
  };

  const filteredSampleRows =
    preview?.sampleRows.filter((r) => {
      if (previewFilter === "new") return r.status === "new";
      if (previewFilter === "existing") return r.status === "existing";
      if (previewFilter === "new_zero_stock") return r.status === "new_zero_stock";
      if (previewFilter === "warnings") return r.warnings.length > 0;
      return true;
    }) ?? [];

  return (
    <ModalRoot isOpen={isOpen} onClose={onClose} maxWidth="4xl">
      <ModalHeader
        title="Importar y Exportar Productos (Excel .XLSX)"
        subtitle="Compatible con Reporte de Inventario de Eleventa POS y sincronización automática de bodega con Metahabi ERP"
        icon="📊"
        onClose={onClose}
      />

      {/* Barra de pestañas */}
      <div className="px-6 pt-3 bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("import")}
            className={`px-4 py-2.5 text-xs font-bold rounded-t-xl border-b-2 transition-all flex items-center gap-2 ${
              activeTab === "import"
                ? "border-indigo-600 text-indigo-600 dark:text-indigo-400 bg-white dark:bg-slate-900"
                : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            <span>📥</span> Importar desde Excel (Eleventa / POS)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("export")}
            className={`px-4 py-2.5 text-xs font-bold rounded-t-xl border-b-2 transition-all flex items-center gap-2 ${
              activeTab === "export"
                ? "border-emerald-600 text-emerald-600 dark:text-emerald-400 bg-white dark:bg-slate-900"
                : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            <span>📤</span> Exportar Inventario a Excel (.XLSX)
          </button>
        </div>

        <button
          type="button"
          onClick={() => handleExport("template")}
          disabled={exporting}
          className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 pb-2"
        >
          <span>📄</span> Descargar Plantilla Excel de Ejemplo
        </button>
      </div>

      <ModalBody className="max-h-[72vh] overflow-y-auto space-y-4">
        {activeTab === "import" ? (
          <>
            {/* Zona de selección de archivo */}
            {!executionResult && (
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files?.[0] || null;
                  handleFileChange(f);
                }}
                className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-indigo-500 dark:hover:border-indigo-500 rounded-2xl p-5 bg-slate-50/70 dark:bg-slate-950/50 transition-colors flex flex-col sm:flex-row items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-2xl shrink-0">
                    📗
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                      {selectedFileName
                        ? `Archivo cargado: ${selectedFileName}`
                        : "Selecciona o arrastra tu archivo Excel (.xlsx) de Eleventa"}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Columnas reconocidas: <b>Código</b>, <b>Producto</b>, <b>P. Costo</b>,{" "}
                      <b>P. Venta</b>, <b>P. Mayoreo</b>, <b>Existencia</b>,{" "}
                      <b>Inv. Mínimo</b>, <b>Inv. Máximo</b> y <b>Departamento</b>.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.csv"
                    onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                  {selectedFileName && (
                    <button
                      type="button"
                      onClick={resetImportState}
                      className="px-3 py-2 rounded-xl text-xs font-semibold border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      Cambiar
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={analyzing || importing}
                    className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-sm transition-colors"
                  >
                    {analyzing ? "Analizando Excel..." : "Seleccionar Archivo .XLSX"}
                  </button>
                </div>
              </div>
            )}

            {/* Resultado post-importación */}
            {executionResult && (
              <div className="p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">✅</span>
                    <div>
                      <h3 className="text-base font-black text-emerald-700 dark:text-emerald-300">
                        ¡Importación de Catálogo Completada!
                      </h3>
                      <p className="text-xs text-emerald-600/90 dark:text-emerald-400/90">
                        Los productos y existencias han sido registrados en SQLite local y encolados para sincronización con el ERP.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={resetImportState}
                    className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-emerald-500/30 text-xs font-bold text-emerald-700 dark:text-emerald-300"
                  >
                    Importar otro archivo
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                  <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <div className="text-[11px] text-slate-500 font-semibold">Creados Nuevos</div>
                    <div className="text-xl font-black text-emerald-600 dark:text-emerald-400">
                      {executionResult.createdCount}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <div className="text-[11px] text-slate-500 font-semibold">Actualizados</div>
                    <div className="text-xl font-black text-indigo-600 dark:text-indigo-400">
                      {executionResult.updatedCount}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <div className="text-[11px] text-slate-500 font-semibold">Departamentos</div>
                    <div className="text-xl font-black text-purple-600 dark:text-purple-400">
                      +{executionResult.departmentsCreated}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <div className="text-[11px] text-slate-500 font-semibold">En Cola Sync ERP</div>
                    <div className="text-xl font-black text-sky-600 dark:text-sky-400">
                      {executionResult.queuedForErpSync}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <div className="text-[11px] text-slate-500 font-semibold">Omitidos</div>
                    <div className="text-xl font-black text-slate-600 dark:text-slate-400">
                      {executionResult.skippedCount}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Diagnóstico y Opciones de Previsualización */}
            {preview && !executionResult && (
              <div className="space-y-4">
                {/* Tarjetas de Resumen */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setPreviewFilter("all")}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      previewFilter === "all"
                        ? "border-indigo-500 bg-indigo-500/10"
                        : "border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60"
                    }`}
                  >
                    <div className="text-[11px] font-semibold text-slate-500">
                      Total Filas Válidas
                    </div>
                    <div className="text-lg font-black text-slate-900 dark:text-white">
                      {preview.validRows}
                    </div>
                    <div className="text-[10px] text-slate-400 truncate">
                      {preview.detectedFormat}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPreviewFilter("new")}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      previewFilter === "new"
                        ? "border-emerald-500 bg-emerald-500/10"
                        : "border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60"
                    }`}
                  >
                    <div className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                      Nuevos (Stock &gt; 0)
                    </div>
                    <div className="text-lg font-black text-emerald-600 dark:text-emerald-400">
                      {preview.newWithStockCount}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      Alta directa en ERP
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPreviewFilter("existing")}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      previewFilter === "existing"
                        ? "border-sky-500 bg-sky-500/10"
                        : "border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60"
                    }`}
                  >
                    <div className="text-[11px] font-semibold text-sky-600 dark:text-sky-400">
                      Ya Existentes
                    </div>
                    <div className="text-lg font-black text-sky-600 dark:text-sky-400">
                      {preview.existingCount}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      Coinciden por código
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPreviewFilter("new_zero_stock")}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      previewFilter === "new_zero_stock"
                        ? "border-amber-500 bg-amber-500/10"
                        : "border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60"
                    }`}
                  >
                    <div className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                      Nuevos en Stock 0
                    </div>
                    <div className="text-lg font-black text-amber-600 dark:text-amber-400">
                      {preview.newZeroStockCount}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      Existencia = 0.00
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPreviewFilter("warnings")}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      previewFilter === "warnings"
                        ? "border-rose-500 bg-rose-500/10"
                        : "border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60"
                    }`}
                  >
                    <div className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                      Alertas Costo/Precio
                    </div>
                    <div className="text-lg font-black text-rose-600 dark:text-rose-400">
                      {preview.costWarningCount + preview.invalidCount}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      Click para revisar
                    </div>
                  </button>
                </div>

                {/* Departamentos nuevos detectados */}
                {preview.newDepartments.length > 0 && (
                  <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold text-purple-700 dark:text-purple-300">
                      🏷️ Se crearán {preview.newDepartments.length} departamentos nuevos:
                    </span>
                    {preview.newDepartments.slice(0, 12).map((dept) => (
                      <span
                        key={dept}
                        className="px-2 py-0.5 rounded-md bg-white dark:bg-slate-900 border border-purple-500/30 text-[11px] font-semibold text-purple-700 dark:text-purple-300"
                      >
                        {dept}
                      </span>
                    ))}
                    {preview.newDepartments.length > 12 && (
                      <span className="text-[11px] text-purple-500 font-semibold">
                        +{preview.newDepartments.length - 12} más
                      </span>
                    )}
                  </div>
                )}

                {/* Panel de Reglas de Sincronización con el ERP */}
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2.5">
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      🔄 Productos que ya existen en el POS / ERP ({preview.existingCount})
                    </div>
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={updateExisting}
                        onChange={(e) => setUpdateExisting(e.target.checked)}
                        className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-xs text-slate-600 dark:text-slate-300">
                        <b>Actualizar precios y datos</b> (P. Costo, P. Venta, P. Mayoreo, Nombre y Departamento)
                      </span>
                    </label>
                    <label
                      className={`flex items-start gap-2.5 cursor-pointer ${
                        !updateExisting ? "opacity-50 pointer-events-none" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={overwriteExistingStock}
                        onChange={(e) => setOverwriteExistingStock(e.target.checked)}
                        disabled={!updateExisting}
                        className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-xs text-slate-600 dark:text-slate-300">
                        <b>Sincronizar también la Existencia del Excel</b> (Genera ajuste automático de inventario en la bodega de la caja en el ERP)
                      </span>
                    </label>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      📦 Productos nuevos con Existencia = 0.00 ({preview.newZeroStockCount})
                    </div>
                    <select
                      value={zeroStockPolicy}
                      onChange={(e) =>
                        setZeroStockPolicy(
                          e.target.value as "local_only" | "skip" | "set_one"
                        )
                      }
                      className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-100"
                    >
                      <option value="local_only">
                        Guardar en POS local y subir al ERP cuando reciban stock &gt; 0 (Recomendado)
                      </option>
                      <option value="set_one">
                        Importar con existencia inicial 1.0 para dar de alta ya en el ERP
                      </option>
                      <option value="skip">
                        Omitir productos nuevos que tengan existencia en 0.00
                      </option>
                    </select>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
                      El ERP solo registra en bodega productos físicos nuevos cuando su saldo inicial es mayor a 0.
                    </p>
                  </div>
                </div>

                {/* Tabla de Vista Previa */}
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                  <div className="px-3.5 py-2 bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-700 dark:text-slate-300">
                      Vista previa ({filteredSampleRows.length} mostrados)
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Los importes se convierten a centavos enteros exactos
                    </span>
                  </div>
                  <div className="max-h-60 overflow-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="bg-slate-50 dark:bg-slate-950 text-[10px] uppercase text-slate-500 sticky top-0 z-10 border-b border-slate-200 dark:border-slate-800">
                        <tr>
                          <th className="py-2 px-2.5">Fila</th>
                          <th className="py-2 px-2.5">Código</th>
                          <th className="py-2 px-2.5">Producto</th>
                          <th className="py-2 px-2.5 text-right">P. Costo</th>
                          <th className="py-2 px-2.5 text-right">P. Venta</th>
                          <th className="py-2 px-2.5 text-right">P. Mayoreo</th>
                          <th className="py-2 px-2.5 text-right">Existencia</th>
                          <th className="py-2 px-2.5 text-center">Mín/Máx</th>
                          <th className="py-2 px-2.5">Departamento</th>
                          <th className="py-2 px-2.5">Estado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800/60">
                        {filteredSampleRows.map((row) => (
                          <tr
                            key={`${row.rowNumber}-${row.code}`}
                            className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                          >
                            <td className="py-1.5 px-2.5 font-mono text-[11px] text-slate-400">
                              #{row.rowNumber}
                            </td>
                            <td className="py-1.5 px-2.5 font-mono font-semibold text-slate-700 dark:text-slate-200">
                              {row.code || "—"}
                            </td>
                            <td className="py-1.5 px-2.5 font-medium text-slate-900 dark:text-white max-w-[200px] truncate">
                              {row.name || "—"}
                            </td>
                            <td className="py-1.5 px-2.5 text-right font-mono text-slate-600 dark:text-slate-300">
                              {formatCents(row.costCents)}
                            </td>
                            <td className="py-1.5 px-2.5 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                              {formatCents(row.priceCents)}
                            </td>
                            <td className="py-1.5 px-2.5 text-right font-mono text-slate-500">
                              {row.wholesalePriceCents > 0
                                ? formatCents(row.wholesalePriceCents)
                                : "$0.00"}
                            </td>
                            <td className="py-1.5 px-2.5 text-right font-mono font-bold">
                              <span
                                className={
                                  row.stock > 0
                                    ? "text-slate-800 dark:text-slate-100"
                                    : "text-amber-500"
                                }
                              >
                                {row.stock.toFixed(2)}
                              </span>
                            </td>
                            <td className="py-1.5 px-2.5 text-center font-mono text-[11px] text-slate-500">
                              {row.minStock}/{row.maxStock}
                            </td>
                            <td className="py-1.5 px-2.5 text-slate-600 dark:text-slate-300 truncate max-w-[130px]">
                              {row.department}
                            </td>
                            <td className="py-1.5 px-2.5">
                              {row.status === "new" && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                                  NUEVO
                                </span>
                              )}
                              {row.status === "existing" && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/15 text-sky-600 dark:text-sky-400">
                                  EXISTENTE
                                </span>
                              )}
                              {row.status === "new_zero_stock" && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400">
                                  STOCK 0
                                </span>
                              )}
                              {row.status === "invalid" && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-600 dark:text-rose-400">
                                  INVÁLIDO
                                </span>
                              )}
                              {row.warnings.length > 0 && (
                                <div
                                  className="text-[10px] text-amber-600 dark:text-amber-400 truncate max-w-[160px]"
                                  title={row.warnings.join(" | ")}
                                >
                                  ⚠️ {row.warnings[0]}
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          /* Pestaña de Exportación */
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setExportFormat("eleventa")}
                className={`p-4 rounded-2xl border-2 text-left transition-all ${
                  exportFormat === "eleventa"
                    ? "border-emerald-500 bg-emerald-500/10"
                    : "border-slate-200 dark:border-slate-800 hover:border-slate-300"
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-black text-slate-900 dark:text-white">
                    📗 Formato Compatible Eleventa (9 Columnas)
                  </span>
                  {exportFormat === "eleventa" && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-600 text-white">
                      Activo
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Genera <b>Reporte de inventario.xlsx</b> con las 9 columnas exactas:{" "}
                  <code>Código</code>, <code>Producto</code>, <code>P. Costo</code>,{" "}
                  <code>P. Venta</code>, <code>P. Mayoreo</code>, <code>Existencia</code>,{" "}
                  <code>Inv. Mínimo</code>, <code>Inv. Máximo</code> y{" "}
                  <code>Departamento</code>.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setExportFormat("metahabi")}
                className={`p-4 rounded-2xl border-2 text-left transition-all ${
                  exportFormat === "metahabi"
                    ? "border-indigo-500 bg-indigo-500/10"
                    : "border-slate-200 dark:border-slate-800 hover:border-slate-300"
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-black text-slate-900 dark:text-white">
                    📘 Formato Extendido Metahabi POS (15 Columnas)
                  </span>
                  {exportFormat === "metahabi" && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-600 text-white">
                      Activo
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Incluye todas las columnas de Eleventa más: <code>Código de Barras</code>,{" "}
                  <code>Unidad</code>, <code>IVA (%)</code>, <code>Impoconsumo</code>,{" "}
                  <code>Tipo (Físico/Servicio/Combo)</code> y{" "}
                  <code>Estado de Sincronización ERP</code>.
                </p>
              </button>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-200">
                  Filtrar por Departamento / Categoría
                </label>
                <p className="text-[11px] text-slate-500">
                  Puedes exportar todo el catálogo activo o solo un departamento específico.
                </p>
              </div>
              <select
                value={exportCategory}
                onChange={(e) => setExportCategory(e.target.value)}
                className="w-full sm:w-64 px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-100"
              >
                <option value="Todas">Todos los Departamentos</option>
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          Cerrar
        </button>

        {activeTab === "import" ? (
          !executionResult && (
            <button
              type="button"
              onClick={handleExecuteImport}
              disabled={!preview || preview.validRows === 0 || importing}
              className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold shadow-md transition-all flex items-center gap-2"
            >
              <span>🚀</span>
              {importing
                ? "Importando y sincronizando..."
                : `Confirmar e Importar (${preview?.validRows ?? 0} productos)`}
            </button>
          )
        ) : (
          <button
            type="button"
            onClick={() => handleExport(exportFormat)}
            disabled={exporting}
            className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold shadow-md transition-all flex items-center gap-2"
          >
            <span>📤</span>
            {exporting
              ? "Generando archivo Excel..."
              : exportFormat === "eleventa"
              ? "Descargar Reporte de inventario.xlsx"
              : "Descargar Catálogo Metahabi.xlsx"}
          </button>
        )}
      </ModalFooter>
    </ModalRoot>
  );
}
