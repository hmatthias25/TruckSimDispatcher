<#
    Tells us what shape a mod .scs is in, so a reader can be written against the real thing rather
    than against a guess.

    Read-only. Opens the archive, reports the container format, and — if it is an ordinary ZIP —
    lists the definition and locale entries and prints a sample of one so the key format is visible.

    Run it on the machine with ATS installed and paste the output.

      powershell -ExecutionPolicy Bypass -File docs\inspect-mod.ps1

    Point it at a file directly if it cannot find one:

      powershell -ExecutionPolicy Bypass -File docs\inspect-mod.ps1 -Path "D:\...\mod.scs"
#>
[CmdletBinding()]
param([string] $Path)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------- find candidates
function Get-SteamLibraries {
    $roots = @("${env:ProgramFiles(x86)}\Steam", "$env:ProgramFiles\Steam") |
        Where-Object { $_ -and (Test-Path $_) }
    $libs = @($roots)
    foreach ($r in $roots) {
        $vdf = Join-Path $r 'steamapps\libraryfolders.vdf'
        if (Test-Path $vdf) {
            Select-String -Path $vdf -Pattern '"path"\s+"(.+?)"' -AllMatches | ForEach-Object {
                $_.Matches | ForEach-Object { $libs += $_.Groups[1].Value -replace '\\\\', '\' }
            }
        }
    }
    $libs | Select-Object -Unique
}

if (-not $Path) {
    $found = @()
    foreach ($lib in Get-SteamLibraries) {
        $ws = Join-Path $lib 'steamapps\workshop\content\270880'
        if (Test-Path $ws) { $found += Get-ChildItem $ws -Recurse -Filter *.scs -ErrorAction SilentlyContinue }
    }
    $manual = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'American Truck Simulator\mod'
    if (Test-Path $manual) { $found += Get-ChildItem $manual -Filter *.scs -ErrorAction SilentlyContinue }

    if (-not $found) {
        Write-Host 'No .scs found. Pass one with -Path.' -ForegroundColor Yellow
        Write-Host '  Workshop: <library>\steamapps\workshop\content\270880\<id>\'
        Write-Host '  Manual:   Documents\American Truck Simulator\mod\'
        return
    }

    Write-Host ''
    Write-Host '  Mods found:' -ForegroundColor Cyan
    $found | Sort-Object Length -Descending | ForEach-Object {
        '    {0,8:N0} MB  {1}' -f ($_.Length / 1MB), $_.FullName
    }
    # The renaming mod is the big one; take the largest as the default guess.
    $Path = ($found | Sort-Object Length -Descending | Select-Object -First 1).FullName
    Write-Host ''
    Write-Host "  Inspecting the largest: $Path" -ForegroundColor Cyan
}

if (-not (Test-Path $Path)) { throw "No file at $Path" }

# ---------------------------------------------------------------- container format
$fs = [IO.File]::OpenRead($Path)
try {
    $head = New-Object byte[] 4
    [void]$fs.Read($head, 0, 4)
} finally { $fs.Dispose() }

$sig = -join ($head | ForEach-Object { [char]$_ })
Write-Host ''
Write-Host ('  First four bytes: {0}  ({1})' -f (($head | ForEach-Object { '{0:X2}' -f $_ }) -join ' '), $sig)

if ($sig -like 'PK*') {
    Write-Host '  FORMAT: ordinary ZIP — readable with System.IO.Compression.' -ForegroundColor Green
} elseif ($sig -like 'SCS*') {
    Write-Host '  FORMAT: SCS HashFS — needs a reader for that container.' -ForegroundColor Yellow
    Write-Host '  Nothing more can be listed without one. That answer is the useful part.'
    return
} else {
    Write-Host "  FORMAT: unrecognised ($sig)." -ForegroundColor Red
    return
}

# ---------------------------------------------------------------- what is inside
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($Path)
try {
    $all = $zip.Entries
    Write-Host ('  {0:N0} entries in the archive.' -f $all.Count)

    $interesting = $all | Where-Object {
        $_.FullName -match '^(def|locale)/' -and $_.FullName -match '\.(sii|sui|mat)$'
    }
    Write-Host ''
    Write-Host ('  {0:N0} def/ and locale/ entries. Up to 40 of them:' -f $interesting.Count) -ForegroundColor Cyan
    $interesting | Select-Object -First 40 | ForEach-Object { '    {0,9:N0}  {1}' -f $_.Length, $_.FullName }

    # A locale file is where display names usually live. Print the head of the biggest one.
    $locale = $interesting | Where-Object { $_.FullName -match '^locale/' } |
        Sort-Object Length -Descending | Select-Object -First 1
    if ($locale) {
        Write-Host ''
        Write-Host "  Head of $($locale.FullName):" -ForegroundColor Cyan
        $sr = New-Object IO.StreamReader($locale.Open())
        try {
            $first = New-Object byte[] 0
            for ($i = 0; $i -lt 60 -and -not $sr.EndOfStream; $i++) { '    ' + $sr.ReadLine() }
        } finally { $sr.Dispose() }
    }

    # Company definitions name the tokens the locale keys are built from.
    $companyDefs = $all | Where-Object { $_.FullName -match '^def/company/' } | Select-Object -First 25
    if ($companyDefs) {
        Write-Host ''
        Write-Host '  def/company entries (first 25):' -ForegroundColor Cyan
        $companyDefs | ForEach-Object { '    ' + $_.FullName }
    }
} finally { $zip.Dispose() }

Write-Host ''
Write-Host '  Done. Paste the above.' -ForegroundColor Green
