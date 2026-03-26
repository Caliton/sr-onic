import { Context } from 'grammy';
import { logger } from '../../utils/logger';

const MODULE = 'TextOutput';
const MAX_MESSAGE_LENGTH = 4096;

// Characters that need escaping in MarkdownV2 plain text segments
const MD_V2_SPECIAL = /([_*\[\]()~`>#+=|{}.!\\-])/g;

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
    // Try smart Markdown → MarkdownV2 conversion first
    try {
      const converted = this.markdownToTelegramV2(text);
      await ctx.reply(converted, { parse_mode: 'MarkdownV2' });
      return;
    } catch (err) {
      logger.debug(MODULE, `MarkdownV2 conversion failed, falling back to plain text`);
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

  /**
   * Converts standard Markdown (as LLMs generate) to Telegram MarkdownV2.
   *
   * Strategy: process the text in segments, protecting code blocks and inline
   * code from escaping, then converting formatting tokens and escaping the rest.
   */
  private markdownToTelegramV2(text: string): string {
    // Step 1: Extract and protect code blocks (```...```)
    const codeBlocks: string[] = [];
    let processed = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
      const placeholder = `\x00CB${codeBlocks.length}\x00`;
      // In MarkdownV2 code blocks, no escaping is needed inside
      codeBlocks.push(`\`\`\`${lang}\n${code}\`\`\``);
      return placeholder;
    });

    // Step 2: Extract and protect inline code (`...`)
    const inlineCodes: string[] = [];
    processed = processed.replace(/`([^`\n]+)`/g, (_match, code) => {
      const placeholder = `\x00IC${inlineCodes.length}\x00`;
      // In MarkdownV2 inline code, no escaping is needed inside
      inlineCodes.push(`\`${code}\``);
      return placeholder;
    });

    // Step 3: Extract and protect links [text](url)
    const links: string[] = [];
    processed = processed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, linkText, url) => {
      const placeholder = `\x00LK${links.length}\x00`;
      // Escape text inside brackets, but NOT the URL
      links.push(`[${this.escapeV2(linkText)}](${url})`);
      return placeholder;
    });

    // Step 4: Convert Markdown formatting to MarkdownV2 equivalents
    // Headers → bold (Telegram has no header support)
    processed = processed.replace(/^#{1,6}\s+(.+)$/gm, (_match, content) => {
      return `\x00BOLD_S\x00${content}\x00BOLD_E\x00`;
    });

    // Bold: **text** → *text*
    processed = processed.replace(/\*\*(.+?)\*\*/g, (_match, content) => {
      return `\x00BOLD_S\x00${content}\x00BOLD_E\x00`;
    });

    // Bold: __text__ → *text*
    processed = processed.replace(/__(.+?)__/g, (_match, content) => {
      return `\x00BOLD_S\x00${content}\x00BOLD_E\x00`;
    });

    // Italic: *text* → _text_ (only single * not already consumed by bold)
    processed = processed.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, (_match, content) => {
      return `\x00ITAL_S\x00${content}\x00ITAL_E\x00`;
    });

    // Italic: _text_ → _text_ (only single _ not already consumed)
    processed = processed.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, (_match, content) => {
      return `\x00ITAL_S\x00${content}\x00ITAL_E\x00`;
    });

    // Strikethrough: ~~text~~ → ~text~
    processed = processed.replace(/~~(.+?)~~/g, (_match, content) => {
      return `\x00STRK_S\x00${content}\x00STRK_E\x00`;
    });

    // Step 5: Escape all special chars in remaining plain text
    // Split by our placeholders, escape only the non-placeholder parts
    const parts = processed.split(/(\x00(?:CB|IC|LK)\d+\x00|\x00(?:BOLD|ITAL|STRK)_[SE]\x00)/);
    const escaped = parts.map((part) => {
      // Keep placeholders as-is
      if (/^\x00(CB|IC|LK)\d+\x00$/.test(part)) return part;
      if (/^\x00(BOLD|ITAL|STRK)_[SE]\x00$/.test(part)) return part;
      // Escape plain text
      return this.escapeV2(part);
    }).join('');

    // Step 6: Restore formatting markers
    let result = escaped
      .replace(/\x00BOLD_S\x00/g, '*')
      .replace(/\x00BOLD_E\x00/g, '*')
      .replace(/\x00ITAL_S\x00/g, '_')
      .replace(/\x00ITAL_E\x00/g, '_')
      .replace(/\x00STRK_S\x00/g, '~')
      .replace(/\x00STRK_E\x00/g, '~');

    // Step 7: Restore protected segments
    for (let i = 0; i < links.length; i++) {
      result = result.replace(`\x00LK${i}\x00`, links[i]);
    }
    for (let i = 0; i < inlineCodes.length; i++) {
      result = result.replace(`\x00IC${i}\x00`, inlineCodes[i]);
    }
    for (let i = 0; i < codeBlocks.length; i++) {
      result = result.replace(`\x00CB${i}\x00`, codeBlocks[i]);
    }

    return result;
  }

  /** Escape special characters for MarkdownV2 plain text segments */
  private escapeV2(text: string): string {
    return text.replace(MD_V2_SPECIAL, '\\$1');
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
