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
    } catch (e: unknown) {
      console.error("Error al cargar estado de terminal:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargarEstado();
  }, [cargarEstado]);

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

  // 3. Pantalla de Configuración del Sistema (F7)
  if (currentView === "settings") {
    return (
      <SettingsPage
        terminalStatus={terminalStatus}
        onBackToSales={() => setCurrentView("sales")}
        onUnpaired={() => {
          setTerminalStatus((prev) => (prev ? { ...prev, isPaired: false } : null));
          handleSetCashier(null);
        }}
      />
    );
  }

  // 4. Estación de Ventas principal (Eleventa-Style) (F1)
  if (currentView === "sales") {
    return (
      <SalesStationPage
        cashier={activeCashier}
        terminalStatus={terminalStatus}
        onLockTerminal={() => handleSetCashier(null)}
        onNavigateToProducts={() => setCurrentView("products")}
        onNavigateToInventory={() => setCurrentView("inventory")}
        onNavigateToSettings={() => setCurrentView("settings")}
      />
    );
  }

  // 5. Catálogo de productos y control de inventario (F3 / F4)
  return (
    <ProductsPage
      initialTab={currentView === "inventory" ? "inventory" : "catalog"}
      onBackToSales={() => setCurrentView("sales")}
    />
  );
}

export default App;
