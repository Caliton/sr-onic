import { logger } from '../utils/logger';
import { ProviderFactory } from '../llm/ProviderFactory';
import { Database } from '../database/Database';
import { Bot } from 'grammy';
import { config } from '../config';

const MODULE = 'HeartbeatService';

/**
 * Interface for custom watchers that can be registered by skills/agents.
 * This makes HeartbeatService extensible beyond system health checks.
 * 
 * Future use cases:
 * - Monitor email inbox for urgent messages
 * - Watch calendar for upcoming events
 * - Check external APIs for status changes
 * - Monitor file system for changes
 */
export interface HeartbeatWatcher {
  /** Unique identifier for the watcher */
  name: string;
  /** Human-readable description */
  description: string;
  /** The check function — returns null if healthy, or a message string if something needs attention */
  check: () => Promise<string | null>;
  /** Whether to alert the owner via Telegram when the check fails */
  alertOnFailure: boolean;
}

interface AlertState {
  lastAlertTime: number;
  consecutiveFailures: number;
}

export class HeartbeatService {
  private interval: ReturnType<typeof setInterval> | null = null;
  private providerFactory: ProviderFactory;
  private watchers: Map<string, HeartbeatWatcher> = new Map();
  private alertStates: Map<string, AlertState> = new Map();
  private sendAlert: ((message: string) => Promise<void>) | null = null;
  private alertCooldownMs: number = 15 * 60 * 1000; // 15 minutes between repeated alerts

  constructor(providerFactory: ProviderFactory) {
    this.providerFactory = providerFactory;

    // Register default system watchers
    this.registerSystemWatchers();
  }

  /**
   * Sets the function used to send alerts to the owner via Telegram.
   */
  public setAlertHandler(handler: (message: string) => Promise<void>): void {
    this.sendAlert = handler;
  }

  /**
   * Register a custom watcher. Skills or agents can use this to add
   * their own periodic checks (email, calendar, external APIs, etc.)
   */
  public registerWatcher(watcher: HeartbeatWatcher): void {
    this.watchers.set(watcher.name, watcher);
    logger.info(MODULE, `Watcher registered: ${watcher.name} — ${watcher.description}`);
  }

  /**
   * Remove a watcher by name.
   */
  public removeWatcher(name: string): void {
    this.watchers.delete(name);
    this.alertStates.delete(name);
    logger.info(MODULE, `Watcher removed: ${name}`);
  }

  /**
   * Get list of all registered watchers.
   */
  public listWatchers(): string {
    if (this.watchers.size === 0) return 'Nenhum watcher registrado.';

    return Array.from(this.watchers.values())
      .map(w => `• ${w.name}: ${w.description}`)
      .join('\n');
  }

  /**
   * Starts the heartbeat loop at the configured interval.
   */
  public start(intervalMs?: number): void {
    const ms = intervalMs || config.heartbeat.intervalMs;

    // Run first check immediately
    this.runAllChecks();

    this.interval = setInterval(() => {
      this.runAllChecks();
    }, ms);

    logger.info(MODULE, `HeartbeatService started: ${this.watchers.size} watchers, interval ${ms / 1000}s`);
  }

  /**
   * Stops the heartbeat loop.
   */
  public stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    logger.info(MODULE, 'HeartbeatService stopped');
  }

  /**
   * Runs all registered watchers and handles alerts.
   */
  public async runAllChecks(): Promise<void> {
    const results: string[] = [];

    for (const [name, watcher] of this.watchers) {
      try {
        const result = await watcher.check();

        if (result) {
          // Check failed — something needs attention
          logger.warn(MODULE, `[${name}] ⚠️ ${result}`);
          results.push(`⚠️ ${name}: ${result}`);

          if (watcher.alertOnFailure) {
            await this.handleAlert(name, result);
          }
        } else {
          // Check passed — reset alert state
          this.alertStates.delete(name);
        }
      } catch (err) {
        logger.error(MODULE, `[${name}] Watcher error: ${err}`);
      }
    }

    if (results.length === 0) {
      logger.debug(MODULE, 'All checks passed ✅');
    }
  }

  private async handleAlert(watcherName: string, message: string): Promise<void> {
    const now = Date.now();
    const state = this.alertStates.get(watcherName) || { lastAlertTime: 0, consecutiveFailures: 0 };
    state.consecutiveFailures++;

    // Rate limiting — don't spam alerts
    if (now - state.lastAlertTime < this.alertCooldownMs) {
      return;
    }

    state.lastAlertTime = now;
    this.alertStates.set(watcherName, state);

    if (this.sendAlert) {
      const alertMsg = `🚨 *Heartbeat Alert*\n\n` +
        `Watcher: \`${watcherName}\`\n` +
        `Falhas consecutivas: ${state.consecutiveFailures}\n` +
        `Mensagem: ${message}`;

      try {
        await this.sendAlert(alertMsg);
        logger.info(MODULE, `Alert sent for watcher: ${watcherName}`);
      } catch (err) {
        logger.error(MODULE, `Failed to send alert: ${err}`);
      }
    }
  }

  /**
   * Registers the default system health watchers.
   */
  private registerSystemWatchers(): void {
    // Database health
    this.registerWatcher({
      name: 'database',
      description: 'Verifica se o SQLite está acessível',
      alertOnFailure: true,
      check: async () => {
        try {
          const db = Database.getInstance();
          db.getDb().prepare('SELECT 1').get();
          return null; // healthy
        } catch {
          return 'Banco de dados SQLite inacessível';
        }
      },
    });

    // LLM Providers availability
    this.registerWatcher({
      name: 'llm_providers',
      description: 'Verifica se pelo menos 1 provider LLM está disponível',
      alertOnFailure: true,
      check: async () => {
        const available = this.providerFactory.getAvailableProviders();
        if (available.length === 0) {
          return 'Nenhum provedor de LLM disponível! Verifique as API keys.';
        }
        return null; // healthy
      },
    });

    // Memory usage
    this.registerWatcher({
      name: 'memory_usage',
      description: `Monitora uso de RAM (threshold: ${config.heartbeat.memoryThresholdMb}MB)`,
      alertOnFailure: true,
      check: async () => {
        const usage = process.memoryUsage();
        const heapUsedMb = Math.round(usage.heapUsed / 1024 / 1024);
        const rssMb = Math.round(usage.rss / 1024 / 1024);

        if (rssMb > config.heartbeat.memoryThresholdMb) {
          return `Uso de RAM elevado: ${rssMb}MB RSS (heap: ${heapUsedMb}MB)`;
        }
        return null; // healthy
      },
    });
  }
}
