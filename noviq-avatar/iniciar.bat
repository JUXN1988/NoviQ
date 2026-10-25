@echo off
chcp 65001 >nul
title Noviq Avatar
cd /d "%~dp0"

rem  Normalmente lo abre Noviq solo. Este archivo sirve para abrirlo a mano.
set "ELECTRON=node_modules\electron\dist\electron.exe"
if exist "%ELECTRON%" goto abrir

where node >nul 2>nul
if errorlevel 1 goto sinnode

if not exist "node_modules\ws\package.json" (
  echo  Instalando dependencias, solo la primera vez...
  call npm install --no-audit --no-fund
)
if not exist "%ELECTRON%" (
  echo  Descargando el motor del avatar, solo la primera vez: unos 160 MB...
  node "node_modules\electron\install.js"
)
if not exist "%ELECTRON%" (
  echo  Reinstalando Electron desde cero...
  rmdir /s /q "node_modules\electron" 2>nul
  call npm install --no-audit --no-fund
)
if not exist "%ELECTRON%" goto fallo

:abrir
start "" "%ELECTRON%" .
exit /b 0

:sinnode
echo.
echo  Falta el motor del avatar y Node.js no esta instalado.
echo  Opcion 1: abre Noviq; el lo descarga y lo repara solo.
echo  Opcion 2: instala Node.js 18 o superior desde https://nodejs.org y vuelve a abrir este archivo.
echo.
pause
exit /b 1

:fallo
echo.
echo  No se pudo descargar Electron. Revisa tu conexion a internet y vuelve a intentarlo,
echo  o abre Noviq, que lo repara solo.
echo.
pause
exit /b 1
