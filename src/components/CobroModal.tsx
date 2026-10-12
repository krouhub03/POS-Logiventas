import { useState, useEffect, useRef } from "react";
import { formatCents, toCents } from "../lib/money";
import type { PaymentInput } from "../types";

interface CobroModalProps {
  totalCents: number;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (payments: PaymentInput[]) => Promise<void>;
}

export function CobroModal({ totalCents, isOpen, onClose, onConfirm }: CobroModalProps) {
  const [method, setMethod] = useState<"cash" | "card" | "transfer">("cash");
  const [pagoInput, setPagoInput] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Inicializar pagoInput con el total al abrir
  useEffect(() => {
    if (isOpen) {
      setPagoInput((totalCents / 100).toString());
      setMethod("cash");
      setError(null);
      setTimeout(() => inputRef.current?.select(), 50);
    }
  }, [isOpen, totalCents]);

  const pagoCents = toCents(pagoInput || 0);
  const cambioCents = Math.max(0, pagoCents - totalCents);
  const faltaCents = Math.max(0, totalCents - pagoCents);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (pagoCents < totalCents) {
      setError(`Monto insuficiente. Faltan ${formatCents(faltaCents)}`);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await onConfirm([
        {
          method,
          amountCents: pagoCents,
        },
      ]);
      onClose();
    } catch (err: unknown) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  // Atajos de teclado en el modal (F1=Efectivo, F2=Tarjeta, F3=Transferencia, Esc=Cerrar, Enter=Cobrar)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "F1") {
        e.preventDefault();
        setMethod("cash");
      } else if (e.key === "F2") {
        e.preventDefault();
        setMethod("card");
      } else if (e.key === "F3") {
        e.preventDefault();
        setMethod("transfer");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Billetes rápidos sugeridos
  const sugerencias = [
    totalCents / 100,
    Math.ceil(totalCents / 5000) * 50,
    Math.ceil(totalCents / 10000) * 100,
    Math.ceil(totalCents / 20000) * 200,
    Math.ceil(totalCents / 50000) * 500,
  ].filter((v, idx, arr) => v >= totalCents / 100 && arr.indexOf(v) === idx && v > 0).slice(0, 4);

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h2 style={styles.title}>Cobrar Venta [F12]</h2>
          <button type="button" onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>

        {error && <div style={styles.errorBox}>{error}</div>}

        <div style={styles.body}>
          {/* Métodos de Pago */}
          <div style={styles.methodsRow}>
            <button
              type="button"
              style={{
                ...styles.methodBtn,
                ...(method === "cash" ? styles.methodActive : {}),
              }}
              onClick={() => setMethod("cash")}
            >
              💵 [F1] Efectivo
            </button>
            <button
              type="button"
              style={{
                ...styles.methodBtn,
                ...(method === "card" ? styles.methodActive : {}),
              }}
              onClick={() => setMethod("card")}
            >
              💳 [F2] Tarjeta
            </button>
            <button
              type="button"
              style={{
                ...styles.methodBtn,
                ...(method === "transfer" ? styles.methodActive : {}),
              }}
              onClick={() => setMethod("transfer")}
            >
              📱 [F3] Transferencia / QR
            </button>
          </div>

          {/* Resumen Financiero */}
          <div style={styles.amountsCard}>
            <div style={styles.amountCol}>
              <span style={styles.amountLabel}>Total a Cobrar</span>
              <span style={styles.totalValue}>{formatCents(totalCents)}</span>
            </div>

            <div style={styles.amountCol}>
              <span style={styles.amountLabel}>Pago del Cliente</span>
              <input
                ref={inputRef}
                style={styles.payInput}
                type="number"
                step="any"
                value={pagoInput}
                onChange={(e) => setPagoInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmit();
                }}
              />
            </div>

            <div style={styles.amountCol}>
              <span style={styles.amountLabel}>Cambio (Vuelto)</span>
              <span style={{ ...styles.cambioValue, color: faltaCents > 0 ? "#ef4444" : "#10b981" }}>
                {faltaCents > 0 ? `Faltan ${formatCents(faltaCents)}` : formatCents(cambioCents)}
              </span>
            </div>
          </div>

          {/* Billetes rápidos */}
          {method === "cash" && sugerencias.length > 0 && (
            <div style={styles.sugerenciasRow}>
              <span style={styles.sugLabel}>Billetes rápidos:</span>
              {sugerencias.map((s, idx) => (
                <button
                  key={idx}
                  type="button"
                  style={styles.sugBtn}
                  onClick={() => {
                    setPagoInput(s.toString());
                    inputRef.current?.focus();
                  }}
                >
                  ${s.toLocaleString()}
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={styles.footer}>
          <button type="button" onClick={onClose} style={styles.cancelBtn}>
            [Esc] Cancelar
          </button>
          <button
            type="button"
            onClick={() => handleSubmit()}
            disabled={loading || pagoCents < totalCents}
            style={{
              ...styles.confirmBtn,
              ...(loading || pagoCents < totalCents ? styles.btnDisabled : {}),
            }}
          >
            {loading ? "Procesando Venta…" : "Cobrar e Imprimir Ticket (Enter)"}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0, 0, 0, 0.75)",
    backdropFilter: "blur(4px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
  },
  modal: {
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: "16px",
    width: "100%",
    maxWidth: "580px",
    boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.6)",
    color: "#f8fafc",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "1rem 1.5rem",
    borderBottom: "1px solid #334155",
    background: "#0f172a",
  },
  title: {
    margin: 0,
    fontSize: "1.25rem",
    fontWeight: "bold",
  },
  closeBtn: {
    background: "transparent",
    border: "none",
    color: "#94a3b8",
    fontSize: "1.2rem",
    cursor: "pointer",
  },
  body: {
    padding: "1.5rem",
  },
  methodsRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: "0.5rem",
    marginBottom: "1.5rem",
  },
  methodBtn: {
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: "8px",
    color: "#94a3b8",
    padding: "0.75rem 0.5rem",
    fontSize: "0.85rem",
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.15s ease",
  },
  methodActive: {
    background: "#2563eb",
    borderColor: "#3b82f6",
    color: "#ffffff",
    boxShadow: "0 0 10px rgba(37, 99, 235, 0.4)",
  },
  amountsCard: {
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: "12px",
    padding: "1.25rem",
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
  },
  amountCol: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  amountLabel: {
    fontSize: "0.9rem",
    fontWeight: 600,
    color: "#94a3b8",
  },
  totalValue: {
    fontSize: "1.6rem",
    fontWeight: "bold",
    color: "#60a5fa",
    fontFamily: "monospace",
  },
  payInput: {
    background: "#1e293b",
    border: "2px solid #3b82f6",
    borderRadius: "8px",
    padding: "0.5rem 0.75rem",
    fontSize: "1.6rem",
    fontWeight: "bold",
    color: "#f8fafc",
    width: "180px",
    textAlign: "right",
    fontFamily: "monospace",
    outline: "none",
  },
  cambioValue: {
    fontSize: "1.6rem",
    fontWeight: "bold",
    fontFamily: "monospace",
  },
  sugerenciasRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    marginTop: "1rem",
    flexWrap: "wrap",
  },
  sugLabel: {
    fontSize: "0.8rem",
    color: "#64748b",
  },
  sugBtn: {
    background: "#334155",
    border: "1px solid #475569",
    borderRadius: "6px",
    color: "#f8fafc",
    padding: "0.35rem 0.65rem",
    fontSize: "0.85rem",
    fontWeight: "bold",
    cursor: "pointer",
  },
  footer: {
    display: "flex",
    justifyContent: "space-between",
    padding: "1rem 1.5rem",
    borderTop: "1px solid #334155",
    background: "#0f172a",
  },
  cancelBtn: {
    background: "transparent",
    border: "1px solid #475569",
    borderRadius: "8px",
    color: "#94a3b8",
    padding: "0.6rem 1rem",
    cursor: "pointer",
    fontSize: "0.9rem",
  },
  confirmBtn: {
    background: "#16a34a",
    border: "none",
    borderRadius: "8px",
    color: "#ffffff",
    padding: "0.6rem 1.5rem",
    fontSize: "0.95rem",
    fontWeight: "bold",
    cursor: "pointer",
    boxShadow: "0 0 15px rgba(22, 163, 74, 0.4)",
  },
  btnDisabled: {
    opacity: 0.4,
    cursor: "not-allowed",
  },
  errorBox: {
    background: "rgba(239, 68, 68, 0.15)",
    border: "1px solid rgba(239, 68, 68, 0.4)",
    color: "#fca5a5",
    padding: "0.65rem 1rem",
    margin: "1rem 1.5rem 0",
    borderRadius: "8px",
    fontSize: "0.85rem",
  },
};
