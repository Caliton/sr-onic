import { Context, InputFile } from 'grammy';
import fs from 'fs';
import path from 'path';
import { config } from '../../config';
import { logger } from '../../utils/logger';

const MODULE = 'FileOutput';

export class FileOutputStrategy {
  public async send(ctx: Context, content: string, fileName: string): Promise<void> {
    const tmpDir = config.paths.tmpDir;
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const filePath = path.join(tmpDir, fileName);

    try {
      // If file already exists on disk (binary, e.g. PDF from PdfGeneratorTool), send it directly
      // Otherwise, write content as text file
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, content, 'utf-8');
      }

      // Send as document
      await ctx.replyWithDocument(new InputFile(filePath, fileName), {
        caption: `📄 ${fileName}`,
      });

      logger.info(MODULE, `File sent: ${fileName}`);
    } catch (err: any) {
      logger.error(MODULE, `Failed to send file: ${err}`);

      // Fallback: send as text chunks
      if (err?.error_code === 429) {
        const retryAfter = err?.parameters?.retry_after || 5;
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        await ctx.replyWithDocument(new InputFile(filePath, fileName));
      } else {
        await ctx.reply(`⚠️ Não consegui gerar o arquivo, segue texto puro:\n\n${content.substring(0, 4000)}`);
      }
    } finally {
      // Cleanup temp file
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch {
        logger.warn(MODULE, `Failed to delete temp file: ${filePath}`);
      }
    }
  }
}
