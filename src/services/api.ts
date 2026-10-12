import { invoke } from "@tauri-apps/api/core";
import type {
  AppInfo,
  CashierUser,
  NewProduct,
  PairCodeInput,
  PairLoginInput,
  PairLoginResult,
  Product,
  TerminalStatus,
} from "../types";

/**
 * Único punto de acceso al backend Rust. Los componentes NO deben llamar
 * `invoke` directamente: así los nombres de comandos y tipos quedan centralizados.
 */
export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),

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
    create: (input: NewProduct) => invoke<Product>("create_product", { input }),
  },
};
