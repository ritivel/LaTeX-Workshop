# Script to download Tectonic binary for Windows
# Run: npm run download-tectonic-win

$ErrorActionPreference = "Stop"

$VERSION = "0.15.0"
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$BINARIES_DIR = Join-Path $SCRIPT_DIR "..\binaries\win32-x64"

Write-Host "Downloading Tectonic $VERSION for Windows x64..."

# Create binaries directory if it doesn't exist
New-Item -ItemType Directory -Force -Path $BINARIES_DIR | Out-Null

# Navigate to binaries directory
Push-Location $BINARIES_DIR

try {
    # Backup existing tectonic.exe if present
    if (Test-Path "tectonic.exe") {
        Write-Host "Backing up existing tectonic.exe..."
        Move-Item -Force "tectonic.exe" "tectonic.exe.bak"
    }

    # Use the official Tectonic drop installer (statically linked binary)
    Write-Host "Downloading from official Tectonic release..."
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
    iex ((New-Object System.Net.WebClient).DownloadString('https://drop-ps1.fullyjustified.net'))

    # Verify installation
    if (Test-Path "tectonic.exe") {
        $version = & .\tectonic.exe --version 2>&1
        Write-Host ""
        Write-Host "Tectonic downloaded successfully!" -ForegroundColor Green
        Write-Host "  Version: $version"
        Write-Host "  Location: $BINARIES_DIR\tectonic.exe"

        # Clean up backup if new version works
        if (Test-Path "tectonic.exe.bak") {
            Remove-Item "tectonic.exe.bak" -Force
        }
    } else {
        throw "tectonic.exe not found after download"
    }
} finally {
    Pop-Location
}
