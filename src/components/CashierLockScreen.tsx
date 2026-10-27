import { useEffect, useState, useCallback } from "react";
import { api } from "../services/api";
import type { CashierUser, TerminalStatus } from "../types";
import { SupportAccessModal } from "./SupportAccessModal";
import { CloseShiftModal } from "./CloseShiftModal";
import { ForgotPinModal } from "./ForgotPinModal";
import { useModals } from "../contexts/ModalContext";
import { useTheme } from "../contexts/ThemeContext";
import { useUpdater } from "../contexts/UpdaterContext";

interface CashierLockScreenProps {
  status: TerminalStatus;
  onUnlocked: (cashier: CashierUser) => void;
  onUnpaired?: () => void;
}

// Helper puro para identificar cuentas con rol de soporte técnico (SUPERADMINSAAS)
export const isSuperAdminUser = (c: CashierUser) => {
  const roleUpper = (c.role || "").toUpperCase();
  const erpRoleUpper = (c.erpRoleCode || "").toUpperCase();
  const profileUpper = (c.profileName || "").toUpperCase();
  const usernameUpper = (c.username || "").toUpperCase();
  return (
    erpRoleUpper === "SUPERADMINSAAS" ||
    roleUpper === "SUPERADMINSAAS" ||
    roleUpper === "SUPERADMIN" ||
    profileUpper.includes("SUPERADMIN") ||
    profileUpper.includes("SOPORTE") ||
    usernameUpper.includes("SOPORTE")
  );
};

// Helper puro para validar si un usuario es un cajero/operador legítimo de la empresa vinculada
export const isCompanyCashier = (c: CashierUser) => {
  const roleUpper = (c.role || "").toUpperCase();
  const profileUpper = (c.profileName || "").toUpperCase();
  const isLegacySeedAdmin = !c.erpUserId && (c.username === "admin" || c.fullName === "Administrador");

  return (
    !isLegacySeedAdmin &&
    Boolean(c.erpUserId) &&
    !isSuperAdminUser(c) &&
    roleUpper !== "CLIENTE" &&
    roleUpper !== "CUSTOMER" &&
    !profileUpper.includes("CLIENTE")
  );
};

export function CashierLockScreen({
  status,
  onUnlocked,
  onUnpaired,
}: CashierLockScreenProps) {
  const { theme, toggleTheme } = useTheme();
  const { confirm, alert: modalAlert } = useModals();
  const {
    currentVersion,
    status: updateStatus,
    newVersion,
    checkForUpdates,
    restartAndApply,
  } = useUpdater();
  const [cashiers, setCashiers] = useState<CashierUser[]>([]);
  const [selectedCashier, setSelectedCashier] = useState<CashierUser | null>(null);
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [showForgotPinModal, setShowForgotPinModal] = useState(false);
  const [showCloseShiftModal, setShowCloseShiftModal] = useState(false);
  const [pendingActionAfterCloseShift, setPendingActionAfterCloseShift] = useState<"shutdown" | "disconnect" | null>(null);
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncSuccessMsg, setSyncSuccessMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargarCajeros = useCallback(async () => {
    try {
      // 1. Carga inmediata desde base local para latencia cero (<5ms)
      const list = await api.auth.listCashiers();
      setCashiers(list);
      const regular = list.filter(isCompanyCashier);
      if (regular.length === 1) {
        setSelectedCashier((curr) => curr ?? regular[0]);
      }

      // 2. Refresco automático en segundo plano desde el ERP (si hay red)
      api.auth
        .syncUsers()
        .then((freshList) => {
          setCashiers(freshList);
          const freshRegular = freshList.filter(isCompanyCashier);
          if (freshRegular.length === 1) {
            setSelectedCashier((curr) => curr ?? freshRegular[0]);
          }
        })
        .catch(() => {
          // Modo Offline-First: opera transparentemente con la lista local
        });
    } catch (e) {
      console.error("Error al listar cajeros locales:", e);
    }
  }, []);

  useEffect(() => {
    cargarCajeros();

    // Auto-refresco en segundo plano periódico (cada 8s) y al volver a enfocar la ventana
    const interval = setInterval(() => {
      if (!pin) {
        cargarCajeros();
      }
    }, 8000);

    const onFocus = () => {
      if (!pin) {
        cargarCajeros();
      }
    };
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [cargarCajeros, pin]);

  const handleSelectCashier = (cashier: CashierUser) => {
    setSelectedCashier(cashier);
    setPin("");
    setError(null);
  };

  const handleBackToSelect = () => {
    setSelectedCashier(null);
    setPin("");
    setError(null);
  };

  // Obtener mapa de frecuencias de login en esta terminal local
  const getFrequencyMap = (): Record<number, number> => {
    try {
      const raw = localStorage.getItem("pos_cashier_frequency");
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  };

  const recordLoginFrequency = (userId: number) => {
    try {
      const freq = getFrequencyMap();
      freq[userId] = (freq[userId] || 0) + 1;
      localStorage.setItem("pos_cashier_frequency", JSON.stringify(freq));
    } catch (e) {
      console.warn("No se pudo registrar frecuencia:", e);
    }
  };

  // Filtrar exclusivamente cajeros legítimos de la empresa vinculada
  const regularCashiers = cashiers.filter(isCompanyCashier);

  const frequencyMap = getFrequencyMap();
  const sortedCashiers = [...regularCashiers].sort((a, b) => {
    const freqA = frequencyMap[a.id] || 0;
    const freqB = frequencyMap[b.id] || 0;
    return freqB - freqA;
  });

  // Los cajeros operativos más frecuentes se muestran con tarjetas y figuras de avatar (hasta 3)
  const frequentCashiers = sortedCashiers.slice(0, Math.min(3, sortedCashiers.length));

  const handlePinSubmit = useCallback(
    async (pinToTest: string) => {
      if (!selectedCashier) return;
      if (!pinToTest || pinToTest.length < 4) return;
      setLoading(true);
      setError(null);
      try {
        const cashier = await api.auth.loginUserPin(selectedCashier.id, pinToTest);
        recordLoginFrequency(cashier.id);
        onUnlocked(cashier);
      } catch (err: unknown) {
        setError(String(err));
        setPin("");
      } finally {
        setLoading(false);
      }
    },
    [selectedCashier, onUnlocked]
  );

  const handleKeyPress = useCallback((digit: string) => {
    setPin((prev) => {
      if (prev.length >= 6) return prev;
      return prev + digit;
    });
  }, []);

  const handleBackspace = useCallback(() => {
    setPin((prev) => prev.slice(0, -1));
  }, []);

  const handleClear = useCallback(() => {
    setPin("");
    setError(null);
  }, []);

  // Soporte de teclado físico
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (showSupportModal) {
        if (e.key === "Escape") {
          setShowSupportModal(false);
        }
        return;
      }

      if (!selectedCashier) {
        // En vista de selección: Teclas numéricas 1..3 seleccionan los cajeros más frecuentes
        const num = parseInt(e.key, 10);
        if (!isNaN(num) && num >= 1 && num <= frequentCashiers.length) {
          handleSelectCashier(frequentCashiers[num - 1]);
        }
      } else {
        // En vista de PIN: 0-9 para PIN, Backspace para borrar, Enter para verificar, Esc para volver
        if (e.key >= "0" && e.key <= "9") {
          handleKeyPress(e.key);
        } else if (e.key === "Backspace") {
          handleBackspace();
        } else if (e.key === "Enter") {
          handlePinSubmit(pin);
        } else if (e.key === "Escape") {
          handleBackToSelect();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedCashier, frequentCashiers, pin, showSupportModal, handleKeyPress, handleBackspace, handlePinSubmit]);

  const handleSyncUsers = async () => {
    setSyncing(true);
    setError(null);
    setSyncSuccessMsg(null);
    try {
      const updated = await api.auth.syncUsers();
      setCashiers(updated);
      const regular = updated.filter(isCompanyCashier);
      if (regular.length === 1) {
        setSelectedCashier((curr) => curr ?? regular[0]);
      }
      setSyncSuccessMsg(
        `✓ Sincronización exitosa: ${regular.length} operador(es) de caja disponible(s)`
      );
      setTimeout(() => setSyncSuccessMsg(null), 4000);
    } catch (err: unknown) {
      setError(`Error al sincronizar usuarios con ERP: ${err}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnectTerminal = async () => {
    try {
      const activeShift = await api.shifts.getActiveShift().catch(() => null);
      if (activeShift) {
        const doClose = await confirm({
          title: "⛔ Turno Activo: Cierre Obligatorio",
          message: `La caja tiene un turno abierto (${activeShift.folio} de ${activeShift.userName || "Cajero"}). No se puede desconectar o cambiar la estación con ventas en custodia sin realizar el arqueo.`,
          confirmText: "Hacer Arqueo y Desconectar",
          cancelText: "Cancelar",
          variant: "warning",
        });
        if (doClose) {
          setPendingActionAfterCloseShift("disconnect");
          setShowCloseShiftModal(true);
        }
        return;
      }

      const ok = await confirm({
        title: "¿Desconectar esta Caja?",
        message:
          "La terminal se desvinculará de la estación actual. Podrás volver a vincularla o reconectarte cuando lo requieras.",
        confirmText: "Sí, desconectar",
        cancelText: "Cancelar",
        variant: "warning",
      });
      if (!ok) return;

      await api.auth.disconnectTemporarily();
      if (onUnpaired) {
        onUnpaired();
      }
    } catch (err) {
      modalAlert({
        title: "Error al desconectar",
        message: String(err),
        variant: "error",
      });
    }
  };

  const handleCloseApp = async () => {
    try {
      const activeShift = await api.shifts.getActiveShift().catch(() => null);
      if (activeShift) {
        const doClose = await confirm({
          title: "⚠️ Turno de Caja Abierto",
          message: `El turno ${activeShift.folio} (${activeShift.userName || "Cajero"}) sigue activo con dinero en custodia. Se debe realizar el arqueo y cierre antes de apagar la estación para emitir el reporte Z.`,
          confirmText: "Hacer Arqueo y Apagar",
          cancelText: "Suspender y Salir",
          variant: "warning",
        });

        if (doClose) {
          setPendingActionAfterCloseShift("shutdown");
          setShowCloseShiftModal(true);
          return;
        }

        const forceExit = await confirm({
          title: "¿Salir sin Arqueo (Solo Emergencias)?",
          message:
            "El turno continuará abierto en el sistema y se reanudará intacto al encender nuevamente el POS. ¿Deseas apagar ahora?",
          confirmText: "Sí, apagar sin arqueo",
          cancelText: "Volver a la caja",
          variant: "danger",
        });
        if (forceExit) {
          await api.system.closeApp(true);
        }
        return;
      }

      const ok = await confirm({
        title: "¿Apagar o Salir del POS?",
        message: "¿Deseas cerrar la aplicación de Punto de Venta?",
        confirmText: "Apagar Caja",
        cancelText: "Continuar en POS",
        variant: "danger",
      });
      if (!ok) return;

      await api.system.closeApp(false);
    } catch (err) {
      console.error("Error al cerrar app:", err);
    }
  };

  interface RoleTheme {
    category: "support" | "admin" | "accountant" | "manager" | "cashier" | "staff";
    color: string;
    bg: string;
    border: string;
    label: string;
  }

  const getRoleTheme = (c: CashierUser): RoleTheme => {
    const role = (c.role || "").toLowerCase();
    const erpRole = (c.erpRoleCode || "").toLowerCase();
    const profile = (c.profileName || "").toLowerCase();
    const isDark = theme === "dark";

    if (
      erpRole === "superadminsaas" ||
      role === "superadminsaas" ||
      role === "superadmin" ||
      profile.includes("soporte")
    ) {
      return {
        category: "support",
        color: isDark ? "#38bdf8" : "#0284c7",
        bg: isDark ? "rgba(56, 189, 248, 0.14)" : "#f0f9ff",
        border: isDark ? "rgba(56, 189, 248, 0.4)" : "#bae6fd",
        label: "Soporte",
      };
    }

    if (
      erpRole === "admin_empresa" ||
      role === "admin" ||
      role === "admin_empresa" ||
      profile.includes("admin")
    ) {
      return {
        category: "admin",
        color: isDark ? "#f59e0b" : "#b45309",
        bg: isDark ? "rgba(245, 158, 11, 0.14)" : "#fffbeb",
        border: isDark ? "rgba(245, 158, 11, 0.4)" : "#fde68a",
        label: c.profileName?.trim() || "Administrador",
      };
    }

    if (
      profile.includes("contad") ||
      profile.includes("fiscal") ||
      profile.includes("auditor") ||
      role.includes("contad")
    ) {
      return {
        category: "accountant",
        color: isDark ? "#10b981" : "#047857",
        bg: isDark ? "rgba(16, 185, 129, 0.14)" : "#ecfdf5",
        border: isDark ? "rgba(16, 185, 129, 0.4)" : "#a7f3d0",
        label: c.profileName?.trim() || "Contador",
      };
    }

    if (
      role === "manager" ||
      profile.includes("gerent") ||
      profile.includes("supervis") ||
      profile.includes("encargad")
    ) {
      return {
        category: "manager",
        color: isDark ? "#8b5cf6" : "#6d28d9",
        bg: isDark ? "rgba(139, 92, 246, 0.14)" : "#f5f3ff",
        border: isDark ? "rgba(139, 92, 246, 0.4)" : "#ddd6fe",
        label: c.profileName?.trim() || "Supervisor",
      };
    }

    if (
      profile.includes("cajer") ||
      profile.includes("vendedor") ||
      profile.includes("pos") ||
      role === "cashier"
    ) {
      return {
        category: "cashier",
        color: isDark ? "#0ea5e9" : "#0369a1",
        bg: isDark ? "rgba(14, 165, 233, 0.14)" : "#f0f9ff",
        border: isDark ? "rgba(14, 165, 233, 0.4)" : "#bae6fd",
        label: c.profileName?.trim() || "Cajero / Ventas",
      };
    }

    return {
      category: "staff",
      color: isDark ? "#94a3b8" : "#475569",
      bg: isDark ? "rgba(148, 163, 184, 0.14)" : "#f8fafc",
      border: isDark ? "rgba(148, 163, 184, 0.4)" : "#e2e8f0",
      label: c.profileName?.trim() || "Operador",
    };
  };

  const isDark = theme === "dark";

  return (
    <div
      className={`w-screen h-screen font-sans select-none overflow-hidden flex flex-col justify-between transition-colors duration-200 ${
        isDark ? "bg-[#020617] text-slate-100" : "bg-[#f8fafc] text-slate-800"
      }`}
      style={{
        background: isDark
          ? "radial-gradient(circle at 50% 18%, #132247 0%, #080f24 45%, #020617 100%)"
          : "radial-gradient(circle at 50% 15%, #ffffff 0%, #f1f5f9 45%, #e2e8f0 100%)",
      }}
    >
      {/* Luces sutiles de fondo */}
      {isDark ? (
        <>
          <div className="fixed top-[-10%] left-[20%] w-[600px] h-[300px] bg-blue-600/10 rounded-full blur-[140px] pointer-events-none" />
          <div className="fixed bottom-[-10%] right-[20%] w-[500px] h-[280px] bg-emerald-500/10 rounded-full blur-[130px] pointer-events-none" />
        </>
      ) : (
        <>
          <div className="fixed top-[-10%] left-[20%] w-[600px] h-[300px] bg-emerald-500/5 rounded-full blur-[120px] pointer-events-none" />
          <div className="fixed bottom-[-10%] right-[20%] w-[500px] h-[280px] bg-blue-500/5 rounded-full blur-[120px] pointer-events-none" />
        </>
      )}

      {/* ================= BARRA SUPERIOR DE SISTEMA ================= */}
      <header
        className={`w-full px-7 py-3 border-b backdrop-blur-md flex items-center justify-between z-20 shrink-0 transition-colors ${
          isDark
            ? "bg-slate-950/70 border-slate-800/80 text-white"
            : "bg-white/90 border-slate-200/90 text-slate-900 shadow-xs"
        }`}
      >
        {/* Izquierda: Marca y Datos de Terminal */}
        <div className="flex items-center gap-3.5">
          <img
            src="/metahabi-icon.png"
            alt="Metahabi POS"
            className="w-9 h-9 rounded-xl object-contain shadow-md shadow-emerald-500/20"
          />
          <div>
            <div className="flex items-center gap-2">
              <span className={`text-base font-extrabold tracking-tight ${isDark ? "text-white" : "text-slate-900"}`}>
                METAHABI <span className="text-emerald-600 font-black">POS</span>
              </span>
              <span
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                  isDark
                    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                    : "bg-emerald-50 text-emerald-700 border-emerald-200"
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_#10b981]" />
                En Línea
              </span>
            </div>
            <div
              className={`text-[11px] font-medium flex items-center gap-1.5 mt-0.5 ${
                isDark ? "text-slate-400" : "text-slate-500"
              }`}
            >
              <span>{status.empresaNombre || "Empresa"} {status.empresaNit ? `(${status.empresaNit})` : ""}</span>
              <span className={isDark ? "text-slate-600" : "text-slate-300"}>•</span>
              <span>
                Terminal: <strong className={isDark ? "text-slate-200" : "text-slate-800"}>{status.cajaCodigo || "CAJA"}</strong> — {status.cajaNombre || "Caja Principal"}
              </span>
            </div>
          </div>
        </div>

        {/* Derecha: Botones de Acción de Sistema */}
        <div className="flex items-center gap-2.5">
          {/* Botón para Alternar Tema Claro / Oscuro */}
          <button
            type="button"
            onClick={toggleTheme}
            className={`p-2 rounded-xl text-xs font-semibold border transition-all active:scale-95 cursor-pointer flex items-center gap-1.5 ${
              isDark
                ? "bg-slate-800/90 hover:bg-slate-700 text-amber-300 border-slate-700 hover:border-amber-400/50"
                : "bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200 shadow-xs"
            }`}
            title={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
          >
            <span>{isDark ? "☀️" : "🌙"}</span>
            <span className="hidden sm:inline">{isDark ? "Modo Claro" : "Modo Oscuro"}</span>
          </button>

          <button
            type="button"
            onClick={handleSyncUsers}
            disabled={syncing}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all active:scale-95 disabled:opacity-50 cursor-pointer ${
              isDark
                ? "bg-slate-800/90 hover:bg-slate-700 text-slate-200 hover:text-white border-slate-700 hover:border-emerald-500/50 shadow-xs"
                : "bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 border-slate-200 hover:border-emerald-500 shadow-xs"
            }`}
            title="Sincronizar lista de usuarios y permisos desde el ERP"
          >
            <span className={syncing ? "animate-spin" : ""}>🔄</span>
            <span>{syncing ? "Sincronizando…" : "Sincronizar"}</span>
          </button>

          <button
            type="button"
            onClick={handleDisconnectTerminal}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all active:scale-95 cursor-pointer shadow-xs ${
              isDark
                ? "bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 hover:text-amber-200 border-amber-500/40 hover:border-amber-400"
                : "bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-200 hover:border-amber-300"
            }`}
            title="Desconectar o cambiar de terminal de caja"
          >
            <span>⚡</span>
            <span>Desconectar</span>
          </button>

          <div className={`h-6 w-px mx-0.5 ${isDark ? "bg-slate-800" : "bg-slate-200"}`} />

          <button
            type="button"
            onClick={handleCloseApp}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all active:scale-95 cursor-pointer shadow-xs ${
              isDark
                ? "bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 hover:text-rose-100 border-rose-500/40 hover:border-rose-400"
                : "bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200 hover:border-rose-300"
            }`}
            title="Cerrar y apagar la aplicación de Punto de Venta"
          >
            <span>⏻</span>
            <span>Apagar</span>
          </button>
        </div>
      </header>

      {/* ================= CONTENEDOR CENTRAL DE AUTENTICACIÓN ================= */}
      <main className="w-full flex-1 flex items-center justify-center p-6 z-10 overflow-y-auto">
        <div
          className={`w-full max-w-4xl border rounded-3xl p-7 relative overflow-hidden transition-colors ${
            isDark
              ? "bg-slate-900/80 backdrop-blur-xl border-slate-800/80 shadow-2xl"
              : "bg-white border-slate-200/90 shadow-xl shadow-slate-200/60"
          }`}
        >
          {/* Línea de acento superior */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500" />

          {/* Encabezado del Card */}
          <div className="text-center mb-6">
            <div
              className={`inline-flex items-center justify-center w-12 h-12 rounded-2xl border shadow-inner mb-2.5 ${
                isDark ? "bg-slate-800/80 border-slate-700/80" : "bg-slate-50 border-slate-200"
              }`}
            >
              <span className="text-2xl">🔒</span>
            </div>
            <h2 className={`text-2xl font-black tracking-tight ${isDark ? "text-white" : "text-slate-900"}`}>
              Selecciona tu Usuario
            </h2>
            <p className={`text-xs mt-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              Elige tu perfil de operador para ingresar al punto de venta y abrir sesión de turno
            </p>
          </div>

          {syncSuccessMsg && (
            <div
              className={`mb-5 p-3 rounded-xl border text-xs font-semibold text-center flex items-center justify-center gap-2 animate-in fade-in slide-in-from-top-1 ${
                isDark
                  ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                  : "bg-emerald-50 border-emerald-200 text-emerald-800"
              }`}
            >
              <span>✓</span>
              <span>{syncSuccessMsg}</span>
            </div>
          )}

          {error && (
            <div
              className={`mb-5 p-3 rounded-xl border text-xs font-semibold text-center flex items-center justify-center gap-2 ${
                isDark
                  ? "bg-rose-500/15 border-rose-500/40 text-rose-300"
                  : "bg-rose-50 border-rose-200 text-rose-700"
              }`}
            >
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {regularCashiers.length === 0 ? (
            <div
              className={`p-8 text-center border border-dashed rounded-2xl my-4 ${
                isDark
                  ? "border-slate-800 bg-slate-950/40 text-slate-400"
                  : "border-slate-300 bg-slate-50/80 text-slate-600"
              }`}
            >
              <div
                className={`w-12 h-12 mx-auto mb-3 rounded-2xl border flex items-center justify-center text-xl ${
                  isDark
                    ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
                    : "bg-amber-50 border-amber-200 text-amber-700"
                }`}
              >
                👤
              </div>
              <p className={`text-sm font-bold mb-1 ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                No hay operadores de caja autorizados detectados
              </p>
              <p className={`text-xs mb-4 max-w-md mx-auto ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                Asegúrate de que el usuario tenga un <strong>PIN de Caja POS (4 a 6 dígitos)</strong> configurado en el ERP y presiona el botón inferior para sincronizarlo.
              </p>
              <button
                type="button"
                onClick={handleSyncUsers}
                disabled={syncing}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-colors cursor-pointer inline-flex items-center gap-2 shadow-lg shadow-emerald-600/20"
              >
                <span className={syncing ? "animate-spin" : ""}>🔄</span>
                <span>{syncing ? "Sincronizando…" : "Sincronizar Usuarios del ERP"}</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-12 gap-7 items-start">
              {/* Columna Izquierda: Operadores (7 columnas) */}
              <div className="col-span-12 lg:col-span-7 space-y-4">
                <div className="flex items-center justify-between">
                  <span
                    className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${
                      isDark ? "text-slate-400" : "text-slate-600"
                    }`}
                  >
                    <span>👥</span> Operadores Frecuentes
                  </span>
                  <span className={`text-[11px] font-medium ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                    {regularCashiers.length} autorizados
                  </span>
                </div>

                {/* Tarjetas de Frecuentes */}
                <div className="grid grid-cols-1 gap-2.5">
                  {frequentCashiers.map((c, idx) => {
                    const rTheme = getRoleTheme(c);
                    const isSelected = selectedCashier?.id === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleSelectCashier(c)}
                        className={`w-full text-left p-3 rounded-2xl border transition-all duration-150 flex items-center justify-between cursor-pointer group ${
                          isSelected
                            ? isDark
                              ? "bg-gradient-to-r from-emerald-950/60 to-slate-900/90 border-emerald-500 shadow-lg shadow-emerald-950/50"
                              : "bg-emerald-50/90 border-emerald-500 ring-1 ring-emerald-500 shadow-md shadow-emerald-500/10"
                            : isDark
                            ? "bg-slate-950/50 hover:bg-slate-800/60 border-slate-800 hover:border-slate-700"
                            : "bg-slate-50 hover:bg-slate-100/90 border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          {/* Avatar */}
                          <div className="relative">
                            <div
                              className="w-11 h-11 rounded-xl flex items-center justify-center font-bold text-sm font-mono border"
                              style={{
                                backgroundColor: rTheme.bg,
                                borderColor: rTheme.border,
                                color: rTheme.color,
                              }}
                            >
                              {c.fullName.slice(0, 2).toUpperCase()}
                            </div>
                            {isSelected && (
                              <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[9px] font-black border border-white shadow-xs">
                                ✓
                              </div>
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span
                                className={`font-bold text-sm transition-colors ${
                                  isSelected
                                    ? isDark
                                      ? "text-emerald-300"
                                      : "text-emerald-900"
                                    : isDark
                                    ? "text-white group-hover:text-slate-100"
                                    : "text-slate-800 group-hover:text-slate-900"
                                }`}
                              >
                                {c.fullName}
                              </span>
                              <span
                                className="px-2 py-0.5 rounded text-[10px] font-bold border"
                                style={{
                                  backgroundColor: rTheme.bg,
                                  borderColor: rTheme.border,
                                  color: rTheme.color,
                                }}
                              >
                                {rTheme.label}
                              </span>
                            </div>
                            <p
                              className={`text-[11px] font-mono mt-0.5 ${
                                isDark ? "text-slate-400" : "text-slate-500"
                              }`}
                            >
                              @{c.username}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`text-[11px] font-mono font-bold px-2 py-1 rounded border ${
                            isDark
                              ? "bg-slate-800/80 text-slate-400 border-slate-700/60"
                              : "bg-white text-slate-500 border-slate-200"
                          }`}
                        >
                          #{idx + 1}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Dropdown de lista completa */}
                <div className="pt-2">
                  <label
                    className={`block text-xs font-bold mb-1.5 ${
                      isDark ? "text-slate-400" : "text-slate-600"
                    }`}
                  >
                    O buscar en lista completa de operadores:
                  </label>
                  <select
                    value={selectedCashier?.id || ""}
                    onChange={(e) => {
                      const id = Number(e.target.value);
                      const found = regularCashiers.find((c) => c.id === id);
                      if (found) handleSelectCashier(found);
                    }}
                    className={`w-full rounded-xl px-3.5 py-2.5 text-xs font-semibold focus:outline-none focus:border-emerald-500 transition-colors border ${
                      isDark
                        ? "bg-slate-950/80 border-slate-700/80 text-slate-200"
                        : "bg-white border-slate-200 text-slate-800 shadow-xs"
                    }`}
                  >
                    <option value="">-- Haz clic para seleccionar cualquier operador ({regularCashiers.length}) --</option>
                    {regularCashiers.map((c) => {
                      const rTheme = getRoleTheme(c);
                      return (
                        <option key={c.id} value={c.id}>
                          {c.fullName} (@{c.username}) — [{rTheme.label}]
                        </option>
                      );
                    })}
                  </select>
                </div>

                {/* Acceso de Soporte */}
                <div className="pt-2 flex justify-start">
                  <button
                    type="button"
                    onClick={() => setShowSupportModal(true)}
                    className={`text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                      isDark
                        ? "text-slate-500 hover:text-slate-300"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    <span>🛠️</span>
                    <span>Acceso de Soporte Técnico (PIN Maestro)</span>
                  </button>
                </div>
              </div>

              {/* Columna Derecha: PIN Pad (5 columnas) */}
              <div
                className={`col-span-12 lg:col-span-5 border rounded-2xl p-5 flex flex-col justify-between ${
                  isDark
                    ? "bg-slate-950/60 border-slate-800/90"
                    : "bg-slate-50/90 border-slate-200 shadow-xs"
                }`}
              >
                {selectedCashier ? (
                  <div>
                    <div
                      className={`flex items-center justify-between pb-3 border-b ${
                        isDark ? "border-slate-800" : "border-slate-200"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-medium ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                          Ingresando:
                        </span>
                        <strong className={`text-xs font-bold ${isDark ? "text-emerald-400" : "text-emerald-700"}`}>
                          {selectedCashier.fullName}
                        </strong>
                      </div>
                      <button
                        type="button"
                        onClick={handleBackToSelect}
                        className={`text-[11px] underline cursor-pointer ${
                          isDark ? "text-slate-400 hover:text-white" : "text-slate-500 hover:text-slate-800"
                        }`}
                      >
                        Cambiar
                      </button>
                    </div>

                    <div className="text-center mt-4">
                      <span className={`text-xs ${isDark ? "text-slate-400" : "text-slate-600 font-medium"}`}>
                        PIN de Seguridad (4 dígitos)
                      </span>
                      <div className="flex justify-center gap-3 my-3">
                        {[0, 1, 2, 3].map((idx) => {
                          const isFilled = pin.length > idx;
                          return (
                            <div
                              key={idx}
                              className={`w-3.5 h-3.5 rounded-full border-2 transition-all duration-150 ${
                                isFilled
                                  ? isDark
                                    ? "bg-emerald-400 border-emerald-300 shadow-[0_0_12px_#10b981] scale-110"
                                    : "bg-emerald-600 border-emerald-500 shadow-md shadow-emerald-500/30 scale-110"
                                  : isDark
                                  ? "border-slate-700 bg-slate-800/60"
                                  : "border-slate-300 bg-white"
                              }`}
                            />
                          );
                        })}
                      </div>
                    </div>

                    {/* Keypad */}
                    <div className="grid grid-cols-3 gap-2 my-2">
                      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
                        <button
                          key={digit}
                          type="button"
                          onClick={() => handleKeyPress(digit)}
                          className={`h-11 rounded-xl font-bold text-base border shadow-xs transition-all cursor-pointer active:scale-95 ${
                            isDark
                              ? "bg-slate-800/80 hover:bg-slate-700 text-white border-slate-700/60"
                              : "bg-white hover:bg-slate-100 text-slate-800 border-slate-200"
                          }`}
                        >
                          {digit}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={handleBackspace}
                        className={`h-11 rounded-xl font-bold text-base border transition-all cursor-pointer active:scale-95 ${
                          isDark
                            ? "bg-slate-800/40 hover:bg-slate-700/60 text-slate-400 hover:text-white border-slate-700/60"
                            : "bg-slate-100 hover:bg-slate-200 text-slate-600 border-slate-200"
                        }`}
                        title="Borrar dígito"
                      >
                        ⌫
                      </button>
                      <button
                        type="button"
                        onClick={() => handleKeyPress("0")}
                        className={`h-11 rounded-xl font-bold text-base border shadow-xs transition-all cursor-pointer active:scale-95 ${
                          isDark
                            ? "bg-slate-800/80 hover:bg-slate-700 text-white border-slate-700/60"
                            : "bg-white hover:bg-slate-100 text-slate-800 border-slate-200"
                        }`}
                      >
                        0
                      </button>
                      <button
                        type="button"
                        onClick={handleClear}
                        className={`h-11 rounded-xl font-bold text-xs border transition-all cursor-pointer active:scale-95 ${
                          isDark
                            ? "bg-slate-800/40 hover:bg-slate-700/60 text-slate-400 hover:text-rose-400 border-slate-700/60"
                            : "bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-rose-600 border-slate-200"
                        }`}
                        title="Limpiar"
                      >
                        C
                      </button>
                    </div>

                    <button
                      type="button"
                      disabled={loading || pin.length < 4}
                      onClick={() => handlePinSubmit(pin)}
                      className="w-full mt-3 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-extrabold text-xs tracking-wider uppercase shadow-md shadow-emerald-600/30 flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer"
                    >
                      <span>{loading ? "Verificando..." : "🔓 Ingresar a Caja"}</span>
                    </button>
                    <p className={`text-[10px] text-center mt-2 font-mono ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                      Presiona Enter en el teclado físico
                    </p>

                    <div className="text-center mt-2.5">
                      <button
                        type="button"
                        onClick={() => setShowForgotPinModal(true)}
                        className={`text-[11px] transition-colors cursor-pointer font-medium inline-flex items-center gap-1.5 ${
                          isDark
                            ? "text-emerald-400/90 hover:text-emerald-300 hover:underline"
                            : "text-emerald-700 hover:text-emerald-900 hover:underline"
                        }`}
                      >
                        <span>🔑</span>
                        <span>¿Olvidaste tu PIN?</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6">
                    <span className="text-3xl mb-2">👈</span>
                    <p className={`text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-700"}`}>
                      Selecciona tu usuario
                    </p>
                    <p className={`text-[11px] mt-1 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                      Elige tu perfil a la izquierda para activar el teclado numérico de ingreso.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ================= FOOTER DEL SISTEMA ================= */}
      <footer
        className={`w-full py-2.5 px-7 border-t flex items-center justify-between text-[11px] z-10 shrink-0 transition-colors ${
          isDark
            ? "border-slate-900 bg-slate-950/40 text-slate-500"
            : "border-slate-200/80 bg-white/90 text-slate-500 shadow-xs"
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span>Metahabi POS • Estación de Caja Activa</span>
        </div>
        <div className="flex items-center gap-3">
          {updateStatus === "ready" ? (
            <button
              type="button"
              onClick={() => restartAndApply()}
              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <span>🔄</span>
              <span>Reiniciar y aplicar v{newVersion}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => checkForUpdates(true)}
              disabled={updateStatus === "checking" || updateStatus === "downloading"}
              className="hover:text-emerald-500 transition-colors cursor-pointer disabled:opacity-50"
              title="Buscar actualizaciones de Metahabi POS"
            >
              {updateStatus === "checking"
                ? "Buscando actualizaciones…"
                : updateStatus === "downloading"
                ? "Descargando actualización…"
                : "Buscar actualización"}
            </button>
          )}
          <span>•</span>
          <span>Versión {currentVersion || "0.1.6"} Oficial</span>
        </div>
      </footer>

      {/* Modal de Acceso de Soporte */}
      <SupportAccessModal
        isOpen={showSupportModal}
        onClose={() => setShowSupportModal(false)}
        onSuccess={(supportUser: CashierUser) => {
          setShowSupportModal(false);
          onUnlocked(supportUser);
        }}
        availableCashiers={cashiers}
        onCashiersUpdated={(updated) => setCashiers(updated)}
      />

      {/* Modal de Ayuda: ¿Olvidaste tu PIN? */}
      <ForgotPinModal
        isOpen={showForgotPinModal}
        onClose={() => setShowForgotPinModal(false)}
        selectedCashier={selectedCashier}
        onSyncComplete={(updated) => {
          setCashiers(updated);
          const current = updated.find((c) => c.id === selectedCashier?.id);
          if (current) setSelectedCashier(current);
        }}
      />

      {/* Modal de Cierre y Arqueo de Turno Requerido */}
      {showCloseShiftModal && (
        <CloseShiftModal
          onShiftClosed={async () => {
            // Asegurar que no quede ningún ticket abierto en memoria ni en localStorage
            localStorage.setItem("pos_active_tickets", JSON.stringify([{ id: 1, name: "Ticket 1", lines: [] }]));
            localStorage.setItem("pos_active_ticket_id", "1");
            window.dispatchEvent(new CustomEvent("pos:reset-tickets"));

            setShowCloseShiftModal(false);
            if (pendingActionAfterCloseShift === "shutdown") {
              await api.system.closeApp(true);
            } else if (pendingActionAfterCloseShift === "disconnect") {
              await api.auth.disconnectTemporarily();
              if (onUnpaired) onUnpaired();
            }
            setPendingActionAfterCloseShift(null);
          }}
          onCancel={() => {
            setShowCloseShiftModal(false);
            setPendingActionAfterCloseShift(null);
          }}
        />
      )}
    </div>
  );
}
