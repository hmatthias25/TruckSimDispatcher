<#
.SYNOPSIS
  Runs the test suites against a freshly built server.

.DESCRIPTION
  Each suite gets its own port and its own career file, so nothing leaks between them and they can
  be read in isolation. The server is started with -NoNewWindow: no console windows appear, which is
  the whole reason this script exists rather than a pile of Start-Process calls.

  Quiet by default. You get one line per suite and the failures; pass -Full for every assertion.

.EXAMPLE
  .\tests\run.ps1                 # everything, quietly
  .\tests\run.ps1 -Only shop,odo  # just those two
  .\tests\run.ps1 -Full           # every PASS line as well
  .\tests\run.ps1 -SkipBuild      # reuse the current binaries
#>
[CmdletBinding()]
param(
    # Suite names to run, with or without the .cjs. Omit for all of them.
    [string[]] $Only,
    # Print every assertion, not just failures.
    [switch] $Full,
    # Don't rebuild first. Only safe when nothing has changed since the last run.
    [switch] $SkipBuild,
    # First port to use. Each suite takes the next one up.
    [int] $BasePort = 5600
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dll = Join-Path $root 'bin\Release\net10.0\win-x64\TruckSimDispatcher.dll'
$work = Join-Path $env:TEMP 'tsd-tests'

Push-Location $root
try {
    # ---- build. A stale binary is the one failure mode that silently reports success, so the server
    # is killed first: a running one holds the DLL and the build fails without saying much.
    if (-not $SkipBuild) {
        Get-Process dotnet, TruckSimDispatcher -ErrorAction SilentlyContinue |
            Stop-Process -Force -ErrorAction SilentlyContinue
        Write-Host 'building...' -ForegroundColor DarkGray
        $out = dotnet build -c Release -r win-x64 --self-contained -v q --nologo 2>&1
        if ($LASTEXITCODE -ne 0) {
            $out | Where-Object { $_ -match 'error' } | ForEach-Object { Write-Host $_ -ForegroundColor Red }
            throw 'build failed'
        }
    }
    if (-not (Test-Path $dll)) { throw "no binary at $dll - build first" }

    # ---- which suites
    $suites = Get-ChildItem (Join-Path $PSScriptRoot '*.cjs') | Sort-Object Name
    if ($Only) {
        $want = $Only | ForEach-Object { ($_ -replace '\.cjs$', '') }
        $suites = $suites | Where-Object { $want -contains $_.BaseName }
        if (-not $suites) { throw "no suite matched: $($Only -join ', ')" }
    }

    if (Test-Path $work) { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
    New-Item -ItemType Directory -Path $work -Force | Out-Null

    $results = @()
    $port = $BasePort

    foreach ($suite in $suites) {
        $port++
        $data = Join-Path $work $suite.BaseName
        New-Item -ItemType Directory -Path $data -Force | Out-Null

        $env:TSD_DATA_DIR = $data
        $env:TSD_PORT = $port

        # -NoNewWindow is the point: no console window, nothing steals focus.
        $log = Join-Path $work "$($suite.BaseName).server.log"
        $err = Join-Path $work "$($suite.BaseName).server.err"
        $server = Start-Process -FilePath 'dotnet' -PassThru -NoNewWindow `
            -ArgumentList $dll, '--port', $port, '--no-browser' `
            -RedirectStandardOutput $log -RedirectStandardError $err

        # Wait on the port rather than guessing at a sleep.
        $up = $false
        for ($i = 0; $i -lt 50 -and -not $up; $i++) {
            Start-Sleep -Milliseconds 300
            try {
                Invoke-RestMethod "http://127.0.0.1:$port/api/bootstrap" -TimeoutSec 3 | Out-Null
                $up = $true
            } catch { }
        }

        if (-not $up) {
            Write-Host ("  {0,-14} SERVER DID NOT START" -f $suite.BaseName) -ForegroundColor Red
            Get-Content $err -ErrorAction SilentlyContinue | Select-Object -First 8 |
                ForEach-Object { Write-Host "      $_" -ForegroundColor DarkRed }
            $results += [pscustomobject]@{ Suite = $suite.BaseName; Pass = 0; Fail = 1; Note = 'no server' }
            try { Stop-Process -Id $server.Id -Force } catch { }
            continue
        }

        $output = & node $suite.FullName 2>&1
        try { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue } catch { }

        $text = $output -join "`n"
        $p = ([regex]::Matches($text, '(?m)^\s*PASS\s')).Count
        $f = ([regex]::Matches($text, '(?m)^\s*FAIL\s')).Count

        if ($Full) {
            Write-Host ""
            Write-Host "--- $($suite.BaseName) (port $port)" -ForegroundColor Cyan
            $output | ForEach-Object { Write-Host $_ }
        } else {
            $colour = if ($f -gt 0) { 'Red' } elseif ($p -eq 0) { 'Yellow' } else { 'Green' }
            Write-Host ("  {0,-14} {1,4} pass  {2,3} fail" -f $suite.BaseName, $p, $f) -ForegroundColor $colour
            # Failures are always shown, plus the error line when a suite died outright.
            $output | Where-Object { $_ -match '^\s*FAIL\s|^ERROR ' } |
                ForEach-Object { Write-Host "      $_" -ForegroundColor Red }
        }

        $results += [pscustomobject]@{ Suite = $suite.BaseName; Pass = $p; Fail = $f; Note = '' }
    }

    Remove-Item Env:\TSD_DATA_DIR, Env:\TSD_PORT -ErrorAction SilentlyContinue

    $totalPass = ($results | Measure-Object -Property Pass -Sum).Sum
    $totalFail = ($results | Measure-Object -Property Fail -Sum).Sum

    Write-Host ""
    Write-Host ("{0} checks across {1} suites, {2} failed" -f $totalPass, $results.Count, $totalFail) `
        -ForegroundColor $(if ($totalFail -gt 0) { 'Red' } else { 'Green' })
    if ($totalFail -gt 0) {
        Write-Host "  server logs: $work" -ForegroundColor DarkGray
    }

    exit $(if ($totalFail -gt 0) { 1 } else { 0 })
} finally {
    Pop-Location
}
