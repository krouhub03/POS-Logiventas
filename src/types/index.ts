/** Espejo de `models::product::Product` (Rust). Importes en centavos. */
export interface Product {
  id: number;
  sku: string;
  barcode: string | null;
  name: string;
  categoryId: number | null;
  unit: string;
  priceCents: number;
  costCents: number;
  taxRateBp: number;
  stock: number;
  minStock: number;
  active: boolean;
}

/** Espejo de `models::product::NewProduct` (Rust). */
export interface NewProduct {
  sku: string;
  barcode?: string | null;
  name: string;
  categoryId?: number | null;
  unit?: string;
  priceCents: number;
  costCents?: number;
  taxRateBp?: number;
  stock?: number;
  minStock?: number;
}

export interface AppInfo {
  version: string;
  dbPath: string;
  schemaVersion: number;
}
