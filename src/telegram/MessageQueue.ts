import { logger } from '../utils/logger';

interface QueueItem {
  userId: string;
  execute: () => Promise<void>;
  resolve: () => void;
}

export class MessageQueue {
  private queues: Map<string, QueueItem[]> = new Map();
  private processing: Map<string, boolean> = new Map();

  public async enqueue(userId: string, task: () => Promise<void>): Promise<void> {
    return new Promise<void>((resolve) => {
      const item: QueueItem = { userId, execute: task, resolve };

      if (!this.queues.has(userId)) {
        this.queues.set(userId, []);
      }

      this.queues.get(userId)!.push(item);

      if (!this.processing.get(userId)) {
        this.processQueue(userId);
      }
    });
  }

  private async processQueue(userId: string): Promise<void> {
    this.processing.set(userId, true);
    const queue = this.queues.get(userId);

    while (queue && queue.length > 0) {
      const item = queue.shift()!;
      try {
        await item.execute();
      } catch (err) {
        logger.error('MessageQueue', `Error processing message for user ${userId}: ${err}`);
      } finally {
        item.resolve();
      }
    }

    this.processing.set(userId, false);
  }
}
