import { useState, useRef, useEffect, useCallback } from "react";
import { formatCents } from "../lib/money";
import { api } from "../services/api";
import type { SaleReceipt } from "../types";
import { PrinterConfigModal } from "./PrinterConfigModal";

interface ReceiptModalProps {
  receipt: SaleReceipt | null;
  isOpen: boolean;
  onClose: () => void;
  onRequestReturn?: (receipt: SaleReceipt) => void;
  businessName?: string;
  businessNit?: string;
  businessAddress?: string;
  businessPhone?: string;
  businessCity?: string;
  businessRegimen?: string;
  businessLogo?: string;
  terminalCode?: string;
}

export function ReceiptModal({
  receipt: initialReceipt,
  isOpen,
  onClose,
  onRequestReturn,
  businessName = "LOGIVENTA POS",
  businessNit,
  businessAddress,
  businessPhone,
  businessCity,
  businessRegimen,
  businessLogo,
  terminalCode = "CAJA-01",
}: ReceiptModalProps) {
  const [currentReceipt, setCurrentReceipt] = useState<SaleReceipt | null>(initialReceipt);
  const [isPrintingDirect, setIsPrintingDirect] = useState(false);
  const [isPrintingDialog, setIsPrintingDialog] = useState(false);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);
  const [printerSettings, setPrinterSettings] = useState<Record<string, string>>({});
  const printAreaRef = useRef<HTMLDivElement>(null);

  // Cargar configuración de impresora al abrir
  const loadPrinterSettings = useCallback(() => {
    api.settings.getAll()
      .then((map) => setPrinterSettings(map))
      .catch((err) => console.warn("No se pudieron cargar ajustes de impresora:", err));
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadPrinterSettings();
      setStatusMessage(null);
    }
  }, [isOpen, loadPrinterSettings]);

  // Mantener actualizado el recibo si cambia la prop
  if (initialReceipt && initialReceipt.id !== currentReceipt?.id) {
    setCurrentReceipt(initialReceipt);
  }

  if (!isOpen || !currentReceipt) return null;

  const printerTarget = printerSettings.printer_target || "Sin configurar";
  const paperWidth = printerSettings.printer_paper_width || "58mm";
  const isPrinterEnabled = printerSettings.printer_enabled !== "false";

  // 1. IMPRESIÓN DIRECTA TÉRMICA ESC/POS (Spooler de Windows / Sin diálogos)
  const handleDirectThermalPrint = async () => {
    setIsPrintingDirect(true);
    setStatusMessage({ text: "Enviando al spooler térmico...", type: "info" });

    try {
      // Registrar reimpresión si corresponde
      const updated = await api.sales.reprintSale(currentReceipt.id);
      setCurrentReceipt(updated);

      // Enviar directamente los bytes ESC/POS al controlador de Windows
      const res = await api.printers.printSaleTicket(currentReceipt.id);
      setStatusMessage({ text: `✅ ${res}`, type: "success" });
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (err) {
      console.error("Error en impresión térmica directa:", err);
      const errMsg = String(err);
      setStatusMessage({
        text: `❌ Error: ${errMsg}. Puedes usar el diálogo de Windows o configurar tu impresora.`,
        type: "error",
      });
    } finally {
      setIsPrintingDirect(false);
    }
  };

  // 2. IMPRESIÓN ASISTIDA / DIÁLOGO DE WINDOWS / GUARDAR PDF
  const printReceiptViaIframe = () => {
    if (!printAreaRef.current) return;
    const content = printAreaRef.current.innerHTML;

    let iframe = document.getElementById("pos-receipt-print-frame") as HTMLIFrameElement;
    if (iframe) {
      iframe.remove();
    }
    iframe = document.createElement("iframe");
    iframe.id = "pos-receipt-print-frame";
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.visibility = "hidden";
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document || iframe.contentDocument;
    if (!doc) {
      window.print();
      return;
    }

    const printWidth = paperWidth.includes("80") ? "80mm" : "58mm";

    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Ticket ${currentReceipt.folio}</title>
          <style>
            @page {
              margin: 0;
              size: ${printWidth} auto;
            }
            *, *::before, *::after {
              box-sizing: border-box;
            }
            html, body {
              margin: 0 auto !important;
              padding: 2mm 3mm !important;
              font-family: 'Courier New', Courier, monospace, monospace;
              font-size: 11px;
              line-height: 1.25;
              color: #000;
              background: #fff;
              width: ${printWidth} !important;
              max-width: ${printWidth} !important;
              overflow: hidden;
            }
            .text-center { text-align: center !important; }
            .text-right { text-align: right !important; }
            .font-bold { font-weight: bold !important; }
            .font-black { font-weight: 900 !important; }
            .font-medium { font-weight: 600 !important; }
            .uppercase { text-transform: uppercase !important; }
            .border-b { border-bottom: 1px dashed #333 !important; }
            .border-t { border-top: 1px dashed #333 !important; }
            .border-dashed { border-style: dashed !important; }
            .border-y-2 { border-top: 2px dashed #000 !important; border-bottom: 2px dashed #000 !important; }
            .py-1 { padding-top: 2px !important; padding-bottom: 2px !important; }
            .py-2 { padding-top: 4px !important; padding-bottom: 4px !important; }
            .pb-1 { padding-bottom: 2px !important; }
            .pb-3 { padding-bottom: 6px !important; }
            .my-2 { margin-top: 4px !important; margin-bottom: 4px !important; }
            .flex { display: flex !important; width: 100% !important; justify-content: space-between !important; }
            .justify-between { justify-content: space-between !important; }
            .items-start { align-items: flex-start !important; }
            .text-xs { font-size: 12px !important; }
            .text-sm { font-size: 13px !important; }
            .text-base { font-size: 14px !important; }
            img { max-height: 55px !important; max-width: 170px !important; object-fit: contain !important; margin: 0 auto 6px auto !important; display: block !important; }
          </style>
        </head>
        <body>
          ${content}
        </body>
      </html>
    `);
    doc.close();

    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch (err) {
        console.error("Error al imprimir iframe:", err);
        window.print();
      }
    }, 200);
  };

  const handleDialogPrint = async () => {
    setIsPrintingDialog(true);
    try {
      const updated = await api.sales.reprintSale(currentReceipt.id);
      setCurrentReceipt(updated);
      printReceiptViaIframe();
    } catch (err) {
      console.error("Error al registrar reimpresión para diálogo:", err);
      printReceiptViaIframe();
    } finally {
      setIsPrintingDialog(false);
    }
  };

  const isReprint = (currentReceipt.reprintCount || 0) > 0;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-lg w-full flex flex-col max-h-[92vh] overflow-hidden">
          {/* Cabecera del Modal */}
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/60">
            <div className="flex items-center gap-2.5">
              <span className="text-xl">🧾</span>
              <div>
                <h2 className="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-2">
                  <span>Ticket de Venta {currentReceipt.folio}</span>
                  {isReprint && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                      Reimpresión #{currentReceipt.reprintCount}
                    </span>
                  )}
                </h2>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  <span>{new Date(currentReceipt.createdAt).toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsConfigOpen(true)}
                className="px-2.5 py-1 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors flex items-center gap-1 cursor-pointer"
                title="Configurar impresora térmica POS"
              >
                <span>⚙️</span>
                <span className="hidden sm:inline font-medium">Impresora</span>
              </button>

              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                title="Cerrar (Esc)"
              >
                ✕
              </button>
            </div>
          </div>

          {/* BANNER DE ESTADO DE LA IMPRESORA */}
          <div className="px-4 py-2 bg-slate-100 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="text-emerald-500 font-bold">🖨️</span>
              <span className="text-slate-600 dark:text-slate-300">
                Impresora actual: <strong className="font-mono text-slate-900 dark:text-white">{printerTarget}</strong> ({paperWidth})
              </span>
            </div>
            <button
              onClick={() => setIsConfigOpen(true)}
              className="text-emerald-600 dark:text-emerald-400 font-semibold text-[11px] hover:underline cursor-pointer"
            >
              Cambiar
            </button>
          </div>

          {/* MENSAJES DE ESTADO */}
          {statusMessage && (
            <div
              className={`px-4 py-2 text-xs font-semibold flex items-center justify-between ${
                statusMessage.type === "success"
                  ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-b border-emerald-200 dark:border-emerald-800"
                  : statusMessage.type === "error"
                  ? "bg-rose-50 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border-b border-rose-200 dark:border-rose-800"
                  : "bg-sky-50 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300 border-b border-sky-200 dark:border-sky-800"
              }`}
            >
              <span>{statusMessage.text}</span>
              <button
                onClick={() => setStatusMessage(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                ✕
              </button>
            </div>
          )}

          {/* Visor de Tirilla Térmica (58mm/80mm) */}
          <div className="flex-1 overflow-y-auto p-4 bg-slate-100 dark:bg-slate-950 flex justify-center">
            <div
              ref={printAreaRef}
              id="print-receipt-area"
              className="w-full max-w-[340px] bg-white text-slate-900 p-5 rounded-lg shadow-sm border border-slate-200 font-mono text-[11px] leading-tight"
              style={{ fontFamily: "'Courier New', Courier, monospace" }}
            >
              {/* ENCABEZADO FISCAL */}
              <div className="text-center pb-3 border-b border-dashed border-slate-400">
                {businessLogo && (
                  <div className="flex justify-center mb-2">
                    <img
                      src={businessLogo}
                      alt="Logo Empresa"
                      className="max-h-12 max-w-[160px] object-contain filter grayscale contrast-125"
                    />
                  </div>
                )}
                <div className="text-sm font-black uppercase tracking-wider">{businessName}</div>
                {businessNit && <div className="text-[10px]">NIT/RUT: {businessNit}</div>}
                {businessRegimen && <div className="text-[10px] text-slate-700">{businessRegimen}</div>}
                {businessAddress && <div className="text-[10px] text-slate-700">{businessAddress}</div>}
                {businessPhone && <div className="text-[10px] text-slate-700">Tel: {businessPhone}</div>}
                {businessCity && <div className="text-[10px] text-slate-700">{businessCity}</div>}
                <div className="text-[10px] text-slate-600 mt-1">Terminal: {terminalCode}</div>
                <div className="text-[10px] text-slate-600">
                  Fecha: {new Date(currentReceipt.createdAt).toLocaleString()}
                </div>
                <div className="text-xs font-black mt-1">TICKET: {currentReceipt.folio}</div>
                {currentReceipt.cashierName && (
                  <div className="text-[10px] text-slate-600">Cajero: {currentReceipt.cashierName}</div>
                )}
              </div>

              {/* MARCA DE AGUA / SELLO DE REIMPRESIÓN */}
              {isReprint && (
                <div className="my-2 py-1 border-y-2 border-dashed border-amber-600 text-center font-black text-amber-800 text-[11px] bg-amber-50">
                  *** COPIA DE TICKET #{currentReceipt.reprintCount} ***
                  <div className="text-[9px] font-normal">REIMPRESIÓN SIN VALOR FISCAL ADICIONAL</div>
                </div>
              )}

              {/* DATOS DEL CLIENTE */}
              <div className="py-2 border-b border-dashed border-slate-400 text-[10px]">
                <div>
                  <span className="font-bold">Cliente:</span>{" "}
                  {currentReceipt.customerName || "Consumidor Final"}
                </div>
                {currentReceipt.customerTaxId && (
                  <div>
                    <span className="font-bold">NIT/CC:</span> {currentReceipt.customerTaxId}
                  </div>
                )}
              </div>

              {/* LISTA DE ARTÍCULOS */}
              <div className="py-2 border-b border-dashed border-slate-400">
                <div className="flex justify-between font-bold text-[10px] pb-1 border-b border-slate-300">
                  <span>CANT. DESCRIPCIÓN</span>
                  <span>TOTAL</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {currentReceipt.items.map((it) => (
                    <div key={it.id} className="py-1">
                      <div className="flex justify-between items-start">
                        <span className="font-medium pr-1">
                          {it.quantity} x {it.description}
                        </span>
                        <span className="font-bold shrink-0">{formatCents(it.totalCents)}</span>
                      </div>
                      <div className="flex justify-between text-[10px] text-slate-500 pl-2">
                        <span>Precio: {formatCents(it.unitPriceCents)}</span>
                        {it.discountCents > 0 && (
                          <span className="text-rose-600">Desc: -{formatCents(it.discountCents)}</span>
                        )}
                      </div>
                      {it.returnedQuantity > 0 && (
                        <div className="text-[9px] text-amber-700 font-bold pl-2">
                          ↩ Devueltas: {it.returnedQuantity} unid.
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* TOTALES */}
              <div className="py-2 border-b border-dashed border-slate-400 space-y-1 text-[11px]">
                <div className="flex justify-between">
                  <span>Subtotal:</span>
                  <span>{formatCents(currentReceipt.subtotalCents)}</span>
                </div>
                {currentReceipt.discountCents > 0 && (
                  <div className="flex justify-between text-rose-600">
                    <span>Descuento:</span>
                    <span>-{formatCents(currentReceipt.discountCents)}</span>
                  </div>
                )}
                {currentReceipt.taxCents > 0 && (
                  <div className="flex justify-between">
                    <span>Impuestos (IVA):</span>
                    <span>{formatCents(currentReceipt.taxCents)}</span>
                  </div>
                )}
                <div className="flex justify-between font-black text-xs pt-1 border-t border-slate-300">
                  <span>TOTAL:</span>
                  <span>{formatCents(currentReceipt.totalCents)}</span>
                </div>
              </div>

              {/* FORMAS DE PAGO */}
              <div className="py-2 border-b border-dashed border-slate-400 space-y-1 text-[10px]">
                <div className="font-bold text-slate-700">FORMAS DE PAGO:</div>
                {currentReceipt.payments.map((p) => (
                  <div key={p.id} className="flex justify-between pl-2">
                    <span className="capitalize">{p.methodName || p.method}</span>
                    <span className="font-bold">{formatCents(p.amountCents)}</span>
                  </div>
                ))}
                <div className="flex justify-between font-bold pt-1 border-t border-slate-200">
                  <span>Total Pagado:</span>
                  <span>{formatCents(currentReceipt.paidCents)}</span>
                </div>
                {currentReceipt.changeCents > 0 && (
                  <div className="flex justify-between text-slate-600 pl-2">
                    <span>Cambio:</span>
                    <span>{formatCents(currentReceipt.changeCents)}</span>
                  </div>
                )}
              </div>

              {/* PIE DE PÁGINA */}
              <div className="text-center pt-3 text-[10px] text-slate-600 space-y-1">
                <div>¡Gracias por su compra!</div>
                <div>Conserve este ticket para devoluciones o garantías.</div>
              </div>
            </div>
          </div>

          {/* Botones de Acción */}
          <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 bg-slate-50 dark:bg-slate-800/60 print:hidden no-print">
            <div>
              {onRequestReturn && currentReceipt.returnStatus !== "full" && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onRequestReturn(currentReceipt);
                  }}
                  className="px-3 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-900/50 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800 text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <span>↩️</span>
                  <span>Devolver Ítems</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs font-semibold transition-colors cursor-pointer"
              >
                Cerrar (Esc)
              </button>

              {/* BOTÓN 1: Diálogo del Sistema / PDF */}
              <button
                type="button"
                disabled={isPrintingDialog}
                onClick={handleDialogPrint}
                className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                title="Abrir cuadro de impresión de Windows o guardar en PDF"
              >
                <span>📄</span>
                <span>PDF / Windows</span>
              </button>

              {/* BOTÓN 2: Impresión Directa Térmica ESC/POS (Recomendada) */}
              <button
                type="button"
                disabled={isPrintingDirect || !isPrinterEnabled}
                onClick={handleDirectThermalPrint}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-bold flex items-center gap-2 shadow-md transition-colors cursor-pointer disabled:opacity-50"
                title={`Imprimir directamente en ${printerTarget}`}
              >
                <span>{isPrintingDirect ? "⏳" : "🖨️"}</span>
                <span>{isPrintingDirect ? "Enviando..." : isReprint ? "Reimprimir Térmico" : "Imprimir Ticket"}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* MODAL DE CONFIGURACIÓN DE IMPRESORA */}
      <PrinterConfigModal
        isOpen={isConfigOpen}
        onClose={() => setIsConfigOpen(false)}
        onSaved={loadPrinterSettings}
      />
    </>
  );
}
