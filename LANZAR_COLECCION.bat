@echo off
title Servidor Coleccion Retro
echo ===================================================
echo     INICIANDO GESTOR DE COLECCION RETRO
echo ===================================================
echo.
echo [PC Local]:   http://localhost:3030
echo [Movil LAN]:  https://192.168.1.4:3443  (Camara habilitada)
echo.
cd /d "%~dp0"
if not exist node_modules (
    echo Instalando dependencias npm...
    npm install
)
echo Abriendo navegador en http://localhost:3030...
start http://localhost:3030
node server.js
pause
