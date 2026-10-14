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
  const [cashiers, setCashiers] = useState<CashierUser[]>([]);
  const [selectedCashier, setSelectedCashier] = useState<CashierUser | null>(null);
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargarCajeros = useCallback(async () => {
    try {
      // 1. Carga inmediata desde SQLite local para latencia cero (<5ms)
      const list = await api.auth.listCashiers();
      setCashiers(list);
      if (list.length === 1) {
        setSelectedCashier(list[0]);
      }

      // 2. Refresco automático en segundo plano desde el ERP (si hay red)
      api.auth
        .syncUsers()
        .then((freshList) => {
          setCashiers(freshList);
        })
        .catch(() => {
          // Modo Offline-First: opera transparentemente con la lista local
        });
    } catch (e) {
      console.error("Error al listar cajeros locales:", e);
    }
  }, []);

  useEffect(() => {
    cargarCajeros();
  }, [cargarCajeros]);

  const handleSelectCashier = (cashier: CashierUser) => {
    setSelectedCashier(cashier);
    setPin("");
    setError(null);
  };

  const handleBackToSelect = () => {
    setSelectedCashier(null);
    setPin("");
    setError(null);
  };

  // Obtener mapa de frecuencias de login en esta terminal local
  const getFrequencyMap = (): Record<number, number> => {
    try {
      const raw = localStorage.getItem("pos_cashier_frequency");
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  };

  const recordLoginFrequency = (userId: number) => {
    try {
      const freq = getFrequencyMap();
      freq[userId] = (freq[userId] || 0) + 1;
      localStorage.setItem("pos_cashier_frequency", JSON.stringify(freq));
    } catch (e) {
      console.warn("No se pudo registrar frecuencia:", e);
    }
  };

  // 1. Filtro estricto: JAMÁS un cliente puede aparecer en el POS (Veto Zero-Trust en UI)
  const authorizedCashiers = cashiers.filter((c) => {
    const roleUpper = (c.role || "").toUpperCase();
    const profileUpper = (c.profileName || "").toUpperCase();
    return (
      roleUpper !== "CLIENTE" &&
      roleUpper !== "CUSTOMER" &&
      !profileUpper.includes("CLIENTE")
    );
  });

  // 2. Separar Soporte Técnico (SUPERADMINSAAS) para enlace copy inferior
  const isSuperAdmin = (c: CashierUser) => {
    const roleUpper = (c.role || "").toUpperCase();
    const erpRoleUpper = (c.erpRoleCode || "").toUpperCase();
    const profileUpper = (c.profileName || "").toUpperCase();
    const usernameUpper = (c.username || "").toUpperCase();
    return (
      erpRoleUpper === "SUPERADMINSAAS" ||
      roleUpper === "SUPERADMINSAAS" ||
      roleUpper === "SUPERADMIN" ||
      profileUpper.includes("SUPERADMIN") ||
      profileUpper.includes("SOPORTE") ||
      usernameUpper.includes("SOPORTE")
    );
  };

  const superAdminUsers = authorizedCashiers.filter(isSuperAdmin);
  const regularCashiers = authorizedCashiers.filter((c) => !isSuperAdmin(c));

  const frequencyMap = getFrequencyMap();
  const sortedCashiers = [...regularCashiers].sort((a, b) => {
    const freqA = frequencyMap[a.id] || 0;
    const freqB = frequencyMap[b.id] || 0;
    return freqB - freqA;
  });

  // Los cajeros operativos más frecuentes se muestran con tarjetas y figuras de avatar (hasta 3)
  const frequentCashiers = sortedCashiers.slice(0, Math.min(3, sortedCashiers.length));

  const handlePinSubmit = useCallback(
    async (pinToTest: string) => {
      if (!selectedCashier) return;
      if (!pinToTest || pinToTest.length < 4) return;
      setLoading(true);
      setError(null);
      try {
        // Validación focalizada contra el ID específico del usuario (Zero-Collision)
        const cashier = await api.auth.loginUserPin(selectedCashier.id, pinToTest);
        recordLoginFrequency(cashier.id);
        onUnlocked(cashier);
      } catch (err: unknown) {
        setError(String(err));
        setPin("");
      } finally {
        setLoading(false);
      }
    },
    [selectedCashier, onUnlocked]
  );

  const handleKeyPress = useCallback((digit: string) => {
    setPin((prev) => {
      if (prev.length >= 6) return prev;
      return prev + digit;
    });
  }, []);

  const handleBackspace = useCallback(() => {
    setPin((prev) => prev.slice(0, -1));
  }, []);

  const handleClear = useCallback(() => {
    setPin("");
    setError(null);
  }, []);

  // Soporte de teclado físico adaptativo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedCashier) {
        // En vista de selección: Teclas numéricas 1..3 seleccionan los cajeros más frecuentes
        const num = parseInt(e.key, 10);
        if (!isNaN(num) && num >= 1 && num <= frequentCashiers.length) {
          handleSelectCashier(frequentCashiers[num - 1]);
        }
      } else {
        // En vista de PIN: 0-9 para PIN, Backspace para borrar, Enter para verificar, Esc para volver
        if (e.key >= "0" && e.key <= "9") {
          handleKeyPress(e.key);
        } else if (e.key === "Backspace") {
          handleBackspace();
        } else if (e.key === "Enter") {
          handlePinSubmit(pin);
        } else if (e.key === "Escape") {
          handleBackToSelect();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedCashier, frequentCashiers, pin, handleKeyPress, handleBackspace, handlePinSubmit]);

  const handleSyncUsers = async () => {
    setSyncing(true);
    setError(null);
    try {
      const updated = await api.auth.syncUsers();
      setCashiers(updated);
      if (updated.length === 1) {
        setSelectedCashier(updated[0]);
      }
    } catch (err: unknown) {
      setError(`Error al sincronizar usuarios con ERP: ${err}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleDesvincular = async () => {
    const ok = await confirm({
      title: "Desvincular Terminal",
      message:
        "¿Estás seguro de desvincular esta terminal de caja? Deberás emparejarla nuevamente para volver a operar.",
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

  interface RoleTheme {
    category: "support" | "admin" | "accountant" | "manager" | "cashier" | "staff";
    color: string;
    bg: string;
    border: string;
    label: string;
  }

  const getRoleTheme = (c: CashierUser): RoleTheme => {
    const role = (c.role || "").toLowerCase();
    const erpRole = (c.erpRoleCode || "").toLowerCase();
    const profile = (c.profileName || "").toLowerCase();

    // 1. Soporte Técnico (SUPERADMINSAAS - Exclusivo, JAMÁS mostrar como Administrador)
    if (
      erpRole === "superadminsaas" ||
      role === "superadminsaas" ||
      role === "superadmin" ||
      profile.includes("soporte")
    ) {
      return {
        category: "support",
        color: "#38bdf8",
        bg: "rgba(56, 189, 248, 0.14)",
        border: "rgba(56, 189, 248, 0.4)",
        label: "Soporte",
      };
    }

    // 2. Administrador de Empresa
    if (
      erpRole === "admin_empresa" ||
      role === "admin" ||
      role === "admin_empresa" ||
      profile.includes("admin")
    ) {
      return {
        category: "admin",
        color: "#f59e0b",
        bg: "rgba(245, 158, 11, 0.14)",
        border: "rgba(245, 158, 11, 0.4)",
        label: c.profileName?.trim() || "Administrador",
      };
    }

    // 2. Contador / Finanzas
    if (
      profile.includes("contad") ||
      profile.includes("fiscal") ||
      profile.includes("auditor") ||
      role.includes("contad")
    ) {
      return {
        category: "accountant",
        color: "#10b981",
        bg: "rgba(16, 185, 129, 0.14)",
        border: "rgba(16, 185, 129, 0.4)",
        label: c.profileName?.trim() || "Contador",
      };
    }

    // 3. Supervisor / Gerente
    if (
      role === "manager" ||
      profile.includes("gerent") ||
      profile.includes("supervis") ||
      profile.includes("encargad")
    ) {
      return {
        category: "manager",
        color: "#8b5cf6",
        bg: "rgba(139, 92, 246, 0.14)",
        border: "rgba(139, 92, 246, 0.4)",
        label: c.profileName?.trim() || "Supervisor",
      };
    }

    // 4. Ventas / Cajero
    if (
      profile.includes("cajer") ||
      profile.includes("vendedor") ||
      profile.includes("pos") ||
      role === "cashier"
    ) {
      return {
        category: "cashier",
        color: "#0ea5e9",
        bg: "rgba(14, 165, 233, 0.14)",
        border: "rgba(14, 165, 233, 0.4)",
        label: c.profileName?.trim() || "Cajero / Ventas",
      };
    }

    // 5. Staff general
    return {
      category: "staff",
      color: "#94a3b8",
      bg: "rgba(148, 163, 184, 0.14)",
      border: "rgba(148, 163, 184, 0.4)",
      label: c.profileName?.trim() || "Operador",
    };
  };

  const renderRoleIcon = (category: string, size = 20) => {
    switch (category) {
      case "support":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
          </svg>
        );
      case "admin":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
        );
      case "accountant":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="16" height="20" x="4" y="2" rx="2" />
            <line x1="8" x2="16" y1="6" y2="6" />
            <line x1="16" x2="16" y1="14" />
            <path d="M16 10h.01" />
            <path d="M12 10h.01" />
            <path d="M8 10h.01" />
            <path d="M12 14h.01" />
            <path d="M8 14h.01" />
            <path d="M12 18h.01" />
            <path d="M8 18h.01" />
          </svg>
        );
      case "manager":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
        );
      case "cashier":
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
            <path d="M3 6h18" />
            <path d="M16 10a4 4 0 0 1-8 0" />
          </svg>
        );
      default:
        return (
          <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        );
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
            title="Sincronizar lista de usuarios y permisos desde el ERP"
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

      {/* Contenido Central */}
      <main style={styles.centerArea}>
        {!selectedCashier ? (
          /* PASO 1: Selector Visual de Cajeros */
          <div style={styles.selectorBox}>
            <div style={styles.avatarCircle}>👥</div>
            <h2 style={styles.lockTitle}>Selecciona tu Usuario</h2>
            <p style={styles.lockSubtitle}>
              Elige tu perfil de operador para ingresar al punto de venta
            </p>

            {error && <div style={styles.errorBox}>{error}</div>}

            {cashiers.length === 0 ? (
              <div style={styles.emptyUsersBox}>
                <p>No hay usuarios sincronizados en la terminal local.</p>
                <button
                  type="button"
                  onClick={handleSyncUsers}
                  disabled={syncing}
                  style={styles.actionBtn}
                >
                  {syncing ? "Sincronizando…" : "Descargar Usuarios del ERP"}
                </button>
              </div>
            ) : (
              <div style={styles.selectorContent}>
                {/* 1. Selector Dropdown (Solo usuarios de caja autorizados, excluye clientes) */}
                <div style={styles.selectCard}>
                  <label style={styles.selectLabel}>
                    <span>📋 Buscar / Seleccionar Usuario de la Lista:</span>
                    <span style={styles.selectCountBadge}>{regularCashiers.length} usuarios</span>
                  </label>
                  <div style={styles.selectWrapper}>
                    <select
                      style={styles.selectElement}
                      value=""
                      onChange={(e) => {
                        const id = Number(e.target.value);
                        const found = authorizedCashiers.find((c) => c.id === id);
                        if (found) handleSelectCashier(found);
                      }}
                    >
                      <option value="">-- Haz clic aquí para desplegar y seleccionar cualquier usuario --</option>
                      {regularCashiers.map((c) => {
                        const theme = getRoleTheme(c);
                        const roleDesc = c.profileName?.trim()
                          ? ` — [${c.profileName.trim()}]`
                          : theme.category === "admin"
                          ? ` — [Administrador]`
                          : "";
                        return (
                          <option key={c.id} value={c.id}>
                            {c.fullName} ({c.username}){roleDesc}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>

                {/* 2. Divisor Visual */}
                {frequentCashiers.length > 0 && (
                  <div style={styles.dividerContainer}>
                    <div style={styles.dividerLine} />
                    <span style={styles.dividerText}>⚡ O ACCESO RÁPIDO: USUARIOS MÁS FRECUENTES</span>
                    <div style={styles.dividerLine} />
                  </div>
                )}

                {/* 3. Tarjetas con Iconos de Rol para Usuarios Más Frecuentes */}
                {frequentCashiers.length > 0 && (
                  <div style={styles.cashierGrid}>
                    {frequentCashiers.map((c, idx) => {
                      const theme = getRoleTheme(c);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => handleSelectCashier(c)}
                          style={styles.cashierCard}
                        >
                          <div style={styles.cardHeader}>
                            <span style={styles.shortcutBadge}>{idx + 1}</span>
                            <div
                              style={{
                                ...styles.roleIconBadge,
                                borderColor: theme.border,
                                backgroundColor: theme.bg,
                                color: theme.color,
                              }}
                              title={theme.label}
                            >
                              {renderRoleIcon(theme.category, 14)}
                            </div>
                          </div>
                          <div
                            style={{
                              ...styles.cardIconCircle,
                              backgroundColor: theme.bg,
                              borderColor: theme.border,
                              color: theme.color,
                            }}
                          >
                            {renderRoleIcon(theme.category, 30)}
                          </div>
                          <div style={styles.cardName}>{c.fullName}</div>
                          {c.profileName && c.profileName.trim() && (
                            <div style={{ ...styles.cardProfileSubtitle, color: theme.color }}>
                              {c.profileName}
                            </div>
                          )}
                          <div style={styles.cardEmail}>{c.username}</div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* 4. Enlace tipo Copy para Soporte */}
                {superAdminUsers.length > 0 && (
                  <div style={styles.supportFooter}>
                    <button
                      type="button"
                      onClick={() => handleSelectCashier(superAdminUsers[0])}
                      style={styles.supportLink}
                      title="Acceso exclusivo para Soporte"
                    >
                      <span style={styles.supportIcon}>🛠️</span>
                      <span>
                        Acceso de <strong>Soporte</strong> (
                        <span style={styles.supportHighlight}>{superAdminUsers[0].fullName}</span>)
                      </span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          /* PASO 2: Ingreso de PIN Personal Dirigido */
          <div style={styles.lockBox}>
            <div style={styles.cashierSelectedHeader}>
              <button
                type="button"
                onClick={handleBackToSelect}
                style={styles.backBtn}
                title="Volver a la selección de cajeros (Esc)"
              >
                ← Cambiar (Esc)
              </button>
              <div
                style={{
                  ...styles.roleIconBadgeDetailed,
                  borderColor: getRoleTheme(selectedCashier).border,
                  backgroundColor: getRoleTheme(selectedCashier).bg,
                  color: getRoleTheme(selectedCashier).color,
                }}
              >
                {renderRoleIcon(getRoleTheme(selectedCashier).category, 14)}
                <span>{getRoleTheme(selectedCashier).label}</span>
              </div>
            </div>

            <div
              style={{
                ...styles.avatarCircleThemed,
                backgroundColor: getRoleTheme(selectedCashier).bg,
                borderColor: getRoleTheme(selectedCashier).border,
                color: getRoleTheme(selectedCashier).color,
              }}
            >
              {renderRoleIcon(getRoleTheme(selectedCashier).category, 34)}
            </div>
            <h2 style={styles.lockTitle}>{selectedCashier.fullName}</h2>
            <p style={styles.lockSubtitle}>
              Ingresa tu PIN de 4 a 6 dígitos para acceder al mostrador
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
          </div>
        )}
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
  selectorBox: {
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: "20px",
    width: "100%",
    maxWidth: "680px",
    padding: "2.5rem 2rem",
    textAlign: "center",
    boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
  },
  selectorContent: {
    display: "flex",
    flexDirection: "column",
    gap: "1.25rem",
    marginTop: "0.5rem",
  },
  selectCard: {
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: "14px",
    padding: "1rem 1.25rem",
    textAlign: "left",
  },
  selectLabel: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: "0.8rem",
    fontWeight: "bold",
    color: "#cbd5e1",
    marginBottom: "0.5rem",
  },
  selectCountBadge: {
    background: "#1e293b",
    color: "#38bdf8",
    fontSize: "0.7rem",
    padding: "0.15rem 0.5rem",
    borderRadius: "6px",
    fontFamily: "monospace",
  },
  selectWrapper: {
    position: "relative",
    width: "100%",
  },
  selectElement: {
    width: "100%",
    background: "#1e293b",
    border: "1px solid #475569",
    borderRadius: "10px",
    color: "#f8fafc",
    padding: "0.75rem 1rem",
    fontSize: "0.9rem",
    fontWeight: 600,
    outline: "none",
    cursor: "pointer",
    boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
  },
  dividerContainer: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    margin: "0.25rem 0",
  },
  dividerLine: {
    flex: 1,
    height: "1px",
    background: "#334155",
  },
  dividerText: {
    fontSize: "0.7rem",
    fontWeight: 700,
    color: "#94a3b8",
    letterSpacing: "0.05em",
    textTransform: "uppercase",
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
  cashierSelectedHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "1rem",
  },
  backBtn: {
    background: "transparent",
    border: "none",
    color: "#94a3b8",
    fontSize: "0.8rem",
    fontWeight: 600,
    cursor: "pointer",
    padding: "0.2rem 0.4rem",
  },
  avatarCircle: {
    fontSize: "2rem",
    marginBottom: "0.5rem",
  },
  lockTitle: {
    fontSize: "1.35rem",
    fontWeight: "bold",
    margin: "0 0 0.25rem",
  },
  lockSubtitle: {
    fontSize: "0.85rem",
    color: "#94a3b8",
    margin: "0 0 1.5rem",
  },
  cashierGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "1rem",
    marginTop: "1rem",
  },
  cashierCard: {
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: "12px",
    padding: "1.25rem 1rem",
    textAlign: "center",
    cursor: "pointer",
    transition: "all 0.15s ease",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  cardHeader: {
    width: "100%",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "0.75rem",
  },
  shortcutBadge: {
    background: "#334155",
    color: "#94a3b8",
    fontSize: "0.7rem",
    fontWeight: "bold",
    padding: "0.15rem 0.4rem",
    borderRadius: "4px",
    fontFamily: "monospace",
  },
  roleIconBadge: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "28px",
    height: "28px",
    borderRadius: "50%",
    border: "1px solid",
    transition: "all 0.15s ease",
  },
  roleIconBadgeDetailed: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    padding: "0.25rem 0.65rem",
    borderRadius: "9999px",
    border: "1px solid",
    fontSize: "0.75rem",
    fontWeight: 600,
  },
  cardIconCircle: {
    width: "56px",
    height: "56px",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid",
    marginBottom: "0.75rem",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.25)",
  },
  avatarCircleThemed: {
    width: "68px",
    height: "68px",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid",
    margin: "0 auto 1.25rem",
    boxShadow: "0 6px 20px rgba(0, 0, 0, 0.35)",
  },
  cardName: {
    fontSize: "0.95rem",
    fontWeight: "bold",
    color: "#f8fafc",
    marginBottom: "0.2rem",
  },
  cardProfileSubtitle: {
    fontSize: "0.72rem",
    fontWeight: 600,
    marginBottom: "0.25rem",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
  },
  cardEmail: {
    fontSize: "0.75rem",
    color: "#64748b",
  },
  supportFooter: {
    marginTop: "1.25rem",
    paddingTop: "1rem",
    borderTop: "1px dashed #334155",
    display: "flex",
    justifyContent: "center",
  },
  supportLink: {
    background: "transparent",
    border: "none",
    color: "#94a3b8",
    fontSize: "0.82rem",
    display: "inline-flex",
    alignItems: "center",
    gap: "0.5rem",
    cursor: "pointer",
    padding: "0.4rem 0.8rem",
    borderRadius: "8px",
    transition: "all 0.15s ease",
  },
  supportIcon: {
    fontSize: "1.05rem",
  },
  supportHighlight: {
    color: "#f59e0b",
    textDecoration: "underline",
    fontWeight: 600,
  },
  emptyUsersBox: {
    padding: "2rem",
    color: "#94a3b8",
    fontSize: "0.9rem",
  },
  actionBtn: {
    marginTop: "1rem",
    background: "#3b82f6",
    color: "#ffffff",
    border: "none",
    borderRadius: "8px",
    padding: "0.6rem 1.2rem",
    fontSize: "0.85rem",
    fontWeight: 600,
    cursor: "pointer",
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
    gap: "0.75rem",
    marginBottom: "1.5rem",
  },
  keyBtn: {
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: "12px",
    color: "#f8fafc",
    fontSize: "1.25rem",
    fontWeight: 600,
    padding: "0.85rem 0",
    cursor: "pointer",
    transition: "background 0.1s ease",
  },
  keyAction: {
    background: "#1e293b",
    color: "#94a3b8",
  },
  unlockBtn: {
    width: "100%",
    background: "#3b82f6",
    color: "#ffffff",
    border: "none",
    borderRadius: "12px",
    padding: "0.85rem 0",
    fontSize: "0.95rem",
    fontWeight: "bold",
    cursor: "pointer",
    transition: "background 0.15s ease",
  },
  unlockDisabled: {
    background: "#334155",
    color: "#64748b",
    cursor: "not-allowed",
  },
  errorBox: {
    background: "#7f1d1d",
    border: "1px solid #ef4444",
    color: "#fca5a5",
    padding: "0.6rem 0.8rem",
    borderRadius: "8px",
    fontSize: "0.8rem",
    marginBottom: "1rem",
  },
};
