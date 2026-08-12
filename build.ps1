<#
    Builds the portable, single-file TruckSim Dispatcher executable.

    Output:  publish\TruckSimDispatcher.exe
    Copy that one file to the machine running American Truck Simulator and run it.
    No .NET install, no dependencies, no internet connection required.
#>
[CmdletBinding()]
param(
    [string]$Runtime = 'win-x64',
    [string]$OutDir  = 'publish'
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
