import { useState, useEffect } from "react";
import { ModalRoot } from "./ui/modal/ModalRoot";
import { ModalHeader } from "./ui/modal/ModalHeader";
import { ModalBody } from "./ui/modal/ModalBody";
import { api } from "../services/api";

export interface ImageLightboxModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageSrc: string | null;
  title: string;
  subtitle?: string;
  productId?: number;
}

export function ImageLightboxModal({
  isOpen,
  onClose,
  imageSrc,
  title,
  subtitle,
  productId,
}: ImageLightboxModalProps) {
  const [currentSrc, setCurrentSrc] = useState<string | null>(imageSrc);
  const [isLoadingFallback, setIsLoadingFallback] = useState(false);

  useEffect(() => {
    setCurrentSrc(imageSrc);
    setIsLoadingFallback(false);
  }, [imageSrc, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen || (!currentSrc && !productId)) return null;

  return (
    <ModalRoot isOpen={isOpen} onClose={onClose} maxWidth="2xl">
      <ModalHeader
        icon="🔍"
        title={title || "Foto del Producto"}
        subtitle={subtitle}
        onClose={onClose}
      />
      <ModalBody className="p-4">
        <div
          className="flex flex-col items-center justify-center p-3 bg-slate-950/5 dark:bg-slate-950/50 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 overflow-hidden"
          onDoubleClick={onClose}
          title="Doble clic para cerrar vista ampliada"
        >
          {currentSrc ? (
            <img
              src={currentSrc}
              alt={title}
              onError={async () => {
                if (productId && !isLoadingFallback) {
                  setIsLoadingFallback(true);
                  try {
                    const b64 = await api.products.getImageBase64(productId);
                    if (b64) {
                      setCurrentSrc(b64);
                    }
                  } catch (err) {
                    console.warn("[ImageLightboxModal] Error al cargar fallback Base64:", err);
                  } finally {
                    setIsLoadingFallback(false);
                  }
                }
              }}
              className="max-h-[70vh] w-auto max-w-full object-contain rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 transition-all select-none"
            />
          ) : (
            <div className="py-20 flex flex-col items-center justify-center text-slate-400 gap-2">
              <span className="text-4xl">🖼️</span>
              <span className="text-xs font-semibold">Cargando imagen...</span>
            </div>
          )}

          <div className="mt-3 flex items-center justify-between w-full text-[11px] text-slate-500 dark:text-slate-400 px-1">
            <span className="flex items-center gap-1.5">
              <span>💡</span>
              <span>
                Doble clic sobre la imagen o pulsa{" "}
                <kbd className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono font-bold text-[10px]">
                  ESC
                </kbd>{" "}
                para cerrar
              </span>
            </span>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs transition-colors cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        </div>
      </ModalBody>
    </ModalRoot>
  );
}
