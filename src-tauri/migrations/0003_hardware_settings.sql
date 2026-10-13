-- =============================================================
-- Migración 0003: Ajustes de Hardware y Periféricos (Impresora, Cajón, Lector, Báscula)
-- =============================================================

INSERT OR IGNORE INTO settings (key, value) VALUES
    ('printer_enabled', 'true'),
    ('printer_type', 'system'),
    ('printer_target', 'POS-58'),
    ('printer_paper_width', '58mm'),
    ('printer_auto_cut', 'true'),
    ('printer_auto_print', 'true'),
    ('printer_header_text', 'CIGARRERÍA MEGALIDER\nNIT: 901.234.567-1\nBogotá, Colombia\nTel: (601) 555-0123'),
    ('printer_footer_text', '¡Gracias por su compra!\nConserve su ticket como comprobante.'),
    ('drawer_enabled', 'true'),
    ('drawer_trigger', 'printer_pulse'),
    ('drawer_open_on_sale', 'true'),
    ('scanner_mode', 'keyboard_hid'),
    ('scanner_sound', 'true'),
    ('scale_enabled', 'false'),
    ('scale_port', 'COM1'),
    ('scale_baud_rate', '9600');
