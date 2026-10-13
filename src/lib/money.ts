const formatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

/** Convierte centavos (entero) a texto de moneda. */
export function formatCents(cents: number): string {
  return formatter.format(cents / 100);
}

/** Convierte un texto/numero en pesos a centavos enteros (redondeo seguro). */
export function toCents(amount: number | string): number {
  const n = typeof amount === "string" ? Number(amount.replace(",", ".")) : amount;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/**
 * Calcula el impuesto en centavos a partir del subtotal en centavos y la tasa en puntos base (BP).
 * 1% = 100 bp. Si la tasa es 0 o no está definida, el impuesto es estrictamente 0.
 */
export function calculateTaxCents(subtotalCents: number, taxRateBp?: number): number {
  if (!taxRateBp || taxRateBp <= 0) return 0;
  return Math.round((subtotalCents * taxRateBp) / 10000);
}
