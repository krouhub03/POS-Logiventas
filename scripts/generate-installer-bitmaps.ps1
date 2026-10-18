# scripts/generate-installer-bitmaps.ps1
Add-Type -AssemblyName System.Drawing

$iconPath = Join-Path $PSScriptRoot "..\src-tauri\icons\icon.png"
$outDir = Join-Path $PSScriptRoot "..\src-tauri\assets\installer"
if (-not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
}

$iconImg = [System.Drawing.Image]::FromFile($iconPath)

# -------------------------------------------------------------
# 1. WiX Dialog: 493 x 312
# Left sidebar (164 px) + Right clean canvas (329 px)
# -------------------------------------------------------------
$wixDialog = New-Object System.Drawing.Bitmap 493, 312
$g = [System.Drawing.Graphics]::FromImage($wixDialog)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

# Fondo derecho blanco sólido
$whiteBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
$g.FillRectangle($whiteBrush, 164, 0, 329, 312)

# Fondo izquierdo: Gradiente esmeralda oscuro cybernetic
$rectLeft = New-Object System.Drawing.Rectangle 0, 0, 164, 312
$c1 = [System.Drawing.Color]::FromArgb(255, 4, 47, 46)     # teal-950
$c2 = [System.Drawing.Color]::FromArgb(255, 2, 44, 34)     # emerald-950
$gradBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rectLeft, $c1, $c2, 65.0
$g.FillRectangle($gradBrush, $rectLeft)

# Acentos geométricos sutiles en la barra lateral
$penLine = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(40, 16, 185, 129)), 1.5
$g.DrawLine($penLine, 20, 0, 164, 180)
$g.DrawLine($penLine, 0, 120, 140, 312)

# Círculo de resplandor para el logo
$glowBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(35, 16, 185, 129))
$g.FillEllipse($glowBrush, 37, 55, 90, 90)

# Dibujar Icono corporativo centrado (72x72)
$g.DrawImage($iconImg, 46, 64, 72, 72)

# Título "METAHABI"
$fontTitle = New-Object System.Drawing.Font("Segoe UI", [float]12, [System.Drawing.FontStyle]::Bold)
$brushWhite = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
$sfCenter = New-Object System.Drawing.StringFormat
$sfCenter.Alignment = [System.Drawing.StringAlignment]::Center
$g.DrawString("METAHABI", $fontTitle, $brushWhite, (New-Object System.Drawing.RectangleF 0, 155, 164, 25), $sfCenter)

# Subtítulo "PUNTO DE VENTA"
$fontSub = New-Object System.Drawing.Font("Segoe UI", [float]8, [System.Drawing.FontStyle]::Bold)
$brushTeal = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 52, 211, 153)) # emerald-400
$g.DrawString("PUNTO DE VENTA", $fontSub, $brushTeal, (New-Object System.Drawing.RectangleF 0, 180, 164, 20), $sfCenter)

# Badge offline-first
$fontBadge = New-Object System.Drawing.Font("Segoe UI", [float]7, [System.Drawing.FontStyle]::Regular)
$brushSlate = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 148, 163, 184))
$g.DrawString("Rapido * Seguro * Offline", $fontBadge, $brushSlate, (New-Object System.Drawing.RectangleF 0, 265, 164, 20), $sfCenter)

# Separador vertical
$penDiv = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 226, 232, 240)), 1.0
$g.DrawLine($penDiv, 164, 0, 164, 312)

$wixDialogPath = Join-Path $outDir "wix-dialog.bmp"
$wixDialog.Save($wixDialogPath, [System.Drawing.Imaging.ImageFormat]::Bmp)
$g.Dispose()
$wixDialog.Dispose()
Write-Output "Creado: $wixDialogPath"

# -------------------------------------------------------------
# 2. WiX Top Banner: 493 x 58
# -------------------------------------------------------------
$wixBanner = New-Object System.Drawing.Bitmap 493, 58
$gb = [System.Drawing.Graphics]::FromImage($wixBanner)
$gb.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$gb.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

# Fondo blanco
$gb.FillRectangle($whiteBrush, 0, 0, 493, 58)

# Acento inferior verde esmeralda (3px)
$accentBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 16, 185, 129))
$gb.FillRectangle($accentBrush, 0, 55, 493, 3)

# Pequeño logo a la derecha (42x42 en x=435, y=7)
$gb.DrawImage($iconImg, 435, 7, 42, 42)

$wixBannerPath = Join-Path $outDir "wix-banner.bmp"
$wixBanner.Save($wixBannerPath, [System.Drawing.Imaging.ImageFormat]::Bmp)
$gb.Dispose()
$wixBanner.Dispose()
Write-Output "Creado: $wixBannerPath"

# -------------------------------------------------------------
# 3. NSIS Sidebar: 164 x 314
# -------------------------------------------------------------
$nsisSidebar = New-Object System.Drawing.Bitmap 164, 314
$gs = [System.Drawing.Graphics]::FromImage($nsisSidebar)
$gs.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$gs.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$gs.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

$rectNsis = New-Object System.Drawing.Rectangle 0, 0, 164, 314
$gradNsis = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rectNsis, $c1, $c2, 65.0
$gs.FillRectangle($gradNsis, $rectNsis)
$gs.FillEllipse($glowBrush, 37, 55, 90, 90)
$gs.DrawImage($iconImg, 46, 64, 72, 72)
$gs.DrawString("METAHABI", $fontTitle, $brushWhite, (New-Object System.Drawing.RectangleF 0, 155, 164, 25), $sfCenter)
$gs.DrawString("PUNTO DE VENTA", $fontSub, $brushTeal, (New-Object System.Drawing.RectangleF 0, 180, 164, 20), $sfCenter)
$gs.DrawString("Rapido * Seguro * Offline", $fontBadge, $brushSlate, (New-Object System.Drawing.RectangleF 0, 270, 164, 20), $sfCenter)

$nsisSidebarPath = Join-Path $outDir "nsis-sidebar.bmp"
$nsisSidebar.Save($nsisSidebarPath, [System.Drawing.Imaging.ImageFormat]::Bmp)
$gs.Dispose()
$nsisSidebar.Dispose()
Write-Output "Creado: $nsisSidebarPath"

# -------------------------------------------------------------
# 4. NSIS Header: 150 x 57
# -------------------------------------------------------------
$nsisHeader = New-Object System.Drawing.Bitmap 150, 57
$gh = [System.Drawing.Graphics]::FromImage($nsisHeader)
$gh.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$gh.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$gh.FillRectangle($whiteBrush, 0, 0, 150, 57)
$gh.DrawImage($iconImg, 100, 8, 40, 40)

$nsisHeaderPath = Join-Path $outDir "nsis-header.bmp"
$nsisHeader.Save($nsisHeaderPath, [System.Drawing.Imaging.ImageFormat]::Bmp)
$gh.Dispose()
$nsisHeader.Dispose()
Write-Output "Creado: $nsisHeaderPath"

$iconImg.Dispose()
Write-Output "✅ ¡Todas las imágenes del instalador generadas exitosamente!"
