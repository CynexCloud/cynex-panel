import fs from 'fs';
import path from 'path';
import prisma from '../../db';
import logger from '../../handlers/logger';
import { EventBus } from './plugin.eventbus';
import { PluginRegistry } from './plugin.registry';
import { PluginDownloader } from './plugin.downloader';
import { SecurityScanner } from './plugin.scanner';
import { CompatibilityMatrixService } from './plugin.compatibility';
import { PluginInstaller } from './plugin.installer';
import { PluginMetricsService } from './plugin.metrics';

export class PluginInstallQueue {
  private static activeLocks: Set<string> = new Set();

  /**
   * Generates a unique key to prevent concurrent installs of the same plugin on the same server.
   */
  private static getLockKey(serverId: string, pluginId: string): string {
    return `${serverId}_${pluginId}`;
  }

  public static acquireLock(serverId: string, pluginId: string): boolean {
    const key = this.getLockKey(serverId, pluginId);
    if (this.activeLocks.has(key)) {
      return false;
    }
    this.activeLocks.add(key);
    return true;
  }

  public static releaseLock(serverId: string, pluginId: string): void {
    const key = this.getLockKey(serverId, pluginId);
    this.activeLocks.delete(key);
  }

  /**
   * Orchestrates the entire install pipeline:
   * Queued -> Downloading -> Verifying -> Scanning -> Installing -> Completed
   */
  public static async processInstallation(
    jobId: string,
    serverId: string,
    pluginId: string,
    versionId: string,
    providerId: string,
    name: string
  ): Promise<void> {
    const startTime = Date.now();
    let tempFilePath = '';

    const updateJob = async (status: string, progress: number, logLine: string, errorMsg?: string) => {
      logger.info(`[Job ${jobId}] ${status} (${progress}%): ${logLine}`);
      
      // Persist to DB
      await prisma.pluginJob.update({
        where: { id: jobId },
        data: {
          status,
          progress,
          logs: {
            // Append log line
            async getLogs() {
              const job = await prisma.pluginJob.findUnique({ where: { id: jobId } });
              return (job?.logs || '') + `${new Date().toLocaleTimeString()} - ${logLine}\n`;
            }
          }.getLogs ? await {
            async getLogs() {
              const job = await prisma.pluginJob.findUnique({ where: { id: jobId } });
              return (job?.logs || '') + `${new Date().toLocaleTimeString()} - ${logLine}\n`;
            }
          }.getLogs() : logLine,
          error: errorMsg || null
        }
      });

      // Emit events
      EventBus.emitTyped('plugin.install.progress', {
        serverId,
        pluginId,
        versionId,
        name,
        stage: status,
        progress,
        logs: logLine
      });
    };

    try {
      // 1. Acquire concurrency lock
      if (!this.acquireLock(serverId, pluginId)) {
        throw new Error(`An installation for plugin "${name}" is already in progress on this server.`);
      }

      await updateJob('preparing', 5, 'Resolving environment and compatibility variables...');

      // 2. Fetch server and environments
      const server = await prisma.server.findUnique({
        where: { UUID: serverId },
        include: { image: true }
      });
      if (!server) {
        throw new Error(`Server ${serverId} not found.`);
      }

      const serverEnv = CompatibilityMatrixService.resolveServerEnvironment(server);
      onProgressCheck: {
        await updateJob('preparing', 10, `Resolved environment: Running ${serverEnv.software} on Minecraft ${serverEnv.minecraftVersion} (Java ${serverEnv.javaVersion})`);
      }

      // 3. Resolve Provider details
      const provider = PluginRegistry.getProvider(providerId);
      if (!provider) {
        throw new Error(`Plugin provider "${providerId}" is currently offline or unregistered.`);
      }

      // 4. Retrieve metadata and validate compatibility
      await updateJob('preparing', 20, 'Fetching plugin metadata from provider registry...');
      const details = await provider.fetch(pluginId);
      const version = details.versions.find((v) => v.versionId === versionId) || details.versions[0];
      if (!version) {
        throw new Error(`Requested version ID ${versionId} was not found on registry.`);
      }

      // 5. Pre-install checks: Compatibility check
      await updateJob('preparing', 25, 'Validating platform, Java, and version compatibility...');
      const compResult = CompatibilityMatrixService.validateCompatibility(
        version.gameVersions || [],
        details.supportedPlatforms || [],
        serverEnv
      );

      if (!compResult.compatible) {
        if (compResult.isWarning) {
          await updateJob('preparing', 28, `[WARNING] Compatibility check reported concerns: ${compResult.reason}`);
        } else {
          throw new Error(`Compatibility check failed: ${compResult.reason}`);
        }
      } else {
        await updateJob('preparing', 30, 'Compatibility check passed successfully.');
      }

      // 6. Download file
      await updateJob('downloading', 35, `Starting download from provider mirror: ${version.downloadUrl}`);
      const downloadResult = await PluginDownloader.downloadAsset(
        providerId,
        version.downloadUrl,
        version.fileName,
        (percent, bytes) => {
          updateJob(
            'downloading',
            35 + Math.round((percent / 100) * 30),
            `Downloading plugin package: ${percent}% completed (${(bytes / 1024).toFixed(1)} KB)`
          );
        }
      );
      tempFilePath = downloadResult.tempFilePath;

      // 7. Security scan
      await updateJob('scanning', 70, 'Running security scans (integrity checks, zip-slip detection, API filters)...');
      const scanResult = await SecurityScanner.scan(tempFilePath, version.fileName, version.checksum);
      if (!scanResult.passed) {
        throw new Error(`Security scanner quarantined the file: ${scanResult.reason}`);
      }
      await updateJob('verifying', 75, 'Integrity verification passed successfully.');

      // 8. Deploy to server
      await updateJob('installing', 80, 'Deploying plugin file into server container...');
      const installedPaths = await PluginInstaller.installPlugin(
        serverId,
        tempFilePath,
        version.fileName,
        serverEnv.software,
        (stage, progress, log) => {
          updateJob(stage, progress, log);
        }
      );

      // 9. Update local database of installed plugins
      await updateJob('finalizing', 95, 'Recording installation record to database metadata store...');

      // Find or create plugin record
      let pluginRecord = await prisma.plugin.findUnique({
        where: { pluginId }
      });
      if (!pluginRecord) {
        pluginRecord = await prisma.plugin.create({
          data: {
            pluginId,
            name: details.name,
            description: details.description,
            author: details.author,
            iconUrl: details.iconUrl,
            provider: providerId
          }
        });
      }

      // Upsert installation status
      const existingInstall = await prisma.pluginInstall.findFirst({
        where: {
          serverId,
          plugin: {
            pluginId: pluginId
          }
        }
      });

      await prisma.pluginInstall.upsert({
        where: {
          id: existingInstall?.id || '00000000-0000-0000-0000-000000000000'
        },
        create: {
          serverId,
          pluginId: pluginRecord.id,
          installedVersion: version.versionNumber,
          latestVersion: details.latestVersion,
          provider: providerId,
          status: 'completed',
          progress: 100,
          logs: `Installed version ${version.versionNumber}`
        },
        update: {
          installedVersion: version.versionNumber,
          latestVersion: details.latestVersion,
          status: 'completed',
          progress: 100,
          updatedAt: new Date()
        }
      });

      // Record success log
      await prisma.pluginUpdateLog.create({
        data: {
          pluginId,
          serverId,
          fromVersion: 'None',
          toVersion: version.versionNumber,
          status: 'success'
        }
      });

      // Record telemetry metrics
      PluginMetricsService.recordInstallDuration(Date.now() - startTime);

      await updateJob('completed', 100, `Successfully installed ${name} to server!`);

    } catch (err: any) {
      // Record failure log
      await prisma.pluginUpdateLog.create({
        data: {
          pluginId,
          serverId,
          fromVersion: 'Unknown',
          toVersion: versionId,
          status: 'failed',
          error: err.message
        }
      });

      await updateJob('failed', 100, `[CRITICAL ERROR] Installation failed: ${err.message}`, err.message);
      EventBus.emitTyped('plugin.install.failed', {
        serverId,
        pluginId,
        versionId,
        name,
        error: err.message
      });
    } finally {
      // Clean up temp file
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath);
        } catch (cleanupErr: any) {
          logger.warn(`Failed to clean up temporary file at ${tempFilePath}: ${cleanupErr.message}`);
        }
      }
      this.releaseLock(serverId, pluginId);
    }
  }
}
