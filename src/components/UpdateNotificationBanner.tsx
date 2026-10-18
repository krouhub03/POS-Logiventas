import { useUpdater } from "../contexts/UpdaterContext";

export function UpdateNotificationBanner() {
  const {
    status,
    progressPercent,
    currentVersion,
    bannerVisible,
    newVersion,
    releaseNotes,
    restartAndApply,
    dismissBanner,
  } = useUpdater();

  // 1. Tarjeta principal cuando la nueva versión está descargada y lista para aplicar
  if (bannerVisible) {
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
                className="text-slate-400 hover:text-white text-xs px-1.5 py-0.5 rounded transition-colors cursor-pointer"
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

  // 2. Notificación sutil: Descargando en segundo plano
  if (status === "downloading") {
    return (
      <aside
        aria-label="Descargando actualización en segundo plano"
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-1.5 p-3 rounded-xl bg-slate-900/95 border border-sky-500/50 text-white text-xs shadow-2xl backdrop-blur-md min-w-[250px] animate-in fade-in slide-in-from-bottom-2 duration-200"
      >
        <div className="flex items-center justify-between text-slate-200 font-medium">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
            Descargando actualización...
          </span>
          <span className="font-mono text-sky-400 font-bold">{progressPercent}%</span>
        </div>
        <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-all duration-300 rounded-full"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </aside>
    );
  }

  // 3. Notificación sutil: Comprobando al inicio
  if (status === "checking") {
    return (
      <div
        role="status"
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-700/80 text-slate-300 text-xs shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-200"
      >
        <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
        <span className="font-medium text-[11px]">Buscando actualizaciones...</span>
      </div>
    );
  }

  // 4. Notificación sutil: Sistema al día (se desvanece a los 3.5 segundos)
  if (status === "up-to-date") {
    return (
      <div
        role="status"
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-emerald-500/40 text-emerald-300 text-xs shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-200"
      >
        <span className="text-emerald-400 font-bold text-xs">✓</span>
        <span className="font-medium text-[11px]">Sistema al día {currentVersion ? `(v${currentVersion})` : ""}</span>
      </div>
    );
  }

  return null;
}
