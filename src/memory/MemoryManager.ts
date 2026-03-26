import { config } from '../config';
import { ConversationRepository, Conversation } from '../database/repositories/ConversationRepository';
import { MessageRepository, Message } from '../database/repositories/MessageRepository';
import { logger } from '../utils/logger';

export interface ContextMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
}

export class MemoryManager {
  private conversationRepo: ConversationRepository;
  private messageRepo: MessageRepository;

  constructor() {
    this.conversationRepo = new ConversationRepository();
    this.messageRepo = new MessageRepository();
  }

  public getOrCreateConversation(userId: string, provider: string): Conversation {
    return this.conversationRepo.findOrCreate(userId, provider);
  }

  public getContextMessages(conversationId: string): ContextMessage[] {
    let messages: Message[];

    try {
      // Primary: token-budget-based retrieval
      messages = this.messageRepo.getByTokenBudget(conversationId, config.memory.maxContextTokens);
    } catch {
      // Fallback: fixed window size
      logger.warn('MemoryManager', 'Token budget retrieval failed, using fixed window');
      messages = this.messageRepo.getRecentMessages(conversationId, config.memory.windowSize);
    }

    return messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
  }

  public saveUserMessage(conversationId: string, content: string): void {
    const tokenEstimate = Math.ceil(content.length / 4);
    this.messageRepo.addMessage(conversationId, 'user', content, tokenEstimate);
    this.conversationRepo.touch(conversationId);
  }

  public saveAssistantMessage(conversationId: string, content: string, provider?: string): void {
    const tokenEstimate = Math.ceil(content.length / 4);
    this.messageRepo.addMessage(conversationId, 'assistant', content, tokenEstimate, provider);
    this.conversationRepo.touch(conversationId);
  }

  public saveToolMessage(conversationId: string, content: string): void {
    const tokenEstimate = Math.ceil(content.length / 4);
    this.messageRepo.addMessage(conversationId, 'tool', content, tokenEstimate);
  }

  public resetConversation(userId: string): void {
    this.conversationRepo.resetConversation(userId);
    logger.info('MemoryManager', `Conversation reset for user ${userId}`);
  }

  public updateProvider(conversationId: string, provider: string): void {
    this.conversationRepo.updateProvider(conversationId, provider);
  }
}
