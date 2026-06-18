# Truss Viewer — live connection monitor (port 8080)
# Run: powershell -ExecutionPolicy Bypass -File monitor-access.ps1

$port = 8080

Write-Host ""
Write-Host "Truss Viewer — who is connected? (port $port)" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop. Refreshes every 5 seconds."
Write-Host ""

while ($true) {
  $now = Get-Date -Format "HH:mm:ss"
  $connections = Get-NetTCPConnection -LocalPort $port -State Established -ErrorAction SilentlyContinue |
    Where-Object { $_.RemoteAddress -notin @("127.0.0.1", "::1") }

  $unique = $connections | Select-Object -ExpandProperty RemoteAddress -Unique

  Clear-Host
  Write-Host "Truss Viewer — access monitor ($now)" -ForegroundColor Cyan
  Write-Host "=========================================="
  Write-Host ""
  Write-Host "Active visitors (unique IPs): $($unique.Count)" -ForegroundColor Green
  Write-Host ""

  if ($unique.Count -eq 0) {
    Write-Host "  No remote connections right now."
  } else {
    Write-Host "  IP Address          Connections"
    Write-Host "  ----------          -----------"
    foreach ($ip in $unique) {
      $count = ($connections | Where-Object RemoteAddress -eq $ip).Count
      Write-Host ("  {0,-18}  {1}" -f $ip, $count)
    }
  }

  Write-Host ""
  Write-Host "Total TCP connections: $($connections.Count)"
  Write-Host "(One person may use several connections while loading pages)"
  Write-Host ""
  Write-Host "Refreshing in 5s... (Ctrl+C to exit)"

  Start-Sleep -Seconds 5
}
