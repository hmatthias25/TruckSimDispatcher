<#
    Builds the portable, single-file TruckSim Dispatcher executable.

    Output:  publish\TruckSimDispatcher.exe
    Copy that one file to the machine running American Truck Simulator and run it.
    No .NET install, no dependencies, no internet connection required.
#>
[CmdletBinding()]
param(
    [string]$Runtime = 'win-x64',
    [string]$OutDir  = 'publish',

    # Stage the shipped documents beside the exe and zip the lot. Without this the release is the exe
    # on its own, which is how v0.44 went out missing both manuals and the README — assembling the zip
    # by hand meant remembering four things every time, and the fourth release forgot three of them.
    [switch]$Package,

    # Where the zip lands. Default keeps it out of the repo.
    [string]$ZipDir = (Join-Path $env:USERPROFILE 'Downloads')
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host ''
Write-Host '  Building TruckSim Dispatcher (portable single file)' -ForegroundColor Yellow
Write-Host "  runtime: $Runtime" -ForegroundColor DarkGray
Write-Host ''

if (Test-Path $OutDir) { Remove-Item $OutDir -Recurse -Force }

dotnet publish TruckSimDispatcher.csproj `
    -c Release `
    -r $Runtime `
    --self-contained true `
    -p:PublishSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:EnableCompressionInSingleFile=true `
    -p:DebugType=none `
    -o $OutDir

if ($LASTEXITCODE -ne 0) { throw "publish failed with exit code $LASTEXITCODE" }

# A single-file publish still drops a .pdb next to the exe; the exe alone is what ships.
Get-ChildItem $OutDir -Filter *.pdb -ErrorAction SilentlyContinue | Remove-Item -Force

$exe = Join-Path $OutDir 'TruckSimDispatcher.exe'
$size = [math]::Round((Get-Item $exe).Length / 1MB, 1)

Write-Host ''
Write-Host "  Done: $exe  ($size MB)" -ForegroundColor Green
Write-Host ''
Write-Host '  Copy that single file anywhere and double-click it.' -ForegroundColor Gray
Write-Host '  It creates a "data" folder beside itself for the career file.' -ForegroundColor Gray
Write-Host ''

if ($Package) {
    # Everything that ships. Named rather than globbed so a missing manual is an error you see here,
    # not a thin zip somebody notices after downloading it.
    $shipped = @(
        'docs\manual\TruckSim-Dispatcher-User-Manual.pdf',
        'docs\manual\TruckSim-Dispatcher-Operations-Manual.pdf',
        'README.md'
    )

    foreach ($f in $shipped) {
        if (-not (Test-Path $f)) {
            throw "Cannot package: $f is missing. Rebuild the manuals (docs\manual\render.py) first."
        }
        # Copied INTO the publish folder. The exe is never copied out of it — Defender locks the freshly
        # written single-file host, and a copy of it is what fails, not the original.
        Copy-Item $f -Destination $OutDir -Force
    }

    $version = (Select-String -Path 'Services\Build.cs' -Pattern 'Version\s*=\s*"([^"]+)"').Matches[0].Groups[1].Value
    $stage   = (Select-String -Path 'Services\Build.cs' -Pattern 'Stage\s*=\s*"([^"]+)"').Matches[0].Groups[1].Value
    $name    = "TruckSimDispatcher-v$version-$stage.zip"

    # Built in TEMP and moved, so a half-written zip never sits in the download folder looking finished.
    $staged = Join-Path $env:TEMP $name
    if (Test-Path $staged) { Remove-Item $staged -Force }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
        (Resolve-Path $OutDir), $staged,
        [System.IO.Compression.CompressionLevel]::Optimal, $false)

    # Read it back before it goes anywhere. An archive that does not contain what it should is worse
    # than a failed build, because it looks like a release.
    $zip = [System.IO.Compression.ZipFile]::OpenRead($staged)
    $names = $zip.Entries | ForEach-Object { $_.FullName }
    $zip.Dispose()

    $expected = @('TruckSimDispatcher.exe') + ($shipped | ForEach-Object { Split-Path $_ -Leaf })
    $absent = $expected | Where-Object { $names -notcontains $_ }
    if ($absent) { throw "Zip is missing: $($absent -join ', ')" }

    if (-not (Test-Path $ZipDir)) { New-Item -ItemType Directory $ZipDir | Out-Null }
    $final = Join-Path $ZipDir $name
    Move-Item $staged $final -Force

    $zipMb = [math]::Round((Get-Item $final).Length / 1MB, 1)
    Write-Host "  Packaged: $final  ($zipMb MB)" -ForegroundColor Green
    $names | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    Write-Host ''
}
