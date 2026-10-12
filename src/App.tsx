import { useEffect, useState, useCallback } from "react";
import { api } from "./services/api";
import { ProductsPage } from "./pages/ProductsPage";
import { PairingScreen } from "./components/PairingScreen";
import { CashierLockScreen } from "./components/CashierLockScreen";
import type { AppInfo, CashierUser, TerminalStatus } from "./types";
import "./App.css";

function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [terminalStatus, setTerminalStatus] = useState<TerminalStatus | null>(null);
  const [activeCashier, setActiveCashier] = useState<CashierUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargarEstado = useCallback(async () => {
    try {
      const [appInfo, termStatus] = await Promise.all([
        api.appInfo(),
        api.auth.getTerminalStatus(),
      ]);
      setInfo(appInfo);
      setTerminalStatus(termStatus);
      if (termStatus.activeCashier) {
        setActiveCashier(termStatus.activeCashier);
      }
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargarEstado();
  }, [cargarEstado]);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0f172a", color: "#f8fafc" }}>
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

  // 3. Terminal desbloqueada con cajero activo
  return (
    <div className="layout">
      <aside className="sidebar">
        <h1 className="brand">Logiventa</h1>
        <div style={{ padding: "0 0.5rem 1rem", fontSize: "0.8rem", color: "#94a3b8" }}>
          <div><strong>{terminalStatus.cajaCodigo}</strong> · {terminalStatus.cajaNombre}</div>
          <div style={{ fontSize: "0.75rem", color: "#64748b" }}>{terminalStatus.empresaNombre}</div>
        </div>

        <nav>
          <a className="nav-item active">Productos</a>
          <a className="nav-item disabled">Ventas</a>
          <a className="nav-item disabled">Caja</a>
          <a className="nav-item disabled">Clientes</a>
          <a className="nav-item disabled">Reportes</a>
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
            🔒 Bloquear Caja
          </button>
        </div>
      </aside>

      <main className="content">
        <ProductsPage />
      </main>

      <footer className="statusbar">
        {error ? (
          <span className="error">Backend no disponible: {error}</span>
        ) : info ? (
          <span>
            v{info.version} · BD esquema v{info.schemaVersion} · Caja: {terminalStatus.cajaCodigo} · Empresa: {terminalStatus.empresaNombre}
          </span>
        ) : (
          <span>Conectando…</span>
        )}
      </footer>
    </div>
  );
}

export default App;
