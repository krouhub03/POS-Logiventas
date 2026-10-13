import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { updaterService } from "../services/updater";

export type UpdaterStatus =
  | "idle"
  | "checking"
  | "downloading"
  | "ready"
  | "up-to-date"
  | "error";

interface UpdaterContextType {
  status: UpdaterStatus;
  progressPercent: number;
  newVersion: string | null;
  releaseNotes: string | null;
  errorMsg: string | null;
  bannerVisible: boolean;
  checkForUpdates: (manual?: boolean) => Promise<void>;
  restartAndApply: () => Promise<void>;
  dismissBanner: () => void;
}

const UpdaterContext = createContext<UpdaterContextType | undefined>(undefined);

export function UpdaterProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<UpdaterStatus>("idle");
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [newVersion, setNewVersion] = useState<string | null>(null);
  const [releaseNotes, setReleaseNotes] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState<boolean>(false);

  const checkForUpdates = useCallback(async (manual: boolean = false) => {
    try {
      setStatus("checking");
      setErrorMsg(null);

      const update = await updaterService.checkForUpdate();

      if (!update) {
        setStatus("up-to-date");
        if (manual) {
          setTimeout(() => setStatus("idle"), 4000);
        } else {
          setStatus("idle");
        }
        return;
      }

      setNewVersion(update.version);
      setReleaseNotes(update.body ?? null);

      // Descarga silenciosa en segundo plano
      setStatus("downloading");
      setProgressPercent(0);

      await updaterService.downloadAndInstall(update, (progress) => {
        setProgressPercent(progress.percent);
      });

      // Actualización descargada e instalada en segundo plano
      setStatus("ready");
      setBannerDismissed(false);
    } catch (err) {
      console.error("[Updater] Error procesando actualización:", err);
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus("error");
      if (manual) {
        setTimeout(() => setStatus("idle"), 5000);
      }
    }
  }, []);

  const restartAndApply = useCallback(async () => {
    try {
      await updaterService.restartApp();
    } catch (err) {
      console.error("[Updater] Error reiniciando aplicación:", err);
      setErrorMsg("No se pudo reiniciar automáticamente la aplicación.");
    }
  }, []);

  const dismissBanner = useCallback(() => {
    setBannerDismissed(true);
  }, []);

  // Verificación silenciosa en segundo plano al arrancar (tras 4 segundos)
  useEffect(() => {
    const timer = setTimeout(() => {
      checkForUpdates(false).catch((err) =>
        console.warn("[Updater] Falló comprobación automática inicial:", err)
      );
    }, 4000);

    // Revisar periódicamente cada 60 minutos
    const interval = setInterval(() => {
      checkForUpdates(false).catch((err) =>
        console.warn("[Updater] Falló comprobación periódica:", err)
      );
    }, 60 * 60 * 1000);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [checkForUpdates]);

  const bannerVisible = status === "ready" && !bannerDismissed;

  return (
    <UpdaterContext.Provider
      value={{
        status,
        progressPercent,
        newVersion,
        releaseNotes,
        errorMsg,
        bannerVisible,
        checkForUpdates,
        restartAndApply,
        dismissBanner,
      }}
    >
      {children}
    </UpdaterContext.Provider>
  );
}

export function useUpdater() {
  const ctx = useContext(UpdaterContext);
  if (!ctx) {
    throw new Error("useUpdater debe usarse dentro de un UpdaterProvider");
  }
  return ctx;
}
