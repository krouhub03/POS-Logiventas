import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * Normaliza una ruta de archivo local y la convierte en una URL segura
 * del protocolo asset de Tauri para visualización en el WebView.
 * Si ya es una URL HTTP o Data URL, la retorna sin modificaciones.
 */
export function toAssetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (
    path.startsWith("data:") ||
    path.startsWith("http://") ||
    path.startsWith("https://") ||
    path.startsWith("asset://")
  ) {
    return path;
  }
  // Normalizar barras invertidas de Windows a barras diagonales para el protocolo web
  const normalized = path.replace(/\\/g, "/");
  try {
    return convertFileSrc(normalized);
  } catch {
    return convertFileSrc(path);
  }
}
