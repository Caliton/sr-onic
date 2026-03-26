import BetterSqlite3 from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { config } from '../config';
import { logger } from '../utils/logger';

const CURRENT_SCHEMA_VERSION = 2;

export class Database {
  private static instance: Database;
  private db: BetterSqlite3.Database;

  private constructor() {
    const dbDir = path.dirname(config.memory.dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.db = new BetterSqlite3(config.memory.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');

    this.initSchema();
    this.runMigrations();

    logger.info('Database', `SQLite initialized at ${config.memory.dbPath} (WAL mode)`);
  }

  public static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }

  public getDb(): BetterSqlite3.Database {
    return this.db;
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'gemini',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        messages_processed INTEGER NOT NULL DEFAULT 0,
        tokens_estimated INTEGER NOT NULL DEFAULT 0,
        tool_calls_executed INTEGER NOT NULL DEFAULT 0,
        errors_count INTEGER NOT NULL DEFAULT 0,
        provider TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
    `);

    // Ensure schema_version has at least version 1
    const row = this.db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number | null };
    if (!row || row.v === null) {
      this.db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(1);
    }
  }

  private runMigrations(): void {
    const row = this.db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number };
    let currentVersion = row.v || 1;

    if (currentVersion < 2) {
      try {
        // Migration v2: add token_count and provider_used to messages
        const columns = this.db.pragma('table_info(messages)') as Array<{ name: string }>;
        const columnNames = columns.map((c) => c.name);

        if (!columnNames.includes('token_count')) {
          this.db.exec('ALTER TABLE messages ADD COLUMN token_count INTEGER');
        }
        if (!columnNames.includes('provider_used')) {
          this.db.exec('ALTER TABLE messages ADD COLUMN provider_used TEXT');
        }

        this.db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(2);
        currentVersion = 2;
        logger.info('Database', 'Migration v2 applied: added token_count, provider_used to messages');
      } catch (err) {
        logger.error('Database', `Migration v2 failed: ${err}`);
        throw err;
      }
    }

    logger.info('Database', `Schema at version ${currentVersion}/${CURRENT_SCHEMA_VERSION}`);
  }

  public close(): void {
    this.db.close();
    logger.info('Database', 'Connection closed');
  }
}
