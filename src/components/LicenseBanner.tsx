import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { PlanInfo } from '../types';

/**
 * Banner que muestra el estado de la licencia/plan y la versión actual del POS.
 * - Muestra la versión actual de la aplicación (ej. v0.1.5).
 * - Consulta la información del plan sincronizada con el ERP.
 * - Valida contra el endpoint `/api/pos/v1/license/validate` del ERP.
 * - Respeta los tokens de diseño (Dark theme / modern UI).
 */
export const LicenseBanner: React.FC = () => {
  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [valid, setValid] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;

    const loadPlan = async () => {
      try {
        const info = await api.licensing.getPlanInfo();
        if (isMounted) setPlan(info);

        const isValid = await api.licensing.validateLicense();
        if (isMounted) setValid(isValid);
      } catch (e) {
        console.error('[LicenseBanner] error cargando licencia:', e);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadPlan();

    return () => {
      isMounted = false;
    };
  }, []);

  if (loading) {
    return null;
  }

  const appVersion = plan?.version ? `v${plan.version}` : 'v0.1.5';
  const planName = (plan?.plan_type || 'free').toUpperCase();
  const expiration = plan?.plan_expiration ? new Date(plan.plan_expiration).toLocaleDateString() : undefined;

  return (
    <div className={`flex items-center justify-between px-4 py-1.5 text-xs border-b select-none transition-colors duration-200 z-50 ${
      !valid 
        ? 'bg-rose-950/80 border-rose-800/80 text-rose-200' 
        : plan?.plan_type === 'free'
        ? 'bg-slate-900/90 border-slate-800 text-slate-300'
        : 'bg-emerald-950/60 border-emerald-800/60 text-emerald-200'
    }`}>
      <div className="flex items-center gap-2.5">
        <span className="font-mono px-1.5 py-0.5 rounded bg-black/40 text-[11px] font-semibold text-slate-200 border border-white/5">
          {appVersion}
        </span>

        {valid ? (
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>
              Plan: <strong className="text-white tracking-wide font-medium">{planName}</strong>
              {expiration && <span className="opacity-75"> (Vence: {expiration})</span>}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-rose-300">
            <span className="inline-block w-2 h-2 rounded-full bg-rose-500" />
            <span>
              Licencia <strong>inválida o revocada</strong> en el ERP. Comunícate con soporte.
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {(!valid || plan?.plan_type === 'free') && (
          <button
            type="button"
            className="px-2.5 py-1 text-[11px] font-medium rounded bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 border border-amber-500/30 transition-all cursor-pointer"
            onClick={() => {
              window.open('https://metahabi.com', '_blank');
            }}
          >
            {valid ? 'Mejorar a Pro' : 'Reactivar Licencia'}
          </button>
        )}
      </div>
    </div>
  );
};
