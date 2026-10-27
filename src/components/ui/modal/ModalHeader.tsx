import { ReactNode } from "react";

export interface ModalHeaderProps {
  title: ReactNode;
  icon?: ReactNode;
  onClose?: () => void;
  subtitle?: ReactNode;
}

export function ModalHeader({ title, icon, onClose, subtitle }: ModalHeaderProps) {
  return (
    <div className="shrink-0 px-6 py-4 bg-slate-50 dark:bg-slate-950/80 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-4">
      <div className="flex items-center gap-3">
        {icon && <span className="text-xl flex-shrink-0">{icon}</span>}
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white leading-tight">
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors rounded-lg p-1 text-base font-bold"
          title="Cerrar (Esc)"
        >
          ✕
        </button>
      )}
    </div>
  );
}
