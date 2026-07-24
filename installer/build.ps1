# Woxus build script (PowerShell)
# Run from the project root to produce a full release build.

param(
    [switch]$SkipDeps,
    [switch]$Portable
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path -Parent $PSScriptRoot
$BUILD_DIR = Join-Path $ROOT "build"
$FRONTEND_DIR = Join-Path $ROOT "frontend"
$BACKEND_DIR = Join-Path $ROOT "backend"
$AGENT_DIR = Join-Path $ROOT "agent"

Write-Host "=== Woxus Build ===" -ForegroundColor Cyan

# 1. Install dependencies
if (-not $SkipDeps) {
    Write-Host "→ Installing frontend dependencies…" -ForegroundColor Yellow
    Push-Location $FRONTEND_DIR
    npm install
    Pop-Location

    Write-Host "→ Installing backend dependencies…" -ForegroundColor Yellow
    Push-Location $BACKEND_DIR
    pip install -r requirements.txt
    Pop-Location

    Write-Host "→ Installing agent dependencies…" -ForegroundColor Yellow
    Push-Location $AGENT_DIR
    pip install -r requirements.txt
    Pop-Location
}

# 2. Build frontend
Write-Host "→ Building frontend…" -ForegroundColor Yellow
Push-Location $FRONTEND_DIR
npm run build
Pop-Location

# 3. Bundle backend with PyInstaller
Write-Host "→ Bundling backend…" -ForegroundColor Yellow
Push-Location $BACKEND_DIR
pyinstaller --onefile --name woxus-backend --windowed --distpath $BUILD_DIR main.py
Pop-Location

# 4. Bundle agent with PyInstaller
Write-Host "→ Bundling agent…" -ForegroundColor Yellow
Push-Location $AGENT_DIR
pyinstaller --onefile --name woxus-agent --windowed --distpath $BUILD_DIR main.py
Pop-Location

# 5. Tauri bundle (produces Woxus.exe + installer)
Write-Host "→ Building Tauri app…" -ForegroundColor Yellow
Push-Location $FRONTEND_DIR
npm run tauri build -- --bundles msi,nsis
Pop-Location

Write-Host "=== Build complete ===" -ForegroundColor Green
Write-Host "Output: $BUILD_DIR" -ForegroundColor Green
