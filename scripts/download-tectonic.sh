#!/bin/bash
# Script to download Tectonic binaries for all platforms
# This script should be run before packaging the extension

set -e

VERSION="0.15.0"  # Update to latest version as needed
# Tag format is tectonic@VERSION, URL-encoded as tectonic%40VERSION
TAG="tectonic@${VERSION}"
TAG_ENCODED="tectonic%40${VERSION}"
BASE_URL="https://github.com/tectonic-typesetting/tectonic/releases/download/${TAG_ENCODED}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARIES_DIR="${SCRIPT_DIR}/../binaries"

echo "Downloading Tectonic binaries version ${VERSION}..."

# Create binaries directory if it doesn't exist
mkdir -p "${BINARIES_DIR}"/{darwin-x64,darwin-arm64,linux-x64,win32-x64}

# Download for macOS x64
echo "Downloading macOS x64..."
curl -L "${BASE_URL}/tectonic-${VERSION}-x86_64-apple-darwin.tar.gz" -o /tmp/tectonic-darwin-x64.tar.gz
tar -xzf /tmp/tectonic-darwin-x64.tar.gz -C "${BINARIES_DIR}/darwin-x64"
chmod +x "${BINARIES_DIR}/darwin-x64/tectonic"
rm /tmp/tectonic-darwin-x64.tar.gz

# Download for macOS ARM64
echo "Downloading macOS ARM64..."
curl -L "${BASE_URL}/tectonic-${VERSION}-aarch64-apple-darwin.tar.gz" -o /tmp/tectonic-darwin-arm64.tar.gz
tar -xzf /tmp/tectonic-darwin-arm64.tar.gz -C "${BINARIES_DIR}/darwin-arm64"
chmod +x "${BINARIES_DIR}/darwin-arm64/tectonic"
rm /tmp/tectonic-darwin-arm64.tar.gz

# Download for Linux x64
echo "Downloading Linux x64..."
curl -L "${BASE_URL}/tectonic-${VERSION}-x86_64-unknown-linux-musl.tar.gz" -o /tmp/tectonic-linux-x64.tar.gz
tar -xzf /tmp/tectonic-linux-x64.tar.gz -C "${BINARIES_DIR}/linux-x64"
chmod +x "${BINARIES_DIR}/linux-x64/tectonic"
rm /tmp/tectonic-linux-x64.tar.gz

# Download for Windows x64
echo "Downloading Windows x64..."
curl -L "${BASE_URL}/tectonic-${VERSION}-x86_64-pc-windows-gnu.zip" -o /tmp/tectonic-win-x64.zip
unzip -q /tmp/tectonic-win-x64.zip -d /tmp/tectonic-win-x64
# Move the executable to the correct location
if [ -f "/tmp/tectonic-win-x64/tectonic-${VERSION}-x86_64-pc-windows-gnu/tectonic.exe" ]; then
    cp "/tmp/tectonic-win-x64/tectonic-${VERSION}-x86_64-pc-windows-gnu/tectonic.exe" "${BINARIES_DIR}/win32-x64/"
elif [ -f "/tmp/tectonic-win-x64/tectonic.exe" ]; then
    cp "/tmp/tectonic-win-x64/tectonic.exe" "${BINARIES_DIR}/win32-x64/"
fi
rm -rf /tmp/tectonic-win-x64 /tmp/tectonic-win-x64.zip

echo "✓ All Tectonic binaries downloaded successfully!"
echo ""
echo "Binaries location:"
echo "  macOS x64:    ${BINARIES_DIR}/darwin-x64/tectonic"
echo "  macOS ARM64:  ${BINARIES_DIR}/darwin-arm64/tectonic"
echo "  Linux x64:    ${BINARIES_DIR}/linux-x64/tectonic"
echo "  Windows x64:  ${BINARIES_DIR}/win32-x64/tectonic.exe"

