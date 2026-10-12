import { useEffect, useState, useCallback } from "react";
import { api } from "./services/api";
import { ProductsPage } from "./pages/ProductsPage";
import { SalesStationPage } from "./pages/SalesStationPage";
import { PairingScreen } from "./components/PairingScreen";
import { CashierLockScreen } from "./components/CashierLockScreen";
import type { CashierUser, TerminalStatus } from "./types";
import "./App.css";

function App() {
  const [terminalStatus, setTerminalStatus] = useState<TerminalStatus | null>(null);
  const [activeCashier, setActiveCashier] = useState<CashierUser | null>(null);
  const [currentView, setCurrentView] = useState<"sales" | "products">("sales");
  const [loading, setLoading] = useState(true);

  const cargarEstado = useCallback(async () => {
    try {
      const termStatus = await api.auth.getTerminalStatus();
      setTerminalStatus(termStatus);
      if (termStatus.activeCashier) {
        setActiveCashier(termStatus.activeCashier);
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

  // Atajo global para cambiar de vista (F1 = Ventas, F3 = Productos)
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if (!activeCashier) return;
      if (e.key === "F1") {
        e.preventDefault();
        setCurrentView("sales");
      } else if (e.key === "F3") {
        e.preventDefault();
        setCurrentView("products");
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
          setActiveCashier(null);
        }}
      />
    );
  }

  // 2. Si está vinculada pero no hay cajero autenticado -> Pantalla de bloqueo con PIN
  if (!activeCashier) {
    return (
      <CashierLockScreen
        status={terminalStatus}
        onUnlocked={(cashier) => setActiveCashier(cashier)}
        onUnpaired={() => {
          setTerminalStatus((prev) => (prev ? { ...prev, isPaired: false } : null));
          setActiveCashier(null);
        }}
      />
    );
  }

  // 3. Estación de Ventas principal (Eleventa-Style)
  if (currentView === "sales") {
    return (
      <SalesStationPage
        cashier={activeCashier}
        terminalStatus={terminalStatus}
        onLockTerminal={() => setActiveCashier(null)}
        onNavigateToProducts={() => setCurrentView("products")}
      />
    );
  }

  // 4. Catálogo de productos (F3)
  return (
    <div className="layout">
      <aside className="sidebar">
        <h1 className="brand">Logiventa</h1>
        <div style={{ padding: "0 0.5rem 1rem", fontSize: "0.8rem", color: "#94a3b8" }}>
          <div><strong>{terminalStatus.cajaCodigo}</strong> · {terminalStatus.cajaNombre}</div>
          <div style={{ fontSize: "0.75rem", color: "#64748b" }}>{terminalStatus.empresaNombre}</div>
        </div>

        <nav>
          <button
            type="button"
            className="nav-item"
            onClick={() => setCurrentView("sales")}
            style={{ width: "100%", textAlign: "left", background: "transparent", border: "none", cursor: "pointer" }}
          >
            ← Volver a Ventas (F1)
          </button>
          <a className="nav-item active">Productos (F3)</a>
        </nav>

        <div style={{ marginTop: "auto", paddingTop: "1rem", borderTop: "1px solid #374151" }}>
          <div style={{ fontSize: "0.85rem", color: "#f3f4f6", fontWeight: "bold" }}>
            👤 {activeCashier.fullName}
          </div>
          <div style={{ fontSize: "0.75rem", color: "#9ca3af", marginBottom: "0.75rem" }}>
            Rol: {activeCashier.role}
          </div>
          <button
            type="button"
            onClick={() => setActiveCashier(null)}
            style={{
              width: "100%",
              background: "#374151",
              border: "none",
              color: "#e5e7eb",
              borderRadius: "6px",
              padding: "0.4rem",
              fontSize: "0.8rem",
              cursor: "pointer",
            }}
          >
            🔒 Bloquear Caja (Esc)
          </button>
        </div>
      </aside>

      <main className="content">
        <ProductsPage />
      </main>
    </div>
  );
}

export default App;
