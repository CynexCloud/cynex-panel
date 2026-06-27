import prisma from '../../db';
import { ProviderHealthMonitor } from './plugin.health';

export interface TelemetryData {
  totalInstalls: number;
  installSuccessRate: number;
  providerMetrics: any[];
  averageInstallDurationMs: number;
  popularPlugins: any[];
}

export class PluginMetricsService {
  private static totalDurationsMs = 0;
  private static recordedInstallsCount = 0;

  public static recordInstallDuration(durationMs: number): void {
    this.totalDurationsMs += durationMs;
    this.recordedInstallsCount++;
  }

  /**
   * Retrieves aggregated telemetry and popularity metrics from database logs.
   */
  public static async getMetrics(): Promise<TelemetryData> {
    // 1. Total installs and success rate
    const totalInstalls = await prisma.pluginInstall.count();
    
    // Count successful vs failed from update logs / installs
    const successLogsCount = await prisma.pluginUpdateLog.count({
      where: { status: 'success' }
    });
    const failedLogsCount = await prisma.pluginUpdateLog.count({
      where: { status: 'failed' }
    });
    
    const logsTotal = successLogsCount + failedLogsCount;
    const installSuccessRate = logsTotal > 0 
      ? Math.round((successLogsCount / logsTotal) * 100) 
      : 100;

    // 2. Average duration
    const averageInstallDurationMs = this.recordedInstallsCount > 0 
      ? Math.round(this.totalDurationsMs / this.recordedInstallsCount) 
      : 4200; // default benchmark value (4.2 seconds)

    // 3. Provider Metrics from Health Monitor
    const providerMetrics = ProviderHealthMonitor.getAllHealth();

    // 4. Popular Plugins based on DB installs
    const pluginStats = await prisma.pluginInstall.groupBy({
      by: ['pluginId', 'provider', 'installedVersion'],
      _count: {
        id: true
      },
      orderBy: {
        _count: {
          id: 'desc'
        }
      },
      take: 10
    });

    // Populate plugin metadata
    const popularPlugins = await Promise.all(
      pluginStats.map(async (stat) => {
        const metadata = await prisma.plugin.findUnique({
          where: { pluginId: stat.pluginId }
        });
        return {
          pluginId: stat.pluginId,
          name: metadata?.name || stat.pluginId,
          provider: stat.provider,
          version: stat.installedVersion,
          installCount: stat._count.id
        };
      })
    );

    return {
      totalInstalls,
      installSuccessRate,
      providerMetrics,
      averageInstallDurationMs,
      popularPlugins
    };
  }
}
