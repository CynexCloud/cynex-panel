import { EventEmitter } from 'events';
import { PluginEventPayloads } from './plugin.types';

class PluginEventBus extends EventEmitter {
  private static instance: PluginEventBus;

  private constructor() {
    super();
    // Allow large listener chains for logging, telemetry, sockets, etc.
    this.setMaxListeners(50);
  }

  public static getInstance(): PluginEventBus {
    if (!PluginEventBus.instance) {
      PluginEventBus.instance = new PluginEventBus();
    }
    return PluginEventBus.instance;
  }

  public emitTyped<K extends keyof PluginEventPayloads>(
    event: K,
    payload: PluginEventPayloads[K]
  ): boolean {
    return this.emit(event, payload);
  }

  public onTyped<K extends keyof PluginEventPayloads>(
    event: K,
    listener: (payload: PluginEventPayloads[K]) => void
  ): this {
    return this.on(event, listener);
  }

  public offTyped<K extends keyof PluginEventPayloads>(
    event: K,
    listener: (payload: PluginEventPayloads[K]) => void
  ): this {
    return this.off(event, listener);
  }
}

export const EventBus = PluginEventBus.getInstance();
