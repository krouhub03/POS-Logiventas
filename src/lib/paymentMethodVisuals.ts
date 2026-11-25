export interface PaymentMethodVisual {
  color: string;
  bgTint: string;
  borderTint: string;
  logoSrc: string;
  fallbackLogoSrc: string;
}

const HEX_REGEX = /^#[0-9a-fA-F]{6}$/;

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = HEX_REGEX.test(hex) ? hex.slice(1) : "009966";
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

export function buildColorTints(hex: string): { color: string; bgTint: string; borderTint: string } {
  const validHex = HEX_REGEX.test(hex.trim()) ? hex.trim().toLowerCase() : "#009966";
  const { r, g, b } = hexToRgb(validHex);
  return {
    color: validHex,
    bgTint: `rgba(${r}, ${g}, ${b}, 0.09)`,
    borderTint: `rgba(${r}, ${g}, ${b}, 0.32)`,
  };
}

/**
 * Resuelve logo local (100% offline) y color sincronizado desde el ERP para un medio de pago.
 */
export function resolvePaymentMethodVisual(input: {
  code?: string | null;
  erpCode?: string | null;
  name?: string | null;
  type?: string | null;
  color?: string | null;
  imageUrl?: string | null;
  isMixed?: boolean;
}): PaymentMethodVisual {
  const combined = `${input.code || ""} ${input.erpCode || ""} ${input.name || ""}`.toLowerCase();
  const typeUpper = (input.type || "").toUpperCase();

  let defaultColor = "#009966";
  let defaultLogo = "/payment-methods/efectivo.svg";

  if (input.isMixed || combined.includes("mixto") || combined.includes("mixed")) {
    defaultColor = "#0d9488";
    defaultLogo = "/payment-methods/mixto.svg";
  } else if (combined.includes("nequi")) {
    defaultColor = "#db2777";
    defaultLogo = "/payment-methods/nequi.svg";
  } else if (combined.includes("daviplata") || combined.includes("davi")) {
    defaultColor = "#dc2626";
    defaultLogo = "/payment-methods/daviplata.svg";
  } else if (
    combined.includes("credito") ||
    combined.includes("crédito") ||
    combined.includes("fiar") ||
    combined.includes("fiao") ||
    typeUpper === "CREDITO"
  ) {
    defaultColor = "#d97706";
    defaultLogo = "/payment-methods/credito.svg";
  } else if (
    combined.includes("card") ||
    combined.includes("tarjeta") ||
    combined.includes("datafono") ||
    combined.includes("datáfono") ||
    combined.includes("bold") ||
    typeUpper === "TARJETA"
  ) {
    defaultColor = "#2563eb";
    defaultLogo = "/payment-methods/tarjeta.svg";
  } else if (
    combined.includes("transfer") ||
    combined.includes("banco") ||
    combined.includes("bancolombia") ||
    combined.includes("pse") ||
    typeUpper === "BANCO"
  ) {
    defaultColor = "#4f46e5";
    defaultLogo = "/payment-methods/transferencia.svg";
  } else if (
    combined.includes("cash") ||
    combined.includes("efectivo") ||
    combined.includes("caja") ||
    typeUpper === "EFECTIVO"
  ) {
    defaultColor = "#009966";
    defaultLogo = "/payment-methods/efectivo.svg";
  }

  let resolvedLogo = defaultLogo;
  const rawImg = (input.imageUrl || "").trim();
  if (rawImg) {
    if (rawImg.startsWith("/images/medios-pago/")) {
      // Mapear ruta de logo por defecto del ERP al archivo local empaquetado en el POS (100% offline)
      resolvedLogo = rawImg.replace("/images/medios-pago/", "/payment-methods/");
    } else if (rawImg.startsWith("data:image/") || rawImg.startsWith("http://") || rawImg.startsWith("https://") || rawImg.startsWith("/")) {
      resolvedLogo = rawImg;
    }
  }

  const chosenColor = input.color && HEX_REGEX.test(input.color.trim()) ? input.color.trim() : defaultColor;
  const tints = buildColorTints(chosenColor);

  return {
    ...tints,
    logoSrc: resolvedLogo,
    fallbackLogoSrc: defaultLogo,
  };
}
