# PowerShell script to bundle Visual C++ Runtime DLLs with Tectonic
# Run this on a Windows system after downloading tectonic.exe

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BinariesDir = Join-Path $ScriptDir "..\binaries\win32-x64"

# Required VC++ Runtime DLLs
$RequiredDlls = @(
    "vcruntime140.dll",
    "vcruntime140_1.dll",  # Required for VS 2019+ builds
    "msvcp140.dll"
)

# Possible source locations for DLLs
$DllSources = @(
    "$env:SystemRoot\System32",
    "$env:ProgramFiles\Microsoft Visual Studio\*\*\VC\Redist\MSVC\*\x64\Microsoft.VC*.CRT",
    "$env:ProgramFiles(x86)\Microsoft Visual Studio\*\*\VC\Redist\MSVC\*\x64\Microsoft.VC*.CRT"
)

Write-Host "Bundling VC++ Runtime DLLs for Tectonic..." -ForegroundColor Cyan
Write-Host "Target directory: $BinariesDir"

foreach ($dll in $RequiredDlls) {
    $found = $false

    # Try System32 first (most reliable)
    $systemDll = Join-Path $env:SystemRoot "System32\$dll"
    if (Test-Path $systemDll) {
        Write-Host "  Copying $dll from System32..." -ForegroundColor Green
        Copy-Item $systemDll -Destination $BinariesDir -Force
        $found = $true
    }

    # If not in System32, try Visual Studio directories
    if (-not $found) {
        foreach ($source in $DllSources) {
            $paths = Get-ChildItem -Path $source -Filter $dll -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($paths) {
                Write-Host "  Copying $dll from $($paths.DirectoryName)..." -ForegroundColor Green
                Copy-Item $paths.FullName -Destination $BinariesDir -Force
                $found = $true
                break
            }
        }
    }

    if (-not $found) {
        Write-Host "  WARNING: $dll not found! Tectonic may not work without it." -ForegroundColor Yellow
        Write-Host "          Install Visual C++ Redistributable: https://aka.ms/vs/17/release/vc_redist.x64.exe" -ForegroundColor Yellow
    }
}

# Verify tectonic.exe exists
$tectonicExe = Join-Path $BinariesDir "tectonic.exe"
if (Test-Path $tectonicExe) {
    Write-Host ""
    Write-Host "Testing tectonic.exe..." -ForegroundColor Cyan
    try {
        $version = & $tectonicExe --version 2>&1
        Write-Host "  SUCCESS: $version" -ForegroundColor Green
    } catch {
        Write-Host "  ERROR: tectonic.exe failed to run. Missing DLLs?" -ForegroundColor Red
        Write-Host "  Error: $_" -ForegroundColor Red
    }
} else {
    Write-Host ""
    Write-Host "WARNING: tectonic.exe not found in $BinariesDir" -ForegroundColor Yellow
    Write-Host "Run 'npm run download-tectonic' first." -ForegroundColor Yellow
}

# Create fontconfig file to suppress fontconfig warnings on Windows
$fontconfigFile = Join-Path $BinariesDir "fonts.conf"
if (-not (Test-Path $fontconfigFile)) {
    Write-Host ""
    Write-Host "Creating fontconfig file to suppress warnings..." -ForegroundColor Cyan
    @"
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>.</dir>
  <cachedir>.</cachedir>
</fontconfig>
"@ | Out-File -FilePath $fontconfigFile -Encoding UTF8
    Write-Host "  Created: fonts.conf" -ForegroundColor Green
    Write-Host "  Note: Set FONTCONFIG_FILE environment variable to this file path if needed" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Done! Files in $BinariesDir :" -ForegroundColor Cyan
Get-ChildItem $BinariesDir | ForEach-Object { Write-Host "  - $($_.Name)" }



