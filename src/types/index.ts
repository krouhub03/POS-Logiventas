/** Espejo de `models::product::Product` (Rust). Importes en centavos. */
export interface Product {
  id: number;
  sku: string;
  barcode: string | null;
  name: string;
  categoryId: number | null;
  categoryName?: string | null;
  unit: string;
  priceCents: number;
  costCents: number;
  taxRateBp: number;
  stock: number;
  minStock: number;
  isService: boolean;
  controlsStock: boolean;
  allowNegativeStock: boolean;
  isBundle: boolean;
  tags?: string | null;
  taxFixedCents: number;
  imageUrl?: string | null;
  imageLocalPath?: string | null;
  imageHash?: string | null;
  imageSyncStatus?: "none" | "pending_download" | "pending_upload" | "synced" | "failed";
  active: boolean;
  components?: ProductComponent[];
}

/** Filtro rápido anclado en la barra de búsqueda de productos (F10). */
export interface PinnedFilter {
  id: string;
  type: "category" | "tag";
  value: string;
  icon?: string;
  color?: string;
}

/** Espejo de `models::product::ProductTag` (Rust). */
export interface ProductTag {
  id: number;
  name: string;
  colorHex: string;
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
  controlsStock?: boolean;
  allowNegativeStock?: boolean;
  isBundle?: boolean;
  tags?: string | null;
  taxFixedCents?: number;
  imageUrl?: string | null;
  imageLocalPath?: string | null;
  imageHash?: string | null;
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
  controlsStock?: boolean;
  allowNegativeStock?: boolean;
  isBundle?: boolean;
  tags?: string | null;
  taxFixedCents?: number;
  imageUrl?: string | null;
  imageLocalPath?: string | null;
  imageHash?: string | null;
  imageSyncStatus?: "none" | "pending_download" | "pending_upload" | "synced" | "failed";
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
  permissions: string[];
  profileName?: string | null;
  erpRoleCode?: string | null;
  loginCount?: number;
}

/** Estado de vinculación M2M de la terminal física con el ERP */
export interface TerminalStatus {
  isPaired: boolean;
  erpUrl: string;
  cajaId: string | null;
  cajaNombre: string | null;
  cajaCodigo: string | null;
  bodegaId?: string | null;
  bodegaNombre?: string | null;
  empresaId: string | null;
  empresaNombre: string | null;
  empresaNit: string | null;
  activeCashier: CashierUser | null;
  activeCashierRevoked?: boolean;
  lastCajaId?: string | null;
  lastCajaCodigo?: string | null;
  lastCajaNombre?: string | null;
  lastEmpresaNombre?: string | null;
  isDisconnected?: boolean;
}

export interface ReconnectTerminalInput {
  erpUrl?: string;
  cajaId?: string;
  cajaCodigo?: string;
  pin?: string;
  email?: string;
  password?: string;
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
  taxFixedCents?: number;
  discountCents?: number;
}

export interface PaymentInput {
  method: "cash" | "card" | "transfer" | "other" | (string & {});
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
  sku?: string | null;
  barcode?: string | null;
  unit?: string | null;
  description: string;
  quantity: number;
  returnedQuantity: number;
  unitPriceCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  isService?: boolean;
  isBundle?: boolean;
}

export interface SalePaymentDto {
  id: number;
  method: string;
  methodName: string;
  amountCents: number;
  reference?: string | null;
}

export interface SaleReturnItemDto {
  id: number;
  saleItemId: number;
  productId: number | null;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  inventoryDisposition: "restock" | "merma" | "no_stock" | string;
}

export interface SaleReturnDto {
  id: number;
  folio: string;
  saleId: number;
  saleFolio: string;
  customerId?: number | null;
  customerName?: string | null;
  cashierName?: string | null;
  returnType: "full" | "partial" | string;
  reason: string;
  refundMethod: "cash" | "credit_balance" | "transfer" | "other" | string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  notes?: string | null;
  createdAt: string;
  items: SaleReturnItemDto[];
}

export interface SaleReceipt {
  id: number;
  folio: string;
  customerId?: number | null;
  customerName?: string | null;
  customerTaxId?: string | null;
  cashierName?: string | null;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  paidCents: number;
  changeCents: number;
  reprintCount: number;
  lastReprintedAt?: string | null;
  returnStatus: "none" | "partial" | "full" | string;
  returnedCents: number;
  itemsCount: number;
  items: SaleItemDto[];
  payments: SalePaymentDto[];
  returns: SaleReturnDto[];
  createdAt: string;
}

export interface SaleSummaryItem {
  id: number;
  folio: string;
  customerId?: number | null;
  customerName?: string | null;
  customerTaxId?: string | null;
  cashierName?: string | null;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  paidCents: number;
  changeCents: number;
  itemsCount: number;
  reprintCount: number;
  returnStatus: "none" | "partial" | "full" | string;
  returnedCents: number;
  paymentSummary: string;
  createdAt: string;
}

export interface CreateSaleReturnItemInput {
  saleItemId: number;
  quantity: number;
  inventoryDisposition?: "restock" | "merma" | "no_stock" | string;
}

export interface CreateSaleReturnInput {
  saleId: number;
  userId?: number | null;
  reason: string;
  refundMethod: "cash" | "credit_balance" | "transfer" | "other" | string;
  notes?: string | null;
  items: CreateSaleReturnItemInput[];
}

export interface TodaySalesSummary {
  totalSalesCount: number;
  totalCents: number;
  cashCents: number;
  cardCents: number;
  transferCents: number;
}

export type PosSettings = Record<string, string>;

/** Impresora detectada en el sistema operativo */
export interface SystemPrinter {
  name: string;
  port?: string | null;
  driver?: string | null;
  isDefault: boolean;
  isLikelyPos: boolean;
}

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
  terminalEnabled: number;
}

/* ==============================================================
   Modelos de Turnos de Caja y Arqueo Z-Report (NIIF v6.2)
   ============================================================== */

export interface CashShift {
  id: number;
  folio: string;
  userId: number;
  userName?: string;
  openedAt: string;
  closedAt?: string;
  openingCents: number;
  closingCents?: number;
  expectedCents?: number;
  declaredCents?: number;
  differenceCents?: number;
  notes?: string;
  status: "open" | "closed";
  erpTurnoId?: string;
}

export interface OpenShiftInput {
  openingCents: number;
  notes?: string;
}

export interface CloseShiftInput {
  declaredCents: number;
  notes?: string;
}

export interface ShiftSummary {
  shiftId: number;
  folio: string;
  openedAt: string;
  userName: string;
  openingCents: number;
  salesCount: number;
  totalSalesCents: number;
  cashSalesCents: number;
  cardSalesCents: number;
  transferSalesCents: number;
  otherSalesCents: number;
  customerPaymentsCashCents: number;
  customerPaymentsOtherCents: number;
  totalTaxCents: number;
  expectedCashCents: number;
}

export interface Customer {
  id: number;
  erpId?: string | null;
  name: string;
  taxId?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  creditLimitCents: number;
  currentBalanceCents: number;
  isCreditBlocked: boolean;
  creditDays: number;
  notes?: string | null;
  active: boolean;
}

export interface CreateCustomerInput {
  name: string;
  taxId?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  creditLimitCents?: number;
  creditDays?: number;
  notes?: string | null;
}

export interface UpdateCustomerCreditInput {
  id: number;
  creditLimitCents: number;
  isCreditBlocked: boolean;
  creditDays: number;
  notes?: string | null;
}

export interface RecordCustomerPaymentInput {
  customerId: number;
  userId: number;
  paymentMethodId?: string | null;
  method: string;
  amountCents: number;
  reference?: string | null;
  notes?: string | null;
}

export interface CustomerPayment {
  id: number;
  folio: string;
  customerId: number;
  customerName: string;
  sessionId?: number | null;
  userId: number;
  paymentMethodId?: string | null;
  method?: string | null;
  amountCents: number;
  previousBalanceCents: number;
  newBalanceCents: number;
  reference?: string | null;
  notes?: string | null;
  createdAt: string;
}

/** Componente integrante de un combo/kit (receta local). */
export interface ProductComponent {
  id: number;
  parentProductId: number;
  childProductId: number;
  childName: string;
  childSku: string;
  childBarcode?: string | null;
  childStock: number;
  childUnit: string;
  childPriceCents: number;
  childCostCents: number;
  quantity: number;
  orderIndex: number;
}

export interface SaveProductComponentItem {
  childProductId: number;
  quantity: number;
  orderIndex?: number;
}
