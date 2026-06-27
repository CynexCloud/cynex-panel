import { EventBus } from './plugin.eventbus';

export interface ProviderHealth {
  id: string;
  name: string;
  status: 'healthy' | 'degraded' | 'offline';
  latencyMs: number;
  successRate: number;
  lastChecked: Date;
  errorCount: number;
}

class ProviderHealthMonitorService {
  private healthStore: Map<string, ProviderHealth> = new Map();

  constructor() {
    // Initialize default providers
    const providers = [
      { id: 'modrinth', name: 'Modrinth Registry' },
      { id: 'hangar', name: 'Paper Hangar' },
      { id: 'spiget', name: 'SpigotMC (Spiget)' },
      { id: 'github', name: 'GitHub Releases' },
      { id: 'custom', name: 'Custom URLs' }
    ];

    for (const p of providers) {
      this.healthStore.set(p.id, {
        id: p.id,
        name: p.name,
        status: 'healthy',
        latencyMs: 0,
        successRate: 100,
        lastChecked: new Date(),
        errorCount: 0
      });
    }
  }

  public getHealth(providerId: string): ProviderHealth | undefined {
    return this.healthStore.get(providerId);
  }

  public getAllHealth(): ProviderHealth[] {
    return Array.from(this.healthStore.values());
  }

  public recordRequest(providerId: string, latencyMs: number, success: boolean): void {
    const health = this.healthStore.get(providerId);
    if (!health) return;

    health.lastChecked = new Date();
    
    // Update latency with exponential moving average (EMA)
    health.latencyMs = health.latencyMs === 0 
      ? latencyMs 
      : Math.round(health.latencyMs * 0.7 + latencyMs * 0.3);

    if (success) {
      health.errorCount = Math.max(0, health.errorCount - 1);
      health.successRate = Math.min(100, health.successRate + 5);
    } else {
      health.errorCount++;
      health.successRate = Math.max(0, health.successRate - 15);
      
      // Emit warning/error through event bus
      EventBus.emit('plugin.install.progress', {
        serverId: 'system',
        pluginId: 'health_check',
        versionId: providerId,
        name: health.name,
        stage: 'provider_health_warning',
        progress: 0,
        logs: `[WARNING] Health degradation on provider: ${health.name} (Error count: ${health.errorCount})`
      });
    }

    // Determine status
    if (health.errorCount >= 10 || health.successRate < 40) {
      health.status = 'offline';
    } else if (health.errorCount >= 3 || health.successRate < 80 || health.latencyMs > 3000) {
      health.status = 'degraded';
    } else {
      health.status = 'healthy';
    }
  }

  public isAvailable(providerId: string): boolean {
    const health = this.healthStore.get(providerId);
    return health ? health.status !== 'offline' : false;
  }
}

export const ProviderHealthMonitor = new ProviderHealthMonitorService();
