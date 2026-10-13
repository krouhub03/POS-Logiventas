import { check, type Update, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { api } from "./api";

export interface UpdateProgress {
  totalBytes: number;
  downloadedBytes: number;
  percent: number;
}

export type UpdateProgressCallback = (progress: UpdateProgress) => void;

/**
 * Servicio encargado de la verificación, descarga silenciosa y aplicación
 * de actualizaciones automáticas vía Tauri 2 Updater.
 */
export const updaterService = {
  /**
   * Consulta el endpoint configurado en tauri.conf.json para determinar si hay una versión superior.
   */
  async checkForUpdate(): Promise<Update | null> {
    try {
      const update = await check();
      return update;
    } catch (err) {
      console.warn("[Updater] Error al consultar actualizaciones:", err);
      return null;
    }
  },

  /**
   * Descarga e instala silenciosamente los paquetes de actualización.
   * Notifica el avance en tiempo real mediante el callback opcional.
   */
  async downloadAndInstall(
    update: Update,
    onProgress?: UpdateProgressCallback
  ): Promise<void> {
    let totalBytes = 0;
    let downloadedBytes = 0;

    await update.downloadAndInstall((event: DownloadEvent) => {
      switch (event.event) {
        case "Started":
          totalBytes = event.data.contentLength ?? 0;
          if (onProgress) {
            onProgress({ totalBytes, downloadedBytes: 0, percent: 0 });
          }
          break;
        case "Progress":
          downloadedBytes += event.data.chunkLength;
          if (onProgress) {
            const percent =
              totalBytes > 0
                ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
                : 0;
            onProgress({ totalBytes, downloadedBytes, percent });
          }
          break;
        case "Finished":
          if (onProgress) {
            onProgress({ totalBytes, downloadedBytes: totalBytes, percent: 100 });
          }
          break;
      }
    });
  },

  /**
   * Reinicia la aplicación instantáneamente para ejecutar la nueva versión instalada.
   */
  async restartApp(): Promise<void> {
    await api.system.restartApp();
  },
};
