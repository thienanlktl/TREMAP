@echo off
:: Run as Administrator — opens port 8080 for LAN access
netsh advfirewall firewall delete rule name="Truss Viewer 8080" >nul 2>&1
netsh advfirewall firewall add rule name="Truss Viewer 8080" dir=in action=allow protocol=TCP localport=8080
echo.
echo Firewall rule added for port 8080.
echo Others on your network can now connect.
echo.
pause
