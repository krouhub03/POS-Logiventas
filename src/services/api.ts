import { invoke } from "@tauri-apps/api/core";
import type { AppInfo, NewProduct, Product } from "../types";

/**
 * Único punto de acceso al backend Rust. Los componentes NO deben llamar
 * `invoke` directamente: así los nombres de comandos y tipos quedan centralizados.
 */
export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),

  products: {
    list: (search?: string) => invoke<Product[]>("list_products", { search }),
    findByBarcode: (barcode: string) =>
      invoke<Product | null>("find_product_by_barcode", { barcode }),
    create: (input: NewProduct) => invoke<Product>("create_product", { input }),
  },
};
