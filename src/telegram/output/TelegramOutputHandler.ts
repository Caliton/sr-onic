import { Context } from 'grammy';
import { TextOutputStrategy } from './TextOutputStrategy';
import { FileOutputStrategy } from './FileOutputStrategy';
import { AudioOutputStrategy } from './AudioOutputStrategy';
import { ErrorOutputStrategy } from './ErrorOutputStrategy';
import { AgentLoopResult } from '../../agent/AgentLoop';
import { logger } from '../../utils/logger';

const MODULE = 'OutputHandler';

export class TelegramOutputHandler {
  private textStrategy: TextOutputStrategy;
  private fileStrategy: FileOutputStrategy;
  private audioStrategy: AudioOutputStrategy;
  private errorStrategy: ErrorOutputStrategy;

  constructor() {
    this.textStrategy = new TextOutputStrategy();
    this.fileStrategy = new FileOutputStrategy();
    this.audioStrategy = new AudioOutputStrategy();
    this.errorStrategy = new ErrorOutputStrategy();
  }

  public async send(
    ctx: Context,
    result: AgentLoopResult,
    requiresAudioReply: boolean = false
  ): Promise<void> {
    try {
      // Priority 1: Audio response
      if (requiresAudioReply && result.isAudio !== false) {
        logger.info(MODULE, 'Routing to AudioOutputStrategy');
        await this.audioStrategy.send(ctx, result.response);
        return;
      }

      // Priority 2: File response
      if (result.isFile && result.fileName) {
        logger.info(MODULE, `Routing to FileOutputStrategy: ${result.fileName}`);
        await this.fileStrategy.send(ctx, result.response, result.fileName);
        return;
      }

      // Priority 3: Default text response
      logger.info(MODULE, 'Routing to TextOutputStrategy');
      await this.textStrategy.send(ctx, result.response);
    } catch (err) {
      logger.error(MODULE, `Output failed: ${err}`);
      await this.errorStrategy.send(ctx, 'Erro ao enviar resposta. Tente novamente.');
    }
  }

  public async sendError(ctx: Context, error: string): Promise<void> {
    await this.errorStrategy.send(ctx, error);
  }
}
