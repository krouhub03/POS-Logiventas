---
name: pos-version-release
description: >-
  Protocolo de versionado semántico (SemVer) y documentación automatizada de cambios en CHANGELOG.md para Metahabi POS (Logiventa).
  Activar cuando se solicite crear una nueva versión, documentar lo que se agregó, preparar un release, hacer bump de versión o publicar actualizaciones.
---

# Metahabi POS — Protocolo de Versionado y Documentación Continua

Este skill define el procedimiento estricto y automatizado para documentar cada cambio, sincronizar versiones en todos los manifiestos del proyecto y garantizar que las notas de versión lleguen directamente a la pantalla de los puntos de venta (POS) y a GitHub Releases.

---

## 🏛️ 1. Principio de la Única Fuente de Verdad y Sincronización Triple

En un proyecto Tauri 2 + Rust + React, la versión debe permanecer idéntica en **tres archivos obligatorios**:

1. [`package.json`](file:///package.json): `"version": "X.Y.Z"` (Frontend y scripts de empaquetado).
2. [`src-tauri/tauri.conf.json`](file:///src-tauri/tauri.conf.json): `"version": "X.Y.Z"` (Metadatos de Tauri y firma del Updater).
3. [`src-tauri/Cargo.toml`](file:///src-tauri/Cargo.toml): `version = "X.Y.Z"` (Binario compilado de Rust).

Si uno de estos archivos queda desfasado, el comparador de versiones de Tauri Updater fallará o entrará en bucle infinito de actualización.

---

## 📝 2. Estándar de Documentación en CHANGELOG.md

Cada versión debe documentarse en [`CHANGELOG.md`](file:///CHANGELOG.md) siguiendo el estándar **Keep a Changelog** y **SemVer**:

```markdown
## [X.Y.Z] - AAAA-MM-DD

### Agregado
- Nuevas funcionalidades o mejoras que aportan valor al usuario o cajero.

### Cambiado
- Modificaciones en comportamientos existentes, interfaces o refactorizaciones.

### Corregido
- Corrección de errores, fallos de sincronización o bugs reportados.

### Seguridad
- Parches de seguridad, endurecimiento de tokens o control de acceso.
```

> [!IMPORTANT]
> Las notas redactadas bajo la sección `## [X.Y.Z]` son las que el workflow de CI/CD extrae automáticamente para el cuerpo de **GitHub Releases**.
> A su vez, el servicio `updaterService` del POS descarga este cuerpo y lo muestra en la tarjeta de actualización (`UpdateNotificationBanner.tsx`) de la caja. Por lo tanto, redacta siempre las notas de forma clara, profesional y entendible para los usuarios.

---

## ⚡ 3. Comandos de Automatización

El repositorio cuenta con scripts listos para ejecutar que realizan todo el trabajo pesado:

### Para incrementar una versión Patch (Correcciones y mejoras menores):
```bash
npm run release:patch
# o con mensaje personalizado:
node scripts/release-version.mjs --type patch --message "Instalador silencioso y reconexión" --commit
```

### Para incrementar una versión Minor (Nuevos módulos o funcionalidades grandes):
```bash
npm run release:minor
# o con mensaje personalizado:
node scripts/release-version.mjs --type minor --message "Nuevo módulo de inventario y etiquetas" --commit
```

### Para preparar y previsualizar sin commitear:
```bash
npm run release:prep
```

### ¿Qué hace el script automáticamente?
1. Incrementa la versión en `package.json`, `src-tauri/tauri.conf.json` y `src-tauri/Cargo.toml`.
2. Lee los commits de git desde el último tag.
3. Inserta la sección formateada en `CHANGELOG.md` con la fecha del día.
4. Genera `.release-notes.md`.
5. Si se indicó `-Commit`, crea el commit `chore(release): vX.Y.Z` y el tag `vX.Y.Z`.

---

## 🚀 4. Despliegue y Distribución

Una vez generado el tag local, para disparar la compilación automática en Windows (GitHub Actions) y generar los instaladores firmados con auto-update:

```powershell
git push origin main --tags
```

El flujo `.github/workflows/release.yml`:
1. Compila el binario en Windows (`x86_64-pc-windows-msvc`).
2. Extrae las notas de esa versión desde `CHANGELOG.md`.
3. Firma criptográficamente el instalador con `minisign`.
4. Publica el release en GitHub con `latest.json`.
5. Todas las terminales POS en producción detectan la nueva versión y se actualizan silenciosamente.
