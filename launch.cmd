@echo off
rem Starts Server Monitor (builds first if needed). Double-click to run.
cd /d "%~dp0"
if not exist "out\main\index.js" call npm run build
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0"
