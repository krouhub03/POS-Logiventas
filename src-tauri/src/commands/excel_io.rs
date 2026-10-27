use std::collections::{HashMap, HashSet};
use std::io::{Cursor, Read, Write};

use base64::Engine;
use quick_xml::events::Event;
use quick_xml::reader::Reader;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::db::Db;
use crate::error::{AppError, AppResult};

// ─────────────────────────────────────────────────────────────────────────────
// DTOs de Importación / Exportación XLSX (Eleventa & Metahabi POS)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ParsedImportRowDto {
    pub row_number: usize,
    pub code: String,
    pub barcode: Option<String>,
    pub name: String,
    pub cost_cents: i64,
    pub price_cents: i64,
    pub wholesale_price_cents: i64,
    pub stock: f64,
    pub min_stock: f64,
    pub max_stock: f64,
    pub department: String,
    pub unit: String,
    pub tax_rate_bp: i64,
    /// 'new' | 'existing' | 'new_zero_stock' | 'invalid'
    pub status: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreviewDto {
    pub detected_format: String,
    pub total_rows: usize,
    pub valid_rows: usize,
    pub new_with_stock_count: usize,
    pub new_zero_stock_count: usize,
    pub existing_count: usize,
    pub invalid_count: usize,
    pub cost_warning_count: usize,
    pub new_departments: Vec<String>,
    pub sample_rows: Vec<ParsedImportRowDto>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportOptionsDto {
    /// Si es true, actualiza precios, nombre y departamento de productos cuyo código ya exista
    pub update_existing: bool,
    /// Si es true y `update_existing` está activo, actualiza también la existencia (stock) en POS y ERP
    pub overwrite_existing_stock: bool,
    /// Política para productos NUEVOS que vienen con Existencia = 0 en el Excel:
    /// - "local_only": Se guardan en el POS con stock 0 (y se suben al ERP automáticamente cuando reciban stock > 0)
    /// - "skip": Se omiten (no se importan)
    /// - "set_one": Se importan con stock inicial 1.0 para darlos de alta de inmediato en la bodega del ERP
    pub zero_stock_policy: String,
    pub user_id: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportExecutionResultDto {
    pub created_count: usize,
    pub updated_count: usize,
    pub skipped_count: usize,
    pub departments_created: usize,
    pub queued_for_erp_sync: usize,
    pub local_only_zero_stock: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportFileDto {
    pub file_name: String,
    pub base64_data: String,
    pub saved_path: Option<String>,
    pub total_exported: usize,
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades de Parseo Determinista (Moneda a Centavos i64 y Números)
// ─────────────────────────────────────────────────────────────────────────────

/// Convierte cualquier representación monetaria de Excel/Eleventa (ej. "$2,566.00", "2566", "$ 3.100,50")
/// a centavos enteros (`i64`) sin errores de redondeo de coma flotante.
pub fn parse_money_to_cents(raw: &str) -> i64 {
    let cleaned: String = raw
        .trim()
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.' || *c == ',' || *c == '-')
        .collect();

    if cleaned.is_empty() || cleaned == "-" {
        return 0;
    }

    let is_negative = cleaned.starts_with('-');
    let unsigned = cleaned.trim_start_matches('-');

    // Determinar cuál es el separador decimal si existen '.' o ','
    let last_dot = unsigned.rfind('.');
    let last_comma = unsigned.rfind(',');

    let normalized = match (last_dot, last_comma) {
        (Some(d), Some(c)) => {
            if d > c {
                // Formato "$2,566.00" -> ',' es miles, '.' es decimal
                unsigned.replace(',', "")
            } else {
                // Formato "$2.566,00" -> '.' es miles, ',' es decimal
                unsigned.replace('.', "").replace(',', ".")
            }
        }
        (None, Some(c)) => {
            let after_comma = &unsigned[c + 1..];
            // En Eleventa o español: si hay 1 o 2 dígitos tras una única coma, es decimal; si hay 3 (ej. "2,566"), es miles
            if unsigned.matches(',').count() == 1 && after_comma.len() <= 2 {
                unsigned.replace(',', ".")
            } else {
                unsigned.replace(',', "")
            }
        }
        (Some(_), None) => {
            // Si hay más de un punto (ej. "2.566.000"), son separadores de miles
            if unsigned.matches('.').count() > 1 {
                unsigned.replace('.', "")
            } else {
                unsigned.to_string()
            }
        }
        (None, None) => unsigned.to_string(),
    };

    let mut parts = normalized.splitn(2, '.');
    let int_part_str = parts.next().unwrap_or("0");
    let frac_part_str = parts.next().unwrap_or("");

    let major: i64 = int_part_str.parse::<i64>().unwrap_or(0);

    let frac_digits: Vec<u32> = frac_part_str
        .chars()
        .filter_map(|ch| ch.to_digit(10))
        .collect();

    let cents: i64 = match frac_digits.len() {
        0 => 0,
        1 => (frac_digits[0] as i64) * 10,
        2 => (frac_digits[0] as i64) * 10 + (frac_digits[1] as i64),
        _ => {
            let base = (frac_digits[0] as i64) * 10 + (frac_digits[1] as i64);
            if frac_digits[2] >= 5 {
                base + 1
            } else {
                base
            }
        }
    };

    let total = major.saturating_mul(100).saturating_add(cents);
    if is_negative {
        0 // Los precios y costos en el POS nunca pueden ser negativos
    } else {
        total
    }
}

/// Parsea una cantidad (`Existencia`, `Inv. Mínimo`, `Inv. Máximo`) desde texto o número de Excel.
pub fn parse_quantity_f64(raw: &str) -> f64 {
    let cleaned: String = raw
        .trim()
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.' || *c == ',' || *c == '-')
        .collect();

    if cleaned.is_empty() || cleaned == "-" {
        return 0.0;
    }

    let last_dot = cleaned.rfind('.');
    let last_comma = cleaned.rfind(',');
    let normalized = match (last_dot, last_comma) {
        (Some(d), Some(c)) => {
            if d > c {
                cleaned.replace(',', "")
            } else {
                cleaned.replace('.', "").replace(',', ".")
            }
        }
        (None, Some(c)) => {
            let after = &cleaned[c + 1..];
            if cleaned.matches(',').count() == 1 && after.len() <= 2 {
                cleaned.replace(',', ".")
            } else {
                cleaned.replace(',', "")
            }
        }
        _ => cleaned,
    };

    normalized.parse::<f64>().unwrap_or(0.0)
}

/// Normaliza el nombre del Departamento de Eleventa:
/// Convierte "- Sin Departamento -", "- Sin Departam...", "Sin Departamento", "" a "General".
pub fn normalize_department_name(raw: &str) -> String {
    let trimmed = raw.trim().trim_matches('-').trim();
    let lower = trimmed.to_lowercase();
    if trimmed.is_empty()
        || lower.starts_with("sin departam")
        || lower == "sin categoria"
        || lower == "sin categoría"
        || lower == "ninguno"
        || lower == "n/a"
    {
        "General".to_string()
    } else {
        raw.trim().to_string()
    }
}

/// Normaliza un encabezado para comparación insensible a tildes, signos de puntuación y mayúsculas.
fn normalize_header_key(s: &str) -> String {
    s.trim()
        .to_lowercase()
        .replace('á', "a")
        .replace('é', "e")
        .replace('í', "i")
        .replace('ó', "o")
        .replace('ú', "u")
        .replace('ü', "u")
        .replace('.', "")
        .replace('_', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

// ─────────────────────────────────────────────────────────────────────────────
// Lector Nativo de Archivos .XLSX (OpenXML) y .CSV en Rust
// ─────────────────────────────────────────────────────────────────────────────

/// Convierte la referencia de celda de Excel (ej. "A1", "C15", "AA2") en índice de columna base 0.
fn excel_col_ref_to_index(cell_ref: &str) -> Option<usize> {
    let letters: String = cell_ref
        .chars()
        .take_while(|c| c.is_ascii_alphabetic())
        .collect();
    if letters.is_empty() {
        return None;
    }
    let mut col: usize = 0;
    for ch in letters.chars() {
        let val = (ch.to_ascii_uppercase() as usize)
            .saturating_sub('A' as usize)
            .saturating_add(1);
        col = col.saturating_mul(26).saturating_add(val);
    }
    Some(col.saturating_sub(1))
}

/// Extrae `xl/sharedStrings.xml` de un archivo `.xlsx`.
fn read_shared_strings<R: Read + std::io::Seek>(archive: &mut ZipArchive<R>) -> Vec<String> {
    let Ok(mut file) = archive.by_name("xl/sharedStrings.xml") else {
        return Vec::new();
    };
    let mut xml_content = String::new();
    if file.read_to_string(&mut xml_content).is_err() {
        return Vec::new();
    }

    let mut reader = Reader::from_str(&xml_content);
    let mut strings = Vec::new();
    let mut in_si = false;
    let mut in_t = false;
    let mut current_si = String::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => match e.name().as_ref() {
                "si" => {
                    in_si = true;
                    current_si.clear();
                }
                "t" if in_si => {
                    in_t = true;
                }
                _ => {}
            },
            Ok(Event::End(e)) => match e.name().as_ref() {
                "si" => {
                    in_si = false;
                    strings.push(current_si.clone());
                }
                "t" => {
                    in_t = false;
                }
                _ => {}
            },
            Ok(Event::Text(e)) if in_si && in_t => {
                if let Ok(txt) = quick_xml::escape::unescape(e.as_ref()) {
                    current_si.push_str(&txt);
                } else {
                    current_si.push_str(e.as_ref());
                }
            }
            Ok(Event::CData(e)) if in_si && in_t => {
                current_si.push_str(e.as_ref());
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }

    strings
}

/// Extrae todas las filas de la primera hoja de trabajo de un `.xlsx` o `.csv`.
pub fn extract_spreadsheet_rows(file_bytes: &[u8]) -> AppResult<Vec<Vec<String>>> {
    if file_bytes.len() < 4 {
        return Err(AppError::Validation("El archivo seleccionado está vacío o es inválido.".into()));
    }

    // Si no comienza con la firma ZIP ('PK\x03\x04'), intentar parsear como CSV/TSV
    if &file_bytes[0..2] != b"PK" {
        return parse_csv_fallback(file_bytes);
    }

    let cursor = Cursor::new(file_bytes);
    let mut archive = ZipArchive::new(cursor).map_err(|e| {
        AppError::Validation(format!(
            "No se pudo abrir el archivo Excel (.xlsx). Verifique que sea un archivo .xlsx válido ({e})."
        ))
    })?;

    let shared_strings = read_shared_strings(&mut archive);

    // Localizar la primera hoja disponible (usualmente xl/worksheets/sheet1.xml)
    let sheet_name = if archive.by_name("xl/worksheets/sheet1.xml").is_ok() {
        "xl/worksheets/sheet1.xml".to_string()
    } else {
        let mut found = None;
        for i in 0..archive.len() {
            if let Ok(f) = archive.by_index(i) {
                let name = f.name().to_string();
                if name.starts_with("xl/worksheets/sheet") && name.ends_with(".xml") {
                    found = Some(name);
                    break;
                }
            }
        }
        found.ok_or_else(|| {
            AppError::Validation("El archivo .xlsx no contiene ninguna hoja de cálculo válida.".into())
        })?
    };

    let mut sheet_xml = String::new();
    {
        let mut sheet_file = archive.by_name(&sheet_name).map_err(|e| {
            AppError::Validation(format!("Error al leer la hoja de Excel: {e}"))
        })?;
        sheet_file.read_to_string(&mut sheet_xml).map_err(|e| {
            AppError::Validation(format!("Error al decodificar contenido XML de la hoja: {e}"))
        })?;
    }

    let mut reader = Reader::from_str(&sheet_xml);
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut current_row: Vec<String> = Vec::new();
    let mut in_row = false;
    let mut in_cell = false;
    let mut in_v = false;
    let mut in_inline_t = false;
    let mut current_col_idx: usize = 0;
    let mut cell_type = String::new();
    let mut cell_value = String::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => match e.name().as_ref() {
                "row" => {
                    in_row = true;
                    current_row.clear();
                    current_col_idx = 0;
                }
                "c" if in_row => {
                    in_cell = true;
                    cell_type.clear();
                    cell_value.clear();
                    for attr in e.attributes().flatten() {
                        match attr.key.as_ref() {
                            "r" => {
                                let r_str = attr.value.as_ref();
                                if let Some(idx) = excel_col_ref_to_index(r_str) {
                                    current_col_idx = idx;
                                }
                            }
                            "t" => {
                                cell_type = attr.value.as_ref().to_string();
                            }
                            _ => {}
                        }
                    }
                }
                "v" if in_cell => {
                    in_v = true;
                }
                "t" if in_cell => {
                    in_inline_t = true;
                }
                _ => {}
            },
            Ok(Event::End(e)) => match e.name().as_ref() {
                "c" if in_row => {
                    in_cell = false;
                    let resolved = if cell_type == "s" {
                        if let Ok(ss_idx) = cell_value.trim().parse::<usize>() {
                            shared_strings.get(ss_idx).cloned().unwrap_or_default()
                        } else {
                            cell_value.clone()
                        }
                    } else {
                        cell_value.clone()
                    };

                    if current_row.len() <= current_col_idx {
                        current_row.resize(current_col_idx + 1, String::new());
                    }
                    current_row[current_col_idx] = resolved;
                    current_col_idx += 1;
                }
                "v" => {
                    in_v = false;
                }
                "t" => {
                    in_inline_t = false;
                }
                "row" if in_row => {
                    in_row = false;
                    if current_row.iter().any(|c| !c.trim().is_empty()) {
                        rows.push(current_row.clone());
                    }
                }
                _ => {}
            },
            Ok(Event::Text(e)) if in_cell && (in_v || in_inline_t) => {
                if let Ok(txt) = quick_xml::escape::unescape(e.as_ref()) {
                    cell_value.push_str(&txt);
                } else {
                    cell_value.push_str(e.as_ref());
                }
            }
            Ok(Event::CData(e)) if in_cell && (in_v || in_inline_t) => {
                cell_value.push_str(e.as_ref());
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }

    Ok(rows)
}

/// Fallback automático si el usuario sube un archivo CSV (separado por `,` o `;` o tabulador).
fn parse_csv_fallback(bytes: &[u8]) -> AppResult<Vec<Vec<String>>> {
    let text = match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => bytes.iter().map(|&b| b as char).collect(),
    };

    let mut rows = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let delimiter = if trimmed.contains('\t') {
            '\t'
        } else if trimmed.matches(';').count() > trimmed.matches(',').count() {
            ';'
        } else {
            ','
        };
        let cols: Vec<String> = trimmed
            .split(delimiter)
            .map(|c| c.trim().trim_matches('"').to_string())
            .collect();
        if cols.iter().any(|c| !c.is_empty()) {
            rows.push(cols);
        }
    }
    Ok(rows)
}

// ─────────────────────────────────────────────────────────────────────────────
// Detector de Columnas Eleventa / Metahabi y Analizador de Filas
// ─────────────────────────────────────────────────────────────────────────────

struct ColumnMapping {
    header_row_index: usize,
    detected_format: String,
    col_code: usize,
    col_barcode: Option<usize>,
    col_name: usize,
    col_cost: Option<usize>,
    col_price: usize,
    col_wholesale: Option<usize>,
    col_stock: Option<usize>,
    col_min_stock: Option<usize>,
    col_max_stock: Option<usize>,
    col_department: Option<usize>,
    col_unit: Option<usize>,
    col_tax_rate: Option<usize>,
}

fn detect_column_mapping(rows: &[Vec<String>]) -> AppResult<ColumnMapping> {
    // Buscar en las primeras 15 filas la fila que contenga los encabezados (ej. "Código" y "Producto")
    for (r_idx, row) in rows.iter().take(15).enumerate() {
        let norm_cols: Vec<String> = row.iter().map(|c| normalize_header_key(c)).collect();

        let mut col_code = None;
        let mut col_barcode = None;
        let mut col_name = None;
        let mut col_cost = None;
        let mut col_price = None;
        let mut col_wholesale = None;
        let mut col_stock = None;
        let mut col_min_stock = None;
        let mut col_max_stock = None;
        let mut col_department = None;
        let mut col_unit = None;
        let mut col_tax_rate = None;

        for (c_idx, h) in norm_cols.iter().enumerate() {
            match h.as_str() {
                "codigo" | "sku" | "cod" | "id" | "clave" if col_code.is_none() => {
                    col_code = Some(c_idx);
                }
                "codigo de barras" | "barras" | "barcode" | "ean" => {
                    col_barcode = Some(c_idx);
                }
                "producto" | "nombre" | "descripcion" | "articulo" | "item" if col_name.is_none() => {
                    col_name = Some(c_idx);
                }
                "p costo" | "pcosto" | "precio costo" | "costo" | "costo unitario" => {
                    col_cost = Some(c_idx);
                }
                "p venta" | "pventa" | "precio venta" | "venta" | "precio" | "pvp" => {
                    col_price = Some(c_idx);
                }
                "p mayoreo" | "pmayoreo" | "precio mayoreo" | "mayoreo" | "mayorista" => {
                    col_wholesale = Some(c_idx);
                }
                "existencia" | "existencias" | "stock" | "cantidad" | "inventario" => {
                    col_stock = Some(c_idx);
                }
                "inv minimo" | "inv min" | "minimo" | "stock minimo" | "min stock" => {
                    col_min_stock = Some(c_idx);
                }
                "inv maximo" | "inv max" | "maximo" | "stock maximo" | "max stock" => {
                    col_max_stock = Some(c_idx);
                }
                "departamento" | "categoria" | "familia" | "grupo" | "linea" => {
                    col_department = Some(c_idx);
                }
                "unidad" | "unidad de medida" | "umed" | "unit" => {
                    col_unit = Some(c_idx);
                }
                "iva" | "iva %" | "iva (%)" | "impuesto" | "tarifa iva" => {
                    col_tax_rate = Some(c_idx);
                }
                _ => {}
            }
        }

        // Si encontramos al menos Código y Producto (y Precio de Venta), es la fila de encabezados
        if let (Some(c_code), Some(c_name)) = (col_code, col_name) {
            let c_price = col_price.unwrap_or(3);
            let is_eleventa = col_wholesale.is_some() || norm_cols.iter().any(|h| h == "p costo" || h == "departamento");
            return Ok(ColumnMapping {
                header_row_index: r_idx,
                detected_format: if is_eleventa {
                    "Eleventa POS (9 Columnas)".to_string()
                } else {
                    "Catálogo Excel Estándar".to_string()
                },
                col_code: c_code,
                col_barcode,
                col_name: c_name,
                col_cost,
                col_price: c_price,
                col_wholesale,
                col_stock,
                col_min_stock,
                col_max_stock,
                col_department,
                col_unit,
                col_tax_rate,
            });
        }
    }

    // Si no se encontró encabezado explícito pero tiene >= 4 columnas, asumir orden estándar Eleventa (A..I)
    if let Some(first) = rows.first() {
        if first.len() >= 4 {
            return Ok(ColumnMapping {
                header_row_index: 0,
                detected_format: "Eleventa POS (Posicional A-I)".to_string(),
                col_code: 0,
                col_barcode: None,
                col_name: 1,
                col_cost: Some(2),
                col_price: 3,
                col_wholesale: if first.len() > 4 { Some(4) } else { None },
                col_stock: if first.len() > 5 { Some(5) } else { None },
                col_min_stock: if first.len() > 6 { Some(6) } else { None },
                col_max_stock: if first.len() > 7 { Some(7) } else { None },
                col_department: if first.len() > 8 { Some(8) } else { None },
                col_unit: None,
                col_tax_rate: None,
            });
        }
    }

    Err(AppError::Validation(
        "No se reconocieron las columnas del archivo. Asegúrese de que incluya al menos 'Código', 'Producto' y 'P. Venta'.".into(),
    ))
}

/// Parsea las filas del archivo y las cruza contra la base de datos SQLite actual sin modificarla.
fn analyze_import_rows(
    conn: &rusqlite::Connection,
    rows: &[Vec<String>],
) -> AppResult<(ColumnMapping, Vec<ParsedImportRowDto>, Vec<String>)> {
    if rows.is_empty() {
        return Err(AppError::Validation("El archivo Excel no contiene filas de datos.".into()));
    }

    let mapping = detect_column_mapping(rows)?;

    // Cargar SKUs, códigos de barras y categorías existentes en SQLite para comparación rápida en O(1)
    let mut existing_codes = HashSet::<String>::new();
    {
        let mut stmt = conn.prepare("SELECT sku, barcode FROM products")?;
        let db_rows = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
        })?;
        for r in db_rows.flatten() {
            existing_codes.insert(r.0.trim().to_lowercase());
            if let Some(bc) = r.1 {
                if !bc.trim().is_empty() {
                    existing_codes.insert(bc.trim().to_lowercase());
                }
            }
        }
    }

    let mut existing_categories = HashSet::<String>::new();
    {
        let mut stmt = conn.prepare("SELECT name FROM categories")?;
        let cat_rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        for c in cat_rows.flatten() {
            existing_categories.insert(c.trim().to_lowercase());
        }
    }

    let mut parsed_rows = Vec::new();
    let mut new_departments_set = HashSet::<String>::new();
    let mut new_departments_list = Vec::<String>::new();
    let mut seen_codes_in_file = HashSet::<String>::new();

    for (idx, row) in rows.iter().enumerate().skip(mapping.header_row_index + 1) {
        let get_col = |c_opt: Option<usize>| -> &str {
            c_opt
                .and_then(|c| row.get(c))
                .map(|s| s.as_str())
                .unwrap_or("")
        };

        let raw_code = row.get(mapping.col_code).map(|s| s.trim()).unwrap_or("");
        let raw_name = row.get(mapping.col_name).map(|s| s.trim()).unwrap_or("");

        // Ignorar filas completamente en blanco
        if raw_code.is_empty() && raw_name.is_empty() {
            continue;
        }

        // Si el código viene en notación decimal de Excel (ej. "770209006966.0"), limpiarlo
        let clean_code = if let Some(stripped) = raw_code.strip_suffix(".0") {
            stripped.trim().to_string()
        } else {
            raw_code.to_string()
        };

        let explicit_barcode = mapping
            .col_barcode
            .and_then(|c| row.get(c))
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| {
                if let Some(stripped) = s.strip_suffix(".0") {
                    stripped.to_string()
                } else {
                    s.to_string()
                }
            });

        // En Eleventa, la columna "Código" es a la vez el SKU y el Código de Barras
        let barcode = explicit_barcode.or_else(|| {
            if !clean_code.is_empty() {
                Some(clean_code.clone())
            } else {
                None
            }
        });

        let cost_cents = parse_money_to_cents(get_col(mapping.col_cost));
        let price_cents = parse_money_to_cents(row.get(mapping.col_price).map(|s| s.as_str()).unwrap_or("0"));
        let wholesale_price_cents = parse_money_to_cents(get_col(mapping.col_wholesale));
        let stock = parse_quantity_f64(get_col(mapping.col_stock)).max(0.0);
        let min_stock = parse_quantity_f64(get_col(mapping.col_min_stock)).max(0.0);
        let max_stock = parse_quantity_f64(get_col(mapping.col_max_stock)).max(0.0);
        let department = normalize_department_name(get_col(mapping.col_department));

        let unit_raw = get_col(mapping.col_unit).trim();
        let unit = if unit_raw.is_empty() {
            "pza".to_string()
        } else {
            unit_raw.to_string()
        };

        let tax_rate_pct = parse_quantity_f64(get_col(mapping.col_tax_rate)).clamp(0.0, 100.0);
        let tax_rate_bp = (tax_rate_pct * 100.0).round() as i64;

        let mut warnings = Vec::new();
        let mut status = "new".to_string();

        if clean_code.is_empty() || raw_name.is_empty() {
            status = "invalid".to_string();
            warnings.push("Falta Código o Nombre del producto".to_string());
        } else {
            let code_key = clean_code.to_lowercase();
            if !seen_codes_in_file.insert(code_key.clone()) {
                warnings.push("Código duplicado dentro del mismo archivo Excel".to_string());
            }

            let exists_in_db = existing_codes.contains(&code_key)
                || barcode
                    .as_ref()
                    .map(|b| existing_codes.contains(&b.to_lowercase()))
                    .unwrap_or(false);

            if exists_in_db {
                status = "existing".to_string();
            } else if stock <= 0.0 {
                status = "new_zero_stock".to_string();
                warnings.push("Existencia en 0.00 (El ERP requiere stock > 0 para alta en bodega)".to_string());
            }

            if cost_cents > 0 && price_cents < cost_cents {
                warnings.push(format!(
                    "P. Venta (${:.2}) es menor que P. Costo (${:.2})",
                    price_cents as f64 / 100.0,
                    cost_cents as f64 / 100.0
                ));
            }

            if department != "General"
                && !existing_categories.contains(&department.to_lowercase())
                && new_departments_set.insert(department.to_lowercase())
            {
                new_departments_list.push(department.clone());
            }
        }

        parsed_rows.push(ParsedImportRowDto {
            row_number: idx + 1,
            code: clean_code,
            barcode,
            name: raw_name.to_string(),
            cost_cents,
            price_cents,
            wholesale_price_cents,
            stock,
            min_stock,
            max_stock,
            department,
            unit,
            tax_rate_bp,
            status,
            warnings,
        });
    }

    new_departments_list.sort();
    Ok((mapping, parsed_rows, new_departments_list))
}

// ─────────────────────────────────────────────────────────────────────────────
// Comandos Tauri: Previsualización, Ejecución de Importación y Exportación XLSX
// ─────────────────────────────────────────────────────────────────────────────

/// 1️⃣ Previsualiza un archivo `.xlsx` (Eleventa o Metahabi) sin alterar la base de datos.
#[tauri::command]
pub fn preview_products_xlsx(
    db: State<'_, Db>,
    file_base64: String,
) -> AppResult<ImportPreviewDto> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(file_base64.trim())
        .map_err(|e| AppError::Validation(format!("Archivo base64 inválido: {e}")))?;

    let raw_rows = extract_spreadsheet_rows(&bytes)?;
    let conn = db.conn()?;
    let (mapping, parsed_rows, new_departments) = analyze_import_rows(&conn, &raw_rows)?;

    let total_rows = parsed_rows.len();
    let new_with_stock_count = parsed_rows.iter().filter(|r| r.status == "new").count();
    let new_zero_stock_count = parsed_rows
        .iter()
        .filter(|r| r.status == "new_zero_stock")
        .count();
    let existing_count = parsed_rows.iter().filter(|r| r.status == "existing").count();
    let invalid_count = parsed_rows.iter().filter(|r| r.status == "invalid").count();
    let valid_rows = total_rows.saturating_sub(invalid_count);
    let cost_warning_count = parsed_rows
        .iter()
        .filter(|r| r.cost_cents > 0 && r.price_cents < r.cost_cents)
        .count();

    let sample_rows = parsed_rows.into_iter().take(150).collect();

    Ok(ImportPreviewDto {
        detected_format: mapping.detected_format,
        total_rows,
        valid_rows,
        new_with_stock_count,
        new_zero_stock_count,
        existing_count,
        invalid_count,
        cost_warning_count,
        new_departments,
        sample_rows,
    })
}

/// 2️⃣ Ejecuta la importación transaccional en SQLite y prepara la cola de sincronización con el ERP.
#[tauri::command]
pub fn execute_products_xlsx_import(
    db: State<'_, Db>,
    file_base64: String,
    options: ImportOptionsDto,
) -> AppResult<ImportExecutionResultDto> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(file_base64.trim())
        .map_err(|e| AppError::Validation(format!("Archivo base64 inválido: {e}")))?;

    let raw_rows = extract_spreadsheet_rows(&bytes)?;
    let mut conn = db.conn()?;
    let (_, parsed_rows, new_departments) = analyze_import_rows(&conn, &raw_rows)?;

    let tx = conn.transaction()?;

    // 1. Crear departamentos nuevos en `categories`
    let mut departments_created = 0usize;
    for dept in &new_departments {
        let clean_dept = dept.trim();
        if !clean_dept.is_empty() && clean_dept != "General" {
            let affected = tx.execute(
                "INSERT INTO categories (name, active) VALUES (?1, 1) ON CONFLICT(name) DO UPDATE SET active = 1",
                params![clean_dept],
            )?;
            if affected > 0 {
                departments_created += 1;
            }
        }
    }

    // Mapa en memoria de nombre de categoría (lowercase) -> id
    let mut category_map = HashMap::<String, i64>::new();
    {
        let mut stmt = tx.prepare("SELECT id, name FROM categories")?;
        let cat_rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
        for r in cat_rows.flatten() {
            category_map.insert(r.1.trim().to_lowercase(), r.0);
        }
    }

    let mut created_count = 0usize;
    let mut updated_count = 0usize;
    let mut skipped_count = 0usize;
    let mut queued_for_erp_sync = 0usize;
    let mut local_only_zero_stock = 0usize;

    for row in parsed_rows {
        if row.status == "invalid" || row.code.is_empty() || row.name.is_empty() {
            skipped_count += 1;
            continue;
        }

        let category_id: Option<i64> = if row.department == "General" {
            None
        } else {
            category_map.get(&row.department.to_lowercase()).copied()
        };

        // Buscar coincidencia existente por SKU o código de barras
        let existing_match: Option<(i64, f64, Option<String>)> = tx
            .query_row(
                "SELECT id, stock, erp_id FROM products WHERE LOWER(sku) = LOWER(?1) OR (barcode IS NOT NULL AND LOWER(barcode) = LOWER(?1)) LIMIT 1",
                params![row.code],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .ok();

        if let Some((product_id, current_stock, _erp_id)) = existing_match {
            if !options.update_existing {
                skipped_count += 1;
                continue;
            }

            let final_stock = if options.overwrite_existing_stock {
                row.stock.max(0.0)
            } else {
                current_stock
            };

            // Liberar barcode si pertenecía a otro producto inactivo distinto
            if let Some(ref bc) = row.barcode {
                let _ = tx.execute(
                    "UPDATE products SET barcode = NULL WHERE barcode = ?1 AND active = 0 AND id != ?2",
                    params![bc, product_id],
                );
            }

            // Si el producto aún no existe en el ERP y su stock sigue en 0, mantener needs_erp_upload = 0
            // para evitar bucle infinito contra la validación del ERP; si ya tiene erp_id o stock > 0, subir al ERP.
            let should_upload_to_erp = if _erp_id.is_some() || final_stock > 0.0 {
                queued_for_erp_sync += 1;
                1_i64
            } else {
                local_only_zero_stock += 1;
                0_i64
            };

            tx.execute(
                "UPDATE products SET
                    name = ?1,
                    category_id = COALESCE(?2, category_id),
                    cost_cents = ?3,
                    price_cents = ?4,
                    wholesale_price_cents = ?5,
                    stock = ?6,
                    min_stock = ?7,
                    max_stock = ?8,
                    unit = ?9,
                    active = 1,
                    needs_erp_upload = ?10,
                    updated_at = datetime('now')
                 WHERE id = ?11",
                params![
                    row.name,
                    category_id,
                    row.cost_cents,
                    row.price_cents,
                    row.wholesale_price_cents,
                    final_stock,
                    row.min_stock,
                    row.max_stock,
                    row.unit,
                    should_upload_to_erp,
                    product_id,
                ],
            )?;

            if options.overwrite_existing_stock {
                let diff = final_stock - current_stock;
                if diff.abs() > 1e-6 {
                    tx.execute(
                        "INSERT INTO inventory_movements (product_id, kind, quantity, reference, user_id)
                         VALUES (?1, 'adjustment', ?2, 'Actualización de stock por importación XLSX', ?3)",
                        params![product_id, diff, options.user_id],
                    )?;
                }
            }

            updated_count += 1;
        } else {
            // Producto Nuevo
            let (initial_stock, needs_erp_upload) = if row.stock > 0.0 {
                (row.stock, 1_i64)
            } else {
                match options.zero_stock_policy.as_str() {
                    "skip" => {
                        skipped_count += 1;
                        continue;
                    }
                    "set_one" => (1.0, 1_i64),
                    _ => {
                        // "local_only": Se guarda en SQLite con stock 0 y needs_erp_upload = 0
                        // Cuando se le ingrese stock > 0 en el POS, subirá automáticamente al ERP
                        (0.0, 0_i64)
                    }
                }
            };

            // Verificar que el código de barras no colisione con otro producto activo
            let mut safe_barcode = row.barcode.clone();
            if let Some(ref bc) = safe_barcode {
                let _ = tx.execute(
                    "UPDATE products SET barcode = NULL WHERE barcode = ?1 AND active = 0",
                    params![bc],
                );
                let taken: bool = tx
                    .query_row(
                        "SELECT 1 FROM products WHERE barcode = ?1",
                        params![bc],
                        |_| Ok(true),
                    )
                    .unwrap_or(false);
                if taken {
                    safe_barcode = None;
                }
            }

            tx.execute(
                "INSERT INTO products (
                    sku, barcode, name, category_id, unit,
                    price_cents, wholesale_price_cents, cost_cents, tax_rate_bp,
                    stock, min_stock, max_stock,
                    is_service, active, needs_erp_upload, controls_stock, allow_negative_stock, is_bundle
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 0, 1, ?13, 1, 0, 0)",
                params![
                    row.code,
                    safe_barcode,
                    row.name,
                    category_id,
                    row.unit,
                    row.price_cents,
                    row.wholesale_price_cents,
                    row.cost_cents,
                    row.tax_rate_bp,
                    initial_stock,
                    row.min_stock,
                    row.max_stock,
                    needs_erp_upload,
                ],
            )?;

            let new_id = tx.last_insert_rowid();

            if initial_stock > 0.0 {
                tx.execute(
                    "INSERT INTO inventory_movements (product_id, kind, quantity, reference, user_id)
                     VALUES (?1, 'adjustment', ?2, 'Inventario inicial XLSX Eleventa', ?3)",
                    params![new_id, initial_stock, options.user_id],
                )?;
                queued_for_erp_sync += 1;
            } else {
                local_only_zero_stock += 1;
            }

            created_count += 1;
        }
    }

    tx.commit()?;

    Ok(ImportExecutionResultDto {
        created_count,
        updated_count,
        skipped_count,
        departments_created,
        queued_for_erp_sync,
        local_only_zero_stock,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Generador Nativo de Archivos .XLSX (OpenXML con Estilos y Formato Moneda)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub enum XlsxCell {
    Text(String),
    CurrencyCents(i64),
    Number(f64),
    Integer(i64),
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn col_index_to_excel_letters(mut col: usize) -> String {
    let mut letters = Vec::new();
    loop {
        let rem = col % 26;
        letters.push((b'A' + rem as u8) as char);
        if col < 26 {
            break;
        }
        col = (col / 26) - 1;
    }
    letters.iter().rev().collect()
}

/// Construye un archivo `.xlsx` válido en memoria con encabezados estilizados y formato moneda `$#,##0.00`.
pub fn generate_xlsx_workbook(
    sheet_title: &str,
    headers: &[(&str, f64)],
    rows: &[Vec<XlsxCell>],
) -> AppResult<Vec<u8>> {
    let mut buf = Cursor::new(Vec::new());
    {
        let mut zip = ZipWriter::new(&mut buf);
        let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

        // 1. [Content_Types].xml
        zip.start_file("[Content_Types].xml", opts).map_err(|e| AppError::Validation(e.to_string()))?;
        zip.write_all(
            br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>"#,
        )?;

        // 2. _rels/.rels
        zip.start_file("_rels/.rels", opts).map_err(|e| AppError::Validation(e.to_string()))?;
        zip.write_all(
            br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"#,
        )?;

        // 3. xl/workbook.xml
        zip.start_file("xl/workbook.xml", opts).map_err(|e| AppError::Validation(e.to_string()))?;
        let wb_xml = format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="{}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>"#,
            xml_escape(sheet_title)
        );
        zip.write_all(wb_xml.as_bytes())?;

        // 4. xl/_rels/workbook.xml.rels
        zip.start_file("xl/_rels/workbook.xml.rels", opts).map_err(|e| AppError::Validation(e.to_string()))?;
        zip.write_all(
            br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>"#,
        )?;

        // 5. xl/styles.xml
        // s="0": Default | s="1": Header Bold | s="2": Currency "$#,##0.00" | s="3": Float "0.00" | s="4": Integer "0"
        zip.start_file("xl/styles.xml", opts).map_err(|e| AppError::Validation(e.to_string()))?;
        zip.write_all(
            br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/>
    <numFmt numFmtId="165" formatCode="0.00"/>
  </numFmts>
  <fonts count="2">
    <font><sz val="10"/><name val="Calibri"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E293B"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="5">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
  </cellXfs>
</styleSheet>"#,
        )?;

        // 6. xl/worksheets/sheet1.xml
        zip.start_file("xl/worksheets/sheet1.xml", opts).map_err(|e| AppError::Validation(e.to_string()))?;
        let mut sheet = String::with_capacity(64 * 1024);
        sheet.push_str(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>"#,
        );
        for (idx, (_, width)) in headers.iter().enumerate() {
            let col_num = idx + 1;
            sheet.push_str(&format!(
                r#"<col min="{col_num}" max="{col_num}" width="{width:.1}" customWidth="1"/>"#
            ));
        }
        sheet.push_str("</cols><sheetData>");

        // Fila 1: Encabezados
        sheet.push_str(r#"<row r="1" ht="22" customHeight="1">"#);
        for (c_idx, (title, _)) in headers.iter().enumerate() {
            let col_ref = format!("{}1", col_index_to_excel_letters(c_idx));
            sheet.push_str(&format!(
                r#"<c r="{col_ref}" s="1" t="inlineStr"><is><t>{}</t></is></c>"#,
                xml_escape(title)
            ));
        }
        sheet.push_str("</row>");

        // Filas de datos
        for (r_idx, row_cells) in rows.iter().enumerate() {
            let row_num = r_idx + 2;
            sheet.push_str(&format!(r#"<row r="{row_num}">"#));
            for (c_idx, cell) in row_cells.iter().enumerate() {
                let col_ref = format!("{}{row_num}", col_index_to_excel_letters(c_idx));
                match cell {
                    XlsxCell::Text(txt) => {
                        sheet.push_str(&format!(
                            r#"<c r="{col_ref}" t="inlineStr"><is><t>{}</t></is></c>"#,
                            xml_escape(txt)
                        ));
                    }
                    XlsxCell::CurrencyCents(cents) => {
                        let major = *cents as f64 / 100.0;
                        sheet.push_str(&format!(r#"<c r="{col_ref}" s="2"><v>{major:.2}</v></c>"#));
                    }
                    XlsxCell::Number(val) => {
                        sheet.push_str(&format!(r#"<c r="{col_ref}" s="3"><v>{val:.2}</v></c>"#));
                    }
                    XlsxCell::Integer(val) => {
                        sheet.push_str(&format!(r#"<c r="{col_ref}" s="4"><v>{val}</v></c>"#));
                    }
                }
            }
            sheet.push_str("</row>");
        }

        sheet.push_str("</sheetData></worksheet>");
        zip.write_all(sheet.as_bytes())?;
        zip.finish().map_err(|e| AppError::Validation(e.to_string()))?;
    }

    Ok(buf.into_inner())
}

/// 3️⃣ Exporta el catálogo de productos en formato `.xlsx` (Formato Eleventa 9 columnas, Metahabi Completo o Plantilla).
#[tauri::command]
pub fn export_products_xlsx(
    db: State<'_, Db>,
    format: String,
    category_filter: Option<String>,
) -> AppResult<ExportFileDto> {
    let conn = db.conn()?;

    if format == "template" {
        let headers = [
            ("Código", 18.0),
            ("Producto", 34.0),
            ("P. Costo", 14.0),
            ("P. Venta", 14.0),
            ("P. Mayoreo", 14.0),
            ("Existencia", 13.0),
            ("Inv. Mínimo", 13.0),
            ("Inv. Máximo", 13.0),
            ("Departamento", 22.0),
        ];
        let sample_rows = vec![
            vec![
                XlsxCell::Text("770209006966".into()),
                XlsxCell::Text("GASEOSA TROPIKOLA 400ML".into()),
                XlsxCell::CurrencyCents(256600),
                XlsxCell::CurrencyCents(310000),
                XlsxCell::CurrencyCents(290000),
                XlsxCell::Number(12.0),
                XlsxCell::Integer(4),
                XlsxCell::Integer(24),
                XlsxCell::Text("Gaseosas".into()),
            ],
            vec![
                XlsxCell::Text("770200708115".into()),
                XlsxCell::Text("CHOCOLATINA JET MORA 30G".into()),
                XlsxCell::CurrencyCents(310300),
                XlsxCell::CurrencyCents(380000),
                XlsxCell::CurrencyCents(0),
                XlsxCell::Number(7.0),
                XlsxCell::Integer(2),
                XlsxCell::Integer(20),
                XlsxCell::Text("Chocolates Nacionales".into()),
            ],
        ];
        let bytes = generate_xlsx_workbook("Plantilla Inventario", &headers, &sample_rows)?;
        let file_name = "Plantilla_Importacion_Productos_Eleventa.xlsx".to_string();
        let saved_path = try_save_to_downloads(&file_name, &bytes);
        return Ok(ExportFileDto {
            file_name,
            base64_data: base64::engine::general_purpose::STANDARD.encode(&bytes),
            saved_path,
            total_exported: sample_rows.len(),
        });
    }

    let mut stmt = conn.prepare(
        "SELECT p.sku, p.barcode, p.name, p.cost_cents, p.price_cents, p.wholesale_price_cents,
                p.stock, p.min_stock, p.max_stock, COALESCE(c.name, '- Sin Departamento -'),
                p.unit, p.tax_rate_bp, p.tax_fixed_cents, p.is_service, p.is_bundle, p.erp_id
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.active = 1
         ORDER BY p.name ASC",
    )?;

    struct ExportProdRow {
        sku: String,
        barcode: Option<String>,
        name: String,
        cost_cents: i64,
        price_cents: i64,
        wholesale_price_cents: i64,
        stock: f64,
        min_stock: f64,
        max_stock: f64,
        department: String,
        unit: String,
        tax_rate_bp: i64,
        tax_fixed_cents: i64,
        is_service: bool,
        is_bundle: bool,
        synced_erp: bool,
    }

    let db_rows = stmt.query_map([], |r| {
        Ok(ExportProdRow {
            sku: r.get(0)?,
            barcode: r.get(1)?,
            name: r.get(2)?,
            cost_cents: r.get(3)?,
            price_cents: r.get(4)?,
            wholesale_price_cents: r.get(5)?,
            stock: r.get(6)?,
            min_stock: r.get(7)?,
            max_stock: r.get(8)?,
            department: r.get(9)?,
            unit: r.get(10)?,
            tax_rate_bp: r.get(11)?,
            tax_fixed_cents: r.get(12)?,
            is_service: r.get::<_, i64>(13)? != 0,
            is_bundle: r.get::<_, i64>(14)? != 0,
            synced_erp: r.get::<_, Option<String>>(15)?.is_some(),
        })
    })?;

    let filter_dept = category_filter
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != "Todas");

    let mut filtered = Vec::new();
    for item in db_rows.flatten() {
        if let Some(dept_f) = filter_dept {
            if !item.department.eq_ignore_ascii_case(dept_f) {
                continue;
            }
        }
        filtered.push(item);
    }

    let total_exported = filtered.len();

    let (headers, sheet_rows, file_name) = if format == "metahabi" {
        let h = vec![
            ("Código", 18.0),
            ("Código de Barras", 18.0),
            ("Producto", 34.0),
            ("P. Costo", 14.0),
            ("P. Venta", 14.0),
            ("P. Mayoreo", 14.0),
            ("Existencia", 13.0),
            ("Inv. Mínimo", 13.0),
            ("Inv. Máximo", 13.0),
            ("Departamento", 22.0),
            ("Unidad", 10.0),
            ("IVA (%)", 10.0),
            ("Impoconsumo", 14.0),
            ("Tipo", 12.0),
            ("Sincronizado ERP", 16.0),
        ];
        let rows_vec: Vec<Vec<XlsxCell>> = filtered
            .into_iter()
            .map(|p| {
                let tipo = if p.is_bundle {
                    "Combo"
                } else if p.is_service {
                    "Servicio"
                } else {
                    "Físico"
                };
                vec![
                    XlsxCell::Text(p.sku.clone()),
                    XlsxCell::Text(p.barcode.unwrap_or_else(|| p.sku)),
                    XlsxCell::Text(p.name),
                    XlsxCell::CurrencyCents(p.cost_cents),
                    XlsxCell::CurrencyCents(p.price_cents),
                    XlsxCell::CurrencyCents(p.wholesale_price_cents),
                    XlsxCell::Number(p.stock),
                    XlsxCell::Integer(p.min_stock.round() as i64),
                    XlsxCell::Integer(p.max_stock.round() as i64),
                    XlsxCell::Text(p.department),
                    XlsxCell::Text(p.unit),
                    XlsxCell::Number(p.tax_rate_bp as f64 / 100.0),
                    XlsxCell::CurrencyCents(p.tax_fixed_cents),
                    XlsxCell::Text(tipo.into()),
                    XlsxCell::Text(if p.synced_erp { "Sí".into() } else { "Pendiente".into() }),
                ]
            })
            .collect();
        (h, rows_vec, "Catalogo_Metahabi_POS.xlsx".to_string())
    } else {
        // Formato Eleventa (9 columnas exactas)
        let h = vec![
            ("Código", 18.0),
            ("Producto", 34.0),
            ("P. Costo", 14.0),
            ("P. Venta", 14.0),
            ("P. Mayoreo", 14.0),
            ("Existencia", 13.0),
            ("Inv. Mínimo", 13.0),
            ("Inv. Máximo", 13.0),
            ("Departamento", 22.0),
        ];
        let rows_vec: Vec<Vec<XlsxCell>> = filtered
            .into_iter()
            .map(|p| {
                let code = p.barcode.filter(|b| !b.is_empty()).unwrap_or(p.sku);
                vec![
                    XlsxCell::Text(code),
                    XlsxCell::Text(p.name),
                    XlsxCell::CurrencyCents(p.cost_cents),
                    XlsxCell::CurrencyCents(p.price_cents),
                    XlsxCell::CurrencyCents(p.wholesale_price_cents),
                    XlsxCell::Number(p.stock),
                    XlsxCell::Integer(p.min_stock.round() as i64),
                    XlsxCell::Integer(p.max_stock.round() as i64),
                    XlsxCell::Text(p.department),
                ]
            })
            .collect();
        (h, rows_vec, "Reporte de inventario.xlsx".to_string())
    };

    let bytes = generate_xlsx_workbook("Inventario", &headers, &sheet_rows)?;
    let saved_path = try_save_to_downloads(&file_name, &bytes);

    Ok(ExportFileDto {
        file_name,
        base64_data: base64::engine::general_purpose::STANDARD.encode(&bytes),
        saved_path,
        total_exported,
    })
}

/// Intenta guardar una copia directa en la carpeta `Downloads` del usuario en Windows/Linux/macOS.
fn try_save_to_downloads(file_name: &str, bytes: &[u8]) -> Option<String> {
    let user_profile = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()?;
    let downloads_dir = std::path::Path::new(&user_profile).join("Downloads");
    if !downloads_dir.exists() {
        return None;
    }
    let full_path = downloads_dir.join(file_name);
    if std::fs::write(&full_path, bytes).is_ok() {
        Some(full_path.to_string_lossy().to_string())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_eleventa_money_to_cents() {
        assert_eq!(parse_money_to_cents("$2,566.00"), 256600);
        assert_eq!(parse_money_to_cents("$3,100.00"), 310000);
        assert_eq!(parse_money_to_cents("$0.00"), 0);
        assert_eq!(parse_money_to_cents("2566"), 256600);
        assert_eq!(parse_money_to_cents("2566.5"), 256650);
        assert_eq!(parse_money_to_cents("$ 6.993,00"), 699300);
    }

    #[test]
    fn test_normalize_department() {
        assert_eq!(normalize_department_name("- Sin Departamento -"), "General");
        assert_eq!(normalize_department_name("- Sin Departam"), "General");
        assert_eq!(normalize_department_name("Gaseosas"), "Gaseosas");
    }

    #[test]
    fn test_xlsx_roundtrip_eleventa() {
        let headers = [
            ("Código", 18.0),
            ("Producto", 30.0),
            ("P. Costo", 14.0),
            ("P. Venta", 14.0),
            ("P. Mayoreo", 14.0),
            ("Existencia", 12.0),
            ("Inv. Mínimo", 12.0),
            ("Inv. Máximo", 12.0),
            ("Departamento", 20.0),
        ];
        let rows = vec![vec![
            XlsxCell::Text("770209006966".into()),
            XlsxCell::Text("TROPIKOLA M".into()),
            XlsxCell::CurrencyCents(256600),
            XlsxCell::CurrencyCents(310000),
            XlsxCell::CurrencyCents(0),
            XlsxCell::Number(7.0),
            XlsxCell::Integer(0),
            XlsxCell::Integer(10),
            XlsxCell::Text("Gaseosas".into()),
        ]];
        let bytes = generate_xlsx_workbook("Inventario", &headers, &rows).unwrap();
        let parsed = extract_spreadsheet_rows(&bytes).unwrap();
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0][0], "Código");
        assert_eq!(parsed[1][0], "770209006966");
        assert_eq!(parsed[1][1], "TROPIKOLA M");
        assert_eq!(parse_money_to_cents(&parsed[1][2]), 256600);
        assert_eq!(parse_money_to_cents(&parsed[1][3]), 310000);
        assert_eq!(parse_quantity_f64(&parsed[1][5]), 7.0);
        assert_eq!(parsed[1][8], "Gaseosas");
    }

    #[test]
    fn test_generate_and_analyze_eleventa_sample_file() {
        let headers = [
            ("Código", 18.0),
            ("Producto", 34.0),
            ("P. Costo", 14.0),
            ("P. Venta", 14.0),
            ("P. Mayoreo", 14.0),
            ("Existencia", 13.0),
            ("Inv. Mínimo", 13.0),
            ("Inv. Máximo", 13.0),
            ("Departamento", 24.0),
        ];

        // Filas basadas directamente en el Reporte de Inventario real de Eleventa
        let rows = vec![
            vec![
                XlsxCell::Text("770209006966".into()),
                XlsxCell::Text(" TROPIKOLA M".into()),
                XlsxCell::Text("$2,566.00".into()),
                XlsxCell::Text("$3,100.00".into()),
                XlsxCell::Text("$0.00".into()),
                XlsxCell::Number(0.00),
                XlsxCell::Integer(0),
                XlsxCell::Integer(0),
                XlsxCell::Text("Gaseosas".into()),
            ],
            vec![
                XlsxCell::Text("770200708115".into()),
                XlsxCell::Text(".JET MORA 30G".into()),
                XlsxCell::Text("$3,103.00".into()),
                XlsxCell::Text("$3,800.00".into()),
                XlsxCell::Text("$0.00".into()),
                XlsxCell::Number(7.00),
                XlsxCell::Integer(0),
                XlsxCell::Integer(0),
                XlsxCell::Text("Chocolates Nacionales".into()),
            ],
            vec![
                XlsxCell::Text("2".into()),
                XlsxCell::Text("PRODUCTO GENERAL PRUEBA".into()),
                XlsxCell::Text("$0.00".into()),
                XlsxCell::Text("$2,000.00".into()),
                XlsxCell::Text("$1,800.00".into()),
                XlsxCell::Number(2.00),
                XlsxCell::Integer(2),
                XlsxCell::Integer(10),
                XlsxCell::Text("- Sin Departamento -".into()),
            ],
            vec![
                XlsxCell::Text("770736112004".into()),
                XlsxCell::Text("3 CORDILLERAS BLANCA 330ML".into()),
                XlsxCell::Text("$3,750.00".into()),
                XlsxCell::Text("$4,500.00".into()),
                XlsxCell::Text("$0.00".into()),
                XlsxCell::Number(0.00),
                XlsxCell::Integer(0),
                XlsxCell::Integer(0),
                XlsxCell::Text("Cervezas Nacionales".into()),
            ],
            vec![
                XlsxCell::Text("770736112002".into()),
                XlsxCell::Text("3 CORDILLERAS MESTIZA 330ML".into()),
                XlsxCell::Text("$3,750.00".into()),
                XlsxCell::Text("$4,500.00".into()),
                XlsxCell::Text("$0.00".into()),
                XlsxCell::Number(1.00),
                XlsxCell::Integer(0),
                XlsxCell::Integer(0),
                XlsxCell::Text("Cervezas Nacionales".into()),
            ],
            vec![
                XlsxCell::Text("770736112003".into()),
                XlsxCell::Text("3 CORDILLERAS MULATA 330ML".into()),
                XlsxCell::Text("$3,750.00".into()),
                XlsxCell::Text("$4,500.00".into()),
                XlsxCell::Text("$0.00".into()),
                XlsxCell::Number(6.00),
                XlsxCell::Integer(0),
                XlsxCell::Integer(0),
                XlsxCell::Text("Cervezas Nacionales".into()),
            ],
            vec![
                XlsxCell::Text("770213785784".into()),
                XlsxCell::Text("3D BICARBONATO DETERGENTE".into()),
                XlsxCell::Text("$6,993.00".into()),
                XlsxCell::Text("$8,350.00".into()),
                XlsxCell::Text("$0.00".into()),
                XlsxCell::Number(1.00),
                XlsxCell::Integer(0),
                XlsxCell::Integer(0),
                XlsxCell::Text("Aseo Hogar".into()),
            ],
        ];

        let bytes = generate_xlsx_workbook("Inventario", &headers, &rows).unwrap();

        // Guardar archivo .xlsx de prueba en la raíz del proyecto POS para pruebas manuales en UI
        let sample_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("Reporte_de_inventario_Eleventa_Prueba.xlsx");
        let _ = std::fs::write(&sample_path, &bytes);

        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::migrations::run(&mut conn).unwrap();

        let raw_rows = extract_spreadsheet_rows(&bytes).unwrap();
        let (mapping, parsed, new_depts) = analyze_import_rows(&conn, &raw_rows).unwrap();

        assert_eq!(mapping.detected_format, "Eleventa POS (9 Columnas)");
        assert_eq!(parsed.len(), 7);
        assert_eq!(
            new_depts,
            vec![
                "Aseo Hogar".to_string(),
                "Cervezas Nacionales".to_string(),
                "Chocolates Nacionales".to_string(),
                "Gaseosas".to_string()
            ]
        );
        // Verificar fila 1 (TROPIKOLA con stock 0)
        assert_eq!(parsed[0].name, "TROPIKOLA M");
        assert_eq!(parsed[0].cost_cents, 256600);
        assert_eq!(parsed[0].price_cents, 310000);
        assert_eq!(parsed[0].status, "new_zero_stock");

        // Verificar fila 2 (JET MORA con stock 7)
        assert_eq!(parsed[1].name, ".JET MORA 30G");
        assert_eq!(parsed[1].cost_cents, 310300);
        assert_eq!(parsed[1].price_cents, 380000);
        assert_eq!(parsed[1].stock, 7.0);
        assert_eq!(parsed[1].status, "new");

        // Verificar fila 3 (- Sin Departamento - normalizado a General)
        assert_eq!(parsed[2].department, "General");
    }
}
