use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tauri::State;
use crate::db::Db;
use crate::error::AppResult;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemPrinter {
    pub name: String,
    pub port: Option<String>,
    pub driver: Option<String>,
    pub is_default: bool,
    pub is_likely_pos: bool,
}

/// Identifica si el nombre, puerto o driver corresponden a una impresora de tickets térmicos
fn is_thermal_pos_printer(name: &str, port: Option<&str>, driver: Option<&str>) -> bool {
    let combined = format!(
        "{} {} {}",
        name,
        port.unwrap_or(""),
        driver.unwrap_or("")
    )
    .to_lowercase();

    // Palabras clave comunes de fabricantes y modelos térmicos POS
    combined.contains("pos")
        || combined.contains("thermal")
        || combined.contains("receipt")
        || combined.contains("ticket")
        || combined.contains("58")
        || combined.contains("80")
        || combined.contains("epson")
        || combined.contains("sat")
        || combined.contains("bixolon")
        || combined.contains("xprinter")
        || combined.contains("star")
        || combined.contains("citizen")
        || combined.contains("rongta")
        || combined.contains("gprinter")
        || combined.contains("zijiang")
        || combined.contains("rp58")
        || combined.contains("rp80")
        || combined.contains("tm-t")
        || combined.contains("generic / text")
}

#[cfg(windows)]
pub fn list_system_printers_windows() -> Vec<SystemPrinter> {
    use windows_registry::{CURRENT_USER, LOCAL_MACHINE};

    let mut printers = Vec::new();
    let mut seen_names = HashSet::new();

    // 1. Obtener la impresora predeterminada de Windows desde HKCU
    let default_printer = CURRENT_USER
        .open("Software\\Microsoft\\Windows NT\\CurrentVersion\\Windows")
        .and_then(|k| k.get_string("Device"))
        .ok()
        .and_then(|s| s.split(',').next().map(|p| p.trim().to_string()));

    // 2. Enumerar impresoras disponibles para el usuario en HKCU
    if let Ok(dev_key) = CURRENT_USER.open("Software\\Microsoft\\Windows NT\\CurrentVersion\\Devices") {
        if let Ok(values) = dev_key.values() {
            for (printer_name, value) in values {
                let port_str: Option<String> = value.try_into().ok();
                let port = port_str.as_deref().and_then(|s| s.split(',').nth(1)).map(|p| p.trim().to_string());

                let is_default = default_printer.as_deref() == Some(&printer_name);
                let is_likely = is_thermal_pos_printer(&printer_name, port.as_deref(), None);

                seen_names.insert(printer_name.to_lowercase());
                printers.push(SystemPrinter {
                    name: printer_name,
                    port,
                    driver: None,
                    is_default,
                    is_likely_pos: is_likely,
                });
            }
        }
    }

    // 3. Complementar con impresoras registradas en HKLM (drivers y puertos de sistema)
    if let Ok(printers_key) = LOCAL_MACHINE.open("SYSTEM\\CurrentControlSet\\Control\\Print\\Printers") {
        if let Ok(subkeys) = printers_key.keys() {
            for subkey_name in subkeys {
                let clean_name = if let Some(pos) = subkey_name.find(':') {
                    subkey_name[pos + 1..].trim().to_string()
                } else {
                    subkey_name.clone()
                };

                let port = printers_key
                    .open(&subkey_name)
                    .and_then(|k| k.get_string("Port"))
                    .ok();
                let driver = printers_key
                    .open(&subkey_name)
                    .and_then(|k| k.get_string("Printer Driver"))
                    .ok();

                if let Some(existing) = printers.iter_mut().find(|p| p.name.eq_ignore_ascii_case(&clean_name)) {
                    if existing.port.is_none() {
                        existing.port = port;
                    }
                    if existing.driver.is_none() {
                        existing.driver = driver;
                    }
                    if !existing.is_likely_pos {
                        existing.is_likely_pos = is_thermal_pos_printer(&clean_name, existing.port.as_deref(), existing.driver.as_deref());
                    }
                } else if !seen_names.contains(&clean_name.to_lowercase()) {
                    let is_default = default_printer.as_deref() == Some(&clean_name);
                    let is_likely = is_thermal_pos_printer(&clean_name, port.as_deref(), driver.as_deref());
                    seen_names.insert(clean_name.to_lowercase());
                    printers.push(SystemPrinter {
                        name: clean_name,
                        port,
                        driver,
                        is_default,
                        is_likely_pos: is_likely,
                    });
                }
            }
        }
    }

    // Ordenar: primero térmicas/POS detectadas, luego la predeterminada, luego alfabético
    printers.sort_by(|a, b| {
        b.is_likely_pos.cmp(&a.is_likely_pos)
            .then_with(|| b.is_default.cmp(&a.is_default))
            .then_with(|| a.name.cmp(&b.name))
    });

    printers
}

#[cfg(not(windows))]
pub fn list_system_printers_windows() -> Vec<SystemPrinter> {
    Vec::new()
}

/// Comando Tauri para enumerar las impresoras disponibles en el sistema operativo
#[tauri::command]
pub fn list_system_printers() -> AppResult<Vec<SystemPrinter>> {
    Ok(list_system_printers_windows())
}

#[cfg(windows)]
#[repr(C)]
struct DocInfo1W {
    p_doc_name: *const u16,
    p_output_file: *const u16,
    p_datatype: *const u16,
}

#[cfg(windows)]
#[link(name = "winspool")]
unsafe extern "system" {
    fn OpenPrinterW(
        p_printer_name: *const u16,
        ph_printer: *mut *mut core::ffi::c_void,
        p_default: *const core::ffi::c_void,
    ) -> i32;

    fn StartDocPrinterW(
        h_printer: *mut core::ffi::c_void,
        level: u32,
        p_doc_info: *const DocInfo1W,
    ) -> u32;

    fn StartPagePrinter(h_printer: *mut core::ffi::c_void) -> i32;

    fn WritePrinter(
        h_printer: *mut core::ffi::c_void,
        p_buf: *const core::ffi::c_void,
        cb_buf: u32,
        pc_written: *mut u32,
    ) -> i32;

    fn EndPagePrinter(h_printer: *mut core::ffi::c_void) -> i32;
    fn EndDocPrinter(h_printer: *mut core::ffi::c_void) -> i32;
    fn ClosePrinter(h_printer: *mut core::ffi::c_void) -> i32;
}

/// Envía datos crudos (RAW / ESC/POS) a una impresora de Windows a través del Spooler nativo
#[cfg(windows)]
pub fn send_raw_to_printer_spooler(printer_name: &str, raw_data: &[u8], doc_title: &str) -> Result<(), String> {
    let wide_name: Vec<u16> = printer_name.encode_utf16().chain(std::iter::once(0)).collect();
    let wide_doc: Vec<u16> = doc_title.encode_utf16().chain(std::iter::once(0)).collect();
    let wide_raw: Vec<u16> = "RAW\0".encode_utf16().collect();

    let mut h_printer: *mut core::ffi::c_void = std::ptr::null_mut();

    unsafe {
        let open_res = OpenPrinterW(wide_name.as_ptr(), &mut h_printer, std::ptr::null());
        if open_res == 0 || h_printer.is_null() {
            return Err(format!("No se pudo abrir la impresora '{}'. Verifica que esté encendida y conectada.", printer_name));
        }

        let doc_info = DocInfo1W {
            p_doc_name: wide_doc.as_ptr(),
            p_output_file: std::ptr::null(),
            p_datatype: wide_raw.as_ptr(),
        };

        let job_id = StartDocPrinterW(h_printer, 1, &doc_info);
        if job_id == 0 {
            ClosePrinter(h_printer);
            return Err(format!("Error al iniciar trabajo de impresión en '{}'. Spooler ocupado o error de controlador.", printer_name));
        }

        StartPagePrinter(h_printer);

        let mut written: u32 = 0;
        let write_res = WritePrinter(
            h_printer,
            raw_data.as_ptr() as *const core::ffi::c_void,
            raw_data.len() as u32,
            &mut written,
        );

        EndPagePrinter(h_printer);
        EndDocPrinter(h_printer);
        ClosePrinter(h_printer);

        if write_res == 0 || written != raw_data.len() as u32 {
            return Err(format!("No se pudieron transmitir todos los bytes a '{}'.", printer_name));
        }

        Ok(())
    }
}

#[cfg(not(windows))]
pub fn send_raw_to_printer_spooler(_printer_name: &str, _raw_data: &[u8], _doc_title: &str) -> Result<(), String> {
    Ok(())
}

/// Envía un ticket de prueba formateado en ESC/POS con corte de papel y pulso de cajón si está configurado
#[tauri::command]
pub fn test_print_ticket(db: State<'_, Db>) -> AppResult<String> {
    let conn = db.conn()?;

    let printer_target: String = conn
        .query_row("SELECT value FROM settings WHERE key = 'printer_target'", [], |r| r.get(0))
        .unwrap_or_else(|_| "POS-58".into());

    let paper_width: String = conn
        .query_row("SELECT value FROM settings WHERE key = 'printer_paper_width'", [], |r| r.get(0))
        .unwrap_or_else(|_| "58mm".into());

    let auto_cut = conn
        .query_row("SELECT value FROM settings WHERE key = 'printer_auto_cut'", [], |r| r.get::<_, String>(0))
        .map(|v| v == "true")
        .unwrap_or(true);

    let drawer_on_print = conn
        .query_row("SELECT value FROM settings WHERE key = 'drawer_open_on_print'", [], |r| r.get::<_, String>(0))
        .map(|v| v == "true")
        .unwrap_or(false);

    let drawer_enabled = conn
        .query_row("SELECT value FROM settings WHERE key = 'drawer_enabled'", [], |r| r.get::<_, String>(0))
        .map(|v| v == "true")
        .unwrap_or(true);

    let header_text: String = conn
        .query_row("SELECT value FROM settings WHERE key = 'printer_header_text'", [], |r| r.get(0))
        .unwrap_or_else(|_| "CIGARRERÍA MEGALIDER\nNIT: 901.234.567-1".into());

    let footer_text: String = conn
        .query_row("SELECT value FROM settings WHERE key = 'printer_footer_text'", [], |r| r.get(0))
        .unwrap_or_else(|_| "¡Gracias por su compra!\nConserve su ticket.".into());

    let col_width = if paper_width.contains("80") { 48 } else { 32 };
    let separator = "-".repeat(col_width);

    // Construcción del payload binario ESC/POS
    let mut payload = Vec::new();

    // 1. Inicializar impresora (ESC @)
    payload.extend_from_slice(b"\x1B\x40");

    // 2. Si el cajón está configurado para abrir al imprimir, enviar pulso eléctrico RJ11
    if drawer_enabled && drawer_on_print {
        // Pulso Pin 2 y Pin 5 (ESC p 0 25 250)
        payload.extend_from_slice(b"\x1B\x70\x00\x19\xFA");
        payload.extend_from_slice(b"\x1B\x70\x01\x19\xFA");
    }

    // 3. Encabezado centrado con doble altura/anchura (ESC a 1, ESC ! 16)
    payload.extend_from_slice(b"\x1B\x61\x01"); // Centrado
    payload.extend_from_slice(b"\x1B\x21\x10"); // Doble altura
    payload.extend_from_slice(b"*** TICKET DE PRUEBA ***\n");
    payload.extend_from_slice(b"\x1B\x21\x00"); // Normal

    for line in header_text.split('\n') {
        let clean = line.trim();
        if !clean.is_empty() {
            payload.extend_from_slice(clean.as_bytes());
            payload.push(b'\n');
        }
    }

    // 4. Cuerpo de prueba alineado a la izquierda
    payload.extend_from_slice(b"\x1B\x61\x00"); // Izquierda
    payload.extend_from_slice(separator.as_bytes());
    payload.push(b'\n');

    let now_str = chrono_or_fallback_time();
    payload.extend_from_slice(format!("Fecha: {}\n", now_str).as_bytes());
    payload.extend_from_slice(format!("Impresora: {}\n", printer_target).as_bytes());
    payload.extend_from_slice(format!("Ancho papel: {} ({} col)\n", paper_width, col_width).as_bytes());
    payload.extend_from_slice(format!("Corte automatico: {}\n", if auto_cut { "SI" } else { "NO" }).as_bytes());
    payload.extend_from_slice(format!("Apertura de cajon: {}\n", if drawer_enabled && drawer_on_print { "SI (Pulso RJ11)" } else { "NO" }).as_bytes());

    payload.extend_from_slice(separator.as_bytes());
    payload.push(b'\n');
    payload.extend_from_slice(b"1x  PRODUCTO DEMO        $10.000\n");
    payload.extend_from_slice(b"    SUBTOTAL:            $10.000\n");
    payload.extend_from_slice(b"    TOTAL VENTA:         $10.000\n");
    payload.extend_from_slice(separator.as_bytes());
    payload.push(b'\n');

    // 5. Pie de página centrado
    payload.extend_from_slice(b"\x1B\x61\x01"); // Centrado
    for line in footer_text.split('\n') {
        let clean = line.trim();
        if !clean.is_empty() {
            payload.extend_from_slice(clean.as_bytes());
            payload.push(b'\n');
        }
    }
    payload.extend_from_slice(b"\x1B\x61\x00"); // Restaurar izquierda

    // 6. Avance de papel para salida (Feed 5 líneas)
    payload.extend_from_slice(b"\n\n\n\n\n");

    // 7. Corte de papel (GS V A 0)
    if auto_cut {
        payload.extend_from_slice(b"\x1D\x56\x41\x00");
    }

    // Enviar al spooler nativo de Windows
    #[cfg(windows)]
    {
        send_raw_to_printer_spooler(&printer_target, &payload, "Prueba Impresion Logiventa POS")
            .map_err(|e| crate::error::AppError::Validation(e))?;
    }

    let drawer_msg = if drawer_enabled && drawer_on_print { " con pulso de cajón" } else { "" };
    Ok(format!("Ticket de prueba enviado con éxito a '{}' ({}){}", printer_target, paper_width, drawer_msg))
}

/// Envía el pulso directo de apertura de gaveta (RJ11 ESC/POS) a la impresora configurada
#[tauri::command]
pub fn test_open_drawer(db: State<'_, Db>) -> AppResult<String> {
    let conn = db.conn()?;

    let printer_target: String = conn
        .query_row("SELECT value FROM settings WHERE key = 'printer_target'", [], |r| r.get(0))
        .unwrap_or_else(|_| "POS-58".into());

    // Comando estándar ESC/POS para apertura de cajón (Pin 2 y Pin 5)
    let pulse_bytes = b"\x1B\x70\x00\x19\xFA\x1B\x70\x01\x19\xFA";

    #[cfg(windows)]
    {
        send_raw_to_printer_spooler(&printer_target, pulse_bytes, "Apertura Cajon Logiventa POS")
            .map_err(|e| crate::error::AppError::Validation(format!("Error abriendo cajón vía '{}': {}", printer_target, e)))?;
    }

    Ok(format!("Pulso de apertura de cajón enviado exitosamente vía '{}'", printer_target))
}

fn chrono_or_fallback_time() -> String {
    // Si no está chrono, generamos fecha en formato ISO legible básico
    use std::time::SystemTime;
    match SystemTime::now().duration_since(SystemTime::UNIX_EPOCH) {
        Ok(d) => {
            let secs = d.as_secs();
            format!("UNIX {}", secs)
        }
        Err(_) => "Hora del sistema".into(),
    }
}
