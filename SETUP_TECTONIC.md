# Setting Up Bundled Tectonic for LaTeX-Workshop

## Quick Start

Follow these steps to complete the Tectonic integration:

### Step 1: Download Tectonic Binaries

Navigate to the LaTeX-Workshop extension directory and download the binaries:

```bash
cd extensions/LaTeX-Workshop
npm run download-tectonic
```

This will download Tectonic v0.15.0 binaries for all platforms (macOS Intel, macOS ARM, Linux, Windows) and place them in the `binaries/` directory.

**Note:** This requires `curl`, `tar`, `unzip`, and `bash` to be available on your system.

### Step 2: Compile TypeScript

Compile the TypeScript code to ensure everything builds correctly:

```bash
npm run compile
```

This compiles both the main extension code and the viewer code.

### Step 3: Verify Binaries

Check that the binaries were downloaded correctly:

```bash
# On macOS/Linux:
ls -lh binaries/*/tectonic*

# On Windows (PowerShell):
Get-ChildItem -Recurse binaries\ | Where-Object {$_.Name -like "*tectonic*"}
```

You should see:
- `binaries/darwin-x64/tectonic`
- `binaries/darwin-arm64/tectonic`
- `binaries/linux-x64/tectonic`
- `binaries/win32-x64/tectonic.exe`

### Step 4: Test the Extension (Optional)

If you want to test the extension:

```bash
# Install dependencies if not already done
npm install

# Run tests
npm test
```

### Step 5: Package the Extension (When Ready)

When you're ready to package the extension for distribution:

```bash
npm run release
```

This will:
1. Clean build artifacts
2. Lint the code
3. Compile TypeScript
4. Package the extension with `vsce package`

## Troubleshooting

### If download script fails:

1. **Check internet connection** - The script downloads from GitHub releases
2. **Verify tools available** - Ensure `curl`, `tar`, and `unzip` are installed
3. **Check Tectonic version** - Verify the version in `scripts/download-tectonic.sh` exists on GitHub
4. **Manual download** - You can manually download binaries from https://github.com/tectonic-typesetting/tectonic/releases

### If compilation fails:

1. **Install dependencies**: `npm install`
2. **Check TypeScript version**: Ensure you have a compatible TypeScript version
3. **Check for errors**: Review the error messages in the terminal

## What Gets Bundled

The following will be included in the extension package:
- All platform binaries in `binaries/` directory
- Compiled JavaScript in `out/` directory
- All necessary configuration files

The source TypeScript files are excluded (as per `.vscodeignore`).

## Updating Tectonic Version

To update to a newer version of Tectonic:

1. Edit `scripts/download-tectonic.sh` and update the `VERSION` variable
2. Run `npm run download-tectonic` again
3. Test the extension to ensure compatibility
4. Update the version in `package.json` if needed

