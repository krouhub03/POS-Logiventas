use serde::{Serialize, Serializer};

/// Error unificado de la aplicación. Se serializa como texto para que el
/// frontend lo reciba en el `catch` de `invoke()`.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Error de base de datos: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("Error de E/S: {0}")]
    Io(#[from] std::io::Error),

    #[error("Error de Tauri: {0}")]
    Tauri(#[from] tauri::Error),

    #[error("Error de red / HTTP: {0}")]
    Network(#[from] reqwest::Error),

    #[error("Error de autenticación: {0}")]
    Auth(String),

    #[error("{0}")]
    Validation(String),

    #[error("No se pudo bloquear la conexión a la base de datos")]
    Lock,
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
