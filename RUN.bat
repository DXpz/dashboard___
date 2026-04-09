@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PORT=8765

set PY=
where python >nul 2>&1 && set PY=python
if not defined PY where py >nul 2>&1 && set PY=py -3
if not defined PY (
  echo [ERROR] No se encontro Python. Instale Python 3 desde https://www.python.org/downloads/
  echo Tambien puede marcar "Add python.exe to PATH" al instalar.
  pause
  exit /b 1
)

echo.
echo  Dashboard LEAD
echo  Carpeta: %cd%
echo  Puerto:  %PORT%
echo.
echo  Abriendo el navegador en 2 segundos (el servidor arranca ya)...
echo  Deje esta ventana ABIERTA mientras use el panel. Cierre con Ctrl+C para detener.
echo.

REM Primero arranca el servidor; a los 2 s se abre el navegador (ya hay algo escuchando).
start /b cmd /c "timeout /t 2 /nobreak >nul && start http://127.0.0.1:%PORT%/"

%PY% -m http.server %PORT% --bind 127.0.0.1
echo.
echo El servidor se detuvo.
pause
