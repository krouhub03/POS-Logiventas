import {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { ConfirmModal } from "../components/ui/modal/ConfirmModal";
import { AlertModal } from "../components/ui/modal/AlertModal";

export interface ConfirmOptions {
  title?: string;
  message: ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "warning" | "primary";
}

export interface AlertOptions {
  title?: string;
  message: ReactNode;
  confirmText?: string;
  variant?: "success" | "error" | "warning" | "info";
}

interface ModalContextValue {
  confirm: (options: ConfirmOptions | string) => Promise<boolean>;
  alert: (options: AlertOptions | string) => Promise<void>;
}

const ModalContext = createContext<ModalContextValue | null>(null);

export function ModalProvider({ children }: { children: ReactNode }) {
  // Estado para ConfirmModal
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    options: ConfirmOptions;
    resolve: (val: boolean) => void;
  } | null>(null);

  // Estado para AlertModal
  const [alertState, setAlertState] = useState<{
    isOpen: boolean;
    options: AlertOptions;
    resolve: () => void;
  } | null>(null);

  const confirm = useCallback((opts: ConfirmOptions | string) => {
    const options: ConfirmOptions =
      typeof opts === "string" ? { message: opts } : opts;

    return new Promise<boolean>((resolve) => {
      setConfirmState({
        isOpen: true,
        options,
        resolve: (val: boolean) => {
          setConfirmState(null);
          resolve(val);
        },
      });
    });
  }, []);

  const alert = useCallback((opts: AlertOptions | string) => {
    const options: AlertOptions =
      typeof opts === "string" ? { message: opts } : opts;

    return new Promise<void>((resolve) => {
      setAlertState({
        isOpen: true,
        options,
        resolve: () => {
          setAlertState(null);
          resolve();
        },
      });
    });
  }, []);

  return (
    <ModalContext.Provider value={{ confirm, alert }}>
      {children}

      {/* Modal de confirmación activo */}
      {confirmState && (
        <ConfirmModal
          isOpen={confirmState.isOpen}
          title={confirmState.options.title || "Confirmar acción"}
          message={confirmState.options.message}
          confirmText={confirmState.options.confirmText}
          cancelText={confirmState.options.cancelText}
          variant={confirmState.options.variant || "primary"}
          onConfirm={() => confirmState.resolve(true)}
          onCancel={() => confirmState.resolve(false)}
        />
      )}

      {/* Modal de alerta activo */}
      {alertState && (
        <AlertModal
          isOpen={alertState.isOpen}
          title={alertState.options.title || "Notificación"}
          message={alertState.options.message}
          confirmText={alertState.options.confirmText}
          variant={alertState.options.variant || "info"}
          onClose={() => alertState.resolve()}
        />
      )}
    </ModalContext.Provider>
  );
}

export function useModals(): ModalContextValue {
  const ctx = useContext(ModalContext);
  if (!ctx) {
    throw new Error("useModals debe usarse dentro de un ModalProvider");
  }
  return ctx;
}
