import { useEffect, useState, useCallback } from "react";
import { api } from "../services/api";
import type { CashierUser, TerminalStatus } from "../types";
import { SupportAccessModal } from "./SupportAccessModal";
import { CloseShiftModal } from "./CloseShiftModal";
import { useModals } from "../contexts/ModalContext";

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
  const { confirm, alert: modalAlert } = useModals();
  const [cashiers, setCashiers] = useState<CashierUser[]>([]);
  const [selectedCashier, setSelectedCashier] = useState<CashierUser | null>(null);
  const [showSupportModal, setShowSupportModal] = useState(false);
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

    if (
      erpRole === "superadminsaas" ||
      role === "superadminsaas" ||
      role === "superadmin" ||
      profile.includes("soporte")
    ) {
      return {
        category: "support",
        color: "#38bdf8",
        bg: "rgba(56, 189, 248, 0.14)",
        border: "rgba(56, 189, 248, 0.4)",
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
        color: "#f59e0b",
        bg: "rgba(245, 158, 11, 0.14)",
        border: "rgba(245, 158, 11, 0.4)",
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
        color: "#10b981",
        bg: "rgba(16, 185, 129, 0.14)",
        border: "rgba(16, 185, 129, 0.4)",
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
        color: "#8b5cf6",
        bg: "rgba(139, 92, 246, 0.14)",
        border: "rgba(139, 92, 246, 0.4)",
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
        color: "#0ea5e9",
        bg: "rgba(14, 165, 233, 0.14)",
        border: "rgba(14, 165, 233, 0.4)",
        label: c.profileName?.trim() || "Cajero / Ventas",
      };
    }

    return {
      category: "staff",
      color: "#94a3b8",
      bg: "rgba(148, 163, 184, 0.14)",
      border: "rgba(148, 163, 184, 0.4)",
      label: c.profileName?.trim() || "Operador",
    };
  };

  return (
    <div
      className="w-screen h-screen bg-[#020617] text-slate-100 font-sans select-none overflow-hidden flex flex-col justify-between"
      style={{ background: "radial-gradient(circle at 50% 18%, #132247 0%, #080f24 45%, #020617 100%)" }}
    >
      {/* Luces sutiles de fondo */}
      <div className="fixed top-[-10%] left-[20%] w-[600px] h-[300px] bg-blue-600/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="fixed bottom-[-10%] right-[20%] w-[500px] h-[280px] bg-emerald-500/10 rounded-full blur-[130px] pointer-events-none" />

      {/* ================= BARRA SUPERIOR DE SISTEMA ================= */}
      <header className="w-full px-7 py-3 bg-slate-950/70 border-b border-slate-800/80 backdrop-blur-md flex items-center justify-between z-20 shrink-0">
        {/* Izquierda: Marca y Datos de Terminal */}
        <div className="flex items-center gap-3.5">
          <img
            src="/metahabi-icon.png"
            alt="Metahabi POS"
            className="w-9 h-9 rounded-xl object-contain shadow-md shadow-emerald-500/20"
          />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-extrabold tracking-tight text-white">
                METAHABI <span className="text-emerald-400 font-black">POS</span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#10b981]" />
                En Línea
              </span>
            </div>
            <div className="text-[11px] text-slate-400 font-medium flex items-center gap-1.5 mt-0.5">
              <span>{status.empresaNombre || "Empresa"} {status.empresaNit ? `(${status.empresaNit})` : ""}</span>
              <span className="text-slate-600">•</span>
              <span>
                Terminal: <strong className="text-slate-200">{status.cajaCodigo || "CAJA"}</strong> — {status.cajaNombre || "Caja Principal"}
              </span>
            </div>
          </div>
        </div>

        {/* Derecha: Botones de Acción de Sistema */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleSyncUsers}
            disabled={syncing}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800/90 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 hover:border-emerald-500/50 shadow-xs transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
            title="Sincronizar lista de usuarios y permisos desde el ERP"
          >
            <span className={syncing ? "animate-spin" : ""}>🔄</span>
            <span>{syncing ? "Sincronizando…" : "Sincronizar Usuarios"}</span>
          </button>

          <button
            type="button"
            onClick={handleDisconnectTerminal}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 hover:text-amber-200 border border-amber-500/40 hover:border-amber-400 transition-all active:scale-95 cursor-pointer shadow-xs"
            title="Desconectar o cambiar de terminal de caja"
          >
            <span>⚡</span>
            <span>Desconectar Caja</span>
          </button>

          <div className="h-6 w-px bg-slate-800 mx-0.5" />

          <button
            type="button"
            onClick={handleCloseApp}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 hover:text-rose-100 border border-rose-500/40 hover:border-rose-400 transition-all active:scale-95 cursor-pointer shadow-xs shadow-rose-950/50"
            title="Cerrar y apagar la aplicación de Punto de Venta"
          >
            <span>⏻</span>
            <span>Apagar Caja</span>
          </button>
        </div>
      </header>

      {/* ================= CONTENEDOR CENTRAL DE AUTENTICACIÓN ================= */}
      <main className="w-full flex-1 flex items-center justify-center p-6 z-10 overflow-y-auto">
        <div className="w-full max-w-4xl bg-slate-900/80 backdrop-blur-xl border border-slate-800/80 rounded-3xl p-7 shadow-2xl relative overflow-hidden">
          {/* Línea de acento superior */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 via-emerald-500 to-teal-400" />

          {/* Encabezado del Card */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-slate-800/80 border border-slate-700/80 shadow-inner mb-2.5">
              <span className="text-2xl">🔒</span>
            </div>
            <h2 className="text-2xl font-black tracking-tight text-white">
              Selecciona tu Usuario
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Elige tu perfil de operador para ingresar al punto de venta y abrir sesión de turno
            </p>
          </div>

          {syncSuccessMsg && (
            <div className="mb-5 p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs font-semibold text-center flex items-center justify-center gap-2 animate-in fade-in slide-in-from-top-1">
              <span>✓</span>
              <span>{syncSuccessMsg}</span>
            </div>
          )}

          {error && (
            <div className="mb-5 p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs font-semibold text-center flex items-center justify-center gap-2">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {regularCashiers.length === 0 ? (
            <div className="p-8 text-center text-slate-400 border border-dashed border-slate-800 rounded-2xl bg-slate-950/40 my-4">
              <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center text-xl">
                👤
              </div>
              <p className="text-sm font-bold text-slate-200 mb-1">
                No hay operadores de caja autorizados detectados
              </p>
              <p className="text-xs text-slate-400 mb-4 max-w-md mx-auto">
                Asegúrate de que el usuario tenga un <strong>PIN de Caja POS (4 a 6 dígitos)</strong> configurado en el ERP y presiona el botón inferior para sincronizarlo.
              </p>
              <button
                type="button"
                onClick={handleSyncUsers}
                disabled={syncing}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-colors cursor-pointer inline-flex items-center gap-2 shadow-lg shadow-emerald-950/50"
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
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <span>👥</span> Operadores Frecuentes
                  </span>
                  <span className="text-[11px] text-slate-500 font-medium">
                    {regularCashiers.length} autorizados
                  </span>
                </div>

                {/* Tarjetas de Frecuentes */}
                <div className="grid grid-cols-1 gap-2.5">
                  {frequentCashiers.map((c, idx) => {
                    const theme = getRoleTheme(c);
                    const isSelected = selectedCashier?.id === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleSelectCashier(c)}
                        className={`w-full text-left p-3 rounded-2xl border transition-all duration-150 flex items-center justify-between cursor-pointer group ${
                          isSelected
                            ? "bg-gradient-to-r from-emerald-950/60 to-slate-900/90 border-emerald-500 shadow-lg shadow-emerald-950/50"
                            : "bg-slate-950/50 hover:bg-slate-800/60 border-slate-800 hover:border-slate-700"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          {/* Avatar */}
                          <div className="relative">
                            <div
                              className="w-11 h-11 rounded-xl flex items-center justify-center font-bold text-sm font-mono border"
                              style={{
                                backgroundColor: theme.bg,
                                borderColor: theme.border,
                                color: theme.color,
                              }}
                            >
                              {c.fullName.slice(0, 2).toUpperCase()}
                            </div>
                            {isSelected && (
                              <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center text-[9px] font-black border border-slate-900">
                                ✓
                              </div>
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className={`font-bold text-sm transition-colors ${isSelected ? "text-emerald-300" : "text-white group-hover:text-slate-100"}`}>
                                {c.fullName}
                              </span>
                              <span
                                className="px-2 py-0.5 rounded text-[10px] font-bold border"
                                style={{
                                  backgroundColor: theme.bg,
                                  borderColor: theme.border,
                                  color: theme.color,
                                }}
                              >
                                {theme.label}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                              @{c.username}
                            </p>
                          </div>
                        </div>
                        <span className="text-[11px] font-mono font-bold px-2 py-1 rounded bg-slate-800/80 text-slate-400 border border-slate-700/60">
                          #{idx + 1}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Dropdown de lista completa */}
                <div className="pt-2">
                  <label className="block text-xs font-bold text-slate-400 mb-1.5">
                    O buscar en lista completa de operadores:
                  </label>
                  <select
                    value={selectedCashier?.id || ""}
                    onChange={(e) => {
                      const id = Number(e.target.value);
                      const found = regularCashiers.find((c) => c.id === id);
                      if (found) handleSelectCashier(found);
                    }}
                    className="w-full bg-slate-950/80 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
                  >
                    <option value="">-- Haz clic para seleccionar cualquier operador ({regularCashiers.length}) --</option>
                    {regularCashiers.map((c) => {
                      const theme = getRoleTheme(c);
                      return (
                        <option key={c.id} value={c.id}>
                          {c.fullName} (@{c.username}) — [{theme.label}]
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
                    className="text-xs font-semibold text-slate-500 hover:text-slate-300 flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <span>🛠️</span>
                    <span>Acceso de Soporte Técnico (PIN Maestro)</span>
                  </button>
                </div>
              </div>

              {/* Columna Derecha: PIN Pad (5 columnas) */}
              <div className="col-span-12 lg:col-span-5 bg-slate-950/60 border border-slate-800/90 rounded-2xl p-5 flex flex-col justify-between">
                {selectedCashier ? (
                  <div>
                    <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400 font-medium">Ingresando:</span>
                        <strong className="text-xs text-emerald-400 font-bold">{selectedCashier.fullName}</strong>
                      </div>
                      <button
                        type="button"
                        onClick={handleBackToSelect}
                        className="text-[11px] text-slate-400 hover:text-white underline cursor-pointer"
                      >
                        Cambiar
                      </button>
                    </div>

                    <div className="text-center mt-4">
                      <span className="text-xs text-slate-400">PIN de Seguridad (4 dígitos)</span>
                      <div className="flex justify-center gap-3 my-3">
                        {[0, 1, 2, 3].map((idx) => {
                          const isFilled = pin.length > idx;
                          return (
                            <div
                              key={idx}
                              className={`w-3.5 h-3.5 rounded-full border-2 transition-all duration-150 ${
                                isFilled
                                  ? "bg-emerald-400 border-emerald-300 shadow-[0_0_12px_#10b981] scale-110"
                                  : "border-slate-700 bg-slate-800/60"
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
                          className="h-11 rounded-xl bg-slate-800/80 hover:bg-slate-700 active:scale-95 text-white font-bold text-base border border-slate-700/60 shadow-xs transition-all cursor-pointer"
                        >
                          {digit}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={handleBackspace}
                        className="h-11 rounded-xl bg-slate-800/40 hover:bg-slate-700/60 active:scale-95 text-slate-400 hover:text-white font-bold text-base border border-slate-700/60 transition-all cursor-pointer"
                        title="Borrar dígito"
                      >
                        ⌫
                      </button>
                      <button
                        type="button"
                        onClick={() => handleKeyPress("0")}
                        className="h-11 rounded-xl bg-slate-800/80 hover:bg-slate-700 active:scale-95 text-white font-bold text-base border border-slate-700/60 shadow-xs transition-all cursor-pointer"
                      >
                        0
                      </button>
                      <button
                        type="button"
                        onClick={handleClear}
                        className="h-11 rounded-xl bg-slate-800/40 hover:bg-slate-700/60 active:scale-95 text-slate-400 hover:text-rose-400 font-bold text-xs border border-slate-700/60 transition-all cursor-pointer"
                        title="Limpiar"
                      >
                        C
                      </button>
                    </div>

                    <button
                      type="button"
                      disabled={loading || pin.length < 4}
                      onClick={() => handlePinSubmit(pin)}
                      className="w-full mt-3 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-extrabold text-xs tracking-wider uppercase shadow-lg shadow-emerald-950/50 flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer"
                    >
                      <span>{loading ? "Verificando..." : "🔓 Ingresar a Caja"}</span>
                    </button>
                    <p className="text-[10px] text-slate-500 text-center mt-2 font-mono">
                      Presiona Enter en el teclado físico
                    </p>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
                    <span className="text-3xl mb-2">👈</span>
                    <p className="text-xs font-semibold text-slate-400">Selecciona tu usuario</p>
                    <p className="text-[11px] text-slate-500 mt-1">
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
      <footer className="w-full py-2.5 px-7 border-t border-slate-900 bg-slate-950/40 flex items-center justify-between text-[11px] text-slate-500 z-10 shrink-0">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span>Metahabi POS • Estación de Caja Activa</span>
        </div>
        <div>
          <span>Versión 0.1.0 Oficial</span>
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

      {/* Modal de Cierre y Arqueo de Turno Requerido */}
      {showCloseShiftModal && (
        <CloseShiftModal
          onShiftClosed={async () => {
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
