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
  isService: boolean;
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
  isService?: boolean;
}

/** Espejo de `models::product::UpdateProductInput` (Rust). */
export interface UpdateProductInput {
  id: number;
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
  isService?: boolean;
  active?: boolean;
}

/** Espejo de `models::product::StockAdjustmentInput` (Rust). */
export interface StockAdjustmentInput {
  productId: number;
  newStock: number;
  reason: string;
  userId?: number;
}

/** Espejo de `models::product::InventoryMovementDto` (Rust). */
export interface InventoryMovement {
  id: number;
  productId: number;
  productName?: string | null;
  kind: "sale" | "purchase" | "adjustment" | "return";
  quantity: number;
  reference?: string | null;
  userId?: number | null;
  createdAt: string;
}

export interface AppInfo {
  version: string;
  dbPath: string;
  schemaVersion: number;
}

/** Operador / Cajero sincronizado con ERP y disponible en SQLite local */
export interface CashierUser {
  id: number;
  erpUserId: string | null;
  username: string;
  fullName: string;
  email: string | null;
  role: string;
  active: boolean;
}

/** Estado de vinculación M2M de la terminal física con el ERP */
export interface TerminalStatus {
  isPaired: boolean;
  erpUrl: string;
  cajaId: string | null;
  cajaNombre: string | null;
  cajaCodigo: string | null;
  empresaId: string | null;
  empresaNombre: string | null;
  empresaNit: string | null;
  activeCashier: CashierUser | null;
}

export interface PairCodeInput {
  erpUrl: string;
  code: string;
}

export interface PairLoginInput {
  erpUrl: string;
  email: string;
  password: string;
  cajaId?: string;
  nuevoNombreCaja?: string;
  nuevoCodigoCaja?: string;
}

export interface ErpCajaOption {
  id: string;
  nombre: string;
  codigo: string;
  estado: string;
}

export interface PairLoginResult {
  success: boolean;
  requiereSeleccionCaja: boolean;
  cajasDisponibles?: ErpCajaOption[];
  terminalStatus?: TerminalStatus;
}

/* ==============================================================
   Modelos de Venta y Cobro (Eleventa-Style)
   ============================================================== */

export interface CartItemInput {
  productId?: number | null;
  sku?: string;
  barcode?: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  taxRateBp?: number;
  discountCents?: number;
}

export interface PaymentInput {
  method: "cash" | "card" | "transfer" | "other";
  amountCents: number;
  reference?: string;
}

export interface CreateSaleInput {
  userId?: number;
  customerId?: number;
  items: CartItemInput[];
  payments: PaymentInput[];
}

export interface SaleItemDto {
  id: number;
  productId: number | null;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
}

export interface SaleReceipt {
  id: number;
  folio: string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  paidCents: number;
  changeCents: number;
  itemsCount: number;
  items: SaleItemDto[];
  createdAt: string;
}

export interface TodaySalesSummary {
  totalSalesCount: number;
  totalCents: number;
  cashCents: number;
  cardCents: number;
  transferCents: number;
}

export type PosSettings = Record<string, string>;

/* ==============================================================
   Modelos de Sincronización y Control de Stock Multi-Caja
   ============================================================== */

export interface CheckStockItemInput {
  productId: number;
  quantity: number;
}

export interface VerifyStockResult {
  ok: boolean;
  motivo?: "STOCK_INSUFICIENTE" | "STOCK_LOCAL_AGOTADO" | "OFFLINE_STRICT_BLOCKED" | string;
  productId?: number;
  productName?: string;
  stockDisponible?: number;
  offlineWarning?: boolean;
}

export interface SyncStatus {
  isPaired: boolean;
  isOnline: boolean;
  pendingCount: number;
  lastSyncAt?: string;
  offlinePolicy: "strict" | "flexible" | string;
  criticalThreshold: number;
}

export interface OutboxBatchResult {
  dispatched: number;
  synced: number;
  failed: number;
}

export interface PaymentMethod {
  id: string;
  code: string;
  erpCode: string;
  name: string;
  type: string;
  pucCode: string | null;
  pucAccountId: string | null;
  pucAccountName: string | null;
  active: number;
}

