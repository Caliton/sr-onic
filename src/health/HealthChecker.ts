import { execSync } from 'child_process';
import { logger } from '../utils/logger';
import { ProviderFactory } from '../llm/ProviderFactory';

const MODULE = 'HealthChecker';

export interface HealthStatus {
  whisperAvailable: boolean;
  ffmpegAvailable: boolean;
  providersAvailable: string[];
}

export class HealthChecker {
  private providerFactory: ProviderFactory;

  constructor(providerFactory: ProviderFactory) {
    this.providerFactory = providerFactory;
  }

  public async check(): Promise<HealthStatus> {
    logger.info(MODULE, '=== Starting Health Checks ===');

    const whisperAvailable = this.checkBinary('whisper', 'whisper --help');
    const ffmpegAvailable = this.checkBinary('ffmpeg', 'ffmpeg -version');
    const providersAvailable = this.providerFactory.getAvailableProviders();

    // Report
    logger.info(MODULE, `Whisper: ${whisperAvailable ? '✅ Available' : '⚠️ Not found (voice features disabled)'}`);
    logger.info(MODULE, `ffmpeg: ${ffmpegAvailable ? '✅ Available' : '⚠️ Not found (audio conversion limited)'}`);
    logger.info(MODULE, `LLM Providers: ${providersAvailable.length > 0 ? `✅ ${providersAvailable.join(', ')}` : '❌ None available!'}`);

    if (providersAvailable.length === 0) {
      logger.error(MODULE, 'CRITICAL: No LLM providers available. Check your API keys in .env');
    }

    logger.info(MODULE, '=== Health Checks Complete ===');

    return {
      whisperAvailable,
      ffmpegAvailable,
      providersAvailable,
    };
  }

  private checkBinary(name: string, command: string): boolean {
    try {
      execSync(command, { stdio: 'pipe', timeout: 5000 });
      return true;
    } catch {
      logger.warn(MODULE, `${name} not found in PATH`);
      return false;
    }
  }
}
