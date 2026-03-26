import { Database } from '../Database';

export interface Message {
  id: number;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  token_count?: number;
  provider_used?: string;
  created_at: string;
}

export class MessageRepository {
  private db;

  constructor() {
    this.db = Database.getInstance().getDb();
  }

  public addMessage(
    conversationId: string,
    role: Message['role'],
    content: string,
    tokenCount?: number,
    providerUsed?: string
  ): void {
    // Strip null bytes (EC-02 from memory spec)
    const cleanContent = content.replace(/\u0000/g, '');

    this.db
      .prepare(
        'INSERT INTO messages (conversation_id, role, content, token_count, provider_used) VALUES (?, ?, ?, ?, ?)'
      )
      .run(conversationId, role, cleanContent, tokenCount ?? null, providerUsed ?? null);
  }

  public getRecentMessages(conversationId: string, limit: number): Message[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?'
      )
      .all(conversationId, limit) as Message[];
    return rows.reverse(); // Chronological order
  }

  public getByTokenBudget(conversationId: string, maxTokens: number): Message[] {
    // Fetch recent messages and accumulate until token budget is exhausted
    const allMessages = this.db
      .prepare(
        'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC'
      )
      .all(conversationId) as Message[];

    const result: Message[] = [];
    let totalTokens = 0;

    for (const msg of allMessages) {
      const tokenEstimate = msg.token_count || Math.ceil(msg.content.length / 4);
      if (totalTokens + tokenEstimate > maxTokens) break;
      totalTokens += tokenEstimate;
      result.unshift(msg); // Maintain chronological order
    }

    return result;
  }

  public deleteByConversation(conversationId: string): void {
    this.db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
  }
}
