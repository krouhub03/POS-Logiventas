import { useEffect, useState, useCallback } from "react";
import { api } from "./services/api";
import { ProductsPage } from "./pages/ProductsPage";
import { SalesStationPage } from "./pages/SalesStationPage";
import { SettingsPage } from "./pages/SettingsPage";
import { PairingScreen } from "./components/PairingScreen";
import { CashierLockScreen } from "./components/CashierLockScreen";
import { OpenShiftModal } from "./components/OpenShiftModal";
import { CloseShiftModal } from "./components/CloseShiftModal";
import { UpdateNotificationBanner } from "./components/UpdateNotificationBanner";
import { LicenseBanner } from "./components/LicenseBanner";
import { useModals } from "./contexts/ModalContext";

import { hasPermission } from "./lib/permissions";
import type { CashierUser, CashShift, TerminalStatus } from "./types";
import "./App.css";

function App() {
  const { alert, confirm } = useModals();
  const [terminalStatus, setTerminalStatus] = useState<TerminalStatus | null>(null);
  const [activeCashier, setActiveCashier] = useState<CashierUser | null>(() => {
    try {
      const saved = localStorage.getItem("pos_active_cashier");
      return saved ? (JSON.parse(saved) as CashierUser) : null;
    } catch {
      return null;
    }
  });
  const [activeShift, setActiveShift] = useState<CashShift | null>(null);
  const [loadingShift, setLoadingShift] = useState(false);
  const [showCloseShiftModal, setShowCloseShiftModal] = useState(false);
  const [exitActionPending, setExitActionPending] = useState(false);
  const [currentView, setCurrentView] = useState<"sales" | "products" | "inventory" | "settings">("sales");
  const [loading, setLoading] = useState(true);

  const handleSetCashier = (cashier: CashierUser | null) => {
    setActiveCashier(cashier);
    if (cashier) {
      localStorage.setItem("pos_active_cashier", JSON.stringify(cashier));
    } else {
      localStorage.removeItem("pos_active_cashier");
    }
  };

  const cargarEstado = useCallback(async () => {
    try {
      const termStatus = await api.auth.getTerminalStatus();
      setTerminalStatus(termStatus);
      if (termStatus.activeCashier) {
        handleSetCashier(termStatus.activeCashier);
      }
      // Si la terminal está vinculada, verificar inmediatamente si sigue activa en el ERP
      if (termStatus.isPaired) {
        api.auth.validateSession().then((liveStatus) => {
          if (!liveStatus.isPaired) {
            setTerminalStatus(liveStatus);
            handleSetCashier(null);
          }
        }).catch(() => {});
      }
    } catch (e: unknown) {
      console.error("Error al cargar estado de terminal:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargarEstado();
  }, [cargarEstado]);

  const cargarTurnoActivo = useCallback(async () => {
    if (!activeCashier) {
      setActiveShift(null);
      return;
    }
    setLoadingShift(true);
    try {
      const shift = await api.shifts.getActiveShift();
      setActiveShift(shift);
    } catch (e: unknown) {
      console.error("Error al cargar turno activo:", e);
    } finally {
      setLoadingShift(false);
    }
  }, [activeCashier]);

  useEffect(() => {
    cargarTurnoActivo();
  }, [cargarTurnoActivo]);

  // Auditoría y Latido Periódico (cada 15s):
  // Si la caja es eliminada, desactivada o revocada en el ERP Megalider,
  // o si el cajero activo fue cambiado a CLIENTE / revocado en el ERP,
  // el POS expulsa al cajero y bloquea la terminal de inmediato.
  useEffect(() => {
    if (!terminalStatus?.isPaired) return;

    const interval = setInterval(async () => {
      try {
        const liveStatus = await api.auth.validateSession(activeCashier?.erpUserId || undefined);
        if (!liveStatus.isPaired) {
          console.warn("[SEGURIDAD POS] La caja fue eliminada o revocada en el ERP. Cerrando sesión de cajero...");
          setTerminalStatus(liveStatus);
          handleSetCashier(null);
        } else if (liveStatus.activeCashierRevoked && activeCashier) {
          console.warn("[SEGURIDAD POS] El usuario activo fue degradado a CLIENTE o revocado en el ERP. Cerrando sesión...");
          handleSetCashier(null);
          alert({
            title: "Acceso Revocado",
            message: "Tu perfil de usuario ha sido modificado a CLIENTE o revocado en el ERP Megalider. La sesión de caja ha sido cerrada por seguridad.",
            variant: "error",
          });
        }
      } catch (err) {
        // En caso de corte de red momentáneo, la política Offline-First de validateSession
        // no desvincula la terminal local.
      }
    }, 15000);

    return () => clearInterval(interval);
  }, [terminalStatus?.isPaired, activeCashier, handleSetCashier, alert]);


  const handleNavigateToProducts = useCallback(() => {
    if (!hasPermission(activeCashier, "inventario:ver")) {
      alert({
        title: "Acceso Denegado",
        message: "Tu perfil de usuario en el ERP no tiene permisos para consultar el catálogo de productos ('inventario:ver').",
        variant: "warning",
      });
      return;
    }
    setCurrentView("products");
  }, [activeCashier, alert]);

  const handleNavigateToInventory = useCallback(() => {
    if (!hasPermission(activeCashier, "inventario:ajustar") && !hasPermission(activeCashier, "inventario:ver")) {
      alert({
        title: "Acceso Denegado",
        message: "Tu perfil de usuario en el ERP no cuenta con permisos para acceder al módulo de inventario ('inventario:ver' o 'inventario:ajustar').",
        variant: "warning",
      });
      return;
    }
    setCurrentView("inventory");
  }, [activeCashier, alert]);

  const handleNavigateToSettings = useCallback(() => {
    if (!hasPermission(activeCashier, "pos:configuracion")) {
      alert({
        title: "Acceso Restringido",
        message: "La configuración de hardware y parámetros del POS está reservada para Administradores ('pos:configuracion').",
        variant: "warning",
      });
      return;
    }
    setCurrentView("settings");
  }, [activeCashier, alert]);

  // Atajos globales para cambiar de vista (F1 = Ventas, F3 = Productos, F4 = Inventario, F7 = Configuración)
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if (!activeCashier) return;
      if (e.key === "F1") {
        e.preventDefault();
        setCurrentView("sales");
      } else if (e.key === "F3") {
        e.preventDefault();
        handleNavigateToProducts();
      } else if (e.key === "F4") {
        e.preventDefault();
        handleNavigateToInventory();
      } else if (e.key === "F7") {
        e.preventDefault();
        handleNavigateToSettings();
      } else if (e.key === "F11") {
        e.preventDefault();
        api.system.toggleFullscreen().catch(console.error);
      }
    };
    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  }, [activeCashier, handleNavigateToProducts, handleNavigateToInventory, handleNavigateToSettings]);

  const handleRequestCloseApp = useCallback(async () => {
    try {
      const currentShift = activeShift ?? (await api.shifts.getActiveShift().catch(() => null));

      if (currentShift) {
        const doCloseShift = await confirm({
          title: "⚠️ Turno de Caja Abierto",
          message: `El turno ${currentShift.folio} (${currentShift.userName || "Cajero"}) sigue activo con ventas en custodia. Se debe realizar el arqueo y cierre antes de apagar la estación para emitir el reporte Z al ERP.`,
          confirmText: "Hacer Arqueo y Apagar",
          cancelText: "Suspender y Salir",
          variant: "warning",
        });

        if (doCloseShift) {
          setExitActionPending(true);
          setShowCloseShiftModal(true);
          return;
        }

        const forceExit = await confirm({
          title: "¿Salir sin Arqueo (Solo Emergencias)?",
          message:
            "El turno continuará abierto en el sistema y se reanudará al encender el POS. ¿Deseas apagar ahora?",
          confirmText: "Sí, apagar sin arqueo",
          cancelText: "Volver al POS",
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
      console.error("Error al salir de la aplicación:", err);
    }
  }, [activeShift, confirm]);

  // Interceptar cierre de ventana de Windows (Alt+F4 o botón X) enviado desde Tauri
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event")
      .then(({ listen }) => {
        listen("pos://request-close-app", () => {
          handleRequestCloseApp();
        }).then((unsub) => {
          unlisten = unsub;
        });
      })
      .catch(() => {});

    return () => {
      if (unlisten) unlisten();
    };
  }, [handleRequestCloseApp]);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#020617", color: "#f8fafc" }}>
        <span>Iniciando Logiventa POS…</span>
      </div>
    );
  }

  // 1. Si la terminal no está vinculada al ERP -> Pantalla de emparejamiento
  if (!terminalStatus?.isPaired) {
    return (
      <PairingScreen
        initialErpUrl={terminalStatus?.erpUrl}
        terminalStatus={terminalStatus}
        onPaired={(newStatus) => {
          setTerminalStatus(newStatus);
          handleSetCashier(null);
        }}
        onUnpaired={(newStatus) => {
          setTerminalStatus(newStatus);
        }}
        onCloseApp={handleRequestCloseApp}
      />
    );
  }

  // 2. Si está vinculada pero no hay cajero autenticado -> Pantalla de bloqueo con PIN
  if (!activeCashier) {
    return (
      <CashierLockScreen
        status={terminalStatus}
        onUnlocked={(cashier) => handleSetCashier(cashier)}
        onUnpaired={() => {
          setTerminalStatus((prev) => (prev ? { ...prev, isPaired: false } : null));
          handleSetCashier(null);
        }}
      />
    );
  }

  // 3. Si hay cajero pero no hay turno de caja abierto -> Apertura Obligatoria de Turno
  if (!activeShift && !loadingShift) {
    return (
      <OpenShiftModal
        cashier={activeCashier}
        onShiftOpened={(shift) => setActiveShift(shift)}
        onCancel={() => handleSetCashier(null)}
      />
    );
  }

  // 4. Estación de Ventas principal (siempre viva para preservar tickets y foco) + Pantallas superpuestas
  return (
    <div className="w-full h-full overflow-hidden flex flex-col relative">
      <div className="shrink-0">
        <LicenseBanner />
      </div>

      <div className="flex-1 min-h-0 w-full relative overflow-hidden">
        {/* VISTA DE VENTAS (F1): Siempre viva en DOM para no perder productos escaneados ni tickets */}
        <div className={currentView === "sales" ? "w-full h-full" : "hidden"}>
          <SalesStationPage
            cashier={activeCashier}
            terminalStatus={terminalStatus}
            activeShift={activeShift}
            isActive={currentView === "sales"}
            onLockTerminal={() => handleSetCashier(null)}
            onOpenCloseShiftModal={() => setShowCloseShiftModal(true)}
            onCloseApp={handleRequestCloseApp}
            onNavigateToProducts={handleNavigateToProducts}
            onNavigateToInventory={handleNavigateToInventory}
            onNavigateToSettings={handleNavigateToSettings}
          />
        </div>

        {/* VISTA DE CONFIGURACIÓN (F7) */}
        {currentView === "settings" && (
          <div className="absolute inset-0 z-40 bg-slate-100 dark:bg-slate-950 overflow-hidden">
            <SettingsPage
              terminalStatus={terminalStatus}
              onBackToSales={() => setCurrentView("sales")}
              onStatusUpdated={(status) => setTerminalStatus(status)}
              onUnpaired={() => {
                setTerminalStatus((prev) => (prev ? { ...prev, isPaired: false } : null));
                handleSetCashier(null);
              }}
            />
          </div>
        )}

        {/* VISTA DE PRODUCTOS E INVENTARIO (F3 / F4) */}
        {(currentView === "products" || currentView === "inventory") && (
          <div className="absolute inset-0 z-40 bg-slate-100 dark:bg-slate-950 overflow-hidden">
            <ProductsPage
              initialTab={currentView === "inventory" ? "inventory" : "catalog"}
              onBackToSales={() => setCurrentView("sales")}
            />
          </div>
        )}
      </div>

      {/* MODAL DE ARQUEO Y CIERRE DE TURNO (Z-REPORT) */}
      {showCloseShiftModal && (
        <CloseShiftModal
          onShiftClosed={async (_shift) => {
            // Asegurar que no quede ningún ticket abierto en memoria ni en localStorage
            localStorage.setItem("pos_active_tickets", JSON.stringify([{ id: 1, name: "Ticket 1", lines: [] }]));
            localStorage.setItem("pos_active_ticket_id", "1");
            window.dispatchEvent(new CustomEvent("pos:reset-tickets"));

            setActiveShift(null);
            setShowCloseShiftModal(false);
            handleSetCashier(null);
            if (exitActionPending) {
              setExitActionPending(false);
              await api.system.closeApp(true);
            }
          }}
          onCancel={() => {
            setShowCloseShiftModal(false);
            setExitActionPending(false);
          }}
        />
      )}

      {/* BANNER FLOTANTE DE ACTUALIZACIÓN AUTOMÁTICA */}
      <UpdateNotificationBanner />
    </div>
  );
}

export default App;
