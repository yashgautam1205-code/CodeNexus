
$url = "https://codenexus-od6e.onrender.com/api/health"

Write-Host "CodeNexus Keep-Alive Started" -ForegroundColor Green
Write-Host "Checking every 60 seconds..."
Write-Host "Press Ctrl+C to stop."

while ($true) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

    try {
        $response = Invoke-WebRequest -Uri $url -Method GET -TimeoutSec 20
        Write-Host "[$timestamp] HTTP $($response.StatusCode) - Server is responding" -ForegroundColor Green
        Write-Host $response.Content
    }
    catch {
        $status = if ($_.Exception.Response) {
            [int]$_.Exception.Response.StatusCode
        } else {
            "Failed"
        }

        Write-Host "[$timestamp] HTTP $status - Request failed" -ForegroundColor Red
    }

    Start-Sleep -Seconds 60
}
