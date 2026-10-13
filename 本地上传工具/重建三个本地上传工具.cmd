@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Building unified local uploader...
py -3.10 build_exes.py
if errorlevel 1 (
  echo.
  echo Build failed. See the error above.
  pause
  exit /b 1
)
echo.
echo Unified local uploader build completed.
pause
