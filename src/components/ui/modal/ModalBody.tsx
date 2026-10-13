import { ReactNode } from "react";

export interface ModalBodyProps {
  children: ReactNode;
  className?: string;
}

export function ModalBody({ children, className = "" }: ModalBodyProps) {
  return (
    <div className={`p-6 text-sm text-slate-700 dark:text-slate-300 ${className}`}>
      {children}
    </div>
  );
}
