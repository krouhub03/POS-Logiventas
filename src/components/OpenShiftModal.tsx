import { useState, useRef, useEffect } from "react";
import { api } from "../services/api";
import type { CashShift, CashierUser } from "../types";

interface OpenShiftModalProps {
  cashier: CashierUser;
  onShiftOpened: (shift: CashShift) => void;
  onCancel?: () => void;
}

export function OpenShiftModal({ cashier, onShiftOpened, onCancel }: OpenShiftModalProps) {
  const [openingPesos, setOpeningPesos] = useState<string>("0");
  const [notes, setNotes] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onCancel) {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const parsedPesos = parseFloat(openingPesos) || 0;
      if (parsedPesos < 0) {
        setError("La base inicial no puede ser un valor negativo");
        setLoading(false);
        return;
      }

      const openingCents = Math.round(parsedPesos * 100);
      const shift = await api.shifts.openShift(cashier.id, {
        openingCents,
        notes: notes.trim() ? notes.trim() : undefined,
      });

      onShiftOpened(shift);
    } catch (err: unknown) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <div style={styles.badge}>TURNO DE CAJA</div>
          <h2 style={styles.title}>Apertura de Caja y Turno</h2>
          <p style={styles.subtitle}>
            Responsable: <strong>{cashier.fullName}</strong> ({cashier.role})
          </p>
        </div>

        {error && <div style={styles.errorBanner}>{error}</div>}

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label}>Base Inicial en Efectivo (Monedas y Billetes)</label>
            <div style={styles.inputWrapper}>
              <span style={styles.currencyPrefix}>$</span>
              <input
                ref={inputRef}
                style={styles.input}
                type="number"
                step="any"
                min="0"
                required
                value={openingPesos}
                onChange={(e) => setOpeningPesos(e.target.value)}
                placeholder="0"
              />
            </div>
            <span style={styles.hint}>
              Ingresa el saldo en efectivo con el que inicias operaciones en tu cajón.
            </span>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Observaciones de Apertura (Opcional)</label>
            <input
              style={styles.inputSimple}
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej. Recibido de supervisor turno mañana..."
            />
          </div>

          <div style={styles.actions}>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                disabled={loading}
                style={styles.cancelBtn}
              >
                Cancelar
              </button>
            )}
            <button
              type="submit"
              disabled={loading}
              style={{
                ...styles.submitBtn,
                ...(loading ? styles.btnDisabled : {}),
              }}
            >
              {loading ? "Abriendo Turno..." : "Abrir Turno e Iniciar Ventas (Enter)"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(3, 7, 18, 0.85)",
    backdropFilter: "blur(6px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
  },
  modal: {
    background: "#0f172a",
    border: "1px solid #1e293b",
    borderRadius: "16px",
    width: "480px",
    maxWidth: "92vw",
    padding: "2rem",
    boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7)",
  },
  header: {
    textAlign: "center",
    marginBottom: "1.5rem",
  },
  badge: {
    display: "inline-block",
    background: "rgba(16, 185, 129, 0.15)",
    color: "#10b981",
    fontSize: "0.75rem",
    fontWeight: 700,
    letterSpacing: "0.08em",
    padding: "0.25rem 0.65rem",
    borderRadius: "9999px",
    marginBottom: "0.5rem",
    border: "1px solid rgba(16, 185, 129, 0.3)",
  },
  title: {
    fontSize: "1.4rem",
    fontWeight: 700,
    color: "#f8fafc",
    margin: "0.25rem 0",
  },
  subtitle: {
    fontSize: "0.85rem",
    color: "#94a3b8",
    margin: 0,
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "1.2rem",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: "0.35rem",
  },
  label: {
    fontSize: "0.78rem",
    fontWeight: 600,
    color: "#cbd5e1",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  inputWrapper: {
    position: "relative",
    display: "flex",
    alignItems: "center",
  },
  currencyPrefix: {
    position: "absolute",
    left: "1rem",
    color: "#64748b",
    fontSize: "1.4rem",
    fontWeight: 700,
  },
  input: {
    width: "100%",
    background: "#020617",
    border: "2px solid #334155",
    borderRadius: "10px",
    padding: "0.75rem 1rem 0.75rem 2.2rem",
    fontSize: "1.5rem",
    fontWeight: 700,
    color: "#38bdf8",
    outline: "none",
  },
  inputSimple: {
    width: "100%",
    background: "#020617",
    border: "1px solid #334155",
    borderRadius: "8px",
    padding: "0.65rem 0.85rem",
    fontSize: "0.9rem",
    color: "#f8fafc",
    outline: "none",
  },
  hint: {
    fontSize: "0.75rem",
    color: "#64748b",
  },
  actions: {
    display: "flex",
    gap: "0.75rem",
    marginTop: "0.5rem",
  },
  cancelBtn: {
    flex: 1,
    background: "#1e293b",
    border: "1px solid #334155",
    color: "#cbd5e1",
    padding: "0.75rem",
    borderRadius: "8px",
    fontWeight: 600,
    cursor: "pointer",
  },
  submitBtn: {
    flex: 2,
    background: "#10b981",
    border: "none",
    color: "#ffffff",
    padding: "0.75rem",
    borderRadius: "8px",
    fontWeight: 700,
    fontSize: "0.95rem",
    cursor: "pointer",
  },
  btnDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  errorBanner: {
    background: "rgba(239, 68, 68, 0.15)",
    border: "1px solid rgba(239, 68, 68, 0.4)",
    color: "#fca5a5",
    padding: "0.65rem 0.85rem",
    borderRadius: "8px",
    fontSize: "0.85rem",
    marginBottom: "1rem",
  },
};
