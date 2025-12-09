import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'
import { lw } from '../lw'

const logger = lw.log('Tectonic')

interface PlatformInfo {
    platform: string
    arch: string
    binaryName: string
}

/**
 * Detects the current platform and returns platform-specific information.
 */
function getPlatformInfo(): PlatformInfo {
    const platform = os.platform()
    const arch = os.arch()

    let platformDir: string
    let binaryName: string

    if (platform === 'darwin') {
        platformDir = arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64'
        binaryName = 'tectonic'
    } else if (platform === 'linux') {
        platformDir = 'linux-x64'
        binaryName = 'tectonic'
    } else if (platform === 'win32') {
        platformDir = 'win32-x64'
        binaryName = 'tectonic.exe'
    } else {
        throw new Error(`Unsupported platform: ${platform}-${arch}`)
    }

    return {
        platform: platformDir,
        arch,
        binaryName
    }
}

/**
 * Gets the path to the Tectonic binary, with fallback logic:
 * 1. Try bundled binary in extension
 * 2. Fall back to system-installed Tectonic
 *
 * @returns The path to the Tectonic binary
 */
export function getTectonicPath(): string {
    const platformInfo = getPlatformInfo()

    // Try bundled binary first
    const bundledPath = path.join(
        lw.extensionRoot,
        'binaries',
        platformInfo.platform,
        platformInfo.binaryName
    )

    // Check if bundled binary exists
    try {
        if (fs.existsSync(bundledPath)) {
            // Make executable on Unix systems
            if (os.platform() !== 'win32') {
                try {
                    fs.chmodSync(bundledPath, 0o755)
                } catch (err) {
                    logger.log(`Warning: Could not make ${bundledPath} executable: ${err}`)
                }
            }
            logger.log(`Using bundled Tectonic: ${bundledPath}`)
            return bundledPath
        }
    } catch (err) {
        logger.log(`Error checking bundled Tectonic: ${err}`)
    }

    // Fall back to system-installed Tectonic
    logger.log(`Bundled Tectonic not found at ${bundledPath}, using system-installed Tectonic`)
    return 'tectonic'
}

/**
 * Checks if the bundled Tectonic binary exists.
 *
 * @returns True if the bundled binary exists, false otherwise
 */
export function hasBundledTectonic(): boolean {
    const platformInfo = getPlatformInfo()
    const bundledPath = path.join(
        lw.extensionRoot,
        'binaries',
        platformInfo.platform,
        platformInfo.binaryName
    )
    return fs.existsSync(bundledPath)
}

