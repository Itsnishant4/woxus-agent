@echo off
REM Woxus build script (batch) — runs build.ps1 via PowerShell
REM Usage: build.bat

echo === Woxus Build ===
powershell -ExecutionPolicy Bypass -File "%~dp0build.ps1"
if %ERRORLEVEL% neq 0 (
    echo Build failed with exit code %ERRORLEVEL%
    exit /b %ERRORLEVEL%
)
echo === Build complete ===
