@echo off
cd /d "%~dp0"
echo ============================================
echo  Truss Viewer - Share URL for VPN users
echo ============================================
echo.

if not exist "dist\index.html" (
  echo Building first... run deploy.bat
  pause
  exit /b 1
)

echo Your IP addresses ^(share the VPN one with coworkers^):
echo.
echo   HOME Wi-Fi only ^(same house Wi-Fi^):
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  set "ip=%%a"
  setlocal enabledelayedexpansion
  set "ip=!ip: =!"
  echo !ip! | findstr /r "^192\.168\. ^10\. ^172\.1[6-9]\. ^172\.2[0-9]\. ^172\.3[0-1]\." >nul
  if not errorlevel 1 echo     http://!ip!:8080/
  endlocal
)

echo.
echo   VPN / Company network ^(share THIS with VPN colleagues^):
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  set "ip=%%a"
  setlocal enabledelayedexpansion
  set "ip=!ip: =!"
  echo !ip! | findstr /r "^10\." >nul
  if not errorlevel 1 (
    echo !ip! | findstr /r "^192\.168\. ^10\.0\. ^10\.1\. ^10\.2\.0\." >nul
    if errorlevel 1 echo     http://!ip!:8080/
  )
  endlocal
)

echo.
echo Look for adapter names like: Cisco, GlobalProtect, AnyConnect,
echo FortiClient, Pulse, VPN, TAP, WAN Miniport
echo.
echo 1. Connect to company VPN first
echo 2. Run this script again to see VPN IP
echo 3. Share http://VPN-IP:8080/ with coworkers ^(also on VPN^)
echo 4. Run open-firewall-admin.bat as Admin once
echo.
echo Starting server...
echo Keep this window open.
echo.
node .\scripts\serve-production.js
