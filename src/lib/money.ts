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
