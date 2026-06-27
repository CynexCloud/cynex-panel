import prisma from '../../db';
import logger from '../../handlers/logger';
import { PluginInstallQueue } from './plugin.queue';
import { EventBus } from './plugin.eventbus';

export class PluginJobManager {
  private static isRunning = false;
  private static activeJobsCount = 0;
  private static maxConcurrency = 2; // Default limit

  /**
   * Initializes the job manager: cleans up stuck jobs and starts the runner loop.
   */
  public static async initialize(): Promise<void> {
    logger.info('Initializing PluginJobManager...');
    
    // Clean up stuck jobs (e.g. from previous panel crash)
    try {
      const stuckJobs = await prisma.pluginJob.findMany({
        where: {
          status: { in: ['preparing', 'downloading', 'scanning', 'verifying', 'installing', 'finalizing'] }
        }
      });

      for (const job of stuckJobs) {
        await prisma.pluginJob.update({
          where: { id: job.id },
          data: {
            status: 'failed',
            error: 'Job aborted due to panel restart.'
          }
        });
      }
      logger.info(`Cleaned up ${stuckJobs.length} stuck plugin installation jobs.`);
    } catch (err: any) {
      logger.warn(`Stuck jobs cleanup failed: ${err.message}`);
    }

    // Load concurrency limit from settings
    try {
      const limitSetting = await prisma.pluginSettings.findUnique({
        where: { key: 'download_concurrency' }
      });
      if (limitSetting) {
        this.maxConcurrency = parseInt(limitSetting.value, 10) || 2;
      }
    } catch {
      // Table might not be ready yet
    }

    // Start runner loop
    this.isRunning = true;
    this.runLoop();
  }

  public static shutdown(): void {
    this.isRunning = false;
  }

  /**
   * Enqueues a new plugin installation job in the database.
   */
  public static async enqueueJob(
    serverId: string,
    pluginId: string,
    versionId: string,
    provider: string,
    name: string
  ): Promise<string> {
    const job = await prisma.pluginJob.create({
      data: {
        serverId,
        pluginId,
        versionId,
        provider,
        name,
        status: 'queued',
        logs: `Queued installation for ${name} (version: ${versionId})\n`
      }
    });

    EventBus.emitTyped('plugin.install.queued', {
      serverId,
      pluginId,
      versionId,
      name
    });

    return job.id;
  }

  /**
   * The infinite loop polling the DB for queued jobs.
   */
  private static async runLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        if (this.activeJobsCount < this.maxConcurrency) {
          // Find next queued job
          const nextJob = await prisma.pluginJob.findFirst({
            where: { status: 'queued' },
            orderBy: { createdAt: 'asc' }
          });

          if (nextJob) {
            // Optimistic lock: update status immediately to avoid race conditions
            this.activeJobsCount++;
            
            await prisma.pluginJob.update({
              where: { id: nextJob.id },
              data: { status: 'preparing' }
            });

            // Process async without blocking loop
            this.executeJob(nextJob);
          }
        }
      } catch (err: any) {
        logger.error(`Error in PluginJobManager loop: ${err.message}`);
      }

      // Wait 1.5 seconds before next poll
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }

  private static async executeJob(job: any): Promise<void> {
    try {
      EventBus.emitTyped('plugin.install.started', {
        serverId: job.serverId,
        pluginId: job.pluginId,
        versionId: job.versionId,
        name: job.name
      });

      await PluginInstallQueue.processInstallation(
        job.id,
        job.serverId,
        job.pluginId,
        job.versionId,
        job.provider,
        job.name
      );
    } catch (err: any) {
      logger.error(`Failed executing plugin install job ${job.id}: ${err.message}`);
    } finally {
      this.activeJobsCount = Math.max(0, this.activeJobsCount - 1);
    }
  }

  /**
   * Cancels a queued job.
   */
  public static async cancelJob(jobId: string): Promise<boolean> {
    const job = await prisma.pluginJob.findUnique({
      where: { id: jobId }
    });

    if (!job || job.status !== 'queued') {
      return false;
    }

    await prisma.pluginJob.update({
      where: { id: jobId },
      data: {
        status: 'cancelled',
        logs: job.logs + `${new Date().toLocaleTimeString()} - Job cancelled by user.\n`
      }
    });

    return true;
  }
}
