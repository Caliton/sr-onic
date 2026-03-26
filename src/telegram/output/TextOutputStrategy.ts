import { Context } from 'grammy';
import { logger } from '../../utils/logger';

const MODULE = 'TextOutput';
const MAX_MESSAGE_LENGTH = 4096;

// Characters that need escaping in MarkdownV2
const MD_ESCAPE_CHARS = /([_*\[\]()~`>#+\-=|{}.!\\])/g;

export class TextOutputStrategy {
  public async send(ctx: Context, text: string): Promise<void> {
    const chunks = this.chunkText(text, MAX_MESSAGE_LENGTH);
    let typingInterval: ReturnType<typeof setInterval> | null = null;

    if (chunks.length > 1) {
      typingInterval = setInterval(() => {
        ctx.replyWithChatAction('typing').catch(() => {});
      }, 4000);
    }

    try {
      for (const chunk of chunks) {
        await this.sendChunk(ctx, chunk);
      }
    } finally {
      if (typingInterval) clearInterval(typingInterval);
    }
  }

  private async sendChunk(ctx: Context, text: string): Promise<void> {
    // Try MarkdownV2 first
    try {
      const escaped = this.escapeMarkdownV2(text);
      await ctx.reply(escaped, { parse_mode: 'MarkdownV2' });
      return;
    } catch (err) {
      logger.debug(MODULE, `MarkdownV2 failed, falling back to plain text`);
    }

    // Fallback: plain text
    try {
      await ctx.reply(text);
    } catch (err: any) {
      if (err?.error_code === 429) {
        const retryAfter = err?.parameters?.retry_after || 5;
        logger.warn(MODULE, `Rate limited. Retry after ${retryAfter}s`);
        await this.sleep(retryAfter * 1000);
        await ctx.reply(text);
      } else {
        throw err;
      }
    }
  }

  private escapeMarkdownV2(text: string): string {
    return text.replace(MD_ESCAPE_CHARS, '\\$1');
  }

  private chunkText(text: string, maxLen: number): string[] {
    if (text.length <= maxLen) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        chunks.push(remaining);
        break;
      }

      // Find a good split point (newline or space before limit)
      let splitAt = maxLen;

      // Try newline first
      const lastNewline = remaining.lastIndexOf('\n', maxLen);
      if (lastNewline > maxLen * 0.5) {
        splitAt = lastNewline + 1;
      } else {
        // Try space
        const lastSpace = remaining.lastIndexOf(' ', maxLen);
        if (lastSpace > maxLen * 0.5) {
          splitAt = lastSpace + 1;
        }
      }

      chunks.push(remaining.substring(0, splitAt));
      remaining = remaining.substring(splitAt);
    }

    return chunks;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
