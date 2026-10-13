import { useEffect, useRef, ReactNode } from "react";
import { ModalRoot } from "./ModalRoot";
import { ModalBody } from "./ModalBody";
import { ModalFooter } from "./ModalFooter";

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "warning" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  isOpen,
  title,
  message,
  confirmText = "Aceptar",
  cancelText = "Cancelar",
  variant = "primary",
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => confirmBtnRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const variantConfig = {
    danger: {
      icon: "🗑️",
      iconBg: "bg-rose-100 dark:bg-rose-950/80 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800/50",
      confirmBtn: "bg-rose-600 hover:bg-rose-700 text-white shadow-rose-600/30",
    },
    warning: {
      icon: "⚠️",
      iconBg: "bg-amber-100 dark:bg-amber-950/80 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/50",
      confirmBtn: "bg-amber-600 hover:bg-amber-700 text-white shadow-amber-600/30",
    },
    primary: {
      icon: "❓",
      iconBg: "bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50",
      confirmBtn: "bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/30",
    },
  }[variant];

  return (
    <ModalRoot isOpen={isOpen} onClose={onCancel} maxWidth="md">
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

      <ModalFooter className="justify-center gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold transition-colors cursor-pointer"
        >
          {cancelText} (Esc)
        </button>
        <button
          ref={confirmBtnRef}
          type="button"
          onClick={onConfirm}
          className={`px-5 py-2 rounded-xl ${variantConfig.confirmBtn} text-xs font-black shadow-md transition-all cursor-pointer`}
        >
          {confirmText} (Enter)
        </button>
      </ModalFooter>
    </ModalRoot>
  );
}
