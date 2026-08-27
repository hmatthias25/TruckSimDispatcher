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
    [int] $BasePort = 5600,
    # How many suites to run at once. Each has its own port and its own career file, so they do not
    # interfere; this is only about how much of the machine to use. 1 restores the old serial behaviour.
    [int] $Parallel = 8
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
    # @() matters: a single match comes back as one FileInfo, not a list, and the batching below
    # indexes it. Without this, -Only <one suite> ran nothing and reported zero across zero suites.
    $suites = @(Get-ChildItem (Join-Path $PSScriptRoot '*.cjs') | Sort-Object Name)
    if ($Only) {
        $want = $Only | ForEach-Object { ($_ -replace '\.cjs$', '') }
        $suites = @($suites | Where-Object { $want -contains $_.BaseName })
        if (-not $suites) { throw "no suite matched: $($Only -join ', ')" }
    }

    # A career file left behind by an earlier run is the worst failure this script has, because it does
    # not look like one: the suites still run, but against somebody else's state, and report failures
    # that have nothing to do with the code. A crashed run leaves a server holding its file, the delete
    # is refused, and -ErrorAction SilentlyContinue used to swallow that. So: kill first, then insist.
    if (Test-Path $work) {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
        if (Test-Path $work) {
            Get-Process TruckSimDispatcher, dotnet -ErrorAction SilentlyContinue |
                Stop-Process -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 400
            Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
        }
        if (Test-Path $work) {
            $left = @(Get-ChildItem -LiteralPath $work -Recurse -File -ErrorAction SilentlyContinue)
            throw ("cannot clear $work - $($left.Count) file(s) still locked. A server from a previous " +
                   'run is holding them; close it and try again. Refusing to run against stale careers.')
        }
    }
    New-Item -ItemType Directory -Path $work -Force | Out-Null

    $results = @()
    $port = $BasePort

    # ---- how a finished suite is read and reported. Pulled out of the loop because it is now called
    # after a batch rather than inline, and the reporting has to stay identical either way.
    function Read-SuiteResult {
        param($Suite, $Work, $ShowAll, $Port)

        $sout = Join-Path $Work "$($Suite.BaseName).node.log"
        $output = @()
        foreach ($f in @($sout, "$sout.err")) {
            if (Test-Path $f) { $output += @(Get-Content -LiteralPath $f -ErrorAction SilentlyContinue) }
        }

        $text = $output -join "`n"
        $p = ([regex]::Matches($text, '(?m)^\s*PASS\s')).Count
        $f = ([regex]::Matches($text, '(?m)^\s*FAIL\s')).Count

        if ($ShowAll) {
            Write-Host ""
            Write-Host "--- $($Suite.BaseName) (port $Port)" -ForegroundColor Cyan
            $output | ForEach-Object { Write-Host $_ }
        } else {
            $colour = if ($f -gt 0) { 'Red' } elseif ($p -eq 0) { 'Yellow' } else { 'Green' }
            Write-Host ("  {0,-14} {1,4} pass  {2,3} fail" -f $Suite.BaseName, $p, $f) -ForegroundColor $colour
            $output | Where-Object { $_ -match '^\s*FAIL\s|^ERROR ' } |
                ForEach-Object { Write-Host "      $_" -ForegroundColor Red }
        }

        # Every suite ends by printing its own "N passed, M failed". No such line means it stopped
        # partway, and counting the assertions it managed before dying is not a pass.
        $summary = $text -match '(?m)^\s*\d+ passed, \d+ failed\s*$'
        if (-not $summary) {
            $f = [Math]::Max(1, $f)
            Write-Host ("      DIED after {0} assertion(s) - no summary line" -f $p) -ForegroundColor Red
            $output | Select-Object -Last 6 | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkRed }
        }
        [pscustomobject]@{ Suite = $Suite.BaseName; Pass = $p; Fail = $f; Note = '' }
    }

    # ---- run in batches. Each suite in a batch gets its own port and career file, so the only thing
    # shared is the machine.
    $width = [Math]::Max(1, $Parallel)
    for ($start = 0; $start -lt $suites.Count; $start += $width) {
        $stop  = [Math]::Min($start + $width - 1, $suites.Count - 1)
        $batch = @($suites[$start..$stop])
        $live  = @()

        # 1. every server in the batch, started together rather than one after another.
        foreach ($suite in $batch) {
            $port++
            $data = Join-Path $work $suite.BaseName
            New-Item -ItemType Directory -Path $data -Force | Out-Null

            $env:TSD_DATA_DIR = $data
            $env:TSD_PORT = $port

            $log = Join-Path $work "$($suite.BaseName).server.log"
            $err = Join-Path $work "$($suite.BaseName).server.err"
            $server = Start-Process -FilePath 'dotnet' -PassThru -NoNewWindow `
                -ArgumentList $dll, '--port', $port, '--no-browser' `
                -RedirectStandardOutput $log -RedirectStandardError $err

            $live += [pscustomobject]@{ Suite = $suite; Port = $port; Data = $data; Server = $server;
                                        Node = $null; Up = $false; Err = $err }
        }

        # 2. wait for them. Look FIRST and sleep after — the old loop slept 300 ms before its first
        # check, which every suite paid whether or not it needed to.
        $deadline = (Get-Date).AddSeconds(30)
        while ((Get-Date) -lt $deadline -and ($live | Where-Object { -not $_.Up })) {
            foreach ($x in ($live | Where-Object { -not $_.Up })) {
                try {
                    Invoke-RestMethod "http://127.0.0.1:$($x.Port)/api/bootstrap" -TimeoutSec 3 | Out-Null
                    $x.Up = $true
                } catch { }
            }
            if ($live | Where-Object { -not $_.Up }) { Start-Sleep -Milliseconds 40 }
        }

        # 3. every test in the batch, started together. Start-Process takes a snapshot of the
        # environment as it launches, so setting the two variables immediately before each call is
        # what gives each node its own port and career file.
        foreach ($x in $live) {
            if (-not $x.Up) { continue }
            $sout = Join-Path $work "$($x.Suite.BaseName).node.log"
            $env:TSD_DATA_DIR = $x.Data
            $env:TSD_PORT = $x.Port
            $x.Node = Start-Process -FilePath 'node' -PassThru -NoNewWindow `
                -ArgumentList $x.Suite.FullName `
                -RedirectStandardOutput $sout -RedirectStandardError "$sout.err"
        }

        foreach ($x in $live) {
            if ($x.Node) { try { $x.Node.WaitForExit() } catch { } }
        }

        # 4. report in suite order, whatever order they finished in, then tear the batch down.
        foreach ($x in $live) {
            if (-not $x.Up) {
                Write-Host ("  {0,-14} SERVER DID NOT START" -f $x.Suite.BaseName) -ForegroundColor Red
                Get-Content $x.Err -ErrorAction SilentlyContinue | Select-Object -First 8 |
                    ForEach-Object { Write-Host "      $_" -ForegroundColor DarkRed }
                $results += [pscustomobject]@{ Suite = $x.Suite.BaseName; Pass = 0; Fail = 1; Note = 'no server' }
            } else {
                $results += Read-SuiteResult -Suite $x.Suite -Work $work -ShowAll:$Full -Port $x.Port
            }
            try { Stop-Process -Id $x.Server.Id -Force -ErrorAction SilentlyContinue } catch { }
        }
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
