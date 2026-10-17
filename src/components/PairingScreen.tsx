import { useState } from "react";
import { api } from "../services/api";
import type { ErpCajaOption, TerminalStatus } from "../types";

interface PairingScreenProps {
  initialErpUrl?: string;
  terminalStatus?: TerminalStatus | null;
  onPaired: (status: TerminalStatus) => void;
}

export function PairingScreen({
  initialErpUrl = "http://localhost:3000",
  terminalStatus,
  onPaired,
}: PairingScreenProps) {
  const [tab, setTab] = useState<"code" | "login">("code");
  const [erpUrl, setErpUrl] = useState(initialErpUrl);
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [cajasDisponibles, setCajasDisponibles] = useState<ErpCajaOption[] | null>(null);
  const [cajaSeleccionada, setCajaSeleccionada] = useState<string>("");
  const [nuevaCajaNombre, setNuevaCajaNombre] = useState("");
  const [nuevaCajaCodigo, setNuevaCajaCodigo] = useState("");
  const [crearNueva, setCrearNueva] = useState(false);
  const [reconnectPin, setReconnectPin] = useState("");
  const [showReconnectPinInput, setShowReconnectPinInput] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasPreviousCaja = Boolean(terminalStatus?.lastCajaCodigo || terminalStatus?.lastCajaId);

  const normalizeErpUrl = (url: string) => {
    const trimmed = url.trim().replace(/\/+$/, "");
    if (!trimmed) return "http://localhost:3000";
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      return trimmed;
    }
    if (
      trimmed.startsWith("localhost") ||
      trimmed.startsWith("127.0.0.1") ||
      trimmed.startsWith("192.168.") ||
      trimmed.startsWith("10.") ||
      trimmed.startsWith("172.")
    ) {
      return `http://${trimmed}`;
    }
    return `https://${trimmed}`;
  };

  const handleReconnect = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const cleanUrl = normalizeErpUrl(erpUrl);
      const status = await api.auth.reconnectTerminal({
        erpUrl: cleanUrl,
        cajaId: terminalStatus?.lastCajaId || undefined,
        cajaCodigo: terminalStatus?.lastCajaCodigo || undefined,
        pin: reconnectPin.trim() || undefined,
      });
      onPaired(status);
    } catch (err: unknown) {
      const msg = String(err);
      if (msg.toLowerCase().includes("pin") && !showReconnectPinInput) {
        setShowReconnectPinInput(true);
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handlePairWithCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const sanitizedCode = code.replace(/\s+/g, "").toUpperCase();
      const cleanUrl = normalizeErpUrl(erpUrl);
      const status = await api.auth.pairCode({ erpUrl: cleanUrl, code: sanitizedCode });
      onPaired(status);
    } catch (err: unknown) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handlePairWithLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const cleanUrl = normalizeErpUrl(erpUrl);
      const res = await api.auth.pairLogin({
        erpUrl: cleanUrl,
        email,
        password,
        cajaId: !crearNueva && cajaSeleccionada ? cajaSeleccionada : undefined,
        nuevoNombreCaja: crearNueva ? nuevaCajaNombre : undefined,
        nuevoCodigoCaja: crearNueva ? nuevaCajaCodigo : undefined,
      });

      if (res.requiereSeleccionCaja && res.cajasDisponibles) {
        setCajasDisponibles(res.cajasDisponibles);
        if (res.cajasDisponibles.length > 0) {
          setCajaSeleccionada(res.cajasDisponibles[0].id);
        }
      } else if (res.terminalStatus) {
        onPaired(res.terminalStatus);
      }
    } catch (err: unknown) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.header}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "1rem" }}>
            <img src="/logo_metahabi.png" alt="Metahabi" style={{ height: "46px", objectFit: "contain" }} />
          </div>
          <h1 style={styles.title}>Vincular Terminal de Caja</h1>
          <p style={styles.subtitle}>
            Conecta esta aplicación de escritorio directamente con el dominio de tu empresa o sucursal.
          </p>
        </div>

        {/* Tarjeta de Reconexión Rápida de Caja Previa */}
        {hasPreviousCaja && (
          <div
            style={{
              marginBottom: "1.25rem",
              padding: "1rem 1.25rem",
              background: "rgba(16, 185, 129, 0.08)",
              border: "1.5px solid rgba(16, 185, 129, 0.35)",
              borderRadius: "14px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ fontSize: "1.1rem" }}>⚡</span>
                  <strong style={{ fontSize: "0.95rem", color: "#10b981" }}>
                    Caja Desconectada: {terminalStatus?.lastCajaCodigo || "CAJA"}
                  </strong>
                </div>
                <div style={{ fontSize: "0.8rem", color: "#94a3b8", marginTop: "2px" }}>
                  {terminalStatus?.lastCajaNombre || "Terminal POS"} • {terminalStatus?.lastEmpresaNombre || "Empresa"}
                </div>
              </div>

              {!showReconnectPinInput ? (
                <button
                  type="button"
                  onClick={() => handleReconnect()}
                  disabled={loading}
                  style={{
                    padding: "0.6rem 1.25rem",
                    background: "#10b981",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "10px",
                    fontWeight: "bold",
                    fontSize: "0.85rem",
                    cursor: loading ? "not-allowed" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.4rem",
                    boxShadow: "0 2px 8px rgba(16, 185, 129, 0.3)",
                  }}
                >
                  <span>⚡</span>
                  <span>{loading ? "Reconectando…" : "Reconectar esta Caja"}</span>
                </button>
              ) : null}
            </div>

            {showReconnectPinInput && (
              <form onSubmit={handleReconnect} style={{ marginTop: "0.85rem", borderTop: "1px dashed rgba(16, 185, 129, 0.25)", paddingTop: "0.85rem" }}>
                <label style={{ ...styles.label, marginBottom: "0.4rem" }}>
                  Ingresa tu PIN de operador (4-6 dígitos) para autorizar la reconexión:
                </label>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <input
                    style={{ ...styles.input, flex: 1, padding: "0.5rem 0.75rem", fontSize: "1rem", letterSpacing: "0.2em", textAlign: "center" }}
                    type="password"
                    maxLength={6}
                    autoFocus
                    placeholder="••••"
                    value={reconnectPin}
                    onChange={(e) => setReconnectPin(e.target.value.replace(/\D/g, ""))}
                  />
                  <button
                    type="submit"
                    disabled={loading || reconnectPin.length < 4}
                    style={{
                      padding: "0.5rem 1.25rem",
                      background: reconnectPin.length >= 4 ? "#10b981" : "#475569",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "10px",
                      fontWeight: "bold",
                      fontSize: "0.85rem",
                      cursor: reconnectPin.length >= 4 ? "pointer" : "not-allowed",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {loading ? "Reconectando…" : "Confirmar y Reconectar"}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* Selector de Pestañas */}
        <div style={styles.tabs}>
          <button
            type="button"
            style={{
              ...styles.tabButton,
              ...(tab === "code" ? styles.tabActive : {}),
            }}
            onClick={() => {
              setTab("code");
              setError(null);
              setCajasDisponibles(null);
            }}
          >
            1. Con Código de Vinculación (Recomendado)
          </button>
          <button
            type="button"
            style={{
              ...styles.tabButton,
              ...(tab === "login" ? styles.tabActive : {}),
            }}
            onClick={() => {
              setTab("login");
              setError(null);
            }}
          >
            2. Con Usuario Administrador (Directo)
          </button>
        </div>

        {error && <div style={styles.errorBanner}>{error}</div>}

        {/* Pestaña 1: Código OTP */}
        {tab === "code" && (
          <form onSubmit={handlePairWithCode} style={styles.form}>
            <div style={styles.field}>
              <label style={styles.label}>URL o Dominio de tu Empresa (Tienda / Sucursal)</label>
              <input
                style={styles.input}
                type="text"
                required
                value={erpUrl}
                onChange={(e) => setErpUrl(e.target.value)}
                placeholder="https://cmegalider.com o http://localhost:3000"
              />
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Código de Vinculación (6 Caracteres)</label>
              <input
                style={{ ...styles.input, ...styles.codeInput }}
                type="text"
                required
                maxLength={10}
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="ML-XXXX"
              />
              <span style={styles.hint}>
                Genera este código en el panel de tu empresa en: Configuración &gt; Cajas POS (ej. https://cmegalider.com/admin/caja).
              </span>
            </div>

            <button
              type="submit"
              disabled={loading || !code.trim()}
              style={{
                ...styles.submitBtn,
                ...(loading ? styles.btnDisabled : {}),
              }}
            >
              {loading ? "Conectando con tu Empresa…" : "Vincular y Activar Caja"}
            </button>
          </form>
        )}

        {/* Pestaña 2: Login Directo */}
        {tab === "login" && (
          <form onSubmit={handlePairWithLogin} style={styles.form}>
            <div style={styles.field}>
              <label style={styles.label}>URL o Dominio de tu Empresa</label>
              <input
                style={styles.input}
                type="text"
                required
                value={erpUrl}
                onChange={(e) => setErpUrl(e.target.value)}
                placeholder="https://cmegalider.com o http://localhost:3000"
              />
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Correo del Administrador</label>
              <input
                style={styles.input}
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@megalider.com"
              />
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Contraseña</label>
              <input
                style={styles.input}
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            {/* Selección o Creación de Caja tras autenticar */}
            {cajasDisponibles && (
              <div style={styles.cajasBox}>
                <div style={{ display: "flex", gap: "1rem", marginBottom: "0.75rem" }}>
                  <label style={{ fontSize: "0.85rem", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="tipoCaja"
                      checked={!crearNueva}
                      onChange={() => setCrearNueva(false)}
                    />{" "}
                    Seleccionar caja existente
                  </label>
                  <label style={{ fontSize: "0.85rem", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="tipoCaja"
                      checked={crearNueva}
                      onChange={() => setCrearNueva(true)}
                    />{" "}
                    Crear nueva caja para este equipo
                  </label>
                </div>

                {!crearNueva ? (
                  <div style={styles.field}>
                    <label style={styles.label}>Cajas disponibles en la empresa</label>
                    <select
                      style={styles.input}
                      value={cajaSeleccionada}
                      onChange={(e) => setCajaSeleccionada(e.target.value)}
                    >
                      {cajasDisponibles.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.codigo} — {c.nombre} ({c.estado})
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "0.5rem" }}>
                    <div>
                      <label style={styles.label}>Código</label>
                      <input
                        style={styles.input}
                        placeholder="CAJA-02"
                        value={nuevaCajaCodigo}
                        onChange={(e) => setNuevaCajaCodigo(e.target.value.toUpperCase())}
                      />
                    </div>
                    <div>
                      <label style={styles.label}>Nombre de Caja</label>
                      <input
                        style={styles.input}
                        placeholder="Mostrador Pasillo 2"
                        value={nuevaCajaNombre}
                        onChange={(e) => setNuevaCajaNombre(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email.trim() || !password}
              style={{
                ...styles.submitBtn,
                ...(loading ? styles.btnDisabled : {}),
              }}
            >
              {loading
                ? "Autenticando..."
                : cajasDisponibles
                ? "Confirmar y Vincular Terminal"
                : "Autenticar y Vincular Terminal"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100vh",
    background: "#0f172a",
    padding: "1rem",
    fontFamily: "Inter, system-ui, sans-serif",
  },
  card: {
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: "16px",
    width: "100%",
    maxWidth: "520px",
    padding: "2rem",
    boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
    color: "#f8fafc",
  },
  header: {
    textAlign: "center",
    marginBottom: "1.5rem",
  },
  logoBadge: {
    display: "inline-block",
    background: "#2563eb",
    color: "#fff",
    fontWeight: "bold",
    fontSize: "0.85rem",
    padding: "0.25rem 0.75rem",
    borderRadius: "999px",
    marginBottom: "0.5rem",
  },
  title: {
    fontSize: "1.4rem",
    fontWeight: "bold",
    margin: "0 0 0.25rem",
  },
  subtitle: {
    fontSize: "0.85rem",
    color: "#94a3b8",
    margin: 0,
  },
  tabs: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "0.5rem",
    background: "#0f172a",
    padding: "0.35rem",
    borderRadius: "10px",
    marginBottom: "1.5rem",
  },
  tabButton: {
    background: "transparent",
    border: "none",
    color: "#94a3b8",
    padding: "0.5rem",
    fontSize: "0.8rem",
    fontWeight: 600,
    borderRadius: "8px",
    cursor: "pointer",
    transition: "all 0.15s ease",
  },
  tabActive: {
    background: "#2563eb",
    color: "#ffffff",
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
    fontSize: "0.75rem",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "#94a3b8",
  },
  input: {
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: "8px",
    padding: "0.65rem 0.85rem",
    color: "#f8fafc",
    fontSize: "0.95rem",
    outline: "none",
  },
  codeInput: {
    textAlign: "center",
    fontSize: "1.5rem",
    fontWeight: "bold",
    letterSpacing: "0.2em",
    color: "#60a5fa",
    fontFamily: "monospace",
  },
  hint: {
    fontSize: "0.75rem",
    color: "#64748b",
  },
  cajasBox: {
    background: "#0f172a",
    padding: "1rem",
    borderRadius: "8px",
    border: "1px solid #334155",
  },
  submitBtn: {
    background: "#2563eb",
    border: "none",
    borderRadius: "8px",
    color: "#ffffff",
    fontWeight: "bold",
    padding: "0.85rem",
    fontSize: "0.95rem",
    cursor: "pointer",
    transition: "background 0.15s ease",
    marginTop: "0.5rem",
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
