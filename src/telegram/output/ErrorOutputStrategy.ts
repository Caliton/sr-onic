import { Context } from 'grammy';
import { logger } from '../../utils/logger';

const MODULE = 'ErrorOutput';

export class ErrorOutputStrategy {
  public async send(ctx: Context, error: string): Promise<void> {
    // Never expose internal stack traces or API keys
    const safeMessage = this.sanitizeError(error);

    try {
      await ctx.reply(`⚠️ ${safeMessage}`);
    } catch (err) {
      logger.error(MODULE, `Failed to send error message: ${err}`);
      // Last resort: try plain error
      try {
        await ctx.reply('⚠️ Ocorreu um erro interno. Tente novamente.');
      } catch {
        logger.error(MODULE, 'Complete failure sending error message to user');
      }
    }
  }

  private sanitizeError(error: string): string {
    // Remove potential API keys, tokens, paths
    let safe = error
      .replace(/[A-Za-z0-9_-]{30,}/g, '[REDACTED]') // Long tokens
      .replace(/\/[^\s]*node_modules[^\s]*/g, '[INTERNAL_PATH]') // Node paths
      .replace(/[A-Za-z]:\\[^\s]*/g, '[INTERNAL_PATH]') // Windows paths
      .replace(/https?:\/\/api\.[^\s]*/g, '[API_ENDPOINT]'); // API URLs

    // Truncate if too long
    if (safe.length > 500) {
      safe = safe.substring(0, 500) + '...';
    }

    return safe;
  }
}
