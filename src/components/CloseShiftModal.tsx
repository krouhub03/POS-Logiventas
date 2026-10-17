import { useState, useEffect, useRef } from "react";
import { api } from "../services/api";
import { formatCents } from "../lib/money";
import type { CashShift, ShiftSummary } from "../types";

interface CloseShiftModalProps {
  onShiftClosed: (shift: CashShift) => void;
  onCancel: () => void;
}

export function CloseShiftModal({ onShiftClosed, onCancel }: CloseShiftModalProps) {
  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [declaredPesos, setDeclaredPesos] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.shifts
      .getShiftSummary()
      .then((data) => {
        setSummary(data);
        setLoadingSummary(false);
        // Por seguridad y auditoría de arqueo ciego, se inicializa vacío para que el cajero cuente el dinero
        setTimeout(() => inputRef.current?.focus(), 100);
      })
      .catch((err) => {
        setError("Error al cargar resumen del turno: " + String(err));
        setLoadingSummary(false);
      });
  }, []);

  const declaredCents = Math.round((parseFloat(declaredPesos) || 0) * 100);
  const expectedCents = summary?.expectedCashCents ?? 0;
  const differenceCents = declaredPesos === "" ? 0 : declaredCents - expectedCents;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!summary) return;

    if (declaredPesos.trim() === "") {
      setError("Debes ingresar el conteo físico de efectivo en caja para realizar el arqueo.");
      return;
    }

    if (parseFloat(declaredPesos) < 0) {
      setError("El efectivo declarado no puede ser negativo.");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const closedShift = await api.shifts.closeShift({
        declaredCents,
        notes: notes.trim() ? notes.trim() : undefined,
      });

      // Imprimir Z-Report si hay impresora configurada
      api.settings.testPrintTicket().catch(() => {});

      onShiftClosed(closedShift);
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
          <div style={styles.badge}>CORTE Z / NIIF v6.2</div>
          <h2 style={styles.title}>Cierre de Turno y Arqueo Z-Report</h2>
          {summary && (
            <p style={styles.subtitle}>
              Folio: <strong>{summary.folio}</strong> | Cajero: <strong>{summary.userName}</strong>
            </p>
          )}
        </div>

        {error && <div style={styles.errorBanner}>{error}</div>}

        {loadingSummary ? (
          <div style={styles.loadingBox}>Cargando resumen de ventas y recaudos...</div>
        ) : summary ? (
          <form onSubmit={handleSubmit} style={styles.form}>
            {/* Panel de Resumen Financiero */}
            <div style={styles.summaryGrid}>
              <div style={styles.summaryCard}>
                <span style={styles.cardLabel}>Base Inicial</span>
                <span style={styles.cardValue}>{formatCents(summary.openingCents)}</span>
              </div>
              <div style={styles.summaryCard}>
                <span style={styles.cardLabel}>Ventas Efectivo</span>
                <span style={styles.cardValueGreen}>+{formatCents(summary.cashSalesCents)}</span>
              </div>
              <div style={styles.summaryCard}>
                <span style={styles.cardLabel}>Abonos Cartera (Efectivo)</span>
                <span style={styles.cardValueGreen}>+{formatCents(summary.customerPaymentsCashCents)}</span>
              </div>
              <div style={{ ...styles.summaryCard, borderColor: "#0284c7", background: "rgba(2, 132, 199, 0.08)" }}>
                <span style={{ ...styles.cardLabel, color: "#38bdf8" }}>Efectivo Esperado en Caja</span>
                <span style={styles.cardValueBlue}>{formatCents(summary.expectedCashCents)}</span>
              </div>
              <div style={styles.summaryCard}>
                <span style={styles.cardLabel}>Otras Ventas (Tarj/Transf/Crédito)</span>
                <span style={styles.cardValue}>
                  {formatCents(summary.cardSalesCents + summary.transferSalesCents + summary.otherSalesCents)}
                </span>
              </div>
              {summary.customerPaymentsOtherCents > 0 ? (
                <div style={styles.summaryCard}>
                  <span style={styles.cardLabel}>Abonos Cartera (Otros Medios)</span>
                  <span style={styles.cardValue}>
                    {formatCents(summary.customerPaymentsOtherCents)}
                  </span>
                </div>
              ) : (
                <div style={styles.summaryCard}>
                  <span style={styles.cardLabel}>Total Facturado (Turno)</span>
                  <span style={styles.cardValue}>
                    {formatCents(summary.totalSalesCents)}
                  </span>
                </div>
              )}
            </div>

            <div style={styles.formulaNotice}>
              ℹ️ <strong>Cuadre de Efectivo:</strong> Base ({formatCents(summary.openingCents)}) + Ventas Efectivo ({formatCents(summary.cashSalesCents)}) + Abonos Efectivo ({formatCents(summary.customerPaymentsCashCents)}) = <strong>{formatCents(summary.expectedCashCents)}</strong>
            </div>

            {/* Campo de Arqueo Físico */}
            <div style={styles.field}>
              <label style={styles.label}>
                Efectivo Físico Contado en Cajón (Arqueo de Cierre)
              </label>
              <div style={styles.inputWrapper}>
                <span style={styles.currencyPrefix}>$</span>
                <input
                  ref={inputRef}
                  style={styles.input}
                  type="number"
                  step="any"
                  min="0"
                  required
                  placeholder="0.00"
                  value={declaredPesos}
                  onChange={(e) => setDeclaredPesos(e.target.value)}
                />
              </div>
              <span style={styles.hint}>
                Cuenta físicamente todos los billetes y monedas que entregas en caja.
              </span>
            </div>

            {/* Indicador de Diferencia de Arqueo */}
            {declaredPesos !== "" && (
              <div
                style={{
                  ...styles.differenceBox,
                  ...(differenceCents === 0
                    ? styles.diffBalanced
                    : differenceCents < 0
                    ? styles.diffShortage
                    : styles.diffSurplus),
                }}
              >
                <div>
                  <strong>
                    {differenceCents === 0
                      ? "✓ Cuadre Perfecto (Sin Diferencia)"
                      : differenceCents < 0
                      ? "⚠️ Faltante de Caja"
                      : "ℹ️ Sobrante de Caja"}
                  </strong>
                  <div style={{ fontSize: "0.8rem", opacity: 0.9 }}>
                    {differenceCents < 0
                      ? "Se contabilizará como cuenta por cobrar al cajero."
                      : differenceCents > 0
                      ? "Se contabilizará como ingreso por sobrante de caja."
                      : "La caja cierra con cero diferencias contables."}
                  </div>
                </div>
                <div style={{ fontSize: "1.2rem", fontWeight: 800 }}>
                  {formatCents(Math.abs(differenceCents))}
                </div>
              </div>
            )}

            <div style={styles.field}>
              <label style={styles.label}>Observaciones / Justificación de Cierre</label>
              <input
                style={styles.inputSimple}
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ej. Cierre de turno sin novedades, dinero entregado a administración."
              />
            </div>

            <div style={styles.actions}>
              <button
                type="button"
                onClick={onCancel}
                disabled={loading}
                style={styles.cancelBtn}
              >
                Volver al POS
              </button>
              <button
                type="submit"
                disabled={loading || declaredPesos === ""}
                style={{
                  ...styles.submitBtn,
                  ...(loading || declaredPesos === "" ? styles.btnDisabled : {}),
                }}
              >
                {loading ? "Consolidando en ERP..." : "Confirmar Cierre y Enviar Z-Report"}
              </button>
            </div>
          </form>
        ) : null}
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
    background: "rgba(3, 7, 18, 0.88)",
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
    width: "560px",
    maxWidth: "94vw",
    padding: "2rem",
    boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.75)",
  },
  header: {
    textAlign: "center",
    marginBottom: "1.25rem",
  },
  badge: {
    display: "inline-block",
    background: "rgba(59, 130, 246, 0.15)",
    color: "#60a5fa",
    fontSize: "0.75rem",
    fontWeight: 700,
    letterSpacing: "0.08em",
    padding: "0.25rem 0.65rem",
    borderRadius: "9999px",
    marginBottom: "0.5rem",
    border: "1px solid rgba(59, 130, 246, 0.3)",
  },
  title: {
    fontSize: "1.35rem",
    fontWeight: 700,
    color: "#f8fafc",
    margin: "0.25rem 0",
  },
  subtitle: {
    fontSize: "0.85rem",
    color: "#94a3b8",
    margin: 0,
  },
  loadingBox: {
    textAlign: "center",
    padding: "3rem 1rem",
    color: "#94a3b8",
    fontSize: "0.95rem",
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "0.65rem",
    marginBottom: "0.75rem",
  },
  formulaNotice: {
    background: "rgba(15, 23, 42, 0.6)",
    border: "1px dashed #334155",
    borderRadius: "8px",
    padding: "0.5rem 0.75rem",
    fontSize: "0.75rem",
    color: "#94a3b8",
    marginBottom: "1rem",
    lineHeight: 1.4,
  },
  summaryCard: {
    background: "#020617",
    border: "1px solid #1e293b",
    borderRadius: "8px",
    padding: "0.75rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.2rem",
  },
  cardLabel: {
    fontSize: "0.7rem",
    fontWeight: 600,
    color: "#64748b",
    textTransform: "uppercase",
  },
  cardValue: {
    fontSize: "1.05rem",
    fontWeight: 700,
    color: "#f8fafc",
  },
  cardValueGreen: {
    fontSize: "1.05rem",
    fontWeight: 700,
    color: "#10b981",
  },
  cardValueBlue: {
    fontSize: "1.1rem",
    fontWeight: 800,
    color: "#38bdf8",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
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
  differenceBox: {
    padding: "0.85rem 1rem",
    borderRadius: "8px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  diffBalanced: {
    background: "rgba(16, 185, 129, 0.12)",
    border: "1px solid rgba(16, 185, 129, 0.35)",
    color: "#34d399",
  },
  diffShortage: {
    background: "rgba(239, 68, 68, 0.12)",
    border: "1px solid rgba(239, 68, 68, 0.35)",
    color: "#f87171",
  },
  diffSurplus: {
    background: "rgba(59, 130, 246, 0.12)",
    border: "1px solid rgba(59, 130, 246, 0.35)",
    color: "#60a5fa",
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
    background: "#2563eb",
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
