import { InMemStorageProvider, Unleash } from 'unleash-client';
import type { Target } from './config.ts';

/**
 * One official Node SDK instance per target × environment. The SDK talks to the target through the
 * bench's recording proxy, so its real traffic (features polling with ETags, register, metrics) shows
 * up in the inspector exactly as a production backend would generate it.
 */

export interface SdkStatus {
  state: 'starting' | 'ready' | 'error' | 'no-token';
  lastError?: string;
  lastSyncAt?: string;
  flagCount?: number;
}

interface Entry {
  client?: Unleash;
  status: SdkStatus;
  ready: Promise<void>;
}

export const SDK_REFRESH_MS = 5000;

export class SdkPool {
  private entries = new Map<string, Entry>();
  private sdkUrl: (target: Target, env: string) => string;

  /** `sdkUrl` gives the SDK's `url` option (ends in `/api/`); the bench passes its recording proxy. */
  constructor(sdkUrl: (target: Target, env: string) => string) {
    this.sdkUrl = sdkUrl;
  }

  private key(target: string, env: string) {
    return `${target}|${env}`;
  }

  get(target: Target, env: string): Entry {
    const key = this.key(target.name, env);
    let entry = this.entries.get(key);
    if (entry) return entry;

    const token = target.tokens[env as keyof Target['tokens']]?.backend;
    if (!token) {
      entry = {
        status: { state: 'no-token', lastError: `no backend token configured for ${target.name}/${env}` },
        ready: Promise.resolve(),
      };
      this.entries.set(key, entry);
      return entry;
    }

    const status: SdkStatus = { state: 'starting' };
    const client = new Unleash({
      appName: 'testbench',
      instanceId: `testbench-${env}`,
      environment: env,
      url: this.sdkUrl(target, env),
      customHeaders: { Authorization: token },
      refreshInterval: SDK_REFRESH_MS,
      metricsInterval: 15_000,
      storageProvider: new InMemStorageProvider(),
      skipInstanceCountWarning: true,
      timeout: 10_000,
    });
    let settle!: () => void;
    const ready = new Promise<void>((r) => (settle = r));
    const onSync = () => {
      status.lastError = undefined;
      status.lastSyncAt = new Date().toISOString();
      status.flagCount = client.getFeatureToggleDefinitions()?.length ?? 0;
    };
    // isEnabled() returns the fallback until 'ready' — 'synchronized'/'changed' can fire earlier.
    client.on('ready', () => {
      onSync();
      status.state = 'ready';
      settle();
    });
    client.on('synchronized', onSync);
    client.on('changed', onSync);
    client.on('unchanged', () => {
      status.lastSyncAt = new Date().toISOString();
    });
    client.on('error', (e: Error) => {
      if (status.state !== 'ready') status.state = 'error';
      status.lastError = e?.message ?? String(e);
      settle();
    });
    client.on('warn', (msg: string) => {
      status.lastError = String(msg);
      if (status.state === 'starting') {
        status.state = 'error';
        settle();
      }
    });
    setTimeout(settle, 6000).unref();

    entry = { client, status, ready };
    this.entries.set(key, entry);
    return entry;
  }

  reset(targetName: string, env: string): void {
    const key = this.key(targetName, env);
    this.entries.get(key)?.client?.destroy();
    this.entries.delete(key);
  }

  destroyAll(): void {
    for (const e of this.entries.values()) e.client?.destroy();
    this.entries.clear();
  }
}
