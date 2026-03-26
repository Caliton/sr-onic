import cron, { ScheduledTask } from 'node-cron';
import { logger } from '../utils/logger';
import { SkillMetadata } from '../skills/SkillLoader';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

const MODULE = 'CronScheduler';

export interface CronJob {
  id: string;
  source: string; // 'system' | skill name
  description: string;
  schedule: string;
  task: ScheduledTask;
}

export type CronAction = () => Promise<void>;

export class CronScheduler {
  private jobs: Map<string, CronJob> = new Map();
  private messageHandler: ((text: string) => Promise<void>) | null = null;

  /**
   * Sets the handler used to process cron-triggered messages.
   * This simulates a user message being sent to the AgentController.
   */
  public setMessageHandler(handler: (text: string) => Promise<void>): void {
    this.messageHandler = handler;
  }

  /**
   * Registers system-level cron jobs (cleanup, backup, etc.)
   */
  public registerSystemCrons(): void {
    // Cleanup tmp every 6 hours
    this.registerJob({
      id: 'system:cleanup_tmp',
      source: 'sistema',
      description: 'Limpeza do diretório ./tmp/',
      schedule: '0 */6 * * *',
      action: async () => {
        const tmpDir = config.paths.tmpDir;
        if (!fs.existsSync(tmpDir)) return;

        const files = fs.readdirSync(tmpDir);
        let cleaned = 0;
        for (const file of files) {
          try {
            fs.unlinkSync(path.join(tmpDir, file));
            cleaned++;
          } catch { /* ignore */ }
        }
        logger.info(MODULE, `[Cron] Cleaned ${cleaned} files from tmp`);
      },
    });

    // Backup SQLite DB daily at 3 AM
    this.registerJob({
      id: 'system:db_backup',
      source: 'sistema',
      description: 'Backup do banco SQLite',
      schedule: '0 3 * * *',
      action: async () => {
        const dbPath = config.memory.dbPath;
        if (!fs.existsSync(dbPath)) return;

        const backupPath = `${dbPath}.bak`;
        try {
          fs.copyFileSync(dbPath, backupPath);
          logger.info(MODULE, `[Cron] Database backed up to ${backupPath}`);
        } catch (err) {
          logger.error(MODULE, `[Cron] Database backup failed: ${err}`);
        }
      },
    });

    logger.info(MODULE, `System crons registered: ${2} jobs`);
  }

  /**
   * Registers cron jobs defined in skill frontmatter.
   * Each skill can define a "cron" array in its SKILL.md YAML.
   */
  public registerSkillCrons(skills: SkillMetadata[]): void {
    let count = 0;

    for (const skill of skills) {
      if (!skill.cron || skill.cron.length === 0) continue;

      for (let i = 0; i < skill.cron.length; i++) {
        const entry = skill.cron[i];

        if (!cron.validate(entry.schedule)) {
          logger.warn(MODULE, `Invalid cron expression for skill "${skill.name}": "${entry.schedule}" — skipping`);
          continue;
        }

        const jobId = `skill:${skill.name}:${i}`;
        this.registerJob({
          id: jobId,
          source: skill.name,
          description: entry.description || entry.action.substring(0, 50),
          schedule: entry.schedule,
          action: async () => {
            if (!this.messageHandler) {
              logger.warn(MODULE, `[Cron] No message handler set, cannot execute skill cron: ${jobId}`);
              return;
            }

            logger.info(MODULE, `[Cron] Firing skill cron "${skill.name}": ${entry.action.substring(0, 80)}`);
            try {
              await this.messageHandler(entry.action);
            } catch (err) {
              logger.error(MODULE, `[Cron] Skill cron failed "${skill.name}": ${err}`);
            }
          },
        });

        count++;
      }
    }

    logger.info(MODULE, `Skill crons registered: ${count} jobs from ${skills.filter(s => s.cron && s.cron.length > 0).length} skills`);
  }

  /**
   * Removes all cron jobs associated with a specific skill (for hot-reload).
   */
  public removeSkillCrons(skillName: string): void {
    const prefix = `skill:${skillName}:`;
    for (const [id, job] of this.jobs) {
      if (id.startsWith(prefix)) {
        job.task.stop();
        this.jobs.delete(id);
        logger.info(MODULE, `Removed cron job: ${id}`);
      }
    }
  }

  private registerJob(params: {
    id: string;
    source: string;
    description: string;
    schedule: string;
    action: CronAction;
  }): void {
    // Remove existing job with same ID if any
    if (this.jobs.has(params.id)) {
      this.jobs.get(params.id)!.task.stop();
    }

    const task = cron.schedule(params.schedule, params.action);
    task.stop(); // Create stopped, will be started in start()

    this.jobs.set(params.id, {
      id: params.id,
      source: params.source,
      description: params.description,
      schedule: params.schedule,
      task,
    });
  }

  /**
   * Starts all registered cron jobs.
   */
  public start(): void {
    for (const job of this.jobs.values()) {
      job.task.start();
    }
    logger.info(MODULE, `CronScheduler started: ${this.jobs.size} jobs active`);
  }

  /**
   * Stops all cron jobs gracefully.
   */
  public stop(): void {
    for (const job of this.jobs.values()) {
      job.task.stop();
    }
    logger.info(MODULE, 'CronScheduler stopped');
  }

  /**
   * Lists all active cron jobs in a human-readable format.
   */
  public listJobs(): string {
    if (this.jobs.size === 0) return 'Nenhum cron job ativo.';

    const lines: string[] = [];
    for (const job of this.jobs.values()) {
      lines.push(`• [${job.source}] ${job.description} — \`${job.schedule}\``);
    }
    return lines.join('\n');
  }

  /**
   * Returns the number of active jobs.
   */
  public getJobCount(): number {
    return this.jobs.size;
  }
}
