import path from 'path';

export class PluginIsolationService {
  /**
   * Sanitizes a relative path inside a server container.
   * Ensures that it is jailed to either the "/plugins" or "/mods" directories.
   * Returns the clean path relative to the container root, or null if it escapes.
   */
  public static sanitizeAndJailPath(
    userPath: string,
    serverType: string
  ): string | null {
    // 1. Normalize and resolve path separators
    let normalized = userPath.replace(/\\/g, '/');

    // 2. Prevent directory traversal attempts
    if (normalized.includes('..') || normalized.includes('\0')) {
      return null;
    }

    // 3. Ensure it starts with a single forward slash
    if (!normalized.startsWith('/')) {
      normalized = '/' + normalized;
    }

    // 4. Resolve the target directory based on server type (mods vs plugins)
    const isModded = ['fabric', 'forge', 'neoforge', 'sponge', 'arclight', 'mohist'].includes(
      serverType.toLowerCase()
    );
    const allowedRoots = isModded ? ['/mods', '/plugins'] : ['/plugins'];

    // 5. Check if the path is within one of the allowed roots
    const matchedRoot = allowedRoots.find(
      (root) => normalized === root || normalized.startsWith(root + '/')
    );

    if (!matchedRoot) {
      // Default to /plugins if not matched (or /mods for modded)
      const defaultRoot = isModded ? '/mods' : '/plugins';
      return defaultRoot;
    }

    return normalized;
  }
}
