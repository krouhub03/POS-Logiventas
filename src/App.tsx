import { useEffect, useState } from "react";
import { api } from "./services/api";
import { ProductsPage } from "./pages/ProductsPage";
import type { AppInfo } from "./types";
import "./App.css";

function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.appInfo().then(setInfo).catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1 className="brand">Logiventa</h1>
        <nav>
          <a className="nav-item active">Productos</a>
          <a className="nav-item disabled">Ventas</a>
          <a className="nav-item disabled">Caja</a>
          <a className="nav-item disabled">Clientes</a>
          <a className="nav-item disabled">Reportes</a>
        </nav>
      </aside>

      <main className="content">
        <ProductsPage />
      </main>

      <footer className="statusbar">
        {error ? (
          <span className="error">Backend no disponible: {error}</span>
        ) : info ? (
          <span>
            v{info.version} · BD esquema v{info.schemaVersion} · {info.dbPath}
          </span>
        ) : (
          <span>Conectando…</span>
        )}
      </footer>
    </div>
  );
}

export default App;
