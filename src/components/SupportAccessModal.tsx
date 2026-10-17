import { useState, useEffect, useRef, useCallback } from "react";
import { ModalRoot } from "./ui/modal/ModalRoot";
import { ModalHeader } from "./ui/modal/ModalHeader";
import { ModalBody } from "./ui/modal/ModalBody";
import { ModalFooter } from "./ui/modal/ModalFooter";
import { api } from "../services/api";
import type { CashierUser } from "../types";

interface SupportAccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (cashier: CashierUser) => void;
  availableCashiers: CashierUser[];
  onCashiersUpdated?: (cashiers: CashierUser[]) => void;
}

export function SupportAccessModal({
  isOpen,
  onClose,
  onSuccess,
  availableCashiers,
  onCashiersUpdated,
}: SupportAccessModalProps) {
  const [identifier, setIdentifier] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const identifierInputRef = useRef<HTMLInputElement>(null);
  const pinInputRef = useRef<HTMLInputElement>(null);

  // Helper para identificar cuentas con rol de soporte técnico (SUPERADMINSAAS)
  const isSuperAdmin = useCallback((c: CashierUser) => {
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
  }, []);

  // Filtrar cuentas de soporte disponibles en caché local
  const knownSupportUsers = availableCashiers.filter(isSuperAdmin);

  // Reset al abrir el modal
  useEffect(() => {
    if (isOpen) {
      setIdentifier("");
      setPin("");
      setError(null);
      setLoading(false);
      setTimeout(() => {
        identifierInputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  const handleKeyPress = (digit: string) => {
    setPin((prev) => {
      if (prev.length >= 6) return prev;
      return prev + digit;
    });
  };

  const handleBackspace = () => {
    setPin((prev) => prev.slice(0, -1));
  };

  const handleClear = () => {
    setPin("");
    setError(null);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanId = identifier.trim().toLowerCase();

    if (!cleanId) {
      setError("Ingresa el usuario o correo de soporte técnico");
      identifierInputRef.current?.focus();
      return;
    }

    if (!pin || pin.length < 4) {
      setError("Ingresa tu PIN de seguridad (mínimo 4 dígitos)");
      pinInputRef.current?.focus();
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Buscar coincidencia local entre usuarios de soporte
      let targetUser = availableCashiers.find(
        (c) =>
          isSuperAdmin(c) &&
          (c.username.toLowerCase() === cleanId ||
            c.email?.toLowerCase() === cleanId ||
            c.email?.split("@")[0].toLowerCase() === cleanId ||
            c.erpUserId?.toLowerCase() === cleanId)
      );

      // 2. Si no está en caché local, intentar refrescar usuarios desde el ERP en segundo plano
      if (!targetUser) {
        try {
          const freshList = await api.auth.syncUsers();
          if (onCashiersUpdated) {
            onCashiersUpdated(freshList);
          }
          targetUser = freshList.find(
            (c) =>
              isSuperAdmin(c) &&
              (c.username.toLowerCase() === cleanId ||
                c.email?.toLowerCase() === cleanId ||
                c.email?.split("@")[0].toLowerCase() === cleanId ||
                c.erpUserId?.toLowerCase() === cleanId)
          );
        } catch {
          // Si no hay red, continúa con la evaluación offline
        }
      }

      if (!targetUser) {
        // Verificar si el usuario existe pero es un cajero regular
        const isRegularUser = availableCashiers.some(
          (c) =>
            c.username.toLowerCase() === cleanId ||
            c.email?.toLowerCase() === cleanId
        );
        if (isRegularUser) {
          setError(
            "Este usuario no cuenta con privilegios de Soporte Técnico (SUPERADMINSAAS). Utilice la pantalla principal de cajeros."
          );
        } else {
          setError(
            "Usuario de soporte técnico no encontrado o no registrado en esta empresa."
          );
        }
        setLoading(false);
        return;
      }

      // 3. Validar el PIN de soporte con el backend local/ERP
      const unlockedCashier = await api.auth.loginUserPin(targetUser.id, pin);

      onSuccess(unlockedCashier);
      onClose();
    } catch (err: unknown) {
      setError(String(err));
      setPin("");
      pinInputRef.current?.focus();
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalRoot isOpen={isOpen} onClose={onClose} maxWidth="md">
      <ModalHeader
        title="Acceso de Soporte Técnico"
        subtitle="Autenticación exclusiva para personal de soporte y superadministradores"
        icon="🛠️"
        onClose={onClose}
      />

      <ModalBody className="space-y-4">
        {/* Advertencia de Seguridad */}
        <div className="bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800/60 rounded-xl p-3 flex items-start gap-3">
          <span className="text-xl">🛡️</span>
          <div className="text-xs text-sky-900 dark:text-sky-200 leading-relaxed">
            Área restringida para diagnósticos, configuración avanzada o auditoría técnica. Las operaciones quedarán registradas con rol de <strong>Soporte Técnico</strong>.
          </div>
        </div>

        {error && (
          <div className="bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 rounded-xl p-3 text-xs text-rose-800 dark:text-rose-200 font-medium animate-in fade-in duration-150">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Campo Usuario / Correo de Soporte */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Usuario o Correo de Soporte:
            </label>
            <div className="relative">
              <input
                ref={identifierInputRef}
                type="text"
                list="support-accounts-datalist"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="ej. soporte@megalider.com o usuario"
                disabled={loading}
                className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all font-mono"
              />
              {knownSupportUsers.length > 0 && (
                <datalist id="support-accounts-datalist">
                  {knownSupportUsers.map((u) => (
                    <option key={u.id} value={u.username}>
                      {u.fullName} ({u.erpRoleCode || "Soporte"})
                    </option>
                  ))}
                </datalist>
              )}
            </div>
          </div>

          {/* Campo PIN de Seguridad */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                PIN de Acceso (4-6 dígitos):
              </label>
              <span className="text-[11px] text-slate-400 font-mono">
                {pin.length} / 6 dígitos
              </span>
            </div>

            <div className="relative">
              <input
                ref={pinInputRef}
                type="password"
                maxLength={6}
                value={pin}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, "");
                  setPin(val);
                }}
                placeholder="••••••"
                disabled={loading}
                className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-center text-lg font-mono font-bold tracking-widest text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all"
              />
            </div>
          </div>

          {/* Visor de Puntos de PIN */}
          <div className="flex justify-center gap-2 pt-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <span
                key={i}
                className={`w-3 h-3 rounded-full border transition-all duration-150 ${
                  i < pin.length
                    ? "bg-sky-500 border-sky-500 scale-110 shadow-xs"
                    : "border-slate-300 dark:border-slate-700 bg-transparent"
                }`}
              />
            ))}
          </div>

          {/* Teclado Numérico Táctil */}
          <div className="grid grid-cols-3 gap-2 pt-2 max-w-[280px] mx-auto">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => handleKeyPress(n)}
                disabled={loading}
                className="py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700/80 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-white font-mono font-bold text-base transition-colors active:scale-95 cursor-pointer"
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              onClick={handleClear}
              disabled={loading}
              className="py-2.5 rounded-xl bg-slate-200/70 hover:bg-slate-300 dark:bg-slate-800/50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 font-mono font-bold text-sm transition-colors active:scale-95 cursor-pointer"
              title="Borrar PIN"
            >
              C
            </button>
            <button
              type="button"
              onClick={() => handleKeyPress("0")}
              disabled={loading}
              className="py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700/80 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-white font-mono font-bold text-base transition-colors active:scale-95 cursor-pointer"
            >
              0
            </button>
            <button
              type="button"
              onClick={handleBackspace}
              disabled={loading}
              className="py-2.5 rounded-xl bg-slate-200/70 hover:bg-slate-300 dark:bg-slate-800/50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 font-mono font-bold text-sm transition-colors active:scale-95 cursor-pointer"
              title="Retroceso"
            >
              ⌫
            </button>
          </div>
        </form>
      </ModalBody>

      <ModalFooter>
        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold transition-colors cursor-pointer"
        >
          Cancelar (Esc)
        </button>
        <button
          type="button"
          onClick={() => handleSubmit()}
          disabled={loading || !identifier.trim() || pin.length < 4}
          className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
        >
          {loading ? (
            <>
              <span className="animate-spin text-sm">⏳</span>
              <span>Validando…</span>
            </>
          ) : (
            <>
              <span>Acceder como Soporte</span>
              <span>→</span>
            </>
          )}
        </button>
      </ModalFooter>
    </ModalRoot>
  );
}
