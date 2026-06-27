import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { DownloadAsset } from './plugin.types';
import { ProviderHealthMonitor } from './plugin.health';
import logger from '../../handlers/logger';

export class PluginDownloader {
  private static tempDir = path.join(__dirname, '../../../../storage/plugins/temp');

  public static ensureTempDirectory(): void {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Downloads a plugin asset from a URL to a temporary local path.
   * Reports progress and logs events.
   * Uses exponential retry backoff.
   */
  public static async downloadAsset(
    providerId: string,
    url: string,
    filename: string,
    onProgress?: (progress: number, bytesDownloaded: number) => void
  ): Promise<{ tempFilePath: string; size: number }> {
    this.ensureTempDirectory();

    // Clean filename to prevent injection/path traversal
    const safeFilename = path.basename(filename).replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const tempFilePath = path.join(this.tempDir, `${Date.now()}_${safeFilename}`);

    const maxRetries = 3;
    let attempt = 0;
    let lastError: any = null;

    while (attempt < maxRetries) {
      const startTime = Date.now();
      try {
        const response = await axios({
          method: 'GET',
          url: url,
          responseType: 'stream',
          timeout: 45000, // 45 second timeout
          headers: {
            'User-Agent': 'CynexPanel-PluginInstaller/2.0.0'
          }
        });

        const totalLength = parseInt(String(response.headers['content-length'] || '0'), 10);
        let downloadedBytes = 0;

        const writer = fs.createWriteStream(tempFilePath);
        response.data.pipe(writer);

        await new Promise<void>((resolve, reject) => {
          response.data.on('data', (chunk: Buffer) => {
            downloadedBytes += chunk.length;
            if (totalLength > 0 && onProgress) {
              const progress = Math.min(100, Math.round((downloadedBytes / totalLength) * 100));
              onProgress(progress, downloadedBytes);
            }
          });

          writer.on('finish', () => {
            resolve();
          });

          writer.on('error', (err) => {
            reject(err);
          });

          response.data.on('error', (err: any) => {
            reject(err);
          });
        });

        const latency = Date.now() - startTime;
        ProviderHealthMonitor.recordRequest(providerId, latency, true);

        return {
          tempFilePath,
          size: downloadedBytes
        };
      } catch (err: any) {
        attempt++;
        lastError = err;
        const latency = Date.now() - startTime;
        ProviderHealthMonitor.recordRequest(providerId, latency, false);

        logger.warn(`Download attempt ${attempt}/${maxRetries} failed for ${url}: ${err.message}`);

        // Wait with exponential backoff (e.g. 1s, 2s, 4s)
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
        }
      }
    }

    // If we get here, all attempts failed
    throw new Error(`Failed to download plugin after ${maxRetries} retries. Last error: ${lastError?.message}`);
  }
}
