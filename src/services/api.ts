import { invoke } from "@tauri-apps/api/core";
import type {
  AppInfo,
  CashierUser,
  CreateSaleInput,
  InventoryMovement,
  NewProduct,
  PairCodeInput,
  PairLoginInput,
  PairLoginResult,
  Product,
  SaleReceipt,
  StockAdjustmentInput,
  TerminalStatus,
  TodaySalesSummary,
  UpdateProductInput,
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
  },

  auth: {
    getTerminalStatus: () => invoke<TerminalStatus>("get_terminal_status"),
    pairCode: (input: PairCodeInput) =>
      invoke<TerminalStatus>("pair_terminal_code", { input }),
    pairLogin: (input: PairLoginInput) =>
      invoke<PairLoginResult>("pair_terminal_login", { input }),
    syncUsers: () => invoke<CashierUser[]>("sync_users_from_erp"),
    listCashiers: () => invoke<CashierUser[]>("list_local_cashiers"),
    loginPin: (pin: string) => invoke<CashierUser>("login_cashier_pin", { pin }),
    unpair: () => invoke<TerminalStatus>("unpair_terminal"),
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
  },

  sales: {
    create: (input: CreateSaleInput) =>
      invoke<SaleReceipt>("create_sale", { input }),
    getLast: () => invoke<SaleReceipt | null>("get_last_sale"),
    getTodaySummary: () => invoke<TodaySalesSummary>("get_today_summary"),
  },

  settings: {
    getAll: () => invoke<Record<string, string>>("get_all_settings"),
    update: (settings: Record<string, string>) =>
      invoke<void>("update_settings", { settings }),
    testPrintTicket: () => invoke<string>("test_print_ticket"),
    testOpenDrawer: () => invoke<string>("test_open_drawer"),
  },
};
