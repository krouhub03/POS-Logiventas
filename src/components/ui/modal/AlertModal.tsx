import { useEffect, useRef, ReactNode } from "react";
import { ModalRoot } from "./ModalRoot";
import { ModalBody } from "./ModalBody";
import { ModalFooter } from "./ModalFooter";

export interface AlertModalProps {
  isOpen: boolean;
  title: string;
  message: ReactNode;
  confirmText?: string;
  variant?: "success" | "error" | "warning" | "info";
  onClose: () => void;
}

export function AlertModal({
  isOpen,
  title,
  message,
  confirmText = "Entendido",
  variant = "info",
  onClose,
}: AlertModalProps) {
  const okBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => okBtnRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const variantConfig = {
    success: {
      icon: "✅",
      iconBg: "bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50",
      btn: "bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/30",
    },
    error: {
      icon: "❌",
      iconBg: "bg-rose-100 dark:bg-rose-950/80 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800/50",
      btn: "bg-rose-600 hover:bg-rose-700 text-white shadow-rose-600/30",
    },
    warning: {
      icon: "⚠️",
      iconBg: "bg-amber-100 dark:bg-amber-950/80 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/50",
      btn: "bg-amber-600 hover:bg-amber-700 text-white shadow-amber-600/30",
    },
    info: {
      icon: "ℹ️",
      iconBg: "bg-indigo-100 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/50",
      btn: "bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-600/30",
    },
  }[variant];

  return (
    <ModalRoot isOpen={isOpen} onClose={onClose} maxWidth="md">
      <ModalBody className="p-6 text-center">
        <div
          className={`w-14 h-14 rounded-2xl ${variantConfig.iconBg} flex items-center justify-center text-2xl mx-auto mb-4 shadow-sm`}
        >
          {variantConfig.icon}
        </div>
        <h3 className="text-base font-black text-slate-900 dark:text-white mb-2">
          {title}
        </h3>
        <div className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed font-medium">
          {message}
        </div>
      </ModalBody>

      <ModalFooter className="justify-center">
        <button
          ref={okBtnRef}
          type="button"
          onClick={onClose}
          className={`px-6 py-2 rounded-xl ${variantConfig.btn} text-xs font-black shadow-md transition-all cursor-pointer`}
        >
          {confirmText} (Enter / Esc)
        </button>
      </ModalFooter>
    </ModalRoot>
  );
}
