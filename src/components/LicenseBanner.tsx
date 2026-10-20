import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { PlanInfo } from '../types';

/**
 * Banner que muestra el estado de la licencia/plan del POS.
 * - Consulta la información del plan almacenada localmente.
 * - Valida contra el endpoint del ERP para detectar revocaciones o expiraciones.
 * - Si la licencia es inválida muestra un mensaje de alerta y un botón de "Actualizar plan".
 *
 * Se respeta el sistema de tokens de UI del proyecto (bg‑bg‑surface, text‑text‑main, etc.)
 */
export const LicenseBanner: React.FC = () => {
  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [valid, setValid] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);

  // Cargar información del plan al montar el componente
  useEffect(() => {
    const load = async () => {
      try {
        const info = await api.licensing.getPlanInfo();
        setPlan(info);
        const isValid = await api.licensing.validateLicense();
        setValid(isValid);
      } catch (e) {
        console.error('[LicenseBanner] error loading plan info', e);
        // Si falla la validación, consideramos la licencia como no válida
        setValid(false);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) {
    return null; // No mostrar nada mientras se carga
  }

  // Si la licencia es válida y el plan es "free", podemos omitir el banner (opcional)
  if (valid && plan?.plan_type === 'free') {
    return null;
  }

  const expiration = plan?.plan_expiration ? new Date(plan.plan_expiration).toLocaleDateString() : undefined;

  return (
    <div className="flex items-center justify-between p-2 bg-bg-surface border-b border-border-subtle">
      <div className="text-text-main">
        {valid ? (
          <>Plan: <strong>{plan?.plan_type ?? 'desconocido'}</strong>{expiration && ` – expira el ${expiration}`}</>
        ) : (
          <>Licencia <strong>inválida</strong>. Contacta al administrador.</>
        )}
      </div>
      <button
        className="px-3 py-1 bg-brand-primary text-white rounded hover:bg-brand-primary/80 transition"
        onClick={() => {
          // Placeholder: abrir flujo de upgrade o página de gestión de licencias
          alert('Abrir gestión de licencias/plan');
        }}
      >
        {valid ? 'Ver detalle' : 'Actualizar plan'}
      </button>
    </div>
  );
};
