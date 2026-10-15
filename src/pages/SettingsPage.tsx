import { useState, useEffect } from "react";
import { api } from "../services/api";
import { TerminalStatus, PaymentMethod } from "../types";
import { useTheme } from "../contexts/ThemeContext";
import { useModals } from "../contexts/ModalContext";
import { useUpdater } from "../contexts/UpdaterContext";

interface SettingsPageProps {
  terminalStatus: TerminalStatus;
  onBackToSales: () => void;
  onUnpaired: () => void;
}

type SettingsTab = "printer" | "drawer" | "scanner" | "terminal" | "payments" | "general";

export function SettingsPage({
  terminalStatus,
  onBackToSales,
  onUnpaired,
}: SettingsPageProps) {
  const { theme, toggleTheme } = useTheme();
  const { confirm, alert: modalAlert } = useModals();
  const updater = useUpdater();
  const [activeTab, setActiveTab] = useState<SettingsTab>("printer");
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Estado de medios de pago
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loadingMethods, setLoadingMethods] = useState(false);
  const [syncingMethods, setSyncingMethods] = useState(false);

  // Cargar ajustes desde SQLite
  useEffect(() => {
    api.settings
      .getAll()
      .then((map) => setSettings(map))
      .catch((err) => console.error("Error cargando ajustes:", err))
      .finally(() => setLoading(false));
  }, []);

  // Atajo global para volver con Esc o F1
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "F1") {
        e.preventDefault();
        onBackToSales();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onBackToSales]);

  const updateField = (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const showMsg = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 3500);
  };

  const loadPaymentMethods = async () => {
    setLoadingMethods(true);
    try {
      const list = await api.sync.getPaymentMethods();
      setPaymentMethods(list);
    } catch (err) {
      console.error("Error cargando medios de pago:", err);
    } finally {
      setLoadingMethods(false);
    }
  };

  useEffect(() => {
    if (activeTab === "payments") {
      loadPaymentMethods();
    }
  }, [activeTab]);

  const handleToggleMethod = async (id: string, currentEnabled: number) => {
    const nextEnabled = currentEnabled !== 1;
    try {
      await api.sync.togglePaymentMethodTerminalStatus(id, nextEnabled);
      setPaymentMethods((prev) =>
        prev.map((pm) =>
          pm.id === id ? { ...pm, terminalEnabled: nextEnabled ? 1 : 0 } : pm
        )
      );
      showMsg(`✅ Medio de pago ${nextEnabled ? "habilitado" : "deshabilitado"} en esta caja`);
    } catch (err) {
      modalAlert({
        title: "Error al cambiar estado",
        message: String(err),
        variant: "error",
      });
    }
  };

  const handleSyncPaymentMethods = async () => {
    setSyncingMethods(true);
    try {
      const count = await api.sync.syncPaymentMethods();
      await loadPaymentMethods();
      showMsg(`✅ ${count} medios de pago sincronizados desde el ERP`);
    } catch (err) {
      modalAlert({
        title: "Error al sincronizar con ERP",
        message: String(err),
        variant: "error",
      });
    } finally {
      setSyncingMethods(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.settings.update(settings);
      showMsg("✅ Configuraciones guardadas correctamente");
    } catch (err) {
      console.error("Error guardando ajustes:", err);
      modalAlert({
        title: "Error al Guardar Ajustes",
        message: String(err),
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTestPrint = async () => {
    try {
      const res = await api.settings.testPrintTicket();
      setTestResult(res);
      showMsg("🖨️ " + res);
    } catch (err) {
      setTestResult("Error de impresión: " + String(err));
    }
  };

  const handleTestDrawer = async () => {
    try {
      const res = await api.settings.testOpenDrawer();
      setTestResult(res);
      showMsg("💵 " + res);
    } catch (err) {
      setTestResult("Error de apertura: " + String(err));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-100 dark:bg-slate-950 text-slate-800 dark:text-slate-200">
        <span className="font-semibold text-sm">Cargando configuraciones…</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-slate-100 dark:bg-slate-950 text-slate-800 dark:text-slate-100 font-sans select-none overflow-hidden transition-colors duration-150">
      {/* 1. HEADER */}
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="px-2.5 py-1 bg-gradient-to-r from-red-600 to-rose-700 rounded-lg text-white font-black text-xs tracking-wider shadow">
            ML
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span>Configuración del Sistema</span>
              <span className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 text-[10px] px-1.5 py-0.5 rounded font-mono font-bold">
                F7
              </span>
            </h1>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Periféricos, hardware, opciones de impresión y enlace ERP
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={toggleTheme}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-semibold transition-colors"
          >
            {theme === "dark" ? "☀️ Modo Claro" : "🌙 Modo Oscuro"}
          </button>

          <button
            onClick={onBackToSales}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold transition-colors shadow-sm"
          >
            <span>← Volver a Ventas</span>
            <span className="bg-slate-900 px-1.5 py-0.5 rounded text-[10px] font-mono text-slate-400">
              Esc / F1
            </span>
          </button>
        </div>
      </header>

      {/* FEEDBACK TOAST */}
      {feedback && (
        <div className="bg-emerald-50 dark:bg-slate-800/95 border-b border-emerald-300 dark:border-emerald-500/40 text-emerald-800 dark:text-emerald-300 px-6 py-2 text-xs font-semibold flex items-center justify-between">
          <span>{feedback}</span>
          <button onClick={() => setFeedback(null)} className="text-slate-400 hover:text-slate-700 dark:hover:text-white">
            ✕
          </button>
        </div>
      )}

      {/* 2. BODY PRINCIPAL */}
      <div className="flex-1 flex overflow-hidden">
        {/* SIDEBAR DE CATEGORÍAS */}
        <aside className="w-64 bg-slate-50 dark:bg-slate-900/60 border-r border-slate-200 dark:border-slate-800 p-4 flex flex-col gap-1.5">
          <button
            onClick={() => setActiveTab("printer")}
            className={`w-full text-left px-4 py-3 rounded-xl font-semibold text-xs transition-colors flex items-center gap-3 ${
              activeTab === "printer"
                ? "bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 shadow-sm border border-slate-200 dark:border-emerald-500/30"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            <span className="text-base">🖨️</span>
            <div>
              <div className="font-bold">Impresora de Tickets</div>
              <div className="text-[10px] opacity-75 font-normal">ESC/POS, 58mm / 80mm</div>
            </div>
          </button>

          <button
            onClick={() => setActiveTab("drawer")}
            className={`w-full text-left px-4 py-3 rounded-xl font-semibold text-xs transition-colors flex items-center gap-3 ${
              activeTab === "drawer"
                ? "bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 shadow-sm border border-slate-200 dark:border-emerald-500/30"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            <span className="text-base">💵</span>
            <div>
              <div className="font-bold">Cajón de Dinero</div>
              <div className="text-[10px] opacity-75 font-normal">Apertura por pulso</div>
            </div>
          </button>

          <button
            onClick={() => setActiveTab("scanner")}
            className={`w-full text-left px-4 py-3 rounded-xl font-semibold text-xs transition-colors flex items-center gap-3 ${
              activeTab === "scanner"
                ? "bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 shadow-sm border border-slate-200 dark:border-emerald-500/30"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            <span className="text-base">📟</span>
            <div>
              <div className="font-bold">Lector y Báscula</div>
              <div className="text-[10px] opacity-75 font-normal">Códigos de barra y peso</div>
            </div>
          </button>

          <button
            onClick={() => setActiveTab("terminal")}
            className={`w-full text-left px-4 py-3 rounded-xl font-semibold text-xs transition-colors flex items-center gap-3 ${
              activeTab === "terminal"
                ? "bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 shadow-sm border border-slate-200 dark:border-emerald-500/30"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            <span className="text-base">🏢</span>
            <div>
              <div className="font-bold">Terminal y ERP</div>
              <div className="text-[10px] opacity-75 font-normal">Sincronización M2M</div>
            </div>
          </button>

          <button
            onClick={() => setActiveTab("payments")}
            className={`w-full text-left px-4 py-3 rounded-xl font-semibold text-xs transition-colors flex items-center gap-3 ${
              activeTab === "payments"
                ? "bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 shadow-sm border border-slate-200 dark:border-emerald-500/30"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            <span className="text-base">💳</span>
            <div>
              <div className="font-bold">Medios de Pago</div>
              <div className="text-[10px] opacity-75 font-normal">Habilitar para esta caja</div>
            </div>
          </button>

          <button
            onClick={() => setActiveTab("general")}
            className={`w-full text-left px-4 py-3 rounded-xl font-semibold text-xs transition-colors flex items-center gap-3 ${
              activeTab === "general"
                ? "bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-400 shadow-sm border border-slate-200 dark:border-emerald-500/30"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            <span className="text-base">⚙️</span>
            <div>
              <div className="font-bold">General y Sistema</div>
              <div className="text-[10px] opacity-75 font-normal">Temas y sonidos</div>
            </div>
          </button>
        </aside>

        {/* CONTENIDO DE CONFIGURACIÓN */}
        <main className="flex-1 p-6 overflow-y-auto">
          <div className="max-w-3xl space-y-6">
            {/* TAB: IMPRESORA */}
            {activeTab === "printer" && (
              <div className="space-y-6">
                <div className="border-b border-slate-200 dark:border-slate-800 pb-3">
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                    Configuración de Impresora Térmica
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Ajustes de tickets de venta y protocolos ESC/POS
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                    <div>
                      <div className="text-sm font-bold text-slate-900 dark:text-white">
                        Habilitar Impresión de Tickets
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        Permite imprimir comprobantes tras cada venta
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.printer_enabled === "true"}
                      onChange={(e) => updateField("printer_enabled", String(e.target.checked))}
                      className="w-5 h-5 accent-emerald-600 rounded cursor-pointer"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Tipo de Conexión
                      </label>
                      <select
                        value={settings.printer_type || "system"}
                        onChange={(e) => updateField("printer_type", e.target.value)}
                        className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:border-emerald-500"
                      >
                        <option value="system">Impresora de Windows (Spooler)</option>
                        <option value="network">Red Ethernet / WiFi (IP directa 9100)</option>
                        <option value="serial">Puerto Serial (COM / USB-Serial)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Nombre o Destino de Impresora
                      </label>
                      <input
                        type="text"
                        value={settings.printer_target || ""}
                        onChange={(e) => updateField("printer_target", e.target.value)}
                        placeholder="Ej. POS-58, USB001, 192.168.1.150"
                        className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
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

                    <div className="flex items-center gap-6 pt-5">
                      <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                        <input
                          type="checkbox"
                          checked={settings.printer_auto_cut === "true"}
                          onChange={(e) => updateField("printer_auto_cut", String(e.target.checked))}
                          className="accent-emerald-600 rounded"
                        />
                        <span>Corte Automático</span>
                      </label>

                      <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                        <input
                          type="checkbox"
                          checked={settings.printer_auto_print === "true"}
                          onChange={(e) => updateField("printer_auto_print", String(e.target.checked))}
                          className="accent-emerald-600 rounded"
                        />
                        <span>Imprimir sin preguntar</span>
                      </label>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Encabezado del Ticket
                    </label>
                    <textarea
                      rows={3}
                      value={settings.printer_header_text || ""}
                      onChange={(e) => updateField("printer_header_text", e.target.value)}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl p-3 text-xs font-mono focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Pie de Página del Ticket
                    </label>
                    <textarea
                      rows={2}
                      value={settings.printer_footer_text || ""}
                      onChange={(e) => updateField("printer_footer_text", e.target.value)}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl p-3 text-xs font-mono focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div className="pt-2 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleTestPrint}
                      className="px-4 py-2.5 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold transition-colors"
                    >
                      🖨️ Enviar Ticket de Prueba
                    </button>
                    {testResult && (
                      <span className="text-xs text-slate-500 font-mono">{testResult}</span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* TAB: CAJÓN DE DINERO */}
            {activeTab === "drawer" && (
              <div className="space-y-6">
                <div className="border-b border-slate-200 dark:border-slate-800 pb-3">
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                    Cajón de Dinero (Gaveta)
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Apertura automática mediante pulso eléctrico
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                    <div>
                      <div className="text-sm font-bold text-slate-900 dark:text-white">
                        Habilitar Cajón de Dinero
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        Permite enviar el pulso de apertura al cobrar o manual
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.drawer_enabled === "true"}
                      onChange={(e) => updateField("drawer_enabled", String(e.target.checked))}
                      className="w-5 h-5 accent-emerald-600 rounded cursor-pointer"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Método de Activación
                      </label>
                      <select
                        value={settings.drawer_trigger || "printer_pulse"}
                        onChange={(e) => updateField("drawer_trigger", e.target.value)}
                        className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:border-emerald-500"
                      >
                        <option value="printer_pulse">A través de Impresora (RJ11 ESC/POS)</option>
                        <option value="serial">Puerto Serial Directo (RS232)</option>
                      </select>
                    </div>

                    <div className="flex items-center pt-5">
                      <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                        <input
                          type="checkbox"
                          checked={settings.drawer_open_on_sale === "true"}
                          onChange={(e) => updateField("drawer_open_on_sale", String(e.target.checked))}
                          className="accent-emerald-600 rounded"
                        />
                        <span>Abrir automáticamente en ventas en efectivo</span>
                      </label>
                    </div>
                  </div>

                  <div className="pt-2 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleTestDrawer}
                      className="px-4 py-2.5 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold transition-colors"
                    >
                      💵 Probar Apertura de Cajón
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB: LECTOR Y BÁSCULA */}
            {activeTab === "scanner" && (
              <div className="space-y-6">
                <div className="border-b border-slate-200 dark:border-slate-800 pb-3">
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                    Lector de Código de Barras y Báscula
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Captura automática de productos y peso a granel
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                    <div className="text-sm font-bold text-slate-900 dark:text-white">
                      Pistola Lectora de Códigos
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      El lector opera en modo <strong>Emulación de Teclado (HID)</strong> estándar. No requiere drivers especiales; cualquier pistola USB o inalámbrica con sufijo Enter funcionará de forma inmediata.
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                    <div>
                      <div className="text-sm font-bold text-slate-900 dark:text-white">
                        Habilitar Báscula / Balanza Serial
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        Lee peso en vivo para productos a granel (frutas, verduras, carnes)
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.scale_enabled === "true"}
                      onChange={(e) => updateField("scale_enabled", String(e.target.checked))}
                      className="w-5 h-5 accent-emerald-600 rounded cursor-pointer"
                    />
                  </div>

                  {settings.scale_enabled === "true" && (
                    <div className="grid grid-cols-2 gap-4 p-4 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-xl">
                      <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                          Puerto COM
                        </label>
                        <input
                          type="text"
                          value={settings.scale_port || "COM1"}
                          onChange={(e) => updateField("scale_port", e.target.value)}
                          className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                          Baudios (Baud Rate)
                        </label>
                        <select
                          value={settings.scale_baud_rate || "9600"}
                          onChange={(e) => updateField("scale_baud_rate", e.target.value)}
                          className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:border-emerald-500"
                        >
                          <option value="4800">4800 bps</option>
                          <option value="9600">9600 bps</option>
                          <option value="19200">19200 bps</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB: TERMINAL Y ERP */}
            {activeTab === "terminal" && (
              <div className="space-y-6">
                <div className="border-b border-slate-200 dark:border-slate-800 pb-3">
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                    Terminal POS y Conexión ERP
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Detalles de enlace M2M con Megalider ERP
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                      <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">
                        Código de Caja
                      </div>
                      <div className="text-base font-bold text-slate-900 dark:text-white mt-1">
                        {terminalStatus.cajaCodigo || "CAJA-01"}
                      </div>
                    </div>

                    <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                      <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">
                        Empresa Vinculada
                      </div>
                      <div className="text-base font-bold text-slate-900 dark:text-white mt-1">
                        {terminalStatus.empresaNombre || "Megalider"}
                      </div>
                    </div>
                  </div>

                  <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                    <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">
                      URL del Servidor ERP
                    </div>
                    <div className="text-sm font-mono text-slate-800 dark:text-slate-300 mt-1">
                      {terminalStatus.erpUrl}
                    </div>
                  </div>

                  <div className="pt-2 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await api.auth.syncUsers();
                          showMsg("✅ Usuarios de caja sincronizados desde ERP");
                        } catch (e) {
                          modalAlert({
                            title: "Error de Sincronización",
                            message: "Error sincronizando usuarios: " + String(e),
                            variant: "error",
                          });
                        }
                      }}
                      className="px-4 py-2.5 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold transition-colors cursor-pointer"
                    >
                      🔄 Sincronizar Usuarios y Cajeros
                    </button>

                    <button
                      type="button"
                      onClick={async () => {
                        const ok = await confirm({
                          title: "Desvincular Terminal",
                          message: "¿Está seguro de desvincular esta terminal del ERP? Se requerirá vincularla de nuevo con credenciales o código.",
                          variant: "danger",
                          confirmText: "Sí, Desvincular",
                          cancelText: "Cancelar",
                        });
                        if (ok) {
                          try {
                            await api.auth.unpair();
                            onUnpaired();
                          } catch (e) {
                            modalAlert({
                              title: "Error al Desvincular",
                              message: "Error al desvincular: " + String(e),
                              variant: "error",
                            });
                          }
                        }
                      }}
                      className="px-4 py-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 dark:hover:bg-rose-900 border border-rose-300 dark:border-rose-800/40 text-rose-700 dark:text-rose-200 text-xs font-bold transition-colors cursor-pointer"
                    >
                      ⚠️ Desvincular Terminal
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB: MEDIOS DE PAGO */}
            {activeTab === "payments" && (
              <div className="space-y-6">
                <div className="border-b border-slate-200 dark:border-slate-800 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <span>💳 Medios de Pago en esta Caja</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 font-bold">
                        {paymentMethods.filter((m) => m.terminalEnabled === 1).length} de {paymentMethods.length} activos
                      </span>
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Selecciona qué medios sincronizados desde Megalider ERP estarán habilitados para cobrar en esta terminal.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleSyncPaymentMethods}
                    disabled={syncingMethods}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-md shadow-emerald-700/20 cursor-pointer flex items-center gap-2 disabled:opacity-50"
                  >
                    <span>{syncingMethods ? "⏳ Sincronizando…" : "🔄 Sincronizar desde ERP"}</span>
                  </button>
                </div>

                {loadingMethods ? (
                  <div className="p-8 text-center text-slate-500 text-sm">
                    Cargando catálogo de medios de pago…
                  </div>
                ) : paymentMethods.length === 0 ? (
                  <div className="p-8 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl space-y-3">
                    <span className="text-3xl">📭</span>
                    <div className="text-sm font-bold text-slate-800 dark:text-slate-200">
                      No hay medios de pago sincronizados
                    </div>
                    <p className="text-xs text-slate-500 max-w-md mx-auto">
                      Presiona el botón "Sincronizar desde ERP" para descargar los métodos de pago y cuentas PUC configurados en Megalider.
                    </p>
                    <button
                      type="button"
                      onClick={handleSyncPaymentMethods}
                      disabled={syncingMethods}
                      className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold"
                    >
                      Descargar Medios de Pago Ahora
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {paymentMethods.map((pm) => {
                      const isEnabled = pm.terminalEnabled === 1;
                      const getIcon = () => {
                        const t = (pm.type || "").toUpperCase();
                        const c = (pm.code || "").toLowerCase();
                        if (t === "EFECTIVO" || c.includes("cash") || c.includes("efectivo")) return "💵";
                        if (t === "TARJETA" || c.includes("card") || c.includes("tarjeta")) return "💳";
                        if (c.includes("nequi") || c.includes("daviplata") || t === "DIGITAL") return "📱";
                        if (t === "BANCO" || c.includes("transfer")) return "🏦";
                        return "🏷️";
                      };

                      return (
                        <div
                          key={pm.id}
                          className={`p-4 bg-white dark:bg-slate-900 border rounded-xl flex items-center justify-between gap-4 transition-all ${
                            isEnabled
                              ? "border-emerald-300 dark:border-emerald-500/40 shadow-sm"
                              : "border-slate-200 dark:border-slate-800 opacity-60 bg-slate-50/50 dark:bg-slate-900/40"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-2xl p-2 bg-slate-100 dark:bg-slate-800 rounded-xl">
                              {getIcon()}
                            </span>
                            <div>
                              <div className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                <span>{pm.name}</span>
                                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                  {pm.type}
                                </span>
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
                                  Código: {pm.erpCode}
                                </span>
                              </div>
                              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-2">
                                <span className="font-semibold text-slate-600 dark:text-slate-300">
                                  Cuenta Contable (PUC NIIF):
                                </span>
                                {pm.pucCode ? (
                                  <span className="font-mono bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded text-[11px] font-bold">
                                    {pm.pucCode} - {pm.pucAccountName || "Activo Circulante"}
                                  </span>
                                ) : (
                                  <span className="text-amber-600 dark:text-amber-400 font-mono text-[11px]">
                                    (Sin cuenta asignada en ERP)
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => handleToggleMethod(pm.id, pm.terminalEnabled)}
                              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shadow-sm ${
                                isEnabled
                                  ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-700/20"
                                  : "bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700"
                              }`}
                            >
                              <span>{isEnabled ? "✅ Habilitado" : "⚪ Deshabilitado"}</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="flex items-center gap-2 p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-500 dark:text-slate-400">
                  <span className="text-emerald-500 font-bold">⚡ Guardado Automático:</span>
                  <span>Cualquier medio de pago que habilites o deshabilites se guarda de forma instantánea en esta caja.</span>
                </div>
              </div>
            )}

            {/* TAB: GENERAL */}
            {activeTab === "general" && (
              <div className="space-y-6">
                <div className="border-b border-slate-200 dark:border-slate-800 pb-3">
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                    Ajustes Generales
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Preferencias de interfaz y comportamiento
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                    <div>
                      <div className="text-sm font-bold text-slate-900 dark:text-white">
                        Tema Visual Activo
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {theme === "dark" ? "Modo Oscuro (Megalider Pro)" : "Modo Claro (Eleventa Modern)"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={toggleTheme}
                      className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold"
                    >
                      {theme === "dark" ? "☀️ Cambiar a Claro" : "🌙 Cambiar a Oscuro"}
                    </button>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                    <div>
                      <div className="text-sm font-bold text-slate-900 dark:text-white">
                        Sonidos de Confirmación
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        Emitir bip al escanear código de barras o cobrar
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.scanner_sound === "true"}
                      onChange={(e) => updateField("scanner_sound", String(e.target.checked))}
                      className="w-5 h-5 accent-emerald-600 rounded cursor-pointer"
                    />
                  </div>

                  <div className="flex items-center justify-between p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
                    <div>
                      <div className="text-sm font-bold text-slate-900 dark:text-white">
                        Permitir Venta sin Existencias (Stock Negativo)
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        Permite registrar ventas incluso si el inventario local está en 0
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.allow_negative_stock === "true"}
                      onChange={(e) => updateField("allow_negative_stock", String(e.target.checked))}
                      className="w-5 h-5 accent-emerald-600 rounded cursor-pointer"
                    />
                  </div>

                  {/* ACTUALIZACIONES AUTOMÁTICAS (TAURI UPDATER) */}
                  <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                          <span>🔄 Actualizaciones del Sistema</span>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                            GitHub Releases
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          El sistema comprueba y descarga actualizaciones silenciosamente en segundo plano.
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {updater.status === "ready" ? (
                          <button
                            type="button"
                            onClick={() => updater.restartAndApply()}
                            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 shadow-md shadow-emerald-700/20"
                          >
                            <span>🚀 Reiniciar a v{updater.newVersion}</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => updater.checkForUpdates(true)}
                            disabled={updater.status === "checking" || updater.status === "downloading"}
                            className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-800 dark:text-slate-200 transition-colors cursor-pointer disabled:opacity-50"
                          >
                            {updater.status === "checking"
                              ? "⏳ Comprobando…"
                              : updater.status === "downloading"
                              ? `⏳ Descargando (${updater.progressPercent}%)…`
                              : "🔍 Buscar Actualizaciones Ahora"}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Barra de progreso si está descargando */}
                    {updater.status === "downloading" && (
                      <div className="space-y-1 pt-1">
                        <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400">
                          <span>Descargando actualización en segundo plano…</span>
                          <span className="font-mono">{updater.progressPercent}%</span>
                        </div>
                        <div className="w-full bg-slate-200 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                          <div
                            className="bg-emerald-500 h-full transition-all duration-300"
                            style={{ width: `${updater.progressPercent}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {updater.status === "up-to-date" && (
                      <div className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                        ✅ El sistema se encuentra actualizado a la última versión disponible.
                      </div>
                    )}

                    {updater.status === "error" && updater.errorMsg && (
                      <div className="text-xs text-rose-500 font-medium">
                        ⚠️ Error al buscar actualización: {updater.errorMsg}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* BOTÓN GUARDAR CAMBIOS (Oculto en medios de pago porque se guardan en tiempo real) */}
            {activeTab !== "payments" && (
              <div className="pt-6 border-t border-slate-200 dark:border-slate-800 flex justify-end">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="px-8 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-emerald-700/20 dark:shadow-emerald-950/40 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {saving ? "Guardando…" : "💾 Guardar Configuraciones"}
                </button>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
