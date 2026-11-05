use rusqlite::{params, Connection};
use tauri::State;

use crate::commands::sales::format_payment_method_label;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::models::report::{
    CashierSalesStat, CategorySalesStat, DailySalesPoint, ForecastSeriesPoint, HourlySalesBucket,
    PaymentMethodStat, SalesAnalyticsReport, SalesForecastSummary, SalesKpiSummary,
    SalesReportFilterInput, TopProductStat,
};

fn format_hour_label(hour: i64) -> String {
    match hour {
        0 => "12:00 AM".to_string(),
        1..=11 => format!("{}:00 AM", hour),
        12 => "12:00 PM".to_string(),
        13..=23 => format!("{}:00 PM", hour - 12),
        _ => format!("{:02}:00", hour),
    }
}

fn format_peak_hour_range(hour: i64) -> String {
    let next = (hour + 1) % 24;
    format!("{} - {}", format_hour_label(hour), format_hour_label(next))
}

fn format_short_date_label(ymd: &str) -> String {
    let parts: Vec<&str> = ymd.split('-').collect();
    if parts.len() == 3 {
        let month_name = match parts[1] {
            "01" => "Ene",
            "02" => "Feb",
            "03" => "Mar",
            "04" => "Abr",
            "05" => "May",
            "06" => "Jun",
            "07" => "Jul",
            "08" => "Ago",
            "09" => "Sep",
            "10" => "Oct",
            "11" => "Nov",
            "12" => "Dic",
            _ => parts[1],
        };
        format!("{} {}", parts[2], month_name)
    } else {
        ymd.to_string()
    }
}

/// Calcula puntos base: (numerator * 10000) / denominator con redondeo entero
fn calc_bp(numerator: i64, denominator: i64) -> i64 {
    if denominator <= 0 {
        return 0;
    }
    let sign = if numerator < 0 { -1 } else { 1 };
    let abs_num = numerator.abs();
    sign * ((abs_num * 10_000 + (denominator / 2)) / denominator)
}

#[derive(Default)]
struct PeriodTotals {
    gross_sales_cents: i64,
    returns_cents: i64,
    net_sales_cents: i64,
    total_cost_cents: i64,
    profit_cents: i64,
    tickets_count: i64,
    units_sold: f64,
    returns_count: i64,
}

fn query_period_totals(
    conn: &Connection,
    start_date: &str,
    end_date: &str,
    cashier_id: Option<i64>,
    category_name: Option<&str>,
) -> AppResult<PeriodTotals> {
    let cashier_filter = cashier_id.unwrap_or(0);
    let has_cashier = if cashier_id.is_some() { 1 } else { 0 };
    let cat_str = category_name.unwrap_or("").trim();
    let has_category = if !cat_str.is_empty() { 1 } else { 0 };

    if has_category == 0 {
        // Sin filtro de categoría: consulta directa sobre cabecera sales + sale_items
        let (tickets_count, gross_sales_cents, returns_cents, returns_count): (i64, i64, i64, i64) =
            conn.query_row(
                "SELECT
                    COUNT(s.id),
                    COALESCE(SUM(s.total_cents), 0),
                    COALESCE(SUM(COALESCE(s.returned_cents, 0)), 0),
                    COALESCE(SUM(CASE WHEN COALESCE(s.returned_cents, 0) > 0 THEN 1 ELSE 0 END), 0)
                 FROM sales s
                 WHERE s.status = 'completed'
                   AND date(s.created_at, 'localtime') >= date(?1)
                   AND date(s.created_at, 'localtime') <= date(?2)
                   AND (?3 = 0 OR s.user_id = ?4)",
                params![start_date, end_date, has_cashier, cashier_filter],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )?;

        let (units_sold, total_cost_cents): (f64, i64) = conn.query_row(
            "SELECT
                COALESCE(SUM(MAX(0.0, si.quantity - COALESCE(si.returned_quantity, 0.0))), 0.0),
                COALESCE(SUM(CAST(ROUND(MAX(0.0, si.quantity - COALESCE(si.returned_quantity, 0.0)) * COALESCE(si.unit_cost_cents, 0)) AS INTEGER)), 0)
             FROM sale_items si
             JOIN sales s ON s.id = si.sale_id
             WHERE s.status = 'completed'
               AND date(s.created_at, 'localtime') >= date(?1)
               AND date(s.created_at, 'localtime') <= date(?2)
               AND (?3 = 0 OR s.user_id = ?4)",
            params![start_date, end_date, has_cashier, cashier_filter],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;

        let net_sales_cents = (gross_sales_cents - returns_cents).max(0);
        let profit_cents = net_sales_cents - total_cost_cents;

        Ok(PeriodTotals {
            gross_sales_cents,
            returns_cents,
            net_sales_cents,
            total_cost_cents,
            profit_cents,
            tickets_count,
            units_sold,
            returns_count,
        })
    } else {
        // Con filtro de categoría: agregación por líneas de esa categoría
        let (tickets_count, gross_sales_cents, net_sales_cents, units_sold, total_cost_cents, returns_count): (
            i64,
            i64,
            i64,
            f64,
            i64,
            i64,
        ) = conn.query_row(
            "SELECT
                COUNT(DISTINCT s.id),
                COALESCE(SUM(si.total_cents), 0),
                COALESCE(SUM(
                    CASE WHEN si.quantity > 0
                         THEN CAST(ROUND(si.total_cents * MAX(0.0, si.quantity - COALESCE(si.returned_quantity, 0.0)) / si.quantity) AS INTEGER)
                         ELSE 0 END
                ), 0),
                COALESCE(SUM(MAX(0.0, si.quantity - COALESCE(si.returned_quantity, 0.0))), 0.0),
                COALESCE(SUM(CAST(ROUND(MAX(0.0, si.quantity - COALESCE(si.returned_quantity, 0.0)) * COALESCE(si.unit_cost_cents, 0)) AS INTEGER)), 0),
                COUNT(DISTINCT CASE WHEN COALESCE(si.returned_quantity, 0.0) > 0 THEN s.id ELSE NULL END)
             FROM sale_items si
             JOIN sales s ON s.id = si.sale_id
             LEFT JOIN products p ON p.id = si.product_id
             LEFT JOIN categories c ON c.id = p.category_id
             WHERE s.status = 'completed'
               AND date(s.created_at, 'localtime') >= date(?1)
               AND date(s.created_at, 'localtime') <= date(?2)
               AND (?3 = 0 OR s.user_id = ?4)
               AND COALESCE(c.name, 'Sin categoría') = ?5",
            params![start_date, end_date, has_cashier, cashier_filter, cat_str],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
        )?;

        let returns_cents = (gross_sales_cents - net_sales_cents).max(0);
        let profit_cents = net_sales_cents - total_cost_cents;

        Ok(PeriodTotals {
            gross_sales_cents,
            returns_cents,
            net_sales_cents,
            total_cost_cents,
            profit_cents,
            tickets_count,
            units_sold,
            returns_count,
        })
    }
}

/// Aplica puntos base a un valor en centavos con redondeo entero: (v * bp + 5000) / 10000
fn apply_bp(value_cents: i64, bp: i64) -> i64 {
    ((value_cents as i128 * bp as i128 + 5_000) / 10_000) as i64
}

/// Número de días calendario (inclusivo) entre dos fechas 'YYYY-MM-DD'
fn days_inclusive(conn: &Connection, start: &str, end: &str) -> AppResult<i64> {
    let d: i64 = conn.query_row(
        "SELECT CAST(ROUND(julianday(date(?2)) - julianday(date(?1))) AS INTEGER) + 1",
        params![start, end],
        |r| r.get(0),
    )?;
    Ok(d)
}

/// Ventas netas (descontando devoluciones por línea) en un rango, con corte horario opcional ('' = sin corte)
#[allow(clippy::too_many_arguments)]
fn net_sales_between(
    conn: &Connection,
    start: &str,
    end: &str,
    has_cashier: i64,
    cashier_filter: i64,
    has_category: i64,
    cat_str: &str,
    cutoff_time: &str,
) -> AppResult<i64> {
    let v: i64 = conn.query_row(
        "SELECT COALESCE(SUM(
            CASE WHEN si.quantity > 0
                 THEN CAST(ROUND(si.total_cents * MAX(0.0, si.quantity - COALESCE(si.returned_quantity, 0.0)) / si.quantity) AS INTEGER)
                 ELSE 0 END
         ), 0)
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         LEFT JOIN products p ON p.id = si.product_id
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE s.status = 'completed'
           AND date(s.created_at, 'localtime') >= date(?1)
           AND date(s.created_at, 'localtime') <= date(?2)
           AND (?3 = 0 OR s.user_id = ?4)
           AND (?5 = 0 OR COALESCE(c.name, 'Sin categoría') = ?6)
           AND (?7 = '' OR time(s.created_at, 'localtime') <= ?7)",
        params![start, end, has_cashier, cashier_filter, has_category, cat_str, cutoff_time],
        |r| r.get(0),
    )?;
    Ok(v)
}

/// Motor de Proyección del Siguiente Período (100% entero, Offline-First).
///
/// 1. Si el período está en curso, estima su cierre (Run-Rate):
///    - Un solo día: escala lo vendido según el período anterior a la misma hora.
///    - Varios días: (vendido / días transcurridos) × días totales.
/// 2. Suavizamiento ponderado (Holt simplificado) sobre t-2, t-1 y actual:
///    Nivel = (3·Vt + 2·Vt-1 + 1·Vt-2) / 6
///    Tendencia = ((Vt - Vt-1) + (Vt-1 - Vt-2)) / 2, acotada a ±25 % del nivel.
///    Proyección = Nivel + Tendencia.
#[allow(clippy::too_many_arguments)]
fn build_sales_forecast(
    conn: &Connection,
    filter: &SalesReportFilterInput,
    has_cashier: i64,
    cashier_filter: i64,
    has_category: i64,
    cat_str: &str,
    current: &PeriodTotals,
    prev: &PeriodTotals,
) -> AppResult<SalesForecastSummary> {
    let start = filter.start_date.trim();
    let end = filter.end_date.trim();
    let period_days = days_inclusive(conn, start, end)?.max(1);

    let (today, now_time, now_minutes): (String, String, i64) = conn.query_row(
        "SELECT date('now', 'localtime'), time('now', 'localtime'),
                CAST(strftime('%H', 'now', 'localtime') AS INTEGER) * 60
                  + CAST(strftime('%M', 'now', 'localtime') AS INTEGER)",
        [],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;

    let prev_start = filter
        .prev_start_date
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let prev_end = filter
        .prev_end_date
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let prev2_start = filter
        .prev2_start_date
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let prev2_end = filter
        .prev2_end_date
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    // Ventas del período t-2
    let v2 = match (prev2_start, prev2_end) {
        (Some(a), Some(b)) => net_sales_between(
            conn, a, b, has_cashier, cashier_filter, has_category, cat_str, "",
        )?,
        _ => match (prev_start, prev_end) {
            (Some(ps), Some(pe)) => {
                let prev_len = days_inclusive(conn, ps, pe)?.max(1);
                let (p2s, p2e): (String, String) = conn.query_row(
                    "SELECT date(?1, '-' || ?2 || ' days'), date(?1, '-1 day')",
                    params![ps, prev_len],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )?;
                net_sales_between(
                    conn, &p2s, &p2e, has_cashier, cashier_filter, has_category, cat_str, "",
                )?
            }
            _ => 0,
        },
    };

    let vt = current.net_sales_cents.max(0);
    let v1 = prev.net_sales_cents.max(0);

    // 1. Cierre estimado del período actual (si aún está en curso)
    let in_progress = today.as_str() >= start && today.as_str() <= end;
    let vt_closing = if !in_progress {
        vt
    } else if period_days == 1 {
        let prev_is_single_day = match (prev_start, prev_end) {
            (Some(ps), Some(pe)) => days_inclusive(conn, ps, pe)? == 1,
            _ => false,
        };
        let v1_until_now = if prev_is_single_day {
            net_sales_between(
                conn,
                prev_start.unwrap_or_default(),
                prev_end.unwrap_or_default(),
                has_cashier,
                cashier_filter,
                has_category,
                cat_str,
                &now_time,
            )?
        } else {
            0
        };

        let estimated = if v1_until_now > 0 && v1 > 0 {
            // Escalar por la proporción que faltaba vender ayer a esta misma hora (máx 5x)
            let scaled = ((vt as i128 * v1 as i128) / v1_until_now as i128) as i64;
            scaled.min(vt.saturating_mul(5))
        } else {
            // Jornada comercial estándar de 7:00 a 21:00 (840 minutos)
            let elapsed = (now_minutes - 420).clamp(84, 840);
            ((vt as i128 * 840) / elapsed as i128) as i64
        };
        estimated.max(vt)
    } else {
        let elapsed_days = days_inclusive(conn, start, &today)?.clamp(1, period_days);
        ((vt as i128 * period_days as i128 + (elapsed_days as i128 / 2)) / elapsed_days as i128)
            as i64
    };

    // 2. Nivel + Tendencia ponderados
    let (level, trend) = if v1 == 0 && v2 == 0 {
        (vt_closing, 0)
    } else if v2 == 0 {
        ((2 * vt_closing + v1 + 1) / 3, (vt_closing - v1) / 2)
    } else {
        (
            (3 * vt_closing + 2 * v1 + v2 + 3) / 6,
            ((vt_closing - v1) + (v1 - v2)) / 2,
        )
    };
    let cap = level.max(0) / 4;
    let projected = (level + trend.clamp(-cap, cap)).max(0);

    // 3. Nivel de confianza según historial local disponible
    let history_days: i64 = conn.query_row(
        "SELECT COUNT(DISTINCT date(created_at, 'localtime'))
         FROM sales
         WHERE status = 'completed'
           AND date(created_at, 'localtime') >= date('now', 'localtime', '-60 days')",
        [],
        |r| r.get(0),
    )?;
    let (confidence_label, spread_bp) = if history_days >= 28 && v1 > 0 && v2 > 0 {
        ("Alta", 800)
    } else if history_days >= 7 && v1 > 0 {
        ("Media", 1500)
    } else {
        ("En aprendizaje", 2500)
    };
    let spread = apply_bp(projected, spread_bp);

    // 4. Utilidad y tickets proyectados
    let margin_bp = if current.net_sales_cents > 0 {
        calc_bp(current.profit_cents, current.net_sales_cents)
    } else {
        calc_bp(prev.profit_cents, prev.net_sales_cents)
    };
    let avg_ticket = if current.tickets_count > 0 {
        (current.net_sales_cents + current.tickets_count / 2) / current.tickets_count
    } else if prev.tickets_count > 0 {
        (prev.net_sales_cents + prev.tickets_count / 2) / prev.tickets_count
    } else {
        0
    };
    let projected_tickets_count = if avg_ticket > 0 {
        (projected + avg_ticket / 2) / avg_ticket
    } else {
        0
    };

    // 5. Meta operativa: por hora (período de 1 día) o por día (períodos largos)
    let (target_rate_cents, target_rate_label) = if period_days == 1 {
        let active_hours: i64 = conn
            .query_row(
                "SELECT COUNT(DISTINCT strftime('%H', created_at, 'localtime'))
                 FROM sales
                 WHERE status = 'completed'
                   AND date(created_at, 'localtime') >= date('now', 'localtime', '-30 days')",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let hours = if active_hours > 0 { active_hours.min(24) } else { 12 };
        ((projected + hours / 2) / hours, "Meta por Hora".to_string())
    } else {
        (
            (projected + period_days / 2) / period_days,
            "Meta por Día".to_string(),
        )
    };

    let expected_growth_bp = if vt_closing > 0 {
        calc_bp(projected - vt_closing, vt_closing)
    } else if projected > 0 {
        10_000
    } else {
        0
    };

    let series = vec![
        ForecastSeriesPoint {
            label: "Hace 2".into(),
            sales_cents: v2,
            is_projected: false,
        },
        ForecastSeriesPoint {
            label: "Anterior".into(),
            sales_cents: v1,
            is_projected: false,
        },
        ForecastSeriesPoint {
            label: if in_progress {
                "Actual (cierre est.)".into()
            } else {
                "Actual".into()
            },
            sales_cents: vt_closing,
            is_projected: false,
        },
        ForecastSeriesPoint {
            label: "Próximo".into(),
            sales_cents: projected,
            is_projected: true,
        },
    ];

    Ok(SalesForecastSummary {
        projected_sales_cents: projected,
        conservative_sales_cents: (projected - spread).max(0),
        optimistic_sales_cents: projected + spread,
        projected_profit_cents: apply_bp(projected, margin_bp),
        projected_tickets_count,
        target_rate_cents,
        target_rate_label,
        expected_growth_bp,
        confidence_label: confidence_label.to_string(),
        series,
    })
}

pub fn build_sales_analytics(
    conn: &Connection,
    filter: &SalesReportFilterInput,
) -> AppResult<SalesAnalyticsReport> {
    let start_date = filter.start_date.trim();
    let end_date = filter.end_date.trim();
    if start_date.is_empty() || end_date.is_empty() {
        return Err(AppError::Validation(
            "Debe especificar fecha de inicio y fecha de fin para el reporte".into(),
        ));
    }

    let cashier_filter = filter.cashier_id.unwrap_or(0);
    let has_cashier = if filter.cashier_id.is_some() { 1 } else { 0 };
    let cat_str = filter
        .category_name
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_string();
    let has_category = if !cat_str.is_empty() { 1 } else { 0 };

    // 1. Totales del período actual y del período anterior
    let current_totals = query_period_totals(
        conn,
        start_date,
        end_date,
        filter.cashier_id,
        filter.category_name.as_deref(),
    )?;

    let prev_totals = match (
        filter.prev_start_date.as_deref(),
        filter.prev_end_date.as_deref(),
    ) {
        (Some(ps), Some(pe)) if !ps.trim().is_empty() && !pe.trim().is_empty() => {
            query_period_totals(
                conn,
                ps.trim(),
                pe.trim(),
                filter.cashier_id,
                filter.category_name.as_deref(),
            )
            .unwrap_or_default()
        }
        _ => PeriodTotals::default(),
    };

    // 2. Distribución Horaria (00..=23) en hora local
    let mut hourly_buckets: Vec<HourlySalesBucket> = (0..24)
        .map(|h| HourlySalesBucket {
            hour: h,
            label: format_hour_label(h),
            tickets_count: 0,
            total_cents: 0,
            profit_cents: 0,
            units_sold: 0.0,
        })
        .collect();

    {
        let mut h_stmt = conn.prepare(
            "SELECT
                CAST(strftime('%H', datetime(s.created_at, 'localtime')) AS INTEGER) as hr,
                COUNT(DISTINCT s.id) as tx_count,
                COALESCE(SUM(
                    CASE WHEN si.quantity > 0
                         THEN CAST(ROUND(si.total_cents * MAX(0.0, si.quantity - COALESCE(si.returned_quantity, 0.0)) / si.quantity) AS INTEGER)
                         ELSE 0 END
                ), 0) as net_cents,
                COALESCE(SUM(
                    (CASE WHEN si.quantity > 0
                          THEN CAST(ROUND(si.total_cents * MAX(0.0, si.quantity - COALESCE(si.returned_quantity, 0.0)) / si.quantity) AS INTEGER)
                          ELSE 0 END)
                    - CAST(ROUND(MAX(0.0, si.quantity - COALESCE(si.returned_quantity, 0.0)) * COALESCE(si.unit_cost_cents, 0)) AS INTEGER)
                ), 0) as prof_cents,
                COALESCE(SUM(MAX(0.0, si.quantity - COALESCE(si.returned_quantity, 0.0))), 0.0) as u_sold
             FROM sale_items si
             JOIN sales s ON s.id = si.sale_id
             LEFT JOIN products p ON p.id = si.product_id
             LEFT JOIN categories c ON c.id = p.category_id
             WHERE s.status = 'completed'
               AND date(s.created_at, 'localtime') >= date(?1)
               AND date(s.created_at, 'localtime') <= date(?2)
               AND (?3 = 0 OR s.user_id = ?4)
               AND (?5 = 0 OR COALESCE(c.name, 'Sin categoría') = ?6)
             GROUP BY hr
             ORDER BY hr ASC",
        )?;

        let rows = h_stmt.query_map(
            params![
                start_date,
                end_date,
                has_cashier,
                cashier_filter,
                has_category,
                cat_str
            ],
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, f64>(4)?,
                ))
            },
        )?;

        for row in rows {
            let (hr, tx_count, net_cents, prof_cents, u_sold) = row?;
            if (0..24).contains(&hr) {
                let idx = hr as usize;
                hourly_buckets[idx].tickets_count = tx_count;
                hourly_buckets[idx].total_cents = net_cents;
                hourly_buckets[idx].profit_cents = prof_cents;
                hourly_buckets[idx].units_sold = u_sold;
            }
        }
    }

    // Identificar Hora Pico (mayor total_cents; en empate, mayor tickets_count)
    let peak_bucket = hourly_buckets
        .iter()
        .filter(|b| b.total_cents > 0 || b.tickets_count > 0)
        .max_by(|a, b| {
            a.total_cents
                .cmp(&b.total_cents)
                .then_with(|| a.tickets_count.cmp(&b.tickets_count))
        });

    let (peak_hour, peak_hour_label, peak_hour_sales_cents, peak_hour_tickets_count) =
        if let Some(pk) = peak_bucket {
            (
                Some(pk.hour),
                format_peak_hour_range(pk.hour),
                pk.total_cents,
                pk.tickets_count,
            )
        } else {
            (None, "Sin ventas".to_string(), 0, 0)
        };

    // 3. Tendencia Diaria (evolución día por día en el rango)
    let mut daily_trend = Vec::new();
    {
        let mut d_stmt = conn.prepare(
            "SELECT
                date(s.created_at, 'localtime') as d_ymd,
                COUNT(DISTINCT s.id) as tx_count,
                COALESCE(SUM(
                    CASE WHEN si.quantity > 0
                         THEN CAST(ROUND(si.total_cents * MAX(0.0, si.quantity - COALESCE(si.returned_quantity, 0.0)) / si.quantity) AS INTEGER)
                         ELSE 0 END
                ), 0) as net_cents,
                COALESCE(SUM(
                    (CASE WHEN si.quantity > 0
                          THEN CAST(ROUND(si.total_cents * MAX(0.0, si.quantity - COALESCE(si.returned_quantity, 0.0)) / si.quantity) AS INTEGER)
                          ELSE 0 END)
                    - CAST(ROUND(MAX(0.0, si.quantity - COALESCE(si.returned_quantity, 0.0)) * COALESCE(si.unit_cost_cents, 0)) AS INTEGER)
                ), 0) as prof_cents,
                COALESCE(SUM(
                    si.total_cents - (CASE WHEN si.quantity > 0
                         THEN CAST(ROUND(si.total_cents * MAX(0.0, si.quantity - COALESCE(si.returned_quantity, 0.0)) / si.quantity) AS INTEGER)
                         ELSE 0 END)
                ), 0) as ret_cents
             FROM sale_items si
             JOIN sales s ON s.id = si.sale_id
             LEFT JOIN products p ON p.id = si.product_id
             LEFT JOIN categories c ON c.id = p.category_id
             WHERE s.status = 'completed'
               AND date(s.created_at, 'localtime') >= date(?1)
               AND date(s.created_at, 'localtime') <= date(?2)
               AND (?3 = 0 OR s.user_id = ?4)
               AND (?5 = 0 OR COALESCE(c.name, 'Sin categoría') = ?6)
             GROUP BY d_ymd
             ORDER BY d_ymd ASC",
        )?;

        let rows = d_stmt.query_map(
            params![
                start_date,
                end_date,
                has_cashier,
                cashier_filter,
                has_category,
                cat_str
            ],
            |r| {
                let d_ymd: String = r.get(0)?;
                Ok(DailySalesPoint {
                    label: format_short_date_label(&d_ymd),
                    date: d_ymd,
                    tickets_count: r.get(1)?,
                    total_cents: r.get(2)?,
                    profit_cents: r.get(3)?,
                    returns_cents: r.get(4)?,
                })
            },
        )?;

        for row in rows {
            daily_trend.push(row?);
        }
    }

    // 4. Top Productos Más Vendidos (hasta 30 para permitir ordenar en UI por unidades, ventas o utilidad)
    let mut top_products = Vec::new();
    {
        let mut p_stmt = conn.prepare(
            "SELECT
                si.product_id,
                p.sku,
                p.barcode,
                COALESCE(p.name, si.description) as prod_name,
                COALESCE(c.name, 'Sin categoría') as cat_name,
                COALESCE(p.unit, 'pza') as prod_unit,
                p.image_url,
                p.image_local_path,
                COALESCE(SUM(MAX(0.0, si.quantity - COALESCE(si.returned_quantity, 0.0))), 0.0) as u_sold,
                COALESCE(SUM(
                    CASE WHEN si.quantity > 0
                         THEN CAST(ROUND(si.total_cents * MAX(0.0, si.quantity - COALESCE(si.returned_quantity, 0.0)) / si.quantity) AS INTEGER)
                         ELSE 0 END
                ), 0) as rev_cents,
                COALESCE(SUM(
                    CAST(ROUND(MAX(0.0, si.quantity - COALESCE(si.returned_quantity, 0.0)) * COALESCE(si.unit_cost_cents, 0)) AS INTEGER)
                ), 0) as c_cents
             FROM sale_items si
             JOIN sales s ON s.id = si.sale_id
             LEFT JOIN products p ON p.id = si.product_id
             LEFT JOIN categories c ON c.id = p.category_id
             WHERE s.status = 'completed'
               AND date(s.created_at, 'localtime') >= date(?1)
               AND date(s.created_at, 'localtime') <= date(?2)
               AND (?3 = 0 OR s.user_id = ?4)
               AND (?5 = 0 OR COALESCE(c.name, 'Sin categoría') = ?6)
             GROUP BY COALESCE(CAST(si.product_id AS TEXT), si.description)
             HAVING u_sold > 0 OR rev_cents > 0
             ORDER BY rev_cents DESC, u_sold DESC
             LIMIT 35",
        )?;

        let rows = p_stmt.query_map(
            params![
                start_date,
                end_date,
                has_cashier,
                cashier_filter,
                has_category,
                cat_str
            ],
            |r| {
                let rev_cents: i64 = r.get(9)?;
                let c_cents: i64 = r.get(10)?;
                let prof_cents = rev_cents - c_cents;
                Ok(TopProductStat {
                    product_id: r.get(0)?,
                    sku: r.get(1)?,
                    barcode: r.get(2)?,
                    name: r.get(3)?,
                    category_name: r.get(4)?,
                    unit: r.get(5)?,
                    image_url: r.get(6)?,
                    image_local_path: r.get(7)?,
                    units_sold: r.get(8)?,
                    revenue_cents: rev_cents,
                    cost_cents: c_cents,
                    profit_cents: prof_cents,
                    margin_bp: calc_bp(prof_cents, rev_cents),
                    share_bp: calc_bp(rev_cents, current_totals.net_sales_cents),
                })
            },
        )?;

        for row in rows {
            top_products.push(row?);
        }
    }

    // 5. Categorías Más Vendidas
    let mut top_categories = Vec::new();
    {
        let mut c_stmt = conn.prepare(
            "SELECT
                COALESCE(c.name, 'Sin categoría') as cat_name,
                COALESCE(SUM(MAX(0.0, si.quantity - COALESCE(si.returned_quantity, 0.0))), 0.0) as u_sold,
                COUNT(DISTINCT s.id) as tx_count,
                COALESCE(SUM(
                    CASE WHEN si.quantity > 0
                         THEN CAST(ROUND(si.total_cents * MAX(0.0, si.quantity - COALESCE(si.returned_quantity, 0.0)) / si.quantity) AS INTEGER)
                         ELSE 0 END
                ), 0) as rev_cents,
                COALESCE(SUM(
                    (CASE WHEN si.quantity > 0
                          THEN CAST(ROUND(si.total_cents * MAX(0.0, si.quantity - COALESCE(si.returned_quantity, 0.0)) / si.quantity) AS INTEGER)
                          ELSE 0 END)
                    - CAST(ROUND(MAX(0.0, si.quantity - COALESCE(si.returned_quantity, 0.0)) * COALESCE(si.unit_cost_cents, 0)) AS INTEGER)
                ), 0) as prof_cents
             FROM sale_items si
             JOIN sales s ON s.id = si.sale_id
             LEFT JOIN products p ON p.id = si.product_id
             LEFT JOIN categories c ON c.id = p.category_id
             WHERE s.status = 'completed'
               AND date(s.created_at, 'localtime') >= date(?1)
               AND date(s.created_at, 'localtime') <= date(?2)
               AND (?3 = 0 OR s.user_id = ?4)
               AND (?5 = 0 OR COALESCE(c.name, 'Sin categoría') = ?6)
             GROUP BY cat_name
             HAVING rev_cents > 0 OR u_sold > 0
             ORDER BY rev_cents DESC",
        )?;

        let total_cat_rev: i64 = current_totals.net_sales_cents.max(1);
        let rows = c_stmt.query_map(
            params![
                start_date,
                end_date,
                has_cashier,
                cashier_filter,
                has_category,
                cat_str
            ],
            |r| {
                let rev_cents: i64 = r.get(3)?;
                Ok(CategorySalesStat {
                    category_name: r.get(0)?,
                    units_sold: r.get(1)?,
                    tickets_count: r.get(2)?,
                    revenue_cents: rev_cents,
                    profit_cents: r.get(4)?,
                    share_bp: calc_bp(rev_cents, total_cat_rev),
                })
            },
        )?;

        for row in rows {
            top_categories.push(row?);
        }
    }

    // 6. Desglose por Medios de Pago
    let mut payment_methods = Vec::new();
    {
        let mut pm_stmt = conn.prepare(
            "SELECT
                LOWER(COALESCE(p.method, 'other')) as m_code,
                MAX(pm.name) as pm_custom_name,
                COUNT(DISTINCT p.sale_id) as tx_count,
                COALESCE(SUM(p.amount_cents), 0) as sum_cents
             FROM payments p
             JOIN sales s ON s.id = p.sale_id
             LEFT JOIN payment_methods pm ON pm.id = p.payment_method_id OR pm.code = p.method
             WHERE s.status = 'completed'
               AND date(s.created_at, 'localtime') >= date(?1)
               AND date(s.created_at, 'localtime') <= date(?2)
               AND (?3 = 0 OR s.user_id = ?4)
             GROUP BY m_code
             HAVING sum_cents > 0
             ORDER BY sum_cents DESC",
        )?;

        let raw_payments: Vec<(String, Option<String>, i64, i64)> = pm_stmt
            .query_map(
                params![start_date, end_date, has_cashier, cashier_filter],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )?
            .collect::<Result<Vec<_>, _>>()?;

        let total_pay_cents: i64 = raw_payments.iter().map(|x| x.3).sum::<i64>().max(1);

        for (code, custom_name, tx_count, sum_cents) in raw_payments {
            payment_methods.push(PaymentMethodStat {
                method_name: format_payment_method_label(&code, custom_name),
                method_code: code,
                transactions_count: tx_count,
                total_cents: sum_cents,
                share_bp: calc_bp(sum_cents, total_pay_cents),
            });
        }
    }

    // 7. Rendimiento por Cajero
    let mut cashier_breakdown = Vec::new();
    {
        let mut u_stmt = conn.prepare(
            "SELECT
                s.user_id,
                COALESCE(u.full_name, 'Cajero Principal') as u_name,
                COUNT(s.id) as tx_count,
                COALESCE(SUM(s.total_cents - COALESCE(s.returned_cents, 0)), 0) as net_cents
             FROM sales s
             LEFT JOIN users u ON u.id = s.user_id
             WHERE s.status = 'completed'
               AND date(s.created_at, 'localtime') >= date(?1)
               AND date(s.created_at, 'localtime') <= date(?2)
               AND (?3 = 0 OR s.user_id = ?4)
             GROUP BY s.user_id, u_name
             ORDER BY net_cents DESC",
        )?;

        let raw_cashiers: Vec<(Option<i64>, String, i64, i64)> = u_stmt
            .query_map(
                params![start_date, end_date, has_cashier, cashier_filter],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )?
            .collect::<Result<Vec<_>, _>>()?;

        let total_cashier_cents: i64 = raw_cashiers.iter().map(|x| x.3).sum::<i64>().max(1);

        for (uid, uname, tx_count, net_cents) in raw_cashiers {
            let avg_cents = if tx_count > 0 {
                (net_cents + (tx_count / 2)) / tx_count
            } else {
                0
            };
            cashier_breakdown.push(CashierSalesStat {
                user_id: uid,
                cashier_name: uname,
                tickets_count: tx_count,
                net_sales_cents: net_cents,
                avg_ticket_cents: avg_cents,
                share_bp: calc_bp(net_cents, total_cashier_cents),
            });
        }
    }

    // Crecimiento vs período anterior en puntos base
    let net_sales_growth_bp = if prev_totals.net_sales_cents > 0 {
        calc_bp(
            current_totals.net_sales_cents - prev_totals.net_sales_cents,
            prev_totals.net_sales_cents,
        )
    } else if current_totals.net_sales_cents > 0 {
        10_000 // +100.0% si antes fue 0 y ahora hay ventas
    } else {
        0
    };

    let avg_ticket_cents = if current_totals.tickets_count > 0 {
        (current_totals.net_sales_cents + (current_totals.tickets_count / 2))
            / current_totals.tickets_count
    } else {
        0
    };

    let profit_margin_bp = calc_bp(current_totals.profit_cents, current_totals.net_sales_cents);

    let forecast = build_sales_forecast(
        conn,
        filter,
        has_cashier,
        cashier_filter,
        has_category,
        &cat_str,
        &current_totals,
        &prev_totals,
    )?;

    let kpis = SalesKpiSummary {
        gross_sales_cents: current_totals.gross_sales_cents,
        returns_cents: current_totals.returns_cents,
        net_sales_cents: current_totals.net_sales_cents,
        prev_net_sales_cents: prev_totals.net_sales_cents,
        net_sales_growth_bp,
        total_cost_cents: current_totals.total_cost_cents,
        estimated_profit_cents: current_totals.profit_cents,
        prev_profit_cents: prev_totals.profit_cents,
        profit_margin_bp,
        tickets_count: current_totals.tickets_count,
        prev_tickets_count: prev_totals.tickets_count,
        avg_ticket_cents,
        total_units_sold: current_totals.units_sold,
        returns_count: current_totals.returns_count,
        peak_hour,
        peak_hour_label,
        peak_hour_sales_cents,
        peak_hour_tickets_count,
    };

    Ok(SalesAnalyticsReport {
        start_date: start_date.to_string(),
        end_date: end_date.to_string(),
        kpis,
        forecast,
        hourly_distribution: hourly_buckets,
        daily_trend,
        top_products,
        top_categories,
        payment_methods,
        cashier_breakdown,
    })
}

#[tauri::command]
pub fn get_sales_analytics(
    db: State<'_, Db>,
    filter: SalesReportFilterInput,
) -> AppResult<SalesAnalyticsReport> {
    let conn = db.conn()?;
    build_sales_analytics(&conn, &filter)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::sales::create_sale_in_conn;
    use crate::models::sale::{CartItemInput, CreateSaleInput, PaymentInput};

    #[test]
    fn sales_analytics_computes_exact_kpis_peak_hour_and_categories() {
        let mut conn = Connection::open_in_memory().expect("in-memory db");
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        crate::db::migrations::run(&mut conn).expect("run migrations");
        conn.execute(
            "INSERT OR REPLACE INTO users (id, username, full_name, role, active) VALUES (1, 'cajero1', 'Cajero Prueba', 'cashier', 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO cash_sessions (id, folio, user_id, opening_cents, status, opened_at) VALUES (1, 'T-CAJA01-01', 1, 10000000, 'open', datetime('now'))",
            [],
        )
        .unwrap();

        // Crear categoría y productos con costo conocido
        conn.execute(
            "INSERT INTO categories (id, name, active) VALUES (10, 'Bebidas y Licores', 1), (20, 'Snacks', 1)",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO products (id, sku, barcode, name, category_id, price_cents, cost_cents, stock, controls_stock, active)
             VALUES (101, 'BEB-01', '7701001', 'Cerveza Aguila Sixpack', 10, 1800000, 1200000, 100, 1, 1),
                    (102, 'SNK-01', '7701002', 'Papas Margarita Grande', 20, 600000, 400000, 100, 1, 1)",
            [],
        )
        .unwrap();

        // Emitir una venta con 2 sixpacks ($36,000) y 1 papas ($6,000) -> Total $42,000 (4_200_000 centavos)
        // Costo total = 2 * $12,000 + 1 * $4,000 = $28,000 (2_800_000 centavos)
        // Ganancia esperada = $14,000 (1_400_000 centavos) -> Margen = 33.33% (3333 bp)
        let sale = create_sale_in_conn(
            &mut conn,
            CreateSaleInput {
                user_id: Some(1),
                customer_id: None,
                items: vec![
                    CartItemInput {
                        product_id: Some(101),
                        sku: None,
                        barcode: None,
                        description: "Cerveza Aguila Sixpack".into(),
                        quantity: 2.0,
                        unit_price_cents: 1_800_000,
                        tax_rate_bp: Some(0),
                        tax_fixed_cents: Some(0),
                        discount_cents: Some(0),
                    },
                    CartItemInput {
                        product_id: Some(102),
                        sku: None,
                        barcode: None,
                        description: "Papas Margarita Grande".into(),
                        quantity: 1.0,
                        unit_price_cents: 600_000,
                        tax_rate_bp: Some(0),
                        tax_fixed_cents: Some(0),
                        discount_cents: Some(0),
                    },
                ],
                payments: vec![PaymentInput {
                    method: "cash".into(),
                    amount_cents: 5_000_000, // Paga con $50,000, cambio $8,000
                    reference: None,
                }],
                client_tx_id: None,
            },
        )
        .expect("create sale");

        assert_eq!(sale.total_cents, 4_200_000);

        let today_local: String = conn
            .query_row("SELECT date('now', 'localtime')", [], |r| r.get(0))
            .unwrap();

        let report = build_sales_analytics(
            &conn,
            &SalesReportFilterInput {
                start_date: today_local.clone(),
                end_date: today_local.clone(),
                prev_start_date: None,
                prev_end_date: None,
                prev2_start_date: None,
                prev2_end_date: None,
                cashier_id: None,
                category_name: None,
            },
        )
        .expect("build analytics");

        assert_eq!(report.kpis.net_sales_cents, 4_200_000);
        assert_eq!(report.kpis.total_cost_cents, 2_800_000);
        assert_eq!(report.kpis.estimated_profit_cents, 1_400_000);
        assert_eq!(report.kpis.profit_margin_bp, 3333);
        assert_eq!(report.kpis.tickets_count, 1);
        assert_eq!(report.hourly_distribution.len(), 24);
        assert!(report.kpis.peak_hour.is_some());
        assert_eq!(report.top_products.len(), 2);
        assert_eq!(report.top_products[0].name, "Cerveza Aguila Sixpack");
        assert_eq!(report.top_products[0].revenue_cents, 3_600_000);
        assert_eq!(report.top_categories.len(), 2);
        assert_eq!(report.top_categories[0].category_name, "Bebidas y Licores");
        assert_eq!(report.payment_methods.len(), 1);
        assert_eq!(report.payment_methods[0].total_cents, 4_200_000); // Efectivo neto descontando vueltas

        // Proyección: sin historial previo, el nivel es el cierre estimado del período actual
        assert_eq!(report.forecast.series.len(), 4);
        assert!(report.forecast.series[3].is_projected);
        assert!(report.forecast.projected_sales_cents >= 4_200_000);
        assert!(report.forecast.conservative_sales_cents <= report.forecast.projected_sales_cents);
        assert!(report.forecast.optimistic_sales_cents >= report.forecast.projected_sales_cents);
        assert_eq!(report.forecast.confidence_label, "En aprendizaje");
    }

    #[test]
    fn forecast_weighted_level_and_trend_are_integer_exact() {
        // Nivel = (3·Vt + 2·Vt-1 + Vt-2) / 6 ; Tendencia acotada a ±25 % del nivel
        let vt: i64 = 1_200_000;
        let v1: i64 = 1_000_000;
        let v2: i64 = 800_000;
        let level = (3 * vt + 2 * v1 + v2 + 3) / 6;
        let trend = ((vt - v1) + (v1 - v2)) / 2;
        let cap = level / 4;
        let projected = level + trend.clamp(-cap, cap);
        assert_eq!(level, 1_066_667);
        assert_eq!(trend, 200_000);
        assert_eq!(projected, 1_266_667);
        assert_eq!(apply_bp(projected, 800), 101_333);
    }
}
