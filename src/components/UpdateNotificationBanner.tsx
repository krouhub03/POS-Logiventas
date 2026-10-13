import { useUpdater } from "../contexts/UpdaterContext";

export function UpdateNotificationBanner() {
  const {
    bannerVisible,
    newVersion,
    releaseNotes,
    restartAndApply,
    dismissBanner,
  } = useUpdater();

  if (!bannerVisible) return null;

  return (
    <aside
      aria-label="Notificación de actualización disponible"
      className="fixed bottom-4 right-4 z-50 max-w-md w-full bg-slate-900/95 dark:bg-slate-900/95 text-white border border-emerald-500/60 rounded-xl shadow-2xl p-4 backdrop-blur-md animate-in fade-in slide-in-from-bottom-5 duration-300"
    >
      <div className="flex items-start gap-3">
        <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg text-xl flex-shrink-0">
          🚀
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-sm text-emerald-300">
              ¡Actualización {newVersion ? `v${newVersion}` : ""} Lista!
            </h4>
            <button
              onClick={dismissBanner}
              className="text-slate-400 hover:text-white text-xs px-1.5 py-0.5 rounded transition-colors"
              title="Ocultar aviso (se aplicará al cerrar el sistema)"
            >
              ✕
            </button>
          </div>
          <p className="text-xs text-slate-300 mt-1 leading-relaxed">
            Se descargó e instaló automáticamente en segundo plano. Reinicia el punto de venta para comenzar a utilizar la nueva versión.
          </p>
          {releaseNotes && (
            <div className="mt-2 text-[11px] text-slate-400 max-h-16 overflow-y-auto bg-slate-950/60 p-2 rounded border border-slate-800">
              {releaseNotes}
            </div>
          )}
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => restartAndApply()}
              className="bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-sm transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <span>🔄</span> Reiniciar ahora
            </button>
            <button
              onClick={dismissBanner}
              className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
            >
              Aplicar al cerrar
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
