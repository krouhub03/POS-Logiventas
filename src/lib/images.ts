import { convertFileSrc } from "@tauri-apps/api/core";

export type ProductKind = "product" | "service" | "bundle";

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

function createPlaceholderSvg({
  icon,
  title,
  subtitle,
  bgGradient,
  badgeBg,
  badgeBorder,
  badgeText,
}: {
  icon: string;
  title: string;
  subtitle: string;
  bgGradient: string[];
  badgeBg: string;
  badgeBorder: string;
  badgeText: string;
}): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="100%" height="100%">
    <defs>
      <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${bgGradient[0]}" />
        <stop offset="60%" stop-color="${bgGradient[1]}" />
        <stop offset="100%" stop-color="${bgGradient[2]}" />
      </linearGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#000" flood-opacity="0.3" />
      </filter>
    </defs>
    <rect width="400" height="400" rx="44" fill="url(#grad)" />
    <circle cx="200" cy="155" r="75" fill="white" fill-opacity="0.08" />
    <text x="200" y="185" font-size="70" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif" filter="url(#shadow)">${icon}</text>
    <g transform="translate(200, 275)">
      <rect x="-95" y="-20" width="190" height="40" rx="20" fill="${badgeBg}" stroke="${badgeBorder}" stroke-width="2" />
      <text x="0" y="6" font-size="16" font-weight="900" letter-spacing="2" fill="${badgeText}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif">${title}</text>
    </g>
    <text x="200" y="340" font-size="15" font-weight="700" fill="white" fill-opacity="0.85" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif">${subtitle}</text>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * Retorna una imagen predeterminada en formato SVG Data URL según el tipo de producto:
 * - 'bundle': Combo / Producto compuesto (🍱)
 * - 'service': Servicio (🛠️)
 * - 'product': Producto físico estándar (📦)
 */
export function getDefaultProductImage(kind?: ProductKind | string | null): string {
  if (kind === "bundle") {
    return createPlaceholderSvg({
      icon: "🍱",
      title: "COMBO",
      subtitle: "Producto Compuesto",
      bgGradient: ["#9333ea", "#6b21a8", "#2e1065"],
      badgeBg: "rgba(147, 51, 234, 0.25)",
      badgeBorder: "rgba(192, 132, 252, 0.5)",
      badgeText: "#e9d5ff",
    });
  }
  if (kind === "service") {
    return createPlaceholderSvg({
      icon: "🛠️",
      title: "SERVICIO",
      subtitle: "Prestación / Mano de Obra",
      bgGradient: ["#0284c7", "#0369a1", "#082f49"],
      badgeBg: "rgba(2, 132, 199, 0.25)",
      badgeBorder: "rgba(56, 189, 248, 0.5)",
      badgeText: "#bae6fd",
    });
  }
  return createPlaceholderSvg({
    icon: "📦",
    title: "PRODUCTO",
    subtitle: "Artículo Físico",
    bgGradient: ["#475569", "#1e293b", "#0f172a"],
    badgeBg: "rgba(100, 116, 139, 0.25)",
    badgeBorder: "rgba(148, 163, 184, 0.5)",
    badgeText: "#e2e8f0",
  });
}

/**
 * Resuelve la fuente final de la imagen para un producto:
 * Si tiene imagen local o remota válida, la devuelve normalizada.
 * Si no tiene imagen, retorna la imagen predeterminada según el tipo.
 */
export function resolveProductImageSrc(
  imageLocalPath?: string | null,
  imageUrl?: string | null,
  kind?: ProductKind | string | null
): string {
  const assetUrl = toAssetUrl(imageLocalPath) || imageUrl;
  if (assetUrl) {
    return assetUrl;
  }
  return getDefaultProductImage(kind);
}
