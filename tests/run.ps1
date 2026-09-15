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

$runStarted = Get-Date

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

    # ---- is the server listening yet?
    #
    # This is the single most expensive thing the runner does, and it was not obvious. A connection to a
    # local port with nothing behind it does NOT fail fast on Windows — it sits in SYN retry for about
    # TWO SECONDS. The readiness probe used Invoke-RestMethod, so every pass of the poll loop blocked for
    # two seconds per server that had not finished booting, serialized, in a single-threaded shell. With
    # eight or twelve servers coming up at once that is sixteen to twenty-four seconds of the harness
    # doing nothing, over and over, while the machine sat idle.
    #
    # Measured: 2049 ms per failed probe that way, 111 ms capped like this. The suites were never slow.
    function Test-ServerUp {
        param([int] $Port)
        $c = [System.Net.Sockets.TcpClient]::new()
        try {
            $iar = $c.BeginConnect('127.0.0.1', $Port, $null, $null)
            if (-not $iar.AsyncWaitHandle.WaitOne(100)) { return $false }
            $c.EndConnect($iar)
            return $true
        } catch { return $false } finally { $c.Close() }
    }

    # ---- run as a rolling pool. Each suite gets its own port and career file, so the only thing
    # shared is the machine.
    #
    # This used to go in lock-step batches of $width: start eight servers, wait for all eight, run
    # eight tests, wait for all eight, tear all eight down, then begin the next lot. Every barrier in
    # that sentence is paid at the speed of the slowest member, three times per batch, and there are
    # thirteen batches. Measured: 150s of wall clock for 344s of suite time across eight workers —
    # where perfect packing is 43s. The suites were never the problem; the waiting between them was.
    #
    # A slot now refills the moment it empties, and a server boots while its neighbours are still
    # testing. Nothing waits for anything it does not need.
    $width = [Math]::Max(1, $Parallel)
    $pending = [System.Collections.Generic.Queue[object]]::new()
    foreach ($suite in $suites) { $pending.Enqueue($suite) }
    $live = [System.Collections.ArrayList]::new()
    $done = @{}

    # Booting servers AHEAD of the tests that will use them was tried and is worse: 4 of lookahead took
    # the run from 88s to 89s and suite time from 467s to 622s. A server coming up is not free — it is a
    # second of JIT on a machine that is already the constraint — so hiding the boot just moved the cost
    # onto the tests that were running. Left at zero with the measurement written down, because it is
    # exactly the change somebody reaches for next.
    $lookahead = 0

    while ($pending.Count -gt 0 -or $live.Count -gt 0) {
        $running = @($live | Where-Object { $_.Node -and -not $_.Node.HasExited }).Count

        # 1. fill any free slot. Booting a server is the slow part, so it starts as early as it can.
        while ($live.Count -lt ($width + $lookahead) -and $pending.Count -gt 0) {
            $suite = $pending.Dequeue()
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

            [void]$live.Add([pscustomobject]@{
                Suite = $suite; Port = $port; Data = $data; Server = $server; Node = $null;
                Up = $false; Err = $err; Deadline = (Get-Date).AddSeconds(30);
                Started = (Get-Date); Seconds = 0 })
        }

        # 2. any server that has come up gets its test launched. Start-Process snapshots the
        # environment as it launches, so the two variables are set immediately before each call.
        foreach ($x in @($live | Where-Object { -not $_.Node })) {
            # Only $width tests run at once, however many servers are warm behind them.
            if ($x.Up -and $running -ge $width) { continue }
            if ($x.Up -or (Test-ServerUp -Port $x.Port)) {
                $x.Up = $true
            } else {
                if ((Get-Date) -gt $x.Deadline) {
                    Write-Host ("  {0,-14} SERVER DID NOT START" -f $x.Suite.BaseName) -ForegroundColor Red
                    Get-Content $x.Err -ErrorAction SilentlyContinue | Select-Object -First 8 |
                        ForEach-Object { Write-Host "      $_" -ForegroundColor DarkRed }
                    $done[$x.Suite.BaseName] = [pscustomobject]@{
                        Suite = $x.Suite.BaseName; Pass = 0; Fail = 1; Note = 'no server'; Seconds = 0 }
                    try { Stop-Process -Id $x.Server.Id -Force -ErrorAction SilentlyContinue } catch { }
                    $live.Remove($x)
                }
                continue
            }

            $sout = Join-Path $work "$($x.Suite.BaseName).node.log"
            $env:TSD_DATA_DIR = $x.Data
            $env:TSD_PORT = $x.Port
            $x.Started = Get-Date
            $x.Node = Start-Process -FilePath 'node' -PassThru -NoNewWindow `
                -ArgumentList $x.Suite.FullName `
                -RedirectStandardOutput $sout -RedirectStandardError "$sout.err"
            $running++          # counted here, or one pass could launch the whole lookahead at once
        }

        # 3. reap whatever has finished, freeing the slot for the next suite immediately.
        foreach ($x in @($live | Where-Object { $_.Node -and $_.Node.HasExited })) {
            $x.Seconds = [Math]::Round(((Get-Date) - $x.Started).TotalSeconds, 1)
            $done[$x.Suite.BaseName] = [pscustomobject]@{
                Suite = $x.Suite.BaseName; Port = $x.Port; Seconds = $x.Seconds; Ran = $true }
            try { Stop-Process -Id $x.Server.Id -Force -ErrorAction SilentlyContinue } catch { }
            $live.Remove($x)
        }

        # Only rest when there is genuinely nothing to start. Sleeping while a slot is free is how the
        # whole run ends up idling a little at a time.
        if ($live.Count -gt 0 -and ($pending.Count -eq 0 -or $live.Count -ge ($width + $lookahead))) {
            Start-Sleep -Milliseconds 40
        }
    }

    # ---- report in suite order, whatever order they finished in. Reading the logs is cheap and the
    # files are already on disk, so this costs nothing and keeps the output stable between runs.
    foreach ($suite in $suites) {
        $d = $done[$suite.BaseName]
        if (-not $d -or -not $d.Ran) { if ($d) { $results += $d }; continue }
        $r = Read-SuiteResult -Suite $suite -Work $work -ShowAll:$Full -Port $d.Port
        $r | Add-Member -NotePropertyName Seconds -NotePropertyValue $d.Seconds -Force
        $results += $r
    }

    Remove-Item Env:\TSD_DATA_DIR, Env:\TSD_PORT -ErrorAction SilentlyContinue

    $totalPass = ($results | Measure-Object -Property Pass -Sum).Sum
    $totalFail = ($results | Measure-Object -Property Fail -Sum).Sum

    Write-Host ""
    # The long poles, because a run is only ever as fast as these. Printed always: a suite that has
    # quietly grown into a minute is the kind of thing nobody looks for until the whole run is slow.
    $slow = @($results | Where-Object { $_.Seconds -gt 0 } | Sort-Object Seconds -Descending | Select-Object -First 8)
    if ($slow.Count -gt 0) {
        $wall = [Math]::Round(((Get-Date) - $runStarted).TotalSeconds, 1)
        $work2 = ($results | Measure-Object -Property Seconds -Sum).Sum
        Write-Host ("slowest: " + (($slow | ForEach-Object { "{0} {1}s" -f $_.Suite, $_.Seconds }) -join '  ')) -ForegroundColor DarkGray
        Write-Host ("{0}s wall, {1}s of suite time across {2} suites at width {3}" -f `
            $wall, [Math]::Round($work2, 1), $results.Count, [Math]::Max(1, $Parallel)) -ForegroundColor DarkGray
    }
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
