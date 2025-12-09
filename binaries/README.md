# Tectonic Binaries

This directory contains platform-specific Tectonic binaries that are bundled with the LaTeX-Workshop extension.

## Directory Structure

- `darwin-x64/` - macOS Intel (x86_64)
- `darwin-arm64/` - macOS Apple Silicon (ARM64)
- `linux-x64/` - Linux x86_64
- `win32-x64/` - Windows x64

## Downloading Binaries

Before packaging the extension, you need to download the Tectonic binaries for all platforms:

```bash
npm run download-tectonic
```

Or manually:

```bash
bash scripts/download-tectonic.sh
```

This will download the latest Tectonic binaries from the official GitHub releases and place them in the appropriate platform directories.

## How It Works

When a user selects the "tectonic" recipe, LaTeX-Workshop will:

1. First try to use the bundled Tectonic binary for the user's platform
2. If the bundled binary is not found, fall back to a system-installed Tectonic (if available)

This ensures users don't need to install anything - the extension works out of the box with the bundled Tectonic, but still supports users who prefer to use their own system installation.

## Updating Tectonic Version

To update to a newer version of Tectonic:

1. Update the `VERSION` variable in `scripts/download-tectonic.sh`
2. Run `npm run download-tectonic` to download the new binaries
3. Test the extension to ensure compatibility

