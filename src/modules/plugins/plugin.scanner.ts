import { PluginSecurityService } from './plugin.security';
import logger from '../../handlers/logger';

export class SecurityScanner {
  /**
   * Scans a downloaded plugin jar for security violations.
   * Logs results and handles quarantine.
   */
  public static async scan(
    tempFilePath: string,
    filename: string,
    expectedChecksum?: string | null
  ): Promise<{ passed: boolean; reason?: string }> {
    try {
      logger.info(`Starting security scan for ${filename} at ${tempFilePath}`);
      const result = await PluginSecurityService.scanFile(tempFilePath, filename, expectedChecksum);
      logger.info(`Security scan passed for ${filename}: ${result.details}`);
      return { passed: true };
    } catch (err: any) {
      logger.error(`Security scan FAILED for ${filename}: ${err.message}`);
      return {
        passed: false,
        reason: err.message
      };
    }
  }
}
