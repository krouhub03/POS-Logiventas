pub mod migrations;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use rusqlite::Connection;

use crate::error::{AppError, AppResult};

/// Normaliza un texto para búsqueda en SQLite:
/// Convierte a minúsculas Unicode y remueve tildes / diacríticos
/// (á->a, é->e, í->i, ó->o, ú->u, ü->u, ñ->n).
/// Esto garantiza que búsquedas como "doña", "DOÑA", "dOÑA" o "dona"
/// encuentren siempre el producto sin importar mayúsculas, minúsculas o tildes.
pub fn normalize_search_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        for lc in c.to_lowercase() {
            match lc {
                'á' | 'à' | 'ä' | 'â' | 'ã' | 'ā' => out.push('a'),
                'é' | 'è' | 'ë' | 'ê' | 'ē' => out.push('e'),
                'í' | 'ì' | 'ï' | 'î' | 'ī' => out.push('i'),
                'ó' | 'ò' | 'ö' | 'ô' | 'õ' | 'ō' => out.push('o'),
                'ú' | 'ù' | 'ü' | 'û' | 'ū' => out.push('u'),
                'ñ' => out.push('n'),
                other => out.push(other),
            }
        }
    }
    out
}

/// Registra funciones escalares personalizadas en SQLite (ej. normalización Unicode).
pub fn register_custom_functions(conn: &Connection) -> rusqlite::Result<()> {
    conn.create_scalar_function(
        "pos_norm",
        1,
        rusqlite::functions::FunctionFlags::SQLITE_UTF8 | rusqlite::functions::FunctionFlags::SQLITE_DETERMINISTIC,
        |ctx| {
            let val: Option<String> = ctx.get(0)?;
            Ok(val.map(|s| normalize_search_text(&s)).unwrap_or_default())
        },
    )?;
    Ok(())
}

/// Estado global con la conexión SQLite, administrado por Tauri (`app.manage`).
#[derive(Clone)]
pub struct Db {
    conn: Arc<Mutex<Connection>>,
    path: PathBuf,
}

impl Db {
    /// Abre (o crea) la base de datos en `path`, configura pragmas y aplica migraciones.
    pub fn open(path: &Path) -> AppResult<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }

        let mut conn = Connection::open(path)?;
        register_custom_functions(&conn)?;
        conn.pragma_update(None, "foreign_keys", true)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;

        migrations::run(&mut conn)?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            path: path.to_path_buf(),
        })
    }

    pub fn conn(&self) -> AppResult<MutexGuard<'_, Connection>> {
        self.conn.lock().map_err(|_| AppError::Lock)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn schema_version(&self) -> AppResult<i64> {
        let conn = self.conn()?;
        Ok(conn.pragma_query_value(None, "user_version", |r| r.get(0))?)
    }
}
