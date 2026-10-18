import type { CashierUser } from "../types";

/**
 * Catálogo estándar de permisos del ERP sincronizados con el POS:
 * - 'pos:vender': Acceso a facturación y emisión de tickets
 * - 'pos:anular': Anular tickets o partidas
 * - 'caja:cuadre': Apertura y cierre de turnos de caja (Z-Report)
 * - 'inventario:ver': Consulta de productos y stock
 * - 'inventario:costos': Consulta de costos y márgenes comerciales
 * - 'inventario:ajustar': Movimientos manuales y ajustes de inventario
 * - 'pos:configuracion': Hardware, periféricos, medios de pago y desvinculación
 */
export type PosPermission =
  | "pos:operar"
  | "pos:vender"
  | "pos:cobrar"
  | "pos:anular"
  | "pos:anular_linea"
  | "pos:descuento"
  | "caja:abrir_turno"
  | "caja:cerrar_turno"
  | "caja:cuadre"
  | "inventario:ver"
  | "inventario:costos"
  | "inventario:ajustar"
  | "clientes:ver"
  | "pos:configuracion"
  | string;

/**
 * Determina si el operador posee rango de Administrador (Superadmin o Admin de Empresa).
 */
export function isAdminUser(user: CashierUser | null): boolean {
  if (!user || !user.active) return false;
  const roleUpper = (user.role || "").toUpperCase();
  const erpRoleUpper = (user.erpRoleCode || "").toUpperCase();
  return (
    roleUpper === "SUPERADMINSAAS" ||
    roleUpper === "SUPERADMIN" ||
    roleUpper === "ADMIN" ||
    roleUpper === "ADMIN_EMPRESA" ||
    roleUpper === "ADMINISTRADOR" ||
    erpRoleUpper === "SUPERADMINSAAS" ||
    erpRoleUpper === "SUPERADMIN" ||
    erpRoleUpper === "ADMIN_EMPRESA" ||
    erpRoleUpper === "ADMIN" ||
    erpRoleUpper === "ADMINISTRADOR"
  );
}

/**
 * Valida si un cajero/usuario cuenta con el permiso requerido.
 * Refleja exactamente la lógica Zero-Trust:
 * 1. SUPERADMINSAAS posee pase maestro irrestricto (*).
 * 2. Administradores (ADMIN / ADMIN_EMPRESA) siempre tienen acceso a la configuración del POS (F7).
 * 3. Permisos granulares evaluados contra la matriz sincronizada.
 */
export function hasPermission(user: CashierUser | null, permission: PosPermission): boolean {
  if (!user || !user.active) return false;

  const roleUpper = (user.role || "").toUpperCase();
  const erpRoleUpper = (user.erpRoleCode || "").toUpperCase();

  // 1. Exclusivo para Soporte Técnico / Superadministrador global: Pase maestro (*)
  if (
    roleUpper === "SUPERADMINSAAS" ||
    roleUpper === "SUPERADMIN" ||
    erpRoleUpper === "SUPERADMINSAAS"
  ) {
    return true;
  }

  // 2. Administradores de Empresa: Acceso garantizado a Configuración (F7) y funciones clave
  if (isAdminUser(user)) {
    if (
      permission === "pos:configuracion" ||
      permission === "pos:operar" ||
      permission === "pos:vender" ||
      permission === "inventario:ver" ||
      permission === "inventario:ajustar" ||
      permission === "inventario:costos" ||
      permission === "clientes:ver" ||
      permission === "caja:cuadre"
    ) {
      return true;
    }
  }

  // 3. Verificación estricta de permisos granulares
  if (Array.isArray(user.permissions) && user.permissions.length > 0) {
    if (user.permissions.includes("*") || user.permissions.includes(permission)) {
      return true;
    }
    // Si es administrador, permitir pos:configuracion
    if (isAdminUser(user) && permission === "pos:configuracion") {
      return true;
    }
    return false;
  }

  // 3. Fallbacks estándar basados en roles para compatibilidad
  if (user.role === "manager") {
    // El manager no puede entrar a la configuración técnica del POS a menos que tenga el permiso explícito
    return permission !== "pos:configuracion";
  }

  if (user.role === "cashier") {
    // El cajero estándar puede operar, vender, cobrar, consultar catálogo y aperturar/cerrar su turno
    return (
      permission === "pos:operar" ||
      permission === "pos:vender" ||
      permission === "pos:cobrar" ||
      permission === "pos:anular_linea" ||
      permission === "caja:abrir_turno" ||
      permission === "caja:cerrar_turno" ||
      permission === "caja:cuadre" ||
      permission === "inventario:ver" ||
      permission === "clientes:ver"
    );
  }

  return false;
}
