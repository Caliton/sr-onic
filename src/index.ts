import fs from 'fs';
import path from 'path';
import { config } from './config';
import { logger } from './utils/logger';
import { Database } from './database/Database';
import { ProviderFactory } from './llm/ProviderFactory';
import { ToolRegistry } from './tools/ToolRegistry';
import { CurrentTimeTool } from './tools/implementations/CurrentTimeTool';
import { PdfGeneratorTool } from './tools/implementations/PdfGeneratorTool';
import { CreateSkillTool } from './tools/implementations/CreateSkillTool';
import { SaveActivityTool } from './tools/implementations/SaveActivityTool';

import { MarketAnalysisTool } from './tools/implementations/MarketAnalysisTool';
import { StrategyTool } from './tools/implementations/StrategyTool';
import { WebSearchTool } from './tools/implementations/WebSearchTool';
import { ListActivitiesTool } from './tools/implementations/ListActivitiesTool';
import { RequestIllustrationTool } from './tools/implementations/RequestIllustrationTool';
import { HealthChecker } from './health/HealthChecker';
import { HeartbeatService } from './health/HeartbeatService';
import { AgentController } from './agent/AgentController';
import { TelegramInputHandler } from './telegram/TelegramInputHandler';
import { CronScheduler } from './scheduler/CronScheduler';

const MODULE = 'Main';

async function bootstrap(): Promise<void> {
  logger.info(MODULE, '🚀 SrOnic Agent starting...');

  // Validate critical config
  if (!config.telegram.botToken) {
    logger.error(MODULE, 'FATAL: TELEGRAM_BOT_TOKEN is not set. Check your .env file.');
    process.exit(1);
  }

  if (config.telegram.allowedUserIds.length === 0) {
    logger.error(MODULE, 'FATAL: TELEGRAM_ALLOWED_USER_IDS is not set. Check your .env file.');
    process.exit(1);
  }

  // Step 1: Clean tmp directory (RF-05/RF-08)
  cleanTmpDir();

  // Step 2: Ensure required directories exist
  ensureDirectories();

  // Step 3: Initialize Database (Singleton)
  logger.info(MODULE, 'Initializing database...');
  Database.getInstance();

  // Step 4: Initialize LLM Provider Factory
  logger.info(MODULE, 'Initializing LLM providers...');
  const providerFactory = new ProviderFactory();

  // Step 5: Health Check
  logger.info(MODULE, 'Running health checks...');
  const healthChecker = new HealthChecker(providerFactory);
  const healthStatus = await healthChecker.check();

  // Step 6: Register Tools
  logger.info(MODULE, 'Registering tools...');
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(new CurrentTimeTool());
  toolRegistry.register(new PdfGeneratorTool(providerFactory));
  toolRegistry.register(new CreateSkillTool());
  toolRegistry.register(new SaveActivityTool(providerFactory));

  toolRegistry.register(new MarketAnalysisTool(providerFactory));
  toolRegistry.register(new StrategyTool(providerFactory));
  toolRegistry.register(new WebSearchTool());
  toolRegistry.register(new ListActivitiesTool());
  toolRegistry.register(new RequestIllustrationTool());

  // Step 7: Initialize Agent Controller (Facade)
  logger.info(MODULE, 'Initializing agent controller...');
  const controller = new AgentController(providerFactory, toolRegistry);

  // Step 8: Initialize Cron Scheduler
  logger.info(MODULE, 'Initializing cron scheduler...');
  const scheduler = new CronScheduler();
  scheduler.registerSystemCrons();
  scheduler.registerSkillCrons(controller.getLoadedSkills());

  // Step 9: Initialize Heartbeat Service
  logger.info(MODULE, 'Initializing heartbeat service...');
  const heartbeat = new HeartbeatService(providerFactory);

  // Step 10: Start Telegram Bot
  logger.info(MODULE, 'Starting Telegram bot...');
  const inputHandler = new TelegramInputHandler(controller, scheduler);
  inputHandler.setHealthStatus(healthStatus.whisperAvailable, healthStatus.ffmpegAvailable);
  await inputHandler.start();

  // Wire up cron message handler (needs bot to be running to send messages)
  const ownerId = config.telegram.allowedUserIds[0];
  scheduler.setMessageHandler(async (text: string) => {
    // Simulate a user message from the owner via the controller
    logger.info(MODULE, `[Cron] Simulating message: "${text.substring(0, 60)}..."`);
    const { Bot } = await import('grammy');
    const bot = new Bot(config.telegram.botToken);
    await bot.api.sendMessage(ownerId, `🕐 *Tarefa agendada:*\n${text}`);
  });

  // Wire up heartbeat alert handler
  heartbeat.setAlertHandler(async (message: string) => {
    try {
      const { Bot } = await import('grammy');
      const bot = new Bot(config.telegram.botToken);
      await bot.api.sendMessage(ownerId, message);
    } catch (err) {
      logger.error(MODULE, `Failed to send heartbeat alert: ${err}`);
    }
  });

  // Start scheduler and heartbeat
  if (config.scheduler.enabled) {
    scheduler.start();
    logger.info(MODULE, `Cron scheduler started: ${scheduler.getJobCount()} jobs`);
  } else {
    logger.info(MODULE, 'Cron scheduler disabled via config');
  }
  heartbeat.start();

  // Register ActivityWatcher — monitors ./data/activities/ for pending .md files
  heartbeat.registerWatcher({
    name: 'activity_watcher',
    description: 'Monitora ./data/activities/ por atividades .md pendentes para gerar PDF',
    alertOnFailure: false,
    check: async () => {
      const dir = config.paths.activitiesDir;
      if (!fs.existsSync(dir)) return null;

      const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const filePath = path.join(dir, file);
        const content = fs.readFileSync(filePath, 'utf-8');

        // Only process files explicitly marked as pending_review (exact match via regex)
        if (!/^status:\s*pending_review\s*$/m.test(content)) continue;

        logger.info(MODULE, `[ActivityWatcher] Found pending activity: ${file}`);

        const saveActivityTool = toolRegistry.getTool('save_activity') as SaveActivityTool;
        if (!saveActivityTool) continue;

        try {
          // Extract frontmatter fields
          const gradeMatch = content.match(/^grade:\s*(.+)$/m);
          const themeMatch = content.match(/^theme:\s*(.+)$/m);
          const typeMatch = content.match(/^type:\s*(.+)$/m);
          const titleMatch = content.match(/^title:\s*"?(.+?)"?\s*$/m);
          const bodyMatch = content.match(/^---[\s\S]*?---\s*([\s\S]*)$/m);

          const grade = gradeMatch?.[1]?.trim() || '1-ano';
          const theme = themeMatch?.[1]?.trim() || 'geral';
          const type = typeMatch?.[1]?.trim() || 'colorir';
          const title = titleMatch?.[1]?.trim() || file.replace('.md', '');
          const body = bodyMatch?.[1]?.trim() || content;

          const slug = `${grade}_${type}_${theme}`.replace(/\s+/g, '-').toLowerCase();

          // Generate PDF using the enriched prompt pipeline (strips teacher sections, adds SVG fallback, etc.)
          const pdfResult = await saveActivityTool.generatePdfFromActivity(content, slug, grade, type, theme);
          logger.info(MODULE, `[ActivityWatcher] PDF generated for: ${title}`);

          // Mark original file as done
          const updated = content.replace(/^status:\s*pending_review\s*$/m, 'status: done');
          fs.writeFileSync(filePath, updated, 'utf-8');

          // Notify owner via Telegram
          const tmpPdfPath = path.join(config.paths.tmpDir, `atividade_${slug}.pdf`);
          if (fs.existsSync(tmpPdfPath)) {
            const { Bot } = await import('grammy');
            const bot = new Bot(config.telegram.botToken);
            const { InputFile } = await import('grammy');
            await bot.api.sendDocument(ownerId, new InputFile(tmpPdfPath, `atividade_${slug}.pdf`), {
              caption: `📄 Atividade gerada: ${title}`,
            });
            fs.unlinkSync(tmpPdfPath);
          }
        } catch (err) {
          logger.error(MODULE, `[ActivityWatcher] Failed to process ${file}: ${err}`);
        }
      }
      return null;
    },
  });

  logger.info(MODULE, '✅ SrOnic Agent is fully operational!');

  // Graceful shutdown
  const shutdown = () => {
    logger.info(MODULE, 'Shutting down...');
    scheduler.stop();
    heartbeat.stop();
    inputHandler.stop();
    Database.getInstance().close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function cleanTmpDir(): void {
  const tmpDir = config.paths.tmpDir;
  if (fs.existsSync(tmpDir)) {
    const files = fs.readdirSync(tmpDir);
    for (const file of files) {
      try {
        fs.unlinkSync(`${tmpDir}/${file}`);
      } catch {
        // Ignore individual file deletion errors
      }
    }
    logger.info(MODULE, `Cleaned tmp directory: ${files.length} files removed`);
  }
}

function ensureDirectories(): void {
  const dirs = [
    config.paths.tmpDir,
    config.paths.dataDir,
    config.paths.skillsDir,
    config.paths.activitiesDir,
    config.logging.dir,
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      logger.info(MODULE, `Created directory: ${dir}`);
    }
  }
}

// Run
bootstrap().catch((err) => {
  console.error('Fatal error during bootstrap:', err);
  process.exit(1);
});
