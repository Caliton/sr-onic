import { Bot, Context } from 'grammy';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { logger } from '../utils/logger';
import { MessageQueue } from './MessageQueue';
import { AgentController } from '../agent/AgentController';
import { CronScheduler } from '../scheduler/CronScheduler';

const MODULE = 'TelegramInput';

// Audio reply keywords
const AUDIO_KEYWORDS = /responda?\s+em\s+[aá]udio|fale?\s+comigo|me\s+responda?\s+falando|resposta\s+em\s+voz/i;

export interface ProcessedInput {
  text: string;
  userId: string;
  chatId: number;
  requiresAudioReply: boolean;
  voiceId?: string;
  ctx: Context;
}

export class TelegramInputHandler {
  private bot: Bot;
  private messageQueue: MessageQueue;
  private controller: AgentController;
  private scheduler: CronScheduler | null;
  private whisperAvailable: boolean = false;
  private ffmpegAvailable: boolean = false;

  constructor(controller: AgentController, scheduler?: CronScheduler) {
    this.bot = new Bot(config.telegram.botToken);
    this.messageQueue = new MessageQueue();
    this.controller = controller;
    this.scheduler = scheduler || null;
  }

  public setHealthStatus(whisper: boolean, ffmpeg: boolean): void {
    this.whisperAvailable = whisper;
    this.ffmpegAvailable = ffmpeg;
  }

  public async start(): Promise<void> {
    // Whitelist middleware
    this.bot.use(async (ctx, next) => {
      const userId = ctx.from?.id;
      if (!userId || !config.telegram.allowedUserIds.includes(userId)) {
        logger.warn(MODULE, `Unauthorized access attempt from user ID: ${userId}`);
        return; // Silent ignore
      }
      await next();
    });

    // Ignore edited messages (EC-09)
    this.bot.on('edited_message', (ctx) => {
      logger.debug(MODULE, `Ignoring edited message from user ${ctx.from?.id}`);
    });

    // Register command handlers
    this.registerCommands();

    // Text messages
    this.bot.on('message:text', async (ctx) => {
      const userId = String(ctx.from!.id);
      const text = ctx.message.text;

      // Skip commands (handled separately)
      if (text.startsWith('/') && ['/reset', '/provider', '/skills', '/start', '/help', '/crons'].some(cmd => text.startsWith(cmd))) {
        return;
      }

      const requiresAudioReply = AUDIO_KEYWORDS.test(text);

      const input: ProcessedInput = {
        text,
        userId,
        chatId: ctx.chat.id,
        requiresAudioReply,
        voiceId: requiresAudioReply ? config.tts.voice : undefined,
        ctx,
      };

      await this.messageQueue.enqueue(userId, () => this.controller.handleMessage(input));
    });

    // Document handler (PDF/MD)
    this.bot.on('message:document', async (ctx) => {
      const userId = String(ctx.from!.id);
      const document = ctx.message.document;
      const caption = ctx.message.caption || '';

      if (!document) return;

      const mimeType = document.mime_type || '';
      const fileName = document.file_name || '';

      // Only support PDF and MD
      const isPdf = mimeType === 'application/pdf';
      const isMd = fileName.endsWith('.md');

      if (!isPdf && !isMd) {
        await ctx.reply('⚠️ No momento, só consigo processar texto estruturado (.md), áudio e PDF.');
        return;
      }

      await ctx.replyWithChatAction('typing');

      try {
        const file = await ctx.getFile();
        const filePath = path.join(config.paths.tmpDir, `${Date.now()}_${fileName}`);

        // Ensure tmp dir exists
        if (!fs.existsSync(config.paths.tmpDir)) {
          fs.mkdirSync(config.paths.tmpDir, { recursive: true });
        }

        // Download file
        await this.downloadFile(file.file_path!, filePath);

        let extractedText = '';

        if (isPdf) {
          extractedText = await this.parsePdf(filePath);
        } else if (isMd) {
          extractedText = fs.readFileSync(filePath, 'utf-8');
        }

        // Cleanup temp file
        this.safeDelete(filePath);

        if (!extractedText.trim()) {
          await ctx.reply('⚠️ Não consegui extrair texto do arquivo. O documento pode estar vazio ou corrompido.');
          return;
        }

        const fullText = caption
          ? `${caption}\n\n--- Conteúdo do arquivo ${fileName} ---\n${extractedText}`
          : `--- Conteúdo do arquivo ${fileName} ---\n${extractedText}`;

        const requiresAudioReply = AUDIO_KEYWORDS.test(caption);

        const input: ProcessedInput = {
          text: fullText,
          userId,
          chatId: ctx.chat.id,
          requiresAudioReply,
          voiceId: requiresAudioReply ? config.tts.voice : undefined,
          ctx,
        };

        await this.messageQueue.enqueue(userId, () => this.controller.handleMessage(input));
      } catch (err) {
        logger.error(MODULE, `Document processing error: ${err}`);
        this.safeDeleteTmpFiles();
        await ctx.reply('⚠️ Falha ao processar o documento. Tente novamente.');
      }
    });

    // Voice/Audio handler
    this.bot.on(['message:voice', 'message:audio'], async (ctx) => {
      const userId = String(ctx.from!.id);

      if (!this.whisperAvailable || !this.ffmpegAvailable) {
        const reason = !this.whisperAvailable ? 'Whisper' : 'ffmpeg';
        await ctx.reply(`⚠️ Funcionalidade de voz desabilitada: ${reason} não encontrado. Envie sua mensagem como texto.`);
        return;
      }

      await ctx.replyWithChatAction('record_voice');

      try {
        const file = await ctx.getFile();
        const ext = ctx.message.voice ? '.ogg' : '.mp3';
        const filePath = path.join(config.paths.tmpDir, `${Date.now()}_audio${ext}`);

        if (!fs.existsSync(config.paths.tmpDir)) {
          fs.mkdirSync(config.paths.tmpDir, { recursive: true });
        }

        await this.downloadFile(file.file_path!, filePath);

        const transcript = await this.transcribeAudio(filePath);

        // Cleanup
        this.safeDelete(filePath);

        if (!transcript || transcript.trim() === '') {
          await ctx.reply('Áudio vazio captado. Pode reenviar?');
          return;
        }

        logger.info(MODULE, `Transcript: ${transcript.substring(0, 100)}...`);

        const input: ProcessedInput = {
          text: transcript,
          userId,
          chatId: ctx.chat.id,
          requiresAudioReply: true, // Voice input defaults to audio reply
          voiceId: config.tts.voice, // G-05: inject TTS voice preference
          ctx,
        };

        await this.messageQueue.enqueue(userId, () => this.controller.handleMessage(input));
      } catch (err) {
        logger.error(MODULE, `Audio processing error: ${err}`);
        this.safeDeleteTmpFiles();
        await ctx.reply('⚠️ Falha ao processar o áudio: arquivo grande demais ou falha no serviço.');
      }
    });

    // Unsupported media types
    this.bot.on(['message:photo', 'message:video', 'message:sticker'], async (ctx) => {
      await ctx.reply('⚠️ No momento, só consigo processar texto estruturado (.md), áudio e PDF.');
    });

    // Start polling
    logger.info(MODULE, 'Starting Telegram bot polling...');
    this.bot.start({
      onStart: () => {
        logger.info(MODULE, '✅ Bot is running and listening for messages');
      },
    });
  }

  private registerCommands(): void {
    this.bot.command('start', async (ctx) => {
      await ctx.reply(
        '🤖 Olá! Eu sou o SrOnic, seu agente pessoal de IA.\n\n' +
        'Comandos disponíveis:\n' +
        '/reset - Limpar contexto da conversa\n' +
        '/provider <nome> - Trocar o provedor de LLM (gemini, deepseek)\n' +
        '/skills - Listar skills disponíveis\n' +
        '/help - Mostrar esta mensagem'
      );
    });

    this.bot.command('help', async (ctx) => {
      await ctx.reply(
        '🤖 SrOnic - Comandos:\n\n' +
        '/reset - Limpar contexto da conversa\n' +
        '/provider <nome> - Trocar provedor (gemini, deepseek)\n' +
        '/skills - Listar skills disponíveis'
      );
    });

    this.bot.command('reset', async (ctx) => {
      const userId = String(ctx.from!.id);
      this.controller.handleReset(userId);
      await ctx.reply('🔄 Contexto da conversa limpo com sucesso!');
    });

    this.bot.command('provider', async (ctx) => {
      const userId = String(ctx.from!.id);
      const providerName = ctx.match?.trim();

      if (!providerName) {
        const current = this.controller.getCurrentProvider(userId);
        const available = this.controller.getAvailableProviders();
        await ctx.reply(
          `🧠 Provider atual: ${current}\nDisponíveis: ${available.join(', ')}`
        );
        return;
      }

      const success = this.controller.handleProviderSwitch(userId, providerName);
      if (success) {
        await ctx.reply(`✅ Provider alterado para: ${providerName}`);
      } else {
        await ctx.reply(`⚠️ Provider '${providerName}' não disponível.`);
      }
    });

    this.bot.command('skills', async (ctx) => {
      const skillsList = this.controller.getSkillsList();
      if (skillsList.length === 0) {
        await ctx.reply('📋 Nenhuma skill instalada no momento.');
      } else {
        await ctx.reply('📋 Skills disponíveis:\n\n' + skillsList);
      }
    });

    this.bot.command('crons', async (ctx) => {
      if (!this.scheduler) {
        await ctx.reply('⚠️ Scheduler não está ativo.');
        return;
      }
      const jobsList = this.scheduler.listJobs();
      await ctx.reply('⏰ Cron Jobs Ativos:\n\n' + jobsList);
    });
  }

  private async downloadFile(telegramPath: string, localPath: string): Promise<void> {
    const url = `https://api.telegram.org/file/bot${config.telegram.botToken}/${telegramPath}`;

    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(localPath, buffer);
  }

  private async parsePdf(filePath: string): Promise<string> {
    try {
      const pdfParse = (await import('pdf-parse')).default;
      const dataBuffer = fs.readFileSync(filePath);

      // Size check (20MB max)
      if (dataBuffer.length > 20 * 1024 * 1024) {
        throw new Error('PDF excede o limite de 20MB');
      }

      const data = await pdfParse(dataBuffer);
      return data.text;
    } catch (err) {
      logger.error(MODULE, `PDF parse error: ${err}`);
      throw err;
    }
  }

  private async transcribeAudio(filePath: string): Promise<string> {
    const { execSync } = await import('child_process');

    try {
      // Use Whisper CLI (assumes whisper is in PATH)
      const result = execSync(
        `whisper "${filePath}" --model base --language pt --output_format txt --output_dir "${config.paths.tmpDir}"`,
        { timeout: 60000, encoding: 'utf-8' }
      );

      // Read the transcript file
      const txtFile = filePath.replace(/\.[^.]+$/, '.txt');
      if (fs.existsSync(txtFile)) {
        const transcript = fs.readFileSync(txtFile, 'utf-8').trim();
        this.safeDelete(txtFile);
        return transcript;
      }

      // Fallback: parse stdout
      return result.trim();
    } catch (err) {
      logger.error(MODULE, `Whisper transcription error: ${err}`);
      throw err;
    }
  }

  private safeDelete(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      logger.warn(MODULE, `Failed to delete temp file: ${filePath}`);
    }
  }

  private safeDeleteTmpFiles(): void {
    try {
      if (fs.existsSync(config.paths.tmpDir)) {
        const files = fs.readdirSync(config.paths.tmpDir);
        for (const file of files) {
          this.safeDelete(path.join(config.paths.tmpDir, file));
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  public stop(): void {
    this.bot.stop();
    logger.info(MODULE, 'Telegram bot stopped');
  }
}
