import { ILlmProvider } from './ILlmProvider';
import { GeminiProvider } from './providers/GeminiProvider';
import { DeepSeekProvider } from './providers/DeepSeekProvider';
import { config } from '../config';
import { logger } from '../utils/logger';

interface ProviderState {
  provider: ILlmProvider;
  consecutiveFailures: number;
  disabledUntil: number; // timestamp
}

const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 60_000; // 1 minute

export class ProviderFactory {
  private providers: Map<string, ProviderState> = new Map();
  private fallbackOrder: string[];

  constructor() {
    // Register all providers
    const gemini = new GeminiProvider();
    const deepseek = new DeepSeekProvider();

    if (gemini.isAvailable) {
      this.providers.set('gemini', { provider: gemini, consecutiveFailures: 0, disabledUntil: 0 });
    }
    if (deepseek.isAvailable) {
      this.providers.set('deepseek', { provider: deepseek, consecutiveFailures: 0, disabledUntil: 0 });
    }

    // Fallback order: default provider first, then the rest
    this.fallbackOrder = [config.llm.defaultProvider];
    for (const name of this.providers.keys()) {
      if (name !== config.llm.defaultProvider) {
        this.fallbackOrder.push(name);
      }
    }

    logger.info('ProviderFactory', `Registered providers: ${Array.from(this.providers.keys()).join(', ')}`);
    logger.info('ProviderFactory', `Fallback order: ${this.fallbackOrder.join(' -> ')}`);
  }

  public getProvider(name?: string): ILlmProvider | null {
    const targetName = name || config.llm.defaultProvider;
    const state = this.providers.get(targetName);

    if (!state) return null;
    if (this.isCircuitOpen(state)) {
      logger.warn('ProviderFactory', `Provider ${targetName} is circuit-broken, trying fallback`);
      return null;
    }

    return state.provider;
  }

  public getAvailableProviders(): string[] {
    const now = Date.now();
    return this.fallbackOrder.filter((name) => {
      const state = this.providers.get(name);
      return state && !this.isCircuitOpen(state);
    });
  }

  public getNextAvailable(excludeProvider?: string): ILlmProvider | null {
    for (const name of this.fallbackOrder) {
      if (name === excludeProvider) continue;
      const state = this.providers.get(name);
      if (state && !this.isCircuitOpen(state)) {
        return state.provider;
      }
    }
    return null;
  }

  public reportSuccess(providerName: string): void {
    const state = this.providers.get(providerName);
    if (state) {
      state.consecutiveFailures = 0;
    }
  }

  public reportFailure(providerName: string): void {
    const state = this.providers.get(providerName);
    if (state) {
      state.consecutiveFailures++;
      if (state.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
        state.disabledUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
        logger.warn(
          'ProviderFactory',
          `Circuit breaker OPEN for ${providerName}: ${state.consecutiveFailures} consecutive failures. Disabled for ${CIRCUIT_BREAKER_COOLDOWN_MS / 1000}s`
        );
      }
    }
  }

  private isCircuitOpen(state: ProviderState): boolean {
    if (state.consecutiveFailures < CIRCUIT_BREAKER_THRESHOLD) return false;
    if (Date.now() >= state.disabledUntil) {
      // Half-open: allow one attempt
      state.consecutiveFailures = CIRCUIT_BREAKER_THRESHOLD - 1;
      return false;
    }
    return true;
  }
}
