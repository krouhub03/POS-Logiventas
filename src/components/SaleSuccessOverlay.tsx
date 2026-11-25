import { useEffect } from "react";
import { formatCents } from "../lib/money";
import { resolvePaymentMethodVisual } from "../lib/paymentMethodVisuals";
import type { PaymentMethod, SaleReceipt } from "../types";

export interface SaleSuccessData {
  receipt: SaleReceipt;
  paymentMethods: PaymentMethod[];
}

interface SaleSuccessOverlayProps {
  data: SaleSuccessData | null;
  onDismiss: () => void;
  durationMs?: number;
}

export function SaleSuccessOverlay({
  data,
  onDismiss,
  durationMs = 3000,
}: SaleSuccessOverlayProps) {
  useEffect(() => {
    if (!data) return;

    const timer = window.setTimeout(() => {
      onDismiss();
    }, durationMs);

    const handleKeyDown = (e: KeyboardEvent) => {
      // Cerrar al instante ante cualquier tecla o escaneo sin bloquear la entrada al lector
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
      }
      onDismiss();
    };

    // Pequeño retardo (80ms) para ignorar el Enter residual con el que se confirmó CobroModal
    const attachTimer = window.setTimeout(() => {
      window.addEventListener("keydown", handleKeyDown, { capture: true });
    }, 80);

    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(attachTimer);
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [data, onDismiss, durationMs]);

  if (!data) return null;

  const { receipt, paymentMethods } = data;
  const payments = receipt.payments || [];
  const isMixed = payments.length > 1;

  const findMethod = (code: string) =>
    paymentMethods.find(
      (pm) =>
        pm.code.toLowerCase() === code.toLowerCase() ||
        pm.erpCode.toLowerCase() === code.toLowerCase()
    );

  const primaryPayment = payments[0];
  const primaryMethodObj = primaryPayment ? findMethod(primaryPayment.method) : undefined;

  const visual = resolvePaymentMethodVisual({
    code: primaryPayment?.method,
    erpCode: primaryMethodObj?.erpCode,
    name: primaryMethodObj?.name,
    type: primaryMethodObj?.type,
    color: primaryMethodObj?.color,
    isMixed,
  });

  const methodLabel = isMixed
    ? `Pago Mixto (${payments.length} medios)`
    : primaryMethodObj?.name || primaryPayment?.method || "Efectivo";

  const isCash =
    !isMixed &&
    (primaryMethodObj?.type === "EFECTIVO" ||
      (primaryPayment?.method || "").toLowerCase().includes("cash") ||
      (primaryPayment?.method || "").toLowerCase().includes("efectivo"));

  const isCredit =
    !isMixed &&
    (primaryMethodObj?.type === "CREDITO" ||
      (primaryPayment?.method || "").toLowerCase().includes("credit") ||
      (primaryPayment?.method || "").toLowerCase().includes("credito") ||
      (primaryPayment?.method || "").toLowerCase().includes("fiar"));

  let pillLabel = `PAGADO CON ${methodLabel.toUpperCase()}`;
  let pillValue = formatCents(receipt.totalCents);

  if (isMixed) {
    const summaryParts = payments.slice(0, 2).map((p) => {
      const m = findMethod(p.method);
      const shortName = (m?.name || p.method).split(" ")[0].toUpperCase();
      return `${shortName} ${formatCents(p.amountCents)}`;
    });
    if (payments.length > 2) {
      summaryParts.push(`+${payments.length - 2}`);
    }
    pillLabel = summaryParts.join(" · ");
    pillValue =
      receipt.changeCents > 0
        ? `CAMBIO ${formatCents(receipt.changeCents)}`
        : "PAGADO";
  } else if (isCash) {
    pillLabel = receipt.changeCents > 0 ? "CAMBIO (VUELTO)" : "PAGO EXACTO";
    pillValue = formatCents(receipt.changeCents);
  } else if (isCredit) {
    const holder = receipt.customerName ? ` · ${receipt.customerName.toUpperCase()}` : "";
    pillLabel = `CARGADO A CRÉDITO${holder}`;
    pillValue = formatCents(receipt.totalCents);
  } else if (primaryPayment?.reference) {
    pillLabel = `${methodLabel.toUpperCase()} · REF ${primaryPayment.reference}`;
    pillValue = formatCents(receipt.totalCents);
  }

  return (
    <div
      onClick={onDismiss}
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-slate-900/25 backdrop-blur-[2px] cursor-pointer"
    >
      <style>{`
        @keyframes posHeroPopIn {
          0% { opacity: 0; transform: scale(0.92) translateY(0.5rem); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes posHeroCheck {
          0% { transform: scale(0.5); opacity: 0; }
          70% { transform: scale(1.08); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes posHeroDrain {
          0% { width: 100%; }
          100% { width: 0%; }
        }
      `}</style>

      <div
        className="w-full max-w-[27rem] bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden text-center"
        style={{ animation: "posHeroPopIn 220ms cubic-bezier(0.16, 1, 0.3, 1) forwards" }}
      >
        <div className="px-6 pt-6 pb-5 flex flex-col items-center">
          {/* Sello circular de éxito */}
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center mb-3 bg-emerald-600"
            style={{
              boxShadow: "0 0 0 0.5rem rgba(5, 150, 105, 0.14)",
              animation: "posHeroCheck 360ms cubic-bezier(0.16, 1, 0.3, 1) forwards",
            }}
          >
            <svg
              className="w-8 h-8 text-white"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <h3 className="text-xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            ¡Venta Registrada!
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-medium">
            Folio #{receipt.folio} · {methodLabel}
          </p>

          <div className="font-mono tabular-nums text-3xl font-black text-slate-900 dark:text-white mt-3 tracking-tight">
            {formatCents(receipt.totalCents)}
          </div>

          {/* Píldora inferior con el color sincronizado del medio de pago (sin logo) */}
          <div
            className="mt-3.5 w-full rounded-xl px-4 py-2.5 flex items-center justify-between gap-2 text-xs font-bold border"
            style={{
              backgroundColor: visual.bgTint,
              borderColor: visual.borderTint,
              color: visual.color,
            }}
          >
            <span className="truncate">{pillLabel}</span>
            <span className="font-mono tabular-nums text-base font-extrabold shrink-0">
              {pillValue}
            </span>
          </div>

          <p className="text-xs text-slate-400 dark:text-slate-500 mt-3">
            Continúa escaneando o presiona cualquier tecla
          </p>
        </div>

        {/* Barra de progreso de auto-cierre sincronizada con el color del medio */}
        <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800">
          <div
            className="h-full"
            style={{
              backgroundColor: visual.color,
              animation: `posHeroDrain ${durationMs}ms linear forwards`,
            }}
          />
        </div>
      </div>
    </div>
  );
}
