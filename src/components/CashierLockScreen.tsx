import { useEffect, useState, useCallback } from "react";
import { api } from "../services/api";
import { useModals } from "../contexts/ModalContext";
import type { CashierUser, TerminalStatus } from "../types";

interface CashierLockScreenProps {
  status: TerminalStatus;
  onUnlocked: (cashier: CashierUser) => void;
  onUnpaired: () => void;
}

export function CashierLockScreen({
  status,
  onUnlocked,
  onUnpaired,
}: CashierLockScreenProps) {
  const { confirm } = useModals();
  const [pin, setPin] = useState("");
  const [cashiers, setCashiers] = useState<CashierUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargarCajeros = useCallback(async () => {
    try {
      const list = await api.auth.listCashiers();
      setCashiers(list);
    } catch (e) {
      console.error("Error al listar cajeros locales:", e);
    }
  }, []);

  useEffect(() => {
    cargarCajeros();
  }, [cargarCajeros]);

  const handlePinSubmit = useCallback(async (pinToTest: string) => {
    if (!pinToTest || pinToTest.length < 4) return;
    setLoading(true);
    setError(null);
    try {
      const cashier = await api.auth.loginPin(pinToTest);
      onUnlocked(cashier);
    } catch (err: unknown) {
      setError(String(err));
      setPin("");
    } finally {
      setLoading(false);
    }
  }, [onUnlocked]);

  const handleKeyPress = useCallback((digit: string) => {
    setPin((prev) => {
      if (prev.length >= 6) return prev;
      const next = prev + digit;
      if (next.length >= 4) {
        // Auto-intento si llega a 4 o 6
      }
      return next;
    });
  }, []);

  const handleBackspace = useCallback(() => {
    setPin((prev) => prev.slice(0, -1));
  }, []);

  const handleClear = useCallback(() => {
    setPin("");
    setError(null);
  }, []);

  // Soporte para teclado físico (0-9, Backspace, Enter, Esc)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= "0" && e.key <= "9") {
        handleKeyPress(e.key);
      } else if (e.key === "Backspace") {
        handleBackspace();
      } else if (e.key === "Enter") {
        handlePinSubmit(pin);
      } else if (e.key === "Escape") {
        handleClear();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pin, handleKeyPress, handleBackspace, handlePinSubmit, handleClear]);

  const handleSyncUsers = async () => {
    setSyncing(true);
    setError(null);
    try {
      const updated = await api.auth.syncUsers();
      setCashiers(updated);
    } catch (err: unknown) {
      setError(`Error al sincronizar usuarios con ERP: ${err}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleDesvincular = async () => {
    const ok = await confirm({
      title: "Desvincular Terminal",
      message: "¿Estás seguro de desvincular esta terminal de caja? Deberás emparejarla nuevamente para volver a operar.",
      variant: "danger",
      confirmText: "Sí, Desvincular",
      cancelText: "Cancelar",
    });
    if (ok) {
      try {
        await api.auth.unpair();
        onUnpaired();
      } catch (err: unknown) {
        setError(String(err));
      }
    }
  };

  return (
    <div style={styles.container}>
      {/* Barra Superior con Datos de Terminal */}
      <header style={styles.topBar}>
        <div style={styles.terminalInfo}>
          <div style={styles.indicatorOnline} title="Operando en SQLite local (Offline-First)" />
          <div>
            <div style={styles.empresaText}>
              {status.empresaNombre || "Empresa"} {status.empresaNit ? `(${status.empresaNit})` : ""}
            </div>
            <div style={styles.cajaText}>
              Terminal: <strong>{status.cajaCodigo || "CAJA"}</strong> — {status.cajaNombre || "Caja Principal"}
            </div>
          </div>
        </div>

        <div style={styles.topActions}>
          <button
            type="button"
            onClick={handleSyncUsers}
            disabled={syncing}
            style={styles.syncBtn}
            title="Sincronizar lista de usuarios desde el ERP"
          >
            {syncing ? "Sincronizando…" : "🔄 Sincronizar Usuarios"}
          </button>
          <button
            type="button"
            onClick={handleDesvincular}
            style={styles.unpairBtn}
            title="Desvincular este dispositivo del ERP"
          >
            Desvincular
          </button>
        </div>
      </header>

      {/* Contenido Central: Desbloqueo por PIN */}
      <main style={styles.centerArea}>
        <div style={styles.lockBox}>
          <div style={styles.avatarCircle}>🔒</div>
          <h2 style={styles.lockTitle}>Desbloqueo de Caja</h2>
          <p style={styles.lockSubtitle}>
            Ingresa tu PIN de 4 a 6 dígitos para abrir turno o iniciar ventas
          </p>

          {error && <div style={styles.errorBox}>{error}</div>}

          {/* Visor de PIN */}
          <div style={styles.pinDisplay}>
            {Array.from({ length: 6 }).map((_, i) => (
              <span
                key={i}
                style={{
                  ...styles.pinDot,
                  ...(i < pin.length ? styles.pinDotFilled : {}),
                }}
              />
            ))}
          </div>

          {/* Teclado Numérico en Pantalla */}
          <div style={styles.keypad}>
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => handleKeyPress(n)}
                style={styles.keyBtn}
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              onClick={handleClear}
              style={{ ...styles.keyBtn, ...styles.keyAction }}
            >
              C
            </button>
            <button
              type="button"
              onClick={() => handleKeyPress("0")}
              style={styles.keyBtn}
            >
              0
            </button>
            <button
              type="button"
              onClick={handleBackspace}
              style={{ ...styles.keyBtn, ...styles.keyAction }}
            >
              ⌫
            </button>
          </div>

          <button
            type="button"
            onClick={() => handlePinSubmit(pin)}
            disabled={loading || pin.length < 4}
            style={{
              ...styles.unlockBtn,
              ...(pin.length < 4 || loading ? styles.unlockDisabled : {}),
            }}
          >
            {loading ? "Verificando..." : "Entrar a la Caja (Enter)"}
          </button>

          {/* Cajeros locales disponibles */}
          {cashiers.length > 0 && (
            <div style={styles.cashiersFooter}>
              <span style={styles.footerLabel}>Cajeros registrados localmente:</span>
              <div style={styles.cashierTags}>
                {cashiers.map((c) => (
                  <span key={c.id} style={styles.cashierTag}>
                    👤 {c.fullName}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    background: "#0f172a",
    color: "#f8fafc",
    fontFamily: "Inter, system-ui, sans-serif",
  },
  topBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0.85rem 1.5rem",
    background: "#1e293b",
    borderBottom: "1px solid #334155",
  },
  terminalInfo: {
    display: "flex",
    alignItems: "center",
    gap: "0.85rem",
  },
  indicatorOnline: {
    width: "12px",
    height: "12px",
    borderRadius: "50%",
    background: "#22c55e",
    boxShadow: "0 0 8px #22c55e",
  },
  empresaText: {
    fontSize: "0.95rem",
    fontWeight: "bold",
    color: "#f8fafc",
  },
  cajaText: {
    fontSize: "0.8rem",
    color: "#94a3b8",
  },
  topActions: {
    display: "flex",
    gap: "0.5rem",
  },
  syncBtn: {
    background: "#334155",
    border: "none",
    borderRadius: "6px",
    color: "#e2e8f0",
    padding: "0.4rem 0.8rem",
    fontSize: "0.8rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  unpairBtn: {
    background: "transparent",
    border: "1px solid #475569",
    borderRadius: "6px",
    color: "#94a3b8",
    padding: "0.4rem 0.8rem",
    fontSize: "0.8rem",
    cursor: "pointer",
  },
  centerArea: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "1rem",
  },
  lockBox: {
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: "20px",
    width: "100%",
    maxWidth: "400px",
    padding: "2rem",
    textAlign: "center",
    boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
  },
  avatarCircle: {
    fontSize: "2rem",
    marginBottom: "0.5rem",
  },
  lockTitle: {
    fontSize: "1.4rem",
    fontWeight: "bold",
    margin: "0 0 0.25rem",
  },
  lockSubtitle: {
    fontSize: "0.85rem",
    color: "#94a3b8",
    margin: "0 0 1.5rem",
  },
  pinDisplay: {
    display: "flex",
    justifyContent: "center",
    gap: "0.75rem",
    marginBottom: "1.5rem",
  },
  pinDot: {
    width: "14px",
    height: "14px",
    borderRadius: "50%",
    border: "2px solid #475569",
    background: "transparent",
    transition: "all 0.15s ease",
  },
  pinDotFilled: {
    background: "#3b82f6",
    borderColor: "#3b82f6",
    transform: "scale(1.15)",
  },
  keypad: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "0.6rem",
    marginBottom: "1.25rem",
  },
  keyBtn: {
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: "12px",
    color: "#f8fafc",
    fontSize: "1.4rem",
    fontWeight: "bold",
    padding: "0.85rem 0",
    cursor: "pointer",
    transition: "background 0.1s ease, transform 0.05s ease",
  },
  keyAction: {
    fontSize: "1.1rem",
    color: "#94a3b8",
  },
  unlockBtn: {
    width: "100%",
    background: "#2563eb",
    border: "none",
    borderRadius: "10px",
    color: "#ffffff",
    fontWeight: "bold",
    padding: "0.85rem",
    fontSize: "1rem",
    cursor: "pointer",
    transition: "background 0.15s ease",
  },
  unlockDisabled: {
    opacity: 0.4,
    cursor: "not-allowed",
  },
  errorBox: {
    background: "rgba(239, 68, 68, 0.15)",
    border: "1px solid rgba(239, 68, 68, 0.4)",
    color: "#fca5a5",
    padding: "0.5rem",
    borderRadius: "8px",
    fontSize: "0.85rem",
    marginBottom: "1rem",
  },
  cashiersFooter: {
    marginTop: "1.5rem",
    borderTop: "1px solid #334155",
    paddingTop: "1rem",
    textAlign: "left",
  },
  footerLabel: {
    fontSize: "0.75rem",
    color: "#64748b",
    display: "block",
    marginBottom: "0.4rem",
  },
  cashierTags: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.35rem",
  },
  cashierTag: {
    background: "#0f172a",
    padding: "0.25rem 0.5rem",
    borderRadius: "6px",
    fontSize: "0.75rem",
    color: "#94a3b8",
  },
};
