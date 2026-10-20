// ---------- Licencia ----------
export interface PlanInfo {
  plan_type: string; // "free" | "pro" | "enterprise"
  plan_expiration?: string; // ISO‑8601 date string
  plan_code?: string; // legacy code
  version: string; // Versión actual de la app (ej. "0.1.5")
}
