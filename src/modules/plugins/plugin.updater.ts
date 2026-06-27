import prisma from '../../db';
import logger from '../../handlers/logger';
import { EventBus } from './plugin.eventbus';
import { PluginRegistry } from './plugin.registry';
import { PluginJobManager } from './plugin.jobmanager';

export class PluginUpdateManager {
  /**
   * Scans all installed plugins on a server and checks if updates are available.
   */
  public static async checkForUpdates(serverId: string): Promise<number> {
    logger.info(`Running plugin update checks for server ${serverId}...`);

    const installed = await prisma.pluginInstall.findMany({
      where: {
        serverId,
        ignoreUpdates: false
      },
      include: { plugin: true }
    });

    let updatesFound = 0;

    for (const record of installed) {
      if (record.pinVersion) continue;

      try {
        const provider = PluginRegistry.getProvider(record.provider);
        if (!provider) continue;

        // Fetch latest version from registry
        const details = await provider.fetch(record.plugin.pluginId);
        
        if (details.latestVersion && details.latestVersion !== record.installedVersion) {
          // Version conflict check
          await prisma.pluginInstall.update({
            where: { id: record.id },
            data: {
              latestVersion: details.latestVersion
            }
          });

          updatesFound++;

          EventBus.emitTyped('plugin.update.available', {
            serverId,
            pluginId: record.plugin.pluginId,
            currentVersion: record.installedVersion,
            latestVersion: details.latestVersion
          });
        }
      } catch (err: any) {
        logger.warn(`Failed checking update for plugin ${record.plugin.name} (${record.plugin.pluginId}): ${err.message}`);
      }
    }

    return updatesFound;
  }

  /**
   * Scans ALL servers for plugin updates. Used by background scheduler.
   */
  public static async checkAllServersForUpdates(): Promise<void> {
    try {
      const servers = await prisma.server.findMany({
        select: { UUID: true }
      });

      logger.info(`Running global scheduled plugin updates check across ${servers.length} servers.`);
      for (const server of servers) {
        await this.checkForUpdates(server.UUID);
      }
    } catch (err: any) {
      logger.error(`Scheduled global update check failed: ${err.message}`);
    }
  }

  /**
   * Triggers updates for multiple plugins concurrently.
   */
  public static async triggerBatchUpdate(
    serverId: string,
    pluginIds: string[]
  ): Promise<{ enqueued: string[]; skipped: string[] }> {
    const enqueued: string[] = [];
    const skipped: string[] = [];

    const records = await prisma.pluginInstall.findMany({
      where: {
        serverId,
        plugin: {
          pluginId: { in: pluginIds }
        }
      },
      include: { plugin: true }
    });

    for (const record of records) {
      if (!record.latestVersion || record.installedVersion === record.latestVersion) {
        skipped.push(record.plugin.name);
        continue;
      }

      try {
        const provider = PluginRegistry.getProvider(record.provider);
        if (!provider) {
          skipped.push(record.plugin.name);
          continue;
        }

        const details = await provider.fetch(record.plugin.pluginId);
        const latestVersionInfo = details.versions.find(v => v.versionNumber === record.latestVersion) || details.versions[0];
        
        const jobId = await PluginJobManager.enqueueJob(
          serverId,
          record.plugin.pluginId,
          latestVersionInfo.versionId,
          record.provider,
          record.plugin.name
        );

        enqueued.push(jobId);
      } catch (err: any) {
        logger.error(`Failed to enqueue update for ${record.plugin.name}: ${err.message}`);
        skipped.push(record.plugin.name);
      }
    }

    return { enqueued, skipped };
  }
}
