import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppInfo,
  CashierUser,
  CashShift,
  CheckStockItemInput,
  CloseShiftInput,
  CreateCustomerInput,
  CreateSaleInput,
  Customer,
  CustomerPayment,
  InventoryMovement,
  NewProduct,
  OpenShiftInput,
  OutboxBatchResult,
  PairCodeInput,
  PairLoginInput,
  PairLoginResult,
  PaymentMethod,
  Product,
  ProductComponent,
  ProductTag,
  RecordCustomerPaymentInput,
  ReconnectTerminalInput,
  CreateSaleReturnInput,
  SaleReturnDto,
  SaleReceipt,
  SaleSummaryItem,
  SaveProductComponentItem,
  ShiftSummary,
  StockAdjustmentInput,
  SyncStatus,
  SystemPrinter,
  TerminalStatus,
  TodaySalesSummary,
  UpdateCustomerCreditInput,
  UpdateProductInput,
  VerifyStockResult,
} from "../types";

/**
 * Único punto de acceso al backend Rust. Los componentes NO deben llamar
 * `invoke` directamente: así los nombres de comandos y tipos quedan centralizados.
 */
export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),
  system: {
    appInfo: () => invoke<AppInfo>("app_info"),
    toggleFullscreen: () => invoke<boolean>("toggle_fullscreen"),
    setFullscreen: (fullscreen: boolean) =>
      invoke<void>("set_fullscreen", { fullscreen }),
    minimizeWindow: () => invoke<void>("minimize_window"),
    restartApp: () => invoke<void>("restart_app"),
    closeApp: (force?: boolean) => invoke<void>("close_app", { force }),
  },

  auth: {
    getTerminalStatus: () => invoke<TerminalStatus>("get_terminal_status"),
    validateSession: (activeErpUserId?: string) =>
      invoke<TerminalStatus>("validate_terminal_session", { activeErpUserId }),
    pairCode: (input: PairCodeInput) =>
      invoke<TerminalStatus>("pair_terminal_code", { input }),
    pairLogin: (input: PairLoginInput) =>
      invoke<PairLoginResult>("pair_terminal_login", { input }),
    syncUsers: () => invoke<CashierUser[]>("sync_users_from_erp"),
    listCashiers: () => invoke<CashierUser[]>("list_local_cashiers"),
    loginPin: (pin: string) => invoke<CashierUser>("login_cashier_pin", { pin }),
    loginUserPin: (userId: number, pin: string) =>
      invoke<CashierUser>("login_cashier_user_pin", { userId, pin }),
    changePin: (userId: number, currentPin: string, newPin: string) =>
      invoke<boolean>("change_cashier_pin", { userId, currentPin, newPin }),
    unpair: () => invoke<TerminalStatus>("unpair_terminal"),
    forgetTerminal: () => invoke<TerminalStatus>("forget_terminal"),
    reconnectTerminal: (input: ReconnectTerminalInput) =>
      invoke<TerminalStatus>("reconnect_terminal", { input }),
    disconnectTemporarily: () =>
      invoke<TerminalStatus>("disconnect_terminal_temporarily"),
  },

  products: {
    list: (search?: string) => invoke<Product[]>("list_products", { search }),
    findByBarcode: (barcode: string) =>
      invoke<Product | null>("find_product_by_barcode", { barcode }),
    get: (id: number) => invoke<Product>("get_product", { id }),
    create: (input: NewProduct) => invoke<Product>("create_product", { input }),
    update: (input: UpdateProductInput) =>
      invoke<Product>("update_product", { input }),
    delete: (id: number) => invoke<void>("delete_product", { id }),
    adjustStock: (input: StockAdjustmentInput) =>
      invoke<Product>("adjust_stock", { input }),
    listMovements: (productId?: number, limit?: number) =>
      invoke<InventoryMovement[]>("list_inventory_movements", {
        productId,
        limit,
      }),
    getComponents: (parentId: number) =>
      invoke<ProductComponent[]>("get_product_components", { parentId }),
    saveComponents: (
      parentId: number,
      components: SaveProductComponentItem[]
    ) =>
      invoke<void>("save_product_components", { parentId, components }),
    saveImage: (productId: number, imageBase64: string) =>
      invoke<Product>("save_product_image_local", { productId, imageBase64 }),
    deleteImage: (productId: number) =>
      invoke<Product>("delete_product_image_local", { productId }),
    getImageBase64: (productId: number) =>
      invoke<string | null>("get_product_image_base64", { productId }),
  },

  categories: {
    list: () => invoke<string[]>("list_categories"),
  },

  tags: {
    list: () => invoke<ProductTag[]>("list_product_tags"),
    create: (name: string, colorHex: string) =>
      invoke<ProductTag>("create_product_tag", { name, colorHex }),
    update: (id: number, name: string, colorHex: string) =>
      invoke<ProductTag>("update_product_tag", { id, name, colorHex }),
    delete: (id: number) => invoke<void>("delete_product_tag", { id }),
  },

  sales: {
    create: (input: CreateSaleInput) =>
      invoke<SaleReceipt>("create_sale", { input }),
    getLast: () => invoke<SaleReceipt | null>("get_last_sale"),
    getTodaySummary: () => invoke<TodaySalesSummary>("get_today_summary"),
    listRecent: (params?: { query?: string; statusFilter?: string; limit?: number }) =>
      invoke<SaleSummaryItem[]>("list_recent_sales", {
        query: params?.query,
        statusFilter: params?.statusFilter,
        limit: params?.limit,
      }),
    getDetail: (saleId: number) =>
      invoke<SaleReceipt>("get_sale_detail", { saleId }),
    reprintSale: (saleId: number) =>
      invoke<SaleReceipt>("register_sale_reprint", { saleId }),
    createReturn: (input: CreateSaleReturnInput) =>
      invoke<SaleReturnDto>("create_sale_return", { input }),
  },

  settings: {
    getAll: () => invoke<Record<string, string>>("get_all_settings"),
    update: (settings: Record<string, string>) =>
      invoke<void>("update_settings", { settings }),
    testPrintTicket: () => invoke<string>("test_print_ticket"),
    testOpenDrawer: () => invoke<string>("test_open_drawer"),
  },

  printers: {
    list: () => invoke<SystemPrinter[]>("list_system_printers"),
  },

  sync: {
    verifyStock: (items: CheckStockItemInput[]) =>
      invoke<VerifyStockResult>("verify_and_reserve_stock", { items }),
    releaseStock: (productId?: number) =>
      invoke<void>("release_stock_reservation", { productId }),
    syncCatalog: () => invoke<number>("sync_catalog_from_erp"),
    dispatchOutbox: () => invoke<OutboxBatchResult>("dispatch_sync_outbox"),
    pullDeltas: () => invoke<number>("pull_inventory_deltas"),
    getStatus: () => invoke<SyncStatus>("get_sync_status"),
    syncPaymentMethods: () => invoke<number>("sync_payment_methods"),
    getPaymentMethods: () => invoke<PaymentMethod[]>("get_payment_methods"),
    togglePaymentMethodTerminalStatus: (id: string, enabled: boolean) =>
      invoke<void>("toggle_payment_method_terminal_status", { id, enabled }),
    onStatusChange: (callback: (status: SyncStatus) => void): Promise<UnlistenFn> =>
      listen<SyncStatus>("sync-status-changed", (event) => callback(event.payload)),
  },

  shifts: {
    getActiveShift: () => invoke<CashShift | null>("get_active_shift"),
    openShift: (userId: number, input: OpenShiftInput) =>
      invoke<CashShift>("open_shift", { userId, input }),
    getShiftSummary: () => invoke<ShiftSummary>("get_shift_summary"),
    closeShift: (input: CloseShiftInput) =>
      invoke<CashShift>("close_shift", { input }),
  },

  customers: {
    list: () => invoke<Customer[]>("get_customers"),
    get: (id: number) => invoke<Customer>("get_customer", { id }),
    search: (query: string) => invoke<Customer[]>("search_customers", { query }),
    create: (input: CreateCustomerInput) => invoke<Customer>("create_customer", { input }),
    updateCredit: (input: UpdateCustomerCreditInput) =>
      invoke<Customer>("update_customer_credit", { input }),
    recordPayment: (input: RecordCustomerPaymentInput) =>
      invoke<CustomerPayment>("record_customer_payment", { input }),
    getPayments: (customerId: number) =>
      invoke<CustomerPayment[]>("get_customer_payments", { customerId }),
  },
};
