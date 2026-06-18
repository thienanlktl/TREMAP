@echo off
cd /d "%~dp0"
echo ============================================
echo  Truss Viewer - Network Access (LAN)
echo ============================================
echo.

if not exist "dist\index.html" (
  echo First-time setup: building app...
  call deploy.bat
  exit /b
)

echo Checking Windows Firewall for port 8080...
netsh advfirewall firewall show rule name="Truss Viewer 8080" >nul 2>&1
if errorlevel 1 (
  echo Adding firewall rule ^(may ask for Admin^)...
  netsh advfirewall firewall add rule name="Truss Viewer 8080" dir=in action=allow protocol=TCP localport=8080
)

echo.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  set IP=%%a
  goto :found
)
:found
set IP=%IP: =%

echo Share this URL with people on your network:
echo.
echo   http://%IP%:8080/
echo.
echo Pages:
echo   3D Viewer:      http://%IP%:8080/
echo   Truss Analyzer: http://%IP%:8080/analyzer.html?mark=T06
echo   BOM Compare:    http://%IP%:8080/compare.html
echo.
echo Keep this window open while others use the app.
echo Press Ctrl+C to stop the server.
echo.

node .\scripts\serve-production.js
