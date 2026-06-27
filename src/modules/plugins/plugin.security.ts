import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import logger from '../../handlers/logger';
import { EventBus } from './plugin.eventbus';

export class PluginSecurityService {
  private static quarantineDir = path.join(__dirname, '../../../../storage/plugins/quarantine');

  public static ensureQuarantineDirectory(): void {
    if (!fs.existsSync(this.quarantineDir)) {
      fs.mkdirSync(this.quarantineDir, { recursive: true });
    }
  }

  /**
   * Performs full layered security scan on a local temporary file.
   * Throws an error with quarantine details if a threat is found.
   */
  public static async scanFile(
    tempFilePath: string,
    filename: string,
    expectedChecksum?: string | null
  ): Promise<{ success: boolean; details: string }> {
    this.ensureQuarantineDirectory();

    // 1. Check file exists and size is positive
    if (!fs.existsSync(tempFilePath)) {
      throw new Error(`File does not exist at ${tempFilePath}`);
    }
    const stats = fs.statSync(tempFilePath);
    if (stats.size === 0) {
      throw new Error('Downloaded file is empty (0 bytes).');
    }

    // 2. Validate Magic Bytes (ZIP / JAR start with 'PK\x03\x04')
    const fd = fs.openSync(tempFilePath, 'r');
    const buffer = Buffer.alloc(4);
    fs.readSync(fd, buffer, 0, 4, 0);
    fs.closeSync(fd);

    const isZip = buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04;
    if (!isZip) {
      this.quarantine(tempFilePath, filename, 'Invalid magic bytes. Not a valid ZIP/JAR file.');
      throw new Error('Security scan failed: File does not start with valid ZIP/JAR magic bytes.');
    }

    // 3. Extract and scan contents
    let zip: AdmZip;
    try {
      zip = new AdmZip(tempFilePath);
    } catch (err: any) {
      this.quarantine(tempFilePath, filename, `Corrupt ZIP structure: ${err.message}`);
      throw new Error('Security scan failed: Archive is corrupt.');
    }

    const zipEntries = zip.getEntries();
    let hasManifest = false;
    let hasPluginYaml = false;
    let obfuscationClassCount = 0;
    let totalClasses = 0;
    const suspiciousApis: string[] = [];

    for (const entry of zipEntries) {
      // ZIP Slip & Directory Traversal Check
      if (entry.entryName.includes('..') || entry.entryName.startsWith('/')) {
        this.quarantine(tempFilePath, filename, `Zip-Slip attempt detected: ${entry.entryName}`);
        throw new Error('Security scan failed: Zip-Slip signature detected.');
      }

      const isSymlink = ((entry.header as any).externalFileAttr & 0xA0000000) === 0xA0000000;
      if (isSymlink) {
        this.quarantine(tempFilePath, filename, `Symlink entry detected: ${entry.entryName}`);
        throw new Error('Security scan failed: Symlinks are forbidden in plugin packages.');
      }

      // Track class files
      if (entry.entryName.endsWith('.class')) {
        totalClasses++;
        
        // Obfuscation check: class names that are extremely short in the root package
        const parts = entry.entryName.split('/');
        const className = parts[parts.length - 1];
        if (className.length <= 8 && parts.length <= 2) {
          obfuscationClassCount++;
        }

        // Classpath heuristics: Scan bytecode for dangerous calls
        try {
          const content = entry.getData().toString('binary');
          
          if (content.includes('java/lang/ProcessBuilder') || content.includes('java/lang/Runtime') && content.includes('exec')) {
            suspiciousApis.push(`${entry.entryName} (Runtime Execution API)`);
          }
          if (content.includes('javax/naming/InitialContext') || content.includes('javax/naming/directory/InitialDirContext')) {
            suspiciousApis.push(`${entry.entryName} (JNDI Context Lookup)`);
          }
          if (content.includes('java/net/URLClassLoader') && content.includes('addURL')) {
            suspiciousApis.push(`${entry.entryName} (Dynamic Classloading API)`);
          }
        } catch {
          // Skip unreadable class files
        }
      }

      // Check plugin descriptors
      if (entry.entryName.toUpperCase().endsWith('MANIFEST.MF')) {
        hasManifest = true;
      }
      const upperName = entry.entryName.toLowerCase();
      if (
        upperName === 'plugin.yml' ||
        upperName === 'paper-plugin.yml' ||
        upperName === 'bungee.yml' ||
        upperName === 'velocity-plugin.json' ||
        upperName === 'mods.toml' ||
        upperName === 'neoforge.mods.toml' ||
        upperName === 'mcmod.info'
      ) {
        hasPluginYaml = true;
      }
    }

    // 4. Heuristic evaluations
    if (totalClasses > 0 && (obfuscationClassCount / totalClasses) > 0.8 && totalClasses > 10) {
      this.quarantine(tempFilePath, filename, 'Suspicious obfuscation heuristic triggered.');
      throw new Error('Security scan failed: High ratio of short/obfuscated class names detected.');
    }

    if (suspiciousApis.length > 5) {
      this.quarantine(
        tempFilePath,
        filename,
        `Suspicious runtime API hooks detected: ${suspiciousApis.slice(0, 3).join(', ')}`
      );
      throw new Error('Security scan failed: Found multiple references to unauthorized runtime APIs (ProcessBuilder/JNDI).');
    }

    return {
      success: true,
      details: `Passed signature scans. Manifests: ${hasManifest ? 'found' : 'none'}, Server Descriptor: ${hasPluginYaml ? 'found' : 'none'}`
    };
  }

  /**
   * Moves the file to a quarantine folder, logs it, and dispatches a security warning.
   */
  private static quarantine(tempFilePath: string, filename: string, reason: string): void {
    const dest = path.join(this.quarantineDir, `${Date.now()}_quarantined_${filename}`);
    try {
      if (fs.existsSync(tempFilePath)) {
        fs.renameSync(tempFilePath, dest);
      }
      logger.error(`Plugin QUARANTINED: ${filename}. Reason: ${reason}`);
      EventBus.emitTyped('plugin.security.failed', {
        serverId: 'system',
        pluginId: 'security_scanner',
        versionId: 'quarantine',
        filename,
        reason
      });
    } catch (err: any) {
      logger.error(`Failed to quarantine file ${tempFilePath}: ${err.message}`);
    }
  }
}
