import { ProcessedInput } from '../telegram/TelegramInputHandler';
import { TelegramOutputHandler } from '../telegram/output/TelegramOutputHandler';
import { AgentLoop, AgentLoopResult } from './AgentLoop';
import { MemoryManager, ContextMessage } from '../memory/MemoryManager';
import { ProviderFactory } from '../llm/ProviderFactory';
import { ToolRegistry } from '../tools/ToolRegistry';
import { SkillLoader, SkillMetadata } from '../skills/SkillLoader';
import { SkillRouter } from '../skills/SkillRouter';
import { SkillExecutor } from '../skills/SkillExecutor';
import { config } from '../config';
import { logger } from '../utils/logger';

const MODULE = 'AgentController';

const BASE_SYSTEM_PROMPT = `Você é o SrOnic, um agente pessoal de Inteligência Artificial. 
Você opera localmente no desktop do seu usuário e recebe comandos pelo Telegram.
Seja conciso, direto e útil. Responda sempre em português brasileiro, a menos que o usuário solicite outro idioma.
Quando precisar executar uma ação, use as ferramentas disponíveis.
Se não souber a resposta, seja honesto e diga que não sabe.`;

export class AgentController {
  private memoryManager: MemoryManager;
  private providerFactory: ProviderFactory;
  private toolRegistry: ToolRegistry;
  private agentLoop: AgentLoop;
  private outputHandler: TelegramOutputHandler;
  private skillLoader: SkillLoader;
  private skillRouter: SkillRouter;
  private skillExecutor: SkillExecutor;
  private skills: SkillMetadata[] = [];
  private userProviders: Map<string, string> = new Map();

  constructor(providerFactory: ProviderFactory, toolRegistry: ToolRegistry) {
    this.memoryManager = new MemoryManager();
    this.providerFactory = providerFactory;
    this.toolRegistry = toolRegistry;
    this.agentLoop = new AgentLoop(providerFactory, toolRegistry);
    this.outputHandler = new TelegramOutputHandler();
    this.skillLoader = new SkillLoader();
    this.skillRouter = new SkillRouter(providerFactory);
    this.skillExecutor = new SkillExecutor(this.skillLoader);

    // Load skills on initialization
    this.reloadSkills();
  }

  public reloadSkills(): void {
    this.skills = this.skillLoader.loadAll();
    logger.info(MODULE, `Skills loaded: ${this.skills.map((s) => s.name).join(', ') || 'none'}`);
  }

  public async handleMessage(input: ProcessedInput): Promise<void> {
    const { text, userId, ctx, requiresAudioReply } = input;

    try {
      logger.info(MODULE, `Processing message from user ${userId}: "${text.substring(0, 80)}..."`);

      // Get or create conversation
      const provider = this.getCurrentProvider(userId);
      const conversation = this.memoryManager.getOrCreateConversation(userId, provider);

      // Save user message
      this.memoryManager.saveUserMessage(conversation.id, text);

      // Reload skills (hot-reload)
      this.reloadSkills();

      // Route to skill
      const matchedSkill = await this.skillRouter.route(text, this.skills, userId);

      // Build system prompt
      let systemPrompt = BASE_SYSTEM_PROMPT;

      // Add available skills summary
      const skillsSummary = this.skillExecutor.buildAvailableSkillsSummary(this.skills);
      systemPrompt += skillsSummary;

      // Inject specific skill content if matched
      if (matchedSkill) {
        logger.info(MODULE, `Skill activated: ${matchedSkill.name}`);
        const skillPrompt = this.skillExecutor.getSkillSystemPrompt(matchedSkill);
        systemPrompt += skillPrompt;
      }

      // Add tool descriptions
      const toolDescriptions = this.toolRegistry.getToolDescriptions();
      if (toolDescriptions) {
        systemPrompt += `\n\nFerramentas disponíveis:\n${toolDescriptions}`;
      }

      // Get context messages
      const contextMessages = this.memoryManager.getContextMessages(conversation.id);

      // Run agent loop
      const result = await this.agentLoop.run(
        contextMessages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        systemPrompt,
        ctx,
        provider
      );

      // Save assistant response
      this.memoryManager.saveAssistantMessage(conversation.id, result.response, provider);

      // Send response via output handler
      await this.outputHandler.send(ctx, result, requiresAudioReply);

      logger.info(MODULE, `Response sent for user ${userId}`);
    } catch (err) {
      logger.error(MODULE, `Error processing message: ${err}`);
      await this.outputHandler.sendError(ctx, 'Erro interno ao processar sua mensagem. Tente novamente.');
    }
  }

  public handleReset(userId: string): void {
    this.memoryManager.resetConversation(userId);
    this.skillRouter.clearCache();
    logger.info(MODULE, `Reset executed for user ${userId}`);
  }

  public handleProviderSwitch(userId: string, providerName: string): boolean {
    const available = this.providerFactory.getAvailableProviders();
    if (!available.includes(providerName)) {
      return false;
    }

    this.userProviders.set(userId, providerName);

    // Update conversation provider too
    const conversation = this.memoryManager.getOrCreateConversation(userId, providerName);
    this.memoryManager.updateProvider(conversation.id, providerName);

    logger.info(MODULE, `Provider switched to ${providerName} for user ${userId}`);
    return true;
  }

  public getCurrentProvider(userId: string): string {
    return this.userProviders.get(userId) || config.llm.defaultProvider;
  }

  public getAvailableProviders(): string[] {
    return this.providerFactory.getAvailableProviders();
  }

  public getSkillsList(): string {
    if (this.skills.length === 0) return '';
    return this.skills
      .map((s) => `• ${s.name}: ${s.description}`)
      .join('\n');
  }

  public getLoadedSkills(): SkillMetadata[] {
    return this.skills;
  }
}
