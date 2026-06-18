@echo off
cd /d "%~dp0"
echo Building BOM data...
node .\scripts\build-data.js
echo Starting Plan 193 Viewer Suite...
echo   3D Viewer:     http://localhost:5173/
echo   Split Compare: http://localhost:5173/split.html
echo   BOM Compare:   http://localhost:5173/compare.html
echo   MiTek Inspector: http://localhost:5173/mitek.html
echo   DDP Inspector: http://localhost:5173/ddp.html
echo   Truss Detail:  http://localhost:5173/truss.html?mark=T01
echo   Truss Analyzer: http://localhost:5173/analyzer.html?mark=T06
echo   Network LAN:    run serve-network.bat after deploy
node .\node_modules\vite\bin\vite.js
pause
