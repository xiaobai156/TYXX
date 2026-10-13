$ErrorActionPreference = 'Stop'

$appRoot = $PSScriptRoot
$url = 'http://127.0.0.1:23962/'
$healthUrl = "${url}api/health"
$logDir = Join-Path $env:LOCALAPPDATA 'UnifiedLotteryAnalysis'
$stdout = Join-Path $logDir 'server.log'
$stderr = Join-Path $logDir 'server-error.log'

function Test-UnifiedService {
    try {
        $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
        return $health.ok -eq $true -and $health.database -eq 'ok'
    } catch {
        return $false
    }
}

function Get-MicrosoftEdgePath {
    $candidates = @(
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            return $candidate
        }
    }

    $edgeCommand = Get-Command msedge.exe -ErrorAction SilentlyContinue
    if ($edgeCommand) {
        return $edgeCommand.Source
    }
    throw 'Microsoft Edge was not found. Install Microsoft Edge and try again.'
}

try {
    if (-not (Test-UnifiedService)) {
        $listener = Get-NetTCPConnection -LocalPort 23962 -State Listen -ErrorAction SilentlyContinue
        if ($listener) {
            throw 'Port 23962 is already in use by another program.'
        }

        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
        $node = (Get-Command node.exe -ErrorAction Stop).Source
        Start-Process `
            -FilePath $node `
            -ArgumentList 'server/index.js' `
            -WorkingDirectory $appRoot `
            -WindowStyle Hidden `
            -RedirectStandardOutput $stdout `
            -RedirectStandardError $stderr | Out-Null

        $ready = $false
        for ($attempt = 0; $attempt -lt 50; $attempt += 1) {
            Start-Sleep -Milliseconds 100
            if (Test-UnifiedService) {
                $ready = $true
                break
            }
        }
        if (-not $ready) {
            $details = if (Test-Path $stderr) { Get-Content $stderr -Raw } else { '' }
            throw "Unified analysis platform failed to start. $details"
        }
    }

    $edgePath = Get-MicrosoftEdgePath
    Start-Process -FilePath $edgePath -ArgumentList $url
} catch {
    [Console]::Error.WriteLine("Startup failed: {0}", $_.Exception.Message)
    exit 1
}
