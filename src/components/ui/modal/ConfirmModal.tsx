import { useEffect, useRef, useState, ReactNode } from "react";
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

const ACTIVE_BTN_CLASSES =
  "bg-emerald-600 hover:bg-emerald-700 text-white border-2 border-emerald-400 ring-4 ring-emerald-500/35 shadow-[0_0_20px_rgba(16,185,129,0.55)] scale-[1.02] font-black";
const INACTIVE_BTN_CLASSES =
  "bg-white dark:bg-slate-900 hover:bg-emerald-500/5 hover:border-emerald-500/50 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 font-bold";

export function ConfirmModal({
  isOpen,
  title,
  message,
  confirmText = "Sí",
  cancelText = "No",
  variant = "primary",
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const [selectedBtn, setSelectedBtn] = useState<"confirm" | "cancel">("confirm");
  const selectedBtnRef = useRef<"confirm" | "cancel">("confirm");

  const selectButton = (next: "confirm" | "cancel") => {
    selectedBtnRef.current = next;
    setSelectedBtn(next);
    if (next === "confirm") {
      confirmBtnRef.current?.focus();
    } else {
      cancelBtnRef.current?.focus();
    }
  };

  useEffect(() => {
    if (isOpen) {
      selectedBtnRef.current = "confirm";
      setSelectedBtn("confirm");
      const timer = setTimeout(() => confirmBtnRef.current?.focus(), 50);

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          selectButton("confirm");
          return;
        }

        if (e.key === "ArrowRight") {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          selectButton("cancel");
          return;
        }

        if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Tab") {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          selectButton(selectedBtnRef.current === "confirm" ? "cancel" : "confirm");
          return;
        }

        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          if (
            selectedBtnRef.current === "cancel" ||
            document.activeElement === cancelBtnRef.current ||
            document.activeElement?.getAttribute("data-modal-cancel") === "true"
          ) {
            onCancel();
            return;
          }
          onConfirm();
        }
      };
      window.addEventListener("keydown", handleKeyDown, true);
      return () => {
        clearTimeout(timer);
        window.removeEventListener("keydown", handleKeyDown, true);
      };
    }
  }, [isOpen, onConfirm, onCancel]);

  const variantConfig = {
    danger: {
      icon: "🗑️",
      iconBg: "bg-rose-100 dark:bg-rose-950/80 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800/50",
    },
    warning: {
      icon: "🗑️",
      iconBg: "bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50",
    },
    primary: {
      icon: "🗑️",
      iconBg: "bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50",
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

      <ModalFooter className="grid grid-cols-2 gap-3">
        <button
          ref={confirmBtnRef}
          type="button"
          onClick={onConfirm}
          onFocus={() => {
            selectedBtnRef.current = "confirm";
            setSelectedBtn("confirm");
          }}
          onMouseEnter={() => selectButton("confirm")}
          className={`px-4 py-2.5 rounded-xl text-xs transition-all duration-150 cursor-pointer focus:outline-none flex items-center justify-center gap-1 ${
            selectedBtn === "confirm" ? ACTIVE_BTN_CLASSES : INACTIVE_BTN_CLASSES
          }`}
        >
          <span>{confirmText}</span>
          <span className="font-mono opacity-85">(Enter)</span>
        </button>
        <button
          ref={cancelBtnRef}
          type="button"
          data-modal-cancel="true"
          onClick={onCancel}
          onFocus={() => {
            selectedBtnRef.current = "cancel";
            setSelectedBtn("cancel");
          }}
          onMouseEnter={() => selectButton("cancel")}
          className={`px-4 py-2.5 rounded-xl text-xs transition-all duration-150 cursor-pointer focus:outline-none flex items-center justify-center gap-1 ${
            selectedBtn === "cancel" ? ACTIVE_BTN_CLASSES : INACTIVE_BTN_CLASSES
          }`}
        >
          <span>{cancelText}</span>
          <span className="font-mono opacity-85">(Esc)</span>
        </button>
      </ModalFooter>
    </ModalRoot>
  );
}
