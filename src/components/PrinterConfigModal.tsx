import { useState, useEffect } from "react";
import { api } from "../services/api";
import { SystemPrinter } from "../types";
import { useModals } from "../contexts/ModalContext";

interface PrinterConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export function PrinterConfigModal({
  isOpen,
  onClose,
  onSaved,
}: PrinterConfigModalProps) {
  const { alert: modalAlert } = useModals();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [printers, setPrinters] = useState<SystemPrinter[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isManualPrinter, setIsManualPrinter] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [drawerResult, setDrawerResult] = useState<string | null>(null);
  const [testingPrint, setTestingPrint] = useState(false);
  const [testingDrawer, setTestingDrawer] = useState(false);

  // Cargar configuración existente
  useEffect(() => {
    if (!isOpen) return;

    setLoading(true);
    setTestResult(null);
    setDrawerResult(null);

    Promise.all([
      api.settings.getAll().catch((): Record<string, string> => ({})),
      api.printers.list().catch((): SystemPrinter[] => []),
    ])
      .then(([savedSettings, detectedPrinters]) => {
        setSettings(savedSettings);
        setPrinters(detectedPrinters);
        // Si la impresora configurada no está en la lista detectada, habilitar modo manual
        const target = savedSettings.printer_target;
        if (target && !detectedPrinters.some((p) => p.name === target)) {
          setIsManualPrinter(true);
        }
      })
      .finally(() => setLoading(false));
  }, [isOpen]);

  // Manejar tecla Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const updateField = (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const loadPrinters = async () => {
    setLoadingPrinters(true);
    try {
      const list = await api.printers.list();
      setPrinters(list);
    } catch (err) {
      console.error("Error al detectar impresoras:", err);
    } finally {
      setLoadingPrinters(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.settings.update(settings);
      onSaved?.();
      onClose();
    } catch (err) {
      console.error("Error guardando ajustes de impresora:", err);
      modalAlert({
        title: "Error al guardar",
        message: "No se pudieron guardar los ajustes de la impresora: " + String(err),
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTestPrint = async () => {
    setTestingPrint(true);
    setTestResult(null);
    try {
      // Guardar temporalmente para que el comando tome la impresora seleccionada
      await api.settings.update(settings);
      const res = await api.settings.testPrintTicket();
      setTestResult("✅ " + res);
    } catch (err) {
      console.error("Error en prueba de impresión:", err);
      setTestResult("❌ Error: " + String(err));
    } finally {
      setTestingPrint(false);
    }
  };

  const handleTestDrawer = async () => {
    setTestingDrawer(true);
    setDrawerResult(null);
    try {
      await api.settings.update(settings);
      const res = await api.settings.testOpenDrawer();
      setDrawerResult("✅ " + res);
    } catch (err) {
      console.error("Error probando cajón:", err);
      setDrawerResult("❌ Error: " + String(err));
    } finally {
      setTestingDrawer(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-xl w-full max-h-[90vh] flex flex-col overflow-hidden text-slate-800 dark:text-slate-100">
        {/* HEADER */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xl">
              🖨️
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-white">
                Configuración de Impresora POS
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Impresoras térmicas ESC/POS (USB, Red o Windows Spooler)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
            title="Cerrar (Esc)"
          >
            ✕
          </button>
        </div>

        {/* BODY */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-400">
              <span className="animate-spin text-2xl">🔄</span>
              <span>Cargando configuración de hardware...</span>
            </div>
          ) : (
            <>
              {/* INTERRUPTOR PRINCIPAL */}
              <div className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-xl">
                <div>
                  <div className="font-bold text-slate-900 dark:text-white">
                    Habilitar Impresión de Tickets
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Permite enviar tickets directamente a la impresora térmica
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.printer_enabled !== "false"}
                  onChange={(e) => updateField("printer_enabled", String(e.target.checked))}
                  className="w-5 h-5 accent-emerald-600 rounded cursor-pointer"
                />
              </div>

              {/* SELECCIÓN DE IMPRESORA */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-slate-700 dark:text-slate-300">
                    Impresora de Windows
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={loadPrinters}
                      disabled={loadingPrinters}
                      className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <span className={loadingPrinters ? "animate-spin" : ""}>🔄</span>
                      {loadingPrinters ? "Detectando..." : "Detectar impresoras"}
                    </button>
                    <span className="text-slate-300 dark:text-slate-700">|</span>
                    <button
                      type="button"
                      onClick={() => setIsManualPrinter(!isManualPrinter)}
                      className="text-[11px] font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400 hover:underline cursor-pointer"
                    >
                      {isManualPrinter ? "Ver lista" : "Nombre manual"}
                    </button>
                  </div>
                </div>

                {!isManualPrinter ? (
                  <select
                    value={settings.printer_target || ""}
                    onChange={(e) => updateField("printer_target", e.target.value)}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">-- Seleccionar impresora detectada --</option>
                    {printers.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.isDefault ? "★ " : ""}
                        {p.name}
                        {p.isLikelyPos ? " ⚡ [Térmica / POS]" : ""}
                        {p.port ? ` (${p.port})` : ""}
                      </option>
                    ))}
                    {settings.printer_target &&
                      !printers.some((p) => p.name === settings.printer_target) && (
                        <option value={settings.printer_target}>
                          {settings.printer_target} (Configurada actualmente)
                        </option>
                      )}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={settings.printer_target || ""}
                    onChange={(e) => updateField("printer_target", e.target.value)}
                    placeholder="Ej. POS-58, POS-80, Epson TM-T20, \\SERVIDOR\ticketera"
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-mono font-semibold focus:outline-none focus:border-emerald-500"
                  />
                )}
                {printers.length === 0 && !loadingPrinters && !isManualPrinter && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400">
                    ⚠️ No se encontraron impresoras en Windows. Usa "Nombre manual" si está conectada por red o puerto directo.
                  </p>
                )}
              </div>

              {/* ANCHO DE PAPEL Y OPCIONES */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Ancho del Papel
                  </label>
                  <select
                    value={settings.printer_paper_width || "58mm"}
                    onChange={(e) => updateField("printer_paper_width", e.target.value)}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:border-emerald-500"
                  >
                    <option value="58mm">58 mm (32 columnas aprox.)</option>
                    <option value="80mm">80 mm (48 columnas aprox.)</option>
                  </select>
                </div>

                <div className="flex flex-col justify-center gap-2 pt-1">
                  <label className="flex items-center gap-2 font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.printer_auto_cut !== "false"}
                      onChange={(e) => updateField("printer_auto_cut", String(e.target.checked))}
                      className="accent-emerald-600 rounded"
                    />
                    <span>Corte automático de papel</span>
                  </label>

                  <label className="flex items-center gap-2 font-semibold cursor-pointer text-emerald-700 dark:text-emerald-400">
                    <input
                      type="checkbox"
                      checked={settings.printer_auto_print === "true"}
                      onChange={(e) => updateField("printer_auto_print", String(e.target.checked))}
                      className="accent-emerald-600 rounded"
                    />
                    <span>Imprimir ticket automáticamente al cobrar</span>
                  </label>
                </div>
              </div>

              {/* CAJÓN MONEDERO */}
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-2">
                <div className="font-bold text-amber-900 dark:text-amber-300 flex items-center gap-2">
                  <span>💵</span>
                  <span>Cajón de Dinero (Pulso RJ11)</span>
                </div>
                <label className="flex items-center gap-2 font-semibold cursor-pointer text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={settings.drawer_open_on_print !== "false"}
                    onChange={(e) => updateField("drawer_open_on_print", String(e.target.checked))}
                    className="accent-emerald-600 rounded"
                  />
                  <span>Enviar pulso de apertura al imprimir cada ticket</span>
                </label>
              </div>

              {/* PRUEBAS DE HARDWARE */}
              <div className="p-3.5 bg-slate-100 dark:bg-slate-800/80 rounded-xl space-y-2">
                <div className="font-bold text-slate-700 dark:text-slate-300">
                  Diagnóstico y Pruebas
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleTestPrint}
                    disabled={testingPrint || !settings.printer_target}
                    className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                  >
                    <span>{testingPrint ? "⏳" : "🖨️"}</span>
                    <span>{testingPrint ? "Imprimiendo..." : "Ticket de Prueba"}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleTestDrawer}
                    disabled={testingDrawer || !settings.printer_target}
                    className="px-3.5 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-bold transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                  >
                    <span>{testingDrawer ? "⏳" : "💵"}</span>
                    <span>{testingDrawer ? "Abriendo..." : "Probar Cajón"}</span>
                  </button>
                </div>

                {testResult && (
                  <p className="text-[11px] font-mono mt-1 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 p-2 rounded border border-slate-200 dark:border-slate-700">
                    {testResult}
                  </p>
                )}
                {drawerResult && (
                  <p className="text-[11px] font-mono mt-1 text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 p-2 rounded border border-slate-200 dark:border-slate-700">
                    {drawerResult}
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        {/* FOOTER */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors font-semibold cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-bold shadow-md transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-2"
          >
            <span>{saving ? "💾 Guardando..." : "💾 Guardar Impresora"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
