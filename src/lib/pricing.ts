/**
 * Motor matemático puro de cálculo de costos, utilidad, margen, IVA y valoración
 * de inventario para Metahabi POS.
 *
 * Convenciones financieras estrictas:
 * - Todo valor monetario se opera y retorna en CENTAVOS ENTEROS (number entero).
 * - Las tasas de IVA se operan en PUNTOS BASE (1% = 100 bp, 19% = 1900 bp).
 */

export type ProfitabilityHealth = "loss" | "low" | "healthy";

export interface ProfitabilityMetrics {
  profitCents: number;
  markupPct: number;
  marginPct: number;
  health: ProfitabilityHealth;
}

export interface TaxBreakdown {
  baseCents: number;
  taxCents: number;
  pvpCents: number;
}

export interface InventoryValuation {
  totalCostCents: number;
  totalSaleCents: number;
  projectedProfitCents: number;
}

/**
 * Calcula el costo unitario en centavos a partir del costo total de una caja/paca/canasta.
 */
export function calcUnitCostFromPack(
  packCostCents: number,
  unitsPerPack: number
): number {
  if (!Number.isFinite(packCostCents) || packCostCents <= 0) return 0;
  if (!Number.isFinite(unitsPerPack) || unitsPerPack <= 0) return 0;
  return Math.round(packCostCents / unitsPerPack);
}

/**
 * Calcula el precio de venta base en centavos aplicando un porcentaje de utilidad sobre el costo.
 * Ej: costCents = 374100 ($3,741), markupPct = 20 => 448920 ($4,489.20).
 */
export function calcPriceFromMarkup(
  costCents: number,
  markupPct: number
): number {
  if (!Number.isFinite(costCents) || costCents <= 0) return 0;
  if (!Number.isFinite(markupPct)) return costCents;
  const factor = Math.max(0, 100 + markupPct);
  return Math.round((costCents * factor) / 100);
}

/**
 * Extrae el precio base (antes de IVA) a partir de un PVP que ya incluye IVA.
 */
export function calcBaseFromPvpWithTax(
  pvpCents: number,
  taxRateBp: number
): number {
  if (!Number.isFinite(pvpCents) || pvpCents <= 0) return 0;
  if (!Number.isFinite(taxRateBp) || taxRateBp <= 0) return Math.round(pvpCents);
  return Math.round((pvpCents * 10000) / (10000 + taxRateBp));
}

/**
 * Calcula el desglose de IVA sobre un precio base (alineado con el redondeo bancario de Rust).
 */
export function calcPvpFromBaseWithTax(
  baseCents: number,
  taxRateBp: number
): TaxBreakdown {
  const safeBase = Number.isFinite(baseCents) && baseCents > 0 ? Math.round(baseCents) : 0;
  const safeBp = Number.isFinite(taxRateBp) && taxRateBp > 0 ? Math.round(taxRateBp) : 0;
  if (safeBp === 0) {
    return { baseCents: safeBase, taxCents: 0, pvpCents: safeBase };
  }
  const taxCents = Math.floor((safeBase * safeBp + 5000) / 10000);
  return {
    baseCents: safeBase,
    taxCents,
    pvpCents: safeBase + taxCents,
  };
}

/**
 * Calcula ganancia neta, utilidad sobre costo (markup %), margen bruto sobre venta (%)
 * y estado del semáforo de rentabilidad.
 */
export function calcProfitability(
  costCents: number,
  basePriceCents: number
): ProfitabilityMetrics {
  const safeCost = Number.isFinite(costCents) && costCents > 0 ? Math.round(costCents) : 0;
  const safePrice = Number.isFinite(basePriceCents) && basePriceCents > 0 ? Math.round(basePriceCents) : 0;
  const profitCents = safePrice - safeCost;

  const markupPct = safeCost > 0 ? (profitCents / safeCost) * 100 : 0;
  const marginPct = safePrice > 0 ? (profitCents / safePrice) * 100 : 0;

  let health: ProfitabilityHealth = "healthy";
  if (safePrice < safeCost) {
    health = "loss";
  } else if (safePrice > 0 && marginPct < 10) {
    health = "low";
  }

  return {
    profitCents,
    markupPct,
    marginPct,
    health,
  };
}

/**
 * Calcula un precio de mayoreo sugerido (-10% respecto al precio de venta,
 * garantizando un piso seguro mínimo de +5% sobre el costo para nunca vender a pérdida).
 */
export function calcAutoWholesaleCents(
  costCents: number,
  priceCents: number
): number {
  const safeCost = Number.isFinite(costCents) && costCents > 0 ? Math.round(costCents) : 0;
  const safePrice = Number.isFinite(priceCents) && priceCents > 0 ? Math.round(priceCents) : 0;
  if (safePrice <= 0) return 0;
  const discounted = Math.round(safePrice * 0.9);
  const minSafe = safeCost > 0 ? Math.round(safeCost * 1.05) : 0;
  return Math.min(safePrice, Math.max(discounted, minSafe));
}

/**
 * Calcula la valoración financiera total del inventario actual de un producto.
 */
export function calcInventoryValuation(
  costCents: number,
  basePriceCents: number,
  stock: number
): InventoryValuation {
  const safeStock = Number.isFinite(stock) && stock > 0 ? stock : 0;
  const safeCost = Number.isFinite(costCents) && costCents > 0 ? Math.round(costCents) : 0;
  const safePrice = Number.isFinite(basePriceCents) && basePriceCents > 0 ? Math.round(basePriceCents) : 0;

  const totalCostCents = Math.round(safeCost * safeStock);
  const totalSaleCents = Math.round(safePrice * safeStock);
  return {
    totalCostCents,
    totalSaleCents,
    projectedProfitCents: totalSaleCents - totalCostCents,
  };
}

/**
 * Formatea centavos enteros a string decimal listo para inputs numéricos ("4500.00").
 */
export function centsToInputStr(cents: number): string {
  const safe = Number.isFinite(cents) && cents >= 0 ? Math.round(cents) : 0;
  return (safe / 100).toFixed(2);
}
