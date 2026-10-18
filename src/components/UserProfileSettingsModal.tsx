import { useState, useEffect, useRef } from "react";
import { ModalRoot } from "./ui/modal/ModalRoot";
import { ModalHeader } from "./ui/modal/ModalHeader";
import { ModalBody } from "./ui/modal/ModalBody";
import { ModalFooter } from "./ui/modal/ModalFooter";
import { api } from "../services/api";
import { hasPermission } from "../lib/permissions";
import type { CashierUser } from "../types";

interface UserProfileSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeCashier: CashierUser;
  onLockTerminal?: () => void;
  onNavigateToSettings?: () => void;
  showProductImages?: boolean;
  onToggleProductImages?: () => void;
  onPinChanged?: () => void;
}

type TabType = "pin" | "preferences" | "profile";

export function UserProfileSettingsModal({
  isOpen,
  onClose,
  activeCashier,
  onLockTerminal,
  onNavigateToSettings,
  showProductImages = true,
  onToggleProductImages,
  onPinChanged,
}: UserProfileSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>("pin");

  // Estado Formulario PIN
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinLoading, setPinLoading] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSuccess, setPinSuccess] = useState<string | null>(null);
  const [activePinField, setActivePinField] = useState<"current" | "new" | "confirm">("current");

  // Estado Preferencias de Estación
  const [scanSoundEnabled, setScanSoundEnabled] = useState<boolean>(() => {
    return localStorage.getItem("pos_scan_sound_enabled") !== "false";
  });
  const [autoLockMinutes, setAutoLockMinutes] = useState<number>(() => {
    const val = localStorage.getItem("pos_auto_lock_minutes");
    return val ? Number(val) : 0; // 0 = desactivado
  });
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    return document.documentElement.classList.contains("dark");
  });

  const currentPinRef = useRef<HTMLInputElement>(null);

  // Reset al abrir el modal
  useEffect(() => {
    if (isOpen) {
      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
      setPinError(null);
      setPinSuccess(null);
      setPinLoading(false);
      setActiveTab("pin");
      setActivePinField("current");
      setTimeout(() => {
        currentPinRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // Manejador del cambio de PIN
  const handleChangePin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setPinError(null);
    setPinSuccess(null);

    const cleanCurrent = currentPin.trim();
    const cleanNew = newPin.trim();
    const cleanConfirm = confirmPin.trim();

    if (!cleanCurrent || cleanCurrent.length < 4) {
      setPinError("Ingresa tu PIN actual (4 a 6 dígitos)");
      return;
    }

    if (!cleanNew || cleanNew.length < 4 || cleanNew.length > 6) {
      setPinError("El nuevo PIN debe tener entre 4 y 6 dígitos numéricos");
      return;
    }

    if (cleanNew !== cleanConfirm) {
      setPinError("El nuevo PIN y su confirmación no coinciden");
      return;
    }

    if (cleanCurrent === cleanNew) {
      setPinError("El nuevo PIN debe ser diferente al PIN actual");
      return;
    }

    setPinLoading(true);

    try {
      await api.auth.changePin(activeCashier.id, cleanCurrent, cleanNew);
      setPinSuccess("¡PIN actualizado con éxito! Se sincronizará en todos tus turnos.");
      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
      if (onPinChanged) {
        onPinChanged();
      }
    } catch (err: unknown) {
      setPinError(String(err));
    } finally {
      setPinLoading(false);
    }
  };

  const handleKeypadPress = (digit: string) => {
    if (activePinField === "current") {
      if (currentPin.length < 6) setCurrentPin((p) => p + digit);
    } else if (activePinField === "new") {
      if (newPin.length < 6) setNewPin((p) => p + digit);
    } else if (activePinField === "confirm") {
      if (confirmPin.length < 6) setConfirmPin((p) => p + digit);
    }
  };

  const handleKeypadBackspace = () => {
    if (activePinField === "current") setCurrentPin((p) => p.slice(0, -1));
    else if (activePinField === "new") setNewPin((p) => p.slice(0, -1));
    else if (activePinField === "confirm") setConfirmPin((p) => p.slice(0, -1));
  };

  const handleKeypadClear = () => {
    if (activePinField === "current") setCurrentPin("");
    else if (activePinField === "new") setNewPin("");
    else if (activePinField === "confirm") setConfirmPin("");
  };

  // Alternar tema claro / oscuro
  const toggleTheme = () => {
    const isDark = document.documentElement.classList.contains("dark");
    if (isDark) {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("pos_theme", "light");
      setIsDarkMode(false);
    } else {
      document.documentElement.classList.add("dark");
      localStorage.setItem("pos_theme", "dark");
      setIsDarkMode(true);
    }
  };

  // Guardar preferencia de sonido
  const handleToggleSound = () => {
    const next = !scanSoundEnabled;
    setScanSoundEnabled(next);
    localStorage.setItem("pos_scan_sound_enabled", String(next));

    // Si lo activa, reproducir sonido de prueba breve (Web Audio API)
    if (next) {
      try {
        const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.setValueAtTime(880, audioCtx.currentTime); // 880 Hz
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.08);
      } catch {
        // Ignorar si el navegador bloquea audio sin interacción previa
      }
    }
  };

  // Guardar auto-bloqueo
  const handleAutoLockChange = (mins: number) => {
    setAutoLockMinutes(mins);
    localStorage.setItem("pos_auto_lock_minutes", String(mins));
  };

  return (
    <ModalRoot isOpen={isOpen} onClose={onClose} maxWidth="lg">
      <ModalHeader
        title="Mi Perfil y Preferencias de Estación"
        subtitle={`Operador: ${activeCashier.fullName} (${activeCashier.profileName || activeCashier.role})`}
        icon="⚙️"
        onClose={onClose}
      />

      {/* Pestañas Superiores */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-900/50 px-6 pt-2 gap-2 text-xs font-semibold">
        <button
          type="button"
          onClick={() => setActiveTab("pin")}
          className={`pb-3 px-3.5 border-b-2 font-bold transition-colors flex items-center gap-1.5 cursor-pointer ${
            activeTab === "pin"
              ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
              : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <span>🔐</span>
          <span>Seguridad & PIN</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("preferences")}
          className={`pb-3 px-3.5 border-b-2 font-bold transition-colors flex items-center gap-1.5 cursor-pointer ${
            activeTab === "preferences"
              ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
              : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <span>🎛️</span>
          <span>Preferencias de Caja</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("profile")}
          className={`pb-3 px-3.5 border-b-2 font-bold transition-colors flex items-center gap-1.5 cursor-pointer ${
            activeTab === "profile"
              ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
              : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          <span>👤</span>
          <span>Mi Turno & Permisos</span>
        </button>
      </div>

      <ModalBody className="p-6">
        {/* PESTAÑA 1: CAMBIO DE PIN */}
        {activeTab === "pin" && (
          <div className="space-y-4">
            <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 rounded-xl p-3 flex items-start gap-3">
              <span className="text-xl">🛡️</span>
              <div className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                El PIN es personal e intransferible. Para modificarlo debes confirmar tu <strong>PIN actual</strong>. El nuevo PIN debe tener entre <strong>4 y 6 dígitos numéricos</strong>.
              </div>
            </div>

            {pinError && (
              <div className="bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 rounded-xl p-3 text-xs text-rose-800 dark:text-rose-200 font-medium animate-in fade-in duration-150">
                {pinError}
              </div>
            )}

            {pinSuccess && (
              <div className="bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3 text-xs text-emerald-800 dark:text-emerald-200 font-medium animate-in fade-in duration-150">
                {pinSuccess}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
              {/* Formulario de Inputs */}
              <form onSubmit={handleChangePin} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    PIN Actual:
                  </label>
                  <input
                    ref={currentPinRef}
                    type="password"
                    maxLength={6}
                    value={currentPin}
                    onFocus={() => setActivePinField("current")}
                    onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ""))}
                    placeholder="••••••"
                    disabled={pinLoading}
                    className={`w-full bg-white dark:bg-slate-800 border rounded-xl px-3.5 py-2 text-center text-base font-mono font-bold tracking-widest text-slate-900 dark:text-white outline-none transition-all ${
                      activePinField === "current"
                        ? "border-emerald-500 ring-2 ring-emerald-500/20"
                        : "border-slate-300 dark:border-slate-700"
                    }`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Nuevo PIN (4-6 dígitos):
                  </label>
                  <input
                    type="password"
                    maxLength={6}
                    value={newPin}
                    onFocus={() => setActivePinField("new")}
                    onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
                    placeholder="••••••"
                    disabled={pinLoading}
                    className={`w-full bg-white dark:bg-slate-800 border rounded-xl px-3.5 py-2 text-center text-base font-mono font-bold tracking-widest text-slate-900 dark:text-white outline-none transition-all ${
                      activePinField === "new"
                        ? "border-emerald-500 ring-2 ring-emerald-500/20"
                        : "border-slate-300 dark:border-slate-700"
                    }`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Confirmar Nuevo PIN:
                  </label>
                  <input
                    type="password"
                    maxLength={6}
                    value={confirmPin}
                    onFocus={() => setActivePinField("confirm")}
                    onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
                    placeholder="••••••"
                    disabled={pinLoading}
                    className={`w-full bg-white dark:bg-slate-800 border rounded-xl px-3.5 py-2 text-center text-base font-mono font-bold tracking-widest text-slate-900 dark:text-white outline-none transition-all ${
                      activePinField === "confirm"
                        ? "border-emerald-500 ring-2 ring-emerald-500/20"
                        : "border-slate-300 dark:border-slate-700"
                    }`}
                  />
                  {newPin && confirmPin && (
                    <div className="mt-1 text-[11px] font-medium">
                      {newPin === confirmPin ? (
                        <span className="text-emerald-600 dark:text-emerald-400">✓ Los PIN coinciden</span>
                      ) : (
                        <span className="text-rose-600 dark:text-rose-400">✗ Los PIN no coinciden</span>
                      )}
                    </div>
                  )}
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={pinLoading || currentPin.length < 4 || newPin.length < 4 || newPin !== confirmPin}
                    className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {pinLoading ? "Actualizando PIN…" : "Guardar Nuevo PIN"}
                  </button>
                </div>
              </form>

              {/* Botonera Numérica Táctil */}
              <div className="bg-slate-50 dark:bg-slate-800/30 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800">
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider text-center mb-2.5">
                  Teclado Numérico en Pantalla
                </div>
                <div className="grid grid-cols-3 gap-1.5 max-w-[220px] mx-auto">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => handleKeypadPress(n)}
                      className="py-2.5 rounded-xl bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-white font-mono font-bold text-base transition-colors active:scale-95 cursor-pointer shadow-2xs"
                    >
                      {n}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={handleKeypadClear}
                    className="py-2.5 rounded-xl bg-slate-200/60 hover:bg-slate-200 dark:bg-slate-700/60 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 font-mono font-bold text-sm transition-colors active:scale-95 cursor-pointer"
                  >
                    C
                  </button>
                  <button
                    type="button"
                    onClick={() => handleKeypadPress("0")}
                    className="py-2.5 rounded-xl bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-white font-mono font-bold text-base transition-colors active:scale-95 cursor-pointer shadow-2xs"
                  >
                    0
                  </button>
                  <button
                    type="button"
                    onClick={handleKeypadBackspace}
                    className="py-2.5 rounded-xl bg-slate-200/60 hover:bg-slate-200 dark:bg-slate-700/60 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 font-mono font-bold text-sm transition-colors active:scale-95 cursor-pointer"
                  >
                    ⌫
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* PESTAÑA 2: PREFERENCIAS DE CAJA */}
        {activeTab === "preferences" && (
          <div className="space-y-4">
            <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-slate-800/40">
              {/* Tema Visual */}
              <div className="p-4 flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-bold text-slate-900 dark:text-white">
                    Modo Oscuro / Claro
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Ajusta la paleta de colores para operar cómodamente con poca o alta iluminación.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={toggleTheme}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <span>{isDarkMode ? "🌙 Oscuro" : "☀️ Claro"}</span>
                  <span className="text-slate-400 text-[10px]">(Cambiar)</span>
                </button>
              </div>

              {/* Mostrar Fotos en Ticket de Ventas */}
              <div className="p-4 flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-bold text-slate-900 dark:text-white">
                    Mostrar Fotos de Productos en Tabla de Ventas
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Permite ver las imágenes medianas de los productos escaneados en el ticket activo.
                  </div>
                </div>
                {onToggleProductImages && (
                  <button
                    type="button"
                    onClick={onToggleProductImages}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
                      showProductImages ? "bg-emerald-600" : "bg-slate-300 dark:bg-slate-700"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        showProductImages ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                )}
              </div>

              {/* Sonido de Escáner */}
              <div className="p-4 flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-bold text-slate-900 dark:text-white">
                    Bip Audible al Escanear Producto
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Emite un breve sonido de confirmación por los altavoces de la terminal al registrar un ítem.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleToggleSound}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
                    scanSoundEnabled ? "bg-emerald-600" : "bg-slate-300 dark:bg-slate-700"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      scanSoundEnabled ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              {/* Auto-Bloqueo por Inactividad */}
              <div className="p-4 flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-bold text-slate-900 dark:text-white">
                    Bloqueo Automático por Inactividad
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Bloquea la pantalla solicitando el PIN si la caja permanece sin uso durante este tiempo.
                  </div>
                </div>
                <select
                  value={autoLockMinutes}
                  onChange={(e) => handleAutoLockChange(Number(e.target.value))}
                  className="bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200 outline-none cursor-pointer font-semibold"
                >
                  <option value={0}>Desactivado</option>
                  <option value={1}>1 minuto</option>
                  <option value={3}>3 minutos</option>
                  <option value={5}>5 minutos</option>
                  <option value={10}>10 minutos</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* PESTAÑA 3: MI SESIÓN Y PERMISOS */}
        {activeTab === "profile" && (
          <div className="space-y-4">
            <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 rounded-2xl p-4 flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800/60 flex items-center justify-center text-2xl font-bold text-emerald-700 dark:text-emerald-400">
                {activeCashier.fullName.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1">
                <div className="text-base font-bold text-slate-900 dark:text-white">
                  {activeCashier.fullName}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {activeCashier.username}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 font-mono">
                    {activeCashier.profileName || activeCashier.role}
                  </span>
                  {activeCashier.erpRoleCode && (
                    <span className="text-[10px] text-slate-400 font-mono">
                      ERP: {activeCashier.erpRoleCode}
                    </span>
                  )}
                </div>
              </div>

              {onLockTerminal && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onLockTerminal();
                  }}
                  className="px-3.5 py-2 rounded-xl bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-white text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 shadow-2xs"
                  title="Bloquear pantalla de venta ahora"
                >
                  <span>🔒</span>
                  <span>Bloquear Caja</span>
                </button>
              )}
            </div>

            {/* Acceso a Configuración para Administradores */}
            {onNavigateToSettings && hasPermission(activeCashier, "pos:configuracion") && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onNavigateToSettings();
                }}
                className="w-full flex items-center justify-between p-3 rounded-xl bg-emerald-50/70 hover:bg-emerald-100/80 dark:bg-emerald-950/30 dark:hover:bg-emerald-950/60 border border-emerald-300/80 dark:border-emerald-700/60 text-slate-900 dark:text-emerald-100 transition-all cursor-pointer group shadow-2xs"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold text-base">
                    ⚙️
                  </div>
                  <div className="text-left">
                    <div className="text-xs font-bold text-slate-900 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                      Abrir Configuración del Sistema
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Impresoras, hardware, periféricos y enlace ERP
                    </div>
                  </div>
                </div>
                <span className="text-xs bg-emerald-200/80 dark:bg-emerald-900/60 text-emerald-900 dark:text-emerald-300 font-mono px-2 py-0.5 rounded-md font-bold">
                  F7
                </span>
              </button>
            )}

            {/* Lista de Permisos Efectivos */}
            <div>
              <div className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2 flex items-center justify-between">
                <span>Mis Permisos Operativos:</span>
                <span className="text-[11px] text-slate-400 font-mono">
                  {activeCashier.permissions.includes("*")
                    ? "Control Maestro Total (*)"
                    : `${activeCashier.permissions.length} permisos activos`}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-[160px] overflow-y-auto p-2.5 bg-white dark:bg-slate-800/30 border border-slate-200 dark:border-slate-800 rounded-xl">
                {activeCashier.permissions.includes("*") ? (
                  <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                    ⚡ Superadministrador / Pase Maestro (*)
                  </span>
                ) : activeCashier.permissions.length === 0 ? (
                  <span className="text-xs text-slate-400 italic">
                    Sin permisos específicos registrados
                  </span>
                ) : (
                  activeCashier.permissions.map((perm) => (
                    <span
                      key={perm}
                      className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                    >
                      {perm}
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold transition-colors cursor-pointer"
        >
          Cerrar (Esc)
        </button>
      </ModalFooter>
    </ModalRoot>
  );
}
