import { useEffect, useState, useCallback } from "react";
import { api } from "./services/api";
import { ProductsPage } from "./pages/ProductsPage";
import { SalesStationPage } from "./pages/SalesStationPage";
import { SettingsPage } from "./pages/SettingsPage";
import { PairingScreen } from "./components/PairingScreen";
import { CashierLockScreen } from "./components/CashierLockScreen";
import type { CashierUser, TerminalStatus } from "./types";
import "./App.css";

function App() {
  const [terminalStatus, setTerminalStatus] = useState<TerminalStatus | null>(null);
  const [activeCashier, setActiveCashier] = useState<CashierUser | null>(() => {
    try {
      const saved = localStorage.getItem("pos_active_cashier");
      return saved ? (JSON.parse(saved) as CashierUser) : null;
    } catch {
      return null;
    }
  });
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

  // Auditoría y Latido Periódico (cada 15s):
  // Si la caja es eliminada, desactivada o revocada en el ERP Megalider,
  // el POS expulsa al cajero y bloquea la terminal en la pantalla de vinculación.
  useEffect(() => {
    if (!terminalStatus?.isPaired) return;

    const interval = setInterval(async () => {
      try {
        const liveStatus = await api.auth.validateSession();
        if (!liveStatus.isPaired) {
          console.warn("[SEGURIDAD POS] La caja fue eliminada o revocada en el ERP. Cerrando sesión de cajero...");
          setTerminalStatus(liveStatus);
          handleSetCashier(null);
        }
      } catch (err) {
        // En caso de corte de red momentáneo, la política Offline-First de validateSession
        // no desvincula la terminal local.
      }
    }, 15000);

    return () => clearInterval(interval);
  }, [terminalStatus?.isPaired]);


  // Atajos globales para cambiar de vista (F1 = Ventas, F3 = Productos, F4 = Inventario, F7 = Configuración)
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if (!activeCashier) return;
      if (e.key === "F1") {
        e.preventDefault();
        setCurrentView("sales");
      } else if (e.key === "F3") {
        e.preventDefault();
        setCurrentView("products");
      } else if (e.key === "F4") {
        e.preventDefault();
        setCurrentView("inventory");
      } else if (e.key === "F7") {
        e.preventDefault();
        setCurrentView("settings");
      } else if (e.key === "F11") {
        e.preventDefault();
        api.system.toggleFullscreen().catch(console.error);
      }
    };
    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  }, [activeCashier]);

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
        onPaired={(newStatus) => {
          setTerminalStatus(newStatus);
          handleSetCashier(null);
        }}
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

  // 3. Estación de Ventas principal (siempre viva para preservar tickets y foco) + Pantallas superpuestas
  return (
    <div className="w-screen h-screen overflow-hidden relative">
      {/* VISTA DE VENTAS (F1): Siempre viva en DOM para no perder productos escaneados ni tickets */}
      <div className={currentView === "sales" ? "w-full h-full" : "hidden"}>
        <SalesStationPage
          cashier={activeCashier}
          terminalStatus={terminalStatus}
          isActive={currentView === "sales"}
          onLockTerminal={() => handleSetCashier(null)}
          onNavigateToProducts={() => setCurrentView("products")}
          onNavigateToInventory={() => setCurrentView("inventory")}
          onNavigateToSettings={() => setCurrentView("settings")}
        />
      </div>

      {/* VISTA DE CONFIGURACIÓN (F7) */}
      {currentView === "settings" && (
        <div className="absolute inset-0 z-40 bg-slate-100 dark:bg-slate-950">
          <SettingsPage
            terminalStatus={terminalStatus}
            onBackToSales={() => setCurrentView("sales")}
            onUnpaired={() => {
              setTerminalStatus((prev) => (prev ? { ...prev, isPaired: false } : null));
              handleSetCashier(null);
            }}
          />
        </div>
      )}

      {/* VISTA DE PRODUCTOS E INVENTARIO (F3 / F4) */}
      {(currentView === "products" || currentView === "inventory") && (
        <div className="absolute inset-0 z-40 bg-slate-100 dark:bg-slate-950">
          <ProductsPage
            initialTab={currentView === "inventory" ? "inventory" : "catalog"}
            onBackToSales={() => setCurrentView("sales")}
          />
        </div>
      )}
    </div>
  );
}

export default App;
