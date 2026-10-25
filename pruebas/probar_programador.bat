@echo off
chcp 65001 >nul
title Noviq - pruebas del programador eficiente
cd /d "%~dp0\.."
set "PY=.venv\Scripts\python.exe"
if not exist "%PY%" set "PY=python"
if not exist "pruebas\resultados" mkdir "pruebas\resultados"

if not "%~1"=="" goto REAL

echo.
echo === 1/3 Pruebas unitarias (pytest) ===
"%PY%" -m pip install -q --disable-pip-version-check pytest
"%PY%" -m pytest pruebas -q --junitxml=pruebas\resultados\pytest_programador.xml
echo.
echo === 2/3 Banco con una IA debil simulada (58 tareas) ===
"%PY%" pruebas\banco_programador.py
echo.
echo === 3/3 Avatar (Node) ===
where node >nul 2>nul
if errorlevel 1 (
  echo   Node no esta instalado: se omiten las pruebas del avatar.
) else (
  pushd noviq-avatar
  call npm test
  popd
)
echo.
echo Resultados en pruebas\resultados
echo Para medir un modelo REAL arrastra este .bat a una consola y agrega el modelo, por ejemplo:
echo   pruebas\probar_programador.bat lmstudio::opus4.7-gods.ghost.codex.distill.4b
echo   pruebas\probar_programador.bat nvidia::nvidia/nemotron-3-super-120b-a12b
pause
exit /b 0

:REAL
echo.
echo === Banco REAL con %~1 (14 tareas; puede tardar varios minutos) ===
echo   Si es LM Studio u Ollama, deben estar abiertos con el servidor encendido.
"%PY%" pruebas\banco_programador.py --real "%~1"
echo.
echo Resultados en pruebas\resultados
pause
