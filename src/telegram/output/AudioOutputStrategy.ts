import { Context, InputFile } from 'grammy';
import fs from 'fs';
import path from 'path';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { TextOutputStrategy } from './TextOutputStrategy';

const MODULE = 'AudioOutput';

export class AudioOutputStrategy {
  private textFallback: TextOutputStrategy;

  constructor() {
    this.textFallback = new TextOutputStrategy();
  }

  public async send(ctx: Context, text: string, voiceId?: string): Promise<void> {
    const tmpDir = config.paths.tmpDir;
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const audioPath = path.join(tmpDir, `${Date.now()}_tts.ogg`);

    // Start upload_voice action
    const typingInterval = setInterval(() => {
      ctx.replyWithChatAction('upload_voice').catch(() => {});
    }, 4000);

    try {
      // Clean markdown from text for TTS
      const cleanText = this.cleanForTts(text);

      // Generate audio using edge-tts-universal
      await this.synthesize(cleanText, audioPath, voiceId);

      // Send as voice note
      await ctx.replyWithVoice(new InputFile(audioPath));

      logger.info(MODULE, `Audio sent: ${audioPath}`);
    } catch (err) {
      logger.error(MODULE, `TTS failed: ${err}. Falling back to text.`);
      await ctx.reply('⚠️ Falha na geração de áudio. Enviando como texto:');
      await this.textFallback.send(ctx, text);
    } finally {
      clearInterval(typingInterval);

      // Cleanup temp file
      try {
        if (fs.existsSync(audioPath)) {
          fs.unlinkSync(audioPath);
        }
      } catch {
        logger.warn(MODULE, `Failed to delete temp audio: ${audioPath}`);
      }
    }
  }

  private async synthesize(text: string, outputPath: string, voiceId?: string): Promise<void> {
    try {
      const { Communicate } = await import('edge-tts-universal');
      const communicate = new Communicate(text, {
        voice: voiceId || config.tts.voice,
      });

      const audioChunks: Buffer[] = [];
      for await (const chunk of communicate.stream()) {
        if (chunk.type === 'audio' && chunk.data) {
          audioChunks.push(chunk.data);
        }
      }

      if (audioChunks.length === 0) {
        throw new Error('No audio data received from TTS');
      }

      const audioBuffer = Buffer.concat(audioChunks);
      fs.writeFileSync(outputPath, audioBuffer);
    } catch (err) {
      logger.error(MODULE, `edge-tts-universal synthesis error: ${err}`);
      throw err;
    }
  }

  private cleanForTts(text: string): string {
    return text
      .replace(/```[\s\S]*?```/g, '') // Remove code blocks
      .replace(/`[^`]+`/g, '') // Remove inline code
      .replace(/#+\s/g, '') // Remove headers
      .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold
      .replace(/\*(.*?)\*/g, '$1') // Remove italic
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Links to text only
      .replace(/[>|~_]/g, '') // Remove remaining markdown
      .replace(/\n{3,}/g, '\n\n') // Normalize newlines
      .trim();
  }
}
