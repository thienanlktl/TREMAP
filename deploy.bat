@echo off
cd /d "%~dp0"
echo ============================================
echo  Plan 193 Truss Viewer - Internal Deploy
echo ============================================
echo.
echo Step 1: Building production package...
node .\scripts\build-data.js
if errorlevel 1 goto :fail
node .\node_modules\vite\bin\vite.js build
if errorlevel 1 goto :fail
node .\scripts\prepare-deploy.js
if errorlevel 1 goto :fail
echo.
echo Step 2: Starting server for internal users...
echo   Users on your network open: http://YOUR-PC-IP:8080/
echo   (The server will print the exact Network URL below)
echo.
node .\scripts\serve-production.js
goto :end

:fail
echo.
echo Build failed. Check errors above.
pause
exit /b 1

:end
pause
