import { useState } from "react";
import { ModalRoot } from "./ui/modal/ModalRoot";
import { ModalHeader } from "./ui/modal/ModalHeader";
import { ModalBody } from "./ui/modal/ModalBody";
import { ModalFooter } from "./ui/modal/ModalFooter";
import { api } from "../services/api";
import type { CashierUser } from "../types";

interface ForgotPinModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedCashier: CashierUser | null;
  onSyncComplete?: (cashiers: CashierUser[]) => void;
}

export function ForgotPinModal({
  isOpen,
  onClose,
  selectedCashier,
  onSyncComplete,
}: ForgotPinModalProps) {
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"idle" | "success" | "error">("idle");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const handleSyncNow = async () => {
    setSyncing(true);
    setSyncStatus("idle");
    setStatusMsg(null);
    try {
      const freshList = await api.auth.syncUsers();
      setSyncStatus("success");
      setStatusMsg("¡Credenciales sincronizadas! Ya puedes probar tu nuevo PIN.");
      if (onSyncComplete) {
        onSyncComplete(freshList);
      }
    } catch (err: unknown) {
      setSyncStatus("error");
      setStatusMsg("No se pudo conectar al servidor. Revisa tu conexión a internet.");
      console.warn("[ForgotPinModal] Error sincronizando:", err);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <ModalRoot isOpen={isOpen} onClose={onClose} maxWidth="md">
      <ModalHeader
        title="¿Olvidaste tu PIN de Caja?"
        subtitle="Recuperación sencilla en 3 pasos mediante el portal web"
        onClose={onClose}
      />

      <ModalBody>
        <div className="space-y-4 text-slate-700 dark:text-slate-200">
          {/* Tarjeta de Usuario Afectado */}
          {selectedCashier && (
            <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80">
              <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400 flex items-center justify-center font-bold text-sm border border-emerald-300 dark:border-emerald-800 shrink-0">
                {selectedCashier.fullName.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs text-slate-500 dark:text-slate-400">Usuario seleccionado:</div>
                <div className="font-bold text-sm text-slate-900 dark:text-white truncate">
                  {selectedCashier.fullName}
                </div>
              </div>
            </div>
          )}

          {/* Pasos de Recuperación */}
          <div className="space-y-3">
            {/* Paso 1 */}
            <div className="flex items-start gap-3 p-3 rounded-xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
              <div className="w-6 h-6 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                1
              </div>
              <div className="text-xs leading-relaxed">
                <strong className="text-slate-900 dark:text-white block mb-0.5">
                  Ingresa a Metahabi Web
                </strong>
                Desde cualquier navegador en tu celular o computador, abre{" "}
                <span className="font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                  metahabi.com
                </span>{" "}
                e inicia sesión con tu correo y contraseña principal.
              </div>
            </div>

            {/* Paso 2 */}
            <div className="flex items-start gap-3 p-3 rounded-xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
              <div className="w-6 h-6 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                2
              </div>
              <div className="text-xs leading-relaxed">
                <strong className="text-slate-900 dark:text-white block mb-0.5">
                  Cambia tu PIN de Caja
                </strong>
                Ve al menú <strong>Caja</strong> o <strong>Usuarios</strong>, selecciona tu usuario y haz clic en{" "}
                <strong>"Cambiar PIN"</strong>. Asigna un nuevo código de 4 a 6 dígitos y guarda los cambios.
              </div>
            </div>

            {/* Paso 3 */}
            <div className="flex items-start gap-3 p-3 rounded-xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800">
              <div className="w-6 h-6 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                3
              </div>
              <div className="text-xs leading-relaxed">
                <strong className="text-slate-900 dark:text-white block mb-0.5">
                  Sincroniza y Desbloquea
                </strong>
                Al guardar en la web, el POS detectará el cambio automáticamente en pocos segundos. También puedes pulsar el botón de abajo para forzar la sincronización inmediata.
              </div>
            </div>
          </div>

          {/* Estado de Sincronización */}
          {statusMsg && (
            <div
              className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                syncStatus === "success"
                  ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800"
                  : "bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-800"
              }`}
            >
              <span>{syncStatus === "success" ? "✅" : "⚠️"}</span>
              <span>{statusMsg}</span>
            </div>
          )}
        </div>
      </ModalBody>

      <ModalFooter>
        <button
          type="button"
          disabled={syncing}
          onClick={handleSyncNow}
          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
        >
          <span>{syncing ? "⏳" : "🔄"}</span>
          <span>{syncing ? "Sincronizando..." : "Sincronizar Credenciales Ahora"}</span>
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold transition-colors cursor-pointer"
        >
          Entendido / Volver
        </button>
      </ModalFooter>
    </ModalRoot>
  );
}
