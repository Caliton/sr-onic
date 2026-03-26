import { v4 as uuidv4 } from 'uuid';
import { Database } from '../Database';
import { logger } from '../../utils/logger';

export interface Conversation {
  id: string;
  user_id: string;
  provider: string;
  created_at: string;
  updated_at: string;
}

export class ConversationRepository {
  private db;

  constructor() {
    this.db = Database.getInstance().getDb();
  }

  public findByUserId(userId: string): Conversation | null {
    const row = this.db
      .prepare('SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1')
      .get(userId) as Conversation | undefined;
    return row || null;
  }

  public findOrCreate(userId: string, provider: string): Conversation {
    let conversation = this.findByUserId(userId);
    if (!conversation) {
      const id = uuidv4();
      this.db
        .prepare('INSERT INTO conversations (id, user_id, provider) VALUES (?, ?, ?)')
        .run(id, userId, provider);
      conversation = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Conversation;
      logger.info('ConversationRepo', `New conversation created: ${id} for user ${userId}`);
    }
    return conversation;
  }

  public updateProvider(conversationId: string, provider: string): void {
    this.db
      .prepare('UPDATE conversations SET provider = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(provider, conversationId);
  }

  public resetConversation(userId: string): void {
    const conversation = this.findByUserId(userId);
    if (conversation) {
      this.db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversation.id);
      this.db.prepare('DELETE FROM conversations WHERE id = ?').run(conversation.id);
      logger.info('ConversationRepo', `Conversation reset for user ${userId}`);
    }
  }

  public touch(conversationId: string): void {
    this.db
      .prepare('UPDATE conversations SET updated_at = datetime(\'now\') WHERE id = ?')
      .run(conversationId);
  }
}
