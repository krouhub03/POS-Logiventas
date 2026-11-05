import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "../services/api";
import { formatCents } from "../lib/money";
import { hasPermission } from "../lib/permissions";
import { resolveProductImageSrc, getDefaultProductImage } from "../lib/images";
import type {
  CashierUser,
  SalesAnalyticsReport,
  TopProductStat,
  HourlySalesBucket,
  DailySalesPoint,
} from "../types";

interface SalesReportsPageProps {
  cashier: CashierUser;
  onBackToSales: () => void;
}

type PeriodFilterPreset =
  | "today"
  | "yesterday"
  | "specific_day"
  | "current_month"
  | "prev_month"
  | "custom";

type ChartMode = "hourly" | "daily";
type TopProductSort = "revenue" | "units" | "profit";

const CATEGORY_COLORS = [
  { hex: "#10b981", bg: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  { hex: "#334155", bg: "bg-slate-700", text: "text-slate-700 dark:text-slate-300" },
  { hex: "#0284c7", bg: "bg-sky-600", text: "text-sky-600 dark:text-sky-400" },
  { hex: "#f59e0b", bg: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  { hex: "#8b5cf6", bg: "bg-violet-500", text: "text-violet-600 dark:text-violet-400" },
  { hex: "#64748b", bg: "bg-slate-500", text: "text-slate-500 dark:text-slate-400" },
];

const PAYMENT_RING_COLORS = [
  { stroke: "#10b981", badge: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300" },
  { stroke: "#1e293b", badge: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  { stroke: "#0284c7", badge: "bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300" },
  { stroke: "#f59e0b", badge: "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300" },
];

function toLocalYmd(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + deltaDays);
  return toLocalYmd(dt);
}

function getDateRangesForPreset(
  preset: PeriodFilterPreset,
  specificDay: string,
  customStart: string,
  customEnd: string
): {
  startDate: string;
  endDate: string;
  prevStartDate: string;
  prevEndDate: string;
  prev2StartDate: string;
  prev2EndDate: string;
  comparisonLabel: string;
} {
  const now = new Date();
  const todayStr = toLocalYmd(now);

  if (preset === "today") {
    const yesterdayStr = addDays(todayStr, -1);
    const dayBeforeStr = addDays(todayStr, -2);
    return {
      startDate: todayStr,
      endDate: todayStr,
      prevStartDate: yesterdayStr,
      prevEndDate: yesterdayStr,
      prev2StartDate: dayBeforeStr,
      prev2EndDate: dayBeforeStr,
      comparisonLabel: "vs ayer",
    };
  }

  if (preset === "yesterday") {
    const yesterdayStr = addDays(todayStr, -1);
    const dayBeforeStr = addDays(todayStr, -2);
    const threeDaysAgoStr = addDays(todayStr, -3);
    return {
      startDate: yesterdayStr,
      endDate: yesterdayStr,
      prevStartDate: dayBeforeStr,
      prevEndDate: dayBeforeStr,
      prev2StartDate: threeDaysAgoStr,
      prev2EndDate: threeDaysAgoStr,
      comparisonLabel: "vs anteayer",
    };
  }

  if (preset === "specific_day") {
    const target = specificDay || todayStr;
    const prev = addDays(target, -1);
    const prev2 = addDays(target, -2);
    return {
      startDate: target,
      endDate: target,
      prevStartDate: prev,
      prevEndDate: prev,
      prev2StartDate: prev2,
      prev2EndDate: prev2,
      comparisonLabel: "vs día ant.",
    };
  }

  if (preset === "current_month") {
    const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const firstOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    const firstOfTwoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const lastOfTwoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 1, 0);
    return {
      startDate: toLocalYmd(firstOfThisMonth),
      endDate: todayStr,
      prevStartDate: toLocalYmd(firstOfPrevMonth),
      prevEndDate: toLocalYmd(lastOfPrevMonth),
      prev2StartDate: toLocalYmd(firstOfTwoMonthsAgo),
      prev2EndDate: toLocalYmd(lastOfTwoMonthsAgo),
      comparisonLabel: "vs mes ant.",
    };
  }

  if (preset === "prev_month") {
    const firstOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    const firstOfTwoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const lastOfTwoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 1, 0);
    const firstOfThreeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    const lastOfThreeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 0);
    return {
      startDate: toLocalYmd(firstOfPrevMonth),
      endDate: toLocalYmd(lastOfPrevMonth),
      prevStartDate: toLocalYmd(firstOfTwoMonthsAgo),
      prevEndDate: toLocalYmd(lastOfTwoMonthsAgo),
      prev2StartDate: toLocalYmd(firstOfThreeMonthsAgo),
      prev2EndDate: toLocalYmd(lastOfThreeMonthsAgo),
      comparisonLabel: "vs mes previo",
    };
  }

  // Custom range
  const start = customStart || todayStr;
  const end = customEnd && customEnd >= start ? customEnd : start;
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const d1 = new Date(sy, (sm || 1) - 1, sd || 1);
  const d2 = new Date(ey, (em || 1) - 1, ed || 1);
  const diffDays = Math.max(1, Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)) + 1);

  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(diffDays - 1));
  const prev2End = addDays(prevStart, -1);
  const prev2Start = addDays(prev2End, -(diffDays - 1));

  return {
    startDate: start,
    endDate: end,
    prevStartDate: prevStart,
    prevEndDate: prevEnd,
    prev2StartDate: prev2Start,
    prev2EndDate: prev2End,
    comparisonLabel: "vs período ant.",
  };
}

function formatBpPercent(bp: number, includeSign = false): string {
  const val = (bp / 100).toFixed(1);
  if (includeSign && bp > 0) return `+${val}%`;
  return `${val}%`;
}

function buildSmoothAreaPath(points: { x: number; y: number }[], baselineY: number): { linePath: string; areaPath: string } {
  if (points.length === 0) return { linePath: "", areaPath: "" };
  if (points.length === 1) {
    const p = points[0];
    return {
      linePath: `M ${p.x} ${p.y}`,
      areaPath: `M ${p.x} ${baselineY} L ${p.x} ${p.y} L ${p.x} ${baselineY} Z`,
    };
  }

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const midX = (p0.x + p1.x) / 2;
    d += ` C ${midX} ${p0.y}, ${midX} ${p1.y}, ${p1.x} ${p1.y}`;
  }

  const first = points[0];
  const last = points[points.length - 1];
  const area = `${d} L ${last.x} ${baselineY} L ${first.x} ${baselineY} Z`;

  return { linePath: d, areaPath: area };
}

export function SalesReportsPage({ cashier, onBackToSales }: SalesReportsPageProps) {
  const todayDefault = useMemo(() => toLocalYmd(new Date()), []);
  const canViewCosts = useMemo(() => hasPermission(cashier, "inventario:costos"), [cashier]);

  const [preset, setPreset] = useState<PeriodFilterPreset>("today");
  const [specificDay, setSpecificDay] = useState<string>(todayDefault);
  const [customStart, setCustomStart] = useState<string>(todayDefault);
  const [customEnd, setCustomEnd] = useState<string>(todayDefault);
  const [selectedCashierId, setSelectedCashierId] = useState<string>("all");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const [cashiersList, setCashiersList] = useState<CashierUser[]>([]);
  const [categoriesList, setCategoriesList] = useState<string[]>([]);
  const [report, setReport] = useState<SalesAnalyticsReport | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const [chartMode, setChartMode] = useState<ChartMode>("hourly");
  const [hoveredBarIndex, setHoveredBarIndex] = useState<number | null>(null);
  const [productSort, setProductSort] = useState<TopProductSort>("revenue");
  const [productSearch, setProductSearch] = useState<string>("");

  const activeRange = useMemo(
    () => getDateRangesForPreset(preset, specificDay, customStart, customEnd),
    [preset, specificDay, customStart, customEnd]
  );

  // Cargar lista de cajeros y categorías una sola vez al montar
  useEffect(() => {
    api.auth
      .listCashiers()
      .then((list) => setCashiersList(list))
      .catch(console.error);
    api.categories
      .list()
      .then((cats) => setCategoriesList(cats))
      .catch(console.error);
  }, []);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.reports.getSalesAnalytics({
        startDate: activeRange.startDate,
        endDate: activeRange.endDate,
        prevStartDate: activeRange.prevStartDate,
        prevEndDate: activeRange.prevEndDate,
        prev2StartDate: activeRange.prev2StartDate,
        prev2EndDate: activeRange.prev2EndDate,
        cashierId: selectedCashierId !== "all" ? Number(selectedCashierId) : undefined,
        categoryName: selectedCategory !== "all" ? selectedCategory : undefined,
      });
      setReport(data);
    } catch (err) {
      console.error("Error al consultar analíticas de ventas:", err);
    } finally {
      setLoading(false);
    }
  }, [activeRange, selectedCashierId, selectedCategory]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  // Atajo Esc o F1 para regresar a la estación de ventas
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onBackToSales();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onBackToSales]);

  // Filtrar las horas relevantes del día (6:00 AM a 10:00 PM + cualquier hora de madrugada que tenga ventas)
  const visibleHourlyBuckets = useMemo<HourlySalesBucket[]>(() => {
    if (!report) return [];
    return report.hourlyDistribution.filter(
      (b) => (b.hour >= 6 && b.hour <= 22) || b.totalCents > 0 || b.ticketsCount > 0
    );
  }, [report]);

  // Ordenar y filtrar Top Productos
  const sortedProducts = useMemo<TopProductStat[]>(() => {
    if (!report) return [];
    const q = productSearch.trim().toLowerCase();
    const filtered = q
      ? report.topProducts.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            (p.sku && p.sku.toLowerCase().includes(q)) ||
            (p.barcode && p.barcode.toLowerCase().includes(q)) ||
            p.categoryName.toLowerCase().includes(q)
        )
      : [...report.topProducts];

    filtered.sort((a, b) => {
      if (productSort === "units") return b.unitsSold - a.unitsSold || b.revenueCents - a.revenueCents;
      if (productSort === "profit") return b.profitCents - a.profitCents || b.revenueCents - a.revenueCents;
      return b.revenueCents - a.revenueCents || b.unitsSold - a.unitsSold;
    });

    return filtered;
  }, [report, productSort, productSearch]);

  // Categorías agrupadas (Top 4 + Otros) para el gráfico de dona
  const groupedCategories = useMemo(() => {
    if (!report || report.topCategories.length === 0) return [];
    if (report.topCategories.length <= 5) return report.topCategories;

    const top4 = report.topCategories.slice(0, 4);
    const rest = report.topCategories.slice(4);
    const restRev = rest.reduce((acc, c) => acc + c.revenueCents, 0);
    const restProfit = rest.reduce((acc, c) => acc + c.profitCents, 0);
    const restUnits = rest.reduce((acc, c) => acc + c.unitsSold, 0);
    const restTickets = rest.reduce((acc, c) => acc + c.ticketsCount, 0);
    const restShare = Math.max(0, 10000 - top4.reduce((acc, c) => acc + c.shareBp, 0));

    return [
      ...top4,
      {
        categoryName: "Otros",
        unitsSold: restUnits,
        ticketsCount: restTickets,
        revenueCents: restRev,
        profitCents: restProfit,
        shareBp: restShare,
      },
    ];
  }, [report]);

  const kpis = report?.kpis;
  const isMultiDay = activeRange.startDate !== activeRange.endDate;

  // Datos para el gráfico principal (Horario vs Diario)
  const chartItems = useMemo<
    {
      key: string;
      label: string;
      fullLabel: string;
      totalCents: number;
      profitCents: number;
      ticketsCount: number;
      isPeak: boolean;
    }[]
  >(() => {
    if (!report) return [];
    if (chartMode === "daily" && report.dailyTrend.length > 0) {
      return report.dailyTrend.map((d: DailySalesPoint) => ({
        key: d.date,
        label: d.label,
        fullLabel: `${d.label} (${d.ticketsCount} tks)`,
        totalCents: d.totalCents,
        profitCents: d.profitCents,
        ticketsCount: d.ticketsCount,
        isPeak: false,
      }));
    }
    return visibleHourlyBuckets.map((h: HourlySalesBucket) => ({
      key: String(h.hour),
      label: h.label.replace(":00 ", " "),
      fullLabel: `${h.label} - ${((h.hour + 1) % 24 === 0 ? "12:00 AM" : h.hour + 1 > 12 ? `${h.hour + 1 - 12}:00 PM` : `${h.hour + 1}:00 ${h.hour + 1 === 12 ? "PM" : "AM"}`)}`,
      totalCents: h.totalCents,
      profitCents: h.profitCents,
      ticketsCount: h.ticketsCount,
      isPeak: kpis?.peakHour !== null && kpis?.peakHour === h.hour && h.totalCents > 0,
    }));
  }, [report, chartMode, visibleHourlyBuckets, kpis?.peakHour]);

  const maxChartCents = useMemo(() => {
    const m = chartItems.reduce((max, it) => Math.max(max, it.totalCents), 0);
    return m > 0 ? m : 100000;
  }, [chartItems]);

  return (
    <div className="flex flex-col h-full w-full bg-[#f1f5f9] dark:bg-slate-950 text-slate-800 dark:text-slate-100 select-none overflow-hidden font-sans">
      {/* 1. BARRA SUPERIOR CORPORATIVA */}
      <header className="shrink-0 bg-slate-900 text-white px-4 py-2.5 flex items-center justify-between gap-3 border-b border-slate-800 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 pr-3 border-r border-slate-700">
            <img src="/metahabi-icon.png" alt="Metahabi" className="w-5 h-5 object-contain" />
            <span className="font-extrabold tracking-tight text-xs text-white">
              METAHABI <span className="text-emerald-400 font-semibold">POS</span>
            </span>
          </div>

          <button
            type="button"
            onClick={onBackToSales}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
            title="Volver a la Estación de Ventas (F1 o Esc)"
          >
            <span>←</span>
            <span>Volver a Ventas (F1)</span>
          </button>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={fetchAnalytics}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold transition-colors cursor-pointer shadow-xs"
            title="Refrescar datos en tiempo real"
          >
            <span className={loading ? "animate-spin inline-block" : ""}>↻</span>
            <span className="hidden sm:inline">Actualizar</span>
          </button>
        </div>
      </header>

      {/* 2. CONTENIDO SCROLLABLE DEL TABLERO */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4 space-y-4 custom-scrollbar">
        {/* FILA DE TÍTULO Y FILTROS DE PERÍODO */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/15 dark:bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="20" x2="18" y2="10" />
                <line x1="12" y1="20" x2="12" y2="4" />
                <line x1="6" y1="20" x2="6" y2="14" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-extrabold tracking-tight text-slate-900 dark:text-white leading-tight">
                Inteligencia y Reportes de Ventas
              </h1>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Período consultado:{" "}
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  {activeRange.startDate === activeRange.endDate
                    ? activeRange.startDate
                    : `${activeRange.startDate} al ${activeRange.endDate}`}
                </span>
              </p>
            </div>
          </div>

          {/* CONTROLES DE FILTRO */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Pastillas de Período */}
            <div className="inline-flex flex-wrap items-center bg-white dark:bg-slate-900 p-1 rounded-xl border border-slate-200/90 dark:border-slate-800 shadow-2xs">
              {(
                [
                  { id: "today", label: "Hoy" },
                  { id: "yesterday", label: "Ayer" },
                  { id: "specific_day", label: "Día" },
                  { id: "current_month", label: "Mes Actual" },
                  { id: "prev_month", label: "Mes Anterior" },
                  { id: "custom", label: "Personalizado" },
                ] as { id: PeriodFilterPreset; label: string }[]
              ).map((tab) => {
                const active = preset === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setPreset(tab.id);
                      if (tab.id === "current_month" || tab.id === "prev_month") {
                        setChartMode("hourly");
                      }
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      active
                        ? "bg-emerald-600 text-white shadow-xs"
                        : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Selector de Día puntual */}
            {preset === "specific_day" && (
              <input
                type="date"
                value={specificDay}
                max={todayDefault}
                onChange={(e) => setSpecificDay(e.target.value)}
                className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-100 shadow-2xs outline-none focus:border-emerald-500"
              />
            )}

            {/* Selector de Rango Personalizado */}
            {preset === "custom" && (
              <div className="flex items-center gap-1.5 bg-white dark:bg-slate-900 px-2.5 py-1 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
                <input
                  type="date"
                  value={customStart}
                  max={todayDefault}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="text-xs font-semibold bg-transparent text-slate-800 dark:text-slate-100 outline-none"
                />
                <span className="text-slate-400 text-xs">→</span>
                <input
                  type="date"
                  value={customEnd}
                  min={customStart}
                  max={todayDefault}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="text-xs font-semibold bg-transparent text-slate-800 dark:text-slate-100 outline-none"
                />
              </div>
            )}

            {/* Filtro por Categoría */}
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 shadow-2xs outline-none focus:border-emerald-500 cursor-pointer"
            >
              <option value="all">Todas las categorías</option>
              {categoriesList.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>

            {/* Filtro por Cajero */}
            <select
              value={selectedCashierId}
              onChange={(e) => setSelectedCashierId(e.target.value)}
              className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 shadow-2xs outline-none focus:border-emerald-500 cursor-pointer"
            >
              <option value="all">Todos los cajeros</option>
              {cashiersList.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.fullName}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 3. TARJETAS KPI PRINCIPALES (4 COLUMNAS) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {/* KPI 1: Ventas Netas */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200/80 dark:border-slate-800 shadow-2xs flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                <span>💳</span> Ventas Netas
              </span>
              {kpis && (
                <span
                  className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                    kpis.netSalesGrowthBp >= 0
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/50"
                      : "bg-rose-50 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300 border border-rose-200/60 dark:border-rose-800/50"
                  }`}
                >
                  {formatBpPercent(kpis.netSalesGrowthBp, true)} {activeRange.comparisonLabel}
                </span>
              )}
            </div>
            <div className="mt-2">
              <div className="text-2xl sm:text-[26px] font-extrabold tracking-tight text-slate-900 dark:text-white">
                {formatCents(kpis?.netSalesCents ?? 0)}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center justify-between">
                <span>Bruto: {formatCents(kpis?.grossSalesCents ?? 0)}</span>
                {(kpis?.returnsCents ?? 0) > 0 && (
                  <span className="text-rose-600 dark:text-rose-400 font-semibold">
                    Dev: -{formatCents(kpis?.returnsCents ?? 0)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* KPI 2: Ganancia Estimada / Margen */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200/80 dark:border-slate-800 shadow-2xs flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                <span>💰</span> Ganancia Estimada
              </span>
              {canViewCosts && kpis && (
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-600 text-white shadow-2xs">
                  Margen {formatBpPercent(kpis.profitMarginBp)}
                </span>
              )}
            </div>
            <div className="mt-2">
              {canViewCosts ? (
                <>
                  <div className="text-2xl sm:text-[26px] font-extrabold tracking-tight text-slate-900 dark:text-white">
                    {formatCents(kpis?.estimatedProfitCents ?? 0)}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Costo mercancía vendida: {formatCents(kpis?.totalCostCents ?? 0)}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-2xl font-extrabold tracking-widest text-slate-400 dark:text-slate-600">
                    $ •••••••
                  </div>
                  <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                    Requiere permiso de consulta de costos
                  </div>
                </>
              )}
            </div>
          </div>

          {/* KPI 3: Tickets Emitidos y Ticket Promedio */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200/80 dark:border-slate-800 shadow-2xs flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                <span>🧾</span> Tickets Emitidos
              </span>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                {Number(kpis?.totalUnitsSold ?? 0).toLocaleString("es-CO", {
                  maximumFractionDigits: 2,
                })}{" "}
                unds
              </span>
            </div>
            <div className="mt-2">
              <div className="text-2xl sm:text-[26px] font-extrabold tracking-tight text-slate-900 dark:text-white">
                {kpis?.ticketsCount ?? 0}{" "}
                <span className="text-lg font-bold text-slate-600 dark:text-slate-300">ventas</span>
              </div>
              <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-1 font-medium">
                Ticket Promedio:{" "}
                <span className="font-bold text-slate-800 dark:text-slate-200">
                  {formatCents(kpis?.avgTicketCents ?? 0)}
                </span>
              </div>
            </div>
          </div>

          {/* KPI 4: Hora Pico del Día (Estilo Ámbar Destacado) */}
          <div className="bg-[#fef3c7]/75 dark:bg-amber-950/35 rounded-2xl p-4 border border-amber-200/90 dark:border-amber-800/60 shadow-2xs flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
                <span>🕒</span> Hora Pico del Período
              </span>
              {kpis?.peakHour !== null && kpis?.peakHour !== undefined && (
                <span className="text-[11px] font-bold text-amber-800 dark:text-amber-300 bg-amber-200/70 dark:bg-amber-900/60 px-2 py-0.5 rounded-full">
                  Máximo Flujo
                </span>
              )}
            </div>
            <div className="mt-2">
              <div className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 dark:text-amber-100 flex items-center gap-1.5">
                <span>🔥</span>
                <span>{kpis?.peakHourLabel || "Sin ventas"}</span>
              </div>
              <div className="text-xs font-bold text-amber-800 dark:text-amber-400 mt-1">
                {formatCents(kpis?.peakHourSalesCents ?? 0)} / {kpis?.peakHourTicketsCount ?? 0}{" "}
                tickets
              </div>
            </div>
          </div>
        </div>

        {/* 3.5 PROYECCIÓN DEL SIGUIENTE PERÍODO */}
        {report?.forecast && (
          <div className="rounded-2xl p-[1.5px] bg-linear-to-r from-indigo-500 via-sky-500 to-emerald-500 shadow-2xs">
            <div className="bg-white dark:bg-slate-900 rounded-[15px] p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-4 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🔮</span>
                  <h2 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white">
                    Proyección
                  </h2>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border ${
                    report.forecast.confidenceLabel === "Alta"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800"
                      : report.forecast.confidenceLabel === "Media"
                      ? "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800"
                      : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800"
                  }`}
                  title="Según los días de historial de ventas registrados en esta caja"
                >
                  Confianza {report.forecast.confidenceLabel}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-4 items-center">
                {/* Venta estimada */}
                <div className="xl:col-span-3">
                  <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                    Venta Estimada Próximo Período
                  </div>
                  <div className="text-3xl sm:text-[34px] font-extrabold tracking-tight text-emerald-600 dark:text-emerald-400 mt-1">
                    {formatCents(report.forecast.projectedSalesCents)}
                  </div>
                  <span
                    className={`inline-block mt-2 px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                      report.forecast.expectedGrowthBp >= 0
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                        : "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                    }`}
                  >
                    {formatBpPercent(report.forecast.expectedGrowthBp, true)} tendencia esperada
                  </span>
                </div>

                {/* Rango esperado */}
                <div className="xl:col-span-3 xl:border-l xl:pl-4 border-slate-100 dark:border-slate-800">
                  <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
                    Rango Esperado (Mín - Máx)
                  </div>
                  <div className="relative h-2.5 rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className="absolute inset-y-0 left-[12%] right-[12%] rounded-full bg-linear-to-r from-indigo-500 to-emerald-500" />
                    <div
                      className="absolute -top-1 w-1 h-4.5 rounded-full bg-slate-900 dark:bg-white"
                      style={{ left: "calc(50% - 2px)" }}
                      title={`Proyección: ${formatCents(report.forecast.projectedSalesCents)}`}
                    />
                  </div>
                  <div className="flex items-start justify-between mt-2.5 text-[11px]">
                    <div>
                      <div className="text-slate-500 dark:text-slate-400 font-medium">Conservador</div>
                      <div className="font-extrabold text-slate-800 dark:text-slate-200">
                        {formatCents(report.forecast.conservativeSalesCents)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-slate-500 dark:text-slate-400 font-medium">Optimista</div>
                      <div className="font-extrabold text-slate-800 dark:text-slate-200">
                        {formatCents(report.forecast.optimisticSalesCents)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Indicadores operativos */}
                <div className="xl:col-span-3 xl:border-l xl:pl-4 border-slate-100 dark:border-slate-800 space-y-2">
                  {canViewCosts && (
                    <div className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 text-xs flex items-center justify-between gap-2">
                      <span className="text-slate-600 dark:text-slate-400 font-medium">Utilidad Proyectada</span>
                      <span className="font-extrabold text-slate-900 dark:text-white">
                        {formatCents(report.forecast.projectedProfitCents)}
                      </span>
                    </div>
                  )}
                  <div className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 text-xs flex items-center justify-between gap-2">
                    <span className="text-slate-600 dark:text-slate-400 font-medium">Tickets Estimados</span>
                    <span className="font-extrabold text-slate-900 dark:text-white">
                      ~{report.forecast.projectedTicketsCount} ventas
                    </span>
                  </div>
                  <div className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 text-xs flex items-center justify-between gap-2">
                    <span className="text-slate-600 dark:text-slate-400 font-medium">
                      {report.forecast.targetRateLabel}
                    </span>
                    <span className="font-extrabold text-slate-900 dark:text-white">
                      {formatCents(report.forecast.targetRateCents)}
                    </span>
                  </div>
                </div>

                {/* Mini gráfico histórico + proyección */}
                <div className="xl:col-span-3 xl:border-l xl:pl-4 border-slate-100 dark:border-slate-800">
                  {(() => {
                    const pts = report.forecast.series;
                    const w = 240;
                    const h = 100;
                    const padX = 14;
                    const padTop = 24;
                    const padBottom = 18;
                    const maxV = Math.max(1, ...pts.map((p) => p.salesCents));
                    const coords = pts.map((p, i) => ({
                      ...p,
                      x: padX + (i * (w - padX * 2)) / Math.max(1, pts.length - 1),
                      y: padTop + (1 - p.salesCents / maxV) * (h - padTop - padBottom),
                    }));
                    const historic = coords.filter((c) => !c.isProjected);
                    const lastHist = historic[historic.length - 1];
                    const projected = coords.find((c) => c.isProjected);
                    const baseline = h - padBottom;
                    const { linePath, areaPath } = buildSmoothAreaPath(
                      historic.map((c) => ({ x: c.x, y: c.y })),
                      baseline
                    );

                    return (
                      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-28 overflow-visible">
                        <defs>
                          <linearGradient id="posForecastAreaGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#10b981" stopOpacity="0.28" />
                            <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
                          </linearGradient>
                          <linearGradient id="posForecastProjGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.22" />
                            <stop offset="100%" stopColor="#6366f1" stopOpacity="0.02" />
                          </linearGradient>
                        </defs>

                        {areaPath && <path d={areaPath} fill="url(#posForecastAreaGrad)" />}
                        {lastHist && projected && (
                          <path
                            d={`M ${lastHist.x} ${lastHist.y} L ${projected.x} ${projected.y} L ${projected.x} ${baseline} L ${lastHist.x} ${baseline} Z`}
                            fill="url(#posForecastProjGrad)"
                          />
                        )}
                        {linePath && (
                          <path d={linePath} fill="none" stroke="#059669" strokeWidth="2.4" strokeLinecap="round" />
                        )}
                        {lastHist && projected && (
                          <>
                            <line
                              x1={lastHist.x}
                              y1={padTop - 6}
                              x2={lastHist.x}
                              y2={baseline}
                              stroke="currentColor"
                              className="text-slate-300 dark:text-slate-700"
                              strokeDasharray="3 3"
                            />
                            <line
                              x1={lastHist.x}
                              y1={lastHist.y}
                              x2={projected.x}
                              y2={projected.y}
                              stroke="#6366f1"
                              strokeWidth="2.2"
                              strokeDasharray="5 4"
                              strokeLinecap="round"
                            />
                            <circle
                              cx={lastHist.x}
                              cy={lastHist.y}
                              r={3.5}
                              className="fill-white dark:fill-slate-900"
                              stroke="#059669"
                              strokeWidth="2"
                            />
                            <circle
                              cx={projected.x}
                              cy={projected.y}
                              r={5}
                              className="fill-white dark:fill-slate-900"
                              stroke="#6366f1"
                              strokeWidth="2.5"
                            />
                            <g transform={`translate(${Math.min(w - 78, Math.max(0, projected.x - 76))}, ${Math.max(0, projected.y - 24)})`}>
                              <rect width={76} height={17} rx={5} fill="#6366f1" />
                              <text x={38} y={12} textAnchor="middle" className="fill-white text-[9px] font-bold">
                                {formatCents(projected.salesCents)}
                              </text>
                            </g>
                          </>
                        )}
                        {coords.map((c) => (
                          <text
                            key={c.label}
                            x={c.x}
                            y={h - 3}
                            textAnchor="middle"
                            className={`text-[8.5px] font-semibold ${
                              c.isProjected
                                ? "fill-indigo-600 dark:fill-indigo-400"
                                : "fill-slate-400 dark:fill-slate-500"
                            }`}
                          >
                            {c.label.replace(" (cierre est.)", "")}
                          </text>
                        ))}
                      </svg>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 4. SECCIÓN DE GRÁFICOS PRINCIPALES (FLUJO HORARIO + CATEGORÍAS) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* COLUMNA IZQUIERDA (7 cols): Gráfico de Barras + Área Suavizada de Horas con Más Ventas */}
          <div className="lg:col-span-7 bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200/80 dark:border-slate-800 shadow-2xs flex flex-col justify-between">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <span className="text-slate-500 dark:text-slate-400">🕒</span>
                <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
                  {chartMode === "hourly"
                    ? "Horas con Más Ventas"
                    : "Evolución Diaria de Ventas"}
                </h2>
                <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                  {chartMode === "hourly"
                    ? "(Flujo Horario del Negocio)"
                    : `(${report?.dailyTrend.length ?? 0} días con movimiento)`}
                </span>
              </div>

              {isMultiDay && (
                <div className="inline-flex bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700">
                  <button
                    type="button"
                    onClick={() => setChartMode("hourly")}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${
                      chartMode === "hourly"
                        ? "bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-2xs"
                        : "text-slate-600 dark:text-slate-400"
                    }`}
                  >
                    Por Hora Pico
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartMode("daily")}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${
                      chartMode === "daily"
                        ? "bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-2xs"
                        : "text-slate-600 dark:text-slate-400"
                    }`}
                  >
                    Día por Día
                  </button>
                </div>
              )}
            </div>

            {/* Lienzo SVG Dinámico */}
            {chartItems.length === 0 || (kpis?.ticketsCount ?? 0) === 0 ? (
              <div className="h-60 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                <span className="text-2xl mb-1">📉</span>
                <p className="text-xs font-semibold">
                  No se registran ventas completadas en este período
                </p>
              </div>
            ) : (
              <div className="relative w-full pt-4">
                {(() => {
                  const svgWidth = 720;
                  const svgHeight = 235;
                  const padLeft = 68;
                  const padRight = 20;
                  const padTop = 38;
                  const padBottom = 32;
                  const plotWidth = svgWidth - padLeft - padRight;
                  const plotHeight = svgHeight - padTop - padBottom;
                  const baselineY = padTop + plotHeight;

                  const count = chartItems.length;
                  const slotWidth = plotWidth / Math.max(1, count);

                  const coords = chartItems.map((item, idx) => {
                    const cx = padLeft + slotWidth * idx + slotWidth / 2;
                    const ratio = Math.min(1, Math.max(0, item.totalCents / maxChartCents));
                    const cy = baselineY - ratio * plotHeight;
                    const barHeight = Math.max(ratio > 0 ? 4 : 0, ratio * plotHeight);
                    return { ...item, idx, cx, cy, barHeight };
                  });

                  const { linePath, areaPath } = buildSmoothAreaPath(
                    coords.map((c) => ({ x: c.cx, y: c.cy })),
                    baselineY
                  );

                  const yTicks = [1, 0.75, 0.5, 0.25, 0];
                  const activeHover =
                    hoveredBarIndex !== null && coords[hoveredBarIndex]
                      ? coords[hoveredBarIndex]
                      : coords.find((c) => c.isPeak) || null;

                  return (
                    <svg
                      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                      className="w-full h-60 overflow-visible"
                      onMouseLeave={() => setHoveredBarIndex(null)}
                    >
                      <defs>
                        <linearGradient id="posSalesAreaGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity="0.32" />
                          <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
                        </linearGradient>
                        <linearGradient id="posPeakBarGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#059669" />
                          <stop offset="100%" stopColor="#10b981" />
                        </linearGradient>
                      </defs>

                      {/* Líneas guía horizontales y etiquetas del eje Y */}
                      {yTicks.map((t, i) => {
                        const y = baselineY - t * plotHeight;
                        const valCents = Math.round(maxChartCents * t);
                        return (
                          <g key={i}>
                            <line
                              x1={padLeft}
                              y1={y}
                              x2={svgWidth - padRight}
                              y2={y}
                              stroke="currentColor"
                              className="text-slate-200 dark:text-slate-800"
                              strokeDasharray={t === 0 ? undefined : "3 3"}
                              strokeWidth="1"
                            />
                            <text
                              x={padLeft - 8}
                              y={y + 3}
                              textAnchor="end"
                              className="fill-slate-400 dark:fill-slate-500 text-[10px] font-semibold"
                            >
                              {formatCents(valCents)}
                            </text>
                          </g>
                        );
                      })}

                      {/* Área sombreada bajo la curva */}
                      {areaPath && <path d={areaPath} fill="url(#posSalesAreaGrad)" />}

                      {/* Barras dobles o individuales por franja */}
                      {coords.map((c) => {
                        const isHovered = hoveredBarIndex === c.idx;
                        const barW = Math.min(24, Math.max(8, slotWidth * 0.56));
                        const halfW = barW / 2;

                        return (
                          <g
                            key={c.key}
                            className="cursor-pointer"
                            onMouseEnter={() => setHoveredBarIndex(c.idx)}
                          >
                            {/* Zona interactiva invisible para facilitar hover */}
                            <rect
                              x={c.cx - slotWidth / 2}
                              y={padTop}
                              width={slotWidth}
                              height={plotHeight + padBottom}
                              fill="transparent"
                            />

                            {c.isPeak ? (
                              <rect
                                x={c.cx - barW * 0.6}
                                y={baselineY - c.barHeight}
                                width={barW * 1.2}
                                height={c.barHeight}
                                rx={4}
                                fill="url(#posPeakBarGrad)"
                                className="transition-all duration-200"
                              />
                            ) : (
                              <>
                                {/* Barra izquierda (pizarra oscura) */}
                                <rect
                                  x={c.cx - halfW - 1}
                                  y={baselineY - c.barHeight * 0.92}
                                  width={Math.max(3, halfW - 1)}
                                  height={c.barHeight * 0.92}
                                  rx={2}
                                  className={
                                    isHovered
                                      ? "fill-slate-600 dark:fill-slate-300"
                                      : "fill-slate-700 dark:fill-slate-600"
                                  }
                                />
                                {/* Barra derecha (verde menta) */}
                                <rect
                                  x={c.cx + 1}
                                  y={baselineY - c.barHeight}
                                  width={Math.max(3, halfW - 1)}
                                  height={c.barHeight}
                                  rx={2}
                                  className={
                                    isHovered
                                      ? "fill-emerald-400"
                                      : "fill-emerald-500/75 dark:fill-emerald-500/80"
                                  }
                                />
                              </>
                            )}

                            {/* Etiqueta Eje X */}
                            {(count <= 18 || c.idx % 2 === 0 || c.isPeak) && (
                              <text
                                x={c.cx}
                                y={baselineY + 16}
                                textAnchor="middle"
                                className={`text-[9.5px] font-bold ${
                                  c.isPeak || isHovered
                                    ? "fill-emerald-700 dark:fill-emerald-400"
                                    : "fill-slate-500 dark:fill-slate-400"
                                }`}
                              >
                                {c.label}
                              </text>
                            )}
                          </g>
                        );
                      })}

                      {/* Curva suavizada superior */}
                      {linePath && (
                        <path
                          d={linePath}
                          fill="none"
                          stroke="#059669"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                        />
                      )}

                      {/* Punto e Insignia Flotante en la Hora Pico o Barra en Hover */}
                      {activeHover && activeHover.totalCents > 0 && (
                        <g>
                          <circle
                            cx={activeHover.cx}
                            cy={activeHover.cy}
                            r={5}
                            className="fill-emerald-600 stroke-white dark:stroke-slate-900"
                            strokeWidth="2.5"
                          />
                          {(() => {
                            const boxW = 132;
                            const boxH = 36;
                            const clampedX = Math.min(
                              svgWidth - padRight - boxW / 2,
                              Math.max(padLeft + boxW / 2, activeHover.cx)
                            );
                            const boxY = Math.max(2, activeHover.cy - boxH - 10);
                            return (
                              <g transform={`translate(${clampedX - boxW / 2}, ${boxY})`}>
                                <rect
                                  width={boxW}
                                  height={boxH}
                                  rx={7}
                                  fill="#059669"
                                  className="shadow-md"
                                />
                                <text
                                  x={boxW / 2}
                                  y={13}
                                  textAnchor="middle"
                                  className="fill-emerald-100 text-[9px] font-semibold"
                                >
                                  {activeHover.fullLabel}
                                </text>
                                <text
                                  x={boxW / 2}
                                  y={28}
                                  textAnchor="middle"
                                  className="fill-white text-[11.5px] font-extrabold"
                                >
                                  {formatCents(activeHover.totalCents)}
                                </text>
                              </g>
                            );
                          })()}
                        </g>
                      )}
                    </svg>
                  );
                })()}
              </div>
            )}
          </div>

          {/* COLUMNA DERECHA (5 cols): Categorías Más Vendidas (Dona + Barras Progresivas) */}
          <div className="lg:col-span-5 bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200/80 dark:border-slate-800 shadow-2xs flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <span className="text-slate-500 dark:text-slate-400">🏷️</span>
                <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
                  Categorías Más Vendidas
                </h2>
              </div>
              <span className="text-[11px] font-semibold text-slate-400">
                Participación %
              </span>
            </div>

            {groupedCategories.length === 0 ? (
              <div className="h-56 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                <span className="text-2xl mb-1">🏷️</span>
                <p className="text-xs font-semibold">Sin categorías facturadas en este rango</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-12 items-center gap-4 my-auto py-2">
                {/* Gráfico de Dona SVG */}
                <div className="sm:col-span-5 flex items-center justify-center">
                  {(() => {
                    const size = 165;
                    const strokeWidth = 26;
                    const center = size / 2;
                    const radius = center - strokeWidth / 2 - 4;
                    const circumference = 2 * Math.PI * radius;
                    let accumulatedBp = 0;

                    return (
                      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                        <circle
                          cx={center}
                          cy={center}
                          r={radius}
                          fill="none"
                          stroke="currentColor"
                          className="text-slate-100 dark:text-slate-800"
                          strokeWidth={strokeWidth}
                        />
                        {groupedCategories.map((cat, idx) => {
                          const color = CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
                          const ratio = Math.max(0, Math.min(1, cat.shareBp / 10000));
                          const dashLen = Math.max(0, ratio * circumference - 2);
                          const dashOffset = -(accumulatedBp / 10000) * circumference;
                          accumulatedBp += cat.shareBp;

                          return (
                            <circle
                              key={cat.categoryName}
                              cx={center}
                              cy={center}
                              r={radius}
                              fill="none"
                              stroke={color.hex}
                              strokeWidth={strokeWidth}
                              strokeDasharray={`${dashLen} ${circumference}`}
                              strokeDashoffset={dashOffset}
                              transform={`rotate(-90 ${center} ${center})`}
                              className="transition-all duration-300"
                            >
                              <title>
                                {cat.categoryName}: {formatCents(cat.revenueCents)} (
                                {formatBpPercent(cat.shareBp)})
                              </title>
                            </circle>
                          );
                        })}
                        <text
                          x={center}
                          y={center - 4}
                          textAnchor="middle"
                          className="fill-slate-400 dark:fill-slate-500 text-[10px] font-bold uppercase"
                        >
                          Categorías
                        </text>
                        <text
                          x={center}
                          y={center + 14}
                          textAnchor="middle"
                          className="fill-slate-800 dark:fill-white text-sm font-extrabold"
                        >
                          {report?.topCategories.length ?? 0} activas
                        </text>
                      </svg>
                    );
                  })()}
                </div>

                {/* Barras Horizontales de Categoría */}
                <div className="sm:col-span-7 space-y-3">
                  {groupedCategories.map((cat, idx) => {
                    const color = CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
                    const pct = Math.min(100, Math.round(cat.shareBp / 100));
                    return (
                      <div key={cat.categoryName} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-slate-800 dark:text-slate-200 truncate max-w-[160px]">
                            {cat.categoryName}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                              {formatCents(cat.revenueCents)}
                            </span>
                            <span className="font-extrabold text-slate-900 dark:text-white w-9 text-right">
                              {pct}%
                            </span>
                          </div>
                        </div>
                        <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${color.bg} transition-all duration-300`}
                            style={{ width: `${Math.max(4, pct)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 5. SECCIÓN INFERIOR: PRODUCTOS MÁS VENDIDOS + MEDIOS DE PAGO Y CAJEROS */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pb-4">
          {/* COLUMNA IZQUIERDA (7 cols): Tabla de Productos Más Vendidos */}
          <div className="lg:col-span-7 bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200/80 dark:border-slate-800 shadow-2xs flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <span>🏆</span>
                <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
                  Productos Más Vendidos
                </h2>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder="Filtrar producto..."
                  className="px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 outline-none focus:border-emerald-500 w-36 sm:w-44"
                />

                <div className="inline-flex bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700">
                  <button
                    type="button"
                    onClick={() => setProductSort("revenue")}
                    className={`px-2 py-1 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${
                      productSort === "revenue"
                        ? "bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-2xs"
                        : "text-slate-600 dark:text-slate-400"
                    }`}
                  >
                    Por Total $
                  </button>
                  <button
                    type="button"
                    onClick={() => setProductSort("units")}
                    className={`px-2 py-1 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${
                      productSort === "units"
                        ? "bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-2xs"
                        : "text-slate-600 dark:text-slate-400"
                    }`}
                  >
                    Por Unidades
                  </button>
                  {canViewCosts && (
                    <button
                      type="button"
                      onClick={() => setProductSort("profit")}
                      className={`px-2 py-1 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${
                        productSort === "profit"
                          ? "bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-2xs"
                          : "text-slate-600 dark:text-slate-400"
                      }`}
                    >
                      Más Rentables
                    </button>
                  )}
                </div>
              </div>
            </div>

            {sortedProducts.length === 0 ? (
              <div className="h-48 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                <span className="text-2xl mb-1">📦</span>
                <p className="text-xs font-semibold">
                  No hay productos que coincidan con el filtro seleccionado
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto max-h-72 custom-scrollbar border border-slate-100 dark:border-slate-800/80 rounded-xl">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-50 dark:bg-slate-800/70 sticky top-0 z-10 text-[11px] font-bold text-slate-500 dark:text-slate-400 border-b border-slate-200/70 dark:border-slate-800">
                    <tr>
                      <th className="py-2.5 px-3">Producto</th>
                      <th className="py-2.5 px-3 text-right">Unidades</th>
                      <th className="py-2.5 px-3 text-right">Total</th>
                      {canViewCosts && (
                        <th className="py-2.5 px-3 text-right">Margen %</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 text-xs">
                    {sortedProducts.map((prod, idx) => {
                      const imgSrc =
                        resolveProductImageSrc(prod.imageLocalPath, prod.imageUrl) ||
                        getDefaultProductImage("product");
                      return (
                        <tr
                          key={`${prod.productId ?? prod.name}-${idx}`}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-2.5">
                              <img
                                src={imgSrc}
                                alt={prod.name}
                                className="w-8 h-8 rounded-lg object-cover bg-slate-100 dark:bg-slate-800 border border-slate-200/70 dark:border-slate-700 shrink-0"
                                onError={(e) => {
                                  (e.currentTarget as HTMLImageElement).src =
                                    getDefaultProductImage("product");
                                }}
                              />
                              <div className="min-w-0">
                                <div className="font-bold text-slate-900 dark:text-slate-100 truncate max-w-[220px] sm:max-w-[280px]">
                                  {prod.name}
                                </div>
                                <div className="text-[10px] text-slate-400 flex items-center gap-1.5">
                                  <span>{prod.categoryName}</span>
                                  {prod.sku && <span>• {prod.sku}</span>}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right font-extrabold text-slate-800 dark:text-slate-200">
                            {Number(prod.unitsSold).toLocaleString("es-CO", {
                              maximumFractionDigits: 2,
                            })}
                          </td>
                          <td className="py-2.5 px-3 text-right font-extrabold text-slate-900 dark:text-white">
                            {formatCents(prod.revenueCents)}
                          </td>
                          {canViewCosts && (
                            <td className="py-2.5 px-3 text-right">
                              <span
                                className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-bold ${
                                  prod.marginBp >= 2000
                                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300"
                                    : prod.marginBp > 0
                                    ? "bg-amber-50 text-amber-700 dark:bg-amber-950/70 dark:text-amber-300"
                                    : "bg-rose-50 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300"
                                }`}
                                title={`Utilidad estimada: ${formatCents(prod.profitCents)}`}
                              >
                                {formatBpPercent(prod.marginBp, true)}
                              </span>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* COLUMNA DERECHA (5 cols): Medios de Pago (Anillos Circulares) + Desglose por Cajero */}
          <div className="lg:col-span-5 bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200/80 dark:border-slate-800 shadow-2xs flex flex-col justify-between space-y-4">
            <div>
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <span>💳</span>
                  <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
                    Medios de Pago
                  </h2>
                </div>
                <span className="text-[11px] font-semibold text-slate-400">
                  Recaudo Neto
                </span>
              </div>

              {!report || report.paymentMethods.length === 0 ? (
                <div className="h-36 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                  <span className="text-xl mb-1">💳</span>
                  <p className="text-xs font-semibold">Sin pagos registrados</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                  {report.paymentMethods.slice(0, 4).map((pm, idx) => {
                    const ringColor = PAYMENT_RING_COLORS[idx % PAYMENT_RING_COLORS.length];
                    const pct = Math.min(100, Math.round(pm.shareBp / 100));
                    const size = 84;
                    const strokeW = 8;
                    const center = size / 2;
                    const radius = center - strokeW;
                    const circum = 2 * Math.PI * radius;
                    const dash = (pct / 100) * circum;

                    return (
                      <div
                        key={pm.methodCode}
                        className="flex flex-col items-center p-2.5 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800"
                      >
                        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                          <circle
                            cx={center}
                            cy={center}
                            r={radius}
                            fill="none"
                            stroke="currentColor"
                            className="text-slate-200 dark:text-slate-700"
                            strokeWidth={strokeW}
                          />
                          <circle
                            cx={center}
                            cy={center}
                            r={radius}
                            fill="none"
                            stroke={ringColor.stroke}
                            strokeWidth={strokeW}
                            strokeLinecap="round"
                            strokeDasharray={`${dash} ${circum}`}
                            transform={`rotate(-90 ${center} ${center})`}
                          />
                          <text
                            x={center}
                            y={center + 5}
                            textAnchor="middle"
                            className="fill-slate-900 dark:fill-white text-sm font-extrabold"
                          >
                            {pct}%
                          </text>
                        </svg>
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200 mt-1 text-center truncate w-full">
                          {pm.methodName}
                        </span>
                        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                          {formatCents(pm.totalCents)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Resumen compacto de Cajeros del Período */}
            {report && report.cashierBreakdown.length > 0 && (
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400 mb-2">
                  <span>👤 Ventas por Cajero</span>
                  <span>Ticket Promedio</span>
                </div>
                <div className="space-y-1.5 max-h-28 overflow-y-auto custom-scrollbar">
                  {report.cashierBreakdown.map((cb, idx) => (
                    <div
                      key={`${cb.userId ?? idx}`}
                      className="flex items-center justify-between text-xs py-1 px-2 rounded-lg bg-slate-50 dark:bg-slate-800/50"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-bold text-slate-800 dark:text-slate-200 truncate">
                          {cb.cashierName}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-200/70 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-semibold">
                          {cb.ticketsCount} tks
                        </span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">
                          Prom: {formatCents(cb.avgTicketCents)}
                        </span>
                        <span className="font-extrabold text-slate-900 dark:text-white">
                          {formatCents(cb.netSalesCents)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
